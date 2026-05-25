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
  LiveMessage,
  LiveSessionInfo,
  ackMessage,
  publishLap,
  publishSample,
  subscribeLiveSession,
} from '../src/lib/liveSession';
import { polylineLength } from '../src/lib/geometry';
import { LapRecord } from '../src/lib/analysis';
import { Button, Card, Icon } from '../src/components/ui';
import { LapResultOverlay } from '../src/components/LapResultOverlay';
import { PilotMessageOverlay } from '../src/components/PilotMessageOverlay';
import { colors, radius, spacing, typography } from '../src/theme';

function fmtLap(ms: number) {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

/**
 * Tempo curto pro cronômetro central do HUD: "34.872" quando <60s,
 * "1:14.523" quando ≥60s. Kart médio fica entre 30-90s/volta — quase
 * sempre cabe na forma curta, que é menos visualmente "pesada" que
 * o "00:34.872" tradicional.
 */
function fmtLapShort(ms: number) {
  const totalS = ms / 1000;
  if (totalS < 60) return totalS.toFixed(3);
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function fmtDelta(ms: number) {
  const sign = ms >= 0 ? '+' : '−'; // U+2212 mesmo width do '+'
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
    // IMU pode vir vazio (sensor falhou, app em background sem foreground
    // ativo, etc) — só passa se tem dado real.
    imuSamples: lap.imuSamples.length > 0 ? lap.imuSamples : undefined,
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
  // Mensagem mais recente vinda da equipe pelo realtime. Quando vira não-null,
  // o PilotMessageOverlay mostra. Auto-limpa após animação (callback onDismiss).
  const [latestTeamMessage, setLatestTeamMessage] = useState<LiveMessage | null>(null);
  const {
    state,
    info,
    liveSamples,
    start,
    stop,
    setReferenceMode,
    setLayoutReference,
    clearLayoutReference,
  } = useLapRecorder();

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

  // Alimenta o tracker de setores com a referência geográfica do layout.
  // Tem que rodar SEPARADO do useLapRecorder porque o layout pode chegar
  // depois (efeito async acima). Quando reference muda → recarrega o tracker;
  // quando vira null → limpa (setores somem da UI). Setores são geográficos
  // (1/3 e 2/3 da polyline), não dependem da PB da sessão.
  useEffect(() => {
    if (reference && reference.samples.length >= 5 && reference.durationMs > 0) {
      setLayoutReference(reference.samples, reference.durationMs);
    } else {
      clearLayoutReference();
    }
  }, [reference, setLayoutReference, clearLayoutReference]);

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

  /**
   * Ativa live broadcast. Chamado pela tela de idle (antes da corrida)
   * pra que QR já apareça pronto pra scan ANTES do cronômetro começar
   * a contar. Não abre o modal automaticamente — QR aparece inline no
   * idle, e o modal é só pra re-exibir grande durante a corrida
   * (espectador que chegou tarde).
   *
   * Se chamado durante recording (legacy path), também não abre modal —
   * tap no badge do top bar abre quando precisar.
   */
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

  // Publica samples em batch + decimados pra realtime. Antes: 1 INSERT
  // por sample, await em loop, ~10Hz. Resultado: lag no painel da equipe
  // após 3-5min (3000+ samples = re-render lento + tantas inserts/seg
  // saturam network/Supabase).
  //
  // Agora: pega só 1 a cada PUBLISH_DECIMATION (4Hz efetivo), e dispara
  // fire-and-forget (sem await no loop) — se a rede engasgar, sample
  // seguinte não espera. Coaching ao vivo não precisa de 10Hz; 4Hz dá
  // ~25cm de precisão em movimento mesmo a 80km/h.
  useEffect(() => {
    if (!live) return;
    const PUBLISH_DECIMATION = 3; // pega 1 a cada 3 samples = ~3.3Hz
    const newOnes = liveSamples.slice(lastSampleIdxRef.current);
    if (newOnes.length === 0) return;
    lastSampleIdxRef.current = liveSamples.length;
    const toSend = newOnes.filter((_, i) => i % PUBLISH_DECIMATION === 0);
    // Fire-and-forget — não bloqueia se network engasgar
    (async () => {
      for (const s of toSend) {
        publishSample(live.id, {
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
            // Setores — null quando o app não tem layout reference carregada.
            // Team panel usa esses pra mostrar delta por setor + ranking.
            currentSectorIdx: info.currentSectorIdx,
            currentSectorElapsedMs: info.currentSectorElapsedMs,
            s1Ms: info.currentSectors.s1Ms,
            s2Ms: info.currentSectors.s2Ms,
            s3Ms: info.currentSectors.s3Ms,
            altitude: s.altitude ?? null,
            altitudeAccuracy: s.altitudeAccuracy ?? null,
          }).catch(() => {
          /* engole — não pode quebrar gravação se realtime falhar */
        });
      }
    })();
  }, [
    live,
    liveSamples,
    info.lapsCompleted,
    info.elapsedMs,
    info.bestLapMs,
    info.currentSectorIdx,
    info.currentSectorElapsedMs,
    info.currentSectors,
    reference,
  ]);

  // Publica nova volta quando lapsCompleted incrementa.
  useEffect(() => {
    if (!live) return;
    if (info.lapsCompleted <= lastLapCountRef.current) return;
    const lapNumber = info.lapsCompleted;
    // Usa lastClosedLap (snapshot da volta que ACABOU de fechar) — tem
    // durationMs específico dessa volta, não bestLapMs (que poderia ser
    // de outra volta). Setores também vêm daqui se layout ref estava
    // carregada quando fechou.
    const closed = info.lastClosedLap;
    const ms = closed?.durationMs ?? info.bestLapMs;
    const sectors = info.lastClosedLapSectors;
    lastLapCountRef.current = lapNumber;
    if (ms != null) {
      publishLap(live.id, {
        lapNumber,
        durationMs: ms,
        finishedAt: Date.now(),
        s1Ms: sectors?.s1Ms ?? null,
        s2Ms: sectors?.s2Ms ?? null,
        s3Ms: sectors?.s3Ms ?? null,
      }).catch(() => {});
    }
  }, [live, info.lapsCompleted, info.bestLapMs, info.lastClosedLap, info.lastClosedLapSectors]);

  // Assina canal realtime da live session pra receber mensagens da equipe.
  // Roda só enquanto `live` está ativa — desmonta + remonta se ativar/desativar.
  // Não escuta samples/laps de volta (esses são EVITAS pelo próprio app —
  // mas o canal os entrega; ignoramos no callback).
  useEffect(() => {
    if (!live) return;
    const unsubscribe = subscribeLiveSession(live.id, {
      onMessage: (msg) => {
        // Sempre exibe a mais recente. Se chega outra durante animação,
        // o overlay reseta e mostra a nova (prioridade humana > anterior).
        setLatestTeamMessage(msg);
      },
    });
    return unsubscribe;
  }, [live]);

  // Callback do overlay quando ANIMAÇÃO termina — marca como reconhecida
  // no backend (pra histórico/latência) e limpa o estado local.
  const handleMessageDismiss = (msgId: number) => {
    ackMessage(msgId).catch(() => {});
    setLatestTeamMessage((curr) => (curr?.id === msgId ? null : curr));
  };

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
      // No idle: se usuário ativou "Compartilhar ao vivo" mas mudou de
      // ideia, encerra a live session pra não deixar órfã no Supabase.
      // Não-bloqueante — falha silenciosa não impede a navegação.
      if (live) {
        endLiveSession(live.code).catch(() => {});
        setLive(null);
      }
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

  // HUD font sizes — pensado pra cockpit, layout 50/50 velocímetro + crono.
  //   - hudFontSize: ~140px landscape / ~96px portrait. Bem grande, mas
  //     dois números só (não 3 blocos competindo). Cabe "34.872" e "96"
  //     respirando.
  //   - hudLabelGap controla o espaço entre o label pequeno e o número.
  // Cap em valores absolutos pra não explodir em tablet/iPad em landscape
  // muito largo.
  const hudFontSize = isLandscape
    ? Math.min(width * 0.14, 160)
    : Math.min(width * 0.22, 96);

  if (state === 'idle') {
    return (
      <IdleView
        trackName={params.trackName ?? 'Pista'}
        reference={reference}
        starting={starting}
        onStart={handleStart}
        onCancel={handleCancel}
        isLandscape={isLandscape}
        live={live}
        liveStarting={liveStarting}
        onEnableLive={handleStartLive}
        onDisableLive={handleStopLive}
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
      {/* Top bar — calmo.
       *
       * Esquerda: X (cancel/discard) · REC ● · L N (volta atual)
       * Direita:  BEST 00:47.281 · live/activate · GPS ±Xm
       *
       * Tudo pequeno: no cockpit, o piloto não lê isso durante a volta.
       * Serve pra checagem rápida no box ou em retas longas.
       */}
      <View style={s.recTopBar}>
        <View style={s.recTopGroup}>
          <Pressable hitSlop={12} onPress={handleCancel} style={s.iconBtn}>
            <Text style={s.close}>✕</Text>
          </Pressable>
          <View style={s.recBadge}>
            <View style={s.recDot} />
            <Text style={s.recBadgeText}>REC</Text>
          </View>
          <Text style={[s.lapCounter, typography.mono]}>
            L {info.lapsCompleted + 1}
          </Text>
        </View>

        <View style={s.recTopGroup}>
          {info.bestLapMs !== null && (
            <View style={s.bestBadge}>
              <Text style={s.bestBadgeLabel}>BEST</Text>
              <Text style={[s.bestBadgeValue, typography.mono]}>
                {fmtLap(info.bestLapMs)}
              </Text>
            </View>
          )}
          {/* Badge de live — só aparece quando JÁ está ativo (ativação acontece
           * antes do start, na tela idle). Tap re-abre o modal QR caso a
           * equipe peça pra mostrar o código de novo. Botão de "ativar"
           * removido do cockpit pra reduzir tempo de exposição/manuseio. */}
          {live && (
            <Pressable
              onPress={() => setLiveModalOpen(true)}
              style={({ pressed }) => [s.liveBadge, pressed && { opacity: 0.7 }]}
            >
              <View style={s.liveDot} />
              <Text style={s.liveBadgeText}>{live.code}</Text>
            </Pressable>
          )}
          <View style={s.recGpsBar}>
            <View style={[s.recGpsDot, { backgroundColor: acc.color }]} />
            <Text style={[s.recGpsText, { color: acc.color }]}>{acc.text}</Text>
          </View>
        </View>
      </View>

      {/* HUD calmo — velocímetro + cronômetro, 50/50.
       *
       * Princípio: piloto olha de relance, dois números grossos pretos
       * (fundo preto, números brancos), sem cor competindo pela atenção.
       * Cor só aparece nos momentos certos:
       *   - Pill de delta embaixo (verde se ganhando, vermelho se perdendo)
       *   - Overlay de GANHOU/PERDEU quando fecha volta (3s, anima por
       *     cima do HUD inteiro)
       *
       * O delta em tempo real vai pro pill discreto no rodapé. O destaque
       * permanente da tela são velo + crono — o que o piloto precisa
       * pra dirigir, não pra analisar.
       */}
      <View style={s.recHud}>
        <View style={s.hudBlock}>
          <Text style={s.hudLabel}>KM/H</Text>
          <Text
            style={[
              s.hudValueBig,
              typography.mono,
              { color: colors.textPrimary, fontSize: hudFontSize },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {info.lastSpeedKmh.toFixed(0)}
          </Text>
        </View>

        <View style={s.hudBlock}>
          <Text style={s.hudLabel}>VOLTA</Text>
          <Text
            style={[
              s.hudValueBig,
              typography.mono,
              { color: colors.textPrimary, fontSize: hudFontSize },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {fmtLapShort(currentLapMs)}
          </Text>
        </View>
      </View>

      {/* Footer — delta pill tappável (esquerda) + Encerrar (direita).
       *
       * Pill de delta:
       *   - Tap alterna entre Δ MELHOR (vs PB) e Δ ANTERIOR (vs volta
       *     anterior). Útil quando muda setup/pneu: PB vira inválida e
       *     piloto compara só contra a volta de antes.
       *   - Cor segue sinal: verde (ganhando) ou vermelho (perdendo).
       *     Fundo escuro, número colorido — discreto, não pisca.
       *   - Sem referência ainda: pill some inteiro (1ª volta da sessão).
       *
       * Encerrar fica pequeno e à direita. Cancelar (descarta) continua no
       * X do topo. Dois caminhos, mesma confirmação.
       */}
      <View style={s.recFooter}>
        {liveDeltaMs !== null ? (
          <Pressable
            onPress={toggleRefMode}
            hitSlop={12}
            style={({ pressed }) => [s.deltaPill, pressed && { opacity: 0.7 }]}
          >
            <View
              style={[
                s.deltaPillDot,
                { backgroundColor: liveDeltaMs > 0 ? colors.danger : colors.success },
              ]}
            />
            <Text
              style={[
                s.deltaPillValue,
                typography.mono,
                { color: liveDeltaMs > 0 ? colors.danger : colors.success },
              ]}
            >
              {fmtDelta(liveDeltaMs)}
            </Text>
            <Text style={s.deltaPillMeta}>
              Δ {info.referenceMode === 'best' ? 'MELHOR' : 'ANTERIOR'}
            </Text>
          </Pressable>
        ) : (
          // Placeholder mantém o slot ocupado pra layout não saltar quando
          // o delta começar a aparecer (lap 2+).
          <View style={s.deltaPillPlaceholder}>
            <Text style={s.deltaPillPlaceholderText}>
              {info.lapsCompleted === 0 ? 'aquecendo…' : 'sem sinal'}
            </Text>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [s.endBtnSmall, pressed && { opacity: 0.8 }]}
          onPress={handleFinish}
        >
          <Icon name="stop" size={14} color={colors.textPrimary} />
          <Text style={s.endBtnSmallText}>Encerrar</Text>
        </Pressable>
      </View>

      {/* Painel de setores — só aparece quando há ref de layout carregada.
       * Sem ref geográfica, não dá pra dividir em S1/S2/S3 — esconde o
       * painel inteiro pra não ocupar espaço inútil.
       *
       * Linha 1: barra com 3 segmentos. Cada um colorido por estado:
       *   - pending (cinza fino): setor ainda não alcançado nesta volta
       *   - active (amarelo): setor em que o piloto está agora
       *   - sector-pb (roxo): setor fechado MAIS RÁPIDO que o melhor da
       *     sessão até esse ponto → nova best do setor
       *   - completed-first (verde): setor fechado mas é a 1ª volta (sem
       *     melhor anterior pra comparar)
       *   - completed-slower (cinza): setor fechado mais lento que o melhor
       *
       * Linha 2: tempos em mono — "S1 12.481" / "S2 —" / etc. Mostra parcial
       * em tempo real do setor atual (S1 cresce enquanto o piloto tá nele).
       */}
      {info.currentSectorIdx !== null && (
        <SectorPanel
          currentSectorIdx={info.currentSectorIdx}
          currentSectorElapsedMs={info.currentSectorElapsedMs}
          currentSectors={info.currentSectors}
          bestSectors={info.bestSectors}
        />
      )}

      {/* Overlay GANHOU/PERDEU — anima 3s por cima de tudo quando volta
       * fecha. Pointer-events=none lá dentro, então não bloqueia toques
       * em Encerrar/X mesmo durante a animação. */}
      <LapResultOverlay
        result={
          info.lastClosedLap
            ? {
                variant: 'race',
                lapNumber: info.lastClosedLap.lapNumber,
                durationMs: info.lastClosedLap.durationMs,
                deltaVsRefMs: info.lastClosedLap.deltaVsRefMs,
                isPb: info.lastClosedLap.isPb,
              }
            : null
        }
      />

      {/* Mensagem da equipe — fica POR CIMA do LapResultOverlay (zIndex 10).
       * Se a equipe manda mensagem durante celebração de volta, mensagem
       * ganha — humano > automático. */}
      <PilotMessageOverlay
        message={latestTeamMessage}
        onDismiss={handleMessageDismiss}
      />

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

/**
 * Painel de setores S1/S2/S3 — barra com 3 segmentos + tempos parciais.
 *
 * Mostrado abaixo do footer principal quando há referência de layout
 * carregada (sem ela, não há divisão geográfica possível).
 *
 * Cada segmento exibe um de 5 estados visuais:
 *   - PENDING (cinza fino): setor ainda não alcançado neste volta
 *   - ACTIVE (amarelo, levemente animado pela cor): piloto está aqui agora
 *   - SECTOR_PB (roxo): setor fechado MAIS rápido que melhor da sessão
 *   - COMPLETED_FIRST (verde): setor fechado, é a 1ª volta (sem comparar)
 *   - COMPLETED_SLOWER (cinza claro): setor fechado mais lento que best
 *
 * O tempo do setor atual cresce em tempo real (parcial). Tempos de
 * setores anteriores ficam congelados conforme o piloto avança.
 */
type SectorState = 'pending' | 'active' | 'sector-pb' | 'completed-first' | 'completed-slower';

function sectorState(
  slotIdx: 0 | 1 | 2,
  currentSectorIdx: 0 | 1 | 2,
  currentSectorMs: number | null,
  bestSectorMs: number | null
): SectorState {
  if (currentSectorMs === null) {
    // Não fechou ainda. Active se for o atual, pending se for futuro.
    if (slotIdx === currentSectorIdx) return 'active';
    return 'pending';
  }
  // Setor fechou nesta volta. Compara contra a melhor da sessão.
  if (bestSectorMs === null) return 'completed-first';
  if (currentSectorMs <= bestSectorMs) return 'sector-pb';
  return 'completed-slower';
}

function sectorBgColor(state: SectorState): string {
  switch (state) {
    case 'pending':
      return colors.surface;
    case 'active':
      return colors.warning;
    case 'sector-pb':
      // Roxo magenta — convenção motorsport pra "sector best"
      return colors.accentMagenta ?? '#B833FF';
    case 'completed-first':
      return colors.success;
    case 'completed-slower':
      return colors.textMuted;
  }
}

function sectorTextColor(state: SectorState): string {
  return state === 'pending' ? colors.textMuted : colors.textPrimary;
}

function SectorPanel({
  currentSectorIdx,
  currentSectorElapsedMs,
  currentSectors,
  bestSectors,
}: {
  currentSectorIdx: 0 | 1 | 2;
  currentSectorElapsedMs: number | null;
  currentSectors: { s1Ms: number | null; s2Ms: number | null; s3Ms: number | null };
  bestSectors: { s1Ms: number | null; s2Ms: number | null; s3Ms: number | null };
}) {
  // Tempos a exibir por slot: setores fechados mostram tempo final,
  // setor ATUAL mostra parcial crescendo (currentSectorElapsedMs), setores
  // futuros mostram "—".
  const slotMs: Array<number | null> = [
    currentSectors.s1Ms ?? (currentSectorIdx === 0 ? currentSectorElapsedMs : null),
    currentSectors.s2Ms ?? (currentSectorIdx === 1 ? currentSectorElapsedMs : null),
    currentSectorIdx === 2 ? currentSectorElapsedMs : null,
  ];
  const bestArr = [bestSectors.s1Ms, bestSectors.s2Ms, bestSectors.s3Ms];
  const closedArr = [currentSectors.s1Ms, currentSectors.s2Ms, currentSectors.s3Ms];

  return (
    <View style={s.sectorPanel}>
      {/* Barra com 3 segmentos */}
      <View style={s.sectorBar}>
        {[0, 1, 2].map((idx) => {
          const i = idx as 0 | 1 | 2;
          const state = sectorState(i, currentSectorIdx, closedArr[i], bestArr[i]);
          return (
            <View
              key={i}
              style={[
                s.sectorSegment,
                { backgroundColor: sectorBgColor(state) },
              ]}
            />
          );
        })}
      </View>

      {/* Linha de tempos */}
      <View style={s.sectorTimes}>
        {[0, 1, 2].map((idx) => {
          const i = idx as 0 | 1 | 2;
          const state = sectorState(i, currentSectorIdx, closedArr[i], bestArr[i]);
          const ms = slotMs[i];
          const color = sectorTextColor(state);
          return (
            <View key={i} style={s.sectorTimeCell}>
              <Text style={[s.sectorTimeLabel, { color }]}>S{i + 1}</Text>
              <Text style={[s.sectorTimeValue, typography.mono, { color }]}>
                {ms !== null ? fmtLapShort(ms) : '—'}
              </Text>
            </View>
          );
        })}
      </View>
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
  live,
  liveStarting,
  onEnableLive,
  onDisableLive,
}: {
  trackName: string;
  reference: TrackLayout | null;
  starting: boolean;
  onStart: () => void;
  onCancel: () => void;
  isLandscape: boolean;
  live: LiveSessionInfo | null;
  liveStarting: boolean;
  onEnableLive: () => Promise<void> | void;
  onDisableLive: () => Promise<void> | void;
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

      <ScrollView
        contentContainerStyle={[
          s.idleBody,
          isLandscape && { flexDirection: 'row', gap: spacing.l },
        ]}
        showsVerticalScrollIndicator={false}
      >
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

          {/* Compartilhar ao vivo — toggle + QR antes de começar.
            * A ideia é ativar AQUI, mostrar o QR pra equipe scanear no
            * conforto da box, e SÓ DEPOIS apertar "Começar". Assim quando
            * o cronômetro começa, a equipe já está conectada e não tem
            * janela de "esperando spectator" com tempo correndo.
            *
            * Se tocar de novo (já ativo), pergunta se quer desativar. */}
          <LiveTogglePanel
            live={live}
            liveStarting={liveStarting}
            onEnable={onEnableLive}
            onDisable={onDisableLive}
          />

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
      </ScrollView>
    </View>
  );
}

/**
 * Card "Compartilhar ao vivo" — toggle + QR inline.
 *
 * Estados:
 *   - desligado: card discreto com switch OFF. Subtítulo explica o que é.
 *   - conectando: switch animando, sem QR ainda.
 *   - ativo: card destacado (border verde) com código grande + QR + link.
 *     Tap no card pergunta se quer desativar.
 *
 * O switch visual é um Pressable com 2 estados — não usa o Switch nativo
 * pra manter o look custom do app.
 */
function LiveTogglePanel({
  live,
  liveStarting,
  onEnable,
  onDisable,
}: {
  live: LiveSessionInfo | null;
  liveStarting: boolean;
  onEnable: () => Promise<void> | void;
  onDisable: () => Promise<void> | void;
}) {
  const handleTap = () => {
    if (liveStarting) return;
    if (live) {
      Alert.alert(
        'Desativar transmissão?',
        `Quem tá com o código ${live.code} vai perder o sinal.`,
        [
          { text: 'Manter ativo', style: 'cancel' },
          { text: 'Desativar', style: 'destructive', onPress: () => onDisable() },
        ]
      );
    } else {
      onEnable();
    }
  };

  const isOn = !!live;

  return (
    <Pressable onPress={handleTap} disabled={liveStarting}>
      <Card
        variant={isOn ? 'glow' : 'default'}
        padding="m"
        style={{
          marginTop: spacing.l,
          ...(isOn && { borderColor: colors.success, borderWidth: 1 }),
        }}
      >
        <View style={s.liveRowHead}>
          <View style={{ flex: 1 }}>
            <Text style={[s.liveRowTitle, isOn && { color: colors.success }]}>
              📡 Compartilhar ao vivo
            </Text>
            <Text style={s.liveRowSub}>
              {liveStarting
                ? 'Conectando ao servidor…'
                : isOn
                  ? 'Equipe pode acompanhar pelo navegador'
                  : 'Ativa antes pra equipe estar pronta no início'}
            </Text>
          </View>
          <View
            style={[
              s.liveToggleTrack,
              isOn && { backgroundColor: colors.success },
              liveStarting && { opacity: 0.5 },
            ]}
          >
            <View
              style={[
                s.liveToggleThumb,
                isOn && { alignSelf: 'flex-end' },
              ]}
            />
          </View>
        </View>

        {isOn && live && (
          <View style={s.liveActiveBox}>
            <View style={s.liveQrInline}>
              <QRCode
                value={`https://copilot-mu-eight.vercel.app/live/${live.code}`}
                size={140}
                backgroundColor="#fff"
                color="#000"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.liveCodeLabel}>CÓDIGO</Text>
              <Text style={[s.liveCodeInline, typography.mono]}>{live.code}</Text>
              <Text style={s.liveUrlInline}>copilot-mu-eight.vercel.app</Text>
              <Text style={s.liveHintInline}>
                A equipe entra como "Equipe" no site e usa esse código.
              </Text>
            </View>
          </View>
        )}
      </Card>
    </Pressable>
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
  // flexGrow ao invés de flex pra funcionar como contentContainerStyle de
  // ScrollView (idleBody virou scrollable depois de adicionar o card de
  // live com QR — conteúdo pode passar da viewport em portrait).
  // Padding horizontal vem do idleRoot (que envolve o ScrollView), então
  // aqui não duplicar.
  idleBody: { flexGrow: 1 },

  // ===== Live toggle panel (no idle) =====
  liveRowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
  },
  liveRowTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  liveRowSub: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  // Switch custom — track + thumb, 2 estados (on/off via alignSelf do thumb)
  liveToggleTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 2,
    justifyContent: 'center',
  },
  liveToggleThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.textPrimary,
  },
  // Conteúdo expandido quando live tá ativo: QR + código + url
  liveActiveBox: {
    flexDirection: 'row',
    gap: spacing.m,
    marginTop: spacing.m,
    paddingTop: spacing.m,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'flex-start',
  },
  liveQrInline: {
    backgroundColor: '#fff',
    padding: 8,
    borderRadius: 10,
  },
  liveCodeLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  liveCodeInline: {
    color: colors.success,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
    marginTop: 2,
  },
  liveUrlInline: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  liveHintInline: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing.s,
    lineHeight: 15,
  },
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
  // Grupo de elementos da top bar (esquerda e direita). Usado pros 2
  // lados: REC+lap counter no esquerdo, BEST+live+GPS no direito.
  recTopGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
  },
  // Badge "REC" — indicador estático de que está gravando. Dot vermelho
  // + label, formato pill curto. Sem animação (piloto não precisa de
  // pulse pra saber que tá gravando; o próprio HUD ativo já mostra).
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.danger + '1A',
    borderWidth: 1,
    borderColor: colors.danger + '55',
  },
  recDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.danger,
  },
  recBadgeText: {
    color: colors.danger,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  lapCounter: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  // Badge "BEST 00:47.281" — info secundária mas útil. Sem fundo, só
  // label muted + valor mono pra contrastar com lap counter à esquerda.
  bestBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
  },
  bestBadgeLabel: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  bestBadgeValue: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.3,
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

  // ===== HUD calmo =====
  // 50/50 com KM/H à esquerda e VOLTA à direita. Os blocos crescem pra
  // ocupar a altura disponível (flex 1 + alignItems center). Labels
  // pequenos servem só pra "ancorar" o número quando o piloto olha de
  // relance — o número em si é o foco.
  recHud: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: spacing.s,
  },
  hudBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hudLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 4,
  },
  hudValueBig: {
    fontWeight: '900',
    letterSpacing: -4,
    includeFontPadding: false,
  },

  // ===== Footer =====
  // Pill de delta tappável (esquerda) + Encerrar (direita). Pill segue
  // a cor do delta (verde/vermelho no número e no dot) mas fundo cinza
  // escuro — discreto, não compete com o HUD.
  recFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s,
    paddingVertical: spacing.s,
  },
  deltaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.m,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  deltaPillDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  deltaPillValue: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  deltaPillMeta: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  // Placeholder enquanto não há delta (1ª volta). Mesma altura do pill
  // pra não deslocar o layout quando o delta aparecer.
  deltaPillPlaceholder: {
    paddingHorizontal: spacing.m,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
  },
  deltaPillPlaceholderText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    fontStyle: 'italic',
  },

  // ===== Sectors =====
  // Painel embaixo do footer: barra fina com 3 segmentos + tempos parciais.
  // Pintado em cores semânticas (roxo=sector PB, verde=1ª completed,
  // amarelo=ativo, cinza=pending/slower).
  sectorPanel: {
    paddingTop: 4,
    paddingBottom: 2,
    gap: 4,
  },
  sectorBar: {
    flexDirection: 'row',
    gap: 4,
    height: 5,
  },
  sectorSegment: {
    flex: 1,
    borderRadius: 2.5,
  },
  sectorTimes: {
    flexDirection: 'row',
    gap: 4,
  },
  sectorTimeCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 5,
  },
  sectorTimeLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  sectorTimeValue: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: -0.3,
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
