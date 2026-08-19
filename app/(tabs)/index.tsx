import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listSessions, Session, getLapsForSession } from '../../src/storage/db';
import { getProfile, PilotProfile } from '../../src/storage/profile';
import { findTrackById } from '../../src/data/tracks';
import { TrackSilhouette } from '../../src/components/TrackSilhouette';
import { tabBarSpace } from '../../src/components/ui';
import { SennaQuoteLine } from '../../src/components/SennaQuoteCard';
import { formatLapPlain } from '../../src/lib/format';
import { peakSpeedMsOfLaps, msToKmh } from '../../src/lib/speed';
import { LapRecord } from '../../src/lib/analysis';
import { colors, fonts, spacing, radius } from '../../src/theme';
import { getPilotType, type PilotType } from '../../src/storage/pilotType';
import { IndoorHome } from '../../src/components/IndoorHome';
import { EvolutionChart } from '../../src/components/EvolutionChart';

/**
 * O traçado atrás dos números fica bem apagado de propósito: ele situa, não
 * compete. Azul cheio nessa espessura brigaria com o tempo da volta, que é o
 * que a tela existe pra mostrar.
 */
const HERO_TRACE = 'rgba(91, 140, 255, 0.30)';

type SessionWithStats = Session & {
  bestLapMs: number | null;
  lapMsList: number[];
  peakSpeedKmh: number;
  laps: LapRecord[];
};

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function fmtKmh(v: number): string {
  return v.toFixed(1).replace('.', ',');
}

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const heroW = screenW - spacing.gutter * 2;
  // Proporção que deixa o traçado com respiro em volta dos números sem empurrar
  // o gráfico pra fora da primeira tela.
  const heroH = Math.round(heroW * 0.78);
  /**
   * Largura em que os números podem viver dentro do traçado. O traçado é a
   * forma real da pista e muda de proporção a cada uma, então o bloco de dados
   * se prende a uma fração do herói em vez de ao desenho — e encolhe sozinho
   * se o conteúdo passar disso (uma volta de mais de um minuto, por exemplo).
   */
  const heroInnerW = Math.round(heroW * 0.58);
  const [profile, setProfile] = useState<PilotProfile | null>(null);
  const [sessions, setSessions] = useState<SessionWithStats[]>([]);
  const [pilotType, setPilotTypeState] = useState<PilotType | null>(null);
  const [evoSel, setEvoSel] = useState<number | null>(null);

  const load = useCallback(async () => {
    setEvoSel(null);
    const [prof, list, pt] = await Promise.all([getProfile(), listSessions(), getPilotType()]);
    setProfile(prof);
    setPilotTypeState(pt);
    const enriched = await Promise.all(
      list.map(async (sess) => {
        const laps = await getLapsForSession(sess.id);
        const lapMsList = laps.map((l) => l.durationMs);
        const bestLapMs = lapMsList.length ? Math.min(...lapMsList) : null;
        const peakSpeedKmh = msToKmh(peakSpeedMsOfLaps(laps));
        return { ...sess, bestLapMs, lapMsList, peakSpeedKmh, laps };
      })
    );
    setSessions(enriched);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const firstName = profile?.name?.split(' ')[0] ?? '';

  const lastSession = sessions[0] ?? null;
  const track = lastSession?.trackId ? findTrackById(lastSession.trackId) : null;

  // Sparkline: melhor volta das últimas N sessões (ordem cronológica)
  const sparkData = sessions
    .filter((s) => s.bestLapMs != null)
    .slice(0, 12)
    .map((s) => s.bestLapMs as number)
    .reverse();

  // Sessões alinhadas ao sparkData (mesma ordem cronológica) p/ tooltip do gráfico.
  const sparkSessions = sessions
    .filter((s) => s.bestLapMs != null)
    .slice(0, 12)
    .reverse();
  const evoSelSession = evoSel != null ? sparkSessions[evoSel] : null;

  // Modo Indoor (competição): home focada em ranking.
  if (pilotType === 'indoor') {
    return <IndoorHome />;
  }

  return (
    <View style={s.root}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.l,
          paddingBottom: tabBarSpace(insets.bottom, 24),
          paddingHorizontal: spacing.gutter,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.greeting}>
          Olá{firstName ? `, ${firstName}` : ''}, pronto para correr?
        </Text>
        <SennaQuoteLine style={{ marginTop: 10 }} />

        {/* Herói: o traçado da última sessão com os números dentro dele. A
            silhueta não é decoração de fundo — é o que dá contexto ao tempo,
            e por isso os dois ocupam o mesmo espaço em vez de se empilharem. */}
        <View style={[s.hero, { height: heroH }]}>
          {lastSession && lastSession.lapMsList.length > 0 ? (
            <View style={s.heroShape} pointerEvents="none">
              <LastSessionSilhouette
                sessionId={lastSession.id}
                width={heroW}
                height={heroH}
                color={HERO_TRACE}
                strokeWidth={1.5}
              />
            </View>
          ) : null}

          <View style={[s.heroData, { maxWidth: heroInnerW }]}>
            {lastSession && lastSession.bestLapMs != null ? (
              <>
                <Text style={s.heroLabel}>TEMPO DA ÚLTIMA VOLTA</Text>
                <Text
                  style={s.heroValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                >
                  {formatLapPlain(lastSession.bestLapMs)}
                </Text>
                <View style={s.heroRule} />
                <Text style={s.heroLabel}>VELOCIDADE MÁXIMA</Text>
                <Text style={s.heroValueSmall} numberOfLines={1} adjustsFontSizeToFit>
                  {fmtKmh(lastSession.peakSpeedKmh)}
                  <Text style={s.heroUnit}> km/h</Text>
                </Text>
              </>
            ) : (
              <>
                <Text style={s.heroLabel}>NENHUMA VOLTA AINDA</Text>
                <Text style={s.heroEmpty}>
                  Sua primeira volta vai dizer onde você pode ganhar tempo.
                </Text>
              </>
            )}
          </View>
        </View>

        {lastSession && (
          <Text style={s.heroFooter}>
            {(track?.shortName ?? lastSession.trackName ?? '').toUpperCase()} ·{' '}
            {new Date(lastSession.startedAt)
              .toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
              .toUpperCase()
              .replace('.', '')}
          </Text>
        )}

        {sparkData.length >= 2 && (
          <>
            <View style={s.sectionRule} />
            <Text style={s.sectionTitle}>Evolução</Text>
            <Text style={s.sectionSub}>
              Seus tempos nas últimas {sparkData.length} sessões
            </Text>

            <View style={s.evoHead}>
              <Text style={s.evoLabel}>SEUS TEMPOS</Text>
              <View style={s.evoHeadRight}>
                <Text style={s.evoValue}>
                  {formatLapPlain(evoSel != null ? sparkData[evoSel] : sparkData[sparkData.length - 1])}
                </Text>
                <Text style={s.evoLabel}>
                  SESSÃO {(evoSel ?? sparkData.length - 1) + 1}
                </Text>
              </View>
            </View>

            <View style={s.evoChart}>
              <EvolutionChart
                data={sparkData}
                width={heroW}
                height={150}
                selectedIndex={evoSel}
                onSelect={setEvoSel}
                formatValue={formatLapPlain}
              />
            </View>

            <View style={s.evoFoot}>
              <Text style={s.evoFootText}>
                {evoSelSession ? fmtDate(evoSelSession.startedAt) : 'toque para ver cada sessão'}
              </Text>
              <Text style={s.evoFootText}>melhor {formatLapPlain(Math.min(...sparkData))}</Text>
            </View>
          </>
        )}

        {sparkData.length === 1 && (
          <>
            <View style={s.sectionRule} />
            <Text style={s.sectionTitle}>Evolução</Text>
            <Text style={s.sectionSub}>
              Grave mais uma sessão pra ver sua evolução — o gráfico compara a melhor volta
              de cada uma.
            </Text>
          </>
        )}

        <Pressable
          style={({ pressed }) => [s.cta, pressed && { opacity: 0.9 }]}
          // Passa pela detecção: quem está no kartódromo não precisa ver a
          // lista nacional pra começar. Ela cai em /new-session sozinha quando
          // não reconhece onde o piloto está.
          onPress={() => router.push('/at-track' as any)}
        >
          <Text style={s.ctaText}>Iniciar sessão</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function LastSessionSilhouette({
  sessionId,
  width,
  height,
  color,
  strokeWidth = 2,
}: {
  sessionId: string;
  width: number;
  height: number;
  color?: string;
  strokeWidth?: number;
}) {
  const [bestSamples, setBestSamples] = useState<any[]>([]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const laps = await getLapsForSession(sessionId);
        if (laps.length === 0) return;
        const best = laps.reduce((a, b) => (a.durationMs < b.durationMs ? a : b));
        setBestSamples(best.samples);
      })();
    }, [sessionId])
  );

  if (bestSamples.length < 2) return null;
  return (
    <TrackSilhouette
      samples={bestSamples}
      width={width}
      height={height}
      strokeColor={color}
      strokeWidth={strokeWidth}
    />
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  greeting: {
    fontFamily: fonts.bold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.76,
    color: colors.text,
  },

  hero: {
    marginTop: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroShape: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroData: {
    alignItems: 'center',
  },
  heroLabel: {
    fontFamily: fonts.semibold,
    fontSize: 9,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  heroValue: {
    fontFamily: fonts.monoMedium,
    fontSize: 42,
    lineHeight: 48,
    letterSpacing: -1,
    color: colors.text,
    fontVariant: ['tabular-nums'],
    marginTop: 6,
  },
  heroRule: {
    width: 74,
    height: 1,
    backgroundColor: colors.line2,
    marginVertical: spacing.l,
  },
  heroValueSmall: {
    fontFamily: fonts.monoMedium,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
    color: colors.text,
    fontVariant: ['tabular-nums'],
    marginTop: 6,
  },
  heroUnit: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.muted,
  },
  heroEmpty: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.dim,
    textAlign: 'center',
    marginTop: spacing.m,
    maxWidth: 240,
  },
  heroFooter: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },

  sectionRule: {
    height: 1,
    backgroundColor: colors.line,
    marginTop: spacing.xxl,
    marginBottom: spacing.xxl,
    marginHorizontal: -spacing.gutter,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 22,
    letterSpacing: -0.44,
    color: colors.text,
  },
  sectionSub: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.muted,
    marginTop: 5,
  },

  evoHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: spacing.xxl,
  },
  evoHeadRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.s,
  },
  evoLabel: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  evoValue: {
    fontFamily: fonts.monoMedium,
    fontSize: 17,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  evoChart: {
    marginTop: spacing.l,
  },
  evoFoot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.m,
  },
  evoFootText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.dim,
  },

  cta: {
    height: 56,
    borderRadius: radius.m,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xxxl,
  },
  ctaText: {
    fontFamily: fonts.semibold,
    fontSize: 17,
    letterSpacing: -0.17,
    color: colors.textOnPrimary,
  },
});
