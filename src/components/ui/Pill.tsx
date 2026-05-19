import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../../theme';

type Option<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  options: Option<T>[];
  value: T;
  onChange: (next: T) => void;
};

/**
 * Filtro segmentado horizontal (ex: TODAS / ESTE MÊS / ESTE ANO).
 * Pill ativa fica com fundo lime, inativas com texto cinza.
 */
export function PillTabs<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <View style={styles.row}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              styles.pill,
              active && styles.pillActive,
              pressed && !active && { opacity: 0.6 },
            ]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.s,
  },
  pill: {
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.l,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  labelActive: {
    color: colors.textOnPrimary,
  },
});
