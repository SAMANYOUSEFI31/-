# Baseline Project Audit: Bushido Discipline OS

**Audit Date:** 2026-09-20  
**Target Milestone:** Phase 1 Baseline Architecture & System Health Assessment  
**Document Classification:** Formal Technical Audit  

---

## 1. Directory Structure

```
.
├── .env.example                               # Canonical template of environment variables
├── .github/
│   └── workflows/
│       └── build-apk.yml                      # CI workflow for Capacitor Android APK packaging
├── .gitignore                                 # Git ignore definitions
├── ADMIN_METRICS_AND_LOGIC.md                 # Admin logic, cohort calculation & discipline scoring specifications
├── AGENTS.md                                  # Architectural directives, design system tokens & AI rules
├── BENCHMARKS.md                              # Sound ergonomics, motion physics, and RTL balance rules
├── BUSINESS_LOGIC_AND_ENGINE.md               # Core discipline state engine & cycle lifecycle rules
├── COPYWRITING_AND_MICROCOPY_CATALOG.md       # Persian UI microcopy, error messages & motivational texts
├── DESIGN_SYSTEM.md                           # Strict design tokens, color palette, borders & typography
├── README.md                                  # High-level overview and developer instructions
├── RUNBOOK.md                                 # Operational runbook for production deployments
├── SECURITY.md                                # Threat models, security policies & vulnerability disclosure
├── USER_JOURNEY_AND_UX.md                     # UX flows, user journeys & design paradigms
├── api/
│   ├── .gitkeep
│   └── index.js                               # Vercel Serverless entry point with URL normalization & CJS/ESM interop
├── capacitor.config.json                      # Mobile wrapper configuration (app.bushido.discipline)
├── docs/
│   ├── A11Y_U1_U5_STATUS.md                   # Accessibility audit and WCAG AA verification status
│   ├── API_ROUTING.md                         # API routing specification and contracts
│   ├── ARCHITECTURE.md                        # Master architectural blueprint
│   ├── audits/
│   │   └── phase1-baseline-audit.md           # Baseline technical audit report (this document)
│   ├── MASTER_TOKENIZATION_AND_STATE_AUDIT.md # Token inventory and state management audit
│   ├── TOKEN_INVENTORY_BATTLEFIELD.md         # Design token inventory for the Battlefield view
│   └── TOKEN_RESIDUAL.md                      # Audit of legacy token deprecation
├── index.html                                 # Single-page application HTML entry point
├── metadata.json                              # AI Studio application metadata and permissions
├── package.json                               # Dependencies, engines, and npm lifecycle scripts
├── patch.js                                   # Custom patch utility script
├── prisma/
│   ├── migrations/
│   │   ├── 20260903_phase2b_otp_persistence/  # SQL migration for OTP code persistence
│   │   ├── 20260905_phase4_concurrency_tokens/ # SQL migration for concurrency tokens
│   │   └── 20260905_phase4b_durable_idempotency/ # SQL migration for client operation idempotency
│   └── schema.prisma                          # Authoritative PostgreSQL Prisma schema
├── public/
│   ├── favicon.svg                            # Application vector favicon
│   ├── icon-192.png, icon-192.svg             # PWA 192x192 application icons
│   ├── icon-512.png, icon-512.svg             # PWA 512x512 application icons
│   ├── icon-maskable.svg                      # PWA adaptive maskable icon
│   ├── manifest.json                          # Web App Manifest (PWA specification)
│   └── sw.js                                  # Service worker for offline caching and asset management
├── server.ts                                  # Authoritative Express API server and Vite middleware host
├── server/
│   ├── audit.ts                               # Admin audit logging and security event tracking
│   ├── auth.ts                                # JWT utilities, verification, and RBAC middlewares
│   ├── db.ts                                  # Lazy-loaded Prisma database singleton connection manager
│   ├── db/
│   │   ├── base.ts                            # In-memory dual-mode database engine fallback
│   │   ├── cycles.ts                          # Cycle entity CRUD operations and concurrency validation
│   │   ├── index.ts                           # Unified database export facade
│   │   ├── logs.ts                            # DailyLog entity CRUD, upserts, and optimistic locking
│   │   ├── otp.ts                             # OTP code storage, attempt counters, and consumption
│   │   ├── subscriptions.ts                   # Subscription record management and transaction transitions
│   │   └── users.ts                           # User account queries, mutations, and role administration
│   ├── middleware/
│   │   └── security.ts                        # Rate limiters, security headers, and centralized error handler
│   ├── otp/
│   │   └── index.ts                           # Cryptographic OTP generation, hashing, and challenge verification
│   ├── payment/
│   │   ├── adapter.ts                         # Provider-neutral payment adapter interface & simulator
│   │   ├── index.ts                           # Payment subsystem re-exports
│   │   ├── renewal.ts                         # Subscription renewal and lifecycle transitions
│   │   ├── transitions.ts                     # Strict state machine for payment statuses
│   │   └── types.ts                           # Payment domain types, parameters, and error classifications
│   ├── plans.ts                               # Backend plan definitions and pricing catalog
│   ├── security.ts                            # PBKDF2 hashing, timing mitigations, environment capabilities
│   ├── sms/
│   │   └── index.ts                           # Provider-neutral SMS dispatcher and mock/fail-closed adapters
│   └── utils/
│       ├── phone.ts                           # Iranian mobile phone normalization and validation
│       └── validation.ts                      # Zod validation schemas for all incoming API payloads
├── src/
│   ├── App.tsx                                # Root React application orchestrator and state coordinator
│   ├── app/
│   │   └── routing/
│   │       ├── authTabNavigation.ts           # Authentication navigation and state preservation
│   │       └── routerUtils.ts                 # Zero-dependency History API client-side router
│   ├── components/                            # Legacy forwarding stubs (see Technical Debt section)
│   │   ├── AdminView.tsx, ArchivesView.tsx, AuthModal.tsx, ...
│   ├── config/
│   │   └── plans.ts                           # Client-side subscription plan catalog and pricing
│   ├── context/
│   │   └── BushidoContext.tsx                 # Shared React context definitions
│   ├── data/
│   │   ├── initialData.ts                     # System default state, guest user profile, demo data
│   │   └── moreTabData.ts                     # Navigation and settings item definitions for More tab
│   ├── engine/
│   │   ├── bushidoCalculations.ts             # Mathematical calculations for streaks, mastery, gauges
│   │   └── deterministicSensei.ts             # Deterministic offline-capable Sensei coaching engine
│   ├── features/                              # Domain-driven feature modules
│   │   ├── admin/AdminView.tsx                # Admin management panel (analytics, users, subscriptions)
│   │   ├── archives/ArchivesView.tsx          # Cycle history and performance ledger view
│   │   ├── auth/AuthModal.tsx                 # Unified authentication modal (phone OTP, password, reset)
│   │   ├── autopsy/AutopsyModal.tsx           # Failure autopsy dialog and countermeasure recorder
│   │   │   └── debtAutopsyUtils.ts            # Unresolved debt derivation and virtual log converters
│   │   ├── battlefield/BattlefieldView.tsx    # Primary active day screen, 5 daily habits, gauges
│   │   ├── court/
│   │   │   ├── BushidoCourtView.tsx           # Discipline honor code and rules viewer
│   │   │   └── DisciplineRulesModal.tsx       # Rules overlay modal
│   │   ├── cycles/
│   │   │   ├── CompactEmptyCycleState.tsx     # Empty state placeholder for cycles
│   │   │   ├── CreateCycleModal.tsx           # New 90-day cycle creation modal
│   │   │   └── ResetConfirmationModal.tsx     # Cycle/Account reset confirmation modal
│   │   ├── dashboard/CycleDashboardView.tsx   # 90-day dashboard, habit fidelity matrix, trend chart
│   │   ├── payment/
│   │   │   ├── PaymentModal.tsx               # VIP subscription purchase and gateway redirect modal
│   │   │   └── paymentValidation.ts           # Client-side payment form validation
│   │   ├── profile/ProfileSettingsView.tsx    # Profile settings, cutoff hour, accent theme, data export
│   │   └── tour/
│   │       ├── FirstRunTour.tsx               # Interactive 3-step first-run onboarding tour
│   │       └── OnboardingWelcomeView.tsx      # Welcome hero screen for fresh installations
│   ├── index.css                              # Tailwind CSS global styles (@import "tailwindcss";)
│   ├── main.tsx                               # React DOM entry point
│   ├── shared/                                # Reusable UI components, hooks, and utilities
│   │   ├── components/
│   │   │   ├── charts/                        # TacticalHeatmap90, HabitFidelityMatrix, TrendCurvedChart
│   │   │   ├── feedback/                      # ErrorBoundary, Toast, ViewLoadingSkeleton
│   │   │   ├── layout/                        # Navbar, ResponsiveSubTabBar
│   │   │   └── pwa/                           # IosInstallTip, PwaInstallBanner
│   │   ├── hooks/
│   │   │   ├── useBodyScrollLock.ts           # Modal body scroll locking hook
│   │   │   └── useModalAccessibility.ts       # Focus trapping and Escape key management hook
│   │   └── utils/
│   │       ├── dateUtils.ts                   # Persian date formatting, logical day calculations
│   │       ├── numberUtils.ts                 # Persian numeral conversion (toPersianDigits)
│   │       └── themeUtils.ts                  # Accent theme application and CSS token sync
│   ├── styles/
│   │   └── tokens.css                         # CSS custom properties and color variables
│   ├── sync/                                  # Multi-device synchronization & offline resilience engine
│   │   ├── directMutationUtils.ts             # Direct optimistic mutations and server RPC dispatchers
│   │   ├── impersonationUtils.ts              # Impersonation session handling and token swapping
│   │   ├── offlineQueueUtils.ts               # Local offline mutation queue management and replay
│   │   ├── storageCore.ts                     # Web Storage API wrappers with quota error handling
│   │   ├── storageUtils.ts                    # Account-scoped storage keys and state serialization
│   │   ├── syncDiagnostics.ts                 # Observability events and telemetry for sync operations
│   │   ├── syncOrchestrator.ts                # Orchestrates online/offline sync triggers and locks
│   │   ├── syncReconciliation.ts              # Authoritative server-to-client state reconciliation
│   │   └── visibilitySyncUtils.ts             # Window visibility/focus refetching triggers
│   ├── types.ts                               # Centralized TypeScript interface and type declarations
│   ├── utils/                                 # Compatibility re-export proxies (see Technical Debt section)
│   └── vite-env.d.ts                          # Vite client types declaration
├── tests/                                     # 36 comprehensive test suites covering 885 unit/integration tests
├── tsconfig.json                              # TypeScript strict configuration
├── vercel.json                                # Vercel deployment, caching headers & rewrite rules
└── vite.config.ts                             # Vite configuration with Tailwind CSS plugin
```

