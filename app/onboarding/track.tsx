/**
 * Terceiro passo do cadastro — direção B do handoff: mapa em cima, folha com
 * a lista embaixo.
 *
 * O piloto está em casa e precisa BUSCAR numa lista nacional. É o oposto da
 * tela de chegada na pista (app/at-track.tsx), onde ele está no local e o
 * trabalho é só confirmar. Tratar os dois com a mesma tela é o que fazia a
 * lista parecer longa demais num caso e burocrática no outro.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TRACKS, TrackRef, distanceKm } from '../../src/data/tracks';
import { addCustomTrack, listCustomTracks } from '../../src/storage/customTracks';
import { getAllTrackStats, TrackStats } from '../../src/storage/db';
import { getProfile, saveProfile } from '../../src/storage/profile';
import { silhouetteFor, useSilhouetteMap } from '../../src/components/ui/TrackShape';
import { NearbyMap } from '../../src/components/track/NearbyMap';
import { TrackListRow, TrackRowData } from '../../src/components/track/TrackListRow';
import {
  AddTrackRow,
  PrimaryButton,
  SearchField,
  SectionLabel,
  SheetHandle,
  StepHeader,
  TextLink,
} from '../../src/components/track/parts';
import { colors, fonts, radius, spacing } from '../../src/theme';

/** Até onde uma pista ainda conta como "por perto". */
const NEARBY_KM = 100;
/** Mais pinos que isso viram sopa de pino num mapa de 322 px. */
const MAX_PINS = 6;

export default function OnboardingTrack() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [catalog, setCatalog] = useState<TrackRef[]>(TRACKS);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [stats, setStats] = useState<Map<string, TrackStats>>(new Map());

  const silhouettes = useSilhouetteMap();

  const loadCatalog = useCallback(async () => {
    const custom = await listCustomTracks();
    setCatalog([...TRACKS, ...custom]);
  }, []);

  useEffect(() => {
    loadCatalog();
    getAllTrackStats().then(setStats).catch(() => {});
    getProfile().then((p) => {
      if (p?.homeTrackId) setSelected(p.homeTrackId);
    });
  }, [loadCatalog]);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const last = await Location.getLastKnownPositionAsync();
        const loc =
          last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
        setUserLat(loc.coords.latitude);
        setUserLng(loc.coords.longitude);
      } catch {
        // Sem localização a lista fica sem distância e sem ordenação. Segue.
      }
    })();
  }, []);

  const rows: TrackRowData[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const withDistance = catalog.map((t) => ({
      track: t,
      distanceKm:
        userLat !== null && userLng !== null ? distanceKm(userLat, userLng, t.lat, t.lng) : null,
      silhouette: silhouetteFor(silhouettes, t.id),
      bestLapMs: stats.get(t.id)?.bestLapMs ?? null,
    }));

    const filtered = q
      ? withDistance.filter(
          (r) =>
            r.track.name.toLowerCase().includes(q) ||
            r.track.shortName.toLowerCase().includes(q) ||
            r.track.city.toLowerCase().includes(q)
        )
      : withDistance;

    if (userLat !== null) {
      return [...filtered].sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
    }
    return filtered;
  }, [catalog, query, userLat, userLng, silhouettes, stats]);

  /** A folha mostra o que está perto; a busca abre pro país inteiro. */
  const searching = query.trim().length > 0;
  const visible = useMemo(() => {
    if (searching) return rows;
    if (userLat === null) return rows.slice(0, 8);
    const near = rows.filter((r) => (r.distanceKm ?? 1e9) <= NEARBY_KM);
    return near.length > 0 ? near : rows.slice(0, 5);
  }, [rows, searching, userLat]);

  const pinned = useMemo(() => visible.slice(0, MAX_PINS).map((r) => r.track), [visible]);
  const selectedRow = rows.find((r) => r.track.id === selected) ?? null;

  const handleConfirm = () => {
    if (!selectedRow) return;
    router.push({
      pathname: '/onboarding/track-confirm' as any,
      params: { trackId: selectedRow.track.id },
    });
  };

  const handleSkip = async () => {
    const existing = await getProfile();
    if (existing) await saveProfile({ ...existing, homeTrackId: null });
    router.replace('/');
  };

  const handleAddTrack = async () => {
    const name = query.trim();
    if (name.length < 3) {
      // O campo de busca é o campo do nome: sem nome digitado não há o que cadastrar.
      setSearchFocused(true);
      return;
    }
    const track = await addCustomTrack({ name, lat: userLat, lng: userLng });
    await loadCatalog();
    setQuery('');
    Keyboard.dismiss();
    setSelected(track.id);
  };

  const sectionLabel = searching
    ? `${visible.length} ${visible.length === 1 ? 'resultado' : 'resultados'}`
    : `${visible.length} ${visible.length === 1 ? 'kartódromo' : 'kartódromos'} por perto`;

  return (
    <View style={[s.root, { paddingTop: insets.top + spacing.m }]}>
      <StepHeader step={3} onBack={() => router.back()} />

      <View>
        <NearbyMap
          width={width}
          tracks={pinned}
          selectedId={selected}
          onSelect={setSelected}
          userLat={userLat}
          userLng={userLng}
        />
        <View style={s.searchOverlay}>
          <View style={s.searchBackdrop}>
            <SearchField
              value={query}
              onChangeText={setQuery}
              focused={searchFocused}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
            />
          </View>
        </View>
      </View>

      <View style={s.sheet}>
        <SheetHandle />
        <ScrollView
          contentContainerStyle={s.sheetBody}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <SectionLabel style={{ paddingBottom: 6 }}>{sectionLabel}</SectionLabel>

          {visible.map((r, i) => (
            <TrackListRow
              key={r.track.id}
              data={r}
              selected={selected === r.track.id}
              last={i === visible.length - 1}
              onPress={() => setSelected(r.track.id)}
              showSelect
            />
          ))}

          {visible.length === 0 && (
            <Text style={s.empty}>Nenhum kartódromo encontrado com “{query.trim()}”.</Text>
          )}

          <View style={{ paddingTop: 20 }}>
            <AddTrackRow onPress={handleAddTrack} subtitle="Cadastre e a gente valida em 24 h" />
          </View>
        </ScrollView>

        <View style={[s.footer, { paddingBottom: insets.bottom + spacing.xl }]}>
          <PrimaryButton
            label={selectedRow ? `Usar ${selectedRow.track.shortName}` : 'Escolha um kartódromo'}
            onPress={handleConfirm}
            disabled={!selectedRow}
          />
          <View style={{ marginTop: 12, alignItems: 'center' }}>
            <TextLink label="Escolher depois" onPress={handleSkip} />
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  searchOverlay: {
    position: 'absolute',
    left: spacing.gutter,
    right: spacing.gutter,
    top: 14,
  },
  searchBackdrop: {
    // O blur do handoff não tem equivalente barato aqui; a opacidade alta do
    // fundo faz o mesmo trabalho de descolar o campo da malha.
    backgroundColor: colors.glassBg,
    borderRadius: radius.m,
  },
  sheet: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    marginTop: -18,
  },
  sheetBody: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 6,
    paddingBottom: 8,
  },
  empty: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.dim,
    paddingVertical: spacing.xl,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 12,
  },
});
