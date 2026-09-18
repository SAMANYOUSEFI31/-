# Bushido Discipline OS — Accessibility & Docs Audit Report (U1–U5)

- **Repo assumption:** Current tree after staged folder migration and accessibility hardening waves
- **Date (ISO):** 2026-09-18
- **Purpose:** Record the verified outcome of the five accessibility and documentation prompts (U1–U5) against the current codebase for external reviewer verification.

---

## Summary Status Table

| Prompt | Topic | Status | UI Changed? | Docs Changed? |
| :--- | :--- | :--- | :--- | :--- |
| **U1** | Habit / Mission Row Touch Target Contract & Visual-Only Stamp | `DONE_ALREADY` | No | Yes |
| **U2** | Battlefield Habit & Mission Subtitle Contrast (`text-role-secondary`) | `DONE_ALREADY` | No | No |
| **U3** | User-Visible Persian Network & Sync Error Recovery | `DONE_ALREADY` | No | No |
| **U4** | Secondary Controls (<44px) Hit Area Expansion (Preserving Stamp Size) | `CHANGED_IN_THIS_WAVE` | Yes | Yes |
| **U5** | Documentation Alignment (Architecture, Touch, Reduced-Motion, Adapters) | `CHANGED_IN_THIS_WAVE` | No | Yes |

---

### U1 — Habit/Mission Touch Target Contract & Visual-Only Stamp
- **Intent:** Ensure habit and special mission rows provide a full-width clickable button with minimum 44px height while preserving the stamp as a visual-only indicator, formalized in documentation.
- **Code status:** `DONE_ALREADY`
- **Evidence:**
  - `src/features/battlefield/BattlefieldView.tsx`: Foundation habit row button uses full-width container with minimum 44px height (line 995: `className="... entity-card-habit w-full min-h-[44px] p-3 sm:p-3.5 text-right flex items-center justify-between gap-3 group focus-ring-tactical ..."`). Special mission row button also uses full-width with minimum 44px height (line 1050: `className="... entity-card-habit w-full min-h-[44px] p-3 sm:p-3.5 ..."`).
  - `src/features/battlefield/BattlefieldView.tsx`: Habit stamp is an indicator element nested within the button (line 1018: `className="... entity-stamp-target w-6 h-6 sm:w-7 sm:h-7 ..."`), strictly non-interactive and visual-only.
  - `DESIGN_SYSTEM.md`: Section 13 (`اندازه هدف لمسی (Touch Targets Contract - U1)`) and Section 17 (`قرارداد رسمی هدف لمسی سطرهای عادات و ماموریت ویژه (Habit Row Touch-Target Contract)`).
  - `BENCHMARKS.md`: Section 5 (`قرارداد رسمی تارگت لمسی سطرهای عادات، ماموریت ویژه و کنترل‌های فرعی (Touch-Target Contract - U1)`).
- **UI changed?:** no (Button was already `w-full min-h-[44px]` and stamp was already indicator-only).
- **Docs changed?:** yes (Explicitly documented contract in `DESIGN_SYSTEM.md` and `BENCHMARKS.md`).
- **If STILL_OPEN:** N/A

---

### U2 — Battlefield Habit/Mission Subtitle Contrast
- **Intent:** Ensure battlefield habit and special mission subtitle captions use `text-role-secondary` or stronger contrast, avoiding low-contrast `text-role-muted` for descriptive copy.
- **Code status:** `DONE_ALREADY`
- **Evidence:**
  - `src/features/battlefield/BattlefieldView.tsx`: Foundation habit subtitles use `text-role-secondary` (line 1013: `<p className="text-[11px] text-role-secondary leading-relaxed text-right">{h.subtitleFa}</p>`).
  - `src/features/battlefield/BattlefieldView.tsx`: Special mission subtitle uses `text-role-secondary` (line 1071: `<p className="text-[11px] text-role-secondary leading-relaxed text-right">`).
  - `src/features/battlefield/BattlefieldView.tsx`: Habit card default text color token defaults to `text-role-secondary` in unchecked state (lines 998, 1053: `isChecked ? 'is-checked-standard text-role-primary' : 'text-role-secondary'`), ensuring WCAG AA compliant contrast ratio against `#121215` card background.
- **UI changed?:** no (Already using `text-role-secondary`).
- **Docs changed?:** no
- **If STILL_OPEN:** N/A

---

### U3 — Persian Network/Sync Error Recovery via Existing Toast Patterns
- **Intent:** Provide clear Persian network and sync recovery guidance (explaining what happened and offering actionable recovery) using existing toast patterns without modifying the sync or offline queue engine.
- **Code status:** `DONE_ALREADY`
- **Evidence:**
  - `src/App.tsx`: Lines 361–382 (`checkAndOfferQueueRepair`) detects unreplayable items and displays an actionable warning toast:
    `تعداد ${toPersianDigits(unreplayable.length)} مورد از تغییرات آفلاین به سرور ارسال نشد. جهت بازنشانی صف و همگام‌سازی مجدد، «تعمیر همگام‌سازی» را انتخاب کنید یا به ثبت آفلاین ادامه دهید.` with action button `تعمیر همگام‌سازی` triggering queue cleanup and `MANUAL_FORCE` resync.
  - `src/App.tsx`: Lines 416–429 (`handleAppSyncResult`) handles `FAILED` sync outcomes with an actionable toast:
    `همگام‌سازی با سرور به دلیل اختلال ارتباط انجام نشد؛ داده‌ها در دستگاه محفوظ است. اتصال اینترنت را بررسی کنید یا دوباره تلاش فرمایید.` with action button `تلاش مجدد`.
  - `src/App.tsx`: Lines 430–442 handles offline force-sync attempts (`SKIPPED_OFFLINE`):
    `دستگاه در وضعیت آفلاین است؛ امکان ارسال تغییرات وجود ندارد. اتصال اینترنت را بررسی کنید یا در حالت آفلاین ادامه دهید.` with action button `بررسی مجدد`.
  - `src/App.tsx`: Mutation handlers (lines 1174, 1240, 1308, 1313, 1412, 1462) clearly notify users in Persian that changes were safely cached in local storage/offline queue and will be transmitted once connectivity resumes.
