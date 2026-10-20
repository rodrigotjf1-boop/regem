-- @cloud-only
-- 328 — Desfaz as vendas em DOBRO dos pedidos de canal aceitos pelos dois lados (ERR-251; decisão do dono, 20/10/2026).
--
-- De 07/10 a 20/10, com o servidor da loja ligado, a nuvem também aceitava o pedido da Anota Aí e do iFood (corrigido
-- no #684). Quando os dois aceitavam, cada lado criava a sua venda: o pedido ficou ligado a uma das comandas (a última
-- gravação vence) e a outra sobrou — fechada, com a entrada no caixa e o pedido de produção, contando como venda de
-- balcão. Medido na nuvem em 20/10: 178 sobras, R$ 8.365,96 (175 da Anota Aí e 3 do iFood), todas de uma loja; nenhuma
-- com nota fiscal, baixa de estoque, sessão de caixa ou estorno. O dono escolheu desfazer todas.
--
-- O que é uma sobra: comanda de delivery (senha D) FECHADA, criada de 01 a 20/10, que nenhum pedido aponta e que tem
-- EXATAMENTE uma gêmea apontada por um pedido da Anota Aí ou do iFood — mesma empresa, senha D, mesmo total, mesmo
-- cliente, criada até 10 minutos antes ou depois. A gêmea fica como está: é a venda do pedido.
--
-- Com cada sobra, o mesmo que o cancelamento do delivery faz (`vendas.estornarVendaExterna`):
--  1. estorna cada entrada no caixa: saída 'estorno' na mesma forma, `estorno_de` = a entrada, fora de sessão como a
--     original. A DATA é a da venda, não a de hoje: a venda nunca existiu, e o relatório de cada dia fica certo. O id
--     sai da entrada (md5), então rodar de novo não repete o estorno;
--  2. cancela o pedido de produção que ainda não está cancelado (situação, data e motivo);
--  3. cancela a comanda (situação, data e motivo);
--  4. registra na auditoria, encadeado como o `AuditoriaService` faz (trava por empresa, seq, prev_hash, sha256 da
--     forma canônica com as chaves em ordem).
-- Estoque, cupom, cashback e pontos: nada a desfazer — a baixa do delivery é na conclusão, por pedido, e os benefícios
-- são do pedido, que segue ligado à gêmea.
--
-- SÓ NUVEM: na loja tudo isto chega pela sincronização (comanda e produção por `updated_at`, que o gatilho renova; o
-- estorno por `created_at`, que nasce agora). Idempotente: na segunda vez não há sobra fechada. Não apaga nada.
-- Trava: mais de 200 sobras = critério errado — a migration para sem gravar nada.
set local lock_timeout = '5s';

do $$
declare
  c_motivo constant text := 'Venda em dobro: o pedido foi aceito pela nuvem e pelo servidor da loja (ERR-251). Desfeita pela migration 328.';
  c_estorno constant text := 'Estorno · venda em dobro (ERR-251)';
  v_ids uuid[];
  v_n integer;
  r record;
  v_ult record;
  v_seq integer;
  v_prev text;
  v_det jsonb;
  v_canon text;
