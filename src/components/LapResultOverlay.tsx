/**
 * Overlay animado que aparece sobre o HUD de gravação quando uma volta fecha.
 *
 * Substitui o "flash" abrupto por uma transição com curva ease:
 *   - 0ms  → 400ms : fade-in do fundo (preto → verde/vermelho), delta
 *                    sobe de scale 0.85 com fade 0→1, pill desliza 12px
 *                    de baixo pra cima.
 *   - 400ms → 2600ms : hold (~2.2s). Tudo parado, piloto lê.
 *   - 2600ms → 3000ms : fade-out inverso (cor → preto, delta encolhe
 *                       e some, pill desce).
 *
 * Total ~3s. O componente captura o `result` em estado local quando
 * lapNumber muda, então roda a animação inteira independente do prop
 * voltar a null antes do fim (e o hook só expõe lastClosedLap por ~1s).
 *
 * Duas variantes:
 *   - 'race': mostra delta gigante (verde se ganhou, vermelho se perdeu),
 *             banner "★ NOVA MELHOR VOLTA ★" quando isPb, pill com nº da
 *             volta + tempo. Usado na tela de cronometragem.
 *   - 'reference': sempre verde, mostra "L N/TOTAL  ✓" gigante + pill
 *             com tempo da volta. Usado na tela de reconhecimento, onde
 *             não há referência pra comparar — celebra o progresso.
 *
 * Performance: animações rodam todas em useNativeDriver (transform +
 * opacity). Não bloqueia a JS thread que tá processando samples GPS no
 * background.
 */

import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, spacing, typography } from '../theme';

const FADE_IN_MS = 400;
const HOLD_MS = 2200;
const FADE_OUT_MS = 400;
const TOTAL_MS = FADE_IN_MS + HOLD_MS + FADE_OUT_MS;

type RaceResult = {
  variant: 'race';
  lapNumber: number;
  durationMs: number;
  /** null = 1ª volta sem referência prévia. */
  deltaVsRefMs: number | null;
  isPb: boolean;
};

type ReferenceResult = {
  variant: 'reference';
  lapNumber: number;
  totalLaps: number;
  durationMs: number;
};

export type LapResultOverlayProps = {
  /** Quando muda (lapNumber diferente do último visto), dispara a animação.
   *  Pode voltar a null antes da animação terminar — overlay segue mostrando
   *  o snapshot local até o fim do ciclo. */
  result: RaceResult | ReferenceResult | null;
};

