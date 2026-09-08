import React from 'react';
import { Loader2 } from 'lucide-react';

interface ViewLoadingSkeletonProps {
  title?: string;
}

export const ViewLoadingSkeleton: React.FC<ViewLoadingSkeletonProps> = ({ 
  title = 'در حال فراخوانی پایگاه داده و ماژول‌های بوشیدو...' 
}) => {
  return (
    <div className="w-full max-w-5xl mx-auto py-12 px-4 space-y-6 animate-pulse" dir="rtl">
      {/* Header skeleton */}
      <div className="surface-z1 border-standard radius-card p-4 sm:p-6 flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-6 w-48 surface-z2 radius-component" />
          <div className="h-3.5 w-64 surface-z2 opacity-70 radius-control" />
        </div>
        <div className="flex items-center gap-2 text-role-muted text-xs font-bold">
          <Loader2 className="w-4 h-4 animate-spin text-amber" />
          <span className="hidden sm:inline">{title}</span>
        </div>
      </div>

      {/* Grid cards skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="surface-z1 border-standard radius-card p-5 space-y-3">
            <div className="h-4 w-24 surface-z2 opacity-80 radius-control" />
            <div className="h-8 w-16 surface-z2 radius-component" />
            <div className="h-3 w-full surface-z2 opacity-50 radius-micro" />
          </div>
        ))}
      </div>

      {/* Main content skeleton block */}
      <div className="surface-z1 border-standard radius-modal p-6 sm:p-8 space-y-4">
        <div className="h-5 w-40 surface-z2 radius-component" />
        <div className="space-y-2.5 pt-2">
          <div className="h-12 w-full surface-z2 opacity-60 radius-card" />
          <div className="h-12 w-full surface-z2 opacity-60 radius-card" />
          <div className="h-12 w-full surface-z2 opacity-60 radius-card" />
        </div>
      </div>
    </div>
  );
};
