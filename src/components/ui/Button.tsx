import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 's' | 'm' | 'l';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  style?: ViewStyle | ViewStyle[];
  fullWidth?: boolean;
};

const sizeMap: Record<Size, { padV: number; padH: number; font: number }> = {
  s: { padV: 8, padH: 14, font: 13 },
  m: { padV: 12, padH: 18, font: 15 },
  l: { padV: 16, padH: 24, font: 17 },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'm',
  loading,
  disabled,
  iconLeft,
  iconRight,
  style,
  fullWidth,
}: Props) {
  const v = variantStyles[variant];
  const s = sizeMap[size];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        v.container,
        { paddingVertical: s.padV, paddingHorizontal: s.padH },
        fullWidth && { alignSelf: 'stretch' },
        pressed && !isDisabled && { opacity: 0.75 },
        isDisabled && { opacity: 0.4 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.label.color} />
      ) : (
        <View style={styles.inner}>
          {iconLeft}
          <Text style={[v.label, { fontSize: s.font }]}>{label}</Text>
          {iconRight}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
  },
});

const variantStyles: Record<Variant, { container: ViewStyle; label: TextStyle }> = {
  primary: {
    container: {
      backgroundColor: colors.primary,
    },
    label: {
      color: colors.textOnPrimary,
      fontWeight: '800',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
  },
  secondary: {
    container: {
      backgroundColor: colors.surfaceHigh,
      borderWidth: 1,
      borderColor: colors.border,
    },
    label: {
      color: colors.textPrimary,
      fontWeight: '700',
    },
  },
  ghost: {
    container: {
      backgroundColor: 'transparent',
    },
    label: {
      color: colors.textPrimary,
      fontWeight: '700',
    },
  },
  danger: {
    container: {
      backgroundColor: colors.danger,
    },
    label: {
      color: colors.textPrimary,
      fontWeight: '800',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
  },
};
