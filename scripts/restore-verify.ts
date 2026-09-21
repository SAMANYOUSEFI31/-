/**
 * scripts/restore-verify.ts
 *
 * Phase 2C.2: Automated PostgreSQL Restore & Parity Verification
 *
 * Proves that a verified database backup can be restored into an isolated
 * disposable database and validated without data loss.
 *
 * Verification Steps:
 * 1. Safety verification (local loopback only, non-production).
 * 2. Ephemeral target database creation (bushido_restore_*).
 * 3. pg_restore execution without shell interpolation.
 * 4. Schema parity (tables, enums, critical columns).
 * 5. Constraint & Foreign Key integrity (5 ON DELETE CASCADE relationships).
 * 6. Index & Uniqueness contracts (5 critical unique contracts).
 * 7. Migration history parity (_prisma_migrations records, checksums, timestamps).
 * 8. Exact row count match across all tables.
 * 9. Record-level deep data equality against source database (zero data loss proof).
 * 10. Preflight inspection pass (ALREADY_BASELINED, ZERO_DRIFT, 0 blockers).
 * 11. Schema drift detection pass (prisma migrate diff exits with 0).
 * 12. Behavioral validation (P2002 uniqueness checks and Cascade delete behavior).
 * 13. Guaranteed clean teardown of ephemeral database.
 */

import { spawnSync } from "node:child_process";
import { URL } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import {
  runPreflightInspection,
  DetailedPreflightReport
} from "./preflight-existing-database";
import {
  REQUIRED_TABLES,
  REQUIRED_ENUMS,
  REQUIRED_CRITICAL_COLUMNS,
  REQUIRED_FOREIGN_KEYS,
  REQUIRED_UNIQUE_CONTRACTS,
  EXPECTED_INCREMENTAL_MIGRATIONS,
  BASELINE_MIGRATION
} from "./preflight-assessment";
import {
  BackupManifest,
  assertSafety,
  sanitizeText,
  runBackupVerification,
  computeDeterministicTableDigest,
  canonicalizeRecordValue
} from "./backup-verify";

export type DataParityClassification =
  | "VERIFIED_ZERO_DATA_LOSS"
  | "STRUCTURAL_AND_COUNT_PARITY_ONLY"
  | "DATA_DISCREPANCY_DETECTED"
  | "VERIFICATION_INCOMPLETE";

export interface RestoreComparisonReport {
  restoredDatabaseName: string;
  sourceDatabaseName: string;
  pgRestoreExitCode: number;
  backupArtifact: {
    path: string;
    sizeBytes: number;
    sha256: string;
  };
  artifactVerification: {
    checksumMatches: boolean;
    sizeMatches: boolean;
    tocVerified: boolean;
    missingTocObjects: string[];
    recalculatedSha256: string;
    expectedSha256: string;
    actualSizeBytes: number;
    expectedSizeBytes: number;
  };
  tableParity: {
    expectedTables: string[];
    foundTables: string[];
    missingTables: string[];
    status: "MATCH" | "MISMATCH";
  };
  enumParity: {
    expectedEnums: string[];
    foundEnums: string[];
    missingEnums: string[];
    status: "MATCH" | "MISMATCH";
  };
  foreignKeyParity: {
    verifiedCascadeFks: number;
    missingFks: string[];
    status: "MATCH" | "MISMATCH";
  };
  uniqueContractParity: {
    verifiedContracts: number;
    missingContracts: string[];
    status: "MATCH" | "MISMATCH";
  };
  migrationParity: {
    expectedCount: number;
    restoredCount: number;
    migrations: string[];
    discrepancies: string[];
    status: "MATCH" | "MISMATCH";
  };
  rowCountParity: {
    perTable: Array<{
      table: string;
      expected: number;
      actual: number;
      match: boolean;
    }>;
    totalExpected: number;
    totalActual: number;
    status: "MATCH" | "MISMATCH";
  };
  dataLossStatus: DataParityClassification;
  preflightReport: DetailedPreflightReport;
  schemaDriftStatus: "ZERO_DRIFT" | "DRIFT_DETECTED";
  behavioralVerification: {
    emailUniquenessEnforced: boolean;
    dailyLogUniquenessEnforced: boolean;
    cascadeDeleteActive: boolean;
  };
  acceptance: {
    accepted: boolean;
    blockers: string[];
  };
}

export interface AcceptanceEvaluationResult {
  accepted: boolean;
  blockers: string[];
}

