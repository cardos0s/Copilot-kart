/**
 * Chegou na pista.
 *
 * O piloto abriu o app no kartódromo — aqui a lista NÃO deve aparecer. Ele
 * está no local e o aparelho já sabe onde ele está; o trabalho é confirmar,
 * não buscar. A busca completa fica um nível abaixo, atrás de "não é essa
 * pista", e mesmo lá a folha só mostra o raio curto: quem está na pista
 * escolhe entre duas ou três opções, não trezentas.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TRACKS, TrackRef, distanceKm } from '../src/data/tracks';
import { listCustomTracks } from '../src/storage/customTracks';
import { getAllTrackStats, TrackStats } from '../src/storage/db';
import { formatDistanceKm, formatLapShort } from '../src/lib/format';
import { silhouetteFor, TrackShape, useSilhouetteMap } from '../src/components/ui/TrackShape';
import { TrackListRow } from '../src/components/track/TrackListRow';
import {
  GhostButton,
  PrimaryButton,
  SheetHandle,
  StatColumns,
  TextLink,
} from '../src/components/track/parts';
import { colors, fonts, radius, spacing } from '../src/theme';

/** Raio em que uma pista conta como "você está nela". */
const AT_TRACK_KM = 1.5;
/** A folha de troca só mostra o que está por perto de verdade. */
const SHEET_RADIUS_KM = 10;
/**
 * Fora deste raio o piloto não está em kartódromo nenhum — provavelmente
 * abriu o app em casa. Aí a lista com busca é a tela certa.
 */
const AWAY_KM = 25;
/** Sem isso a tela de detecção pisca e some antes de ser lida. */
const MIN_DETECTING_MS = 900;

type Status = 'detectando' | 'detectada';

function Radar() {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1900, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 1 - pulse.value,
    transform: [{ scale: 0.35 + pulse.value * 0.65 }],
  }));

  return (
    <View style={s.radar}>
      <View style={s.radarOuter} />
      <View style={s.radarInner} />
      <Animated.View style={[s.radarPulse, ringStyle]} />
      <View style={s.radarHalo} />
      <View style={s.radarDot} />
    </View>
  );
}

