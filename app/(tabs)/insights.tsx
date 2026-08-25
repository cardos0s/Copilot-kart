/**
 * "Sua volta" — a melhor volta do piloto na pista mais recente, pintada pela
 * velocidade, e onde o tempo vai embora ao longo de todas as voltas dele ali.
 *
 * A tela de sessão responde "esta volta contra a sua melhor". Esta responde o
 * que se repete: uma curva que custou 0,11 s numa volta pode ter sido
 * distração; a mesma curva custando isso em média ao longo de dezenas de
 * voltas é hábito, e é o que vale treinar.
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AiChatThreadSummary,
  getLapsForSession,
  listAiChatThreads,
  listSessions,
} from '../../src/storage/db';
import { refreshAiEnabled } from '../../src/lib/aiAnalysis';
import { findTrackById } from '../../src/data/tracks';
import { buildLapInsight, LapInsight, speedPaint } from '../../src/lib/lapInsight';
import { formatLapPlain } from '../../src/lib/format';
import { PaintedLap } from '../../src/components/analysis/parts';
import { tabBarSpace } from '../../src/components/ui';
import { colors, fonts, radius, spacing } from '../../src/theme';

/** Voltas de quantas sessões entram na conta. */
const SESSION_WINDOW = 12;

function fmtLoss(ms: number) {
  return `+${(ms / 1000).toFixed(3)}`;
}

