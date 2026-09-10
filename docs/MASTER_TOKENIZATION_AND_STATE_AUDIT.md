# Bushido Discipline OS — Master Tokenization & State Consistency Audit
> **Living Audit & Governance SSOT Document**
> این مستند جامع به عنوان منبع واحد حقیقت (Single Source of Truth) برای ممیزی، توکنایزیشن و یکپارچه‌سازی استیت‌های سراسر اپلیکیشن در ۵ فاز تدوین شده است تا توسط توسعه‌دهنده، هوش مصنوعی‌های دیگر، و ناظران کیفیت قابل ارزیابی و پیگیری دقیق باشد.

---

## ۱. ساختار نقشه راه ۵ مرحله‌ای (5-Phase Roadmap Architecture)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ROADMAP PROGRESS MATRIX                        │
├─────────┬───────────────────────────────────────────┬───────────────────┤
│ فاز     │ حوزه ممیزی و یکپارچه‌سازی                 │ وضعیت             │
├─────────┼───────────────────────────────────────────┼───────────────────┤
│ فاز ۱   │ هسته توکن‌ها و ماتریس استیت‌ها (tokens.css)  │  تکمیل و قفل شد   │
│ فاز ۲   │ پوسته کلان (Top Hub Bar + Floating Navbar)│  تکمیل و قفل شد   │
│ فاز ۳   │ میدان نبرد و کارت‌های عادت (Battlefield)   │  تکمیل و قفل شد   │
│ فاز ۴   │ اتاق فرمان، تب‌ها و آمارها (Dashboard)    │  تکمیل و قفل شد   │
│ فاز ۵   │ مودال‌ها، تنظیمات و اسکن سراسری مخزن      │  تکمیل و قفل شد   │
└─────────┴───────────────────────────────────────────┴───────────────────┘
```

---

## ۲. گزارش جامع فاز ۱: هسته توکن‌ها و ماتریس استیت‌ها (Phase 1 Deep Audit)

### ۲.۱. اعتبارسنجی معماری سه‌سطحی (Three-Tier Architecture Verification)

#### سطح ۱: توکن‌های بدوی (Tier 1: Primitives)
مقادیر خام فیزیکی و شیمیایی رنگ‌ها، شعاع‌ها، فواصل و تایمینگ‌ها:
- **پالت خنثی آبسیدین (Obsidian Canvas):**
  - `--color-canvas-root`: `#09090b` (سطح مرجع $Z_0$)
  - `--color-shell-chrome`: `rgba(9, 9, 11, 0.92)` (شیشه دودی آبسیدین با ضریب آلفای ۹۲٪)
  - `--color-card-elevated`: `#121215` (کارت‌های برجسته $Z_1$)
  - `--color-card-inner`: `#18181b` (شیارها و ول‌های تعاملی $Z_2$)
  - `--color-card-floating`: `#1c1c21` (منوها و مودال‌های شناور $Z_3$)
- **پالت رنگ‌های سمانتیک انحصاری (Semantic Palette):**
  - Crimson (برند و تمرکز ناوبری): `#E11D48`
  - Amber (استادی ۱۰/۱۰ و سنسای هوش مصنوعی): `#FBBF24`
  - Emerald (انجام روز استاندارد ۵/۵ و ۸/۱۰): `#34D399`
  - Rose (زنجیره خالص پیوسته و بدون خدشه): `#FB7185`
  - Debt / Red (بدهی معوق، قفل رفتار و سوختگی): `#F87171` و `#EF4444`
  - Blue (فریز شخصی و توقف موجه): `#60A5FA`
  - Purple (کالبدشکافی تحلیلی و بازنگری): `#C084FC`
- **سلسله‌مراتب شعاع‌های هندسی (Geometric Radii Hierarchy):**
  - فرمول ریاضی: `شعاع داخلی = شعاع خارجی - فاصله (پدینگ)`
  - مقیاس استاندارد: `4px` (میکرو)، `6px` (بج)، `8px` (کنترل)، `12px` (کامپوننت/دکمه)، `14px` (کارت)، `20px` (مودال)، `9999px` (کپسول).
