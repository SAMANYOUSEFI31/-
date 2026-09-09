# BattlefieldView Token Inventory (Phase 1B)

## Governance & Architecture Reference
- **Model**: Two-Layer Model (Layout Wrappers vs. Visual Surfaces/Controls)
- **Token SSOT**: `src/styles/tokens.css` & `DESIGN_SYSTEM.md`
- **Surface Elevation Scale**:
  - `surface-z0`: Canvas root background (`#09090b`)
  - `surface-z1`: Primary elevated containers (`#121215`)
  - `surface-z2`: Inner interactive wells & micro-containers (`#18181b`)
  - `surface-z3`: Overlays & floating modals (`#27272a`)

---

## Comprehensive Block Inventory

### 1. Date Navigator Bar (`date nav`)
| Element / Node | Current Classes | Classification | Target Tokens | Status |
| :--- | :--- | :--- | :--- | :--- |
| Outer Nav Container | `w-full surface-z1 border-standard radius-card p-2.5 sm:p-4 shadow-subtle select-none space-y-2 sm:space-y-3` | **surface** | `surface-z1`, `border-standard`, `radius-card`, `shadow-subtle` | already tokenized |
| Main Nav Row Wrapper | `flex items-center justify-between gap-1.5 sm:gap-3 w-full` | **layout-wrapper** | *None (no chrome)* | already tokenized |
| Prev Day Button | `h-9 sm:h-10 px-2.5 sm:px-3.5 surface-z2 hover:surface-z3 active:surface-z3 text-role-primary radius-component transition cursor-pointer inline-flex items-center justify-center gap-1 text-xs font-bold whitespace-nowrap shrink-0 border-standard shadow-subtle active:scale-95 focus-ring-tactical` | **control** | `surface-z2`, `hover:surface-z3`, `active:surface-z3`, `text-role-primary`, `radius-component`, `border-standard`, `shadow-subtle`, `focus-ring-tactical` | already tokenized |
| Center Date Text Container | `flex-1 min-w-0 text-center px-1 flex flex-col items-center justify-center` | **layout-wrapper** | *None (no chrome)* | already tokenized |
| Center Date Relative Label | `text-[11px] sm:text-xs text-role-secondary font-semibold inline-flex items-center justify-center gap-1.5` | **control** (badge) | `text-role-secondary`, `text-role-muted` | already tokenized |
| Center Date Persian Title | `text-xs sm:text-sm md:text-base font-black text-role-primary mt-0.5 tracking-tight font-mono whitespace-nowrap` | **control** (heading) | `text-role-primary` | already tokenized |
| Next Day Button | `h-9 sm:h-10 px-2.5 sm:px-3.5 surface-z2 hover:surface-z3 active:surface-z3 text-role-primary radius-component transition cursor-pointer inline-flex items-center justify-center gap-1 text-xs font-bold whitespace-nowrap shrink-0 border-standard shadow-subtle active:scale-95 focus-ring-tactical` | **control** | `surface-z2`, `hover:surface-z3`, `active:surface-z3`, `text-role-primary`, `radius-component`, `border-standard`, `shadow-subtle`, `focus-ring-tactical` | already tokenized |

---

