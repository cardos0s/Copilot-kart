/**
 * Memoiza a promise de uma inicialização assíncrona.
 *
 * Chamadas simultâneas recebem a mesma promise, então ninguém vê o resultado
 * antes do `init` terminar. Se o `init` rejeita, a memória é esquecida e a
 * chamada seguinte tenta de novo, em vez de ficar presa na promise rejeitada.
 */
export function once<T>(init: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      pending = init().catch((err) => {
        pending = null;
        throw err;
      });
    }
    return pending;
  };
}
