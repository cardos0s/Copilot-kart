import { useState, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import { useLapRecorder } from '../src/hooks/useLapRecorder';
import { saveTrackReference } from '../src/storage/db';
import { polylineLength, GpsSample } from '../src/lib/geometry';
import { colors, spacing, radius, typography } from '../src/theme';

/**
 * MODO BENCH — TESTE IR-E-VOLTAR NA RUA DE CASA.
 *
 * Parâmetros do detector relaxados pra aceitar velocidades de caminhada
 * e trajetos lineares curtos (80m pra um lado + 80m de volta = "volta" de 160m).
 *
 * DESLIGAR (mudar pra false) antes de qualquer teste em pista ou produção.
 * Enquanto ativado, um banner vermelho aparece no topo da tela.
 */
const BENCH_MODE = true;

const BENCH_DETECTOR_OPTIONS = {
  ritmoSpeedMs: 0.6,         // 2.2 km/h — caminhada tranquila atinge
  ritmoMinSustainedMs: 0.4,  // histerese proporcional
  minLapDistance: 100,       // 160m de volta dá folga
  minLapDuration: 90_000,    // 90s (caminhada 160m ≈ 130s, folga)
  lineRadius: 25,            // tolerância maior pra GPS de cidade
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
            <Circle cx={path.firstX} cy={path.firstY} r={5} fill={colors.accent} />
            <Circle cx={path.lastX} cy={path.lastY} r={6} fill={colors.primary} stroke={colors.bg} strokeWidth={2} />
          </>
        )}
      </Svg>
    </View>
  );
}

