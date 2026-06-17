export const colors = {
  // Backgrounds
  bg: '#08080C',
  bgElevated: '#101018',
  bgPressed: '#1A1A24',
  surface: '#101018',
  surfaceHigh: '#16161F',
  glassBg: 'rgba(16, 16, 24, 0.9)',
  overlay: 'rgba(0, 0, 0, 0.7)',

  // Borders
  border: '#22222E',
  borderStrong: '#2E2E3C',
  borderActive: '#2F6BFF',

  // Brand — azul de corrida COCKPIT (lime virou acento secundário: colors.accentLime)
  primary: '#2F6BFF',
  primaryDim: '#1E49B5',
  primaryGlow: 'rgba(47, 107, 255, 0.20)',
  textOnPrimary: '#FFFFFF',

  // Status
  success: '#00FF88',
  successDim: '#00CC6A',
  danger: '#FF4757',
  dangerDim: '#CC3845',
  warning: '#FFA502',
  warningDim: '#CC8400',

  // Azul de corrida — identidade COCKPIT (splash, onboarding, auth)
  racingBlue: '#2F6BFF',
  racingBlueDim: '#1E49B5',

  // Accents (usar como destaques em gráficos, splashes, gradients)
  accentLime: '#D4FF3A',
  accentMagenta: '#FF3DCB',
  accentCyan: '#3DDCFF',
  accentPurple: '#9D5BFF',
  accentOrange: '#FF6B35',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#A0A0B0',
  textMuted: '#5A5A68',
  textDim: '#3A3A45',
};

export const typography = {
  /** Times de volta e outros números gigantes (tela live). */
  displayXL: { fontSize: 84, fontWeight: '900' as const, letterSpacing: -3 },
  displayL: { fontSize: 64, fontWeight: '900' as const, letterSpacing: -2 },
  displayM: { fontSize: 44, fontWeight: '900' as const, letterSpacing: -1 },
  displayS: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.5 },

  h1: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5 },
  h2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3: { fontSize: 18, fontWeight: '700' as const },

  bodyL: { fontSize: 16, fontWeight: '500' as const },
  body: { fontSize: 14, fontWeight: '500' as const },
  bodyS: { fontSize: 13, fontWeight: '500' as const },

  label: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
    textTransform: 'uppercase' as const,
  },
  labelL: {
    fontSize: 13,
    fontWeight: '700' as const,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
  },

  /** Para números — sempre usar pra tabular-nums. */
  mono: { fontVariant: ['tabular-nums'] as ['tabular-nums'] },
};

export const spacing = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
};

export const radius = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 20,
  xxl: 28,
  pill: 999,
};

export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  cardHigh: {
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  glow: {
    shadowColor: colors.primary,
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  glowSoft: {
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
};

/** Gradientes pre-set pros splashes coloridos da arte do Copilot. */
export const gradients = {
  primarySplash: [colors.accentMagenta, colors.accentPurple, colors.accentCyan, colors.primary],
  cardGlow: ['rgba(212, 255, 58, 0.1)', 'rgba(212, 255, 58, 0)'],
  bottomFade: ['rgba(8,8,12,0)', 'rgba(8,8,12,0.85)', 'rgba(8,8,12,0.98)'],
  topFade: ['rgba(8,8,12,0.95)', 'rgba(8,8,12,0.4)', 'rgba(8,8,12,0)'],
};
