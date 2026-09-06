import { UserProfile, UserSubscriptionTier } from '../types';

export const RECOGNIZED_TIERS = ['free', 'ronin_free', 'vip_samurai', 'daimyo_master', 'shogun_elite'] as const;
export type RecognizedTier = (typeof RECOGNIZED_TIERS)[number];

export interface AuthoritativePaymentValidationParams {
  data: any;
  currentUserId: string;
  expectedAuthority: string;
}

export interface AuthoritativePaymentReceipt {
  refId: string;
  cardPan?: string;
  date: string;
  amount: number;
}

export interface AuthoritativePaymentValidationResult {
  valid: boolean;
  errorCode?: string;
  errorMessageFa?: string;
  validatedUser?: UserProfile;
  receipt?: AuthoritativePaymentReceipt;
}

/**
 * Validates that the payment verification response contains a valid, authoritative server user and subscription result.
 * Strictly prevents client-generated entitlement fallbacks (no invented tier, no hardcoded vip_samurai,
 * no invented dates, no activeCycleLimit: 99, no fallback refId).
 */
export function validateAuthoritativePaymentResponse(
  params: AuthoritativePaymentValidationParams,
  currentUserProfile: UserProfile
): AuthoritativePaymentValidationResult {
  const { data, currentUserId, expectedAuthority } = params;

  if (!data || typeof data !== 'object') {
    return {
      valid: false,
      errorCode: 'INVALID_RESPONSE_FORMAT',
      errorMessageFa: 'پاسخ دریافتی از سرور نامعتبر است.'
    };
  }

  // 1. Status check: 100 (newly completed) or 101 (idempotent duplicate success)
  if (data.status !== 100 && data.status !== 101) {
    return {
      valid: false,
      errorCode: data.code || 'PAYMENT_NOT_CONFIRMED',
      errorMessageFa: data.messageFa || 'تراکنش توسط درگاه پرداخت تایید نشد.'
    };
  }

  const serverUser = data.user;
  const serverSub = data.subscription;

  // 2. Server user must be present
  if (!serverUser || typeof serverUser !== 'object') {
    return {
      valid: false,
      errorCode: 'MISSING_SERVER_USER',
      errorMessageFa: 'اطلاعات کاربر در پاسخ تایید تراکنش موجود نیست.'
    };
  }

  // 3. user.id must match authenticated current userProfile.id
  if (!serverUser.id || serverUser.id !== currentUserId) {
    return {
      valid: false,
      errorCode: 'USER_ID_MISMATCH',
      errorMessageFa: 'شناسه کاربر با اطلاعات حساب جاری مطابقت ندارد.'
    };
  }

  // 4. user.isVip must be true
  if (serverUser.isVip !== true) {
    return {
      valid: false,
      errorCode: 'USER_NOT_VIP',
      errorMessageFa: 'وضعیت کاربری توسط سرور ارتقا نیافته است.'
    };
  }

  // 5. user.tier must be a recognized application tier
  const isRecognizedTier = RECOGNIZED_TIERS.includes(serverUser.tier);
  if (!isRecognizedTier) {
    return {
      valid: false,
      errorCode: 'INVALID_USER_TIER',
      errorMessageFa: 'سطح کاربری ارتقا یافته توسط سرور ناشناخته است.'
    };
  }

  // 6. user.vipSince: taken directly from serverUser, or current user profile
  const validatedVipSince = serverUser.vipSince || currentUserProfile.vipSince || new Date().toISOString();

  // 7. user.vipExpiresAt must be a valid future date string
  if (
    !serverUser.vipExpiresAt ||
    typeof serverUser.vipExpiresAt !== 'string' ||
    isNaN(Date.parse(serverUser.vipExpiresAt))
  ) {
    return {
      valid: false,
      errorCode: 'INVALID_VIP_EXPIRES_AT',
      errorMessageFa: 'تاریخ انقضای اشتراک نامعتبر است.'
    };
  }
  const expiresAtMs = Date.parse(serverUser.vipExpiresAt);
  if (expiresAtMs <= Date.now()) {
    return {
      valid: false,
      errorCode: 'EXPIRED_VIP_DATE',
      errorMessageFa: 'تاریخ انقضای اشتراک در آینده قرار ندارد.'
    };
  }

  // 8. user.paymentRefId must be a non-empty string
  if (
    !serverUser.paymentRefId ||
    typeof serverUser.paymentRefId !== 'string' ||
    serverUser.paymentRefId.trim() === ''
  ) {
    return {
      valid: false,
      errorCode: 'MISSING_PAYMENT_REF_ID',
      errorMessageFa: 'کد پیگیری پرداخت در اطلاعات کاربر ثبت نشده است.'
    };
  }

  // 9. subscription presence and status must be SUCCESS
  if (!serverSub || typeof serverSub !== 'object' || serverSub.status !== 'SUCCESS') {
    return {
      valid: false,
      errorCode: 'SUBSCRIPTION_NOT_SUCCESS',
      errorMessageFa: 'وضعیت ثبت اشتراک در سرور تایید نشده است.'
    };
  }

  // 10. subscription userId must match authenticated user
  if (serverSub.userId !== currentUserId) {
    return {
      valid: false,
      errorCode: 'SUBSCRIPTION_USER_MISMATCH',
      errorMessageFa: 'شناسه مالک اشتراک با کاربر جاری مطابقت ندارد.'
    };
  }

  // 11. subscription authority must match active requested authority
  if (!serverSub.authority || serverSub.authority !== expectedAuthority) {
    return {
      valid: false,
      errorCode: 'AUTHORITY_MISMATCH',
      errorMessageFa: 'شناسه تراکنش با درخواست فعال تطابق ندارد.'
    };
  }

  // 12. subscription refId must match confirmed result
  const confirmedRefId = data.refId || serverUser.paymentRefId;
  if (!serverSub.refId || serverSub.refId !== confirmedRefId) {
    return {
      valid: false,
      errorCode: 'REF_ID_MISMATCH',
      errorMessageFa: 'کد پیگیری اشتراک با رسید پرداخت مطابقت ندارد.'
    };
  }

  // 13. amount must be a positive integer
  const amount = serverSub.amount ?? data.amount;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return {
      valid: false,
      errorCode: 'INVALID_AMOUNT',
      errorMessageFa: 'مبلغ تراکنش نامعتبر است.'
    };
  }

  // Construct validated UserProfile without invented values:
  // Strictly preserve user's own activeCycleLimit, do NOT inject activeCycleLimit: 99
  const validatedUser: UserProfile = {
    ...currentUserProfile,
    id: serverUser.id,
    name: typeof serverUser.name === 'string' ? serverUser.name : currentUserProfile.name,
    email: typeof serverUser.email === 'string' ? serverUser.email : currentUserProfile.email,
    phoneNumber: typeof serverUser.phoneNumber === 'string' ? serverUser.phoneNumber : currentUserProfile.phoneNumber,
    isVip: true,
    tier: serverUser.tier as UserSubscriptionTier,
    vipSince: serverUser.vipSince,
    vipExpiresAt: serverUser.vipExpiresAt,
    paymentRefId: serverUser.paymentRefId,
    // Active cycle limit is preserved from authoritative server or existing profile, NEVER 99
    activeCycleLimit: typeof serverUser.activeCycleLimit === 'number'
      ? serverUser.activeCycleLimit
      : currentUserProfile.activeCycleLimit
  };

  const receipt: AuthoritativePaymentReceipt = {
    refId: confirmedRefId,
    cardPan: serverSub.cardPan || data.cardPan || undefined,
    date: new Intl.DateTimeFormat('fa-IR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(serverUser.vipSince)),
    amount
  };

  return {
    valid: true,
    validatedUser,
    receipt
  };
}
