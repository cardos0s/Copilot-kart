import { ReactNode } from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, shadows, spacing } from '../../theme';

type Variant = 'default' | 'elevated' | 'glow' | 'flat';
type Padding = 'none' | 's' | 'm' | 'l';

type Props = {
  children: ReactNode;
  variant?: Variant;
  padding?: Padding;
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
};

const paddingMap: Record<Padding, number> = {
  none: 0,
  s: spacing.m,
  m: spacing.l,
  l: spacing.xl,
};

export function Card({ children, variant = 'default', padding = 'm', onPress, style }: Props) {
  const variantStyle = variantStyles[variant];
  const content = (
    <View style={[styles.base, variantStyle, { padding: paddingMap[padding] }, style]}>
      {children}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
        {content}
      </Pressable>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.l,
    backgroundColor: colors.surface,
  },
});

const variantStyles: Record<Variant, ViewStyle> = {
  default: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  elevated: {
    backgroundColor: colors.surfaceHigh,
    ...shadows.cardHigh,
  },
  glow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    ...shadows.glowSoft,
  },
  flat: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
};
