-- 218 — Índices para as queries quentes do sync e dos processadores (edge + nuvem).
-- Idempotente (create index if not exists). NÃO é @cloud-only: pedido_externo e comanda
-- existem nos dois lados; impressao_job é LOCAL do edge → guardada por existência.
--
-- Contexto: com o pull keyset por tabela, o edge passa a puxar delta com filtros por
-- (cursor, id) e os processadores varrem pedido_externo/comanda a cada ciclo (15s/12s).
-- Estes índices tiram essas varreduras do seq scan.

-- Pedidos ONLINE aguardando materialização local (EdgePedidosProcessor e, na nuvem, o
-- CloudFallbackProcessor). Parcial: só as linhas quentes (novo, sem comanda).
create index if not exists ix_pedido_externo_novo_sem_comanda
  on pedido_externo (criado_em)
  where status = 'novo' and comanda_id is null;

-- Reconciliação (pedido materializado na nuvem, comanda_id preenchido) + varredura por
-- recência do processador de observabilidade.
create index if not exists ix_pedido_externo_com_comanda
  on pedido_externo (criado_em)
  where comanda_id is not null;

-- Comanda por status (o edge materializa a impressão das 'fechada'; o painel filtra por
-- status). Cobre tenant + status, o par mais consultado.
create index if not exists ix_comanda_tenant_status
  on comanda (tenant_id, status);

-- impressao_job é tabela LOCAL do edge (não sincroniza) — cria o índice SÓ onde a tabela
-- existe, então roda no edge e é no-op silencioso na nuvem (sem @cloud-only, que pularia
-- no edge — exatamente o lado onde precisamos do índice).
do $$
begin
  if to_regclass('public.impressao_job') is not null then
    create index if not exists ix_impressao_job_pendente
      on impressao_job (criado_em)
      where status = 'pendente';
  end if;
end $$;
