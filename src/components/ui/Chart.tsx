import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { colors } from '../../theme';

type Props = {
  /** Pontos do eixo Y (eixo X é índice). Vazio = empty state. */
  data: number[];
  /** Largura do gráfico. Default: preencher container (não funciona em SVG, precisa explícito). */
  width: number;
  /** Altura do gráfico. */
  height: number;
  /** Cor da linha principal. Default: primary (lime). */
  color?: string;
  /** Mostra área preenchida sob a linha. Default: true. */
  showArea?: boolean;
  /** Mostra os pontos como dots. Default: false (sparkline). */
  showDots?: boolean;
  /** Destacar último ponto (volta mais recente). */
  highlightLast?: boolean;
  /** Padding interno em px. Default: 8. */
  padding?: number;
};

export function Chart({
  data,
  width,
  height,
  color = colors.primary,
  showArea = true,
  showDots = false,
  highlightLast = false,
  padding = 8,
}: Props) {
  if (data.length < 2) {
    return <View style={{ width, height }} />;
  }

  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const stepX = innerW / (data.length - 1);
  const points = data.map((v, i) => {
    const x = padding + i * stepX;
    const y = padding + innerH - ((v - min) / range) * innerH;
    return { x, y };
  });

  // Path da linha (smooth via curve cubic). Pode ser melhorado com catmull-rom; por ora linear.
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');

  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(2)},${
    height - padding
  } L${points[0].x.toFixed(2)},${height - padding} Z`;

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0.35} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        {showArea && <Path d={areaPath} fill="url(#area)" />}
        <Path d={linePath} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" />

        {showDots &&
          points.map((p, i) => (
            <Circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={3}
              fill={colors.bg}
              stroke={color}
              strokeWidth={1.5}
            />
          ))}

        {highlightLast && (
          <Circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r={5}
            fill={color}
          />
        )}
      </Svg>
    </View>
  );
}
