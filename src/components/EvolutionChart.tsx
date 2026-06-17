import { useRef } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { colors } from '../theme';

const LIME = colors.accentLime;
const TOOLTIP_W = 76;

type Props = {
  data: number[];
  width: number;
  height: number;
  selectedIndex: number | null;
  onSelect: (i: number | null) => void;
  /** Formata o valor pro tooltip (ex: tempo de volta). */
  formatValue: (v: number) => string;
  color?: string;
  padding?: number;
};

/**
 * Gráfico de linha tocável: toque/arraste seleciona a sessão mais próxima,
 * mostra tooltip com o valor, linha-guia tracejada e ponto lime com halo.
 * Tocar de novo no ponto já selecionado limpa a seleção.
 */
export function EvolutionChart({
  data,
  width,
  height,
  selectedIndex,
  onSelect,
  formatValue,
  color = colors.racingBlue,
  padding = 8,
}: Props) {
  const gesture = useRef({ moved: false, toggleOff: false }).current;

  if (data.length < 2) return <View style={{ width, height }} />;

  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = innerW / (data.length - 1);

  const points = data.map((v, i) => ({
    x: padding + i * stepX,
    y: padding + innerH - ((v - min) / range) * innerH,
  }));

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(2)},${height - padding} L${points[0].x.toFixed(2)},${height - padding} Z`;

  const nearest = (lx: number) => {
    const clamped = Math.max(padding, Math.min(width - padding, lx));
    return Math.max(0, Math.min(data.length - 1, Math.round((clamped - padding) / stepX)));
  };

  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const i = nearest(e.nativeEvent.locationX);
      gesture.moved = false;
      gesture.toggleOff = i === selectedIndex;
      onSelect(i);
    },
    onPanResponderMove: (e) => {
      gesture.moved = true;
      onSelect(nearest(e.nativeEvent.locationX));
    },
    onPanResponderRelease: () => {
      if (!gesture.moved && gesture.toggleOff) onSelect(null);
    },
  });

  const sel =
    selectedIndex != null && selectedIndex >= 0 && selectedIndex < points.length
      ? points[selectedIndex]
      : null;
  const lastP = points[points.length - 1];
  const tipLeft = sel ? Math.max(0, Math.min(width - TOOLTIP_W, sel.x - TOOLTIP_W / 2)) : 0;

  return (
    <View style={{ width, height }} {...pan.panHandlers}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="evoArea" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0.32} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        <Path d={areaPath} fill="url(#evoArea)" />
        <Path d={linePath} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" />

        {points.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={3} fill={colors.bg} stroke={color} strokeWidth={1.5} />
        ))}

        {sel ? (
          <>
            <Line
              x1={sel.x}
              y1={padding}
              x2={sel.x}
              y2={height - padding}
              stroke={colors.borderStrong}
              strokeWidth={1}
              strokeDasharray="3 4"
            />
            <Circle cx={sel.x} cy={sel.y} r={9} fill={LIME} opacity={0.22} />
            <Circle cx={sel.x} cy={sel.y} r={4.5} fill={LIME} stroke={colors.bg} strokeWidth={1.5} />
          </>
        ) : (
          <Circle cx={lastP.x} cy={lastP.y} r={5} fill={LIME} />
        )}
      </Svg>

      {sel && (
        <View style={[s.tooltip, { left: tipLeft, top: Math.max(0, sel.y - 32) }]} pointerEvents="none">
          <Text style={s.tooltipText}>{formatValue(data[selectedIndex as number])}</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  tooltip: {
    position: 'absolute',
    width: TOOLTIP_W,
    alignItems: 'center',
    paddingVertical: 4,
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  tooltipText: {
    color: LIME,
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
});
