import { HabitKey, VulnerableHabit } from '../types';

export interface DeterministicAutopsyResult {
  analysis: string;
  psychologicalTrap: string;
  countermeasure: string;
  tacticalActionTomorrow: string;
}

export interface DeterministicSenseiResult {
  coachVerdict: string;
  keyAdvice: string;
  strategicWarning: string;
  bushidoQuote: string;
}

export interface DeterministicCourtResult {
  verdict: string;
  grade: 'A+' | 'A' | 'B' | 'C' | 'F';
  senseiNotes: string;
  strengths: string[];
  weaknesses: string[];
  tacticalPlanForNextCycle: string;
}

/**
 * Deterministic Behavioral Engine for Autopsies
 * Replaces external AI with reliable cognitive & behavioral heuristic rules
 */
export function getDeterministicAutopsy(params: {
  date: string;
  missedHabits: string[];
  failureReason: string;
  failureTime: string;
  userNotes?: string;
  cycleTheme?: string;
}): DeterministicAutopsyResult {
  const { missedHabits, failureReason, failureTime, userNotes } = params;

  if (failureReason === 'دلایل شخصی') {
    return {
      analysis: 'توقف اضطراری به دلایل غیرقابل پیش‌بینی شخصی رخ داده است. طبق اصول بوشیدو، حفظ آرامش در مواجهه با شرایط غیرمترقبه عین دیسیپلین است.',
      psychologicalTrap: 'تله سرزنش بیهوده خود در شرایط اضطراری بیرونی',
      countermeasure: 'قانون مقابله: ثبت فریز و بازگشت پرقدرت به ریتم اصلی بدون فوت وقت از فردا صبح.',
      tacticalActionTomorrow: 'اجرای بدون درنگ اولین فونداسیون روز (سحرخیزی و آب‌رسانی) در ثانیه اول بیداری.'
    };
  }

  // Matrix of cognitive traps based on time & reason
  let trap = 'تله توهم کنترل زمان و انباشت اصطکاک‌های خرد';
  let analysis = 'عدم مرزبندی مشخص میان ساعات تمرکز عمیق و فعالیت‌های پراکنده باعث فرسایش اراده شده است.';
  let countermeasure = 'قانون مقابله: مسدودسازی کلیه عوامل حواس‌پرتی تا پایان اجرای کار سخت روز.';
  let tacticalActionTomorrow = 'تعیین دقیق سنگین‌ترین وظیفه فردا روی کاغذ قبل از خواب امشب.';

  if (failureTime === 'اول روز') {
    trap = 'تله اینرسی صبحگاهی و به تعویق انداختن نخستین ضربه (Friction Gap)';
    analysis = 'شکست در آغاز روز، زنجیره دوپامینی و اعتمادبه‌نفس بقیه روزکاری را مختل کرده است. شروع روز بدون برنامه مکتوب باعث فرار ذهن به فعالیت‌های آسان شد.';
    countermeasure = 'قانون ۳۰ دقیقه اول: ورود مستقیم به روتین فونداسیون بدون لمس تلفن همراه.';
    tacticalActionTomorrow = 'قرار دادن لباس ورزشی و دفترچه ژورنال کنار تخت قبل از خواب.';
  } else if (failureTime === 'وسط روز') {
    trap = 'تله افت دوپامین پس از ظهر و پذیرش وقفه‌های کاذب (Midday Slump)';
    analysis = 'در میانه روز به دلیل خستگی ذهنی یا گرسنگی، آستانه مقاومت در برابر حواس‌پرتی کاهش یافته و انجام وظایف سخت نیمه‌کاره رها شده است.';
    countermeasure = 'قانون بلوک عمیق ۹۰ دقیقه‌ای: تقسیم کار سخت به دو بازه متمرکز همراه با ۵ دقیقه استراحت فیزیکی.';
    tacticalActionTomorrow = 'انجام مهم‌ترین بخش کار سخت پیش از ساعت ۱۲ ظهر.';
  } else if (failureTime === 'آخر روز') {
    trap = 'تله تخلیه مخزن اراده و اهمال‌کاری تا دقایق پایانی شب (Revenge Bedtime Procrastination)';
    analysis = 'انتقال دادن عادت‌ها (نظیر مطالعه یا ژورنال) به ساعات پایانی شب که مغز در کمترین سطح بازدهی قرار دارد، علت اصلی ثبت شکست بوده است.';
    countermeasure = 'قانون خط قرمز ساعت ۲۱: هیچ عادت پایه‌ای نباید پس از ساعت ۹ شب بدون تیک بماند.';
    tacticalActionTomorrow = 'جابجایی زمان مطالعه و ژورنال به عصر یا بلافاصله پس از کار روزانه.';
  }

  // Refine with specific reason
  if (failureReason === 'نیمه‌کاره رها کردم') {
    trap = 'تله کمال‌گرایی منفی یا خستگی زودهنگام در مواجهه با ابهام وظیفه';
    analysis = 'عدم خرد کردن وظیفه به گام‌های کوچک و شفاف، اصطکاک شناختی ایجاد کرده و منجر به توقف در نیمه راه شد.';
    countermeasure = 'قانون ۵ دقیقه اول: فقط ۵ دقیقه متوالی روی کار تمرکز کن؛ سپس مغز وارد جریان کار می‌شود.';
  } else if (failureReason === 'بی‌برنامه بودم') {
    trap = 'تله تصمیم‌گیری لحظه‌ای زیر فشار خستگی روزانه';
    analysis = 'وقتی برای روز برنامه‌ریزی قبلی وجود نداشته باشد، ناخودآگاه کوتاه‌ترین مسیر به سمت راحتی و مصرف محتوای سطحی را انتخاب می‌کند.';
    countermeasure = 'قانون شامگاه: ۵ تسک فردا باید شب قبل با زمان‌بندی دقیق ثبت شوند.';
  } else if (failureReason === 'وقتم رو به خوبی مدیریت نکردم') {
    trap = 'تله نشت زمان در حباب شبکه‌های اجتماعی و کارهای کم‌ارزش';
    analysis = 'ریز‌فعالیت‌های بی‌ثمر زمان ارزشمند کار عمیق را بلعیده‌اند و در پایان روز زمانی برای اجرای تعهدات اصلی باقی نماند.';
    countermeasure = 'قانون حالت هواپیما: تلفن همراه در طول کار سخت در اتاقی دیگر قرار می‌گیرد.';
  }

  if (missedHabits.length > 0) {
    analysis += ` عدم اجرای «${missedHabits.join('، ')}» مستقیماً انرژی ساختاری روز را تضعیف کرده است.`;
  }

  if (userNotes && userNotes.trim()) {
    analysis += ` نکته مهم از یادداشت شما: اصطکاک ثبت‌شده باید به عنوان درس راهبردی در دستور کار فردا قرار گیرد.`;
  }

  return {
    analysis,
    psychologicalTrap: trap,
    countermeasure,
    tacticalActionTomorrow
  };
}

