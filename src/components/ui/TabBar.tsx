import { ReactNode, useEffect, useState } from 'react';
import { LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radius } from '../../theme';

const PILL_HEIGHT = 52;
const BAR_PADDING = 7;
const PILL_PAD = 18;
const ICON_SIZE = 24;
/** Respiro entre o ícone e o nome quando a aba está aberta. */
const LABEL_GAP = 9;
const OPEN_MS = 260;

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

const EASE = Easing.bezier(0.22, 1, 0.36, 1);

/**
 * Uma aba. A largura da pílula é calculada aqui e animada à mão, em vez de
 * sair do motor de layout.
 *
 * Deixar a largura por conta de uma layout animation não funciona: ela anima
 * até a largura que mediu, e essa medida acontece antes do texto entrar no
 * layout — a pílula termina estreita demais e corta o nome no meio. Medindo o
 * texto uma vez e somando as partes, a largura final é conhecida antes da
 * animação começar.
 */
function Tab({
  label,
  icon,
  active,
  labelWidth,
  onPress,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  labelWidth: number;
  onPress: () => void;
}) {
  const collapsed = PILL_PAD * 2 + ICON_SIZE;
  const expanded = collapsed + LABEL_GAP + labelWidth;
  // Enquanto o texto não foi medido, a pílula fica fechada — abrir para uma
  // largura chutada seria o mesmo defeito de antes, só que na mão.
  const target = active && labelWidth > 0 ? expanded : collapsed;

  const width = useSharedValue(target);
  const labelOpacity = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    width.value = withTiming(target, { duration: OPEN_MS, easing: EASE });
    labelOpacity.value = withTiming(active ? 1 : 0, {
      duration: active ? 180 : 110,
      easing: Easing.linear,
    });
  }, [target, active, width, labelOpacity]);

  const pillStyle = useAnimatedStyle(() => ({ width: width.value }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: labelOpacity.value }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={({ pressed }) => [pressed && { opacity: 0.7 }]}
    >
      <Animated.View style={[styles.pill, active && styles.pillActive, pillStyle]}>
        <View style={styles.icon}>{icon}</View>
        <Animated.Text style={[styles.label, labelStyle]} numberOfLines={1}>
          {label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

/**
 * Barra flutuante de vidro: cápsula centrada por cima do conteúdo, só ícones,
 * e a aba ativa se abre mostrando o nome dela.
 *
 * Ela sobrepõe a tela em vez de ocupar espaço no layout — é isso que dá o que
 * borrar por trás do vidro. As telas de aba reservam o fim do scroll por
 * `tabBarSpace`, então nada fica escondido embaixo.
 */
export function TabBar<T extends string>({ tabs, activeKey, onChange }: Props<T>) {
  const insets = useSafeAreaInsets();
  const [labelWidths, setLabelWidths] = useState<Record<string, number>>({});

  const measure = (key: string) => (e: LayoutChangeEvent) => {
    const w = Math.ceil(e.nativeEvent.layout.width);
    setLabelWidths((prev) => (prev[key] === w || w === 0 ? prev : { ...prev, [key]: w }));
  };

  return (
    <View
      style={[styles.root, { bottom: Math.max(insets.bottom, TAB_BAR_GAP) }]}
      pointerEvents="box-none"
    >
      <BlurView
        intensity={Platform.OS === 'ios' ? 42 : 28}
        tint="dark"
        // No Android o blur real depende deste método; sem ele o componente
        // cai no fundo sólido de baixo, que já é legível sozinho.
        experimentalBlurMethod="dimezisBlurView"
        style={styles.bar}
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.key}
            label={tab.label}
            icon={tab.icon(tab.key === activeKey)}
            active={tab.key === activeKey}
            labelWidth={labelWidths[tab.key] ?? 0}
            onPress={() => onChange(tab.key)}
          />
        ))}
      </BlurView>

      {/* Camada de medição. Fica fora da cápsula, no root, que tem a largura da
          tela — dentro da pílula o texto é medido contra um espaço apertado e
          volta menor do que é, que era a origem do nome cortado. */}
      <View style={styles.measureLayer} pointerEvents="none" aria-hidden>
        {tabs.map((tab) => (
          <Text key={tab.key} style={styles.label} onLayout={measure(tab.key)}>
            {tab.label}
          </Text>
        ))}
      </View>
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
  measureLayer: {
    position: 'absolute',
    top: -9999,
    left: 0,
    opacity: 0,
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
    height: PILL_HEIGHT,
    paddingLeft: PILL_PAD,
    borderRadius: radius.pill,
    // A pílula tem largura própria e o conteúdo transborda enquanto ela abre;
    // recortar aqui é o que transforma o transbordo em revelação.
    overflow: 'hidden',
  },
  pillActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },
  icon: {
    width: ICON_SIZE,
    alignItems: 'center',
    flexShrink: 0,
  },
  label: {
    marginLeft: LABEL_GAP,
    fontFamily: fonts.semibold,
    fontSize: 16,
    letterSpacing: -0.16,
    color: colors.blueSoft,
    // Sem isto o texto é espremido pela largura da pílula enquanto ela abre, e
    // a medida do onLayout sai menor que o tamanho real do nome.
    flexShrink: 0,
    includeFontPadding: false,
  },
});
