-- 143_acerto_subpdv.sql — acerto de contas do sub-PDV de salão (Fase 4).
--
-- O sub-PDV do salão funciona como um app de garçom: abre a mesa, lança os itens
-- (que já vão para a produção) e vai acumulando ali. O caixa responsável enxerga
-- só o ESPELHO — "mesa 12 em aberto, R$ 180" — sem receber nada.
--
-- Quando a conta é paga no sub-PDV, o valor NÃO entra sozinho no caixa: fica
-- PENDENTE DE ACERTO, esperando o garçom levar o dinheiro até o caixa
-- responsável. Lá o operador confere e dá baixa — só então entra na gaveta.
-- É o mesmo fluxo do entregador que volta com a comanda e o dinheiro.
--
-- A diferença entre o declarado e o entregue vira quebra registrada, no mesmo
-- espírito do fechamento cego do caixa. Idempotente.

create table if not exists acerto_subpdv (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid references unidade(id) on delete cascade,

  -- O que está sendo acertado
  comanda_id uuid references comanda(id) on delete cascade,
  mesa_id uuid references mesa(id) on delete set null,

  -- Quem fechou (sub-PDV do salão) e para qual caixa deve prestar contas
  sub_pdv_id uuid references equipamento(id) on delete set null,
  caixa_destino_id uuid references equipamento(id) on delete set null,

  -- Valores em CENTAVOS (nunca float — regra do projeto)
  valor_centavos integer not null default 0,
  forma text,                       -- dinheiro | credito | debito | pix | ...
  recebido_centavos integer,        -- o que o caixa efetivamente recebeu
  diferenca_centavos integer not null default 0,

  -- pendente = esperando o acerto | baixado = já entrou no caixa | cancelado
  status text not null default 'pendente',

  fechado_por_id uuid references colaborador(id) on delete set null,
  fechado_em timestamptz not null default now(),
  baixado_por_id uuid references colaborador(id) on delete set null,
  baixado_em timestamptz,
  caixa_sessao_id uuid references caixa_sessao(id) on delete set null,

  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A fila do caixa: "o que ainda me devem prestar contas".
create index if not exists acerto_subpdv_fila_idx
  on acerto_subpdv (tenant_id, unidade_id, status, fechado_em);

-- Uma comanda não pode gerar dois acertos pendentes.
create unique index if not exists acerto_subpdv_comanda_uidx
  on acerto_subpdv (comanda_id)
  where status = 'pendente';
