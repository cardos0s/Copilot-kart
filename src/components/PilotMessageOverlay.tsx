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

  // Ref pro onDismiss porque o parent re-renderiza a cada poll do GPS e
  // provavelmente não memoiza o handler. Sem ref, mudança de função
  // dispara re-run do effect e cancela o setTimeout.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  // Ref pro timer de dismiss em vez de variável local da closure. Permite
  // que o timer sobreviva às re-runs do effect (parent re-renderiza a
  // cada 500ms do poll do GPS). Sem isso o cleanup cancela o timer,
  // snapshot nunca é limpo, e texto fica fantasma sobre o HUD.
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => {
      setSnapshot(null);
      onDismissRef.current?.(msgId);
      dismissTimerRef.current = null;
    }, TOTAL_MS + 80);
    // SEM cleanup que cancela o timer — ele precisa sobreviver às re-runs.
    // Unmount real é tratado num useEffect separado abaixo.
  }, [message, progress]);

  // Cleanup no unmount real — evita setState em componente desmontado.
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));
  // Antes textStyle animava opacity do conteúdo. Removido: em Android,
  // dois useAnimatedStyle compartilhando o mesmo SharedValue em views
  // diferentes podem ter sync issues. O texto agora renderiza com
  // opacidade SÓLIDA (1) — a transição visual fica só no backdrop, que é
  // suficiente: o piloto vê a tela "ganhar cor" e o texto já chega
  // legível dentro dela.


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

      {/* ContentBox = View regular (não Animated). Sem animação no
       * conteúdo de texto — só o backdrop anima. Texto fica sempre
       * sólido pra evitar qualquer issue de animação no Android. */}
      <View style={s.contentBox}>
        <Text style={[s.kicker, { color: severityText(snapshot.severity) }]}>
          {severityKicker(snapshot.severity)}
        </Text>

        <Text
          numberOfLines={2}
          style={[s.bigText, { color: severityText(snapshot.severity) }]}
        >
          {snapshot.text.toUpperCase()}
        </Text>

        {snapshot.sentBy && (
          <View style={s.byPill}>
            <Text style={[s.byText, { color: severityText(snapshot.severity) }]}>
              {snapshot.sentBy}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // Sem zIndex/elevation — a ordem no JSX já garante que esse overlay
  // renderiza ACIMA do LapResultOverlay (vem depois dele no return).
  // elevation tinha potencial de criar artifacts de compositing no Android.
  absoluteFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // contentBox = mesmo posicionamento absoluto que o backdrop, mas com
  // alignItems/justifyContent pra centralizar texto. Não usa flex:1 porque
  // child flex:1 dentro de View position:absolute estava colapsando pra
  // height 0 em alguns layouts Android.
  contentBox: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  kicker: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 3,
    marginBottom: spacing.m,
    opacity: 0.85,
    textAlign: 'center',
  },
  bigText: {
    // fontWeight 800 em vez de 900 — alguns fontes do Android não têm peso
    // 900 e caem pra normal. 800 é mais portável.
    // letterSpacing 0 — qualquer valor negativo pode renderizar texto
    // colapsado em Android dependendo do font fallback.
    fontSize: 64,
    fontWeight: '800',
    letterSpacing: 0,
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
