import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';

/**
 * Força landscape enquanto a tela está EM FOCO (não só montada).
 *
 * Usa useFocusEffect em vez de useEffect porque com expo-router as telas
 * ficam montadas na pilha — o useEffect de mount não re-dispara ao voltar
 * pra tela, então a trava "não pegava de primeira". Com foco, re-trava
 * sempre que a tela aparece.
 *
 * Ao sair, volta explicitamente pra PORTRAIT_UP (e não DEFAULT, que é
 * ambíguo e deixava o app preso na última orientação ao encerrar).
 *
 * As telas que usam isto também têm layout responsivo (portrait empilhado),
 * então mesmo no instante antes da rotação concluir elas aparecem usáveis —
 * nunca uma tela quebrada ou travada.
 */
export function useLockLandscape() {
  useFocusEffect(
    useCallback(() => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
      return () => {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      };
    }, []),
  );
}