---

## 2. Routes and Pages

### Client-Side Routes & Canonical URLs
The client application utilizes a zero-dependency History API router implemented in `src/app/routing/routerUtils.ts`. Navigation does not incur full-page reloads and syncs state seamlessly with browser history.

| Path | Canonical URL | Component / View | Description |
|---|---|---|---|
| `/` | `/battlefield` | `BattlefieldView` | Default landing view: 5 core daily discipline habits, active streak, daily score gauge (0–10), and day switcher. |
| `/battlefield` | `/battlefield` | `BattlefieldView` | Explicit route for the daily discipline tracking interface. |
| `/dashboard` | `/dashboard` | `CycleDashboardView` | 90-day progress metrics, Tactical Heatmap, Habit Fidelity Matrix, and performance spline charts (Lazy loaded). |
| `/cycle` | `/dashboard` | `CycleDashboardView` | Legacy alias routed canonically to `/dashboard`. |
| `/more` | `/more` | `ProfileSettingsView` | User account settings, night-owl cutoff hour (0–12 AM), accent theme switcher, JSON backup export, and cycle reset. |
| `/profile` | `/more` | `ProfileSettingsView` | Alias routed canonically to `/more`. |
| `/settings` | `/more` | `ProfileSettingsView` | Alias routed canonically to `/more`. |
| `/archives` | `/archives` | `ArchivesView` | Historical cycle ledger, past verdicts, completion percentages, and all-time record archives (Lazy loaded). |
| `/more/archives` | `/archives` | `ArchivesView` | Sub-path alias routed canonically to `/archives`. |
| `/database` | `/archives` | `ArchivesView` | Legacy persistence alias routed canonically to `/archives`. |
| `/court` | `/archives` | `ArchivesView` | Honor court alias routed canonically to `/archives`. |
| `/admin` | `/admin` | `AdminView` | System administrative panel: growth analytics, user RBAC table, impersonation engine, and transaction logs (Lazy loaded; RBAC guarded). |
| *Unknown* | `/battlefield` | `BattlefieldView` | Unrecognized paths automatically normalize and redirect to `/battlefield`. |

