-- 355_cashback_vencimento_do_extrato.sql — o crédito de cashback renova o vencimento nos DOIS lados.
--
-- ⚠️ NÃO é @cloud-only: o gatilho do saldo existe na nuvem e no servidor da loja (mig 274).
-- ⚠️ Aplicar ANTES do merge. Idempotente (create or replace; a correção só estende data).
--
-- O DEFEITO (medido na nuvem em 03/11/2026, 1 empresa com cashback de prazo 30 dias, 3.690 saldos positivos):
-- o vencimento ("O saldo vence o prazo do plano depois do último crédito; cada crédito renova") era gravado SÓ pelo
-- serviço, no lado que credita. Quando o crédito acontece no servidor da loja (o pedido aceito lá), o extrato sobe para
-- a nuvem e o gatilho da 274 recalcula o SALDO — mas o vencimento da nuvem fica o antigo (598 saldos com data mais cedo
-- que a do último crédito) ou vazio (362). O gasto e a leitura do saldo acontecem na nuvem (cardápio e robô): com a data
-- atrasada, o saldo de quem acabou de ganhar vencia antes da hora na primeira leitura. E o aviso "seu cashback vence em…"
-- (Onda 3) diria a data errada.
--
-- A CORREÇÃO
-- 1) O gatilho do saldo passa a renovar o vencimento quando o lançamento é um CRÉDITO de plano com prazo: data do
--    lançamento + prazo do plano, sem nunca voltar a data para trás (o crédito velho que chega atrasado pelo sync não
--    encurta). Vale para a linha criada no próprio lado e para a que chega pelo sync — a mesma regra do serviço
--    (`CashbackService.creditarPedido`), que continua gravando a dele (as duas dão a mesma data).
-- 2) Correção de uma vez: o saldo que JÁ TEM data e cuja data é mais cedo que a do último crédito pelo extrato ganha a
--    data do extrato. Só estende. O saldo SEM data não muda (na nuvem ele nunca venceu — começar a vencer é decisão do
--    dono, não desta correção); ele ganha data no próximo crédito.
--
-- ⚠️ ANTES DE APLICAR, a conta do que muda (só leitura) — o mesmo critério do passo 2:
--   with ult as (select distinct on (m.tenant_id, m.telefone, m.tipo) m.tenant_id, m.telefone, m.tipo,
--                       m.criado_em + make_interval(days => p.prazo_resgate_dias) as vence
--                  from cashback_movimento m join cashback_plano p on p.id = m.plano_id
--                 where m.origem = 'credito' and m.delta > 0 and p.prazo_resgate_dias is not null
--                 order by m.tenant_id, m.telefone, m.tipo, m.criado_em desc)
--   select count(*) from cashback_saldo s join ult u using (tenant_id, telefone, tipo)
--    where s.expira_em is not null and u.vence > s.expira_em + interval '1 minute';

-- ── 1) O gatilho renova o vencimento ──────────────────────────────────────────────────
create or replace function cashback_saldo_do_extrato() returns trigger as $$
declare
  v_saldo numeric;
  v_vence timestamptz;
begin
  -- Mesma guarda do lado da fidelidade: numa exclusao em cascata o pai ja sumiu.
  if not exists (select 1 from empresa where id = new.tenant_id) then return new; end if;
  select greatest(0, coalesce(sum(delta), 0)) into v_saldo
    from cashback_movimento
   where tenant_id = new.tenant_id and telefone = new.telefone and tipo = new.tipo;

  -- Credito de plano com prazo renova o vencimento (mig 355). Estorno, resgate, expiracao e credito de plano sem prazo
  -- nao mexem na data.
  if new.origem = 'credito' and new.delta > 0 and new.plano_id is not null then
    select new.criado_em + make_interval(days => p.prazo_resgate_dias) into v_vence
      from cashback_plano p
     where p.id = new.plano_id and p.prazo_resgate_dias is not null;
  end if;

  insert into cashback_saldo (tenant_id, telefone, cliente_id, tipo, saldo, expira_em)
  values (new.tenant_id, new.telefone, new.cliente_id, new.tipo, v_saldo, v_vence)
  on conflict (tenant_id, telefone, tipo) do update
    set saldo = excluded.saldo,
        -- não perde a ligação com o cadastro
        cliente_id = coalesce(cashback_saldo.cliente_id, excluded.cliente_id),
        -- o crédito renova; nunca volta a data para trás; sem crédito com prazo, fica a que estava
        expira_em = case
                      when excluded.expira_em is null then cashback_saldo.expira_em
                      when cashback_saldo.expira_em is null then excluded.expira_em
                      else greatest(cashback_saldo.expira_em, excluded.expira_em)
                    end,
        atualizado_em = now();
  return new;
end;
$$ language plpgsql;

-- O gatilho da 274 já aponta para esta função (create or replace mantém o vínculo); recriado aqui só se faltar.
do $$
begin
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where t.tgname = 'trg_cashback_saldo' and c.relname = 'cashback_movimento'
                    and c.relnamespace = to_regnamespace(current_schema())) then
    create trigger trg_cashback_saldo after insert on cashback_movimento
      for each row execute function cashback_saldo_do_extrato();
  end if;
end $$;

-- ── 2) Correção de uma vez: estende a data atrasada pelo extrato ──────────────────────
with ult as (
  select distinct on (m.tenant_id, m.telefone, m.tipo) m.tenant_id, m.telefone, m.tipo,
         m.criado_em + make_interval(days => p.prazo_resgate_dias) as vence
    from cashback_movimento m
    join cashback_plano p on p.id = m.plano_id
   where m.origem = 'credito' and m.delta > 0 and p.prazo_resgate_dias is not null
   order by m.tenant_id, m.telefone, m.tipo, m.criado_em desc
)
update cashback_saldo s
   set expira_em = u.vence
  from ult u
 where s.tenant_id = u.tenant_id and s.telefone = u.telefone and s.tipo = u.tipo
   and s.expira_em is not null
   and u.vence > s.expira_em + interval '1 minute';

-- ── Conferência (rodar no MESMO Run) ──────────────────────────────────────────────────
select 'funcao renova o vencimento' as item,
       case when position('mig 355' in pg_get_functiondef(to_regprocedure(current_schema() || '.cashback_saldo_do_extrato()'))) > 0
            then 'ok' else 'FALTA' end as estado
union all
select 'gatilho no extrato',
       case when exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                          where t.tgname = 'trg_cashback_saldo' and c.relname = 'cashback_movimento'
                            and c.relnamespace = to_regnamespace(current_schema())) then 'ok' else 'FALTA' end
union all
select 'nenhuma data atrasada pelo extrato',
       case when not exists (
         select 1
           from cashback_saldo s
           join (select distinct on (m.tenant_id, m.telefone, m.tipo) m.tenant_id, m.telefone, m.tipo,
                        m.criado_em + make_interval(days => p.prazo_resgate_dias) as vence
                   from cashback_movimento m join cashback_plano p on p.id = m.plano_id
                  where m.origem = 'credito' and m.delta > 0 and p.prazo_resgate_dias is not null
                  order by m.tenant_id, m.telefone, m.tipo, m.criado_em desc) u
             on u.tenant_id = s.tenant_id and u.telefone = s.telefone and u.tipo = s.tipo
          where s.expira_em is not null and u.vence > s.expira_em + interval '1 minute') then 'ok' else 'FALTA' end;
