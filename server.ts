import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import crypto from 'crypto';
import {
  initializeDatabase,
  closeDatabase,
  findUserById,
  findUserByIdentifier,
  findUserByPhoneNumber,
  createUser,
  updateUser,
  deleteUser,
  getUserCycles,
  createCycle,
  updateCycle,
  deleteCycle,
  getUserDailyLogs,
  upsertDailyLog,
  createSubscriptionRecord,
  completeSubscription,
  markSubscriptionFailed,
  getUserSubscriptions,
  adminGetAllUsers,
  adminUpdateUser,
  adminCreateTestUser,
  adminGetAllSubscriptions,
  adminGetOverviewStats,
  ensureDefaultAdminAndUsers,
  isPrismaAvailable
} from './server/db/index.js';
import {
  generateToken,
  authMiddleware,
  adminMiddleware,
  optionalAuthMiddleware,
  AuthenticatedRequest
} from './server/auth.js';
import {
  SUPER_ADMIN_PHONE,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_PASS,
  SUPER_ADMIN_NAME,
  isSuperAdminIdentifier,
  hashPassword,
  verifyPassword,
  allowTestShortcuts,
  isProduction,
  isQuickLoginEnabled,
  isOtpDebugEnabled,
  isMockOtpEnabled,
  isMockPaymentEnabled,
  getSecurityCapabilities
} from './server/security.js';
import {
  apiRateLimiter,
  authRateLimiter,
  setSecurityHeaders,
  errorHandler
} from './server/middleware/security.js';
import {
  validateBody,
  registerSchema,
  registerRequestOtpSchema,
  registerVerifyOtpSchema,
  forgotPasswordRequestOtpSchema,
  resetPasswordWithOtpSchema,
  loginSchema,
  otpRequestSchema,
  resetPasswordSchema,
  createCycleSchema,
  updateCycleSchema,
  upsertDailyLogSchema,
  autopsySchema,
  paymentRequestSchema,
  paymentVerifySchema
} from './server/utils/validation.js';
import { normalizePhoneNumber, isValidIranianMobile } from './server/utils/phone.js';
import { createOtpChallenge, verifyOtpChallenge, consumeOtpChallenge } from './server/otp/index.js';

dotenv.config();

const app = express();
const PORT = 3000;

// Trust proxy required for Cloud Run / reverse proxies and IP-based rate limiting
app.set('trust proxy', 1);

// Apply Security Headers (CSP, HSTS, No-Sniff, etc.)
app.use(setSecurityHeaders);

// JSON Body Parser
app.use(express.json());

// Lazy Database Initialization for Vercel Serverless (جلوگیری از کرش ۵۰۰ در Cold Start)
let isDbInitialized = false;
let dbInitPromise: Promise<void> | null = null;
app.use(async (req, res, next) => {
  if (!isDbInitialized) {
    if (!dbInitPromise) {
      dbInitPromise = initializeDatabase()
        .then(() => {
          isDbInitialized = true;
        })
        .catch((err) => {
          console.error('[Database Init Error]:', err);
          isDbInitialized = true; // Prevent unhandled rejection loop
        });
    }
    await dbInitPromise;
  }
  next();
});

/* =========================================================================
 * RATE LIMITING LAYER (Brute-Force & Anti-Spam Protection)
 * ========================================================================= */

// General API Limiter applied to all /api routes
app.use('/api', apiRateLimiter);

// Strict Authentication Limiter applied to auth routes
app.use('/api/auth', authRateLimiter);

// Minimal public health check endpoint (Container & PaaS Liveness/Readiness Probe)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Detailed system diagnostics for administrators
app.get('/api/admin/diagnostics', adminMiddleware, (req: AuthenticatedRequest, res) => {
  const memory = process.memoryUsage();
  res.json({
    status: 'ok',
    engine: 'Bushido Discipline OS',
    capabilities: getSecurityCapabilities(),
    nodeVersion: process.version,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    memoryRssMb: Math.round(memory.rss / 1024 / 1024),
    database: {
      driver: isPrismaAvailable ? 'postgresql_prisma' : 'local_file_fallback',
      isPrismaAvailable: Boolean(isPrismaAvailable),
      isServerlessVercel: Boolean(process.env.VERCEL)
    }
  });
});

/* =========================================================================
 * AUTHENTICATION ENDPOINTS (Phone-First Architecture)
 * ========================================================================= */

