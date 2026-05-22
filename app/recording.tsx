import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  Vibration,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { useLapRecorder, RecordedLap } from '../src/hooks/useLapRecorder';
import { useLockLandscape } from '../src/hooks/useLockLandscape';
import {
  saveLap,
  saveLayout,
  createSession,
  getDefaultLayoutForTrack,
  getLayout,
  getCurrentPb,
  savePbRecord,
  getGamificationState,
  saveGamificationState,
  TrackLayout,
} from '../src/storage/db';
import {
  Achievement,
  computePreviousStreak,
  getStatsForAchievements,
  levelForXp,
  processAchievementsAfterSession,
  processSessionMilestones,
} from '../src/lib/gamification';
import { setPendingCelebration } from '../src/lib/celebrationQueue';
import { refreshTodayChallenges } from '../src/lib/challenges';
import { pushCoachInsight } from '../src/lib/coachInsights';
import { requestQuickInsight } from '../src/lib/aiAnalysis';
import { peakSpeedMs, msToKmh } from '../src/lib/speed';
import { getProfile } from '../src/storage/profile';
import { publishLeaderboardEntry } from '../src/lib/leaderboard';
import { ensurePilot } from '../src/lib/liveSession';
import {
  createLiveSession,
  endLiveSession,
  LiveSessionInfo,
  publishLap,
  publishSample,
} from '../src/lib/liveSession';
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
  const params = useLocalSearchParams<{
    trackId: string;
    trackName: string;
    layoutId?: string;
    kartSetupId?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Trava o device em landscape — pra esta tela é o uso esperado.
  useLockLandscape();

  const [starting, setStarting] = useState(false);
  const [reference, setReference] = useState<TrackLayout | null>(null);
  const [idlePrompt, setIdlePrompt] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleDismissedRef = useRef(false);
  // Live broadcasting (Supabase realtime). Quando o piloto ativa, criamos
  // uma session lá no backend e vamos jorrando samples/voltas pra spectators
  // assistirem via web. Tudo opcional — funciona offline também.
  const [live, setLive] = useState<LiveSessionInfo | null>(null);
  const [liveModalOpen, setLiveModalOpen] = useState(false);
  const [liveStarting, setLiveStarting] = useState(false);
  const lastSampleIdxRef = useRef(0);
  const lastLapCountRef = useRef(0);
  const { state, info, liveSamples, start, stop, setReferenceMode } = useLapRecorder();

  // Carrega o layout escolhido (passado via params do picker) ou cai pro
  // default da pista. Sessão antiga sem layoutId continua puxando o default.
  useEffect(() => {
    (async () => {
      if (params.layoutId) {
        const l = await getLayout(params.layoutId);
        if (l) {
          setReference(l);
          return;
        }
      }
      if (params.trackId) {
        const l = await getDefaultLayoutForTrack(params.trackId);
        setReference(l);
      }
    })();
  }, [params.trackId, params.layoutId]);

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

  // ===== Live broadcasting =====

  const handleStartLive = async () => {
    setLiveStarting(true);
    try {
      const info = await createLiveSession({
        trackId: params.trackId ?? null,
        trackName: params.trackName ?? 'Pista',
        referenceLapMs: reference?.durationMs ?? null,
      });
      setLive(info);
      lastSampleIdxRef.current = 0;
      lastLapCountRef.current = 0;
      setLiveModalOpen(true);
    } catch (err: any) {
      Alert.alert(
        'Não foi possível ativar live',
        err?.message ?? 'Confere se o Supabase tá configurado (env vars + schema).'
      );
    } finally {
      setLiveStarting(false);
    }
  };

  const handleStopLive = async () => {
    if (!live) return;
    try {
      await endLiveSession(live.code);
    } catch {
      /* silencioso — se já caiu, segue */
    }
    setLive(null);
    setLiveModalOpen(false);
  };

  // Publica deltas de samples (1 por sample, com cap de batch). Roda quando
  // o array de liveSamples cresce. Sem rate limit do nosso lado — Supabase
  // realtime aguenta tranquilo o ritmo de ~1Hz do GPS.
  useEffect(() => {
    if (!live) return;
    const newOnes = liveSamples.slice(lastSampleIdxRef.current);
    if (newOnes.length === 0) return;
    lastSampleIdxRef.current = liveSamples.length;
    (async () => {
      for (const s of newOnes) {
        try {
          await publishSample(live.id, {
            t: s.t,
            lat: s.lat,
            lng: s.lng,
            speed: s.speed,
            heading: s.heading,
            accuracy: s.accuracy,
            lapNumber: info.lapsCompleted,
            lapElapsedMs: info.elapsedMs,
            bestLapMs: info.bestLapMs ?? null,
            deltaVsRefMs:
              reference && info.bestLapMs !== null
                ? info.bestLapMs - reference.durationMs
                : null,
          });
        } catch {
          /* engole — não pode quebrar gravação se realtime falhar */
        }
      }
    })();
  }, [live, liveSamples, info.lapsCompleted, info.elapsedMs, info.bestLapMs, reference]);

  // Publica nova volta quando lapsCompleted incrementa.
  useEffect(() => {
    if (!live) return;
    if (info.lapsCompleted <= lastLapCountRef.current) return;
    const lapNumber = info.lapsCompleted;
    const ms = info.bestLapMs;
    lastLapCountRef.current = lapNumber;
    if (ms != null) {
      publishLap(live.id, {
        lapNumber,
        durationMs: ms,
        finishedAt: Date.now(),
      }).catch(() => {});
    }
  }, [live, info.lapsCompleted, info.bestLapMs]);

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
            // Encerra live primeiro pra spectators verem "AO VIVO" sumir.
            if (live) {
              await endLiveSession(live.code).catch(() => {});
              setLive(null);
            }
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
              layoutId: params.layoutId ?? null,
              kartSetupId: params.kartSetupId ?? null,
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

            // ===== Gamification: processar milestones (PB, XP, level up) =====
            // Detecta se essa é nova PB, sub-threshold, streak, etc. Atualiza
            // estado de XP e cria PB record. Modal de celebração abre quando
            // session/[id] montar e ler a queue (não bloqueia navegação).
            try {
              const trackIdForGame = params.trackId ?? null;
              const layoutIdForGame = params.layoutId ?? null;
              const previousPb = trackIdForGame
                ? await getCurrentPb(trackIdForGame, layoutIdForGame)
                : null;
              const previousStreak = await computePreviousStreak(
                trackIdForGame,
                layoutIdForGame,
                session.id
              );
              const gameState = await getGamificationState();

              const result = processSessionMilestones({
                trackId: trackIdForGame,
                layoutId: layoutIdForGame,
                sessionId: session.id,
                bestLapMs: best.durationMs,
                bestLapId: best.id,
                previousPbMs: previousPb?.durationMs ?? null,
                previousStreakCount: previousStreak,
                currentXp: gameState.xp,
              });

              await saveGamificationState({
                ...gameState,
                xp: result.newXp,
                level: gameState.level, // levelForXp recalcula na leitura
                updatedAt: Date.now(),
              });
              if (result.isNewPb && trackIdForGame) {
                await savePbRecord({
                  id: `pb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  trackId: trackIdForGame,
                  layoutId: layoutIdForGame,
                  sessionId: session.id,
                  lapId: best.id,
                  durationMs: best.durationMs,
                  celebrated: false,
                  createdAt: Date.now(),
                });
              }
              // Achievements — processa só DEPOIS de salvar laps e ter
              // contagens corretas pra "10 sessões", "100 voltas", etc.
              const stats = await getStatsForAchievements(trackIdForGame);
              const previousLevel = levelForXp(gameState.xp);
              const newLevel = levelForXp(result.newXp);
              const newStreak = result.isNewPb ? previousStreak + 1 : 0;
              const newAchievements = await processAchievementsAfterSession({
                sessionId: session.id,
                trackId: trackIdForGame,
                bestLapMs: best.durationMs,
                isNewPb: result.isNewPb,
                newStreak,
                totalLapsAfter: stats.totalLaps,
                totalSessionsAfter: stats.totalSessions,
                sessionsOnSameTrack: stats.sessionsOnTrack,
                newLevel,
                previousLevel,
              });

              if (result.milestones.length > 0 || newAchievements.length > 0) {
                setPendingCelebration({
                  sessionId: session.id,
                  milestones: result.milestones,
                  xpGained: result.xpGained,
                  newXp: result.newXp,
                  achievements: newAchievements,
                });
              }

              // Refresh dos desafios diários — atualiza progresso de "X voltas",
              // "sub-50s", etc baseado na sessão recém salva.
              await refreshTodayChallenges();

              // Empilha insight no Coach flutuante. Tenta gerar texto via LLM
              // (Gemini/Claude/OpenAI conforme provider configurado); se falhar
              // ou não houver IA configurada, cai num mock conciso.
              const peakKmh = msToKmh(peakSpeedMs(best.samples));
              const profileForInsight = await getProfile().catch(() => null);
              const aiInsight = await requestQuickInsight({
                trackName: params.trackName ?? 'Pista',
                bestLapMs: best.durationMs,
                previousPbMs: previousPb?.durationMs ?? null,
                lapCount: lapsToSave.length,
                peakKmh,
                pilotName: profileForInsight?.name ?? null,
              });

              if (aiInsight) {
                pushCoachInsight({
                  title: aiInsight.title,
                  body: aiInsight.body,
                  metric: aiInsight.metric,
                  sessionId: session.id,
                });
              } else if (result.isNewPb) {
                // Fallback sem IA: mensagem genérica de PB
                pushCoachInsight({
                  title: 'Nova melhor volta',
                  body: `Você bateu ${(best.durationMs / 1000).toFixed(3)}s. Tenta repetir nas próximas 3 voltas antes de empurrar mais.`,
                  metric: `${(best.durationMs / 1000).toFixed(3)}s`,
                  sessionId: session.id,
                });
              } else if (result.xpGained >= 50) {
                pushCoachInsight({
                  title: 'Sessão registrada',
                  body: `Volta consistente. Pra próxima, foca em 1 curva específica — mais ganho que tentar a volta inteira.`,
                  sessionId: session.id,
                });
              }

              // Publica PB no leaderboard público (Supabase) — opcional, falha
              // silenciosa se Supabase não configurado. Só publica novas PBs.
              if (result.isNewPb && trackIdForGame) {
                try {
                  const pilotId = await ensurePilot();
                  if (pilotId) {
                    await publishLeaderboardEntry({
                      pilotId,
                      trackId: trackIdForGame,
                      layoutId: layoutIdForGame,
                      bestLapMs: best.durationMs,
                      sessionId: session.id,
                    });
                  }
                } catch {
                  // Sem Supabase / sem internet / RLS reject — engole.
                }
              }
            } catch {
              // Gamification é "nice to have" — qualquer erro engole e não
              // bloqueia o fluxo principal de salvar a sessão.
            }

            if (reference && best.durationMs < reference.durationMs) {
              Alert.alert(
                'Nova melhor volta! 🏆',
                `Você fez ${fmtLap(best.durationMs)} (referência atual: ${fmtLap(reference.durationMs)}).\n\nQuer atualizar a referência do "${reference.name}"?`,
                [
                  {
                    text: 'Manter a antiga',
                    style: 'cancel',
                    onPress: () => router.replace(`/session/${session.id}`),
                  },
                  {
                    text: 'Atualizar',
                    onPress: async () => {
                      // Sobrescreve o layout que tava sendo usado, preservando id/name/isDefault.
                      await saveLayout({
                        ...reference,
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
  // Delta em tempo real estilo MyChron — vem do tracker no hook.
  // Compara o ponto atual da pista contra o mesmo ponto da volta de
  // referência (best ou previous, conforme info.referenceMode).
  const liveDeltaMs = info.liveDeltaMs;
  // Toggle do modo da referência — tap no rótulo "vs MELHOR"/"vs ANTERIOR"
  const toggleRefMode = () => {
    setReferenceMode(info.referenceMode === 'best' ? 'previous' : 'best');
  };
  // Tempo da volta atual em curso. Vem do hook (não do elapsedMs total).
  // Fallback pro elapsed total quando ainda não fechou primeira volta.
  const currentLapMs = info.currentLapElapsedMs ?? info.elapsedMs;

  // HUD font sizes — pensado pra cockpit:
  //   - Delta ~64px landscape / ~56px portrait: legível com capacete a 60cm
  //     da tela mas NÃO domina o visual. Antes era 180px (90% da tela).
  //   - KM/H um pouco menor que delta, suficiente pra ler de relance.
  //   - Tempo da volta atual ainda menor — info secundária.
  // Cap em valores absolutos pra não explodir em tablet/iPad.
  const deltaFontSize = isLandscape
    ? Math.min(width * 0.075, 68)
    : Math.min(width * 0.13, 56);
  const kmhFontSize = isLandscape
    ? Math.min(width * 0.06, 52)
    : Math.min(width * 0.11, 44);
  const lapFontSize = isLandscape
    ? Math.min(width * 0.04, 32)
    : Math.min(width * 0.08, 28);

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
        <View style={s.recTopActions}>
          {live ? (
            <Pressable
              onPress={() => setLiveModalOpen(true)}
              style={({ pressed }) => [s.liveBadge, pressed && { opacity: 0.7 }]}
            >
              <View style={s.liveDot} />
              <Text style={s.liveBadgeText}>{live.code}</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={handleStartLive}
              disabled={liveStarting}
              style={({ pressed }) => [
                s.liveActivateBtn,
                liveStarting && { opacity: 0.5 },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={s.liveActivateText}>📡 Ao vivo</Text>
            </Pressable>
          )}
          <View style={s.recGpsBar}>
            <View style={[s.recGpsDot, { backgroundColor: acc.color }]} />
            <Text style={[s.recGpsText, { color: acc.color }]}>{acc.text}</Text>
          </View>
        </View>
      </View>

      {/* HUD compacto estilo MyChron.
       *
       * Princípio: piloto olha de relance (0.3s) e volta pra pista. Nada
       * gigante dominando, nada que peça leitura cuidadosa. 3 blocos médios
       * lado a lado:
       *
       *   [ DELTA -0.180 ]  [ 56 km/h ]  [ V3 · 00:42 ]
       *
       * O delta tem a cor (verde/vermelho) — captação periférica. KM/H em
       * letras grandes mas não dominantes. Tempo da volta atual + nº da
       * volta juntos no terceiro bloco. Quando bate PB, o card do delta
       * vira "NEW BEST!" em verde por 4s (sem mudar layout — só conteúdo).
       *
       * Abaixo: linha discreta "MELHOR 01:02.500 · vs MELHOR" tappable
       * pra alternar referência. Quase invisível, mas acessível.
       */}
      <View style={s.recHud}>
        {/* Bloco 1: Delta (ou NEW BEST flash, ou tempo da volta como fallback) */}
        <View style={s.hudBlock}>
          {info.justSetNewBest ? (
            <>
              <Text style={[s.hudLabel, { color: colors.success }]}>NEW BEST</Text>
              <Text
                style={[
                  s.hudValueBig,
                  typography.mono,
                  { color: colors.success, fontSize: deltaFontSize },
                ]}
              >
                {info.bestLapMs !== null ? fmtLap(info.bestLapMs) : '—'}
              </Text>
            </>
          ) : liveDeltaMs !== null ? (
            <>
              <Text style={s.hudLabel}>DELTA</Text>
              <Text
                style={[
                  s.hudValueBig,
                  typography.mono,
                  {
                    color: liveDeltaMs > 0 ? colors.danger : colors.success,
                    fontSize: deltaFontSize,
                  },
                ]}
              >
                {fmtDelta(liveDeltaMs)}
              </Text>
            </>
          ) : (
            <>
              <Text style={s.hudLabel}>
                {info.lapsCompleted === 0 ? 'AQUECENDO' : 'SEM SINAL'}
              </Text>
              <Text
                style={[
                  s.hudValueBig,
                  typography.mono,
                  { color: colors.textMuted, fontSize: deltaFontSize },
                ]}
              >
                —
              </Text>
            </>
          )}
        </View>

        {/* Bloco 2: KM/H — sempre presente, instinto do piloto */}
        <View style={s.hudBlock}>
          <Text style={s.hudLabel}>KM/H</Text>
          <Text
            style={[
              s.hudValueBig,
              typography.mono,
              { color: colors.textPrimary, fontSize: kmhFontSize },
            ]}
          >
            {info.lastSpeedKmh.toFixed(0)}
          </Text>
        </View>

        {/* Bloco 3: Volta atual (nº + cronômetro) */}
        <View style={s.hudBlock}>
          <Text style={s.hudLabel}>VOLTA {info.lapsCompleted + 1}</Text>
          <Text
            style={[
              s.hudValueMid,
              typography.mono,
              { color: colors.textPrimary, fontSize: lapFontSize },
            ]}
          >
            {fmtTime(currentLapMs)}
          </Text>
        </View>
      </View>

      {/* Faixa inferior — pílulas pequenas: melhor + toggle de ref + encerrar.
       * Tudo discreto. O piloto olha aqui só quando quer (no box, num
       * momento de respiro). Encerrar fica destacado em vermelho porque é
       * ação importante mas raramente acionada durante a volta. */}
      <View style={s.recFooter}>
        <Pressable
          onPress={toggleRefMode}
          hitSlop={12}
          style={({ pressed }) => [s.footerPill, pressed && { opacity: 0.7 }]}
        >
          <Text style={s.footerPillLabel}>MELHOR</Text>
          <Text style={[s.footerPillValue, typography.mono]}>
            {info.bestLapMs !== null ? fmtLap(info.bestLapMs) : '—'}
          </Text>
          <Text style={s.footerPillMeta}>
            · vs {info.referenceMode === 'best' ? 'MELHOR' : 'ANTERIOR'}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [s.endBtnSmall, pressed && { opacity: 0.8 }]}
          onPress={handleFinish}
        >
          <Icon name="stop" size={14} color={colors.textPrimary} />
          <Text style={s.endBtnSmallText}>Encerrar</Text>
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

      {/* Modal QR — abre quando ativa live ou toca no badge LIVE no topo */}
      <Modal
        visible={liveModalOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setLiveModalOpen(false)}
      >
        <View style={s.liveModalOverlay}>
          <ScrollView contentContainerStyle={s.liveModalScroll}>
            <View style={s.liveModalCard}>
              <Text style={s.liveModalTitle}>Compartilhar ao vivo</Text>
              <Text style={s.liveModalBody}>
                Quem quiser acompanhar abre a câmera do celular/iPad e aponta
                pro QR. Ou digita o código em <Text style={s.liveModalCode}>copilot-mu-eight.vercel.app</Text>.
              </Text>

              {live && (
                <>
                  <View style={s.liveQrBox}>
                    <QRCode
                      value={`https://copilot-mu-eight.vercel.app/live/${live.code}`}
                      size={220}
                      backgroundColor="#fff"
                      color="#000"
                    />
                  </View>
                  <Text style={[s.liveCodeBig, typography.mono]}>{live.code}</Text>
                </>
              )}

              <Pressable
                onPress={() => setLiveModalOpen(false)}
                style={({ pressed }) => [s.liveModalCloseBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={s.liveModalCloseText}>Fechar (segue ao vivo)</Text>
              </Pressable>
              <Pressable
                onPress={handleStopLive}
                style={({ pressed }) => [s.liveModalStopBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={s.liveModalStopText}>Encerrar transmissão</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>
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
  reference: TrackLayout | null;
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
  recTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.m,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.danger + '33',
    borderWidth: 1,
    borderColor: colors.danger,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.danger,
  },
  liveBadgeText: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  liveActivateBtn: {
    paddingHorizontal: spacing.m,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  liveActivateText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },

  liveModalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveModalScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.l,
  },
  liveModalCard: {
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.l,
    padding: spacing.l,
    alignItems: 'center',
  },
  liveModalTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: spacing.s,
  },
  liveModalBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: spacing.l,
  },
  liveModalCode: {
    color: colors.primary,
    fontWeight: '700',
  },
  liveQrBox: {
    backgroundColor: '#fff',
    padding: spacing.m,
    borderRadius: radius.m,
    marginBottom: spacing.m,
  },
  liveCodeBig: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: spacing.l,
  },
  liveModalCloseBtn: {
    paddingVertical: spacing.m,
    paddingHorizontal: spacing.l,
    borderRadius: radius.m,
    backgroundColor: colors.primary,
    alignSelf: 'stretch',
    alignItems: 'center',
    marginBottom: spacing.s,
  },
  liveModalCloseText: {
    color: colors.textOnPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  liveModalStopBtn: {
    paddingVertical: spacing.s,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  liveModalStopText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  recGpsDot: { width: 8, height: 8, borderRadius: 4 },
  recGpsText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },

  // ===== HUD compacto =====
  // Linha central de 3 blocos médios (delta, km/h, volta atual). Cada
  // bloco respira com altura uniforme; labels minúsculas servem de
  // âncora visual quando o número muda (delta oscila, km/h oscila).
  recHud: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: spacing.s,
  },
  hudBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 100,
  },
  hudLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  hudValueBig: {
    fontWeight: '900',
    letterSpacing: -2,
    includeFontPadding: false,
    marginTop: 2,
  },
  hudValueMid: {
    fontWeight: '900',
    letterSpacing: -1,
    includeFontPadding: false,
    marginTop: 2,
  },

  // ===== Footer =====
  // Linha bem fina. Pílula de "MELHOR ... · vs MELHOR" tappable pra
  // alternar referência; ao lado, botão Encerrar compacto. Tudo no nível
  // de "info secundária" — não compete com o HUD central pela atenção.
  recFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s,
    paddingVertical: spacing.s,
  },
  footerPill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    paddingHorizontal: spacing.m,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  footerPillLabel: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  footerPillValue: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  footerPillMeta: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  endBtnSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.m,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
  },
  endBtnSmallText: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
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
