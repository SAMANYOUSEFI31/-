import fs from 'fs';
import path from 'path';
import {
  SUPER_ADMIN_PHONE,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_PASS,
  SUPER_ADMIN_NAME,
  isSuperAdminIdentifier,
  hashPassword,
  allowTestShortcuts
} from '../security.js';

// Prisma client state management (shared across all db modules)
export let prisma: any = null;
export let isPrismaAvailable = false;

export function setPrismaState(client: any, available: boolean) {
  prisma = client;
  isPrismaAvailable = available;
}

// Harmonize connection string variables for Prisma & Vercel / Neon / Supabase
export function harmonizeDatabaseEnv(): string | null {
  const dbUrl =
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.DIRECT_URL ||
    null;

  const directUrl =
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DIRECT_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    dbUrl;

  if (dbUrl) {
    if (!process.env.POSTGRES_PRISMA_URL) process.env.POSTGRES_PRISMA_URL = dbUrl;
    if (!process.env.DATABASE_URL) process.env.DATABASE_URL = dbUrl;
    if (!process.env.POSTGRES_URL_NON_POOLING && directUrl) process.env.POSTGRES_URL_NON_POOLING = directUrl;
    if (!process.env.DIRECT_URL && directUrl) process.env.DIRECT_URL = directUrl;
  }

  return dbUrl;
}