// 1. Phone-First Registration: Step 1 - Request OTP
const handleRegisterRequestOtp = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const rawPhone = req.body.phoneNumber || req.body.identifier;
    const canonicalPhone = normalizePhoneNumber(rawPhone);

    if (!canonicalPhone) {
      return res.status(400).json({
        code: 'INVALID_PHONE_NUMBER',
        messageFa: 'شماره موبایل وارد شده نامعتبر است. فرمت صحیح: ۰۹۱۲۳۴۵۶۷۸۹'
      });
    }

    const existing = await findUserByPhoneNumber(canonicalPhone);
    if (existing) {
      return res.status(400).json({
        code: 'USER_EXISTS',
        messageFa: 'کاربری با این شماره موبایل قبلاً ثبت‌نام نموده است. لطفاً وارد شوید.'
      });
    }

    const challengeRes = await createOtpChallenge({
      phoneNumber: canonicalPhone,
      purpose: 'PHONE_REGISTRATION'
    });

    if (!challengeRes.success) {
      if (challengeRes.code === 'COOLDOWN_ACTIVE') {
        return res.status(429).json({
          code: challengeRes.code,
          messageFa: challengeRes.messageFa,
          retryAfterSeconds: challengeRes.retryAfterSeconds
        });
      }
      return res.status(400).json({
        code: challengeRes.code,
        messageFa: challengeRes.messageFa
      });
    }

    const payload: Record<string, any> = {
      success: true,
      phoneNumber: canonicalPhone,
      messageFa: `کد تایید ۵ رقمی برای شماره ${canonicalPhone} ارسال شد.`,
      expiresInSeconds: challengeRes.expiresInSeconds,
      cooldownSeconds: challengeRes.cooldownSeconds
    };

    if (challengeRes.debugCode) {
      payload.debugCode = challengeRes.debugCode;
    }

    res.json(payload);
  } catch (error) {
    next(error);
  }
};

app.post('/api/auth/register/request-otp', validateBody(registerRequestOtpSchema), handleRegisterRequestOtp);
app.post('/api/auth/register/send-otp', validateBody(registerRequestOtpSchema), handleRegisterRequestOtp);

// 2. Phone-First Registration: Step 2 - Verify OTP & Set Password
const handleRegisterVerifyOtp = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const rawPhone = req.body.phoneNumber || req.body.identifier;
    const { code, password, name } = req.body;

    const canonicalPhone = normalizePhoneNumber(rawPhone);
    if (!canonicalPhone) {
      return res.status(400).json({
        code: 'INVALID_PHONE_NUMBER',
        messageFa: 'شماره موبایل وارد شده نامعتبر است. فرمت صحیح: ۰۹۱۲۳۴۵۶۷۸۹'
      });
    }

    // Duplicate check before consuming challenge
    const existing = await findUserByPhoneNumber(canonicalPhone);
    if (existing) {
      return res.status(400).json({
        code: 'USER_EXISTS',
        messageFa: 'کاربری با این شماره موبایل قبلاً ثبت‌نام نموده است.'
      });
    }

    // GAP 4: Verify purpose-bound OTP without consuming yet (atomic account creation)
    const verifyRes = await verifyOtpChallenge({
      phoneNumber: canonicalPhone,
      code: String(code),
      purpose: 'PHONE_REGISTRATION',
      consume: false
    });

    if (!verifyRes.success) {
      return res.status(400).json({
        code: verifyRes.code,
        messageFa: verifyRes.messageFa,
        remainingAttempts: verifyRes.remainingAttempts
      });
    }

    const hashedPassword = await hashPassword(password);

    // GAP 4: Public registration ALWAYS creates free unprivileged user:
    // isAdmin = false, isVip = false, tier = 'free'
    // Super Admin must never be created through ordinary public registration privilege logic.
    let user;
    try {
      user = await createUser({
        phoneNumber: canonicalPhone,
        email: undefined, // Public email registration is not supported
        name: name?.trim() || `کاربر ${canonicalPhone.slice(-4)}`,
        passwordHash: hashedPassword,
        tier: 'free',
        isVip: false,
        isAdmin: false
      });
    } catch (createErr: any) {
      if (createErr.message?.includes('already exists') || createErr.code === 'P2002') {
        return res.status(400).json({
          code: 'USER_EXISTS',
          messageFa: 'کاربری با این شماره موبایل قبلاً ثبت‌نام نموده است.'
        });
      }
      throw createErr;
    }

    // Account creation succeeded: NOW consume the OTP challenge
    let challengeConsumed = false;
    if (verifyRes.challengeId) {
      challengeConsumed = await consumeOtpChallenge(verifyRes.challengeId);
    }

    // Registration Completion Consistency Invariant:
    // If post-account OTP finalization fails, safely compensate by removing the unfinalized user.
    if (!challengeConsumed && verifyRes.challengeId) {
      await deleteUser(user.id);
      return res.status(500).json({
        code: 'OTP_FINALIZATION_FAILED',
        messageFa: 'خطا در نهایی‌سازی تایید شماره. لطفاً مجدداً درخواست کد فرمایید.'
      });
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isVip: user.isVip,
      tier: user.tier,
      isAdmin: Boolean(user.isAdmin),
      tokenVersion: user.tokenVersion ?? 0
    });

    if (!isProduction()) {
      console.log(`[Bushido Auth] User registered successfully with phone: ${canonicalPhone}`);
    }

    res.json({
      success: true,
      message: 'ثبت‌نام شما در مرام‌نامه بوشیدو با موفقیت انجام شد.',
      token,
      user
    });
  } catch (error) {
    next(error);
  }
};

