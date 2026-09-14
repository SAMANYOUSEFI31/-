# 📐 سند جامع فرمول‌ها، شاخص‌ها و منطق محاسباتی سامانه بوشیدو
> **مرجع فنی و تحلیلی:** Bushido Discipline OS — Metrics & Mathematical Logic Engine  
> **کاربرد:** مستندسازی کامل تمامی فرمول‌های ریاضی، شاخص‌های عملکردی (KPIs)، قیف‌های تبدیل، دسته‌بندی کوهورت‌ها، شاخص‌های ماندگاری، و موتور سنجش انضباط.  
> **مخاطب:** مدیران محصول (PO)، مدیران ارشد، تحلیل‌گران داده و عامل‌های هوش مصنوعی (AI Agents).

---

## ۱. شاخص‌های کلان پنل مدیریت (Macro Analytics & Executive KPIs)

تمامی شاخص‌های این بخش بر اساس بازه زمانی انتخابی مدیر (`analyticsTimeRange`) فیلتر و محاسبه می‌شوند:
- **۷ روزه (`7d`):** از ۷ روز تقویمی گذشته تا انتهای روز جاری
- **۳۰ روزه (`30d`):** ۳۰ روز تقویمی اخیر
- **۹۰ روزه (`90d`):** ۹۰ روز فصلی (Quarterly)
- **۱ ساله (`1y`):** ۳۶۵ روز سالانه (Annual)
- **تمام دوران (`all`):** کل تاریخچه از اولین روز استقرار پایگاه داده

---

### ۱.۱. تعداد ثبت‌نامی‌های پنجره زمانی (`windowSignups`)
- **تعریف:** تعداد کل کاربرانی که تاریخ ایجاد حساب آن‌ها (`createdAt`) در بازه زمانی تعیین‌شده قرار دارد.
- **فرمول کد:**
```typescript
const windowUsers = users.filter(u => filterByDate(u.createdAt));
const windowSignups = windowUsers.length;
```

---

### ۱.۲. خریداران اشتراک سامورایی VIP در بازه (`windowVips`)
- **تعریف:** تعداد کاربرانی در بازه انتخابی که عضویت سامورایی VIP فعال دارند (`isVip === true`).
- **فرمول کد:**
```typescript
const windowVips = windowUsers.filter(u => u.isVip).length;
```

---

### ۱.۳. نرخ تبدیل پنجره زمانی (`windowConversionRate`)
- **تعریف:** درصد ثبت‌نام‌شدگان بازه انتخابی که به اشتراک پولی VIP ارتقا یافته‌اند.
- **فرمول ریاضی:**
$$\text{Conversion Rate} = \begin{cases} \left(\frac{\text{windowVips}}{\text{windowSignups}} \times 100\right) & \text{if } \text{windowSignups} > 0 \\ 0 & \text{if } \text{windowSignups} = 0 \end{cases}$$
- **فرمت نمایش:** اعشاری با ۱ رقم اعشار همراه با تبدیل به ارقام فارسی (مانند `۱۲.۵٪`).

---

### ۱.۴. کل درآمد محقق‌شده در بازه (`windowRevenue`)
- **تعریف:** مجموع مبالغ واریز شده تراکنش‌های بانکی زرین‌پال که وضعیت آن‌ها قطعی و موفق (`status === 'SUCCESS'`) است.
- **فرمول ریاضی:**
$$\text{windowRevenue} = \sum_{s \in \text{windowSubs}, \text{status} = \text{'SUCCESS'}} s.\text{amount}$$
- **واحد پولی:** تومان ایران (همراه با فرمت‌بندی ۳ رقمی و تبدیل به فارسی).

---

### ۱.۵. میانگین ارزش هر سفارش/مشترک (`windowAOV` - Average Order Value)
- **تعریف:** میانگین مبلغ پرداختی به ازای هر تراکنش موفق خرید اشتراک در بازه انتخابی.
- **فرمول ریاضی:**
$$\text{AOV} = \begin{cases} \text{round}\left(\frac{\text{windowRevenue}}{\text{windowSubs.length}}\right) & \text{if } \text{windowSubs.length} > 0 \\ \text{round}\left(\frac{\text{windowRevenue}}{\text{windowVips}}\right) & \text{else if } \text{windowVips} > 0 \\ 0 & \text{otherwise} \end{cases}$$

---

### ۱.۶. تعداد کاربران فعال در پنجره زمانی (`windowActiveUsers`)
- **تعریف:** کاربرانی در بازه انتخابی که حداقل یک بار در طول عمر خود رکورد نبرد ثبت کرده‌اند (`logsCount > 0`).

---

## ۲. منطق دسته‌بندی دوره‌ای و نمودار روند اسپلاین (Bucketing & Spline Chart)

