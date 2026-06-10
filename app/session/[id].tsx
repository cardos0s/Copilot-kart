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
} from '../../src/components/ColoredTrackPath';
import {
  Card,
  Metric,
  PillTabs,
  ScreenHeader,
  StatRow,
} from '../../src/components/ui';
import { colors, radius, spacing, typography } from '../../src/theme';

// react-native-maps removido — crashava no Android sem Google Maps API key,
// e a silhueta SVG com markers de eventos é mais legível pro caso de uso
// de análise de volta (sem fotos de satélite a distrair).

type ViewMode = 'comparar' | 'setores' | 'mapa';
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
      // try/finally garante que setLoading(false) sempre dispara, mesmo se
      // qualquer await abaixo lançar. Sem isso a tela ficava em "carregando"
      // pra sempre quando uma sessão antiga tinha layout/track inválido.
      try {
        const ses = await getSession(id).catch(() => null);
        const lapsRaw = await getLapsForSession(id).catch(() => []);

        // Prioriza o layout explicitamente gravado na sessão; se nada vier
        // (sessões antigas pré-layout, ou sem trackId), cai pro default da pista.
        let ref: TrackLayout | null = null;
        if (ses?.layoutId) {
          ref = await getLayout(ses.layoutId).catch(() => null);
        }
        if (!ref && ses?.trackId) {
          ref = await getDefaultLayoutForTrack(ses.trackId).catch(() => null);
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
      } finally {
        setLoading(false);
      }
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
      return {
        kind: 'ok',
        sessionBest,
        useExternalRef,
        refSamples,
        refDurationMs,
        selected,
        refLap,
        corners,
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

  // Tap em setor → vai pro mapa naquele ponto
  const handleSectorTap = (idx: number) => {
    setFocusedSectorIdx(idx);
    setMode('mapa');
    // Scroll-to-top do conteúdo pra deixar mapa visível
    requestAnimationFrame(() => {
      mapScrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  };

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
        <View style={s.compareRow}>
          <Card variant="elevated" padding="m" style={{ flex: 1 }}>
            <Metric
              label="MELHOR VOLTA"
              value={fmtLap(refDurationMs)}
              hint={useExternalRef ? 'referência da pista' : `Volta ${lapIndex(laps, sessionBest)}`}
              tone="success"
              size="m"
            />
          </Card>
          <Card variant="elevated" padding="m" style={{ flex: 1 }}>
            <Metric
              label="VOLTA ATUAL"
              value={fmtLap(selected.durationMs)}
              hint={`Volta ${lapIndex(laps, selected)}`}
              tone="magenta"
              size="m"
            />
          </Card>
        </View>

        {!isSelectedReference && analysis && (
          <View style={{ paddingHorizontal: spacing.l, marginTop: spacing.m }}>
            <Card variant="default" padding="m">
              <View style={{ alignItems: 'center' }}>
                <Text style={s.deltaLabel}>DIFERENÇA</Text>
                <Text
                  style={[
                    s.deltaValue,
                    typography.mono,
                    { color: analysis.totalDeltaMs > 0 ? colors.danger : colors.success },
                  ]}
                >
                  {fmtDelta(analysis.totalDeltaMs)}
                </Text>
              </View>
            </Card>
          </View>
        )}

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
                style={[s.lapChip, isSel && s.lapChipActive, isRef && s.lapChipRef]}
                onPress={() => handleSelectLap(lap.id)}
              >
                <Text style={[s.lapChipIdx, isSel && s.lapChipIdxActive]}>V{i + 1}</Text>
                <Text style={[s.lapChipTime, typography.mono]}>{fmtLap(lap.durationMs)}</Text>
                {isRef ? (
                  <Text style={s.lapChipBadge}>★</Text>
                ) : (
                  <Text
                    style={[
                      s.lapChipDelta,
                      typography.mono,
                      { color: delta > 0 ? colors.danger : colors.success },
                    ]}
                  >
                    {fmtDelta(delta)}
                  </Text>
                )}
                {peakKmh > 0 && (
                  <Text style={[s.lapChipSpeed, typography.mono]}>{peakKmh.toFixed(0)} km/h</Text>
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
            refDurationMs={refDurationMs}
            selectedDurationMs={selected.durationMs}
            isSelectedReference={isSelectedReference}
            refPeakKmh={msToKmh(peakSpeedMs(refSamples))}
            selectedPeakKmh={msToKmh(peakSpeedMs(selected.samples))}
          />
        )}

        {mode === 'setores' && (
          <SectorsPanel
            sectors={sectors}
            maxAbsDelta={maxAbsDelta}
            corners={corners}
            matchedCurrent={matchedCurrent}
            onSectorTap={handleSectorTap}
          />
        )}

        {mode === 'mapa' && (
          <MapPanel
            selected={selected}
            sectors={sectors}
            matchedCurrent={matchedCurrent}
            refLap={refLap}
            isSelectedReference={isSelectedReference}
            maxAbsDelta={maxAbsDelta}
            refSamples={refSamples}
            corners={corners}
            colorMode={colorMode}
            onColorModeChange={setColorMode}
            focusedSectorIdx={focusedSectorIdx}
            onClearFocus={() => setFocusedSectorIdx(null)}
            onExpandRequest={() => setMapFullscreen(true)}
            onOpenDetailedMap={() =>
              router.push({
                pathname: '/track-map' as any,
                params: { sessionId: id, lapId: selected.id },
              })
            }
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

function ComparePanel({
  sectors,
  refDurationMs,
  selectedDurationMs,
  isSelectedReference,
  refPeakKmh,
  selectedPeakKmh,
}: {
  sectors: any[];
  refDurationMs: number;
  selectedDurationMs: number;
  isSelectedReference: boolean;
  refPeakKmh: number;
  selectedPeakKmh: number;
}) {
  if (isSelectedReference) {
    return (
      <View style={{ paddingHorizontal: spacing.l, paddingTop: spacing.l }}>
        <Card variant="glow" padding="l">
          <Text style={s.refNoteTitle}>★ Melhor volta da sessão</Text>
          <Text style={s.refNoteText}>
            Selecione outra volta pra ver onde ela perdeu tempo comparada a esta.
          </Text>
        </Card>
      </View>
    );
  }
  if (sectors.length === 0) return null;

  const third = Math.ceil(sectors.length / 3);
  // Agrupa os mini-setores em S1/S2/S3 (terços da pista). Setores inválidos
  // (sec.valid === false) têm currentMs=0 e delta=0 — ignorá-los na soma
  // evita mostrar "00:00.000" enganoso pro piloto quando o map-matching da
  // volta atual saiu degenerado naquela região. Se TODOS os setores do
  // terço são inválidos, devolvemos null e a UI renderiza "—".
  const groups = [0, 1, 2].map((g) => {
    const slice = sectors.slice(g * third, (g + 1) * third);
    if (slice.length === 0) {
      return { best: null as number | null, current: null as number | null, delta: null as number | null };
    }
    const validSlice = slice.filter((sec) => sec.valid !== false);
    const refSum = slice.reduce((a, sec) => a + (sec.referenceMs ?? 0), 0);
    if (validSlice.length === 0) {
      // Terço todo sem dados confiáveis — mostra "—" no atual e na diferença,
      // mas ainda exibe o tempo da referência (esse é confiável).
      return { best: refSum, current: null, delta: null };
    }
    const curSum = validSlice.reduce((a, sec) => a + (sec.currentMs ?? 0), 0);
    return { best: refSum, current: curSum, delta: curSum - refSum };
  });

  return (
    <View style={{ paddingHorizontal: spacing.l, paddingTop: spacing.l }}>
      <Card variant="elevated" padding="m">
        <StatRow
          header
          cells={[
            { text: 'Setor', align: 'left' },
            { text: 'Melhor', align: 'right' },
            { text: 'Atual', align: 'right' },
            { text: 'Dif', align: 'right' },
          ]}
          weights={[1, 1.4, 1.4, 1]}
        />
        {groups.map((g, i) => (
          <StatRow
            key={i}
            weights={[1, 1.4, 1.4, 1]}
            cells={[
              { text: `S${i + 1}`, tone: 'muted', align: 'left' },
              { text: g.best != null ? fmtLap(g.best) : '—', tone: 'success', align: 'right' },
              { text: g.current != null ? fmtLap(g.current) : '—', tone: 'magenta', align: 'right' },
              {
                text: g.delta != null ? fmtDelta(g.delta) : '—',
                tone: g.delta == null ? 'muted' : g.delta > 0 ? 'danger' : 'success',
                align: 'right',
              },
            ]}
          />
        ))}
        <StatRow
          weights={[1, 1.4, 1.4, 1]}
          cells={[
            { text: 'TOTAL', tone: 'muted', align: 'left' },
            { text: fmtLap(refDurationMs), tone: 'success', align: 'right' },
            { text: fmtLap(selectedDurationMs), tone: 'magenta', align: 'right' },
            {
              text: fmtDelta(selectedDurationMs - refDurationMs),
              tone: selectedDurationMs - refDurationMs > 0 ? 'danger' : 'success',
              align: 'right',
            },
          ]}
        />
        {refPeakKmh > 0 && selectedPeakKmh > 0 && (
          <StatRow
            weights={[1, 1.4, 1.4, 1]}
            cells={[
              { text: 'PICO km/h', tone: 'muted', align: 'left' },
              { text: refPeakKmh.toFixed(0), tone: 'cyan', align: 'right' },
              { text: selectedPeakKmh.toFixed(0), tone: 'cyan', align: 'right' },
              {
                text:
                  (selectedPeakKmh - refPeakKmh >= 0 ? '+' : '') +
                  (selectedPeakKmh - refPeakKmh).toFixed(0),
                tone: selectedPeakKmh - refPeakKmh >= 0 ? 'success' : 'danger',
                align: 'right',
              },
            ]}
          />
        )}
      </Card>
    </View>
  );
}

function SectorsPanel({
  sectors,
  maxAbsDelta,
  corners,
  matchedCurrent,
  onSectorTap,
}: {
  sectors: any[];
  maxAbsDelta: number;
  corners: Corner[];
  matchedCurrent: any;
  onSectorTap: (idx: number) => void;
}) {
  if (sectors.length === 0) {
    return (
      <View style={{ paddingHorizontal: spacing.l, paddingTop: spacing.l }}>
        <Text style={s.emptyText}>Selecione uma volta diferente da melhor pra ver setores.</Text>
      </View>
    );
  }

  // Só setores VÁLIDOS entram nos rankings — setores sem dados (curMs=0) ou
  // com tempo anômalo (pit-in) iriam dominar com deltas falsos.
  const validSectors = sectors.filter((sec) => sec.valid !== false);
  const invalidCount = sectors.length - validSectors.length;

  // Se TODOS os setores foram filtrados, é um problema. Em vez de listas vazias,
  // mostra os setores brutos com aviso "dados sem confiança alta". Isso evita
  // tela em branco e permite diagnosticar o que tá acontecendo.
  const useSectorsForRanking = validSectors.length >= 3 ? validSectors : sectors;
  const showLowConfidenceWarning = validSectors.length < 3;

  const sorted = [...useSectorsForRanking].sort((a, b) => b.deltaMs - a.deltaMs);
  const worst = sorted.slice(0, 5);
  const best = [...useSectorsForRanking].sort((a, b) => a.deltaMs - b.deltaMs).slice(0, 3);

  return (
    <View style={{ paddingHorizontal: spacing.l, paddingTop: spacing.l }}>
      {showLowConfidenceWarning && (
        <View style={s.outLapWarn}>
          <Text style={s.outLapTitle}>Confiança baixa</Text>
          <Text style={s.outLapBody}>
            Muitos setores ({invalidCount}/{sectors.length}) tiveram dados anômalos — pode ser
            out-lap, trechos parados ou problema de GPS. Os números abaixo podem não refletir
            sua pilotagem real.
          </Text>
        </View>
      )}
      {!showLowConfidenceWarning && invalidCount > 0 && (
        <Text style={s.partialNote}>
          {invalidCount} setor{invalidCount === 1 ? '' : 'es'} descartado{invalidCount === 1 ? '' : 's'} (sem dados confiáveis).
        </Text>
      )}
      <Text style={s.sectionTitle}>Onde perdeu tempo</Text>
      {worst.map((sec) => (
        <SectorCard
          key={sec.index}
          sec={sec}
          maxAbsDelta={maxAbsDelta}
          corners={corners}
          matchedCurrent={matchedCurrent}
          onPress={() => onSectorTap(sec.index)}
          negative
        />
      ))}

      <Text style={[s.sectionTitle, { marginTop: spacing.xl }]}>Onde ganhou tempo</Text>
      {best.map((sec) => (
        <SectorCard
          key={sec.index}
          sec={sec}
          maxAbsDelta={maxAbsDelta}
          corners={corners}
          matchedCurrent={matchedCurrent}
          onPress={() => onSectorTap(sec.index)}
        />
      ))}

      <Text style={s.hint}>Toque em um setor pra ver no mapa.</Text>
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
          s.sectorDelta,
          typography.mono,
          { color: sec.deltaMs > 0 ? colors.danger : colors.success },
        ]}
      >
        {fmtDelta(sec.deltaMs)}
      </Text>
    </Pressable>
  );
}

function MapPanel({
  selected,
  sectors,
  matchedCurrent,
  refLap,
  isSelectedReference,
  maxAbsDelta,
  refSamples,
  corners,
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
        />
      </Card>

      {/* Legenda dos markers */}
      <View style={s.markersLegend}>
        <MarkerLegendItem color={colors.accentCyan} label="P · pico de velocidade" />
        <MarkerLegendItem color={colors.warning} label="B · freada mais forte" />
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

  lapChip: {
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.m,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 92,
    alignItems: 'center',
  },
  lapChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryGlow },
  lapChipRef: { borderColor: colors.success },
  lapChipIdx: { color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  lapChipIdxActive: { color: colors.primary },
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
  sectorDelta: { fontSize: 17, fontWeight: '900', marginLeft: spacing.m, letterSpacing: -0.5 },
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
