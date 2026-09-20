# Project Reality Report

## Status Block

- **Document status**: Working Snapshot [Reported deployment context]
- **Purpose**: Descriptive extraction of the observed repository state [Reported deployment context]
- **Authority**: Non-normative and subject to independent audit [Reported deployment context]
- **Evidence boundary**: Claims must be traceable to repository files or captured command output [Reported deployment context]
- **Last reviewed commit**: `not-a-git-repo` (Git metadata directory `.git` is absent in working container) [Verified from captured command output]
- *Notice*: This document is a descriptive working snapshot and is not a formal audit, roadmap, implementation plan, or normative source of truth.

---

## Evidence Quality System

The assertions and statements in this report use the following evidence classifications:

- **[Verified from code]**: Extracted directly from committed source code files (`.ts`, `.tsx`, `.js`, etc.).
- **[Verified from committed configuration]**: Derived directly from committed configuration manifests (`package.json`, `tsconfig.json`, `prisma/schema.prisma`, `vercel.json`, `capacitor.config.json`, `.env.example`).
- **[Verified from captured command output]**: Direct output and exit code obtained from executing a command in the environment during this session.
- **[Reported deployment context]**: Operational, infrastructure, or environmental context reported for the current project phase.
- **[Unverified]**: A claim or assumption not directly demonstrated by code, configuration, or captured tool execution.
- **[Contradictory]**: Conflicting statements or diverging implementations discovered across files or environments.

---

## 1. Tech Stack

- **Runtime Environment**:
  - Required Node.js version: Not explicitly pinned in the repository (no `engines` declaration in `package.json`) [Verified from committed configuration]
  - Observed agent runtime: `v22.23.2` via `node -v` (Exit code: `0`) [Verified from captured command output]
- **Frontend Framework**: React 19 (`react@19.0.1`, `react-dom@19.0.1`) [Verified from committed configuration]
- **Language**: TypeScript (`typescript@~5.8.2`) [Verified from committed configuration]
- **Frontend Build Tool**: Vite 6 (`vite@^6.2.3`), `@vitejs/plugin-react@^4.3.4` [Verified from committed configuration]
- **Backend Bundler**: esbuild (`esbuild@^0.25.0`) targeting Node.js CommonJS (`dist/server.cjs`) [Verified from committed configuration]
- **Styling & CSS**: Tailwind CSS v4 (`tailwindcss@^4.0.0`, `@tailwindcss/vite@^4.0.0`, `autoprefixer@^10.4.21`) and CSS design tokens (`src/styles/tokens.css`) [Verified from committed configuration]
- **UI & Iconography**: Lucide React (`lucide-react@^0.546.0`) [Verified from committed configuration]
- **Motion & Animations**: Motion (`motion@^12.23.24`) [Verified from committed configuration]
- **Server Framework**: Express 4 (`express@^4.21.2`, `@types/express@^4.17.21`) [Verified from committed configuration]
- **Server Runner**: tsx (`tsx@^4.21.0`) for development execution [Verified from committed configuration]
- **Database ORM**: Prisma ORM (`prisma@6.4.0`, `@prisma/client@6.4.0`) [Verified from committed configuration]
- **Database Target Engine**: PostgreSQL configured via `provider = "postgresql"` in `prisma/schema.prisma` [Verified from committed configuration]
- **Validation Library**: Zod (`zod@^3.24.2`) [Verified from committed configuration]
- **Security & Cryptography**: jsonwebtoken (`jsonwebtoken@^9.0.2`), Node.js native `crypto` module (PBKDF2 SHA-512, timingSafeEqual, createHmac SHA-256) [Verified from committed configuration] [Verified from code]
- **Environment Configuration**: dotenv (`dotenv@^17.2.3`) [Verified from committed configuration]
- **Client Routing**: Custom zero-dependency HTML5 History API router (`src/app/routing/routerUtils.ts`) [Verified from code]
- **PWA Capabilities**: Service Worker (`public/sw.js`), Web App Manifest (`public/manifest.json`), install banner components [Verified from code]
- **Hybrid Mobile Configuration**: Capacitor (`capacitor.config.json`), GitHub Actions Android APK pipeline (`.github/workflows/build-apk.yml`) [Verified from committed configuration]
- **Serverless Hosting Adapter**: Vercel serverless entry point (`api/index.js`, `vercel.json`) [Verified from committed configuration]
- **Test Runner**: Node.js built-in test runner executed via `tsx --test "tests/**/*.test.ts"` [Verified from committed configuration]