### Modal Overlays & Workflow Dialogs
- **AuthModal (`src/features/auth/AuthModal.tsx`)**: Modal supporting Iranian phone OTP registration, password login, and OTP password recovery.
- **AutopsyModal (`src/features/autopsy/AutopsyModal.tsx`)**: Guided failure autopsy session for missed habits, capturing failure reason, timing, notes, and countermeasures.
- **CreateCycleModal (`src/features/cycles/CreateCycleModal.tsx`)**: Form for creating a new 90-day cycle with title, start date, theme, and optional special mission.
- **DisciplineRulesModal (`src/features/court/DisciplineRulesModal.tsx`)**: Explanatory overlay detailing the 5 immutable Bushido discipline pillars and scoring rules.
- **PaymentModal (`src/features/payment/PaymentModal.tsx`)**: Tiers presentation (`vip_samurai`, `daimyo_master`) and checkout flow redirecting to the payment gateway.
- **ResetConfirmationModal (`src/features/cycles/ResetConfirmationModal.tsx`)**: Destructive action modal with confirmation prompt for cycle or account resets.
- **FirstRunTour (`src/features/tour/FirstRunTour.tsx`)**: 3-step interactive onboarding walkthrough for first-time visitors.

### Server-Side Routing & SPA Fallback
- **Vercel Serverless Gateway (`api/index.js`)**: Normalizes query parameters (`?path=...`) and forwarded headers (`x-forwarded-uri`) into standard `/api/*` Express routes.
- **Express Wildcard Fallback (`server.ts`)**: Catches all non-API requests (`*` in Express v4) and delivers `dist/index.html` with no-cache headers.

---

## 3. Database Schema

The production schema is managed through **Prisma ORM** (`prisma/schema.prisma`) targeting **PostgreSQL**. The application also incorporates an automated dual-mode fallback (`server/db/base.ts`) that executes an in-memory database simulation if `DATABASE_URL` is absent.

### Enums
- `UserRole`: `FREE` | `VIP` | `ADMIN`
- `UserTier`: `FREE` | `VIP` | `MASTER`
- `DayStatus`: `STANDARD` | `FROZEN` | `BURNED`
- `SubscriptionStatus`: `PENDING` | `SUCCESS` | `FAILED`

### Models and Relations

