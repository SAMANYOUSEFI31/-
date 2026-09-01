import { AccentTheme } from '../types';

export interface ThemeConfig {
  id: AccentTheme;
  nameFa: string;
  nameEn: string;
  descriptionFa: string;
  colorHex: string;
  badgeBg: string;
  glowColor: string;
  primaryClass: string;
  hoverClass: string;
  borderClass: string;
  textClass: string;
  bgSubtle: string;
}

export const BUSHIDO_CRIMSON_THEME: ThemeConfig = {
  id: 'crimson',
  nameFa: 'سرخ اصیل بوشیدو',
  nameEn: 'Bushido Crimson',
  descriptionFa: 'نماد غیرت، شجاعت و تمرکز پولادین',
  colorHex: '#E11D48',
  badgeBg: 'bg-[#E11D48]',
  glowColor: 'rgba(225, 29, 72, 0.35)',
  primaryClass: 'bg-[#E11D48] hover:bg-[#BE123C] text-white',
  hoverClass: 'hover:bg-[#E11D48]/20 hover:text-[#FB7185]',
  borderClass: 'border-[#E11D48]/40',
  textClass: 'text-[#FB7185]',
  bgSubtle: 'bg-[#E11D48]/15'
};

export const THEME_PALETTES: Record<AccentTheme, ThemeConfig> = {
  crimson: BUSHIDO_CRIMSON_THEME,
  amber: BUSHIDO_CRIMSON_THEME,
  emerald: BUSHIDO_CRIMSON_THEME,
  cyan: BUSHIDO_CRIMSON_THEME
};

export function applyAccentTheme(_theme: AccentTheme = 'crimson') {
  if (typeof document === 'undefined') return;
  const config = BUSHIDO_CRIMSON_THEME;
  document.documentElement.setAttribute('data-theme', 'crimson');
  document.documentElement.style.setProperty('--accent-primary', config.colorHex);
  document.documentElement.style.setProperty('--accent-glow', config.glowColor);
  
  // Calculate RGB channels for subtle transparency (E1 = 225, 1D = 29, 48 = 72)
  document.documentElement.style.setProperty('--accent-subtle', `rgba(225, 29, 72, 0.15)`);
  document.documentElement.style.setProperty('--accent-border', `rgba(225, 29, 72, 0.4)`);
}

