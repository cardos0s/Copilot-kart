import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import { RACE_TRACK } from '../src/lib/raceTrack';
import { TRACKS } from '../src/data/tracks';
import { getProfile } from '../src/storage/profile';
import { Icon } from '../src/components/ui';
import { colors, radius, spacing } from '../src/theme';

const BLUE = colors.racingBlue;
const TICK_MS = 250; // atualização da partida (4x/s) — dots suaves

// Cores dos capacetes dos adversários (você é sempre azul).
const RIVAL_COLORS = ['#F5C84B', '#FF6B35', '#9D5BFF', '#3DDCFF', '#FF3DCB', '#00FF88', '#C9D2DE'];

const RIVALS: { name: string; num: string; pace: number }[] = [
  { name: 'Bia Rocha', num: '7', pace: 40600 },
  { name: 'Léo Martins', num: '14', pace: 41100 },
  { name: 'Diego Sá', num: '44', pace: 41800 },
  { name: 'Marina L.', num: '12', pace: 42300 },
  { name: 'Rafa Tó', num: '88', pace: 42900 },
  { name: 'Camila V.', num: '23', pace: 43400 },
  { name: 'Theo M.', num: '5', pace: 43900 },
];

type Kart = {
  id: string;
  name: string;
  num: string;
  color: string;
  isMe: boolean;
  pace: number; // ms/volta base
  phase: number; // fase da variação senoidal (deixa cada um único)
  progress: number; // voltas completas (float)
  lastLapMs: number | null;
  bestLapMs: number | null;
  speed: number; // km/h instantânea
  lapAnchorProgress: number; // progress no início da volta atual
  lapAnchorTime: number; // timestamp no início da volta atual
};

function makeKarts(myName: string | null): Kart[] {
  const me: Kart = {
    id: 'me',
    name: myName ?? 'Você',
    num: '219',
    color: BLUE,
    isMe: true,
    pace: 41400,
    phase: 0,
    progress: 0,
    lastLapMs: null,
    bestLapMs: null,
    speed: 0,
    lapAnchorProgress: 0,
    lapAnchorTime: 0,
  };
  const rivals: Kart[] = RIVALS.map((r, i) => ({
    id: `r${i}`,
    name: r.name,
    num: r.num,
    color: RIVAL_COLORS[i % RIVAL_COLORS.length],
    isMe: false,
    pace: r.pace,
    phase: (i + 1) * 0.9,
    progress: 0,
    lastLapMs: null,
    bestLapMs: null,
    speed: 0,
    lapAnchorProgress: 0,
    lapAnchorTime: 0,
  }));
  // Começa todo mundo embaralhado na pista (não em fila) pra parecer corrida em andamento.
  const all = [me, ...rivals];
  all.forEach((k, i) => {
    k.progress = (i * 0.11) % 1;
    k.lapAnchorProgress = Math.floor(k.progress);
  });
  return all;
}

// Posição (x,y) no viewBox 340x250 pra uma fração de volta p∈[0,1).
function trackPos(p: number): { x: number; y: number } {
  const xs = RACE_TRACK.xs;
  const ys = RACE_TRACK.ys;
  const n = xs.length;
  const f = ((p % 1) + 1) % 1;
  const idx = f * (n - 1);
  const i = Math.floor(idx);
  const t = idx - i;
  const j = Math.min(i + 1, n - 1);
  return { x: xs[i] + (xs[j] - xs[i]) * t, y: ys[i] + (ys[j] - ys[i]) * t };
}