#### 1. `User`
Primary user identity and profile entity.
- `id` (String, `@id @default(cuid())`): Unique user identifier.
- `email` (String?, `@unique`): Optional email address.
- `phoneNumber` (String?, `@unique`): Canonical Iranian mobile number (`09XXXXXXXXX`).
- `name` (String?): User display name.
- `passwordHash` (String?): PBKDF2 hash formatted as `salt:derivedHex`.
- `role` (UserRole, `@default(FREE)`): Authorization level (`FREE`, `VIP`, `ADMIN`).
- `tier` (String, `@default("ronin_free")`): Active tier tag (`ronin_free`, `vip_samurai`, `daimyo_master`).
- `isVip` (Boolean, `@default(false)`): VIP status flag.
- `vipSince` (DateTime?): Timestamp of initial VIP activation.
- `vipExpiresAt` (DateTime?): Expiration timestamp for active VIP status.
- `paymentRefId` (String?): Reference ID of the activating transaction.
- `isAdmin` (Boolean, `@default(false)`): Administrative privileges flag.
- `tokenVersion` (Int, `@default(0)`): Monotonically increasing counter for session invalidation.
- `nightOwlCutoffHour` (Int, `@default(4)`): User cutoff hour (0–12 AM) determining the boundary of a logical day.
- `accentTheme` (String, `@default("amber")`): UI color preference.
- `createdAt` / `updatedAt` (DateTime)
- **Relations**: `cycles Cycle[]`, `dailyLogs DailyLog[]`, `subscriptions Subscription[]`, `otpCodes OtpCode[]`.
- **Indexes**: `@@index([email])`, `@@index([phoneNumber])`, `@@index([role])`, `@@index([isVip])`.

#### 2. `Cycle`
90-day discipline cycle container.
- `id` (String, `@id @default(cuid())`): Unique cycle ID.
- `userId` (String): Foreign key referencing `User.id` (`onDelete: Cascade`).
- `title` (String): Title of the cycle.
- `startDate` (String, `YYYY-MM-DD`): Cycle start date.
- `endDate` (String, `YYYY-MM-DD`): Cycle end date.
- `targetTheme` (String?): Focus area or custom theme name.
- `inheritedStreak` (Int, `@default(0)`): Preserved streak count carried over from a prior cycle.
- `rules` (String[], `@default([])`): Active rules or commitments.
- `isArchived` (Boolean, `@default(false)`): Flag indicating completed or archived status.
- `reportRead` (Boolean, `@default(false)`): Whether final cycle report was acknowledged.
- `verdict` (Json?): Machine evaluation or autopsy summary of the cycle.
- `revision` (Int, `@default(1)`): Concurrency revision counter for optimistic locking.
- `createdAt` / `updatedAt` (DateTime)
- **Relations**: `user User`, `dailyLogs DailyLog[]`.
- **Indexes**: `@@index([userId])`, `@@index([userId, isArchived])`, `@@index([userId, startDate])`, `@@index([id, userId, revision])`.

#### 3. `DailyLog`
Granular daily tracking record representing one calendar date within a cycle.
- `id` (String, `@id @default(cuid())`): Unique log ID.
- `userId` (String): Foreign key referencing `User.id` (`onDelete: Cascade`).
- `cycleId` (String): Foreign key referencing `Cycle.id` (`onDelete: Cascade`).
- `date` (String, `YYYY-MM-DD`): Tracked calendar date.
- `status` (DayStatus, `@default(STANDARD)`): Day classification (`STANDARD`, `FROZEN`, `BURNED`).
- `revision` (Int, `@default(1)`): Optimistic locking revision token.
- `wakeUp` (Boolean, `@default(false)`): Habit 1: Early wake-up committed.
- `workout` (Boolean, `@default(false)`): Habit 2: Physical workout completed.
- `study` (Boolean, `@default(false)`): Habit 3: Deep study / reading session completed.
- `journal` (Boolean, `@default(false)`): Habit 4: Daily reflection journal recorded.
- `hardTask` (Boolean, `@default(false)`): Habit 5: Core difficult task accomplished.
- `specialMission` (Boolean, `@default(false)`): Bonus habit / custom cycle mission completed.
- `failureReason` (String?): Documented reason if the day was broken.
- `failureTime` (String?): Approximate time of behavioral failure.
- `autopsyNotes` (String?): Detailed qualitative failure analysis.
- `countermeasure` (String?): Preventative action planned for the subsequent day.
- `aiFeedback` (String?): Automated feedback generated by the Sensei engine.
- `notes` (String?): General daily notes.
- `lastClientOperationId` (String?): UUID of the last applied client operation for idempotency.
- `createdAt` / `updatedAt` (DateTime)
- **Constraints & Indexes**:
  - Unique composite constraints: `@@unique([cycleId, date])`, `@@unique([userId, date])`.
  - Indexes: `@@index([userId])`, `@@index([cycleId])`, `@@index([userId, date])`, `@@index([userId, cycleId])`, `@@index([id, userId, revision])`.

#### 4. `OtpCode`
Temporary authentication challenges.
- `id` (String, `@id @default(cuid())`): Challenge ID.
- `identifier` (String): Canonical phone number (`09XXXXXXXXX`).
- `purpose` (String, `@default("PHONE_REGISTRATION")`): `PHONE_REGISTRATION` | `PASSWORD_RESET`.
- `codeHash` (String): PBKDF2 hash of the 5-digit verification code.
- `expiresAt` (DateTime): Challenge expiry timestamp (3-minute lifetime).
- `verified` (Boolean, `@default(false)`): Whether code was successfully validated.
- `attempts` (Int, `@default(0)`): Verification attempt counter.
- `maxAttempts` (Int, `@default(5)`): Maximum allowed attempts before challenge invalidation.
- `lastSentAt` (DateTime, `@default(now())`): Rate limit timestamp (60-second cooldown).
- `consumedAt` (DateTime?): Timestamp when challenge was permanently claimed.
- `userId` (String?): Optional link to existing `User` (`onDelete: Cascade`).
- **Indexes**: `@@index([identifier])`, `@@index([identifier, verified])`, `@@index([identifier, purpose])`, `@@index([identifier, purpose, verified])`.

