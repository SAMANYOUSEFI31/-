# Bushido Discipline OS — Target Architecture & Staged Folder Map

> **Status:** FOLDER REORGANIZATION ACTIVE (FEATURES, SHARED, SYNC & APP ROUTING MIGRATED)  
> **Current State:** `src/shared/`, `src/features/`, `src/app/routing/`, and `src/sync/` are relocated and fully active in the production codebase. All tests green.  
> **Zero-Regression Invariants:** No unrequested UI redesign. No changes to Vercel API `?path=` serverless routing. No rewrite of sync/offline/tick logic. Pure import path updates per cluster.  
> **Integration Realities (SMS & Payment):** SMS/OTP and Payment (Zarinpal) are implemented as configurable adapter layers (`server/sms/` and `server/payment/`). By default, in local dev, staging, or environments without live external credentials (`ZARINPAL_MERCHANT_ID` / SMS gateway keys), they run in simulated mock/sandbox mode with debug OTP codes and test transactions. They operate as live gateways only when valid external production credentials are explicitly provisioned.

---

## Migration Wave Status & Completed Moves

### A. Completed & Active Moves (In Current Codebase)
1. **Shared Primitives & Hooks (`src/shared/`)**:
   - `src/shared/hooks/`: `useAudioEffects.ts`, `useBodyScrollLock.ts`, `useHaptics.ts`, `useModalAccessibility.ts`.
   - `src/shared/utils/`: `dateUtils.ts`, `numberUtils.ts`, `themeUtils.ts`.
   - `src/shared/components/feedback/`: `Toast.tsx`, `ErrorBoundary.tsx`, `ViewLoadingSkeleton.tsx`.
   - `src/shared/components/layout/`: `Navbar.tsx`, `ResponsiveSubTabBar.tsx`.
   - `src/shared/components/pwa/`: `PwaInstallBanner.tsx`, `IosInstallTip.tsx`.
   - `src/shared/components/charts/`: `TacticalHeatmap90.tsx`, `TrendCurvedChart.tsx`, `HabitFidelityMatrix.tsx`, `ChartLoadingFallback.tsx`.
2. **Domain Features (`src/features/`)**:
   - `src/features/archives/`: `ArchivesView.tsx`.
   - `src/features/profile/`: `ProfileSettingsView.tsx`.
   - `src/features/dashboard/`: `CycleDashboardView.tsx`.
   - `src/features/tour/`: `FirstRunTour.tsx`, `OnboardingWelcomeView.tsx`.
   - `src/features/cycles/`: `CreateCycleModal.tsx`, `ResetConfirmationModal.tsx`, `CompactEmptyCycleState.tsx`.
   - `src/features/battlefield/`: `BattlefieldView.tsx`.
   - `src/features/court/`: `BushidoCourtView.tsx`, `DisciplineRulesModal.tsx`.
   - `src/features/autopsy/`: `AutopsyModal.tsx`, `debtAutopsyUtils.ts`.
   - `src/features/payment/`: `PaymentModal.tsx`, `paymentValidation.ts`.
   - `src/features/auth/`: `AuthModal.tsx`.
   - `src/features/admin/`: `AdminView.tsx`.
3. **Application Routing (`src/app/routing/`)**:
   - `routerUtils.ts`, `authTabNavigation.ts`.
4. **Sync & Storage Engine (`src/sync/`)**:
   - `directMutationUtils.ts`, `offlineQueueUtils.ts`, `storageCore.ts`, `storageUtils.ts`, `syncOrchestrator.ts`, `syncReconciliation.ts`, `syncDiagnostics.ts`, `visibilitySyncUtils.ts`, `impersonationUtils.ts`.
5. **Compatibility Stubs**:
   - Re-export bridges maintained in `src/components/` and `src/utils/` to ensure full backward compatibility across test harnesses and external consumers.

### B. Current Architecture & Deferred Refactorings
1. **Server Route Consolidation (`server.ts`)**:
   - `server.ts` acts as the root Express entrypoint, handling security headers, Vite development middleware, and API dispatching. Routes use helper modules (`server/sms/`, `server/payment/`, `server/otp/`, `server/auth.ts`, `server/security.ts`, `server/audit.ts`).
2. **External Gateway Adapters (SMS/OTP & Zarinpal Payment)**:
   - `server/sms/index.ts`: Pluggable SMS gateway adapter supporting Kavenegar/SMS providers when API credentials are provided; falls back gracefully to sandbox/mock simulation with debug OTP codes for local/staging verification.
   - `server/payment/adapter.ts`: Pluggable Iranian payment gateway adapter supporting Zarinpal REST/sandbox APIs. Operates in local test simulation by default; requires `ZARINPAL_MERCHANT_ID` for live transaction routing.
