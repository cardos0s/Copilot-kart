import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, typography } from '../../theme';

type Tone = 'neutral' | 'primary' | 'success' | 'danger' | 'magenta' | 'cyan';
type Size = 'm' | 'l' | 'xl' | 'xxl';

type Props = {
  /** Rótulo acima do valor (ex: "MELHOR VOLTA"). */
  label?: string;
  /** Valor principal (ex: "00:48.632"). */
  value: string;
  /** Texto auxiliar abaixo (ex: "vs sessão anterior", "Volta 12"). */
  hint?: string;
  /** Cor do valor. */
  tone?: Tone;
  /** Tamanho do número. */
  size?: Size;
  /** Sufixo inline depois do valor (ex: "+0.243"). */
  delta?: string;
  /** Cor do delta. */
  deltaTone?: Tone;
  /** Alinhamento (left default). */
  align?: 'left' | 'center';
  style?: ViewStyle | ViewStyle[];
};

const toneColor: Record<Tone, string> = {
  neutral: colors.textPrimary,
  primary: colors.primary,
  success: colors.success,
  danger: colors.danger,
  magenta: colors.accentMagenta,
  cyan: colors.accentCyan,
};

const sizeMap: Record<Size, { fontSize: number; weight: '700' | '800' | '900'; letterSpacing: number }> = {
  m: { fontSize: 28, weight: '800', letterSpacing: -0.5 },
  l: { fontSize: 36, weight: '900', letterSpacing: -1 },
  xl: { fontSize: 48, weight: '900', letterSpacing: -1.5 },
  xxl: { fontSize: 72, weight: '900', letterSpacing: -2.5 },
};

export function Metric({
  label,
  value,
  hint,
  tone = 'neutral',
  size = 'l',
  delta,
  deltaTone = 'success',
  align = 'left',
  style,
}: Props) {
  const valueStyle = sizeMap[size];
  return (
    <View style={[{ alignItems: align === 'center' ? 'center' : 'flex-start' }, style]}>
      {label && (
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      )}
      <View style={styles.valueRow}>
        <Text
          style={[
            styles.value,
            valueStyle,
            { color: toneColor[tone] },
            typography.mono,
          ]}
        >
          {value}
        </Text>
      </View>
      {delta && (
        <Text style={[styles.delta, { color: toneColor[deltaTone] }, typography.mono]}>
          {delta}
        </Text>
      )}
      {hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: 6,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  value: {
    includeFontPadding: false,
  },
  delta: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 4,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
});
