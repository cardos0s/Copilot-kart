/**
 * O mapa da direção B.
 *
 * A malha viária é abstrata, como no handoff — não é um mapa de verdade. Isso
 * é decisão, não atalho: o Mapbox do app depende de token que nem todo build
 * tem, e esta é a terceira tela do cadastro, onde o piloto pode estar num
 * kartódromo sem sinal. O que precisa ser verdadeiro aqui são as posições
 * relativas dos pinos, e essas vêm das coordenadas reais.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import { TrackRef } from '../../data/tracks';
import { makeLocalProjector } from '../../lib/geometry';
import { colors, radius } from '../../theme';

export const MAP_HEIGHT = 322;
const MESH_W = 390;
const PIN_PAD = 46;

type Props = {
  width: number;
  tracks: TrackRef[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  userLat: number | null;
  userLng: number | null;
};

export function NearbyMap({ width, tracks, selectedId, onSelect, userLat, userLng }: Props) {
  const { pins, userPoint } = useMemo(() => {
    if (tracks.length === 0) return { pins: [], userPoint: null };

    // Sem posição do usuário o mapa se centra no conjunto de pistas.
    const origin =
      userLat !== null && userLng !== null
        ? { lat: userLat, lng: userLng }
        : {
            lat: tracks.reduce((a, t) => a + t.lat, 0) / tracks.length,
            lng: tracks.reduce((a, t) => a + t.lng, 0) / tracks.length,
          };

    const projector = makeLocalProjector(origin);
    const projected = tracks.map((t) => ({ track: t, xy: projector.toXY({ lat: t.lat, lng: t.lng }) }));

    // Escala pra caber o pino mais distante — o mapa serve pra situar quem
    // está perto, não pra medir.
    const maxAbs = projected.reduce(
      (m, p) => Math.max(m, Math.abs(p.xy.x), Math.abs(p.xy.y)),
      0
    );
    const halfW = width / 2 - PIN_PAD;
    const halfH = MAP_HEIGHT / 2 - PIN_PAD;
    const scale = maxAbs > 0 ? Math.min(halfW, halfH) / maxAbs : 0;

    return {
      pins: projected.map((p) => ({
        id: p.track.id,
        // Norte pra cima: o Y do projetor cresce pro norte e o da tela pra baixo.
        left: width / 2 + p.xy.x * scale,
        top: MAP_HEIGHT / 2 - p.xy.y * scale,
      })),
      userPoint:
        userLat !== null && userLng !== null
          ? { left: width / 2, top: MAP_HEIGHT / 2 }
          : null,
    };
  }, [tracks, width, userLat, userLng]);

  return (
    <View style={[s.map, { width, height: MAP_HEIGHT }]}>
      <Svg
        width={width}
        height={MAP_HEIGHT}
        viewBox={`0 0 ${MESH_W} ${MAP_HEIGHT}`}
        preserveAspectRatio="xMidYMid slice"
        style={StyleSheet.absoluteFill}
      >
        <G stroke={colors.line} strokeWidth={1} fill="none">
          <Path d="M-10 90 C90 70 150 130 260 110 S380 150 400 130" />
          <Path d="M-10 210 C80 190 160 250 250 226 S370 250 400 236" />
          <Path d="M60 -10 C80 90 40 160 70 250 S60 320 66 340" />
          <Path d="M210 -10 C230 80 190 150 224 240 S214 320 220 340" />
          <Path d="M320 -10 C338 90 300 170 330 260" />
        </G>
        <G stroke={colors.line2} strokeWidth={2} fill="none">
          <Path d="M-10 160 C110 140 180 196 300 172 S388 190 400 184" />
        </G>
      </Svg>

      {pins.map((p) => {
        const on = p.id === selectedId;
        const size = on ? 26 : 18;
        const dot = on ? 8 : 6;
        return (
          <Pressable
            key={p.id}
            onPress={() => onSelect(p.id)}
            hitSlop={10}
            style={[s.pinAnchor, { left: p.left, top: p.top }]}
          >
            {on && <View style={s.halo} />}
            <View
              style={[
                s.pin,
                {
                  width: size,
                  height: size,
                  marginLeft: -size / 2,
                  marginTop: -size / 2,
                  backgroundColor: on ? colors.blue : colors.surfaceRail,
                },
                on && s.pinSelected,
              ]}
            >
              <View
                style={{
                  width: dot,
                  height: dot,
                  borderRadius: radius.pill,
                  backgroundColor: on ? '#fff' : colors.muted,
                }}
              />
            </View>
          </Pressable>
        );
      })}

      {userPoint && (
        <View style={[s.userAnchor, { left: userPoint.left, top: userPoint.top }]}>
          <View style={s.userHalo} />
          <View style={s.userDot} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  map: {
    backgroundColor: colors.surfaceTrack,
    overflow: 'hidden',
  },
  pinAnchor: {
    position: 'absolute',
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 46,
    height: 46,
    marginLeft: -23,
    marginTop: -23,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(37, 99, 255, 0.16)',
  },
  pin: {
    position: 'absolute',
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinSelected: {
    // O anel na cor do fundo é o que descola o pino selecionado da malha.
    borderWidth: 2,
    borderColor: colors.bg,
  },
  userAnchor: {
    position: 'absolute',
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userHalo: {
    position: 'absolute',
    width: 18,
    height: 18,
    marginLeft: -9,
    marginTop: -9,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  userDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    marginLeft: -6,
    marginTop: -6,
    borderRadius: radius.pill,
    backgroundColor: '#fff',
  },
});
