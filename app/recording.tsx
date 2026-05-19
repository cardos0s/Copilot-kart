import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  Vibration,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLapRecorder, RecordedLap } from '../src/hooks/useLapRecorder';
import { useLockLandscape } from '../src/hooks/useLockLandscape';
import {
  saveLap,
  createSession,
  getTrackReference,
  saveTrackReference,
  TrackReference,
} from '../src/storage/db';
import { polylineLength } from '../src/lib/geometry';
import { LapRecord } from '../src/lib/analysis';
import { Button, Card, Icon } from '../src/components/ui';
import { colors, radius, spacing, typography } from '../src/theme';

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
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

function fmtDelta(ms: number) {
  const sign = ms >= 0 ? '+' : '-';
  const abs = Math.abs(ms / 1000);
  return `${sign}${abs.toFixed(3)}`;
}

function accuracyLabel(acc: number) {
  if (acc === 0) return { text: 'GPS', color: colors.textMuted };
  if (acc <= 5) return { text: `±${acc.toFixed(0)}m`, color: colors.success };
  if (acc <= 10) return { text: `±${acc.toFixed(0)}m`, color: colors.warning };
  return { text: `±${acc.toFixed(0)}m`, color: colors.danger };
}

function toLapRecord(lap: RecordedLap, sessionId: string, index: number): LapRecord {
  return {
    id: `${sessionId}_lap_${index + 1}`,
    sessionId,
    samples: lap.samples,
    startedAt: lap.startedAt,
    durationMs: lap.durationMs,
  };
}