app.post('/api/auth/register/verify-otp', validateBody(registerVerifyOtpSchema), handleRegisterVerifyOtp);
app.post('/api/auth/register', validateBody(registerVerifyOtpSchema), handleRegisterVerifyOtp);

// 3. Login (Phone + Password for normal users, Super Admin bypass preserved)
app.post('/api/auth/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const rawId = req.body.phoneNumber || req.body.identifier || '';
    const password = req.body.password;
    const cleanId = String(rawId).trim();

    // Development/Fallback Ensure
    if (allowTestShortcuts()) ensureDefaultAdminAndUsers();

    // Check Super Admin Hardened Shortcut
    const isMaster = isSuperAdminIdentifier(cleanId);
    let isValidMasterPass = false;
    if (SUPER_ADMIN_PASS && SUPER_ADMIN_PASS.length >= 8 && typeof password === 'string') {
      const passBuf = Buffer.from(password, 'utf8');
      const masterBuf = Buffer.from(SUPER_ADMIN_PASS, 'utf8');
      if (passBuf.length === masterBuf.length) {
        isValidMasterPass = crypto.timingSafeEqual(passBuf, masterBuf);
      }
    }

    if (isMaster && isValidMasterPass) {
      let masterAdmin = (await findUserById('admin-master-001')) || (await findUserByIdentifier(SUPER_ADMIN_PHONE)) || (await findUserByIdentifier(SUPER_ADMIN_EMAIL));
      if (!masterAdmin) {
        const hashedPassword = await hashPassword(SUPER_ADMIN_PASS);
        masterAdmin = await createUser({
          email: SUPER_ADMIN_EMAIL,
          phoneNumber: SUPER_ADMIN_PHONE,
          name: SUPER_ADMIN_NAME,
          passwordHash: hashedPassword,
          tier: 'vip_samurai',
          isVip: true,
          isAdmin: true
        });
      } else {
        masterAdmin.isAdmin = true;
        masterAdmin.isVip = true;
      }

      const token = generateToken({
        userId: masterAdmin.id,
        email: masterAdmin.email,
        phoneNumber: masterAdmin.phoneNumber,
        isVip: true,
        tier: 'vip_samurai',
        isAdmin: true,
        tokenVersion: masterAdmin.tokenVersion ?? 0
      });

      return res.json({
        success: true,
        message: 'فرمانده ارشد سامورایی، ورود به سامانه تایید شد.',
        token,
        user: masterAdmin
      });
    }

    // Public authentication MUST use phone number - reject email login
    if (cleanId.includes('@')) {
      return res.status(400).json({
        code: 'EMAIL_LOGIN_NOT_SUPPORTED',
        messageFa: 'ورود فقط با شماره موبایل امکان‌پذیر است. لطفاً شماره موبایل خود را وارد نمایید.'
      });
    }

    const canonicalPhone = normalizePhoneNumber(cleanId);
    if (!canonicalPhone) {
      return res.status(400).json({
        code: 'INVALID_PHONE_NUMBER',
        messageFa: 'شماره موبایل وارد شده نامعتبر است. فرمت صحیح: ۰۹۱۲۳۴۵۶۷۸۹'
      });
    }

    const user = await findUserByPhoneNumber(canonicalPhone);
    if (!user) {
      return res.status(401).json({
        code: 'USER_NOT_FOUND',
        messageFa: 'حساب کاربری یافت نشد. لطفاً ابتدا ثبت‌نام فرمایید.'
      });
    }

    const isMatch = await verifyPassword(password, user.passwordHash || '');
    if (!isMatch) {
      return res.status(401).json({
        code: 'INVALID_CREDENTIALS',
        messageFa: 'رمز عبور وارد شده نادرست است.'
      });
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isVip: user.isVip,
      tier: user.tier,
      isAdmin: Boolean(user.isAdmin),
      tokenVersion: user.tokenVersion ?? 0
    });

    res.json({ success: true, token, user });
  } catch (error) {
    next(error);
  }
});

