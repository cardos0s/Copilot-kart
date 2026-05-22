import Svg, { Path, Circle } from 'react-native-svg';
import { colors } from '../../theme';

export type IconName =
  | 'home'
  | 'list'
  | 'bolt'
  | 'person'
  | 'chart'
  | 'map'
  | 'plus'
  | 'play'
  | 'stop'
  | 'bell'
  | 'gear'
  | 'menu'
  | 'more-h'
  | 'chevron-right'
  | 'edit'
  | 'check'
  | 'cloud-sync'
  | 'arrow-right'
  | 'trash';

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
};

/**
 * Ícone SVG inline. Stroke-based, segue o estilo line-icons do mock.
 * Adicionar novos casos abaixo conforme necessário — todos com viewBox 24x24.
 */
export function Icon({ name, size = 22, color = colors.textPrimary, strokeWidth = 2 }: Props) {
  const sp = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {paths(name, sp, color)}
    </Svg>
  );
}

function paths(name: IconName, sp: any, color: string) {
  switch (name) {
    case 'home':
      return <Path {...sp} d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-9z" />;
    case 'list':
      return (
        <>
          <Path {...sp} d="M8 6h13M8 12h13M8 18h13" />
          <Circle cx={3.5} cy={6} r={1.2} fill={color} stroke="none" />
          <Circle cx={3.5} cy={12} r={1.2} fill={color} stroke="none" />
          <Circle cx={3.5} cy={18} r={1.2} fill={color} stroke="none" />
        </>
      );
    case 'bolt':
      return <Path {...sp} d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill={color} />;
    case 'person':
      return (
        <>
          <Circle {...sp} cx={12} cy={8} r={4} />
          <Path {...sp} d="M4 21c0-4 4-7 8-7s8 3 8 7" />
        </>
      );
    case 'chart':
      return <Path {...sp} d="M3 21h18M6 17v-6M11 17V7M16 17v-9M21 17V4" />;
    case 'map':
      return (
        <>
          <Path
            {...sp}
            d="M9 3L3 5v16l6-2 6 2 6-2V3l-6 2-6-2z"
          />
          <Path {...sp} d="M9 3v16M15 5v16" />
        </>
      );
    case 'plus':
      return <Path {...sp} d="M12 5v14M5 12h14" />;
    case 'play':
      return <Path {...sp} d="M6 4l14 8-14 8V4z" fill={color} />;
    case 'stop':
      return <Path {...sp} d="M6 6h12v12H6z" fill={color} />;
    case 'bell':
      return (
        <>
          <Path
            {...sp}
            d="M18 16v-5a6 6 0 10-12 0v5l-2 2v1h16v-1l-2-2z"
          />
          <Path {...sp} d="M10 21a2 2 0 004 0" />
        </>
      );
    case 'gear':
      return (
        <>
          <Circle {...sp} cx={12} cy={12} r={3} />
          <Path
            {...sp}
            d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"
          />
        </>
      );
    case 'menu':
      return <Path {...sp} d="M4 6h16M4 12h16M4 18h16" />;
    case 'more-h':
      return (
        <>
          <Circle cx={5} cy={12} r={1.5} fill={color} />
          <Circle cx={12} cy={12} r={1.5} fill={color} />
          <Circle cx={19} cy={12} r={1.5} fill={color} />
        </>
      );
    case 'chevron-right':
      return <Path {...sp} d="M9 6l6 6-6 6" />;
    case 'edit':
      return (
        <>
          <Path
            {...sp}
            d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"
          />
          <Path {...sp} d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" />
        </>
      );
    case 'check':
      return <Path {...sp} d="M5 12l5 5L20 7" />;
    case 'cloud-sync':
      return (
        <>
          <Path {...sp} d="M18 10a6 6 0 00-11.8-1.5A4.5 4.5 0 007 17h11a4 4 0 000-8z" />
          <Path {...sp} d="M9 14l3-3 3 3M12 11v6" />
        </>
      );
    case 'arrow-right':
      return <Path {...sp} d="M5 12h14M13 5l7 7-7 7" />;
    case 'trash':
      // Lixeira clássica — tampa + corpo + 2 linhas internas. Stroke-based
      // pra combinar com o resto. viewBox 24x24.
      return (
        <>
          <Path {...sp} d="M3 6h18" />
          <Path {...sp} d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          <Path {...sp} d="M19 6l-1.5 14a2 2 0 01-2 1.8H8.5a2 2 0 01-2-1.8L5 6" />
          <Path {...sp} d="M10 11v6M14 11v6" />
        </>
      );
    default:
      return null;
  }
}