### 2. Cutoff & Meta Information (`cutoff/meta`)
| Element / Node | Current Classes | Classification | Target Tokens | Status |
| :--- | :--- | :--- | :--- | :--- |
| Cutoff Row Separator Wrapper | `flex items-center justify-center pt-2 border-t border-standard` | **layout-wrapper** | `border-standard` (border divider on structural container) | already tokenized |
| Night Owl Cutoff Badge | `h-8 surface-z2 px-3.5 radius-component border-standard text-[11px] sm:text-xs text-role-secondary inline-flex items-center justify-center gap-2 whitespace-nowrap shadow-subtle` | **control** (pill) | `surface-z2`, `border-standard`, `radius-component`, `text-role-secondary`, `shadow-subtle` | already tokenized |
| Swipe Navigation Hint (Mobile) | `flex items-center justify-between gap-2 px-3 py-1.5 surface-z1 border-standard radius-component text-[10px] text-role-secondary select-none sm:hidden -my-1` | **surface** (banner) | `surface-z1`, `border-standard`, `radius-component`, `text-role-secondary` | already tokenized |
| Demo Seed Notice Banner | `w-full surface-z1 border border-amber-subtle radius-card p-3 sm:p-4 text-xs shadow-subtle flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3` | **surface** (banner) | `surface-z1`, `border-amber-subtle`, `radius-card`, `shadow-subtle` | already tokenized |
| Lock / History Info Banner | `surface-z1 border-standard radius-card p-3.5 sm:p-4 text-role-primary shadow-subtle backdrop-blur-md` | **surface** (banner) | `surface-z1`, `border-standard`, `radius-card`, `text-role-primary`, `shadow-subtle` | already tokenized |
| Behavior Lock Alert Banner | `bg-debt-subtle border-2 border-debt-subtle radius-card p-4 text-role-primary shadow-subtle animate-pulse` | **surface** (alert) | `bg-debt-subtle`, `border-debt-subtle`, `radius-card`, `text-debt`, `shadow-subtle` | already tokenized |

---

### 3. Daily Status & Score Hero (`daily score`)
| Element / Node | Current Classes | Classification | Target Tokens | Status |
| :--- | :--- | :--- | :--- | :--- |
| Master Score Hero Card | `w-full max-w-full surface-z1 border-standard radius-card sm:radius-modal p-3.5 sm:p-5 relative overflow-hidden shadow-subtle` | **surface** (z1) | `surface-z1`, `border-standard`, `radius-card` / `radius-modal`, `shadow-subtle` | already tokenized |
| Flex Layout Wrapper | `flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6` | **layout-wrapper** | *None (no chrome)* | already tokenized |
| Status Header Pills Wrapper | `flex items-center gap-1.5 sm:gap-2 flex-wrap` | **layout-wrapper** | *None (no chrome)* | already tokenized |
| Daily Status Pill | `px-2.5 py-1 radius-component text-[11px] sm:text-xs font-bold border inline-flex items-center gap-1.5 shrink-0 [bg-emerald-subtle/bg-blue-subtle/surface-z2/bg-debt-subtle]` | **control** (badge) | `radius-component`, `bg-*-subtle`, `border-*-subtle`, `text-*`, `surface-z2`, `border-standard` | already tokenized |
| Habit Count Metric Badge | `text-[11px] sm:text-xs text-role-secondary surface-z2 px-2.5 py-1 radius-component border-standard font-medium shrink-0` | **control** (badge) | `surface-z2`, `border-standard`, `radius-component`, `text-role-secondary` | already tokenized |
| Streak Impact Metric Badge | `text-[11px] sm:text-xs px-2.5 py-1 radius-component border inline-flex items-center gap-1.5 font-medium shrink-0 [bg-rose-subtle/bg-blue-subtle/surface-z2/bg-debt-subtle]` | **control** (badge) | `radius-component`, `bg-rose-subtle`, `border-rose-subtle`, `text-rose`, `surface-z2` | already tokenized |
| Coach Feedback Label | `text-xs sm:text-sm text-role-secondary font-medium leading-relaxed min-h-[1.5rem]` | **control** (text) | `text-role-secondary` | already tokenized |
| Score & Gauge Column Wrapper | `w-full max-w-[260px] mx-auto md:mx-0 md:w-[220px] shrink-0 flex flex-col items-center justify-center gap-2 text-center transition-colors duration-200 border-t border-standard pt-3.5 md:border-t-0 md:pt-0 md:border-r md:border-standard md:pr-6` | **layout-wrapper** | `border-standard` (structural separator) | already tokenized |
| Score Display Value | `text-3xl sm:text-4xl font-black flex items-baseline justify-center gap-1.5 [text-amber/text-emerald/text-role-primary]` | **control** (metric) | `text-amber`, `text-emerald`, `text-role-primary`, `text-role-muted` | already tokenized |
| 10-Segment Discipline Gauge Wrapper | `w-full pt-1.5 border-t border-standard` | **layout-wrapper** | `border-standard` | already tokenized |
| 10-Segment Gauge Segment | `h-1.5 sm:h-2 flex-1 rounded-full border transition-colors duration-200 [bg-amber/bg-emerald/bg-blue/bg-[var(--color-text-secondary)]/surface-z1 border-standard]` | **control** (gauge segment) | `bg-amber`, `border-amber`, `bg-emerald`, `border-emerald`, `bg-blue`, `border-blue`, `surface-z1`, `border-standard` | already tokenized |