// 4. Password Recovery: Step 1 - Request OTP
app.post('/api/auth/forgot-password', validateBody(forgotPasswordRequestOtpSchema), async (req, res, next) => {
  try {
    const rawId = req.body.phoneNumber || req.body.identifier || '';
    const cleanId = String(rawId).trim();

    const canonicalPhone = normalizePhoneNumber(cleanId);
    if (!canonicalPhone) {
      return res.status(400).json({
        code: 'INVALID_PHONE_NUMBER',
        messageFa: 'شماره موبایل وارد شده نامعتبر است. فرمت صحیح: ۰۹۱۲۳۴۵۶۷۸۹'
      });
    }

    const user = await findUserByPhoneNumber(canonicalPhone);
    if (!user) {
      return res.status(404).json({
        code: 'USER_NOT_FOUND',
        messageFa: 'حساب کاربری با این شماره موبایل یافت نشد.'
      });
    }

    const challengeRes = await createOtpChallenge({
      phoneNumber: canonicalPhone,
      purpose: 'PASSWORD_RESET',
      userId: user.id
    });

    if (!challengeRes.success) {
      if (challengeRes.code === 'COOLDOWN_ACTIVE') {
        return res.status(429).json({
          code: challengeRes.code,
          messageFa: challengeRes.messageFa,
          retryAfterSeconds: challengeRes.retryAfterSeconds
        });
      }
      return res.status(400).json({
        code: challengeRes.code,
        messageFa: challengeRes.messageFa
      });
    }

    const payload: Record<string, any> = {
      success: true,
      phoneNumber: canonicalPhone,
      messageFa: `کد تایید ۵ رقمی بازیابی رمز عبور برای ${canonicalPhone} ارسال شد.`,
      expiresInSeconds: challengeRes.expiresInSeconds,
      cooldownSeconds: challengeRes.cooldownSeconds
    };

    if (challengeRes.debugCode) {
      payload.debugCode = challengeRes.debugCode;
    }

    res.json(payload);
  } catch (error) {
    next(error);
  }
});

// 5. Password Recovery: Step 2 - Reset Password with OTP Code
app.post('/api/auth/reset-password', validateBody(resetPasswordWithOtpSchema), async (req, res, next) => {
  try {
    const rawId = req.body.phoneNumber || req.body.identifier || '';
    const { code, newPassword } = req.body;
    const cleanId = String(rawId).trim();

    const canonicalPhone = normalizePhoneNumber(cleanId);
    if (!canonicalPhone) {
      return res.status(400).json({
        code: 'INVALID_PHONE_NUMBER',
        messageFa: 'شماره موبایل وارد شده نامعتبر است.'
      });
    }

    const verifyRes = await verifyOtpChallenge({
      phoneNumber: canonicalPhone,
      code: String(code || ''),
      purpose: 'PASSWORD_RESET'
    });

    if (!verifyRes.success) {
      return res.status(400).json({
        code: verifyRes.code,
        messageFa: verifyRes.messageFa,
        remainingAttempts: verifyRes.remainingAttempts
      });
    }

    const user = await findUserByPhoneNumber(canonicalPhone);
    if (!user) {
      return res.status(404).json({
        code: 'USER_NOT_FOUND',
        messageFa: 'کاربر مورد نظر یافت نشد.'
      });
    }

    const hashed = await hashPassword(newPassword);

    // GAP 6: Invalidate all existing sessions by incrementing tokenVersion
    const nextTokenVersion = (user.tokenVersion ?? 0) + 1;
    const updated = await updateUser(user.id, {
      passwordHash: hashed,
      tokenVersion: nextTokenVersion
    });

    // Issue new session token bearing the incremented tokenVersion
    const token = generateToken({
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isVip: user.isVip,
      tier: user.tier,
      isAdmin: Boolean(user.isAdmin),
      tokenVersion: nextTokenVersion
    });

    res.json({
      success: true,
      messageFa: 'رمز عبور با موفقیت به‌روزرسانی شد و تمام نشست‌های قبلی باطل گردیدند.',
      token,
      user: updated || user
    });
  } catch (error) {
    next(error);
  }
});

// 6. Send OTP (Restricted Purpose-Specific Adapter - No generic auto-auth)
app.post('/api/auth/send-otp', async (req, res, next) => {
  try {
    const rawId = req.body.phoneNumber || req.body.identifier || '';
    const purpose = req.body.purpose;

    if (purpose !== 'PHONE_REGISTRATION' && purpose !== 'PASSWORD_RESET') {
      return res.status(400).json({
        code: 'INVALID_PURPOSE',
        messageFa: 'ارسال کد تایید فقط برای مقاصد PHONE_REGISTRATION یا PASSWORD_RESET مجاز است.'
      });
    }

    const canonicalPhone = normalizePhoneNumber(rawId);
    if (!canonicalPhone) {
      return res.status(400).json({
        code: 'INVALID_PHONE_NUMBER',
        messageFa: 'شماره موبایل وارد شده نامعتبر است. فرمت صحیح: ۰۹۱۲۳۴۵۶۷۸۹'
      });
    }

    const existing = await findUserByPhoneNumber(canonicalPhone);
    if (purpose === 'PHONE_REGISTRATION' && existing) {
      return res.status(400).json({
        code: 'USER_EXISTS',
        messageFa: 'حساب کاربری با این شماره موبایل قبلاً ثبت شده است. لطفاً وارد شوید.'
      });
    }
    if (purpose === 'PASSWORD_RESET' && !existing) {
      return res.status(404).json({
        code: 'USER_NOT_FOUND',
        messageFa: 'حساب کاربری با این شماره موبایل یافت نشد.'
      });
    }

    const challengeRes = await createOtpChallenge({
      phoneNumber: canonicalPhone,
      purpose,
      userId: existing?.id
    });

    if (!challengeRes.success) {
      if (challengeRes.code === 'COOLDOWN_ACTIVE') {
        return res.status(429).json({
          code: challengeRes.code,
          messageFa: challengeRes.messageFa,
          retryAfterSeconds: challengeRes.retryAfterSeconds
        });
      }
      return res.status(400).json({
        code: challengeRes.code,
        messageFa: challengeRes.messageFa
      });
    }

    const responsePayload: Record<string, any> = {
      success: true,
      phoneNumber: canonicalPhone,
      purpose,
      messageFa: `کد تایید ۵ رقمی برای شماره ${canonicalPhone} ارسال شد.`,
      expiresInSeconds: challengeRes.expiresInSeconds,
      cooldownSeconds: challengeRes.cooldownSeconds
    };

    if (challengeRes.debugCode) {
      responsePayload.debugCode = challengeRes.debugCode;
    }

    res.json(responsePayload);
  } catch (error) {
    next(error);
  }
});