3. **Internal Component Granularity**:
   - Views (`BattlefieldView.tsx`, `AdminView.tsx`, `AuthModal.tsx`) are structured as coordinated domain features while keeping atomic test assertions completely intact.

---

## 1. Current Pain Points (God Files & Mixed Concerns)

The codebase currently functions reliably with 840+ green tests, robust offline sync, and production database persistence. However, code organization suffers from monolithic files and flat directories:

* **God Component (`src/App.tsx` — ~2,000 lines):**
  * Mixes top-level shell rendering, tab/route dispatching, and modal state management.
  * Embeds offline sync orchestrator initialization, remote visibility catch-up listeners, and account switching state machines.
  * Houses admin impersonation exit flows, tour/onboarding progression, audio FX triggers, and periodic heartbeat timers.
* **Monolithic Backend Server (`server.ts` — ~2,000 lines):**
  * Bundles Express server configuration, Vite dev middleware mounting, and static production serving into a single entry point.
  * Declares 30+ endpoints inline across 6 domains: auth/passwords, SMS/OTP challenges, cycle CRUD/archive, daily log write-ahead upserts, payment gateway handshakes, and admin telemetry.
  * Tightly couples route handling with schema validation, rate limiting, and database error mapping.
* **Flat & Overcrowded Components Directory (`src/components/` — 24 files):**
  * Flattens full-page views (`BattlefieldView`, `CycleDashboardView`, `ArchivesView`, `SenseiView`, `AdminView`) alongside overlay modals (`AuthModal`, `AutopsyModal`, `CreateCycleModal`, `PaymentModal`, `ResetConfirmationModal`, `DisciplineRulesModal`).
  * Intermingles reusable UI primitives (`Navbar`, `ResponsiveSubTabBar`, `Toast`, `ErrorBoundary`) with complex domain charts (`TrendCurvedChart`, `TacticalHeatmap90`, `HabitFidelityMatrix`, `BushidoCourtView`) and platform banners (`PwaInstallBanner`, `IosInstallTip`).
* **Massive View Components:**
  * `BattlefieldView.tsx` (~1,100 lines): Co-locates daily habit tick cards, 10-segment score gauge, day-carousel navigation, coach banner, autopsy prompt triggers, and swipe ergonomics.
  * `AdminView.tsx` (~1,300 lines): Bundles three full dashboards (Growth/Analytics with spline charts & cohorts, User database with RBAC & impersonation, and Financial transaction telemetry) without sub-component boundaries.
  * `CycleDashboardView.tsx` (~700 lines): Combines KPI summaries, 90-day heatmap, radar discipline gauges, target rules, and records in one monolithic file.
* **Flat Utility Directory (`src/utils/` — 21 files):**
  * Mixes low-level mathematical formatters (`numberUtils.ts`, `dateUtils.ts`, `themeUtils.ts`) with browser/DOM tactile hooks (`haptics.ts`, `audioEffects.ts`, `useBodyScrollLock.ts`, `useModalAccessibility.ts`).
  * Placed alongside high-stakes distributed synchronization engines (`storageCore.ts`, `storageUtils.ts`, `offlineQueueUtils.ts`, `directMutationUtils.ts`, `syncOrchestrator.ts`, `syncReconciliation.ts`, `visibilitySyncUtils.ts`, `syncDiagnostics.ts`, `impersonationUtils.ts`).
* **Flat Test Root (`tests/` — 49 test files):**
  * 49 test files reside in a single flat directory without categorization (unit vs. sync concurrency vs. server integration vs. accessibility).
* **Vercel Serverless Fragility:**
  * `api/index.js` relies directly on `../server.ts` or `../dist/server.cjs` and strict Express function export bindings. Moving or refactoring backend files carelessly risks breaking Vercel deployment and `vercel-export-contract.test.ts`.

---

## 2. Target Directory & File Architecture

The target architecture establishes a clean, domain-driven structure while preserving existing runtime contracts, Vercel serverless exports, and Vite/Express bundling rules.

