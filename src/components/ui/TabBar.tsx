import { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radius } from '../../theme';

const PILL_HEIGHT = 52;
const BAR_PADDING = 7;

/** Altura da cápsula: pílula + respiro interno + a borda de 1 px de cada lado. */
export const TAB_BAR_HEIGHT = PILL_HEIGHT + BAR_PADDING * 2 + 2;
/** Distância mínima entre a cápsula e a borda de baixo da tela. */
export const TAB_BAR_GAP = 12;

/**
 * Quanto a barra ocupa a partir da borda inferior, com folga. Quem desenha
 * algo flutuante acima dela (FAB, toast) deve partir daqui em vez de chutar
 * um número — foi assim que o FAB da home indoor quase encostou na barra.
 */
export function tabBarSpace(insetBottom: number, gap = 16) {
  return Math.max(insetBottom, TAB_BAR_GAP) + TAB_BAR_HEIGHT + gap;
}

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
 * Barra flutuante de vidro: cápsula centrada por cima do conteúdo, só ícones,
 * e a aba ativa se abre mostrando o nome dela.
 *
 * Ela sobrepõe a tela em vez de ocupar espaço no layout — é isso que dá o que
 * borrar por trás do vidro. As telas de aba já reservam 120 px no fim do
 * scroll, então nada fica escondido embaixo.
 */
export function TabBar<T extends string>({ tabs, activeKey, onChange }: Props<T>) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { bottom: Math.max(insets.bottom, 12) }]} pointerEvents="box-none">
      <BlurView
        intensity={Platform.OS === 'ios' ? 42 : 28}
        tint="dark"
        // No Android o blur real depende deste método; sem ele o componente
        // cai no fundo sólido de baixo, que já é legível sozinho.
        experimentalBlurMethod="dimezisBlurView"
        style={styles.bar}
      >
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onChange(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tab.label}
              style={({ pressed }) => [pressed && { opacity: 0.7 }]}
            >
              <Animated.View
                layout={LinearTransition.duration(260)}
                style={[styles.pill, active && styles.pillActive]}
              >
                {tab.icon(active)}
                {active && (
                  <Animated.Text
                    entering={FadeIn.duration(180).delay(60)}
                    exiting={FadeOut.duration(110)}
                    style={styles.label}
                  >
                    {tab.label}
                  </Animated.Text>
                )}
              </Animated.View>
            </Pressable>
          );
        })}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: BAR_PADDING,
    borderRadius: radius.pill,
    // O overflow é o que faz o blur respeitar a cápsula em vez de vazar nos
    // cantos, e a cor é o piso de legibilidade se o blur não estiver ativo.
    overflow: 'hidden',
    backgroundColor: 'rgba(18, 21, 27, 0.72)',
    borderWidth: 1,
    borderColor: colors.line2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: PILL_HEIGHT,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
  },
  pillActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    letterSpacing: -0.16,
    color: colors.blueSoft,
    // Sem isto o texto encolhe pra caber na largura transitória da pílula
    // enquanto ela abre, e chega truncado no fim da animação.
    flexShrink: 0,
    includeFontPadding: false,
  },
});
