/**
 * scripts/verify-migrations.ts
 *
 * Phase 2C.1: Hardened Disposable Database & Migration Integrity Verification
 *
 * This script verifies that the repository's Prisma migration chain cleanly
 * bootstraps an empty database and reproduces the exact target schema defined
 * in prisma/schema.prisma with zero drift.
 *
 * HARDENED SAFETY INVARIANTS:
 * 1. Zero shell execution (no shell: true, no string interpolation into shells).
 * 2. DATABASE_URL passed exclusively via child process environment.
 * 3. Strict redaction of credentials in all log outputs and errors.
 * 4. Refuses execution on production, staging, remote, or cloud databases.
 * 5. Requires explicit acknowledgment (--disposable-acknowledged or DISPOSABLE_DB_ACKNOWLEDGED=true).
 * 6. Operates ONLY on an ephemeral, disposable database created specifically for verification.
 * 7. Complete behavioral verification of 5 critical uniqueness constraints.
 * 8. Exact verification of 5 required Cascade foreign-key relationships.
 * 9. Guaranteed cleanup of the disposable database upon completion or failure.
 */

import { spawnSync } from "node:child_process";
import { URL } from "node:url";
import { PrismaClient, Prisma } from "@prisma/client";

// --- Safety Configuration & Remote Guardrails ---
const BANNED_KEYWORDS = [
  "neon.tech",
  "supabase",
  "vercel",
  "liara",
  "render",
  "railway",
  "aws",
  "rds",
  "gcp",
  "cloudsql",
  "pooler",
  "azure",
  "cockroach",
  "planetscale",
  "prod",
  "stage",
  "live"
];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function sanitizeText(text: string): string {
  // Redact password or connection credentials from any text/error
  return text.replace(
    /(postgres(?:ql)?:\/\/)([^:@\s]+):([^@\s]+)@/gi,
    "$1$2:[REDACTED]@"
  );
}

