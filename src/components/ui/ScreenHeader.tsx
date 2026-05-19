import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, spacing, typography } from '../../theme';

type Props = {
  title: string;
  /** Mostra seta de voltar à esquerda. Default: true. */
  showBack?: boolean;
  /** Override do onPress do botão de voltar. */
  onBack?: () => void;
  /** Slot de ação à direita (ícone + onPress). */
  rightAction?: ReactNode;
  /** Sufixo abaixo do título — usado pra subtítulos pequenos tipo "Volta 12 · 24/04". */
  subtitle?: string;
};

export function ScreenHeader({ title, showBack = true, onBack, rightAction, subtitle }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleBack = onBack ?? (() => router.back());

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.s }]}>
      <View style={styles.row}>
        <View style={styles.side}>
          {showBack && (
            <Pressable
              onPress={handleBack}
              hitSlop={12}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.5 }]}
            >
              <Text style={styles.chevron}>‹</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.center}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>

        <View style={[styles.side, { alignItems: 'flex-end' }]}>{rightAction}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.m,
    backgroundColor: colors.bg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  side: {
    width: 44,
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    ...typography.labelL,
    color: colors.textPrimary,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    color: colors.textPrimary,
    fontSize: 34,
    fontWeight: '300',
    lineHeight: 34,
    marginTop: -4,
  },
});