---

## 2. Folder Structure

Extracted from the repository filesystem [Verified from code]:

```
/
├── .env.example
├── .github/
│   └── workflows/
│       └── build-apk.yml
├── .gitignore
├── ADMIN_METRICS_AND_LOGIC.md
├── AGENTS.md
├── BENCHMARKS.md
├── BUSINESS_LOGIC_AND_ENGINE.md
├── COPYWRITING_AND_MICROCOPY_CATALOG.md
├── DESIGN_SYSTEM.md
├── README.md
├── RUNBOOK.md
├── SECURITY.md
├── USER_JOURNEY_AND_UX.md
├── api/
│   ├── .gitkeep
│   └── index.js
├── capacitor.config.json
├── docs/
│   ├── A11Y_U1_U5_STATUS.md
│   ├── API_ROUTING.md
│   ├── ARCHITECTURE.md
│   ├── MASTER_TOKENIZATION_AND_STATE_AUDIT.md
│   ├── TOKEN_INVENTORY_BATTLEFIELD.md
│   ├── TOKEN_RESIDUAL.md
│   └── reports/
│       └── project-reality-report.md
├── index.html
├── metadata.json
├── package.json
├── patch.js
├── prisma/
│   ├── migrations/
│   │   ├── 20260903_phase2b_otp_persistence/
│   │   ├── 20260905_phase4_concurrency_tokens/
│   │   └── 20260905_phase4b_durable_idempotency/
│   └── schema.prisma
├── public/
│   ├── favicon.svg
│   ├── icon-192.png
│   ├── icon-192.svg
│   ├── icon-512.png
│   ├── icon-512.svg
│   ├── icon-maskable.svg
│   ├── manifest.json
│   └── sw.js
├── server/
│   ├── audit.ts
│   ├── auth.ts
│   ├── db/
│   │   ├── base.ts
│   │   ├── cycles.ts
│   │   ├── index.ts
│   │   ├── logs.ts
│   │   ├── otp.ts
│   │   ├── subscriptions.ts
│   │   └── users.ts
│   ├── middleware/
│   │   └── security.ts
│   ├── otp/
│   │   └── index.ts
│   ├── payment/
│   │   ├── adapter.ts
│   │   ├── index.ts
│   │   ├── renewal.ts
│   │   ├── transitions.ts
│   │   └── types.ts
│   ├── plans.ts
│   ├── security.ts
│   ├── sms/
│   │   └── index.ts
│   └── utils/
│       ├── phone.ts
│       └── validation.ts
├── server.ts
├── src/
│   ├── App.tsx
│   ├── app/
│   │   └── routing/
│   │       ├── authTabNavigation.ts
│   │       └── routerUtils.ts
│   ├── components/
│   │   ├── AdminView.tsx
│   │   ├── ArchivesView.tsx
│   │   ├── AuthModal.tsx
│   │   ├── AutopsyModal.tsx
│   │   ├── BattlefieldView.tsx
│   │   ├── BushidoCourtView.tsx
│   │   ├── ChartLoadingFallback.tsx
│   │   ├── CompactEmptyCycleState.tsx
│   │   ├── CreateCycleModal.tsx
│   │   ├── CycleDashboardView.tsx
│   │   ├── DatabaseView.tsx
│   │   ├── DisciplineRulesModal.tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── FirstRunTour.tsx
│   │   ├── HabitFidelityMatrix.tsx
│   │   ├── Navbar.tsx
│   │   ├── OnboardingWelcomeView.tsx
│   │   ├── PaymentModal.tsx
│   │   ├── ProfileSettingsView.tsx
│   │   ├── ResetConfirmationModal.tsx
│   │   ├── ResponsiveSubTabBar.tsx
│   │   ├── SenseiView.tsx
│   │   ├── TacticalHeatmap90.tsx
│   │   ├── Toast.tsx
│   │   └── ViewLoadingSkeleton.tsx
│   ├── config/
│   │   └── plans.ts
│   ├── context/
│   │   └── BushidoContext.tsx
│   ├── data/
│   │   ├── initialData.ts
│   │   └── moreTabData.ts
│   ├── engine/
│   │   ├── bushidoCalculations.ts
│   │   └── deterministicSensei.ts
│   ├── features/
│   │   ├── admin/
│   │   │   └── AdminView.tsx
│   │   ├── archives/
│   │   │   └── ArchivesView.tsx
│   │   ├── auth/
│   │   │   └── AuthModal.tsx
│   │   ├── autopsy/
│   │   │   ├── AutopsyModal.tsx
│   │   │   └── debtAutopsyUtils.ts
│   │   ├── battlefield/
│   │   │   └── BattlefieldView.tsx
│   │   ├── court/
│   │   │   ├── BushidoCourtView.tsx
│   │   │   └── DisciplineRulesModal.tsx
│   │   ├── cycles/
│   │   │   ├── CompactEmptyCycleState.tsx
│   │   │   ├── CreateCycleModal.tsx
│   │   │   └── ResetConfirmationModal.tsx
│   │   ├── dashboard/
│   │   │   └── CycleDashboardView.tsx
│   │   ├── payment/
│   │   │   ├── PaymentModal.tsx
│   │   │   └── paymentValidation.ts
│   │   ├── profile/
│   │   │   └── ProfileSettingsView.tsx
│   │   └── tour/
│   │       ├── FirstRunTour.tsx
│   │       └── OnboardingWelcomeView.tsx
│   ├── index.css
│   ├── main.tsx
│   ├── shared/
│   │   ├── components/
│   │   │   ├── charts/
│   │   │   │   ├── ChartLoadingFallback.tsx
│   │   │   │   ├── HabitFidelityMatrix.tsx
│   │   │   │   ├── TacticalHeatmap90.tsx
│   │   │   │   └── TrendCurvedChart.tsx
│   │   │   ├── feedback/
│   │   │   │   ├── ErrorBoundary.tsx
│   │   │   │   ├── Toast.tsx
│   │   │   │   └── ViewLoadingSkeleton.tsx
│   │   │   ├── index.ts
│   │   │   ├── layout/
│   │   │   │   ├── Navbar.tsx
│   │   │   │   └── ResponsiveSubTabBar.tsx
│   │   │   └── pwa/
│   │   │       ├── IosInstallTip.tsx
│   │   │       └── PwaInstallBanner.tsx
│   │   ├── hooks/
│   │   │   ├── useBodyScrollLock.ts
│   │   │   └── useModalAccessibility.ts
│   │   └── utils/
│   │       ├── dateUtils.ts
│   │       ├── numberUtils.ts
│   │       └── themeUtils.ts
│   ├── styles/
│   │   └── tokens.css
│   ├── sync/
│   │   ├── directMutationUtils.ts
│   │   ├── impersonationUtils.ts
│   │   ├── offlineQueueUtils.ts
│   │   ├── storageCore.ts
│   │   ├── storageUtils.ts
│   │   ├── syncDiagnostics.ts
│   │   ├── syncOrchestrator.ts
│   │   ├── syncReconciliation.ts
│   │   └── visibilitySyncUtils.ts
│   ├── types.ts
│   ├── utils/
│   │   ├── audioEffects.ts
│   │   ├── authTabNavigation.ts
│   │   ├── cycleValidation.ts
│   │   ├── dateUtils.ts
│   │   ├── debtAutopsyUtils.ts
│   │   ├── directMutationUtils.ts
│   │   ├── haptics.ts
│   │   ├── impersonationUtils.ts
│   │   ├── numberUtils.ts
│   │   ├── offlineQueueUtils.ts
│   │   ├── paymentValidation.ts
│   │   ├── routerUtils.ts
│   │   ├── storageCore.ts
│   │   ├── storageUtils.ts
│   │   ├── syncDiagnostics.ts
│   │   ├── syncOrchestrator.ts
│   │   ├── syncReconciliation.ts
│   │   ├── themeUtils.ts
│   │   ├── useBodyScrollLock.ts
│   │   ├── useModalAccessibility.ts
│   │   └── visibilitySyncUtils.ts
│   └── vite-env.d.ts
├── tests/
│   └── (43 automated test files)
├── tsconfig.json
├── vercel.json
└── vite.config.ts
```

