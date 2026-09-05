import { z, ZodSchema } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { toEnglishDigits } from '../security';
import { normalizePhoneNumber } from './phone';

/**
 * تابع کمکی پاک‌سازی و تبدیل اعداد فارسی/عربی به انگلیسی
 */
const cleanDigits = (val: string) => toEnglishDigits(val ? val.trim() : '');

/**
 * اعتبارسنجی و نرمال‌سازی سخت‌گیرانه شماره موبایل ایران
 */
export const iranianPhoneSchema = z
  .string()
  .min(1, { message: 'ورود شماره موبایل الزامی است.' })
  .transform((val, ctx) => {
    const normalized = normalizePhoneNumber(val);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'فرمت شماره موبایل نامعتبر است. نمونه صحیح: ۰۹۱۲۳۴۵۶۷۸۹',
      });
      return z.NEVER;
    }
    return normalized;
  });

/**
 * Standard date string format validator (YYYY-MM-DD)
 * تبدیل خودکار اعداد فارسی در تاریخ و اعتبارسنجی فرمت
 */
const dateStringSchema = z
  .string()
  .transform(cleanDigits)
  .pipe(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: 'فرمت تاریخ باید به صورت YYYY-MM-DD باشد.',
    })
  );

/**
 * Exact five-digit OTP format validator
 */
export const fiveDigitOtpSchema = z
  .string({ required_error: 'ورود کد تایید الزامی است.' })
  .transform(cleanDigits)
  .pipe(
    z.string().regex(/^\d{5}$/, { message: 'کد تایید باید دقیقاً ۵ رقم باشد.' })
  );

/**
 * Centralized password policy (minimum 8 characters)
 */
export const passwordSchema = z
  .string({ required_error: 'ورود رمز عبور الزامی است.' })
  .min(8, { message: 'رمز عبور باید حداقل ۸ کاراکتر باشد.' });

/* =========================================================================
 * ZOD SCHEMAS FOR API INPUT VALIDATION (Item B5)
 * ========================================================================= */

/**
 * Phone-First Registration: Step 1 (Request OTP)
 */
export const registerRequestOtpSchema = z
  .object({
    phoneNumber: iranianPhoneSchema,
  })
  .strict({ message: 'فیلدهای اضافی در بدنه درخواست مجاز نیست.' });

/**
 * Phone-First Registration: Step 2 (Verify OTP & Set Password)
 * Rejects unexpected privilege fields (isAdmin, isVip, role, tier) via .strict()
 */
export const registerVerifyOtpSchema = z
  .object({
    phoneNumber: iranianPhoneSchema,
    code: fiveDigitOtpSchema,
    password: passwordSchema,
    name: z.string().max(80, { message: 'نام کاربری حداکثر می‌تواند ۸۰ کاراکتر باشد.' }).optional(),
  })
  .strict({ message: 'فیلدهای اضافی یا ارتقای دسترسی در ثبت‌نام عمومی مجاز نیست.' });

/**
 * Phone-First Password Recovery: Step 1 (Request OTP)
 */
export const forgotPasswordRequestOtpSchema = z
  .object({
    phoneNumber: iranianPhoneSchema,
  })
  .strict({ message: 'فیلدهای اضافی در بدنه درخواست مجاز نیست.' });

/**
 * Phone-First Password Recovery: Step 2 (Reset Password with OTP)
 */
export const resetPasswordWithOtpSchema = z
  .object({
    phoneNumber: iranianPhoneSchema,
    code: fiveDigitOtpSchema,
    newPassword: passwordSchema,
  })
  .strict({ message: 'فیلدهای اضافی در بدنه درخواست مجاز نیست.' });

/**
 * User Registration Schema (Legacy / Direct Adapter)
 */
export const registerSchema = z.object({
  identifier: z
    .string()
    .optional()
    .transform((val) => (val ? cleanDigits(val) : val)),
  phoneNumber: z
    .string()
    .optional()
    .transform((val) => (val ? cleanDigits(val) : val)),
  password: z.string().min(8, { message: 'رمز عبور باید حداقل ۸ کاراکتر باشد.' }),
  name: z.string().max(80, { message: 'نام کاربری حداکثر می‌تواند ۸۰ کاراکتر باشد.' }).optional(),
  email: z.string().email({ message: 'فرمت ایمیل وارد شده نامعتبر است.' }).optional().or(z.literal('')),
  code: z.string().optional().transform((val) => (val ? cleanDigits(val) : val)),
});

