/**
 * Replay 3D estilo Strava — Mapbox SDK nativo (@rnmapbox/maps).
 *
 * Stack escolhida pra dar cobertura ~100% de devices Android/iOS (mesma
 * tech que o Strava usa). Substitui a tentativa anterior com expo-gl +
 * react-three-fiber que crashava nativamente em alguns aparelhos.
 *
 * Features:
 *   - Terreno 3D real (Mapbox DEM v1) — montanhas, depressões, elevação
 *     visível mesmo em pistas planas pelo contexto da região
 *   - Câmera pitched ~60° estilo flyover
 *   - Estilo satellite-streets (foto aérea real com nomes de rua/track)
 *   - Polylines de cada volta sobrepostas sobre a foto
 *   - Kart marker animado (círculo lime sobre a track) na volta ativa
 *   - Câmera FOLLOWING o kart quando uma volta específica está selecionada
 *   - Marcadores de spin (anéis vermelhos) onde o detector flagou rodada
 *   - Controles play/pause + 1x/2x/4x/8x + chip por volta
 *
 * Token Mapbox:
 *   - Público (pk.*): read at runtime via EXPO_PUBLIC_MAPBOX_TOKEN.
 *     Embarcado no bundle JS — restrição via URL/bundle ID no dashboard.
 *   - Secret (sk.*): set at build time via MAPBOX_DOWNLOADS_TOKEN env.
 *     Usado pelo plugin pra baixar Mapbox SDK do maven privado deles.
 *
 * Sem token, tela mostra instrução pro usuário configurar.
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
import Mapbox, {
  Camera,
  CircleLayer,
  LineLayer,
  MapView,
  RasterDemSource,
  ShapeSource,
  Terrain,
} from '@rnmapbox/maps';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { getLapsForSession, getSession } from '../../src/storage/db';
import { detectSpins, type SpinEvent } from '../../src/lib/spinDetector';
import type { GpsSample, ImuSample } from '../../src/lib/geometry';
import { colors, spacing, typography } from '../../src/theme';

// ============================================================================
// Token — set globalmente uma vez
// ============================================================================

const MAPBOX_PUBLIC_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';
if (MAPBOX_PUBLIC_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);
}

// ============================================================================
// Tipos da cena
// ============================================================================

type SceneLap = {
  id: string;
  index: number;
  number: number;
  durationMs: number;
  isPb: boolean;
  /** [lng, lat] pares — formato GeoJSON. */
  coords: Array<[number, number]>;
  /** Timestamps alinhados com coords. */
  timestamps: number[];
  startT: number;
  endT: number;
};