---

## 3. Route Map

Managed on the client via `src/app/routing/routerUtils.ts` and `src/App.tsx` [Verified from code]:

### Canonical Shell Routes
- `/` or `/battlefield`: Battlefield View (Daily habit execution, 10-segment score gauge, active day controls)
- `/dashboard`: Cycle Dashboard (Cycle statistics, 90-day heatmap, fidelity matrix, curved trend chart)
- `/more`: More & Settings (User profile, night-owl cutoff hour, VIP membership status, Telegram links, export/reset)
- `/archives`: Archives & Historical Records (Completed cycles, autopsy cases, court verdicts)
- `/admin`: Administration Panel (Metrics dashboard, user directory, impersonation, subscription audit)

### Normalizations & Aliases
- `/cycle` normalizes to `/dashboard`
- `/profile` and `/settings` normalize to `/more`
- `/more/archives`, `/database`, and `/court` normalize to `/archives`
- Any unmapped path falls back to `/battlefield`

### State-Driven Overlay Views
- `AuthModal`: Login, Register via SMS OTP, Password Reset
- `AutopsyModal`: Debt autopsy and failure analysis
- `PaymentModal`: VIP membership checkout and plans
- `CreateCycleModal`: New cycle creation modal
- `DisciplineRulesModal`: Bushido rules overview
- `ResetConfirmationModal`: Cycle wipe / account reset
- `FirstRunTour` / `OnboardingWelcomeView`: First-time user tour

