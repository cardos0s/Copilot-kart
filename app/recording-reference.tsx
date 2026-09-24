import { useState, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, BackHandler, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import { useLapRecorder, GPS_START_ERROR } from '../src/hooks/useLapRecorder';
import { useLockLandscape } from '../src/hooks/useLockLandscape';
import { sqliteLayoutRepo } from '../src/storage/sessionRepo';
import { GpsSample } from '../src/lib/geometry';
import { normalizeId, saveReferenceLayout } from '../src/recording/finishSession';
import { UnresolvedRecordingError } from '../src/recording/journal';
import { EXIT_OPTIONS, exitGuard, type ExitAction, type ExitState } from '../src/recording/exitGuard';
import { journal } from '../src/recording/runtime';
import { CockpitDialog, type CockpitDialogAction } from '../src/components/CockpitDialog';
import { LapResultOverlay } from '../src/components/LapResultOverlay';
import { TrackSilhouette } from '../src/components/TrackSilhouette';
import { formatLapPlain as fmtLapPlain } from '../src/lib/format';
import { colors, fonts, spacing, radius, typography } from '../src/theme';

/** Falha ao salvar o traçado: o diário fica e a recuperação aparece na próxima abertura. */
const SAVE_LAYOUT_ERROR =
  'Não consegui salvar o traçado. Ele fica guardado e o app oferece recuperar na próxima abertura.';

type DialogState = {
  title: string;
  message?: string;
  actions: [CockpitDialogAction] | [CockpitDialogAction, CockpitDialogAction];
};

function fmtTime(ms: number) {
  const totalS = Math.floor(ms / 1000);
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtLap(ms: number) {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function accuracyLabel(acc: number) {
  if (acc === 0) return { text: 'Aguardando GPS', color: colors.textMuted };
  if (acc <= 5) return { text: `Excelente · ±${acc.toFixed(0)}m`, color: colors.primary };
  if (acc <= 10) return { text: `Bom · ±${acc.toFixed(0)}m`, color: colors.warning };
  return { text: `Ruim · ±${acc.toFixed(0)}m`, color: colors.danger };
}

/** Mini radar: desenha as amostras acumuladas normalizando no box */
function LiveRadar({ samples }: { samples: GpsSample[] }) {
  const size = 260;

  const path = useMemo(() => {
    if (samples.length < 2) return null;

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    for (const p of samples) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
    const dLat = maxLat - minLat || 0.0001;
    const dLng = maxLng - minLng || 0.0001;
    const padding = 20;
    const scaleX = (size - padding * 2) / dLng;
    const scaleY = (size - padding * 2) / dLat;
    const scale = Math.min(scaleX, scaleY);
    const offsetX = (size - dLng * scale) / 2;
    const offsetY = (size - dLat * scale) / 2;

    const toX = (lng: number) => (lng - minLng) * scale + offsetX;
    const toY = (lat: number) => size - ((lat - minLat) * scale + offsetY);

    const d = samples
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.lng).toFixed(1)} ${toY(p.lat).toFixed(1)}`)
      .join(' ');

    const last = samples[samples.length - 1];
    const first = samples[0];
    return {
      d,
      lastX: toX(last.lng),
      lastY: toY(last.lat),
      firstX: toX(first.lng),
      firstY: toY(first.lat),
    };
  }, [samples]);

  return (
    <View style={[radarStyles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Line x1={0} y1={size / 2} x2={size} y2={size / 2} stroke={colors.border} strokeWidth={0.5} />
        <Line x1={size / 2} y1={0} x2={size / 2} y2={size} stroke={colors.border} strokeWidth={0.5} />
        <Circle cx={size / 2} cy={size / 2} r={size / 2 - 4} stroke={colors.border} strokeWidth={0.5} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={size / 3} stroke={colors.border} strokeWidth={0.5} fill="none" />

        {path && (
          <>
            <Path
              d={path.d}
              stroke={colors.primary}
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Circle cx={path.firstX} cy={path.firstY} r={5} fill={colors.accentMagenta} />
            <Circle cx={path.lastX} cy={path.lastY} r={6} fill={colors.primary} stroke={colors.bg} strokeWidth={2} />
          </>
        )}
      </Svg>
    </View>
  );
}

/** Lado do quadro do traçado na coluna esquerda do cockpit. */
const TRACE_SIZE = 230;

export default function RecordingReference() {
  const params = useLocalSearchParams<{
    trackId: string;
    trackName: string;
    /** Nome do layout a criar (ex: "Layout curto"). Se ausente, usa "Layout principal". */
    layoutName?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Tela de cockpit (celular no suporte, deitado) — mesma trava do recording
  useLockLandscape();
  const [targetLaps, setTargetLaps] = useState(3);
  const [starting, setStarting] = useState(false);
  // Meta de voltas atingida: faixa na tela, sem toque; a gravação segue.
  const [targetReached, setTargetReached] = useState(false);
  // Diálogo in-app: a tela fica presa em paisagem, e o alerta nativo trava o iOS.
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [exitState, setExitState] = useState<ExitState>('recording');

  /**
   * Overlay de transição pós-reconhecimento. Quando setado, mostra
   * "Pista mapeada! Iniciando cronometragem em X..." e auto-navega pra
   * /recording após contagem. Driver continua no kart sem precisar tocar.
   */
  const [transition, setTransition] = useState<{
    lapsCount: number;
    bestMs: number;
    lengthM: number;
    /** Traçado recém-criado: a cronometragem compara contra ele (REC-11). */
    layoutId: string;
  } | null>(null);
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (!transition) return;
    setCountdown(5);
    const tick = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(tick);
          // Auto-navega quando chega a 0
          router.replace({
            pathname: '/recording',
            params: {
              trackId: params.trackId!,
              trackName: params.trackName!,
              layoutId: transition.layoutId,
            },
          });
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [transition, router, params.trackId, params.trackName]);

  const cancelTransition = () => {
    setTransition(null);
    router.replace('/');
  };

  const handleTargetReached = () => setTargetReached(true);

  const { state, info, liveSamples, start, stop } = useLapRecorder({
    targetLaps,
    onTargetReached: handleTargetReached,
  });

  const handleStart = async () => {
    setStarting(true);
    try {
      await start({
        meta: {
          mode: 'reference',
          trackId: normalizeId(params.trackId),
          trackName: params.trackName ?? 'Pista',
          layoutId: null,
          layoutName: params.layoutName?.trim() || null,
          kartSetupId: null,
        },
      });
    } catch (e: any) {
      if (e instanceof UnresolvedRecordingError) {
        // Gravação interrompida pendente: recuperar ou descartar antes (REC-13).
        setStarting(false);
        router.replace('/recovery' as any);
        return;
      }
      setDialog({
        title: 'ERRO',
        message: e?.message ?? GPS_START_ERROR,
        actions: [{ label: 'OK', variant: 'primary', onPress: () => setDialog(null) }],
      });
    }
    setStarting(false);
  };

  /** Diálogo de um botão só que sai para a home. */
  const leaveWith = (title: string, message: string) =>
    setDialog({
      title,
      message,
      actions: [
        {
          label: 'OK',
          variant: 'primary',
          onPress: () => {
            setDialog(null);
            router.replace('/');
          },
        },
      ],
    });

  const handleFinish = async () => {
    setDialog(null);
    // stop() agora entrega tudo pronto: samples completos, voltas já recortadas.
    // A fonte de verdade é a mesma que alimentou o modal — sem re-detecção.
    const recordingId = journal.recordingId ?? `rec_${Date.now()}`;
    const result = await stop();

    if (result.allSamples.length < 30) {
      await journal.end(recordingId).catch(() => {});
      leaveWith('POUCOS DADOS', 'Não consegui captar o suficiente pra detectar uma volta.');
      return;
    }

    if (result.laps.length === 0) {
      await journal.end(recordingId).catch(() => {});
      leaveWith(
        'NENHUMA VOLTA COMPLETA',
        'Não detectei nenhuma volta fechada. É preciso passar pela linha de largada pelo menos 2 vezes. Tenta de novo.'
      );
      return;
    }

    // Cria sempre um layout NOVO a partir da melhor volta (a primeira da
    // pista vira default). O id vem da gravação, então salvar de novo não
    // duplica. Só depois apaga o diário.
    let layout;
    try {
      layout = await saveReferenceLayout(
        {
          recordingId,
          trackId: params.trackId!,
          layoutName: params.layoutName,
          laps: result.laps,
          recordedAt: Date.now(),
        },
        sqliteLayoutRepo
      );
    } catch (e) {
      console.warn('[recording-reference] falha ao salvar o traçado:', e);
      leaveWith('ERRO AO SALVAR', SAVE_LAYOUT_ERROR);
      return;
    }
    await journal
      .end(recordingId)
      .catch((e) => console.warn('[recording-reference] journal.end:', e));

    // Em vez de diálogo bloqueante, dispara o overlay de countdown — driver
    // ainda tá no kart, então auto-transição pra cronometragem é a default.
    // 5s de janela pra cancelar caso queira parar/pit.
    setTransition({
      lapsCount: result.laps.length,
      bestMs: layout.durationMs,
      lengthM: layout.lengthM,
      layoutId: layout.id,
    });
  };

  const handleFinishConfirm = () => {
    setDialog({
      title: 'ENCERRAR RECONHECIMENTO?',
      message: `Detectei ${info.lapsCompleted} volta(s) completa(s) até agora.`,
      actions: [
        { label: 'Encerrar', variant: 'destructive', onPress: handleFinish },
        { label: 'Continuar gravando', variant: 'secondary', onPress: () => setDialog(null) },
      ],
    });
  };

  /** "Descartar" na confirmação de saída: para o GPS, apaga o diário e sai. */
  const discardRecording = async () => {
    const recordingId = journal.recordingId;
    await stop();
    if (recordingId) await journal.end(recordingId).catch(() => {});
    router.replace('/');
  };

  const dispatchExit = (action: ExitAction) => {
    const r = exitGuard(exitState, action);
    setExitState(r.state);
    if (r.effect === 'finish') handleFinish();
    else if (r.effect === 'discard') discardRecording();
  };

  const handleCancel = () => {
    if (state === 'recording') {
      dispatchExit('requestExit');
    } else {
      router.replace('/');
    }
  };

  // Botão voltar do Android: gravando, abre a confirmação; saindo ou
  // salvando, não faz nada. No idle, segue o comportamento padrão.
  useEffect(() => {
    if (state === 'idle') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (state === 'recording') dispatchExit('requestExit');
      return true;
    });
    return () => sub.remove();
  }, [state, exitState]);

  const acc = accuracyLabel(info.lastAccuracy);
  const progress = Math.min(1, info.lapsCompleted / targetLaps);

  const lapMs = info.currentLapElapsedMs;

  return (
    <View style={[s.container, { paddingLeft: insets.left + spacing.xxl, paddingRight: insets.right + spacing.xxl }]}>
      {state === 'idle' ? (
        <View style={s.idle}>
          <Text style={s.idleTitle}>Gravar o traçado</Text>
          <Text style={s.idleSub}>{params.trackName}</Text>

          <Text style={s.idleLapsLabel}>QUANTAS VOLTAS?</Text>
          <View style={s.idleLapsRow}>
            {[2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                onPress={() => setTargetLaps(n)}
                style={({ pressed }) => [
                  s.idleChip,
                  targetLaps === n && s.idleChipActive,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[s.idleChipText, targetLaps === n && s.idleChipTextActive]}>{n}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.idleHint}>
            Ritmo constante na linha que você usaria. Não precisa ser rápido — precisa ser a
            trajetória certa.
          </Text>

          <View style={s.idleActions}>
            <Pressable
              onPress={handleStart}
              disabled={starting}
              style={({ pressed }) => [s.cockpitCta, (pressed || starting) && { opacity: 0.85 }]}
            >
              <Text style={s.cockpitCtaText}>{starting ? 'Abrindo GPS…' : 'Começar'}</Text>
            </Pressable>
            <Pressable onPress={handleCancel} hitSlop={10}>
              <Text style={s.idleGhostText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={s.cockpit}>
          <Text style={s.recLabel}>
            <Text style={s.recDot}>● </Text>
            GRAVANDO O TRAÇADO
          </Text>

          <View style={s.cockpitRow}>
            {/* O traçado vai se desenhando conforme ele anda — é o retorno de
                que o reconhecimento está pegando alguma coisa. */}
            <View style={s.traceCol}>
              {liveSamples.length > 4 ? (
                <TrackSilhouette
                  samples={liveSamples}
                  width={TRACE_SIZE}
                  height={TRACE_SIZE * 0.82}
                  strokeColor={colors.blue}
                  strokeWidth={3}
                />
              ) : (
                <Text style={s.traceWaiting}>procurando o sinal…</Text>
              )}
            </View>

            <View style={s.cockpitDivider} />

            <View style={s.dataCol}>
              <View style={s.dataTop}>
                <View style={s.dataBlock}>
                  <Text style={s.dataLabel}>TEMPO DA VOLTA</Text>
                  <Text style={s.dataValue} numberOfLines={1} adjustsFontSizeToFit>
                    {lapMs != null ? fmtLapPlain(lapMs) : '—'}
                  </Text>
                </View>
                <View style={s.dataRule} />
                <View style={s.dataBlock}>
                  <Text style={s.dataLabel}>VELOCIDADE</Text>
                  <Text style={s.dataValue} numberOfLines={1} adjustsFontSizeToFit>
                    {info.lastSpeedKmh.toFixed(1).replace('.', ',')}
                    <Text style={s.dataUnit}> km/h</Text>
                  </Text>
                </View>
              </View>

              <View style={s.dataSplit} />

              <Text style={s.dataLabel}>VOLTAS</Text>
              <View style={s.lapsBottom}>
                <Text style={s.lapCount}>
                  {info.lapsCompleted}
                  <Text style={s.lapCountOf}> de {targetLaps}</Text>
                </Text>

                <View style={s.segments}>
                  {Array.from({ length: targetLaps }, (_, n) => (
                    <View key={n} style={[s.segment, n < info.lapsCompleted && s.segmentDone]} />
                  ))}
                </View>

                <Text style={s.lapHint} numberOfLines={2}>
                  Ritmo constante na linha que você usaria
                </Text>

                <Pressable
                  onPress={handleCancel}
                  style={({ pressed }) => [s.cancelBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={s.cancelText}>Cancelar</Text>
                </Pressable>
              </View>

              {info.lapsCompleted > 0 && (
                <Pressable
                  onPress={handleFinishConfirm}
                  style={({ pressed }) => [s.finishLink, pressed && { opacity: 0.6 }]}
                >
                  <Text style={s.finishLinkText}>Encerrar e salvar traçado</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      )}

      {/* Overlay de celebração por volta completada — verde 3s. Não tem
       * delta aqui (estamos GRAVANDO a referência, não comparando contra
       * uma). Mostra "L 2/3 ✓" + tempo. Quando fecha a última volta do
       * target, exibe o banner "REFERÊNCIA PRONTA" (igual conceito do
       * "NOVA MELHOR VOLTA" da tela de race). */}
      <LapResultOverlay
        result={
          info.lastClosedLap
            ? {
                variant: 'reference',
                lapNumber: info.lastClosedLap.lapNumber,
                totalLaps: targetLaps,
                durationMs: info.lastClosedLap.durationMs,
              }
            : null
        }
      />

      {/* Meta atingida: faixa que não pede toque; a gravação segue até o
          piloto encerrar (REC-08, AC 2). */}
      {targetReached && state === 'recording' && !transition && (
        <View pointerEvents="none" style={[s.targetBanner, { top: insets.top + spacing.s }]}>
          <Text style={s.targetBannerText}>
            META ATINGIDA · {info.lapsCompleted} volta(s). Siga gravando ou encerre quando quiser.
          </Text>
        </View>
      )}

      {/* Overlay de transição auto pra cronometragem */}
      {transition && (
        <View style={s.transitionOverlay}>
          <View style={s.transitionCard}>
            <Text style={s.transitionEmoji}>🏁</Text>
            <Text style={s.transitionTitle}>PISTA MAPEADA</Text>
            <Text style={s.transitionMeta}>
              {transition.lapsCount} volta(s) · melhor {fmtLap(transition.bestMs)} ·{' '}
              {transition.lengthM.toFixed(0)}m
            </Text>
            <Text style={s.transitionMessage}>
              Iniciando cronometragem em
            </Text>
            <Text style={s.transitionCountdown}>{countdown}</Text>
            <Text style={s.transitionHint}>
              Continue dirigindo — vamos comparar suas voltas com essa referência
            </Text>
            <Pressable
              onPress={cancelTransition}
              style={({ pressed }) => [s.transitionCancel, pressed && { opacity: 0.6 }]}
            >
              <Text style={s.transitionCancelText}>Não, vou parar</Text>
            </Pressable>
          </View>
        </View>
      )}

      <CockpitDialog
        visible={exitState === 'confirming'}
        title="SAIR DO RECONHECIMENTO?"
        message={`${info.lapsCompleted} volta(s) completa(s) até agora.`}
        actions={[
          { ...EXIT_OPTIONS[0], onPress: () => dispatchExit(EXIT_OPTIONS[0].action) },
          { ...EXIT_OPTIONS[1], onPress: () => dispatchExit(EXIT_OPTIONS[1].action) },
          { ...EXIT_OPTIONS[2], onPress: () => dispatchExit(EXIT_OPTIONS[2].action) },
        ]}
      />
      {dialog && (
        <CockpitDialog visible title={dialog.title} message={dialog.message} actions={dialog.actions} />
      )}
    </View>
  );
}

function Stat({ label, value, unit, mono }: { label: string; value: string; unit?: string; mono?: boolean }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <View style={s.statValueRow}>
        <Text style={[s.statValue, mono && typography.mono]}>{value}</Text>
        {unit && <Text style={s.statUnit}>{unit}</Text>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // ── cockpit de gravação (paisagem) ──────────────────────────────
  // Número grosso em tudo: o piloto lê isso de relance, com o celular no
  // suporte e o kart andando.
  cockpit: { flex: 1, paddingVertical: spacing.xl },
  recLabel: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.4, color: colors.muted },
  recDot: { color: colors.danger },
  cockpitRow: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  traceCol: { width: TRACE_SIZE, alignItems: 'center', justifyContent: 'center' },
  traceWaiting: { fontFamily: fonts.regular, fontSize: 14, color: colors.dim, textAlign: 'center' },
  cockpitDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.line,
    marginHorizontal: spacing.xxl,
    marginVertical: spacing.l,
  },
  dataCol: { flex: 1, justifyContent: 'center' },
  dataTop: { flexDirection: 'row', alignItems: 'flex-start' },
  dataBlock: { flex: 1 },
  dataRule: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.line,
    marginHorizontal: spacing.xl,
  },
  dataLabel: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 1.3, color: colors.muted },
  dataValue: {
    fontFamily: fonts.monoSemibold,
    fontSize: 62,
    lineHeight: 70,
    letterSpacing: -1.5,
    color: colors.text,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  dataUnit: { fontFamily: fonts.semibold, fontSize: 18, color: colors.muted },
  dataSplit: { height: 1, backgroundColor: colors.line, marginVertical: spacing.xl },
  lapsBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.l, marginTop: 6 },
  lapCount: {
    fontFamily: fonts.monoSemibold,
    fontSize: 40,
    lineHeight: 46,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  lapCountOf: { fontFamily: fonts.semibold, fontSize: 17, color: colors.muted },
  segments: { flexDirection: 'row', gap: 6 },
  segment: { width: 34, height: 5, borderRadius: radius.pill, backgroundColor: colors.surfaceRail },
  segmentDone: { backgroundColor: colors.blue },
  lapHint: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 19,
    color: colors.muted,
    textAlign: 'right',
  },
  cancelBtn: {
    height: 48,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.line2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  finishLink: { marginTop: spacing.l, alignSelf: 'flex-start' },
  finishLinkText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.blueSoft },

  // ── antes de começar ────────────────────────────────────────────
  idle: { flex: 1, justifyContent: 'center' },
  idleTitle: { fontFamily: fonts.bold, fontSize: 30, letterSpacing: -0.8, color: colors.text },
  idleSub: { fontFamily: fonts.regular, fontSize: 16, color: colors.muted, marginTop: 4 },
  idleLapsLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 1.3,
    color: colors.muted,
    marginTop: spacing.xxl,
  },
  idleLapsRow: { flexDirection: 'row', gap: spacing.m, marginTop: spacing.m },
  idleChip: {
    width: 60,
    height: 52,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idleChipActive: { backgroundColor: colors.blue },
  idleChipText: { fontFamily: fonts.monoSemibold, fontSize: 20, color: colors.muted },
  idleChipTextActive: { color: colors.textOnPrimary },
  idleHint: {
    fontFamily: fonts.regular,
    fontSize: 14.5,
    lineHeight: 20,
    color: colors.dim,
    marginTop: spacing.l,
    maxWidth: 460,
  },
  idleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxl,
    marginTop: spacing.xxl,
  },
  cockpitCta: {
    height: 56,
    paddingHorizontal: 46,
    borderRadius: radius.m,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cockpitCtaText: { fontFamily: fonts.bold, fontSize: 18, color: colors.textOnPrimary },
  idleGhostText: { fontFamily: fonts.regular, fontSize: 16, color: colors.muted },

  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.l,
  },
  close: { color: colors.textSecondary, fontSize: 22, fontWeight: '400' },
  step: { color: colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  scroll: { paddingHorizontal: spacing.xl },

  trackName: { color: colors.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  instruction: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.s, lineHeight: 20 },

  lapsPicker: {
    marginTop: spacing.xxl,
    padding: spacing.l,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lapsLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  lapsRow: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.m },
  lapsChip: {
    flex: 1,
    paddingVertical: spacing.m,
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
  },
  lapsChipActive: { borderColor: colors.primary, backgroundColor: 'rgba(0,255,136,0.08)' },
  lapsText: { color: colors.textSecondary, fontSize: 20, fontWeight: '800' },
  lapsTextActive: { color: colors.primary },
  lapsHint: { color: colors.textMuted, fontSize: 12, marginTop: spacing.m, lineHeight: 18 },

  radarBox: { marginTop: spacing.l, alignItems: 'center', position: 'relative' },
  radarEmpty: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 260,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  radarEmptyTitle: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  radarEmptyText: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.xs,
    lineHeight: 16,
  },

  lapProgress: { marginTop: spacing.l },
  lapProgressLabels: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  lapProgressCount: { color: colors.primary, fontSize: 28, fontWeight: '900', ...typography.mono },
  lapProgressLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  lapProgressBar: {
    height: 6,
    backgroundColor: colors.bgElevated,
    borderRadius: 3,
    marginTop: spacing.s,
    overflow: 'hidden',
  },
  lapProgressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 3 },
  bestLapText: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.s, fontWeight: '500' },
  bestLapValue: { color: colors.primary, fontWeight: '800', ...typography.mono },

  statsGrid: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.l },
  stat: {
    flex: 1,
    padding: spacing.m,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4, gap: 4 },
  statValue: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  statUnit: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },

  accBox: {
    marginTop: spacing.m,
    padding: spacing.m,
    borderRadius: radius.m,
    backgroundColor: colors.bgElevated,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  accLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  accValue: { fontSize: 14, fontWeight: '700', marginTop: 2 },

  movingBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center', marginTop: spacing.m },
  movingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  movingText: { color: colors.primary, fontSize: 13, fontWeight: '700' },

  footer: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.m,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    backgroundColor: colors.primary,
    borderRadius: radius.l,
  },
  primaryText: { color: colors.textOnPrimary, fontSize: 16, fontWeight: '800' },
  primaryArrow: { color: colors.textOnPrimary, fontSize: 20, fontWeight: '800' },
  finishBtn: { paddingVertical: 16, backgroundColor: colors.danger, borderRadius: radius.l, alignItems: 'center' },
  finishText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  benchBanner: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.m,
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.m,
    backgroundColor: colors.danger,
    borderRadius: radius.m,
    alignItems: 'center',
  },
  benchBannerText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },

  /* Transition overlay (auto -> cronometragem) */
  targetBanner: {
    position: 'absolute',
    left: spacing.xxl,
    right: spacing.xxl,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: radius.m,
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.l,
    alignItems: 'center',
  },
  targetBannerText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    letterSpacing: 0.6,
    color: colors.success,
    textAlign: 'center',
  },
  transitionOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  transitionCard: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    padding: spacing.xxl,
    borderRadius: radius.l,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  transitionEmoji: { fontSize: 48, marginBottom: spacing.s },
  transitionTitle: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2,
  },
  transitionMeta: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
  transitionMessage: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    marginTop: spacing.l,
  },
  transitionCountdown: {
    color: colors.primary,
    fontSize: 96,
    fontWeight: '900',
    letterSpacing: -4,
    lineHeight: 110,
    ...typography.mono,
  },
  transitionHint: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.s,
    fontWeight: '500',
  },
  transitionCancel: {
    marginTop: spacing.l,
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.l,
  },
  transitionCancelText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
  },
});

const radarStyles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
  },
});