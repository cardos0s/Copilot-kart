import { useCallback, useEffect, useState } from 'react';
import {
  ActionSheetIOS,
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
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { getProfile, persistProfilePhoto, PilotProfile, saveProfile } from '../src/storage/profile';
import { Avatar, Button, Card, Icon, ScreenHeader } from '../src/components/ui';
import { colors, radius, spacing } from '../src/theme';

export default function ProfileEdit() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<PilotProfile>({
    name: '',
    nickname: null,
    category: '',
    homeTrackId: null,
    createdAt: Date.now(),
    photoUri: null,
    kartNumber: null,
    team: null,
  });

  useEffect(() => {
    getProfile()
      .then((p) => {
        if (p) setForm(p);
      })
      .catch(() => {
        // Sem perfil — form fica com defaults, user pode editar mesmo assim
      })
      .finally(() => setLoading(false));
  }, []);

  const update = useCallback(<K extends keyof PilotProfile>(key: K, value: PilotProfile[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const pickFromGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permissão negada', 'Habilite acesso à galeria nas configurações do iOS.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      handlePhotoSelected(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permissão negada', 'Habilite a câmera nas configurações do iOS.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      handlePhotoSelected(result.assets[0].uri);
    }
  };

  const handlePhotoSelected = async (uri: string) => {
    try {
      const persistent = await persistProfilePhoto(uri);
      update('photoUri', persistent);
    } catch {
      // fallback: usa a URI temporária mesmo
      update('photoUri', uri);
    }
  };

  const handlePhotoTap = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancelar', 'Tirar foto', 'Escolher da galeria', form.photoUri ? 'Remover foto' : ''].filter(Boolean),
          cancelButtonIndex: 0,
          destructiveButtonIndex: form.photoUri ? 3 : undefined,
        },
        (idx) => {
          if (idx === 1) takePhoto();
          else if (idx === 2) pickFromGallery();
          else if (idx === 3) update('photoUri', null);
        }
      );
    } else {
      Alert.alert('Foto', undefined, [
        { text: 'Tirar foto', onPress: takePhoto },
        { text: 'Escolher da galeria', onPress: pickFromGallery },
        ...(form.photoUri
          ? [{ text: 'Remover', onPress: () => update('photoUri', null), style: 'destructive' as const }]
          : []),
        { text: 'Cancelar', style: 'cancel' as const },
      ]);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      Alert.alert('Faltou', 'O nome é obrigatório.');
      return;
    }
    setSaving(true);
    try {
      await saveProfile({
        ...form,
        name: form.name.trim(),
        nickname: form.nickname?.trim() || null,
        category: form.category.trim(),
        kartNumber: form.kartNumber?.trim() || null,
        team: form.team?.trim() || null,
      });
      router.back();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <View style={s.root} />;
  }

  return (
    <View style={s.root}>
      <ScreenHeader title="EDITAR PERFIL" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: spacing.l, paddingBottom: spacing.huge }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Avatar + edit */}
          <View style={s.avatarBlock}>
            <Pressable onPress={handlePhotoTap} hitSlop={12} style={s.avatarWrap}>
              <Avatar photoUri={form.photoUri} name={form.name} size={120} ring />
              <View style={s.cameraBadge}>
                <Icon name="edit" size={14} color={colors.textOnPrimary} />
              </View>
            </Pressable>
            <Text style={s.avatarHint}>Toque pra alterar</Text>
          </View>

          {/* Form */}
          <Field label="NOME COMPLETO" required>
            <TextInput
              value={form.name}
              onChangeText={(v) => update('name', v)}
              placeholder="Davi Cardoso"
              placeholderTextColor={colors.textMuted}
              style={s.input}
              autoCapitalize="words"
              returnKeyType="next"
            />
          </Field>

          <Field label="NICKNAME">
            <TextInput
              value={form.nickname ?? ''}
              onChangeText={(v) => update('nickname', v)}
              placeholder="Como você é chamado na pista"
              placeholderTextColor={colors.textMuted}
              style={s.input}
            />
          </Field>

          <View style={{ flexDirection: 'row', gap: spacing.m }}>
            <View style={{ flex: 1 }}>
              <Field label="NÚMERO">
                <TextInput
                  value={form.kartNumber ?? ''}
                  onChangeText={(v) => update('kartNumber', v.replace(/[^0-9]/g, ''))}
                  placeholder="219"
                  placeholderTextColor={colors.textMuted}
                  style={s.input}
                  keyboardType="number-pad"
                  maxLength={4}
                />
              </Field>
            </View>
            <View style={{ flex: 2 }}>
              <Field label="CATEGORIA">
                <TextInput
                  value={form.category}
                  onChangeText={(v) => update('category', v)}
                  placeholder="Graduados"
                  placeholderTextColor={colors.textMuted}
                  style={s.input}
                  autoCapitalize="words"
                />
              </Field>
            </View>
          </View>

          <Field label="EQUIPE">
            <TextInput
              value={form.team ?? ''}
              onChangeText={(v) => update('team', v)}
              placeholder="Cortex Tech Racing"
              placeholderTextColor={colors.textMuted}
              style={s.input}
              autoCapitalize="words"
            />
          </Field>

          <View style={{ marginTop: spacing.xl }}>
            <Button
              label={saving ? 'Salvando…' : 'Salvar'}
              onPress={handleSave}
              variant="primary"
              size="l"
              fullWidth
              loading={saving}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginTop: spacing.l }}>
      <Text style={s.fieldLabel}>
        {label}
        {required && <Text style={{ color: colors.danger }}> *</Text>}
      </Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  avatarBlock: {
    alignItems: 'center',
    marginTop: spacing.l,
  },
  avatarWrap: { position: 'relative' },
  cameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.bg,
  },
  avatarHint: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: spacing.s,
  },

  fieldLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  input: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.m,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
