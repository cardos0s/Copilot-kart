/**
 * Confirmação da pista — onde o piloto decide com informação, não só pelo nome.
 *
 * Chega aqui pela escolha do cadastro. É a última tela do fluxo de cadastro:
 * confirmar define a pista de casa e entra no app.
 */

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { distanceKm, findTrackById, TrackRef } from '../../src/data/tracks';
import { listCustomTracks } from '../../src/storage/customTracks';
import { getTrackStats, TrackStats } from '../../src/storage/db';
import { getProfile, saveProfile } from '../../src/storage/profile';
import { fetchLeaderboard } from '../../src/lib/leaderboard';
import { formatDistanceKm, formatLapShort, orDash } from '../../src/lib/format';
import { Silhouette } from '../../src/lib/trackSilhouette';
import { loadSilhouetteMap, silhouetteFor, TrackShape } from '../../src/components/ui/TrackShape';
import {
  ChevronLeft,
  PrimaryButton,
  SectionLabel,
  StatColumns,
  TypeBadge,
} from '../../src/components/track/parts';
import { colors, fonts, radius, spacing } from '../../src/theme';

const TRACK_AREA_H = 268;
const SHAPE_SIZE = 196;

function HistoryRow({
  label,
  value,
  highlight,
  last,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[s.historyRow, !last && s.historyDivider]}>
      <Text style={s.historyLabel}>{label}</Text>
      <Text style={[s.historyValue, highlight && { color: colors.blueSoft }]}>{value}</Text>
    </View>
  );
}

export default function TrackConfirm() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { trackId } = useLocalSearchParams<{ trackId: string }>();

  const [track, setTrack] = useState<TrackRef | null>(null);
  const [silhouette, setSilhouette] = useState<Silhouette | null>(null);
  const [stats, setStats] = useState<TrackStats | null>(null);
  const [trackRecordMs, setTrackRecordMs] = useState<number | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!trackId) return;
    (async () => {
      const known = findTrackById(trackId);
      if (known) {
        setTrack(known);
      } else {
        const custom = await listCustomTracks();
        setTrack(custom.find((t) => t.id === trackId) ?? null);
      }

      loadSilhouetteMap().then((map) => setSilhouette(silhouetteFor(map, trackId)));
      getTrackStats(trackId).then(setStats).catch(() => {});
      // Sem Supabase configurado a lista volta vazia — o recorde vira "—".
      fetchLeaderboard(trackId, null, 1)
        .then((entries) => setTrackRecordMs(entries[0]?.bestLapMs ?? null))
        .catch(() => {});
    })();
  }, [trackId]);

  useEffect(() => {
    if (!track) return;
    (async () => {
      try {
        const loc = await Location.getLastKnownPositionAsync();
        if (loc) {
          setDistance(
            distanceKm(loc.coords.latitude, loc.coords.longitude, track.lat, track.lng)
          );
        }
      } catch {
        // Distância é complemento; a tela funciona sem ela.
      }
    })();
  }, [track]);

  const handleConfirm = async () => {
    if (!track || saving) return;
    setSaving(true);
    const existing = await getProfile();
    if (existing) await saveProfile({ ...existing, homeTrackId: track.id });
    router.replace('/');
  };

  if (!track) {
    return <View style={s.root} />;
  }

  return (
    <View style={s.root}>
      <View style={s.trackArea}>
        <TrackShape
          silhouette={silhouette}
          size={SHAPE_SIZE}
          color={colors.blue}
          strokeWidth={2.4}
          showStart
        />

        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={[s.backButton, { top: insets.top + 14 }]}
        >
          <ChevronLeft size={16} />
        </Pressable>

        {/* A legenda só faz sentido com traçado gravado: a forma genérica não
            tem largada nenhuma pra marcar. */}
        {silhouette?.real && (
          <View style={s.startLegend}>
            <View style={s.startDot} />
            <Text style={s.startLabel}>Largada / chegada</Text>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{track.shortName}</Text>
            <Text style={s.subtitle}>
              {track.city}, {track.state}
              {distance !== null ? ` · ${formatDistanceKm(distance)}` : ''}
            </Text>
          </View>
          <TypeBadge kind={track.kind} />
        </View>

        <View style={s.statsBlock}>
          <StatColumns
            items={[
              { label: 'Extensão', value: `${track.lengthM} m` },
              { label: 'Curvas', value: orDash(track.turns) },
              { label: 'Largura', value: orDash(track.widthM, ' m') },
            ]}
          />
        </View>

        <SectionLabel style={{ paddingTop: 20, paddingBottom: 4 }}>Seu histórico aqui</SectionLabel>
        <HistoryRow
          label="Melhor volta"
          value={formatLapShort(stats?.bestLapMs)}
          highlight={!!stats?.bestLapMs}
        />
        <HistoryRow label="Sessões" value={String(stats?.sessionCount ?? 0)} />
        <HistoryRow label="Recorde da pista" value={formatLapShort(trackRecordMs)} last />

        <Text style={s.reassurance}>
          Você pode trocar sua pista de casa quando quiser, em Ajustes.
        </Text>
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + spacing.xl }]}>
        <PrimaryButton label="Definir como minha pista" onPress={handleConfirm} disabled={saving} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  trackArea: {
    height: TRACK_AREA_H,
    backgroundColor: colors.surfaceTrack,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    position: 'absolute',
    left: spacing.gutter,
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(8, 9, 12, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  startLegend: {
    position: 'absolute',
    bottom: 16,
    left: spacing.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  startDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.blueSoft,
  },
  startLabel: {
    fontFamily: fonts.semibold,
    fontSize: 9.5,
    letterSpacing: 0.86,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  body: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 18,
    paddingBottom: spacing.xl,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: 22,
    letterSpacing: -0.44,
    color: colors.text,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    color: colors.dim,
    marginTop: 4,
  },
  statsBlock: {
    marginTop: 22,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  historyDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  historyLabel: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  historyValue: {
    fontFamily: fonts.monoMedium,
    fontSize: 17,
    color: colors.text,
  },
  reassurance: {
    // Existe para tirar peso da decisão: sem ela o passo parece irreversível.
    marginTop: 20,
    fontFamily: fonts.regular,
    fontSize: 12.5,
    color: colors.dim,
  },
  footer: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 14,
  },
});
