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
| **دکمه‌های ورود تستی در پروداکشن کار نمی‌کنند** | رفتار کاملاً طبیعی و امنیتی | این ویژگی در پروداکشن خاموش است. در صورت نیاز ضروری موقت، `ALLOW_TEST_SHORTCUTS=true` را در سرور ست کنید. |
| **لاگ‌های کاربر پس از ری‌استارت Vercel از نو می‌شوند** | اتصال دیتابیس به PostgreSQL انجام نشده و سرورلس فایل موقت `/tmp` را خالی کرده است | متغیر `DATABASE_URL` را به یک سرویس پایدار (مثل Neon Postgres) متصل کنید. |
| **خطای CORS یا خطای ۵۰۰ در ثبت نام** | اشتباه در مقدار متغیرهای احراز هویت | لاگ‌های سرور (Runtime Logs) را در پنل Vercel بررسی کنید. |
| **نسخه جدید UI برای کاربر نمایش داده نمی‌شود (کش PWA)** | سرویس‌ورکر نسخه قدیمی را کش کرده است | از منوی تنظیمات یا کلید میانبر، کش مرورگر کاربر را نوسازی نمایید یا کش سرویس‌ورکر را در تب Application مرورگر Unregister کنید. |

---

## ۳. بررسی لاگ‌های سرور (Runtime Logs)

کدهای لاگ با برچسب‌های استاندارد در خروجی کنسول ثبت می‌شوند:
- `[Database] PostgreSQL connected via Prisma datasource`: اتصال موفق به Postgres.
- `[Database] Running in self-hosted persistent file/memory database mode`: فعال بودن موتور پشتیبان محلی.
- `[Bushido Auth]`: ثبت‌نام و نشست‌های کاربران.
- `[RateLimit]`: مسدودسازی آی‌پی‌های ارسال‌کننده ریکوئست‌های بیش از حد مجاز.

---

## ۴. اهداف و بهینه‌سازی‌های آینده [هدف آینده]

- [هدف آینده] اضافه کردن لایه Web Push Notifications برای یادآوری زمان کات‌آف شبانه.
- [هدف آینده] مهاجرت کامل وب‌سوکت برای همگام‌سازی لحظه‌ای چنددستگاهی در سطح حساب‌های VIP.