برای ترسیم نمودار پیوسته و منعطف در کامپوننت `<TrendCurvedChart />`، داده‌های بازه به باکت‌های متقارن زمانی (`buckets`) تقسیم می‌شوند:

| بازه زمانی | تعداد باکت‌ها | بازه هر باکت | برچسب نمونه |
| :--- | :--- | :--- | :--- |
| **۷ روز اخیر (`7d`)** | ۷ باکت | ۱ روزه | «امروز»، «دیروز»، «چهارشنبه»، ... |
| **۳۰ روز اخیر (`30d`)** | ۱۰ باکت | ۳ روزه | «۳ روز اخیر»، «۴-۶ روز پیش»، ... |
| **۹۰ روز اخیر (`90d`)** | ۱۲ باکت | ۷ روزه (هفتگی) | «هفته جاری»، «هفته ۲»، ... |
| **۱ سال اخیر (`1y`)** | ۱۲ باکت | ۳۰ روزه (ماهانه) | «۳۰ روز اخیر»، «ماه ۲»، ... |

### ۲.۱. فرمول‌های درون هر باکت (Bucket Metrics):
برای هر باکت $b$:
1. **ثبت‌نامی‌های باکت (`signups`):** کاربرانی با `createdAt` در بازه تقویمی باکت.
2. **تبدیل‌های VIP باکت (`vipConversions`):** کاربران VIP ایجاد شده در بازه یا تراکنش‌های موفق باکت.
3. **درآمد باکت (`revenue`):** مجموع مبالغ تراکنش‌های موفق باکت.
4. **نرخ تبدیل باکت (`conversionRate`):**
$$\text{Bucket Conversion Rate} = \begin{cases} \text{round}\left(\frac{\text{vipConversions}}{\text{signups}} \times 100\right) & \text{if } \text{signups} > 0 \\ 100 & \text{else if } \text{vipConversions} > 0 \\ 0 & \text{otherwise} \end{cases}$$

### ۲.۲. الگوریتم پیوستگی منحنی اسپلاین بزیه (Cubic Bézier Curve Algorithm):
در رسم خطوط نرم SVG، برای هر جفت نقطه متوالی $(X_0, Y_0)$ و $(X_1, Y_1)$، دو نقطه کنترلی جهت ایجاد انحنای ارگانیک بدون لبه‌های تیز محاسبه می‌شوند:
$$CP_{1X} = X_0 + \frac{X_1 - X_0}{2}, \quad CP_{1Y} = Y_0$$
$$CP_{2X} = X_0 + \frac{X_1 - X_0}{2}, \quad CP_{2Y} = Y_1$$
دستور مسیر: `C CP1X,CP1Y CP2X,CP2Y X1,Y1`

---

## ۳. قیف تبدیل جامع کاربران (Conversion Funnel)

قیف تبدیل مسیر ۳ مرحله‌ای سفر کاربر (User Journey) را در کل دوران می‌سنجد:

```
[۱. ثبت‌نام اولیه در سامانه] ── (۱۰۰٪ کل اعضا)
           ↓
[۲. ورود به نبرد و ثبت رکورد] ── (درصد فعال‌سازی اولیه - Activation Rate)
           ↓
[۳. خرید اشتراک سامورایی VIP] ── (درصد تبدیل پولی - Paying Conversion)
```

1. **مرحله ۱ - ثبت‌نام اولیه:**  
   $$\text{Step 1 Count} = \text{users.length} \quad (\text{مبنا: } ۱۰۰٪)$$
2. **مرحله ۲ - ورود به نبرد (Engaged Fighters):**  
   کاربرانی که حداقل ۱ بار ثبت عادات یا لاگ روزانه داشته‌اند:
   $$\text{Step 2 Count} = \sum [u \in \text{users} \mid u.\text{logsCount} > 0]$$
   $$\text{Activation Rate} = \text{round}\left(\frac{\text{Step 2 Count}}{\text{Total Users}} \times 100\right)\%$$
3. **مرحله ۳ - ارتقا به VIP:**  
   کاربرانی که حق اشتراک فعال دارند:
   $$\text{Step 3 Count} = \sum [u \in \text{users} \mid u.\text{isVip} = \text{true}]$$
   $$\text{Paid Conversion Rate} = \left(\frac{\text{Step 3 Count}}{\text{Total Users}} \times 100\right)\%$$

---

## ۴. دسته‌بندی چرخه عمر کاربران (Lifecycle Cohorts)

کاربران سامانه بر اساس طول عمر حساب خود (`now - createdAt`) به ۳ گروه استراتژیک تفکیک می‌شوند:

### ۴.۱. تقسیم‌بندی زمانی کوهورت‌ها:
1. **کوهورت تازه پیوسته (Newbies):**  
   $$\Delta t \le 7 \text{ روز تقویمی}$$
