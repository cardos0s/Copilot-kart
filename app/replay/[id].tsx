/**
 * Replay 3D da sessão — visualização pós-pista com react-three-fiber.
 *
 * Funcionalidades:
 *   - Renderiza todas as voltas como polylines coloridas sobre uma "pista"
 *     plana. PB destacada (verde brilhante), outras voltas em cinza/azul
 *     diferenciadas por matiz.
 *   - Kartzinho 3D (cuboide simples) anima ao longo de uma volta
 *     escolhida (ou da PB se "todas" estiver selecionado).
 *   - Marcadores de rodadas (spin events) nos pontos onde aconteceram —
 *     anéis vermelhos pulsantes na pista. Detector usa IMU quando há,
 *     senão fallback GPS-only.
 *   - Controles: play/pause, velocidade do replay (1x/2x/4x/8x), filtro
 *     de voltas, reset de câmera.
 *
 * Coordenadas:
 *   - GPS lat/lng → projetado pra ENU local (metros) via makeLocalProjector
 *   - Three.js usa Y como "pra cima"; mapeamos GPS y (norte) → scene z,
 *     altitude → scene y. Resultado: olhar de cima vê a pista como um
 *     mapa, e altitude (pra pista plana de kart, ~constante) vira "subida"
 *     visível em terrenos com elevação.
 *
 * Performance:
 *   - Polylines criadas uma vez via BufferGeometry; não recriadas a
 *     cada frame.
 *   - Kart animado em useFrame (60Hz idealmente) com índice interpolado
 *     entre samples por timestamp.
 *   - Decimação: se uma volta tem >300 samples, intervala — pra mobile
 *     GPU sobreviver.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas, useFrame } from '@react-three/fiber/native';
import * as THREE from 'three';
import { getLapsForSession, getSession } from '../../src/storage/db';
import {
  makeLocalProjector,
  type GpsSample,
  type ImuSample,
} from '../../src/lib/geometry';
import { detectSpins, type SpinEvent } from '../../src/lib/spinDetector';
import { colors, spacing, typography } from '../../src/theme';

// ============================================================================
// Tipos de dado preparado pra cena
// ============================================================================

type SceneLap = {
  id: string;
  index: number; // 0-based
  number: number; // 1-based, pra UI
  durationMs: number;
  isPb: boolean;
  /** Float32Array intercalado [x,y,z, x,y,z, ...] em metros desde origem. */
  positions: Float32Array;
  /** Timestamps alinhados com positions (1 timestamp por ponto). */
  timestamps: number[];
  /** Range de tempo da volta — pra mapear progresso 0..1 → t */
  startT: number;
  endT: number;
};

type SceneData = {
  laps: SceneLap[];
  /** Eventos de spin em coordenadas de cena (x,y,z) + dado original */
  spins: Array<{ event: SpinEvent; pos: { x: number; z: number } }>;
  /** Centro da pista (pra apontar câmera) */
  center: { x: number; z: number };
  /** Tamanho aproximado da pista (lado do bounding box) */
  size: number;
  /** Range de altitude vs base — pra normalizar eixo Y */
  altitudeBase: number;
};

// ============================================================================
// Página principal
// ============================================================================

export default function ReplayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [scene, setScene] = useState<SceneData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackName, setTrackName] = useState<string>('—');

  /** -1 = todas as voltas; >=0 = índice da volta selecionada (mostra essa apenas) */
  const [selectedLapIdx, setSelectedLapIdx] = useState<number>(-1);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<1 | 2 | 4 | 8>(2);
  /** Progresso 0..1 dentro da volta sendo animada. useRef no kart pra evitar re-render. */
  const progressRef = useRef(0);
  const [displayProgress, setDisplayProgress] = useState(0);

  // ===== Carrega + projeta samples na coord local =====
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
        if (!cancelled) setScene(built);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Erro ao carregar replay');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  /** Volta ativa pro replay — selectedLapIdx ou PB se "todas". */
  const activeLap = useMemo(() => {
    if (!scene) return null;
    if (selectedLapIdx >= 0) return scene.laps[selectedLapIdx] ?? null;
    return scene.laps.find((l) => l.isPb) ?? scene.laps[0];
  }, [scene, selectedLapIdx]);

  if (error) {
    return (
      <Center>
        <Text style={s.errorTitle}>Replay indisponível</Text>
        <Text style={s.errorBody}>{error}</Text>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backBtnText}>Voltar</Text>
        </Pressable>
      </Center>
    );
  }

  if (!scene || !activeLap) {
    return (
      <Center>
        <ActivityIndicator color={colors.primary} />
        <Text style={s.loadingText}>Preparando replay…</Text>
      </Center>
    );
  }

  return (
    <View style={s.root}>
      {/* Cena 3D */}
      <Canvas
        camera={{
          position: [scene.center.x, scene.size * 0.9, scene.center.z + scene.size * 0.6],
          fov: 50,
          near: 0.1,
          far: scene.size * 10,
        }}
        gl={{ antialias: true }}
        onCreated={({ camera }) => {
          camera.lookAt(scene.center.x, 0, scene.center.z);
        }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[scene.size, scene.size, scene.size]} intensity={0.8} />
        <Ground center={scene.center} size={scene.size * 3} />
        {scene.laps.map((lap) => (
          <LapLine
            key={lap.id}
            lap={lap}
            visible={selectedLapIdx === -1 || selectedLapIdx === lap.index}
            highlighted={
              selectedLapIdx === -1 ? lap.isPb : selectedLapIdx === lap.index
            }
          />
        ))}
        {scene.spins.map((sp, i) => (
          <SpinMarker key={i} pos={sp.pos} altitudeBase={scene.altitudeBase} />
        ))}
        <AnimatedKart
          lap={activeLap}
          playing={playing}
          speed={speed}
          progressRef={progressRef}
          onProgress={setDisplayProgress}
        />
      </Canvas>

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

      {/* Controle de voltas — chips horizontais */}
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

      {/* Bottom controls — play/pause + speed + progresso */}
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
                style={[s.progressFill, { width: `${displayProgress * 100}%` }]}
              />
            </View>
            <Text style={s.progressLabel}>
              Volta {activeLap.number} · {fmtTime(displayProgress * activeLap.durationMs)} /{' '}
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
// Componentes 3D
// ============================================================================

function Ground({
  center,
  size,
}: {
  center: { x: number; z: number };
  size: number;
}) {
  // Plano "chão" cinza escuro — referência visual da superfície.
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[center.x, -0.5, center.z]}
    >
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial color="#0F0F18" />
    </mesh>
  );
}

