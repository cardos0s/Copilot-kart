import { IndoorHome } from '../src/components/IndoorHome';

// Ranking ao vivo do kartódromo (mesmo componente da home Indoor), acessível
// pelo card "RANKING" na home do piloto. Volta com swipe (iOS) ou pelo back.
export default function Ranking() {
  return <IndoorHome showBack />;
}
