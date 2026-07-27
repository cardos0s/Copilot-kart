import { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TRACKS, TrackRef, distanceKm, findTrackById } from '../src/data/tracks';
import { addCustomTrack, listCustomTracks } from '../src/storage/customTracks';
import { listAllLayoutsGrouped, TrackLayout } from '../src/storage/db';
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
  /** Layout marcado como default (ou o mais recente). Null se a pista ainda não tem nenhum. */
  defaultLayout: TrackLayout | null;
  /** Quantos layouts essa pista tem ao todo — vira badge "N traçados" quando >1. */
  layoutCount: number;
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
  const [layoutsByTrack, setLayoutsByTrack] = useState<Map<string, TrackLayout[]>>(new Map());
  const [homeTrackId, setHomeTrackId] = useState<string | null>(null);
  const [customTracks, setCustomTracks] = useState<TrackRef[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [grouped, profile, customs] = await Promise.all([
      listAllLayoutsGrouped(),
      getProfile(),
      listCustomTracks(),
    ]);
    setLayoutsByTrack(grouped);
    setCustomTracks(customs);
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
    const all = [...customTracks, ...TRACKS].map<TrackRow>((t) => {
      const layouts = layoutsByTrack.get(t.id) ?? [];
      // listAllLayoutsGrouped ordena: is_default DESC, recorded_at DESC.
      // O primeiro é o default (se houver).
      const defaultLayout = layouts[0] ?? null;
      return {
        id: t.id,
        name: t.name,
        shortName: t.shortName,
        city: t.city,
        state: t.state,
        lat: t.lat,
        lng: t.lng,
        distanceKm:
          userLat !== null && userLng !== null && !(t.lat === 0 && t.lng === 0)
            ? distanceKm(userLat, userLng, t.lat, t.lng)
            : null,
        defaultLayout,
        layoutCount: layouts.length,
        isHome: t.id === homeTrackId,
      };
    });

    const q = query.trim().toLowerCase();
    const filtered = q
      ? all.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.shortName.toLowerCase().includes(q) ||
            t.city.toLowerCase().includes(q)
        )
      : all;

    // Ordem: pista de casa → pistas com layout → resto (por distância se disponível)
    return [...filtered].sort((a, b) => {
      if (a.isHome && !b.isHome) return -1;
      if (!a.isHome && b.isHome) return 1;
      if (a.defaultLayout && !b.defaultLayout) return -1;
      if (!a.defaultLayout && b.defaultLayout) return 1;
      if (a.distanceKm !== null && b.distanceKm !== null) {
        return a.distanceKm - b.distanceKm;
      }
      return 0;
    });
  }, [query, userLat, userLng, layoutsByTrack, homeTrackId]);

  // Tap em qualquer pista → leva pra tela de escolha de traçado. Ela cuida
  // de todos os casos (0 layouts, 1 layout, N layouts, gravar novo). Esta
  // tela aqui só descobre QUAL pista.
  const handleSelectTrack = (row: TrackRow) => {
    router.push({
      pathname: '/track-layouts-picker' as any,
      params: {
        trackId: row.id,
        trackName: row.name,
      },
    });
  };

  // Pista não catalogada → cria custom e segue o fluxo normal. Usa a posição
  // atual como coordenada (quem cadastra costuma estar NA pista).
  const handleAddCustomTrack = async () => {
    const name = query.trim();
    if (name.length < 3) return;
    const track = await addCustomTrack({ name, lat: userLat, lng: userLng });
    await load();
    setQuery('');
    router.push({
      pathname: '/track-layouts-picker' as any,
      params: { trackId: track.id, trackName: track.name },
    });
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

      {/* Pista livre — grava sem kartódromo cadastrado. Ideal pra testar
        * dirigindo (carro/rua): velocímetro, GPS e detecção de volta rodam
        * normalmente, só não há referência/setores de pista. */}
      <Pressable
        onPress={() =>
          router.push({ pathname: '/recording' as any, params: { trackName: 'Treino livre' } })
        }
        style={({ pressed }) => [s.freeCard, pressed && { opacity: 0.9 }]}
      >
        <View style={s.freeIcon}>
          <Text style={{ fontSize: 22 }}>🚗</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.freeTitle}>Pista livre</Text>
          <Text style={s.freeSub} numberOfLines={2}>
            Grave em qualquer lugar, sem kartódromo. Velocímetro, voltas e GPS rodando.
          </Text>
        </View>
        <Text style={s.chevron}>›</Text>
      </Pressable>

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
              style={({ pressed }) => [
                s.row,
                row.defaultLayout && s.rowReady,
                row.isHome && s.rowHome,
                pressed && { opacity: 0.85 },
              ]}
            >
              <View style={s.iconBox}>
                {row.defaultLayout && row.defaultLayout.samples.length > 2 ? (
                  <TrackSilhouette
                    samples={row.defaultLayout.samples}
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
                  {row.city ? `${row.city}, ${row.state}` : 'Pista personalizada'}
                  {row.distanceKm !== null && ` · ${Math.round(row.distanceKm)} km`}
                </Text>
                <View style={s.rowStatus}>
                  {row.defaultLayout ? (
                    <>
                      <View style={s.statusDot} />
                      <Text style={s.statusReady}>
                        {formatLap(row.defaultLayout.durationMs)}
                        {row.layoutCount > 1 && ` · ${row.layoutCount} traçados`}
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

          {/* Pista fora do catálogo → cadastra na hora e segue o fluxo */}
          {query.trim().length >= 3 && (
            <Pressable
              onPress={handleAddCustomTrack}
              style={({ pressed }) => [s.addCustomRow, pressed && { opacity: 0.85 }]}
            >
              <View style={s.addCustomIcon}>
                <Text style={{ fontSize: 20, color: colors.primary }}>＋</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.addCustomTitle} numberOfLines={1}>
                  Adicionar "{query.trim()}"
                </Text>
                <Text style={s.addCustomSub}>
                  Sua pista não tá no catálogo? Cadastra e grava a primeira volta.
                </Text>
              </View>
              <Text style={s.chevron}>›</Text>
            </Pressable>
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
  freeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.l,
    padding: spacing.m,
    backgroundColor: 'rgba(47,107,255,0.10)',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.l,
  },
  freeIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.m,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  freeTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  freeSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 16 },
  addCustomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    marginTop: spacing.m,
    padding: spacing.m,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
    borderRadius: radius.l,
  },
  addCustomIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.m,
    backgroundColor: 'rgba(47,107,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCustomTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  addCustomSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 16 },
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