/**
 * Deterministic Sensei Coach
 * Provides real-time tactical advice based on user metrics
 */
export function getDeterministicSenseiAdvice(params: {
  cycleTitle: string;
  elapsedDays: number;
  remainingDays: number;
  disciplinePercentage: number;
  disciplineLevel: string;
  pureStreak: number;
  vulnerableHabits: VulnerableHabit[];
  dominantFailureReason: string;
  dominantFailureTime: string;
  userQuery?: string;
}): DeterministicSenseiResult {
  const {
    cycleTitle,
    elapsedDays,
    remainingDays,
    disciplinePercentage,
    disciplineLevel,
    pureStreak,
    vulnerableHabits,
    dominantFailureReason,
    dominantFailureTime,
    userQuery
  } = params;

  // If user asked a specific prompt:
  if (userQuery && userQuery.trim()) {
    const q = userQuery.toLowerCase();
    if (q.includes('صبح') || q.includes('سحرخیز') || q.includes('بیداری') || q.includes('خواب')) {
      return {
        coachVerdict: 'جنگجو، سحرخیزی نقطه ثقل پیروزی است. نبرد صبحگاه از شب قبل آغاز می‌شود؛ تاریکی شب را با نور صفحه موبایل نسوزان تا طلوع خورشید را با صلابت فتح کنی.',
        keyAdvice: 'امشب ساعت ۲۲:۳۰ همه دستگاه‌های دیجیتال را خاموش کن و لیوان آب بزرگی کنار تخت بگذار.',
        strategicWarning: 'افت در سحرخیزی به صورت دومینویی تمام ارکان ۴ گانه بعدی را تا غروب سرنگون می‌کند.',
        bushidoQuote: 'کسی که بر صبحگاه خود مسلط شود، بر تمام سرنوشت آن روز فرمان می‌راند.'
      };
    }
    if (q.includes('ورزش') || q.includes('خستگی') || q.includes('انرژی') || q.includes('بدن')) {
      return {
        coachVerdict: 'جسم، زره اراده توست. تمرین ورزشی برای سامورایی یک تفریح نیست، بلکه تجدید بیعت با دیسیپلین فیزیولوژیک است.',
        keyAdvice: 'حتی اگر خسته‌ای، حداقل ۲۰ دقیقه پیاده‌روی تند یا تمرین وزن بدن انجام بده تا رکود بدنی شکسته شود.',
        strategicWarning: 'بی‌تحرکی مغز را در حالت رخوت و تولید دوپامین تنبل قفل می‌کند.',
        bushidoQuote: 'شمشیر صیقل‌نخورده زنگ می‌زند و جنگجوی بی‌تحرک در برابر اولین باد تسلیم می‌شود.'
      };
    }
    if (q.includes('کار سخت') || q.includes('تمرکز') || q.includes('پشت گوش') || q.includes('اهمال') || q.includes('تنبلی')) {
      return {
        coachVerdict: 'سنگین‌ترین قورباغه را همان ابتدا ببلع. دلیل فرار تو از کار سخت، احساس ابهام در مقیاس آن است؛ آن را به گام‌های ۲۵ دقیقه‌ای تبدیل کن.',
        keyAdvice: 'تکنیک تک‌تسک: تمام تب‌ها و برنامه‌ها را ببند و فقط یک فایل کاری را باز نگه دار.',
        strategicWarning: 'به تعویق انداختن کار سخت به ساعات عصر، درصد شکست آن را تا ۳ برابر افزایش می‌دهد.',
        bushidoQuote: 'هنگام مواجهه با کوه، به قله نگاه نکن؛ اولین تیشه را با تمام قدرت فرود بیاور.'
      };
    }
  }

  // General Sensei Briefing based on actual metrics
  let coachVerdict = '';
  let keyAdvice = '';
  let strategicWarning = '';
  let bushidoQuote = 'راه سامورایی در پایبندی بی‌چون‌وچرا به عهد خویش است.';

  if (disciplinePercentage >= 80) {
    coachVerdict = `دلاور، نرخ انضباط ${disciplinePercentage}٪ با ${pureStreak} روز استریک متوالی نشان‌دهنده شکل‌گیری دیسیپلین پولادین در «${cycleTitle}» است. ریتم جنگی شما در استاندارد عالی قرار دارد.`;
    keyAdvice = 'از تله غرور و آسودگی خاطر دوری کن. حفظ قله همواره از فتح آن دشوارتر است.';
    strategicWarning = 'در روزهای موفقیت، مراقب انحراف‌های ریز باشید که به آرامی ساختار را سست می‌کنند.';
    bushidoQuote = 'آرامش سامورایی در میان طوفان است و هوشیاری‌اش در اوج آرامش.';
  } else if (disciplinePercentage >= 60) {
    coachVerdict = `عملکرد شما در روز ${elapsedDays} با نرخ ${disciplinePercentage}٪ در وضعیت ${disciplineLevel} ارزیابی می‌شود. پتانسیل جهش بالاست اما لغزش‌های گاه‌وبیگاه پیوستگی را تهدید می‌کنند.`;
    keyAdvice = 'روی ساعت طلایی شروع روز تمرکز کن تا قبل از ظهر حداقل ۳ پایه از ۵ پایه تکمیل شده باشند.';
    strategicWarning = vulnerableHabits.length > 0 
      ? `ضعف در ${vulnerableHabits.map(v => v.titleFa).join(' و ')} نیازمند تقویت فوری است.`
      : 'از رها کردن نیمه‌کاره کارها در ساعات پس از ظهر بپرهیزید.';
    bushidoQuote = 'پیروزی واقعی نه در شکست‌ناپذیری، بلکه در ایستادن دوباره پس از هر لغزش است.';
  } else {
    coachVerdict = `هشدار دیوان بوشیدو: سطح انضباط جاری (${disciplinePercentage}٪) حاکی از اختلال در ساختار تعهدات است. در ${remainingDays} روز باقیمانده، فرصت بازسازی تمام‌عیار وجود دارد.`;
    keyAdvice = 'ساده‌سازی روتین: فردا فقط و فقط روی ۲ پایه حیاتی تمرکز کن تا حس پیشروی دوباره زنده شود.';
    strategicWarning = `بیشترین تلفات شما در بازه «${dominantFailureTime}» با انگیزه «${dominantFailureReason}» رخ داده است. این نقطه کور را مسدود کنید.`;
    bushidoQuote = 'جنگجو وقتی می‌افتد، به زمین نگاه نمی‌کند؛ برمی‌خیزد و شمشیرش را محکم‌تر می‌گیرد.';
  }

  return {
    coachVerdict,
    keyAdvice,
    strategicWarning,
    bushidoQuote
  };
}

