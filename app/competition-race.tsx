import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, InteractionManager, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useLapRecorder } from '../src/hooks/useLapRecorder';
import { useLockLandscape } from '../src/hooks/useLockLandscape';
import { RACE_TRACK } from '../src/lib/raceTrack';
import { joinMatch, MatchPeerState } from '../src/lib/match';
import { ensurePilot } from '../src/lib/liveSession';
import { getProfile } from '../src/storage/profile';
import { Icon } from '../src/components/ui';
import { colors, radius, spacing } from '../src/theme';

const TOTAL_LAPS = 16;
const MAX_KMH = 90;
const REF_LAP_MS = 40000; // fallback de ritmo enquanto não há best
const KART_COLORS = ['#F5C84B', '#FF6B35', '#9D5BFF', '#3DDCFF', '#FF3DCB', '#00FF88', '#C9D2DE'];

// Galera de exemplo (modo demo) — nomes + ritmo base por kart. Ritmo próximo
// da volta-demo do piloto (~53s) pra você ficar no meio do pelotão e as
// posições embaralharem (em vez de ficar sempre em último).
const DEMO_RIVALS: { name: string; num: string; pace: number }[] = [
  { name: 'Bia Rocha', num: '7', pace: 50500 },
  { name: 'Léo Martins', num: '14', pace: 51800 },
  { name: 'Diego Sá', num: '44', pace: 52700 },
  { name: 'Marina L.', num: '12', pace: 53600 },
  { name: 'Rafa Tó', num: '88', pace: 54600 },
  { name: 'Camila V.', num: '23', pace: 55800 },
  { name: 'Theo M.', num: '5', pace: 57200 },
];

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

function fmtSec(ms: number | null): string {
  if (ms == null) return '—';
  return (ms / 1000).toFixed(2);
}

type Kart = MatchPeerState & { isMe: boolean; color: string };

