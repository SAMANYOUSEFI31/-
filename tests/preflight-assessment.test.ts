/**
 * tests/preflight-assessment.test.ts
 *
 * Phase 2C.1: Regression Tests for Pure Preflight Assessment Logic
 *
 * Covers 10 fail-closed assessment scenarios:
 * 1. Fully migrated plus zero drift -> ALREADY_BASELINED
 * 2. Baseline recorded plus drift -> BLOCKED
 * 3. Baseline recorded plus missing incremental -> BLOCKED
 * 4. Baseline recorded plus failed or unfinished migration -> BLOCKED
 * 5. Legacy complete schema plus zero drift and baseline absent -> APPLICABLE
 * 6. Legacy schema missing unique constraint -> BLOCKED
 * 7. Missing enum -> BLOCKED
 * 8. Empty database -> FRESH_DATABASE, never APPLICABLE
 * 9. Prisma diff execution error -> BLOCKED
 * 10. Drift detected with exit code 2 -> BLOCKED
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePreflightAssessment,
  PreflightAssessmentInput,
  REQUIRED_TABLES,
  REQUIRED_ENUMS,
  REQUIRED_CRITICAL_COLUMNS,
  REQUIRED_FOREIGN_KEYS,
  REQUIRED_UNIQUE_CONTRACTS,
  BASELINE_MIGRATION,
  EXPECTED_INCREMENTAL_MIGRATIONS,
  MigrationRecord,
  SchemaObjectsReport
} from "../scripts/preflight-assessment.js";

function createCompleteSchemaObjects(): SchemaObjectsReport {
  return {
    tables: [...REQUIRED_TABLES, "_prisma_migrations"],
    enums: [...REQUIRED_ENUMS],
    columns: REQUIRED_CRITICAL_COLUMNS.map((c) => ({ table: c.table, column: c.column })),
    foreignKeys: [...REQUIRED_FOREIGN_KEYS],
    uniqueIndexes: REQUIRED_UNIQUE_CONTRACTS.map((u) => ({ table: u.table, columns: [...u.columns] }))
  };
}

function createCleanMigrationHistory(withBaseline = true, withIncrementals = true): MigrationRecord[] {
  const records: MigrationRecord[] = [];
  if (withBaseline) {
    records.push({
      id: "mig-baseline",
      checksum: "checksum-baseline",
      migrationName: BASELINE_MIGRATION,
      startedAt: new Date("2026-09-01T00:00:00Z"),
      finishedAt: new Date("2026-09-01T00:00:05Z"),
      rolledBackAt: null,
      appliedSteps: 1,
      logs: null
    });
  }
  if (withIncrementals) {
    for (let i = 0; i < EXPECTED_INCREMENTAL_MIGRATIONS.length; i++) {
      records.push({
        id: `mig-inc-${i}`,
        checksum: `checksum-inc-${i}`,
        migrationName: EXPECTED_INCREMENTAL_MIGRATIONS[i],
        startedAt: new Date(`2026-09-03T00:00:0${i}Z`),
        finishedAt: new Date(`2026-09-03T00:00:0${i + 1}Z`),
        rolledBackAt: null,
        appliedSteps: 1,
        logs: null
      });
    }
  }
  return records;
}

describe("Preflight Assessment Logic (Phase 2C.1)", () => {
  it("Scenario 1: Fully migrated plus zero drift -> ALREADY_BASELINED", () => {
    const input: PreflightAssessmentInput = {
      migrationsTableExists: true,
      migrationRecords: createCleanMigrationHistory(true, true),
      schemaObjects: createCompleteSchemaObjects(),
      drift: { status: "ZERO_DRIFT", summary: "No difference detected." }
    };

    const res = evaluatePreflightAssessment(input);
    assert.equal(res.status, "ALREADY_BASELINED");
    assert.equal(res.applicable, false);
    assert.equal(res.classification, "FULLY_MIGRATED");
    assert.equal(res.blockers.length, 0);
    assert.equal(res.details.missingIncrementals.length, 0);
  });

  it("Scenario 2: Baseline recorded plus drift -> BLOCKED", () => {
    const input: PreflightAssessmentInput = {
      migrationsTableExists: true,
      migrationRecords: createCleanMigrationHistory(true, true),
      schemaObjects: createCompleteSchemaObjects(),
      drift: { status: "DRIFT_DETECTED", summary: "[+] Added column missing_in_schema" }
    };

    const res = evaluatePreflightAssessment(input);
    assert.equal(res.status, "BLOCKED");
    assert.equal(res.applicable, false);
    assert.equal(res.classification, "DRIFTED");
    assert.equal(res.blockers.some((b) => b.includes("Schema drift detected")), true);
    assert.equal(res.recommendedAction.includes("strictly prohibited"), true);
  });

  it("Scenario 3: Baseline recorded plus missing incremental -> BLOCKED", () => {
    const input: PreflightAssessmentInput = {
      migrationsTableExists: true,
      migrationRecords: createCleanMigrationHistory(true, false),
      schemaObjects: createCompleteSchemaObjects(),
      drift: { status: "ZERO_DRIFT", summary: "No difference detected." }
    };

    const res = evaluatePreflightAssessment(input);
    assert.equal(res.status, "BLOCKED");
    assert.equal(res.applicable, false);
    assert.deepEqual(res.details.missingIncrementals, EXPECTED_INCREMENTAL_MIGRATIONS);
    assert.equal(res.blockers.some((b) => b.includes("Missing expected incremental migrations")), true);
    assert.equal(res.recommendedAction.includes("strictly prohibited"), true);
  });

  it("Scenario 4: Baseline recorded plus failed or unfinished migration -> BLOCKED", () => {
    const history = createCleanMigrationHistory(true, true);
    history[1].finishedAt = null;

    const input: PreflightAssessmentInput = {
      migrationsTableExists: true,
      migrationRecords: history,
      schemaObjects: createCompleteSchemaObjects(),
      drift: { status: "ZERO_DRIFT", summary: "No difference detected." }
    };

    const res = evaluatePreflightAssessment(input);
    assert.equal(res.status, "BLOCKED");
    assert.equal(res.applicable, false);
    assert.equal(res.classification, "FAILED_OR_UNFINISHED_HISTORY");
    assert.equal(res.blockers.some((b) => b.includes("Failed or unfinished migrations")), true);
    assert.equal(res.details.failedOrUnfinishedMigrations.length > 0, true);
  });

  it("Scenario 5: Legacy complete schema plus zero drift and baseline absent -> APPLICABLE", () => {
    const input: PreflightAssessmentInput = {
      migrationsTableExists: false,
      migrationRecords: [],
      schemaObjects: createCompleteSchemaObjects(),
      drift: { status: "ZERO_DRIFT", summary: "No difference detected." }
    };

    const res = evaluatePreflightAssessment(input);
    assert.equal(res.status, "APPLICABLE");
    assert.equal(res.applicable, true);
    assert.equal(res.classification, "LEGACY_COMPLETE_UNBASELINED");
    assert.equal(res.blockers.length, 0);
    assert.equal(res.recommendedAction.includes("migrate resolve --applied 20260901_initial_baseline"), true);
  });

  it("Scenario 6: Legacy schema missing unique constraint -> BLOCKED", () => {
    const schema = createCompleteSchemaObjects();
    schema.uniqueIndexes = schema.uniqueIndexes.filter(
      (u) => !(u.table === "DailyLog" && u.columns.includes("cycleId"))
    );

    const input: PreflightAssessmentInput = {
      migrationsTableExists: false,
      migrationRecords: [],
      schemaObjects: schema,
      drift: { status: "ZERO_DRIFT", summary: "No difference detected." }
    };

    const res = evaluatePreflightAssessment(input);
    assert.equal(res.status, "BLOCKED");
    assert.equal(res.applicable, false);
    assert.equal(res.details.missingUniqueContracts.includes("DailyLog(cycleId, date)"), true);
    assert.equal(res.blockers.some((b) => b.includes("Missing or mismatched unique contracts")), true);
  });

  it("Scenario 7: Missing enum -> BLOCKED", () => {
    const schema = createCompleteSchemaObjects();
    schema.enums = schema.enums.filter((e) => e !== "SubscriptionStatus");

    const input: PreflightAssessmentInput = {
      migrationsTableExists: false,
      migrationRecords: [],
      schemaObjects: schema,
      drift: { status: "ZERO_DRIFT", summary: "No difference detected." }
    };

    const res = evaluatePreflightAssessment(input);
    assert.equal(res.status, "BLOCKED");
    assert.equal(res.applicable, false);
    assert.equal(res.details.missingEnums.includes("SubscriptionStatus"), true);
    assert.equal(res.blockers.some((b) => b.includes("Missing required enums")), true);
  });

  it("Scenario 8: Empty database -> FRESH_DATABASE, never APPLICABLE", () => {
    const input: PreflightAssessmentInput = {
      migrationsTableExists: false,
      migrationRecords: [],
      schemaObjects: {
        tables: [],
        enums: [],
        columns: [],
        foreignKeys: [],
        uniqueIndexes: []
      },
      drift: { status: "DRIFT_DETECTED", summary: "Tables missing" }
    };

    const res = evaluatePreflightAssessment(input);
    assert.equal(res.status, "FRESH_DATABASE");
    assert.equal(res.applicable, false);
    assert.equal(res.classification, "FRESH_EMPTY");
    assert.equal(res.recommendedAction.includes("npm run db:migrate:deploy"), true);
  });

  it("Scenario 9: Prisma diff execution error -> BLOCKED", () => {
    const input: PreflightAssessmentInput = {
      migrationsTableExists: false,
      migrationRecords: [],
      schemaObjects: createCompleteSchemaObjects(),
      drift: { status: "VERIFICATION_ERROR", summary: "Could not connect to database server at localhost:5432" }
    };

    const res = evaluatePreflightAssessment(input);
    assert.equal(res.status, "BLOCKED");
    assert.equal(res.applicable, false);
    assert.equal(res.blockers.some((b) => b.includes("Prisma migrate diff verification error")), true);
    assert.equal(res.recommendedAction.includes("BLOCKED"), true);
  });

  it("Scenario 10: Drift detected with exit code 2 -> BLOCKED", () => {
    const input: PreflightAssessmentInput = {
      migrationsTableExists: false,
      migrationRecords: [],
      schemaObjects: createCompleteSchemaObjects(),
      drift: { status: "DRIFT_DETECTED", summary: "[-] Removed column User.tokenVersion" }
    };

    const res = evaluatePreflightAssessment(input);
    assert.equal(res.status, "BLOCKED");
    assert.equal(res.applicable, false);
    assert.equal(res.classification, "DRIFTED");
    assert.equal(res.blockers.some((b) => b.includes("Schema drift detected")), true);
  });
});
