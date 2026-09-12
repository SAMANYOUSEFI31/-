import React from 'react';
import { Loader2, LayoutDashboard, Grid3X3, BarChart3 } from 'lucide-react';

interface ChartLoadingFallbackProps {
  title?: string;
  subtitle?: string;
  type?: 'heatmap' | 'matrix' | 'analytics';
}

export const ChartLoadingFallback: React.FC<ChartLoadingFallbackProps> = ({
  title = 'در حال پردازش داده‌ها و بارگذاری ماژول...',
  subtitle = 'محاسبه ماتریس وفاداری و داده‌های تاکتیکی چرخه',
  type = 'heatmap'
}) => {
  return (
    <div 
      className="surface-z1 border-standard radius-card p-5 sm:p-7 space-y-4 animate-pulse select-none"
      dir="rtl"
      role="status"
      aria-live="polite"
    >
      {/* Header skeleton */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-standard">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 radius-card surface-z2 border-standard flex items-center justify-center text-role-secondary shrink-0">
            {type === 'heatmap' ? (
              <Grid3X3 className="w-5 h-5 text-role-secondary" />
            ) : type === 'matrix' ? (
              <BarChart3 className="w-5 h-5 text-role-secondary" />
            ) : (
              <LayoutDashboard className="w-5 h-5 text-role-secondary" />
            )}
          </div>
          <div className="space-y-1.5">
            <div className="h-5 w-48 surface-z2 radius-control" />
            <div className="h-3 w-64 surface-z2 opacity-60 radius-micro" />
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-role-muted font-bold">
          <Loader2 className="w-4 h-4 animate-spin text-amber" />
          <span className="hidden sm:inline font-mono text-[11px]">{title}</span>
        </div>
      </div>

      {/* Grid or Skeleton Body based on type */}
      {type === 'heatmap' ? (
        <div className="surface-z2 radius-card p-3 sm:p-4 space-y-3">
          <div className="grid grid-cols-6 sm:grid-cols-10 md:grid-cols-[repeat(15,minmax(0,1fr))] lg:grid-cols-[repeat(18,minmax(0,1fr))] gap-1 sm:gap-1.5 md:gap-2">
            {Array.from({ length: 90 }, (_, i) => (
              <div 
                key={i} 
                className="h-10 sm:h-11 md:h-12 w-full surface-z0 opacity-50 radius-control border-standard" 
              />
            ))}
          </div>
        </div>
      ) : type === 'matrix' ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="surface-z2 border-standard radius-card p-3.5 flex items-center justify-between gap-3">
              <div className="space-y-1.5 flex-1">
                <div className="h-4 w-32 surface-z3 radius-control" />
                <div className="h-3 w-20 surface-z3 opacity-60 radius-micro" />
              </div>
              <div className="w-28 h-3 surface-z0 radius-capsule border-standard" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="surface-z2 border-standard radius-card p-5 h-44" />
          <div className="surface-z2 border-standard radius-card p-5 h-44" />
        </div>
      )}
    </div>
  );
};