---

## 4. API Map

All API endpoints are mounted on Express in `server.ts` under `/api` [Verified from code]:

### System & Telemetry
- `GET /api` | `GET /api/`: API root directory and status
- `GET /api/health`: Healthcheck endpoint (uptime, timestamp, DB connection state)
- `GET /api/ready` | `GET /api/readiness` | `GET /api/health/ready`: Readiness probes
- `GET /api/admin/diagnostics`: Deep diagnostics endpoint (`adminMiddleware`)
- `ALL /api/*`: Catch-all 404 JSON fallback handler

### Authentication & Profile
- `POST /api/auth/register/request-otp` | `POST /api/auth/register/send-otp`: Request registration OTP
- `POST /api/auth/register/verify-otp` | `POST /api/auth/register`: Verify OTP and create user
- `POST /api/auth/login`: Authenticate with phone/identifier and password
- `POST /api/auth/forgot-password`: Request password reset OTP
- `POST /api/auth/reset-password`: Reset password using verified OTP
- `POST /api/auth/send-otp`: General OTP send endpoint
- `POST /api/auth/verify-otp`: Deprecated general OTP endpoint (returns HTTP 410 Gone)
- `POST /api/auth/quick-login`: Development shortcut login (`ENABLE_QUICK_LOGIN`, `ALLOW_TEST_SHORTCUTS`)
- `GET /api/auth/me`: Current authenticated user session (`authMiddleware`)
- `PUT /api/auth/profile` | `PUT /api/user/profile`: Update user profile (`authMiddleware`)

### Cycles Management
- `GET /api/cycles`: Fetch user cycles (`authMiddleware`)
- `GET /api/cycles/:id`: Fetch single cycle by ID (`authMiddleware`)
- `POST /api/cycles`: Create a new cycle with revision token (`authMiddleware`)
- `PUT /api/cycles/:id`: Update cycle with revision token check (`authMiddleware`)
- `PUT /api/cycles/:id/archive`: Archive cycle (`authMiddleware`)
- `PUT /api/cycles/:id/restore`: Restore archived cycle (`authMiddleware`)
- `DELETE /api/cycles/:id`: Delete cycle (`authMiddleware`)

### Daily Logs Management
- `GET /api/logs` | `GET /api/daily-logs`: Fetch daily logs, optionally filtered by `cycleId` (`authMiddleware`)
- `GET /api/logs/:id` | `GET /api/daily-logs/:id`: Fetch single daily log (`authMiddleware`)
- `POST /api/logs` | `POST /api/logs/upsert` | `POST /api/daily-logs`: Upsert daily log with revision check and client operation ID (`authMiddleware`)
- `PUT /api/logs/:id` | `PUT /api/daily-logs/:id`: Update daily log (`authMiddleware`)
- `DELETE /api/logs/:id` | `DELETE /api/daily-logs/:id`: Delete daily log (`authMiddleware`)

### Deterministic AI Engine
- `POST /api/ai/autopsy`: Psychological trap analysis and countermeasures (`authMiddleware`)
- `POST /api/ai/coach`: Sensei coaching feedback based on discipline percentage (`authMiddleware`)
- `POST /api/ai/verdict`: Cycle court verdict and grade evaluation (`authMiddleware`)

