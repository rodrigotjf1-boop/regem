-- 364 — ENDEREÇO DEPOIS QUE O PEDIDO SAIU (PR 3b-2 do pedido alterado; decisão 8 aprovada pelo dono em 03/11/2026 —
-- protótipo `mockups/regem-alteracao-pedido.html`, vista "Painel da loja" › "endereço depois que saiu").
--
-- A equipe muda o endereço do pedido que já saiu pelo caso urgente de Atendimento; a alteração nasce marcada em
-- `pedido_alteracao.pedido` (`depoisQueSaiu: true` e o `chamadoId` do caso). Quando ela vale — na hora, ou depois que o
-- servidor da loja aplica a "pedida" e a decisão sobe pelo sincronismo —, a rotina da NUVEM manda ao cliente "Endereço
-- atualizado!" e grava `pedido.avisoAoCliente` (uma vez só: a troca é condicional).
--
-- Este índice PARCIAL guarda só as alterações "depois que saiu" já aplicadas que ainda esperam o aviso: a rotina roda a
-- cada 20 s para todas as lojas e lê por ele, sem varrer o histórico inteiro. A linha sai do índice quando ganha a marca
-- (também a que passou do prazo — a rotina marca sem mandar). A expressão do `where` é a MESMA da consulta da rotina
-- (`AtendimentoService.avisarEnderecosMudados`) — sem ela igual, o Postgres não usa o índice.
--
-- NÃO é @cloud-only: `pedido_alteracao` existe na nuvem e no servidor da loja (sobe e desce); o índice é inofensivo lá.
-- ⚠️ Aplicar na NUVEM ANTES do merge (V9). Idempotente; sem `drop`. Índice pequeno (só as que esperam o aviso).
set local lock_timeout = '5s';

create index if not exists idx_pedido_alteracao_aviso_do_endereco
  on pedido_alteracao (created_at)
  where situacao = 'aplicada'
    and (pedido ->> 'depoisQueSaiu') = 'true'
    and not (pedido ? 'avisoAoCliente');
