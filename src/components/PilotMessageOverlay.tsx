/**
 * Overlay full-screen que aparece pro piloto quando a equipe manda uma
 * mensagem (BOA VOLTA, SETOR 2 LENTO, BOX AGORA, etc).
 *
 * Princípio: piloto está no cockpit a 60cm da tela, com capacete e
 * provavelmente em movimento. Mensagem precisa ser:
 *   1. Visível na visão periférica (cor sólida full-screen)
 *   2. Legível em <1s (1-3 palavras, fonte enorme)
 *   3. Auto-dismiss (piloto não pode interagir com a tela)
 *
 * Cores por severidade (espelham o estilo das 3 imagens de referência):
 *   - info     → verde sólido, texto preto. Feedback positivo (BOA VOLTA)
 *   - warning  → amarelo, texto preto. Atenção (SETOR 2 LENTO)
 *   - critical → vermelho, texto branco. Comando urgente (BOX AGORA)
 *
 * Animação: fade-in 250ms (mais rápido que o LapResult overlay porque
 * é interrupção do box — precisa chegar logo) + hold 4.5s + fade-out
 * 250ms. Total ~5s.
 *
 * Stacking: vem POR CIMA do LapResultOverlay (que tem zIndex 0). Se o
 * box manda mensagem durante a celebração de volta, a mensagem ganha
 * (prioridade humana > celebração).
 *
 * Threading: animação no native driver (transform + opacity), não trava
 * o JS thread que está processando GPS samples + delta.
 */

import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, spacing, typography } from '../theme';
import type { LiveMessage } from '../lib/liveSession';

const FADE_IN_MS = 250;
const HOLD_MS = 4500;
const FADE_OUT_MS = 250;
const TOTAL_MS = FADE_IN_MS + HOLD_MS + FADE_OUT_MS;

export type PilotMessageOverlayProps = {
  /** Mensagem atual a exibir. Se mudar (`id` diferente), dispara animação.
   *  Pode voltar a null antes do fim — overlay segue até completar 5s. */
  message: LiveMessage | null;
  /** Chamado quando o overlay TERMINA a animação. Caller pode usar pra
   *  marcar a mensagem como acked no backend. */
  onDismiss?: (msgId: number) => void;
};

function severityBg(sev: LiveMessage['severity']): string {
  switch (sev) {
    case 'info':
      return colors.success;
    case 'warning':
      return colors.warning;
    case 'critical':
      return colors.danger;
  }
}

function severityText(sev: LiveMessage['severity']): string {
  // Em vermelho/critical o texto branco contrasta melhor; nos outros 2,
  // texto preto fica mais legível no fundo claro.
  return sev === 'critical' ? colors.textPrimary : '#08080C';
}

function severityKicker(sev: LiveMessage['severity']): string {
  switch (sev) {
    case 'info':
      return '★  COACH  ★';
    case 'warning':
      return '⚠  ATENÇÃO  ⚠';
    case 'critical':
      return '!  CRÍTICO  !';
  }
}

export function PilotMessageOverlay({ message, onDismiss }: PilotMessageOverlayProps) {
  const [snapshot, setSnapshot] = useState<LiveMessage | null>(null);
  const lastSeenIdRef = useRef<number | null>(null);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!message) return;
    if (lastSeenIdRef.current === message.id) return; // mesma msg, ignora
    lastSeenIdRef.current = message.id;
    const msgId = message.id;

    setSnapshot(message);
    progress.value = 0;
    progress.value = withSequence(
      withTiming(1, { duration: FADE_IN_MS, easing: Easing.out(Easing.cubic) }),
      withDelay(
        HOLD_MS,
        withTiming(0, { duration: FADE_OUT_MS, easing: Easing.in(Easing.cubic) })
      )
    );

    const t = setTimeout(() => {
      setSnapshot(null);
      onDismiss?.(msgId);
    }, TOTAL_MS + 80);
    return () => clearTimeout(t);
  }, [message, onDismiss, progress]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      // Sobe de 0.92 → 1.0 na entrada (escala). Sem rotate ou bounce —
      // piloto não precisa de spectacle, precisa LER.
      {
        scale: 0.92 + progress.value * 0.08,
      },
    ],
  }));

  if (!snapshot) return null;

  return (
    <View pointerEvents="none" style={s.absoluteFill}>
      <Animated.View
        style={[
          s.absoluteFill,
          { backgroundColor: severityBg(snapshot.severity) },
          backdropStyle,
        ]}
      />

      <View style={s.contentBox}>
        <Animated.Text
          style={[
            s.kicker,
            { color: severityText(snapshot.severity) },
            textStyle,
          ]}
        >
          {severityKicker(snapshot.severity)}
        </Animated.Text>

        <Animated.Text
          numberOfLines={2}
          adjustsFontSizeToFit
          style={[
            s.bigText,
            typography.mono,
            { color: severityText(snapshot.severity) },
            textStyle,
          ]}
        >
          {snapshot.text.toUpperCase()}
        </Animated.Text>

        {snapshot.sentBy && (
          <Animated.View style={[s.byPill, textStyle]}>
            <Text style={[s.byText, { color: severityText(snapshot.severity) }]}>
              {snapshot.sentBy}
            </Text>
          </Animated.View>
        )}
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
    // zIndex 10 = vai por cima do LapResultOverlay (sem zIndex = 0).
    // Mensagem da equipe é mais importante que celebração automática.
    zIndex: 10,
    elevation: 10,
  },
  contentBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  kicker: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 4,
    marginBottom: spacing.m,
    opacity: 0.85,
  },
  bigText: {
    fontSize: 110,
    fontWeight: '900',
    letterSpacing: -4,
    textAlign: 'center',
    includeFontPadding: false,
  },
  byPill: {
    marginTop: spacing.l,
    paddingHorizontal: spacing.m,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(8, 8, 12, 0.18)',
  },
  byText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
});