export default function Insights() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();

  const [loading, setLoading] = useState(true);
  const [insight, setInsight] = useState<LapInsight | null>(null);
  const [trackName, setTrackName] = useState('');
  const [threads, setThreads] = useState<AiChatThreadSummary[]>([]);
  const [aiReady, setAiReady] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sessions = await listSessions();
      const anchor = sessions.find((x) => x.trackId) ?? sessions[0];
      if (!anchor) {
        setInsight(null);
        return;
      }
      const track = anchor.trackId ? findTrackById(anchor.trackId) : null;
      setTrackName(track?.shortName ?? anchor.trackName);

      // Só voltas da MESMA pista: misturar kartódromos faria a média de curva
      // comparar coisas que não se comparam.
      const sameTrack = sessions
        .filter((x) => (anchor.trackId ? x.trackId === anchor.trackId : x.trackName === anchor.trackName))
        .slice(0, SESSION_WINDOW);

      const laps = (await Promise.all(sameTrack.map((x) => getLapsForSession(x.id)))).flat();
      setInsight(buildLapInsight(laps));

      setThreads(await listAiChatThreads(6).catch(() => []));
      setAiReady(await refreshAiEnabled().catch(() => false));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const mapSize = Math.min(width - spacing.gutter * 2, 400);
  const maxLoss = insight ? Math.max(...insight.corners.map((c) => c.lossMs), 1) : 1;

  return (
    <View style={s.root}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.s,
          paddingBottom: tabBarSpace(insets.bottom, 24),
          paddingHorizontal: spacing.gutter,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.title}>Sua volta</Text>

        {loading ? (
          <View style={s.center}>
            <ActivityIndicator color={colors.blue} />
          </View>
        ) : !insight ? (
          <>
            <Text style={s.subtitle}>Ainda sem voltas gravadas</Text>
            <Text style={s.empty}>
              Grave uma sessão e esta tela passa a mostrar sua melhor volta pintada pela
              velocidade, e em quais curvas o tempo vai embora.
            </Text>
          </>
        ) : (
          <>
            <Text style={s.subtitle}>
              {trackName} · {formatLapPlain(insight.best.durationMs)} · pintada pela velocidade
            </Text>

            <View style={s.mapWrap}>
              <PaintedLap
                samples={insight.best.samples}
                minKmh={insight.minKmh}
                maxKmh={insight.maxKmh}
                size={mapSize}
              />
            </View>

            {/* Escala: sem ela a cor é bonita e não informa. */}
            <View style={s.scaleBar}>
              {Array.from({ length: 40 }, (_, i) => (
                <View
                  key={i}
                  style={{
                    flex: 1,
                    height: 4,
                    backgroundColor: speedPaint(
                      insight.minKmh + ((insight.maxKmh - insight.minKmh) * i) / 39,
                      insight.minKmh,
                      insight.maxKmh
                    ),
                  }}
                />
              ))}
            </View>
            <View style={s.scaleLabels}>
              <Text style={s.scaleValue}>
                {insight.minKmh.toFixed(0)}<Text style={s.scaleUnit}> km/h</Text>
              </Text>
              <Text style={s.scaleTitle}>VELOCIDADE</Text>
              <Text style={s.scaleValue}>
                {insight.maxKmh.toFixed(0)}<Text style={s.scaleUnit}> km/h</Text>
              </Text>
            </View>

            {insight.corners.length > 0 && (
              <>
                <View style={s.lossHead}>
                  <Text style={s.lossLabel}>ONDE O TEMPO VAI</Text>
                  <Text style={s.lossTotal}>
                    {(insight.totalLossMs / 1000).toFixed(3)}
                    <Text style={s.lossTotalUnit}> s por volta</Text>
                  </Text>
                </View>

                {insight.corners.map((c) => {
                  const isWorst = insight.worst?.number === c.number;
                  return (
                    <View key={c.number} style={s.lossRow}>
                      <View style={s.lossRowTop}>
                        <Text style={[s.cornerName, isWorst && s.cornerNameWorst]}>
                          Curva {c.number}
                        </Text>
                        <Text style={[s.cornerLoss, isWorst && { color: colors.danger }]}>
                          {fmtLoss(c.lossMs)}
                        </Text>
                      </View>
                      <View style={s.lossTrack}>
                        <View
                          style={{
                            width: `${Math.min(100, (c.lossMs / maxLoss) * 100)}%`,
                            height: 4,
                            borderRadius: radius.pill,
                            backgroundColor: isWorst ? colors.danger : colors.surfaceRail,
                          }}
                        />
                      </View>
                    </View>
                  );
                })}
              </>
            )}

            <Text style={s.reading}>{plainReading(insight)}</Text>

            {/* ── Coach IA ──────────────────────────────────────────
                Separado de propósito. O texto acima sai de aritmética; daqui
                pra baixo é modelo de linguagem, e misturar os dois faz o
                piloto confiar no número errado. */}
            <View style={s.aiHead}>
              <Text style={s.aiMark}>✦</Text>
              <Text style={s.aiTitle}>COACH IA</Text>
              <View style={s.aiRule} />
            </View>

            <Pressable
              onPress={() =>
                aiReady
                  ? router.push({
                      pathname: '/coach' as any,
                      // A tela exige os dois: sem eles ela abre em erro.
                      params: { sessionId: insight.best.sessionId, lapId: insight.best.id },
                    })
                  : router.push('/ai-key' as any)
              }
              style={({ pressed }) => [s.aiCta, pressed && { opacity: 0.85 }]}
            >
              <Text style={s.aiCtaText}>
                {aiReady ? 'Analisar sua melhor volta com IA' : 'Configurar a chave de IA'}
              </Text>
            </Pressable>

            {!aiReady && (
              <Text style={s.aiHint}>
                A análise por IA usa sua própria chave — Claude, Gemini ou OpenAI. Sem ela o
                resto da tela continua funcionando: nada aqui em cima depende de IA.
              </Text>
            )}

            {threads.length > 0 && (
              <>
                <Text style={s.aiSection}>CONVERSAS RECENTES</Text>
                {threads.map((t) => (
                  <Pressable
                    key={t.cacheKey}
                    onPress={() =>
                      router.push({
                        pathname: '/coach' as any,
                        params: { sessionId: t.sessionId, lapId: t.lapId },
                      })
                    }
                    style={({ pressed }) => [s.thread, pressed && { opacity: 0.7 }]}
                  >
                    <View style={s.threadTop}>
                      <Text style={s.threadTrack} numberOfLines={1}>
                        {t.trackName ?? 'Sessão'}
                      </Text>
                      <Text style={s.threadCount}>
                        {t.messageCount} {t.messageCount === 1 ? 'msg' : 'msgs'}
                      </Text>
                    </View>
                    <Text style={s.threadPreview} numberOfLines={2}>
                      {t.preview}
                    </Text>
                  </Pressable>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * Leitura em português dos mesmos números da lista. Aritmética, não IA —
 * por isso ela não fica embaixo do rótulo de coach.
 */
function plainReading(insight: LapInsight): string {
  const w = insight.worst;
  if (!w || insight.lapsUsed === 0) {
    return 'Ainda não há voltas suficientes pra separar hábito de acaso. Mais uma sessão e eu consigo apontar onde o tempo se repete.';
  }
  const apex = w.apexKmh != null ? ` e cai a ${w.apexKmh.toFixed(0)} km/h` : '';
  return `Em ${w.lapsLosing} das ${insight.lapsUsed} voltas você perde tempo na curva ${w.number}${apex} — são ${(w.lossMs / 1000).toFixed(3)} s por volta, o maior pedaço da sua diferença.`;
}

const s = StyleSheet.create({
  reading: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.text,
    marginTop: spacing.xxl,
  },

  aiHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    marginTop: spacing.xxxl,
    marginBottom: spacing.l,
  },
  aiMark: { fontSize: 14, color: colors.blueSoft },
  aiTitle: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.3, color: colors.blueSoft },
  aiRule: { flex: 1, height: 1, backgroundColor: colors.line },
  aiCta: {
    height: 54,
    borderRadius: radius.m,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiCtaText: { fontFamily: fonts.semibold, fontSize: 16, color: colors.textOnPrimary },
  aiHint: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.dim,
    marginTop: spacing.m,
  },
  aiSection: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.muted,
    marginTop: spacing.xxl,
    marginBottom: spacing.s,
  },
  thread: {
    paddingVertical: spacing.l,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  threadTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  threadTrack: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  threadCount: { fontFamily: fonts.regular, fontSize: 13, color: colors.dim },
  threadPreview: {
    fontFamily: fonts.regular,
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.muted,
    marginTop: 4,
  },
  root: { flex: 1, backgroundColor: colors.bg },
  center: { paddingVertical: spacing.huge, alignItems: 'center' },

  title: { fontFamily: fonts.bold, fontSize: 34, letterSpacing: -1, color: colors.text },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.muted,
    marginTop: 6,
  },
  empty: {
    fontFamily: fonts.regular,
    fontSize: 15.5,
    lineHeight: 23,
    color: colors.dim,
    marginTop: spacing.l,
  },

  mapWrap: { alignItems: 'center', marginTop: spacing.xxl, marginBottom: spacing.xxl },
  scaleBar: { flexDirection: 'row', borderRadius: radius.pill, overflow: 'hidden' },
  scaleLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.m,
  },
  scaleValue: {
    fontFamily: fonts.monoMedium,
    fontSize: 15,
    color: colors.muted,
    fontVariant: ['tabular-nums'],
  },
  scaleUnit: { fontFamily: fonts.regular, fontSize: 13, color: colors.dim },
  scaleTitle: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.3, color: colors.muted },

  lossHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: spacing.xxxl,
    marginBottom: spacing.l,
  },
  lossLabel: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.3, color: colors.muted },
  lossTotal: {
    fontFamily: fonts.monoMedium,
    fontSize: 19,
    color: colors.danger,
    fontVariant: ['tabular-nums'],
  },
  lossTotalUnit: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted },

  lossRow: { paddingTop: spacing.l, borderTopWidth: 1, borderTopColor: colors.line },
  lossRowTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.m,
  },
  cornerName: { fontFamily: fonts.regular, fontSize: 19, color: colors.muted },
  cornerNameWorst: { fontFamily: fonts.bold, color: colors.text },
  cornerLoss: {
    fontFamily: fonts.monoMedium,
    fontSize: 19,
    color: colors.muted,
    fontVariant: ['tabular-nums'],
  },
  lossTrack: { height: 4, borderRadius: radius.pill, backgroundColor: 'transparent', marginBottom: spacing.l },

});
