/**
 * Replay 2D top-down da sessão — rendering via react-native-svg.
 *
 * Substituição da versão 3D anterior (expo-gl + react-three-fiber) que
 * crashava nativamente em alguns devices. SVG é rock-solid em qualquer
 * Android/iOS, custo zero de inicialização, suficiente pra visualizar
 * o que importa: traçado, voltas comparativas, kart se movendo,
 * marcadores de rodada.
 *
 * O que tem:
 *   - Todas as voltas renderizadas como polylines coloridas. PB destacada
 *     em verde brilhante, outras em cinza.
 *   - Kart marker (círculo lime) anima no traçado da volta selecionada,
 *     com pequena seta indicando direção (calculada do vetor entre
 *     samples consecutivos).
 *   - Marcadores vermelhos pulsantes nos pontos onde rolou rodada
 *     (detectados via detectSpins — IMU se houver, fallback GPS).
 *   - Filtro de voltas (Todas / Lap N) e controles play/pause/speed.
 *
 * O que NÃO tem (vs versão 3D):
 *   - Perspectiva 3D / câmera flyover → trade-off pela estabilidade
 *   - Visualização de altitude
 *   - Rotação do kart durante spin → ainda mostra o ponto, mas
 *     o ícone do kart segue o traçado normalmente
 *
 * Re-introduzir 3D depois via Mapbox SDK (@rnmapbox/maps) que é mais
 * robusto que expo-gl em devices variados.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, G, Line as SvgLine } from 'react-native-svg';
import {
  getLapsForSession,
  getSession,
} from '../../src/storage/db';
import {
  makeLocalProjector,
  type GpsSample,
  type ImuSample,
} from '../../src/lib/geometry';
import { detectSpins, type SpinEvent } from '../../src/lib/spinDetector';
import { colors, spacing, typography } from '../../src/theme';

// ============================================================================
// Tipos
// ============================================================================

type SceneLap = {
  id: string;
  index: number;
  number: number;
  durationMs: number;
  isPb: boolean;
  /** Pontos projetados em metros desde origem (x, y). */
  points: Array<{ x: number; y: number; t: number }>;
  startT: number;
  endT: number;
};

type SceneData = {
  laps: SceneLap[];
  spins: Array<{ event: SpinEvent; pt: { x: number; y: number } }>;
  /** Bounding box em metros pra escalar pro viewport. */
  bbox: { minX: number; maxX: number; minY: number; maxY: number };
};

// ============================================================================
// Helpers
// ============================================================================

function fmtTime(ms: number): string {
  if (ms < 60000) return (ms / 1000).toFixed(2);
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function buildScene(
  rawLapsIn: Array<{
    id: string;
    samples: GpsSample[];
    imuSamples?: ImuSample[];
    durationMs: number;
    startedAt: number;
  }>
): SceneData | null {
  // Sanitiza voltas — filtra samples corrompidos antes de processar.
  const rawLaps = rawLapsIn
    .map((l) => ({
      ...l,
      samples: l.samples.filter(
        (s) =>
          Number.isFinite(s.lat) &&
          Number.isFinite(s.lng) &&
          Number.isFinite(s.t)
      ),
    }))
    .filter((l) => l.samples.length >= 2);
  if (rawLaps.length === 0) return null;

  const origin = { lat: rawLaps[0].samples[0].lat, lng: rawLaps[0].samples[0].lng };
  const projector = makeLocalProjector(origin);

  const bestLap = rawLaps.reduce(
    (b, l) => (l.durationMs < b.durationMs ? l : b),
    rawLaps[0]
  );

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const sceneLaps: SceneLap[] = rawLaps.map((lap, idx) => {
    // Decimação leve — se passa de 400, intervala. Pra SVG, perfil de
    // 200-400 pontos por polyline é confortável.
    const step = Math.max(1, Math.floor(lap.samples.length / 400));
    const samples = lap.samples.filter((_, i) => i % step === 0);
    const points = samples.map((s) => {
      const xy = projector.toXY(s);
      if (xy.x < minX) minX = xy.x;
      if (xy.x > maxX) maxX = xy.x;
      if (xy.y < minY) minY = xy.y;
      if (xy.y > maxY) maxY = xy.y;
      return { x: xy.x, y: xy.y, t: s.t };
    });
    return {
      id: lap.id,
      index: idx,
      number: idx + 1,
      durationMs: lap.durationMs,
      isPb: lap.id === bestLap.id,
      points,
      startT: points[0].t,
      endT: points[points.length - 1].t,
    };
  });

  // Spins — detecta e projeta
  const spins: SceneData['spins'] = [];
  for (const lap of rawLaps) {
    const events = detectSpins(lap.samples, lap.imuSamples);
    for (const ev of events) {
      const xy = projector.toXY({ lat: ev.lat, lng: ev.lng });
      spins.push({ event: ev, pt: { x: xy.x, y: xy.y } });
    }
  }

  return {
    laps: sceneLaps,
    spins,
    bbox: { minX, maxX, minY, maxY },
  };
}

/**
 * Constrói o atributo `d` de um <Path> SVG a partir de pontos em XY.
 * Aplica transform de XY→viewport.
 */
function pointsToPath(
  points: Array<{ x: number; y: number }>,
  tx: (x: number) => number,
  ty: (y: number) => number
): string {
  if (points.length === 0) return '';
  let d = `M ${tx(points[0].x).toFixed(1)} ${ty(points[0].y).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${tx(points[i].x).toFixed(1)} ${ty(points[i].y).toFixed(1)}`;
  }
  return d;
}