// In-Memory / File Persistent Store Fallback (Ensures 100% operational guarantee)
export interface DBUser {
  id: string;
  email?: string | null;
  phoneNumber?: string | null;
  name?: string | null;
  passwordHash?: string | null;
  tier: string;
  isVip: boolean;
  isAdmin?: boolean;
  nightOwlCutoffHour?: number;
  accentTheme?: string;
  vipSince?: string | null;
  vipExpiresAt?: string | null;
  paymentRefId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DBCycle {
  id: string;
  userId: string;
  title: string;
  startDate: string;
  endDate: string;
  targetTheme?: string | null;
  inheritedStreak: number;
  rules: string[];
  isArchived: boolean;
  reportRead: boolean;
  verdict?: any;
  createdAt: string;
  updatedAt: string;
}

export interface DBDailyLog {
  id: string;
  userId: string;
  cycleId: string;
  date: string;
  wakeUp: boolean;
  workout: boolean;
  study: boolean;
  journal: boolean;
  hardTask: boolean;
  specialMission: boolean;
  failureReason?: string | null;
  failureTime?: string | null;
  autopsyNotes?: string | null;
  countermeasure?: string | null;
  aiFeedback?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DBOtpCode {
  id: string;
  identifier: string;
  code: string;
  expiresAt: string;
  verified: boolean;
  userId?: string | null;
  createdAt: string;
}

export type DBSubscriptionStatus = 'PENDING' | 'SUCCESS' | 'FAILED';

export interface DBSubscription {
  id: string;
  userId: string;
  planId: string;
  amount: number;
  authority: string;
  refId?: string | null;
  cardPan?: string | null;
  status: DBSubscriptionStatus;
  description?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalStore {
  users: DBUser[];
  cycles: DBCycle[];
  dailyLogs: DBDailyLog[];
  otpCodes: DBOtpCode[];
  subscriptions: DBSubscription[];
}

export function getStorageFilePath(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join('/tmp', 'bushido_local_db.json');
  }
  return path.join(process.cwd(), 'bushido_local_db.json');
}

export const DB_FILE_PATH = getStorageFilePath();

export function loadLocalStore(): LocalStore {
  try {
    const primaryPath = getStorageFilePath();
    if (fs.existsSync(primaryPath)) {
      const data = fs.readFileSync(primaryPath, 'utf-8');
      return JSON.parse(data);
    }
    // Also check cwd fallback if /tmp doesn't have it yet
    const cwdPath = path.join(process.cwd(), 'bushido_local_db.json');
    if (primaryPath !== cwdPath && fs.existsSync(cwdPath)) {
      const data = fs.readFileSync(cwdPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    // Silent safe parse fallback
  }
  return {
    users: [],
    cycles: [],
    dailyLogs: [],
    otpCodes: [],
    subscriptions: []
  };
}

export let memoryStore: LocalStore = loadLocalStore();

let hasWarnedReadOnly = false;

export function saveLocalStore() {
  // If Prisma is active and running, we do not write to local JSON file
  if (isPrismaAvailable && prisma) {
    return;
  }

  try {
    const filePath = getStorageFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(memoryStore, null, 2), 'utf-8');
  } catch (e: any) {
    // Avoid spamming serverless logs on EROFS or permissions issues
    if (!hasWarnedReadOnly) {
      hasWarnedReadOnly = true;
      console.warn('[Database] Local file persistence fallback active in RAM (/tmp or read-only filesystem):', e?.message || e);
    }
  }
}

// -------------------------------------------------------------
// Seed initial starter pack for a new user
// -------------------------------------------------------------
export function seedUserData(userId: string): { cycle: DBCycle; logs: DBDailyLog[] } {
  const now = new Date();
  const todayIso = now.toISOString().split('T')[0];

  const addDays = (dStr: string, days: number) => {
    const [y, m, d] = dStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().split('T')[0];
  };

  const cycleStart = addDays(todayIso, -24);
  const cycleEnd = addDays(cycleStart, 89);

  const starterCycle: DBCycle = {
    id: `cycle-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    userId,
    title: 'چرخه ۱ (نمونه) — فونداسیون اراده و دیسیپلین آهنین',
    startDate: cycleStart,
    endDate: cycleEnd,
    targetTheme: 'تسلط بر سحرخیزی، ۱۰۰ ساعت کار عمیق و ثبات در ورزش روزانه',
    inheritedStreak: 0,
    rules: [
      'ساعت بیدارباش ۵:۳۰ صبح بدون استفاده از اسنوز',
      'هیچ روزی بدون حداقل ۳۰ دقیقه ورزش و تحرک سپری نمی‌شود',
      'ثبت روزانه بلافاصله قبل از خواب در میدان نبرد',
      'کالبدشکافی بدون تعارف در صورت هرگونه افت'
    ],
    isArchived: false,
    reportRead: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const starterLogs: DBDailyLog[] = [];

  for (let i = 0; i <= 24; i++) {
    const logDate = addDays(cycleStart, i);
    const isToday = logDate === todayIso;

    if (isToday) {
      starterLogs.push({
        id: `log-${userId}-${logDate}`,
        userId,
        cycleId: starterCycle.id,
        date: logDate,
        wakeUp: true,
        workout: true,
        study: true,
        journal: false,
        hardTask: true,
        specialMission: true,
        notes: 'تمرکز بالا روی وظایف روزانه و شروع عالی صبح',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    } else if (i === 18) {
      starterLogs.push({
        id: `log-${userId}-${logDate}`,
        userId,
        cycleId: starterCycle.id,
        date: logDate,
        wakeUp: true,
        workout: false,
        study: false,
        journal: true,
        hardTask: false,
        specialMission: false,
        failureReason: 'دلایل شخصی',
        failureTime: 'وسط روز',
        autopsyNotes: 'سفر کاری اضطراری و عدم دسترسی به امکانات عادی. ریتم فریز شد.',
        countermeasure: 'حفظ استانداردهای ذهنی و ژورنال‌نویسی شبانه در شرایط بحران.',
        createdAt: new Date(Date.now() - (24 - i) * 86400000).toISOString(),
        updatedAt: new Date().toISOString()
      });
    } else if (i === 11) {
      starterLogs.push({
        id: `log-${userId}-${logDate}`,
        userId,
        cycleId: starterCycle.id,
        date: logDate,
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
        aiFeedback: 'افت اصلی ناشی از تصمیم‌گیری واکنشی به جای کنشگرانه بوده است.',
        createdAt: new Date(Date.now() - (24 - i) * 86400000).toISOString(),
        updatedAt: new Date().toISOString()
      });
    } else {
      starterLogs.push({
        id: `log-${userId}-${logDate}`,
        userId,
        cycleId: starterCycle.id,
        date: logDate,
        wakeUp: true,
        workout: true,
        study: true,
        journal: true,
        hardTask: true,
        specialMission: i % 3 === 0,
        notes: i % 4 === 0 ? 'انرژی و تمرکز فوق‌العاده. تسلط کامل بر زمان.' : undefined,
        createdAt: new Date(Date.now() - (24 - i) * 86400000).toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  }

  return { cycle: starterCycle, logs: starterLogs };
}

// -------------------------------------------------------------
// Initialize Default Admin & Test Users
// -------------------------------------------------------------
// -------------------------------------------------------------
// Initialize Default Admin & Test Users
// -------------------------------------------------------------
export function ensureDefaultAdminAndUsers() {
  const nowStr = new Date().toISOString();
  const nextYearStr = new Date(Date.now() + 365 * 86400000).toISOString();

  // بدون رمز ادمین معتبر در env، seed ادمین انجام نشود
  if (!SUPER_ADMIN_PASS || String(SUPER_ADMIN_PASS).trim().length < 8) {
    console.warn('[Database] SUPER_ADMIN_PASS خالی یا کوتاه است؛ seed ادمین انجام نشد.');
  }

  const adminHashedPass =
    SUPER_ADMIN_PASS && String(SUPER_ADMIN_PASS).trim().length >= 8
      ? hashPassword(SUPER_ADMIN_PASS)
      : null;

  // 1. Master Admin فقط وقتی SUPER_ADMIN_PASS تنظیم شده باشد
  const existingAdmin = memoryStore.users.find(
    (u) =>
      u.id === 'admin-master-001' ||
      u.phoneNumber === SUPER_ADMIN_PHONE ||
      u.email === SUPER_ADMIN_EMAIL
  );

  if (adminHashedPass && !existingAdmin) {
    const adminUser: DBUser = {
      id: 'admin-master-001',
      email: SUPER_ADMIN_EMAIL || null,
      phoneNumber: SUPER_ADMIN_PHONE || null,
      name: SUPER_ADMIN_NAME,
      passwordHash: adminHashedPass,
      tier: 'vip_samurai',
      isVip: true,
      isAdmin: true,
      nightOwlCutoffHour: 4,
      accentTheme: 'amber',
      vipSince: nowStr,
      vipExpiresAt: nextYearStr,
      paymentRefId: 'REF-ADMIN-MASTER-001',
      createdAt: nowStr,
      updatedAt: nowStr
    };
    memoryStore.users.unshift(adminUser);
  } else if (adminHashedPass && existingAdmin) {
    existingAdmin.id = 'admin-master-001';
    if (SUPER_ADMIN_PHONE) existingAdmin.phoneNumber = SUPER_ADMIN_PHONE;
    if (SUPER_ADMIN_EMAIL) existingAdmin.email = SUPER_ADMIN_EMAIL;
    existingAdmin.name = SUPER_ADMIN_NAME;
    existingAdmin.passwordHash = adminHashedPass;
    existingAdmin.isAdmin = true;
    existingAdmin.isVip = true;
    existingAdmin.tier = 'vip_samurai';
    if (!existingAdmin.vipExpiresAt) existingAdmin.vipExpiresAt = nextYearStr;
  }

  // 2. کاربر تست (برای محیط توسعه / ALLOW_TEST_SHORTCUTS)
  const testHashedPass = hashPassword('test1234');
  const existingTestUser = memoryStore.users.find(
    (u) => u.id === 'test-user-001' || u.email === 'test@bushido.app'
  );
  if (!existingTestUser) {
    const testUser: DBUser = {
      id: 'test-user-001',
      email: 'test@bushido.app',
      phoneNumber: '09121111111',
      name: 'کاربر آزمایشی بوشیدو (دید کاربر)',
      passwordHash: testHashedPass,
      tier: 'free',
      isVip: false,
      isAdmin: false,
      nightOwlCutoffHour: 4,
      accentTheme: 'emerald',
      vipSince: null,
      vipExpiresAt: null,
      paymentRefId: null,
      createdAt: nowStr,
      updatedAt: nowStr
    };
    memoryStore.users.push(testUser);
    const testSeed = seedUserData(testUser.id);
    memoryStore.cycles.push(testSeed.cycle);
    memoryStore.dailyLogs.push(...testSeed.logs);
  } else {
    if (!existingTestUser.passwordHash) {
      existingTestUser.passwordHash = testHashedPass;
    }
  }

  saveLocalStore();
}

// Seed فقط از server.ts یا initializeDatabase صدا زده می‌شود — اینجا خودکار اجرا نشود
