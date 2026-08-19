/**
 * Escolha do traçado da sessão.
 *
 * Dois estados bem diferentes: a pista que o app ainda não conhece, onde a
 * única saída é ensinar (ou correr sem referência), e a pista com um ou mais
 * traçados, onde o trabalho é escolher qual vale pra esta sessão. Cada traçado
 * guarda a própria melhor volta — é isso que mantém a comparação honesta
 * quando o kartódromo muda a configuração.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import {
  deleteLayout,
  getLayoutStats,
  LayoutStats,
  listLayoutsForTrack,
  setDefaultLayout,
  TrackLayout,
} from '../src/storage/db';
import { TrackSilhouette } from '../src/components/TrackSilhouette';
import { placeholderSilhouette, SILHOUETTE_VIEWBOX } from '../src/lib/trackSilhouette';
import { countCorners } from '../src/lib/trackShapeStats';
import { formatLapPlain } from '../src/lib/format';
import { ChevronLeft, PlusIcon, SelectDot } from '../src/components/track/parts';
import { colors, fonts, radius, spacing } from '../src/theme';

/** Nome do primeiro traçado — quem só tem um não precisa batizar nada. */
const FIRST_LAYOUT_NAME = 'Traçado completo';

type LayoutRow = TrackLayout & { corners: number | null; stats: LayoutStats | undefined };

/** A silhueta tracejada do estado vazio: forma genérica, sem promessa de ser a pista. */
function DashedShape({ trackId, size }: { trackId: string; size: number }) {
  const shape = placeholderSilhouette(trackId);
  return (
    <Svg width={size} height={size} viewBox={SILHOUETTE_VIEWBOX} fill="none">
      <Path
        d={shape.d}
        stroke={colors.muted}
        strokeWidth={1.2}
        strokeDasharray="3 2.4"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.7}
      />
    </Svg>
  );
}

