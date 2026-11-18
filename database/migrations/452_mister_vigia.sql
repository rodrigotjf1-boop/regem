-- @cloud-only
-- 452 — MISTER: o "FICA DE OLHO" e o LEMBRETE (versão 4, fase M4d — protótipo `mockups/regem-mister-jeito-memoria.html`,
-- aprovado pelo dono em 18/11/2026, decisão 8; o padrão "heartbeat" do Hermes Agent: só fala quando algo muda). A 450 é de
-- outra frente (o grafo) e a 451 também (o gasto do WhatsApp, G3b).
--
-- mister_vigia — um pedido de quem conversa com o Mister:
--   tipo        — olho (avisa quando o alvo muda; vence no fim da noite de trabalho, 06:00 da loja) | lembrete (avisa uma
--                 vez, na hora marcada; até 30 dias)
--   alvo        — só no olho: pedido | caixa | impressora | canal
--   referencia  — só no olho: o que achar de novo a cada volta (o pedido do canal ou a comanda), sem telefone nem dado de
--                 cliente
--   rotulo      — como aparece na conversa ("#284 · iFood 4821"; o texto do lembrete), uma linha de até 200 letras
--   estado      — só no olho: o último estado visto (a volta compara e fala só quando muda)
--   quando      — lembrete: a hora de avisar; olho: até quando vale
--   situacao    — ativo | feito | vencido | cancelado
--   resultado   — o que a última entrega fez (enviado, modelo, o motivo da falha) — nunca o telefone
-- Os tetos (3 "fica de olho" e 10 lembretes ativos por pessoa) são conferidos pelo serviço com a trava da empresa, na mesma
-- transação que grava.
--
-- mister_conversa_config.fica_de_olho — o ajuste da empresa (Mister › "Jeito e memória"), nascendo DESLIGADO.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (a tabela fica em SO_NUVEM no sync-daemon).
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM política (como as do Mister desde a 414).
set local lock_timeout = '5s';

create table if not exists mister_vigia (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references empresa(id) on delete cascade,
  colaborador_id  uuid not null references colaborador(id) on delete cascade,
  tipo            text not null,
  alvo            text,
  referencia      text,
  rotulo          text not null,
  estado          text,
  quando          timestamptz not null,
  situacao        text not null default 'ativo',
  resultado       text,
  avisado_em      timestamptz,
  criado_em       timestamptz not null default clock_timestamp(),
  atualizado_em   timestamptz not null default clock_timestamp(),
  constraint ck_mister_vigia_tipo check (tipo in ('olho', 'lembrete')),
  constraint ck_mister_vigia_alvo check (
    (tipo = 'lembrete' and alvo is null and referencia is null)
    or (tipo = 'olho' and alvo in ('pedido', 'caixa', 'impressora', 'canal') and referencia is not null)
  ),
  constraint ck_mister_vigia_situacao check (situacao in ('ativo', 'feito', 'vencido', 'cancelado')),
  constraint ck_mister_vigia_rotulo check (char_length(rotulo) between 1 and 200 and position(chr(10) in rotulo) = 0)
);
-- A volta de cada minuto: os ativos pela hora; o teto por pessoa: os ativos de cada uma.
create index if not exists ix_mister_vigia_ativos on mister_vigia (quando) where situacao = 'ativo';
create index if not exists ix_mister_vigia_pessoa on mister_vigia (tenant_id, colaborador_id) where situacao = 'ativo';
alter table mister_vigia enable row level security;

comment on table mister_vigia is 'Mister (mig 452): o "fica de olho" e o lembrete de cada pessoa — só nuvem';

alter table mister_conversa_config add column if not exists fica_de_olho boolean not null default false;

-- Conferência (no mesmo Run): a tabela com RLS, as colunas, as restrições, os índices e a coluna do ajuste.
do $$
begin
  if to_regclass('mister_vigia') is null then raise exception 'mig 452: falta a tabela mister_vigia'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('mister_vigia')) then
    raise exception 'mig 452: a RLS da mister_vigia não está ligada';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'mister_vigia'
         and column_name in ('id', 'tenant_id', 'colaborador_id', 'tipo', 'alvo', 'referencia', 'rotulo', 'estado', 'quando',
                             'situacao', 'resultado', 'avisado_em', 'criado_em', 'atualizado_em')) <> 14 then
    raise exception 'mig 452: faltam colunas da mister_vigia';
  end if;
  if (select count(*) from pg_constraint where conrelid = to_regclass('mister_vigia')
         and conname in ('ck_mister_vigia_tipo', 'ck_mister_vigia_alvo', 'ck_mister_vigia_situacao', 'ck_mister_vigia_rotulo')) <> 4 then
    raise exception 'mig 452: faltam restrições da mister_vigia';
  end if;
  if to_regclass('ix_mister_vigia_ativos') is null or to_regclass('ix_mister_vigia_pessoa') is null then
    raise exception 'mig 452: faltam os índices da mister_vigia';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = current_schema() and table_name = 'mister_conversa_config' and column_name = 'fica_de_olho') then
    raise exception 'mig 452: falta a coluna fica_de_olho em mister_conversa_config';
  end if;
end $$;
