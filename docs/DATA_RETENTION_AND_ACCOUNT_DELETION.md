# Phase 2C.4: Data Retention, Account Deletion & Cascade Safety Specification

> **Document Type:** Authoritative Technical Specification & Retention Architecture  
> **Lifecycle Phase:** Phase 2C.4A (Retention & Deletion Contract Formulation)  
> **Status:** SPECIFICATION LOCKED / IMPLEMENTATION BLOCKED ON FINANCIAL DECISION  
> **Parent Roadmaps:** `RUNBOOK.md` (Section 6), `docs/reports/project-reality-report.md`, `docs/ARCHITECTURE.md`

---

## 1. Executive Summary & Verification Context

This specification establishes the authoritative, immutable contract for data retention, user lifecycle termination, account deletion, cascade safety, and client-side storage purging across Bushido Discipline OS.

### 1.1. Current Verified System State (Phase 2C.4A Baseline)
1. **No Public Account Deletion Endpoint Exists:**
   - In the current production server (`server.ts`), there is **no public API route** (e.g., `DELETE /api/users/me`, `POST /api/account/delete`, or similar) available for users to initiate account deletion.
   - The only server-side deletion invocation currently in `server.ts` is an internal registration rollback mechanism (`server.ts` line 399) used exclusively as an unfinalized-user cleanup compensation if OTP consumption fails during initial phone registration.
2. **Structural Database Cascade Relationships:**
   - In `prisma/schema.prisma`, the `User` model defines relational `onDelete: Cascade` foreign key actions to four models:
     - `Cycle` (`Cycle.userId -> User.id`, `onDelete: Cascade`)
     - `DailyLog` (`DailyLog.userId -> User.id` and `DailyLog.cycleId -> Cycle.id`, `onDelete: Cascade`)
     - `OtpCode` (`OtpCode.userId -> User.id`, `onDelete: Cascade`)
     - `Subscription` (`Subscription.userId -> User.id`, `onDelete: Cascade`)
3. **Existing Cascade Verification Is Only Structural Evidence:**
   - The cascade deletion logic tested in `scripts/restore-verify.ts` (and asserted in `tests/backup-restore-proof.test.ts`) serves strictly as **structural integrity evidence** during disposable database backup-and-restore verification.
   - It proves that PostgreSQL engine foreign-key constraints execute without constraint violations during an automated script run; it does **not** represent an end-to-end user-facing account deletion contract, reauthentication flow, session invalidation mechanism, or client storage wipe protocol.
4. **Local Client Reset Is Not Server Account Deletion:**
   - The local reset action in the frontend UI (`ResetConfirmationModal` / guest demo purge / `storageCore.clearStorage()`) operates exclusively on browser local storage (`localStorage`, `sessionStorage`, IndexedDB).
   - Local client reset does **not** notify the server, does **not** delete the `User` record in PostgreSQL, and does **not** constitute account deletion.

---

## 2. Comprehensive Data Inventory

