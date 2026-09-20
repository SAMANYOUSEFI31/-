/**
 * scripts/preflight-assessment.ts
 *
 * Phase 2C.1: Pure Fail-Closed Preflight & Baseline Adoption Assessment Engine
 *
 * This pure module evaluates database state, migration history, schema integrity,
 * and schema drift to produce fail-closed classifications:
 *
 * - ALREADY_BASELINED: Only when baseline and all incrementals are finished cleanly,
 *   all structural objects (tables, enums, columns, FKs, unique contracts) exist,
 *   and real database drift is ZERO_DRIFT.
 * - APPLICABLE: Only when baseline is absent, all structural objects exist,
 *   migration history is internally consistent with no failed/unfinished records,
 *   and real database drift is ZERO_DRIFT.
 * - FRESH_DATABASE: When database is empty (no tables/enums, no migrations).
 * - BLOCKED: In all other cases (drift, missing objects, missing incrementals,
 *   failed/unfinished migrations, execution errors).
 */

export interface MigrationRecord {
  id: string;
  checksum: string;
  migrationName: string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  rolledBackAt: Date | string | null;
  appliedSteps: number;
  logs: string | null;
}

export interface ForeignKeyContract {
  table: string;
  column: string;
  foreignTable: string;
  foreignColumn: string;
  deleteRule: string;
}

export interface UniqueContract {
  table: string;
  columns: string[];
}

export type DriftStatus = "ZERO_DRIFT" | "DRIFT_DETECTED" | "VERIFICATION_ERROR";

export interface DriftReport {
  status: DriftStatus;
  summary: string;
}

export interface SchemaObjectsReport {
  tables: string[];
  enums: string[];
  columns: Array<{ table: string; column: string }>;
  foreignKeys: ForeignKeyContract[];
  uniqueIndexes: Array<{ table: string; columns: string[] }>;
}

export interface PreflightAssessmentInput {
  migrationsTableExists: boolean;
  migrationRecords: MigrationRecord[];
  schemaObjects: SchemaObjectsReport;
  drift: DriftReport;
}

export type AssessmentStatus = "ALREADY_BASELINED" | "APPLICABLE" | "FRESH_DATABASE" | "BLOCKED";

export type DatabaseClassification =
  | "LEGACY_COMPLETE_UNBASELINED"
  | "FRESH_EMPTY"
  | "PARTIALLY_MIGRATED"
  | "FULLY_MIGRATED"
  | "DRIFTED"
  | "FAILED_OR_UNFINISHED_HISTORY";

export interface PreflightAssessmentResult {
  status: AssessmentStatus;
  applicable: boolean;
  classification: DatabaseClassification;
  reasons: string[];
  blockers: string[];
  recommendedAction: string;
  humanReviewRequired: boolean;
  details: {
    missingTables: string[];
    missingEnums: string[];
    missingColumns: string[];
    missingForeignKeys: string[];
    missingUniqueContracts: string[];
    missingIncrementals: string[];
    failedOrUnfinishedMigrations: string[];
  };
}

export const REQUIRED_TABLES = [
  "User",
  "Cycle",
  "DailyLog",
  "OtpCode",
  "Subscription"
] as const;

export const REQUIRED_ENUMS = [
  "UserRole",
  "UserTier",
  "DayStatus",
  "SubscriptionStatus"
] as const;

export const REQUIRED_CRITICAL_COLUMNS = [
  { table: "User", column: "tokenVersion" },
  { table: "Cycle", column: "revision" },
  { table: "DailyLog", column: "revision" },
  { table: "DailyLog", column: "lastClientOperationId" },
  { table: "OtpCode", column: "purpose" },
  { table: "OtpCode", column: "codeHash" },
  { table: "Subscription", column: "authority" }
] as const;