2. **کوهورت مستقر در نبرد (Settled):**  
   $$7 \text{ روز} < \Delta t \le 30 \text{ روز تقویمی}$$
3. **کوهورت کهنه‌سربازان بوشیدو (Veterans):**  
   $$\Delta t > 30 \text{ روز تقویمی}$$

### ۴.۲. فرمول نرخ فعالیت هر کوهورت (`calcActiveRate`):
برای هر کوهورت $C$:
$$\text{Active Rate}_C = \begin{cases} \text{round}\left(\frac{\sum_{u \in C} [u.\text{logsCount} > 0]}{\text{Total Count}_C} \times 100\right) & \text{if } \text{Total Count}_C > 0 \\ 0 & \text{otherwise} \end{cases}$$

### ۴.۳. شاخص سلامت چسبندگی محصول (Habit Stickiness Index):
درصدی از کل کاربران که توانسته‌اند حداقل ۳ روز تعهد ثبت کنند (تشکیل الگوی اولیه عادت):
$$\text{Stickiness Index} = \text{round}\left(\frac{\sum [u \in \text{users} \mid u.\text{logsCount} \ge 3]}{\text{Total Users}} \times 100\right)\%$$

---

## ۵. شاخص‌های ماندگاری و پیشگیری از ریزش (Retention & Churn Indicators)

1. **جنگجویان فعال (Active Fighters):**  
   تعداد و درصد کاربرانی که حساب آن‌ها به خواب نرفته و حداقل یک لاگ دارند.
   $$\text{Active Users \%} = \left(\frac{\text{users with logsCount} > 0}{\text{Total Users}} \times 100\right)$$
2. **نرخ استمرار چرخه‌ها (Cycle Continuance):**  
   مجموع کل چرخه‌های متعهدانه ایجاد شده در پایگاه داده (`totalCycles`).
3. **استخر عدم فعالیت / کاربران راکد (Inactivity Pool - Churn Risk):**  
   تعداد کاربرانی که ثبت‌نام کرده‌اند اما حتی ۱ روز هم لاگ ثبت نکرده‌اند (`logsCount === 0`). این گروه جامعه هدف کمپین‌های بازگشت (Re-engagement) هستند.

---

## ۶. شاخص‌های مالی و پایش درگاه پرداخت (Subscriptions & Gateway KPIs)

در تب اشتراک‌ها (`subscriptions`)، چهار شاخص کلیدی مالی پایش می‌شوند:

1. **مجموع درآمد واریزی:**
   $$\text{Total Revenue} = \sum_{s \in \text{subscriptions}, \text{status} = \text{'SUCCESS'}} s.\text{amount}$$
2. **تراکنش‌های موفق بانکی:**
   $$\text{Successful Transactions} = \sum [s \in \text{subscriptions} \mid s.\text{status} = \text{'SUCCESS'}]$$
3. **نرخ موفقیت درگاه پرداخت (Gateway Success Rate):**
   $$\text{Gateway Success Rate} = \begin{cases} \text{round}\left(\frac{\text{Successful Transactions}}{\text{Total Transactions}} \times 100\right) & \text{if Total} > 0 \\ 100 & \text{otherwise} \end{cases}$$
4. **میانگین ارزش سفارش (Average Ticket Size):**
   $$\text{Average Ticket} = \begin{cases} \text{round}\left(\frac{\text{Total Revenue}}{\text{Successful Transactions}}\right) & \text{if Successful} > 0 \\ 0 & \text{otherwise} \end{cases}$$

---

## ۷. موتور مرکزی ارزش روز و شاخص انضباط بوشیدو (Discipline Engine)

این بخش قلب محاسباتی سامانه و مبنای محاسبه امتیازات هر جنگجو در چرخه ۹۰ روزه است.

### ۷.۱. محاسبه ارزش امتیاز روزانه (Daily Score - 0 تا 10):
- **پایه‌های ۵ گانه فونداسیون (`habitsCount`):** سحرخیزی، ورزش، مطالعه، ژورنال‌نویسی، کار سخت (هر کدام ۱ امتیاز).
- **روز استاندارد (`isStandard`):** زمانی محقق می‌شود که تمام ۵ پایه تیک خورده باشند (`habitsCount === 5`).
- **پاداش روز استاندارد (`bonusScore`):** اگر روز استاندارد باشد، ۳ امتیاز پاداش تعلق می‌گیرد.
- **ماموریت ویژه (`specialMission`):** در صورت انجام ماموریت ویژه تعریف‌شده، ۲ امتیاز افزوده می‌شود.
- **فرمول نهایی امتیاز روز ($S_{\text{day}}$):**
$$S_{\text{day}} = \min\left(10, \text{habitsCount} + (2 \times \text{specialMission}) + (3 \times \text{isStandard})\right)$$
*(امتیاز ۱۰ از ۱۰ نماد کمال تعهد یا **Mastery Day** است).*