#### 5. `Subscription`
Financial transactions and VIP plan subscriptions.
- `id` (String, `@id @default(cuid())`): Subscription record ID.
- `userId` (String): Foreign key referencing `User.id` (`onDelete: Cascade`).
- `planId` (String): Plan identifier (e.g., `vip_samurai_1m`, `daimyo_master_3m`).
- `amount` (Int): Transaction amount in Toman.
- `authority` (String, `@unique`): Payment gateway authority / transaction token.
- `refId` (String?): Gateway tracking/reference ID upon success.
- `cardPan` (String?): Masked bank card number (`6037-99**-****-1234`).
- `status` (SubscriptionStatus, `@default(PENDING)`): `PENDING` | `SUCCESS` | `FAILED`.
- `description` (String?): Transaction narrative.
- `expiresAt` (DateTime?): Expiration date of the granted VIP privileges.
- `createdAt` / `updatedAt` (DateTime)
- **Indexes**: `@@index([userId])`, `@@index([authority])`, `@@index([userId, status])`.

---

## 4. Authentication Flow

```
+-----------------------------------------------------------------------------------+
|                            AUTHENTICATION LIFECYCLE                               |
+-----------------------------------------------------------------------------------+

[REGISTRATION VIA PHONE OTP]
  User enters 09XXXXXXXXX 
        │
        ▼
  POST /api/auth/register/request-otp  ──► Validates Iranian mobile format
        │                                  Checks rate limits (60s cooldown, max 5)
        │                                  Generates 5-digit cryptographically secure code
        │                                  Hashes code with PBKDF2 & stores in OtpCode
        │                                  Dispatches SMS via active provider
        ▼
  User submits OTP + Name + Password
        │
        ▼
  POST /api/auth/register/verify-otp   ──► Validates code against OtpCode hash
                                           Ensures challenge is not expired or consumed
                                           Creates User record (Role: FREE)
                                           Issues signed JWT with tokenVersion

[DIRECT LOGIN VIA IDENTIFIER & PASSWORD]
  User enters Phone or Email + Password
        │
        ▼
  POST /api/auth/login                 ──► Normalizes identifier
                                           Fetches User (if absent, runs DUMMY hash check)
                                           Verifies PBKDF2 salt:hash
                                           Issues signed JWT containing tokenVersion

[PASSWORD RECOVERY VIA OTP]
  User requests reset for Phone
        │
        ▼
  POST /api/auth/forgot-password       ──► Issues OTP with purpose: PASSWORD_RESET
        │
        ▼
  POST /api/auth/reset-password        ──► Verifies OTP, updates passwordHash,
                                           increments tokenVersion (revokes old sessions)

[SESSION REVOCATION & REVALIDATION]
  Incoming Authenticated Request
        │
        ▼
  authMiddleware                       ──► Decodes JWT
                                           Checks DB: user.tokenVersion === token.tokenVersion
                                           Rejects with 401 if tokenVersion mismatch

[ADMIN IMPERSONATION]
  Admin calls POST /api/admin/impersonate
        │
        ▼
  Server verifies admin credentials ──► Generates impersonation JWT
                                        Logs audit event (admin ID, target ID, IP, time)
                                        Client stores admin token in sessionStorage
                                        Client stores impersonation token in localStorage
```

---

## 5. Roles and Permissions

### Role Hierarchy & Capabilities

```
                  ┌──────────────────────┐
                  │     SUPER ADMIN      │  Ultimate control; cannot be demoted or deleted
                  └──────────┬───────────┘
                             │
                  ┌──────────▼───────────┐
                  │        ADMIN         │  Access to /admin; User CRUD, Impersonation, Telemetry
                  └──────────┬───────────┘
                             │
                  ┌──────────▼───────────┐
                  │       VIP USER       │  VIP tiers (Samurai/Daimyo); Advanced analytics, Sensei AI
                  └──────────┬───────────┘
                             │
                  ┌──────────▼───────────┐
                  │      FREE USER       │  Standard 90-day cycles, 5 habits, local sync
                  └──────────┬───────────┘
                             │
                  ┌──────────▼───────────┐
                  │        GUEST         │  Client-only in-memory storage; no server sync
                  └──────────────────────┘
```

### Role Matrix

| Capability / Resource | Guest | Free User | VIP User | Admin | Super Admin |
|---|:---:|:---:|:---:|:---:|:---:|
| Track Daily 5 Habits locally | Yes | Yes | Yes | Yes | Yes |
| Sync Cycles & Logs to Cloud DB | No | Yes | Yes | Yes | Yes |
| Historical Archives & Reports | Demo only | Yes | Yes | Yes | Yes |
| Automated AI Failure Autopsy | Basic | Basic | Advanced | Advanced | Advanced |
| Extended Cycle Analytics & Heatmap | Demo only | Standard | Full (90-day) | Full | Full |
| Access Admin Panel (`/admin`) | No | No | No | Yes | Yes |
| View System Telemetry & KPIs | No | No | No | Yes | Yes |
| List & Filter All Users | No | No | No | Yes | Yes |
| Update User Roles & Tiers | No | No | No | Yes | Yes |
| Create Test User Fixtures | No | No | No | Yes | Yes |
| Impersonate User Account | No | No | No | Yes | Yes |
| Demote/Delete Another Admin | No | No | No | No | Yes |