- **فیزیک و تایمینگ‌های حرکتی (Motion Timings):**
  - `--duration-instant`: `100ms` (کلیک‌های ریز، چک‌باکس‌ها)
  - `--duration-fast`: `150ms` (دکمه‌ها، کارت‌ها، فیدبک لمسی)
  - `--duration-regular`: `200ms` (انتقال تب‌ها و نمودارها)
  - `--duration-deliberate`: `300ms` (باز شدن مودال‌ها و کشوها)

#### سطح ۲: نقش‌های معنایی (Tier 2: Semantic Roles)
کلاس‌های کاربردی برای اعمال آسان نقش‌ها بر روی المان‌ها:
- سطوح ارتفاعی: `.surface-z0`, `.surface-shell`, `.surface-z1`, `.surface-z2`, `.surface-z3`
- مرزها و تقسیم‌کننده‌ها: `.border-standard`, `.border-subtle`, `.border-hover`, `.border-active`, `.divide-standard`, `.divide-subtle`
- نقش‌های متنی لومینانس APCA:
  - `.text-role-primary`: `#F4F4F5` (کنتراست فوق‌العاده بالا $L_c = 104$)
  - `.text-role-secondary`: `#A1A1AA` (متون توضیحی و زیرعنوان‌ها $L_c = 78$)
  - `.text-role-muted`: `#71717A` (کپشن‌ها و زیروندها $L_c = 60$)
  - `.text-role-disabled`: `#52525B` (وضعیت‌های غیرفعال)
- خانواده رنگ‌های سمانتیک با ۳ شکل همزمان (متن، پس‌زمینه، کادر):
  - `.text-*`, `.bg-*`, `.bg-*-subtle`, `.border-*`, `.border-*-subtle` برای تمامی ۷ رنگ کلیدی.

#### سطح ۳: موجودیت‌های کامپوننت و قراردادها (Tier 3: Component Entities)
کلاس‌های پیش‌ساخته با رعایت تمام استیت‌های تعاملی:
- `.entity-hero-panel`: کانتینر قهرمان اصلی و هدر
- `.entity-card-habit`: کارت عادت‌های روزانه با استیت‌های استاندارد، استادی و قفل
- `.entity-stamp-target`: چک‌باکس کپسولی و دایره‌ای لمسی
- `.entity-input-well`: ورودی‌ها و فرم‌ها با فوکوس تاکتیکال
- `.entity-metric-card`: کارت‌های بنتو برای آمارها
- `.entity-status-badge` و `.entity-telemetry-badge`: بج‌های غیرقابل کلیک
- `.entity-action-btn`: دکمه‌های کنشی با مقیاس لمسی
- قرارداد دکمه‌ها: `.btn-contract-primary`, `.btn-contract-mastery`, `.btn-contract-secondary`, `.btn-contract-ghost`

---

### ۲.۲. ماتریس ۶ استیت استاندارد تعامل (Canonical 6-State Matrix)

برای جلوگیری از رفتار ناهماهنگ دکمه‌ها و کارت‌ها در بخش‌های مختلف، قرارداد رفتاری زیر تثبیت شد:

| استیت (State) | شبه‌کلاس / شناسه | رفتار بصری و تغییر توکن | فیدبک فیزیکی |
| :--- | :--- | :--- | :--- |
| **۱. Default** | `:root / base` | رنگ پیش‌فرض المان طبق سطح خود ($Z_1$ یا $Z_2$) | حالت آرام |
| **۲. Hover** | `:hover`, `.border-hover` | روشن‌تر شدن لبه نوری (`--color-border-hover`) یا صعود به سطح بعدی (`hover:surface-z2` / `hover:surface-z3`) | تغییر رنگ ملایم در ۱۵۰ میلی‌ثانیه |
| **۳. Active / Pressed** | `:active`, `.active:surface-z3` | صعود موقت سطح به $Z_3$ یا فشرده‌شدن دکمه | انقباض ارگونومیک (`transform: scale(0.98)` یا `scale(0.99)`) |
| **۴. Selected / Current** | `[aria-current="page"]`, `.is-active` | برجسته‌شدن با پیل متحرک بدون کادر (`surface-z2 border-none shadow-xs`) و رنگ سرخ برند (`text-crimson`) | انیمیشن فنری لغزشی |
| **۵. Disabled / Locked** | `:disabled`, `.is-disabled`, `.is-locked` | کاهش شفافیت به ۴۵٪ (`opacity: 0.45`)، نشانگر ممنوع (`cursor: not-allowed`)، لغو رخدادهای کلیک (`pointer-events: none`) | قفل کامل مقیاس و افکت |
| **۶. Focus-Visible** | `:focus-visible`, `.focus-ring-tactical` | حلقه فوکوس دو لایه ۲ پیکسلی ضد نویز: لایه اول تاریک روت (`#09090b`) و لایه دوم هایلایت قرمز (`var(--color-accent-primary-border)`) | دسترس‌پذیری کامل بدون ایجاد زشتی در کلیک‌های موس |

