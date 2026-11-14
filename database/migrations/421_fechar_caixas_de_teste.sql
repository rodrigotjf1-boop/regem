-- @cloud-only
-- 421 — Fecha, ZERADOS, os 4 caixas de TESTE abertos há meses (pedido do dono, 14/11/2026: "os locais se puder fechar,
-- feche zerado"). Achados pelo aviso "caixa aberto há mais de 24 horas" do Mister (#969, ligado em 14/11).
--
-- Os 6 caixas abertos há mais de 24 h na nuvem, medidos em 14/11 por volta das 11h (Brasília):
--   • 4 de TESTE, os desta migration. Nenhum aparelho em uso consegue fechá-los: dois têm o terminal apagado, um é do
--     "Caixa nuvem" (parado desde 04/09) e um é o do delivery de uma empresa de teste. Saldos: R$ 0,00, R$ 32,50, R$ 33,00
--     e R$ 36,00; o último lançamento é de 03/09.
--   • 2 que NÃO entram:
--     – o PDV1 da loja, aberto em 02/08, com 69 recebimentos de 30/09 a 29/10 (R$ 3.653,49);
--     – o caixa do delivery aberto em 13/11, com 14 recebimentos em dinheiro de 13/11 19h52 a 14/11 0h12 (R$ 646,50).
--     Os dois estão em uso e têm dinheiro de verdade: fecham na tela, contando a gaveta.
--
-- "Zerado" = o fechamento sem contagem que o PDV manda (`valoresInformados` vazio). Fica assim:
--   • informado 0 em cada forma;
--   • esperado e diferença por forma calculados como `FinanceiroService.fecharSessao` calcula: lançamentos (entrada menos
--     saída) agrupados por forma, com a abertura somada ao dinheiro;
--   • as colunas antigas guardam só o dinheiro;
--   • nenhuma ocorrência de diferença é aberta (é teste).
-- A auditoria é encadeada como na 411. O aviso do Mister se resolve sozinho na volta seguinte e manda "✅ Resolvido".
--
-- SÓ NUVEM: na loja com servidor, o caixa fechado desce pela sincronização (`caixa_sessao` vai nos dois sentidos). O
-- gatilho renova o `updated_at`, e a cópia da loja, mais velha, perde.
-- Idempotente: na segunda vez não sobra caixa aberto no critério. Não apaga nada.
set local lock_timeout = '5s';

do $$
declare
  c_ids constant uuid[] := array[
    '9340f8da-a7b0-440d-83f9-8371515a5439',
    '88160453-144f-4da3-befa-228d122a7db5',
    '4430f63a-39de-46b1-ae89-0395db6e3b67',
    '9055b7de-891e-4898-89f5-48ed4552ef56'
  ]::uuid[];
  c_motivo constant text := 'Caixa de teste aberto há meses: fechado zerado a pedido do dono (migration 421).';
  v_n integer;
  r record;
  v_ult record;
  v_seq integer;
  v_prev text;
  v_det jsonb;
  v_canon text;
begin
  create temporary table t421 on commit drop as
    select s.id, s.tenant_id, s.unidade_id, coalesce(s.valor_abertura, 0) as valor_abertura
      from caixa_sessao s
     where s.id = any(c_ids)
       and s.status = 'aberta';

  select count(*) into v_n from t421;
  if v_n = 0 then
    raise notice '421: nenhum caixa de teste aberto a fechar.';
    return;
  end if;

  -- O esperado por forma, como o fechamento da tela: entrada menos saída por forma; a abertura entra no dinheiro (a chave
  -- "dinheiro" sempre existe, mesmo zerada).
  create temporary table t421_forma on commit drop as
    select x.id, x.forma, sum(x.mov) as mov
      from (
        select l.sessao_id as id, coalesce(l.forma, 'dinheiro') as forma,
               case when l.tipo = 'entrada' then l.valor else -l.valor end as mov
          from lancamento_caixa l
          join t421 t on t.id = l.sessao_id
        union all
        select t.id, 'dinheiro', t.valor_abertura from t421 t
      ) x
     group by x.id, x.forma;

  create temporary table t421_fecha on commit drop as
    select f.id,
           coalesce(sum(f.mov) filter (where f.forma = 'dinheiro'), 0) as dinheiro,
           sum(f.mov) as esperado,
           jsonb_object_agg(f.forma, 0) as informados,
           jsonb_object_agg(f.forma, round(f.mov, 2)) as esperados,
           jsonb_object_agg(f.forma, round(-f.mov, 2)) as diferencas
      from t421_forma f
     group by f.id;

  -- 1) O caixa: fechado agora, zerado, por ninguém da loja (é a distribuição, a pedido do dono).
  update caixa_sessao s
     set status = 'fechada',
         valor_informado = 0,
         valor_esperado = round(d.dinheiro, 2),
         diferenca = round(-d.dinheiro, 2),
         valores_informados = d.informados,
         esperado_por_forma = d.esperados,
         diferenca_por_forma = d.diferencas,
         fechada_em = now(),
         fechada_por_id = null,
         obs = c_motivo
    from t421_fecha d
   where s.id = d.id
     and s.status = 'aberta';

  -- 2) Auditoria encadeada, uma linha por caixa.
  for r in select t.*, d.esperado from t421 t join t421_fecha d on d.id = t.id order by t.tenant_id, t.id loop
    perform pg_advisory_xact_lock(hashtext(r.tenant_id::text), 0);
    select a.seq, a.hash into v_ult
      from audit_log a
     where a.tenant_id = r.tenant_id and a.seq is not null
     order by a.seq desc
     limit 1;
    v_seq := coalesce(v_ult.seq, 0) + 1;
    v_prev := coalesce(v_ult.hash, '');
    v_det := jsonb_build_object(
      'diferenca', round(-r.esperado, 2)::text,
      'esperado', round(r.esperado, 2)::text,
      'informado', '0',
      'migration', '421',
      'motivo', c_motivo);
    -- Forma canônica do AuditoriaService (chaves em ordem; `at` entra porque o ator não é 'usuario').
    v_canon := '{"ac":' || to_json('fechou_caixa'::text)::text
            || ',"ai":null'
            || ',"ap":' || to_json('servico'::text)::text
            || ',"at":' || to_json('distribuicao'::text)::text
            || ',"d":{"diferenca":' || to_json(round(-r.esperado, 2)::text)::text
            ||       ',"esperado":' || to_json(round(r.esperado, 2)::text)::text
            ||       ',"informado":' || to_json('0'::text)::text
            ||       ',"migration":' || to_json('421'::text)::text
            ||       ',"motivo":' || to_json(c_motivo)::text || '}'
            || ',"ei":' || to_json(r.id::text)::text
            || ',"et":' || to_json('caixa_sessao'::text)::text
            || ',"o":' || to_json('migracao'::text)::text
            || ',"s":' || v_seq::text
            || ',"t":' || to_json(r.tenant_id::text)::text
            || ',"ti":' || to_json('financeiro'::text)::text
            || ',"u":' || coalesce(to_json(r.unidade_id::text)::text, 'null')
            || '}';
    insert into audit_log (tenant_id, unidade_id, actor_tipo, actor_id, actor_perfil, tipo, acao, entidade_tipo,
                           entidade_id, detalhe, origem, seq, prev_hash, hash)
    values (r.tenant_id, r.unidade_id, 'distribuicao', null, 'servico', 'financeiro', 'fechou_caixa',
            'caixa_sessao', r.id, v_det, 'migracao', v_seq, v_prev,
            encode(sha256(convert_to(v_prev || '|' || v_canon, 'UTF8')), 'hex'));
  end loop;

  raise notice '421: % caixas de teste fechados zerados.', v_n;