function assertSafety(rawUrl: string, args: string[]) {
  const env = process.env;
  if (
    env.NODE_ENV === "production" ||
    env.APP_ENV === "production" ||
    env.APP_ENV === "staging" ||
    env.VERCEL === "1" ||
    env.VERCEL_ENV
  ) {
    throw new Error(
      "[VERIFICATION_SAFETY_VIOLATION] Execution refused: Environment indicates production, staging, or Vercel runtime."
    );
  }

  const hasAckArg = args.includes("--disposable-acknowledged");
  const hasAckEnv = env.DISPOSABLE_DB_ACKNOWLEDGED === "true";
  if (!hasAckArg && !hasAckEnv) {
    throw new Error(
      "[VERIFICATION_SAFETY_VIOLATION] Execution refused: Missing required explicit acknowledgment flag (--disposable-acknowledged or DISPOSABLE_DB_ACKNOWLEDGED=true)."
    );
  }

  if (!rawUrl) {
    throw new Error(
      "[VERIFICATION_SAFETY_VIOLATION] Execution refused: No PostgreSQL database URL provided. Pass --url or DISPOSABLE_DATABASE_URL or DATABASE_URL."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw new Error(`[VERIFICATION_SAFETY_VIOLATION] Invalid database URL: ${(err as Error).message}`);
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error(
      `[VERIFICATION_SAFETY_VIOLATION] Invalid protocol '${parsed.protocol}'. Expected postgresql: or postgres:.`
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  const fullLowerUrl = rawUrl.toLowerCase();
  for (const banned of BANNED_KEYWORDS) {
    if (fullLowerUrl.includes(banned)) {
      throw new Error(
        `[VERIFICATION_SAFETY_VIOLATION] Banned keyword '${banned}' detected in database URL. Refusing to run against potential remote/production target.`
      );
    }
  }

  if (!LOCAL_HOSTS.has(hostname) && !hostname.endsWith(".local")) {
    throw new Error(
      `[VERIFICATION_SAFETY_VIOLATION] Target host '${hostname}' is not a permitted local loopback address (127.0.0.1, localhost, ::1).`
    );
  }
}

/**
 * Execute a child process without shell interpolation.
 * Credentials are passed exclusively via child process environment.
 */
function runProcess(
  executable: string,
  args: string[],
  envOverrides: Record<string, string> = {}
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(executable, args, {
    shell: false,
    encoding: "utf8",
    env: { ...process.env, ...envOverrides }
  });

  if (result.error) {
    throw new Error(
      `Execution error [${executable} ${args.join(" ")}]: ${sanitizeText(result.error.message)}`
    );
  }

  if (result.status !== 0) {
    const errorMsg = sanitizeText(result.stderr || result.stdout || `Exit code ${result.status}`);
    throw new Error(`Command failed [${executable} ${args.join(" ")}]: ${errorMsg}`);
  }

  return result;
}

/**
 * Helper to assert that a Prisma operation throws an authentic P2002 Unique Constraint violation.
 */
async function assertUniqueConstraintViolation(
  operation: () => Promise<unknown>,
  expectedFields: string[],
  description: string
): Promise<void> {
  try {
    await operation();
    throw new Error(`FAILED: Unique constraint was not enforced for ${description} (operation succeeded).`);
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        const rawTarget = err.meta?.target;
        const targets: string[] = Array.isArray(rawTarget)
          ? rawTarget.map(String)
          : rawTarget
            ? [String(rawTarget)]
            : [];

        const allExpectedPresent = expectedFields.every((f) =>
          targets.some((t) => t.includes(f)) || err.message.includes(f)
        );

        if (!allExpectedPresent && targets.length > 0) {
          throw new Error(
            `Unique violation target mismatch for ${description}. Expected [${expectedFields.join(", ")}], got [${targets.join(", ")}].`
          );
        }
        return; // Passed verification
      }
      throw new Error(
        `Unexpected Prisma error code '${err.code}' (expected P2002) for ${description}: ${sanitizeText(err.message)}`
      );
    }

    if ((err as Error).message.startsWith("FAILED:")) {
      throw err;
    }

    throw new Error(
      `Unexpected non-Prisma exception during ${description} test: ${sanitizeText((err as Error).message)}`
    );
  }
}

async function main() {
  const args = process.argv.slice(2);

  let rawUrl = process.env.DISPOSABLE_DATABASE_URL || process.env.DATABASE_URL || "";
  const urlArgIndex = args.indexOf("--url");
  if (urlArgIndex !== -1 && args[urlArgIndex + 1]) {
    rawUrl = args[urlArgIndex + 1];
  }

  console.log("================================================================");
  console.log("  PHASE 2C.1: HARDENED DISPOSABLE DATABASE VERIFICATION");
  console.log("================================================================");

  // 1. Enforce safety invariants
  assertSafety(rawUrl, args);
  console.log("✓ Safety checks passed: Non-production environment and local loopback target verified.");

  const parsedUrl = new URL(rawUrl);
  const maintenanceDb = parsedUrl.pathname.replace(/^\//, "") || "postgres";

  // Create unique ephemeral database name
  const disposableDbName = `bushido_disposable_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  parsedUrl.pathname = `/${disposableDbName}`;
  const disposableDbUrl = parsedUrl.toString();

  const maintenanceUrlObj = new URL(rawUrl);
  maintenanceUrlObj.pathname = `/${maintenanceDb}`;
  const maintenanceUrl = maintenanceUrlObj.toString();

  console.log(`✓ Ephemeral target database generated: ${disposableDbName}`);

  let dbCreated = false;

  const teardownDisposableDb = async () => {
    if (!dbCreated) return;
    console.log(`\n[Teardown] Dropping ephemeral database: ${disposableDbName}...`);
    try {
      const maintenancePrisma = new PrismaClient({
        datasources: { db: { url: maintenanceUrl } }
      });
      await maintenancePrisma.$executeRawUnsafe(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '${disposableDbName}' AND pid <> pg_backend_pid();
      `);
      await maintenancePrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${disposableDbName}";`);
      await maintenancePrisma.$disconnect();
      dbCreated = false;
      console.log(`✓ Ephemeral database dropped cleanly: ${disposableDbName}`);
    } catch (dropErr) {
      console.error(`! Warning: Failed to drop ephemeral database during teardown: ${sanitizeText((dropErr as Error).message)}`);
    }
  };

  process.on("SIGINT", async () => {
    await teardownDisposableDb();
    process.exit(1);
  });
  process.on("SIGTERM", async () => {
    await teardownDisposableDb();
    process.exit(1);
  });

  try {
    // 2. Create the disposable database via direct parameterized maintenance client
    console.log(`[1/7] Creating disposable database '${disposableDbName}'...`);
    const maintenancePrisma = new PrismaClient({
      datasources: { db: { url: maintenanceUrl } }
    });
    await maintenancePrisma.$executeRawUnsafe(`CREATE DATABASE "${disposableDbName}";`);
    await maintenancePrisma.$disconnect();
    dbCreated = true;
    console.log(`✓ Disposable database created successfully.`);

    // 3. Run prisma validate without shell interpolation
    console.log(`[2/7] Running 'prisma validate'...`);
    const validateRes = runProcess("npx", ["prisma", "validate"], {
      DATABASE_URL: disposableDbUrl
    });
    console.log(`✓ Prisma schema validation: ${validateRes.stdout.trim() || "valid"}`);

    // 4. Run prisma migrate deploy without shell interpolation
    console.log(`[3/7] Running 'prisma migrate deploy' on disposable database...`);
    const deployRes = runProcess("npx", ["prisma", "migrate", "deploy"], {
      DATABASE_URL: disposableDbUrl
    });
    console.log(sanitizeText(deployRes.stdout.trim()));
    console.log(`✓ Migration history applied cleanly to fresh database.`);

    // 5. Verify zero schema drift using read-only prisma migrate diff without credentials in args
    console.log(`[4/7] Checking for schema drift against prisma/schema.prisma...`);
    const driftRes = runProcess(
      "npx",
      [
        "prisma",
        "migrate",
        "diff",
        "--from-schema-datamodel",
        "prisma/schema.prisma",
        "--to-schema-datasource",
        "prisma/schema.prisma",
        "--exit-code"
      ],
      { DATABASE_URL: disposableDbUrl }
    );
    if (driftRes.status !== 0) {
      throw new Error(`Schema drift detected!\n${sanitizeText(driftRes.stdout || driftRes.stderr)}`);
    }
    console.log(`✓ Zero schema drift confirmed: Migrations reproduce current schema exactly.`);

    // 6. Deep structural inspection
    console.log(`[5/7] Verifying structural database objects (tables, enums, constraints, foreign keys)...`);
    const prisma = new PrismaClient({
      datasources: { db: { url: disposableDbUrl } }
    });

    // 6a. Verify required tables
    const tables: Array<{ table_name: string }> = await prisma.$queryRawUnsafe(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);
    const tableNames = new Set(tables.map((t) => t.table_name));
    const requiredTables = ["User", "Cycle", "DailyLog", "OtpCode", "Subscription", "_prisma_migrations"];
    for (const reqTable of requiredTables) {
      if (!tableNames.has(reqTable)) {
        throw new Error(`Missing expected table: ${reqTable}`);
      }
    }
    console.log(`  ✓ All required tables exist: ${requiredTables.join(", ")}`);

    // 6b. Verify required enums
    const enums: Array<{ typname: string }> = await prisma.$queryRawUnsafe(`
      SELECT typname
      FROM pg_type
      WHERE typname IN ('UserRole', 'UserTier', 'DayStatus', 'SubscriptionStatus');
    `);
    const enumNames = new Set(enums.map((e) => e.typname));
    const requiredEnums = ["UserRole", "UserTier", "DayStatus", "SubscriptionStatus"];
    for (const reqEnum of requiredEnums) {
      if (!enumNames.has(reqEnum)) {
        throw new Error(`Missing expected enum: ${reqEnum}`);
      }
    }
    console.log(`  ✓ All required enums exist: ${requiredEnums.join(", ")}`);

    // 6c. Verify critical concurrency, idempotency, and auth columns
    const columns: Array<{ table_name: string; column_name: string }> = await prisma.$queryRawUnsafe(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public';
    `);
    const hasColumn = (tbl: string, col: string) =>
      columns.some((c) => c.table_name === tbl && c.column_name === col);

    if (!hasColumn("User", "tokenVersion")) throw new Error("Missing User.tokenVersion");
    if (!hasColumn("Cycle", "revision")) throw new Error("Missing Cycle.revision");
    if (!hasColumn("DailyLog", "revision")) throw new Error("Missing DailyLog.revision");
    if (!hasColumn("DailyLog", "lastClientOperationId")) throw new Error("Missing DailyLog.lastClientOperationId");
    if (!hasColumn("OtpCode", "purpose")) throw new Error("Missing OtpCode.purpose");
    if (!hasColumn("OtpCode", "codeHash")) throw new Error("Missing OtpCode.codeHash");
    if (!hasColumn("Subscription", "authority")) throw new Error("Missing Subscription.authority");
    console.log(`  ✓ Critical fields verified (tokenVersion, revision, lastClientOperationId, etc.)`);

    // 6d. Strengthened Foreign Key Verification: Check all 5 exact relationships
    interface ForeignKeyRow {
      table_name: string;
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
      delete_rule: string;
    }

    const discoveredFks: ForeignKeyRow[] = await prisma.$queryRawUnsafe(`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints AS rc
        ON tc.constraint_name = rc.constraint_name
        AND tc.table_schema = rc.constraint_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public';
    `);

    const expectedForeignKeys = [
      { table: "Cycle", column: "userId", foreignTable: "User", foreignColumn: "id", deleteRule: "CASCADE" },
      { table: "DailyLog", column: "userId", foreignTable: "User", foreignColumn: "id", deleteRule: "CASCADE" },
      { table: "DailyLog", column: "cycleId", foreignTable: "Cycle", foreignColumn: "id", deleteRule: "CASCADE" },
      { table: "OtpCode", column: "userId", foreignTable: "User", foreignColumn: "id", deleteRule: "CASCADE" },
      { table: "Subscription", column: "userId", foreignTable: "User", foreignColumn: "id", deleteRule: "CASCADE" }
    ];

    if (discoveredFks.length !== expectedForeignKeys.length) {
      throw new Error(
        `Foreign key count mismatch. Expected ${expectedForeignKeys.length}, found ${discoveredFks.length}.`
      );
    }

    for (const exp of expectedForeignKeys) {
      const match = discoveredFks.find(
        (f) =>
          f.table_name === exp.table &&
          f.column_name === exp.column &&
          f.foreign_table_name === exp.foreignTable &&
          f.foreign_column_name === exp.foreignColumn
      );

      if (!match) {
        throw new Error(
          `Missing expected foreign key: ${exp.table}.${exp.column} -> ${exp.foreignTable}.${exp.foreignColumn}`
        );
      }

      if (match.delete_rule !== exp.deleteRule) {
        throw new Error(
          `Foreign key delete behavior mismatch for ${exp.table}.${exp.column}: expected ${exp.deleteRule}, got ${match.delete_rule}`
        );
      }
      console.log(`  ✓ FK Verified: ${exp.table}.${exp.column} -> ${exp.foreignTable}.${exp.foreignColumn} [ON DELETE ${match.delete_rule}]`);
    }

    // 7. Behavioral verification of ALL 5 critical uniqueness constraints
    console.log(`[6/7] Behavioral verification of 5 critical uniqueness constraints & Cascade behavior...`);

    const synthUserIdA = `synth_usr_a_${Date.now()}`;
    const synthPhoneA = "+989120000088";
    const synthEmailA = `synth_a_${Date.now()}@test.internal`;

    // 7a. Insert initial User A
    await prisma.user.create({
      data: {
        id: synthUserIdA,
        phoneNumber: synthPhoneA,
        email: synthEmailA,
        name: "Synthetic User A",
        role: "FREE",
        tokenVersion: 0
      }
    });

    // 7b. Verify User.phoneNumber uniqueness
    await assertUniqueConstraintViolation(
      () =>
        prisma.user.create({
          data: {
            id: `synth_dup_phone_${Date.now()}`,
            phoneNumber: synthPhoneA, // duplicate
            name: "Duplicate Phone User"
          }
        }),
      ["phoneNumber"],
      "User.phoneNumber uniqueness"
    );
    console.log(`  ✓ 1/5 Verified: User.phoneNumber uniqueness strictly enforced.`);

    // 7c. Verify User.email uniqueness
    await assertUniqueConstraintViolation(
      () =>
        prisma.user.create({
          data: {
            id: `synth_dup_email_${Date.now()}`,
            email: synthEmailA, // duplicate
            name: "Duplicate Email User"
          }
        }),
      ["email"],
      "User.email uniqueness"
    );
    console.log(`  ✓ 2/5 Verified: User.email uniqueness strictly enforced.`);

    // Create Cycle 1 for User A
    const synthCycle1 = await prisma.cycle.create({
      data: {
        userId: synthUserIdA,
        title: "Synthetic Test Cycle 1",
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        revision: 1
      }
    });

    // Create DailyLog 1 for Cycle 1 on date 2026-09-01
    await prisma.dailyLog.create({
      data: {
        userId: synthUserIdA,
        cycleId: synthCycle1.id,
        date: "2026-09-01",
        revision: 1,
        lastClientOperationId: "synth_op_001",
        status: "STANDARD"
      }
    });

    // 7d. Verify DailyLog(cycleId, date) uniqueness
    await assertUniqueConstraintViolation(
      () =>
        prisma.dailyLog.create({
          data: {
            userId: synthUserIdA,
            cycleId: synthCycle1.id, // same cycle
            date: "2026-09-01",      // same date
            revision: 1,
            status: "STANDARD"
          }
        }),
      ["cycleId", "date"],
      "DailyLog(cycleId, date) uniqueness"
    );
    console.log(`  ✓ 3/5 Verified: DailyLog(cycleId, date) uniqueness strictly enforced.`);

    // Create Cycle 2 for User A
    const synthCycle2 = await prisma.cycle.create({
      data: {
        userId: synthUserIdA,
        title: "Synthetic Test Cycle 2",
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        revision: 1
      }
    });

    // 7e. Verify DailyLog(userId, date) uniqueness across cycles
    await assertUniqueConstraintViolation(
      () =>
        prisma.dailyLog.create({
          data: {
            userId: synthUserIdA,   // same user
            cycleId: synthCycle2.id, // different cycle
            date: "2026-09-01",      // same date
            revision: 1,
            status: "STANDARD"
          }
        }),
      ["userId", "date"],
      "DailyLog(userId, date) uniqueness"
    );
    console.log(`  ✓ 4/5 Verified: DailyLog(userId, date) uniqueness strictly enforced.`);

    // Create initial subscription with authority
    const synthAuthKey = `synth_auth_token_${Date.now()}`;
    await prisma.subscription.create({
      data: {
        userId: synthUserIdA,
        planId: "quarterly_ronin",
        amount: 399000,
        authority: synthAuthKey,
        status: "PENDING"
      }
    });

    // 7f. Verify Subscription.authority uniqueness
    await assertUniqueConstraintViolation(
      () =>
        prisma.subscription.create({
          data: {
            userId: synthUserIdA,
            planId: "quarterly_ronin",
            amount: 399000,
            authority: synthAuthKey, // duplicate authority
            status: "PENDING"
          }
        }),
      ["authority"],
      "Subscription.authority uniqueness"
    );
    console.log(`  ✓ 5/5 Verified: Subscription.authority uniqueness strictly enforced.`);

    // Also test OtpCode creation
    await prisma.otpCode.create({
      data: {
        identifier: synthPhoneA,
        purpose: "PHONE_REGISTRATION",
        codeHash: "synth_hash_001",
        expiresAt: new Date(Date.now() + 600000),
        userId: synthUserIdA
      }
    });

    // 7g. Verify CASCADE deletion
    await prisma.user.delete({
      where: { id: synthUserIdA }
    });

    const remainingCycles = await prisma.cycle.count({ where: { userId: synthUserIdA } });
    const remainingLogs = await prisma.dailyLog.count({ where: { userId: synthUserIdA } });
    const remainingOtps = await prisma.otpCode.count({ where: { userId: synthUserIdA } });
    const remainingSubs = await prisma.subscription.count({ where: { userId: synthUserIdA } });

    if (remainingCycles !== 0 || remainingLogs !== 0 || remainingOtps !== 0 || remainingSubs !== 0) {
      throw new Error(
        `Cascade delete failure: Remaining records found after user deletion (Cycles: ${remainingCycles}, Logs: ${remainingLogs}, Otps: ${remainingOtps}, Subs: ${remainingSubs})`
      );
    }
    console.log(`  ✓ Cascade deletion verified: All child records deleted upon user deletion.`);

    await prisma.$disconnect();

    // 8. Clean up disposable database
    console.log(`[7/7] Cleaning up disposable database...`);
    await teardownDisposableDb();

    console.log("================================================================");
    console.log("  ALL HARDENED DISPOSABLE DATABASE VERIFICATIONS PASSED!");
    console.log("================================================================");
    process.exit(0);
  } catch (err) {
    console.error(`\n[FATAL ERROR] Verification failed: ${sanitizeText((err as Error).message)}`);
    await teardownDisposableDb();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled top-level error:", err);
  process.exit(1);
});