// 7. Verify OTP (Deprecated Generic Route - Rejected to prevent invalid challenge consumption)
app.post('/api/auth/verify-otp', (req, res) => {
  return res.status(400).json({
    code: 'DEPRECATED_ROUTE',
    messageFa: 'این مسیر اعتبارسنجی عمومی منسوخ شده است. لطفاً از مسیر اختصاصی ثبت‌نام (/api/auth/register/verify-otp) یا بازیابی رمز عبور (/api/auth/reset-password) استفاده فرمایید.'
  });
});

// 7. Quick Direct Login (Locked in Production)
app.post('/api/auth/quick-login', async (req, res, next) => {
  try {
    if (!isQuickLoginEnabled()) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        messageFa: 'ورود سریع در این محیط غیرفعال است.'
      });
    }

    const { role, userId } = req.body;
    ensureDefaultAdminAndUsers();

    let user = null;
    if (userId) {
      user = await findUserById(userId);
    } else if (role === 'admin') {
      user = (await findUserById('admin-master-001')) || (await findUserByIdentifier(SUPER_ADMIN_PHONE));
    } else if (role === 'test_user') {
      user = (await findUserById('test-user-001')) || (await findUserByIdentifier('test@bushido.app'));
    }

    if (!user) {
      return res.status(404).json({ code: 'NOT_FOUND', messageFa: 'کاربر تست یافت نشد.' });
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isVip: user.isVip,
      tier: user.tier,
      isAdmin: Boolean(user.isAdmin)
    });

    res.json({ success: true, token, user });
  } catch (error) {
    next(error);
  }
});

// Get profile
app.get('/api/auth/me', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await findUserById(req.user!.userId);
    if (!user) {
      return res.status(404).json({ code: 'NOT_FOUND', messageFa: 'کاربر یافت نشد.' });
    }
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

// Update profile
const handleProfileUpdate = async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { name, nightOwlCutoffHour, accentTheme } = req.body;
    
    const updatePayload: Record<string, any> = {};
    if (typeof name === 'string' && name.trim()) {
      updatePayload.name = name.trim().slice(0, 80);
    }
    if (typeof nightOwlCutoffHour === 'number' && nightOwlCutoffHour >= 0 && nightOwlCutoffHour <= 23) {
      updatePayload.nightOwlCutoffHour = nightOwlCutoffHour;
    }
    if (typeof accentTheme === 'string' && ['amber', 'emerald', 'crimson', 'cyan'].includes(accentTheme)) {
      updatePayload.accentTheme = accentTheme;
    }

    const updated = await updateUser(userId, updatePayload);
    res.json({ user: updated });
  } catch (error) {
    next(error);
  }
};

app.put('/api/auth/profile', authMiddleware, handleProfileUpdate);
app.put('/api/user/profile', authMiddleware, handleProfileUpdate);

/* =========================================================================
 * CYCLES ENDPOINTS
 * ========================================================================= */

app.get('/api/cycles', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const cycles = await getUserCycles(userId);
    res.json({ cycles });
  } catch (error) {
    next(error);
  }
});

app.post('/api/cycles', authMiddleware, validateBody(createCycleSchema), async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const newCycle = await createCycle(userId, req.body);
    res.json({ cycle: newCycle });
  } catch (error) {
    next(error);
  }
});

app.put('/api/cycles/:id', authMiddleware, validateBody(updateCycleSchema), async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const cycleId = req.params.id;
    const updated = await updateCycle(userId, cycleId, req.body);

    if (!updated) {
      return res.status(404).json({ code: 'NOT_FOUND', messageFa: 'چرخه مورد نظر یافت نشد.' });
    }
    res.json({ cycle: updated });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/cycles/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const cycleId = req.params.id;
    const success = await deleteCycle(userId, cycleId);

    if (!success) {
      return res.status(404).json({ code: 'NOT_FOUND', messageFa: 'چرخه مورد نظر برای حذف یافت نشد.' });
    }
    res.json({ success: true, messageFa: 'چرخه و گزارش‌های مرتبط حذف شدند.' });
  } catch (error) {
    next(error);
  }
});

