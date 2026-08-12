import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import { colors, spacing, radius } from '../../src/theme';
import { setPilotType, type PilotType } from '../../src/storage/pilotType';

const BLUE = colors.racingBlue;

function TrackIcon({ active }: { active: boolean }) {
  const c = active ? BLUE : colors.textSecondary;
  return (
    <Svg width={34} height={34} viewBox="0 0 34 34">
      <Path
        d="M8 22 Q3 12 11 8 Q20 4 26 11 Q32 18 24 23 Q16 28 11 23 Q7 26 8 22 Z"
        stroke={c}
        strokeWidth={2.4}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}

function IndoorIcon({ active }: { active: boolean }) {
  const c = active ? BLUE : colors.textSecondary;
  return (
    <Svg width={34} height={34} viewBox="0 0 34 34">
      {/* canopy / teto */}
      <Path d="M6 22 L9 12 Q17 8 25 12 L28 22" stroke={c} strokeWidth={2.4} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Path d="M5 22 L29 22" stroke={c} strokeWidth={2.4} strokeLinecap="round" />
      <Circle cx={17} cy={16} r={2.4} fill={c} />
    </Svg>
  );
}

type Mode = { id: PilotType; title: string; sub: string; Icon: (p: { active: boolean }) => JSX.Element };

const MODES: Mode[] = [
  { id: 'owner', title: 'Piloto', sub: 'Kart próprio', Icon: TrackIcon },
  { id: 'indoor', title: 'Indoor', sub: 'Locação', Icon: IndoorIcon },
];

export default function OnboardingMode() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<PilotType | null>(null);

  const handleContinue = async () => {
    if (!selected) return;
    await setPilotType(selected);
    router.push('/onboarding/name');
  };

  return (
    <View style={[s.root, { paddingTop: insets.top + spacing.s }]}>
      <Pressable onPress={() => router.back()} hitSlop={16} style={s.back}>
        <Text style={s.backIcon}>‹</Text>
      </Pressable>

      <View style={s.titleBlock}>
        <Text style={s.kicker}>COMO VOCÊ CORRE?</Text>
        <Text style={s.title}>Escolha seu modo</Text>
        <Text style={s.subtitle}>Dá pra trocar depois nas configurações.</Text>
      </View>

      {/* Cards centralizados no meio da tela */}
      <View style={s.center}>
        <View style={s.cardsRow}>
          {MODES.map((m) => {
            const active = selected === m.id;
            return (
              <Pressable
                key={m.id}
                onPress={() => setSelected(m.id)}
                style={({ pressed }) => [s.card, active && s.cardActive, pressed && { opacity: 0.85 }]}
              >
                <View style={[s.iconBox, active && s.iconBoxActive]}>
                  <m.Icon active={active} />
                </View>
                <Text style={s.cardTitle}>{m.title.toUpperCase()}</Text>
                <Text style={s.cardSub}>{m.sub}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[s.footer, { paddingBottom: insets.bottom + spacing.l }]}>
        <Pressable
          disabled={!selected}
          onPress={handleContinue}
          style={({ pressed }) => [s.btn, !selected && s.btnDisabled, pressed && selected && { opacity: 0.85 }]}
        >
          <Text style={s.btnText}>Continuar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.xl },
  back: { width: 36, height: 36, justifyContent: 'center' },
  backIcon: { color: colors.textSecondary, fontSize: 30, fontWeight: '400' },
  titleBlock: { marginTop: spacing.m },
  kicker: { color: BLUE, fontSize: 12, fontWeight: '800', letterSpacing: 3 },
  title: {
    color: colors.textPrimary,
    fontSize: 32,
    fontWeight: '900',
    fontStyle: 'italic',
    textTransform: 'uppercase',
    letterSpacing: -0.5,
    marginTop: spacing.s,
  },
  subtitle: { color: colors.textSecondary, fontSize: 15, marginTop: spacing.s },
  center: { flex: 1, justifyContent: 'center' },
  cardsRow: { flexDirection: 'row', gap: spacing.l },
  card: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.m,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
  },
  cardActive: {
    borderColor: BLUE,
    borderWidth: 1.5,
    backgroundColor: 'rgba(37, 99, 255, 0.08)',
  },
  iconBox: {
    width: 80,
    height: 80,
    borderRadius: radius.l,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.l,
  },
  iconBoxActive: { borderColor: BLUE },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 19,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 0.5,
  },
  cardSub: { color: BLUE, fontSize: 14, fontWeight: '700', marginTop: spacing.xs },
  footer: { paddingTop: spacing.m },
  btn: { backgroundColor: BLUE, borderRadius: radius.m, paddingVertical: 16, alignItems: 'center' },
  btnDisabled: { opacity: 0.35 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
