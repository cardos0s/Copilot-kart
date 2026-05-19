import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../../theme';

export type TabItem<T extends string = string> = {
  key: T;
  label: string;
  icon: (active: boolean) => ReactNode;
};

type Props<T extends string> = {
  tabs: TabItem<T>[];
  activeKey: T;
  onChange: (key: T) => void;
};

/**
 * Bottom tab bar custom — visual standalone, sem dependência de @react-navigation.
 * Pra wirear no expo-router, criar um adapter que recebe BottomTabBarProps e mapeia
 * state.routes -> tabs / state.index -> activeKey / navigation.navigate -> onChange.
 */
export function TabBar<T extends string>({ tabs, activeKey, onChange }: Props<T>) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.root,
        { paddingBottom: Math.max(insets.bottom, spacing.s) },
      ]}
    >
      <View style={styles.row}>
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onChange(tab.key)}
              style={({ pressed }) => [
                styles.tab,
                pressed && { opacity: 0.6 },
              ]}
            >
              {tab.icon(active)}
              <Text style={[styles.label, active && styles.labelActive]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.bgElevated,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.s,
    paddingHorizontal: spacing.s,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    gap: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  labelActive: {
    color: colors.primary,
  },
});