### Payments & Subscriptions
- `GET /api/plans` | `GET /api/payment/plans`: Public subscription plans list
- `POST /api/payment/request`: Create payment request via payment adapter (`authMiddleware`)
- `POST /api/payment/verify`: Verify payment transaction (`authMiddleware`)
- `GET /api/user/subscriptions` | `GET /api/subscriptions/my`: Get user payment history (`authMiddleware`)

### Admin Management Panel
- `GET /api/admin/stats`: Aggregate system KPIs and counts (`adminMiddleware`)
- `GET /api/admin/users`: User directory with pagination and filters (`adminMiddleware`)
- `GET /api/admin/role`: Check current user admin privilege status (`adminMiddleware`)
- `PUT /api/admin/users/:id`: Update user role, VIP status, or password (`adminMiddleware`)
- `POST /api/admin/users/create-test`: Create test user account (`adminMiddleware`)
- `POST /api/admin/impersonate`: Issue impersonated session token (`adminMiddleware`)
- `POST /api/admin/impersonate/exit` | `POST /api/admin/exit-impersonation`: Terminate active impersonation
- `GET /api/admin/subscriptions`: Audit platform subscription records (`adminMiddleware`)

---

## 5. Database Schema

Managed in `prisma/schema.prisma` targeting PostgreSQL (`provider = "postgresql"`, `url = env("DATABASE_URL")`) [Verified from committed configuration]:

### Enums
- `UserRole`: `FREE`, `VIP`, `ADMIN`
- `UserTier`: `FREE`, `VIP`, `MASTER`
- `DayStatus`: `STANDARD`, `FROZEN`, `BURNED`
- `SubscriptionStatus`: `PENDING`, `SUCCESS`, `FAILED`

### Models
- **User**: `id` (cuid), `email` (unique), `phoneNumber` (unique), `name`, `passwordHash`, `role` (UserRole), `tier` (string), `isVip` (boolean), `vipSince` (DateTime), `vipExpiresAt` (DateTime), `paymentRefId` (string), `isAdmin` (boolean), `tokenVersion` (int), `nightOwlCutoffHour` (int), `accentTheme` (string), `cycles` (Cycle[]), `dailyLogs` (DailyLog[]), `subscriptions` (Subscription[]), `otpCodes` (OtpCode[]), `createdAt`, `updatedAt`.
- **Cycle**: `id` (cuid), `userId` (FK User), `title`, `startDate`, `endDate`, `targetTheme`, `inheritedStreak`, `rules` (string[]), `isArchived`, `reportRead`, `verdict` (Json), `revision` (int), `dailyLogs` (DailyLog[]), `createdAt`, `updatedAt`.
- **DailyLog**: `id` (cuid), `userId` (FK User), `cycleId` (FK Cycle), `date`, `status` (DayStatus), `revision` (int), `wakeUp` (boolean), `workout` (boolean), `study` (boolean), `journal` (boolean), `hardTask` (boolean), `specialMission` (boolean), `failureReason`, `failureTime`, `autopsyNotes`, `countermeasure`, `aiFeedback`, `notes`, `lastClientOperationId`, `createdAt`, `updatedAt`. (Unique on `[cycleId, date]` and `[userId, date]`).
- **OtpCode**: `id` (cuid), `identifier`, `purpose`, `codeHash` (SHA-256 / HMAC-SHA256 string storage), `expiresAt`, `verified`, `attempts`, `maxAttempts`, `lastSentAt`, `consumedAt`, `userId` (FK User?), `createdAt`, `updatedAt`.
- **Subscription**: `id` (cuid), `userId` (FK User), `planId`, `amount`, `authority` (unique), `refId`, `cardPan`, `status` (SubscriptionStatus), `description`, `expiresAt`, `createdAt`, `updatedAt`.

---

## 6. Authentication Flow

Extracted from `server/otp/index.ts`, `server/auth.ts`, and `server/security.ts` [Verified from code]:

- **Phone Canonicalization**: Persian/Arabic numerals are normalized to ASCII digits via `toEnglishDigits` and validated against regex `^09\d{9}$`.
- **OTP Protection Architecture**:
  - OTP codes are protected using **HMAC-SHA256** (`crypto.createHmac('sha256', secret)`).
  - Keyed by `getJwtSecret()`.
  - Bound to canonical phone number using the string template `${phoneNumber}:${code}`.
  - Compared using `crypto.timingSafeEqual` over utf8 Buffers.
