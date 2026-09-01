import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, AlertTriangle, AlertOctagon, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type?: ToastType;
  duration?: number;
}

interface ToastProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  return (
    <div 
      className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none w-full max-w-sm px-4 select-none"
      dir="rtl"
    >
      <AnimatePresence mode="sync">
        {toasts.map(toast => {
          const type = toast.type || 'success';
          
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 450, damping: 32 }}
              className={`pointer-events-auto w-full p-3.5 rounded-2xl border backdrop-blur-xl shadow-2xl flex items-center justify-between gap-3 text-xs sm:text-sm font-bold ${
                type === 'error'
                  ? 'bg-red-950/90 border-red-500/60 text-red-100 shadow-red-950/50'
                  : type === 'warning'
                  ? 'bg-amber-950/90 border-amber-500/60 text-amber-100 shadow-amber-950/50'
                  : type === 'info'
                  ? 'bg-blue-950/90 border-blue-500/60 text-blue-100 shadow-blue-950/50'
                  : 'bg-[#121215]/95 border-emerald-500/50 text-zinc-100 shadow-black/80'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {type === 'error' && (
                  <div className="w-7 h-7 rounded-xl bg-red-500/20 border border-red-500/40 flex items-center justify-center shrink-0 text-red-400">
                    <AlertOctagon className="w-4 h-4" />
                  </div>
                )}
                {type === 'warning' && (
                  <div className="w-7 h-7 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 text-amber-400">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                )}
                {type === 'info' && (
                  <div className="w-7 h-7 rounded-xl bg-blue-500/20 border border-blue-500/40 flex items-center justify-center shrink-0 text-blue-400">
                    <Info className="w-4 h-4" />
                  </div>
                )}
                {type === 'success' && (
                  <div className="w-7 h-7 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0 text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                )}
                
                <span className="leading-snug break-words text-zinc-100">
                  {toast.message}
                </span>
              </div>

              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="w-8 h-8 sm:w-11 sm:h-11 min-w-[36px] min-h-[36px] rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 flex items-center justify-center shrink-0 transition cursor-pointer touch-manipulation"
                title="بستن اعلان"
                aria-label="بستن اعلان"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
