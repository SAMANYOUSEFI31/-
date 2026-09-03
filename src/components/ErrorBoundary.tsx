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
          className="min-h-screen bg-[#09090b] text-zinc-100 flex items-center justify-center p-4 font-sans selection:bg-rose-500/30"
          dir="rtl"
        >
          <div className="w-full max-w-lg bg-[#121215] border border-zinc-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl shadow-black/80">
            
            {/* Header Icon & Title */}
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0 shadow-lg">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h1 className="text-lg sm:text-xl font-black text-zinc-100 tracking-tight">
                  مهار خطای غیرمنتظره سامانه
                </h1>
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                  سیستم محافظت بوشیدو خطای رندرینگ را کنترل کرده تا یکپارچگی داده‌های شما حفظ شود.
                </p>
              </div>
            </div>

            {/* Error detail banner */}
            {process.env.NODE_ENV !== 'production' ? (
              <div className="bg-[#09090b] border border-red-500/30 rounded-2xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-red-300">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>پیام خطا (محیط توسعه):</span>
                </div>
                <p className="text-xs font-mono text-zinc-300 break-words leading-relaxed">
                  {this.state.error?.message || 'یک خطای نامشخص در رابط کاربری رخ داده است.'}
                </p>
                {this.state.errorInfo?.componentStack && (
                  <details className="mt-2 text-[11px] text-zinc-400 font-mono">
                    <summary className="cursor-pointer text-zinc-300 hover:text-white">نمایش ردپای کامپوننت‌ها</summary>
                    <pre className="mt-2 p-2 bg-zinc-950 rounded-lg overflow-x-auto text-[10px] text-zinc-400 text-left whitespace-pre-wrap" dir="ltr">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </div>
            ) : (
              <div className="bg-[#09090b] border border-zinc-800 rounded-2xl p-4 text-center space-y-1.5">
                <p className="text-xs text-zinc-300 leading-relaxed">
                  اطلاعات و رکوردهای شما در حافظه محلی ذخیره شده‌اند. با کلیک روی دکمه زیر، سامانه به‌صورت خودکار بازیابی می‌شود.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full sm:flex-1 py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition cursor-pointer active:scale-[0.98] touch-manipulation"
                title="بارگذاری مجدد بدون دستکاری و حذف داده‌های ثبت‌شده"
              >
                <RefreshCw className="w-4 h-4" />
                <span>بارگذاری مجدد (حفظ تمام داده‌ها)</span>
              </button>

              <button
                type="button"
                onClick={this.handleResetLocal}
                className="w-full sm:w-auto py-3 px-4 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer active:scale-[0.98] touch-manipulation"
                title="پاکسازی کش محلی مرورگر و بازنشانی وضعیت اولیه"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>بازنشانی کامل حافظه موقت</span>
              </button>
            </div>

            {/* Footer notice */}
            <p className="text-[11px] text-zinc-400 text-center leading-relaxed border-t border-zinc-800/80 pt-4">
              داده‌های ثبت‌شده و گزارش‌های روزانه شما کاملاً امن هستند؛ دکمه «بارگذاری مجدد» صفحه را بدون پاکسازی داده‌ها بازیابی می‌کند.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
