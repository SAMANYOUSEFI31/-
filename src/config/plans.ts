import { SubscriptionPlan } from '../types';

/**
 * Authoritative plan definitions and catalog for Bushido VIP subscriptions.
 * Single source of truth across client and server.
 */
export const PLANS: readonly SubscriptionPlan[] = [
  {
    id: 'samurai_90days',
    title: 'فصل ۹۰ روزه سامورایی VIP',
    titleFa: 'اشتراک یک فصل کامل (۹۰ روز)',
    priceToman: 199000,
    formattedPrice: '۱۹۹,۰۰۰',
    durationMonths: 3,
    durationDays: 90,
    badgeFa: 'پیشنهاد ویژه دیوان',
    isPopular: true,
    tier: 'vip_samurai',
    features: [
      'دسترسی نامحدود به کالبدشکافی عمیق شکست‌ها',
      'مشاوره راهبردی نامحدود با سنسی بوشیدو',
      'صدور گواهینامه رسمی دیوان پایان دوره با مهر طلایی',
      'امکان تعریف و بایگانی نامحدود چرخه‌های ۹۰ روزه',
      'نشان اختصاصی سامورایی ویژه در پروفایل کاربری',
      'پشتیبان‌گیری ابری و خروجی دیتابیس بدون محدودیت'
    ]
  },
  {
    id: 'samurai_annual',
    title: 'عضویت سالانه دلاوران بوشیدو',
    titleFa: 'اشتراک سالانه (۴ چرخه ۹۰ روزه)',
    priceToman: 590000,
    formattedPrice: '۵۹۰,۰۰۰',
    durationMonths: 12,
    durationDays: 365,
    badgeFa: '۳۰٪ تخفیف طلایی',
    isPopular: false,
    tier: 'vip_samurai',
    features: [
      'شامل تمام امکانات پلن ۹۰ روزه',
      'دسترسی مادام‌العمر به آرشیو تحلیل‌های شکست',
      'اولویت در دریافت امکانات و ابزارهای جدید',
      'نشان افسانه‌ای جنگجوی برتر (Legendary Warrior)'
    ]
  }
] as const;

export function getPlanById(planId: string): SubscriptionPlan | null {
  if (!planId || typeof planId !== 'string') return null;
  const normalizedId = planId.trim();
  return PLANS.find(p => p.id === normalizedId) || null;
}

export function isValidPlanId(planId: string): boolean {
  return getPlanById(planId) !== null;
}

export function getAllPlans(): SubscriptionPlan[] {
  return [...PLANS];
}