/**
 * User Login Schema (Phone + Password or Super Admin)
 */
export const loginSchema = z.object({
  identifier: z
    .string()
    .optional()
    .transform((val) => (val ? cleanDigits(val) : val)),
  phoneNumber: z
    .string()
    .optional()
    .transform((val) => (val ? cleanDigits(val) : val)),
  password: z.string().min(1, { message: 'ورود رمز عبور الزامی است.' }),
});

/**
 * OTP Dispatch Request Schema
 */
export const otpRequestSchema = z.object({
  identifier: z
    .string()
    .optional()
    .transform((val) => (val ? cleanDigits(val) : val)),
  phoneNumber: z
    .string()
    .optional()
    .transform((val) => (val ? cleanDigits(val) : val)),
});

/**
 * Reset Password with OTP Schema
 */
export const resetPasswordSchema = z.object({
  identifier: z
    .string()
    .optional()
    .transform((val) => (val ? cleanDigits(val) : val)),
  phoneNumber: z
    .string()
    .optional()
    .transform((val) => (val ? cleanDigits(val) : val)),
  code: z
    .string()
    .transform(cleanDigits)
    .pipe(z.string().min(4, { message: 'کد تایید الزامی است.' })),
  newPassword: z.string().min(8, { message: 'رمز عبور جدید باید حداقل ۸ کاراکتر باشد.' }),
});

/**
 * Create Cycle Schema
 */
export const createCycleSchema = z.object({
  id: z.string().max(120).optional(),
  clientOperationId: z.string().max(120).optional(),
  title: z
    .string()
    .min(1, { message: 'عنوان چرخه الزامی است.' })
    .max(120, { message: 'عنوان چرخه حداکثر ۱۲۰ کاراکتر می‌باشد.' }),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  targetTheme: z.string().max(200).optional().nullable(),
  inheritedStreak: z.number().int().min(0).optional().default(0),
  rules: z.array(z.string().max(200)).max(20).optional().default([]),
});

/**
 * Update Cycle Schema
 */
export const updateCycleSchema = z.object({
  clientOperationId: z.string().max(120).optional(),
  title: z.string().min(1).max(120).optional(),
  targetTheme: z.string().max(200).optional().nullable(),
  rules: z.array(z.string().max(200)).max(20).optional(),
  isArchived: z.boolean().optional(),
  reportRead: z.boolean().optional(),
  verdict: z.any().optional(),
  expectedRevision: z.number().int().positive().optional(),
  revision: z.number().int().positive().optional(),
})
.superRefine((data, ctx) => {
  if (data.expectedRevision !== undefined && data.revision !== undefined && data.expectedRevision !== data.revision) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ارسال همزمان revision و expectedRevision با مقادیر متفاوت نامعتبر است.',
      path: ['expectedRevision']
    });
  }
})
.transform((data) => {
  const expectedRevision = data.expectedRevision ?? data.revision;
  const { revision, ...rest } = data;
  return {
    ...rest,
    ...(expectedRevision !== undefined ? { expectedRevision } : {})
  };
});

/**
 * Daily Log Upsert Schema (Foundation Habits & Autopsy details)
 */
export const upsertDailyLogSchema = z.object({
  id: z.string().max(120).optional(),
  clientOperationId: z.string().max(120).optional(),
  cycleId: z.string().min(1, { message: 'شناسه چرخه الزامی است.' }),
  date: dateStringSchema,
  wakeUp: z.boolean().default(false),
  workout: z.boolean().default(false),
  study: z.boolean().default(false),
  journal: z.boolean().default(false),
  hardTask: z.boolean().default(false),
  specialMission: z.boolean().default(false),
  failureReason: z.string().max(500).optional().nullable(),
  failureTime: z.string().max(100).optional().nullable(),
  autopsyNotes: z.string().max(2000).optional().nullable(),
  countermeasure: z.string().max(2000).optional().nullable(),
  aiFeedback: z.string().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  expectedRevision: z.number().int().positive().optional(),
  revision: z.number().int().positive().optional(),
})
.superRefine((data, ctx) => {
  if (data.expectedRevision !== undefined && data.revision !== undefined && data.expectedRevision !== data.revision) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ارسال همزمان revision و expectedRevision با مقادیر متفاوت نامعتبر است.',
      path: ['expectedRevision']
    });
  }
})
.transform((data) => {
  const expectedRevision = data.expectedRevision ?? data.revision;
  const { revision, ...rest } = data;
  return {
    ...rest,
    ...(expectedRevision !== undefined ? { expectedRevision } : {})
  };
});

