-- @cloud-only
-- 500 — Desfaz as 16 vendas em DOBRO de 02/08 a 09/09/2026 (ERR-582; decisão do dono, 23/11/2026). Continua a migration 497.
--
-- O mesmo defeito: o pedido de canal foi aceito pelos dois lados e a venda que nenhum pedido aponta sobrou, fechada, com o cartão
-- de produção e contando como venda de balcão. Medido na nuvem em 23/11: 16 sobras, R$ 746,00, de uma empresa, criadas até 1 minuto
-- da venda do pedido, com o mesmo cliente, os mesmos itens, preços e quantidades (em 2 delas o "TRIO 08" está em outro cadastro de
-- mesmo nome). 12 têm a entrada no caixa (R$ 587,50) e 4 nunca tiveram. Nenhuma tem nota, pagamento, TEF, baixa de estoque nem
-- entrada em sessão de caixa. A venda ligada ao pedido fica como está.
--
-- Com cada sobra, o mesmo da 497: estorna a entrada que houver (saída 'estorno', mesma forma, `estorno_de`, fora de sessão, id
-- tirado da entrada), cancela o cartão e a comanda, nas DATAS da venda, e registra na corrente da auditoria.
--
-- SÓ NUVEM: na loja tudo isto chega pela sincronização. Não apaga nada. Idempotente: na segunda vez não há sobra.
-- TRAVA: outro número de vendas, de entradas ou outra soma = critério diferente do que o dono aprovou, e nada é gravado.
set local lock_timeout = '5s';

do $$
declare
  c_qtd constant integer := 16;
  c_soma constant numeric := 746.00;
  c_entradas constant integer := 12;
  c_caixa constant numeric := 587.50;
  c_de constant timestamptz := timestamptz '2026-08-01 00:00:00-03';
  c_ate constant timestamptz := timestamptz '2026-09-09 06:00:00-03';
  c_motivo constant text := 'Venda em dobro: o pedido foi aceito pela nuvem e pelo servidor da loja (ERR-582). Desfeita pela migration 500.';
  c_estorno constant text := 'Estorno · venda em dobro (ERR-582, mig 500)';
  v_sobras uuid[];
  v_gemeas uuid[];
  v_pedidos uuid[];
  v_soma numeric;
  v_n integer;
  v_entradas integer;
  v_caixa numeric;
  r record;
  v_ult record;
  v_seq integer;
  v_prev text;
  v_det jsonb;
  v_canon text;