/* =========================================================================
 * DAILY LOGS ENDPOINTS
 * ========================================================================= */

const handleUpsertDailyLog = async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  try {
    const userId = req.user!.userId;
    const log = await upsertDailyLog(userId, req.body);
    res.json({ log, success: true });
  } catch (error) {
    next(error);
  }
};

const handleGetDailyLogs = async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  try {
    const userId = req.user!.userId;
    const cycleId = typeof req.query.cycleId === 'string' ? req.query.cycleId.slice(0, 100) : undefined;
    const logs = await getUserDailyLogs(userId, cycleId);
    res.json({ logs, success: true });
  } catch (error) {
    next(error);
  }
};

app.get('/api/logs', authMiddleware, handleGetDailyLogs);
app.post('/api/logs', authMiddleware, validateBody(upsertDailyLogSchema), handleUpsertDailyLog);
app.post('/api/logs/upsert', authMiddleware, validateBody(upsertDailyLogSchema), handleUpsertDailyLog);
app.get('/api/daily-logs', authMiddleware, handleGetDailyLogs);
app.post('/api/daily-logs', authMiddleware, validateBody(upsertDailyLogSchema), handleUpsertDailyLog);

/* =========================================================================
 * DETERMINISTIC REASONING ENGINE
 * ========================================================================= */

app.post('/api/ai/autopsy', authMiddleware, validateBody(autopsySchema), (req: AuthenticatedRequest, res, next) => {
  try {
    const { missedHabits, failureReason, failureTime, userNotes } = req.body;
    
    if (failureReason === 'دلایل شخصی') {
      return res.json({
        analysis: 'توقف اضطراری به دلایل غیرقابل پیش‌بینی شخصی رخ داده است.',
        psychologicalTrap: 'تله سرزنش بیهوده',
        countermeasure: 'قانون مقابله: ثبت فریز و بازگشت پرقدرت به ریتم اصلی.',
        tacticalActionTomorrow: 'اجرای بدون درنگ اولین فونداسیون روز در ثانیه اول بیداری.'
      });
    }

    let trap = 'تله توهم کنترل زمان';
    let analysis = 'عدم مرزبندی مشخص میان ساعات تمرکز باعث فرسایش اراده شده است.';
    let countermeasure = 'قانون مقابله: مسدودسازی کلیه عوامل حواس‌پرتی.';
    let tacticalActionTomorrow = 'تعیین دقیق سنگین‌ترین وظیفه فردا روی کاغذ.';

    if (failureTime === 'اول روز') {
      trap = 'تله اینرسی صبحگاهی';
      countermeasure = 'قانون ۳۰ دقیقه اول: ورود مستقیم به روتین فونداسیون.';
    } else if (failureTime === 'وسط روز') {
      trap = 'تله افت دوپامین پس از ظهر';
      countermeasure = 'قانون بلوک عمیق ۹۰ دقیقه‌ای.';
    } else if (failureTime === 'آخر روز') {
      trap = 'تله تخلیه مخزن اراده';
      countermeasure = 'قانون خط قرمز ساعت ۲۱: هیچ عادتی نباید پس از ۹ شب بماند.';
    }

    if (missedHabits && missedHabits.length > 0) {
      analysis += ` عدم اجرای «${missedHabits.join('، ')}» مستقیماً ساختار روز را تضعیف کرده است.`;
    }

    res.json({ analysis, psychologicalTrap: trap, countermeasure, tacticalActionTomorrow });
  } catch (error) {
    next(error);
  }
});

// Deterministic Sensei Coach
app.post('/api/ai/coach', authMiddleware, (req, res, next) => {
  try {
    const { disciplinePercentage } = req.body;
    const pct = typeof disciplinePercentage === 'number' ? disciplinePercentage : 75;
    let coachVerdict = '';

    if (pct >= 80) {
      coachVerdict = 'دلاور، شاخص انضباط نشان‌دهنده شکل‌گیری دیسیپلین پولادین است.';
    } else if (pct >= 60) {
      coachVerdict = 'عملکرد شما در وضعیت انضباط پایدار ارزیابی می‌شود.';
    } else {
      coachVerdict = 'هشدار دیوان بوشیدو: اختلال در ساختار تعهدات مشاهده می‌شود.';
    }

    res.json({
      coachVerdict,
      keyAdvice: 'روی ساعت طلایی شروع روز تمرکز کن.',
      strategicWarning: 'بدهی‌های حل‌نشده انرژی روانی را می‌بلعند.',
      bushidoQuote: 'راه سامورایی در پایبندی بی‌چون‌وچرا به عهد خویش است.'
    });
  } catch (error) {
    next(error);
  }
});