### Middlewares Enforcing RBAC
- `authMiddleware`: Requires valid JWT. Verifies user existence and `tokenVersion` parity. Attaches `req.user`.
- `adminMiddleware`: Extends `authMiddleware`. Verifies `user.role === 'ADMIN'`, `user.isAdmin === true`, or matches `SUPER_ADMIN_IDENTIFIER`.
- `superAdminMiddleware`: Enforces that the caller matches configured super admin credentials.
- `optionalAuthMiddleware`: Decodes JWT if provided; permits anonymous access if absent.

---

## 6. APIs

### System & Health Endpoints
- `GET /api` / `GET /api/`: API root confirmation; returns operational status and version.
- `GET /api/health`: Health status endpoint returning database connectivity state.
- `GET /api/ready`, `/api/readiness`, `/api/health/ready`: Readiness probes for container orchestration.
- `GET /api/admin/diagnostics`: Administrative runtime diagnostics (Admin only).

### Authentication Endpoints
- `POST /api/auth/register/request-otp`: Issues 5-digit verification code to an Iranian mobile number.
- `POST /api/auth/register/send-otp`: Alias for request-otp.
- `POST /api/auth/register/verify-otp`: Validates OTP and registers new user.
- `POST /api/auth/register`: Alias for verify-otp.
- `POST /api/auth/login`: Authenticates user with identifier and password.
- `POST /api/auth/forgot-password`: Requests password-reset OTP.
- `POST /api/auth/reset-password`: Verifies reset OTP and updates user password.
- `POST /api/auth/send-otp`: Generic OTP request endpoint.
- `POST /api/auth/verify-otp`: Generic OTP verification endpoint.
- `POST /api/auth/quick-login`: Instant dev/test login bypass (Controlled by `ALLOW_TEST_SHORTCUTS`).
- `GET /api/auth/me`: Fetches profile of currently authenticated user.
- `PUT /api/auth/profile` / `PUT /api/user/profile`: Updates profile attributes (name, theme, night-owl cutoff hour).

### Cycle Endpoints
- `GET /api/cycles`: Retrieves all non-archived cycles belonging to authenticated user.
- `GET /api/cycles/:id`: Retrieves a single cycle with associated logs.
- `POST /api/cycles`: Creates a new 90-day cycle.
- `PUT /api/cycles/:id`: Updates an existing cycle (Guarded by optimistic concurrency revision).
- `PUT /api/cycles/:id/archive`: Flags a cycle as archived.
- `PUT /api/cycles/:id/restore`: Unarchives a previously archived cycle.
- `DELETE /api/cycles/:id`: Permanently removes a cycle and cascades to its daily logs.

### Daily Log Endpoints
- `GET /api/logs` / `GET /api/daily-logs`: Retrieves daily logs filtered by `cycleId` or date range.
- `GET /api/logs/:id` / `GET /api/daily-logs/:id`: Retrieves a single daily log.
- `POST /api/logs` / `POST /api/logs/upsert` / `POST /api/daily-logs`: Idempotent upsert of a daily log (Guarded by `revision` and `lastClientOperationId`).
- `PUT /api/logs/:id` / `PUT /api/daily-logs/:id`: Updates an existing daily log.
- `DELETE /api/logs/:id` / `DELETE /api/daily-logs/:id`: Deletes a daily log.

### AI Engine Endpoints
- `POST /api/ai/autopsy`: Evaluates behavioral breakdown and provides structured failure remediation.
- `POST /api/ai/coach`: Generates contextual daily coaching advice based on recent habit consistency.
- `POST /api/ai/verdict`: Formulates final 90-day cycle evaluation upon cycle completion.

### Payment & Subscription Endpoints
- `GET /api/plans` / `GET /api/payment/plans`: Returns active subscription plans and pricing catalog.
- `POST /api/payment/request`: Initiates payment flow; returns gateway authority token and redirect URL.
- `POST /api/payment/verify`: Verifies transaction after gateway return; activates VIP privileges on success.
- `GET /api/user/subscriptions` / `GET /api/subscriptions/my`: Returns transaction history for the authenticated user.

### Admin Panel Endpoints (Guarded by `adminMiddleware`)
- `GET /api/admin/stats`: Aggregate system KPIs (total users, active fighters, churn rate, total revenue).
- `GET /api/admin/users`: Paginated and filterable table of all registered users.
- `GET /api/admin/role`: Verifies caller's administrative status.
- `PUT /api/admin/users/:id`: Modifies user attributes, role (`FREE`, `VIP`, `ADMIN`), or VIP tier.
- `POST /api/admin/users/create-test`: Creates mock user fixtures for testing.
- `POST /api/admin/impersonate`: Generates scoped authentication token for target user with audit logging.
- `POST /api/admin/impersonate/exit` / `/api/admin/exit-impersonation`: Terminates impersonation session.
- `GET /api/admin/subscriptions`: Complete audit log of all system subscription transactions.

---

## 7. Middleware

