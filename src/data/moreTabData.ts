import { HabitKey } from '../types';

export interface HabitPhilosophy {
  key: HabitKey;
  titleFa: string;
  subtitleFa: string;
  iconName: string;
  color: string;
  whyItMatters: string;
  dailyStandard: string;
  commonPitfalls: string;
  tacticalAdvice: string;
}

export const BUSHIDO_HABITS_PHILOSOPHY: HabitPhilosophy[] = [
  {
    key: 'wakeUp',
    titleFa: 'سحرخیزی و بیدارباش',
    subtitleFa: 'بیدارباش سر ساعت بدون بهانه و چانه‌زنی با ذهن',
    iconName: 'Sun',
    color: 'amber',
    whyItMatters: 'سحرخیزی اولین نبرد روز و پایه تسلط اراده بر تنبلی است. کسی که اولین تصمیم صبح را ببازد، کنترل بقیه روز را هم از دست می‌دهد.',
    dailyStandard: 'بیدار شدن در ساعت تعیین‌شده شخصی بدون زدن دکمه اسنوز (Snooze) و خروج فوری از رختخواب.',
    commonPitfalls: 'به تعویق انداختن زنگ بیدارباش، در رختخواب ماندن با گوشی، و نداشتن ساعت خواب شبانه مشخص.',
    tacticalAdvice: 'گوشی یا ساعت زنگ‌دار را دور از دسترس تخت بگذارید تا برای خاموش کردن آن مجبور به ایستادن شوید.'
  },
  {
    key: 'workout',
    titleFa: 'ورزش و فعالیت بدنی',
    subtitleFa: 'فعالیت بدنی هدفمند، منظم و تقویت تاب‌آوری جسم',
    iconName: 'Dumbbell',
    color: 'emerald',
    whyItMatters: 'جسم قوی ابزار اجرای تصمیمات ذهن است. ترشح اندورفین و بهبود گردش خون انرژی لازم برای ساعت‌ها تمرکز را فراهم می‌کند.',
    dailyStandard: 'حداقل ۳۰ تا ۴۵ دقیقه تمرین پرفشار، تمرین قدرتی یا هوازی با برنامه منظم.',
    commonPitfalls: 'بهانه کمبود وقت، انجام تمرین بدون برنامه و شدت کافی، یا متوقف کردن به خاطر بی‌حوصلگی.',
    tacticalAdvice: 'لباس‌های تمرین را از شب قبل آماده کنید و زمان تمرین را به عنوان یک جلسه غیرقابل لغو در تقویم بگذارید.'
  },
  {
    key: 'study',
    titleFa: 'مطالعه تخصصی',
    subtitleFa: 'تغذیه ذهن، مطالعه عمیق کتاب‌های مرجع و ارتقای مهارت',
    iconName: 'BookOpen',
    color: 'blue',
    whyItMatters: 'بدون ورودی‌های فکری باکیفیت، ذهن دچار روزمرگی و رکود تحلیلی می‌شود. مطالعه عمیق مزیت رقابتی پایدار شماست.',
    dailyStandard: 'حداقل ۳۰ دقیقه مطالعه متمرکز کتاب‌های تخصصی، فلسفه، بیوگرافی یا مهارت‌های استراتژیک.',
    commonPitfalls: 'مطالعه پراکنده مقالات شبکه‌های اجتماعی به جای کتاب، حواس‌پرتی در حین مطالعه و یادداشت‌برداری نکردن.',
    tacticalAdvice: 'در طول زمان مطالعه، تلفن همراه را در حالت پرواز و دور از اتاق کار قرار دهید.'
  },
  {
    key: 'journal',
    titleFa: 'ژورنال‌نویسی و بازتاب',
    subtitleFa: 'ثبت روزانه، تخلیه ذهن، ریشه‌یابی و شفافیت استراتژیک',
    iconName: 'PenTool',
    color: 'violet',
    whyItMatters: 'ذهن پردازشگر است نه انبار داده. ژورنال‌نویسی افکار مبهم را به تصمیمات شفاف تبدیل کرده و اضطراب را از بین می‌برد.',
    dailyStandard: 'ثبت وقایع کلیدی روز، ارزیابی موفقیت‌ها/شکست‌ها، تخلیه ذهنی و برنامه‌ریزی روز بعد.',
    commonPitfalls: 'ثبت نامنظم، کمال‌گرایی در نگارش، یا نگاه تشریفاتی داشتن به نوشتن.',
    tacticalAdvice: 'هر شب قبل از خواب یا اول صبح، ۵ تا ۱۰ دقیقه به صورت آزاد و بدون ویرایش بنویسید.'
  },
  {
    key: 'hardTask',
    titleFa: 'کار سخت روز (قورباغه بزرگ)',
    subtitleFa: 'انجام سنگین‌ترین و تعیین‌کننده‌ترین اولویت کاری',
    iconName: 'Briefcase',
    color: 'rose',
    whyItMatters: 'مشغول بودن به کارهای ساده توهم پیشرفت ایجاد می‌کند. جهش‌های واقعی زمانی اتفاق می‌افتد که بزرگ‌ترین مانع را بردارید.',
    dailyStandard: 'تکمیل یا پیشبرد اساسی مهم‌ترین وظیفه‌ای که بیشترین مقاومت ذهنی را برای انجام آن دارید.',
    commonPitfalls: 'شروع روز با چک کردن پیام‌ها و ایمیل‌ها و فرار به سمت کارهای کوچک و کم‌اهمیت.',
    tacticalAdvice: 'سخت‌ترین کار را در اولین بلوک کاری روز (صبح زود) انجام دهید تا آرامش فکری کل روز تضمین شود.'
  }
];