export default function CompetitionRace() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    code?: string;
    trackId?: string;
    trackName?: string;
    simulate?: string;
  }>();
  const isDemo = params.simulate === '1';
  // Código da partida — define o canal Realtime. Quem tem o mesmo código
  // entra na mesma corrida. No demo não precisa (rivais são simulados).
  const matchCode = (params.code ?? '').toUpperCase();

  // Cockpit: força landscape (suporte). Trava robusta + layout responsivo
  // como rede de segurança (empilha em portrait se a rotação atrasar).
  useLockLandscape();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const { state, info, start, stop } = useLapRecorder();

  const [myName, setMyName] = useState<string>('Você');
  const [peers, setPeers] = useState<Kart[]>([]);
  const [posInfo, setPosInfo] = useState<{ pos: number; delta: number }>({ pos: 1, delta: 0 });
  // Classificação final congelada quando encerra (mostra o ranking da partida).
  const [finished, setFinished] = useState<Kart[] | null>(null);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  // Tamanho medido do mapa — SVG precisa de width/height NUMÉRICOS (percentual
  // em SVG quebra em release/Fabric).
  const [mapSize, setMapSize] = useState({ w: 0, h: 0 });

  const pilotIdRef = useRef<string>('me');
  const matchRef = useRef<{ leave: () => void } | null>(null);
  const prevPosRef = useRef<number>(1);

  // Voltas completas (pra best/pior) — observadas via info.lastClosedLap.
  const completedRef = useRef<number[]>([]);
  const lastSeenLapRef = useRef<number>(0);
  const [bestMs, setBestMs] = useState<number | null>(null);
  const [worstMs, setWorstMs] = useState<number | null>(null);

  // Estado da simulação demo (karts rivais andando na pista).
  const demoRef = useRef<{ id: string; name: string; num: string; pace: number; phase: number; progress: number; lastLapMs: number | null; bestLapMs: number | null }[]>(
    DEMO_RIVALS.map((r, i) => ({
      id: `d${i}`,
      name: r.name,
      num: r.num,
      pace: r.pace,
      phase: (i + 1) * 0.8,
      // Largada agrupada perto do início — o pelotão se espalha pelo ritmo.
      progress: i * 0.04,
      lastLapMs: null,
      bestLapMs: null,
    }))
  );
  const demoTickRef = useRef<number>(0);

  // ---- Início: carrega perfil, começa gravação, entra na partida ----
  // Adia GPS + Realtime pra DEPOIS da transição de navegação assentar
  // (runAfterInteractions). Iniciar isso no mount, durante a animação de push,
  // jankava a entrada e exigia "clicar duas vezes". Igual ao lock de orientação.
  useEffect(() => {
    let alive = true;
    const task = InteractionManager.runAfterInteractions(() => {
      (async () => {
        const prof = await getProfile().catch(() => null);
        if (alive && prof?.name) setMyName(prof.name);

        try {
          await start({ simulate: isDemo });
        } catch (e: any) {
          Alert.alert('Erro', e?.message ?? 'Falha ao iniciar GPS');
        }

        if (!isDemo && matchCode) {
          const pid = await ensurePilot().catch(() => null);
          if (pid) pilotIdRef.current = pid;
          if (alive) {
            matchRef.current = joinMatch(
              matchCode,
              () => buildMyState(),
              (list) => {
                if (!alive) return;
                setPeers(
                  list.map((p, i) => ({ ...p, isMe: false, color: KART_COLORS[(p.colorIdx ?? i) % KART_COLORS.length] }))
                );
              }
            );
          }
        }
      })();
    });
    return () => {
      alive = false;
      task.cancel();
      matchRef.current?.leave();
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Detecta voltas fechadas pra best/pior ----
  useEffect(() => {
    const closed = info.lastClosedLap;
    if (closed && closed.lapNumber !== lastSeenLapRef.current) {
      lastSeenLapRef.current = closed.lapNumber;
      completedRef.current.push(closed.durationMs);
      const arr = completedRef.current;
      setBestMs(Math.min(...arr));
      setWorstMs(Math.max(...arr));
    }
  }, [info.lastClosedLap]);

  // ---- Meu estado atual (pro broadcast e pra posição) ----
  const myLapNumber = info.lapsCompleted + 1;
  const refLap = bestMs ?? REF_LAP_MS;
  const myProgress = Math.max(0, Math.min(0.999, (info.currentLapElapsedMs ?? 0) / refLap));

  const buildMyState = useCallback((): MatchPeerState => {
    return {
      pilotId: pilotIdRef.current,
      name: myName,
      kartNum: '219',
      colorIdx: 0,
      lapNumber: info.lapsCompleted + 1,
      lapProgress: Math.max(0, Math.min(0.999, (info.currentLapElapsedMs ?? 0) / (bestMs ?? REF_LAP_MS))),
      speedKmh: info.lastSpeedKmh,
      lastLapMs: info.previousLapMs,
      bestLapMs: bestMs,
      ts: Date.now(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myName, info.lapsCompleted, info.currentLapElapsedMs, info.lastSpeedKmh, info.previousLapMs, bestMs]);

  // ---- Loop da simulação demo (galera) ----
  // Início adiado pra DEPOIS da transição: setState (setPeers) a cada 250ms
  // durante a animação de push cancelava a entrada ("não abre de primeira").
  useEffect(() => {
    if (!isDemo) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const task = InteractionManager.runAfterInteractions(() => {
      id = setInterval(() => {
      const now = Date.now();
      const dt = demoTickRef.current === 0 ? 0 : now - demoTickRef.current;
      demoTickRef.current = now;
      demoRef.current.forEach((k) => {
        const variation = Math.sin(now / 9000 + k.phase) * 0.04 + (Math.random() - 0.5) * 0.015;
        const instPace = k.pace * (1 + variation);
        const before = k.progress;
        k.progress += dt / instPace;
        if (Math.floor(k.progress) > Math.floor(before)) {
          k.lastLapMs = Math.round(instPace);
          k.bestLapMs = k.bestLapMs == null ? k.lastLapMs : Math.min(k.bestLapMs, k.lastLapMs);
        }
      });
      setPeers(
        demoRef.current.map((k, i) => ({
          pilotId: k.id,
          name: k.name,
          kartNum: k.num,
          colorIdx: i,
          lapNumber: Math.floor(k.progress) + 1,
          lapProgress: ((k.progress % 1) + 1) % 1,
          speedKmh: 0,
          lastLapMs: k.lastLapMs,
          bestLapMs: k.bestLapMs,
          ts: now,
          isMe: false,
          color: KART_COLORS[i % KART_COLORS.length],
        }))
      );
      }, 250);
    });
    return () => {
      task.cancel();
      if (id) clearInterval(id);
    };
  }, [isDemo]);

  // ---- Monta o grid completo (eu + galera) e calcula posição ----
  const me: Kart = {
    pilotId: pilotIdRef.current,
    name: myName,
    kartNum: '219',
    colorIdx: 0,
    lapNumber: myLapNumber,
    lapProgress: myProgress,
    speedKmh: info.lastSpeedKmh,
    lastLapMs: info.previousLapMs,
    bestLapMs: bestMs,
    ts: Date.now(),
    isMe: true,
    color: colors.racingBlue,
  };
  const grid = [me, ...peers];
  const totalOf = (k: Kart) => k.lapNumber - 1 + k.lapProgress;
  const ordered = [...grid].sort((a, b) => totalOf(b) - totalOf(a));
  const leaderId = ordered[0]?.pilotId;

  // Atualiza posição (com seta de variação) sem loop de render.
  useEffect(() => {
    const myPos = ordered.findIndex((k) => k.isMe) + 1 || 1;
    if (myPos !== posInfo.pos) {
      const delta = prevPosRef.current - myPos; // +N = subiu N posições
      prevPosRef.current = myPos;
      setPosInfo({ pos: myPos, delta });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered.map((k) => k.pilotId).join(',')]);

  // ---- Derivados de UI ----
  const speed = Math.round(info.lastSpeedKmh);
  const speedFrac = Math.max(0, Math.min(1, info.lastSpeedKmh / MAX_KMH));
  const curLapMs = info.currentLapElapsedMs ?? 0;
  const dBest = info.previousLapMs != null && bestMs != null ? info.previousLapMs - bestMs : null;
  const dWorst = info.previousLapMs != null && worstMs != null ? info.previousLapMs - worstMs : null;
  const nPilots = grid.length;
  const othersOnTrack = Math.max(0, nPilots - 2); // tira "você" e "líder" da contagem do rótulo

  const posDeltaIcon = posInfo.delta > 0 ? '▲' : posInfo.delta < 0 ? '▼' : '—';
  const posDeltaColor = posInfo.delta > 0 ? colors.success : posInfo.delta < 0 ? colors.danger : colors.textMuted;

  // Confirmação IN-APP (não Alert nativo): no iOS, alert nativo sobre tela
  // travada em landscape vira a orientação pra portrait e não restaura, deixando
  // a tela num meio-termo com toque quebrado (trava o app).
  const handleEnd = () => setConfirmingEnd(true);

  const doEnd = () => {
    // Congela a ordem atual como classificação final e mostra o ranking.
    // Para de transmitir e de gravar, mas mantém a tela pra exibir o pódio.
    setConfirmingEnd(false);
    setFinished([...ordered]);
    matchRef.current?.leave();
    matchRef.current = null;
    stop();
  };

  const myFinalPos = finished ? finished.findIndex((k) => k.isMe) + 1 : 0;

  return (
    <View style={[s.root, { paddingTop: insets.top + spacing.s, paddingLeft: insets.left + spacing.l, paddingRight: insets.right + spacing.l, paddingBottom: insets.bottom + spacing.s }]}>
      <View style={[s.body, !isLandscape && { flexDirection: 'column' }]}>
        {/* ===== ESQUERDA: mapa da galera ===== */}
        <View style={s.left}>
          <View style={s.gridHead}>
            <View style={s.liveTag}>
              <View style={s.liveDot} />
              <Text style={s.liveTagText}>GRID AO VIVO{isDemo ? ' · EXEMPLO' : ''}</Text>
            </View>
            <Text style={s.pilotsCount}>{nPilots} PILOTOS</Text>
          </View>
          {!!matchCode && (
            <View style={s.codePill}>
              <Text style={s.codePillLabel}>CÓDIGO DA PARTIDA</Text>
              <Text style={s.codePillValue}>{matchCode}</Text>
            </View>
          )}

          <View
            style={s.mapWrap}
            onLayout={(e) => setMapSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
          >
            {mapSize.w > 0 && mapSize.h > 0 && (
            <Svg width={mapSize.w} height={mapSize.h} viewBox="0 0 340 250">
              <Path d={RACE_TRACK.d} stroke="#23232e" strokeWidth={22} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              <Path d={RACE_TRACK.d} stroke="#3a3a48" strokeWidth={2} fill="none" strokeDasharray="2 12" />
              {grid.map((k) => {
                const pos = trackPos(totalOf(k));
                const isLeader = k.pilotId === leaderId;
                if (k.isMe) {
                  return <Circle key={k.pilotId} cx={pos.x} cy={pos.y} r={9} fill={colors.racingBlue} stroke="#fff" strokeWidth={2.5} />;
                }
                return (
                  <Circle
                    key={k.pilotId}
                    cx={pos.x}
                    cy={pos.y}
                    r={7}
                    fill={isLeader ? colors.success : k.color}
                    stroke="#0c0c12"
                    strokeWidth={1.5}
                  />
                );
              })}
            </Svg>
            )}
          </View>

          <View style={s.legendRow}>
            <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: colors.racingBlue, borderColor: '#fff', borderWidth: 2 }]} /><Text style={s.legendText}>VOCÊ</Text></View>
            <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: colors.success }]} /><Text style={s.legendText}>líder</Text></View>
            <Text style={s.legendMuted}>+{othersOnTrack} na pista</Text>
          </View>
        </View>

        <View style={[s.divider, !isLandscape && { width: '100%', height: 1, marginVertical: spacing.m }]} />

        {/* ===== DIREITA: velocímetro + dados ===== */}
        <View style={s.right}>
          <View style={s.rTop}>
            <Text style={s.volta}>VOLTA <Text style={s.voltaNum}>{Math.min(myLapNumber, TOTAL_LAPS)}/{TOTAL_LAPS}</Text></Text>
            <View style={s.posWrap}>
              <Text style={s.posLabel}>POS </Text>
              <Text style={s.posValue}>P{posInfo.pos}</Text>
              <Text style={[s.posDelta, { color: posDeltaColor }]}> {posDeltaIcon}{posInfo.delta !== 0 ? Math.abs(posInfo.delta) : ''}</Text>
            </View>
          </View>

          <View style={s.speedRow}>
            <View style={s.speedNumWrap}>
              <Text style={s.speedNum}>{speed}</Text>
              <Text style={s.speedUnit}>km/h</Text>
            </View>
            <Text style={s.speedLabel}>VELOCIDADE</Text>
          </View>

          {/* Barra de velocidade — Views + gradiente nativo (sem SVG, que com
            * porcentagem quebrava em release/Fabric). */}
          <View style={s.barTrack}>
            <View style={s.barBg} />
            <LinearGradient
              colors={[colors.racingBlue, colors.success]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[s.barFill, { width: `${speedFrac * 100}%` }]}
            />
            <View style={[s.barThumb, { left: `${speedFrac * 100}%` }]} />
          </View>

          {/* Cards: tempo volta / Δ melhor / Δ pior */}
          <View style={s.cardsRow}>
            <View style={s.card}>
              <Text style={s.cardLabel}>TEMPO VOLTA</Text>
              <Text style={s.cardValue}>{curLapMs > 0 ? fmtSec(curLapMs) : '—'}</Text>
            </View>
            <View style={s.card}>
              <Text style={[s.cardLabel, { color: colors.accentLime }]}>Δ MELHOR</Text>
              <Text style={[s.cardValue, { color: dBest != null ? (dBest > 0 ? colors.danger : colors.success) : colors.textMuted }]}>
                {dBest != null ? `${dBest > 0 ? '+' : ''}${(dBest / 1000).toFixed(2)}` : '—'}
              </Text>
              <Text style={s.cardSub}>{bestMs != null ? `volta ${fmtSec(bestMs)}` : 'sem volta'}</Text>
            </View>
            <View style={s.card}>
              <Text style={[s.cardLabel, { color: colors.textSecondary }]}>Δ PIOR</Text>
              <Text style={[s.cardValue, { color: dWorst != null ? colors.success : colors.textMuted }]}>
                {dWorst != null ? `${(dWorst / 1000).toFixed(2)}` : '—'}
              </Text>
              <Text style={s.cardSub}>{worstMs != null ? `volta ${fmtSec(worstMs)}` : 'sem volta'}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Encerrar — canto inferior, discreto */}
      <Pressable style={s.endBtn} onPress={handleEnd} hitSlop={10}>
        <Icon name="stop" size={13} color={colors.textPrimary} />
        <Text style={s.endBtnText}>ENCERRAR</Text>
      </Pressable>
      {state === 'requesting' && (
        <View style={s.loading}><Text style={s.loadingText}>abrindo GPS…</Text></View>
      )}

      {/* Confirmação de encerrar — overlay in-app (não Alert nativo). */}
      {confirmingEnd && !finished && (
        <View style={s.resultBackdrop}>
          <View style={s.resultCard}>
            <Text style={s.resultKicker}>ENCERRAR CORRIDA?</Text>
            <Text style={[s.resultSub, { marginTop: spacing.s }]}>Mostra a classificação final da partida.</Text>
            <Pressable
              style={({ pressed }) => [s.resultBtn, { backgroundColor: colors.danger, marginTop: spacing.l }, pressed && { opacity: 0.85 }]}
              onPress={doEnd}
            >
              <Text style={s.resultBtnText}>ENCERRAR</Text>
            </Pressable>
            <Pressable style={s.confirmCancel} onPress={() => setConfirmingEnd(false)}>
              <Text style={s.confirmCancelText}>Continuar correndo</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Classificação final da partida — overlay (não Modal: Modal + orientação
          travada crasha no iOS com New Architecture). */}
      {finished && (
        <View style={s.resultBackdrop}>
          <View style={s.resultCard}>
            <Text style={s.resultKicker}>FIM DA PARTIDA</Text>
            <Text style={s.resultPos}>
              VOCÊ TERMINOU EM <Text style={{ color: colors.accentLime }}>P{myFinalPos}</Text>
            </Text>
            <Text style={s.resultSub}>de {finished?.length ?? 0} pilotos</Text>

            <ScrollView style={s.resultList} showsVerticalScrollIndicator={false}>
              {(finished ?? []).map((k, i) => (
                <View key={k.pilotId} style={[s.resultRow, k.isMe && s.resultRowMe]}>
                  <Text style={[s.resultRowPos, i < 3 && { color: ['#F5C84B', '#C9D2DE', '#D98A4B'][i] }]}>
                    {i + 1}
                  </Text>
                  <View style={[s.resultDot, { backgroundColor: k.isMe ? colors.racingBlue : k.color }]} />
                  <Text style={[s.resultName, k.isMe && { color: colors.racingBlue }]} numberOfLines={1}>
                    {k.name}{k.isMe ? ' (você)' : ''}
                  </Text>
                  <Text style={s.resultLaps}>{Math.max(1, k.lapNumber)}ª volta</Text>
                </View>
              ))}
            </ScrollView>

            <Pressable style={({ pressed }) => [s.resultBtn, pressed && { opacity: 0.85 }]} onPress={() => router.back()}>
              <Text style={s.resultBtnText}>SAIR</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, flexDirection: 'row', gap: spacing.l },

  // Esquerda
  left: { flex: 1, justifyContent: 'space-between' },
  gridHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liveTag: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  liveTagText: { color: colors.textSecondary, fontSize: 12, fontWeight: '800', fontStyle: 'italic', letterSpacing: 1.2 },
  pilotsCount: { color: colors.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  codePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.s,
    paddingVertical: 6,
    paddingHorizontal: spacing.m,
    borderRadius: radius.s,
    backgroundColor: 'rgba(47,107,255,0.10)',
    borderWidth: 1,
    borderColor: colors.racingBlue,
  },
  codePillLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  codePillValue: { color: colors.racingBlue, fontSize: 18, fontWeight: '900', letterSpacing: 3, fontVariant: ['tabular-nums'] },
  mapWrap: { flex: 1, marginVertical: spacing.s },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.l },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  legendMuted: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },

  divider: { width: 1, backgroundColor: colors.border, marginVertical: spacing.xs },

  // Direita
  right: { flex: 1.3, justifyContent: 'center' },
  rTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  volta: { color: colors.textSecondary, fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  voltaNum: { color: colors.textPrimary, fontWeight: '900' },
  posWrap: { flexDirection: 'row', alignItems: 'baseline' },
  posLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  posValue: { color: colors.accentLime, fontSize: 30, fontWeight: '900', fontStyle: 'italic' },
  posDelta: { fontSize: 14, fontWeight: '800' },

  speedRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: spacing.xs },
  speedNumWrap: { flexDirection: 'row', alignItems: 'flex-end' },
  speedNum: { color: colors.textPrimary, fontSize: 96, fontWeight: '900', letterSpacing: -3, lineHeight: 100, fontVariant: ['tabular-nums'] },
  speedUnit: { color: colors.textSecondary, fontSize: 22, fontWeight: '700', marginBottom: 16, marginLeft: 6 },
  speedLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1.5, marginBottom: 18 },

  barTrack: { marginTop: spacing.s, height: 16, justifyContent: 'center' },
  barBg: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: '#23232e' },
  barFill: { position: 'absolute', left: 0, height: 4, borderRadius: 2 },
  barThumb: {
    position: 'absolute',
    width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff',
    marginLeft: -8, top: 0,
    shadowColor: colors.success, shadowOpacity: 0.6, shadowRadius: 6,
  },

  cardsRow: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.l },
  card: { flex: 1, backgroundColor: colors.bgElevated, borderRadius: radius.m, borderWidth: 1, borderColor: colors.border, padding: spacing.m },
  cardLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1, fontStyle: 'italic' },
  cardValue: { color: colors.textPrimary, fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'], marginTop: 4 },
  cardSub: { color: colors.textMuted, fontSize: 10, fontWeight: '600', marginTop: 1 },

  endBtn: {
    position: 'absolute', right: spacing.l, bottom: spacing.s,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.danger, paddingVertical: 8, paddingHorizontal: spacing.m, borderRadius: radius.pill,
  },
  endBtnText: { color: colors.textPrimary, fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },

  loading: { position: 'absolute', top: spacing.s, left: spacing.l },
  loadingText: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic' },

  // ===== Resultado / classificação final =====
  resultBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 100, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: spacing.l },
  resultCard: { width: '100%', maxWidth: 460, backgroundColor: colors.bg, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.l },
  resultKicker: { color: colors.danger, fontSize: 11, fontWeight: '900', letterSpacing: 2, textAlign: 'center' },
  resultPos: { color: colors.textPrimary, fontSize: 24, fontWeight: '900', fontStyle: 'italic', textAlign: 'center', marginTop: 4 },
  resultSub: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 2, marginBottom: spacing.m },
  resultList: { maxHeight: 230, alignSelf: 'stretch' },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.m, paddingVertical: 9, paddingHorizontal: spacing.m, borderRadius: radius.s, marginBottom: 4, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border },
  resultRowMe: { borderColor: colors.racingBlue, backgroundColor: 'rgba(47,107,255,0.08)' },
  resultRowPos: { width: 22, textAlign: 'center', color: colors.textSecondary, fontSize: 15, fontWeight: '900' },
  resultDot: { width: 11, height: 11, borderRadius: 6 },
  resultName: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  resultLaps: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  resultBtn: { marginTop: spacing.m, backgroundColor: colors.racingBlue, borderRadius: radius.m, paddingVertical: 14, alignItems: 'center' },
  resultBtnText: { color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  confirmCancel: { paddingVertical: spacing.m, marginTop: spacing.xs, alignItems: 'center' },
  confirmCancelText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
});