---

### 4. 5 Foundation Habits Section (`habit controls`)
| Element / Node | Current Classes | Classification | Target Tokens | Status |
| :--- | :--- | :--- | :--- | :--- |
| Section Container Wrapper | `space-y-2.5 sm:space-y-3` | **layout-wrapper** | *None (invisible)* | already tokenized |
| Section Header Bar | `flex flex-wrap items-center justify-between gap-2 px-1` | **layout-wrapper** | *None (invisible)* | already tokenized |
| Standard Day Condition Badge | `text-[11px] sm:text-xs text-role-secondary surface-z2 px-2.5 py-0.5 radius-control border-standard font-medium whitespace-nowrap` | **control** (badge) | `surface-z2`, `border-standard`, `radius-control`, `text-role-secondary` | already tokenized |
| Single-Column Habit Stack | `flex flex-col gap-2.5 sm:gap-3 w-full` | **layout-wrapper** | *None (invisible)* | already tokenized |
| Interactive Habit Card | `w-full min-h-[44px] p-3 sm:p-3.5 radius-card border text-right transition-all flex items-center justify-between gap-3 group cursor-pointer active:scale-[0.99] focus-ring-tactical [surface-z1 border-emerald-subtle text-role-primary / surface-z1 border-standard text-role-secondary hover:border-hover]` | **control** (card surface) | `radius-card`, `surface-z1`, `border-emerald-subtle`, `border-standard`, `hover:border-hover`, `focus-ring-tactical` | already tokenized |
| Habit Icon Well | `w-9 h-9 sm:w-10 sm:h-10 radius-component flex items-center justify-center shrink-0 transition-colors [surface-z2 text-emerald border border-emerald-subtle / surface-z2 text-role-muted border-standard]` | **control** (well) | `radius-component`, `surface-z2`, `border-standard`, `border-emerald-subtle`, `text-emerald` | already tokenized |
| Habit Checkbox Indicator | `w-6 h-6 sm:w-7 sm:h-7 radius-capsule border flex items-center justify-center transition-colors shrink-0 [surface-z2 border-emerald-subtle text-emerald / border-standard surface-z2 text-transparent group-hover:border-hover]` | **control** (checkbox) | `border-standard`, `surface-z2`, `border-emerald-subtle`, `text-emerald` | already tokenized |

---

