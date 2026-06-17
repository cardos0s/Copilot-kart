import { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import Svg, { Path } from 'react-native-svg';
import { OnboardingShell } from '../../src/components/OnboardingShell';
import { colors, spacing, radius } from '../../src/theme';
import { saveProfile, getProfile } from '../../src/storage/profile';
import { TRACKS, TrackRef, distanceKm } from '../../src/data/tracks';

/** Ícone simplificado do traçado (SVG estático por enquanto, genérico) */
function TrackIcon({ trackId }: { trackId: string }) {
  // Paths visualmente distintos por pista. Depois podem ser substituídos
  // por silhuetas reais quando o usuário gravar uma volta em cada pista.
  const paths: Record<string, string> = {
    'leandro-melo': 'M 4 18 Q 4 6 14 6 L 22 6 Q 30 6 30 14 Q 30 22 22 22 L 14 22 Q 8 22 8 26',
    'ayrton-senna-lauro': 'M 6 16 Q 2 8 10 4 Q 20 2 26 10 Q 32 18 24 22 Q 16 26 10 20 Z',
    'granja-viana': 'M 4 14 Q 4 4 14 4 Q 24 4 24 12 Q 24 18 18 18 Q 14 18 14 22 L 30 22',
    'interlagos': 'M 6 22 Q 2 10 12 6 Q 22 4 28 12 Q 32 20 22 22 Q 12 22 6 22 Z',
    'speedland': 'M 4 14 L 14 4 L 24 14 L 30 8 L 30 20 L 14 22 Z',
    'aldeia-serra': 'M 6 8 Q 16 4 26 8 Q 32 14 26 20 Q 16 24 6 20 Q 2 14 6 8 Z',
    'speed-park': 'M 4 20 Q 4 8 12 8 Q 20 8 22 14 Q 24 20 16 22 L 30 22',
    'beto-carrero': 'M 4 16 Q 8 6 16 8 Q 24 10 26 18 Q 28 26 18 24 Q 10 22 4 16 Z',
  };
  return (
    <Svg width={36} height={28} viewBox="0 0 36 28">
      <Path
        d={paths[trackId] ?? paths['leandro-melo']}
        stroke={colors.racingBlue}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  );
}

type TrackWithDistance = TrackRef & { distanceKm: number | null };

export default function OnboardingTrack() {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [locating, setLocating] = useState(true);

  // Pega localização pra calcular distâncias
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getLastKnownPositionAsync();
          if (loc) {
            setUserLat(loc.coords.latitude);
            setUserLng(loc.coords.longitude);
          } else {
            const current = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Low,
            });
            setUserLat(current.coords.latitude);
            setUserLng(current.coords.longitude);
          }
        }
      } catch {
        // Sem localização, lista fica sem distâncias. Tudo bem.
      } finally {
        setLocating(false);
      }
    })();
  }, []);

  // Pré-seleciona se já escolheu antes
  useEffect(() => {
    getProfile().then((p) => {
      if (p?.homeTrackId) setSelected(p.homeTrackId);
    });
  }, []);

  // Lista ordenada por distância (se tiver GPS) ou pela ordem original
  const sortedTracks: TrackWithDistance[] = useMemo(() => {
    const withDist = TRACKS.map((t) => ({
      ...t,
      distanceKm:
        userLat !== null && userLng !== null
          ? distanceKm(userLat, userLng, t.lat, t.lng)
          : null,
    }));

    // Filtra por busca
    const q = query.trim().toLowerCase();
    const filtered = q
      ? withDist.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.shortName.toLowerCase().includes(q) ||
            t.city.toLowerCase().includes(q)
        )
      : withDist;

    // Ordena por distância se tiver GPS, senão ordem da lista
    if (userLat !== null) {
      return [...filtered].sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
    }
    return filtered;
  }, [query, userLat, userLng]);

  const handleContinue = async () => {
    const existing = await getProfile();
    if (!existing) return;
    await saveProfile({
      ...existing,
      homeTrackId: selected,
    });
    router.replace('/');
  };

  const handleSkip = async () => {
    const existing = await getProfile();
    if (existing) {
      await saveProfile({ ...existing, homeTrackId: null });
    }
    router.replace('/');
  };

  return (
    <OnboardingShell
      step={3}
      title="Kartódromo de casa?"
      subtitle="Vai aparecer sempre em destaque"
      onContinue={handleContinue}
      onSkip={handleSkip}
      continueDisabled={selected === null}
      continueLabel="Começar a correr"
    >
      <View style={s.searchBox}>
        <Text style={s.searchIcon}>🔍</Text>
        <TextInput
          style={s.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar kartódromo..."
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
        />
      </View>

      {locating && (
        <View style={s.locatingBox}>
          <ActivityIndicator size="small" color={colors.racingBlue} />
          <Text style={s.locatingText}>Localizando pra calcular distâncias...</Text>
        </View>
      )}

      <View style={s.list}>
        {sortedTracks.map((t) => {
          const isActive = selected === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => setSelected(t.id)}
              style={({ pressed }) => [
                s.row,
                isActive && s.rowActive,
                pressed && { opacity: 0.8 },
              ]}
            >
              <View style={s.iconBox}>
                <TrackIcon trackId={t.id} />
              </View>
              <View style={s.rowBody}>
                <Text style={[s.rowTitle, isActive && s.rowTitleActive]} numberOfLines={1}>
                  {t.shortName}
                </Text>
                <Text style={s.rowMeta} numberOfLines={1}>
                  {t.city}, {t.state}
                  {t.distanceKm !== null && ` · ${Math.round(t.distanceKm)} km`}
                </Text>
              </View>
              {isActive && <Text style={s.check}>✓</Text>}
            </Pressable>
          );
        })}
        {sortedTracks.length === 0 && (
          <Text style={s.emptyText}>Nenhum kartódromo encontrado com "{query}"</Text>
        )}
      </View>
    </OnboardingShell>
  );
}

const s = StyleSheet.create({
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    gap: spacing.s,
  },
  searchIcon: {
    fontSize: 14,
    color: colors.textMuted,
  },
  search: {
    flex: 1,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  locatingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    marginTop: spacing.m,
    paddingHorizontal: spacing.s,
  },
  locatingText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  list: {
    marginTop: spacing.l,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    padding: spacing.m,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    marginBottom: spacing.s,
  },
  rowActive: {
    borderColor: colors.racingBlue,
    borderWidth: 1.5,
    backgroundColor: 'rgba(47, 107, 255, 0.08)',
  },
  iconBox: {
    width: 44,
    height: 44,
    backgroundColor: colors.bg,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  rowTitleActive: {
    color: colors.racingBlue,
  },
  rowMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },
  check: {
    color: colors.racingBlue,
    fontSize: 18,
    fontWeight: '800',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    padding: spacing.xl,
  },
});