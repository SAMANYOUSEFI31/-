import { Cycle, DailyLog, SystemSettings, UserProfile } from '../types';
import { addDaysToDate, formatDateISO, getLogicalTodayDate } from '../utils/dateUtils';

export const GUEST_USER_PROFILE: UserProfile = {
  id: '',
  name: 'کاربر مهمان (وارد نشده)',
  email: '',
  phoneNumber: '',
  tier: 'free',
  isVip: false,
  isAdmin: false,
  activeCycleLimit: 1
};

export const DEFAULT_ADMIN_USER_PROFILE: UserProfile = {
  id: 'admin-master-001',
  name: 'فرمانده ارشد سامورایی (مدیر)',
  email: 'admin@bushido.app',
  phoneNumber: '09375454050',
  tier: 'vip_samurai',
  isVip: true,
  isAdmin: true,
  vipSince: new Date(Date.now() - 25 * 86400000).toISOString(),
  vipExpiresAt: new Date(Date.now() + 65 * 86400000).toISOString(),
  paymentRefId: 'REF-78942150',
  activeCycleLimit: 99
};

export function createInitialSystemState(): {
  cycles: Cycle[];
  logs: DailyLog[];
  settings: SystemSettings;
  userProfile: UserProfile;
} {
  const todayStr = getLogicalTodayDate();
  
  // Create current Cycle 1 starting ~25 days ago so user sees live active progress
  const cycle1StartDate = addDaysToDate(todayStr, -24);
  const cycle1EndDate = addDaysToDate(cycle1StartDate, 89);

  const cycle1: Cycle = {
    id: 'cycle-1',
    title: 'چرخه ۱ (نمونه) — فونداسیون اراده و دیسیپلین آهنین',
    startDate: cycle1StartDate,
    endDate: cycle1EndDate,
    targetTheme: 'تسلط بر سحرخیزی، ۱۰۰ ساعت کار عمیق و ثبات در ورزش روزانه',
    inheritedStreak: 0,
    rules: [
      'ساعت بیدارباش ۵:۳۰ صبح بدون استفاده از اسنوز',
      'هیچ روزی بدون حداقل ۳۰ دقیقه ورزش و تحرک سپری نمی‌شود',
      'ثبت روزانه بلافاصله قبل از خواب در میدان نبرد',
      'کالبدشکافی بدون تعارف در صورت هرگونه افت'
    ],
    isArchived: false,
    reportRead: false
  };

  // Generate logs for past 24 days + today
  const logs: DailyLog[] = [];

  for (let i = 0; i <= 24; i++) {
    const dayDate = addDaysToDate(cycle1StartDate, i);
    const isToday = dayDate === todayStr;

    if (isToday) {
      // Today: in progress!
      logs.push({
        id: `log-${dayDate}`,
        cycleId: cycle1.id,
        date: dayDate,
        createdAt: new Date().toISOString(),
        wakeUp: true,
        workout: true,
        study: true,
        journal: false, // in progress
        hardTask: true,
        specialMission: true,
        notes: 'تمرکز بالا روی پروژه و شروع عالی صبح'
      });
    } else if (i === 18) {
      // Day 19 was a personal emergency freeze
      logs.push({
        id: `log-${dayDate}`,
        cycleId: cycle1.id,
        date: dayDate,
        createdAt: new Date(Date.now() - (24 - i) * 86400000).toISOString(),
        wakeUp: true,
        workout: false,
        study: false,
        journal: true,
        hardTask: false,
        specialMission: false,
        failureReason: 'دلایل شخصی',
        failureTime: 'وسط روز',
        autopsyNotes: 'سفر کاری اضطراری و عدم دسترسی به امکانات عادی. ریتم فریز شد.',
        countermeasure: 'حفظ استانداردهای ذهنی و ژورنال‌نویسی شبانه در شرایط بحران.'
      });
    } else if (i === 11) {
      // Day 12 was a burned day that got resolved
      logs.push({
        id: `log-${dayDate}`,
        cycleId: cycle1.id,
        date: dayDate,
        createdAt: new Date(Date.now() - (24 - i) * 86400000).toISOString(),
        wakeUp: false,
        workout: true,
        study: true,
        journal: true,
        hardTask: false,
        specialMission: false,
        failureReason: 'وقتم رو به خوبی مدیریت نکردم',
        failureTime: 'آخر روز',
        autopsyNotes: 'اتلاف وقت در شبکه‌های اجتماعی در ساعات اولیه صبح باعث به تعویق افتادن کار سخت شد.',
        countermeasure: 'قانون صفر دسترسی: گوشی قبل از ساعت ۹ صبح در اتاق دیگر قفل می‌شود.',
        aiFeedback: 'افت اصلی ناشی از تصمیم‌گیری واکنشی به جای کنشگرانه بوده است. اعمال قانون صفر گوشی بهترین اقدام تثبیت‌کننده است.'
      });
    } else if (i === 5) {
      // Day 6 was a burned day resolved
      logs.push({
        id: `log-${dayDate}`,
        cycleId: cycle1.id,
        date: dayDate,
        createdAt: new Date(Date.now() - (24 - i) * 86400000).toISOString(),
        wakeUp: true,
        workout: false,
        study: true,
        journal: true,
        hardTask: true,
        specialMission: false,
        failureReason: 'نیمه‌کاره رها کردم',
        failureTime: 'وسط روز',
        autopsyNotes: 'به علت خستگی عصرانه تمرین ورزشی را نیمه‌کاره رها کردم.',
        countermeasure: 'ورزش به ساعات بلافاصله پس از بیداری (۶:۳۰ صبح) منتقل شد.'
      });
    } else {
      // Standard successful day
      logs.push({
        id: `log-${dayDate}`,
        cycleId: cycle1.id,
        date: dayDate,
        createdAt: new Date(Date.now() - (24 - i) * 86400000).toISOString(),
        wakeUp: true,
        workout: true,
        study: true,
        journal: true,
        hardTask: true,
        specialMission: i % 3 === 0,
        notes: i % 4 === 0 ? 'انرژی و تمرکز فوق‌العاده. تسلط کامل بر زمان.' : undefined
      });
    }
  }

  const settings: SystemSettings = {
    id: 'system-main',
    platformName: 'Bushido Discipline OS',
    centralEngineName: 'موتور مرکزی بوشیدو',
    allTimeMaxStreak: 18,
    allTimeMaxScore: 230,
    allTimeMaxStandardDays: 22,
    nightOwlCutoffHour: 4
  };

  const userProfile: UserProfile = {
    id: 'admin-master-001',
    name: 'فرمانده ارشد سامورایی (مدیر)',
    email: 'admin@bushido.app',
    phoneNumber: '09375454050',
    tier: 'vip_samurai',
    isVip: true,
    isAdmin: true,
    vipSince: new Date(Date.now() - 25 * 86400000).toISOString(),
    vipExpiresAt: new Date(Date.now() + 65 * 86400000).toISOString(),
    paymentRefId: 'REF-78942150',
    activeCycleLimit: 99
  };

  return {
    cycles: [cycle1],
    logs,
    settings,
    userProfile
  };
}

export function createEmptySystemState(userProfile?: UserProfile): {
  cycles: Cycle[];
  logs: DailyLog[];
  settings: SystemSettings;
  userProfile: UserProfile;
} {
  const settings: SystemSettings = {
    id: 'system-main',
    platformName: 'Bushido Discipline OS',
    centralEngineName: 'موتور مرکزی بوشیدو',
    allTimeMaxStreak: 0,
    allTimeMaxScore: 0,
    allTimeMaxStandardDays: 0,
    nightOwlCutoffHour: 4
  };

  return {
    cycles: [],
    logs: [],
    settings,
    userProfile: userProfile || GUEST_USER_PROFILE
  };
}

