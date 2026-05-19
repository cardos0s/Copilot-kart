import { StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../../theme';

type Position = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'side-right' | 'center';
type Intensity = 'subtle' | 'normal' | 'strong';

type Props = {
  position?: Position;
  intensity?: Intensity;
  /** Esconde pinceladas individuais (lime/magenta/cyan/purple). Útil pra ajustar paleta. */
  palette?: Array<'lime' | 'magenta' | 'cyan' | 'purple'>;
  style?: ViewStyle;
};

const intensityOpacity: Record<Intensity, number> = {
  subtle: 0.15,
  normal: 0.35,
  strong: 0.6,
};

const colorMap = {
  lime: colors.primary,
  magenta: colors.accentMagenta,
  cyan: colors.accentCyan,
  purple: colors.accentPurple,
};

/**
 * Pinceladas decorativas magenta/cyan/lime/purple do estilo Cortex Tech.
 * Renderiza 3-4 gradients radiais/lineares angulados como brush strokes.
 *
 * Posicionado absolute — coloca DENTRO de um container relative (ex: dentro de um Card)
 * e ele vai atrás do conteúdo (zIndex baixo).
 *
 * pointerEvents="none" pra não interceptar toques.
 */
export function DecorativeSplash({
  position = 'top-right',
  intensity = 'normal',
  palette = ['lime', 'magenta', 'cyan', 'purple'],
  style,
}: Props) {
  const opacity = intensityOpacity[intensity];

  return (
    <View style={[styles.layer, positionStyles[position], style]} pointerEvents="none">
      {palette.includes('magenta') && (
        <LinearGradient
          colors={[`${colorMap.magenta}00`, `${colorMap.magenta}FF`, `${colorMap.magenta}00`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.streak, { opacity, transform: [{ rotate: '-25deg' }, { translateX: -20 }] }]}
        />
      )}
      {palette.includes('cyan') && (
        <LinearGradient
          colors={[`${colorMap.cyan}00`, `${colorMap.cyan}DD`, `${colorMap.cyan}00`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.streak,
            { opacity: opacity * 0.8, top: 40, transform: [{ rotate: '-30deg' }, { translateX: 30 }] },
          ]}
        />
      )}
      {palette.includes('purple') && (
        <LinearGradient
          colors={[`${colorMap.purple}00`, `${colorMap.purple}EE`, `${colorMap.purple}00`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.streak,
            { opacity: opacity * 0.9, top: 80, transform: [{ rotate: '-20deg' }, { translateX: -10 }] },
          ]}
        />
      )}
      {palette.includes('lime') && (
        <LinearGradient
          colors={[`${colorMap.lime}00`, `${colorMap.lime}CC`, `${colorMap.lime}00`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.streak,
            { opacity: opacity * 1.1, top: 120, transform: [{ rotate: '-28deg' }, { translateX: 40 }] },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    width: 300,
    height: 240,
    overflow: 'hidden',
  },
  streak: {
    position: 'absolute',
    width: 280,
    height: 16,
    borderRadius: 8,
  },
});

const positionStyles: Record<Position, ViewStyle> = {
  'top-left': { top: 0, left: 0 },
  'top-right': { top: 0, right: 0 },
  'bottom-left': { bottom: 0, left: 0 },
  'bottom-right': { bottom: 0, right: 0 },
  'side-right': { top: 60, right: -40, height: '100%' },
  center: { top: '30%', alignSelf: 'center' },
};
