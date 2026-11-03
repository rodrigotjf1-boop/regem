-- @cloud-only
-- 359 · O SALDO DE CASHBACK SEM DATA GANHA O PRAZO DO PLANO, CONTADO DE HOJE (decisão do dono, 03/11/2026 — item 1:
-- "personalizável, porém vir como padrão 30 dias").
--
-- O QUE É: na nuvem, 362 saldos (R$ 2.129,63) sem data de vencimento — créditos feitos no servidor da loja antes da 355,
-- quando a data só era gravada pelo serviço do lado que creditava. Nunca venceriam. A 355 já dá a data a todo crédito
-- novo (o gatilho do extrato); esta correção cuida dos antigos.
--
-- A REGRA: o saldo positivo sem data ganha o prazo do plano do ÚLTIMO crédito dele — o "Prazo (dias)" do Plano de
-- cashback, que a loja escolhe em Delivery › Configurações › Cashback (plano novo vem com 30) —, contado de HOJE:
-- ninguém perde saldo sem ter o prazo inteiro para usar, e o aviso "cashback vencendo" (se ligado) avisa antes. Plano
-- "sem prazo (indeterminado)": o saldo continua sem data, como a loja escolheu.
--
-- Só NUVEM: o saldo não sincroniza (cada lado recalcula do extrato — mig 274); quando vencer, o "venceu" desce para a
-- loja pelo extrato. Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente (só mexe em quem está
-- sem data).
set local lock_timeout = '5s';

with alvo as (
  select s.id,
         (select p.prazo_resgate_dias
            from cashback_movimento m
            join cashback_plano p on p.id = m.plano_id
           where m.tenant_id = s.tenant_id and m.telefone = s.telefone and m.tipo = s.tipo
             and m.origem = 'credito' and m.delta > 0
           order by m.criado_em desc, m.id desc
           limit 1) as prazo
    from cashback_saldo s
   where s.expira_em is null and s.saldo > 0
)
update cashback_saldo s
   set expira_em = now() + make_interval(days => a.prazo)
  from alvo a
 where a.id = s.id and a.prazo is not null;

-- Conferência no MESMO Run: nenhum saldo positivo sem data cujo último crédito é de plano com prazo.
select 'saldo positivo sem data com crédito de plano com prazo: nenhum' as objeto,
       not exists (
         select 1 from cashback_saldo s
          where s.expira_em is null and s.saldo > 0
            and (select p.prazo_resgate_dias
                   from cashback_movimento m
                   join cashback_plano p on p.id = m.plano_id
                  where m.tenant_id = s.tenant_id and m.telefone = s.telefone and m.tipo = s.tipo
                    and m.origem = 'credito' and m.delta > 0
                  order by m.criado_em desc, m.id desc
                  limit 1) is not null) as ok;