export default function Recording() {
  const params = useLocalSearchParams<{ trackId: string; trackName: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Trava o device em landscape — pra esta tela é o uso esperado.
  useLockLandscape();

  const [starting, setStarting] = useState(false);
  const [reference, setReference] = useState<TrackReference | null>(null);
  const [idlePrompt, setIdlePrompt] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleDismissedRef = useRef(false);
  const { state, info, start, stop } = useLapRecorder();

  useEffect(() => {
    if (params.trackId) {
      getTrackReference(params.trackId).then(setReference);
    }
  }, [params.trackId]);

  /**
   * Idle detection — quando o piloto encosta no box, fica parado e quer
   * encerrar sem precisar tirar o celular do macacão. Após 30s sem movimento
   * (e pelo menos 1 volta completa), vibramos e mostramos um banner gigante
   * "Encerrar?" no centro da tela. Tap único = encerra.
   */
  useEffect(() => {
    if (state !== 'recording' || idleDismissedRef.current) return;
    if (info.isMoving) {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      setIdlePrompt(false);
      return;
    }
    // Parado — agenda prompt se ainda não agendou
    if (info.lapsCompleted >= 1 && !idleTimerRef.current) {
      idleTimerRef.current = setTimeout(() => {
        Vibration.vibrate([0, 400, 200, 400]);
        setIdlePrompt(true);
        idleTimerRef.current = null;
      }, 30_000);
    }
    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [info.isMoving, info.lapsCompleted, state]);

  const handleDismissIdle = () => {
    setIdlePrompt(false);
    // Suprime o prompt até o piloto voltar a se mover (evita spam)
    idleDismissedRef.current = true;
  };

  // Reset do flag de "dispensado" quando volta a se mover
  useEffect(() => {
    if (info.isMoving) {
      idleDismissedRef.current = false;
    }
  }, [info.isMoving]);

  const handleStart = async () => {
    setStarting(true);
    try {
      await start();
    } catch (e: any) {
      Alert.alert('Erro', e.message ?? 'Falha ao iniciar GPS');
    }
    setStarting(false);
  };

  const handleFinish = () => {
    Alert.alert(
      'Encerrar sessão?',
      `Vamos processar ${info.lapsCompleted} volta(s) e mostrar a análise.`,
      [
        { text: 'Continuar', style: 'cancel' },
        {
          text: 'Encerrar',
          style: 'destructive',
          onPress: async () => {
            const result = await stop();

            if (result.allSamples.length < 30) {
              Alert.alert('Poucos dados', 'Não deu tempo de captar dados suficientes.');
              router.replace('/');
              return;
            }

            const session = await createSession({
              trackName: params.trackName ?? 'Pista',
              kart: null,
              notes: null,
              weather: 'dry',
              trackId: params.trackId ?? null,
              mode: 'race',
            });

            const lapsToSave: LapRecord[] = result.laps.map((lap, i) =>
              toLapRecord(lap, session.id, i)
            );
            for (const lap of lapsToSave) {
              await saveLap(lap);
            }

            if (lapsToSave.length === 0) {
              Alert.alert(
                'Nenhuma volta completa',
                'Não detectei voltas fechadas nessa sessão.',
                [{ text: 'OK', onPress: () => router.replace(`/session/${session.id}`) }]
              );
              return;
            }

            const best = lapsToSave.reduce(
              (b, l) => (l.durationMs < b.durationMs ? l : b),
              lapsToSave[0]
            );

            if (reference && best.durationMs < reference.durationMs) {
              Alert.alert(
                'Nova melhor volta! 🏆',
                `Você fez ${fmtLap(best.durationMs)} (referência atual: ${fmtLap(reference.durationMs)}).\n\nQuer atualizar a referência?`,
                [
                  {
                    text: 'Manter a antiga',
                    style: 'cancel',
                    onPress: () => router.replace(`/session/${session.id}`),
                  },
                  {
                    text: 'Atualizar',
                    onPress: async () => {
                      await saveTrackReference({
                        trackId: params.trackId!,
                        trackName: params.trackName!,
                        samples: best.samples,
                        durationMs: best.durationMs,
                        lengthM: polylineLength(best.samples),
                        recordedAt: Date.now(),
                        sourceSessionId: session.id,
                        sourceLapId: best.id,
                      });
                      router.replace(`/session/${session.id}`);
                    },
                  },
                ]
              );
            } else {
              router.replace(`/session/${session.id}`);
            }
          },
        },
      ]
    );
  };

  const handleCancel = () => {
    if (state === 'recording') {
      Alert.alert('Cancelar sessão?', 'Os dados gravados serão descartados.', [
        { text: 'Continuar', style: 'cancel' },
        {
          text: 'Cancelar',
          style: 'destructive',
          onPress: async () => {
            await stop();
            router.replace('/');
          },
        },
      ]);
    } else {
      router.replace('/');
    }
  };

  const acc = accuracyLabel(info.lastAccuracy);
  const deltaMs =
    reference && info.bestLapMs !== null ? info.bestLapMs - reference.durationMs : null;
  const currentLapMs = info.elapsedMs % 60000;

  if (state === 'idle') {
    return (
      <IdleView
        trackName={params.trackName ?? 'Pista'}
        reference={reference}
        starting={starting}
        onStart={handleStart}
        onCancel={handleCancel}
        isLandscape={isLandscape}
      />
    );
  }

  // Recording — layout pensado pra landscape (uso esperado no cockpit)
  return (
    <View
      style={[
        s.recRoot,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      {/* Top bar — minimalista */}
      <View style={s.recTopBar}>
        <Pressable hitSlop={12} onPress={handleCancel} style={s.iconBtn}>
          <Text style={s.close}>✕</Text>
        </Pressable>
        <Text style={s.recTrackName} numberOfLines={1}>
          {params.trackName ?? 'AO VIVO'}
        </Text>
        <View style={s.recGpsBar}>
          <View style={[s.recGpsDot, { backgroundColor: acc.color }]} />
          <Text style={[s.recGpsText, { color: acc.color }]}>{acc.text}</Text>
        </View>
      </View>

      {/* Hero — número gigante centralizado */}
      <View style={s.recHero}>
        {deltaMs !== null ? (
          <>
            <Text style={s.recHeroLabel}>DELTA</Text>
            <Text
              style={[
                s.recHeroValue,
                typography.mono,
                {
                  fontSize: isLandscape ? Math.min(width * 0.18, 180) : Math.min(width * 0.28, 110),
                  color: deltaMs > 0 ? colors.danger : colors.success,
                },
              ]}
            >
              {fmtDelta(deltaMs)}
            </Text>
            <Text style={s.recHeroHint}>vs referência da pista</Text>
          </>
        ) : (
          <>
            <Text style={s.recHeroLabel}>VOLTA ATUAL</Text>
            <Text
              style={[
                s.recHeroValue,
                typography.mono,
                {
                  fontSize: isLandscape ? Math.min(width * 0.18, 180) : Math.min(width * 0.28, 110),
                  color: colors.textPrimary,
                },
              ]}
            >
              {fmtTime(currentLapMs)}
            </Text>
            <Text style={s.recHeroHint}>sem referência configurada</Text>
          </>
        )}
      </View>

      {/* Bottom bar — stats + encerrar */}
      <View style={s.recBottomBar}>
        <StatBlock label="MELHOR" value={info.bestLapMs !== null ? fmtLap(info.bestLapMs) : '—'} tone="primary" />
        <StatBlock label="VOLTAS" value={String(info.lapsCompleted)} />
        <StatBlock label="TEMPO" value={fmtTime(info.elapsedMs)} />
        <StatBlock label="KM/H" value={info.lastSpeedKmh.toFixed(0)} />
        <Pressable
          style={({ pressed }) => [s.endBtn, pressed && { opacity: 0.8 }]}
          onPress={handleFinish}
        >
          <Icon name="stop" size={18} color={colors.textPrimary} />
          <Text style={s.endBtnText}>Encerrar</Text>
        </Pressable>
      </View>

      {/* Idle prompt — overlay quando piloto fica parado por 30s+ */}
      {idlePrompt && (
        <View style={s.idleOverlay}>
          <View style={s.idleCard}>
            <Text style={s.idlePromptTitle}>SEM MOVIMENTO</Text>
            <Text style={s.idlePromptSub}>Parado há 30s. Encerrar sessão?</Text>
            <Pressable
              style={({ pressed }) => [s.idleEndBtn, pressed && { opacity: 0.8 }]}
              onPress={() => {
                setIdlePrompt(false);
                handleFinish();
              }}
            >
              <Icon name="stop" size={22} color={colors.textPrimary} />
              <Text style={s.idleEndText}>ENCERRAR SESSÃO</Text>
            </Pressable>
            <Pressable
              onPress={handleDismissIdle}
              hitSlop={12}
              style={({ pressed }) => [s.idleDismiss, pressed && { opacity: 0.5 }]}
            >
              <Text style={s.idleDismissText}>Continuar correndo</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function StatBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'primary';
}) {
  return (
    <View style={s.statBlock}>
      <Text style={s.statLabel}>{label}</Text>
      <Text
        style={[
          s.statValue,
          typography.mono,
          tone === 'primary' && { color: colors.primary },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
    </View>
  );
}

/** Tela de "pronto pra correr" antes do GPS começar. Funciona em portrait ou landscape. */
function IdleView({
  trackName,
  reference,
  starting,
  onStart,
  onCancel,
  isLandscape,
}: {
  trackName: string;
  reference: TrackReference | null;
  starting: boolean;
  onStart: () => void;
  onCancel: () => void;
  isLandscape: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.idleRoot, { paddingTop: insets.top + spacing.s }]}>
      <View style={s.idleHeader}>
        <Pressable hitSlop={12} onPress={onCancel} style={s.iconBtn}>
          <Text style={s.close}>✕</Text>
        </Pressable>
        <Text style={s.idleTitle}>SESSÃO AO VIVO</Text>
        <View style={s.iconBtn} />
      </View>

      <View style={[s.idleBody, isLandscape && { flexDirection: 'row', gap: spacing.l }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.idleTrack}>{trackName}</Text>
          {reference && (
            <Card variant="glow" padding="m" style={{ marginTop: spacing.l }}>
              <Text style={s.refLabel}>REFERÊNCIA DA PISTA</Text>
              <View style={s.refRow}>
                <Text style={[s.refTime, typography.mono]}>{fmtLap(reference.durationMs)}</Text>
                <Text style={s.refMeta}>{reference.lengthM.toFixed(0)}m</Text>
              </View>
            </Card>
          )}
          <Card variant="default" padding="l" style={{ marginTop: spacing.l }}>
            <Text style={s.instructionTitle}>Pronto pra correr?</Text>
            <Text style={s.instructionText}>
              Encaixe o celular no suporte horizontal do kart, aperte "Começar". A análise
              aparece quando você encerrar.
            </Text>
          </Card>
        </View>

        <View
          style={{
            paddingTop: isLandscape ? 0 : spacing.l,
            paddingBottom: insets.bottom + spacing.l,
            justifyContent: 'flex-end',
            ...(isLandscape && { width: 240 }),
          }}
        >
          <Button
            label={starting ? 'Abrindo GPS…' : 'Começar a correr'}
            onPress={onStart}
            variant="primary"
            size="l"
            fullWidth
            loading={starting}
            iconRight={
              !starting ? <Icon name="arrow-right" size={20} color={colors.textOnPrimary} /> : undefined
            }
          />
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  close: { color: colors.textSecondary, fontSize: 22, fontWeight: '500' },

  /* IDLE */
  idleRoot: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.l },
  idleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.m,
  },
  idleTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
  idleBody: { flex: 1 },
  idleTrack: { color: colors.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },

  refLabel: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  refRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  refTime: { color: colors.textPrimary, fontSize: 28, fontWeight: '900' },
  refMeta: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },

  instructionTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  instructionText: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: spacing.s,
    lineHeight: 20,
  },

  /* RECORDING */
  recRoot: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.l,
  },
  recTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
  },
  recTrackName: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
    flex: 1,
    textAlign: 'center',
  },
  recGpsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.m,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recGpsDot: { width: 8, height: 8, borderRadius: 4 },
  recGpsText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },

  recHero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recHeroLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
  },
  recHeroValue: {
    fontWeight: '900',
    letterSpacing: -4,
    includeFontPadding: false,
    marginTop: spacing.s,
  },
  recHeroHint: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    marginTop: spacing.s,
  },

  recBottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingVertical: spacing.s,
  },
  statBlock: {
    flex: 1,
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.s,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
    marginTop: 2,
  },

  endBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s,
    paddingHorizontal: spacing.l,
    paddingVertical: 14,
    borderRadius: radius.m,
    backgroundColor: colors.danger,
  },
  endBtnText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  // Idle prompt overlay
  idleOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  idleCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.l,
    borderWidth: 2,
    borderColor: colors.warning,
    padding: spacing.l,
    alignItems: 'center',
  },
  idlePromptTitle: {
    color: colors.warning,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2,
  },
  idlePromptSub: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 4,
    textAlign: 'center',
  },
  idleEndBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s,
    backgroundColor: colors.danger,
    paddingVertical: spacing.l,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.m,
    marginTop: spacing.l,
    alignSelf: 'stretch',
  },
  idleEndText: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1,
  },
  idleDismiss: {
    marginTop: spacing.m,
    padding: spacing.s,
  },
  idleDismissText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
});