export default function AtTrack() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [status, setStatus] = useState<Status>('detectando');
  const [catalog, setCatalog] = useState<TrackRef[]>(TRACKS);
  const [detected, setDetected] = useState<TrackRef | null>(null);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [stats, setStats] = useState<Map<string, TrackStats>>(new Map());
  const [sheetOpen, setSheetOpen] = useState(false);
  const startedAt = useRef(Date.now());

  const silhouettes = useSilhouetteMap();

  useEffect(() => {
    getAllTrackStats().then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      const custom = await listCustomTracks();
      const all = [...TRACKS, ...custom];
      if (!alive) return;
      setCatalog(all);

      // A tela pressupõe permissão concedida. Se o usuário negar, vai direto
      // pra lista com busca — sem insistir no diálogo.
      const { status: permission } = await Location.requestForegroundPermissionsAsync();
      if (!alive) return;
      if (permission !== 'granted') {
        router.replace('/new-session');
        return;
      }

      let coords: { latitude: number; longitude: number } | null = null;
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        coords = loc.coords;
      } catch {
        const last = await Location.getLastKnownPositionAsync();
        coords = last?.coords ?? null;
      }
      if (!alive) return;

      if (!coords) {
        router.replace('/new-session');
        return;
      }
      setUserLat(coords.latitude);
      setUserLng(coords.longitude);

      const ranked = all
        .map((t) => ({ track: t, km: distanceKm(coords!.latitude, coords!.longitude, t.lat, t.lng) }))
        .sort((a, b) => a.km - b.km);
      const nearest = ranked[0] ?? null;
      const runner = ranked[1] ?? null;

      const wait = Math.max(0, MIN_DETECTING_MS - (Date.now() - startedAt.current));
      setTimeout(() => {
        if (!alive) return;
        if (!nearest || nearest.km > AWAY_KM) {
          router.replace('/new-session');
          return;
        }
        setDetected(nearest.track);
        setStatus('detectada');
        // GPS impreciso com duas pistas plausíveis no mesmo raio: em vez de
        // escolher por ele, já abre a folha de troca com as duas.
        const ambiguous =
          nearest.km > AT_TRACK_KM ||
          (runner !== null && runner.km <= AT_TRACK_KM && runner.km - nearest.km < 0.4);
        if (ambiguous) setSheetOpen(true);
      }, wait);
    })();

    return () => {
      alive = false;
    };
  }, [router]);

  const nearbyRows = useMemo(() => {
    if (userLat === null || userLng === null) return [];
    return catalog
      .map((t) => ({
        track: t,
        distanceKm: distanceKm(userLat, userLng, t.lat, t.lng),
        silhouette: silhouetteFor(silhouettes, t.id),
        bestLapMs: stats.get(t.id)?.bestLapMs ?? null,
      }))
      .filter((r) => r.distanceKm <= SHEET_RADIUS_KM)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }, [catalog, userLat, userLng, silhouettes, stats]);

  const detectedStats = detected ? stats.get(detected.id) : undefined;
  const detectedDistance =
    detected && userLat !== null && userLng !== null
      ? distanceKm(userLat, userLng, detected.lat, detected.lng)
      : null;

  const handleStart = () => {
    if (!detected) return;
    router.push({
      pathname: '/track-layouts-picker' as any,
      params: { trackId: detected.id, trackName: detected.name },
    });
  };

  if (status === 'detectando' || !detected) {
    return (
      <View style={s.root}>
        <View style={s.detectingBody}>
          <Radar />
          <Text style={s.detectingTitle}>Procurando a pista</Text>
          <Text style={s.detectingSubtitle}>Usando sua localização</Text>
        </View>
        <View style={[s.footer, { paddingBottom: insets.bottom + spacing.xl }]}>
          <GhostButton label="Escolher manualmente" onPress={() => router.replace('/new-session')} />
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <View style={s.trackArea}>
        <TrackShape
          silhouette={silhouetteFor(silhouettes, detected.id)}
          size={186}
          color={colors.blue}
          strokeWidth={2.4}
        />
        <View style={[s.hereLegend, { top: insets.top + 16 }]}>
          <View style={s.hereDot} />
          <Text style={s.hereLabel}>Você está aqui</Text>
        </View>
      </View>

      <View style={s.body}>
        <Text style={s.name}>{detected.shortName}</Text>
        <Text style={s.subtitle}>
          {detected.city}, {detected.state}
          {detectedDistance !== null ? ` · a ${formatDistanceKm(detectedDistance)} de você` : ''}
        </Text>

        <View style={s.statsBlock}>
          <StatColumns
            items={[
              {
                label: 'Sua melhor',
                value: formatLapShort(detectedStats?.bestLapMs),
                highlight: !!detectedStats?.bestLapMs,
              },
              { label: 'Sessões aqui', value: String(detectedStats?.sessionCount ?? 0) },
              { label: 'Extensão', value: `${detected.lengthM} m` },
            ]}
          />
        </View>
      </View>

      <View style={[s.footer, { paddingBottom: insets.bottom + spacing.xl }]}>
        <PrimaryButton label="Começar sessão" onPress={handleStart} />
        <View style={{ marginTop: 12, alignItems: 'center' }}>
          <Pressable onPress={() => setSheetOpen(true)} hitSlop={10}>
            {({ pressed }) => (
              <Text style={[s.notThisTrack, pressed && { opacity: 0.6 }]}>Não é essa pista</Text>
            )}
          </Pressable>
        </View>
      </View>

      {sheetOpen && (
        <View style={StyleSheet.absoluteFill}>
          <Pressable style={s.overlay} onPress={() => setSheetOpen(false)} />
          <View style={[s.sheet, { paddingBottom: insets.bottom + spacing.xxl }]}>
            <SheetHandle />
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Qual pista?</Text>
              <Text style={s.sheetSubtitle}>Kartódromos num raio de 10 km</Text>
            </View>
            <ScrollView style={s.sheetList} showsVerticalScrollIndicator={false}>
              {nearbyRows.map((r, i) => (
                <TrackListRow
                  key={r.track.id}
                  data={r}
                  selected={r.track.id === detected.id}
                  last={i === nearbyRows.length - 1}
                  onPress={() => {
                    setDetected(r.track);
                    setSheetOpen(false);
                  }}
                />
              ))}
              {nearbyRows.length === 0 && (
                <Text style={s.sheetEmpty}>Nenhum kartódromo num raio de 10 km.</Text>
              )}
            </ScrollView>
            <View style={s.sheetFooter}>
              <TextLink label="Buscar outra pista" onPress={() => router.replace('/new-session')} />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  detectingBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.gutter,
  },
  radar: {
    width: 116,
    height: 116,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 26,
  },
  radarOuter: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  radarInner: {
    position: 'absolute',
    top: 22,
    left: 22,
    right: 22,
    bottom: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.line2,
  },
  radarPulse: {
    position: 'absolute',
    width: 116,
    height: 116,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.blue,
  },
  radarHalo: {
    position: 'absolute',
    width: 23,
    height: 23,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(37, 99, 255, 0.18)',
  },
  radarDot: {
    position: 'absolute',
    width: 13,
    height: 13,
    borderRadius: radius.pill,
    backgroundColor: colors.blue,
  },
  detectingTitle: {
    fontFamily: fonts.semibold,
    fontSize: 19,
    letterSpacing: -0.38,
    color: colors.text,
  },
  detectingSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    color: colors.dim,
    marginTop: 7,
  },

  trackArea: {
    height: 300,
    backgroundColor: colors.surfaceTrack,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hereLegend: {
    position: 'absolute',
    left: spacing.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  hereDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.blueSoft,
  },
  hereLabel: {
    fontFamily: fonts.semibold,
    fontSize: 9.5,
    letterSpacing: 0.86,
    textTransform: 'uppercase',
    color: colors.muted,
  },

  body: {
    flex: 1,
    paddingHorizontal: spacing.gutter,
    paddingTop: 22,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: 24,
    letterSpacing: -0.65,
    color: colors.text,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    color: colors.dim,
    marginTop: 5,
  },
  statsBlock: {
    marginTop: 24,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },

  footer: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 14,
  },
  notThisTrack: {
    fontFamily: fonts.medium,
    fontSize: 13.5,
    color: colors.blueSoft,
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '70%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  sheetHead: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 12,
  },
  sheetTitle: {
    fontFamily: fonts.bold,
    fontSize: 22,
    letterSpacing: -0.44,
    color: colors.text,
  },
  sheetSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    color: colors.dim,
    marginTop: 4,
  },
  sheetList: {
    paddingHorizontal: spacing.gutter,
    marginTop: 8,
  },
  sheetEmpty: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.dim,
    paddingVertical: spacing.xl,
  },
  sheetFooter: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 14,
  },
});