export function evaluateRestoreAcceptance(report: RestoreComparisonReport): AcceptanceEvaluationResult {
  const blockers: string[] = [];

  if (report.pgRestoreExitCode !== 0) {
    blockers.push(`pg_restore non-zero exit code: ${report.pgRestoreExitCode}`);
  }
  if (!report.artifactVerification.checksumMatches) {
    blockers.push("Backup artifact SHA-256 checksum does not match manifest");
  }
  if (!report.artifactVerification.sizeMatches) {
    blockers.push("Backup artifact file size does not match manifest");
  }
  if (!report.artifactVerification.tocVerified) {
    blockers.push(`Backup artifact TOC missing required objects: ${report.artifactVerification.missingTocObjects.join(", ")}`);
  }
  if (report.tableParity.status !== "MATCH") {
    blockers.push(`Table parity mismatch: missing ${report.tableParity.missingTables.join(", ")}`);
  }
  if (report.enumParity.status !== "MATCH") {
    blockers.push(`Enum parity mismatch: missing ${report.enumParity.missingEnums.join(", ")}`);
  }
  if (
    report.foreignKeyParity.status !== "MATCH" ||
    report.foreignKeyParity.verifiedCascadeFks !== 5 ||
    report.foreignKeyParity.missingFks.length > 0
  ) {
    blockers.push(
      `Foreign key parity mismatch: verified ${report.foreignKeyParity.verifiedCascadeFks}/5, missing ${report.foreignKeyParity.missingFks.join(", ")}`
    );
  }
  if (
    report.uniqueContractParity.status !== "MATCH" ||
    report.uniqueContractParity.verifiedContracts !== 5 ||
    report.uniqueContractParity.missingContracts.length > 0
  ) {
    blockers.push(
      `Unique contract parity mismatch: verified ${report.uniqueContractParity.verifiedContracts}/5, missing ${report.uniqueContractParity.missingContracts.join(", ")}`
    );
  }
  if (report.migrationParity.status !== "MATCH" || report.migrationParity.discrepancies.length > 0) {
    blockers.push(
      `Migration parity mismatch: expected ${report.migrationParity.expectedCount}, got ${report.migrationParity.restoredCount}. Details: ${report.migrationParity.discrepancies.join("; ")}`
    );
  }
  if (report.rowCountParity.status !== "MATCH") {
    const mismatches = report.rowCountParity.perTable
      .filter((p) => !p.match)
      .map((p) => `${p.table} (expected ${p.expected}, actual ${p.actual})`);
    blockers.push(`Row count parity mismatch in tables: ${mismatches.join(", ")}`);
  }
  if (report.dataLossStatus !== "VERIFIED_ZERO_DATA_LOSS") {
    blockers.push(`Data loss status is '${report.dataLossStatus}', required 'VERIFIED_ZERO_DATA_LOSS'`);
  }
  if (report.preflightReport.assessment.status !== "ALREADY_BASELINED") {
    blockers.push(`Restored preflight status '${report.preflightReport.assessment.status}' is not ALREADY_BASELINED`);
  }
  if (report.preflightReport.assessment.classification !== "FULLY_MIGRATED") {
    blockers.push(`Restored preflight classification '${report.preflightReport.assessment.classification}' is not FULLY_MIGRATED`);
  }
  if (report.preflightReport.assessment.blockers.length > 0) {
    blockers.push(`Restored preflight reported blockers: ${report.preflightReport.assessment.blockers.join("; ")}`);
  }
  if (report.schemaDriftStatus !== "ZERO_DRIFT") {
    blockers.push(`Schema drift detected: '${report.schemaDriftStatus}'`);
  }
  if (!report.behavioralVerification.emailUniquenessEnforced) {
    blockers.push("Behavioral check failed: Email uniqueness (P2002) not enforced");
  }
  if (!report.behavioralVerification.dailyLogUniquenessEnforced) {
    blockers.push("Behavioral check failed: DailyLog uniqueness (P2002) not enforced");
  }
  if (!report.behavioralVerification.cascadeDeleteActive) {
    blockers.push("Behavioral check failed: Cascade deletion not active");
  }

  return {
    accepted: blockers.length === 0,
    blockers
  };
}

export function assertRestoreAcceptance(report: RestoreComparisonReport): void {
  const evaluation = evaluateRestoreAcceptance(report);
  if (!evaluation.accepted) {
    throw new Error(
      `[RESTORE_ACCEPTANCE_FAILED] Acceptance gate blocked restore verification with ${evaluation.blockers.length} blocker(s):\n${evaluation.blockers
        .map((b, i) => `  ${i + 1}. ${b}`)
        .join("\n")}`
    );
  }
}

export interface RestoreVerificationOptions {
  backupPath?: string;
  manifestPath?: string;
  sourceDatabaseUrl?: string;
  maintenanceUrl: string;
  args?: string[];
  skipSafetyCheck?: boolean;
  keepRestoredDb?: boolean;
  e2eMode?: boolean;
}

/**
 * Seed a realistic production dataset for end-to-end backup & restore proof.
 */