export const REQUIRED_FOREIGN_KEYS: ForeignKeyContract[] = [
  { table: "Cycle", column: "userId", foreignTable: "User", foreignColumn: "id", deleteRule: "CASCADE" },
  { table: "DailyLog", column: "userId", foreignTable: "User", foreignColumn: "id", deleteRule: "CASCADE" },
  { table: "DailyLog", column: "cycleId", foreignTable: "Cycle", foreignColumn: "id", deleteRule: "CASCADE" },
  { table: "OtpCode", column: "userId", foreignTable: "User", foreignColumn: "id", deleteRule: "CASCADE" },
  { table: "Subscription", column: "userId", foreignTable: "User", foreignColumn: "id", deleteRule: "CASCADE" }
];

export const REQUIRED_UNIQUE_CONTRACTS: UniqueContract[] = [
  { table: "User", columns: ["email"] },
  { table: "User", columns: ["phoneNumber"] },
  { table: "DailyLog", columns: ["cycleId", "date"] },
  { table: "DailyLog", columns: ["userId", "date"] },
  { table: "Subscription", columns: ["authority"] }
];

export const BASELINE_MIGRATION = "20260901_initial_baseline";

export const EXPECTED_INCREMENTAL_MIGRATIONS = [
  "20260903_phase2b_otp_persistence",
  "20260905_phase4_concurrency_tokens",
  "20260905_phase4b_durable_idempotency"
];

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Pure evaluation of the preflight assessment inputs.
 */