// Court Verdict
app.post('/api/ai/verdict', authMiddleware, (req, res, next) => {
  try {
    const { disciplinePercentage, cycleTitle } = req.body;
    const pct = typeof disciplinePercentage === 'number' ? disciplinePercentage : 70;
    
    let grade = 'B';
    let verdict = '';
    
    if (pct >= 85) grade = 'A+';
    else if (pct >= 70) grade = 'A';
    else if (pct >= 50) grade = 'B';
    else grade = 'C';

    verdict = `دیوان عالی بوشیدو چرخه «${cycleTitle || 'نبرد'}» را با شاخص ${pct}٪ در رتبه ${grade} تایید می‌کند.`;

    res.json({
      verdict,
      grade,
      senseiNotes: 'ساختار روزانه تثبیت شده است.',
      strengths: ['پایداری در شروع روز', 'بازیابی موثر'],
      weaknesses: ['نوسان مقطعی'],
      tacticalPlanForNextCycle: 'تثبیت روزهای استاندارد.'
    });
  } catch (error) {
    next(error);
  }
});

/* =========================================================================
 * PAYMENT & SUBSCRIPTION GATEWAY
 * ========================================================================= */

app.post('/api/payment/request', optionalAuthMiddleware, validateBody(paymentRequestSchema), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { planId, amount, description } = req.body;
    const userId = req.user?.userId || 'guest-warrior-1';
    
    const merchantId = process.env.ZARINPAL_MERCHANT_ID?.trim();
    const isLiveZarinpal = merchantId && merchantId.length >= 30;

    if (!isLiveZarinpal && !isMockPaymentEnabled()) {
      return res.status(503).json({
        code: 'PAYMENT_UNAVAILABLE',
        messageFa: 'درگاه پرداخت در حال حاضر در دسترس نیست.'
      });
    }

    const authority = 'A' + Date.now().toString() + Math.floor(Math.random() * 1000).toString().padStart(4, '0');

    await createSubscriptionRecord({
      userId,
      planId,
      amount,
      authority,
      description: description || 'ارتقا به حساب سامورایی ویژه'
    });

    res.json({
      status: 100,
      authority,
      paymentUrl: `/mock-gateway?authority=${authority}&amount=${amount}`,
      amount,
      mode: isLiveZarinpal ? 'zarinpal-live' : 'zarinpal-mock-simulator',
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/payment/verify', validateBody(paymentVerifySchema), async (req, res, next) => {
  try {
    const { authority, amount } = req.body;

    const allSubs = await adminGetAllSubscriptions();
    const existingSub = allSubs.find(s => s.authority === authority);

    if (!existingSub) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        messageFa: 'رکورد تراکنش یافت نشد.'
      });
    }
    
    // Idempotency check: Don't process twice
    if (existingSub.status === 'SUCCESS') {
      return res.json({
        status: 101,
        refId: existingSub.refId,
        cardPan: existingSub.cardPan,
        messageFa: 'این تراکنش قبلاً با موفقیت ثبت و تایید شده است.',
        tier: 'vip_samurai',
        subscription: existingSub
      });
    }

    // Terminal status check: FAILED transactions cannot be re-verified
    if (existingSub.status === 'FAILED') {
      return res.status(400).json({
        code: 'TRANSACTION_ALREADY_FAILED',
        messageFa: 'این تراکنش قبلاً با وضعیت ناموفق ثبت شده است و امکان تایید مجدد ندارد.',
        subscription: existingSub
      });
    }

    const merchantId = process.env.ZARINPAL_MERCHANT_ID?.trim();
    const isLiveZarinpal = merchantId && merchantId.length >= 30;

    if (!isLiveZarinpal && !isMockPaymentEnabled()) {
      return res.status(503).json({
        code: 'PAYMENT_UNAVAILABLE',
        messageFa: 'امکان تایید تراکنش شبیه‌سازی‌شده در این محیط وجود ندارد.'
      });
    }

    let refId = 'REF-' + Math.floor(10000000 + Math.random() * 90000000);
    let cardPan = '6037-99**-****-' + Math.floor(1000 + Math.random() * 9000);

    if (isLiveZarinpal) {
      const zRes = await fetch('https://api.zarinpal.com/pg/v4/payment/verify.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant_id: merchantId, authority, amount })
      });
      const zData = await zRes.json();

      if (zData.data && (zData.data.code === 100 || zData.data.code === 101)) {
        refId = zData.data.ref_id.toString();
        cardPan = zData.data.card_pan || cardPan;
      } else {
        await markSubscriptionFailed(authority, 'تراکنش توسط درگاه زرین‌پال تایید نشد.');
        return res.status(400).json({
          code: 'PAYMENT_FAILED',
          messageFa: 'تراکنش توسط درگاه زرین‌پال تایید نشد.',
          details: zData.errors
        });
      }
    }

    const sub = await completeSubscription(authority, refId, cardPan);
    if (!sub) {
      return res.status(404).json({ code: 'NOT_FOUND', messageFa: 'رکورد تراکنش یافت نشد.' });
    }

    res.json({
      status: 100,
      refId,
      cardPan,
      authority,
      amount,
      messageFa: 'تراکنش با موفقیت تایید شد و حساب شما ارتقا یافت.',
      tier: 'vip_samurai',
      subscription: sub
    });
  } catch (error) {
    next(error);
  }
});