- **Directly Verified OTP Controls** [Verified from code]:
  - **60-second resend cooldown**: Enforced by comparing request timestamp with `lastSentAt` against `OTP_COOLDOWN_SECONDS` (60s).
  - **180-second expiration**: Set by `OTP_EXPIRATION_SECONDS` (180s = 3 minutes).
  - **Maximum 5 verification attempts**: `attempts` counter incremented on failure; blocked once `attempts >= maxAttempts` (5).
  - **Purpose binding**: Validates `challenge.purpose === options.purpose` (e.g. `PHONE_REGISTRATION`, `PASSWORD_RESET`).
  - **Challenge consumption**: Verified code marked with `consumedAt = new Date()` (or deleted) to prevent replay.
  - **Cleanup following dispatch failure**: If SMS delivery fails, newly created OTP record is immediately deleted (`removeOtpRecord`).
  - *Note on daily quota*: No daily send quota counter was found in the codebase.
- **Password Hashing**: User passwords are encrypted with PBKDF2 (`salt:derivedHash`, 100,000 iterations, 64-byte key length, SHA-512) [Verified from code].
- **Password Login Verification**: Uses `crypto.timingSafeEqual` on PBKDF2 derived hash. If the user does not exist, server verifies against a `DUMMY_PASSWORD_HASH` to neutralize timing enumeration [Verified from code].
- **Session Tokens**: Issues 7-day signed JWT containing `userId`, `phoneNumber`, `role`, `tier`, and `tokenVersion` [Verified from code].
- **Session Revocation**: `authMiddleware` checks `token.tokenVersion < user.tokenVersion`. If lower, rejects with `401 SESSION_REVOKED` [Verified from code].
- **Admin Impersonation**: Admin issues impersonated JWT marked with `isImpersonated: true`. All admin-protected routes explicitly reject tokens where `isImpersonated === true` with HTTP 403 `IMPERSONATION_ACCESS_FORBIDDEN` [Verified from code].

---

## 7. Middleware Flow

Extracted from `server.ts` and `server/middleware/security.ts` [Verified from code]:

1. **Path Rewriter**: Normalizes serverless forwarded URIs and preserves `/api` segments.
2. **Security Headers (`setSecurityHeaders`)**:
   - Production: Strict HSTS, CSP (`frame-ancestors 'self'`, connect-src to self and Zarinpal), `X-Frame-Options: SAMEORIGIN`.
   - Dev / Test Shortcuts: Permissive CSP allowing preview iframe embeds.
   - Common: `X-Content-Type-Options: nosniff`, `X-XSS-Protection: 1; mode=block`, `Referrer-Policy: strict-origin-when-cross-origin`, removes `X-Powered-By`.
3. **Body Parser**: `express.json()`.
4. **Health Check Bypass**: Bypasses rate limiting for `/api/health` and `/api/ready`.
5. **Rate Limiting**:
   - `apiRateLimiter`: 100 requests per 1 minute window on `/api`.
   - `authRateLimiter`: 10 requests per 15 minute window on `/api/auth`.
6. **Route Validation & Auth**:
   - `validateBody(schema)`: Zod schema parsing.
   - `authMiddleware`: JWT verification, DB user check, token version check.
   - `adminMiddleware` / `superAdminMiddleware`: Role and super admin identifier verification, rejects impersonated tokens.
7. **Static / SPA Serving**: Serves `dist/` and falls back non-API routes to `index.html` (in production) or mounts Vite dev middleware (in development).
8. **Error Handler (`errorHandler`)**:
   - Maps `PreconditionRequiredError` to HTTP 428.
   - Maps `ConcurrencyConflictError` to HTTP 409.
   - Maps `ServiceUnavailableError` to HTTP 503.
   - Censoring: Suppresses stack traces and raw error messages in production.

---

## 8. Roles and Permissions

Extracted from `server/auth.ts` and `server/security.ts` [Verified from code]:

- **Guest / Anonymous**: Local client state execution only. Cannot persist to cloud database.
- **FREE (`ronin_free`)**: Standard daily logging, cycle tracking, autopsy analysis, sensei feedback. Limited to 1 active cycle.
- **VIP (`vip_samurai`)**: Unlocks unlimited cycles, VIP badge, full history analytics.
- **ADMIN**: Access to `/admin`, platform statistics, user management, role adjustments, impersonation, and transaction audits.
- **SUPER_ADMIN**: Master commander identified by `SUPER_ADMIN_PHONE`, `SUPER_ADMIN_EMAIL`, or `SUPER_ADMIN_IDENTIFIER`. Root system privileges.
- **Impersonated Session**: Operates in the target user's scope; hard-blocked from all `/api/admin/*` endpoints (HTTP 403).