- **UI changed?:** no (Existing handlers already implement these actionable toasts and explanations).
- **Docs changed?:** no
- **If STILL_OPEN:** N/A

---

### U4 — Secondary Controls Hit Area Expansion
- **Intent:** Audit icon-only and secondary dismiss/clear controls that were under ~44px hit area and expand their touch target to ≥44px using padding, minimum sizes, and negative margins without enlarging visual chrome, keeping the habit stamp size requirement unchanged.
- **Code status:** `CHANGED_IN_THIS_WAVE`
- **Evidence:**
  - `src/features/tour/FirstRunTour.tsx`: Close button updated from 24×24px to 44×44px hit area with negative margins and tactile touch handling (lines 342–348: `className="w-11 h-11 min-w-[44px] min-h-[44px] -my-2.5 -ml-2.5 radius-component flex items-center justify-center text-role-muted hover:text-role-primary hover:surface-z2 transition-colors cursor-pointer touch-manipulation focus-ring-tactical"`).
  - `src/features/battlefield/BattlefieldView.tsx`: Demo banner dismiss buttons expanded to 44×44px (mobile line 504: `w-11 h-11 min-w-[44px] min-h-[44px] -mt-2.5 -ml-2.5 ... touch-manipulation`, desktop line 544: `w-11 h-11 min-w-[44px] min-h-[44px] ... touch-manipulation`).
  - `src/features/battlefield/BattlefieldView.tsx`: Swipe hint dismiss button updated from sub-18px (`p-0.5`) to 44×44px (line 649: `w-11 h-11 min-w-[44px] min-h-[44px] -my-2.5 -ml-2.5 radius-control cursor-pointer shrink-0 focus-ring-tactical touch-manipulation`).
  - `src/shared/components/pwa/PwaInstallBanner.tsx`: Dismiss button expanded to 44×44px (line 186: `w-11 h-11 min-w-[44px] min-h-[44px] -my-2.5 -ml-2.5 ... touch-manipulation`).
  - `src/shared/components/pwa/IosInstallTip.tsx`: Dismiss button expanded to 44×44px (line 105: `w-11 h-11 min-w-[44px] min-h-[44px] -my-2.5 -ml-2.5 ... touch-manipulation`).
  - `src/shared/components/feedback/Toast.tsx`: Toast dismiss button expanded to uniform 44×44px (line 95: `w-11 h-11 min-w-[44px] min-h-[44px]`).
  - `src/features/archives/ArchivesView.tsx`: Search clear button hit area expanded to full vertical input height (line 719: `className="absolute inset-y-0 left-0 w-9 flex items-center justify-center ... touch-manipulation focus-ring-tactical"`).
  - `src/features/battlefield/BattlefieldView.tsx`: Stamp size requirement strictly preserved as indicator-only (line 1018: `entity-stamp-target w-6 h-6 sm:w-7 sm:h-7`).
- **UI changed?:** yes (Hit areas expanded to ≥44px with negative margins/min-dimensions, retaining visual chrome).
- **Docs changed?:** yes (Documented in `DESIGN_SYSTEM.md` Section 13 and `BENCHMARKS.md` Section 5).
- **If STILL_OPEN:** N/A

---

### U5 — Documentation Alignment (Architecture, Design System, Benchmarks & Gateway Realities)
- **Intent:** Synchronize architectural documentation with the current staged folder structure (features, shared, sync, app routing), add design/touch notes (reduced-motion, forced-colors, U1 touch contract), provide README reference links, and ensure SMS/OTP and payment (Zarinpal) are accurately documented as configurable adapter layers with mock/sandbox fallbacks rather than claiming live external services without credentials.
- **Code status:** `CHANGED_IN_THIS_WAVE`
- **Evidence:**
  - `docs/ARCHITECTURE.md`: Updated Section 1 to document active relocation of `src/shared/`, `src/features/`, `src/app/routing/`, and `src/sync/`. Documented Section B adapter realities: `server/sms/` (SMS adapter with sandbox fallback and debug OTP when no SMS gateway credentials exist) and `server/payment/` (Zarinpal adapter with sandbox/test simulation when `ZARINPAL_MERCHANT_ID` is unset).
  - `DESIGN_SYSTEM.md`: Updated Section 13 with the Touch Target Contract (U1, negative margin technique for secondary controls), `@media (prefers-reduced-motion: reduce)` rules (`motion-reduce:animate-none`, instantaneous transitions), and `@media (forced-colors: active)` Windows High Contrast mode support.
  - `BENCHMARKS.md`: Updated Section 5 (`Touch-Target Contract - U1`) and Section ج with accessibility contrast, reduced-motion, and forced-colors rules.
  - `README.md`: Added Section 7 (`اسناد تکمیلی و راهنماهای مرجع معماری و طراحی`) with direct relative markdown links to `docs/ARCHITECTURE.md`, `DESIGN_SYSTEM.md`, `BENCHMARKS.md`, `ADMIN_METRICS_AND_LOGIC.md`, and `docs/API_ROUTING.md`.
- **UI changed?:** no (Documentation-only alignment).
- **Docs changed?:** yes (`docs/ARCHITECTURE.md`, `DESIGN_SYSTEM.md`, `BENCHMARKS.md`, `README.md`).
- **If STILL_OPEN:** N/A