/**
 * Daily Log Update Schema
 */
export const updateDailyLogSchema = z.object({
  id: z.string().max(120).optional(),
  clientOperationId: z.string().max(120).optional(),
  cycleId: z.string().min(1).optional(),
  wakeUp: z.boolean().optional(),
  workout: z.boolean().optional(),
  study: z.boolean().optional(),
  journal: z.boolean().optional(),
  hardTask: z.boolean().optional(),
  specialMission: z.boolean().optional(),
  failureReason: z.string().max(500).optional().nullable(),
  failureTime: z.string().max(100).optional().nullable(),
  autopsyNotes: z.string().max(2000).optional().nullable(),
  countermeasure: z.string().max(2000).optional().nullable(),
  aiFeedback: z.string().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  expectedRevision: z.number().int().positive().optional(),
  revision: z.number().int().positive().optional(),
})
.superRefine((data, ctx) => {
  if (data.expectedRevision !== undefined && data.revision !== undefined && data.expectedRevision !== data.revision) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ارسال همزمان revision و expectedRevision با مقادیر متفاوت نامعتبر است.',
      path: ['expectedRevision']
    });
  }
})
.transform((data) => {
  const expectedRevision = data.expectedRevision ?? data.revision;
  const { revision, ...rest } = data;
  return {
    ...rest,
    ...(expectedRevision !== undefined ? { expectedRevision } : {})
  };
});

/**
 * Failure Autopsy Submission Schema
 */
export const autopsySchema = z.object({
  date: dateStringSchema,
  missedHabits: z.array(z.string()).optional().default([]),
  failureReason: z.string().max(500).optional().default(''),
  failureTime: z.string().max(100).optional().default(''),
  userNotes: z.string().max(2000).optional().default(''),
});

/**
 * User Profile Update Schema (Phase 3A.3 Allow-List)
 * Allows ONLY safe, client-editable preferences:
 * - name (string, max 80)
 * - nightOwlCutoffHour (integer, 0..23)
 * - accentTheme (enum: 'amber' | 'emerald' | 'crimson' | 'cyan')
 *
 * All privilege-bearing, identity, and internal fields are stripped or rejected.
 */
export const updateProfileSchema = z.object({
  clientOperationId: z.string().max(120).optional(),
  name: z.string().max(80, { message: 'نام کاربری حداکثر ۸۰ کاراکتر می‌باشد.' }).optional(),
  nightOwlCutoffHour: z.number().int({ message: 'ساعت کات‌آف باید عدد صحیح باشد.' }).min(0).max(23, { message: 'ساعت کات‌آف شبانه باید عددی بین ۰ تا ۲۳ باشد.' }).optional(),
  accentTheme: z.enum(['amber', 'emerald', 'crimson', 'cyan'], { message: 'تم انتخابی نامعتبر است.' }).optional(),
});

/**
 * Payment Request Schema
 * Client may request a planId. Amount is optional and validated server-side against authoritative catalog.
 */
export const paymentRequestSchema = z.object({
  planId: z.string().min(1, { message: 'شناسه طرح اشتراک الزامی است.' }),
  amount: z.number().positive({ message: 'مبلغ پرداخت باید یک عدد مثبت باشد.' }).optional(),
  description: z.string().max(200).optional(),
});

/**
 * Payment Verification Schema
 */
export const paymentVerifySchema = z.object({
  authority: z
    .string()
    .transform(cleanDigits)
    .pipe(z.string().min(1, { message: 'شناسه مرجع (Authority) الزامی است.' })),
  amount: z.number().optional(),
});

/* =========================================================================
 * HELPER MIDDLEWARE FOR REQUEST BODY VALIDATION (Item B4/B5)
 * ========================================================================= */

/**
 * Express Middleware factory that parses and validates `req.body` using Zod.
 * Returns standardized API error responses (B4 Error format) upon validation failure.
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const formattedErrors = result.error.flatten();
      const firstError =
        result.error.issues[0]?.message || 'اطلاعات ورودی با الگوی استاندارد تطابق ندارد.';

      res.status(400).json({
        code: 'VALIDATION_ERROR',
        messageFa: firstError,
        message: 'Invalid request body payload.',
        details: formattedErrors.fieldErrors,
      });
      return;
    }

    // Replace request body with sanitised, digit-converted and validated data
    req.body = result.data;
    next();
  };
}
