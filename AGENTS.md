# Bushido Discipline OS - Agent Development Guidelines

## Project Reference
- Official Design System: See `/DESIGN_SYSTEM.md` for complete color tokens, affordance rules, icon sizing hierarchy, typography, and responsive standards.
- Universal Benchmarks & AI Decision Protocol: See `/BENCHMARKS.md` for sound ergonomics, motion physics, and RTL balance rules.

## Core Rules for All Future Edits
1. **Typography & Layout**:
   - Always convert numbers to Persian digits using `toPersianDigits(val)`.
   - Prevent text-wrapping in buttons and chips using `whitespace-nowrap`.
   - Explanatory descriptions in cards must wrap naturally with `leading-relaxed text-right` without `truncate` ellipsis.
   - Ensure vertical center alignment for all icon-label pairs using `inline-flex items-center justify-center gap-X leading-none`.
2. **Audio Feedback Ergonomics**:
   - Navigation, date switching, swipe gestures, and passive scrolling MUST remain completely silent (`soundFX` must NEVER play during date changes or passive browsing).
   - Audio feedback is strictly reserved for deliberate commitments: habit toggles, mastery unlocks, debt settlements, and error alerts.
3. **Temporal & RTL Layout Alignment**:
   - Strictly use "روز جاری نبرد" for today, "${n} روز بعد" for future, and "${n} روز قبل" for past.
   - Auxiliary action buttons ("پرش به روز جاری") must sit at the starting (right) edge in RTL layouts, and passive badges ("کات‌آف شبانه") must balance gracefully at the center/left.
4. **Top Hub Bar Standardization**:
   - All header controls (Brand mark, Cycle selector, Streak badge, VIP CTA, Debt alert, User button) share unified height: `h-8` on Mobile (< 640px) and `h-9` on Desktop (≥ 640px).
   - VIP Upgrade CTA must remain accessible on mobile header (`h-8 px-2.5 bg-amber-500`).
5. **Affordance Matrix**:
   - Interactive buttons must use `cursor-pointer`, distinct solid or bordered background, and active scale animations.
   - Informative badges and chips must use `cursor-default select-none pointer-events-none` with subtle borders.
6. **Icon Sizing Hierarchy**:
   - Level 1 Master Hero: `w-12 h-12` container with `w-6 h-6` icon.
   - Level 2 Section Header: `w-10 h-10` container with `w-5 h-5` icon.
   - Level 3 Interactive Habit Cards: `w-10 h-10 shrink-0` container with `w-5 h-5` icon.
   - Level 4 Stats & Record Cards: `w-8 h-8 shrink-0` container with `w-4 h-4` icon.
   - Level 5 Inline Micro: `w-3.5 h-3.5` to `w-4 h-4`.
7. **Color Tokens, APCA Benchmark & Luminance Parity**:
   - Canvas & Containers: Base Canvas `#09090b` (`bg-[#09090b]`), Elevated Cards `#121215` (`bg-[#121215]`), Borders `#27272a` (`border-zinc-800`).
   - Primary Text: `#f4f4f5` (`text-zinc-100` / `text-white`), Secondary: `#a1a1aa` (`text-zinc-400` / `text-slate-300`).
   - Amber (`amber-400` / `#fbbf24`): Mastery 10/10, AI judgment, VIP actions, cumulative total score (`Award`).
   - Emerald (`emerald-400` / `#34d399`): Standard Day 8/10 (5/5 checks), streak vitality (`CheckCircle2`).
   - Fiery Rose (`rose-400` / `#fb7185`): Pure continuous streak, historical streak peak (`Flame`). (Immutable semantic token across all themes).
   - Crimson / Alert Red (`red-400` / `red-500`): Open debts, behavior locks, critical autopsy alerts (`AlertOctagon`).
   - Blue (`blue-400` / `#60a5fa`): Personal freeze, excused pauses (`Snowflake`).
   - Violet (`purple-400` / `#c084fc`): Resolved autopsy cases (`ShieldCheck`).
8. **Discipline Holy Trinity & Universal Streak Invariance**:
   - All-time Hall of Records, current cycle metrics, and Top Hub Bar must share identical icon & color tokens: Streak (`Flame` with `text-rose-400 bg-rose-500/10 border-rose-500/20`), Standard Days (`CheckCircle2` with `text-emerald-400`), and Total Score (`Award` with `text-amber-400`).
   - User accent theme selection NEVER recolors the semantic Pure Streak flame.
9. **Modal & Container Copy Contrast Rule**:
   - Multi-line body copy and explanatory descriptions must use neutral text (`text-zinc-300` / `text-slate-300`), NEVER saturated colored text. Saturated semantic colors are strictly reserved for icons, titles, metric badges, and status pills.
10. **Section Header Icon Neutrality & Semantic Color Exclusivity**:
   - Section headers (e.g. Coach Banner, Hall of Records master box, Settings groups, Guide sections) must strictly use neutral zinc icons (`text-zinc-200` or `text-zinc-300`). Saturated semantic colors (rose, emerald, amber, red, purple, blue) are strictly reserved for actual state indicators and metric cards (Discipline Holy Trinity), never for static container titles.
11. **Direct Milestone State Feedback (No Redundant Toasts)**:
   - Day milestones (8/10 Standard Day and 10/10 Mastery Day) are directly reflected in the Battlefield daily score badge and audio chime. Redundant floating toast banners are eliminated for a dignified, stoic user experience.
