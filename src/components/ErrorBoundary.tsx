import React, { Component, ErrorInfo, ReactNode } from 'react';
import { ShieldAlert, RotateCcw, RefreshCw, AlertTriangle, Home } from 'lucide-react';
import { clearUserLocalState, getActiveAccountId, safeRemoveLocalStorage } from '../utils/storageUtils';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught runtime error caught by Bushido ErrorBoundary:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetLocal = () => {
    try {
      const activeId = getActiveAccountId();
      clearUserLocalState(activeId);
      clearUserLocalState(null); // Clear guest storage too
      safeRemoveLocalStorage('bushido_discipline_os_v1');
      safeRemoveLocalStorage('bushido_system_state_v1');
      safeRemoveLocalStorage('bushido_active_account_id');
      safeRemoveLocalStorage('bushido_auth_token');
      sessionStorage.clear();
    } catch (e) {
      console.warn('Failed to clear storage:', e);
    }
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div 
          className="min-h-screen surface-z0 text-role-primary flex items-center justify-center p-4 font-sans selection:bg-rose-subtle"
          dir="rtl"
        >
          <div className="w-full max-w-lg surface-z1 border-standard radius-modal p-6 sm:p-8 space-y-6 shadow-subtle">
            
            {/* Header Icon & Title */}
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 radius-component bg-rose-subtle border border-rose-subtle flex items-center justify-center text-rose shrink-0 shadow-subtle">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h1 className="text-lg sm:text-xl font-black text-role-primary tracking-tight">
                  مهار خطای غیرمنتظره سامانه
                </h1>
                <p className="text-xs sm:text-sm text-role-secondary leading-relaxed">
                  سیستم محافظت بوشیدو خطای رندرینگ را کنترل کرده تا یکپارچگی داده‌های شما حفظ شود.
                </p>
              </div>
            </div>

            {/* Error detail banner */}
            {import.meta.env.DEV ? (
              <div className="surface-z0 border border-debt-subtle radius-card p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-debt">
                  <AlertTriangle className="w-4 h-4 text-debt shrink-0" />
                  <span>پیام خطا (محیط توسعه):</span>
                </div>
                <p className="text-xs font-mono text-role-primary break-words leading-relaxed">
                  {this.state.error?.message || 'یک خطای نامشخص در رابط کاربری رخ داده است.'}
                </p>
                {this.state.errorInfo?.componentStack && (
                  <details className="mt-2 text-[11px] text-role-muted font-mono">
                    <summary className="cursor-pointer text-role-secondary hover:text-role-primary">نمایش ردپای کامپوننت‌ها</summary>
                    <pre className="mt-2 p-2 surface-z2 border-standard radius-control overflow-x-auto text-[10px] text-role-secondary text-left whitespace-pre-wrap" dir="ltr">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </div>
            ) : (
              <div className="surface-z0 border-standard radius-card p-4 text-center space-y-1.5">
                <p className="text-xs text-role-secondary leading-relaxed">
                  اطلاعات و رکوردهای شما در حافظه محلی ذخیره شده‌اند. با کلیک روی دکمه زیر، سامانه به‌صورت خودکار بازیابی می‌شود.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full sm:flex-1 py-3 px-4 radius-component bg-amber hover:brightness-110 text-black font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-subtle transition cursor-pointer active:scale-[0.98] touch-manipulation focus-ring-tactical"
                title="بارگذاری مجدد بدون دستکاری و حذف داده‌های ثبت‌شده"
              >
                <RefreshCw className="w-4 h-4" />
                <span>بارگذاری مجدد (حفظ تمام داده‌ها)</span>
              </button>

              <button
                type="button"
                onClick={this.handleResetLocal}
                className="w-full sm:w-auto py-3 px-4 radius-component surface-z2 hover:surface-z3 border-standard text-role-secondary hover:text-role-primary font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer active:scale-[0.98] touch-manipulation focus-ring-tactical"
                title="پاکسازی کش محلی مرورگر و بازنشانی وضعیت اولیه"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>بازنشانی کامل حافظه موقت</span>
              </button>
            </div>

            {/* Footer notice */}
            <p className="text-[11px] text-role-muted text-center leading-relaxed border-t border-standard pt-4">
              داده‌های ثبت‌شده و گزارش‌های روزانه شما کاملاً امن هستند؛ دکمه «بارگذاری مجدد» صفحه را بدون پاکسازی داده‌ها بازیابی می‌کند.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