---

## 9. External Services & Providers

### Currently Configured or Observed
- **PostgreSQL Database Target**: Configured via Prisma (`DATABASE_URL`, `POSTGRES_PRISMA_URL`) [Verified from committed configuration].
- **Typography CDN**: Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) declared in `index.html` [Verified from code].
- **Telegram Links**: Static community and support links to `t.me/BushidoSupport` and `t.me/BushidoDiscipline` in `src/data/moreTabData.ts` [Verified from code].

### Current Deployment Context [Reported deployment context]
- **Vercel**: Currently used for manual testing (`vercel.json`, `api/index.js`).
- **Neon**: Currently used as the test PostgreSQL database via connection strings.
- **SMS/OTP Provider**: Not yet live (runs `MockSmsProvider` in dev/test, fail-closed `FailClosedSmsProvider` in production).
- **Payment Gateway**: Not yet live (runs `ProviderNeutralSimulatorAdapter` in dev/test, fails closed to `null` in production).

### Structurally Possible [Verified from code]
- **Generic PostgreSQL Providers**: Prisma client connects to any compliant PostgreSQL instance supporting SSL/pooled connection strings.
- **Zarinpal**: Content Security Policy in `server/middleware/security.ts` includes `api.zarinpal.com`, `payment.zarinpal.com`, `sandbox.zarinpal.com`.

### Future Candidate [Reported deployment context]
- **Liara**: A future deployment candidate, not current production.

---

## 10. Environment Variables Used

### Defined in `.env.example` [Verified from committed configuration]
- `DATABASE_URL`: Primary PostgreSQL connection string used by Prisma.
- `DIRECT_URL`: Unpooled PostgreSQL connection string used for migrations.
- `POSTGRES_PRISMA_URL`: Alternative pooled database URL for Vercel Postgres.
- `POSTGRES_URL_NON_POOLING`: Alternative unpooled direct URL for Vercel Postgres.
- `JWT_SECRET`: Secret key used for signing and verifying JSON Web Tokens.
- `ALLOW_TEST_SHORTCUTS`: Boolean flag permitting test shortcuts, test accounts, and relaxed CSP.
- `ENABLE_QUICK_LOGIN`: Boolean flag controlling availability of `/api/auth/quick-login`.
- `ENABLE_OTP_DEBUG`: Boolean flag exposing plain OTP codes in API responses for automated testing.
- `SUPER_ADMIN_PHONE`: Phone number identifying the Super Admin user.
- `SUPER_ADMIN_EMAIL`: Email address identifying the Super Admin user.
- `SUPER_ADMIN_IDENTIFIER`: Unified identifier for Super Admin identification.
- `SUPER_ADMIN_PASS`: Default/seed password for Super Admin account.
- `SUPER_ADMIN_NAME`: Display name for Super Admin user.
- `ZARINPAL_MERCHANT_ID`: Merchant identifier for Zarinpal payment gateway integration.

### Runtime Environment Variables Referenced in Code [Verified from code]
- `NODE_ENV`: Runtime environment selector (`"production"`, `"development"`, `"test"`).
- `POSTGRES_URL`, `POSTGRES_URL_POOLED`, `DATABASE_URL_POOLED`, `DATABASE_URL_UNPOOLED`: Fallback database URLs checked in `server/db/base.ts`.
- `POSTGRES_HOST`, `PGHOST`, `POSTGRES_USER`, `PGUSER`, `POSTGRES_PASSWORD`, `PGPASSWORD`, `POSTGRES_DATABASE`, `PGDATABASE`, `POSTGRES_PORT`, `PGPORT`: Individual database connection parameters in `server/db/base.ts`.
- `ADMIN_PHONE`, `ADMIN_USERNAME`: Alternative identifier aliases in `server/security.ts`.
- `VERCEL`, `VERCEL_ENV`, `NOW_REGION`: Deployment environment detection flags for Vercel serverless platform.
- `AWS_LAMBDA_FUNCTION_NAME`: AWS Lambda serverless execution indicator.
- `JEST_WORKER_ID`, `NODE_TEST_CONTEXT`: Test runner environment detection flags.

---

## 11. Build Status

