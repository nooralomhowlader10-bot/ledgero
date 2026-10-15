// ═══════════════════════════════════════════════════════════════════════
// LEDGERO — Dual-Mode Theme Token System
// Easy Mode: Khatabook/OkCredit inspired — friendly, large, green/red
// Advanced Mode: QuickBooks/Xero inspired — premium, compact, purple/blue
// ═══════════════════════════════════════════════════════════════════════

export const EASY_THEME = {
  // Colors
  primary: '#008060',       // Trusted green
  primaryLight: '#e6f5f0',
  accent: '#0ea5e9',        // Sky blue
  danger: '#D82C0D',        // Cash out red
  dangerLight: '#fef2f2',
  bg: '#F4F6F8',
  surface: '#FFFFFF',
  surfaceBorder: 'transparent',
  textPrimary: '#1a1a1a',
  textSecondary: '#6b7280',
  textMuted: '#9ca3af',

  // Geometry
  radius: '16px',
  radiusSm: '12px',
  radiusLg: '20px',
  shadow: '0 2px 12px rgba(0,0,0,0.06)',
  shadowHover: '0 4px 20px rgba(0,0,0,0.1)',

  // Typography
  fontBase: '16px',
  fontSm: '14px',
  fontLg: '20px',
  fontXl: '28px',
  fontWeight: '500',
  fontWeightBold: '700',

  // Navigation
  navStyle: 'tabs',      // top tabs on desktop, bottom tabs on mobile
  headerHeight: '56px',
  bottomNavHeight: '64px',
};

export const ADVANCED_THEME = {
  // Colors
  primary: '#7C3AED',       // Purple — premium
  primaryLight: '#f3e8ff',
  accent: '#3B82F6',        // Blue — data
  danger: '#ef4444',        // Red
  dangerLight: '#fef2f2',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceBorder: '#E2E8F0',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94a3b8',

  // Geometry
  radius: '8px',
  radiusSm: '6px',
  radiusLg: '12px',
  shadow: '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)',
  shadowHover: '0 4px 6px rgba(0,0,0,0.1)',

  // Typography
  fontBase: '14px',
  fontSm: '12px',
  fontLg: '18px',
  fontXl: '24px',
  fontWeight: '400',
  fontWeightBold: '600',

  // Navigation
  navStyle: 'sidebar',   // left sidebar on desktop, bottom tabs + hamburger on mobile
  headerHeight: '56px',
  bottomNavHeight: '60px',
};

// CSS variable injection — called when mode changes
export function applyModeTheme(mode) {
  const theme = mode === 'advanced' ? ADVANCED_THEME : EASY_THEME;
  const root = document.documentElement;

  root.setAttribute('data-mode', mode);

  root.style.setProperty('--m-primary', theme.primary);
  root.style.setProperty('--m-primary-light', theme.primaryLight);
  root.style.setProperty('--m-accent', theme.accent);
  root.style.setProperty('--m-danger', theme.danger);
  root.style.setProperty('--m-danger-light', theme.dangerLight);
  root.style.setProperty('--m-bg', theme.bg);
  root.style.setProperty('--m-surface', theme.surface);
  root.style.setProperty('--m-surface-border', theme.surfaceBorder);
  root.style.setProperty('--m-text', theme.textPrimary);
  root.style.setProperty('--m-text-secondary', theme.textSecondary);
  root.style.setProperty('--m-text-muted', theme.textMuted);
  root.style.setProperty('--m-radius', theme.radius);
  root.style.setProperty('--m-radius-sm', theme.radiusSm);
  root.style.setProperty('--m-radius-lg', theme.radiusLg);
  root.style.setProperty('--m-shadow', theme.shadow);
  root.style.setProperty('--m-shadow-hover', theme.shadowHover);
  root.style.setProperty('--m-font-base', theme.fontBase);
  root.style.setProperty('--m-font-sm', theme.fontSm);
  root.style.setProperty('--m-font-lg', theme.fontLg);
  root.style.setProperty('--m-font-xl', theme.fontXl);
}
