import { useCallback } from 'react';
import { InteractionManager } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';

/**
 * Força landscape nas telas de cockpit (celular no suporte, deitado).
 *
 * PONTO CRÍTICO: trava só DEPOIS da transição de navegação terminar, via
 * InteractionManager.runAfterInteractions. Travar a orientação NO MEIO da
 * animação de push cancela a transição — a tela "abre e volta sozinha" e,
 * quando enfim entra, já perdeu o momento da rotação e fica em pé. Esperando
 * a transição assentar, a tela entra inteira e só então gira pra landscape.
 *
 * useFocusEffect (não useEffect) porque as telas ficam montadas na pilha com
 * expo-router — precisa re-travar a cada foco, não só no mount.
 *
 * Ao sair, volta pra PORTRAIT_UP explícito (DEFAULT é ambíguo e prendia o app
 * na última orientação).
 */
export function useLockLandscape() {
  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
      });
      return () => {
        task.cancel();
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      };
    }, []),
  );
}
