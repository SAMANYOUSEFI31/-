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
      <div className="bg-[#121215] border border-zinc-800/80 rounded-2xl p-4 sm:p-6 flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-6 w-48 bg-zinc-800/60 rounded-xl" />
          <div className="h-3.5 w-64 bg-zinc-800/40 rounded-lg" />
        </div>
        <div className="flex items-center gap-2 text-zinc-500 text-xs font-bold">
          <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
          <span className="hidden sm:inline">{title}</span>
        </div>
      </div>

      {/* Grid cards skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-[#121215] border border-zinc-800/60 rounded-2xl p-5 space-y-3">
            <div className="h-4 w-24 bg-zinc-800/50 rounded-lg" />
            <div className="h-8 w-16 bg-zinc-800/70 rounded-xl" />
            <div className="h-3 w-full bg-zinc-800/30 rounded" />
          </div>
        ))}
      </div>

      {/* Main content skeleton block */}
      <div className="bg-[#121215] border border-zinc-800/60 rounded-3xl p-6 sm:p-8 space-y-4">
        <div className="h-5 w-40 bg-zinc-800/60 rounded-xl" />
        <div className="space-y-2.5 pt-2">
          <div className="h-12 w-full bg-zinc-800/30 rounded-2xl" />
          <div className="h-12 w-full bg-zinc-800/30 rounded-2xl" />
          <div className="h-12 w-full bg-zinc-800/30 rounded-2xl" />
        </div>
      </div>
    </div>
  );
};
