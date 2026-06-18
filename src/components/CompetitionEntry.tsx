import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { generateMatchCode } from '../lib/match';
import { colors, radius, spacing } from '../theme';

/**
 * Bloco de entrada da competição ao vivo — usado na home do piloto e no indoor.
 *
 *  - CRIAR PARTIDA → gera um código e abre a corrida (você é o "host").
 *  - ENTRAR COM CÓDIGO → digita o código que alguém compartilhou e entra na
 *    MESMA corrida (mesmo canal Realtime `match:<code>`).
 *
 * A corrida em si é `app/competition-race.tsx`.
 */
export function CompetitionEntry({ compact }: { compact?: boolean } = {}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [joinOpen, setJoinOpen] = useState(false);
  const [code, setCode] = useState('');

  return (
    <View>
      <Pressable
        style={({ pressed }) => [s.createBtn, pressed && { opacity: 0.85 }]}
        onPress={() => router.push({ pathname: '/competition-race', params: { code: generateMatchCode() } } as any)}
      >
        <Text style={s.createBtnText}>▶  CRIAR PARTIDA</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [s.joinBtn, pressed && { opacity: 0.85 }]}
        onPress={() => {
          setCode('');
          setJoinOpen(true);
        }}
      >
        <Text style={s.joinBtnText}>ENTRAR COM CÓDIGO</Text>
      </Pressable>
      {!compact && (
        <Text style={s.hint}>
          Crie a partida e compartilhe o código. Quem digitar entra na MESMA corrida e
          aparece no seu mapa ao vivo.
        </Text>
      )}

      <Modal visible={joinOpen} transparent animationType="slide" onRequestClose={() => setJoinOpen(false)}>
        <Pressable style={s.modalBg} onPress={() => setJoinOpen(false)}>
          <Pressable style={[s.sheet, { paddingBottom: insets.bottom + spacing.l }]} onPress={() => {}}>
            <Text style={s.sheetTitle}>Entrar com código</Text>
            <Text style={s.sheetSub}>Digite o código que quem criou a partida compartilhou.</Text>
            <TextInput
              style={s.input}
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="K7P2QX"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
            />
            <Pressable
              style={({ pressed }) => [s.createBtn, { marginTop: spacing.m }, code.length < 4 && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
              disabled={code.length < 4}
              onPress={() => {
                setJoinOpen(false);
                router.push({ pathname: '/competition-race', params: { code } } as any);
              }}
            >
              <Text style={s.createBtnText}>ENTRAR NA CORRIDA</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  createBtn: {
    backgroundColor: colors.racingBlue,
    borderRadius: radius.m,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: colors.racingBlue,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  createBtnText: { color: '#fff', fontSize: 16, fontWeight: '900', fontStyle: 'italic', letterSpacing: 0.5 },
  joinBtn: {
    marginTop: spacing.s,
    borderRadius: radius.m,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  joinBtnText: { color: colors.textPrimary, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: spacing.s, lineHeight: 16 },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.l },
  sheetTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  sheetSub: { color: colors.textSecondary, fontSize: 13, marginTop: 4, marginBottom: spacing.m, lineHeight: 18 },
  input: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingVertical: 14,
    paddingHorizontal: spacing.l,
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 8,
    textAlign: 'center',
  },
});
