/**
 * scripts/verify-migrations.ts
 *
 * Phase 2C.1: Disposable Database & Migration Integrity Verification
 *
 * This script verifies that the repository's Prisma migration chain cleanly
 * bootstraps an empty database and reproduces the exact target schema defined
 * in prisma/schema.prisma with zero drift.
 *
 * SAFETY INVARIANTS:
 * 1. Strictly refuses to run on production, staging, remote, or cloud databases.
 * 2. Requires an explicit acknowledgment flag (--disposable-acknowledged or DISPOSABLE_DB_ACKNOWLEDGED=true).
 * 3. Operates ONLY on an ephemeral, disposable database created specifically for the test.
 * 4. Verifies schema drift, constraints, indexes, synthetic records, and Cascade deletion.
 * 5. Guarantees cleanup of the disposable database upon completion or failure.
 */

import { execSync, spawnSync } from "node:child_process";
import { URL } from "node:url";
import { PrismaClient } from "@prisma/client";

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

function assertSafety(rawUrl: string, args: string[]) {
  // 1. Environment flag check
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

  // 2. Explicit acknowledgment check
  const hasAckArg = args.includes("--disposable-acknowledged");
  const hasAckEnv = env.DISPOSABLE_DB_ACKNOWLEDGED === "true";
  if (!hasAckArg && !hasAckEnv) {
    throw new Error(
      "[VERIFICATION_SAFETY_VIOLATION] Execution refused: Missing required explicit acknowledgment flag (--disposable-acknowledged or DISPOSABLE_DB_ACKNOWLEDGED=true)."
    );
  }

  // 3. URL parsing and safety analysis
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

  // Banned keyword scan
  const fullLowerUrl = rawUrl.toLowerCase();
  for (const banned of BANNED_KEYWORDS) {
    if (fullLowerUrl.includes(banned)) {
      throw new Error(
        `[VERIFICATION_SAFETY_VIOLATION] Banned keyword '${banned}' detected in database URL. Refusing to run against potential remote/production target.`
      );
    }
  }

  // Hostname local verification
  if (!LOCAL_HOSTS.has(hostname) && !hostname.endsWith(".local")) {
    throw new Error(
      `[VERIFICATION_SAFETY_VIOLATION] Target host '${hostname}' is not a permitted local loopback address (127.0.0.1, localhost, ::1).`
    );
  }
}

async function runCommand(command: string, envOverrides: Record<string, string> = {}): Promise<string> {
  const result = spawnSync(command, {
    shell: true,
    encoding: "utf8",
    env: { ...process.env, ...envOverrides }
  });

  if (result.status !== 0) {
    const errorMsg = result.stderr || result.stdout || `Command failed with exit code ${result.status}`;
    throw new Error(`Command failed [${command}]: ${errorMsg}`);
  }

  return (result.stdout || "").trim();
}

