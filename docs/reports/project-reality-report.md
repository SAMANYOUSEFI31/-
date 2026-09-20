# Project Reality Report

## 1. Tech Stack

- **Runtime Environment**: Node.js (v22+ ESM native with CommonJS bundling support)
- **Frontend Framework**: React 19 (`react@19.0.1`, `react-dom@19.0.1`)
- **Language**: TypeScript (`typescript@~5.8.2`) with strict mode enabled (`tsconfig.json`)
- **Frontend Build Tool**: Vite 6 (`vite@^6.2.3`), `@vitejs/plugin-react@^4.3.4`
- **Backend Bundler**: esbuild (`esbuild@^0.25.0`) targeting Node.js CommonJS (`dist/server.cjs`)
- **Styling & CSS**: Tailwind CSS v4 (`tailwindcss@^4.0.0`, `@tailwindcss/vite@^4.0.0`, `autoprefixer@^10.4.21`) and CSS design tokens (`src/styles/tokens.css`)
- **UI & Iconography**: Lucide React (`lucide-react@^0.546.0`)
- **Motion & Animations**: Motion (`motion@^12.23.24`)
- **Server Framework**: Express 4 (`express@^4.21.2`, `@types/express@^4.17.21`)
- **Server Runner**: tsx (`tsx@^4.21.0`) for development execution
- **Database ORM**: Prisma ORM (`prisma@6.4.0`, `@prisma/client@6.4.0`)
- **Database Engine Target**: PostgreSQL (Neon, Supabase, Vercel Postgres, Google Cloud SQL)
- **Validation Library**: Zod (`zod@^3.24.2`)
- **Security & Cryptography**: jsonwebtoken (`jsonwebtoken@^9.0.2`), Node.js native `crypto` module (PBKDF2 SHA-512, timingSafeEqual, randomBytes)
- **Environment Configuration**: dotenv (`dotenv@^17.2.3`)
- **Client Routing**: Custom zero-dependency HTML5 History API router (`src/app/routing/routerUtils.ts`)
- **PWA Capabilities**: Service Worker (`public/sw.js`), Web App Manifest (`public/manifest.json`), install prompt handlers
- **Hybrid Mobile Configuration**: Capacitor (`capacitor.config.json`), GitHub Actions Android APK pipeline (`.github/workflows/build-apk.yml`)
- **Serverless Hosting Adapter**: Vercel serverless entry point (`api/index.js`, `vercel.json`)
- **Test Runner**: Node.js built-in test runner (`tsx --test "tests/**/*.test.ts"`)

---

