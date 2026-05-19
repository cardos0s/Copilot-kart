import { Image, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '../../theme';

type Props = {
  /** URI da foto (opcional). Se ausente, mostra iniciais. */
  photoUri?: string | null;
  /** Nome completo — extrai iniciais (primeira + última palavra). */
  name?: string;
  /** Diâmetro em px. */
  size?: number;
  /** Cor de fundo das iniciais. Default surfaceHigh. */
  bgColor?: string;
  /** Cor das iniciais. Default primary (lime). */
  initialsColor?: string;
  /** Borda externa (offset). Útil pra destaque. */
  ring?: boolean;
  style?: ViewStyle;
};

function getInitials(name?: string) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  photoUri,
  name,
  size = 64,
  bgColor = colors.surfaceHigh,
  initialsColor = colors.primary,
  ring = false,
  style,
}: Props) {
  const initials = getInitials(name);
  const containerStyle: ViewStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    overflow: 'hidden',
    backgroundColor: bgColor,
    alignItems: 'center',
    justifyContent: 'center',
    ...(ring && {
      borderWidth: 3,
      borderColor: colors.primary,
    }),
  };

  return (
    <View style={[containerStyle, style]}>
      {photoUri ? (
        <Image source={{ uri: photoUri }} style={{ width: '100%', height: '100%' }} />
      ) : (
        <Text
          style={[
            styles.initials,
            { fontSize: size * 0.4, color: initialsColor },
          ]}
        >
          {initials}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  initials: {
    fontWeight: '900',
    letterSpacing: -0.5,
  },
});
