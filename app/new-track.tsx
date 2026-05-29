/**
 * Criar pista custom — pro piloto que está num kartódromo fora da lista
 * hardcoded (caso comum em teste de campo com desconhecidos).
 *
 * Captura: nome (obrigatório), cidade/estado (opcional) e a localização
 * GPS atual (pra ordenação por distância + futura detecção automática de
 * "você está nessa pista"). Salva no SQLite (custom_tracks) e re-hidrata
 * o cache em memória pra a pista aparecer na lista na hora.
 *
 * Fluxo: new-session → "Minha pista não está aqui" → aqui → salva →
 * volta pra new-session com a pista nova no topo.
 */

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { addCustomTrack, listCustomTracks } from '../src/storage/db';
import { setCustomTracksCache } from '../src/data/tracks';
import { colors, radius, spacing, typography } from '../src/theme';

export default function NewTrack() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(true);
  const [locError, setLocError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Captura GPS atual ao montar. Não bloqueia o save (pista pode ser
  // salva sem coords se o GPS falhar — só perde ordenação por distância).
  const captureLocation = async () => {
    setLocating(true);
    setLocError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocError('Permissão de localização negada — a pista será salva sem coordenadas.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    } catch {
      setLocError('Não consegui pegar o GPS agora. Tenta de novo ou salva sem coordenadas.');
    } finally {
      setLocating(false);
    }
  };

  useEffect(() => {
    captureLocation();
  }, []);

  const canSave = name.trim().length >= 2 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const trimmedName = name.trim();
      await addCustomTrack({
        name: trimmedName,
        // shortName = nome curtinho. Se o piloto digitou algo longo, corta.
        shortName: trimmedName.length > 22 ? trimmedName.slice(0, 22) : trimmedName,
        city: city.trim() || null,
        state: state.trim().toUpperCase() || null,
        // Coords: usa GPS capturado, ou 0/0 como fallback (sem distância).
        lat: coords?.lat ?? 0,
        lng: coords?.lng ?? 0,
        lengthM: null,
      });
      // Re-hidrata o cache pra a pista aparecer na lista imediatamente.
      const all = await listCustomTracks();
      setCustomTracksCache(all);
      router.back();
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? 'Não consegui salvar a pista.');
      setSaving(false);
    }
  };

  return (
    <View style={[s.container, { paddingTop: insets.top + spacing.m }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
          <Text style={s.backTxt}>‹ Voltar</Text>
        </Pressable>
        <Text style={s.title}>Nova pista</Text>
        <Text style={s.subtitle}>
          Tá num kartódromo que não está na lista? Cria aqui. Usa o GPS pra
          marcar onde fica.
        </Text>
      </View>

      <View style={s.form}>
        <Text style={s.label}>NOME DA PISTA *</Text>
        <TextInput
          style={s.input}
          value={name}
          onChangeText={setName}
          placeholder="Ex: Kartódromo da Cidade"
          placeholderTextColor={colors.textMuted}
          autoFocus
        />

        <View style={s.row}>
          <View style={{ flex: 2 }}>
            <Text style={s.label}>CIDADE</Text>
            <TextInput
              style={s.input}
              value={city}
              onChangeText={setCity}
              placeholder="Opcional"
              placeholderTextColor={colors.textMuted}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>UF</Text>
            <TextInput
              style={s.input}
              value={state}
              onChangeText={setState}
              placeholder="SP"
              placeholderTextColor={colors.textMuted}
              maxLength={2}
              autoCapitalize="characters"
            />
          </View>
        </View>

        {/* Status do GPS — mostra coords capturadas ou estado/erro */}
        <View style={s.gpsBox}>
          {locating ? (
            <View style={s.gpsRow}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={s.gpsText}>Pegando sua localização…</Text>
            </View>
          ) : coords ? (
            <View style={s.gpsRow}>
              <View style={s.gpsDot} />
              <Text style={[s.gpsText, typography.mono]}>
                {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
              </Text>
              <Pressable onPress={captureLocation} hitSlop={8}>
                <Text style={s.gpsRefresh}>atualizar</Text>
              </Pressable>
            </View>
          ) : (
            <View>
              <Text style={s.gpsError}>{locError ?? 'Sem localização.'}</Text>
              <Pressable onPress={captureLocation} hitSlop={8}>
                <Text style={s.gpsRefresh}>tentar de novo</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>

      <View style={[s.footer, { paddingBottom: insets.bottom + spacing.l }]}>
        <Pressable
          onPress={handleSave}
          disabled={!canSave}
          style={[s.saveBtn, !canSave && { opacity: 0.4 }]}
        >
          {saving ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={s.saveTxt}>Salvar pista</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.l },
  backBtn: { marginBottom: spacing.m },
  backTxt: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  title: { color: colors.textPrimary, fontSize: 26, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: spacing.s,
    lineHeight: 19,
  },
  form: { paddingHorizontal: spacing.xl, gap: spacing.m, flex: 1 },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '500',
  },
  row: { flexDirection: 'row', gap: spacing.m },
  gpsBox: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    padding: spacing.m,
    marginTop: spacing.s,
  },
  gpsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  gpsDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  gpsText: { color: colors.textSecondary, fontSize: 13, flex: 1 },
  gpsRefresh: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  gpsError: { color: colors.warning, fontSize: 12, lineHeight: 17, marginBottom: 6 },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.m },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.m,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveTxt: { color: colors.textOnPrimary, fontSize: 16, fontWeight: '800' },
});
