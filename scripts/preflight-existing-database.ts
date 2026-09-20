/**
 * scripts/preflight-existing-database.ts
 *
 * Phase 2C.1: Read-Only Existing-Database Preflight Inspector
 *
 * This script performs a non-mutating inspection of an existing PostgreSQL database
 * to evaluate migration state, schema integrity, and baseline adoption applicability.
 *
 * STRICT READ-ONLY GUARANTEES:
 * - Executes ONLY read queries (SELECT from pg_catalog, information_schema, _prisma_migrations).
 * - Executes read-only Prisma schema drift detection (prisma migrate diff).
 * - NEVER executes: migrate deploy, migrate resolve, db push, migrate reset,
 *   CREATE, ALTER, DROP, TRUNCATE, INSERT, UPDATE, or DELETE.
 * - NEVER mutates the database or marks any migration as applied.
 * - NEVER prints raw database passwords or connection credentials.
 */

import { spawnSync } from "node:child_process";
import { URL } from "node:url";
import { PrismaClient } from "@prisma/client";

function sanitizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) {
      parsed.password = "****";
    }
    return parsed.toString();
  } catch {
    return "[MALFORMED_DATABASE_URL]";
  }
}

function sanitizeText(text: string): string {
  return text.replace(
    /(postgres(?:ql)?:\/\/)([^:@\s]+):([^@\s]+)@/gi,
    "$1$2:[REDACTED]@"
  );
}

interface PreflightReport {
  databaseIdentity: {
    targetUrlSanitized: string;
    databaseName: string;
    serverAddress: string;
    serverPort: string;
    serverVersion: string;
    hostClassification: "local_loopback" | "private_network" | "remote_cloud";
  };
  migrations: {
    migrationsTableExists: boolean;
    initialBaselineRecorded: boolean;
    recordedMigrations: Array<{
      migrationName: string;
      finishedAt: Date | string | null;
      appliedSteps: number;
    }>;
    missingExpectedIncrementals: string[];
  };
  schemaIntegrity: {
    existingTables: string[];
    missingRequiredTables: string[];
    existingEnums: string[];
    missingRequiredEnums: string[];
    verifiedForeignKeys: Array<{
      table: string;
      column: string;
      foreignTable: string;
      foreignColumn: string;
      deleteRule: string;
    }>;
    missingForeignKeys: string[];
    verifiedUniqueConstraints: string[];
    criticalColumnsFound: string[];
    criticalColumnsMissing: string[];
  };
  schemaDrift: {
    status: "ZERO_DRIFT" | "DRIFT_DETECTED" | "UNKNOWN_OR_ERROR";
    summary: string;
  };
  baselineAdoption: {
    applicable: boolean;
    status: "APPLICABLE" | "ALREADY_BASELINED" | "BLOCKED";
    reasons: string[];
    recommendedAction: string;
  };
  humanReviewRequired: boolean;
}

