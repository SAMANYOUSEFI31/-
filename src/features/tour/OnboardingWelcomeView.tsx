import React from 'react';
import { Sparkles, Swords } from 'lucide-react';

export interface CompactEmptyCycleStateProps {
  title?: string;
  description?: string;
  buttonText?: string;
  onOpenCreateCycle: () => void;
  onNavigateToHabitsGuide?: () => void;
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
}

export type OnboardingWelcomeViewProps = CompactEmptyCycleStateProps;

export const CompactEmptyCycleState: React.FC<CompactEmptyCycleStateProps> = ({
  title = 'هیچ چرخه فعالی وجود ندارد',
  description = 'برای آغاز مسیر انضباط و ثبت روزانه ارکان بوشیدو، اولین چرخه ۹۰ روزه نبرد خود را بسازید.',
  buttonText = 'تعریف اولین چرخه نبرد',
  onOpenCreateCycle,
  secondaryAction
}) => {
  return (
    <div 
      id="compact-empty-cycle-state"
      className="max-w-md mx-auto py-12 sm:py-16 px-4 animate-in fade-in duration-200" 
      dir="rtl"
    >
      <div 
        id="compact-empty-cycle-card"
        className="surface-z1 border-standard radius-card p-6 sm:p-8 text-center space-y-4 shadow-subtle"
      >
        <div 
          id="compact-empty-cycle-icon-box"
          className="w-12 h-12 radius-component surface-z2 border-standard flex items-center justify-center text-crimson mx-auto shadow-subtle"
        >
          <Swords className="w-6 h-6 text-crimson" />
        </div>

        <div id="compact-empty-cycle-content" className="space-y-2">
          <h2 
            id="compact-empty-cycle-heading"
            className="text-base sm:text-lg font-black text-role-primary tracking-tight"
          >
            {title}
          </h2>
          <p 
            id="compact-empty-cycle-sentence"
            className="text-xs sm:text-sm text-role-secondary leading-relaxed max-w-sm mx-auto"
          >
            {description}
          </p>
        </div>

        <div id="compact-empty-cycle-actions" className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-2.5">
          <button
            id="compact-empty-cycle-create-btn"
            type="button"
            onClick={onOpenCreateCycle}
            className="btn-contract-primary w-full sm:w-auto font-black text-xs sm:text-sm px-6 py-3 radius-component shadow-subtle whitespace-nowrap focus-ring-tactical inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-white" />
            <span>{buttonText}</span>
          </button>
          {secondaryAction && (
            <button
              id="compact-empty-cycle-secondary-btn"
              type="button"
              onClick={secondaryAction.onClick}
              className="btn-contract-secondary w-full sm:w-auto text-xs font-bold px-4 py-3 radius-component inline-flex items-center justify-center gap-1.5 focus-ring-tactical cursor-pointer"
            >
              <span>{secondaryAction.label}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Aliased exports for unified empty-state contract and clean backward compatibility
export const OnboardingWelcomeView = CompactEmptyCycleState;
export default CompactEmptyCycleState;
