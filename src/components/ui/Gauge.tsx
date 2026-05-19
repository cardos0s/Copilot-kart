import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { colors, typography } from '../../theme';

type Props = {
  /** Valor 0-100. */
  value: number;
  /** Diâmetro total em px. Default 160. */
  size?: number;
  /** Espessura do arco. Default 12. */
  thickness?: number;
  /** Cor do arco preenchido. Default primary (gradient). */
  color?: string;
  /** Cor do trilho (background). Default border. */
  trackColor?: string;
  /** Slot de conteúdo central. Se não passar, mostra o valor formatado. */
  children?: ReactNode;
  /** Sufixo do valor (ex: "/100"). Só usado se children não for passado. */
  suffix?: string;
};

/**
 * Donut/Gauge circular pra scores (ex: Insights 87/100).
 * Renderiza um arco preenchido proporcional ao value, com slot central customizável.
 */
export function Gauge({
  value,
  size = 160,
  thickness = 12,
  color = colors.primary,
  trackColor = colors.borderStrong,
  children,
  suffix = '/100',
}: Props) {
  const clamped = Math.max(0, Math.min(100, value));
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - clamped / 100);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={1} />
            <Stop offset="1" stopColor={color} stopOpacity={0.6} />
          </LinearGradient>
        </Defs>

        {/* Trilho de fundo */}
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={trackColor}
          strokeWidth={thickness}
          fill="none"
        />

        {/* Arco preenchido (gira -90deg pra começar no topo) */}
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke="url(#gaugeGrad)"
          strokeWidth={thickness}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </Svg>

      {children ?? (
        <View style={{ alignItems: 'center' }}>
          <Text style={[styles.value, typography.mono]}>{Math.round(clamped)}</Text>
          <Text style={styles.suffix}>{suffix}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  value: {
    color: colors.textPrimary,
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: -2,
    includeFontPadding: false,
  },
  suffix: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: -2,
  },
});