export async function seedRealisticProductionData(prisma: PrismaClient): Promise<{
  usersCount: number;
  cyclesCount: number;
  dailyLogsCount: number;
  otpCodesCount: number;
  subscriptionsCount: number;
  totalRows: number;
}> {
  // User 1: Free User (Ronin)
  const u1 = await prisma.user.create({
    data: {
      email: "ronin.fighter@bushido.local",
      phoneNumber: "09121111111",
      name: "Sohrab Ronin",
      role: "FREE",
      tier: "ronin_free",
      isVip: false,
      tokenVersion: 1,
      accentTheme: "amber",
      nightOwlCutoffHour: 4
    }
  });

  // User 2: VIP Samurai User
  const u2 = await prisma.user.create({
    data: {
      email: "samurai.vip@bushido.local",
      phoneNumber: "09122222222",
      name: "Arash Samurai",
      role: "VIP",
      tier: "vip_samurai",
      isVip: true,
      vipSince: new Date("2026-08-01T10:00:00Z"),
      vipExpiresAt: new Date("2026-11-01T10:00:00Z"),
      tokenVersion: 2,
      accentTheme: "orange",
      nightOwlCutoffHour: 3
    }
  });

  // User 3: Admin Daimyo User
  const u3 = await prisma.user.create({
    data: {
      email: "daimyo.admin@bushido.local",
      phoneNumber: "09123333333",
      name: "Master Daimyo",
      role: "ADMIN",
      tier: "daimyo_master",
      isVip: true,
      isAdmin: true,
      tokenVersion: 5,
      accentTheme: "emerald",
      nightOwlCutoffHour: 5
    }
  });

  // Cycles
  const c1 = await prisma.cycle.create({
    data: {
      userId: u1.id,
      title: "دوره ۲۱ روزه آغازین",
      startDate: "2026-09-01",
      endDate: "2026-09-21",
      inheritedStreak: 0,
      rules: ["بیداری ۵ صبح", "۴۵ دقیقه ورزش", "مطالعه کایزن"],
      revision: 1
    }
  });

  const c2 = await prisma.cycle.create({
    data: {
      userId: u2.id,
      title: "نبرد آهن و انضباط نینجا",
      startDate: "2026-09-01",
      endDate: "2026-09-21",
      inheritedStreak: 14,
      rules: ["حذف کامل شکر", "تمرین فشرده", "ژورنال شبانه"],
      verdict: {
        totalScore: 92,
        standardDays: 18,
        masteryDays: 14,
        coachVerdict: "انضباط پولادین با تعهد کامل به کات‌آف شبانه"
      },
      revision: 3
    }
  });

  // Daily Logs
  const d1 = await prisma.dailyLog.create({
    data: {
      userId: u1.id,
      cycleId: c1.id,
      date: "2026-09-01",
      status: "STANDARD",
      wakeUp: true,
      workout: true,
      study: true,
      journal: true,
      hardTask: false,
      specialMission: true,
      lastClientOperationId: "op-seed-001",
      revision: 1
    }
  });

  const d2 = await prisma.dailyLog.create({
    data: {
      userId: u1.id,
      cycleId: c1.id,
      date: "2026-09-02",
      status: "BURNED",
      wakeUp: false,
      workout: false,
      study: false,
      journal: false,
      hardTask: false,
      specialMission: false,
      failureReason: "خستگی مفرط و اهمال‌کاری",
      failureTime: "23:30",
      autopsyNotes: "عدم رعایت کات‌آف شبانه باعث تاخیر بیداری شد.",
      countermeasure: "خاموشی کامل گوشی از ساعت ۲۲:۳۰",
      lastClientOperationId: "op-seed-002",
      revision: 2
    }
  });

  const d3 = await prisma.dailyLog.create({
    data: {
      userId: u2.id,
      cycleId: c2.id,
      date: "2026-09-01",
      status: "STANDARD",
      wakeUp: true,
      workout: true,
      study: true,
      journal: true,
      hardTask: true,
      specialMission: true,
      aiFeedback: "تمرکز عالی روی اهداف اصلی.",
      lastClientOperationId: "op-seed-003",
      revision: 1
    }
  });

  // OtpCodes
  const o1 = await prisma.otpCode.create({
    data: {
      identifier: "09121111111",
      purpose: "PHONE_REGISTRATION",
      codeHash: "hash-seed-123456",
      expiresAt: new Date("2026-09-20T18:00:00Z"),
      verified: true,
      attempts: 1,
      userId: u1.id
    }
  });

  const o2 = await prisma.otpCode.create({
    data: {
      identifier: "09129999999",
      purpose: "PASSWORD_RESET",
      codeHash: "hash-seed-654321",
      expiresAt: new Date("2026-09-20T19:00:00Z"),
      verified: false,
      attempts: 0
    }
  });

  // Subscriptions
  const s1 = await prisma.subscription.create({
    data: {
      userId: u2.id,
      planId: "vip_quarterly",
      amount: 450000,
      authority: "A000000000000000000000000001",
      refId: "REF-987654321",
      cardPan: "6037********1234",
      status: "SUCCESS",
      expiresAt: new Date("2026-11-01T10:00:00Z")
    }
  });

  const s2 = await prisma.subscription.create({
    data: {
      userId: u1.id,
      planId: "vip_monthly",
      amount: 150000,
      authority: "A000000000000000000000000002",
      status: "PENDING"
    }
  });

  const usersCount = 3;
  const cyclesCount = 2;
  const dailyLogsCount = 3;
  const otpCodesCount = 2;
  const subscriptionsCount = 2;
  const totalRows = usersCount + cyclesCount + dailyLogsCount + otpCodesCount + subscriptionsCount;

  return {
    usersCount,
    cyclesCount,
    dailyLogsCount,
    otpCodesCount,
    subscriptionsCount,
    totalRows
  };
}