end
$$;

-- Conferência no MESMO Run: `ok` tem de vir true. Nenhum dos 4 aberto; os 4 fechados por esta migration; uma linha de
-- auditoria por caixa; a corrente da auditoria ligada; o esperado gravado igual à soma dos lançamentos com a abertura.
-- `em_uso_abertos` é só informação: os 2 caixas em uso ficam com o dono (podem já ter sido fechados por ele na tela).
select (x.abertos = 0 and x.fechados = 4 and x.auditados = 4 and x.elos_quebrados = 0 and x.esperado_diferente = 0) as ok,
       x.*
  from (
    select
      (select count(*) from caixa_sessao
        where id in ('9340f8da-a7b0-440d-83f9-8371515a5439', '88160453-144f-4da3-befa-228d122a7db5',
                     '4430f63a-39de-46b1-ae89-0395db6e3b67', '9055b7de-891e-4898-89f5-48ed4552ef56')
          and status = 'aberta') as abertos,
      (select count(*) from caixa_sessao
        where id in ('9340f8da-a7b0-440d-83f9-8371515a5439', '88160453-144f-4da3-befa-228d122a7db5',
                     '4430f63a-39de-46b1-ae89-0395db6e3b67', '9055b7de-891e-4898-89f5-48ed4552ef56')
          and status = 'fechada'
          and obs = 'Caixa de teste aberto há meses: fechado zerado a pedido do dono (migration 421).') as fechados,
      (select count(*) from audit_log
        where acao = 'fechou_caixa' and detalhe ->> 'migration' = '421') as auditados,
      (select count(*) from audit_log a
        where a.acao = 'fechou_caixa' and a.detalhe ->> 'migration' = '421'
          and a.prev_hash is distinct from coalesce((select b.hash from audit_log b
                                                      where b.tenant_id = a.tenant_id and b.seq = a.seq - 1), '')) as elos_quebrados,
      (select count(*) from caixa_sessao s
        where s.obs = 'Caixa de teste aberto há meses: fechado zerado a pedido do dono (migration 421).'
          and (select coalesce(sum((v.value)::numeric), 0) from jsonb_each_text(s.esperado_por_forma) v)
              is distinct from coalesce(s.valor_abertura, 0)
                 + (select coalesce(sum(case when l.tipo = 'entrada' then l.valor else -l.valor end), 0)
                      from lancamento_caixa l where l.sessao_id = s.id)) as esperado_diferente,
      (select count(*) from caixa_sessao
        where id in ('167c5c3c-ec43-4a1a-9a38-8e9952cd9ad3', '8e463311-dfff-403b-ae62-1dccbb86e101')
          and status = 'aberta') as em_uso_abertos
  ) x;