- **Status**: Verified [Verified from captured command output]
- **Command**: `npm run build`
- **Exit code**: `0`
- **Captured Output**:
  - `prisma generate`: `✔ Generated Prisma Client (v6.4.0) to ./node_modules/@prisma/client in 54ms`
  - `vite build`: `dist/index.html 1.44 kB │ gzip: 0.69 kB`, `dist/assets/index-D_u001XU.css 41.30 kB │ gzip: 8.41 kB`, `dist/assets/index-CWG-j7rP.js 402.16 kB │ gzip: 120.14 kB`, built in 547ms
  - `esbuild`: Bundled `server.ts` into `dist/server.cjs` (166.7kb) and `dist/server.cjs.map` (262.3kb) in 32ms

---

## 12. TypeScript Status

- **Configuration Behavior** [Verified from committed configuration]:
  - `tsconfig.json` contains: `"target": "ES2022"`, `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"include": ["src"]`.
  - **Explicit strict mode is not configured**: `"strict": true` and `"noImplicitAny": true` are **not** present in `tsconfig.json`.
  - **Inclusion Scope**: `tsconfig.json` currently includes `"src"` only.
  - **Server and Test Coverage**: Server files (`server.ts`, `server/**/*.ts`) and tests (`tests/**/*.ts`) are not included in `tsconfig.json` `"include"`. Therefore, server and test TypeScript coverage by the lint command is not established.
- **Command**: `npm run lint` (`tsc --noEmit`)
- **Status**: Verified [Verified from captured command output]
- **Exit code**: `0`
- **Captured Output**: Clean exit with 0 diagnostics.

---

## 13. ESLint Status

- **Status**: Not Installed / Not Configured [Verified from committed configuration]
- `package.json` contains no ESLint dependencies (`eslint`, `@eslint/*`, `@typescript-eslint/*`).
- No ESLint configuration file exists in the repository root.
- The `npm run lint` script maps strictly to `tsc --noEmit`.

---

## 14. Test Status

- **Status**: Verified [Verified from captured command output]
- **Command**: `npm test` (`tsx --test "tests/**/*.test.ts"`)
- **Exit code**: `0`
- **Captured Test Counts**:
  - `# tests 885`
  - `# suites 217`
  - `# pass 885`
  - `# fail 0`
  - `# cancelled 0`
  - `# skipped 0`
  - `# todo 0`
  - `# duration_ms 34322.478074`

---

## 15. Known TODOs

- **Total in Source Code**: 0 [Verified from captured command output via `grep -rnEI "TODO" --exclude-dir=node_modules --exclude-dir=dist .`].

---

## 16. Known FIXMEs

- **Total in Source Code**: 0 [Verified from captured command output via `grep -rnEI "FIXME" --exclude-dir=node_modules --exclude-dir=dist .`].

---

## 17. Current Risks Discovered

1. **In-Memory Rate Limiter**:
   - Description: `rateLimitStore` in `server/middleware/security.ts` uses an in-process JavaScript `Map`. In serverless or multi-instance configurations, counters are not shared across instances and reset on cold starts [Verified from code].
   - Classification: Accepted temporary risk for the current Vercel manual-testing stage. Must be re-evaluated before public OTP/payment and horizontally scaled production.

2. **Mock or Fail-Closed SMS and Payment Adapters**:
   - Description: With live provider keys absent or unconfigured, `MockSmsProvider` / `ProviderNeutralSimulatorAdapter` are used in dev/test, and production fails closed (`SMS_GATEWAY_UNCONFIGURED_IN_PRODUCTION`, payment adapter returns `null`) [Verified from code].
   - Classification: Expected current-state limitation, not a defect in the manual-testing stage. Production blocker before real launch.

3. **Client-Side localStorage JWT**:
   - Description: Active JWT token is persisted in browser `localStorage` under `bushido_auth_token` (`src/sync/storageUtils.ts`) [Verified from code].
   - Classification: Security trade-off requiring a dedicated threat-model decision. (Content Security Policy is not declared a sufficient mitigation).

4. **Transitional Compatibility Forwarding Files**:
   - Description: Re-exporting bridge files exist across `/src/components/*` (mirroring `/src/features/*`) and `/src/utils/*` (mirroring `/src/sync/*` and `/src/shared/utils/*`) [Verified from code].
   - Classification: Transitional architecture debt retained to preserve import compatibility without breaking active references.