Bushido Discipline OS processes and stores data across three primary tiers: active relational database (PostgreSQL), client browser runtime (Web/PWA/Capacitor), and operational observability/backup archives.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        BUSHIDO DATA INVENTORY                          │
├─────────────────────────┬─────────────────────────┬────────────────────┤
│ 1. Relational Database  │ 2. Client-Side Runtime  │ 3. Observability & │
│    (PostgreSQL / Prisma)│    (Browser / PWA)      │    Backup Storage  │
├─────────────────────────┼─────────────────────────┼────────────────────┤
│ • User Accounts         │ • LocalStorage Keys     │ • DB Backups (SQL) │
│ • Cycles (90-Day)       │ • SessionStorage State  │ • CI Diagnostics   │
│ • DailyLogs & Autopsies │ • Offline Mutation Q    │ • Audit Logs (PII- │
│ • OtpCodes & Challenges │ • Quarantine Buckets    │   Free Structured) │
│ • Subscriptions & Pay   │ • In-Memory Auth Tokens │ • Serverless Logs  │
└─────────────────────────┴─────────────────────────┴────────────────────┘
```

### 2.1. Tier 1: Relational Database Records (`prisma/schema.prisma`)
1. **User Identity & Authentication Data (`model User`):**
   - Unique identifiers: `id` (cuid), `email` (nullable unique string), `phoneNumber` (canonical E.164-style `09XXXXXXXXX` unique string).
   - Profile metadata: `name` (user-chosen display name, max 80 chars), `accentTheme` (visual preference), `nightOwlCutoffHour` (0..23 cutoff).
   - Security & Credentials: `passwordHash` (PBKDF2-SHA512 with 16-byte cryptographically secure random salt), `tokenVersion` (integer counter for global session revocation).
   - RBAC & Entitlements: `role` (`FREE`, `VIP`, `ADMIN`), `tier` (`ronin_free`, `vip_samurai`, `daimyo_master`), `isVip` (boolean), `vipSince` (timestamp), `vipExpiresAt` (timestamp), `paymentRefId` (string), `isAdmin` (boolean).
   - Timestamps: `createdAt`, `updatedAt`.
2. **Cycles (`model Cycle`):**
   - Identifiers & Foreign Keys: `id` (cuid), `userId` (FK to `User.id`).
   - Planning Data: `title`, `startDate` (`YYYY-MM-DD`), `endDate` (`YYYY-MM-DD`), `targetTheme`, `rules` (custom text array of rules).
   - Progress Metrics: `inheritedStreak` (integer), `isArchived` (boolean), `reportRead` (boolean), `verdict` (JSON payload containing deterministic Sensei grading, stats, and historical metrics).
   - Concurrency: `revision` (integer version counter).
   - Timestamps: `createdAt`, `updatedAt`.
3. **DailyLogs & Habit Autopsies (`model DailyLog`):**
   - Identifiers & Foreign Keys: `id` (cuid), `userId` (FK to `User.id`), `cycleId` (FK to `Cycle.id`).
   - Temporal & State: `date` (`YYYY-MM-DD`), `status` (`STANDARD`, `FROZEN`, `BURNED`), `revision` (integer version counter), `lastClientOperationId` (idempotency UUID).
   - 5 Foundation Habits: `wakeUp` (boolean), `workout` (boolean), `study` (boolean), `journal` (boolean), `hardTask` (boolean), `specialMission` (boolean).
   - Failure Autopsy & Psychological Reflection: `failureReason` (string), `failureTime` (string), `autopsyNotes` (personal text, up to 2000 chars), `countermeasure` (preventative commitment, up to 2000 chars), `aiFeedback` (deterministic Coach feedback, up to 2000 chars), `notes` (general reflection, up to 2000 chars).
   - Timestamps: `createdAt`, `updatedAt`.
4. **OTP Records & Challenges (`model OtpCode`):**
   - Identifiers & Linkage: `id` (cuid), `identifier` (phone number), `userId` (optional FK to `User.id`).
   - Verification State: `purpose` (`PHONE_REGISTRATION`, `PASSWORD_RESET`, `ACCOUNT_DELETION`), `codeHash` (SHA-256 / PBKDF2 hash of 6-digit OTP code), `expiresAt` (timestamp, 2-minute TTL), `verified` (boolean), `consumedAt` (timestamp).
   - Rate Limiting: `attempts` (integer), `maxAttempts` (default 5), `lastSentAt` (timestamp).
   - Timestamps: `createdAt`, `updatedAt`.
5. **Subscriptions & Payment Metadata (`model Subscription`):**
   - Transaction Identifiers: `id` (cuid), `userId` (FK to `User.id`), `planId` (`ronin_free`, `vip_monthly`, `vip_quarterly`, `vip_annual`).
   - Financial Audit Details: `amount` (Toman integer), `authority` (Zarinpal/gateway unique authority string), `refId` (payment gateway reference token), `cardPan` (masked card PAN, e.g., `603799******1234`), `status` (`PENDING`, `SUCCESS`, `FAILED`), `description` (invoice text), `expiresAt` (subscription entitlement expiry timestamp).
   - Timestamps: `createdAt`, `updatedAt`.

### 2.2. Tier 2: Client-Side Runtime Storage (Browser / PWA / Device)
1. **Local Storage Keys (`localStorage`):**
   - Authentication: `bushido_auth_token` (JWT string), `bushido_user_profile` (cached user profile JSON).
   - Domain Data: `bushido_cycles` (JSON array of cached cycles), `bushido_daily_logs` (JSON array of daily log entries), `bushido_active_cycle_id` (active cycle pointer).
   - Sync & Replay: `bushido_mutation_queue_${userId}` (serialized pending offline operations), `bushido_sync_state_${userId}` (last sync timestamp and revision digests), `bushido_client_op_history_${userId}` (processed client operation UUIDs).
   - Diagnostic & Tour: `bushido_tour_completed`, `bushido_first_run_acknowledged`, `bushido_sound_enabled`.
2. **Offline Mutation Queue:**
   - Queued operations containing optimistic payloads (`cycle:create`, `cycle:update`, `cycle:delete`, `log:upsert`, `log:update`) pending replay upon network reconnection.
3. **Quarantine Data:**
   - `bushido_offline_quarantine_${userId}` containing rejected, poisoned, or unresolvable mutations isolated from standard retry loops.
4. **Session & Impersonation State (`sessionStorage` & In-Memory):**
   - Active tokens in memory (`currentToken`, `impersonationAdminToken`).
   - `sessionStorage` fallback keys for impersonation context (`bushido_impersonation_context`).
   - Concurrency locks (`runtimeInFlightOperations`, `inFlightReplayPromises`).

### 2.3. Tier 3: Backups, Observability & Diagnostic Artifacts
1. **Database Backups:**
   - Full PostgreSQL logical dumps (`pg_dump` SQL/tar files) stored securely in offline/cold backup repositories for disaster recovery.
2. **CI Diagnostics & Logs:**
   - Sanitized CI diagnostic bundles (`ci-diagnostics/`) created during automated test execution with credentials and secrets masked as `[REDACTED]`.
3. **Server Audit Logs (`server/audit.ts`):**
   - Structured JSON operational events (`auth_login`, `auth_logout`, `impersonation_started`, `impersonation_exited`) containing zero PII (no names, no phone numbers, no passwords, no tokens).

---

## 3. Deletion Classification Matrix

Every data category across the application is formally classified into exactly one of four retention categories:
- **`DELETE`**: Hard-purged immediately upon confirmed account deletion.
- **`ANONYMIZE`**: Stripped of all personal identifiers and unlinked from the user.
- **`RETAIN`**: Kept intact for system integrity or backup lifecycles (contains no PII).
- **`NEEDS LEGAL DECISION`**: Blocked pending human legal/tax/accounting determination.

| Data Category | Target Store | Current Classification | Treatment Upon Account Deletion |
| :--- | :--- | :---: | :--- |
| **User Profile & Identity** (`name`, `email`, `phoneNumber`, `passwordHash`) | PostgreSQL (`User`) | **`DELETE`** | Hard-deleted atomically in database deletion transaction. |
| **Active Auth Credentials & Token Versions** (`tokenVersion`, JWTs) | PostgreSQL / Memory | **`DELETE`** | User row deletion instantly invalidates all issued JWTs (subsequent checks fail with `401 USER_NOT_FOUND`). |
| **Cycles & Target Rules** (`model Cycle`) | PostgreSQL (`Cycle`) | **`DELETE`** | Hard-deleted via database cascade. Personal goal structures are wiped completely. |
| **DailyLogs, Habits & Autopsies** (`model DailyLog`) | PostgreSQL (`DailyLog`) | **`DELETE`** | Hard-deleted via database cascade. Sensitive habit ticks and psychological failure notes are destroyed. |
| **OTP Codes & Verification Records** (`model OtpCode`) | PostgreSQL (`OtpCode`) | **`DELETE`** | Hard-deleted via database cascade. Ephemeral phone verification records are purged. |
| **Client LocalStorage & Cache** (`bushido_cycles`, `bushido_daily_logs`, etc.) | Client Browser / App | **`DELETE`** | Purged immediately by client runtime upon receiving `200 OK` from deletion endpoint. |
| **Client Offline Mutation Queue** (`bushido_mutation_queue_*`) | Client Browser / App | **`DELETE`** | Wiped cleanly to prevent dead mutations from replaying or reviving deleted accounts. |
| **Client Quarantine Data** (`bushido_offline_quarantine_*`) | Client Browser / App | **`DELETE`** | Emptied and removed from client storage. |
| **Active Session & Impersonation Tokens** (`sessionStorage`, in-memory) | Client Browser / App | **`DELETE`** | Memory cleared, storage purged, UI redirected to unauthenticated landing state. |
| **Subscriptions & Financial Payment Records** (`model Subscription`) | PostgreSQL (`Subscription`) | **`NEEDS LEGAL DECISION`** | **EXPLICIT BLOCKER:** Iranian tax/accounting law and Shaparak/Zarinpal audit rules require financial record retention. See Section 5. |
| **Operational Audit Logs** (`server/audit.ts`) | Server Log Files | **`RETAIN`** | Maintained as immutable records. Audit logs contain zero PII and are required for security auditing and abuse tracking. |
| **Cold Database Backups** (`pg_dump` snapshots) | Offline Backup Store | **`RETAIN`** | Immutable snapshots are not altered retroactively. Data in backups ages out naturally according to the backup retention schedule. |

---

## 4. Locked Technical Contracts

The technical architecture for account deletion is governed by 11 non-negotiable invariants:

### Contract 1: Server-Authoritative User Identity
- The user account to be deleted must be determined **strictly and exclusively** from the authenticated server-side session context (`req.user.userId` extracted from the cryptographically verified JWT).
- The server must never accept, rely on, or query a user ID provided in the HTTP request body, route parameters, or query string.

### Contract 2: Mandatory Reauthentication Before Destructive Deletion
- Account deletion is irreversible. The request must require fresh, explicit reauthentication in the request payload:
  - For password-authenticated users: the valid `currentPassword`.
  - For phone/OTP-authenticated users: an active, pre-verified OTP challenge token (`challengeId`) specifically authorized for purpose `ACCOUNT_DELETION`.
- Requests lacking valid reauthentication credentials must fail immediately with `401 INVALID_CREDENTIALS` or `400 REAUTHENTICATION_REQUIRED`.

### Contract 3: No Client-Supplied Target userId
- The deletion endpoint contract accepts only credentials (`password` or `challengeId`).
- Any attempt to supply a `targetUserId` or `userId` in the payload must be rejected or strictly ignored by Zod schema validation (`strip` / `strict`).

### Contract 4: Impersonated Sessions Cannot Delete Accounts
- Administrative impersonation sessions (`req.user.isImpersonated === true`) are strictly forbidden from initiating account deletion.
- If an admin is impersonating a user and attempts to delete the account, the server must reject the request with HTTP `403 FORBIDDEN` and error code `IMPERSONATION_DELETION_FORBIDDEN`. Support agents cannot destroy user accounts while impersonating them.

### Contract 5: Super-Admin Account Cannot Self-Delete Through Public Route
- System Super-Admin accounts (`user.isAdmin === true` or user matching `SUPER_ADMIN_PHONE` / `SUPER_ADMIN_EMAIL`) cannot be deleted through the public user deletion endpoint.
- Any deletion attempt targeting a protected administrative account must return HTTP `403 FORBIDDEN` with error code `ADMIN_DELETION_PROHIBITED`.

### Contract 6: Database Failure Must Fail Closed
- If any database constraint fails, network connection drops, or a database error occurs during the deletion process, the operation must abort completely.
- The transaction must roll back, leaving zero orphaned rows and making no partial changes.
- The server must return HTTP `500 INTERNAL_SERVER_ERROR` with code `DELETION_FAILED_CLOSED` and must **never** report false success.

### Contract 7: Deletion Must Be Atomic
- All database deletions (User record, child cycles, daily logs, OTP codes, and subscription records per policy) must execute within a single isolated database transaction (`prisma.$transaction`).
- Either the entire account graph is purged, or nothing is changed.

### Contract 8: Immediate Invalidation of All Sessions
- Once the `User` row is deleted from PostgreSQL:
  - All issued JWT bearer tokens for that user immediately become un-resolvable on subsequent requests because `getUserById(userId)` returns `null`.
  - Subsequent API requests fail with `401 USER_NOT_FOUND` / `SESSION_REVOKED`.

### Contract 9: Mandatory Client Storage Purge Upon Success
- Upon receiving HTTP `200 OK` from the server deletion route, the client runtime must synchronously execute a complete storage wipe:
  - Remove all `localStorage` keys matching `bushido_*`.
  - Clear `sessionStorage`.
  - Terminate all active sync timers, background pollers, and offline queue watchers.
  - Reset client state to guest baseline and redirect to the unauthenticated onboarding view.

### Contract 10: Anti-Resurrection & Offline Replay Prevention
- Stale offline mutations waiting in indexed/local queues for a deleted account must never be permitted to recreate cycles or daily logs.
- When an offline queue worker encounters `401 USER_NOT_FOUND` or `404 NOT_FOUND` indicating account deletion, the queue engine must permanently prune and purge the pending mutation queue for that user rather than continuously retrying or resurrecting data.

### Contract 11: Safe & Deterministic Retries (Idempotency)
- If a client initiates account deletion, the server succeeds, but the network connection drops before the client receives the HTTP 200 response:
  - A subsequent retry will present credentials for a user that no longer exists in the database.
  - The server must return HTTP `404 USER_NOT_FOUND` or `401 INVALID_CREDENTIALS` indicating the account is absent.
  - The client must recognize this terminal state, conclude the account no longer exists, and safely trigger the local storage wipe.

---

## 5. Explicit Blocker: Financial & Subscription Retention Legal Decision

> 🛑 **HARD ARCHITECTURAL BLOCKER — DO NOT MODIFY PRISMA CASCADE YET**

### 5.1. Nature of the Blocker
- In the current schema (`prisma/schema.prisma`), `Subscription` is configured with `onDelete: Cascade`.
- If a user account is deleted in PostgreSQL today, all associated `Subscription` rows (including payment `amount`, `authority`, `refId`, `cardPan`, `status`, and `createdAt` timestamps) are automatically and irreversibly destroyed by PostgreSQL foreign key cascade.
- **Why this is blocked:**
  1. **Tax & Financial Compliance:** Under Iranian Electronic Commerce Law and standard financial accounting standards, commercial platforms are required to retain financial transaction records and invoice references for a statutory minimum period (typically 5 to 10 years) for tax audits and financial reconciliation.
  2. **Payment Gateway (Zarinpal / Shaparak) Auditability:** In the event of a payment dispute, chargeback, or judicial inquiry regarding transaction `authority` / `refId`, deleting the financial record removes the sole audit trail linking the transaction to the platform.
  3. **Data Protection vs. Financial Retention Tension:** General data protection principles (Right to Erasure / Account Deletion) require deleting personal data, but almost universally grant exceptions for compliance with legal financial retention obligations.

### 5.2. Required Human Decision
A formal human policy decision is required from project leadership and legal/accounting advisors on the following questions:

```
[DECISION REQUIRED FROM HUMAN STAKEHOLDERS]
1. Financial Retention Period:
   Should Subscription records be retained for 5 years, 10 years, or deleted immediately?
   