export default function TrackLayoutsPicker() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { trackId, trackName } = useLocalSearchParams<{ trackId: string; trackName: string }>();

  const [layouts, setLayouts] = useState<TrackLayout[] | null>(null);
  const [stats, setStats] = useState<Map<string, LayoutStats>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nameModal, setNameModal] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    if (!trackId) return;
    const [result, layoutStats] = await Promise.all([
      listLayoutsForTrack(trackId),
      getLayoutStats(trackId).catch(() => new Map<string, LayoutStats>()),
    ]);
    setLayouts(result);
    setStats(layoutStats);
    setSelectedId((prev) => {
      if (prev && result.some((l) => l.id === prev)) return prev;
      return (result.find((l) => l.isDefault) ?? result[0])?.id ?? null;
    });
  }, [trackId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Contar curvas percorre a polyline inteira de cada traçado; sem memo isso
  // rodaria a cada toque na lista.
  const rows: LayoutRow[] = useMemo(
    () =>
      (layouts ?? []).map((l) => ({
        ...l,
        corners: countCorners(l.samples),
        stats: stats.get(l.id),
      })),
    [layouts, stats]
  );

  const selected = rows.find((l) => l.id === selectedId) ?? null;

  const goToPreflight = (layoutId?: string) => {
    router.push({
      pathname: '/preflight' as any,
      params: { trackId: trackId!, trackName: trackName!, ...(layoutId ? { layoutId } : {}) },
    });
  };

  const recordLayout = (layoutName: string) => {
    router.push({
      pathname: '/recording-reference',
      params: { trackId: trackId!, trackName: trackName!, layoutName },
    });
  };

  const handleNewLayoutConfirm = () => {
    const name = newName.trim();
    if (!name) {
      Alert.alert('Nome obrigatório', 'Dá um nome pro traçado novo.');
      return;
    }
    setNameModal(false);
    setNewName('');
    recordLayout(name);
  };

  const handleLongPress = (layout: TrackLayout) => {
    const buttons: Array<{ text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }> = [
      { text: 'Cancelar', style: 'cancel' },
    ];
    if (!layout.isDefault) {
      buttons.unshift({
        text: 'Tornar padrão',
        onPress: async () => {
          await setDefaultLayout(trackId!, layout.id);
          await load();
        },
      });
    }
    buttons.unshift({
      text: 'Apagar traçado',
      style: 'destructive',
      onPress: () => {
        Alert.alert(
          'Apagar traçado?',
          `"${layout.name}" será removido. Sessões antigas que usaram esse traçado ficam, mas não vão mais ter a referência pra comparar.`,
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Apagar',
              style: 'destructive',
              onPress: async () => {
                await deleteLayout(layout.id);
                await load();
              },
            },
          ]
        );
      },
    });
    Alert.alert(`Gerenciar "${layout.name}"`, undefined, buttons);
  };

  if (!trackId || !trackName) {
    return (
      <View style={[s.root, s.center]}>
        <Text style={s.errorText}>Faltando trackId ou trackName na URL.</Text>
      </View>
    );
  }

  const header = (
    <View style={[s.header, { paddingTop: insets.top + spacing.s }]}>
      <View style={s.headerLine}>
        <Pressable onPress={() => router.back()} hitSlop={14}>
          <ChevronLeft size={20} />
        </Pressable>
        <Text style={s.title}>Traçado da sessão</Text>
      </View>
      <Text style={s.subtitle} numberOfLines={1}>
        {trackName}
      </Text>
    </View>
  );

  if (layouts === null) {
    return (
      <View style={s.root}>
        {header}
        <View style={s.center}>
          <ActivityIndicator color={colors.blue} />
        </View>
      </View>
    );
  }

  // ── pista que o app ainda não conhece ───────────────────────────
  if (layouts.length === 0) {
    return (
      <View style={s.root}>
        {header}
        <View style={s.emptyBody}>
          <DashedShape trackId={trackId} size={Math.min(220, width * 0.55)} />
          <Text style={s.emptyTitle}>Ainda não conheço esta pista</Text>
          <Text style={s.emptyText}>
            Dê algumas voltas tranquilas e eu desenho o traçado. Depois disso, cada sessão
            aqui já nasce comparável.
          </Text>
        </View>
        <View style={[s.footer, { paddingBottom: insets.bottom + spacing.xl }]}>
          <Pressable
            onPress={() => recordLayout(FIRST_LAYOUT_NAME)}
            style={({ pressed }) => [s.cta, pressed && { opacity: 0.9 }]}
          >
            <Text style={s.ctaText}>Gravar traçado</Text>
          </Pressable>
          {/* Sem traçado o app ainda conta voltas — a linha de chegada sai do
              próprio primeiro trecho em ritmo. O que se perde é setor e
              comparação, não a sessão. */}
          <Pressable onPress={() => goToPreflight()} hitSlop={10} style={s.linkWrap}>
            {({ pressed }) => (
              <Text style={[s.link, pressed && { opacity: 0.6 }]}>Correr sem traçado</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  // ── pista com traçado ───────────────────────────────────────────
  return (
    <View style={s.root}>
      {header}
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.intro}>
          Cada traçado guarda sua própria melhor volta, então as comparações ficam
          consistentes.
        </Text>

        {rows.map((l, i) => {
          const on = l.id === selectedId;
          const meta = [
            `${l.lengthM.toFixed(0)} m`,
            l.corners != null ? `${l.corners} curvas` : null,
            l.stats ? `${l.stats.sessionCount} ${l.stats.sessionCount === 1 ? 'sessão' : 'sessões'}` : null,
          ].filter(Boolean).join(' · ');

          return (
            <Pressable
              key={l.id}
              onPress={() => setSelectedId(l.id)}
              onLongPress={() => handleLongPress(l)}
              delayLongPress={400}
              style={({ pressed }) => [
                s.row,
                i < rows.length - 1 && s.rowDivider,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={s.rowShape}>
                <TrackSilhouette
                  samples={l.samples}
                  width={104}
                  height={78}
                  strokeColor={on ? colors.blue : colors.muted}
                  strokeWidth={2}
                />
              </View>
              <View style={s.rowBody}>
                <Text style={s.rowName} numberOfLines={1}>
                  {l.name}
                </Text>
                <Text style={s.rowMeta} numberOfLines={1}>
                  {meta}
                </Text>
                <View style={s.bestLine}>
                  <Text style={s.bestLabel}>MELHOR</Text>
                  <Text style={s.bestValue}>
                    {formatLapPlain(l.stats?.bestLapMs ?? l.durationMs)}
                  </Text>
                </View>
              </View>
              <SelectDot selected={on} />
            </Pressable>
          );
        })}

        <Pressable
          onPress={() => setNameModal(true)}
          style={({ pressed }) => [s.addRow, pressed && { opacity: 0.7 }]}
        >
          <View style={s.addIcon}>
            <PlusIcon size={17} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.addLabel}>Gravar outro traçado</Text>
            <Text style={s.addSub}>Para configurações diferentes da pista</Text>
          </View>
        </Pressable>

        <Text style={s.hint}>
          Toque longo num traçado pra apagar ou trocar o padrão.
        </Text>
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Pressable
          onPress={() => selected && goToPreflight(selected.id)}
          disabled={!selected}
          style={({ pressed }) => [
            s.cta,
            !selected && { opacity: 0.35 },
            pressed && selected && { opacity: 0.9 },
          ]}
        >
          <Text style={s.ctaText} numberOfLines={1}>
            {selected ? `Usar ${selected.name.toLowerCase()}` : 'Escolha um traçado'}
          </Text>
        </Pressable>
      </View>

      <Modal visible={nameModal} transparent animationType="fade" onRequestClose={() => setNameModal(false)}>
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Nome do traçado novo</Text>
            <Text style={s.modalBody}>
              Kartódromos mudam a configuração da pista. Um nome que diga qual é ajuda a
              achar depois — "traçado curto", "invertido".
            </Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="Traçado curto"
              placeholderTextColor={colors.dim}
              style={s.modalInput}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleNewLayoutConfirm}
            />
            <View style={s.modalActions}>
              <Pressable
                onPress={() => {
                  setNameModal(false);
                  setNewName('');
                }}
                style={({ pressed }) => [s.modalCancel, pressed && { opacity: 0.7 }]}
              >
                <Text style={s.modalCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={handleNewLayoutConfirm}
                style={({ pressed }) => [s.modalConfirm, pressed && { opacity: 0.9 }]}
              >
                <Text style={s.modalConfirmText}>Começar gravação</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontFamily: fonts.regular, fontSize: 14, color: colors.danger },

  header: {
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.l,
  },
  headerLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 26,
    letterSpacing: -0.7,
    color: colors.text,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.muted,
    marginTop: 2,
    marginLeft: 32,
  },

  emptyBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  emptyTitle: {
    fontFamily: fonts.bold,
    fontSize: 22,
    letterSpacing: -0.44,
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.xxxl,
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 15.5,
    lineHeight: 23,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.m,
  },

  scroll: {
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.xl,
  },
  intro: {
    fontFamily: fonts.regular,
    fontSize: 15.5,
    lineHeight: 23,
    color: colors.muted,
    marginBottom: spacing.xxl,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.l,
    paddingVertical: spacing.l,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowShape: {
    width: 104,
    alignItems: 'center',
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: {
    fontFamily: fonts.bold,
    fontSize: 19,
    letterSpacing: -0.38,
    color: colors.text,
  },
  rowMeta: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.muted,
    marginTop: 3,
  },
  bestLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginTop: 8,
  },
  bestLabel: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.dim,
  },
  bestValue: {
    fontFamily: fonts.monoMedium,
    fontSize: 17,
    color: colors.blueSoft,
    fontVariant: ['tabular-nums'],
  },

  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingVertical: spacing.xl,
  },
  addIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: {
    fontFamily: fonts.bold,
    fontSize: 17,
    letterSpacing: -0.2,
    color: colors.blueSoft,
  },
  addSub: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    color: colors.dim,
    marginTop: 2,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 12.5,
    color: colors.dim,
  },

  footer: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.m,
  },
  cta: {
    height: 58,
    borderRadius: radius.m,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontFamily: fonts.bold,
    fontSize: 18,
    letterSpacing: -0.2,
    color: colors.textOnPrimary,
  },
  linkWrap: { alignSelf: 'center', marginTop: spacing.l },
  link: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.muted,
  },

  modalBg: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xxl,
  },
  modalTitle: {
    fontFamily: fonts.bold,
    fontSize: 19,
    letterSpacing: -0.3,
    color: colors.text,
  },
  modalBody: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    marginTop: spacing.s,
  },
  modalInput: {
    height: 48,
    borderRadius: radius.m,
    backgroundColor: colors.bg,
    paddingHorizontal: 14,
    marginTop: spacing.l,
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.text,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.m,
    marginTop: spacing.xl,
  },
  modalCancel: {
    flex: 1,
    height: 48,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.line2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.muted,
  },
  modalConfirm: {
    flex: 1.4,
    height: 48,
    borderRadius: radius.m,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmText: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.textOnPrimary,
  },
});
