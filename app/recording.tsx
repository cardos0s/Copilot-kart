import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLapRecorder, RecordedLap } from '../src/hooks/useLapRecorder';
import {
  saveLap,
  createSession,
  getTrackReference,
  saveTrackReference,
  TrackReference,
} from '../src/storage/db';
import { polylineLength } from '../src/lib/geometry';
import { LapRecord } from '../src/lib/analysis';
import { colors, spacing, radius, typography } from '../src/theme';

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

function fmtDelta(ms: number) {
  const sign = ms >= 0 ? '+' : '-';
  const abs = Math.abs(ms / 1000);
  return `${sign}${abs.toFixed(2)}s`;
}

function accuracyLabel(acc: number) {
  if (acc === 0) return { text: 'Aguardando GPS', color: colors.textMuted };
  if (acc <= 5) return { text: `Excelente · ±${acc.toFixed(0)}m`, color: colors.primary };
  if (acc <= 10) return { text: `Bom · ±${acc.toFixed(0)}m`, color: colors.warning };
  return { text: `Ruim · ±${acc.toFixed(0)}m`, color: colors.danger };
}

/**
 * Converte uma volta de domínio (RecordedLap, o que o hook detecta) em um
 * registro persistível (LapRecord, o que o banco espera). Decoração de
 * identidade: só aqui a volta ganha id e sessionId.
 */
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
  const [starting, setStarting] = useState(false);
  const [reference, setReference] = useState<TrackReference | null>(null);

  const { state, info, start, stop } = useLapRecorder();

  useEffect(() => {
    if (params.trackId) {
      getTrackReference(params.trackId).then(setReference);
    }
  }, [params.trackId]);

  const handleStart = async () => {
    setStarting(true);
    try {
      await start();
    } catch (e: any) {
      Alert.alert('Erro', e.message ?? 'Falha ao iniciar GPS');
    }
    setStarting(false);
  };

  const handleFinish = async () => {
    Alert.alert(
      'Encerrar corrida?',
      `Vamos processar ${info.lapsCompleted} volta(s) e mostrar a análise.`,
      [
        { text: 'Continuar', style: 'cancel' },
        {
          text: 'Encerrar',
          style: 'destructive',
          onPress: async () => {
            // Fonte única de verdade: voltas já detectadas pelo hook.
            const result = await stop();

            if (result.allSamples.length < 30) {
              Alert.alert('Poucos dados', 'Não deu tempo de captar dados suficientes.');
              router.replace('/');
              return;
            }

            // Cria sessão no banco — agora sim essa gravação tem identidade.
            const session = await createSession({
              trackName: params.trackName ?? 'Pista',
              kart: null,
              notes: null,
              weather: 'dry',
              trackId: params.trackId ?? null,
              mode: 'race',
            });

            // Persiste cada volta. Aqui é onde o domínio vira persistência —
            // decoramos RecordedLap com id e sessionId pra virar LapRecord.
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

            // Melhor volta da sessão atual
            const best = lapsToSave.reduce((b, l) =>
              l.durationMs < b.durationMs ? l : b
            , lapsToSave[0]);

            // Se bateu a referência, pergunta se quer atualizar
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
      Alert.alert('Cancelar corrida?', 'Os dados gravados serão descartados.', [
        { text: 'Continuar', style: 'cancel' },
        {
          text: 'Cancelar',
          style: 'destructive',
          onPress: async () => { await stop(); router.replace('/'); },
        },
      ]);
    } else {
      router.replace('/');
    }
  };

  const acc = accuracyLabel(info.lastAccuracy);
  const deltaMs = reference && info.bestLapMs !== null
    ? info.bestLapMs - reference.durationMs
    : null;

  return (
    <View style={[s.container, { paddingTop: insets.top + spacing.m }]}>
      <View style={s.header}>
        <Pressable onPress={handleCancel} hitSlop={12}>
          <Text style={s.close}>✕</Text>
        </Pressable>
        <Text style={s.step}>CORRIDA</Text>
        <View style={{ width: 20 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 180 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.trackName}>{params.trackName}</Text>

        {reference && (
          <View style={s.refCard}>
            <Text style={s.refLabel}>REFERÊNCIA DA PISTA</Text>
            <View style={s.refRow}>
              <Text style={s.refTime}>{fmtLap(reference.durationMs)}</Text>
              <Text style={s.refMeta}>{reference.lengthM.toFixed(0)}m</Text>
            </View>
          </View>
        )}

        {state === 'recording' && (
          <>
            <View style={s.bigTimer}>
              <Text style={s.timerLabel}>TEMPO DE SESSÃO</Text>
              <Text style={s.timerValue}>{fmtTime(info.elapsedMs)}</Text>
            </View>

            <View style={s.lapStats}>
              <View style={s.lapStatBlock}>
                <Text style={s.lapStatLabel}>VOLTAS</Text>
                <Text style={s.lapStatValue}>{info.lapsCompleted}</Text>
              </View>
              {info.bestLapMs !== null && (
                <View style={s.lapStatBlock}>
                  <Text style={s.lapStatLabel}>MELHOR</Text>
                  <Text style={[s.lapStatValue, s.lapStatValueMono]}>
                    {fmtLap(info.bestLapMs)}
                  </Text>
                </View>
              )}
              {deltaMs !== null && (
                <View style={s.lapStatBlock}>
                  <Text style={s.lapStatLabel}>Δ REF</Text>
                  <Text
                    style={[
                      s.lapStatValue,
                      s.lapStatValueMono,
                      { color: deltaMs > 0 ? colors.danger : colors.primary },
                    ]}
                  >
                    {fmtDelta(deltaMs)}
                  </Text>
                </View>
              )}
            </View>

            <View style={s.statsGrid}>
              <Stat label="VEL" value={`${info.lastSpeedKmh.toFixed(0)}`} unit="km/h" />
              <Stat label="PTS" value={String(info.totalSamples)} />
            </View>

            <View style={[s.accBox, { borderColor: acc.color }]}>
              <Text style={s.accLabel}>SINAL GPS</Text>
              <Text style={[s.accValue, { color: acc.color }]}>{acc.text}</Text>
            </View>

            {info.isMoving && (
              <View style={s.movingBadge}>
                <View style={s.movingDot} />
                <Text style={s.movingText}>Em ritmo de pista</Text>
              </View>
            )}
          </>
        )}

        {state === 'idle' && (
          <View style={s.instruction}>
            <Text style={s.instructionTitle}>Pronto pra correr?</Text>
            <Text style={s.instructionText}>
              Guarda o celular no bolso do macacão, aperta "Começar" e corre normal.
              A análise vai aparecer quando tu encerrar.
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + spacing.l }]}>
        {state === 'idle' && (
          <Pressable
            style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.6 }, starting && { opacity: 0.5 }]}
            onPress={handleStart}
            disabled={starting}
          >
            <Text style={s.primaryText}>
              {starting ? 'Abrindo GPS...' : 'Começar a correr'}
            </Text>
            {!starting && <Text style={s.primaryArrow}>→</Text>}
          </Pressable>
        )}
        {state === 'recording' && (
          <Pressable
            style={({ pressed }) => [s.finishBtn, pressed && { opacity: 0.8 }]}
            onPress={handleFinish}
          >
            <Text style={s.finishText}>Encerrar corrida</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <View style={s.statValueRow}>
        <Text style={s.statValue}>{value}</Text>
        {unit && <Text style={s.statUnit}>{unit}</Text>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
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

  refCard: {
    marginTop: spacing.m,
    padding: spacing.m,
    borderRadius: radius.m,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.primary + '55',
  },
  refLabel: { color: colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  refRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 },
  refTime: { color: colors.textPrimary, fontSize: 22, fontWeight: '800', ...typography.mono },
  refMeta: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },

  instruction: {
    marginTop: spacing.xxl,
    padding: spacing.l,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
  },
  instructionTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  instructionText: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.s, lineHeight: 20 },

  bigTimer: {
    marginTop: spacing.l,
    padding: spacing.l,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  timerLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  timerValue: { color: colors.textPrimary, fontSize: 56, fontWeight: '900', ...typography.mono, marginTop: 4 },

  lapStats: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.m },
  lapStatBlock: {
    flex: 1,
    padding: spacing.m,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  lapStatLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  lapStatValue: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', marginTop: 4 },
  lapStatValueMono: { ...typography.mono },

  statsGrid: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.m },
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
});