## 2. Folder Structure

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
│   ├── audits/
│   │   └── phase1-baseline-audit.md
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
│   └── (43 automated test suites)
├── tsconfig.json
├── vercel.json
└── vite.config.ts
```

---

## 3. Route Map

The application utilizes a custom History API routing mechanism (`src/app/routing/routerUtils.ts`) integrated with browser state and popstate listeners in `src/App.tsx`.

### Canonical Client Routes
- `/` or `/battlefield`: Battlefield View (Default landing screen, daily habit tracking, score gauge, active day controls)
- `/dashboard`: Cycle Dashboard / Command Center (Cycle KPIs, 90-day tactical heatmap, habit fidelity matrix, curved trend spline)
- `/more`: More / Profile Settings Shell (Profile information, night-owl cutoff hour, VIP membership status, Telegram links, export/reset)
- `/archives`: Archives & Historical Ledger (All past cycles, autopsy records, archived cycle verdicts)
- `/admin`: Administration Panel (Admin-only view: analytics, user management, impersonation, subscription audits)

### Path Aliases & Normalization
- `/cycle` maps to `/dashboard`
- `/profile` and `/settings` map to `/more`
- `/more/archives`, `/database`, and `/court` map to `/archives`
- Any unmatched or unrecognized pathname normalizes and redirects to `/battlefield`

### Client Modal Dialog Routes (State-Driven Overlays)
- `AuthModal`: Login, Register via SMS OTP, Password Reset via SMS OTP
- `AutopsyModal`: Debt autopsy, root failure analysis, psychological trap identification
- `PaymentModal`: VIP upgrade, plan selection, gateway simulation/redirection
- `CreateCycleModal`: New cycle configuration (date ranges, target themes, rules)
- `DisciplineRulesModal`: Bushido discipline rules and covenant explanation
- `ResetConfirmationModal`: Cycle wipe and full account data reset confirmation
- `FirstRunTour` & `OnboardingWelcomeView`: First-time user onboarding guided flow

---

## 4. API Map

All backend endpoints are registered in `server.ts` and served under the `/api` prefix.

### System, Diagnostics & Probes
- `GET /api` | `GET /api/`: API root directory and status metadata
- `GET /api/health`: Healthcheck endpoint reporting server uptime, timestamp, and database status
- `GET /api/ready` | `GET /api/readiness` | `GET /api/health/ready`: Readiness probe checking database connectivity
- `GET /api/admin/diagnostics`: Deep diagnostic telemetry for database connectivity, table row counts, and environment flags (`adminMiddleware`)
- `ALL /api/*`: Fallback handler returning structured JSON 404 for any unmatched API paths

### Authentication & Profile Management
- `POST /api/auth/register/request-otp` | `POST /api/auth/register/send-otp`: Request registration OTP code for phone number (`validateBody(registerRequestOtpSchema)`)
- `POST /api/auth/register/verify-otp` | `POST /api/auth/register`: Verify OTP and complete user account creation (`validateBody(registerVerifyOtpSchema)`)
- `POST /api/auth/login`: Authenticate with phone/identifier and password (`validateBody(loginSchema)`)
- `POST /api/auth/forgot-password`: Request password reset OTP code (`validateBody(forgotPasswordRequestOtpSchema)`)
- `POST /api/auth/reset-password`: Reset password using verified OTP code (`validateBody(resetPasswordWithOtpSchema)`)
- `POST /api/auth/send-otp`: General OTP send endpoint
- `POST /api/auth/verify-otp`: Deprecated general OTP endpoint (returns HTTP 410 Gone with redirect instructions)
- `POST /api/auth/quick-login`: Development and test environment shortcut login (conditional on `ENABLE_QUICK_LOGIN` and `ALLOW_TEST_SHORTCUTS`)
- `GET /api/auth/me`: Get current authenticated user session data (`authMiddleware`)
- `PUT /api/auth/profile` | `PUT /api/user/profile`: Update user profile name, cutoff hour, or theme (`authMiddleware`, `validateBody(updateProfileSchema)`)

### Cycles Management
- `GET /api/cycles`: List all cycles belonging to the authenticated user (`authMiddleware`)
- `GET /api/cycles/:id`: Retrieve single cycle by ID (`authMiddleware`)
- `POST /api/cycles`: Create a new cycle with concurrency revision token (`authMiddleware`, `validateBody(createCycleSchema)`)
- `PUT /api/cycles/:id`: Update cycle metadata with revision token validation (`authMiddleware`, `validateBody(updateCycleSchema)`)
- `PUT /api/cycles/:id/archive`: Archive an active cycle (`authMiddleware`)
- `PUT /api/cycles/:id/restore`: Restore an archived cycle (`authMiddleware`)
- `DELETE /api/cycles/:id`: Permanently delete a cycle and its associated logs (`authMiddleware`)

### Daily Logs Management
- `GET /api/logs` | `GET /api/daily-logs`: Fetch daily logs, optionally filtered by `cycleId` (`authMiddleware`)
- `GET /api/logs/:id` | `GET /api/daily-logs/:id`: Fetch single daily log by ID (`authMiddleware`)
- `POST /api/logs` | `POST /api/logs/upsert` | `POST /api/daily-logs`: Upsert daily habit log with revision token and idempotent client operation ID (`authMiddleware`, `validateBody(upsertDailyLogSchema)`)
- `PUT /api/logs/:id` | `PUT /api/daily-logs/:id`: Update existing daily log (`authMiddleware`, `validateBody(updateDailyLogSchema)`)
- `DELETE /api/logs/:id` | `DELETE /api/daily-logs/:id`: Delete daily log (`authMiddleware`)

### Deterministic AI & Evaluation Engine
- `POST /api/ai/autopsy`: Analyze missed habits, determine psychological traps, and generate countermeasures (`authMiddleware`, `validateBody(autopsySchema)`)
- `POST /api/ai/coach`: Generate deterministic coaching guidance based on discipline score percentage (`authMiddleware`)
- `POST /api/ai/verdict`: Generate cycle evaluation verdict, grade, and notes (`authMiddleware`)

### Subscription & Payments
- `GET /api/plans` | `GET /api/payment/plans`: Public subscription plans configuration
- `POST /api/payment/request`: Initiate payment request through payment adapter (`authMiddleware`, `validateBody(paymentRequestSchema)`)
- `POST /api/payment/verify`: Verify completed payment transaction (`authMiddleware`, `validateBody(paymentVerifySchema)`)
- `GET /api/user/subscriptions` | `GET /api/subscriptions/my`: Get authenticated user's payment and subscription history (`authMiddleware`)

### Admin Management Panel
- `GET /api/admin/stats`: Aggregated platform statistics and KPIs (`adminMiddleware`)
- `GET /api/admin/users`: User directory with pagination, search, and role filters (`adminMiddleware`)
- `GET /api/admin/role`: Check requesting user's admin privilege status (`adminMiddleware`)
- `PUT /api/admin/users/:id`: Modify user status, role, VIP dates, or password (`adminMiddleware`)
- `POST /api/admin/users/create-test`: Create isolated test user account (`adminMiddleware`)
- `POST /api/admin/impersonate`: Issue impersonated session token for target user (`adminMiddleware`)
- `POST /api/admin/impersonate/exit` | `POST /api/admin/exit-impersonation`: Terminate active impersonation session
- `GET /api/admin/subscriptions`: Audit all platform transactions and payment records (`adminMiddleware`)

---

## 5. Database Schema

Defined in `prisma/schema.prisma` targeting PostgreSQL datasource `env("DATABASE_URL")`.

### Enums
- `UserRole`: `FREE`, `VIP`, `ADMIN`
- `UserTier`: `FREE`, `VIP`, `MASTER`
- `DayStatus`: `STANDARD`, `FROZEN`, `BURNED`
- `SubscriptionStatus`: `PENDING`, `SUCCESS`, `FAILED`

### Models

#### 1. User
- `id`: String (cuid, primary key)
- `email`: String? (unique, indexed)
- `phoneNumber`: String? (unique, indexed)
- `name`: String?
- `passwordHash`: String?
- `role`: UserRole (default: `FREE`, indexed)
- `tier`: String (default: `"ronin_free"`)
- `isVip`: Boolean (default: `false`, indexed)
- `vipSince`: DateTime?
- `vipExpiresAt`: DateTime?
- `paymentRefId`: String?
- `isAdmin`: Boolean (default: `false`)
- `tokenVersion`: Int (default: `0`)
- `nightOwlCutoffHour`: Int (default: `4`)
- `accentTheme`: String (default: `"amber"`)
- Relations: `cycles` (Cycle[]), `dailyLogs` (DailyLog[]), `subscriptions` (Subscription[]), `otpCodes` (OtpCode[])
- Timestamps: `createdAt` (DateTime), `updatedAt` (DateTime)

#### 2. Cycle
- `id`: String (cuid, primary key)
- `userId`: String (indexed)
- `title`: String
- `startDate`: String (YYYY-MM-DD)
- `endDate`: String (YYYY-MM-DD)
- `targetTheme`: String?
- `inheritedStreak`: Int (default: `0`)
- `rules`: String[] (default: `[]`)
- `isArchived`: Boolean (default: `false`)
- `reportRead`: Boolean (default: `false`)
- `verdict`: Json?
- `revision`: Int (default: `1`)
- Relations: `user` (User, cascade delete), `dailyLogs` (DailyLog[])
- Indexes: `[userId]`, `[userId, isArchived]`, `[userId, startDate]`, `[id, userId, revision]`
- Timestamps: `createdAt` (DateTime), `updatedAt` (DateTime)

#### 3. DailyLog
- `id`: String (cuid, primary key)
- `userId`: String (indexed)
- `cycleId`: String (indexed)
- `date`: String (YYYY-MM-DD)
- `status`: DayStatus (default: `STANDARD`)
- `revision`: Int (default: `1`)
- `wakeUp`: Boolean (default: `false`)
- `workout`: Boolean (default: `false`)
- `study`: Boolean (default: `false`)
- `journal`: Boolean (default: `false`)
- `hardTask`: Boolean (default: `false`)
- `specialMission`: Boolean (default: `false`)
- `failureReason`: String?
- `failureTime`: String?
- `autopsyNotes`: String?
- `countermeasure`: String?
- `aiFeedback`: String?
- `notes`: String?
- `lastClientOperationId`: String?
- Relations: `user` (User, cascade delete), `cycle` (Cycle, cascade delete)
- Unique constraints: `@@unique([cycleId, date])`, `@@unique([userId, date])`
- Indexes: `[userId]`, `[cycleId]`, `[userId, date]`, `[userId, cycleId]`, `[id, userId, revision]`
- Timestamps: `createdAt` (DateTime), `updatedAt` (DateTime)

#### 4. OtpCode
- `id`: String (cuid, primary key)
- `identifier`: String (Canonical phone number: `09XXXXXXXXX`, indexed)
- `purpose`: String (default: `"PHONE_REGISTRATION"`)
- `codeHash`: String (SHA-256 hash)
- `expiresAt`: DateTime
- `verified`: Boolean (default: `false`)
- `attempts`: Int (default: `0`)
- `maxAttempts`: Int (default: `5`)
- `lastSentAt`: DateTime (default: `now()`)
- `consumedAt`: DateTime?
- `userId`: String?
- Relations: `user` (User?, cascade delete)
- Indexes: `[identifier]`, `[identifier, verified]`, `[identifier, purpose]`, `[identifier, purpose, verified]`
- Timestamps: `createdAt` (DateTime), `updatedAt` (DateTime)

#### 5. Subscription
- `id`: String (cuid, primary key)
- `userId`: String (indexed)
- `planId`: String
- `amount`: Int
- `authority`: String (unique, indexed)
- `refId`: String?
- `cardPan`: String?
- `status`: SubscriptionStatus (default: `PENDING`)
- `description`: String?
- `expiresAt`: DateTime?
- Relations: `user` (User, cascade delete)
- Indexes: `[userId]`, `[authority]`, `[userId, status]`
- Timestamps: `createdAt` (DateTime), `updatedAt` (DateTime)

---

## 6. Authentication Flow

### Phone/SMS OTP Registration
1. **Client Request**: Client submits phone number to `POST /api/auth/register/request-otp`.
2. **Canonicalization**: Server converts Persian/Arabic numerals to standard digits via `toEnglishDigits` and validates regex `^09\d{9}$`.
3. **Throttling & Cooldown**: Server verifies minimum 60-second cooldown since `lastSentAt` and daily send quota.
4. **Code Generation & Hash**: Generates 5-digit cryptographically random OTP. Code is stored as a SHA-256 hash in `OtpCode` table; plaintext code is never stored in DB.
5. **SMS Dispatch**: Dispatches SMS via active `SmsProvider` (`MockSmsProvider` in dev/test; real provider or fail-closed in prod).
6. **Verification & Creation**: Client submits phone number, 5-digit code, display name, and password to `POST /api/auth/register/verify-otp`.
7. **Hash Comparison**: Server queries active unconsumed OTP, verifies attempts < `maxAttempts`, checks expiration (3 minutes), compares SHA-256 hash.
8. **Password Hashing**: User password is encrypted with PBKDF2 (`salt:derivedHash`, 100,000 iterations, 64-byte key length, SHA-512).
9. **User Record & Token Generation**: Creates user with default role `FREE` and `tokenVersion: 0`. Signs JWT containing `userId`, `phoneNumber`, `role`, `tier`, and `tokenVersion` (7-day expiration).

### Password Login
1. Client submits identifier (phone or email) and password to `POST /api/auth/login`.
2. Server queries user by identifier. If user does not exist, server executes `verifyPassword` against `DUMMY_PASSWORD_HASH` to neutralize timing-based user enumeration attacks.
3. Server executes timing-safe comparison (`crypto.timingSafeEqual`) on PBKDF2 derived hash.
4. Returns user payload and signed JWT token.

### Password Reset Flow
1. Client requests OTP via `POST /api/auth/forgot-password` with identifier.
2. Server generates OTP record with purpose `"PASSWORD_RESET"`.
3. Client submits identifier, OTP code, and new password to `POST /api/auth/reset-password`.
4. Upon verification, password is updated with a new PBKDF2 salt and hash.
5. `tokenVersion` on user record is incremented by 1, instantly invalidating all previously issued tokens across all devices.

### Development Quick Login
- Enabled only when `ALLOW_TEST_SHORTCUTS=true` or `ENABLE_QUICK_LOGIN=true`.
- Allows instant login to mock accounts (`test_user`, `ronin_free`, `super_admin`) without requiring SMS delivery.

### Impersonation Flow
1. Authenticated Admin requests `POST /api/admin/impersonate` with `targetUserId`.
2. Server verifies admin privileges and logs event to audit storage (`server/audit.ts`).
3. Server issues JWT with claims `isImpersonated: true` and `impersonatedBy: adminUserId`.
4. Client stores admin recovery token in `sessionStorage` (`bushido_impersonator_token`) and uses target user's token.
5. Server middleware explicitly checks `isImpersonated`: all admin routes reject impersonated tokens with HTTP 403 `IMPERSONATION_ACCESS_FORBIDDEN` to prevent privilege escalation.
6. Admin returns to original session via `POST /api/admin/impersonate/exit`.

---

## 7. Middleware Flow

Incoming HTTP requests traverse the following pipeline in `server.ts`:

```
Incoming Request
       │
       ▼
[1] Path Rewriter Middleware
    (Normalizes x-forwarded-uri and path segments for serverless edge consistency)
       │
       ▼
[2] Security Headers Middleware (setSecurityHeaders)
    - Production: Strict HSTS, strict CSP (restricted script-src, frame-ancestors 'self', connect-src to self and Zarinpal), X-Frame-Options: SAMEORIGIN
    - Dev / Test Shortcuts: Permissive CSP allowing frame-ancestors for AI Studio preview iframe
    - Common: X-Content-Type-Options: nosniff, X-XSS-Protection: 1; mode=block, Referrer-Policy: strict-origin-when-cross-origin, removes X-Powered-By
       │
       ▼
[3] Body Parser Middleware (express.json())
       │
       ▼
[4] Health Bypass Check
    (Passes /api/health and readiness probes without rate limiting or authentication)
       │
       ▼
[5] Rate Limiting Middleware
    - General API (/api): 100 requests per 1 minute window (apiRateLimiter)
    - Auth Routes (/api/auth): 10 requests per 15 minute window (authRateLimiter)
       │
       ▼
[6] Route Handler Pipeline
    ├── Zod Request Validation (validateBody)
    │   └── Returns HTTP 400 with Persian error message on schema failure
    ├── Authentication (authMiddleware)
    │   ├── Verifies Bearer JWT signature
    │   ├── Verifies user existence in database
    │   └── Enforces tokenVersion check (returns 401 SESSION_REVOKED if tokenVersion < user.tokenVersion)
    ├── Role Protection (adminMiddleware / superAdminMiddleware)
    │   ├── Enforces user.isAdmin === true or Super Admin identifier
    │   └── Enforces defense-in-depth: rejects any token with isImpersonated === true (403)
    └── Route Execution (Controllers & DB Transactions)
       │
       ▼
[7] Static File & SPA Fallback (Production) / Vite Dev Middleware (Development)
    (Serves static assets from dist/ and falls back unmatched GET requests to index.html)
       │
       ▼
[8] Central Error Handling Middleware (errorHandler)
    - Maps PreconditionRequiredError to HTTP 428
    - Maps ConcurrencyConflictError to HTTP 409
    - Maps ServiceUnavailableError to HTTP 503
    - Censoring: Stack traces and internal error messages suppressed in production
```

---

## 8. Roles and Permissions

### Role Matrix

| Capability / Resource | Guest / Anonymous | FREE (`ronin_free`) | VIP (`vip_samurai`) | ADMIN | SUPER_ADMIN (Commander) | Impersonated Session |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| View Battlefield UI | Yes (local/demo) | Yes | Yes | Yes | Yes | Yes |
| Daily Habits Check | Yes (local) | Yes | Yes | Yes | Yes | Yes |
| Sync to Database | No | Yes | Yes | Yes | Yes | Yes |
| Cycles Creation | Local only | Standard (max 1 active) | Unlimited | Unlimited | Unlimited | Target User Quota |
| Autopsy Analysis | Deterministic AI | Deterministic AI | Deterministic AI | Deterministic AI | Deterministic AI | Deterministic AI |
| View Historical Archives | Local | Yes | Yes | Yes | Yes | Yes |
| Access Admin Panel (`/admin`) | No | No | No | Yes | Yes | **Blocked (HTTP 403)** |
| View System KPIs & Telemetry | No | No | No | Yes | Yes | **Blocked (HTTP 403)** |
| Modify User Roles & VIP Dates | No | No | No | Yes | Yes | **Blocked (HTTP 403)** |
| Initiate User Impersonation | No | No | No | Yes | Yes | **Blocked (HTTP 403)** |
| Super Admin Root Endpoints | No | No | No | No | Yes | **Blocked (HTTP 403)** |

---

## 9. External Services

### 1. PostgreSQL Database
- Connected through Prisma client.
- Targets: Vercel Postgres, Neon, Supabase, Google Cloud SQL.
- Connection string injected via `DATABASE_URL` / `POSTGRES_PRISMA_URL`.

### 2. SMS Gateway Service
- Integrated via `SmsProvider` interface (`server/sms/index.ts`).
- Current default: `MockSmsProvider` for dev/test environments (logs OTP codes to server console and maintains memory dispatch history).
- Production behavior without configured gateway credentials: `FailClosedSmsProvider` returns `SMS_GATEWAY_UNCONFIGURED_IN_PRODUCTION`.

### 3. Payment Gateway (Zarinpal)
- Integrated via `PaymentGatewayAdapter` interface (`server/payment/adapter.ts`).
- Current default: `ProviderNeutralSimulatorAdapter` for non-production environments (generates simulated authority and ref IDs).
- Production behavior: `getPaymentAdapter()` returns `null` (fails closed) if a live provider adapter is not configured.
- Content Security Policy permits connections to `api.zarinpal.com`, `payment.zarinpal.com`, and `sandbox.zarinpal.com`.

### 4. CDN & Web Typography
- Google Fonts: Preconnected and loaded via `fonts.googleapis.com` and `fonts.gstatic.com` in `index.html` for Vazirmatn, Plus Jakarta Sans, and JetBrains Mono.

### 5. Community & Support Links
- External support links pointed to Telegram channels: `https://t.me/BushidoSupport` and `https://t.me/BushidoDiscipline`.

---

## 10. Environment Variables Used

### Defined in `.env.example`
- `DATABASE_URL`: Primary PostgreSQL connection string used by Prisma.
- `DIRECT_URL`: Unpooled PostgreSQL connection string used for migrations.
- `POSTGRES_PRISMA_URL`: Alternative pooled database URL for Vercel Postgres.
- `POSTGRES_URL_NON_POOLING`: Alternative unpooled direct URL for Vercel Postgres.
- `JWT_SECRET`: Secret key used for signing and verifying JSON Web Tokens (mandatory ≥32 characters in production).
- `ALLOW_TEST_SHORTCUTS`: Boolean flag (`"true"`) permitting test shortcuts, test accounts, and relaxed CSP in non-dev environments.
- `ENABLE_QUICK_LOGIN`: Boolean flag (`"true"`/`"false"`) controlling availability of `/api/auth/quick-login`.
- `ENABLE_OTP_DEBUG`: Boolean flag exposing plain OTP codes in API responses for automated testing.
- `SUPER_ADMIN_PHONE`: Canonical phone number identifying the Super Admin user.
- `SUPER_ADMIN_EMAIL`: Email address identifying the Super Admin user.
- `SUPER_ADMIN_IDENTIFIER`: Unified identifier for Super Admin identification.
- `SUPER_ADMIN_PASS`: Default/seed password for Super Admin account.
- `SUPER_ADMIN_NAME`: Display name for Super Admin user.
- `ZARINPAL_MERCHANT_ID`: Merchant identifier for Zarinpal payment gateway integration.

### Runtime Environment Variables Referenced in Code
- `NODE_ENV`: Runtime environment selector (`"production"`, `"development"`, `"test"`).
- `POSTGRES_URL`, `POSTGRES_URL_POOLED`, `DATABASE_URL_POOLED`, `DATABASE_URL_UNPOOLED`: Fallback database URLs checked in `server/db/base.ts`.
- `POSTGRES_HOST`, `PGHOST`, `POSTGRES_USER`, `PGUSER`, `POSTGRES_PASSWORD`, `PGPASSWORD`, `POSTGRES_DATABASE`, `PGDATABASE`, `POSTGRES_PORT`, `PGPORT`: Individual database parameters used to reconstruct connection URL in `server/db/base.ts`.
- `ADMIN_PHONE`, `ADMIN_USERNAME`: Alternative identifier aliases checked in `server/security.ts`.
- `VERCEL`, `VERCEL_ENV`, `NOW_REGION`: Deployment environment detection flags for Vercel serverless platform.
- `AWS_LAMBDA_FUNCTION_NAME`: AWS Lambda serverless execution indicator.
- `JEST_WORKER_ID`, `NODE_TEST_CONTEXT`: Test runner environment detection flags preventing server auto-start during test execution.

---

## 11. Build Status

- **Status**: Passing (`compile_applet` confirmed successful).
- **Client Build**: Vite successfully bundles client assets into `dist/` (`index.html`, JavaScript modules, CSS assets).
- **Server Build**: esbuild bundles `server.ts` into a CommonJS output (`dist/server.cjs`) with `--packages=external` and sourcemap generation.
- **Prisma Generation**: `prisma generate` compiles the Prisma client matching `schema.prisma`.

---

## 12. TypeScript Status

- **Status**: Clean / 0 Errors.
- **Verification Command**: `npm run lint` (`tsc --noEmit`).
- **Configuration**: Strict mode enabled (`"strict": true`, `"noImplicitAny": true`, `"skipLibCheck": true` in `tsconfig.json`).
- All server and client TypeScript source files compile with 0 type diagnostics.

---

## 13. ESLint Status

- **Status**: Not Installed / Not Configured.
- `package.json` does not contain `eslint` or any `@eslint/*` or `@typescript-eslint/*` dependencies.
- No `.eslintrc*` or `eslint.config.*` configuration file exists in the repository root.
- The `npm run lint` script in `package.json` delegates directly to `tsc --noEmit`.

---

## 14. Known TODOs

- **Total Active in Source Code**: 0.
- Regex search across all production source files (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`) returned 0 active `TODO` occurrences.

---

## 15. Known FIXMEs

- **Total Active in Source Code**: 0.
- Regex search across all production source files (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`) returned 0 active `FIXME` occurrences.

---

## 16. Current Risks Discovered

1. **In-Memory Rate Limiter on Multi-Instance / Serverless**:
   `rateLimitStore` in `server/middleware/security.ts` uses an in-process JavaScript `Map`. In a scaled, multi-container, or serverless deployment (such as Vercel serverless functions or horizontally autoscaled Cloud Run containers), rate limiting counters are not shared across instances and are reset upon instance termination or cold start.

2. **Production Fail-Closed on Unconfigured Payment Provider**:
   `getPaymentAdapter()` in `server/payment/adapter.ts` strictly returns `null` in production unless an explicit live provider adapter is registered. In production environments where real Zarinpal gateway API calls are not yet wired to a production adapter, calling `/api/payment/request` fails closed with an unconfigured provider error.

3. **Production Fail-Closed on Unconfigured SMS Gateway**:
   In production with `ALLOW_TEST_SHORTCUTS=false`, `MockSmsProvider` returns `SMS_GATEWAY_UNCONFIGURED_IN_PRODUCTION` because a live third-party SMS provider (e.g. Kavenegar, Ghasedak, etc.) is not wired into `server/sms/index.ts`.

4. **Dual Component / Bridge File Duplication**:
   The repository contains mirrored component entries across two directory structures: `/src/components/*` and `/src/features/*` (for example, `src/components/AdminView.tsx` which re-exports from `src/features/admin/AdminView.tsx`), as well as duplicate utility files in `/src/utils/*` re-exporting from `/src/sync/*` and `/src/shared/utils/*`. While maintaining backwards compatibility, it maintains duplicate file handles across the project tree.

5. **Client Authentication Token Stored in Browser LocalStorage**:
   The active JWT token is stored in client `localStorage` under the key `bushido_auth_token` (`src/sync/storageUtils.ts`). Any JavaScript code executing on the client origin has read access to this token, though this risk is mitigated by the Content Security Policy configured in `server/middleware/security.ts`.
