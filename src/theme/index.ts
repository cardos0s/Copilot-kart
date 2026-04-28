export const colors = {
  bg: '#0a0a0f',
  bgElevated: '#14141c',
  bgPressed: '#1c1c26',
  border: '#22222e',
  borderActive: '#00ff88',
  primary: '#00ff88',
  primaryDim: '#00cc6a',
  primaryGlow: 'rgba(0, 255, 136, 0.15)',
  accent: '#ff6b35',
  accentDim: '#cc5529',
  danger: '#ff4757',
  warning: '#ffa502',
  success: '#00ff88',
  textPrimary: '#ffffff',
  textSecondary: '#a0a0b0',
  textMuted: '#5a5a68',
  textOnPrimary: '#0a0a0f',
  overlay: 'rgba(0, 0, 0, 0.7)',
  glassBg: 'rgba(20, 20, 28, 0.9)',
};

export const typography = {
  displayL: { fontSize: 72, fontWeight: '900' as const, letterSpacing: -2 },
  displayM: { fontSize: 48, fontWeight: '900' as const, letterSpacing: -1 },
  displayS: { fontSize: 36, fontWeight: '800' as const, letterSpacing: -0.5 },
  h1: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5 },
  h2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3: { fontSize: 18, fontWeight: '700' as const },
  bodyL: { fontSize: 16, fontWeight: '500' as const },
  body: { fontSize: 14, fontWeight: '500' as const },
  bodyS: { fontSize: 13, fontWeight: '500' as const },
  label: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 1.5, textTransform: 'uppercase' as const },
  labelL: { fontSize: 13, fontWeight: '700' as const, letterSpacing: 1, textTransform: 'uppercase' as const },
  mono: { fontVariant: ['tabular-nums'] as const },
};

export const spacing = {
  xs: 4, s: 8, m: 12, l: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48,
};

export const radius = {
  s: 8, m: 12, l: 16, xl: 20, pill: 999,
};

export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  glow: {
    shadowColor: colors.primary,
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
};