function LapLine({
  lap,
  visible,
  highlighted,
}: {
  lap: SceneLap;
  visible: boolean;
  highlighted: boolean;
}) {
  // Geometria + material criados via useMemo pra não recompilar a cada render.
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(lap.positions, 3));
    return geo;
  }, [lap.positions]);

  const color = highlighted ? '#00FF88' : lap.isPb ? '#A8CC2E' : '#3A506B';

  if (!visible) return null;
  return (
    // @ts-ignore — JSX intrinsics adicionados pelo r3f
    <line geometry={geometry}>
      <lineBasicMaterial color={color} linewidth={highlighted ? 4 : 2} />
    </line>
  );
}

function SpinMarker({
  pos,
  altitudeBase,
}: {
  pos: { x: number; z: number };
  altitudeBase: number;
}) {
  // Anel vermelho pulsante no ponto do spin. Anima escala via useFrame.
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const pulse = 1 + 0.15 * Math.sin(clock.elapsedTime * 3);
    meshRef.current.scale.set(pulse, pulse, pulse);
  });
  return (
    <mesh
      ref={meshRef}
      position={[pos.x, altitudeBase + 0.5, pos.z]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <ringGeometry args={[3, 4, 24]} />
      <meshBasicMaterial color="#FF4757" transparent opacity={0.7} />
    </mesh>
  );
}

function AnimatedKart({
  lap,
  playing,
  speed,
  progressRef,
  onProgress,
}: {
  lap: SceneLap;
  playing: boolean;
  speed: 1 | 2 | 4 | 8;
  progressRef: React.MutableRefObject<number>;
  onProgress: (p: number) => void;
}) {
  // Estado interno: posição + rotação calculadas a cada frame por interpolação
  // linear entre samples adjacentes (baseado em progressRef → tempo → sample).
  const meshRef = useRef<THREE.Mesh>(null);
  const lastReportedProgressRef = useRef(0);

  useFrame((_, dt) => {
    if (!meshRef.current) return;

    // Avança o progresso se está rodando. dt vem em segundos; multiplica
    // por (speed * 1000) pra obter ms de "tempo de pista" virtual.
    if (playing) {
      const advanceMs = dt * 1000 * speed;
      const dur = lap.endT - lap.startT;
      progressRef.current += advanceMs / dur;
      if (progressRef.current >= 1) progressRef.current = 0; // loop
    }

    const progress = progressRef.current;
    const targetT = lap.startT + progress * (lap.endT - lap.startT);

    // Encontra o sample mais próximo no array de timestamps (binary search
    // seria mais rápido mas pra 500 samples linear é tranquilo).
    let idx = 0;
    for (let i = 0; i < lap.timestamps.length - 1; i++) {
      if (lap.timestamps[i] <= targetT && targetT <= lap.timestamps[i + 1]) {
        idx = i;
        break;
      }
    }
    const t0 = lap.timestamps[idx];
    const t1 = lap.timestamps[Math.min(idx + 1, lap.timestamps.length - 1)];
    const alpha = t1 > t0 ? (targetT - t0) / (t1 - t0) : 0;

    const i3 = idx * 3;
    const j3 = Math.min((idx + 1) * 3, lap.positions.length - 3);
    const x = lap.positions[i3] * (1 - alpha) + lap.positions[j3] * alpha;
    const y = lap.positions[i3 + 1] * (1 - alpha) + lap.positions[j3 + 1] * alpha;
    const z = lap.positions[i3 + 2] * (1 - alpha) + lap.positions[j3 + 2] * alpha;

    meshRef.current.position.set(x, y + 1, z);

    // Heading: direção do vetor (next - current) projetado em XZ.
    const dx = lap.positions[j3] - lap.positions[i3];
    const dz = lap.positions[j3 + 2] - lap.positions[i3 + 2];
    if (dx !== 0 || dz !== 0) {
      meshRef.current.rotation.y = Math.atan2(dx, dz);
    }

    // Reporta progresso pra UI uma vez por ~10% de mudança (evita re-render
    // a cada frame — 60Hz × setState seria desastre).
    if (Math.abs(progress - lastReportedProgressRef.current) > 0.005) {
      lastReportedProgressRef.current = progress;
      onProgress(progress);
    }
  });

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[2, 1, 3]} />
      <meshStandardMaterial color="#D4FF3A" emissive="#D4FF3A" emissiveIntensity={0.4} />
    </mesh>
  );
}