function fmtLap(ms: number): string {
  const totalS = ms / 1000;
  if (totalS < 60) return totalS.toFixed(3);
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function fmtDelta(ms: number): string {
  const sign = ms >= 0 ? '+' : '−'; // U+2212 minus, mesma largura do +
  const abs = Math.abs(ms / 1000);
  return `${sign}${abs.toFixed(3)}`;
}

export function LapResultOverlay({ result }: LapResultOverlayProps) {
  /**
   * Snapshot local — capturamos `result` quando o lapNumber muda, e a UI
   * lê SEMPRE daqui (não do prop). Garante que se o prop voltar a null
   * no meio da animação, o conteúdo não some.
   */
  const [snapshot, setSnapshot] = useState<RaceResult | ReferenceResult | null>(null);
  const lastSeenLapRef = useRef<number | null>(null);

  // Master progress 0 → 1, dirige todas as transforms via interpolate.
  // Trajetória: 0 → 1 em FADE_IN, hold em 1, 1 → 0 em FADE_OUT.
  const progress = useSharedValue(0);

  // Ref pra ID do timeout em vez de variável local na closure do effect.
  // Permite que o timeout sobreviva quando o effect re-roda por re-render
  // do parent (que acontece a cada 500ms do poll do GPS no recording.tsx).
  // Sem isso: 1ª run agenda timeout → 2ª run cleanup cancela → snapshot
  // fica preso visível pra sempre.
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!result) return;
    // Mesmo lapNumber → já animamos esse, ignora (re-render por outro motivo).
    if (lastSeenLapRef.current === result.lapNumber) return;
    lastSeenLapRef.current = result.lapNumber;

    setSnapshot(result);
    progress.value = 0;
    progress.value = withSequence(
      withTiming(1, { duration: FADE_IN_MS, easing: Easing.out(Easing.cubic) }),
      withDelay(
        HOLD_MS,
        withTiming(0, { duration: FADE_OUT_MS, easing: Easing.in(Easing.cubic) })
      )
    );
    // Limpa timeout anterior se ainda tava pending (caso raro: nova volta
    // antes da animação da anterior terminar). Daí agenda o novo.
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => {
      setSnapshot(null);
      dismissTimerRef.current = null;
    }, TOTAL_MS + 80);
    // SEM cleanup que cancela o timer — o timer precisa sobreviver às
    // re-runs do effect causadas por re-renders do parent. Só limpa em
    // unmount real do componente (handled abaixo num useEffect separado).
  }, [result, progress]);

  // Cleanup no unmount — cancela timeout pendente pra não chamar setState
  // num componente desmontado (warning do RN).
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  // === Estilos animados ===
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  const deltaStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      // Sobe de 0.85 → 1.0 enquanto entra; mantém 1.0 no hold; 1.0 → 0.92 na saída.
      // Como progress vai 0→1→0, interpolate cobre só a entrada. Pra saída
      // a escala 1→0.92 acontece naturalmente porque progress volta a cair.
      { scale: interpolate(progress.value, [0, 1], [0.85, 1.0]) },
    ],
  }));

  const pillStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      // Translada 12px de baixo pra cima na entrada (progress 0→1 → translateY 12→0).
      { translateY: interpolate(progress.value, [0, 1], [12, 0]) },
    ],
  }));

  const bannerStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: interpolate(progress.value, [0, 1], [-8, 0]) }],
  }));

  if (!snapshot) return null;

  // ====== Decide cor + conteúdo conforme variante ======
  let bgColor: string;
  let centerNumber: string;
  let centerColor: string;
  let banner: string | null = null;
  let pillText: string;

  if (snapshot.variant === 'race') {
    // Cor segue o SINAL do delta. Quando não há delta (1ª volta), assume
    // verde porque toda 1ª volta vira PB automaticamente.
    const isGreen =
      snapshot.deltaVsRefMs === null || snapshot.deltaVsRefMs <= 0;
    bgColor = isGreen ? colors.success : colors.danger;
    centerColor = isGreen ? '#08090C' : colors.textPrimary;
    // Sem delta na 1ª volta: mostra só o tempo gigante (não temos contra o
    // que comparar). Senão, mostra o delta gigante.
    centerNumber =
      snapshot.deltaVsRefMs === null
        ? fmtLap(snapshot.durationMs)
        : fmtDelta(snapshot.deltaVsRefMs);
    if (snapshot.isPb) banner = '★  NOVA MELHOR VOLTA  ★';
    pillText = `L ${snapshot.lapNumber}  ${fmtLap(snapshot.durationMs)}`;
  } else {
    // 'reference' — sempre verde, mostra progresso "N/TOTAL" como destaque.
    bgColor = colors.success;
    centerColor = '#08090C';
    centerNumber = `L ${snapshot.lapNumber}/${snapshot.totalLaps}  ✓`;
    banner = snapshot.lapNumber >= snapshot.totalLaps ? '★  REFERÊNCIA PRONTA  ★' : null;
    pillText = fmtLap(snapshot.durationMs);
  }

  return (
    <View pointerEvents="none" style={s.absoluteFill}>
      {/* Backdrop colorido — sólido, fade-in/out via opacity (native driver) */}
      <Animated.View
        style={[
          s.absoluteFill,
          { backgroundColor: bgColor },
          backdropStyle,
        ]}
      />

      {/* Conteúdo central */}
      <View style={s.contentBox}>
        {banner && (
          <Animated.Text style={[s.banner, { color: centerColor }, bannerStyle]}>
            {banner}
          </Animated.Text>
        )}

        <Animated.Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[
            s.centerNumber,
            typography.mono,
            { color: centerColor },
            deltaStyle,
          ]}
        >
          {centerNumber}
        </Animated.Text>

        <Animated.View style={[s.pill, pillStyle]}>
          <Text style={[s.pillText, typography.mono]}>{pillText}</Text>
        </Animated.View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  absoluteFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  contentBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  banner: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: spacing.m,
    textAlign: 'center',
  },
  centerNumber: {
    // Tamanho grande mas com adjustsFontSizeToFit pra encolher se passar
    // do width. Em landscape (uso esperado) cabe 6-7 chars facilmente.
    fontSize: 140,
    fontWeight: '900',
    letterSpacing: -4,
    includeFontPadding: false,
    textAlign: 'center',
  },
  pill: {
    marginTop: spacing.l,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.s,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(8, 9, 12, 0.85)',
  },
  pillText: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