---

### ۷.۲. شاخص انضباط و مخرج فانتوم (Discipline Score & Phantom Denominator):
شاخص انضباط صرفاً یک میانگین ساده نیست؛ بلکه با اعمال ضرایب جریمه برای بدهی‌های تسویه‌نشده و روزهای از دست رفته، تصویر واقعی تعهد کاربر را نشان می‌دهد:

$$\text{Discipline Score} = \frac{n_1}{\text{Phantom Denominator}}$$

#### پارامترهای فرمول:
- $n_1$: تعداد روزهای استاندارد (تکمیل کامل ۵/۵ رکن)
- $n_2$: روزهای سوخته کالبدشکافی‌شده که حداقل ۱ عادت انجام شده است.
- $n_3$: روزهای سوخته کالبدشکافی‌شده با صفر عادت.
- $n_4$: روزهای سوخته بدون کالبدشکافی (بدهی باز انضباطی) با حداقل ۱ عادت.
- $n_5$: روزهای سوخته بدون کالبدشکافی با صفر عادت.
- $\text{missing\_days}$: روزهای تقویمی سپری‌شده که کاربر اصلاً مراجعه و ثبت نکرده است.
- $\text{evaluated\_days}$: روزهای سپری‌شده منهای روزهای فریز موجه (`n_frozen`).

#### فرمول مخرج فانتوم (Phantom Denominator):
$$\text{Phantom Denominator} = \text{evaluated\_days} + (0.2 \times n_3) + (1.5 \times n_4) + (3.0 \times (n_5 + \text{missing\_days}))$$

> **تحلیل ضرایب جریمه:**  
> - ضریب $0.2$: جریمه ملایم برای روزهای کالبدشکافی‌شده با صداقت.  
> - ضریب $1.5$: جریمه برای بدهی باز کالبدشکافی‌نشده.  
> - ضریب $3.0$: جریمه سنگین برای فرار از نبرد و رها کردن روز بدون ثبت.

---

### ۷.۳. سطوح چهارگانه انضباط (Discipline Levels):

| سطح انضباط | بازه شاخص (درصد) | مفهوم تاکتیکی |
| :--- | :--- | :--- |
| **انضباط آهنین (Iron Discipline)** | $\ge ۸۰٪$ | تسلط کامل، پایداری پولادین و پایبندی سامورایی به تعهدات |
| **انضباط پایدار (Sustainable Discipline)** | $۶۰٪ \text{ تا } ۷۹٪$ | وضعیت باثبات با افت‌های موردی که سریعاً بازیابی شده‌اند |
| **انضباط ناپایدار (Unstable Discipline)** | $۴۰٪ \text{ تا } ۵۹٪$ | نوسان مداوم تعهد، نیازمند مداخله و اصلاح روتین |
| **بحران تعهد (Commitment Crisis)** | $< ۴۰٪$ | ریزش تعهدات، بدهی‌های انباشته و نیاز به شوک رفتاری |

---

## ۸. فرمت گزارش خلاصه اجرایی جهت رونوشت مدیر (PO Executive Summary)

در بالای تب آنالیز دکمه «رونوشت گزارش تحلیلی (PO)» تعبیه شده است که داده‌های پردازش‌شده را در قالب یک گزارش مدیریتی ساخت‌یافته در کلیپ‌بورد کپی می‌کند:

```text
📊 گزارش تحلیلی و عملکرد سیستم دیسیپلین بوشیدو (PO Report)
بازه زمانی گزارش: [۷ روز اخیر / ۳۰ روز اخیر / ۹۰ روز اخیر / ...]
تاریخ صدور: [تاریخ روز به شمسی]
------------------------------------------------
👥 کل جنگجویان ثبت‌نامی در بازه: [X] نفر
👑 خریداران اشتراک سامورایی VIP در بازه: [Y] نفر
🎯 نرخ تبدیل به VIP (Conversion): [Z]٪
💰 کل درآمد محقق‌شده در بازه: [W] تومان
⚡ میانگین ارزش هر مشترک (AOV): [A] تومان
💳 تراکنش‌های موفق بانکی کل: [B] فقره
🔥 کاربران فعال کل: [C] نفر ([D]٪)
------------------------------------------------
🌱 کوهورت تازه پیوسته (<۷ روز): [N1] نفر (فعالیت: [R1]٪)
🛡️ کوهورت مستقر (۷ تا ۳۰ روز): [N2] نفر (فعالیت: [R2]٪)
⚔️ کوهورت کهنه‌سرباز (>۳۰ روز): [N3] نفر (فعالیت: [R3]٪)
```
