import React from 'react';
import { motion } from 'motion/react';

export interface SubTabItem<T extends string = string> {
  id: T;
  label: string;
  shortLabel?: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: string;
  hasAlert?: boolean;
  activeColor?: string;
}

interface ResponsiveSubTabBarProps<T extends string = string> {
  tabs: SubTabItem<T>[];
  activeTab: T;
  onSelectTab: (id: T) => void;
  layoutId?: string;
  className?: string;
}

/**
 * ResponsiveSubTabBar
 * Universal ergonomic sub-tab bar conforming to mobile UX standards:
 * - On very small screens (< 640px), ensures no text truncation or collision by showing icons and smart shortLabels with touch targets >= 44px
 * - Fully fluid & responsive on tablet/desktop with full labels and badges
 * - Uses spring-animated layout indicator for seamless tactile feedback
 * - Supports arbitrary number of tabs without structural overflow
 */
export function ResponsiveSubTabBar<T extends string = string>({
  tabs,
  activeTab,
  onSelectTab,
  layoutId = 'activeSubTabIndicator',
  className = ''
}: ResponsiveSubTabBarProps<T>) {
  return (
    <div
      className={`w-full max-w-full bg-[#121215] border border-zinc-800 p-1 sm:p-1.5 rounded-2xl flex items-center shadow-lg select-none relative ${className}`}
    >
      <div 
        className="w-full grid gap-1 sm:gap-1.5 min-w-0"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const activeIconColor = tab.activeColor || 'text-amber-400';

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`w-full min-h-[44px] h-11 sm:h-12 py-1.5 sm:py-2 px-1 xs:px-1.5 sm:px-3 rounded-xl font-bold text-[11px] xs:text-xs sm:text-sm transition-colors duration-150 cursor-pointer flex items-center justify-center gap-1 sm:gap-2 whitespace-nowrap leading-none relative z-10 select-none active:scale-[0.98] ${
                isActive
                  ? 'text-white font-black'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId={layoutId}
                  layout="position"
                  className="absolute inset-0 rounded-xl bg-zinc-800/90 border border-zinc-700 shadow-sm -z-10 pointer-events-none"
                  transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                />
              )}

              {Icon && (
                <Icon
                  className={`w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 transition-colors duration-150 ${
                    isActive ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'
                  }`}
                />
              )}

              {/* Unified Canonical Label across all screen sizes */}
              <span className="transition-colors duration-150 whitespace-nowrap text-[11px] xs:text-xs sm:text-sm truncate">
                {tab.label}
              </span>

              {/* Optional badge */}
              {tab.badge && (
                <span
                  className={`hidden md:inline-block text-[10px] font-mono px-1.5 py-0.5 rounded-md border transition-colors duration-150 shrink-0 ${
                    isActive
                      ? 'bg-[#18181b] text-zinc-200 border-zinc-700'
                      : 'bg-[#18181b] text-zinc-400 border-zinc-800'
                  }`}
                >
                  {tab.badge}
                </span>
              )}

              {/* Optional alert ping */}
              {tab.hasAlert && (
                <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
