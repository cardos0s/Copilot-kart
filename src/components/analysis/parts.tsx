/**
 * Vocabulário compartilhado da análise de voltas.
 *
 * As quatro abas contam a mesma história por ângulos diferentes, então a
 * barra de delta, o cabeçalho de comparação e a linha de setor vivem aqui —
 * senão cada aba inventa a própria régua e o mesmo 0,140 s aparece com
 * tamanhos diferentes dependendo de onde o piloto olha.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, spacing } from '../../theme';
import { formatLapPlain } from '../../lib/format';

/** "+0.140" / "−0.020" — sinal explícito, sempre três casas. */
export function fmtDeltaS(ms: number): string {
  const s = ms / 1000;
  const sign = s > 0 ? '+' : s < 0 ? '−' : '';
  return `${sign}${Math.abs(s).toFixed(3)}`;
}

export function deltaTone(ms: number): string {
  if (ms > 0) return colors.danger;
  if (ms < 0) return colors.success;
  return colors.muted;
}

/**
 * Barra divergente: o tique fica no meio e o preenchimento cresce pra direita
 * quando perdeu tempo, pra esquerda quando ganhou. Todas as barras da tela
 * compartilham `maxAbsMs`, senão a maior perda parece igual em qualquer setor
 * e a comparação entre eles some.
 */
export function DeltaBar({ deltaMs, maxAbsMs }: { deltaMs: number; maxAbsMs: number }) {
  const limit = Math.max(maxAbsMs, 1);
  const ratio = Math.min(1, Math.abs(deltaMs) / limit);
  const lost = deltaMs > 0;

  return (
    <View style={s.barTrack}>
      <View style={s.barCenter} />
      <View
        style={[
          s.barFill,
          {
            width: `${ratio * 50}%`,
            backgroundColor: lost ? colors.danger : colors.success,
            left: lost ? '50%' : undefined,
            right: lost ? undefined : '50%',
          },
        ]}
      />
    </View>
  );
}

/** O par melhor-volta × volta-selecionada que encabeça a tela toda. */
export function LapSummaryHead({
  bestMs,
  bestLabel,
  currentMs,
  currentLabel,
  deltaMs,
  isBest,
}: {
  bestMs: number;
  bestLabel: string;
  currentMs: number;
  currentLabel: string;
  deltaMs: number;
  isBest: boolean;
}) {
  return (
    <View style={s.head}>
      <View style={s.headCol}>
        <Text style={s.headLabel}>MELHOR VOLTA</Text>
        <View style={s.headValueLine}>
          <Text style={[s.headValue, { color: colors.blueSoft }]}>{formatLapPlain(bestMs)}</Text>
          <Text style={s.headSuffix}>{bestLabel}</Text>
        </View>
      </View>

      <View style={s.headRule} />

      <View style={s.headCol}>
        <Text style={s.headLabel}>{currentLabel}</Text>
        <View style={s.headValueLine}>
          <Text style={s.headValueSmall}>{formatLapPlain(currentMs)}</Text>
          {!isBest && (
            <Text style={[s.headDelta, { color: deltaTone(deltaMs) }]}>{fmtDeltaS(deltaMs)}</Text>
          )}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  barTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRail,
    justifyContent: 'center',
  },
  barCenter: {
    position: 'absolute',
    left: '50%',
    width: 1,
    top: -2,
    bottom: -2,
    backgroundColor: colors.line2,
  },
  barFill: {
    position: 'absolute',
    height: 8,
    borderRadius: radius.pill,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.m,
  },
  headCol: { flex: 1 },
  headRule: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.line,
    marginHorizontal: spacing.xl,
  },
  headLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 1.3,
    color: colors.muted,
  },
  headValueLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginTop: 6,
  },
  headValue: {
    fontFamily: fonts.monoMedium,
    fontSize: 40,
    letterSpacing: -1.2,
    fontVariant: ['tabular-nums'],
  },
  headValueSmall: {
    fontFamily: fonts.monoMedium,
    fontSize: 32,
    letterSpacing: -0.9,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  headSuffix: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.muted,
  },
  headDelta: {
    fontFamily: fonts.monoMedium,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
});

// ── mapa de curvas ────────────────────────────────────────────────

import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import { Pressable } from 'react-native';
import type { ReferenceLap } from '../../lib/geometry';
import type { Corner } from '../../lib/corners';

const VB = 100;

/**
 * O traçado com as curvas numeradas em cima.
 *
 * A projeção é a mesma da silhueta da home: encaixa o desenho no viewBox
 * preservando a proporção. O marcador de cada curva sai do ápice — o ponto de
 * curvatura máxima — que é onde o piloto reconhece a curva olhando o mapa.
 */
export function CornerMap({
  refLap,
  corners,
  selectedIndex,
  size,
  onSelect,
}: {
  refLap: ReferenceLap;
  corners: Corner[];
  selectedIndex: number | null;
  size: number;
  onSelect?: (i: number) => void;
}) {
  const pts = refLap.points;
  if (pts.length < 8) return null;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const pad = 12;
  const scale = Math.min((VB - pad * 2) / spanX, (VB - pad * 2) / spanY);
  const offX = (VB - spanX * scale) / 2;
  const offY = (VB - spanY * scale) / 2;
  // Y do GPS cresce pro norte, o do SVG pra baixo.
  const toBox = (p: { x: number; y: number }) => ({
    x: offX + (p.x - minX) * scale,
    y: VB - (offY + (p.y - minY) * scale),
  });

  const step = Math.max(1, Math.floor(pts.length / 160));
  const kept: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i += step) kept.push(toBox(pts[i]));
  const d = kept.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z';

  /** Ponto da polyline mais próximo da distância s. */
  const atS = (s: number) => {
    let lo = 0;
    for (let i = 1; i < refLap.cumulativeDist.length; i++) {
      if (refLap.cumulativeDist[i] >= s) { lo = i; break; }
      lo = i;
    }
    return toBox(pts[lo]);
  };

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`} fill="none">
      <Path d={d} stroke={colors.surfaceRail} strokeWidth={3.4} strokeLinejoin="round" strokeLinecap="round" />
      <Path d={d} stroke={colors.blue} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {corners.map((c, i) => {
        const p = atS(c.sApex);
        const on = i === selectedIndex;
        return (
          <React.Fragment key={c.index}>
            {on && <Circle cx={p.x} cy={p.y} r={5.2} fill="rgba(37,99,255,0.30)" />}
            <Circle
              cx={p.x}
              cy={p.y}
              r={on ? 2.6 : 1.9}
              fill={on ? '#fff' : colors.bg}
              stroke={on ? colors.blue : colors.muted}
              strokeWidth={on ? 0 : 1.1}
              onPress={onSelect ? () => onSelect(i) : undefined}
            />
            <SvgText
              x={p.x}
              y={p.y - 5}
              fill={on ? colors.text : colors.muted}
              fontSize={4.2}
              textAnchor="middle"
            >
              {i + 1}
            </SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

/** Seta de direção da curva. */
export function CornerArrow({ direction, color }: { direction: 'left' | 'right'; color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d={direction === 'right' ? 'M6 19 C6 11 12 7 18 7 M14 4 L18 7 L14 10' : 'M18 19 C18 11 12 7 6 7 M10 4 L6 7 L10 10'}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