2. Data Treatment Strategy upon Account Deletion:
   Option A: Anonymization (Set User.name, email, phone to null, retain User skeleton + Subscription).
   Option B: Soft-Delete (Mark User.isDeleted = true, anonymize PII, retain relational integrity).
   Option C: Unlinked Archive (Move Subscription.userId to null / SetNull onDelete, keeping financial log unlinked).
   Option D: Hard Cascade Deletion (Retain current onDelete: Cascade, destroying financial history).
```

### 5.3. Invariant While Decision Is Pending
- **No engineer or AI agent may guess or invent this retention policy.**
- **The current `onDelete: Cascade` relation on `Subscription` in `prisma/schema.prisma` must remain completely untouched until this formal decision is documented and approved.**
- Phase 2C.4A is completed as a specification. Implementation phases (2C.4B through 2C.4D) will execute according to the locked technical contracts once this blocker is resolved.

---

## 6. Acceptance Criteria for Future Phases

### 6.1. Phase 2C.4B: Server Deletion Transaction
- [ ] Implement secure endpoint (`POST /api/account/delete` or `DELETE /api/account`) protected by `authMiddleware`.
- [ ] Enforce Zod validation requiring valid reauthentication payload (current password or verified OTP challenge ID).
- [ ] Enforce security checks: reject impersonated sessions (`403 IMPERSONATION_DELETION_FORBIDDEN`) and reject super-admin self-deletion (`403 ADMIN_DELETION_PROHIBITED`).
- [ ] Execute deletion within an atomic `prisma.$transaction`.
- [ ] Emit structured PII-free audit log entry (`account_deleted`, `userId`, `timestamp`).
- [ ] Implement unit and integration tests verifying:
  - Reauthentication validation (rejection of bad password / missing OTP).
  - Impersonation block.
  - Admin self-deletion block.
  - Transactional rollback on injected database error.
  - Immediate 401 on subsequent requests with pre-existing JWT.

### 6.2. Phase 2C.4C: Client Purge and Replay Prevention
- [ ] Implement client-side account deletion workflow in profile settings (`ProfileSettingsView.tsx` / `AuthModal.tsx`).
- [ ] Implement `purgeAccountState()` utility wiping all `localStorage` keys, `sessionStorage`, and runtime memory.
- [ ] Update offline sync queue processor (`offlineQueueUtils.ts`, `syncOrchestrator.ts`) to handle terminal `401 USER_NOT_FOUND` by permanently dropping pending mutations for deleted users.
- [ ] Add tests verifying that pending offline mutations cannot recreate deleted cycles or daily logs.

### 6.3. Phase 2C.4D: End-to-End Deletion & Cascade Proof
- [ ] Construct automated end-to-end integration test verifying the full lifecycle:
  1. Register fresh user via phone/OTP.
  2. Create 90-day cycle and log multiple daily habit entries with autopsy notes.
  3. Create subscription record.
  4. Perform account deletion with valid reauthentication.
  5. Assert database records for User, Cycle, DailyLog, and OtpCode are zero.
  6. Assert client local storage is completely purged.
  7. Attempt offline replay against deleted account and assert zero data resurrection.
  8. Assert zero orphaned foreign rows in PostgreSQL database.

---

## 7. Canonical Roadmap Alignment

This specification preserves the canonical engineering roadmap established in `RUNBOOK.md` and `docs/reports/project-reality-report.md`. No later phases are altered or redefined.

| Roadmap Phase | Title | Status | Scope / Deliverable |
| :--- | :--- | :---: | :--- |
| **Phase 2C.1** | Migration Integrity & Fresh Database Bootstrap | **CLOSED** | Preflight assessment, disposable database migration verification. |
| **Phase 2C.2** | Backup, Restore & Recovery Proof | **CLOSED** | Fail-closed backup and restore verification with zero data loss proof. |
| **Phase 2C.3** | CI Quality Gates & Protected Main | **CLOSED** | Authoritative CI pipeline hardened; Protected Main DEFERRED for direct-push compatibility. |
| **Phase 2C.4** | Data Retention, Account Deletion & Cascade Safety | **CLOSED FOR CURRENT SCOPE** | **Phase 2C.4A CLOSED** (Specification locked in this document). Phases 2C.4B-D pending financial retention decision. |
| **Phase 2C.5** | Operational Failure Injection | **CLOSED** | 15 core operational failure invariants audited, verified, and locked. |
| **Phase 2C.6** | Dependency and Supply-Chain Hardening | **IN PROGRESS** | Supply-chain and dependency hardening in progress pending GitHub Actions and Copilot acceptance. |
| **Phase 2D** | Architecture Decomposition & Maintainability | **NOT STARTED** | God-file decomposition (`src/App.tsx`, `server.ts`, `BattlefieldView.tsx`). |
