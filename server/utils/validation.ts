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

/* =========================================================================
 * ZOD SCHEMAS FOR API INPUT VALIDATION (Item B5)
 * ========================================================================= */

/**
 * Phone-First Registration: Step 1 (Request OTP)
 */
export const registerRequestOtpSchema = z.object({
  phoneNumber: iranianPhoneSchema,
});

/**
 * Phone-First Registration: Step 2 (Verify OTP & Set Password)
 */
export const registerVerifyOtpSchema = z.object({
  phoneNumber: iranianPhoneSchema,
  code: z
    .string()
    .transform(cleanDigits)
    .pipe(z.string().min(4, { message: 'کد تایید الزامی است.' })),
  password: z.string().min(8, { message: 'رمز عبور باید حداقل ۸ کاراکتر باشد.' }),
  name: z.string().max(80, { message: 'نام کاربری حداکثر می‌تواند ۸۰ کاراکتر باشد.' }).optional(),
});

/**
 * Phone-First Password Recovery: Step 1 (Request OTP)
 */
export const forgotPasswordRequestOtpSchema = z.object({
  phoneNumber: iranianPhoneSchema,
});

/**
 * Phone-First Password Recovery: Step 2 (Reset Password with OTP)
 */
export const resetPasswordWithOtpSchema = z.object({
  phoneNumber: iranianPhoneSchema,
  code: z
    .string()
    .transform(cleanDigits)
    .pipe(z.string().min(4, { message: 'کد تایید الزامی است.' })),
  newPassword: z.string().min(8, { message: 'رمز عبور جدید باید حداقل ۸ کاراکتر باشد.' }),
});

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
  title: z.string().min(1).max(120).optional(),
  targetTheme: z.string().max(200).optional().nullable(),
  rules: z.array(z.string().max(200)).max(20).optional(),
  isArchived: z.boolean().optional(),
  reportRead: z.boolean().optional(),
  verdict: z.any().optional(),
});

/**
 * Daily Log Upsert Schema (Foundation Habits & Autopsy details)
 */
export const upsertDailyLogSchema = z.object({
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
 * Payment Request Schema
 */
export const paymentRequestSchema = z.object({
  planId: z.string().min(1, { message: 'شناسه طرح اشتراک الزامی است.' }),
  amount: z.number().positive({ message: 'مبلغ پرداخت باید یک عدد مثبت باشد.' }),
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