async function main() {
  const args = process.argv.slice(2);
  let rawUrl = process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL || "";

  const urlArgIndex = args.indexOf("--url");
  if (urlArgIndex !== -1 && args[urlArgIndex + 1]) {
    rawUrl = args[urlArgIndex + 1];
  }

  if (!rawUrl) {
    console.error("================================================================");
    console.error("  READ-ONLY EXISTING-DATABASE PREFLIGHT INSPECTOR");
    console.error("================================================================");
    console.error("ERROR: No database URL provided.");
    console.error("Usage:");
    console.error("  npx tsx scripts/preflight-existing-database.ts --url <DATABASE_URL>");
    console.error("  or set TARGET_DATABASE_URL=<DATABASE_URL>");
    process.exit(1);
  }

  const sanitizedTargetUrl = sanitizeUrl(rawUrl);

  console.log("================================================================");
  console.log("  READ-ONLY EXISTING-DATABASE PREFLIGHT INSPECTOR");
  console.log("================================================================");
  console.log(`[Read-Only Mode] Target: ${sanitizedTargetUrl}`);

  const parsedUrl = new URL(rawUrl);
  const hostname = parsedUrl.hostname.toLowerCase();
  let hostClassification: "local_loopback" | "private_network" | "remote_cloud" = "remote_cloud";
  if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname)) {
    hostClassification = "local_loopback";
  } else if (
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("172.")
  ) {
    hostClassification = "private_network";
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: rawUrl } }
  });

  const report: PreflightReport = {
    databaseIdentity: {
      targetUrlSanitized: sanitizedTargetUrl,
      databaseName: parsedUrl.pathname.replace(/^\//, ""),
      serverAddress: "unknown",
      serverPort: parsedUrl.port || "5432",
      serverVersion: "unknown",
      hostClassification
    },
    migrations: {
      migrationsTableExists: false,
      initialBaselineRecorded: false,
      recordedMigrations: [],
      missingExpectedIncrementals: []
    },
    schemaIntegrity: {
      existingTables: [],
      missingRequiredTables: [],
      existingEnums: [],
      missingRequiredEnums: [],
      verifiedForeignKeys: [],
      missingForeignKeys: [],
      verifiedUniqueConstraints: [],
      criticalColumnsFound: [],
      criticalColumnsMissing: []
    },
    schemaDrift: {
      status: "UNKNOWN_OR_ERROR",
      summary: ""
    },
    baselineAdoption: {
      applicable: false,
      status: "BLOCKED",
      reasons: [],
      recommendedAction: "Human review required before performing any migration."
    },
    humanReviewRequired: true
  };

  try {
    // 1. Inspect Server & Database Identity (READ-ONLY)
    const dbIdentity: Array<{
      current_database: string;
      inet_server_addr: string | null;
      inet_server_port: number | null;
      version: string;
    }> = await prisma.$queryRawUnsafe(`
      SELECT
        current_database(),
        inet_server_addr()::text,
        inet_server_port(),
        version();
    `);

    if (dbIdentity && dbIdentity.length > 0) {
      report.databaseIdentity.databaseName = dbIdentity[0].current_database;
      report.databaseIdentity.serverAddress = dbIdentity[0].inet_server_addr || hostname;
      report.databaseIdentity.serverPort = String(dbIdentity[0].inet_server_port || parsedUrl.port || 5432);
      report.databaseIdentity.serverVersion = dbIdentity[0].version.split(" on ")[0];
    }

    // 2. Check for _prisma_migrations table (READ-ONLY)
    const migrationTableCheck: Array<{ count: number }> = await prisma.$queryRawUnsafe(`
      SELECT count(*)::int as count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '_prisma_migrations';
    `);

    report.migrations.migrationsTableExists = (migrationTableCheck[0]?.count || 0) > 0;

    if (report.migrations.migrationsTableExists) {
      const recordedMigrations: Array<{
        migration_name: string;
        finished_at: Date | null;
        applied_steps_count: number;
      }> = await prisma.$queryRawUnsafe(`
        SELECT migration_name, finished_at, applied_steps_count
        FROM _prisma_migrations
        ORDER BY started_at ASC;
      `);

      report.migrations.recordedMigrations = recordedMigrations.map((m) => ({
        migrationName: m.migration_name,
        finishedAt: m.finished_at,
        appliedSteps: m.applied_steps_count
      }));

      report.migrations.initialBaselineRecorded = recordedMigrations.some(
        (m) => m.migration_name === "20260901_initial_baseline" && m.finished_at !== null
      );

      const expectedIncrementals = [
        "20260903_phase2b_otp_persistence",
        "20260905_phase4_concurrency_tokens",
        "20260905_phase4b_durable_idempotency"
      ];

      for (const inc of expectedIncrementals) {
        if (!recordedMigrations.some((m) => m.migration_name === inc && m.finished_at !== null)) {
          report.migrations.missingExpectedIncrementals.push(inc);
        }
      }
    }

    // 3. Inspect Tables (READ-ONLY)
    const tables: Array<{ table_name: string }> = await prisma.$queryRawUnsafe(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);
    const tableNames = tables.map((t) => t.table_name);
    report.schemaIntegrity.existingTables = tableNames;

    const requiredTables = ["User", "Cycle", "DailyLog", "OtpCode", "Subscription"];
    report.schemaIntegrity.missingRequiredTables = requiredTables.filter((t) => !tableNames.includes(t));

    // 4. Inspect Enums (READ-ONLY)
    const enums: Array<{ typname: string }> = await prisma.$queryRawUnsafe(`
      SELECT typname
      FROM pg_type
      WHERE typname IN ('UserRole', 'UserTier', 'DayStatus', 'SubscriptionStatus');
    `);
    const enumNames = enums.map((e) => e.typname);
    report.schemaIntegrity.existingEnums = enumNames;

    const requiredEnums = ["UserRole", "UserTier", "DayStatus", "SubscriptionStatus"];
    report.schemaIntegrity.missingRequiredEnums = requiredEnums.filter((e) => !enumNames.includes(e));

    // 5. Inspect Foreign Keys (READ-ONLY)
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

    for (const exp of expectedForeignKeys) {
      const match = discoveredFks.find(
        (f) =>
          f.table_name === exp.table &&
          f.column_name === exp.column &&
          f.foreign_table_name === exp.foreignTable &&
          f.foreign_column_name === exp.foreignColumn
      );

      if (match && match.delete_rule === exp.deleteRule) {
        report.schemaIntegrity.verifiedForeignKeys.push(exp);
      } else {
        report.schemaIntegrity.missingForeignKeys.push(
          `${exp.table}.${exp.column} -> ${exp.foreignTable}.${exp.foreignColumn} [${exp.deleteRule}]`
        );
      }
    }

    // 6. Inspect Critical Columns (READ-ONLY)
    const columns: Array<{ table_name: string; column_name: string }> = await prisma.$queryRawUnsafe(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public';
    `);

    const criticalChecks = [
      { table: "User", column: "tokenVersion" },
      { table: "Cycle", column: "revision" },
      { table: "DailyLog", column: "revision" },
      { table: "DailyLog", column: "lastClientOperationId" },
      { table: "OtpCode", column: "purpose" },
      { table: "Subscription", column: "authority" }
    ];

    for (const check of criticalChecks) {
      const found = columns.some((c) => c.table_name === check.table && c.column_name === check.column);
      if (found) {
        report.schemaIntegrity.criticalColumnsFound.push(`${check.table}.${check.column}`);
      } else {
        report.schemaIntegrity.criticalColumnsMissing.push(`${check.table}.${check.column}`);
      }
    }

    // 7. Inspect Unique Constraints (READ-ONLY)
    const uniqueConstraints: Array<{ constraint_name: string; table_name: string }> = await prisma.$queryRawUnsafe(`
      SELECT tc.constraint_name, tc.table_name
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public' AND tc.constraint_type = 'UNIQUE';
    `);
    report.schemaIntegrity.verifiedUniqueConstraints = uniqueConstraints.map((u) => `${u.table_name}.${u.constraint_name}`);

    // 8. Run Read-Only Schema Drift Check via prisma migrate diff (READ-ONLY)
    const diffRes = spawnSync(
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
      {
        shell: false,
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: rawUrl }
      }
    );

    if (diffRes.status === 0) {
      report.schemaDrift.status = "ZERO_DRIFT";
      report.schemaDrift.summary = "Target database schema exactly matches prisma/schema.prisma (0 differences).";
    } else if (diffRes.status === 2) {
      report.schemaDrift.status = "DRIFT_DETECTED";
      report.schemaDrift.summary = sanitizeText(diffRes.stdout || diffRes.stderr).trim();
    } else {
      report.schemaDrift.status = "UNKNOWN_OR_ERROR";
      report.schemaDrift.summary = sanitizeText(diffRes.stderr || diffRes.stdout || "Prisma diff failed to execute.").trim();
    }

    // 9. Evaluate Baseline Adoption Applicability
    const tablesComplete = report.schemaIntegrity.missingRequiredTables.length === 0;
    const fksComplete = report.schemaIntegrity.missingForeignKeys.length === 0;
    const columnsComplete = report.schemaIntegrity.criticalColumnsMissing.length === 0;
    const isZeroDrift = report.schemaDrift.status === "ZERO_DRIFT";

    if (report.migrations.initialBaselineRecorded) {
      report.baselineAdoption.applicable = false;
      report.baselineAdoption.status = "ALREADY_BASELINED";
      report.baselineAdoption.reasons.push(
        "Initial baseline migration (20260901_initial_baseline) is already recorded as applied in _prisma_migrations."
      );
      report.baselineAdoption.recommendedAction =
        "No baseline adoption required. Run 'npm run db:migrate:deploy' if any subsequent migrations are pending.";
    } else if (tablesComplete && fksComplete && columnsComplete && isZeroDrift) {
      report.baselineAdoption.applicable = true;
      report.baselineAdoption.status = "APPLICABLE";
      report.baselineAdoption.reasons.push(
        "Target database contains complete schema matching prisma/schema.prisma with zero drift, but 20260901_initial_baseline is not yet recorded in _prisma_migrations."
      );
      report.baselineAdoption.recommendedAction =
        "BASELINE ADOPTION APPLICABLE: Operator may take verified restorable backup, obtain explicit approval, and execute: 'npx prisma migrate resolve --applied 20260901_initial_baseline', followed by 'npm run db:migrate:deploy'.";
    } else {
      report.baselineAdoption.applicable = false;
      report.baselineAdoption.status = "BLOCKED";
      if (!tablesComplete) {
        report.baselineAdoption.reasons.push(
          `Missing required tables: ${report.schemaIntegrity.missingRequiredTables.join(", ")}`
        );
      }
      if (!fksComplete) {
        report.baselineAdoption.reasons.push(
          `Missing or non-CASCADE foreign keys: ${report.schemaIntegrity.missingForeignKeys.join(", ")}`
        );
      }
      if (!columnsComplete) {
        report.baselineAdoption.reasons.push(
          `Missing critical columns: ${report.schemaIntegrity.criticalColumnsMissing.join(", ")}`
        );
      }
      if (!isZeroDrift) {
        report.baselineAdoption.reasons.push(
          `Schema drift detected: ${report.schemaDrift.summary.slice(0, 150)}...`
        );
      }
      report.baselineAdoption.recommendedAction =
        "BLOCKED: Baseline adoption CANNOT be performed automatically. Schema or migration discrepancies must be investigated and resolved first.";
    }

    await prisma.$disconnect();

    // 10. Output Comprehensive Diagnostic Report
    console.log("\n================ PREFLIGHT DIAGNOSTIC REPORT ================");
    console.log(`Target Database:       ${report.databaseIdentity.databaseName}`);
    console.log(`Server Address:        ${report.databaseIdentity.serverAddress}:${report.databaseIdentity.serverPort}`);
    console.log(`Host Classification:   ${report.databaseIdentity.hostClassification}`);
    console.log(`Database Version:      ${report.databaseIdentity.serverVersion}`);
    console.log("------------------------------------------------------------");
    console.log(`Migrations Table:      ${report.migrations.migrationsTableExists ? "EXISTS" : "NOT FOUND"}`);
    console.log(`Baseline Recorded:     ${report.migrations.initialBaselineRecorded ? "YES" : "NO"}`);
    console.log(
      `Recorded Migrations:   ${report.migrations.recordedMigrations.map((m) => m.migrationName).join(", ") || "None"}`
    );
    if (report.migrations.missingExpectedIncrementals.length > 0) {
      console.log(`Missing Incrementals:  ${report.migrations.missingExpectedIncrementals.join(", ")}`);
    }
    console.log("------------------------------------------------------------");
    console.log(`Existing Tables:       ${report.schemaIntegrity.existingTables.join(", ")}`);
    if (report.schemaIntegrity.missingRequiredTables.length > 0) {
      console.log(`Missing Tables:        ${report.schemaIntegrity.missingRequiredTables.join(", ")}`);
    }
    console.log(`Enums Verified:        ${report.schemaIntegrity.existingEnums.join(", ")}`);
    console.log(
      `Foreign Keys:          ${report.schemaIntegrity.verifiedForeignKeys.length} verified [ON DELETE CASCADE]`
    );
    if (report.schemaIntegrity.missingForeignKeys.length > 0) {
      console.log(`Missing FKs:           ${report.schemaIntegrity.missingForeignKeys.join(", ")}`);
    }
    console.log(`Critical Columns:      ${report.schemaIntegrity.criticalColumnsFound.length} verified`);
    if (report.schemaIntegrity.criticalColumnsMissing.length > 0) {
      console.log(`Missing Columns:       ${report.schemaIntegrity.criticalColumnsMissing.join(", ")}`);
    }
    console.log("------------------------------------------------------------");
    console.log(`Schema Drift Status:   ${report.schemaDrift.status}`);
    console.log(`Schema Drift Summary:  ${report.schemaDrift.summary.slice(0, 120)}`);
    console.log("==================== ADOPTION ASSESSMENT ====================");
    console.log(`Baseline Applicable:   ${report.baselineAdoption.applicable ? "YES" : "NO"}`);
    console.log(`Adoption Status:       ${report.baselineAdoption.status}`);
    console.log(`Reasons:`);
    report.baselineAdoption.reasons.forEach((r) => console.log(`  - ${r}`));
    console.log(`Recommended Action:    ${report.baselineAdoption.recommendedAction}`);
    console.log("------------------------------------------------------------");
    console.log(`HUMAN REVIEW REQUIRED: ${report.humanReviewRequired ? "YES (Mandatory)" : "NO"}`);
    console.log(
      "Read-Only Guarantee:   No database changes, DDL, DML, or migrate-resolve were executed."
    );
    console.log("============================================================\n");

    process.exit(0);
  } catch (err) {
    console.error(`\n[PREFLIGHT ERROR] Could not complete inspection: ${sanitizeText((err as Error).message)}`);
    try {
      await prisma.$disconnect();
    } catch {}
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled preflight error:", sanitizeText(err.message));
  process.exit(1);
});
