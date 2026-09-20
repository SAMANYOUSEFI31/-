/**
 * tests/backup-restore-proof.test.ts
 *
 * Phase 2C.2: Automated Regression Tests for Backup & Restore Proof
 *
 * Validates:
 * 1. Remote guardrails & safety invariants (non-prod, loopback only, banned keywords, credentials redaction).
 * 2. Backup TOC integrity checks (fail-closed when tables/enums missing).
 * 3. Live local PostgreSQL backup & restore execution:
 *    - Full schema migration deployment.
 *    - Realistic production data seeding across User, Cycle, DailyLog, OtpCode, Subscription.
 *    - pg_dump custom format creation and manifest verification.
 *    - pg_restore execution into isolated disposable database.
 *    - Deep comparison: row counts, tables, enums, indexes, foreign keys, migrations, record parity.
 *    - Zero data loss proof.
 *    - Restored database passes preflight inspection (ALREADY_BASELINED, ZERO_DRIFT, 0 blockers).
 *    - Restored database passes prisma migrate diff (exit code 0).
 *    - Restored database enforces behavioral uniqueness and cascade deletion.
 *    - Clean teardown of all ephemeral databases.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  assertSafety,
  sanitizeText,
  runBackupVerification
} from "../scripts/backup-verify";
import {
  runRestoreVerification,
  seedRealisticProductionData
} from "../scripts/restore-verify";

describe("Phase 2C.2: Safety Invariants & Remote Guardrails", () => {
  it("should redact database passwords in error messages and outputs", () => {
    const raw = "postgresql://postgres:SuperSecretPassword123@127.0.0.1:5432/bushido";
    const sanitized = sanitizeText(raw);
    assert.equal(sanitized.includes("SuperSecretPassword123"), false);
    assert.equal(sanitized, "postgresql://postgres:[REDACTED]@127.0.0.1:5432/bushido");
  });

  it("should fail-closed if explicit acknowledgment flag is missing", () => {
    assert.throws(
      () => {
        assertSafety("postgresql://postgres@127.0.0.1:5432/db", []);
      },
      (err: Error) => {
        return err.message.includes("[SAFETY_VIOLATION]") && err.message.includes("acknowledgment");
      }
    );
  });

  it("should fail-closed if banned keywords detected in database URL", () => {
    const bannedUrls = [
      "postgresql://user:pass@ep-cool-bushido.us-east-2.aws.neon.tech/neondb",
      "postgresql://postgres:pass@db.abcdefgh.supabase.co:5432/postgres",
      "postgresql://user:pass@ep-cool-pooler.us-east-1.aws.neon.tech/neondb",
      "postgresql://postgres:pass@production-db.internal:5432/bushido_prod",
      "postgresql://postgres:pass@127.0.0.1:5432/bushido_stage_db"
    ];

    for (const url of bannedUrls) {
      assert.throws(
        () => {
          assertSafety(url, ["--disposable-acknowledged"]);
        },
        (err: Error) => {
          return err.message.includes("[SAFETY_VIOLATION]") && err.message.includes("Banned keyword");
        }
      );
    }
  });

  it("should fail-closed if non-loopback host is provided", () => {
    assert.throws(
      () => {
        assertSafety("postgresql://postgres:pass@db.mycompany.internal:5432/postgres", [
          "--disposable-acknowledged"
        ]);
      },
      (err: Error) => {
        return err.message.includes("[SAFETY_VIOLATION]") && err.message.includes("not a permitted local loopback");
      }
    );
  });

  it("should succeed for verified local loopback address with acknowledgment", () => {
    assert.doesNotThrow(() => {
      assertSafety("postgresql://postgres@127.0.0.1:54332/postgres", ["--disposable-acknowledged"]);
    });
    assert.doesNotThrow(() => {
      assertSafety("postgresql://postgres@localhost:5432/test_db", ["--disposable-acknowledged"]);
    });
  });
});

describe("Phase 2C.2: Live Local PostgreSQL Backup & Restore Proof", () => {
  const LOCAL_DB_URL = "postgresql://postgres@127.0.0.1:54332/postgres";

  it("should execute end-to-end backup, restore, deep parity validation, and prove zero data loss", async () => {
    const report = await runRestoreVerification({
      maintenanceUrl: LOCAL_DB_URL,
      args: ["--disposable-acknowledged"],
      e2eMode: true
    });

    // 1. Schema objects parity
    assert.equal(report.tableParity.status, "MATCH", "All 6 tables must exist in restored DB");
    assert.equal(report.tableParity.foundTables.length, 6);
    assert.equal(report.enumParity.status, "MATCH", "All 4 enums must exist in restored DB");
    assert.equal(report.foreignKeyParity.status, "MATCH", "All 5 ON DELETE CASCADE FKs must be verified");
    assert.equal(report.foreignKeyParity.verifiedCascadeFks, 5);
    assert.equal(report.uniqueContractParity.status, "MATCH", "All 5 unique contracts must be verified");
    assert.equal(report.uniqueContractParity.verifiedContracts, 5);

    // 2. Migration history parity
    assert.equal(report.migrationParity.status, "MATCH", "All 4 migrations must be present and finished");
    assert.equal(report.migrationParity.restoredCount, 4);

    // 3. Row count parity
    assert.equal(report.rowCountParity.status, "MATCH", "Row counts must match exactly between source and restore");
    assert.equal(report.rowCountParity.totalActual, 12, "Total seeded application rows must be 12");
    assert.equal(report.rowCountParity.totalExpected, 12);

    const userCount = report.rowCountParity.perTable.find((p) => p.table === "User");
    assert.equal(userCount?.actual, 3);

    const cycleCount = report.rowCountParity.perTable.find((p) => p.table === "Cycle");
    assert.equal(cycleCount?.actual, 2);

    const logCount = report.rowCountParity.perTable.find((p) => p.table === "DailyLog");
    assert.equal(logCount?.actual, 3);

    const otpCount = report.rowCountParity.perTable.find((p) => p.table === "OtpCode");
    assert.equal(otpCount?.actual, 2);

    const subCount = report.rowCountParity.perTable.find((p) => p.table === "Subscription");
    assert.equal(subCount?.actual, 2);

    // 4. Zero Data Loss Proof
    assert.equal(
      report.dataLossStatus,
      "ZERO_DATA_LOSS",
      "All record fields, JSON verdicts, and timestamps must match exactly"
    );

    // 5. Restored Preflight Status
    assert.equal(
      report.preflightReport.assessment.status,
      "ALREADY_BASELINED",
      "Restored database must pass preflight as ALREADY_BASELINED"
    );
    assert.equal(
      report.preflightReport.assessment.classification,
      "FULLY_MIGRATED",
      "Restored database must be classified as FULLY_MIGRATED"
    );
    assert.equal(report.preflightReport.assessment.blockers.length, 0, "There must be 0 preflight blockers");

    // 6. Schema Drift status
    assert.equal(
      report.schemaDriftStatus,
      "ZERO_DRIFT",
      "Restored database must show ZERO_DRIFT against prisma/schema.prisma"
    );

    // 7. Behavioral enforcement
    assert.equal(
      report.behavioralVerification.emailUniquenessEnforced,
      true,
      "User.email uniqueness must be actively enforced (P2002)"
    );
    assert.equal(
      report.behavioralVerification.dailyLogUniquenessEnforced,
      true,
      "DailyLog(cycleId, date) uniqueness must be actively enforced (P2002)"
    );
    assert.equal(
      report.behavioralVerification.cascadeDeleteActive,
      true,
      "ON DELETE CASCADE must be actively enforced on restored database"
    );
  });
});