begin
  select coalesce(array_agg(c.id order by c.tenant_id, c.created_at, c.id), '{}')
    into v_ids
    from comanda c
   where c.senha_prefixo = 'D'
     and c.status = 'fechada'
     and c.created_at >= timestamptz '2026-10-01 00:00:00-03'
     and c.created_at < timestamptz '2026-10-21 00:00:00-03'
     and not exists (select 1 from pedido_externo p where p.comanda_id = c.id)
     and (select count(*)
            from comanda g
            join pedido_externo p on p.comanda_id = g.id
           where g.tenant_id = c.tenant_id
             and g.id <> c.id
             and g.senha_prefixo = 'D'
             and g.total = c.total
             and coalesce(g.cliente, '') = coalesce(c.cliente, '')
             and abs(extract(epoch from (g.created_at - c.created_at))) < 600
             and p.canal in ('anotaai', 'ifood')
             and p.deleted_at is null) = 1;

  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n > 200 then
    raise exception '328: % sobras — mais do que as 178 medidas; nada foi gravado. Conferir o critério.', v_n;
  end if;
  if v_n = 0 then
    raise notice '328: nenhuma venda em dobro a desfazer.';
    return;
  end if;

  -- 1) Estorno de cada entrada no caixa, com a data da venda.
  insert into lancamento_caixa (id, tenant_id, unidade_id, sessao_id, comanda_id, tipo, valor, data, categoria, forma,
                                estorno_de, descricao, criado_por_id)
  select md5('regem:328:estorno:' || l.id::text)::uuid, l.tenant_id, l.unidade_id, l.sessao_id, l.comanda_id,
         'saida', l.valor, l.data, 'estorno', l.forma, l.id, c_estorno, null
    from lancamento_caixa l
   where l.comanda_id = any(v_ids)
     and l.tipo = 'entrada'
     and not exists (select 1 from lancamento_caixa e where e.estorno_de = l.id)
  on conflict (id) do nothing;

  -- 2) Produção da sobra sai da fila.
  update producao_pedido
     set status = 'cancelado', cancelado_em = now(), cancelado_por_id = null, obs = c_motivo
   where comanda_id = any(v_ids)
     and status <> 'cancelado';

  -- 3) A comanda.
  update comanda
     set status = 'cancelada', cancelada_em = now(), cancelada_por_id = null, motivo_cancelamento = c_motivo
   where id = any(v_ids)
     and status = 'fechada';

  -- 4) Auditoria encadeada, uma linha por comanda (como o cancelamento do delivery).
  for r in
    select c.id, c.tenant_id, c.unidade_id, c.total,
           (select g.id from comanda g join pedido_externo p on p.comanda_id = g.id
             where g.tenant_id = c.tenant_id and g.id <> c.id and g.senha_prefixo = 'D' and g.total = c.total
               and coalesce(g.cliente, '') = coalesce(c.cliente, '')
               and abs(extract(epoch from (g.created_at - c.created_at))) < 600
               and p.canal in ('anotaai', 'ifood') and p.deleted_at is null) as gemea_id,
           (select p.id from comanda g join pedido_externo p on p.comanda_id = g.id
             where g.tenant_id = c.tenant_id and g.id <> c.id and g.senha_prefixo = 'D' and g.total = c.total
               and coalesce(g.cliente, '') = coalesce(c.cliente, '')
               and abs(extract(epoch from (g.created_at - c.created_at))) < 600
               and p.canal in ('anotaai', 'ifood') and p.deleted_at is null) as pedido_id
      from comanda c
     where c.id = any(v_ids)
     order by c.tenant_id, c.created_at, c.id
  loop
    perform pg_advisory_xact_lock(hashtext(r.tenant_id::text), 0);
    select a.seq, a.hash into v_ult
      from audit_log a
     where a.tenant_id = r.tenant_id and a.seq is not null
     order by a.seq desc
     limit 1;
    v_seq := coalesce(v_ult.seq, 0) + 1;
    v_prev := coalesce(v_ult.hash, '');
    v_det := jsonb_build_object(
      'motivo', c_motivo,
      'comandaGemeaId', r.gemea_id::text,
      'pedidoExternoId', r.pedido_id::text,
      'valor', r.total::text,
      'migration', '328');
    -- Forma canônica do AuditoriaService (chaves em ordem; `at` entra porque o ator não é 'usuario').
    v_canon := '{"ac":' || to_json('desfez_venda_em_dobro'::text)::text
            || ',"ai":null'
            || ',"ap":' || to_json('servico'::text)::text
            || ',"at":' || to_json('distribuicao'::text)::text
            || ',"d":{"comandaGemeaId":' || to_json(r.gemea_id::text)::text
            ||       ',"migration":' || to_json('328'::text)::text
            ||       ',"motivo":' || to_json(c_motivo)::text
            ||       ',"pedidoExternoId":' || to_json(r.pedido_id::text)::text
            ||       ',"valor":' || to_json(r.total::text)::text || '}'
            || ',"ei":' || to_json(r.id::text)::text
            || ',"et":' || to_json('comanda'::text)::text
            || ',"o":' || to_json('migracao'::text)::text
            || ',"s":' || v_seq::text
            || ',"t":' || to_json(r.tenant_id::text)::text
            || ',"ti":' || to_json('venda'::text)::text
            || ',"u":' || coalesce(to_json(r.unidade_id::text)::text, 'null')
            || '}';
    insert into audit_log (tenant_id, unidade_id, actor_tipo, actor_id, actor_perfil, tipo, acao, entidade_tipo,
                           entidade_id, detalhe, origem, seq, prev_hash, hash)
    values (r.tenant_id, r.unidade_id, 'distribuicao', null, 'servico', 'venda', 'desfez_venda_em_dobro', 'comanda',
            r.id, v_det, 'migracao', v_seq, v_prev,
            encode(sha256(convert_to(v_prev || '|' || v_canon, 'UTF8')), 'hex'));
  end loop;

  raise notice '328: % vendas em dobro desfeitas.', v_n;
end
$$;

-- Conferência no MESMO Run: `ok` tem de vir true — nenhuma sobra fechada no período, e o mesmo número de comandas
-- canceladas, estornos e linhas de auditoria, com a corrente da auditoria ligada.
select (x.sobras_fechadas = 0 and x.canceladas = x.estornos and x.estornos = x.auditadas and x.elos_quebrados = 0) as ok,
       x.*
  from (
    select
      (select count(*) from comanda c
        where c.senha_prefixo = 'D' and c.status = 'fechada'
          and c.created_at >= timestamptz '2026-10-01 00:00:00-03'
          and c.created_at < timestamptz '2026-10-21 00:00:00-03'
          and not exists (select 1 from pedido_externo p where p.comanda_id = c.id)) as sobras_fechadas,
      (select count(*) from comanda
        where motivo_cancelamento = 'Venda em dobro: o pedido foi aceito pela nuvem e pelo servidor da loja (ERR-251). Desfeita pela migration 328.') as canceladas,
      (select count(*) from lancamento_caixa where descricao = 'Estorno · venda em dobro (ERR-251)') as estornos,
      (select coalesce(sum(valor), 0) from lancamento_caixa where descricao = 'Estorno · venda em dobro (ERR-251)') as valor_estornado,
      (select count(*) from audit_log where acao = 'desfez_venda_em_dobro') as auditadas,
      (select count(*) from audit_log a
        where a.acao = 'desfez_venda_em_dobro'
          and a.prev_hash is distinct from coalesce((select b.hash from audit_log b
                                                      where b.tenant_id = a.tenant_id and b.seq = a.seq - 1), '')) as elos_quebrados
  ) x;
