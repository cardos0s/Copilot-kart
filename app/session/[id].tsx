import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import {
  getSession,
  getLapsForSession,
  Session,
  getDefaultLayoutForTrack,
  getLayout,
  TrackLayout,
} from '../../src/storage/db';
import {
  LapRecord,
  analyzeLap,
  cleanSamples,
  matchLapToReference,
  repairDegenerateTimestamps,
} from '../../src/lib/analysis';
import { buildReferenceLap } from '../../src/lib/geometry';
import { Corner, describeSector, detectCorners } from '../../src/lib/corners';
import { CornerMetric, analyzeCorners } from '../../src/lib/cornerAnalysis';
import {
  CornerArrow,
  CornerMap,
  DeltaBar,
  LapSummaryHead,
  deltaTone,
  fmtDeltaS,
} from '../../src/components/analysis/parts';
import { formatLapPlain } from '../../src/lib/format';
import { msToKmh, peakSpeedInSectorMs, peakSpeedMs } from '../../src/lib/speed';
import { consumePendingCelebration } from '../../src/lib/celebrationQueue';
import {
  Achievement,
  Milestone,
  levelForXp,
  nextLevel,
  xpProgressInLevel,
} from '../../src/lib/gamification';
import { PbUnlocked } from '../../src/components/celebrations/PbUnlocked';
import { FloatingCoach } from '../../src/components/FloatingCoach';
import { LevelUp } from '../../src/components/celebrations/LevelUp';
import { AchievementUnlocked } from '../../src/components/celebrations/AchievementUnlocked';
import { findTrackById } from '../../src/data/tracks';
import {
  ColoredTrackPath,
  ColoredSegment,
  CornerBadge,
  EventMarker,
  AzimuthArrow,
} from '../../src/components/ColoredTrackPath';
import {
  Card,
  Metric,
  PillTabs,
  ScreenHeader,
  StatRow,
} from '../../src/components/ui';
import { colors, fonts, radius, spacing, typography } from '../../src/theme';

// react-native-maps removido — crashava no Android sem Google Maps API key,
// e a silhueta SVG com markers de eventos é mais legível pro caso de uso
// de análise de volta (sem fotos de satélite a distrair).

type ViewMode = 'comparar' | 'setores' | 'curvas' | 'mapa';
type ColorMode = 'delta' | 'speed';

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

