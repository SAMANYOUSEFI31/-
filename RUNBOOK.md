# 🛠️ کتابچه عملیاتی و دیباگ (Operational Runbook & Troubleshooting)

> **مخاطب:** تیم فنی، DevOps و پشتیبانی سیستم  
> **سامانه:** Bushido Discipline OS

---

## ۱. ارزیابی سلامت سامانه (`GET /api/health`)

سریع‌ترین روش برای بررسی وضعیت زنده برنامه، فراخوانی آدرس `/api/health` است:

### نمونه پاسخ سالم (PostgreSQL فعال):
```json
{
  "status": "ok",
  "engine": "Bushido Discipline OS (Production Grade)",
  "mode": "production",
  "version": "3.0.0",
  "uptimeSeconds": 3600,
  "timestamp": "2026-09-01T14:22:00.000Z",
  "nodeVersion": "v22.x",
  "memoryRssMb": 85,
  "database": {
    "driver": "postgresql_prisma",
    "isPrismaAvailable": true,
    "isServerlessVercel": true
  },
  "security": {
    "testShortcutsEnabled": false,
    "otpDebugEnabled": false
  }
}
```

### نمونه پاسخ در حالت Fallback محلی:
```json
{
  "database": {
    "driver": "local_file_fallback",
    "isPrismaAvailable": false,
    "isServerlessVercel": true
  }
}
```
> **تحلیل:** اگر `driver` برابر با `local_file_fallback` باشد، یعنی دیتابیس PostgreSQL متصل نشده و برنامه از فایل موقت حافظه استفاده می‌کند. برای رفع این موضوع، متغیر `DATABASE_URL` را در Vercel بررسی کنید.

---

## ۲. سناریوهای عیب‌یابی متداول (Troubleshooting Matrix)

| نشانه / خطا | علت احتمالی | اقدام اصلاحی |
| :--- | :--- | :--- |
| **دکمه‌های ورود تستی در پروداکشن کار نمی‌کنند** | رفتار کاملاً طبیعی و امنیتی | این ویژگی در پروداکشن (`APP_ENV=production`) به طور مطلق قفل است. در محیط استیجینگ (`APP_ENV=staging`) با تنظیم `ALLOW_TEST_SHORTCUTS=true` فعال می‌شود. |
| **لاگ‌های کاربر پس از ری‌استارت Vercel از نو می‌شوند** | اتصال دیتابیس به PostgreSQL انجام نشده و سرورلس فایل موقت `/tmp` را خالی کرده است | متغیر `DATABASE_URL` را به یک سرویس پایدار (مثل Neon Postgres) متصل کنید. |
| **خطای CORS یا خطای ۵۰۰ در ثبت نام** | اشتباه در مقدار متغیرهای احراز هویت | لاگ‌های سرور (Runtime Logs) را در پنل Vercel بررسی کنید. |
| **نسخه جدید UI برای کاربر نمایش داده نمی‌شود (کش PWA)** | سرویس‌ورکر نسخه قدیمی را کش کرده است | از منوی تنظیمات یا کلید میانبر، کش مرورگر کاربر را نوسازی نمایید یا کش سرویس‌ورکر را در تب Application مرورگر Unregister کنید. |

---

## ۳. ردیابی خطاها و لاگ‌های ساختاریافته سرور (Operational Observability & Runtime Logs)

### شناسه ردیابی درخواست (`X-Request-ID`):
- تمامی پاسخ‌های ارسالی سرور (موفق یا ناموفق) دارای هدر استاندارد `X-Request-ID` با یک مقدار UUID یکتا و غیرقابل دستکاری کلاینت هستند.
- در صورت بروز خطای سمت کاربر یا دریافت گزارش خطا در استیجینگ/پروداکشن ورسل، مقدار هدر `X-Request-ID` را از تب Network یا پیام خطای کلاینت دریافت کنید.
- در پنل **Vercel Runtime Logs**، شناسه `requestId` را جستجو کنید تا رویداد ساختاریافته مربوطه را بلافاصله بیابید.

### فیلدهای ایمن رویدادهای خطای ۵۰۰ (`server_error`):
هر خطای غیرمنتظره سرور به صورت یک خط JSON ساختاریافته ثبت می‌شود:
```json
{
  "event": "server_error",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "method": "POST",
  "path": "/api/cycles",
  "statusCode": 500,
  "errorCode": "INTERNAL_SERVER_ERROR",
  "environment": "staging",
  "timestamp": "2026-09-20T14:22:00.000Z",
  "errorName": "DatabaseError",
  "message": "An unexpected error occurred."
}
```

### اصل مصونیت و عدم ثبت داده‌های حساس (Redaction Invariant):
- بدنه درخواست‌ها (`request body`)، هدرهای کلاینت (`request headers`)، پارامترهای کوئری استرینگ (`query values`) و کوکی‌ها هرگز در لاگ‌ها ثبت نمی‌شوند.
- کلیدهای احراز هویت (`Authorization`، توکن‌های JWT، کوکی‌ها)، کلمات عبور، کدهای OTP، مقادیر `JWT_SECRET`، آدرس‌های اتصال دیتابیس (`DATABASE_URL`) و اطلاعات پذیرنده پرداخت در صورت بروز در متن پیام خطا، به صورت خودکار با برچسب `[REDACTED]` جایگزین می‌شوند.

---

## ۴. اهداف و بهینه‌سازی‌های آینده [هدف آینده]

- [هدف آینده] اضافه کردن لایه Web Push Notifications برای یادآوری زمان کات‌آف شبانه.
- [هدف آینده] مهاجرت کامل وب‌سوکت برای همگام‌سازی لحظه‌ای چنددستگاهی در سطح حساب‌های VIP.