---

### ۲.۳. اصلاحات و تقویت‌های اعمال‌شده در فاز ۱ روی `tokens.css`

1. **افزودن کلاس `.active:surface-z2:active`**: برای المان‌های تعاملی مستقر روی سطح $Z_1$ که در هنگام لمس باید به سطح $Z_2$ صعود کنند.
2. **افزودن صریح استیت‌های غیرفعال (`:disabled` و `.is-disabled`) به قرارداد دکمه‌ها**:
   - `.btn-contract-primary:disabled`
   - `.btn-contract-mastery:disabled`
   - `.btn-contract-secondary:disabled`
   - `.btn-contract-ghost:disabled`
3. **تنظیم استیت هاور دکمه استادی (`.btn-contract-mastery:hover`)**: افزودن `filter: brightness(1.05)` جهت فیدبک بصری بهینه بدون بر هم زدن رنگ طلایی سمانتیک.

---

## ۳. گزارش جامع فاز ۲: پوسته کلان (Top Hub Bar + Floating Navbar Deep Audit)

### ۳.۱. ممیزی هدر و کنترل‌های هاب بالا (Top Hub Bar)
- **برندینگ بوشیدو (Brand Mark):**
  - ابعاد: `h-8 w-8 sm:h-9 sm:w-9 radius-component`
  - رنگ: پس‌زمینه قرمز اختصاصی برند `bg-crimson`، متن متصل به توکن لایه ۲ `text-role-primary` (حذف کلاس قدیمی `text-white`).
- **انتخاب‌گر چرخه (Cycle Switcher Dropdown):**
  - دکمه تریگر: اتصال به لایه‌های تعاملی `surface-z1 hover:surface-z2 active:surface-z3 border-subtle radius-component`.
  - پنل دراپ‌داون: لایه معلق `surface-z3 border-subtle radius-modal shadow-dropdown`.
  - دکمه‌های آیتم‌ها: تفکیک دکمه انتخاب (`surface-z2` برای چرخه جاری با نشانگر `text-emerald font-bold`) از دکمه مجزای حذف (`hover:text-debt hover:bg-debt-subtle`).
- **استانداردسازی ارتفاع عناصر هدر (AGENTS.md Rule 4 Compliance):**
  - کلیه کنترل‌ها به صورت یکپارچه دارای ارتفاع `h-8` روی موبایل و `h-9` روی دسکتاپ شدند (`h-8 sm:h-9`).
- **نشانگر بدهی باز (Debt Alert):**
  - اتصال به توکن‌های سمانتیک بدهی: `bg-debt-subtle border border-debt text-debt radius-component`.
- **نشانگر شعله استریک (Pure Streak):**
  - اتصال به توکن‌های سمانتیک استریک پایدار: `bg-rose-subtle text-rose radius-component`. عدم تغییر رنگ با تم انتخابی کاربر (حفظ استواری نماد استریک).
- **دکمه وضعیت / ارتقای VIP:**
  - اگر کاربر VIP باشد: بج متین طلایی `bg-amber-subtle text-amber`.
  - اگر کاربر VIP نباشد: دکمه ارتقا در دسترس در هدر موبایل و دسکتاپ با `bg-amber text-canvas-root font-black`.
- **دکمه حساب کاربری (User Profile / Auth Button):**
  - اتصال به `onOpenAuthModal` با آیکون `User` و ارتفاع هماهنگ `h-8 sm:h-9` و سطح `surface-z1 hover:surface-z2`.