function deltaColor(deltaMs: number, maxAbsDeltaMs: number): string {
  if (maxAbsDeltaMs === 0) return colors.textMuted;
  const ratio = Math.max(-1, Math.min(1, deltaMs / maxAbsDeltaMs));
  if (ratio < 0) {
    const intensity = Math.abs(ratio);
    return `rgba(0, 255, 136, ${0.5 + intensity * 0.5})`;
  }
  const intensity = ratio;
  const r = 255;
  const g = Math.floor(200 * (1 - intensity));
  const b = Math.floor(100 * (1 - intensity));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Map speed (m/s) to red→yellow→green via min/max range. */
function speedColor(speed: number, minS: number, maxS: number): string {
  if (maxS <= minS) return colors.primary;
  const t = Math.max(0, Math.min(1, (speed - minS) / (maxS - minS)));
  if (t < 0.5) {
    const k = t * 2; // 0..1 from red to yellow
    const r = 255;
    const g = Math.floor(60 + k * 195);
    const b = Math.floor(50 * (1 - k));
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const k = (t - 0.5) * 2; // 0..1 from yellow to green
    const r = Math.floor(255 * (1 - k * 0.85));
    const g = 255;
    const b = Math.floor(60 + k * 20);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

/** Percentil (clamp 0..1) sem mutar o array. */
function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function SessionScreenInner() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [laps, setLaps] = useState<LapRecord[]>([]);
  const [reference, setReference] = useState<TrackLayout | null>(null);
  const [selectedLapId, setSelectedLapId] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('comparar');
  const [colorMode, setColorMode] = useState<ColorMode>('delta');
  const [focusedSectorIdx, setFocusedSectorIdx] = useState<number | null>(null);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  // Fila de modais de celebração — ordem: PB → cada Achievement → Level Up.
  // O modal ativo fica em `celebrationStep`; ao fechar, avança pro próximo.
  type CelebrationStep =
    | { kind: 'pb'; pb: Extract<Milestone, { kind: 'pb' }>; callouts: Array<{ id: string; icon: string; label: string }> }
    | { kind: 'achievement'; achievement: Achievement; index: number; total: number }
    | { kind: 'level'; levelUp: Extract<Milestone, { kind: 'level_up' }>; newXp: number };
  const [celebrationQueue, setCelebrationQueue] = useState<CelebrationStep[]>([]);
  const celebrationStep = celebrationQueue[0] ?? null;
  const advanceCelebration = () => setCelebrationQueue((q) => q.slice(1));
  // Quando true, pelo menos uma volta (ou a referência) teve timestamps
  // degenerados e foi reparada com tempos lineares — mostra um aviso na UI
  // pra deixar claro que os deltas por setor são aproximados.
  const [approxTimestamps, setApproxTimestamps] = useState(false);
  /** Curva em foco. Curvas e Mapa mostram a mesma — trocar numa troca na outra. */
  const [selectedCorner, setSelectedCorner] = useState<number | null>(null);

  // Lê a queue de celebração na 1ª montagem e monta a fila de modais na
  // ordem PB → Achievements → Level Up. Ao fechar cada um, avança.
  useEffect(() => {
    if (!id) return;
    const pending = consumePendingCelebration(id);
    if (!pending) return;
    const queue: CelebrationStep[] = [];

    const pb = pending.milestones.find((m) => m.kind === 'pb') as
      | Extract<Milestone, { kind: 'pb' }>
      | undefined;
    if (pb) {
      const callouts: Array<{ id: string; icon: string; label: string }> = [];
      for (const m of pending.milestones) {
        if (m.kind === 'sub_threshold') {
          callouts.push({
            id: `sub_${m.thresholdMs}`,
            icon: '⚡',
            label: `Sub-${Math.floor(m.thresholdMs / 1000)}s`,
          });
        } else if (m.kind === 'streak') {
          callouts.push({ id: 'streak', icon: '🔥', label: `Streak ×${m.count}` });
        }
      }
      callouts.push({ id: 'xp', icon: '◆', label: `+${pending.xpGained} XP` });
      queue.push({ kind: 'pb', pb, callouts });
    }

    pending.achievements.forEach((ach, i) =>
      queue.push({
        kind: 'achievement',
        achievement: ach,
        index: i,
        total: pending.achievements.length,
      })
    );

    const levelUp = pending.milestones.find((m) => m.kind === 'level_up') as
      | Extract<Milestone, { kind: 'level_up' }>
      | undefined;
    if (levelUp) {
      queue.push({ kind: 'level', levelUp, newXp: pending.newXp });
    }

    setCelebrationQueue(queue);
  }, [id]);

  // Sem lock de orientação aqui — a análise é vista no pit/em casa,
  // então respeitamos a rotação que o usuário escolher (portrait ou landscape).
  // A app inteira já tá com `orientation: default` no app.json.

  const mapScrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    (async () => {
      if (!id) return;
      setLoading(true);
      const ses = await getSession(id);
      const lapsRaw = await getLapsForSession(id);

      // Prioriza o layout explicitamente gravado na sessão; se nada vier
      // (sessões antigas pré-layout, ou sem trackId), cai pro default da pista.
      let ref: TrackLayout | null = null;
      if (ses?.layoutId) {
        ref = await getLayout(ses.layoutId);
      }
      if (!ref && ses?.trackId) {
        ref = await getDefaultLayoutForTrack(ses.trackId);
      }

      // Pipeline de cada volta: limpa por accuracy, depois detecta e repara
      // timestamps degenerados. O reparo usa durationMs/startedAt salvos no
      // banco (que vieram do lapDetector quando os t ainda eram válidos) pra
      // sintetizar tempos linearmente espaçados. Sem isso, voltas antigas
      // gravadas com loc.timestamp=0 mostravam "Confiança baixa 20/20" e
      // todos os setores zerados.
      let anyRepaired = false;
      const cleanedLaps = lapsRaw.map((l) => {
        const cleaned = cleanSamples(l.samples, 10);
        const { samples: repairedSamples, repaired } = repairDegenerateTimestamps(
          cleaned,
          l.durationMs,
          l.startedAt,
        );
        if (repaired) anyRepaired = true;
        return { ...l, samples: repairedSamples };
      });

      if (ref && ref.samples.length >= 2) {
        const { samples: repairedRefSamples, repaired } = repairDegenerateTimestamps(
          ref.samples,
          ref.durationMs,
        );
        if (repaired) {
          anyRepaired = true;
          ref = { ...ref, samples: repairedRefSamples };
        }
      }

      setSession(ses);
      setLaps(cleanedLaps);
      setReference(ref);
      setApproxTimestamps(anyRepaired);
      setLoading(false);
    })();
  }, [id]);

  // Compute pesado: matching, análise, detecção de curvas. Roda SEMPRE (mesmo
  // que session/laps ainda não tenham carregado) pra obedecer Rules of Hooks
  // — o early return fica DEPOIS de todos os hooks. Retorna um discriminated
  // union que diferencia loading / no-laps / too-short / error / ok.
  type Computed =
    | { kind: 'no-laps' }
    | { kind: 'too-short' }
    | { kind: 'error'; error: Error }
    | {
        kind: 'ok';
        sessionBest: LapRecord;
        useExternalRef: boolean;
        refSamples: any[];
        refDurationMs: number;
        selected: LapRecord;
        refLap: any;
        corners: Corner[];
        cornerMetrics: CornerMetric[];
        matchedReferenceProper: any;
        isSelectedReference: boolean;
        matchedCurrent: any;
        analysis: any;
        sectors: any[];
        maxAbsDelta: number;
      };

  const computed = useMemo<Computed>(() => {
    if (!session || laps.length === 0) {
      return { kind: 'no-laps' };
    }
    const sessionBest = laps.reduce(
      (b, l) => (l.durationMs < b.durationMs ? l : b),
      laps[0]
    );
    const useExternalRef = reference !== null;
    const refSamples = useExternalRef ? reference!.samples : sessionBest.samples;
    const refDurationMs = useExternalRef ? reference!.durationMs : sessionBest.durationMs;
    // Default = melhor volta da sessão (não a primeira, que costuma ser out-lap).
    // Se o usuário escolheu outra explicitamente, respeita.
    const selected = selectedLapId
      ? laps.find((l) => l.id === selectedLapId) ?? sessionBest
      : sessionBest;

    if (refSamples.length < 5 || selected.samples.length < 5) {
      return { kind: 'too-short' };
    }

    try {
      const refLap = buildReferenceLap(refSamples, {
        lat: refSamples[0].lat,
        lng: refSamples[0].lng,
      });
      const corners = detectCorners(refLap);
      const matchedReferenceProper = matchLapToReference(
        {
          id: 'ref',
          sessionId: 'ref',
          startedAt: 0,
          durationMs: refDurationMs,
          samples: refSamples,
        },
        refLap
      );
      const isSelectedReference = !useExternalRef && selected.id === sessionBest.id;
      const matchedCurrent = matchLapToReference(selected, refLap);
      const analysis = !isSelectedReference
        ? analyzeLap(matchedCurrent, matchedReferenceProper, 20)
        : null;
      const sectors = analysis?.sectors ?? [];
      const maxAbsDelta = Math.max(1, ...sectors.map((x: any) => Math.abs(x.deltaMs)));
      const cornerMetrics = analyzeCorners(
        corners,
        refLap,
        matchedCurrent,
        isSelectedReference ? null : matchedReferenceProper
      );
      return {
        kind: 'ok',
        sessionBest,
        useExternalRef,
        refSamples,
        refDurationMs,
        selected,
        refLap,
        corners,
        cornerMetrics,
        matchedReferenceProper,
        isSelectedReference,
        matchedCurrent,
        analysis,
        sectors,
        maxAbsDelta,
      };
    } catch (err: any) {
      if (__DEV__) console.warn('[SessionScreen] compute error:', err?.message ?? err);
      return {
        kind: 'error',
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }, [session, laps, reference, selectedLapId]);

  // === Daqui pra baixo: early returns. Todos os hooks já rodaram. ===

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (computed.kind === 'no-laps') {
    return (
      <View style={s.root}>
        <ScreenHeader title="SESSÃO" />
        <View style={[s.center, { flex: 1, padding: spacing.huge }]}>
          <Text style={s.emptyTitle}>Sem voltas nessa sessão</Text>
          <Text style={s.emptyText}>
            Pode ser que o GPS não tenha conseguido sinal suficiente, ou a detecção
            automática não reconheceu nenhuma volta completa.
          </Text>
        </View>
      </View>
    );
  }

  if (computed.kind === 'too-short') {
    return (
      <View style={s.root}>
        <ScreenHeader title="SESSÃO" subtitle={session?.trackName} />
        <View style={[s.center, { flex: 1, padding: spacing.huge }]}>
          <Text style={s.emptyTitle}>Dados insuficientes</Text>
          <Text style={s.emptyText}>
            Essa sessão tem poucos pontos de GPS válidos pra análise.
          </Text>
        </View>
      </View>
    );
  }

  if (computed.kind === 'error') {
    return (
      <View style={s.root}>
        <ScreenHeader title="SESSÃO" subtitle={session?.trackName} />
        <View style={[s.center, { flex: 1, padding: spacing.huge }]}>
          <Text style={s.emptyTitle}>Não foi possível analisar</Text>
          <Text style={s.emptyText}>
            Encontrei dados, mas eles não bateram com a referência da pista.
          </Text>
          <Text style={[s.emptyText, { color: colors.danger, marginTop: spacing.m, fontSize: 11 }]}>
            {computed.error.message}
          </Text>
        </View>
      </View>
    );
  }

  // computed.kind === 'ok' a partir daqui
  const {
    sessionBest,
    useExternalRef,
    refSamples,
    refDurationMs,
    selected,
    refLap,
    corners,
    cornerMetrics,
    isSelectedReference,
    matchedCurrent,
    sectors,
    maxAbsDelta,
    analysis,
  } = computed;

  // session é não-null aqui — `computed.kind === 'ok'` só ocorre quando session existe
  const track = session!.trackId ? findTrackById(session!.trackId) : null;
  const trackDisplayName = track?.shortName ?? session!.trackName;

  // Quando muda a volta selecionada, desfoca o setor (que era da outra análise)
  const handleSelectLap = (lapId: string) => {
    setSelectedLapId(lapId);
    setFocusedSectorIdx(null);
  };

  // Tap em setor → vai pro mapa na curva daquele trecho. O mapa agora fala em
  // curvas, então focar um setor sem curva não diria nada ao piloto.
  const handleSectorTap = (idx: number) => {
    setFocusedSectorIdx(idx);
    if (sectors.length > 0 && refLap.totalLength > 0 && corners.length > 0) {
      const sStart = (idx / sectors.length) * refLap.totalLength;
      let nearest = 0;
      let bestDist = Infinity;
      corners.forEach((c, i) => {
        const dist = Math.abs(c.sApex - sStart);
        if (dist < bestDist) { bestDist = dist; nearest = i; }
      });
      setSelectedCorner(nearest);
    }
    setMode('mapa');
    // Scroll-to-top do conteúdo pra deixar mapa visível
    requestAnimationFrame(() => {
      mapScrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  };

  const handleCornerSelect = (i: number) => setSelectedCorner(i);

  return (
    <View style={s.root}>
      <ScreenHeader
        title="ANÁLISE DE VOLTAS"
        subtitle={
          reference?.name
            ? `${trackDisplayName} · ${reference.name}`
            : trackDisplayName
        }
      />

      <ScrollView
        ref={mapScrollRef}
        contentContainerStyle={{ paddingBottom: spacing.huge }}
        showsVerticalScrollIndicator={false}
      >
        <LapSummaryHead
          bestMs={refDurationMs}
          bestLabel={useExternalRef ? 'ref' : `v${lapIndex(laps, sessionBest)}`}
          currentMs={selected.durationMs}
          currentLabel={`VOLTA ${lapIndex(laps, selected)}`}
          deltaMs={selected.durationMs - refDurationMs}
          isBest={isSelectedReference}
        />

        {/* "Perguntar pra IA" foi removido — agora a função vive no botão
            flutuante (AssistiveTouch-style) que aparece automaticamente em
            todas as telas. Mantemos só o atalho de comparar voltas. */}
        {!isSelectedReference && laps.length >= 2 && (
          <View style={{ paddingHorizontal: spacing.l, marginTop: spacing.m, gap: spacing.s }}>
            <Pressable
              onPress={() => {
                const otherLap =
                  laps.find((l) => l.id !== selected.id && l.id === sessionBest.id) ??
                  laps.find((l) => l.id !== selected.id);
                if (!otherLap) return;
                router.push({
                  pathname: '/lap-compare' as any,
                  params: {
                    sessionA: id,
                    lapA: selected.id,
                    sessionB: id,
                    lapB: otherLap.id,
                  },
                });
              }}
              style={({ pressed }) => [s.askAiBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={s.askAiBtnText}>Comparar com a melhor volta</Text>
            </Pressable>

            {/* Replay 3D — viewer com todas as voltas + kart animado +
              * marcação de rodadas. Usa react-three-fiber, então abre tela
              * dedicada (não inline) pra liberar tela inteira pro GL. */}
            <Pressable
              onPress={() => router.push(`/replay/${id}` as any)}
              style={({ pressed }) => [s.replayBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={s.replayBtnText}>Ver replay da sessão</Text>
            </Pressable>
          </View>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: spacing.l,
            paddingVertical: spacing.m,
            gap: spacing.s,
          }}
        >
          {laps.map((lap, i) => {
            const isSel = lap.id === selected.id;
            const isRef = !useExternalRef && lap.id === sessionBest.id;
            const delta = lap.durationMs - refDurationMs;
            const peakKmh = msToKmh(peakSpeedMs(lap.samples));
            return (
              <Pressable
                key={lap.id}
                style={[s.lapChip, isSel && s.lapChipActive]}
                onPress={() => handleSelectLap(lap.id)}
              >
                <View style={s.lapChipTop}>
                  <Text style={[s.lapChipIdx, isSel && s.lapChipIdxActive]}>V{i + 1}</Text>
                  {isRef && <View style={s.lapChipDot} />}
                </View>
                <Text style={s.lapChipTime}>{formatLapPlain(lap.durationMs)}</Text>
                {isRef ? (
                  <Text style={s.lapChipBest}>MELHOR</Text>
                ) : (
                  <Text style={[s.lapChipDelta, { color: deltaTone(delta) }]}>
                    {fmtDeltaS(delta)}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={{ paddingHorizontal: spacing.l, paddingTop: spacing.s }}>
          <PillTabs<ViewMode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'comparar', label: 'Comparar' },
              { value: 'setores', label: 'Setores' },
              { value: 'curvas', label: 'Curvas' },
              { value: 'mapa', label: 'Mapa' },
            ]}
          />
        </View>

        {approxTimestamps && (mode === 'setores' || mode === 'mapa') && (
          <View style={s.approxBanner}>
            <Text style={s.approxBannerTitle}>Tempos por setor aproximados</Text>
            <Text style={s.approxBannerBody}>
              A gravação dessa sessão salvou os pontos GPS sem timestamps válidos
              (bug em versões antigas do app). Reconstruí os tempos de forma uniforme
              pra liberar a análise, mas os deltas por setor não refletem onde você
              realmente perdeu ou ganhou tempo dentro da volta. Gravações novas já
              gravam timestamps corretos.
            </Text>
          </View>
        )}

        {mode === 'comparar' && (
          <ComparePanel
            sectors={sectors}
            corners={corners}
            cornerMetrics={cornerMetrics}
            refDurationMs={refDurationMs}
            selectedDurationMs={selected.durationMs}
            isSelectedReference={isSelectedReference}
            refPeakKmh={msToKmh(peakSpeedMs(refSamples))}
            selectedPeakKmh={msToKmh(peakSpeedMs(selected.samples))}
            bestLabel={useExternalRef ? 'REF' : `V${lapIndex(laps, sessionBest)}`}
            currentLabel={`V${lapIndex(laps, selected)}`}
            currentIndex={lapIndex(laps, selected)}
            totalLength={refLap.totalLength}
          />
        )}

        {mode === 'setores' && (
          <SectorsPanel
            sectors={sectors}
            corners={corners}
            totalLength={refLap.totalLength}
            currentIndex={lapIndex(laps, selected)}
            selectedDurationMs={selected.durationMs}
            refDurationMs={refDurationMs}
            isSelectedReference={isSelectedReference}
            onSectorTap={handleSectorTap}
          />
        )}

        {mode === 'curvas' && (
          <CornersPanel
            metrics={cornerMetrics}
            corners={corners}
            refLap={refLap}
            selectedCorner={selectedCorner}
            onSelect={handleCornerSelect}
            refLabel={useExternalRef ? 'REF' : `V${lapIndex(laps, sessionBest)}`}
            isReference={isSelectedReference}
          />
        )}

        {mode === 'mapa' && (
          <TrackMapPanel
            refLap={refLap}
            corners={corners}
            metrics={cornerMetrics}
            selectedCorner={selectedCorner}
            onSelect={handleCornerSelect}
          />
        )}

      </ScrollView>

      <Modal
        visible={mapFullscreen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setMapFullscreen(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <ScreenHeader
            title="MAPA"
            subtitle={`${trackDisplayName} · ${fmtLap(selected.durationMs)}`}
            onBack={() => setMapFullscreen(false)}
          />
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.huge }}>
            <MapPanel
              selected={selected}
              sectors={sectors}
              matchedCurrent={matchedCurrent}
              refLap={refLap}
              isSelectedReference={isSelectedReference}
              maxAbsDelta={maxAbsDelta}
              refSamples={refSamples}
              corners={corners}
              cornerMetrics={cornerMetrics}
              colorMode={colorMode}
              onColorModeChange={setColorMode}
              focusedSectorIdx={focusedSectorIdx}
              onClearFocus={() => setFocusedSectorIdx(null)}
              expanded
            />
          </ScrollView>
        </View>
      </Modal>

      <PbUnlocked
        visible={celebrationStep?.kind === 'pb'}
        onClose={advanceCelebration}
        onContinue={advanceCelebration}
        durationMs={celebrationStep?.kind === 'pb' ? celebrationStep.pb.durationMs : 0}
        deltaMs={celebrationStep?.kind === 'pb' ? celebrationStep.pb.deltaMs : null}
        callouts={celebrationStep?.kind === 'pb' ? celebrationStep.callouts : []}
      />
      <AchievementUnlocked
        visible={celebrationStep?.kind === 'achievement'}
        onClose={advanceCelebration}
        achievement={celebrationStep?.kind === 'achievement' ? celebrationStep.achievement : null}
        currentIndex={celebrationStep?.kind === 'achievement' ? celebrationStep.index : 0}
        totalCount={celebrationStep?.kind === 'achievement' ? celebrationStep.total : 0}
      />
      <FloatingCoach />
      <LevelUp
        visible={celebrationStep?.kind === 'level'}
        onClose={advanceCelebration}
        level={
          celebrationStep?.kind === 'level'
            ? celebrationStep.levelUp.to
            : { index: 1, name: 'Cadete', threshold: 0, title: 'Cadete' }
        }
        xpCurrent={
          celebrationStep?.kind === 'level'
            ? xpProgressInLevel(celebrationStep.newXp).earned
            : 0
        }
        xpNeeded={
          celebrationStep?.kind === 'level'
            ? xpProgressInLevel(celebrationStep.newXp).needed
            : 0
        }
        unlocks={
          celebrationStep?.kind === 'level'
            ? [
                { icon: '◆', title: 'Mais XP por sessão', subtitle: `Você agora ganha bônus por chegar ao nível ${celebrationStep.levelUp.to.name}` },
              ]
            : []
        }
      />
    </View>
  );
}

function lapIndex(laps: LapRecord[], target: LapRecord) {
  return laps.findIndex((l) => l.id === target.id) + 1;
}

export default function SessionScreen() {
  return (
    <ErrorBoundary context="análise da sessão">
      <SessionScreenInner />
    </ErrorBoundary>
  );
}

/**
 * Agrupa os mini-setores em S1/S2/S3 (terços da pista) e diz quais curvas
 * caem em cada terço. Setor inválido não entra na soma: currentMs=0 viraria
 * um "ganhou tempo" que não aconteceu.
 */
function groupThirds(
  sectors: any[],
  corners: Corner[],
  totalLength: number
): Array<{ refMs: number; curMs: number | null; deltaMs: number | null; corners: number[] }> {
  const third = Math.ceil(sectors.length / 3);
  return [0, 1, 2].map((g) => {
    const slice = sectors.slice(g * third, (g + 1) * third);
    const refSum = slice.reduce((a: number, sec: any) => a + (sec.referenceMs ?? 0), 0);
    const valid = slice.filter((sec: any) => sec.valid !== false);
    const curSum = valid.length ? valid.reduce((a: number, sec: any) => a + (sec.currentMs ?? 0), 0) : null;

    // Quais curvas ficam neste terço, pela posição do ápice ao longo da volta.
    const from = totalLength * (g / 3);
    const to = totalLength * ((g + 1) / 3);
    const inside = corners
      .map((c, i) => ({ i: i + 1, s: c.sApex }))
      .filter((c) => c.s >= from && c.s < to)
      .map((c) => c.i);

    return {
      refMs: refSum,
      curMs: curSum,
      deltaMs: curSum != null ? curSum - refSum : null,
      corners: inside,
    };
  });
}

function cornersLabel(list: number[]): string {
  if (list.length === 0) return '—';
  if (list.length === 1) return `CURVA ${list[0]}`;
  return `CURVAS ${list[0]}–${list[list.length - 1]}`;
}


/** Bloco "CURVA N · PERDIDO AQUI · ÁPICE" que Curvas e Mapa compartilham. */
function CornerReadout({
  metric,
  number,
  withDirection,
}: {
  metric: CornerMetric | null;
  number: number | null;
  withDirection?: boolean;
}) {
  if (!metric || number == null) {
    return <Text style={s.panelIntro}>Toque numa curva para ver os números dela</Text>;
  }
  const dir = metric.direction === 'right' ? 'DIREITA' : 'ESQUERDA';
  return (
    <View style={s.readout}>
      <View style={{ flex: 1 }}>
        <Text style={s.panelLabel}>
          CURVA {number}
          {withDirection ? ` · ${dir}` : ''}
        </Text>
        {metric.minSpeedKmh != null && (
          <Text style={s.readoutApex}>
            {metric.minSpeedKmh.toFixed(0)}
            <Text style={s.readoutUnit}> km/h no ápice</Text>
          </Text>
        )}
      </View>
      <View style={s.readoutRule} />
      <View style={{ flex: 1 }}>
        <Text style={s.panelLabel}>PERDIDO AQUI</Text>
        <Text style={[s.readoutDelta, { color: deltaTone(metric.deltaMs ?? 0) }]}>
          {metric.deltaMs != null ? (metric.deltaMs / 1000).toFixed(2).replace('-', '−') : '—'}
        </Text>
      </View>
    </View>
  );
}

function CornersPanel({
  metrics,
  corners,
  refLap,
  selectedCorner,
  onSelect,
  refLabel,
  isReference,
}: {
  metrics: CornerMetric[];
  corners: Corner[];
  refLap: any;
  selectedCorner: number | null;
  onSelect: (i: number) => void;
  refLabel: string;
  isReference: boolean;
}) {
  if (metrics.length === 0) {
    return (
      <View style={s.panel}>
        <Text style={s.panelIntro}>
          Nenhuma curva detectada nessa volta — traçado curto demais ou GPS com pouco sinal.
        </Text>
      </View>
    );
  }

  const lefts = metrics.filter((m) => m.direction === 'left').length;
  const rights = metrics.length - lefts;
  const sel = selectedCorner != null ? metrics[selectedCorner] ?? null : null;

  return (
    <View style={s.panel}>
      <View style={s.cornerTop}>
        <CornerMap
          refLap={refLap}
          corners={corners}
          selectedIndex={selectedCorner}
          size={168}
          onSelect={onSelect}
        />
        <View style={s.cornerTopData}>
          <CornerReadout
            metric={sel}
            number={selectedCorner != null ? selectedCorner + 1 : null}
          />
        </View>
      </View>

      <View style={s.panelRule} />

      <View style={s.cornerListHead}>
        <Text style={s.panelLabelTight}>
          {metrics.length} CURVAS · {lefts} À ESQUERDA, {rights} À DIREITA
        </Text>
        {!isReference && <Text style={s.panelLabelTight}>VS. {refLabel}</Text>}
      </View>

      {metrics.map((m, i) => {
        const on = i === selectedCorner;
        return (
          <Pressable
            key={i}
            onPress={() => onSelect(i)}
            style={({ pressed }) => [s.cornerRow, on && s.cornerRowActive, pressed && { opacity: 0.7 }]}
          >
            <Text style={[s.cornerNum, on && { color: colors.blueSoft }]}>{i + 1}</Text>
            <CornerArrow direction={m.direction} color={on ? colors.blueSoft : colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={s.cornerName}>{m.direction === 'right' ? 'Direita' : 'Esquerda'}</Text>
              {m.minSpeedKmh != null && (
                <Text style={s.cornerSpeed}>{m.minSpeedKmh.toFixed(0)} km/h no ápice</Text>
              )}
            </View>
            {!isReference && (
              <Text style={[s.cornerDelta, { color: deltaTone(m.deltaMs ?? 0) }]}>
                {m.deltaMs != null ? (m.deltaMs / 1000).toFixed(2).replace('-', '−') : '—'}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function TrackMapPanel({
  refLap,
  corners,
  metrics,
  selectedCorner,
  onSelect,
}: {
  refLap: any;
  corners: Corner[];
  metrics: CornerMetric[];
  selectedCorner: number | null;
  onSelect: (i: number) => void;
}) {
  const { width } = useWindowDimensions();
  const size = Math.min(width - spacing.gutter * 2, 360);
  const sel = selectedCorner != null ? metrics[selectedCorner] ?? null : null;

  return (
    <View style={s.panel}>
      <View style={{ alignItems: 'center' }}>
        <CornerMap
          refLap={refLap}
          corners={corners}
          selectedIndex={selectedCorner}
          size={size}
          onSelect={onSelect}
        />
      </View>
      <Text style={[s.panelIntro, { textAlign: 'center', marginTop: spacing.l }]}>
        Toque numa curva para ver os números dela
      </Text>
      <View style={s.panelRule} />
      <CornerReadout
        metric={sel}
        number={selectedCorner != null ? selectedCorner + 1 : null}
        withDirection
      />
    </View>
  );
}

function ComparePanel({
  sectors,
  corners,
  cornerMetrics,
  refDurationMs,
  selectedDurationMs,
  isSelectedReference,
  refPeakKmh,
  selectedPeakKmh,
  bestLabel,
  currentLabel,
  currentIndex,
  totalLength,
}: {
  sectors: any[];
  corners: Corner[];
  cornerMetrics: CornerMetric[];
  refDurationMs: number;
  selectedDurationMs: number;
  isSelectedReference: boolean;
  refPeakKmh: number;
  selectedPeakKmh: number;
  bestLabel: string;
  currentLabel: string;
  currentIndex: number;
  totalLength: number;
}) {
  if (isSelectedReference) {
    return (
      <View style={s.panel}>
        <Text style={s.panelIntro}>
          Esta é a sua melhor volta da sessão. Escolha outra ali em cima pra ver onde ela
          perdeu tempo comparada a esta.
        </Text>
      </View>
    );
  }
  if (sectors.length === 0) return null;

  const groups = groupThirds(sectors, corners, totalLength);
  const maxAbs = Math.max(...groups.map((g) => Math.abs(g.deltaMs ?? 0)), 1);

  // Onde está o tempo: o pior terço e, dentro dele, a pior curva. É o mesmo
  // caminho que o piloto faria com o dedo — o resumo só escreve em português.
  const worstIdx = groups.reduce(
    (best, g, i) => ((g.deltaMs ?? -Infinity) > (groups[best].deltaMs ?? -Infinity) ? i : best),
    0
  );
  const worst = groups[worstIdx];
  // O número da curva é a posição dela na volta, então carrego o índice junto
  // em vez de procurar o objeto de volta na lista depois.
  const worstCorner = cornerMetrics
    .map((m, i) => ({ m, number: i + 1 }))
    .filter((e) => e.m.valid && e.m.deltaMs != null && worst.corners.includes(e.number))
    .reduce<{ m: CornerMetric; number: number } | null>(
      (a, b) => ((b.m.deltaMs ?? 0) > (a?.m.deltaMs ?? -Infinity) ? b : a),
      null
    );
  const others = groups
    .filter((_, i) => i !== worstIdx)
    .reduce((a, g) => a + (g.deltaMs ?? 0), 0);

  return (
    <View style={s.panel}>
      <View style={s.twoUp}>
        <View style={{ flex: 1 }}>
          <Text style={[s.twoUpLabel, { color: colors.blueSoft }]}>{bestLabel} · MELHOR</Text>
          <Text style={[s.twoUpValue, { color: colors.blueSoft }]}>
            {formatLapPlain(refDurationMs)}
          </Text>
          {refPeakKmh > 0 && <Text style={s.twoUpHint}>{refPeakKmh.toFixed(0)} km/h máx</Text>}
        </View>
        <View style={s.twoUpRule} />
        <View style={{ flex: 1 }}>
          <Text style={s.twoUpLabel}>{currentLabel}</Text>
          <Text style={s.twoUpValue}>{formatLapPlain(selectedDurationMs)}</Text>
          {selectedPeakKmh > 0 && (
            <Text style={s.twoUpHint}>{selectedPeakKmh.toFixed(0)} km/h máx</Text>
          )}
        </View>
      </View>

      <View style={s.panelRule} />

      <Text style={s.panelLabel}>ONDE A DIFERENÇA ACONTECE</Text>
      {groups.map((g, i) => (
        <View key={i} style={s.barRow}>
          <Text style={s.barRowLabel}>SETOR {i + 1}</Text>
          <View style={{ flex: 1 }}>
            <DeltaBar deltaMs={g.deltaMs ?? 0} maxAbsMs={maxAbs} />
          </View>
          <Text style={[s.barRowValue, { color: deltaTone(g.deltaMs ?? 0) }]}>
            {g.deltaMs != null ? fmtDeltaS(g.deltaMs) : '—'}
          </Text>
        </View>
      ))}

      <View style={s.panelRule} />

      <Text style={s.panelLabel}>RESUMO</Text>
      <Text style={s.summary}>
        A volta {currentIndex} perdeu{' '}
        <Text style={s.summaryHot}>{((worst.deltaMs ?? 0) / 1000).toFixed(3).replace('.', ',')} s</Text>{' '}
        no setor {worstIdx + 1}
        {worstCorner && worstCorner.m.deltaMs != null ? (
          <>
            , e{' '}
            <Text style={s.summaryHot}>
              {(worstCorner.m.deltaMs / 1000).toFixed(3).replace('.', ',')} s
            </Text>{' '}
            disso na curva {worstCorner.number}
            {worstCorner.m.minSpeedKmh != null
              ? `, onde o ápice ficou em ${worstCorner.m.minSpeedKmh.toFixed(0)} km/h`
              : ''}
          </>
        ) : null}
        . Nos outros dois setores a diferença somada é de{' '}
        <Text style={s.summaryHot}>{(others / 1000).toFixed(3).replace('.', ',')} s</Text>.
      </Text>
    </View>
  );
}

function SectorsPanel({
  sectors,
  corners,
  totalLength,
  currentIndex,
  selectedDurationMs,
  refDurationMs,
  isSelectedReference,
  onSectorTap,
}: {
  sectors: any[];
  corners: Corner[];
  totalLength: number;
  currentIndex: number;
  selectedDurationMs: number;
  refDurationMs: number;
  isSelectedReference: boolean;
  onSectorTap: (idx: number) => void;
}) {
  if (sectors.length === 0) return null;

  const groups = groupThirds(sectors, corners, totalLength);
  const maxAbs = Math.max(...groups.map((g) => Math.abs(g.deltaMs ?? 0)), 1);
  const worstIdx = groups.reduce(
    (best, g, i) => ((g.deltaMs ?? -Infinity) > (groups[best].deltaMs ?? -Infinity) ? i : best),
    0
  );
  const third = Math.ceil(sectors.length / 3);
  const totalDelta = selectedDurationMs - refDurationMs;

  return (
    <View style={s.panel}>
      <Text style={s.panelIntro}>
        {isSelectedReference
          ? 'Esta é a sua melhor volta — os setores abaixo são a referência.'
          : `Volta ${currentIndex} contra a sua melhor. O setor ${worstIdx + 1} é onde está o tempo.`}
      </Text>

      {groups.map((g, i) => (
        <Pressable
          key={i}
          onPress={() => onSectorTap(i * third)}
          style={({ pressed }) => [s.sectorBlock, pressed && { opacity: 0.7 }]}
        >
          <View style={s.sectorTop}>
            <Text style={s.sectorLabel}>SETOR {i + 1}</Text>
            <Text style={s.sectorCorners}>{cornersLabel(g.corners)}</Text>
            <View style={{ flex: 1 }} />
            <Text style={s.sectorTime}>{g.curMs != null ? formatLapPlain(g.curMs) : '—'}</Text>
            <Text style={[s.sectorDelta, { color: deltaTone(g.deltaMs ?? 0) }]}>
              {g.deltaMs != null ? fmtDeltaS(g.deltaMs) : '—'}
            </Text>
          </View>
          <DeltaBar deltaMs={g.deltaMs ?? 0} maxAbsMs={maxAbs} />
        </Pressable>
      ))}

      <View style={s.totalRow}>
        <Text style={s.totalLabel}>TOTAL</Text>
        <Text style={s.sectorTime}>{formatLapPlain(selectedDurationMs)}</Text>
        <Text style={[s.sectorDelta, { color: deltaTone(totalDelta) }]}>
          {fmtDeltaS(totalDelta)}
        </Text>
      </View>
    </View>
  );
}

function SectorCard({
  sec,
  maxAbsDelta,
  corners,
  matchedCurrent,
  onPress,
  negative,
}: {
  sec: any;
  maxAbsDelta: number;
  corners: Corner[];
  matchedCurrent: any;
  onPress: () => void;
  negative?: boolean;
}) {
  const label = describeSector(sec, corners);
  const peakKmh = msToKmh(peakSpeedInSectorMs(matchedCurrent, sec.sStart, sec.sEnd));
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.sectorCard, pressed && { opacity: 0.65 }]}
    >
      <View style={[s.sectorColorBar, { backgroundColor: deltaColor(sec.deltaMs, maxAbsDelta) }]} />
      <View style={{ flex: 1 }}>
        <Text style={s.sectorTitle}>{label}</Text>
        <Text style={s.sectorDetail}>
          m{sec.sStart.toFixed(0)}–{sec.sEnd.toFixed(0)} · média {(sec.avgSpeedCurrent * 3.6).toFixed(0)} km/h
          {peakKmh > 0 ? ` · pico ${peakKmh.toFixed(0)}` : ''}
        </Text>
      </View>
      <Text
        style={[
          s.sectorCardDelta,
          typography.mono,
          { color: sec.deltaMs > 0 ? colors.danger : colors.success },
        ]}
      >
        {fmtDelta(sec.deltaMs)}
      </Text>
    </Pressable>
  );
}

/**
 * Mapa antigo: colore o traçado por velocidade ou por delta, com legenda e
 * foco em setor. NÃO está mais ligado a nenhuma aba — o Mapa novo fala em
 * curvas. Fica aqui porque a leitura por cor é informação que o mapa de
 * curvas não dá; se ela não voltar como modo, isto some.
 */
function MapPanel({
  selected,
  sectors,
  matchedCurrent,
  refLap,
  isSelectedReference,
  maxAbsDelta,
  refSamples,
  corners,
  cornerMetrics,
  colorMode,
  onColorModeChange,
  focusedSectorIdx,
  onClearFocus,
  expanded,
  onExpandRequest,
  onOpenDetailedMap,
}: {
  selected: LapRecord;
  sectors: any[];
  matchedCurrent: any;
  refLap: any;
  isSelectedReference: boolean;
  maxAbsDelta: number;
  refSamples: any[];
  corners: Corner[];
  cornerMetrics: CornerMetric[];
  colorMode: ColorMode;
  onColorModeChange: (m: ColorMode) => void;
  focusedSectorIdx: number | null;
  onClearFocus: () => void;
  /** Quando true, o mapa toma o máximo de tela disponível (modo fullscreen). */
  expanded?: boolean;
  /** Se passado, mostra botão "Expandir" no header pra abrir versão fullscreen. */
  onExpandRequest?: () => void;
  /** Se passado, mostra botão pra abrir a tela detalhada (track-map.tsx). */
  onOpenDetailedMap?: () => void;
}) {
  const mapPoints = selected.samples.map((p) => ({ latitude: p.lat, longitude: p.lng }));

  // Speed range pra colorização (5p–95p evita outliers)
  const speeds = selected.samples.map((p) => p.speed);
  const minS = percentile(speeds, 0.05);
  const maxS = percentile(speeds, 0.95);

  // Por amostra, computa cor segundo o modo
  const sampleColors: string[] = useMemo(() => {
    if (selected.samples.length === 0) return [];
    if (colorMode === 'speed' || isSelectedReference || sectors.length === 0) {
      return selected.samples.map((p) => speedColor(p.speed, minS, maxS));
    }
    // Modo delta — mapa colors per sector
    const sectorLen = refLap.totalLength / sectors.length;
    return matchedCurrent.points.map((p: any) => {
      const idx = Math.min(sectors.length - 1, Math.max(0, Math.floor(p.s / sectorLen)));
      return deltaColor(sectors[idx].deltaMs, maxAbsDelta);
    });
  }, [colorMode, selected, sectors, isSelectedReference, refLap, matchedCurrent, maxAbsDelta, minS, maxS]);

  // Agrupar samples adjacentes da mesma cor (pra menos polylines)
  const segments = useMemo(() => {
    const out: ColoredSegment[] = [];
    if (selected.samples.length === 0 || sampleColors.length === 0) return out;
    let cur: ColoredSegment | null = null;
    for (let i = 0; i < selected.samples.length; i++) {
      const color = sampleColors[i] ?? colors.primary;
      const sample = selected.samples[i];
      if (!cur || cur.color !== color) {
        if (cur) cur.samples.push(sample); // overlap pra evitar gap
        cur = { samples: [sample], color };
        out.push(cur);
      } else {
        cur.samples.push(sample);
      }
    }
    return out;
  }, [selected, sampleColors]);

  // Ponto do apex do setor focado (rosa)
  const focusedSectorApex = useMemo(() => {
    if (focusedSectorIdx == null || sectors.length === 0) return null;
    const sec = sectors[focusedSectorIdx];
    const inSector = matchedCurrent.points
      .map((p: any, i: number) => ({ p, sample: selected.samples[i] }))
      .filter(({ p }: any) => p.s >= sec.sStart && p.s <= sec.sEnd);
    if (inSector.length === 0) return null;
    const apexIdx = Math.floor(inSector.length / 2);
    return { lat: inSector[apexIdx].sample.lat, lng: inSector[apexIdx].sample.lng };
  }, [focusedSectorIdx, sectors, matchedCurrent, selected]);

  // Helper: dada uma distância s ao longo da pista, retorna a melhor lat/lng
  // entre os matched points (procura ponto mais próximo na curva matched).
  const findLatLngAtS = (sTarget: number): { lat: number; lng: number } | null => {
    if (!matchedCurrent?.points?.length || !selected?.samples?.length) return null;
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < matchedCurrent.points.length; i++) {
      const diff = Math.abs(matchedCurrent.points[i].s - sTarget);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    const sample = selected.samples[bestIdx];
    return sample ? { lat: sample.lat, lng: sample.lng } : null;
  };

  // Marcadores de eventos automáticos:
  //   P = pico de velocidade absoluto da volta
  //   B = freada mais forte (maior desaceleração entre samples)
  //   + = setor onde ganhou mais tempo (verde)
  //   − = setor onde perdeu mais tempo (vermelho)
  const eventMarkers = useMemo<EventMarker[]>(() => {
    const out: EventMarker[] = [];

    // Peak speed
    let peakIdx = 0;
    let peakSpeed = 0;
    for (let i = 0; i < selected.samples.length; i++) {
      if (selected.samples[i].speed > peakSpeed) {
        peakSpeed = selected.samples[i].speed;
        peakIdx = i;
      }
    }
    if (peakSpeed > 0 && selected.samples[peakIdx]) {
      out.push({
        point: { lat: selected.samples[peakIdx].lat, lng: selected.samples[peakIdx].lng },
        color: colors.accentCyan,
        label: 'P',
      });
    }

    // Hardest braking — maior decel entre samples consecutivos
    let brakeIdx = -1;
    let maxDecel = 0;
    for (let i = 1; i < selected.samples.length; i++) {
      const dv = selected.samples[i].speed - selected.samples[i - 1].speed;
      const dt = (selected.samples[i].t - selected.samples[i - 1].t) / 1000;
      if (dt > 0.05 && dt < 5) {
        const decel = -dv / dt; // m/s²
        if (decel > maxDecel) {
          maxDecel = decel;
          brakeIdx = i;
        }
      }
    }
    if (brakeIdx > 0 && maxDecel > 3 && selected.samples[brakeIdx]) {
      out.push({
        point: { lat: selected.samples[brakeIdx].lat, lng: selected.samples[brakeIdx].lng },
        color: colors.warning,
        label: 'B',
      });
    }

    // Best/worst sector — só quando não é a referência. Filtra setores
    // inválidos (sem dados ou pit-in anômalo) pra não mostrar markers errados.
    if (!isSelectedReference && sectors.length > 0) {
      const validSorted = sectors
        .filter((sec: any) => sec.valid !== false)
        .sort((a: any, b: any) => a.deltaMs - b.deltaMs);
      const best = validSorted[0];
      const worst = validSorted[validSorted.length - 1];

      if (best && best.deltaMs < -100) {
        const apex = findLatLngAtS((best.sStart + best.sEnd) / 2);
        if (apex) out.push({ point: apex, color: colors.success, label: '+' });
      }
      if (worst && worst.deltaMs > 100) {
        const apex = findLatLngAtS((worst.sStart + worst.sEnd) / 2);
        if (apex) out.push({ point: apex, color: colors.danger, label: '−' });
      }
    }

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, sectors, isSelectedReference, matchedCurrent]);

  // Setas de azimute na entrada de cada curva — direção de percurso do kart
  const azimuthArrows = useMemo<AzimuthArrow[]>(() => {
    if (!cornerMetrics || cornerMetrics.length === 0) return [];
    return cornerMetrics
      .map((m): AzimuthArrow | null => {
        const entry = findLatLngAtS(m.corner.sStart);
        if (!entry) return null;
        return {
          point: entry,
          azimuthDeg: m.entryAzimuthDeg,
          color: m.direction === 'left' ? colors.accentCyan : colors.accentOrange,
        };
      })
      .filter((x): x is AzimuthArrow => x !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cornerMetrics, matchedCurrent, selected]);

  // Badges numerados em cada curva — usa apexS pra mapear pra lat/lng
  const cornerBadges = useMemo<CornerBadge[]>(() => {
    if (!corners || corners.length === 0) return [];
    return corners
      .map((c) => {
        const apex = findLatLngAtS(c.sApex);
        if (!apex) return null;
        return { point: apex, number: c.index + 1 };
      })
      .filter((x): x is CornerBadge => x !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corners, matchedCurrent, selected]);

  const focusedSector = focusedSectorIdx != null ? sectors[focusedSectorIdx] : null;
  const focusedLabel = focusedSector ? describeSector(focusedSector, corners) : null;
  const { width, height } = Dimensions.get('window');
  // Em modo fullscreen, o mapa ocupa o maior quadrado possível dentro da
  // tela menos paddings e controles (~150px reservados pra toggle+legenda).
  const trackSize = expanded
    ? Math.min(width - spacing.l * 2, height - 200)
    : Math.min(width - spacing.l * 2, 380);

  return (
    <View style={{ paddingHorizontal: spacing.l, paddingTop: spacing.l }}>
      {(onExpandRequest || onOpenDetailedMap) && (
        <View style={{ flexDirection: 'row', gap: spacing.s, justifyContent: 'flex-end', marginBottom: spacing.s }}>
          {onOpenDetailedMap && (
            <Pressable
              onPress={onOpenDetailedMap}
              style={({ pressed }) => [s.expandBtn, pressed && { opacity: 0.6 }]}
              hitSlop={8}
            >
              <Text style={s.expandBtnText}>📐 Detalhado</Text>
            </Pressable>
          )}
          {onExpandRequest && (
            <Pressable
              onPress={onExpandRequest}
              style={({ pressed }) => [s.expandBtn, pressed && { opacity: 0.6 }]}
              hitSlop={8}
            >
              <Text style={s.expandBtnText}>⛶ Tela cheia</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Color mode toggle */}
      {!isSelectedReference && (
        <>
          <PillTabs<ColorMode>
            value={colorMode}
            onChange={onColorModeChange}
            options={[
              { value: 'delta', label: 'Delta' },
              { value: 'speed', label: 'Velocidade' },
            ]}
          />
          <Text style={s.modeExplain}>
            {colorMode === 'delta'
              ? 'DELTA = diferença de tempo vs sua melhor volta. Verde: foi mais rápido. Vermelho: foi mais lento.'
              : 'VELOCIDADE = km/h em cada ponto da pista. Verde: mais rápido. Vermelho: mais lento.'}
          </Text>
        </>
      )}

      {/* Focused sector badge */}
      {focusedSector && focusedLabel && (
        <Pressable onPress={onClearFocus} style={s.focusBadge}>
          <Text style={s.focusBadgeLabel}>{focusedLabel.toUpperCase()}</Text>
          <Text style={s.focusBadgeMeta}>
            m{focusedSector.sStart.toFixed(0)}–{focusedSector.sEnd.toFixed(0)} ·
            <Text
              style={{ color: focusedSector.deltaMs > 0 ? colors.danger : colors.success }}
            >
              {' '}
              {fmtDelta(focusedSector.deltaMs)}
            </Text>
          </Text>
          <Text style={s.focusBadgeHint}>toque pra mostrar pista inteira</Text>
        </Pressable>
      )}

      <Card variant="default" padding="l" style={{ marginTop: spacing.m, alignItems: 'center' }}>
        <ColoredTrackPath
          segments={segments}
          width={trackSize}
          height={trackSize}
          strokeWidth={5}
          highlightPoint={focusedSectorApex ?? undefined}
          eventMarkers={eventMarkers}
          cornerBadges={cornerBadges}
          azimuthArrows={azimuthArrows}
        />
      </Card>

      {/* Legenda dos markers */}
      <View style={s.markersLegend}>
        <MarkerLegendItem color={colors.accentCyan} label="P · pico de velocidade" />
        <MarkerLegendItem color={colors.warning} label="B · freada mais forte" />
        <MarkerLegendItem color={colors.accentCyan} label="➤ · azimute entrada (esq)" />
        <MarkerLegendItem color={colors.accentOrange} label="➤ · azimute entrada (dir)" />
        {!isSelectedReference && sectors.length > 0 && (
          <>
            <MarkerLegendItem color={colors.success} label="+ · maior ganho" />
            <MarkerLegendItem color={colors.danger} label="− · maior perda" />
          </>
        )}
      </View>

      {/* Legend */}
      {!isSelectedReference && (
        <View style={s.legend}>
          {colorMode === 'delta' ? (
            <>
              <LegendItem color={colors.success} label="ganhou" />
              <LegendItem color={colors.warning} label="neutro" />
              <LegendItem color={colors.danger} label="perdeu" />
            </>
          ) : (
            <>
              <LegendItem color="rgb(255,60,50)" label="lento" />
              <LegendItem color="rgb(255,200,50)" label="médio" />
              <LegendItem color="rgb(50,255,80)" label="rápido" />
            </>
          )}
        </View>
      )}
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={s.legendItem}>
      <View style={[s.legendDot, { backgroundColor: color }]} />
      <Text style={s.legendText}>{label}</Text>
    </View>
  );
}

function MarkerLegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={s.markerLegendItem}>
      <View style={[s.markerLegendDot, { backgroundColor: color }]} />
      <Text style={s.markerLegendText}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  // ── painéis Curvas e Mapa ───────────────────────────────────────
  panelLabelTight: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 1.1,
    color: colors.muted,
  },
  readout: { flexDirection: 'row', alignItems: 'flex-start' },
  readoutRule: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.line,
    marginHorizontal: spacing.xl,
  },
  readoutApex: {
    fontFamily: fonts.monoMedium,
    fontSize: 34,
    letterSpacing: -0.9,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  readoutUnit: { fontFamily: fonts.regular, fontSize: 15, color: colors.muted },
  readoutDelta: {
    fontFamily: fonts.monoMedium,
    fontSize: 34,
    letterSpacing: -0.9,
    fontVariant: ['tabular-nums'],
  },

  cornerTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.l },
  cornerTopData: { flex: 1 },
  cornerListHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.s,
  },
  cornerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.l,
    paddingVertical: spacing.l,
    paddingHorizontal: spacing.m,
    marginHorizontal: -spacing.m,
    borderRadius: radius.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  cornerRowActive: { backgroundColor: 'rgba(37, 99, 255, 0.10)', borderBottomColor: 'transparent' },
  cornerNum: {
    width: 18,
    fontFamily: fonts.monoMedium,
    fontSize: 17,
    color: colors.muted,
    fontVariant: ['tabular-nums'],
  },
  cornerName: { fontFamily: fonts.bold, fontSize: 17, letterSpacing: -0.2, color: colors.text },
  cornerSpeed: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted, marginTop: 2 },
  cornerDelta: { fontFamily: fonts.monoMedium, fontSize: 17, fontVariant: ['tabular-nums'] },

  // ── painéis de análise (Comparar / Setores) ─────────────────────
  panel: { paddingHorizontal: spacing.gutter, paddingTop: spacing.xl },
  panelIntro: {
    fontFamily: fonts.regular,
    fontSize: 15.5,
    lineHeight: 23,
    color: colors.muted,
  },
  panelRule: { height: 1, backgroundColor: colors.line, marginVertical: spacing.xl },
  panelLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 1.3,
    color: colors.muted,
    marginBottom: spacing.l,
  },

  twoUp: { flexDirection: 'row', alignItems: 'flex-start' },
  twoUpLabel: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 1.2, color: colors.muted },
  twoUpValue: {
    fontFamily: fonts.monoMedium,
    fontSize: 36,
    letterSpacing: -1,
    color: colors.text,
    fontVariant: ['tabular-nums'],
    marginTop: 6,
  },
  twoUpHint: { fontFamily: fonts.regular, fontSize: 14, color: colors.dim, marginTop: 4 },
  twoUpRule: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.line,
    marginHorizontal: spacing.xl,
  },

  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.l, marginBottom: spacing.l },
  barRowLabel: {
    width: 66,
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.muted,
  },
  barRowValue: {
    width: 62,
    textAlign: 'right',
    fontFamily: fonts.monoMedium,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },

  summary: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 25, color: colors.text },
  summaryHot: { fontFamily: fonts.semibold, color: colors.danger },

  sectorBlock: { marginTop: spacing.xxl },
  sectorTop: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.m, marginBottom: spacing.m },
  sectorLabel: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 1, color: colors.text },
  sectorCorners: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 1, color: colors.muted },
  sectorTime: {
    fontFamily: fonts.monoMedium,
    fontSize: 24,
    letterSpacing: -0.6,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  sectorDelta: { fontFamily: fonts.monoMedium, fontSize: 15, fontVariant: ['tabular-nums'] },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.m,
    marginTop: spacing.xxl,
    paddingTop: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  totalLabel: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.text,
  },

  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  compareRow: {
    flexDirection: 'row',
    gap: spacing.s,
    paddingHorizontal: spacing.l,
    paddingTop: spacing.s,
  },

  deltaLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  deltaValue: {
    fontSize: 36,
    fontWeight: '900',
    marginTop: 4,
    letterSpacing: -1,
  },

  askAiBtn: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  askAiBtnText: {
    color: colors.accentPurple,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  replayBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary + '55',
    borderRadius: 12,
  },
  replayBtnText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  expandBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.s,
  },
  expandBtnText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },

  lapChipTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lapChipDot: { width: 7, height: 7, borderRadius: 99, backgroundColor: colors.blue },
  lapChipBest: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 1.1,
    color: colors.blueSoft,
    marginTop: 8,
  },
  lapChip: {
    width: 150,
    paddingVertical: spacing.l,
    paddingHorizontal: spacing.l,
    borderRadius: radius.l,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  lapChipActive: { borderColor: colors.blue, backgroundColor: 'rgba(37, 99, 255, 0.10)' },
  lapChipIdx: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    letterSpacing: 0.6,
    color: colors.muted,
  },
  lapChipIdxActive: { color: colors.blueSoft },
  lapChipTime: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
    marginTop: 2,
    letterSpacing: -0.3,
  },
  lapChipBadge: { color: colors.success, fontSize: 14, fontWeight: '700', marginTop: 2 },
  lapChipDelta: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  lapChipSpeed: {
    color: colors.accentCyan,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginTop: 3,
  },

  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: spacing.s,
  },
  sectorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.m,
    paddingLeft: 8,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    marginBottom: spacing.s,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectorColorBar: { width: 4, alignSelf: 'stretch', borderRadius: 2, marginRight: 10 },
  sectorTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  sectorDetail: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  sectorCardDelta: { fontSize: 17, fontWeight: '900', marginLeft: spacing.m, letterSpacing: -0.5 },
  hint: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: spacing.s,
    textAlign: 'center',
  },

  mapWrap: {
    borderRadius: radius.l,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },

  focusBadge: {
    marginTop: spacing.m,
    padding: spacing.m,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryGlow,
  },
  focusBadgeLabel: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  focusBadgeMeta: { color: colors.textPrimary, fontSize: 13, fontWeight: '700', marginTop: 2 },
  focusBadgeHint: { color: colors.textMuted, fontSize: 10, fontWeight: '500', marginTop: 4 },

  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.l,
    marginTop: spacing.m,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  outLapWarn: {
    padding: spacing.l,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  outLapTitle: {
    color: colors.warning,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  outLapBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
  partialNote: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: spacing.s,
    fontStyle: 'italic',
  },
  approxBanner: {
    marginHorizontal: spacing.l,
    marginTop: spacing.m,
    padding: spacing.m,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.warning + '55',
  },
  approxBannerTitle: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  approxBannerBody: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },

  modeExplain: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 16,
    marginTop: spacing.s,
    paddingHorizontal: spacing.s,
  },
  markersLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.m,
    marginTop: spacing.m,
    paddingHorizontal: spacing.m,
  },
  markerLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  markerLegendDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  markerLegendText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },

  refNoteTitle: { color: colors.success, fontWeight: '800', fontSize: 14, letterSpacing: 0.5 },
  refNoteText: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: spacing.s,
    lineHeight: 19,
  },

  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.m,
    lineHeight: 20,
  },

  /* === AI Coach Panel === */
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    marginBottom: spacing.l,
  },
  aiBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiBadgeText: {
    color: colors.textPrimary,
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 1,
  },
  aiTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  aiSub: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
    lineHeight: 16,
  },

  aiWarn: {
    padding: spacing.m,
    borderRadius: 12,
    backgroundColor: 'rgba(255,165,2,0.1)',
    borderWidth: 1,
    borderColor: colors.warning,
    marginBottom: spacing.l,
  },
  aiWarnText: {
    color: colors.warning,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  aiContextChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing.m,
  },
  aiContextChip: {
    backgroundColor: colors.primaryGlow,
    borderWidth: 1,
    borderColor: colors.primary + '66',
    paddingHorizontal: spacing.s,
    paddingVertical: 4,
    borderRadius: 8,
  },
  aiContextChipText: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  aiWarnBtn: {
    alignSelf: 'flex-start',
    marginTop: spacing.s,
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.m,
    borderRadius: 8,
    backgroundColor: colors.warning,
  },
  aiWarnBtnText: {
    color: colors.bg,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  aiResponse: {
    padding: spacing.l,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accentPurple,
    marginBottom: spacing.l,
  },
  aiResponseText: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
  },

  chatThread: {
    gap: spacing.s,
    marginBottom: spacing.m,
  },
  chatBubble: {
    paddingVertical: spacing.m,
    paddingHorizontal: spacing.m,
    borderRadius: 12,
    maxWidth: '88%',
  },
  chatBubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accentPurple + '55',
  },
  chatBubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
  },
  chatBubbleText: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  chatBubbleTextUser: {
    color: colors.textOnPrimary,
    fontWeight: '600',
  },
  chatBubbleLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
  },
  chatBubbleLoadingText: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
  },

  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.s,
    marginTop: spacing.s,
  },
  chatInput: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  chatSendBtn: {
    paddingHorizontal: spacing.m,
    height: 42,
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.accentPurple,
  },
  chatSendBtnText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },

  aiError: {
    padding: spacing.m,
    borderRadius: 12,
    backgroundColor: 'rgba(255,71,87,0.1)',
    borderWidth: 1,
    borderColor: colors.danger,
    marginBottom: spacing.m,
  },
  aiErrorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },

  aiBtn: {
    paddingVertical: 16,
    backgroundColor: colors.accentPurple,
    borderRadius: 12,
    alignItems: 'center',
  },
  aiBtnText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  aiClear: {
    paddingVertical: spacing.s,
    alignItems: 'center',
  },
  aiClearText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },

  aiHint: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: spacing.m,
  },
});
