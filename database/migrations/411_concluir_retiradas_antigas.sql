-- @cloud-only
-- 411 — Conclui as retiradas ANTIGAS paradas no balcão da loja "Rodrigo de oliveira" (pedido do dono, 11/11/2026: "aceitar e
-- receber todos os pedidos de retirada que estão no balcão › retiradas, exceto os de hoje"; achado da auditoria do KDS).
--
-- Até o #903 (11/11), a retirada que a Anota Aí finalizava nunca concluía no Regem: o pedido parava em "pronto" e ficava
-- para sempre em PDV · Balcão › Retirada. Medido na nuvem em 11/11, ~23h30, nesta empresa, criados até 10/11: 350 pedidos,
-- todos "pronto" e com a venda já FECHADA — 110 pagos online (R$ 4.608,39), 1 pago no totem, e 239 "a pagar na retirada"
-- (155 em dinheiro, 84 em cartão — R$ 10.607,45), cobrados no balcão na época mas nunca lançados no Regem.
--
-- Decisões do dono (11/11, as três recomendadas): (1) só esta empresa — a "Vikings Delivery" fica como está; (2) os "a pagar"
-- ficam RECEBIDOS FORA DO CAIXA — pago, na forma do pedido; nada entra no caixa de hoje nem em caixa antigo (o lançamento da
-- venda já existe, com a forma e a data da venda, fora de sessão); (3) o estoque NÃO baixa — os produtos saíram semanas
-- atrás e a contagem já acerta o saldo.
--
-- Por isso NÃO é o "Entregar" da tela repetido: ele concluiria com a data de hoje, poria o dinheiro no caixa aberto agora,
-- baixaria o estoque e avisaria cada canal de novo. Aqui, com cada pedido:
--  1. status 'concluido'; concluído e entregue no momento em que ficou pronto (ou aceito, ou criado) — o dia do pedido,
--     não hoje; pago e com o pagamento aprovado; o pago online fica marcado como tal (como o "Entregar" faz);
--  2. registra na auditoria, encadeado como o `AuditoriaService` faz (trava por empresa, seq, prev_hash, sha256 da forma
--     canônica com as chaves em ordem).
-- Sem caixa, sem estoque, sem aviso a canal ou cliente (nada disso sai de um UPDATE). O gatilho da mig 330 fecha o cartão do
-- KDS que ainda estiver aberto (como em toda conclusão); o da integração só anota "mudou" para quem lê a porta.
--
-- SÓ NUVEM: na loja (servidor ligado) a mudança desce pela sincronização — o gatilho renova o `updated_at` e a cópia de lá,
-- mais velha, perde. Idempotente: na segunda vez não sobra pedido no critério. Não apaga nada.
-- Trava: mais de 360 pedidos = critério errado — a migration para sem gravar nada.
set local lock_timeout = '5s';

do $$
declare
  c_empresa constant uuid := '4b324104-f283-4685-96c0-add58e362391';
  c_ate constant timestamptz := timestamptz '2026-11-11 00:00:00-03';
  c_motivo constant text := 'Retirada antiga parada no balcão: concluída e recebida fora do caixa, sem baixar estoque (pedido do dono, migration 411).';
  v_n integer;
  r record;
  v_ult record;
  v_seq integer;
  v_prev text;
  v_det jsonb;
  v_canon text;
begin
  create temporary table t411 on commit drop as
    select p.id, p.tenant_id, p.unidade_id, p.total, p.forma_pagamento,
           (p.pago is true or p.status_pagamento = 'aprovado') as pago_antes
      from pedido_externo p
     where p.tenant_id = c_empresa
       and (p.tipo = 'retirada' or p.agendamento is not null)
       and p.status in ('novo', 'confirmado', 'pronto', 'despachado', 'entregue')
       and p.criado_em < c_ate
       and p.comanda_id is not null
       and p.deleted_at is null;

  select count(*) into v_n from t411;
  if v_n > 360 then
    raise exception '411: % retiradas — mais do que as 350 medidas; nada foi gravado. Conferir o critério.', v_n;
  end if;
  if v_n = 0 then
    raise notice '411: nenhuma retirada antiga a concluir.';
    return;
  end if;

  -- 1) O pedido: concluído no dia dele, pago.
  update pedido_externo p
     set status = 'concluido',
         concluido_em = coalesce(p.pronto_em, p.confirmado_em, p.criado_em),
         entregue_em = coalesce(p.entregue_em, p.pronto_em, p.confirmado_em, p.criado_em),
         pago_online = case when t.pago_antes then true else p.pago_online end,
         pago = true,
         status_pagamento = 'aprovado'
    from t411 t
   where p.id = t.id
     and p.status in ('novo', 'confirmado', 'pronto', 'despachado', 'entregue');

  -- 2) Auditoria encadeada, uma linha por pedido.
  for r in select * from t411 order by tenant_id, id loop
    perform pg_advisory_xact_lock(hashtext(r.tenant_id::text), 0);
    select a.seq, a.hash into v_ult
      from audit_log a
     where a.tenant_id = r.tenant_id and a.seq is not null
     order by a.seq desc
     limit 1;
    v_seq := coalesce(v_ult.seq, 0) + 1;
    v_prev := coalesce(v_ult.hash, '');
    v_det := jsonb_build_object(
      'forma', coalesce(r.forma_pagamento, ''),
      'migration', '411',
      'motivo', c_motivo,
      'pagoAntes', r.pago_antes,
      'valor', coalesce(r.total, 0)::text);
    -- Forma canônica do AuditoriaService (chaves em ordem; `at` entra porque o ator não é 'usuario').
    v_canon := '{"ac":' || to_json('concluiu_retirada_antiga'::text)::text
            || ',"ai":null'
            || ',"ap":' || to_json('servico'::text)::text
            || ',"at":' || to_json('distribuicao'::text)::text
            || ',"d":{"forma":' || to_json(coalesce(r.forma_pagamento, ''))::text
            ||       ',"migration":' || to_json('411'::text)::text
            ||       ',"motivo":' || to_json(c_motivo)::text
            ||       ',"pagoAntes":' || to_json(r.pago_antes)::text
            ||       ',"valor":' || to_json(coalesce(r.total, 0)::text)::text || '}'
            || ',"ei":' || to_json(r.id::text)::text
            || ',"et":' || to_json('pedido_externo'::text)::text
            || ',"o":' || to_json('migracao'::text)::text
            || ',"s":' || v_seq::text
            || ',"t":' || to_json(r.tenant_id::text)::text
            || ',"ti":' || to_json('delivery'::text)::text
            || ',"u":' || coalesce(to_json(r.unidade_id::text)::text, 'null')
            || '}';
    insert into audit_log (tenant_id, unidade_id, actor_tipo, actor_id, actor_perfil, tipo, acao, entidade_tipo,
                           entidade_id, detalhe, origem, seq, prev_hash, hash)
    values (r.tenant_id, r.unidade_id, 'distribuicao', null, 'servico', 'delivery', 'concluiu_retirada_antiga',
            'pedido_externo', r.id, v_det, 'migracao', v_seq, v_prev,
            encode(sha256(convert_to(v_prev || '|' || v_canon, 'UTF8')), 'hex'));
  end loop;

  raise notice '411: % retiradas antigas concluídas.', v_n;