async function main() {
  const args = process.argv.slice(2);

  // Extract raw URL from args or environment
  let rawUrl = process.env.DISPOSABLE_DATABASE_URL || process.env.DATABASE_URL || "";
  const urlArgIndex = args.indexOf("--url");
  if (urlArgIndex !== -1 && args[urlArgIndex + 1]) {
    rawUrl = args[urlArgIndex + 1];
  }

  console.log("================================================================");
  console.log("  PHASE 2C.1: PRISMA MIGRATION INTEGRITY & DISPOSABLE VERIFY");
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

  // URL for maintenance connection to create/drop the disposable db
  const maintenanceUrlObj = new URL(rawUrl);
  maintenanceUrlObj.pathname = `/${maintenanceDb}`;
  const maintenanceUrl = maintenanceUrlObj.toString();

  console.log(`✓ Ephemeral target generated: ${disposableDbName}`);

  let dbCreated = false;

  // Cleanup helper
  const teardownDisposableDb = async () => {
    if (!dbCreated) return;
    console.log(`\n[Teardown] Dropping ephemeral database: ${disposableDbName}...`);
    try {
      // Connect to maintenance db to drop disposable database
      const maintenancePrisma = new PrismaClient({
        datasources: { db: { url: maintenanceUrl } }
      });
      // Terminate any remaining connections to the disposable database first
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
      console.error(`! Warning: Failed to drop ephemeral database during teardown: ${(dropErr as Error).message}`);
    }
  };

  // Register process signal handlers for clean teardown
  process.on("SIGINT", async () => {
    await teardownDisposableDb();
    process.exit(1);
  });
  process.on("SIGTERM", async () => {
    await teardownDisposableDb();
    process.exit(1);
  });

  try {
    // 2. Create the disposable database
    console.log(`[1/7] Creating disposable database '${disposableDbName}'...`);
    const maintenancePrisma = new PrismaClient({
      datasources: { db: { url: maintenanceUrl } }
    });
    await maintenancePrisma.$executeRawUnsafe(`CREATE DATABASE "${disposableDbName}";`);
    await maintenancePrisma.$disconnect();
    dbCreated = true;
    console.log(`✓ Disposable database created successfully.`);

    // 3. Run prisma validate
    console.log(`[2/7] Running 'prisma validate'...`);
    const validateOut = await runCommand("npx prisma validate", {
      DATABASE_URL: disposableDbUrl
    });
    console.log(`✓ Prisma schema validation: ${validateOut || "valid"}`);

    // 4. Run prisma migrate deploy against the disposable database
    console.log(`[3/7] Running 'prisma migrate deploy' on disposable database...`);
    const deployOut = await runCommand("npx prisma migrate deploy", {
      DATABASE_URL: disposableDbUrl
    });
    console.log(deployOut);
    console.log(`✓ Migration history applied cleanly to fresh database.`);

    // 5. Verify zero schema drift
    console.log(`[4/7] Checking for schema drift against prisma/schema.prisma...`);
    const driftCheck = spawnSync(
      `npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-url "${disposableDbUrl}" --exit-code`,
      { shell: true, encoding: "utf8" }
    );
    if (driftCheck.status !== 0) {
      throw new Error(`Schema drift detected!\nOutput:\n${driftCheck.stdout}\n${driftCheck.stderr}`);
    }
    console.log(`✓ Zero schema drift confirmed: Migrations reproduce current schema exactly.`);

    // 6. Deep structural inspection
    console.log(`[5/7] Verifying structural database objects (tables, enums, constraints, indexes)...`);
    const prisma = new PrismaClient({
      datasources: { db: { url: disposableDbUrl } }
    });

    // Verify all 5 tables exist
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

    // Verify all 4 custom enums exist
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

    // Verify critical concurrency, idempotency, and auth columns
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

    // Verify Cascade foreign keys
    const fks: Array<{ constraint_name: string; delete_rule: string }> = await prisma.$queryRawUnsafe(`
      SELECT rc.constraint_name, rc.delete_rule
      FROM information_schema.referential_constraints rc
      JOIN information_schema.table_constraints tc
        ON rc.constraint_name = tc.constraint_name
      WHERE tc.table_schema = 'public';
    `);
    for (const fk of fks) {
      if (fk.delete_rule !== "CASCADE") {
        throw new Error(`Constraint ${fk.constraint_name} has non-CASCADE rule: ${fk.delete_rule}`);
      }
    }
    console.log(`  ✓ Foreign keys verified with ON DELETE CASCADE rule.`);

    // 7. Synthetic record execution & Cascade validation
    console.log(`[6/7] Testing synthetic records, constraints, and Cascade behavior...`);

    const synthUserId = `synth_test_usr_${Date.now()}`;
    const synthPhone = "+989120000099";

    // 7a. Insert synthetic user
    await prisma.user.create({
      data: {
        id: synthUserId,
        phoneNumber: synthPhone,
        email: `synth_${Date.now()}@test.internal`,
        name: "Synthetic Verification User",
        role: "FREE",
        tokenVersion: 0
      }
    });

    // 7b. Verify uniqueness enforcement on phoneNumber
    let caughtUniqueViolation = false;
    try {
      await prisma.user.create({
        data: {
          id: `synth_duplicate_${Date.now()}`,
          phoneNumber: synthPhone, // duplicate
          name: "Duplicate Phone User"
        }
      });
    } catch {
      caughtUniqueViolation = true;
    }
    if (!caughtUniqueViolation) {
      throw new Error("Failed uniqueness enforcement: Duplicate phoneNumber was accepted without error.");
    }
    console.log(`  ✓ Unique constraint on User.phoneNumber enforced correctly.`);

    // 7c. Insert synthetic Cycle, DailyLog, OtpCode, Subscription
    const synthCycle = await prisma.cycle.create({
      data: {
        userId: synthUserId,
        title: "Synthetic Test Cycle",
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        revision: 1
      }
    });

    await prisma.dailyLog.create({
      data: {
        userId: synthUserId,
        cycleId: synthCycle.id,
        date: "2026-09-01",
        revision: 1,
        lastClientOperationId: "synth_op_001",
        status: "STANDARD"
      }
    });

    // 7d. Verify unique constraint on DailyLog (cycleId, date)
    let caughtDailyLogUnique = false;
    try {
      await prisma.dailyLog.create({
        data: {
          userId: synthUserId,
          cycleId: synthCycle.id,
          date: "2026-09-01", // duplicate date for same cycle
          revision: 1,
          status: "STANDARD"
        }
      });
    } catch {
      caughtDailyLogUnique = true;
    }
    if (!caughtDailyLogUnique) {
      throw new Error("Failed uniqueness enforcement: Duplicate DailyLog(cycleId, date) was accepted.");
    }
    console.log(`  ✓ Unique constraint on DailyLog(cycleId, date) enforced correctly.`);

    await prisma.otpCode.create({
      data: {
        identifier: synthPhone,
        purpose: "PHONE_REGISTRATION",
        codeHash: "synth_hash",
        expiresAt: new Date(Date.now() + 600000),
        userId: synthUserId
      }
    });

    await prisma.subscription.create({
      data: {
        userId: synthUserId,
        planId: "quarterly_ronin",
        amount: 399000,
        authority: `synth_auth_${Date.now()}`,
        status: "PENDING"
      }
    });

    // 7e. Test CASCADE deletion by deleting the synthetic user
    await prisma.user.delete({
      where: { id: synthUserId }
    });

    // Check that all child records were deleted by cascade
    const remainingCycles = await prisma.cycle.count({ where: { userId: synthUserId } });
    const remainingLogs = await prisma.dailyLog.count({ where: { userId: synthUserId } });
    const remainingOtps = await prisma.otpCode.count({ where: { userId: synthUserId } });
    const remainingSubs = await prisma.subscription.count({ where: { userId: synthUserId } });

    if (remainingCycles !== 0 || remainingLogs !== 0 || remainingOtps !== 0 || remainingSubs !== 0) {
      throw new Error(
        `Cascade delete failure: Remaining records found after user deletion (Cycles: ${remainingCycles}, Logs: ${remainingLogs}, Otps: ${remainingOtps}, Subs: ${remainingSubs})`
      );
    }
    console.log(`  ✓ Cascade deletion verified: All child records removed upon user deletion.`);

    await prisma.$disconnect();

    // 8. Clean up disposable database
    console.log(`[7/7] Cleaning up disposable database...`);
    await teardownDisposableDb();

    console.log("================================================================");
    console.log("  ALL DISPOSABLE DATABASE VERIFICATIONS PASSED SUCCESSFULLY!");
    console.log("================================================================");
    process.exit(0);
  } catch (err) {
    console.error(`\n[FATAL ERROR] Verification failed: ${(err as Error).message}`);
    await teardownDisposableDb();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled top-level error:", err);
  process.exit(1);
});
