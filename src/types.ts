export type HabitKey = 'wakeUp' | 'workout' | 'study' | 'journal' | 'hardTask';

export interface HabitDef {
  key: HabitKey;
  title: string;
  titleFa: string;
  subtitleFa: string;
  iconName: string;
  color: string;
}

export type FailureReason = 
  | 'وقتم رو به خوبی مدیریت نکردم'
  | 'نیمه‌کاره رها کردم'
  | 'بی‌برنامه بودم'
  | 'دلایل شخصی'
  | '';

export type FailureTime = 
  | 'اول روز'
  | 'وسط روز'
  | 'آخر روز'
  | '';

export type DayStatusType = 
  | 'standard'          // تعهد کامل | پایه‌ها اجرا شد 🟢
  | 'personal_frozen'   // توقف اضطراری | ریتم فریز شد ❄️
  | 'burned_unresolved' // کالبدشکافی نشده | بدهی باز ⚠️
  | 'burned_resolved';  // پرونده این شکست بسته شد 🔴

export type CycleStatusType = 
  | 'active'            // ⚡ چرخه فعال
  | 'upcoming'          // ⏳ چرخه آینده
  | 'ready_for_court'   // ⚖ آماده برای قرارگاه بوشیدو
  | 'archived'          // 📦 بایگانی شده
  | 'overlap_error';    // ⚠️ تداخل تقویمی

export type DisciplineLevel = 
  | '🛡️ انضباط آهنین'
  | '⚔️ انضباط پایدار'
  | '👺 انضباط ناپایدار'
  | '👹 بحران تعهد'
  | '⏳ آینده'
  | '⚠️ خطای ساختار';

export interface DailyLog {
  id: string;
  cycleId: string;
  date: string; // YYYY-MM-DD
  createdAt: string;
  isSynced?: boolean; // نشانگر همگام‌سازی ابری آفلاین به آنلاین
  revision?: number;
  
  // Foundation 5 Core Habits
  wakeUp: boolean;     // سحرخیزی
  workout: boolean;    // ورزش
  study: boolean;      // مطالعه
  journal: boolean;    // ژورنال‌نویسی
  hardTask: boolean;   // کار سخت روز
  
  // Bonus Gamification
  specialMission: boolean; // ماموریت ویژه (+2 pts)
  
  // Failure Layer (کالبدشکافی شکست)
  failureReason?: FailureReason;
  failureTime?: FailureTime;
  autopsyNotes?: string;    // یادداشت‌های ریشه‌یابی
  countermeasure?: string;  // قانون مقابله و استراتژی فردا
  aiFeedback?: string;      // تحلیل اختصاصی هوش مصنوعی

  // Daily reflection notes
  notes?: string;
}

export interface CycleVerdict {
  verdict: string;
  grade: 'A+' | 'A' | 'B' | 'C' | 'F';
  senseiNotes: string;
  strengths: string[];
  weaknesses: string[];
  bushidoSealDate: string;
  tacticalPlanForNextCycle: string;
}

export interface Cycle {
  id: string;
  title: string;          // مثلا: چرخه‌ ۱ - احیای اراده و دیسیپلین آهنین
  startDate: string;      // YYYY-MM-DD
  endDate: string;        // YYYY-MM-DD (calculated startDate + 89 days)
  targetTheme: string;    // تم اصلی چرخه‌ (مثلا سحرخیزی بی‌چون‌وچرا و ۱۰۰ ساعت کار عمیق)
  rules?: string[];       // میثاق‌نامه اختصاصی
  inheritedStreak?: number; // استریک به ارث رسیده از چرخه‌های قبل
  isArchived?: boolean;
  reportRead?: boolean;   // چک‌پوینت تأیید گزارش
  verdict?: CycleVerdict;
  isSynced?: boolean;     // نشانگر همگام‌سازی ابری آفلاین به آنلاین
  revision?: number;
}

export interface SystemSettings {
  id: string;
  platformName: string;
  centralEngineName: string;
  allTimeMaxStreak: number;
  allTimeMaxScore: number;
  allTimeMaxStandardDays: number;
  nightOwlCutoffHour: number; // 4 am default logical day cutoff
  accentTheme?: AccentTheme;
}

export interface VulnerableHabit {
  key: HabitKey;
  titleFa: string;
  ratePct: number;
  successCount: number;
  totalEvaluated: number;
  icon: string;
}

export interface CycleMetrics {
  cycle: Cycle;
  status: CycleStatusType;
  statusLabelFa: string;
  elapsedDays: number;
  remainingDays: number;
  logsCount: number;
  standardDaysCount: number;
  burnedDaysCount: number;
  unresolvedDebtCount: number;
  resolvedDebtCount: number;
  frozenDaysCount: number;
  inactiveDaysCount: number;
  incompleteDaysCount: number;
  totalScore: number;
  disciplineScore: number;       // 0 to 1
  disciplinePercentage: number;  // 0 to 100
  disciplineLevel: DisciplineLevel;
  