### ۳.۲. ممیزی ناوبر شناور موبایل و تب‌های دسکتاپ (Navbar)
- **کپسول شیشه‌ای شناور موبایل:**
  - حذف کلاس هاردکدشده `border border-white/[0.08]` و جایگزینی با توکن معنایی `border-subtle`.
  - بدنه اصلی: `surface-shell border-subtle shadow-dropdown radius-capsule`.
  - رعایت حاشیه امن ناچ و جزیره پویا: `pb-safe mb-2.5 sm:mb-3`.
- **پیل متحرک تب فعال:**
  - تطبیق کامل با قرارداد سطح ۲ و ۳: `surface-z2 border-none shadow-xs`.
  - بدون کادر مضاعف، با انیمیشن فنری مخملی (`stiffness: 450, damping: 35, mass: 0.7`).
- **استیت متن و آیکون تب‌ها:**
  - فعال: `text-crimson font-black` با آیکون `text-crimson`.
  - غیرفعال: `text-role-secondary hover:text-role-primary` با آیکون `text-role-secondary`.
- **بج‌های هشدار تب‌ها:**
  - هشدار بدهی معوق روی تب میدان نبرد: `bg-debt animate-ping`.
  - هشدار نقطه عطف جدید روی تب بیشتر: `bg-amber animate-pulse`.

---

## ۴. گزارش جامع فاز ۳: هسته میدان نبرد (Battlefield & Habits Deep Audit)

### ۴.۱. ممیزی نوار تاریخ و کنترل‌های تقویم نبرد (Date Navigator & Cutoff Bar)
- **دکمه‌های روز قبل و روز بعد:**
  - ساختار تعاملی با لمس ارگونومیک: `h-9 sm:h-10 px-2.5 sm:px-3.5 surface-z2 hover:surface-z3 active:surface-z3 text-role-primary radius-component border-standard shadow-subtle active:scale-95`.
  - عدم پخش هرگونه صدای اضافی هنگام ورق زدن روزها (رعایت بند ۲ راهنما).
- **باکس کات‌آف شبانه:**
  - استقرار در مرکز با موجودیت استاندارد لایه ۳: `entity-telemetry-badge shadow-subtle`.
  - تفکیک شفاف کنتراست: لیبل با `text-role-secondary` و ساعت با `text-role-primary font-mono font-bold`.
- **بنرهای وضعیت روزها و دکمه پرش به روز جاری:**
  - روزهای آینده: کادر مات `surface-z1 border-standard radius-card text-role-primary shadow-subtle backdrop-blur-md` با دکمه کنشی `bg-rose-subtle hover:brightness-125 text-rose border border-rose-subtle`.
  - روزهای گذشته: کادر تاریخچه با دکمه `bg-rose-subtle hover:brightness-125 text-rose`.
  - چرخه‌های آرشیوشده: بنر متین بنفش `bg-purple-subtle border border-purple-subtle text-purple`.
  - قفل رفتار (Behavior Lock) ناشی از بدهی‌های سوخته: کادر هشدار قرمز `bg-debt-subtle border border-debt-subtle text-debt animate-pulse` با دکمه‌های کالبدشکافی تاکتیکال.

### ۴.۲. ممیزی هیرو پنل و گیج ده‌گانه انضباط (Discipline Gauge & Score Hero)
- **کانتینر اصلی هیرو:**
  - متصل به موجودیت لایه ۳: `entity-hero-panel radius-card border-standard surface-z1`.
- **بج‌های تله‌متری و سرزندگی زنجیره (Streak Vitality):**
  - شمارنده عادت‌ها: `entity-telemetry-badge font-mono` با نسبت فونت دقیق ۵ رکن پایه.
  - بج حیاتی استریک: استفاده از `entity-status-badge` با رنگ‌های سمانتیک استاندارد (`text-rose bg-rose-subtle` برای روز استاندارد، `text-blue bg-blue-subtle` برای فریز موجه، و `text-debt bg-debt-subtle` برای شکست).