type SceneData = {
  laps: SceneLap[];
  spins: Array<{ event: SpinEvent; lngLat: [number, number] }>;
  /** Centro da pista [lng, lat]. */
  center: [number, number];
};

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
  const [progress, setProgress] = useState(0);

  // Sem token = tela explicativa em vez de Map (que crasharia 401 em runtime).
  if (!MAPBOX_PUBLIC_TOKEN) {
    return <NoTokenScreen onBack={() => router.back()} />;
  }

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
          setError('Voltas dessa sessão não têm dados GPS suficientes.');
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

  // Animação do progresso 0→1 dentro da volta ativa
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
      setProgress((p) => (p + advance >= 1 ? 0 : p + advance));
    };
    const id = setInterval(tick, 16);
    return () => clearInterval(id);
  }, [playing, activeLap, speed]);

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
      <ReplayMap
        scene={scene}
        activeLap={activeLap}
        selectedLapIdx={selectedLapIdx}
        progress={progress}
      />

      {/* Top bar */}
      <View style={[s.topBar, { paddingTop: insets.top + spacing.s }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.iconBtn}>
          <Text style={s.iconBtnText}>✕</Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={s.topTitle}>REPLAY 3D</Text>
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
          <Pressable onPress={() => setPlaying((p) => !p)} style={s.playBtn}>
            <Text style={s.playBtnText}>{playing ? '⏸' : '▶'}</Text>
          </Pressable>

          <View style={{ flex: 1, marginHorizontal: spacing.m }}>
            <View style={s.progressTrack}>
              <View style={[s.progressFill, { width: `${progress * 100}%` }]} />
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
// Mapbox scene
// ============================================================================

function ReplayMap({
  scene,
  activeLap,
  selectedLapIdx,
  progress,
}: {
  scene: SceneData;
  activeLap: SceneLap;
  selectedLapIdx: number;
  progress: number;
}) {
  // GeoJSON das polylines — uma FeatureCollection com todas as voltas
  // visíveis (filtradas conforme seleção). Cada feature carrega prop
  // `lapId` + `highlighted` pro LineLayer estilizar.
  const lapsGeoJson = useMemo<FeatureCollection<LineString>>(() => {
    const visible = scene.laps.filter(
      (l) => selectedLapIdx === -1 || selectedLapIdx === l.index
    );
    return {
      type: 'FeatureCollection',
      features: visible.map<Feature<LineString>>((lap) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: lap.coords },
        properties: {
          lapId: lap.id,
          highlighted:
            selectedLapIdx === -1 ? lap.isPb : selectedLapIdx === lap.index,
          isPb: lap.isPb,
        },
      })),
    };
  }, [scene.laps, selectedLapIdx]);

  // GeoJSON do kart — Point feature que atualiza a cada tick.
  // Interpolação linear entre samples adjacentes baseada no progress.
  const kartGeoJson = useMemo<Feature<Point>>(() => {
    const targetT = activeLap.startT + progress * (activeLap.endT - activeLap.startT);
    const ts = activeLap.timestamps;
    let idx = 0;
    for (let i = 0; i < ts.length - 1; i++) {
      if (ts[i] <= targetT && targetT <= ts[i + 1]) {
        idx = i;
        break;
      }
    }
    const a = activeLap.coords[idx];
    const b = activeLap.coords[Math.min(idx + 1, activeLap.coords.length - 1)];
    const dur = ts[Math.min(idx + 1, ts.length - 1)] - ts[idx];
    const alpha = dur > 0 ? (targetT - ts[idx]) / dur : 0;
    const lng = a[0] * (1 - alpha) + b[0] * alpha;
    const lat = a[1] * (1 - alpha) + b[1] * alpha;
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {},
    };
  }, [activeLap, progress]);

  // Bearing — direção do kart, calculado do vetor entre os 2 samples adjacentes.
  // Mapbox bearing: 0=norte, 90=leste, etc.
  const bearing = useMemo(() => {
    const ts = activeLap.timestamps;
    const targetT = activeLap.startT + progress * (activeLap.endT - activeLap.startT);
    let idx = 0;
    for (let i = 0; i < ts.length - 1; i++) {
      if (ts[i] <= targetT && targetT <= ts[i + 1]) {
        idx = i;
        break;
      }
    }
    const a = activeLap.coords[idx];
    const b = activeLap.coords[Math.min(idx + 1, activeLap.coords.length - 1)];
    const dLng = b[0] - a[0];
    const dLat = b[1] - a[1];
    return (Math.atan2(dLng, dLat) * 180) / Math.PI;
  }, [activeLap, progress]);

  // GeoJSON dos spins — uma FeatureCollection de Points.
  const spinsGeoJson = useMemo<FeatureCollection<Point>>(() => {
    return {
      type: 'FeatureCollection',
      features: scene.spins.map<Feature<Point>>((sp, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: sp.lngLat },
        properties: { idx: i },
      })),
    };
  }, [scene.spins]);

  // Camera: quando "Todas" tá selecionado, fica em overview no centro.
  // Quando volta específica, segue o kart com pitch 60° (flyover).
  const isFollowing = selectedLapIdx >= 0;
  const kartCoord = kartGeoJson.geometry.coordinates as [number, number];
  const cameraCenter = isFollowing ? kartCoord : scene.center;

  return (
    <MapView
      style={s.map}
      styleURL="mapbox://styles/mapbox/satellite-streets-v12"
      logoEnabled={false}
      attributionPosition={{ bottom: 8, right: 8 }}
      pitchEnabled
      rotateEnabled
    >
      <Camera
        centerCoordinate={cameraCenter}
        zoomLevel={isFollowing ? 17 : 16}
        pitch={isFollowing ? 60 : 0}
        heading={isFollowing ? bearing : 0}
        animationDuration={isFollowing ? 800 : 1500}
        animationMode="flyTo"
      />

      {/* Terreno 3D do Mapbox — DEM v1, exagero 1.2 pra ficar mais visível
       * em pistas relativamente planas. Em terreno montanhoso fica mais
       * dramático. */}
      <RasterDemSource
        id="dem"
        url="mapbox://mapbox.mapbox-terrain-dem-v1"
        tileSize={512}
        maxZoomLevel={14}
      >
        <Terrain sourceID="dem" exaggeration={1.2} />
      </RasterDemSource>

      {/* Polylines de cada volta — uma só ShapeSource, LineLayer pinta
       * por prop `highlighted` (case do Mapbox style spec). */}
      <ShapeSource id="laps" shape={lapsGeoJson}>
        <LineLayer
          id="lapsLine"
          style={{
            lineColor: [
              'case',
              ['get', 'highlighted'],
              '#00FF88',
              ['get', 'isPb'],
              '#A8CC2E',
              '#3A506B',
            ],
            lineWidth: ['case', ['get', 'highlighted'], 5, 2.5],
            lineOpacity: ['case', ['get', 'highlighted'], 1, 0.6],
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </ShapeSource>

      {/* Marcadores de spin — anel vermelho duplo */}
      <ShapeSource id="spins" shape={spinsGeoJson}>
        <CircleLayer
          id="spinsHalo"
          style={{
            circleRadius: 18,
            circleColor: '#FF4757',
            circleOpacity: 0.18,
          }}
        />
        <CircleLayer
          id="spinsCore"
          style={{
            circleRadius: 8,
            circleColor: 'transparent',
            circleStrokeColor: '#FF4757',
            circleStrokeWidth: 3,
          }}
        />
      </ShapeSource>

      {/* Kart marker — circulinho lime com halo */}
      <ShapeSource id="kart" shape={kartGeoJson}>
        <CircleLayer
          id="kartHalo"
          style={{
            circleRadius: 14,
            circleColor: '#D4FF3A',
            circleOpacity: 0.25,
          }}
        />
        <CircleLayer
          id="kartDot"
          style={{
            circleRadius: 7,
            circleColor: '#D4FF3A',
            circleStrokeColor: '#08080C',
            circleStrokeWidth: 2,
          }}
        />
      </ShapeSource>
    </MapView>
  );
}

// ============================================================================
// Sem-token screen
// ============================================================================

function NoTokenScreen({ onBack }: { onBack: () => void }) {
  return (
    <View style={s.centerRoot}>
      <View style={s.centerBox}>
        <Text style={s.errorTitle}>Mapbox não configurado</Text>
        <Text style={s.errorBody}>
          O replay 3D usa o Mapbox SDK (mesma tech do Strava). Pra ativar:{'\n\n'}
          1. Cria conta em mapbox.com (free){'\n'}
          2. Gera um token público (pk.*) no dashboard{'\n'}
          3. Setar como EXPO_PUBLIC_MAPBOX_TOKEN no env do build{'\n'}
          4. Gera token secret (sk.*) com scope Downloads:Read,{'\n'}
          {'   '}setar como MAPBOX_DOWNLOADS_TOKEN no EAS{'\n'}
          5. Rebuild do APK
        </Text>
        <Pressable onPress={onBack} style={s.backBtn}>
          <Text style={s.backBtnText}>Voltar</Text>
        </Pressable>
      </View>
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
// Helpers
// ============================================================================

/**
 * Tempo no formato padrão MM:SS.SSS (minuto:segundo.milésimo).
 * Centésimos embutidos nos 2 primeiros dígitos do milésimo.
 */
function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00.000';
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
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

  const bestLap = rawLaps.reduce(
    (b, l) => (l.durationMs < b.durationMs ? l : b),
    rawLaps[0]
  );

  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  const sceneLaps: SceneLap[] = rawLaps.map((lap, idx) => {
    const step = Math.max(1, Math.floor(lap.samples.length / 400));
    const samples = lap.samples.filter((_, i) => i % step === 0);
    const coords: Array<[number, number]> = [];
    const timestamps: number[] = [];
    samples.forEach((s) => {
      coords.push([s.lng, s.lat]);
      timestamps.push(s.t);
      if (s.lng < minLng) minLng = s.lng;
      if (s.lng > maxLng) maxLng = s.lng;
      if (s.lat < minLat) minLat = s.lat;
      if (s.lat > maxLat) maxLat = s.lat;
    });
    return {
      id: lap.id,
      index: idx,
      number: idx + 1,
      durationMs: lap.durationMs,
      isPb: lap.id === bestLap.id,
      coords,
      timestamps,
      startT: timestamps[0],
      endT: timestamps[timestamps.length - 1],
    };
  });

  const spins: SceneData['spins'] = [];
  for (const lap of rawLaps) {
    const events = detectSpins(lap.samples, lap.imuSamples);
    for (const ev of events) {
      spins.push({ event: ev, lngLat: [ev.lng, ev.lat] });
    }
  }

  return {
    laps: sceneLaps,
    spins,
    center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
  };
}

// ============================================================================
// Styles
// ============================================================================

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#08080C' },
  map: { flex: 1 },
  centerRoot: {
    flex: 1,
    backgroundColor: '#08080C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBox: {
    alignItems: 'center',
    padding: spacing.xl,
    maxWidth: 380,
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
    marginBottom: spacing.m,
  },
  errorBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'left',
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
    backgroundColor: 'rgba(8,8,12,0.55)',
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  iconBtnText: { color: colors.textPrimary, fontSize: 22 },
  topTitle: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
  },
  topSub: { color: '#E5E5E5', fontSize: 11, marginTop: 2 },

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
    backgroundColor: 'rgba(16,16,24,0.9)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipPb: { borderColor: colors.success + '88' },
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
  bottomRow: { flexDirection: 'row', alignItems: 'center' },
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
  progressFill: { height: '100%', backgroundColor: colors.primary },
  progressLabel: {
    color: '#E5E5E5',
    fontSize: 10,
    marginTop: 4,
    ...typography.mono,
  },
  speedRow: { flexDirection: 'row', gap: 4 },
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
