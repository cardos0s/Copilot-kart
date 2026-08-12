/**
 * Tokens do Cockpit 219 — vindos do handoff de design (splash + kartódromo).
 *
 * Os nomes antigos do tema continuam exportados apontando para os valores
 * novos, então as telas já existentes migram junto sem precisar de edição.
 * Regras do sistema que os valores carregam:
 *   - um acento só (azul). Verde e vermelho existem para o SINAL de um delta
 *     (mais rápido / mais lento), nunca como decoração.
 *   - `blueSoft` só sobre fundo escuro; sobre branco use `blue`.
 *   - hairline no lugar de caixa, e nenhuma sombra na interface.
 */
export const colors = {
  // ==== Paleta do handoff ====
  paper: '#FFFFFF',
  ink: '#0B0D11',

  blue: '#2563FF',
  blueSoft: '#5B8CFF',
  blueDim: 'rgba(37, 99, 255, 0.12)',

  text: '#F1F3F6',
  muted: '#8A93A0',
  dim: 'rgba(241, 243, 246, 0.38)',

  line: 'rgba(255, 255, 255, 0.07)',
  line2: 'rgba(255, 255, 255, 0.14)',

  // ==== Backgrounds ====
  bg: '#08090C',
  /** Superfície de campo e cartão. */
  surface: '#12151B',
  /** Área de traçado e mapa — mais fria que a superfície comum. */
  surfaceTrack: '#0D1118',
  /** Trilhos, pinos inativos, estado pressionado. */
  surfaceRail: '#252A33',
  bgElevated: '#12151B',
  bgPressed: '#252A33',
  surfaceHigh: '#1D212A',
  glassBg: 'rgba(13, 17, 24, 0.92)',
  overlay: 'rgba(8, 9, 12, 0.66)',

  // ==== Borders ====
  border: 'rgba(255, 255, 255, 0.07)',
  borderStrong: 'rgba(255, 255, 255, 0.14)',
  borderActive: '#2563FF',

  // ==== Brand ====
  primary: '#2563FF',
  primaryDim: '#1B4ACC',
  primaryGlow: 'rgba(37, 99, 255, 0.12)',
  textOnPrimary: '#FFFFFF',
  racingBlue: '#2563FF',
  racingBlueDim: '#1B4ACC',

  // ==== Sinal de delta ====
  // Só para dado: volta mais rápida / mais lenta, ganhou / perdeu tempo.
  success: '#32CE7B',
  successDim: '#249456',
  danger: '#FF5C5C',
  dangerDim: '#C53F3F',
  warning: '#E5A83C',
  warningDim: '#A8792A',

  // ==== Acentos herdados ====
  // O handoff pede um acento só. Estes seguem aqui porque gamificação,
  // gráficos e celebrações ainda dependem deles — tirar de circulação é uma
  // passada de design à parte, não uma troca de valor de token.
  accentLime: '#D4FF3A',
  accentMagenta: '#FF3DCB',
  accentCyan: '#3DDCFF',
  accentPurple: '#9D5BFF',
  accentOrange: '#FF6B35',

  // ==== Text ====
  textPrimary: '#F1F3F6',
  textSecondary: '#8A93A0',
  textMuted: 'rgba(241, 243, 246, 0.38)',
  textDim: 'rgba(241, 243, 246, 0.22)',
};

/**
 * Famílias carregadas em app/_layout.tsx. No React Native o peso vem da
 * família, não de fontWeight — por isso cada peso tem seu nome.
 */
export const fonts = {
  /** Display e interface. */
  regular: 'Chivo_400Regular',
  medium: 'Chivo_500Medium',
  semibold: 'Chivo_600SemiBold',
  bold: 'Chivo_700Bold',
  extrabold: 'Chivo_800ExtraBold',
  /** Só o wordmark da splash. */
  wordmark: 'Chivo_800ExtraBold_Italic',
  /** Números, tempos e distâncias. */
  monoRegular: 'RobotoMono_400Regular',
  monoMedium: 'RobotoMono_500Medium',
  monoSemibold: 'RobotoMono_600SemiBold',
};

export const typography = {
  /** Times de volta e outros números gigantes (tela live). */
  displayXL: { fontFamily: fonts.monoSemibold, fontSize: 84, letterSpacing: -3 },
  displayL: { fontFamily: fonts.monoSemibold, fontSize: 64, letterSpacing: -2 },
  displayM: { fontFamily: fonts.monoSemibold, fontSize: 44, letterSpacing: -1 },
  displayS: { fontFamily: fonts.extrabold, fontSize: 32, letterSpacing: -0.9 },

  /** Título de tela — Chivo 25/700, tracking −0,027em. */
  h1: { fontFamily: fonts.bold, fontSize: 25, letterSpacing: -0.68 },
  /** Título de seção — 21–22/700, −0,02em. */
  h2: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.44 },
  h3: { fontFamily: fonts.semibold, fontSize: 18, letterSpacing: -0.18 },

  bodyL: { fontFamily: fonts.regular, fontSize: 14.5 },
  body: { fontFamily: fonts.regular, fontSize: 14 },
  bodyS: { fontFamily: fonts.regular, fontSize: 13 },

  /** Nome de item de lista — 500, vira 600 quando selecionado. */
  item: { fontFamily: fonts.medium, fontSize: 15, letterSpacing: -0.15 },
  itemActive: { fontFamily: fonts.semibold, fontSize: 15, letterSpacing: -0.15 },

  label: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    letterSpacing: 0.9,
    textTransform: 'uppercase' as const,
  },
  labelL: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 1.08,
    textTransform: 'uppercase' as const,
  },

  /**
   * Para números. Todo número que atualiza em tempo real precisa disto: em
   * fonte proporcional o dígito muda de largura a cada leitura e empurra o
   * layout.
   */
  mono: {
    fontFamily: fonts.monoMedium,
    fontVariant: ['tabular-nums'] as ['tabular-nums'],
  },
};

/** Gutter de tela: 20. */
export const spacing = {
  xs: 4,
  s: 7,
  m: 12,
  l: 14,
  xl: 20,
  xxl: 26,
  xxxl: 32,
  huge: 48,
  /** Margem lateral padrão das telas. */
  gutter: 20,
};

export const radius = {
  /** Selo. */
  xs: 4,
  /** Campo e botão. */
  s: 9,
  m: 12,
  /** Superfície. */
  l: 14,
  /** Cartão e folha. */
  xl: 18,
  xxl: 18,
  pill: 99,
};

/**
 * O sistema não tem sombra: separação é feita com hairline. Os objetos
 * seguem exportados como no-op para as telas antigas continuarem compilando —
 * se alguma precisar mesmo de elevação, é uma decisão a tomar tela a tela.
 */
const noShadow = {
  shadowColor: 'transparent',
  shadowOpacity: 0,
  shadowRadius: 0,
  shadowOffset: { width: 0, height: 0 },
  elevation: 0,
};

export const shadows = {
  card: noShadow,
  cardHigh: noShadow,
  glow: noShadow,
  glowSoft: noShadow,
};

/** Gradientes pre-set pros splashes coloridos da arte do Copilot. */
export const gradients = {
  primarySplash: [colors.accentMagenta, colors.accentPurple, colors.accentCyan, colors.primary],
  cardGlow: ['rgba(212, 255, 58, 0.1)', 'rgba(212, 255, 58, 0)'],
  bottomFade: ['rgba(8,9,12,0)', 'rgba(8,9,12,0.85)', 'rgba(8,9,12,0.98)'],
  topFade: ['rgba(8,9,12,0.95)', 'rgba(8,9,12,0.4)', 'rgba(8,9,12,0)'],
};
