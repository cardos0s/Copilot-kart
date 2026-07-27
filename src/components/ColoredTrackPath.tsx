import { View } from 'react-native';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';
import { GpsSample } from '../lib/geometry';
import { colors } from '../theme';

export type ColoredSegment = {
  /** Samples consecutivos no segmento (mínimo 2). */
  samples: GpsSample[];
  color: string;
};

export type EventMarker = {
  point: { lat: number; lng: number };
  color: string;
  /** Letra/símbolo curto dentro do círculo (ex: "P", "B", "+", "−"). */
  label: string;
};

export type CornerBadge = {
  point: { lat: number; lng: number };
  number: number;
};

export type AzimuthArrow = {
  point: { lat: number; lng: number };
  /** Azimute de bússola em graus (0 = Norte, horário). */
  azimuthDeg: number;
  color?: string;
};

type Props = {
  /** Segmentos coloridos — cada um com seus pontos lat/lng. */
  segments: ColoredSegment[];
  width: number;
  height: number;
  strokeWidth?: number;
  /** Marcador opcional no ponto destacado (lat/lng). Útil pro setor focado. */
  highlightPoint?: { lat: number; lng: number };
  /** Mostra círculo no ponto de largada. */
  showStart?: boolean;
  /** Marcadores de eventos automáticos (pico velocidade, freada, etc). */
  eventMarkers?: EventMarker[];
  /** Badges numerados nas curvas. */
  cornerBadges?: CornerBadge[];
  /** Setas de azimute (direção de percurso) — ex: entrada de cada curva. */
  azimuthArrows?: AzimuthArrow[];
};

/**
 * Renderiza a trajetória como silhueta SVG, com cada segmento numa cor.
 * Funciona offline, sem Google Maps. Suporta marcadores de eventos e badges
 * de curva sobrepostos pra análise visual de "onde aconteceu o quê".
 */
export function ColoredTrackPath({
  segments,
  width,
  height,
  strokeWidth = 3,
  highlightPoint,
  showStart = true,
  eventMarkers = [],
  cornerBadges = [],
  azimuthArrows = [],
}: Props) {
  if (segments.length === 0) {
    return <View style={{ width, height }} />;
  }

  // bbox global considerando todos os segmentos
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const seg of segments) {
    for (const p of seg.samples) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
  }

  const dLat = maxLat - minLat || 0.0001;
  const dLng = maxLng - minLng || 0.0001;
  const padding = 18;
  const scaleX = (width - padding * 2) / dLng;
  const scaleY = (height - padding * 2) / dLat;
  const scale = Math.min(scaleX, scaleY);

  const offsetX = (width - dLng * scale) / 2;
  const offsetY = (height - dLat * scale) / 2;

  const toX = (lng: number) => (lng - minLng) * scale + offsetX;
  const toY = (lat: number) => height - ((lat - minLat) * scale + offsetY);

  const firstSample = segments[0]?.samples[0];

  return (
    <Svg width={width} height={height}>
      {/* Trilha colorida */}
      {segments.map((seg, segIdx) => {
        if (seg.samples.length < 2) return null;
        const step = Math.max(1, Math.floor(seg.samples.length / 100));
        const filtered = seg.samples.filter(
          (_, i) => i % step === 0 || i === seg.samples.length - 1
        );
        const d = filtered
          .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.lng).toFixed(1)},${toY(p.lat).toFixed(1)}`)
          .join(' ');
        return (
          <Path
            key={segIdx}
            d={d}
            stroke={seg.color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}

      {/* Highlight do setor focado (anel pulsante seria ideal, por ora ponto destacado) */}
      {highlightPoint && (
        <G>
          <Circle
            cx={toX(highlightPoint.lng)}
            cy={toY(highlightPoint.lat)}
            r={14}
            fill={`${colors.primary}33`}
            stroke="none"
          />
          <Circle
            cx={toX(highlightPoint.lng)}
            cy={toY(highlightPoint.lat)}
            r={7}
            fill={colors.primary}
            stroke={colors.bg}
            strokeWidth={2}
          />
        </G>
      )}

      {/* Setas de azimute — direção de percurso na entrada das curvas.
          Tela tem norte pra cima (toY inverte lat) e rotate() do SVG é
          horário, igual azimute de bússola: rotate(azimuthDeg) direto. */}
      {azimuthArrows.map((ar, i) => {
        const cx = toX(ar.point.lng);
        const cy = toY(ar.point.lat);
        const color = ar.color ?? colors.accentLime;
        return (
          <G key={`azimuth-${i}`} transform={`translate(${cx},${cy}) rotate(${ar.azimuthDeg})`}>
            {/* haste + ponta, apontando pra cima antes da rotação */}
            <Path
              d="M0,9 L0,-9 M-4.5,-3.5 L0,-9 L4.5,-3.5"
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </G>
        );
      })}

      {/* Badges numerados nas curvas */}
      {cornerBadges.map((cb, i) => (
        <G key={`corner-${i}`}>
          <Circle
            cx={toX(cb.point.lng)}
            cy={toY(cb.point.lat)}
            r={9}
            fill="rgba(0,0,0,0.85)"
            stroke={colors.textSecondary}
            strokeWidth={1}
          />
          <SvgText
            x={toX(cb.point.lng)}
            y={toY(cb.point.lat) + 3.5}
            fontSize={10}
            fontWeight="700"
            fill={colors.textPrimary}
            textAnchor="middle"
          >
            {cb.number}
          </SvgText>
        </G>
      ))}

      {/* Marcadores de eventos (pico de vel, freada, ganho, perda) */}
      {eventMarkers.map((m, i) => (
        <G key={`event-${i}`}>
          <Circle
            cx={toX(m.point.lng)}
            cy={toY(m.point.lat)}
            r={12}
            fill={m.color}
            stroke={colors.bg}
            strokeWidth={2.5}
          />
          <SvgText
            x={toX(m.point.lng)}
            y={toY(m.point.lat) + 4}
            fontSize={11}
            fontWeight="900"
            fill={colors.textPrimary}
            textAnchor="middle"
          >
            {m.label}
          </SvgText>
        </G>
      ))}

      {/* Linha de largada */}
      {showStart && firstSample && (
        <Circle
          cx={toX(firstSample.lng)}
          cy={toY(firstSample.lat)}
          r={5}
          fill={colors.accentMagenta}
          stroke={colors.bg}
          strokeWidth={1.5}
        />
      )}
    </Svg>
  );
}
