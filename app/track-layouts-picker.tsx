import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  deleteLayout,
  listLayoutsForTrack,
  setDefaultLayout,
  TrackLayout,
} from '../src/storage/db';
import { TrackSilhouette } from '../src/components/TrackSilhouette';
import { ScreenHeader } from '../src/components/ui';
import { colors, radius, spacing, typography } from '../src/theme';

function fmtLap(ms: number) {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function fmtDate(ms: number) {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export default function TrackLayoutsPicker() {
  const router = useRouter();
  const { trackId, trackName } = useLocalSearchParams<{
    trackId: string;
    trackName: string;
  }>();
  const [layouts, setLayouts] = useState<TrackLayout[] | null>(null);
  const [newLayoutModal, setNewLayoutModal] = useState(false);
  const [newLayoutName, setNewLayoutName] = useState('');

  const load = useCallback(async () => {
    if (!trackId) return;
    const result = await listLayoutsForTrack(trackId);
    setLayouts(result);
  }, [trackId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleStartRace = (layout: TrackLayout) => {
    // Em vez de ir direto pra gravação, passa pelo pre-flight (checklist +
    // confirmação do setup ativo). Garante que o piloto sabe o que tá rolando
    // antes de começar a contar volta.
    router.push({
      pathname: '/preflight' as any,
      params: {
        trackId: trackId!,
        trackName: trackName!,
        layoutId: layout.id,
      },
    });
  };

  const handleNewLayoutConfirm = () => {
    const name = newLayoutName.trim();
    if (!name) {
      Alert.alert('Nome obrigatório', 'Dá um nome pro traçado novo.');
      return;
    }
    setNewLayoutModal(false);
    setNewLayoutName('');
    router.push({
      pathname: '/recording-reference',
      params: {
        trackId: trackId!,
        trackName: trackName!,
        layoutName: name,
      },
    });
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

  if (layouts === null) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <ScreenHeader
        title="TRAÇADO DA SESSÃO"
        subtitle={trackName}
        onBack={() => router.back()}
      />
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.intro}>
          Escolha qual traçado vai usar nessa sessão. Cada traçado tem sua própria
          referência de melhor volta — comparações ficam consistentes.
        </Text>

        {layouts.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>Nenhum traçado cadastrado</Text>
            <Text style={s.emptyBody}>
              Antes de correr aqui, preciso aprender o traçado da pista. Dê algumas
              voltas tranquilas pra eu desenhar.
            </Text>
            <Pressable
              onPress={() => setNewLayoutModal(true)}
              style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={s.primaryBtnText}>Gravar primeiro traçado</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {layouts.map((l) => (
              <Pressable
                key={l.id}
                onPress={() => handleStartRace(l)}
                onLongPress={() => handleLongPress(l)}
                delayLongPress={400}
                style={({ pressed }) => [s.layoutCard, pressed && { opacity: 0.7 }]}
              >
                <View style={s.layoutIcon}>
                  <TrackSilhouette
                    samples={l.samples}
                    width={56}
                    height={42}
                    strokeColor={colors.primary}
                  />
                </View>
                <View style={s.layoutBody}>
                  <View style={s.layoutTitleLine}>
                    <Text style={s.layoutName} numberOfLines={1}>
                      {l.name}
                    </Text>
                    {l.isDefault && <Text style={s.defaultBadge}>padrão</Text>}
                  </View>
                  <Text style={[s.layoutMeta, typography.mono]}>
                    Melhor: {fmtLap(l.durationMs)} · {l.lengthM.toFixed(0)}m
                  </Text>
                  <Text style={s.layoutDate}>Gravado em {fmtDate(l.recordedAt)}</Text>
                </View>
                <Text style={s.chevron}>›</Text>
              </Pressable>
            ))}

            <Pressable
              onPress={() => setNewLayoutModal(true)}
              style={({ pressed }) => [s.newLayoutBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={s.newLayoutBtnText}>+ Gravar traçado novo</Text>
            </Pressable>

            <Text style={s.hint}>
              Toque longo num traçado pra renomear, apagar ou trocar o padrão.
            </Text>
          </>
        )}
      </ScrollView>

      <Modal
        visible={newLayoutModal}
        animationType="fade"
        transparent
        onRequestClose={() => setNewLayoutModal(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Nome do traçado novo</Text>
            <Text style={s.modalBody}>
              Ex: "Layout curto", "Inverso", "Configuração corrida".
            </Text>
            <TextInput
              value={newLayoutName}
              onChangeText={setNewLayoutName}
              placeholder="Layout curto"
              placeholderTextColor={colors.textMuted}
              style={s.modalInput}
              autoFocus
              autoCapitalize="words"
            />
            <View style={s.modalActions}>
              <Pressable
                onPress={() => {
                  setNewLayoutModal(false);
                  setNewLayoutName('');
                }}
                style={({ pressed }) => [s.modalCancel, pressed && { opacity: 0.6 }]}
              >
                <Text style={s.modalCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={handleNewLayoutConfirm}
                style={({ pressed }) => [s.modalConfirm, pressed && { opacity: 0.7 }]}
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
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.l, gap: spacing.s },

  intro: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: spacing.m,
  },

  layoutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    padding: spacing.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.l,
  },
  layoutIcon: {
    width: 60,
    height: 48,
    backgroundColor: colors.bg,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
  },
  layoutBody: { flex: 1, minWidth: 0 },
  layoutTitleLine: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  layoutName: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  defaultBadge: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    backgroundColor: colors.primaryGlow,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  layoutMeta: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  layoutDate: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 24,
    fontWeight: '300',
  },

  primaryBtn: {
    marginTop: spacing.l,
    paddingVertical: 14,
    borderRadius: radius.m,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: colors.textOnPrimary,
    fontSize: 14,
    fontWeight: '800',
  },

  newLayoutBtn: {
    marginTop: spacing.m,
    paddingVertical: 14,
    borderRadius: radius.m,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    alignItems: 'center',
  },
  newLayoutBtnText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },

  hint: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.m,
  },

  emptyCard: {
    padding: spacing.l,
    borderRadius: radius.l,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: spacing.s,
  },
  emptyBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },

  errorText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.l,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.l,
    padding: spacing.l,
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    marginBottom: spacing.s,
  },
  modalBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.m,
  },
  modalInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.m,
    color: colors.textPrimary,
    fontSize: 14,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.s,
    marginTop: spacing.l,
  },
  modalCancel: {
    flex: 1,
    paddingVertical: spacing.m,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  modalCancelText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  modalConfirm: {
    flex: 1,
    paddingVertical: spacing.m,
    borderRadius: radius.m,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  modalConfirmText: {
    color: colors.textOnPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
});
