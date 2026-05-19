import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { colors } from '../theme';
import { GpsSample } from '../lib/geometry';

type Props = {
  samples: GpsSample[];
  width?: number;
  height?: number;
  strokeColor?: string;
  strokeWidth?: number;
  showStart?: boolean;
};

export function TrackSilhouette({
  samples,
  width = 120,
  height = 80,
  strokeColor = colors.primary,
  strokeWidth = 2.5,
  showStart = true,
}: Props) {
  if (samples.length < 2) {
    return <View style={{ width, height }} />;
  }

  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  for (const s of samples) {
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lng < minLng) minLng = s.lng;
    if (s.lng > maxLng) maxLng = s.lng;
  }

  const dLat = maxLat - minLat || 0.0001;
  const dLng = maxLng - minLng || 0.0001;

  const padding = 6;
  const scaleX = (width - padding * 2) / dLng;
  const scaleY = (height - padding * 2) / dLat;
  const scale = Math.min(scaleX, scaleY);

  const offsetX = (width - dLng * scale) / 2;
  const offsetY = (height - dLat * scale) / 2;

  const toX = (lng: number) => (lng - minLng) * scale + offsetX;
  const toY = (lat: number) => height - ((lat - minLat) * scale + offsetY);

  const step = Math.max(1, Math.floor(samples.length / 120));
  const path = samples
    .filter((_, i) => i % step === 0)
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${toX(s.lng).toFixed(1)} ${toY(s.lat).toFixed(1)}`)
    .join(' ') + ' Z';

  const startX = toX(samples[0].lng);
  const startY = toY(samples[0].lat);

  return (
    <Svg width={width} height={height}>
      <Path
        d={path}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {showStart && (
        <Circle cx={startX} cy={startY} r={3.5} fill={colors.accentMagenta} />
      )}
    </Svg>
  );
}