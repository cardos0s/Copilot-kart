import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../../theme';

type Cell = {
  text: string;
  tone?: 'neutral' | 'primary' | 'success' | 'danger' | 'magenta' | 'cyan' | 'muted';
  align?: 'left' | 'right' | 'center';
  /** Faz o texto encolher pra caber (numeric cells). Default true. */
  fit?: boolean;
};

type Props = {
  /** Células da linha. Tipicamente 4 (rótulo + 3 valores). */
  cells: Cell[];
  /** Pesos relativos das colunas (mesma length de cells). Default: igual. */
  weights?: number[];
  /** Se true, aplica estilo "header" (texto menor, uppercase). */
  header?: boolean;
};

const toneColor = {
  neutral: colors.textPrimary,
  primary: colors.primary,
  success: colors.success,
  danger: colors.danger,
  magenta: colors.accentMagenta,
  cyan: colors.accentCyan,
  muted: colors.textMuted,
};

/**
 * Linha de tabela compacta (ex: S1 | 00:16.325 | 00:16.482 | +0.157).
 * Sem bordas internas — espaçamento por flex weights.
 */
export function StatRow({ cells, weights, header }: Props) {
  return (
    <View style={[styles.row, header && styles.headerRow]}>
      {cells.map((cell, i) => {
        const flex = weights?.[i] ?? 1;
        const align = cell.align ?? (i === 0 ? 'left' : 'right');
        const color = toneColor[cell.tone ?? 'neutral'];
        return (
          <View key={i} style={{ flex, alignItems: justifyMap[align] }}>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit={cell.fit ?? !header}
              style={[
                header ? styles.headerText : styles.cellText,
                { color },
                !header && typography.mono,
              ]}
            >
              {cell.text}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const justifyMap = {
  left: 'flex-start' as const,
  right: 'flex-end' as const,
  center: 'center' as const,
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerRow: {
    paddingVertical: spacing.s,
    borderBottomColor: colors.borderStrong,
  },
  cellText: {
    fontSize: 14,
    fontWeight: '700',
  },
  headerText: {
    ...typography.label,
    color: colors.textMuted,
  },
});