export interface SupportContactInfo {
  title: string;
  description: string;
  channel: string;
  value: string;
  actionLabel: string;
  link?: string;
  iconName: string;
}

export const SUPPORT_CONTACT_CHANNELS: SupportContactInfo[] = [
  {
    title: 'پشتیبانی آنلاین تلگرام',
    description: 'ارتباط مستقیم با تیم پشتیبانی و دریافت پاسخ سریع',
    channel: 'Telegram',
    value: '@BushidoSupport',
    actionLabel: 'ارسال پیام در تلگرام',
    link: 'https://t.me/BushidoSupport',
    iconName: 'Send'
  },
  {
    title: 'کانال رسمی جامعه بوشیدو',
    description: 'دریافت آپدیت‌ها، نکات انضباطی و راهنماهای چرخه‌های ۹۰ روزه',
    channel: 'Telegram Channel',
    value: '@BushidoDiscipline',
    actionLabel: 'عضویت در کانال',
    link: 'https://t.me/BushidoDiscipline',
    iconName: 'Radio'
  },
  {
    title: 'پشتیبانی ایمیلی',
    description: 'ارسال پیشنهادات، گزارش باگ یا مسائل مربوط به حساب کاربری',
    channel: 'Email',
    value: 'support@bushido.app',
    actionLabel: 'ارسال ایمیل',
    link: 'mailto:support@bushido.app',
    iconName: 'Mail'
  }
];

export interface SystemDisciplineRule {
  id: string;
  title: string;
  badge: string;
  description: string;
  iconName: 'CheckCircle2' | 'Award' | 'AlertOctagon' | 'Snowflake';
  colorToken: 'emerald' | 'amber' | 'debt' | 'blue';
}

export const BUSHIDO_SYSTEM_RULES: SystemDisciplineRule[] = [
  {
    id: 'standard-day',
    title: 'قانون روز استاندارد',
    badge: '۸ از ۱۰',
    description: 'تکمیل تمام ۵ پایه روزانه معادل ۸ امتیاز است. هر روزی که به این حد نصاب برسد، یک روز موفق محسوب شده و زنجیره پیشروی می‌کند.',
    iconName: 'CheckCircle2',
    colorToken: 'emerald'
  },
  {
    id: 'mastery-day',
    title: 'قانون کمال و تسلط',
    badge: '۱۰ از ۱۰',
    description: 'رسیدن به امتیاز کامل نیازمند تکمیل ۵ پایه به علاوه انجام ماموریت ویژه در راستای هدف ۹۰ روزه چرخه است؛ این نشان، برترین رکورد افتخار در تالار سوابق است.',
    iconName: 'Award',
    colorToken: 'amber'
  },
  {
    id: 'debt-autopsy',
    title: 'قانون کالبدشکافی بدهی (Debt)',
    badge: 'کسر امتیاز',
    description: 'هر روزی که به حد نصاب نرسد، بدهی انضباطی ایجاد می‌کند. تا زمان کالبدشکافی، ثبت ریشه ناکامی و پادزهر عملی، وضعیت هشدار باقی می‌ماند.',
    iconName: 'AlertOctagon',
    colorToken: 'debt'
  },
  {
    id: 'emergency-freeze',
    title: 'قانون توقف موجه (فریز اضطراری)',
    badge: 'حفظ زنجیره',
    description: 'در صورت بیماری شدید یا شرایط فورس‌ماژور، ثبت «دلایل شخصی» مانع از سوختن زنجیره می‌شود؛ اما امتیازی به آن روز اختصاص نمی‌یابد.',
    iconName: 'Snowflake',
    colorToken: 'blue'
  }
];

export interface SpecialMissionPhilosophy {
  title: string;
  subtitle: string;
  howItWorks: string;
  criteria: string;
  tacticalTip: string;
}

export const BUSHIDO_SPECIAL_MISSION_GUIDE: SpecialMissionPhilosophy = {
  title: 'ماموریت ویژه روزانه (جهش هدف ۹۰ روزه)',
  subtitle: 'پیوند عمیق بین عادات روزانه و دستاورد نهایی چرخه ۹۰ روزه',
  howItWorks: 'در شروع هر چرخه، شما یک هدف کلیدی ۹۰ روزه برای خود تعیین می‌کنید. هر روزی که علاوه بر ۵ پایه، دست‌کم یک اقدام مشخص در جهت این هدف انجام دهید، تیک «ماموریت ویژه روز» (+۲ امتیاز) را می‌زنید تا به امتیاز کامل ۱۰ از ۱۰ برسید.',
  criteria: 'معیار ثبت: هر اقدامی که مستقیماً خروجی، پیشرفت ملموس یا گامی عملی به سوی هدف چرخه باشد (مانند نگارش یک بخش، کدنویسی یک ویژگی، یا تمرین تخصصی).',
  tacticalTip: 'ماموریت ویژه را با کارهای روتین اشتباه نگیرید؛ این اقدام، تعیین‌کننده‌ترین گام شما در طول روز برای فتح چرخه ۹۰ روزه است.'
};

