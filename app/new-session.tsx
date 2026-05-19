import { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TRACKS, TrackRef, distanceKm, findTrackById } from '../src/data/tracks';
import { getTrackReference, listTrackReferences, TrackReference, deleteTrackReference } from '../src/storage/db';
import { getProfile } from '../src/storage/profile';
import { TrackSilhouette } from '../src/components/TrackSilhouette';
import { colors, spacing, radius, typography } from '../src/theme';

type TrackRow = {
  id: string;
  name: string;
  shortName: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  distanceKm: number | null;
  reference: TrackReference | null;
  isHome: boolean;
};

function formatLap(ms: number) {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Ícone genérico de pista — quando não tem samples da referência */
function TrackIconFallback({ trackId }: { trackId: string }) {
  const paths: Record<string, string> = {
    'leandro-melo': 'M 6 26 Q 6 8 22 8 L 36 8 Q 50 8 50 22 Q 50 36 36 36 L 22 36 Q 12 36 12 44',
    'ayrton-senna-lauro': 'M 10 26 Q 2 14 16 8 Q 32 4 44 16 Q 54 28 42 36 Q 26 42 14 34 Z',
    'granja-viana': 'M 6 22 Q 6 6 22 6 Q 40 6 40 18 Q 40 28 30 28 Q 22 28 22 36 L 52 36',
    'interlagos': 'M 10 36 Q 2 16 20 10 Q 40 6 50 18 Q 56 32 38 36 Q 20 36 10 36 Z',
    'speedland': 'M 6 22 L 22 6 L 40 22 L 50 12 L 50 34 L 22 36 Z',
    'aldeia-serra': 'M 10 12 Q 26 6 42 12 Q 54 22 42 32 Q 26 38 10 32 Q 2 22 10 12 Z',
    'speed-park': 'M 6 34 Q 6 12 20 12 Q 34 12 38 24 Q 40 34 26 36 L 52 36',
    'beto-carrero': 'M 6 26 Q 12 10 26 12 Q 40 16 44 28 Q 48 42 30 38 Q 16 34 6 26 Z',
  };
  return (
    <Svg width={60} height={44} viewBox="0 0 60 44">
      <Path
        d={paths[trackId] ?? paths['leandro-melo']}
        stroke={colors.accentMagenta}
        strokeWidth={2.5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export default function NewSession() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [locating, setLocating] = useState(true);
  const [references, setReferences] = useState<TrackReference[]>([]);
  const [homeTrackId, setHomeTrackId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [refs, profile] = await Promise.all([
      listTrackReferences(),
      getProfile(),
    ]);
    setReferences(refs);
    setHomeTrackId(profile?.homeTrackId ?? null);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getLastKnownPositionAsync();
          if (loc) {
            setUserLat(loc.coords.latitude);
            setUserLng(loc.coords.longitude);
          }
        }
      } catch {
        // Sem GPS, ok
      } finally {
        setLocating(false);
      }
    })();
  }, []);

  const rows: TrackRow[] = useMemo(() => {
    const refMap = new Map(references.map((r) => [r.trackId, r]));
    const all = TRACKS.map<TrackRow>((t) => ({
      id: t.id,
      name: t.name,
      shortName: t.shortName,
      city: t.city,
      state: t.state,
      lat: t.lat,
      lng: t.lng,
      distanceKm:
        userLat !== null && userLng !== null
          ? distanceKm(userLat, userLng, t.lat, t.lng)
          : null,
      reference: refMap.get(t.id) ?? null,
      isHome: t.id === homeTrackId,
    }));

    const q = query.trim().toLowerCase();
    const filtered = q
      ? all.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.shortName.toLowerCase().includes(q) ||
            t.city.toLowerCase().includes(q)
        )
      : all;

    // Ordem: pista de casa → pistas com referência → resto (por distância se disponível)
    return [...filtered].sort((a, b) => {
      if (a.isHome && !b.isHome) return -1;
      if (!a.isHome && b.isHome) return 1;
      if (a.reference && !b.reference) return -1;
      if (!a.reference && b.reference) return 1;
      if (a.distanceKm !== null && b.distanceKm !== null) {
        return a.distanceKm - b.distanceKm;
      }
      return 0;
    });
  }, [query, userLat, userLng, references, homeTrackId]);

  const handleSelectTrack = (row: TrackRow) => {
    if (row.reference) {
      // Já tem referência: ação primária = correr. Android Alert tem limite
      // de 3 botões, então "Apagar referência" mora no long-press.
      Alert.alert(
        row.shortName,
        `Referência atual: ${formatLap(row.reference.durationMs)}`,
        [
          { text: 'Bora correr', onPress: () => startRace(row) },
          { text: 'Regravar referência', onPress: () => startReference(row) },
          { text: 'Cancelar', style: 'cancel' },
        ]
      );
    } else {
      // Sem referência — explica o fluxo antes
      Alert.alert(
        `Primeiro conhecer ${row.shortName}`,
        'Para analisar suas voltas, preciso aprender a pista. Dê algumas voltas tranquilas e vou desenhar o traçado.',
        [
          { text: 'Agora não', style: 'cancel' },
          { text: 'Começar reconhecimento', onPress: () => startReference(row) },
        ]
      );
    }
  };

  const startReference = (row: TrackRow) => {
    router.push({
      pathname: '/recording-reference',
      params: {
        trackId: row.id,
        trackName: row.name,
      },
    });
  };

  /**
   * Long-press na pista — abre menu de gerenciamento da referência (incluindo
   * "Apagar"). Mantém o tap simples como ação primária (correr ou reconhecer).
   */
  const handleLongPressTrack = (row: TrackRow) => {
    if (!row.reference) return; // sem ref, long-press não faz nada
    Alert.alert(
      `Gerenciar ${row.shortName}`,
      `Referência atual: ${formatLap(row.reference.durationMs)}`,
      [
        {
          text: 'Apagar referência',
          style: 'destructive',
          onPress: () => confirmDeleteReference(row),
        },
        { text: 'Regravar referência', onPress: () => startReference(row) },
        { text: 'Cancelar', style: 'cancel' },
      ]
    );
  };

  const startRace = (row: TrackRow) => {
    router.push({
      pathname: '/recording',
      params: {
        trackId: row.id,
        trackName: row.name,
      },
    });
  };

  const confirmDeleteReference = (row: TrackRow) => {
    Alert.alert(
      'Apagar referência?',
      `A referência atual de ${row.shortName} será removida. Isso não apaga sessões anteriores.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Apagar',
          style: 'destructive',
          onPress: async () => {
            await deleteTrackReference(row.id);
            await load();
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[s.container, { paddingTop: insets.top + spacing.m }]}>
      <View style={s.header}>
        <Text style={s.title}>Qual pista?</Text>
        <Text style={s.subtitle}>
          Escolha a pista pra começar. Pistas sem referência precisam de 1 sessão de reconhecimento antes.
        </Text>
      </View>

      <View style={s.searchBox}>
        <Text style={s.searchIcon}>🔍</Text>
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar kartódromo..."
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
        />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.list}>
          {rows.map((row) => (
            <Pressable
              key={row.id}
              onPress={() => handleSelectTrack(row)}
              onLongPress={() => handleLongPressTrack(row)}
              delayLongPress={400}
              style={({ pressed }) => [
                s.row,
                row.reference && s.rowReady,
                row.isHome && s.rowHome,
                pressed && { opacity: 0.85 },
              ]}
            >
              <View style={s.iconBox}>
                {row.reference && row.reference.samples.length > 2 ? (
                  <TrackSilhouette
                    samples={row.reference.samples}
                    width={60}
                    height={44}
                    strokeColor={colors.primary}
                  />
                ) : (
                  <TrackIconFallback trackId={row.id} />
                )}
              </View>

              <View style={s.rowBody}>
                <View style={s.rowTitleLine}>
                  <Text style={s.rowTitle} numberOfLines={1}>
                    {row.shortName}
                  </Text>
                  {row.isHome && <Text style={s.homeBadge}>· casa</Text>}
                </View>
                <Text style={s.rowMeta} numberOfLines={1}>
                  {row.city}, {row.state}
                  {row.distanceKm !== null && ` · ${Math.round(row.distanceKm)} km`}
                </Text>
                <View style={s.rowStatus}>
                  {row.reference ? (
                    <>
                      <View style={s.statusDot} />
                      <Text style={s.statusReady}>
                        Referência {formatLap(row.reference.durationMs)}
                      </Text>
                    </>
                  ) : (
                    <Text style={s.statusEmpty}>Pista não reconhecida</Text>
                  )}
                </View>
              </View>

              <Text style={s.chevron}>›</Text>
            </Pressable>
          ))}
          {rows.length === 0 && (
            <Text style={s.emptyText}>Nenhuma pista encontrada com "{query}"</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.l,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: spacing.s,
    lineHeight: 19,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    marginHorizontal: spacing.xl,
    paddingHorizontal: spacing.m,
    gap: spacing.s,
  },
  searchIcon: { fontSize: 14, color: colors.textMuted },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  list: { paddingTop: spacing.l, paddingHorizontal: spacing.l },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    padding: spacing.m,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.l,
    marginBottom: spacing.s,
  },
  rowReady: {
    borderColor: colors.primary + '55',
  },
  rowHome: {
    borderColor: colors.primary,
    borderWidth: 1.5,
  },
  iconBox: {
    width: 64,
    height: 50,
    backgroundColor: colors.bg,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  rowTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  homeBadge: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  rowMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },
  rowStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  statusReady: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    ...typography.mono,
  },
  statusEmpty: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    fontStyle: 'italic',
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 22,
    fontWeight: '300',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    padding: spacing.xl,
  },
});