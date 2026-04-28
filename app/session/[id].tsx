import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Dimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSession, getLapsForSession, Session, getTrackReference, TrackReference } from '../../src/storage/db';
import { LapRecord, analyzeLap, cleanSamples, matchLapToReference } from '../../src/lib/analysis';
import { buildReferenceLap } from '../../src/lib/geometry';
import { TrackSilhouette } from '../../src/components/TrackSilhouette';
import { colors, spacing, radius, typography } from '../../src/theme';

let MapView: any = null;
let Polyline: any = null;
let Marker: any = null;
let PROVIDER_GOOGLE: any = undefined;
try {
  const maps = require('react-native-maps');
  MapView = maps.default;
  Polyline = maps.Polyline;
  Marker = maps.Marker;
  PROVIDER_GOOGLE = maps.PROVIDER_GOOGLE;
} catch {
  // Expo Go: sem mapa
}

function fmtLap(ms: number) {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function fmtDelta(ms: number) {
  const sign = ms >= 0 ? '+' : '-';
  const abs = Math.abs(ms / 1000);
  return `${sign}${abs.toFixed(3)}s`;
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

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<Session | null>(null);
  const [laps, setLaps] = useState<LapRecord[]>([]);
  const [reference, setReference] = useState<TrackReference | null>(null);
  const [selectedLapId, setSelectedLapId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!id) return;
      setLoading(true);
      const ses = await getSession(id);
      const lapsRaw = await getLapsForSession(id);
      const cleanedLaps = lapsRaw.map((l) => ({ ...l, samples: cleanSamples(l.samples, 10) }));

      let ref: TrackReference | null = null;
      if (ses?.trackId) {
        ref = await getTrackReference(ses.trackId);
      }

      setSession(ses);
      setLaps(cleanedLaps);
      setReference(ref);
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!session || laps.length === 0) {
    return (
      <View style={[s.container, s.center, { padding: spacing.huge }]}>
        <Text style={s.emptyTitle}>Sem voltas nessa sessão</Text>
        <Text style={s.emptyText}>
          Pode ser que o GPS não tenha conseguido sinal suficiente, ou a detecção
          automática não reconheceu nenhuma volta completa.
        </Text>
      </View>
    );
  }

  // Decide a volta de referência: da pista salva (prioridade) ou a melhor da sessão
  const sessionBest = laps.reduce((b, l) => (l.durationMs < b.durationMs ? l : b), laps[0]);
  const useExternalRef = reference !== null;
  const refSamples = useExternalRef ? reference!.samples : sessionBest.samples;
  const refDurationMs = useExternalRef ? reference!.durationMs : sessionBest.durationMs;

  const selected = selectedLapId
    ? laps.find((l) => l.id === selectedLapId) ?? laps[0]
    : laps[0];

  // Análise: se tem referência externa, compara toda volta com ela
  // Se não, compara com a melhor da sessão (menos a própria)
  const refLap = buildReferenceLap(refSamples, {
    lat: refSamples[0].lat,
    lng: refSamples[0].lng,
  });
  const matchedRef = {
    points: refSamples.map((s, i) => {
      const t0 = refSamples[0].t;
      return { s: 0, tMs: s.t - t0, speed: s.speed, x: 0, y: 0 };
    }),
    durationMs: refDurationMs,
    referenceLength: refLap.totalLength,
  };
  // Refaz matched da própria referência com coordenadas locais
  const matchedReferenceProper = matchLapToReference({
    id: 'ref', sessionId: 'ref', startedAt: 0, durationMs: refDurationMs, samples: refSamples,
  }, refLap);

  const isSelectedReference = !useExternalRef && selected.id === sessionBest.id;
  const matchedCurrent = matchLapToReference(selected, refLap);

  const analysis = !isSelectedReference
    ? analyzeLap(matchedCurrent, matchedReferenceProper, 20)
    : null;

  const sectors = analysis?.sectors ?? [];
  const maxAbsDelta = Math.max(1, ...sectors.map((x) => Math.abs(x.deltaMs)));

  const mapPoints = selected.samples.map((p) => ({ latitude: p.lat, longitude: p.lng }));

  let coloredSegments: Array<{ coords: { latitude: number; longitude: number }[]; color: string }> = [];
  if (!isSelectedReference && analysis && MapView) {
    const sectorLen = refLap.totalLength / sectors.length;
    const sampleSectorIdx = matchedCurrent.points.map((p) =>
      Math.min(sectors.length - 1, Math.floor(p.s / sectorLen))
    );
    let current: (typeof coloredSegments)[number] | null = null;
    for (let i = 0; i < selected.samples.length; i++) {
      const idx = sampleSectorIdx[i];
      const color = deltaColor(sectors[idx].deltaMs, maxAbsDelta);
      const coord = { latitude: selected.samples[i].lat, longitude: selected.samples[i].lng };
      if (!current || current.color !== color) {
        if (current) current.coords.push(coord);
        current = { coords: [coord], color };
        coloredSegments.push(current);
      } else {
        current.coords.push(coord);
      }
    }
  }

  const lats = mapPoints.map((p) => p.latitude);
  const lngs = mapPoints.map((p) => p.longitude);
  const region = lats.length
    ? {
        latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
        longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
        latitudeDelta: Math.max(0.003, (Math.max(...lats) - Math.min(...lats)) * 1.8),
        longitudeDelta: Math.max(0.003, (Math.max(...lngs) - Math.min(...lngs)) * 1.8),
      }
    : undefined;

  const { width } = Dimensions.get('window');

  return (
    <ScrollView
      style={[s.container, { paddingTop: insets.top }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + spacing.huge }}
    >
      <View style={s.header}>
        <View style={s.heroSilhouette}>
          <TrackSilhouette
            samples={refSamples}
            width={120}
            height={80}
            strokeColor={colors.primary}
          />
        </View>
        <Text style={s.trackName}>{session.trackName}</Text>
        <Text style={s.sessionMeta}>
          {laps.length} volta{laps.length > 1 ? 's' : ''} · melhor {fmtLap(sessionBest.durationMs)}
        </Text>
        {useExternalRef && (
          <View style={s.refBadge}>
            <Text style={s.refBadgeText}>
              Comparando com referência: {fmtLap(reference!.durationMs)}
            </Text>
          </View>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.lapStrip} contentContainerStyle={{ paddingHorizontal: spacing.l }}>
        {laps.map((lap, i) => {
          const isSel = lap.id === selected.id;
          const isRef = !useExternalRef && lap.id === sessionBest.id;
          const delta = lap.durationMs - refDurationMs;
          return (
            <Pressable
              key={lap.id}
              style={[s.lapChip, isSel && s.lapChipActive, isRef && s.lapChipRef]}
              onPress={() => setSelectedLapId(lap.id)}
            >
              <Text style={[s.lapChipIdx, isSel && s.lapChipIdxActive]}>Volta {i + 1}</Text>
              <Text style={s.lapChipTime}>{fmtLap(lap.durationMs)}</Text>
              {isRef ? (
                <Text style={s.lapChipBadge}>★ melhor</Text>
              ) : (
                <Text style={[s.lapChipDelta, { color: delta > 0 ? colors.danger : colors.primary }]}>
                  {fmtDelta(delta)}
                </Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[s.mapWrap, { height: width * 0.95 }]}>
        {!MapView ? (
          <View style={s.mapFallback}>
            <Text style={s.mapFallbackText}>
              Mapa indisponível no Expo Go{'\n'}(aparece no APK final)
            </Text>
          </View>
        ) : region ? (
          <MapView
            style={{ flex: 1 }}
            provider={PROVIDER_GOOGLE}
            initialRegion={region}
            mapType="satellite"
            showsCompass={false}
          >
            {isSelectedReference || !analysis ? (
              <Polyline coordinates={mapPoints} strokeColor={colors.primary} strokeWidth={5} />
            ) : (
              coloredSegments.map((seg, i) => (
                <Polyline key={i} coordinates={seg.coords} strokeColor={seg.color} strokeWidth={6} />
              ))
            )}
            {mapPoints[0] && (
              <Marker coordinate={mapPoints[0]} title="Linha de largada" pinColor={colors.primary} />
            )}
          </MapView>
        ) : null}
      </View>

      {!isSelectedReference && analysis && (
        <View style={s.analysisBlock}>
          <View style={s.deltaCard}>
            <Text style={s.deltaLabel}>DIFERENÇA TOTAL</Text>
            <Text
              style={[
                s.deltaValue,
                { color: analysis.totalDeltaMs > 0 ? colors.danger : colors.primary },
              ]}
            >
              {fmtDelta(analysis.totalDeltaMs)}
            </Text>
            <Text style={s.deltaSub}>
              {useExternalRef ? 'vs referência' : `vs melhor volta (${fmtLap(refDurationMs)})`}
            </Text>
          </View>

          <Text style={s.sectionTitle}>Onde perdeu tempo</Text>
          {[...sectors]
            .sort((a, b) => b.deltaMs - a.deltaMs)
            .slice(0, 5)
            .map((sec) => (
              <View key={sec.index} style={s.sectorCard}>
                <View style={[s.sectorColorBar, { backgroundColor: deltaColor(sec.deltaMs, maxAbsDelta) }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.sectorTitle}>
                    Setor {sec.index + 1} · m{sec.sStart.toFixed(0)}–{sec.sEnd.toFixed(0)}
                  </Text>
                  <Text style={s.sectorDetail}>
                    Vel média: {(sec.avgSpeedCurrent * 3.6).toFixed(0)} km/h
                    (ref: {(sec.avgSpeedRef * 3.6).toFixed(0)} km/h)
                  </Text>
                </View>
                <Text style={[s.sectorDelta, { color: sec.deltaMs > 0 ? colors.danger : colors.primary }]}>
                  {fmtDelta(sec.deltaMs)}
                </Text>
              </View>
            ))}

          <Text style={s.sectionTitle}>Onde ganhou tempo</Text>
          {[...sectors]
            .sort((a, b) => a.deltaMs - b.deltaMs)
            .slice(0, 3)
            .map((sec) => (
              <View key={sec.index} style={s.sectorCard}>
                <View style={[s.sectorColorBar, { backgroundColor: deltaColor(sec.deltaMs, maxAbsDelta) }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.sectorTitle}>
                    Setor {sec.index + 1} · m{sec.sStart.toFixed(0)}–{sec.sEnd.toFixed(0)}
                  </Text>
                  <Text style={s.sectorDetail}>
                    Vel média: {(sec.avgSpeedCurrent * 3.6).toFixed(0)} km/h
                  </Text>
                </View>
                <Text style={[s.sectorDelta, { color: colors.primary }]}>{fmtDelta(sec.deltaMs)}</Text>
              </View>
            ))}
        </View>
      )}

      {isSelectedReference && (
        <View style={s.refNote}>
          <Text style={s.refNoteTitle}>★ Melhor volta da sessão</Text>
          <Text style={s.refNoteText}>
            Selecione outra volta acima pra ver onde ela perdeu tempo comparada a esta.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: { padding: spacing.xl, paddingBottom: spacing.m, alignItems: 'flex-start' },
  heroSilhouette: {
    width: 120,
    height: 80,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.m,
  },
  trackName: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  sessionMeta: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  refBadge: {
    marginTop: spacing.s,
    paddingHorizontal: spacing.m,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryGlow,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  refBadgeText: { color: colors.primary, fontSize: 12, fontWeight: '700' },

  lapStrip: { paddingVertical: spacing.s },
  lapChip: {
    padding: spacing.m,
    marginRight: spacing.s,
    borderRadius: radius.m,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 100,
    alignItems: 'center',
  },
  lapChipActive: { borderColor: colors.primary, backgroundColor: 'rgba(0,255,136,0.06)' },
  lapChipRef: { borderColor: colors.primary },
  lapChipIdx: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  lapChipIdxActive: { color: colors.primary },
  lapChipTime: { color: colors.textPrimary, fontSize: 16, fontWeight: '800', marginTop: 2, ...typography.mono },
  lapChipBadge: { color: colors.primary, fontSize: 11, fontWeight: '700', marginTop: 2 },
  lapChipDelta: { fontSize: 12, fontWeight: '700', marginTop: 2, ...typography.mono },

  mapWrap: { marginHorizontal: spacing.l, marginTop: spacing.m, borderRadius: radius.l, overflow: 'hidden' },
  mapFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgElevated, padding: spacing.xl },
  mapFallbackText: { color: colors.textMuted, textAlign: 'center', fontSize: 13 },

  analysisBlock: { padding: spacing.l },
  deltaCard: {
    padding: spacing.l,
    borderRadius: radius.l,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  deltaLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  deltaValue: { fontSize: 44, fontWeight: '900', ...typography.mono, marginTop: 4 },
  deltaSub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },

  sectionTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', marginTop: spacing.xxl, marginBottom: spacing.m },
  sectorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.m,
    paddingLeft: 8,
    borderRadius: radius.m,
    backgroundColor: colors.bgElevated,
    marginBottom: spacing.s,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectorColorBar: { width: 4, alignSelf: 'stretch', borderRadius: 2, marginRight: 10 },
  sectorTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  sectorDetail: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  sectorDelta: { fontSize: 17, fontWeight: '800', ...typography.mono, marginLeft: spacing.m },

  emptyTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginTop: spacing.m, lineHeight: 20 },

  refNote: {
    margin: spacing.l,
    padding: spacing.l,
    borderRadius: radius.l,
    backgroundColor: 'rgba(0,255,136,0.06)',
    borderWidth: 1,
    borderColor: colors.primary + '55',
  },
  refNoteTitle: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  refNoteText: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.s, lineHeight: 19 },
});