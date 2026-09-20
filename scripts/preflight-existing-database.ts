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
import {
  evaluatePreflightAssessment,
  MigrationRecord,
  ForeignKeyContract,
  UniqueContract,
  SchemaObjectsReport,
  PreflightAssessmentInput,
  PreflightAssessmentResult,
  REQUIRED_TABLES,
  REQUIRED_ENUMS,
  REQUIRED_CRITICAL_COLUMNS,
  REQUIRED_FOREIGN_KEYS,
  REQUIRED_UNIQUE_CONTRACTS,
  EXPECTED_INCREMENTAL_MIGRATIONS
} from "./preflight-assessment";

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

export interface DetailedPreflightReport {
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
    recordedMigrations: MigrationRecord[];
    missingExpectedIncrementals: string[];
  };
  schemaIntegrity: {
    existingTables: string[];
    missingRequiredTables: string[];
    existingEnums: string[];
    missingRequiredEnums: string[];
    verifiedForeignKeys: ForeignKeyContract[];
    missingForeignKeys: string[];
    verifiedUniqueContracts: Array<{ table: string; columns: string[] }>;
    missingUniqueContracts: string[];
    criticalColumnsFound: string[];
    criticalColumnsMissing: string[];
  };
  schemaDrift: {
    status: "ZERO_DRIFT" | "DRIFT_DETECTED" | "VERIFICATION_ERROR";
    summary: string;
  };
  assessment: PreflightAssessmentResult;
}

