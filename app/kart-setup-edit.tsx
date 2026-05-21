import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  getKartSetup,
  KartSetup,
  listKartSetups,
  saveKartSetup,
} from '../src/storage/db';
import { ScreenHeader } from '../src/components/ui';
import { colors, radius, spacing, typography } from '../src/theme';

export default function KartSetupEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [loading, setLoading] = useState(true);
  const [setup, setSetup] = useState<Partial<KartSetup>>({
    name: '',
    chassisBrand: '',
    chassisModel: '',
    engineType: '',
    engineTune: '',
    hours: 0,
    tirePressureFront: null,
    tirePressureRear: null,
    camberDeg: null,
    gearFront: null,
    gearRear: null,
    ballastKg: null,
    notes: '',
    isActive: false,
  });

  useEffect(() => {
    (async () => {
      if (id) {
        const existing = await getKartSetup(id);
        if (existing) setSetup(existing);
      } else {
        // Setup novo — se for o primeiro, marca ativo automaticamente
        const all = await listKartSetups();
        if (all.length === 0) setSetup((p) => ({ ...p, isActive: true }));
      }
      setLoading(false);
    })();
  }, [id]);

  const handleSave = async () => {
    const name = (setup.name ?? '').trim();
    if (!name) {
      Alert.alert('Nome obrigatório', 'Dá um nome pro setup (ex: "K7 Rotax").');
      return;
    }
    const now = Date.now();
    const full: KartSetup = {
      id: setup.id ?? `setup_${now}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      chassisBrand: setup.chassisBrand || null,
      chassisModel: setup.chassisModel || null,
      chassisYear: setup.chassisYear ?? null,
      engineType: setup.engineType || null,
      engineTune: setup.engineTune || null,
      hours: setup.hours ?? 0,
      tirePressureFront: setup.tirePressureFront ?? null,
      tirePressureRear: setup.tirePressureRear ?? null,
      camberDeg: setup.camberDeg ?? null,
      gearFront: setup.gearFront ?? null,
      gearRear: setup.gearRear ?? null,
      ballastKg: setup.ballastKg ?? null,
      category: setup.category || null,
      notes: setup.notes || null,
      isActive: setup.isActive ?? false,
      createdAt: setup.createdAt ?? now,
      updatedAt: now,
    };
    await saveKartSetup(full);
    router.back();
  };

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const update = <K extends keyof KartSetup>(field: K, value: KartSetup[K]) =>
    setSetup((p) => ({ ...p, [field]: value }));

  const parseFloat2 = (v: string) => {
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const parseInt2 = (v: string) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader
        title={id ? 'EDITAR SETUP' : 'NOVO SETUP'}
        onBack={() => router.back()}
        rightAction={
          <Pressable onPress={handleSave} hitSlop={8}>
            <Text style={s.saveAction}>Salvar</Text>
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Field
          label="Nome"
          placeholder="ex: K7 Rotax"
          value={setup.name ?? ''}
          onChangeText={(v) => update('name', v)}
        />

        <SectionLabel>CHASSI</SectionLabel>
        <View style={s.row2}>
          <Field
            label="Marca"
            placeholder="OTK Tony"
            value={setup.chassisBrand ?? ''}
            onChangeText={(v) => update('chassisBrand', v)}
            half
          />
          <Field
            label="Modelo"
            placeholder="Racer EVK"
            value={setup.chassisModel ?? ''}
            onChangeText={(v) => update('chassisModel', v)}
            half
          />
        </View>
        <Field
          label="Ano"
          placeholder="2024"
          keyboardType="number-pad"
          value={setup.chassisYear?.toString() ?? ''}
          onChangeText={(v) => update('chassisYear', parseInt2(v))}
        />

        <SectionLabel>MOTOR</SectionLabel>
        <View style={s.row2}>
          <Field
            label="Tipo"
            placeholder="Rotax Max"
            value={setup.engineType ?? ''}
            onChangeText={(v) => update('engineType', v)}
            half
          />
          <Field
            label="Tune"
            placeholder="Tune 4"
            value={setup.engineTune ?? ''}
            onChangeText={(v) => update('engineTune', v)}
            half
          />
        </View>
        <Field
          label="Horas de uso"
          placeholder="0"
          keyboardType="decimal-pad"
          value={setup.hours?.toString() ?? ''}
          onChangeText={(v) => update('hours', parseFloat2(v) ?? 0)}
        />

        <SectionLabel>AJUSTES</SectionLabel>
        <View style={s.row2}>
          <Field
            label="Pressão dianteira (bar)"
            placeholder="0.90"
            keyboardType="decimal-pad"
            value={setup.tirePressureFront?.toString() ?? ''}
            onChangeText={(v) => update('tirePressureFront', parseFloat2(v))}
            half
          />
          <Field
            label="Pressão traseira (bar)"
            placeholder="0.85"
            keyboardType="decimal-pad"
            value={setup.tirePressureRear?.toString() ?? ''}
            onChangeText={(v) => update('tirePressureRear', parseFloat2(v))}
            half
          />
        </View>
        <View style={s.row2}>
          <Field
            label="Cambagem (°)"
            placeholder="-1.5"
            keyboardType="numbers-and-punctuation"
            value={setup.camberDeg?.toString() ?? ''}
            onChangeText={(v) => update('camberDeg', parseFloat2(v))}
            half
          />
          <Field
            label="Lastro (kg)"
            placeholder="0"
            keyboardType="decimal-pad"
            value={setup.ballastKg?.toString() ?? ''}
            onChangeText={(v) => update('ballastKg', parseFloat2(v))}
            half
          />
        </View>
        <View style={s.row2}>
          <Field
            label="Pinhão"
            placeholder="11"
            keyboardType="number-pad"
            value={setup.gearFront?.toString() ?? ''}
            onChangeText={(v) => update('gearFront', parseInt2(v))}
            half
          />
          <Field
            label="Coroa"
            placeholder="82"
            keyboardType="number-pad"
            value={setup.gearRear?.toString() ?? ''}
            onChangeText={(v) => update('gearRear', parseInt2(v))}
            half
          />
        </View>

        <SectionLabel>NOTAS</SectionLabel>
        <Field
          placeholder="Anotações sobre esse setup (opcional)"
          value={setup.notes ?? ''}
          onChangeText={(v) => update('notes', v)}
          multiline
        />

        <Pressable
          onPress={() => update('isActive', !setup.isActive)}
          style={({ pressed }) => [s.activeToggle, pressed && { opacity: 0.7 }]}
        >
          <View
            style={[
              s.checkbox,
              setup.isActive && { backgroundColor: colors.primary, borderColor: colors.primary },
            ]}
          />
          <Text style={s.activeToggleText}>Setup ativo (default em novas sessões)</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={s.section}>{children}</Text>;
}

function Field({
  label,
  placeholder,
  value,
  onChangeText,
  keyboardType,
  multiline,
  half,
}: {
  label?: string;
  placeholder?: string;
  value: string;
  onChangeText: (v: string) => void;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad' | 'numbers-and-punctuation';
  multiline?: boolean;
  half?: boolean;
}) {
  return (
    <View style={[s.field, half && { flex: 1 }]}>
      {label && <Text style={s.fieldLabel}>{label}</Text>}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType ?? 'default'}
        multiline={multiline}
        autoCapitalize={multiline ? 'sentences' : 'words'}
        style={[s.input, multiline && { minHeight: 80, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.l, paddingBottom: spacing.huge },

  saveAction: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
    paddingHorizontal: spacing.s,
  },

  section: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: spacing.l,
    marginBottom: spacing.s,
  },

  field: { marginBottom: spacing.m },
  row2: { flexDirection: 'row', gap: spacing.s },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.m,
    color: colors.textPrimary,
    fontSize: 14,
    ...typography.mono,
  },

  activeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    marginTop: spacing.xl,
    padding: spacing.m,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.textMuted,
  },
  activeToggleText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
});