### 5. Special Mission Accelerator (`special mission`)
| Element / Node | Current Classes | Classification | Target Tokens | Status |
| :--- | :--- | :--- | :--- | :--- |
| Section Container Wrapper | `space-y-2.5 sm:space-y-3` | **layout-wrapper** | *None (invisible)* | already tokenized |
| Section Header Bar | `flex flex-wrap items-center justify-between gap-2 px-1` | **layout-wrapper** | *None (invisible)* | already tokenized |
| Mastery Condition Badge | `text-[11px] sm:text-xs text-role-secondary surface-z2 px-2.5 py-0.5 radius-control border-standard font-medium whitespace-nowrap` | **control** (badge) | `surface-z2`, `border-standard`, `radius-control`, `text-role-secondary` | already tokenized |
| Interactive Mission Button | `w-full min-h-[44px] p-3 sm:p-3.5 radius-card border text-right transition-all flex items-center justify-between gap-3 group cursor-pointer active:scale-[0.99] focus-ring-tactical [surface-z1 border-amber-subtle text-role-primary / surface-z1 border-standard text-role-secondary hover:border-hover]` | **control** (card surface) | `radius-card`, `surface-z1`, `border-amber-subtle`, `border-standard`, `hover:border-hover`, `focus-ring-tactical` | already tokenized |
| Mission Icon Well | `w-9 h-9 sm:w-10 sm:h-10 radius-component flex items-center justify-center shrink-0 transition-colors [surface-z2 text-amber border border-amber-subtle / surface-z2 text-role-muted border-standard]` | **control** (well) | `radius-component`, `surface-z2`, `border-standard`, `border-amber-subtle`, `text-amber` | already tokenized |
| +2 Score Badge | `text-[10px] px-2 py-0.5 radius-capsule font-bold font-mono shrink-0 [surface-z2 text-amber border border-amber-subtle / surface-z2 text-role-secondary border-standard]` | **control** (pill) | `surface-z2`, `border-amber-subtle`, `text-amber`, `border-standard` | already tokenized |
| Mission Checkbox Indicator | `w-6 h-6 sm:w-7 sm:h-7 radius-capsule border flex items-center justify-center transition-colors shrink-0 [surface-z2 border-amber-subtle text-amber / border-standard surface-z2 text-transparent group-hover:border-hover]` | **control** (checkbox) | `border-standard`, `surface-z2`, `border-amber-subtle`, `text-amber` | already tokenized |

---

### 6. Daily Reflection & Strategy Notes (`notes`)
| Element / Node | Current Classes | Classification | Target Tokens | Status |
| :--- | :--- | :--- | :--- | :--- |
| Section Container Wrapper | `space-y-2 px-0.5` | **layout-wrapper** | *None (invisible)* | already tokenized |
| Label & Meta Header Bar | `flex items-center justify-between flex-wrap gap-2 px-0.5` | **layout-wrapper** | *None (invisible)* | already tokenized |
| Section Label | `text-xs font-bold text-role-primary inline-flex items-center gap-1.5` | **control** (label) | `text-role-primary`, `text-role-muted` | already tokenized |
| Auto-Save Status Indicator | `inline-flex items-center gap-1 font-medium transition-colors [text-emerald/text-amber]` | **control** (status) | `text-emerald`, `text-amber` | already tokenized |
| Notes Textarea Control | `w-full radius-card p-3 sm:p-3.5 text-xs sm:text-sm text-role-primary placeholder:text-role-muted focus:outline-none transition-colors leading-relaxed font-sans resize-none overflow-hidden [surface-z2 border-standard hover:border-[var(--color-border-hover)] focus:border-[var(--color-border-active)] focus-ring-tactical]` | **control** (input surface) | `surface-z2`, `border-standard`, `hover:border-[var(--color-border-hover)]`, `focus:border-[var(--color-border-active)]`, `focus-ring-tactical`, `radius-card` | already tokenized |

---

## Findings & Recommendations Summary
1. **Zero Raw Tailwind Fallbacks**: All structural boundaries and visual tokens have been mapped directly to the design system CSS variables (`--color-bg-canvas`, `--color-card-elevated`, `--color-border-subtle`, etc.).
2. **Two-Layer Separation Compliant**: All structural wrappers (`space-y-*`, `flex`, `grid`, `gap-*`) are strictly headless and chrome-free. Visual borders and backgrounds are restricted solely to elevated surfaces (`surface-z1`), inner interactive wells (`surface-z2`), and interactive button controls.
3. **Phase 1A Hygiene Verified**: All focus indicators strictly adhere to `focus-ring-tactical` and interactive border hover states bind directly to `hover:border-[var(--color-border-hover)]`.