```
bushido-discipline-os/
├── api/
│   ├── index.js                           # Unchanged: Vercel Serverless entrypoint & ?path= normalizer
│   └── .gitkeep
├── docs/                                  # Architectural specifications & audits
│   ├── ARCHITECTURE.md                    # This master map
│   ├── MASTER_TOKENIZATION_AND_STATE_AUDIT.md
│   ├── TOKEN_INVENTORY_BATTLEFIELD.md
│   └── TOKEN_RESIDUAL.md
├── public/                                # Static assets & PWA files
│   ├── icons/                             # Dedicated icon subfolder
│   │   ├── favicon.svg
│   │   ├── icon-192.png
│   │   ├── icon-192.svg
│   │   ├── icon-512.png
│   │   ├── icon-512.svg
│   │   └── icon-maskable.svg
│   ├── manifest.json                      # Web App Manifest
│   └── sw.js                              # Service Worker
├── server/                                # Modular Express Backend
│   ├── audit/                             # Security & impersonation audit logging
│   │   └── index.ts                       # (from server/audit.ts)
│   ├── config/                            # Environment & server settings
│   │   ├── plans.ts                       # (from server/plans.ts)
│   │   └── security.ts                    # (from server/security.ts)
│   ├── db/                                # Prisma repositories & database layer
│   │   ├── base.ts                        # Client connection & fallback in-memory engine
│   │   ├── users.ts                       # User queries & admin mutation helpers
│   │   ├── cycles.ts                      # Cycle repository & archive operations
│   │   ├── logs.ts                        # DailyLog write-ahead & concurrency checks
│   │   ├── otp.ts                         # OTP challenge persistence
│   │   ├── subscriptions.ts               # Subscription repository
│   │   └── index.ts                       # Unified database barrel export
│   ├── middleware/                        # Express middlewares
│   │   ├── auth.ts                        # JWT validation & RBAC (from server/auth.ts)
│   │   └── security.ts                    # Rate limiting, security headers, error handler
│   ├── otp/                               # OTP verification & generation
│   │   └── index.ts
│   ├── payment/                           # Payment gateways & subscription state machine
│   │   ├── adapter.ts
│   │   ├── transitions.ts
│   │   ├── renewal.ts
│   │   ├── types.ts
│   │   └── index.ts
│   ├── routes/                            # Modular Express route clusters
│   │   ├── admin.routes.ts                # /api/admin/* (stats, users, subscriptions)
│   │   ├── auth.routes.ts                 # /api/auth/* (register, login, password, OTP)
│   │   ├── cycles.routes.ts               # /api/cycles/* (CRUD, archive, restore)
│   │   ├── health.routes.ts               # /api/health, /api/db-status
│   │   ├── logs.routes.ts                 # /api/dailylogs/* (upsert, batch, autopsy)
│   │   ├── payment.routes.ts              # /api/payment/* (request, verify)
│   │   └── index.ts                       # Unified router mounting on /api
│   ├── sms/                               # SMS gateway provider
│   │   └── index.ts
│   └── utils/                             # Server utilities
│       ├── phone.ts                       # Iranian mobile normalization
│       └── validation.ts                  # Zod request validation schemas
├── server.ts                              # Slim Express app bootstrap, router mounting & Vite middleware
├── src/
│   ├── app/                               # Core Application Shell & Routing
│   │   ├── App.tsx                        # Slim root shell (composed views & providers)
│   │   └── routing/                       # Client router, path normalizer & active tab state
│   │       ├── routerUtils.ts             # (from src/utils/routerUtils.ts)
│   │       └── authTabNavigation.ts       # (from src/utils/authTabNavigation.ts)
│   ├── context/                           # React Context Providers
│   │   └── BushidoContext.tsx             # Global application state provider
│   ├── engine/                            # Pure Mathematical & Domain Calculations (Zero UI)
│   │   ├── bushidoCalculations.ts         # Scoring, streaks, 10-gauge math, fidelity
│   │   └── deterministicSensei.ts         # Sensei coach deterministic guidance engine
│   ├── features/                          # Domain-Driven Feature Slices
│   │   ├── admin/                         # Admin Telemetry & Management
│   │   │   ├── components/
│   │   │   │   ├── AdminAnalyticsTab.tsx  # Growth, Conversion Funnel, Cohorts, Spline
│   │   │   │   ├── AdminSubscriptionsTab.tsx # Financial KPIs, transactions audit
│   │   │   │   └── AdminUsersTab.tsx      # User directory, RBAC roles, impersonation
│   │   │   └── AdminView.tsx              # Consolidated 3-tab Admin coordinator
│   │   ├── archives/                      # Cycle Archives & Historical Records
│   │   │   └── ArchivesView.tsx
│   │   ├── auth/                          # Authentication & Account Access
│   │   │   ├── components/
│   │   │   │   ├── LoginForm.tsx
│   │   │   │   ├── OtpVerificationForm.tsx
│   │   │   │   └── RegisterForm.tsx
│   │   │   └── AuthModal.tsx              # Coordinated authentication dialog
│   │   ├── autopsy/                       # Failure Autopsy & Debt Settlement
│   │   │   ├── utils/
│   │   │   │   └── debtAutopsyUtils.ts    # (from src/utils/debtAutopsyUtils.ts)
│   │   │   └── AutopsyModal.tsx           # Stoic autopsy examination modal
│   │   ├── battlefield/                   # Core Daily Habit Battlefield
│   │   │   ├── components/
│   │   │   │   ├── BattlefieldHeader.tsx  # Daily score, 10-segment gauge, status pill
│   │   │   │   ├── CoachBanner.tsx        # Sensei callout banner
│   │   │   │   ├── DayCarousel.tsx        # Day switcher & temporal markers
│   │   │   │   └── HabitCard.tsx          # Interactive habit item card
│   │   │   └── BattlefieldView.tsx        # Coordinated Battlefield view
│   │   ├── court/                         # Bushido Court & Disciplinary Rules
│   │   │   ├── BushidoCourtView.tsx
│   │   │   └── DisciplineRulesModal.tsx
│   │   ├── cycles/                        # Cycle Creation & Target Settings
│   │   │   ├── utils/
│   │   │   │   └── cycleValidation.ts     # (from src/utils/cycleValidation.ts)
│   │   │   ├── CompactEmptyCycleState.tsx
│   │   │   ├── CreateCycleModal.tsx
│   │   │   └── ResetConfirmationModal.tsx
│   │   ├── dashboard/                     # 90-Day Tactical Dashboard & Records
│   │   │   ├── components/
│   │   │   │   ├── CycleHeaderCard.tsx
│   │   │   │   ├── DisciplineLevelCard.tsx
│   │   │   │   └── KpiSummaryGrid.tsx
│   │   │   └── CycleDashboardView.tsx     # Coordinated Dashboard view
│   │   ├── payment/                       # VIP Subscriptions & Gateway Interop
│   │   │   ├── utils/
│   │   │   │   └── paymentValidation.ts   # (from src/utils/paymentValidation.ts)
│   │   │   └── PaymentModal.tsx           # VIP upgrade & tier selection dialog
│   │   ├── profile/                       # User Profile & System Preferences
│   │   │   └── ProfileSettingsView.tsx
│   │   ├── sensei/                        # Sensei Wisdom & Guide
│   │   │   └── SenseiView.tsx
│   │   └── tour/                          # Onboarding & First-Run Walkthrough
│   │       ├── FirstRunTour.tsx
│   │       └── OnboardingWelcomeView.tsx
│   ├── shared/                            # Shared Cross-Feature Primitives
│   │   ├── components/                    # Reusable Presentation Components
│   │   │   ├── charts/
│   │   │   │   ├── ChartLoadingFallback.tsx
│   │   │   │   ├── HabitFidelityMatrix.tsx
│   │   │   │   ├── TacticalHeatmap90.tsx
│   │   │   │   └── TrendCurvedChart.tsx
│   │   │   ├── feedback/
│   │   │   │   ├── ErrorBoundary.tsx
│   │   │   │   ├── Toast.tsx
│   │   │   │   └── ViewLoadingSkeleton.tsx
│   │   │   ├── layout/
│   │   │   │   ├── Navbar.tsx
│   │   │   │   └── ResponsiveSubTabBar.tsx
│   │   │   └── pwa/
│   │   │       ├── IosInstallTip.tsx
│   │   │       └── PwaInstallBanner.tsx
│   │   ├── hooks/                         # Tactical UI & DOM Hooks
│   │   │   ├── useAudioEffects.ts         # (from src/utils/audioEffects.ts)
│   │   │   ├── useBodyScrollLock.ts       # (from src/utils/useBodyScrollLock.ts)
│   │   │   ├── useHaptics.ts              # (from src/utils/haptics.ts)
│   │   │   └── useModalAccessibility.ts   # (from src/utils/useModalAccessibility.ts)
│   │   └── utils/                         # Pure Universal Helper Functions
│   │       ├── dateUtils.ts               # Date math, Jalali conversion, logical today
│   │       ├── numberUtils.ts             # Persian digit conversion & number formatting
│   │       └── themeUtils.ts              # Accent theme tokens & CSS custom property application
│   ├── sync/                              # Critical Persistence & Sync Engine (HIGH SENSITIVITY)
│   │   ├── directMutationUtils.ts         # Optimistic client mutations & write-ahead execution
│   │   ├── impersonationUtils.ts          # Admin session swapping & credential isolation
│   │   ├── offlineQueueUtils.ts           # Offline mutation queue storage & conflict detection
│   │   ├── storageCore.ts                 # Atomic scoped localStorage/sessionStorage engine
│   │   ├── storageUtils.ts                # Account state transitions & state persistence
│   │   ├── syncDiagnostics.ts             # Observability event emission & telemetry
│   │   ├── syncOrchestrator.ts            # Lock-guarded sync lifecycle & background pull
│   │   ├── syncReconciliation.ts          # Remote boot state reconciliation algorithm
│   │   └── visibilitySyncUtils.ts         # Multi-device visibility/focus remote refetch
│   ├── config/
│   │   └── plans.ts                       # Subscription plan definitions & pricing
│   ├── data/
│   │   ├── initialData.ts                 # Seed system state & guest user profile
│   │   └── moreTabData.ts                 # Sensei rules & navigation links
│   ├── styles/
│   │   └── tokens.css                     # Bushido design system tokens & APCA palette
│   ├── index.css                          # Global Tailwind imports & root typography
│   ├── main.tsx                           # Vite DOM entry point
│   ├── types.ts                           # Global TypeScript interfaces & enums
│   └── vite-env.d.ts
└── tests/                                 # Organized Test Suite
    ├── contracts/                         # External interface & export contracts
    │   ├── vercel-export-contract.test.ts
    │   └── debt-autopsy-contract.test.ts
    ├── engine/                            # Pure domain unit tests
    │   ├── engine.test.ts
    │   └── rules-and-special-mission-unification.test.ts
    ├── features/                          # Feature-level integration tests
    │   ├── admin-impersonation-boundary.test.ts
    │   ├── first-run-tour.test.ts
    │   ├── habit-toggle-and-pwa-cache.test.ts
    │   ├── ios-install-tip.test.ts
    │   ├── payment-subscription-status.test.ts
    │   ├── phone-auth.test.ts
    │   ├── profile-privilege-integrity.test.ts
    │   └── pwa-a2hs-banner.test.ts
    ├── security/                          # Security, RBAC & isolation tests
    │   └── security.test.ts
    ├── server/                            # Server integration & DB persistence tests
    │   ├── phase-2c-production-db-honesty.test.ts
    │   ├── phase-5a-payment-integrity.test.ts
    │   ├── phase-6-production-persistence.test.ts
    │   └── storage-and-seed.test.ts
    └── sync/                              # Distributed sync, offline queue & concurrency tests
        ├── client-storage-ownership.test.ts
        ├── cycle-log-ownership.test.ts
        ├── offline-queue-ownership.test.ts
        ├── phase-2b-offline-resilience.test.ts
        ├── phase-3b3-replay-contract-closure.test.ts
        ├── phase-3c3-sync-hardening-and-invariants.test.ts
        ├── phase-4-conflict-safety.test.ts
        ├── phase-6-1a-dailylog-write-ahead.test.ts
        ├── phase-6-1b-create-rollback.test.ts
        ├── phase-6-1b-cycle-mutation-reliability.test.ts
        ├── phase-6-2-cycle-idempotency-and-concurrency.test.ts
        ├── phase-6-2-multi-device-convergence.test.ts
        ├── replay-idempotency-and-retry.test.ts
        ├── sync-diagnostics-observability.test.ts
        ├── sync-orchestrator.test.ts
        ├── sync-reconciliation.test.ts
        └── visibility-refetch.test.ts
```