- **گیج ده‌گانه انضباط (10-Segment Discipline Gauge):**
  - کانتینر: `entity-gauge-track select-none pointer-events-none`.
  - قطعات تکمیل‌شده: امتیاز ۱۰ با رنگ کهربایی `bg-amber border border-amber/40`، امتیاز ۸ (استاندارد) با رنگ زمرد `bg-emerald border border-emerald/40`، فریز با رنگ آبی `bg-blue border border-blue/40`، و سایر مقادیر با توکن معنایی رسمی `bg-role-primary border-subtle`.
  - قطعات خالی: جایگزینی کلاس هاردکدشده قدیمی با توکن لایه دو رسمی `surface-z0 border-subtle shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]`.

### ۴.۳. ممیزی ۵ کارت عادت فونداسیون (5 Foundation Habits)
- **کانتینر کارت:**
  - متصل به کلاس لایه ۳: `entity-card-habit w-full min-h-[44px] radius-card border-standard surface-z1`.
  - استیت فعال و تکمیل‌شده: کلاس اختصاصی `.is-checked-standard` با رنگ متنی `text-role-primary` و بوردر هایلایت زمرد ملایم `border-[var(--color-accent-emerald-border)]`.
  - استیت غیرفعال: رنگ خنثی ثانویه `text-role-secondary`.
  - استیت قفل رفتار / بدهی: کلاس `.is-locked` با افکت مسدودسازی و نشانگر عدم دسترسی.
- **مهر/چک‌باکس لمسی (Stamp Target):**
  - ابعاد ارگونومیک: `w-6 h-6 sm:w-7 sm:h-7 entity-stamp-target radius-capsule`.
  - حالت چک‌خورده: پس‌زمینه زمرد سمانتیک `bg-emerald text-canvas-root` با تیک ضخیم و باوقار.
  - حالت خالی: شفاف با ترنزیشن هاور مرز `group-hover:border-hover`.

### ۴.۴. ممیزی ماموریت ویژه شتاب‌دهنده روز (Special Mission Accelerator)
- **کانتینر کارت شتاب‌دهنده:**
  - متصل به موجودیت لایه ۳ با کلاس کمال `.is-checked-mastery` و هایلایت کهربایی `border-[var(--color-accent-amber-border)]`.
- **مهر کمال:**
  - در حالت فعال: پس‌زمینه طلایی بوشیدو `bg-amber text-canvas-root`.
- **بج پاداش کمال:**
  - استقرار بج `+۲ امتیاز` با توکن‌های رسمی `surface-z2 text-amber border border-amber-subtle`.

### ۴.۵. ممیزی باکس کالبدشکافی و یادداشت‌های استراتژیک (Reflection Notes)
- **باکس اقدام کالبدشکافی:**
  - تفکیک رنگی هوشمند بر اساس وضعیت: آبی برای دلایل شخصی، بنفش برای کالبدشکافی حل‌شده، قرمز برای بدهی باز، و خنثی برای روز جاری.
- **تکس‌اریا یادداشت‌های میدان نبرد:**
  - متصل به موجودیت لایه ۳ ورودی‌ها: `entity-input-well surface-z2 border-standard radius-card`.
  - استیت‌های نشانگر وضعیت ذخیره: سبز زمردی `text-emerald` برای ذخیره موفق و کهربایی `text-amber` برای در حال ذخیره.

---

## ۵. گزارش جامع فاز ۴: اتاق فرمان، تب‌ها و داشبورد تحلیلی (Command Room & Analytics Deep Audit)

### ۵.۱. ممیزی نوار زیرتب‌ها (`ResponsiveSubTabBar`)
- **ساختار کانتینر:**
  - اتصال به `surface-z1 border-subtle p-1 sm:p-1.5 radius-card shadow-subtle`.
- **نشانگر تب فعال (Spring Active Indicator):**
  - متصل به فرمول بدون کادر سطح دو: `surface-z2 border-none shadow-xs` با انیمیشن فنری باوقار (`stiffness: 500, damping: 38`).
- **استیت تب‌های فعال و غیرفعال:**
  - فعال: `text-crimson font-black` با آیکون همرنگ و کنتراست شفاف.
  - غیرفعال: `text-role-secondary hover:text-role-primary` با ترنزیشن ۱۵۰ میلی‌ثانیه‌ای فاز ۱.
