import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import { LEGENDS, LEVEL_COLOR, type Legend } from '../src/data/legends';
import { colors, radius, spacing } from '../src/theme';

const BLUE = colors.racingBlue;

function fmtLap(ms: number) {
  return (ms / 1000).toFixed(2);
}

function HelmetIcon({ color, size = 34 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 34 34">
      <Circle cx={17} cy={17} r={16} fill="#0d1322" />
      <Path d="M6 20 A11 11 0 0 1 28 20 L28 23 Q28 25 25 25 L9 25 Q6 25 6 23 Z" fill={color} />
      <Path d="M9 16 Q17 12 25 16 L25 19 Q17 16 9 19 Z" fill="#0a0e18" opacity={0.55} />
    </Svg>
  );
}

export default function Legends() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<Legend>(LEGENDS[0]);

  return (
    <View style={[s.root, { paddingTop: insets.top + spacing.s }]}>
      <Pressable onPress={() => router.back()} hitSlop={16} style={s.back}>
        <Text style={s.backIcon}>‹</Text>
      </Pressable>

      <Text style={s.title}>MODO LENDAS</Text>
      <Text style={s.subtitle}>Bata o recorde dos maiores — no tempo convertido pra kart.</Text>

      <ScrollView style={{ marginTop: spacing.l }} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        {LEGENDS.map((l) => {
          const active = selected.id === l.id;
          return (
            <Pressable
              key={l.id}
              onPress={() => setSelected(l)}
              style={({ pressed }) => [s.row, active && { borderColor: l.helmet }, pressed && { opacity: 0.85 }]}
            >
              <View style={s.helmetBox}>
                <HelmetIcon color={l.helmet} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.name} numberOfLines={1}>{l.name}</Text>
                <View style={s.metaRow}>
                  <View style={[s.levelBadge, { backgroundColor: `${LEVEL_COLOR[l.level]}22` }]}>
                    <Text style={[s.levelText, { color: LEVEL_COLOR[l.level] }]}>{l.level.toUpperCase()}</Text>
                  </View>
                  <Text style={s.country}>{l.country}</Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.convLabel}>CONVERTIDO</Text>
                <Text style={s.lap}>{fmtLap(l.lapMs)}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + spacing.l }]}>
        <Pressable
          style={({ pressed }) => [s.cta, pressed && { opacity: 0.9 }]}
          onPress={() => router.push({ pathname: '/legend-race', params: { id: selected.id } } as any)}
        >
          <Text style={s.ctaText}>DESAFIAR {selected.short.toUpperCase()}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.l },
  back: { width: 36, height: 36, justifyContent: 'center' },
  backIcon: { color: colors.textSecondary, fontSize: 30, fontWeight: '400' },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: '900', fontStyle: 'italic', letterSpacing: 0.5, marginTop: spacing.s },
  subtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: spacing.s },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.m, padding: spacing.m, marginBottom: spacing.s, backgroundColor: colors.surface, borderRadius: radius.l, borderWidth: 1.5, borderColor: 'transparent' },
  helmetBox: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.bgElevated, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, marginTop: 4 },
  levelBadge: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  levelText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  country: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  convLabel: { color: colors.textMuted, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  lap: { color: colors.textPrimary, fontSize: 20, fontWeight: '900', letterSpacing: -0.5, marginTop: 2, fontVariant: ['tabular-nums'] },
  footer: { paddingTop: spacing.s },
  cta: { backgroundColor: BLUE, borderRadius: radius.m, paddingVertical: 16, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
});