begin
  select coalesce(array_agg(x.sobra order by x.criada_em, x.sobra), '{}'),
         coalesce(array_agg(x.gemea order by x.criada_em, x.sobra), '{}'),
         coalesce(array_agg(x.pedido order by x.criada_em, x.sobra), '{}'),
         coalesce(sum(x.total), 0)
    into v_sobras, v_gemeas, v_pedidos, v_soma
    from (
      select distinct on (o.id) o.id as sobra, o.created_at as criada_em, o.total, pe.comanda_id as gemea, pe.id as pedido
        from pedido_externo pe
        join producao_pedido pp on pp.tenant_id = pe.tenant_id and pp.senha_plataforma = pe.display_id
         and pp.created_at between pe.criado_em - interval '5 minutes' and pe.criado_em + interval '3 hours'
         and pp.comanda_id <> pe.comanda_id
        join comanda o on o.id = pp.comanda_id and o.tenant_id = pe.tenant_id
        join comanda g on g.id = pe.comanda_id and g.tenant_id = pe.tenant_id
       where pe.criado_em >= c_de and pe.criado_em < c_ate
         and pe.display_id is not null
         and o.total = g.total
         and o.status = 'fechada' and o.cancelada_em is null
         and g.cancelada_em is null
         and coalesce(o.cliente, '') = coalesce(g.cliente, '')
         and abs(extract(epoch from (g.created_at - o.created_at))) < 120
         and not exists (select 1 from pedido_externo x where x.tenant_id = pe.tenant_id and x.comanda_id = o.id)
       order by o.id, pe.criado_em
    ) x;

  v_n := coalesce(array_length(v_sobras, 1), 0);
  if v_n = 0 then
    raise notice '500: nenhuma venda em dobro a desfazer.';
    return;
  end if;
  select count(*), coalesce(sum(l.valor), 0) into v_entradas, v_caixa
    from lancamento_caixa l
   where l.comanda_id = any(v_sobras) and l.tipo = 'entrada';
  if v_n <> c_qtd or v_soma <> c_soma or v_entradas <> c_entradas or v_caixa <> c_caixa then
    raise exception '500: % sobras (R$ %) e % entradas (R$ %) — diferente do aprovado; nada foi gravado.', v_n, v_soma, v_entradas, v_caixa;
  end if;
  if (select count(distinct g) from unnest(v_gemeas) g) <> v_n or (select count(distinct p) from unnest(v_pedidos) p) <> v_n then
    raise exception '500: uma venda ou um pedido aparece em mais de um par; nada foi gravado.';
  end if;
  if exists (select 1 from lancamento_caixa l where l.comanda_id = any(v_sobras) and (l.sessao_id is not null or l.tipo <> 'entrada'))
     or exists (select 1 from movimento_estoque m where m.ref_tipo = 'venda' and m.ref_id = any(v_sobras))
     or exists (select 1 from nota_fiscal n where n.comanda_id = any(v_sobras))
     or exists (select 1 from comanda_pagamento p where p.comanda_id = any(v_sobras))
     or exists (select 1 from pagamento_tef t where t.comanda_id = any(v_sobras)) then
    raise exception '500: uma sobra tem sessão de caixa, estorno, estoque, nota ou pagamento; nada foi gravado.';
  end if;

  -- 1) Estorno de cada entrada no caixa, com a data da venda.
  insert into lancamento_caixa (id, tenant_id, unidade_id, sessao_id, comanda_id, tipo, valor, data, categoria, forma,
                                estorno_de, descricao, criado_por_id)
  select md5('regem:500:estorno:' || l.id::text)::uuid, l.tenant_id, l.unidade_id, l.sessao_id, l.comanda_id,
         'saida', l.valor, l.data, 'estorno', l.forma, l.id, c_estorno, null
    from lancamento_caixa l
   where l.comanda_id = any(v_sobras)
     and l.tipo = 'entrada'
     and not exists (select 1 from lancamento_caixa e where e.estorno_de = l.id)
  on conflict (id) do nothing;

  -- 2) O cartão de produção da sobra.
  update producao_pedido
     set status = 'cancelado', cancelado_em = created_at, cancelado_por_id = null, obs = c_motivo
   where comanda_id = any(v_sobras)
     and status <> 'cancelado';

  -- 3) A comanda.
  update comanda
     set status = 'cancelada', cancelada_em = created_at, cancelada_por_id = null, motivo_cancelamento = c_motivo
   where id = any(v_sobras)
     and status = 'fechada';

  -- 4) Auditoria encadeada, uma linha por comanda (como o cancelamento do delivery).
  for r in
    select c.id, c.tenant_id, c.unidade_id, c.total, u.gemea_id, u.pedido_id
      from unnest(v_sobras, v_gemeas, v_pedidos) as u(sobra_id, gemea_id, pedido_id)
      join comanda c on c.id = u.sobra_id
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
      'migration', '500');
    -- Forma canônica do AuditoriaService (chaves em ordem; `at` entra porque o ator não é 'usuario').
    v_canon := '{"ac":' || to_json('desfez_venda_em_dobro'::text)::text
            || ',"ai":null'
            || ',"ap":' || to_json('servico'::text)::text
            || ',"at":' || to_json('distribuicao'::text)::text
            || ',"d":{"comandaGemeaId":' || to_json(r.gemea_id::text)::text
            ||       ',"migration":' || to_json('500'::text)::text
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

  raise notice '500: % vendas em dobro desfeitas (R$ %), % estornos (R$ %).', v_n, v_soma, v_entradas, v_caixa;
end
$$;

-- Conferência no MESMO Run: `ok` tem de vir true — as 16 canceladas, as 12 entradas estornadas, a soma certa e a auditoria ligada.
select (x.canceladas = 16 and x.valor_cancelado = 746.00 and x.estornos = 12 and x.valor_estornado = 587.50
        and x.auditadas = 16 and x.elos_quebrados = 0) as ok,
       x.*
  from (
    select
      (select count(*) from comanda
        where motivo_cancelamento = 'Venda em dobro: o pedido foi aceito pela nuvem e pelo servidor da loja (ERR-582). Desfeita pela migration 500.') as canceladas,
      (select coalesce(sum(total), 0) from comanda
        where motivo_cancelamento = 'Venda em dobro: o pedido foi aceito pela nuvem e pelo servidor da loja (ERR-582). Desfeita pela migration 500.') as valor_cancelado,
      (select count(*) from lancamento_caixa where descricao = 'Estorno · venda em dobro (ERR-582, mig 500)') as estornos,
      (select coalesce(sum(valor), 0) from lancamento_caixa where descricao = 'Estorno · venda em dobro (ERR-582, mig 500)') as valor_estornado,
      (select count(*) from audit_log where acao = 'desfez_venda_em_dobro' and detalhe->>'migration' = '500') as auditadas,
      (select count(*) from audit_log a
        where a.acao = 'desfez_venda_em_dobro' and a.detalhe->>'migration' = '500'
          and a.prev_hash is distinct from coalesce((select b.hash from audit_log b
                                                      where b.tenant_id = a.tenant_id and b.seq = a.seq - 1), '')) as elos_quebrados
  ) x;