- **تضمین ارگونومی و حداقل مساحت لمس (Touch Target ≥ 44px):**
  - ارتفاع دکمه‌ها: `min-h-[44px] h-11 sm:h-12` با انقباض لمسی استاندارد `active:scale-[0.98]`.
  - بج‌های تب‌ها روی دسکتاپ: متصل به `surface-z1 border-current/30` در حالت فعال و `surface-z2 text-role-secondary border-subtle` در حالت غیرفعال.

### ۵.۲. ارکان تثلیث مقدس دیسیپلین (Discipline Holy Trinity Cards)
طبق قوانین سخت‌گیرانه بند ۸ و ۱۰ سند `AGENTS.md`:
- **کارت ۱: زنجیره فعال (Pure Streak):**
  - متصل به آیکون `Flame` در کانتینر `bg-rose-subtle`، عدد برجسته با رنگ رز سمانتیک `text-rose` (ثبات قطعی در تمام تم‌ها).
- **کارت ۲: روزهای استاندارد (Standard Days):**
  - متصل به آیکون `CheckCircle2` در کانتینر `bg-emerald-subtle`، عدد برجسته با رنگ زمرد سمانتیک `text-emerald`.
- **کارت ۳: مجموع امتیاز (Total Score):**
  - متصل به آیکون `Award` در کانتینر `bg-amber-subtle`، عدد برجسته با رنگ کهربای سمانتیک `text-amber`.

### ۵.۳. ممیزی کارت‌های آماری ثانویه و اصل ضد-رنگین‌کمان (Anti-Rainbow Invariance)
کارت‌های ثانویه برای جلوگیری از آشفتگی بصری از سطوح خنثی بهره می‌برند:
- **بدهی کالبدشکافی (Unresolved Debt):**
  - در صورت نبود بدهی: سطح خنثی متین `surface-z2 border-standard text-role-muted` با متن `text-role-primary`.
  - در صورت وجود بدهی باز: هایلایت مشروط قرمز بدهی با آیکون `AlertOctagon` و رنگ `text-debt`.
- **کالبدشکافی شده (Resolved Debt):**
  - سطح کاملاً خنثی با آیکون خنثی `ShieldCheck text-role-muted` و متن `text-role-primary`.
- **توقف اضطراری (Frozen Days):**
  - سطح کاملاً خنثی با آیکون خنثی `Snowflake text-role-muted` و متن `text-role-primary`.

### ۵.۴. تالار رکوردها و قله‌های دیسیپلین (Hall of Records)
- **هدر کانتینر اصلی:**
  - رعایت قانون ۱۰ راهنما: آیکون جام `Trophy` با رنگ کاملاً خنثی `text-role-secondary` در کانتینر `surface-z2 border-standard`.
- **رکوردهای تاریخی سه‌گانه:**
  - تطبیق ۱۰۰٪ پالت رنگ با ارکان تثلیث (رز برای استریک، زمرد برای روزهای استاندارد، کهربا برای امتیاز کل).

### ۵.۵. نقشه حرارتی تاکتیکی ۹۰ روزه (`TacticalHeatmap90`)
- تفکیک قطعی روزهای تقویم در ۳ فاز ۳۰ روزه:
  - روز کمال (۱۰/۱۰): `bg-amber text-canvas-root border-amber`.
  - روز استاندارد (۸/۱۰): `bg-emerald text-canvas-root border-emerald`.
  - روز جاری در حال نبرد: `surface-z2 text-role-primary ring-2 ring-amber ring-offset-2 ring-offset-canvas-root`.
  - روزهای فریز: `bg-blue text-role-primary border-blue`.
  - روزهای بدهی باز: `bg-debt text-role-primary border-debt animate-pulse`.

### ۵.۶. ماتریس وفاداری به ارکان (`HabitFidelityMatrix`)
- هدر بخش: آیکون لایه‌ها `Layers` با رنگ خنثی `text-role-secondary`.
- نوارهای پیشرفت ۵ رکن: اتصال به سطوح سه سطحی `surface-z0 border-standard` با پرکننده‌های سمانتیک زمرد، کهربا و قرمز بدهی.
- کارت شتاب‌دهنده ویژه: هایلایت مستقل کهربایی `bg-amber-subtle text-amber`.