// ============================================================================
// Page
// ============================================================================

export default function ReplayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [scene, setScene] = useState<SceneData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackName, setTrackName] = useState<string>('—');
  const [selectedLapIdx, setSelectedLapIdx] = useState<number>(-1);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<1 | 2 | 4 | 8>(2);
  const [progress, setProgress] = useState(0); // 0..1 dentro da volta ativa

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const [session, lapsRaw] = await Promise.all([
          getSession(id),
          getLapsForSession(id),
        ]);
        if (cancelled) return;
        if (!session) {
          setError('Sessão não encontrada');
          return;
        }
        setTrackName(session.trackName ?? '—');
        if (lapsRaw.length === 0) {
          setError('Nenhuma volta gravada nessa sessão');
          return;
        }
        const built = buildScene(lapsRaw);
        if (cancelled) return;
        if (!built) {
          setError(
            'Voltas dessa sessão não têm dados GPS suficientes pra renderizar (muito antigas ou corrompidas).'
          );
          return;
        }
        setScene(built);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Erro ao carregar replay');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const activeLap = useMemo(() => {
    if (!scene) return null;
    if (selectedLapIdx >= 0) return scene.laps[selectedLapIdx] ?? null;
    return scene.laps.find((l) => l.isPb) ?? scene.laps[0];
  }, [scene, selectedLapIdx]);

  // Animação do progresso — useEffect com setInterval simples (60fps).
  // SVG não tem useFrame, então rolamos no JS. Pra 200-400 samples cada,
  // re-render a 60Hz é tranquilo no RN.
  const lastTickRef = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || !activeLap) {
      lastTickRef.current = null;
      return;
    }
    const tick = () => {
      const now = Date.now();
      if (lastTickRef.current === null) {
        lastTickRef.current = now;
        return;
      }
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;
      const advance = (dt * speed) / activeLap.durationMs;
      setProgress((p) => {
        const next = p + advance;
        return next >= 1 ? 0 : next;
      });
    };
    const id = setInterval(tick, 16); // ~60Hz
    return () => clearInterval(id);
  }, [playing, activeLap, speed]);

  // Reset progresso quando troca volta selecionada
  useEffect(() => {
    setProgress(0);
    lastTickRef.current = null;
  }, [selectedLapIdx]);

  if (error) {
    return (
      <View style={s.centerRoot}>
        <View style={s.centerBox}>
          <Text style={s.errorTitle}>Replay indisponível</Text>
          <Text style={s.errorBody}>{error}</Text>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <Text style={s.backBtnText}>Voltar</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!scene || !activeLap) {
    return (
      <View style={s.centerRoot}>
        <ActivityIndicator color={colors.primary} />
        <Text style={s.loadingText}>Preparando replay…</Text>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <ReplayCanvas
        scene={scene}
        activeLap={activeLap}
        progress={progress}
        selectedLapIdx={selectedLapIdx}
        insets={insets}
      />

      {/* Top bar */}
      <View style={[s.topBar, { paddingTop: insets.top + spacing.s }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.iconBtn}>
          <Text style={s.iconBtnText}>✕</Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={s.topTitle}>REPLAY</Text>
          <Text style={s.topSub}>
            {trackName} · {scene.laps.length} volta(s)
            {scene.spins.length > 0 && ` · ${scene.spins.length} rodada(s)`}
          </Text>
        </View>
        <View style={s.iconBtn} />
      </View>

      {/* Lap chips */}
      <View style={[s.lapBar, { top: insets.top + 60 }]}>
        <LapChip
          label="Todas"
          active={selectedLapIdx === -1}
          onPress={() => setSelectedLapIdx(-1)}
        />
        {scene.laps.map((lap) => (
          <LapChip
            key={lap.id}
            label={`L${lap.number}${lap.isPb ? ' ⭐' : ''}`}
            active={selectedLapIdx === lap.index}
            onPress={() => setSelectedLapIdx(lap.index)}
            pb={lap.isPb}
          />
        ))}
      </View>

      {/* Bottom controls */}
      <View style={[s.bottomBar, { paddingBottom: insets.bottom + spacing.m }]}>
        <View style={s.bottomRow}>
          <Pressable
            onPress={() => setPlaying((p) => !p)}
            style={s.playBtn}
          >
            <Text style={s.playBtnText}>{playing ? '⏸' : '▶'}</Text>
          </Pressable>

          <View style={{ flex: 1, marginHorizontal: spacing.m }}>
            <View style={s.progressTrack}>
              <View
                style={[s.progressFill, { width: `${progress * 100}%` }]}
              />
            </View>
            <Text style={s.progressLabel}>
              Volta {activeLap.number} · {fmtTime(progress * activeLap.durationMs)} /{' '}
              {fmtTime(activeLap.durationMs)}
            </Text>
          </View>

          <View style={s.speedRow}>
            {([1, 2, 4, 8] as const).map((sp) => (
              <Pressable
                key={sp}
                onPress={() => setSpeed(sp)}
                style={[s.speedChip, speed === sp && s.speedChipActive]}
              >
                <Text
                  style={[s.speedChipText, speed === sp && s.speedChipTextActive]}
                >
                  {sp}x
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

// ============================================================================
// Canvas SVG
// ============================================================================

function ReplayCanvas({
  scene,
  activeLap,
  progress,
  selectedLapIdx,
  insets,
}: {
  scene: SceneData;
  activeLap: SceneLap;
  progress: number;
  selectedLapIdx: number;
  insets: { top: number; bottom: number; left: number; right: number };
}) {
  // Viewport SVG — usa viewBox virtual com aspect ratio da pista.
  // O React Native escala isso pro tamanho da View automaticamente.
  const W = 1000;
  const H = 700;
  const PADDING = 60;

  const { tx, ty } = useMemo(() => {
    const { minX, maxX, minY, maxY } = scene.bbox;
    const dx = maxX - minX || 1;
    const dy = maxY - minY || 1;
    const scale = Math.min((W - PADDING * 2) / dx, (H - PADDING * 2) / dy);
    const offsetX = (W - dx * scale) / 2;
    const offsetY = (H - dy * scale) / 2;
    return {
      tx: (x: number) => offsetX + (x - minX) * scale,
      // Inverte Y (norte vai pra cima no SVG, mas Y do SVG cresce pra baixo)
      ty: (y: number) => H - (offsetY + (y - minY) * scale),
    };
  }, [scene.bbox]);

  // Posição interpolada do kart na volta ativa
  const kart = useMemo(() => {
    const targetT = activeLap.startT + progress * (activeLap.endT - activeLap.startT);
    const pts = activeLap.points;
    // Binary search seria mais rápido, mas pra 400 pontos linear é OK
    let idx = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      if (pts[i].t <= targetT && targetT <= pts[i + 1].t) {
        idx = i;
        break;
      }
    }
    const a = pts[idx];
    const b = pts[Math.min(idx + 1, pts.length - 1)];
    const dur = b.t - a.t;
    const alpha = dur > 0 ? (targetT - a.t) / dur : 0;
    const x = a.x * (1 - alpha) + b.x * alpha;
    const y = a.y * (1 - alpha) + b.y * alpha;
    // Heading do vetor entre samples
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return { x, y, dx, dy };
  }, [activeLap, progress]);

  return (
    <View style={s.canvas}>
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Polylines de todas as voltas */}
        {scene.laps.map((lap) => {
          const visible = selectedLapIdx === -1 || selectedLapIdx === lap.index;
          if (!visible) return null;
          const highlighted =
            selectedLapIdx === -1 ? lap.isPb : selectedLapIdx === lap.index;
          const color = highlighted
            ? '#00FF88'
            : lap.isPb
              ? '#A8CC2E'
              : '#3A506B';
          return (
            <Path
              key={lap.id}
              d={pointsToPath(lap.points, tx, ty)}
              stroke={color}
              strokeWidth={highlighted ? 4 : 2}
              strokeOpacity={highlighted ? 1 : 0.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

        {/* Marcadores de spin */}
        {scene.spins.map((sp, i) => (
          <G key={i}>
            <Circle
              cx={tx(sp.pt.x)}
              cy={ty(sp.pt.y)}
              r={18}
              fill="#FF4757"
              fillOpacity={0.15}
            />
            <Circle
              cx={tx(sp.pt.x)}
              cy={ty(sp.pt.y)}
              r={10}
              stroke="#FF4757"
              strokeWidth={2.5}
              fill="none"
            />
          </G>
        ))}

        {/* Kart marker — círculo lime com setinha de direção */}
        <G>
          <Circle
            cx={tx(kart.x)}
            cy={ty(kart.y)}
            r={14}
            fill="#D4FF3A"
            fillOpacity={0.25}
          />
          <Circle
            cx={tx(kart.x)}
            cy={ty(kart.y)}
            r={7}
            fill="#D4FF3A"
            stroke="#08080C"
            strokeWidth={2}
          />
          {/* Linha de direção — vetor até o próximo ponto */}
          <SvgLine
            x1={tx(kart.x)}
            y1={ty(kart.y)}
            x2={tx(kart.x + kart.dx * 3)}
            y2={ty(kart.y + kart.dy * 3)}
            stroke="#D4FF3A"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        </G>
      </Svg>
    </View>
  );
}

// ============================================================================
// UI bits
// ============================================================================

function LapChip({
  label,
  active,
  onPress,
  pb,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  pb?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.chip, active && s.chipActive, pb && !active && s.chipPb]}
    >
      <Text
        style={[
          s.chipText,
          active && s.chipTextActive,
          pb && !active && s.chipTextPb,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ============================================================================
// Styles
// ============================================================================

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#08080C' },
  canvas: { flex: 1, backgroundColor: '#0F0F18' },
  centerRoot: {
    flex: 1,
    backgroundColor: '#08080C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBox: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: spacing.m,
  },
  errorTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: spacing.s,
  },
  errorBody: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.l,
  },
  backBtn: {
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  backBtnText: { color: colors.textPrimary, fontWeight: '700' },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.s,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  iconBtnText: { color: colors.textPrimary, fontSize: 22 },
  topTitle: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
  },
  topSub: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },

  lapBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: spacing.l,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(16,16,24,0.85)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipPb: {
    borderColor: colors.success + '88',
  },
  chipText: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
  chipTextActive: { color: '#08080C' },
  chipTextPb: { color: colors.success },

  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.l,
    paddingTop: spacing.m,
    backgroundColor: 'rgba(8,8,12,0.85)',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnText: { color: '#08080C', fontSize: 20, fontWeight: '900' },
  progressTrack: {
    height: 4,
    backgroundColor: colors.surface,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  progressLabel: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 4,
    ...typography.mono,
  },
  speedRow: {
    flexDirection: 'row',
    gap: 4,
  },
  speedChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 32,
    alignItems: 'center',
  },
  speedChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  speedChipText: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
  speedChipTextActive: { color: '#08080C' },
});