  // Streaks
  pureStreak: number;            // خالص این چرخه
  maxPureStreak: number;         // رکورد خالص این چرخه
  inheritedStreak: number;       // ارث از چرخه‌های قبل
  globalLiveStreak: number;      // سراسری زنده
  maxGlobalStreak: number;       // بیشترین استریک سراسری این چرخه
  
  // Failure streaks
  maxFailureRun: number;         // طولانی‌ترین سقوط متوالی
  maxInactiveRun: number;        // طولانی‌ترین انفعال متوالی
  maxIncompleteRun: number;      // بیشترین تلاش ناموفق متوالی
  
  // Analysis
  dominantFailureReason: string;
  dominantFailureTime: string;
  vulnerableHabits: VulnerableHabit[];
  needsIntervention: boolean;
  isCourtReady: boolean;
  coachMessage: string;
}

export interface DailyComputed {
  isStandard: boolean;
  habitsCount: number;
  score: number;
  statusType: DayStatusType;
  needsAutopsy: boolean;
  isLockedDueToPastDebt: boolean;
  coachStatusLabel: string;
  displayScore: string;
  displayProgressBlocks: string;
}

// User and Subscription Types
export type UserSubscriptionTier = 'free' | 'vip_samurai';

export type AccentTheme = 'amber' | 'emerald' | 'crimson' | 'cyan';

export interface UserProfile {
  id: string;
  name: string;
  email?: string;
  phoneNumber?: string;
  tier: UserSubscriptionTier;
  isVip: boolean;
  isAdmin?: boolean;
  vipSince?: string;
  vipExpiresAt?: string;
  paymentRefId?: string;
  activeCycleLimit: number;
  nightOwlCutoffHour?: number;
  accentTheme?: AccentTheme;
}

export interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  user: UserProfile | null;
}

export interface AdminUserItem {
  id: string;
  name: string;
  email?: string | null;
  phoneNumber?: string | null;
  tier: string;
  isVip: boolean;
  isAdmin?: boolean;
  vipSince?: string | null;
  vipExpiresAt?: string | null;
  paymentRefId?: string | null;
  cyclesCount: number;
  logsCount: number;
  subscriptionsCount: number;
  createdAt: string;
}

export type SubscriptionStatus = 'PENDING' | 'SUCCESS' | 'FAILED';

export interface AdminSubscriptionItem {
  id: string;
  userId: string;
  planId: string;
  amount: number;
  authority: string;
  refId?: string | null;
  cardPan?: string | null;
  status: SubscriptionStatus;
  description?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOverviewStats {
  totalUsers: number;
  totalVipUsers: number;
  totalCycles: number;
  totalDailyLogs: number;
  totalSubscriptions: number;
  totalRevenueToman: number;
  databaseMode: string;
}

export interface SubscriptionPlan {
  id: string;
  title: string;
  titleFa: string;
  priceToman: number;
  formattedPrice: string;
  durationMonths: number;
  durationDays?: number;
  badgeFa: string;
  features: string[];
  isPopular?: boolean;
  tier?: UserSubscriptionTier;
}

export interface PaymentRequestResponse {
  status: number; // 100 = success in Zarinpal
  authority: string;
  paymentUrl: string;
  feeType?: string;
  amount: number;
  description: string;
}

export interface SystemState {
  cycles: Cycle[];
  logs: DailyLog[];
  settings: SystemSettings;
  userProfile: UserProfile;
}

export interface PaymentVerifyResponse {
  status: number; // 100 = verified, 101 = already verified
  refId: string;
  cardPan?: string;
  message: string;
  tier: UserSubscriptionTier;
}

export type OfflineMutationType = 
  | 'UPDATE_LOG' 
  | 'UPDATE_CYCLE' 
  | 'CREATE_CYCLE' 
  | 'DELETE_CYCLE'
  | 'UPDATE_PROFILE'
  | 'UPDATE_SETTINGS';

export type ReplayFailureClassification =
  | 'SUCCESS'
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'CONFLICT_DEFERRED'
  | 'PRECONDITION_REQUIRED'
  | 'RATE_LIMITED'
  | 'SERVER_RETRYABLE'
  | 'NETWORK_ERROR'
  | 'ENTITY_MISSING'
  | 'UNKNOWN_MUTATION';

export interface OfflineQueueItem {
  id: string;
  ownerId: string; // Canonical user ID (e.g. 'admin-master-001', 'user-123') or 'guest'
  type: OfflineMutationType;
  payload: any;
  timestamp: number;
  expectedRevision?: number;
  retryCount?: number;
  nextRetryAt?: number;
  lastError?: string;
  classification?: ReplayFailureClassification;
  dedupKey?: string;
}

export type ConflictType = 'CONCURRENCY_CONFLICT' | 'PRECONDITION_REQUIRED';

export interface ClientConflictMetadata {
  id: string;
  ownerId: string;
  entityType: 'CYCLE' | 'DAILY_LOG' | 'USER_PROFILE' | 'SYSTEM_SETTINGS' | string;
  entityId: string;
  mutationType: OfflineMutationType;
  conflictType: ConflictType;
  statusCode: 409 | 428;
  timestamp: number;
  expectedRevision?: number;
  currentRevision?: number;
  messageFa?: string;
  dedupKey?: string;
  clientPayload?: any;
}