---

## 3. Safe Migration Order & Staging Strategy

To eliminate regressions, file movements must be executed in **discrete, verifiable clusters (one cluster per prompt)**. After every step:
1. `npm run lint` (`tsc --noEmit`) must succeed with 0 errors.
2. `npm run build` must compile clean bundles (`dist/` and `dist/server.cjs`).
3. `npm test` must pass all 844 tests across all test suites.

### Staging Phases:

| Stage | Cluster | Scope | Risk Level | Description |
|---|---|---|---|---|
| **Phase 1** | **Cluster A** | Leaf UI Primitives & Hooks | 🟢 Low | Move UI hooks (`useBodyScrollLock`, `useModalAccessibility`, `useHaptics`, `useAudioEffects`) and shared layout/feedback components (`Toast`, `ErrorBoundary`, `Navbar`, `PwaInstallBanner`). |
| **Phase 2** | **Cluster B** | Standalone Modals & Charts | 🟢 Low | Move self-contained modals (`ResetConfirmationModal`, `DisciplineRulesModal`) and visualization charts (`TrendCurvedChart`, `TacticalHeatmap90`, `HabitFidelityMatrix`). |
| **Phase 3** | **Cluster C** | Isolated Feature Views | 🟡 Medium | Relocate self-contained views: `ArchivesView`, `SenseiView`, `BushidoCourtView`, and `ProfileSettingsView` into their respective `features/` folders. |
| **Phase 4** | **Cluster D** | Express Server Route Extraction | 🟡 Medium | Extract modular route handlers from `server.ts` into `server/routes/` (`health`, `auth`, `cycles`, `logs`, `payment`, `admin`). Keep `server.ts` as the slim root bootstrap. |
| **Phase 5** | **Cluster E** | Primary Feature Slices | 🟠 High | Migrate `features/dashboard/`, `features/admin/`, `features/auth/`, and `features/payment/`. |
| **Phase 6** | **Cluster F** | Battlefield Decomposition | 🟠 High | Extract subcomponents from `BattlefieldView.tsx` (`BattlefieldHeader`, `HabitCard`, `DayCarousel`, `CoachBanner`) under `features/battlefield/`. |
| **Phase 7** | **Cluster G** | Sync Engine Relocation | 🔴 Critical | Relocate `src/utils/sync*.ts`, `storage*.ts`, `offlineQueueUtils.ts` to `src/sync/`. Update import paths across all 49 test suites. |
| **Phase 8** | **Cluster H** | Test Suite Categorization | 🟢 Low | Move test files from `/tests` into categorized folders (`tests/sync/`, `tests/server/`, etc.) and verify `npm test` glob matching. |

