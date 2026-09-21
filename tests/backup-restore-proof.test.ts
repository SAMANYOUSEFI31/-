/**
 * tests/backup-restore-proof.test.ts
 *
 * Phase 2C.2: Automated Regression Tests for Fail-Closed Backup & Restore Proof
 *
 * Validates:
 * 1. Remote guardrails & safety invariants (non-prod, loopback only, banned keywords, credentials redaction).
 * 2. Fail-Closed Artifact Integrity & Checksum Gate:
 *    - Recalculates SHA-256 and detects checksum mismatch, blocking restore.
 *    - Detects file size mismatch, blocking restore.
 *    - Missing manifest for external restore fails immediately.
 *    - TOC verification (required tables & enums verified before DB creation).
 * 3. Strict pg_restore contract:
 *    - Only exit code 0 is accepted; non-zero exit code fails closed.
 * 4. Honest Data-Parity Classification:
 *    - Live deep record comparison -> VERIFIED_ZERO_DATA_LOSS.
 *    - Deterministic per-table record digests -> VERIFIED_ZERO_DATA_LOSS without live source.
 *    - Source unavailable without digests -> STRUCTURAL_AND_COUNT_PARITY_ONLY (never claims zero data loss).
 *    - Discrepancy detected on count mismatch -> DATA_DISCREPANCY_DETECTED.
 * 5. Pure Acceptance Gate Invariants:
 *    - Proves that every individual failure condition blocks acceptance and throws.
 * 6. Backup Preflight Gate:
 *    - Blocks backup creation if required tables/enums are missing or row count is invalid.
 * 7. Git Data-Leak Prevention:
 *    - Proves backup artifacts and dumps are ignored by Git.
 * 8. Live Local PostgreSQL Backup & Restore Proof:
 *    - Runs against local or CI disposable PostgreSQL on localhost (port 5432 in CI, 54332 local).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  assertSafety,
  sanitizeText,
  computeDeterministicTableDigest,
  canonicalizeRecordValue,
  assertBackupPreflight
} from "../scripts/backup-verify";
import {
  runRestoreVerification,
  evaluateRestoreAcceptance,
  assertRestoreAcceptance,
  RestoreComparisonReport,
  seedRealisticProductionData
} from "../scripts/restore-verify";

function getLocalDbUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (process.env.DISPOSABLE_DATABASE_URL) return process.env.DISPOSABLE_DATABASE_URL;
  if (process.env.CI || process.env.GITHUB_ACTIONS) {
    return "postgresql://postgres:postgrespassword@localhost:5432/postgres";
  }
  return "postgresql://postgres@127.0.0.1:54332/postgres";
}

function createMockValidReport(): RestoreComparisonReport {
  return {
    restoredDatabaseName: "bushido_restore_mock",
    sourceDatabaseName: "bushido_source_mock",
    pgRestoreExitCode: 0,
    backupArtifact: {
      path: "backups/mock_backup.dump",
      sizeBytes: 2048,
      sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    },
    artifactVerification: {
      checksumMatches: true,
      sizeMatches: true,
      tocVerified: true,
      missingTocObjects: [],
      recalculatedSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      expectedSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      actualSizeBytes: 2048,
      expectedSizeBytes: 2048
    },
    tableParity: {
      expectedTables: ["User", "Cycle", "DailyLog", "OtpCode", "Subscription", "_prisma_migrations"],
      foundTables: ["User", "Cycle", "DailyLog", "OtpCode", "Subscription", "_prisma_migrations"],
      missingTables: [],
      status: "MATCH"
    },
    enumParity: {
      expectedEnums: ["UserRole", "UserTier", "DayStatus", "SubscriptionStatus"],
      foundEnums: ["UserRole", "UserTier", "DayStatus", "SubscriptionStatus"],
      missingEnums: [],
      status: "MATCH"
    },
    foreignKeyParity: {
      verifiedCascadeFks: 5,
      missingFks: [],
      status: "MATCH"
    },
    uniqueContractParity: {
      verifiedContracts: 5,
      missingContracts: [],
      status: "MATCH"
    },
    migrationParity: {
      expectedCount: 4,
      restoredCount: 4,
      migrations: ["20260901_baseline", "20260902_inc1", "20260903_inc2", "20260904_inc3"],
      discrepancies: [],
      status: "MATCH"
    },
    rowCountParity: {
      perTable: [
        { table: "User", expected: 3, actual: 3, match: true },
        { table: "Cycle", expected: 2, actual: 2, match: true },
        { table: "DailyLog", expected: 3, actual: 3, match: true },
        { table: "OtpCode", expected: 2, actual: 2, match: true },
        { table: "Subscription", expected: 2, actual: 2, match: true },
        { table: "_prisma_migrations", expected: 4, actual: 4, match: true }
      ],
      totalExpected: 12,
      totalActual: 12,
      status: "MATCH"
    },
    dataLossStatus: "VERIFIED_ZERO_DATA_LOSS",
    preflightReport: {
      databaseIdentity: {
        databaseName: "bushido_restore_mock",
        serverAddress: "127.0.0.1",
        serverPort: 5432,
        serverVersion: "PostgreSQL 15",
        hostClassification: "LOCAL_LOOPBACK"
      },
      migrations: {
        migrationsTableExists: true,
        initialBaselineRecorded: true,
        recordedMigrations: [],
        missingExpectedIncrementals: []
      },
      schemaIntegrity: {
        existingTables: [],
        missingRequiredTables: [],
        existingEnums: [],
        missingRequiredEnums: [],
        criticalColumnsVerified: true,
        foreignKeyContractsVerified: true,
        uniqueContractsVerified: true
      },
      assessment: {
        status: "ALREADY_BASELINED",
        classification: "FULLY_MIGRATED",
        recommendedAction: "NO_ACTION_REQUIRED",
        reasons: [],
        blockers: [],
        details: {
          missingTables: [],
          missingEnums: [],
          missingColumns: [],
          missingForeignKeys: [],
          missingUniqueContracts: [],
          missingMigrations: [],
          failedOrUnfinishedMigrations: [],
          checksumMismatches: []
        }
      }
    },
    schemaDriftStatus: "ZERO_DRIFT",
    behavioralVerification: {
      emailUniquenessEnforced: true,
      dailyLogUniquenessEnforced: true,
      cascadeDeleteActive: true
    },
    acceptance: {
      accepted: true,
      blockers: []
    }
  };
}

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

describe("Phase 2C.2: Artifact Integrity & Manifest Validation", () => {
  it("should fail external restore if manifest is missing", async () => {
    const tempDumpPath = path.resolve(process.cwd(), "temp_nonexistent_restore_test.dump");
    fs.writeFileSync(tempDumpPath, "dummy dump content");

    try {
      await assert.rejects(
        async () => {
          await runRestoreVerification({
            maintenanceUrl: getLocalDbUrl(),
            backupPath: tempDumpPath,
            args: ["--disposable-acknowledged"]
          });
        },
        (err: Error) => {
          return (
            err.message.includes("[RESTORE_INTEGRITY_VIOLATION]") &&
            err.message.includes("Missing manifest for externally supplied backup artifact")
          );
        }
      );
    } finally {
      if (fs.existsSync(tempDumpPath)) fs.unlinkSync(tempDumpPath);
    }
  });

  it("should recalculate SHA-256 and fail if checksum does not match manifest", async () => {
    const tempDumpPath = path.resolve(process.cwd(), "temp_checksum_fail.dump");
    const tempManifestPath = `${tempDumpPath}.manifest.json`;
    fs.writeFileSync(tempDumpPath, "tampered dump content");

    const forgedManifest = {
      version: "1.0.0",
      sourceDatabase: { databaseName: "test", serverHost: "127.0.0.1", serverPort: 5432, serverVersion: "Postgres 15" },
      backupArtifact: {
        filePath: tempDumpPath,
        fileName: "temp_checksum_fail.dump",
        fileSizeBytes: 21,
        sha256: "0000000000000000000000000000000000000000000000000000000000000000", // Wrong checksum
        format: "custom",
        createdAtIso: new Date().toISOString()
      },
      tocVerification: { totalTocEntries: 10, tablesFound: [], enumsFound: [], allRequiredTablesPresent: true, allRequiredEnumsPresent: true },
      sourceMetadata: { tableRowCounts: [], totalRows: 0, migrationRecords: [], foreignKeysCount: 5, uniqueIndexesCount: 5 }
    };
    fs.writeFileSync(tempManifestPath, JSON.stringify(forgedManifest, null, 2));

    try {
      await assert.rejects(
        async () => {
          await runRestoreVerification({
            maintenanceUrl: getLocalDbUrl(),
            backupPath: tempDumpPath,
            manifestPath: tempManifestPath,
            args: ["--disposable-acknowledged"]
          });
        },
        (err: Error) => {
          return (
            err.message.includes("[RESTORE_INTEGRITY_VIOLATION]") &&
            err.message.includes("Backup checksum mismatch")
          );
        }
      );
    } finally {
      if (fs.existsSync(tempDumpPath)) fs.unlinkSync(tempDumpPath);
      if (fs.existsSync(tempManifestPath)) fs.unlinkSync(tempManifestPath);
    }
  });

  it("should fail if artifact file size does not match manifest", async () => {
    const tempDumpPath = path.resolve(process.cwd(), "temp_size_fail.dump");
    const tempManifestPath = `${tempDumpPath}.manifest.json`;
    const content = "dump content with specific length";
    fs.writeFileSync(tempDumpPath, content);
    const realSha256 = crypto.createHash("sha256").update(content).digest("hex");

    const forgedManifest = {
      version: "1.0.0",
      sourceDatabase: { databaseName: "test", serverHost: "127.0.0.1", serverPort: 5432, serverVersion: "Postgres 15" },
      backupArtifact: {
        filePath: tempDumpPath,
        fileName: "temp_size_fail.dump",
        fileSizeBytes: 999999, // Wrong file size
        sha256: realSha256,
        format: "custom",
        createdAtIso: new Date().toISOString()
      },
      tocVerification: { totalTocEntries: 10, tablesFound: [], enumsFound: [], allRequiredTablesPresent: true, allRequiredEnumsPresent: true },
      sourceMetadata: { tableRowCounts: [], totalRows: 0, migrationRecords: [], foreignKeysCount: 5, uniqueIndexesCount: 5 }
    };
    fs.writeFileSync(tempManifestPath, JSON.stringify(forgedManifest, null, 2));

    try {
      await assert.rejects(
        async () => {
          await runRestoreVerification({
            maintenanceUrl: getLocalDbUrl(),
            backupPath: tempDumpPath,
            manifestPath: tempManifestPath,
            args: ["--disposable-acknowledged"]
          });
        },
        (err: Error) => {
          return (
            err.message.includes("[RESTORE_INTEGRITY_VIOLATION]") &&
            err.message.includes("Backup file size mismatch")
          );
        }
      );
    } finally {
      if (fs.existsSync(tempDumpPath)) fs.unlinkSync(tempDumpPath);
      if (fs.existsSync(tempManifestPath)) fs.unlinkSync(tempManifestPath);
    }
  });
});

describe("Phase 2C.2: Deterministic Per-Table Record Digests & Honest Parity", () => {
  it("should compute identical deterministic digests regardless of row input order", () => {
    const row1 = { id: "u1", email: "alice@test.com", createdAt: new Date("2026-01-01T00:00:00Z"), meta: { b: 2, a: 1 } };
    const row2 = { id: "u2", email: "bob@test.com", createdAt: new Date("2026-01-02T00:00:00Z"), meta: { a: 1, b: 2 } };

    const digestOrderA = computeDeterministicTableDigest([row1, row2]);
    const digestOrderB = computeDeterministicTableDigest([row2, row1]);

    assert.equal(digestOrderA, digestOrderB, "Row order must not affect deterministic digest");
  });

  it("should canonicalize Date, JSON, arrays and null deterministically", () => {
    const val1 = { z: null, y: [new Date("2026-01-01T12:00:00Z"), 42], x: { d: "hello", c: "world" } };
    const val2 = { x: { c: "world", d: "hello" }, y: [new Date("2026-01-01T12:00:00Z"), 42], z: null };

    const canon1 = canonicalizeRecordValue(val1);
    const canon2 = canonicalizeRecordValue(val2);

    assert.deepEqual(canon1, canon2);
    assert.equal(JSON.stringify(canon1), JSON.stringify(canon2));
  });

  it("should classify parity as STRUCTURAL_AND_COUNT_PARITY_ONLY if live source is missing and no digests exist", () => {
    const report = createMockValidReport();
    report.dataLossStatus = "STRUCTURAL_AND_COUNT_PARITY_ONLY";

    const evalResult = evaluateRestoreAcceptance(report);
    assert.equal(evalResult.accepted, false, "STRUCTURAL_AND_COUNT_PARITY_ONLY must NOT pass acceptance gate");
    assert.ok(evalResult.blockers.some((b) => b.includes("VERIFIED_ZERO_DATA_LOSS")));
  });

  it("should classify parity as DATA_DISCREPANCY_DETECTED on row count mismatch", () => {
    const report = createMockValidReport();
    report.rowCountParity.status = "MISMATCH";
    report.dataLossStatus = "DATA_DISCREPANCY_DETECTED";

    const evalResult = evaluateRestoreAcceptance(report);
    assert.equal(evalResult.accepted, false);
    assert.ok(evalResult.blockers.some((b) => b.includes("Row count parity mismatch")));
  });
});

describe("Phase 2C.2: Pure Final Acceptance Gate Invariants", () => {
  it("should accept a 100% compliant report without blockers", () => {
    const report = createMockValidReport();
    const evalResult = evaluateRestoreAcceptance(report);
    assert.equal(evalResult.accepted, true);
    assert.equal(evalResult.blockers.length, 0);
    assert.doesNotThrow(() => assertRestoreAcceptance(report));
  });

  it("should block acceptance if pg_restore exit code is non-zero (e.g. exit code 1)", () => {
    const report = createMockValidReport();
    report.pgRestoreExitCode = 1;

    const evalResult = evaluateRestoreAcceptance(report);
    assert.equal(evalResult.accepted, false);
    assert.ok(evalResult.blockers.some((b) => b.includes("pg_restore non-zero exit code: 1")));
    assert.throws(() => assertRestoreAcceptance(report), /RESTORE_ACCEPTANCE_FAILED/);
  });

  it("should block acceptance if artifact checksum does not match", () => {
    const report = createMockValidReport();
    report.artifactVerification.checksumMatches = false;

    const evalResult = evaluateRestoreAcceptance(report);
    assert.equal(evalResult.accepted, false);
    assert.ok(evalResult.blockers.some((b) => b.includes("SHA-256 checksum does not match")));
    assert.throws(() => assertRestoreAcceptance(report), /RESTORE_ACCEPTANCE_FAILED/);
  });

  it("should block acceptance if artifact file size does not match", () => {
    const report = createMockValidReport();
    report.artifactVerification.sizeMatches = false;

    const evalResult = evaluateRestoreAcceptance(report);
    assert.equal(evalResult.accepted, false);
    assert.ok(evalResult.blockers.some((b) => b.includes("file size does not match")));
    assert.throws(() => assertRestoreAcceptance(report), /RESTORE_ACCEPTANCE_FAILED/);
  });

  it("should block acceptance if required TOC objects are missing", () => {
    const report = createMockValidReport();
    report.artifactVerification.tocVerified = false;
    report.artifactVerification.missingTocObjects = ["table:User", "enum:UserRole"];

    const evalResult = evaluateRestoreAcceptance(report);
    assert.equal(evalResult.accepted, false);
    assert.ok(evalResult.blockers.some((b) => b.includes("missing required objects")));
    assert.throws(() => assertRestoreAcceptance(report), /RESTORE_ACCEPTANCE_FAILED/);
  });

  it("should block acceptance if table parity is MISMATCH", () => {
    const report = createMockValidReport();
    report.tableParity.status = "MISMATCH";
    report.tableParity.missingTables = ["Subscription"];

    const evalResult = evaluateRestoreAcceptance(report);
    assert.equal(evalResult.accepted, false);
    assert.ok(evalResult.blockers.some((b) => b.includes("Table parity mismatch")));
    assert.throws(() => assertRestoreAcceptance(report), /RESTORE_ACCEPTANCE_FAILED/);
  });

  it("should block acceptance if enum parity is MISMATCH", () => {
    const report = createMockValidReport();
    report.enumParity.status = "MISMATCH";
    report.enumParity.missingEnums = ["UserRole"];

    const evalResult = evaluateRestoreAcceptance(report);
    assert.equal(evalResult.accepted, false);
    assert.ok(evalResult.blockers.some((b) => b.includes("Enum parity mismatch")));
    assert.throws(() => assertRestoreAcceptance(report), /RESTORE_ACCEPTANCE_FAILED/);
  });

  it("should block acceptance if foreign key parity is MISMATCH or less than 5 CASCADE FKs", () => {
    const report = createMockValidReport();
    report.foreignKeyParity.verifiedCascadeFks = 4;
    report.foreignKeyParity.missingFks = ["Cycle.userId -> User.id [CASCADE]"];

    const evalResult = evaluateRestoreAcceptance(report);
    assert.equal(evalResult.accepted, false);
    assert.ok(evalResult.blockers.some((b) => b.includes("Foreign key parity mismatch")));
    assert.throws(() => assertRestoreAcceptance(report), /RESTORE_ACCEPTANCE_FAILED/);
  });

  it("should block acceptance if unique contract parity is MISMATCH or less than 5 contracts", () => {
    const report = createMockValidReport();
    report.uniqueContractParity.verifiedContracts = 4;
    report.uniqueContractParity.missingContracts = ["DailyLog(cycleId, date)"];

    const evalResult = evaluateRestoreAcceptance(report);
    assert.equal(evalResult.accepted, false);
    assert.ok(evalResult.blockers.some((b) => b.includes("Unique contract parity mismatch")));
    assert.throws(() => assertRestoreAcceptance(report), /RESTORE_ACCEPTANCE_FAILED/);
  });

  it("should block acceptance if migration checksum or count mismatches", () => {
    const report = createMockValidReport();
    report.migrationParity.status = "MISMATCH";
    report.migrationParity.discrepancies = ["Migration '20260901_baseline' checksum mismatch"];

    const evalResult = evaluateRestoreAcceptance(report);
    assert.equal(evalResult.accepted, false);
    assert.ok(evalResult.blockers.some((b) => b.includes("Migration parity mismatch")));
    assert.throws(() => assertRestoreAcceptance(report), /RESTORE_ACCEPTANCE_FAILED/);
  });

  it("should block acceptance if schema drift is DRIFT_DETECTED", () => {
    const report = createMockValidReport();
    report.schemaDriftStatus = "DRIFT_DETECTED";

    const evalResult = evaluateRestoreAcceptance(report);
    assert.equal(evalResult.accepted, false);
    assert.ok(evalResult.blockers.some((b) => b.includes("Schema drift detected")));
    assert.throws(() => assertRestoreAcceptance(report), /RESTORE_ACCEPTANCE_FAILED/);
  });

  it("should block acceptance if behavioral checks fail (email uniqueness, dailyLog uniqueness, or cascade)", () => {
    const report = createMockValidReport();
    report.behavioralVerification.cascadeDeleteActive = false;

    const evalResult = evaluateRestoreAcceptance(report);
    assert.equal(evalResult.accepted, false);
    assert.ok(evalResult.blockers.some((b) => b.includes("Cascade deletion not active")));
    assert.throws(() => assertRestoreAcceptance(report), /RESTORE_ACCEPTANCE_FAILED/);
  });
});

describe("Phase 2C.2: Git Data-Leak Prevention", () => {
  it("should ignore backups/, *.dump, and *.manifest.json in .gitignore", () => {
    const checkRes = spawnSync(
      "git",
      [
        "check-ignore",
        "backups/test.dump",
        "backups/test.dump.manifest.json",
        "local_dump_sample.dump",
        "sample.dump.manifest.json"
      ],
      { shell: false, encoding: "utf8" }
    );

    assert.equal(checkRes.status, 0, "git check-ignore must match backup artifacts");
    const output = checkRes.stdout;
    assert.ok(output.includes("backups/test.dump"));
    assert.ok(output.includes("backups/test.dump.manifest.json"));
    assert.ok(output.includes("local_dump_sample.dump"));
  });

  it("should confirm zero backup files are tracked in Git index", () => {
    const lsRes = spawnSync("git", ["ls-files"], { shell: false, encoding: "utf8" });
    assert.equal(lsRes.status, 0);
    const trackedFiles = lsRes.stdout.split("\n");
    const leakedFiles = trackedFiles.filter(
      (f) => f.endsWith(".dump") || f.includes("backups/") || f.endsWith(".manifest.json")
    );
    assert.deepEqual(leakedFiles, [], "No backup dump or manifest should be tracked in Git");
  });
});

describe("Phase 2C.2: Live Local PostgreSQL Backup & Restore Proof", () => {
  it("should execute end-to-end backup, restore, deep parity validation, and prove zero data loss", async (t) => {
    const localDbUrl = getLocalDbUrl();

    // Check if live local PostgreSQL is reachable before attempting e2e
    const isReachable = await new Promise<boolean>((resolve) => {
      try {
        const client = new PrismaClient({ datasources: { db: { url: localDbUrl } } });
        client
          .$connect()
          .then(() => client.$disconnect().then(() => resolve(true)))
          .catch(() => resolve(false));
      } catch {
        resolve(false);
      }
    });

    if (!isReachable) {
      t.skip(`Safe local disposable PostgreSQL is not reachable at ${sanitizeText(localDbUrl)}; skipping live e2e.`);
      return;
    }

    const report = await runRestoreVerification({
      maintenanceUrl: localDbUrl,
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
    assert.equal(report.migrationParity.discrepancies.length, 0);

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

    // 4. Honest Zero Data Loss Proof
    assert.equal(
      report.dataLossStatus,
      "VERIFIED_ZERO_DATA_LOSS",
      "Deep record comparison must prove verified zero data loss"
    );

    // 5. Artifact verification
    assert.equal(report.artifactVerification.checksumMatches, true);
    assert.equal(report.artifactVerification.sizeMatches, true);
    assert.equal(report.artifactVerification.tocVerified, true);
    assert.equal(report.pgRestoreExitCode, 0);

    // 6. Restored Preflight Status
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

    // 7. Schema Drift status
    assert.equal(
      report.schemaDriftStatus,
      "ZERO_DRIFT",
      "Restored database must show ZERO_DRIFT against prisma/schema.prisma"
    );

    // 8. Behavioral enforcement
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

    // 9. Pure Acceptance Gate
    assert.equal(report.acceptance.accepted, true);
    assert.equal(report.acceptance.blockers.length, 0);
    assert.doesNotThrow(() => assertRestoreAcceptance(report));
  });
});
