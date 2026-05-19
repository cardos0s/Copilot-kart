import { useEffect } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';

/**
 * Trava o device em landscape enquanto a tela está montada.
 * Restaura a orientação padrão (default — segue o sensor) quando desmonta.
 *
 * Uso típico: telas de gravação ao vivo e análise de mapa, onde o piloto
 * deixa o celular no cockpit em horizontal.
 */
export function useLockLandscape() {
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {
      // silencia — alguns devices podem não permitir
    });
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT).catch(() => {});
    };
  }, []);
}