// ============================================================================
// UI chips/buttons
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
      style={[
        s.chip,
        active && s.chipActive,
        pb && !active && s.chipPb,
      ]}
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

function Center({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.centerRoot}>
      <View style={s.centerBox}>{children}</View>
    </View>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function fmtTime(ms: number): string {
  if (ms < 60000) return (ms / 1000).toFixed(2);
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/**
 * Pré-processa todas as voltas: projeta GPS pra coord local, identifica PB,
 * detecta spins, calcula bbox da cena pra apontar câmera. Tudo uma vez só
 * no carregamento — não roda na renderização.
 */
function buildScene(rawLaps: Array<{
  id: string;
  samples: GpsSample[];
  imuSamples?: ImuSample[];
  durationMs: number;
  startedAt: number;
}>): SceneData {
  // Origem = primeiro sample da primeira volta (consistente entre runs).
  const firstSample = rawLaps[0].samples[0];
  const origin = { lat: firstSample.lat, lng: firstSample.lng };
  const projector = makeLocalProjector(origin);

  // PB
  const bestLap = rawLaps.reduce((b, l) =>
    l.durationMs < b.durationMs ? l : b
  , rawLaps[0]);

  // Coleta altitude pra normalizar baseline (subtrai mínima pra começar do 0)
  const allAltitudes = rawLaps.flatMap((l) =>
    l.samples.map((s) => s.altitude).filter((a): a is number => a != null)
  );
  const altitudeBase = allAltitudes.length > 0 ? Math.min(...allAltitudes) : 0;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const sceneLaps: SceneLap[] = rawLaps.map((lap, idx) => {
    // Decimação suave — se passar de 400 samples, pula proporcionalmente.
    const step = Math.max(1, Math.floor(lap.samples.length / 400));
    const samples = lap.samples.filter((_, i) => i % step === 0);
    const positions = new Float32Array(samples.length * 3);
    const timestamps: number[] = [];
    samples.forEach((s, i) => {
      const xy = projector.toXY(s);
      // GPS y (norte/sul em metros) → scene z. GPS x (leste/oeste) → scene x.
      // Altitude (subtraindo baseline) → scene y. Amplificada 5× pra ser
      // visualmente perceptível em pistas planas (kart varia 0-3m geralmente).
      const altScene = ((s.altitude ?? altitudeBase) - altitudeBase) * 5;
      positions[i * 3] = xy.x;
      positions[i * 3 + 1] = altScene;
      positions[i * 3 + 2] = xy.y;
      timestamps.push(s.t);
      if (xy.x < minX) minX = xy.x;
      if (xy.x > maxX) maxX = xy.x;
      if (xy.y < minZ) minZ = xy.y;
      if (xy.y > maxZ) maxZ = xy.y;
    });
    return {
      id: lap.id,
      index: idx,
      number: idx + 1,
      durationMs: lap.durationMs,
      isPb: lap.id === bestLap.id,
      positions,
      timestamps,
      startT: timestamps[0],
      endT: timestamps[timestamps.length - 1],
    };
  });

  // Spins: detecta em cada volta + projeta pro espaço de cena.
  const spins: SceneData['spins'] = [];
  for (const lap of rawLaps) {
    const events = detectSpins(lap.samples, lap.imuSamples);
    for (const ev of events) {
      const xy = projector.toXY({ lat: ev.lat, lng: ev.lng } as any);
      spins.push({ event: ev, pos: { x: xy.x, z: xy.y } });
    }
  }

  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const size = Math.max(maxX - minX, maxZ - minZ, 50); // mín 50m pra evitar zoom maluco

  return {
    laps: sceneLaps,
    spins,
    center: { x: centerX, z: centerZ },
    size,
    altitudeBase: 0, // já normalizado
  };
}

// ============================================================================
// Styles
// ============================================================================

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#08080C' },
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
