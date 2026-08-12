import { useEffect, useState } from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import {
  placeholderSilhouette,
  samplesToSilhouette,
  Silhouette,
  SILHOUETTE_VIEWBOX,
} from '../../lib/trackSilhouette';
import { listAllLayoutsGrouped, listTrackReferences } from '../../storage/db';
import { colors } from '../../theme';

export type SilhouetteMap = Map<string, Silhouette>;

/**
 * Carrega de uma vez as silhuetas de todas as pistas que já foram gravadas.
 * A lista de kartódromos tem quase 70 entradas — buscar pista a pista viraria
 * uma consulta por linha. As duas fontes já vêm em lote do banco.
 */
export async function loadSilhouetteMap(): Promise<SilhouetteMap> {
  const map: SilhouetteMap = new Map();
  try {
    const layoutsByTrack = await listAllLayoutsGrouped();
    for (const [trackId, layouts] of layoutsByTrack) {
      const preferred = layouts.find((l) => l.isDefault) ?? layouts[0];
      const shape = preferred && samplesToSilhouette(preferred.samples);
      if (shape) map.set(trackId, shape);
    }
    // A volta de referência é a mais representativa da pista — sobrepõe o layout.
    const references = await listTrackReferences();
    for (const ref of references) {
      const shape = samplesToSilhouette(ref.samples);
      if (shape) map.set(ref.trackId, shape);
    }
  } catch {
    // Banco indisponível — todo mundo cai na forma genérica.
  }
  return map;
}

/** Silhueta real quando existe, forma genérica quando não. */
export function silhouetteFor(map: SilhouetteMap | null, trackId: string): Silhouette {
  return map?.get(trackId) ?? placeholderSilhouette(trackId);
}

export function useSilhouetteMap(): SilhouetteMap | null {
  const [map, setMap] = useState<SilhouetteMap | null>(null);

  useEffect(() => {
    let alive = true;
    loadSilhouetteMap().then((m) => {
      if (alive) setMap(m);
    });
    return () => {
      alive = false;
    };
  }, []);

  return map;
}

type Props = {
  silhouette: Silhouette | null;
  size: number;
  color?: string;
  strokeWidth?: number;
  /** Ponto de largada/chegada — só existe em traçado gravado de verdade. */
  showStart?: boolean;
};

export function TrackShape({
  silhouette,
  size,
  color = colors.muted,
  strokeWidth = 2.4,
  showStart = false,
}: Props) {
  if (!silhouette) return null;

  return (
    <Svg width={size} height={size} viewBox={SILHOUETTE_VIEWBOX} fill="none">
      <Path
        d={silhouette.d}
        stroke={color}
        // Em unidades do viewBox: a espessura cresce junto com o tamanho, que
        // é o que dá o traço encorpado do traçado grande e o fio fino da lista.
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {showStart && silhouette.start && (
        <Circle cx={silhouette.start.x} cy={silhouette.start.y} r={2.2} fill={colors.blueSoft} />
      )}
    </Svg>
  );
}