function fmtLap(ms: number | null): string {
  if (ms == null) return '—';
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function fmtClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type RaceEvent = { id: string; text: string; good: boolean };

export default function Competition() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [karts, setKarts] = useState<Kart[]>(() => makeKarts(null));
  const [events, setEvents] = useState<RaceEvent[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [trackId, setTrackId] = useState<string>(TRACKS[0].id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedTrack = TRACKS.find((t) => t.id === trackId) ?? TRACKS[0];

  const kartsRef = useRef<Kart[]>(karts);
  const orderRef = useRef<string[]>([]); // ids na ordem da última atualização
  const startRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);
  const evtSeq = useRef(0);

  // Carrega o nome do piloto pra marcar "você".
  useEffect(() => {
    let alive = true;
    getProfile().then((p) => {
      if (!alive) return;
      const next = makeKarts(p?.name ?? null);
      kartsRef.current = next;
      setKarts(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  const tick = useCallback(() => {
    const now = Date.now();
    if (startRef.current === 0) {
      startRef.current = now;
      lastTickRef.current = now;
      kartsRef.current.forEach((k) => (k.lapAnchorTime = now));
    }
    const dt = now - lastTickRef.current;
    lastTickRef.current = now;
    setElapsed(now - startRef.current);

    const updated = kartsRef.current.map((k) => {
      // Ritmo instantâneo: pace base ± ~4% (senoidal por kart) + ruído leve.
      const variation = Math.sin((now / 9000) + k.phase) * 0.04 + (Math.random() - 0.5) * 0.015;
      const instPace = k.pace * (1 + variation);
      const dProgress = dt / instPace;
      let progress = k.progress + dProgress;

      let lastLapMs = k.lastLapMs;
      let bestLapMs = k.bestLapMs;
      let lapAnchorProgress = k.lapAnchorProgress;
      let lapAnchorTime = k.lapAnchorTime;

      // Fechou uma volta?
      if (Math.floor(progress) > Math.floor(k.progress)) {
        const lapTime = now - k.lapAnchorTime;
        // Guarda só se for um tempo plausível (evita 1ª volta parcial doida).
        if (lapTime > 20000 && lapTime < 120000) {
          lastLapMs = Math.round(lapTime);
          bestLapMs = bestLapMs == null ? lastLapMs : Math.min(bestLapMs, lastLapMs);
        }
        lapAnchorProgress = Math.floor(progress);
        lapAnchorTime = now;
      }

      // Velocidade: cai nas curvas (4 "humps" por volta) e sobe nas retas.
      const frac = ((progress % 1) + 1) % 1;
      const cornerFactor = 0.72 + 0.28 * ((Math.sin(frac * Math.PI * 2 * 4) + 1) / 2);
      const paceSpeed = 41400 / instPace; // mais rápido => >1
      const speed = Math.max(42, Math.min(82, 78 * cornerFactor * paceSpeed + (Math.random() - 0.5) * 3));

      return {
        ...k,
        progress,
        lastLapMs,
        bestLapMs,
        lapAnchorProgress,
        lapAnchorTime,
        speed,
      };
    });

    // Ordena por progresso (mais voltas/distância = na frente).
    updated.sort((a, b) => b.progress - a.progress);

    // Detecta mudança de posição do "você" e troca de líder pro ticker.
    const newOrder = updated.map((k) => k.id);
    const prevOrder = orderRef.current;
    if (prevOrder.length > 0) {
      const myNew = newOrder.indexOf('me');
      const myOld = prevOrder.indexOf('me');
      if (myNew >= 0 && myOld >= 0 && myNew !== myOld) {
        if (myNew < myOld) {
          // Subiu — passou quem estava à frente.
          const passedId = prevOrder[myNew];
          const passed = updated.find((k) => k.id === passedId);
          pushEvent(`Você passou ${passed?.name ?? 'um rival'} · P${myNew + 1}`, true);
        } else {
          const byId = newOrder[myOld];
          const by = updated.find((k) => k.id === byId);
          pushEvent(`${by?.name ?? 'Um rival'} te passou · P${myNew + 1}`, false);
        }
      }
      // Troca de líder (envolvendo qualquer um).
      if (newOrder[0] !== prevOrder[0]) {
        const leader = updated[0];
        if (!leader.isMe) pushEvent(`${leader.name} assumiu a ponta`, false);
        else pushEvent(`Você assumiu a ponta! 🏁`, true);
      }
    }
    orderRef.current = newOrder;

    kartsRef.current = updated;
    setKarts(updated);
  }, []);

  function pushEvent(text: string, good: boolean) {
    evtSeq.current += 1;
    const e: RaceEvent = { id: `e${evtSeq.current}`, text, good };
    setEvents((prev) => [e, ...prev].slice(0, 4));
  }

  useFocusEffect(
    useCallback(() => {
      const id = setInterval(tick, TICK_MS);
      return () => clearInterval(id);
    }, [tick])
  );

  const leader = karts[0];
  const leaderPace = leader?.pace ?? 41400;
  const onTrack = karts.length;

  return (
    <View style={[s.root, { paddingTop: insets.top + spacing.s }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={16}>
          <Text style={s.back}>‹</Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <View style={s.liveTag}>
            <View style={s.liveDot} />
            <Text style={s.liveTagText}>PARTIDA AO VIVO · EXEMPLO</Text>
          </View>
        </View>
        <Text style={s.clock}>{fmtClock(elapsed)}</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.l, paddingBottom: insets.bottom + spacing.huge }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.title}>COMPETIÇÃO</Text>
        <Text style={s.sub}>{onTrack} karts na pista agora</Text>

        {/* Seletor de pista + iniciar corrida real */}
        <Pressable style={s.trackChip} onPress={() => setPickerOpen(true)}>
          <Icon name="map" size={16} color={colors.racingBlue} />
          <Text style={s.trackChipText} numberOfLines={1}>{selectedTrack.shortName ?? selectedTrack.name}</Text>
          <Icon name="chevron-right" size={16} color={colors.textMuted} />
        </Pressable>
        <Pressable
          style={({ pressed }) => [s.startBtn, pressed && { opacity: 0.85 }]}
          onPress={() =>
            router.push({
              pathname: '/competition-race',
              params: { trackId: selectedTrack.id, trackName: selectedTrack.shortName ?? selectedTrack.name },
            } as any)
          }
        >
          <Text style={s.startBtnText}>▶  INICIAR CORRIDA AO VIVO</Text>
        </Pressable>
        <Text style={s.startHint}>
          Todos que entrarem na corrida nesta pista aparecem no seu mapa ao vivo.
        </Text>

        {/* Mini-mapa da pista com os karts ao vivo */}
        <View style={s.mapBox}>
          <Svg width="100%" height={200} viewBox="0 0 340 250">
            <Path d={RACE_TRACK.d} stroke="#23232e" strokeWidth={20} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            <Path d={RACE_TRACK.d} stroke="#33333f" strokeWidth={2} fill="none" strokeDasharray="2 12" />
            {karts.map((k) => {
              const pos = trackPos(k.progress);
              return (
                <Circle
                  key={k.id}
                  cx={pos.x}
                  cy={pos.y}
                  r={k.isMe ? 8 : 6}
                  fill={k.color}
                  stroke={k.isMe ? '#fff' : '#0c0c12'}
                  strokeWidth={k.isMe ? 2 : 1.5}
                />
              );
            })}
          </Svg>
        </View>

        {/* Ticker de ultrapassagens */}
        {events.length > 0 && (
          <View style={s.ticker}>
            {events.map((e) => (
              <View key={e.id} style={s.tickerRow}>
                <Text style={[s.tickerBullet, { color: e.good ? colors.success : colors.danger }]}>
                  {e.good ? '▲' : '▼'}
                </Text>
                <Text style={s.tickerText}>{e.text}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Timing ao vivo */}
        <Text style={s.sectionLabel}>GRID AO VIVO</Text>
        {karts.map((k, i) => {
          const gapMs = leader ? (leader.progress - k.progress) * leaderPace : 0;
          return (
            <View key={k.id} style={[s.row, k.isMe && s.rowMe]}>
              <Text style={[s.pos, i < 3 && { color: ['#F5C84B', '#C9D2DE', '#D98A4B'][i] }]}>
                {i + 1}
              </Text>
              <View style={[s.dot, { backgroundColor: k.color }]} />
              <View style={s.rowBody}>
                <Text style={[s.name, k.isMe && { color: BLUE }]} numberOfLines={1}>
                  {k.name} {k.isMe && '(você)'}
                </Text>
                <Text style={s.meta}>
                  #{k.num} · {Math.floor(k.progress) + 1}ª volta · últ {fmtLap(k.lastLapMs)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[s.speed, k.isMe && { color: BLUE }]}>{Math.round(k.speed)}<Text style={s.speedUnit}> km/h</Text></Text>
                <Text style={s.gap}>{i === 0 ? 'LÍDER' : `+${(gapMs / 1000).toFixed(2)}s`}</Text>
              </View>
            </View>
          );
        })}

        {/* Link pro ranking de melhores voltas */}
        <Pressable style={s.rankLink} onPress={() => router.push('/ranking' as any)}>
          <Text style={s.rankLinkText}>Ver ranking de melhores voltas</Text>
          <Text style={s.rankLinkChevron}>›</Text>
        </Pressable>

        <Text style={s.note}>
          Demo de partida. Na pista de verdade, cada piloto entra na mesma partida e o app
          sincroniza posições, ultrapassagens e velocidade ao vivo.
        </Text>
      </ScrollView>

      {/* Picker de pista */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={s.modalBg} onPress={() => setPickerOpen(false)}>
          <View style={[s.modalSheet, { paddingBottom: insets.bottom + spacing.l }]}>
            <Text style={s.modalTitle}>Escolha o kartódromo</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {TRACKS.map((t) => (
                <Pressable
                  key={t.id}
                  style={[s.trackRow, t.id === trackId && s.trackRowActive]}
                  onPress={() => {
                    setTrackId(t.id);
                    setPickerOpen(false);
                  }}
                >
                  <Text style={[s.trackRowName, t.id === trackId && { color: BLUE }]}>
                    {t.shortName ?? t.name}
                  </Text>
                  <Text style={s.trackRowCity}>{t.city}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.s,
    gap: spacing.m,
  },
  back: { color: colors.textSecondary, fontSize: 30, fontWeight: '400' },
  liveTag: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  liveTagText: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  clock: { color: colors.textPrimary, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'], minWidth: 44, textAlign: 'right' },

  title: { color: colors.textPrimary, fontSize: 34, fontWeight: '900', fontStyle: 'italic', letterSpacing: -0.5, marginTop: spacing.s },
  sub: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 2 },

  trackChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.s, marginTop: spacing.l,
    paddingVertical: 12, paddingHorizontal: spacing.l, backgroundColor: colors.bgElevated,
    borderRadius: radius.m, borderWidth: 1, borderColor: colors.border,
  },
  trackChipText: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  startBtn: {
    marginTop: spacing.s, backgroundColor: BLUE, borderRadius: radius.m,
    paddingVertical: 16, alignItems: 'center',
    shadowColor: BLUE, shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
  },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '900', fontStyle: 'italic', letterSpacing: 0.5 },
  startHint: { color: colors.textMuted, fontSize: 12, marginTop: spacing.s, lineHeight: 16 },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.l },
  modalTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800', marginBottom: spacing.m },
  trackRow: { paddingVertical: 14, paddingHorizontal: spacing.m, borderRadius: radius.m },
  trackRowActive: { backgroundColor: 'rgba(47,107,255,0.10)' },
  trackRowName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  trackRowCity: { color: colors.textMuted, fontSize: 12, marginTop: 2 },

  mapBox: {
    marginTop: spacing.l,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.s,
  },

  ticker: { marginTop: spacing.m, gap: 4 },
  tickerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  tickerBullet: { fontSize: 11, fontWeight: '900' },
  tickerText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },

  sectionLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 2, marginTop: spacing.xl, marginBottom: spacing.s },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingVertical: spacing.m,
    paddingHorizontal: spacing.m,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.s,
  },
  rowMe: { borderColor: BLUE, backgroundColor: 'rgba(47,107,255,0.07)' },
  pos: { width: 22, textAlign: 'center', color: colors.textSecondary, fontSize: 15, fontWeight: '900' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  rowBody: { flex: 1, minWidth: 0 },
  name: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  meta: { color: colors.textMuted, fontSize: 11, marginTop: 2, fontWeight: '600' },
  speed: { color: colors.textPrimary, fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  speedUnit: { color: colors.textMuted, fontSize: 10, fontWeight: '700' },
  gap: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 1 },

  rankLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.l,
    padding: spacing.l,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rankLinkText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  rankLinkChevron: { color: colors.textMuted, fontSize: 20, fontWeight: '700' },

  note: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: spacing.l },
});