end
$$;

-- Conferência no MESMO Run: `ok` tem de vir true — nenhuma retirada antiga aberta nesta empresa, uma linha de auditoria por
-- pedido concluído aqui, a corrente da auditoria ligada, e nenhum dos "a pagar" num caixa.
select (x.antigas_abertas = 0 and x.concluidas = x.auditadas and x.elos_quebrados = 0 and x.em_caixa = 0) as ok,
       x.*
  from (
    select
      (select count(*) from pedido_externo p
        where p.tenant_id = '4b324104-f283-4685-96c0-add58e362391'
          and (p.tipo = 'retirada' or p.agendamento is not null)
          and p.status in ('novo', 'confirmado', 'pronto', 'despachado', 'entregue')
          and p.criado_em < timestamptz '2026-11-11 00:00:00-03'
          and p.comanda_id is not null and p.deleted_at is null) as antigas_abertas,
      (select count(*) from audit_log where acao = 'concluiu_retirada_antiga') as auditadas,
      (select count(*) from pedido_externo p
        where p.id in (select entidade_id from audit_log where acao = 'concluiu_retirada_antiga')
          and p.status = 'concluido' and p.pago) as concluidas,
      (select coalesce(sum((detalhe->>'valor')::numeric), 0) from audit_log
        where acao = 'concluiu_retirada_antiga' and not (detalhe->>'pagoAntes')::boolean) as recebido_fora_do_caixa,
      (select count(*) from pedido_externo p
        where p.id in (select entidade_id from audit_log
                        where acao = 'concluiu_retirada_antiga' and not (detalhe->>'pagoAntes')::boolean)
          and p.caixa_sessao_id is not null) as em_caixa,
      (select count(*) from audit_log a
        where a.acao = 'concluiu_retirada_antiga'
          and a.prev_hash is distinct from coalesce((select b.hash from audit_log b
                                                      where b.tenant_id = a.tenant_id and b.seq = a.seq - 1), '')) as elos_quebrados
  ) x;