export async function runPreflightInspection(rawUrl: string): Promise<DetailedPreflightReport> {
  const sanitizedTargetUrl = sanitizeUrl(rawUrl);
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

    const serverAddress = dbIdentity[0]?.inet_server_addr || hostname;
    const serverPort = String(dbIdentity[0]?.inet_server_port || parsedUrl.port || 5432);
    const serverVersion = dbIdentity[0]?.version ? dbIdentity[0].version.split(" on ")[0] : "unknown";
    const databaseName = dbIdentity[0]?.current_database || parsedUrl.pathname.replace(/^\//, "");

    // 2. Inspect _prisma_migrations table (READ-ONLY)
    const migrationTableCheck: Array<{ count: number }> = await prisma.$queryRawUnsafe(`
      SELECT count(*)::int as count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '_prisma_migrations';
    `);

    const migrationsTableExists = (migrationTableCheck[0]?.count || 0) > 0;
    let recordedMigrations: MigrationRecord[] = [];

    if (migrationsTableExists) {
      const rawRecords: Array<{
        id: string;
        checksum: string;
        migration_name: string;
        started_at: Date | null;
        finished_at: Date | null;
        rolled_back_at: Date | null;
        applied_steps_count: number;
        logs: string | null;
      }> = await prisma.$queryRawUnsafe(`
        SELECT id, checksum, migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, logs
        FROM _prisma_migrations
        ORDER BY started_at ASC;
      `);

      recordedMigrations = rawRecords.map((r) => ({
        id: r.id,
        checksum: r.checksum,
        migrationName: r.migration_name,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        rolledBackAt: r.rolled_back_at,
        appliedSteps: r.applied_steps_count,
        logs: r.logs
      }));
    }

    // 3. Inspect Tables (READ-ONLY)
    const tables: Array<{ table_name: string }> = await prisma.$queryRawUnsafe(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);
    const existingTables = tables.map((t) => t.table_name);

    // 4. Inspect Enums (READ-ONLY)
    const enums: Array<{ typname: string }> = await prisma.$queryRawUnsafe(`
      SELECT typname
      FROM pg_type
      WHERE typname IN ('UserRole', 'UserTier', 'DayStatus', 'SubscriptionStatus');
    `);
    const existingEnums = enums.map((e) => e.typname);

    // 5. Inspect Columns (READ-ONLY)
    const columns: Array<{ table_name: string; column_name: string }> = await prisma.$queryRawUnsafe(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public';
    `);
    const existingColumns = columns.map((c) => ({ table: c.table_name, column: c.column_name }));

    // 6. Inspect Foreign Keys with CASCADE (READ-ONLY)
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

    const verifiedForeignKeys: ForeignKeyContract[] = [];
    for (const req of REQUIRED_FOREIGN_KEYS) {
      const match = discoveredFks.find(
        (f) =>
          f.table_name === req.table &&
          f.column_name === req.column &&
          f.foreign_table_name === req.foreignTable &&
          f.foreign_column_name === req.foreignColumn &&
          f.delete_rule === req.deleteRule
      );
      if (match) {
        verifiedForeignKeys.push(req);
      }
    }

    // 7. Inspect Unique Contracts from pg_index catalog (READ-ONLY)
    const uniqueIndexesRows: Array<{ table_name: string; column_names: string[] }> = await prisma.$queryRawUnsafe(`
      SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        array_to_json(array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum))) AS column_names
      FROM pg_index ix
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE n.nspname = 'public'
        AND ix.indisunique = true
        AND NOT ix.indisprimary
      GROUP BY t.relname, i.relname;
    `);

    const verifiedUniqueContracts: Array<{ table: string; columns: string[] }> = [];
    for (const req of REQUIRED_UNIQUE_CONTRACTS) {
      const match = uniqueIndexesRows.find(
        (u) =>
          u.table_name === req.table &&
          JSON.stringify(u.column_names) === JSON.stringify(req.columns)
      );
      if (match) {
        verifiedUniqueContracts.push(req);
      }
    }

    // Disconnect Prisma before running drift process
    await prisma.$disconnect();

    // 8. Real Database Schema Drift Check via prisma migrate diff (READ-ONLY)
    // Compares the actual target database datasource against prisma/schema.prisma datamodel
    const diffRes = spawnSync(
      "npx",
      [
        "prisma",
        "migrate",
        "diff",
        "--from-schema-datasource",
        "prisma/schema.prisma",
        "--to-schema-datamodel",
        "prisma/schema.prisma",
        "--exit-code"
      ],
      {
        shell: false,
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: rawUrl }
      }
    );

    let driftStatus: "ZERO_DRIFT" | "DRIFT_DETECTED" | "VERIFICATION_ERROR" = "VERIFICATION_ERROR";
    let driftSummary = "";

    if (diffRes.error) {
      driftStatus = "VERIFICATION_ERROR";
      driftSummary = sanitizeText(diffRes.error.message);
    } else if (diffRes.status === 0) {
      driftStatus = "ZERO_DRIFT";
      driftSummary = "Target database schema exactly matches prisma/schema.prisma (0 differences).";
    } else if (diffRes.status === 2) {
      driftStatus = "DRIFT_DETECTED";
      driftSummary = sanitizeText(diffRes.stdout || diffRes.stderr).trim();
    } else {
      driftStatus = "VERIFICATION_ERROR";
      driftSummary = sanitizeText(
        diffRes.stderr || diffRes.stdout || `Prisma diff process exited with code ${diffRes.status}`
      ).trim();
    }

    // 9. Pure Fail-Closed Assessment
    const schemaObjectsReport: SchemaObjectsReport = {
      tables: existingTables,
      enums: existingEnums,
      columns: existingColumns,
      foreignKeys: discoveredFks.map((f) => ({
        table: f.table_name,
        column: f.column_name,
        foreignTable: f.foreign_table_name,
        foreignColumn: f.foreign_column_name,
        deleteRule: f.delete_rule
      })),
      uniqueIndexes: uniqueIndexesRows.map((u) => ({
        table: u.table_name,
        columns: u.column_names
      }))
    };

    const assessmentInput: PreflightAssessmentInput = {
      migrationsTableExists,
      migrationRecords: recordedMigrations,
      schemaObjects: schemaObjectsReport,
      drift: {
        status: driftStatus,
        summary: driftSummary
      }
    };

    const assessment = evaluatePreflightAssessment(assessmentInput);

    const initialBaselineRecorded = recordedMigrations.some(
      (m) => m.migrationName === "20260901_initial_baseline" && m.finishedAt !== null && m.rolledBackAt === null
    );

    const missingExpectedIncrementals: string[] = [];
    for (const inc of EXPECTED_INCREMENTAL_MIGRATIONS) {
      const match = recordedMigrations.find(
        (m) => m.migrationName === inc && m.finishedAt !== null && m.rolledBackAt === null
      );
      if (!match) {
        missingExpectedIncrementals.push(inc);
      }
    }

    const criticalColumnsFound: string[] = [];
    for (const col of REQUIRED_CRITICAL_COLUMNS) {
      if (existingColumns.some((c) => c.table === col.table && c.column === col.column)) {
        criticalColumnsFound.push(`${col.table}.${col.column}`);
      }
    }

    return {
      databaseIdentity: {
        targetUrlSanitized: sanitizedTargetUrl,
        databaseName,
        serverAddress,
        serverPort,
        serverVersion,
        hostClassification
      },
      migrations: {
        migrationsTableExists,
        initialBaselineRecorded,
        recordedMigrations,
        missingExpectedIncrementals
      },
      schemaIntegrity: {
        existingTables,
        missingRequiredTables: assessment.details.missingTables,
        existingEnums,
        missingRequiredEnums: assessment.details.missingEnums,
        verifiedForeignKeys,
        missingForeignKeys: assessment.details.missingForeignKeys,
        verifiedUniqueContracts,
        missingUniqueContracts: assessment.details.missingUniqueContracts,
        criticalColumnsFound,
        criticalColumnsMissing: assessment.details.missingColumns
      },
      schemaDrift: {
        status: driftStatus,
        summary: driftSummary
      },
      assessment
    };
  } catch (err) {
    try {
      await prisma.$disconnect();
    } catch {}
    throw err;
  }
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

  try {
    const report = await runPreflightInspection(rawUrl);

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
    if (report.assessment.details.failedOrUnfinishedMigrations.length > 0) {
      console.log(`Failed/Unfinished:     ${report.assessment.details.failedOrUnfinishedMigrations.join("; ")}`);
    }
    console.log("------------------------------------------------------------");
    console.log(`Existing Tables:       ${report.schemaIntegrity.existingTables.join(", ")}`);
    if (report.schemaIntegrity.missingRequiredTables.length > 0) {
      console.log(`Missing Tables:        ${report.schemaIntegrity.missingRequiredTables.join(", ")}`);
    }
    console.log(`Enums Verified:        ${report.schemaIntegrity.existingEnums.join(", ")}`);
    if (report.schemaIntegrity.missingRequiredEnums.length > 0) {
      console.log(`Missing Enums:         ${report.schemaIntegrity.missingRequiredEnums.join(", ")}`);
    }
    console.log(
      `Foreign Keys:          ${report.schemaIntegrity.verifiedForeignKeys.length} verified [ON DELETE CASCADE]`
    );
    if (report.schemaIntegrity.missingForeignKeys.length > 0) {
      console.log(`Missing FKs:           ${report.schemaIntegrity.missingForeignKeys.join(", ")}`);
    }
    console.log(
      `Unique Contracts:      ${report.schemaIntegrity.verifiedUniqueContracts.length} verified`
    );
    if (report.schemaIntegrity.missingUniqueContracts.length > 0) {
      console.log(`Missing Unique:        ${report.schemaIntegrity.missingUniqueContracts.join(", ")}`);
    }
    console.log(`Critical Columns:      ${report.schemaIntegrity.criticalColumnsFound.length} verified`);
    if (report.schemaIntegrity.criticalColumnsMissing.length > 0) {
      console.log(`Missing Columns:       ${report.schemaIntegrity.criticalColumnsMissing.join(", ")}`);
    }
    console.log("------------------------------------------------------------");
    console.log(`Schema Drift Status:   ${report.schemaDrift.status}`);
    console.log(`Schema Drift Summary:  ${report.schemaDrift.summary.slice(0, 120)}`);
    console.log("==================== ADOPTION ASSESSMENT ====================");
    console.log(`Classification:        ${report.assessment.classification}`);
    console.log(`Adoption Status:       ${report.assessment.status}`);
    console.log(`Baseline Applicable:   ${report.assessment.applicable ? "YES" : "NO"}`);
    if (report.assessment.blockers.length > 0) {
      console.log(`Blockers:`);
      report.assessment.blockers.forEach((b) => console.log(`  ! ${b}`));
    }
    console.log(`Reasons:`);
    report.assessment.reasons.forEach((r) => console.log(`  - ${r}`));
    console.log(`Recommended Action:    ${report.assessment.recommendedAction}`);
    console.log("------------------------------------------------------------");
    console.log(`HUMAN REVIEW REQUIRED: ${report.assessment.humanReviewRequired ? "YES (Mandatory)" : "NO"}`);
    console.log(
      "Read-Only Guarantee:   No database changes, DDL, DML, or migrate-resolve were executed."
    );
    console.log("============================================================\n");

    process.exit(0);
  } catch (err) {
    console.error(`\n[PREFLIGHT ERROR] Could not complete inspection: ${sanitizeText((err as Error).message)}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith("preflight-existing-database.ts")) {
  main().catch((err) => {
    console.error("Unhandled preflight error:", sanitizeText(err.message));
    process.exit(1);
  });
}