export async function runRestoreVerification(
  options: RestoreVerificationOptions
): Promise<RestoreComparisonReport> {
  const {
    maintenanceUrl,
    args = [],
    skipSafetyCheck = false,
    keepRestoredDb = false,
    e2eMode = false
  } = options;

  let backupPath = options.backupPath;
  let manifestPath = options.manifestPath;
  let sourceDatabaseUrl = options.sourceDatabaseUrl;

  if (!skipSafetyCheck) {
    assertSafety(maintenanceUrl, args);
    if (sourceDatabaseUrl) {
      assertSafety(sourceDatabaseUrl, args);
    }
  }

  const maintenancePrisma = new PrismaClient({
    datasources: { db: { url: maintenanceUrl } }
  });

  const ephemeralDbsToCleanup: string[] = [];
  const tempFilesToCleanup: string[] = [];

  const cleanupAll = async () => {
    for (const dbName of ephemeralDbsToCleanup) {
      try {
        await maintenancePrisma.$executeRawUnsafe(`
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = '${dbName}' AND pid <> pg_backend_pid();
        `);
        await maintenancePrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}";`);
      } catch {}
    }
    for (const f of tempFilesToCleanup) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {}
    }
  };

  try {
    // If e2eMode or no backup provided, build an ephemeral source DB, deploy migrations, seed data, and run backup
    let manifest: BackupManifest | null = null;

    if (e2eMode || !backupPath) {
      const sourceDbName = `bushido_source_pf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await maintenancePrisma.$executeRawUnsafe(`CREATE DATABASE "${sourceDbName}";`);
      ephemeralDbsToCleanup.push(sourceDbName);

      const parsedMaint = new URL(maintenanceUrl);
      parsedMaint.pathname = `/${sourceDbName}`;
      sourceDatabaseUrl = parsedMaint.toString();

      // 1. Deploy migrations on source DB
      const deployRes = spawnSync("npx", ["prisma", "migrate", "deploy"], {
        shell: false,
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: sourceDatabaseUrl }
      });

      if (deployRes.status !== 0) {
        throw new Error(`Failed to deploy migrations on source DB: ${sanitizeText(deployRes.stderr || deployRes.stdout)}`);
      }

      // 2. Seed realistic production data
      const sourcePrisma = new PrismaClient({
        datasources: { db: { url: sourceDatabaseUrl } }
      });
      await seedRealisticProductionData(sourcePrisma);
      await sourcePrisma.$disconnect();

      // 3. Create verified backup
      manifest = await runBackupVerification({
        databaseUrl: sourceDatabaseUrl,
        args: ["--disposable-acknowledged"],
        skipSafetyCheck: true
      });
      backupPath = manifest.backupArtifact.filePath;
      tempFilesToCleanup.push(backupPath);
      tempFilesToCleanup.push(`${backupPath}.manifest.json`);
    } else {
      if (manifestPath && fs.existsSync(manifestPath)) {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      } else if (backupPath && fs.existsSync(`${backupPath}.manifest.json`)) {
        manifest = JSON.parse(fs.readFileSync(`${backupPath}.manifest.json`, "utf8"));
      } else {
        throw new Error(
          `[RESTORE_INTEGRITY_VIOLATION] Execution refused: Missing manifest for externally supplied backup artifact: ${backupPath}`
        );
      }
    }

    if (!backupPath || !fs.existsSync(backupPath)) {
      throw new Error(`[RESTORE_ERROR] Backup file not found at: ${backupPath}`);
    }

    // Recalculate SHA-256 and size from actual dump file
    const fileBytes = fs.readFileSync(backupPath);
    const recalculatedSha256 = crypto.createHash("sha256").update(fileBytes).digest("hex");
    const expectedSha256 = manifest?.backupArtifact?.sha256 || "";
    const actualSizeBytes = fs.statSync(backupPath).size;
    const expectedSizeBytes = manifest?.backupArtifact?.fileSizeBytes || -1;

    const actualBuf = Buffer.from(recalculatedSha256, "utf8");
    const expectedBuf = Buffer.from(expectedSha256, "utf8");
    const checksumMatches =
      actualBuf.length > 0 &&
      expectedBuf.length > 0 &&
      actualBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(actualBuf, expectedBuf);

    if (!checksumMatches) {
      throw new Error(
        `[RESTORE_INTEGRITY_VIOLATION] Backup checksum mismatch! Expected SHA-256 ${expectedSha256}, recalculated ${recalculatedSha256}`
      );
    }

    const sizeMatches = actualSizeBytes === expectedSizeBytes;
    if (!sizeMatches) {
      throw new Error(
        `[RESTORE_INTEGRITY_VIOLATION] Backup file size mismatch! Expected ${expectedSizeBytes} bytes, found ${actualSizeBytes} bytes`
      );
    }

    // Run pg_restore --list to inspect TOC before creating restore database
    const tocResult = spawnSync("pg_restore", ["--list", backupPath], {
      shell: false,
      encoding: "utf8"
    });
    if (tocResult.error) {
      throw new Error(
        `[RESTORE_INTEGRITY_VIOLATION] pg_restore --list failed: ${sanitizeText(tocResult.error.message)}`
      );
    }
    if (tocResult.status !== 0) {
      throw new Error(
        `[RESTORE_INTEGRITY_VIOLATION] pg_restore --list failed with non-zero exit code ${tocResult.status}: ${sanitizeText(
          tocResult.stderr || tocResult.stdout
        )}`
      );
    }

    const tocOutput = tocResult.stdout;
    const missingTocObjects: string[] = [];
    for (const t of [...REQUIRED_TABLES, "_prisma_migrations"]) {
      const regex = new RegExp(`(TABLE|TABLE DATA)\\s+public\\s+${t}\\b`, "i");
      if (!regex.test(tocOutput)) {
        missingTocObjects.push(`table:${t}`);
      }
    }
    for (const e of REQUIRED_ENUMS) {
      const regex = new RegExp(`TYPE\\s+public\\s+${e}\\b`, "i");
      if (!regex.test(tocOutput)) {
        missingTocObjects.push(`enum:${e}`);
      }
    }
    if (missingTocObjects.length > 0) {
      throw new Error(
        `[RESTORE_INTEGRITY_VIOLATION] Backup artifact TOC is missing required objects: ${missingTocObjects.join(", ")}`
      );
    }

    const artifactVerification = {
      checksumMatches,
      sizeMatches,
      tocVerified: missingTocObjects.length === 0,
      missingTocObjects,
      recalculatedSha256,
      expectedSha256,
      actualSizeBytes,
      expectedSizeBytes
    };

    // 4. Create ephemeral target restore database
    const restoreDbName = `bushido_restore_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await maintenancePrisma.$executeRawUnsafe(`CREATE DATABASE "${restoreDbName}";`);
    if (!keepRestoredDb) {
      ephemeralDbsToCleanup.push(restoreDbName);
    }

    const parsedTarget = new URL(maintenanceUrl);
    parsedTarget.pathname = `/${restoreDbName}`;
    const restoreDbUrl = parsedTarget.toString();

    // 5. Execute pg_restore
    const host = parsedTarget.hostname || "127.0.0.1";
    const port = parsedTarget.port || "5432";
    const user = decodeURIComponent(parsedTarget.username || "postgres");
    const password = decodeURIComponent(parsedTarget.password || "");

    const envOverrides: Record<string, string> = {
      PGHOST: host,
      PGPORT: String(port),
      PGUSER: user
    };
    if (password) {
      envOverrides.PGPASSWORD = password;
    }

    const restoreRes = spawnSync(
      "pg_restore",
      [
        "--no-owner",
        "--no-privileges",
        "--dbname",
        restoreDbName,
        backupPath
      ],
      {
        shell: false,
        encoding: "utf8",
        env: { ...process.env, ...envOverrides }
      }
    );

    if (restoreRes.error) {
      throw new Error(`[RESTORE_ERROR] pg_restore failed to spawn: ${sanitizeText(restoreRes.error.message)}`);
    }

    const pgRestoreExitCode = restoreRes.status ?? -1;

    // Strict exit code 0 contract: accept ONLY code 0
    if (pgRestoreExitCode !== 0) {
      throw new Error(
        `[RESTORE_ERROR] pg_restore exited with non-zero code ${pgRestoreExitCode}: ${sanitizeText(
          restoreRes.stderr || restoreRes.stdout
        )}`
      );
    }

    // 6. Connect to Restored Database via PrismaClient
    const restoredPrisma = new PrismaClient({
      datasources: { db: { url: restoreDbUrl } }
    });

    let sourcePrisma: PrismaClient | null = null;
    if (sourceDatabaseUrl) {
      sourcePrisma = new PrismaClient({
        datasources: { db: { url: sourceDatabaseUrl } }
      });
    }

    // 7. Inspect tables
    const tablesRes: Array<{ table_name: string }> = await restoredPrisma.$queryRawUnsafe(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);
    const foundTables = tablesRes.map((t) => t.table_name);
    const expectedTables = [...REQUIRED_TABLES, "_prisma_migrations"];
    const missingTables = expectedTables.filter((t) => !foundTables.includes(t));
    const tableParityStatus = missingTables.length === 0 ? "MATCH" : "MISMATCH";

    // 8. Inspect enums
    const enumsRes: Array<{ typname: string }> = await restoredPrisma.$queryRawUnsafe(`
      SELECT typname FROM pg_type
      WHERE typname IN ('UserRole', 'UserTier', 'DayStatus', 'SubscriptionStatus');
    `);
    const foundEnums = enumsRes.map((e) => e.typname);
    const missingEnums = REQUIRED_ENUMS.filter((e) => !foundEnums.includes(e));
    const enumParityStatus = missingEnums.length === 0 ? "MATCH" : "MISMATCH";

    // 9. Inspect foreign keys with CASCADE
    interface FkRow {
      table_name: string;
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
      delete_rule: string;
    }
    const fksRes: FkRow[] = await restoredPrisma.$queryRawUnsafe(`
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
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';
    `);

    const missingFks: string[] = [];
    let verifiedCascadeFks = 0;
    for (const req of REQUIRED_FOREIGN_KEYS) {
      const match = fksRes.find(
        (f) =>
          f.table_name === req.table &&
          f.column_name === req.column &&
          f.foreign_table_name === req.foreignTable &&
          f.foreign_column_name === req.foreignColumn &&
          f.delete_rule === req.deleteRule
      );
      if (match) {
        verifiedCascadeFks++;
      } else {
        missingFks.push(`${req.table}.${req.column} -> ${req.foreignTable}.${req.foreignColumn} [${req.deleteRule}]`);
      }
    }
    const foreignKeyParityStatus = missingFks.length === 0 ? "MATCH" : "MISMATCH";

    // 10. Inspect Unique Contracts
    const uniqueIndexesRows: Array<{ table_name: string; column_names: string[] }> =
      await restoredPrisma.$queryRawUnsafe(`
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

    const missingUniqueContracts: string[] = [];
    let verifiedContracts = 0;
    for (const req of REQUIRED_UNIQUE_CONTRACTS) {
      const match = uniqueIndexesRows.find(
        (u) =>
          u.table_name === req.table &&
          JSON.stringify(u.column_names) === JSON.stringify(req.columns)
      );
      if (match) {
        verifiedContracts++;
      } else {
        missingUniqueContracts.push(`${req.table}(${req.columns.join(", ")})`);
      }
    }
    const uniqueContractParityStatus = missingUniqueContracts.length === 0 ? "MATCH" : "MISMATCH";

    // 11. Migration History Parity
    const restoredMigrations: Array<{ migration_name: string; checksum: string; finished_at: Date | null }> =
      await restoredPrisma.$queryRawUnsafe(
        "SELECT migration_name, checksum, finished_at FROM _prisma_migrations ORDER BY started_at ASC;"
      );

    const expectedMigrationCount = manifest?.sourceMetadata.migrationRecords.length || 4;
    const restoredMigrationCount = restoredMigrations.length;
    const migrationDiscrepancies: string[] = [];

    if (expectedMigrationCount !== restoredMigrationCount) {
      migrationDiscrepancies.push(`Count mismatch: expected ${expectedMigrationCount}, got ${restoredMigrationCount}`);
    }
    for (const rm of restoredMigrations) {
      if (!rm.finished_at) {
        migrationDiscrepancies.push(`Migration '${rm.migration_name}' finished_at is null`);
      }
    }
    if (manifest?.sourceMetadata.migrationRecords) {
      for (const sm of manifest.sourceMetadata.migrationRecords) {
        const found = restoredMigrations.find((rm) => rm.migration_name === sm.migrationName);
        if (!found) {
          migrationDiscrepancies.push(`Migration '${sm.migrationName}' missing from restored history`);
        } else if (found.checksum !== sm.checksum) {
          migrationDiscrepancies.push(
            `Migration '${sm.migrationName}' checksum mismatch: expected ${sm.checksum}, got ${found.checksum}`
          );
        }
      }
    }
    const migrationParityStatus = migrationDiscrepancies.length === 0 ? "MATCH" : "MISMATCH";

    // 12. Row Counts Comparison
    const perTableCounts: Array<{ table: string; expected: number; actual: number; match: boolean }> = [];
    let totalExpectedRows = 0;
    let totalActualRows = 0;

    for (const table of expectedTables) {
      const actualRes: Array<{ count: number }> = await restoredPrisma.$queryRawUnsafe(
        `SELECT count(*)::int as count FROM "${table}";`
      );
      const actual = actualRes[0]?.count ?? -1;

      let expected = 0;
      if (manifest) {
        const found = manifest.sourceMetadata.tableRowCounts.find((rc) => rc.tableName === table);
        expected = found ? found.rowCount : -1;
      } else if (sourcePrisma) {
        const srcRes: Array<{ count: number }> = await sourcePrisma.$queryRawUnsafe(
          `SELECT count(*)::int as count FROM "${table}";`
        );
        expected = srcRes[0]?.count ?? -1;
      }

      const match = expected === actual && actual >= 0;
      perTableCounts.push({ table, expected, actual, match });

      if (table !== "_prisma_migrations") {
        totalExpectedRows += Math.max(0, expected);
        totalActualRows += Math.max(0, actual);
      }
    }

    const rowCountParityStatus = perTableCounts.every((p) => p.match) ? "MATCH" : "MISMATCH";

    // 13. Deep Record-Level Comparison & Honest Data Loss Status
    let dataLossStatus: DataParityClassification = "VERIFICATION_INCOMPLETE";

    if (rowCountParityStatus !== "MATCH" || perTableCounts.some((p) => !p.match || p.actual < 0 || p.expected < 0)) {
      dataLossStatus = "DATA_DISCREPANCY_DETECTED";
    } else if (sourcePrisma) {
      let deepMismatch = false;
      for (const table of REQUIRED_TABLES) {
        const srcRecords: any[] = await sourcePrisma.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY id ASC;`);
        const dstRecords: any[] = await restoredPrisma.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY id ASC;`);

        if (srcRecords.length !== dstRecords.length) {
          deepMismatch = true;
          break;
        }

        const srcDigest = computeDeterministicTableDigest(srcRecords);
        const dstDigest = computeDeterministicTableDigest(dstRecords);
        if (srcDigest !== dstDigest) {
          deepMismatch = true;
          break;
        }
      }

      dataLossStatus = deepMismatch ? "DATA_DISCREPANCY_DETECTED" : "VERIFIED_ZERO_DATA_LOSS";
    } else if (manifest?.sourceMetadata.tableDigests) {
      let digestMismatch = false;
      let missingDigest = false;

      for (const table of REQUIRED_TABLES) {
        const expectedDigest = manifest.sourceMetadata.tableDigests[table];
        if (!expectedDigest) {
          missingDigest = true;
          break;
        }
        const dstRecords: any[] = await restoredPrisma.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY id ASC;`);
        const dstDigest = computeDeterministicTableDigest(dstRecords);
        if (dstDigest !== expectedDigest) {
          digestMismatch = true;
          break;
        }
      }

      if (digestMismatch) {
        dataLossStatus = "DATA_DISCREPANCY_DETECTED";
      } else if (missingDigest) {
        dataLossStatus = "STRUCTURAL_AND_COUNT_PARITY_ONLY";
      } else {
        dataLossStatus = "VERIFIED_ZERO_DATA_LOSS";
      }
    } else {
      // Manifest only had counts/structural metadata, no live source and no record digests
      dataLossStatus = "STRUCTURAL_AND_COUNT_PARITY_ONLY";
    }

    // 14. Preflight Inspection Integration
    const preflightReport = await runPreflightInspection(restoreDbUrl);

    // 15. Drift Detection Integration (prisma migrate diff)
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
        env: { ...process.env, DATABASE_URL: restoreDbUrl }
      }
    );

    const schemaDriftStatus = diffRes.status === 0 ? "ZERO_DRIFT" : "DRIFT_DETECTED";

    // 16. Behavioral Verification (Uniqueness & Cascade)
    let emailUniquenessEnforced = false;
    let dailyLogUniquenessEnforced = false;
    let cascadeDeleteActive = false;

    // Test email uniqueness
    try {
      await restoredPrisma.user.create({
        data: {
          email: "behavioral.test@bushido.local",
          phoneNumber: "09990000001",
          name: "Behavior Test 1"
        }
      });
      // Duplicate insert must throw P2002
      try {
        await restoredPrisma.user.create({
          data: {
            email: "behavioral.test@bushido.local",
            phoneNumber: "09990000002",
            name: "Behavior Test 2"
          }
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          emailUniquenessEnforced = true;
        }
      }
    } catch {}

    // Test dailyLog uniqueness
    try {
      const u = await restoredPrisma.user.findFirst();
      const c = await restoredPrisma.cycle.findFirst({ where: { userId: u?.id } });
      if (u && c) {
        const testDate = "2029-12-31";
        await restoredPrisma.dailyLog.create({
          data: {
            userId: u.id,
            cycleId: c.id,
            date: testDate
          }
        });
        try {
          await restoredPrisma.dailyLog.create({
            data: {
              userId: u.id,
              cycleId: c.id,
              date: testDate
            }
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            dailyLogUniquenessEnforced = true;
          }
        }
      }
    } catch {}

    // Test Cascade Delete
    try {
      const cascadeUser = await restoredPrisma.user.create({
        data: {
          email: "cascade.test@bushido.local",
          name: "Cascade Test"
        }
      });
      const cascadeCycle = await restoredPrisma.cycle.create({
        data: {
          userId: cascadeUser.id,
          title: "Cascade Cycle",
          startDate: "2030-01-01",
          endDate: "2030-01-21"
        }
      });
      await restoredPrisma.dailyLog.create({
        data: {
          userId: cascadeUser.id,
          cycleId: cascadeCycle.id,
          date: "2030-01-01"
        }
      });

      // Delete user
      await restoredPrisma.user.delete({ where: { id: cascadeUser.id } });

      const remainingCycle = await restoredPrisma.cycle.findUnique({ where: { id: cascadeCycle.id } });
      const remainingLogs = await restoredPrisma.dailyLog.findMany({ where: { cycleId: cascadeCycle.id } });

      if (!remainingCycle && remainingLogs.length === 0) {
        cascadeDeleteActive = true;
      }
    } catch {}

    await restoredPrisma.$disconnect();
    if (sourcePrisma) {
      await sourcePrisma.$disconnect();
    }

    // Teardown
    if (!keepRestoredDb) {
      await cleanupAll();
    }

    const report: RestoreComparisonReport = {
      restoredDatabaseName: restoreDbName,
      sourceDatabaseName: manifest?.sourceDatabase.databaseName || "source_db",
      pgRestoreExitCode,
      backupArtifact: {
        path: backupPath,
        sizeBytes: actualSizeBytes,
        sha256: recalculatedSha256
      },
      artifactVerification,
      tableParity: {
        expectedTables,
        foundTables,
        missingTables,
        status: tableParityStatus
      },
      enumParity: {
        expectedEnums: [...REQUIRED_ENUMS],
        foundEnums,
        missingEnums,
        status: enumParityStatus
      },
      foreignKeyParity: {
        verifiedCascadeFks,
        missingFks,
        status: foreignKeyParityStatus
      },
      uniqueContractParity: {
        verifiedContracts,
        missingContracts: missingUniqueContracts,
        status: uniqueContractParityStatus
      },
      migrationParity: {
        expectedCount: expectedMigrationCount,
        restoredCount: restoredMigrationCount,
        migrations: restoredMigrations.map((m) => m.migration_name),
        discrepancies: migrationDiscrepancies,
        status: migrationParityStatus
      },
      rowCountParity: {
        perTable: perTableCounts,
        totalExpected: totalExpectedRows,
        totalActual: totalActualRows,
        status: rowCountParityStatus
      },
      dataLossStatus,
      preflightReport,
      schemaDriftStatus,
      behavioralVerification: {
        emailUniquenessEnforced,
        dailyLogUniquenessEnforced,
        cascadeDeleteActive
      },
      acceptance: {
        accepted: false,
        blockers: []
      }
    };

    report.acceptance = evaluateRestoreAcceptance(report);
    return report;
  } catch (err) {
    await cleanupAll();
    throw err;
  } finally {
    await maintenancePrisma.$disconnect();
  }
}