---

## 4. High-Risk "RED ZONES" (What NEVER Moves Early)

These modules contain deep, interdependent concurrency invariants or platform integration contracts. **They MUST NOT be moved or modified in initial migration stages:**

1. **The Distributed Sync Engine (`src/utils/sync*.ts`, `storageCore.ts`, `storageUtils.ts`, `offlineQueueUtils.ts`, `directMutationUtils.ts`):**
   * **Why it must stay until Phase 7:** Over 20 test suites (`phase-6-1a`, `phase-6-2`, `sync-orchestrator`, `offline-resilience`, etc.) import these exact paths directly. Moving them early causes widespread import breakages before component refactoring is stable.
2. **Client Router & Navigation State (`src/utils/routerUtils.ts`, `src/utils/authTabNavigation.ts`):**
   * **Why it must stay until Phase 5/6:** Browser URL path matching (`/battlefield`, `/dashboard`, `/more`, `/archives`) and client-side history navigation are verified by `tests/client-router.test.ts` and `tests/phase-6-5b-navigation-accessibility.test.ts`.
3. **Vercel Serverless Entry Point (`api/index.js` & `vercel.json`):**
   * **Why it must NOT be touched:** `api/index.js` normalizes incoming Vercel URLs (`?path=` query parameters) and binds directly to `server.ts` / `dist/server.cjs`. This contract is protected by `tests/vercel-export-contract.test.ts`.
4. **Prisma Database Layer (`server/db/*`):**
   * **Why it must stay anchored:** Handles concurrency version tokens (`concurrencyToken`), write-ahead daily logs, and transactional atomicity. Changing its export interface will disrupt server endpoints and database integration tests.

---

## 5. Architectural Invariants (Enforced for All Future Prompts)

1. **NO Application Source Files Moved in this Prompt:**
   * This prompt delivers documentation and the architectural map ONLY (`docs/ARCHITECTURE.md`).
2. **NO UI Redesign:**
   * Visual styling, design tokens (`tokens.css`), Persian typography (`toPersianDigits`), APCA contrast ratios, and layout geometry must remain strictly preserved.
3. **NO Behavior Change:**
   * Habit ticking, optimistic updates, rollback logic, offline queueing, multi-device reconciliation, and VIP subscriptions must behave identically before and after any file move.
4. **Small PRs & Continuous Verification:**
   * Every future refactoring prompt will address exactly **one cluster**.
   * Every prompt must conclude with verification:
     * `npm run lint`
     * `npm run build`
     * `npm test`