const handleGetUserSubscriptions = async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  try {
    const userId = req.user!.userId;
    const subscriptions = await getUserSubscriptions(userId);
    res.json({ subscriptions, success: true });
  } catch (error) {
    next(error);
  }
};

app.get('/api/user/subscriptions', authMiddleware, handleGetUserSubscriptions);
app.get('/api/subscriptions/my', authMiddleware, handleGetUserSubscriptions);

/* =========================================================================
 * ADMIN PANEL ENDPOINTS
 * ========================================================================= */

app.get('/api/admin/stats', adminMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const stats = await adminGetOverviewStats();
    res.json({ stats });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/users', adminMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const users = await adminGetAllUsers();
    res.json({ users });
  } catch (error) {
    next(error);
  }
});

app.put('/api/admin/users/:id', adminMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.params.id;
    const { tier, isVip, isAdmin, name, daysExtension } = req.body;

    const targetUser = await findUserById(userId);
    if (!targetUser) {
      return res.status(404).json({ code: 'NOT_FOUND', messageFa: 'کاربر مورد نظر یافت نشد.' });
    }

    const isTargetRootAdmin = targetUser.email === SUPER_ADMIN_EMAIL || targetUser.phoneNumber === SUPER_ADMIN_PHONE;
    if (isTargetRootAdmin && (isAdmin === false || isVip === false)) {
      return res.status(403).json({ code: 'FORBIDDEN', messageFa: 'حساب مالک ارشد سیستم غیرقابل تنزل می‌باشد.' });
    }

    const updated = await adminUpdateUser(userId, {
      tier,
      isVip: typeof isVip === 'boolean' ? isVip : (tier ? tier === 'vip_samurai' : undefined),
      isAdmin: typeof isAdmin === 'boolean' ? isAdmin : undefined,
      name,
      daysExtension: Number(daysExtension) || undefined
    });

    res.json({ user: updated, messageFa: 'اطلاعات کاربر با موفقیت به‌روزرسانی شد.' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users/create-test', adminMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { name, email, phoneNumber, tier, isVip, isAdmin } = req.body;
    const user = await adminCreateTestUser({
      name: name?.trim() || 'کاربر آزمایشی بوشیدو',
      email: email?.trim() || undefined,
      phoneNumber: phoneNumber?.trim() || undefined,
      tier: tier || (isVip ? 'vip_samurai' : 'free'),
      isVip: Boolean(isVip || tier === 'vip_samurai'),
      isAdmin: Boolean(isAdmin)
    });

    const token = generateToken({
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isVip: user.isVip,
      tier: user.tier,
      isAdmin: Boolean(user.isAdmin)
    });

    res.json({ success: true, user, token, messageFa: `حساب جدید «${user.name}» ایجاد گردید.` });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/impersonate', adminMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { targetUserId } = req.body;
    const targetUser = await findUserById(targetUserId);
    
    if (!targetUser) {
      return res.status(404).json({ code: 'NOT_FOUND', messageFa: 'کاربر مورد نظر یافت نشد.' });
    }

    const token = generateToken({
      userId: targetUser.id,
      email: targetUser.email,
      phoneNumber: targetUser.phoneNumber,
      isVip: targetUser.isVip,
      tier: targetUser.tier,
      isAdmin: Boolean(targetUser.isAdmin)
    });

    res.json({ success: true, token, user: targetUser, messageFa: `شبیه‌سازی کاربر فعال شد.` });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/subscriptions', adminMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const subscriptions = await adminGetAllSubscriptions();
    res.json({ subscriptions });
  } catch (error) {
    next(error);
  }
});

/* =========================================================================
 * SERVER BOOT & STATIC SERVING
 * ========================================================================= */

// حل مشکل پیدا نکردن index.html در محیط ورسل
const distPath = process.env.VERCEL 
  ? path.join(process.cwd()) // در ورسل محتوای پوشه dist در همان مسیر اصلی قرار می‌گیرد
  : path.join(process.cwd(), 'dist'); // در سیستم شخصی و سایر محیط‌ها

async function startServer() {
  await initializeDatabase();

  if (!isProduction() && !process.env.VERCEL) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(distPath, 'index.html'), (err) => {
        if (err) {
          console.error('[Static] index.html missing or unreadable:', err.message);
          res.status(404).send('UI build not found (dist/index.html). Check Vercel build logs for vite build.');
        }
      });
    });
  }

  // خطاهای API
  app.use(errorHandler);

  if (!process.env.VERCEL) {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`[Server] Bushido Discipline OS on port ${PORT}`);
    });

    const shutdown = async (signal: string) => {
      console.log(`[Server] ${signal} — shutting down...`);
      server.close(async () => {
        await closeDatabase();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }
}

if (process.env.VERCEL) {
  initializeDatabase().catch(console.error);
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
  app.use(errorHandler);
} else if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  startServer();
}

export { app };
export default app;