async function main() {
  const args = process.argv.slice(2);
  let maintenanceUrl = process.env.DISPOSABLE_DATABASE_URL || process.env.DATABASE_URL || "";
  let backupPath = "";
  let manifestPath = "";
  let sourceUrl = process.env.SOURCE_DATABASE_URL || "";
  let e2eMode = args.includes("--e2e");

  const urlIdx = args.indexOf("--url");
  if (urlIdx !== -1 && args[urlIdx + 1]) {
    maintenanceUrl = args[urlIdx + 1];
  }

  const backupIdx = args.indexOf("--backup");
  if (backupIdx !== -1 && args[backupIdx + 1]) {
    backupPath = args[backupIdx + 1];
  }

  const manifestIdx = args.indexOf("--manifest");
  if (manifestIdx !== -1 && args[manifestIdx + 1]) {
    manifestPath = args[manifestIdx + 1];
  }

  const sourceIdx = args.indexOf("--source-url");
  if (sourceIdx !== -1 && args[sourceIdx + 1]) {
    sourceUrl = args[sourceIdx + 1];
  }

  // If no backup passed, default to e2eMode
  if (!backupPath) {
    e2eMode = true;
  }

  console.log("================================================================");
  console.log("  PHASE 2C.2: AUTOMATED POSTGRESQL RESTORE & PARITY PROOF");
  console.log("================================================================");

  try {
    const report = await runRestoreVerification({
      maintenanceUrl,
      backupPath: backupPath || undefined,
      manifestPath: manifestPath || undefined,
      sourceDatabaseUrl: sourceUrl || undefined,
      args,
      e2eMode
    });

    console.log(`✓ Safety checks passed: Local loopback target verified.`);
    console.log(`✓ Source Database:       ${report.sourceDatabaseName}`);
    console.log(`✓ Restored Database:     ${report.restoredDatabaseName}`);
    console.log(`✓ Backup Artifact:       ${report.backupArtifact.path}`);
    console.log(`✓ SHA-256 Checksum:      ${report.backupArtifact.sha256}`);
    console.log("----------------------------------------------------------------");
    console.log(`✓ Table Parity:          ${report.tableParity.status} (${report.tableParity.foundTables.length}/${report.tableParity.expectedTables.length} tables verified)`);
    console.log(`✓ Enum Parity:           ${report.enumParity.status} (${report.enumParity.foundEnums.join(", ")})`);
    console.log(`✓ Foreign Key Parity:    ${report.foreignKeyParity.status} (${report.foreignKeyParity.verifiedCascadeFks}/5 ON DELETE CASCADE verified)`);
    console.log(`✓ Unique Contract Parity:${report.uniqueContractParity.status} (${report.uniqueContractParity.verifiedContracts}/5 unique contracts verified)`);
    console.log(`✓ Migration Parity:      ${report.migrationParity.status} (${report.migrationParity.restoredCount} migrations applied)`);
    console.log("----------------------------------------------------------------");
    console.log(`✓ Row Count Parity:      ${report.rowCountParity.status}`);
    for (const p of report.rowCountParity.perTable) {
      console.log(`    - ${p.table.padEnd(20)}: expected=${p.expected}, restored=${p.actual} [${p.match ? "OK" : "MISMATCH"}]`);
    }
    console.log(`✓ Total Rows Verified:   ${report.rowCountParity.totalActual} / ${report.rowCountParity.totalExpected}`);
    console.log(`✓ Deep Record Parity:    ${report.dataLossStatus}`);
    console.log("----------------------------------------------------------------");
    console.log(`✓ Restored Preflight:    ${report.preflightReport.assessment.status} (${report.preflightReport.assessment.classification})`);
    console.log(`✓ Preflight Blockers:    ${report.preflightReport.assessment.blockers.length}`);
    console.log(`✓ Schema Drift (diff):   ${report.schemaDriftStatus}`);
    console.log("----------------------------------------------------------------");
    console.log(`✓ Behavioral Checks:`);
    console.log(`    - Email Uniqueness (P2002):      ${report.behavioralVerification.emailUniquenessEnforced ? "ENFORCED" : "FAILED"}`);
    console.log(`    - DailyLog Uniqueness (P2002):   ${report.behavioralVerification.dailyLogUniquenessEnforced ? "ENFORCED" : "FAILED"}`);
    console.log(`    - Cascade Deletion:              ${report.behavioralVerification.cascadeDeleteActive ? "ACTIVE" : "FAILED"}`);
    // Enforce final pure acceptance gate
    assertRestoreAcceptance(report);

    console.log("================================================================");
    console.log("  BACKUP & RESTORE VERIFICATION PROOF: 100% SUCCESSFUL!");
    console.log("  ZERO DATA LOSS CONFIRMED ACROSS ALL APPLICATION RECORDS.");
    console.log("================================================================");

    process.exit(0);
  } catch (err) {
    console.error(`\n[RESTORE VERIFICATION ERROR] ${(err as Error).message}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith("restore-verify.ts")) {
  main().catch((err) => {
    console.error("Unhandled restore error:", sanitizeText(err.message));
    process.exit(1);
  });
}