---

## ۶. گزارش جامع فاز ۵: لایه‌های غوطه‌ور، مودال‌ها، تنظیمات و اسکن سراسری (Modals & Overlays Deep Audit)

### ۶.۱. ممیزی بک‌دراپ‌ها و لایه‌های غوطه‌ور (Backdrops & Overlays)
- **اصلاح نشت رنگ پس‌زمینه در مودال‌ها:**
  - کلاس‌های هاردکدشده `bg-black/80` و `bg-black/85` در `ArchivesView` و `DatabaseView` شناسایی و پاکسازی شدند.
  - تمامی مودال‌ها و پاپ‌آپ‌ها اکنون به توکن رسمی `surface-backdrop-modal` با بلور شیشه‌ای (`backdrop-blur-sm` / `md`) متصل هستند تا یکپارچگی بصری حفظ شود.
  - رعایت حاشیه‌های امن ناچ و جزیره پویا (`pt-safe`, `pb-safe`) در تمامی مودال‌های تعاملی تأیید شد.

### ۶.۲. ممیزی مودال‌های اقدام و هشدار (Action & Alert Modals)
- **مودال احراز هویت (`AuthModal`):**
  - فیلدهای ورودی به موجودیت‌های استاندارد فرم متصل شدند.
  - دکمه‌های کنشی با توکن‌های رسمی `bg-amber text-canvas-root` و `bg-role-primary text-canvas-root` تنظیم شده‌اند.
- **مودال کالبدشکافی خطا (`AutopsyModal`):**
  - باکس‌های انتخاب علت خطا به استیت‌های خنثی `surface-z2 text-role-secondary hover:surface-z3` مجهز شده‌اند و رنگ اکتیو آنها قرمز بدهی `text-debt` است.
- **مودال‌های تسویه بدهی و تاییدیه (`ResetConfirmationModal` / `PaymentModal`):**
  - هدر کانتینرها با سطح `surface-z1` و `radius-modal` یکدست شده‌اند. دکمه‌های انصراف با کادر `border-subtle` و دکمه‌های تایید متناسب با ریسک عملیات رنگ‌بندی شده‌اند (مانند قرمز برای ریست و سبز برای تایید موفقیت).

### ۶.۳. ممیزی نمای تنظیمات و مدیریت کاربر (`ProfileSettingsView`)
- هدر و ساختار صفحه به لایه‌های `surface-z1` متصل است.
- بج‌های وضعیت و توکن‌های مربوط به VIP (طلایی/کهربایی بوشیدو `bg-amber` و `text-amber`) با قوانین سمانتیک هم‌سو هستند.
- توست‌ها (پیام‌های شناور) با موجودیت `toast` تطبیق داده شده‌اند و در مرکز پایین صفحه با حاشیه امن قرار می‌گیرند.

### ۶.۴. تاییدیه نهایی ممیزی توکن‌ها (Final Token Scan و پاکسازی‌های بصری)
- اسکن کل پروژه نشان می‌دهد که کلاس‌های ناقض (`bg-zinc`, `text-slate`, `border-gray` و هگزاکدهای مستقیم) به طور کامل ریشه‌کن شده‌اند. سیستم استایل‌دهی اکنون به صورت ۱۰۰٪ متکی به توکن‌های سمانتیک CSS متغیر `tokens.css` عمل می‌کند.
- **پاکسازی سایه‌های هاردکدشده (Drop-shadow/Box-shadow):** تمامی درخشش‌های غیرضروری و سایه‌های هاردکد (مانند `shadow-[0_0_15px_...]`) در تب داشبورد و آیکون‌های هدر حذف شدند و سیستم به قانون عدم استفاده از Glow رنگی (طراحی Stoic) پایبند شد.
- **مینیمال‌سازی آیکون‌های VIP:** آیکون تاج شناور (Crown) حذف شد و کاربر VIP تنها با رنگ شدن آیکون پروفایل با متغیر سمانتیک `text-amber` در هدر مشخص می‌شود تا یکپارچگی بصری و خلوتی رابط کاربری (Layout Cleanliness) حفظ شود.