export default function RecordingReference() {
  const params = useLocalSearchParams<{ trackId: string; trackName: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [targetLaps, setTargetLaps] = useState(3);
  const [starting, setStarting] = useState(false);
  const targetReachedHandledRef = useRef(false);

  const handleTargetReached = () => {
    if (targetReachedHandledRef.current) return;
    targetReachedHandledRef.current = true;
    Alert.alert(
      'Voltas completas! 🏁',
      `Você completou ${targetLaps} volta(s). Posso encerrar e salvar a referência agora, ou continuar gravando se quiser mais voltas pra melhorar a precisão.`,
      [
        { text: 'Continuar gravando', style: 'cancel', onPress: () => { targetReachedHandledRef.current = false; } },
        { text: 'Encerrar e salvar', onPress: handleFinish },
      ]
    );
  };

  const { state, info, liveSamples, start, stop } = useLapRecorder({
    targetLaps,
    onTargetReached: handleTargetReached,
    detectorOptions: BENCH_MODE ? BENCH_DETECTOR_OPTIONS : undefined,
  });

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
    // stop() agora entrega tudo pronto: samples completos, voltas já recortadas.
    // A fonte de verdade é a mesma que alimentou o modal — sem re-detecção.
    const result = await stop();

    if (result.allSamples.length < 30) {
      Alert.alert('Poucos dados', 'Não consegui captar o suficiente pra detectar uma volta.');
      router.replace('/');
      return;
    }

    if (result.laps.length === 0) {
      Alert.alert(
        'Nenhuma volta completa',
        'Não detectei nenhuma volta fechada. É preciso passar pela linha de largada pelo menos 2 vezes. Tenta de novo.'
      );
      router.replace('/');
      return;
    }

    // Melhor volta = a mais rápida. O critério de referência é qualidade
    // (traçado limpo), não média — uma volta rápida e limpa serve melhor
    // como baseline do que a média de três voltas ruins.
    const best = result.laps.reduce((b, l) =>
      l.durationMs < b.durationMs ? l : b
    , result.laps[0]);

    const lengthM = polylineLength(best.samples);

    await saveTrackReference({
      trackId: params.trackId!,
      trackName: params.trackName!,
      samples: best.samples,
      durationMs: best.durationMs,
      lengthM,
      recordedAt: Date.now(),
    });

    Alert.alert(
      'Pista reconhecida! 🏁',
      `${result.laps.length} volta(s) detectada(s). Melhor: ${fmtLap(best.durationMs)} · ${lengthM.toFixed(0)}m\n\nVamos correr agora?`,
      [
        { text: 'Agora não', style: 'cancel', onPress: () => router.replace('/') },
        {
          text: 'Bora correr',
          onPress: () => {
            router.replace({
              pathname: '/recording',
              params: { trackId: params.trackId!, trackName: params.trackName! },
            });
          },
        },
      ]
    );
  };

  const handleFinishConfirm = () => {
    Alert.alert(
      'Encerrar reconhecimento?',
      `Detectei ${info.lapsCompleted} volta(s) completa(s) até agora.`,
      [
        { text: 'Continuar gravando', style: 'cancel' },
        { text: 'Encerrar', style: 'destructive', onPress: handleFinish },
      ]
    );
  };

  const handleCancel = () => {
    if (state === 'recording') {
      Alert.alert('Cancelar reconhecimento?', 'Os dados gravados serão descartados.', [
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
  const progress = Math.min(1, info.lapsCompleted / targetLaps);

  return (
    <View style={[s.container, { paddingTop: insets.top + spacing.m }]}>
      <View style={s.header}>
        <Pressable onPress={handleCancel} hitSlop={12}>
          <Text style={s.close}>✕</Text>
        </Pressable>
        <Text style={s.step}>RECONHECIMENTO</Text>
        <View style={{ width: 20 }} />
      </View>

      {BENCH_MODE && (
        <View style={s.benchBanner}>
          <Text style={s.benchBannerText}>⚠️ MODO BENCH — caminhada</Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 180 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.trackName}>{params.trackName}</Text>
        <Text style={s.instruction}>
          {state === 'idle'
            ? 'Dê algumas voltas tranquilas pra eu aprender o traçado.'
            : `Objetivo: ${targetLaps} volta(s). A pista vai aparecer no radar conforme você anda.`}
        </Text>

        {state === 'idle' && (
          <View style={s.lapsPicker}>
            <Text style={s.lapsLabel}>QUANTAS VOLTAS?</Text>
            <View style={s.lapsRow}>
              {[1, 2, 3, 5].map((n) => (
                <Pressable
                  key={n}
                  onPress={() => setTargetLaps(n)}
                  style={[s.lapsChip, targetLaps === n && s.lapsChipActive]}
                >
                  <Text style={[s.lapsText, targetLaps === n && s.lapsTextActive]}>{n}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={s.lapsHint}>
              Mais voltas = referência mais precisa. 3 é suficiente na maioria dos casos.
            </Text>
          </View>
        )}

        {state === 'recording' && (
          <>
            <View style={s.radarBox}>
              <LiveRadar samples={liveSamples} />
              {liveSamples.length < 5 && (
                <View style={s.radarEmpty}>
                  <Text style={s.radarEmptyTitle}>
                    {info.isMoving ? 'Gravando...' : 'Aguardando você acelerar'}
                  </Text>
                  <Text style={s.radarEmptyText}>
                    {info.isMoving
                      ? 'Continue rodando, o traçado vai aparecer aqui.'
                      : 'O radar começa a desenhar quando você passar dos 18 km/h.'}
                  </Text>
                </View>
              )}
            </View>

            <View style={s.lapProgress}>
              <View style={s.lapProgressLabels}>
                <Text style={s.lapProgressCount}>
                  {info.lapsCompleted} / {targetLaps}
                </Text>
                <Text style={s.lapProgressLabel}>VOLTAS COMPLETAS</Text>
              </View>
              <View style={s.lapProgressBar}>
                <View style={[s.lapProgressFill, { width: `${progress * 100}%` }]} />
              </View>
              {info.bestLapMs !== null && (
                <Text style={s.bestLapText}>
                  Melhor volta: <Text style={s.bestLapValue}>{fmtLap(info.bestLapMs)}</Text>
                </Text>
              )}
            </View>

            <View style={s.statsGrid}>
              <Stat label="TEMPO" value={fmtTime(info.elapsedMs)} mono />
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
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + spacing.l }]}>
        {state === 'idle' && (
          <Pressable
            style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.6 }, starting && { opacity: 0.5 }]}
            onPress={handleStart}
            disabled={starting}
          >
            <Text style={s.primaryText}>
              {starting ? 'Abrindo GPS...' : 'Começar reconhecimento'}
            </Text>
            {!starting && <Text style={s.primaryArrow}>→</Text>}
          </Pressable>
        )}
        {state === 'recording' && (
          <Pressable
            style={({ pressed }) => [s.finishBtn, pressed && { opacity: 0.8 }]}
            onPress={handleFinishConfirm}
          >
            <Text style={s.finishText}>Encerrar e salvar referência</Text>
          </Pressable>
        )}
      </View>
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
});

const radarStyles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
  },
});