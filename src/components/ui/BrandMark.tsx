import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme';

type Variant = 'inline' | 'stacked';

type Props = {
  variant?: Variant;
};

/**
 * Assinatura "powered by Cortex Tech".
 * Usado em rodapés (Perfil, Configurações).
 *
 * inline: "powered by  CORTEX TECH" em uma linha
 * stacked: "powered by" em cima, "CORTEX TECH" embaixo
 */
export function BrandMark({ variant = 'inline' }: Props) {
  if (variant === 'stacked') {
    return (
      <View style={styles.stacked}>
        <Text style={styles.poweredBy}>powered by</Text>
        <Text style={styles.brand}>CORTEX TECH</Text>
      </View>
    );
  }

  return (
    <View style={styles.inline}>
      <Text style={styles.poweredBy}>powered by</Text>
      <Text style={styles.brand}>CORTEX TECH</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stacked: {
    alignItems: 'center',
  },
  poweredBy: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  brand: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
  },
});