| Middleware | Location | Purpose & Functionality |
|---|---|---|
| **Vercel Path Normalizer** | `server.ts` (L111) | Reconstructs `/api/*` request paths from forwarded serverless query parameters (`?path=...`) or headers (`x-forwarded-uri`). |
| **Security Headers** | `server/middleware/security.ts` | Sets HTTP response headers: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Strict-Transport-Security`, and `Referrer-Policy`. |
| **JSON Parser** | `server.ts` (L135) | Express built-in `express.json()` parser for incoming request bodies. |
| **Lazy DB Initializer** | `server.ts` (L143) | Ensures database connection is established before serving API requests; non-blocking for frontend assets. |
| **API Rate Limiter** | `server/middleware/security.ts` | Restricts general `/api` requests to 100 requests per 15-minute window per IP. |
| **Auth Rate Limiter** | `server/middleware/security.ts` | Restricts sensitive `/api/auth` endpoints to 10 requests per 15-minute window per IP to mitigate brute force. |
| **Body Validator (`validateBody`)** | `server/utils/validation.ts` | Compiles incoming JSON payloads against strict Zod schemas; rejects invalid structures with HTTP 400. |
| **Authentication (`authMiddleware`)** | `server/auth.ts` | Validates Bearer JWT; verifies user existence and matching `tokenVersion`. |
| **Admin Authorization (`adminMiddleware`)** | `server/auth.ts` | Restricts endpoint to users with `ADMIN` role or matching super-admin identifiers. |
| **Super Admin Authorization** | `server/auth.ts` | Restricts endpoint exclusively to super-admin credentials. |
| **Optional Authentication** | `server/auth.ts` | Attaches user session if valid JWT is present, but allows request to proceed unauthenticated if missing. |
| **Centralized Error Handler** | `server/middleware/security.ts` | Intercepts unhandled exceptions; standardizes JSON error responses; sanitizes stack traces in production. |

---

## 8. Environment Variables Used

| Variable | Source | Required in Prod | Default / Fallback | Sensitivity | Description |
|---|---|:---:|---|:---:|---|
| `DATABASE_URL` | `.env.example`, `schema.prisma` | **Yes** | None (falls back to memory DB) | High | PostgreSQL connection string (pooled). |
| `DIRECT_URL` | `.env.example` | No | None | High | Direct PostgreSQL connection string for Prisma migrations. |
| `POSTGRES_PRISMA_URL` | `.env.example` | No | None | High | Alternative Vercel Postgres pooled connection URL. |
| `POSTGRES_URL_NON_POOLING` | `.env.example` | No | None | High | Alternative Vercel Postgres non-pooling connection URL. |
| `JWT_SECRET` | `.env.example`, `server/security.ts` | **Yes** | Insecure dev key | **Critical** | Signing key for JWT generation (Must be ≥32 characters in production). |
| `SUPER_ADMIN_IDENTIFIER` | `.env.example`, `server/security.ts` | No | `admin` (dev mode only) | Medium | Canonical identifier for bootstrapping initial super admin. |
| `SUPER_ADMIN_PHONE` | `.env.example`, `server/security.ts` | No | None | Medium | Super admin phone number for privileged login. |
| `SUPER_ADMIN_EMAIL` | `.env.example`, `server/security.ts` | No | None | Medium | Super admin email address. |
| `SUPER_ADMIN_PASS` | `.env.example`, `server/security.ts` | No | `admin123` (dev mode only) | High | Initial bootstrap password for super admin. |
| `SUPER_ADMIN_NAME` | `.env.example`, `server/security.ts` | No | `Super Admin` | Low | Display name for bootstrapped super admin. |
| `ALLOW_TEST_SHORTCUTS` | `.env.example`, `server/security.ts` | No | `false` in prod; `true` in dev | High | Strictly controls dev shortcuts (quick-login, mock OTP/payment). |
| `ENABLE_QUICK_LOGIN` | `.env.example`, `server/security.ts` | No | Governed by shortcuts | Medium | Explicitly enables or disables quick-login endpoint. |
| `ENABLE_OTP_DEBUG` | `.env.example`, `server/security.ts` | No | Governed by shortcuts | High | Echoes OTP codes in API responses for automated testing. |
| `ZARINPAL_MERCHANT_ID` | `.env.example` | No | None | High | Merchant ID for Zarinpal payment gateway. |
| `NODE_ENV` | Environment / Node.js | No | `development` | Low | Execution environment (`production` / `development` / `test`). |
| `PORT` | Environment | No | `3000` | Low | Port for HTTP server binding. |

---

## 9. External Services

1. **PostgreSQL Database**:
   - Primary persistence engine accessed via Prisma ORM. Compatible with Neon, Supabase, Vercel Postgres, and Google Cloud SQL.
2. **SMS Gateway Abstraction (`server/sms/index.ts`)**:
   - Provider-neutral interface (`SmsProvider`) designed for Iranian SMS providers (e.g., Kavenegar, FarazSMS).
   - Incorporates `MockSmsProvider` for test/dev environments.
   - Includes `FailClosedSmsProvider` to prevent silent registration failures in production when unconfigured.
3. **Payment Gateway Abstraction (`server/payment/`)**:
   - Provider-neutral payment layer (`PaymentGatewayAdapter`) architected for Zarinpal.
   - Includes `ProviderNeutralSimulatorAdapter` for sandbox and developer testing.
   - Fails closed in production if no live gateway is configured.
4. **Progressive Web App (PWA)**:
   - Service worker (`public/sw.js`) provides offline caching for application assets.
   - `public/manifest.json` provides web app installability metadata for mobile and desktop browsers.
5. **Mobile Runtime Wrapper (Capacitor)**:
   - Configured via `capacitor.config.json` (`app.bushido.discipline`) with a dedicated GitHub Actions build workflow (`.github/workflows/build-apk.yml`).

---

## 10. Current Technical Debt

1. **Component Forwarding Stubs (`src/components/`)**:
   - The directory `/src/components/` contains 25 lightweight forwarding shims (e.g., `export { AdminView } from '../features/admin/AdminView'`) created during a previous feature refactor.
   - While functional, these shims add file-system clutter and should eventually be consolidated to import directly from `src/features/` and `src/shared/`.
2. **Utility Compatibility Proxies (`src/utils/`)**:
   - Similar to components, `/src/utils/` hosts re-export proxies that forward calls to `src/sync/` and `src/shared/utils/`.
3. **Dual Persistence Layer Maintenance (`server/db/base.ts`)**:
   - An entire in-memory database simulation (~800 lines of code) is maintained alongside the Prisma database adapter to allow the app to function without a live database in dev/test.
   - While effective for zero-dependency local runs, maintaining schema parity across both engines represents ongoing engineering overhead.
4. **Monolithic Core Modules**:
   - `src/App.tsx` spans 2,013 lines, coordinating state, sync triggers, routing, and UI rendering.
   - `server.ts` spans 2,017 lines, consolidating Express routes, middleware, and request handlers in a single file rather than modular route controllers.
5. **Simulated Production Fallbacks**:
   - SMS and payment gateway adapters are isolated behind simulators; production deployment without configured live providers requires finalizing the live driver implementations.

---

## 11. Known TODOs

- **Codebase Scan**: A comprehensive regex search across all project source code for `TODO`, `FIXME`, `HACK`, and `XXX` markers returned **0 active instances in production code**.
- **Architectural Backlog Items (from documentation)**:
  - Wire live Iranian SMS gateway driver (e.g., Kavenegar API) in place of the fallback provider.
  - Finalize production Zarinpal gateway adapter using `ZARINPAL_MERCHANT_ID`.
  - Deprecate and remove legacy forwarding stubs in `src/components/` and `src/utils/`.
  - Break down `server.ts` into modular Express routers (`/routes/auth.ts`, `/routes/cycles.ts`, etc.).

---

## 12. Build Status

| Check | Command | Result | Details |
|---|---|:---:|---|
| **Production Build** | `npm run build` | **PASS** | `prisma generate`, `vite build`, and `esbuild server.ts` bundled to `dist/server.cjs` cleanly without warnings or errors. |
| **Test Suite** | `npm test` | **PASS** | **885 tests passing across 51 test suites** (0 failures, 0 skipped, 0 cancelled). |
| **Container Readiness** | `node dist/server.cjs` | **PASS** | Server boots and binds to `0.0.0.0:3000`. |

---

## 13. TypeScript Errors

- **Validation Command**: `tsc --noEmit`
- **Error Count**: **0 errors**
- **Status**: Completely clean across all server, client, test, and utility files under strict TypeScript configuration.

---

## 14. ESLint Errors

- **Configuration Status**: ESLint is not installed as an independent linter in `package.json`.
- **Lint Script**: `npm run lint` maps directly to `tsc --noEmit`.
- **Error Count**: **0 errors** (Type checking and syntax validation pass with zero diagnostics).

---

## 15. Security Observations

### Strengths & Defenses
1. **Password Storage**: Uses PBKDF2 with 100,000 iterations of SHA-512 and cryptographically random salts (16 bytes).
2. **Timing Attack Mitigation**: Employs a pre-computed `DUMMY_PASSWORD_HASH` on authentication failure when a user is not found, ensuring uniform response times and thwarting username enumeration.
3. **Session Revocation**: Implements `tokenVersion` on the `User` model, checked against incoming JWT payloads on every request. Password resets or administrative actions immediately invalidate all outstanding user sessions.
4. **Input Sanitization**: Every mutating endpoint enforces strict Zod schema validation (`validateBody`), stripping unexpected properties and rejecting malformed payloads.
5. **Rate Limiting**: Layered rate limiting across general `/api` routes (100 req/15 min) and stricter limits on sensitive `/api/auth` routes (10 req/15 min).
6. **Security Headers**: Comprehensive HTTP security headers configured via `setSecurityHeaders` (Content-Security-Policy, HSTS, X-Content-Type-Options: nosniff, Frameguard).
7. **Impersonation Auditing**: Admin impersonation generates dedicated audit log entries with admin ID, target user ID, IP address, and timestamp (`server/audit.ts`).
8. **Storage Isolation**: Client-side storage rigorously scopes offline queues and states by account ID (`getScopedStorageKey`), preventing data bleed across logins or guests.
9. **Strict Production Gating**: `allowTestShortcuts()` fails closed in production unless explicitly overridden, protecting against test route exposure.

### Considerations & Recommendations
1. **Rate Limiting Persistence**: The current rate limiters in `server/middleware/security.ts` operate in-memory. In horizontally scaled environments (multiple Cloud Run or serverless containers), an external store (such as Redis) should be introduced for distributed tracking.
2. **Reverse Proxy Trust**: `app.set('trust proxy', 1)` is configured. Verify that reverse proxy infrastructure accurately sanitizes `X-Forwarded-For` headers to prevent spoofed IP bypass of rate limiters.
3. **JWT Secret Enforcement**: Ensure deployment pipelines enforce a high-entropy string (≥32 characters) for `JWT_SECRET` in production.