export function evaluatePreflightAssessment(input: PreflightAssessmentInput): PreflightAssessmentResult {
  const { migrationsTableExists, migrationRecords, schemaObjects, drift } = input;

  const blockers: string[] = [];
  const reasons: string[] = [];

  // 1. Inspect migration history for failed / unfinished / rolled-back migrations
  const failedOrUnfinishedMigrations: string[] = [];
  for (const m of migrationRecords) {
    const isUnfinished = m.finishedAt === null;
    const isRolledBack = m.rolledBackAt !== null;
    const isZeroSteps = m.appliedSteps === 0;
    const hasErrorLogs = m.logs !== null && m.logs.trim().length > 0;

    if (isUnfinished || isRolledBack || isZeroSteps || hasErrorLogs) {
      const issues: string[] = [];
      if (isUnfinished) issues.push("unfinished (finishedAt is null)");
      if (isRolledBack) issues.push("rolled back (rolledBackAt is set)");
      if (isZeroSteps) issues.push("zero applied steps");
      if (hasErrorLogs) issues.push("error logs present");
      failedOrUnfinishedMigrations.push(`${m.migrationName} [${issues.join(", ")}]`);
    }
  }

  // 2. Check baseline and incremental presence in migration records
  const baselineRecord = migrationRecords.find(
    (m) => m.migrationName === BASELINE_MIGRATION && m.finishedAt !== null && m.rolledBackAt === null
  );
  const initialBaselineRecorded = Boolean(baselineRecord);

  const missingIncrementals: string[] = [];
  for (const inc of EXPECTED_INCREMENTAL_MIGRATIONS) {
    const record = migrationRecords.find(
      (m) => m.migrationName === inc && m.finishedAt !== null && m.rolledBackAt === null && m.appliedSteps > 0
    );
    if (!record) {
      missingIncrementals.push(inc);
    }
  }

  // 3. Inspect structural tables
  const existingTableSet = new Set(schemaObjects.tables);
  const missingTables = REQUIRED_TABLES.filter((t) => !existingTableSet.has(t));

  // 4. Inspect structural enums
  const existingEnumSet = new Set(schemaObjects.enums);
  const missingEnums = REQUIRED_ENUMS.filter((e) => !existingEnumSet.has(e));

  // 5. Inspect critical columns
  const missingColumns: string[] = [];
  for (const col of REQUIRED_CRITICAL_COLUMNS) {
    const found = schemaObjects.columns.some(
      (c) => c.table === col.table && c.column === col.column
    );
    if (!found) {
      missingColumns.push(`${col.table}.${col.column}`);
    }
  }

  // 6. Inspect foreign keys
  const missingForeignKeys: string[] = [];
  for (const reqFk of REQUIRED_FOREIGN_KEYS) {
    const found = schemaObjects.foreignKeys.some(
      (fk) =>
        fk.table === reqFk.table &&
        fk.column === reqFk.column &&
        fk.foreignTable === reqFk.foreignTable &&
        fk.foreignColumn === reqFk.foreignColumn &&
        fk.deleteRule === reqFk.deleteRule
    );
    if (!found) {
      missingForeignKeys.push(
        `${reqFk.table}.${reqFk.column} -> ${reqFk.foreignTable}.${reqFk.foreignColumn} [${reqFk.deleteRule}]`
      );
    }
  }

  // 7. Inspect unique contracts (exact table and ordered column set)
  const missingUniqueContracts: string[] = [];
  for (const reqUq of REQUIRED_UNIQUE_CONTRACTS) {
    const found = schemaObjects.uniqueIndexes.some(
      (u) => u.table === reqUq.table && arraysEqual(u.columns, reqUq.columns)
    );
    if (!found) {
      missingUniqueContracts.push(`${reqUq.table}(${reqUq.columns.join(", ")})`);
    }
  }

  const structuralComplete =
    missingTables.length === 0 &&
    missingEnums.length === 0 &&
    missingColumns.length === 0 &&
    missingForeignKeys.length === 0 &&
    missingUniqueContracts.length === 0;

  const isZeroDrift = drift.status === "ZERO_DRIFT";

  // Check for Empty/Fresh Database
  const userTablesCount = schemaObjects.tables.filter((t) => t !== "_prisma_migrations").length;
  const isFreshDatabase =
    userTablesCount === 0 &&
    schemaObjects.enums.length === 0 &&
    (!migrationsTableExists || migrationRecords.length === 0);

  if (isFreshDatabase) {
    return {
      status: "FRESH_DATABASE",
      applicable: false,
      classification: "FRESH_EMPTY",
      reasons: [
        "Database contains zero application tables and no migration history.",
        "Baseline adoption is not applicable to a fresh database."
      ],
      blockers: [],
      recommendedAction:
        "Database is fresh and empty. Run 'npm run db:migrate:deploy' to apply all migrations and initialize schema from scratch.",
      humanReviewRequired: false,
      details: {
        missingTables,
        missingEnums,
        missingColumns,
        missingForeignKeys,
        missingUniqueContracts,
        missingIncrementals,
        failedOrUnfinishedMigrations
      }
    };
  }

  // Check for failed or unfinished migrations
  if (failedOrUnfinishedMigrations.length > 0) {
    blockers.push(`Failed or unfinished migrations detected: ${failedOrUnfinishedMigrations.join("; ")}`);
  }

  // Check schema drift
  if (drift.status === "DRIFT_DETECTED") {
    blockers.push(`Schema drift detected between actual database and prisma/schema.prisma: ${drift.summary}`);
  } else if (drift.status === "VERIFICATION_ERROR") {
    blockers.push(`Prisma migrate diff verification error: ${drift.summary}`);
  }

  // Check structural discrepancies
  if (missingTables.length > 0) {
    blockers.push(`Missing required tables: ${missingTables.join(", ")}`);
  }
  if (missingEnums.length > 0) {
    blockers.push(`Missing required enums: ${missingEnums.join(", ")}`);
  }
  if (missingColumns.length > 0) {
    blockers.push(`Missing critical columns: ${missingColumns.join(", ")}`);
  }
  if (missingForeignKeys.length > 0) {
    blockers.push(`Missing or non-CASCADE foreign keys: ${missingForeignKeys.join(", ")}`);
  }
  if (missingUniqueContracts.length > 0) {
    blockers.push(`Missing or mismatched unique contracts: ${missingUniqueContracts.join(", ")}`);
  }

  // Determine Classification and Outcome
  let status: AssessmentStatus = "BLOCKED";
  let classification: DatabaseClassification = "PARTIALLY_MIGRATED";
  let applicable = false;
  let recommendedAction = "";

  if (initialBaselineRecorded) {
    if (missingIncrementals.length > 0) {
      blockers.push(`Missing expected incremental migrations: ${missingIncrementals.join(", ")}`);
    }

    if (blockers.length === 0 && structuralComplete && isZeroDrift && missingIncrementals.length === 0) {
      status = "ALREADY_BASELINED";
      classification = "FULLY_MIGRATED";
      applicable = false;
      reasons.push(
        "Initial baseline migration and all incremental migrations are recorded and finished cleanly.",
        "Target database schema exactly matches prisma/schema.prisma with zero drift.",
        "All required tables, enums, critical columns, unique contracts, and CASCADE foreign keys are verified."
      );
      recommendedAction =
        "Database is fully baselined and migrated. No baseline adoption required. Run 'npm run db:migrate:deploy' if any future migrations are pending.";
    } else {
      status = "BLOCKED";
      if (drift.status === "DRIFT_DETECTED" || drift.status === "VERIFICATION_ERROR") {
        classification = "DRIFTED";
      } else if (failedOrUnfinishedMigrations.length > 0) {
        classification = "FAILED_OR_UNFINISHED_HISTORY";
      } else {
        classification = "PARTIALLY_MIGRATED";
      }
      applicable = false;
      reasons.push(
        "Baseline migration is recorded, but schema or migration integrity conditions are violated."
      );
      recommendedAction =
        "BLOCKED: Migration history indicates baseline is recorded, but integrity violations exist. Both 'migrate deploy' and 'migrate resolve' are strictly prohibited until discrepancies are investigated and resolved.";
    }
  } else {
    // Baseline is NOT recorded
    if (blockers.length === 0 && structuralComplete && isZeroDrift && failedOrUnfinishedMigrations.length === 0) {
      status = "APPLICABLE";
      classification = "LEGACY_COMPLETE_UNBASELINED";
      applicable = true;
      reasons.push(
        "Target database contains complete schema matching prisma/schema.prisma with zero drift.",
        "Initial baseline migration (20260901_initial_baseline) is not yet recorded in _prisma_migrations.",
        "All tables, enums, critical columns, unique contracts, and CASCADE foreign keys are intact with no failed migrations."
      );
      recommendedAction =
        "BASELINE ADOPTION APPLICABLE: Operator must take verified restorable backup, complete human review, and manually execute: 'npx prisma migrate resolve --applied 20260901_initial_baseline', followed by 'npm run db:migrate:deploy'.";
    } else {
      status = "BLOCKED";
      if (drift.status === "DRIFT_DETECTED" || drift.status === "VERIFICATION_ERROR") {
        classification = "DRIFTED";
      } else if (failedOrUnfinishedMigrations.length > 0) {
        classification = "FAILED_OR_UNFINISHED_HISTORY";
      } else {
        classification = "PARTIALLY_MIGRATED";
      }
      applicable = false;
      reasons.push(
        "Baseline migration is absent and database schema is incomplete, drifted, or contains failed migration history."
      );
      recommendedAction =
        "BLOCKED: Baseline adoption CANNOT be performed automatically. Schema or migration discrepancies must be investigated and resolved first. Prohibit 'migrate resolve'.";
    }
  }

  return {
    status,
    applicable,
    classification,
    reasons,
    blockers,
    recommendedAction,
    humanReviewRequired: status !== "FRESH_DATABASE",
    details: {
      missingTables,
      missingEnums,
      missingColumns,
      missingForeignKeys,
      missingUniqueContracts,
      missingIncrementals,
      failedOrUnfinishedMigrations
    }
  };
}
