/**
 * Saída da gravação só com confirmação. O botão voltar do Android e o botão
 * de cancelar disparam `requestExit`; a tela mostra `EXIT_OPTIONS` num
 * diálogo e executa o efeito devolvido. Redutor puro.
 */

export type ExitState = 'recording' | 'confirming';
export type ExitAction = 'requestExit' | 'continue' | 'finish' | 'discard';
/** `finish` é o mesmo caminho do botão "Encerrar"; `discard` para o GPS e apaga o diário. */
export type ExitEffect = 'none' | 'finish' | 'discard';

export type ExitOption = {
  action: Exclude<ExitAction, 'requestExit'>;
  label: string;
  variant: 'primary' | 'secondary' | 'destructive';
};

export const EXIT_OPTIONS: readonly ExitOption[] = [
  { action: 'continue', label: 'Continuar gravando', variant: 'primary' },
  { action: 'finish', label: 'Encerrar e salvar', variant: 'secondary' },
  { action: 'discard', label: 'Descartar', variant: 'destructive' },
];

export function exitGuard(
  state: ExitState,
  action: ExitAction
): { state: ExitState; effect: ExitEffect } {
  if (action === 'requestExit') return { state: 'confirming', effect: 'none' };
  if (state !== 'confirming') return { state, effect: 'none' };
  if (action === 'continue') return { state: 'recording', effect: 'none' };
  return { state: 'recording', effect: action };
}