/**
 * Deterministic Bushido Court Final Judgment
 * Generates official sealed verdicts based on 90-day data
 */
export function getDeterministicCourtVerdict(params: {
  cycleTitle: string;
  standardDays: number;
  totalDays: number;
  maxStreak: number;
  disciplinePercentage: number;
  vulnerableHabits: VulnerableHabit[];
}): DeterministicCourtResult {
  const {
    cycleTitle,
    standardDays,
    totalDays,
    maxStreak,
    disciplinePercentage,
    vulnerableHabits
  } = params;

  let grade: 'A+' | 'A' | 'B' | 'C' | 'F' = 'B';
  let verdict = '';
  let senseiNotes = '';
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  let tacticalPlanForNextCycle = '';

  if (disciplinePercentage >= 85) {
    grade = 'A+';
    verdict = `دیوان عالی بوشیدو با افتخار و احترام، پایبندی استثنایی شما را در چرخه «${cycleTitle}» به رسمیت می‌شناسد. دستیابی به ${standardDays} روز استاندارد کامل از مجموع ${totalDays} روز و ثبت زنجیره متوالی ${maxStreak} روز، گواه تسلط کامل بر نفس و پی‌ریزی شاکله دیسیپلین آهنین است.`;
    senseiNotes = 'شما ثابت کردید که مرزهای توانایی انسان نه توسط احساسات، بلکه توسط تعهد به ساختار تعیین می‌شود. این دستاورد شایسته ستایش است.';
    strengths.push('تداوم بی‌نقص در زنجیره روزهای استاندارد', 'مهار کامل وسوسه‌های اهمال‌کاری', 'ایجاد پایداری حداکثری در ۵ رکن فونداسیون');
    weaknesses.push('لزوم مراقبت از فرسودگی در دوره‌های با شدت بالا');
    tacticalPlanForNextCycle = 'ارتقای سطح چالش: افزایش بار کاری در تسک‌های سخت و ورود به قلمرو چرخه‌های تخصصی مهارتی.';
  } else if (disciplinePercentage >= 70) {
    grade = 'A';
    verdict = `دیوان بوشیدو عملکرد شما را در چرخه «${cycleTitle}» با احراز رتبه پایدار و شاخص انضباط ${disciplinePercentage}٪ مورد تایید قرار می‌دهد. ثبت ${standardDays} روز موفق و رکورد استریک ${maxStreak} روز نشان‌دهنده اراده استوار در میدان نبرد روزانه است.`;
    senseiNotes = 'رشد محسوسی در مقایسه با شروع دوره دیده می‌شود. ساختار روزانه شما تثبیت شده و اکنون آماده جهش به سطوح بالاتر هستید.';
    strengths.push('پایداری عالی در شروع روز', 'بازیابی موثر پس از روزهای افت', 'کاهش نرخ روزهای سوخته بدون کالبدشکافی');
    if (vulnerableHabits.length > 0) {
      weaknesses.push(`افت مقطعی در رکن «${vulnerableHabits[0].titleFa}»`);
    } else {
      weaknesses.push('نوسان در کار سخت در روزهای آخر هفته');
    }
    tacticalPlanForNextCycle = 'تثبیت حداقل ۲۵ روز استاندارد در هر ماه و پوشش کامل نقاط ضعف شناسایی‌شده در کالبدشکافی‌ها.';
  } else if (disciplinePercentage >= 50) {
    grade = 'B';
    verdict = `دیوان بوشیدو پایان چرخه ۹۰ روزه «${cycleTitle}» را با رتبه متوسط (${disciplinePercentage}٪) ثبت می‌نماید. تلاش‌های شما برای بازگشت به ریتم شایسته تقدیر است، اما نوسانات رفتاری مانع از آزادسازی تمام ظرفیت سیستم شد.`;
    senseiNotes = 'اصلی‌ترین دشمن شما در این دوره، توهم وقت داشتن در ساعات میانی روز بوده است. ساختار نیاز به سفت‌تر شدن دارد.';
    strengths.push('ثبت رکوردهای انفرادی در روزهای با انگیزه بالا', 'پایبندی به تسویه بدهی‌های کالبدشکافی');
    weaknesses.push('افت مکرر در فونداسیون‌های اصلی به ویژه در اواخر هفته', 'پیوستگی ناکافی در زنجیره متوالی');
    tacticalPlanForNextCycle = 'کاهش اهداف فانتزی و تمرکز تمام‌عیار روی ۳ رکن اصلی تا دستیابی به ۲۰ روز استاندارد پیوسته.';
  } else {
    grade = 'C';
    verdict = `دیوان بوشیدو چرخه «${cycleTitle}» را با شاخص ${disciplinePercentage}٪ بایگانی می‌کند. این دوره حامل درس‌های ارزشمندی از نقاط آسیب‌پذیری روانی و رفتاری شماست که نباید نادیده گرفته شوند.`;
    senseiNotes = 'شکست در این چرخه پایان راه نیست، بلکه نقشه راه شفافی از مواضع نیازمند بازسازی است.';
    strengths.push('شجاعت در مواجهه با واقعیت داده‌ها و عدم انکار شکست');
    weaknesses.push('تسلیم شدن زودهنگام در برابر اصطکاک‌های خرد', 'توقف‌های طولانی‌مدت پس از افت');
    tacticalPlanForNextCycle = 'آغاز فوری چرخه ترمیمی جدید با تمرکز صرف بر سحرخیزی و کار سخت به مدت ۳۰ روز.';
  }

  return {
    verdict,
    grade,
    senseiNotes,
    strengths,
    weaknesses,
    tacticalPlanForNextCycle
  };
}
