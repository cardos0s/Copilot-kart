import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TrackRef } from '../../data/tracks';
import { formatDistanceKm, formatLapShort } from '../../lib/format';
import { Silhouette } from '../../lib/trackSilhouette';
import { TrackShape } from '../ui/TrackShape';
import { colors, fonts } from '../../theme';
import { SelectDot, TypeBadge } from './parts';

export type TrackRowData = {
  track: TrackRef;
  distanceKm: number | null;
  silhouette: Silhouette;
  /** Melhor volta do piloto aqui, se ele já correu. */
  bestLapMs: number | null;
};

type Props = {
  data: TrackRowData;
  selected: boolean;
  last?: boolean;
  onPress: () => void;
  /** O indicador circular só aparece onde a linha é uma escolha. */
  showSelect?: boolean;
};

export function TrackListRow({ data, selected, last, onPress, showSelect = false }: Props) {
  const { track, distanceKm, silhouette, bestLapMs } = data;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.row, !last && s.rowDivider, pressed && { opacity: 0.7 }]}
    >
      <TrackShape
        silhouette={silhouette}
        size={36}
        color={selected ? colors.blueSoft : colors.muted}
        strokeWidth={selected ? 2.6 : 2.2}
      />

      <View style={s.body}>
        <View style={s.titleLine}>
          <Text style={[s.name, selected && s.nameSelected]} numberOfLines={1}>
            {track.shortName}
          </Text>
          <TypeBadge kind={track.kind} />
        </View>
        <View style={s.metaLine}>
          <Text style={s.meta} numberOfLines={1}>
            {track.city}, {track.state}
          </Text>
          <View style={s.metaDot} />
          <Text style={s.meta}>{track.lengthM} m</Text>
        </View>
      </View>

      <View style={s.right}>
        <Text style={[s.distance, selected && { color: colors.blueSoft }]}>
          {formatDistanceKm(distanceKm)}
        </Text>
        {bestLapMs !== null && (
          <Text style={s.best}>vc: {formatLapShort(bestLapMs)}</Text>
        )}
      </View>

      {showSelect && <SelectDot selected={selected} />}
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  name: {
    flexShrink: 1,
    fontFamily: fonts.medium,
    fontSize: 15,
    letterSpacing: -0.15,
    color: colors.text,
  },
  nameSelected: {
    fontFamily: fonts.semibold,
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 3,
  },
  meta: {
    flexShrink: 1,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.dim,
  },
  metaDot: {
    width: 2.5,
    height: 2.5,
    borderRadius: 99,
    backgroundColor: colors.line2,
  },
  right: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  distance: {
    fontFamily: fonts.monoMedium,
    fontSize: 13,
    color: colors.muted,
  },
  best: {
    fontFamily: fonts.semibold,
    fontSize: 9,
    letterSpacing: 0.36,
    color: colors.dim,
    marginTop: 3,
  },
});
