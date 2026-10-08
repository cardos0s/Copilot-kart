# Conta e backup Context

**Gathered:** 2026-10-08
**Spec:** `.specs/features/conta-e-backup/spec.md`
**Status:** Aguardando aprovação da spec

---

## Feature Boundary

Conta opcional (Apple e e-mail) que guarda na nuvem, com dono por `auth.uid()`, tudo o que o piloto
gravou, inclusive o bruto em blocos (AD-007). Restaura num aparelho novo, junta os dados locais no
primeiro login, sai com escolha sobre os dados do aparelho e exclui conta e backup dentro do app. O
ao vivo, o ranking e a corrida por código ficam para a `nuvem-segura`.

---

## Implementation Decisions

Respostas da Julia em 08/10. Ela aprovou de uma vez as oito recomendações ("pode seguir"):

1. **Modelo:** backup contínuo com restauração, sem edição simultânea em vários aparelhos.
2. **Envio:** automático depois de salvar e ao abrir o app, com botão "Fazer backup agora" e
   interruptor para desligar. O bruto só vai pelo Wi-Fi, a menos que o piloto libere os dados
   móveis.
3. **Bruto:** vai inteiro para a nuvem. **Fica pendente** o plano do Supabase e a cota de
   armazenamento, que a Julia confirma antes de aplicar no projeto real.
4. **Primeiro login:** junta tudo depois de uma tela de aviso. Os dois lados se somam pelo id, e na
   gamificação vale o maior valor.
5. **Sair:** pergunta se mantém ou apaga os dados do aparelho. O cartão "Conta" vira um só.
6. **Excluir conta:** apaga conta, backup e foto, revoga a Apple e pergunta sobre os dados do
   aparelho.
7. **Fica de fora:** a chave da IA, o `device_id` e o diário em andamento. As conversas do coach
   entram.
8. **Login:** Apple e e-mail, com o fluxo de e-mail corrigido e o token no SecureStore. Sem Google.

### Agent's Discretion

Padrões meus, na tabela de Assumptions da spec, marcados `n` até a aprovação:
- excluir a sessão também na nuvem;
- "Esqueci a senha";
- ordem da restauração (dados pequenos primeiro, bruto em segundo plano ou ao abrir a sessão);
- "na nuvem" só com tudo confirmado;
- retomada do envio sem duplicata;
- aviso antes de apagar dado ainda pendente.

---

## Specific References

- `fix/live-perf` (`3dea91b`, `src/lib/sessionSync.ts`): o backup anônimo não é reaproveitado.
  Ficam duas ideias: o upsert idempotente pelo id local e o interruptor para desligar.
- O levantamento da loja, §3 (Dados e nuvem) e §5 (L2, exclusão de conta).

---

## Deferred Ideas

- Login com Google no Android.
- Exportar a sessão em arquivo.
