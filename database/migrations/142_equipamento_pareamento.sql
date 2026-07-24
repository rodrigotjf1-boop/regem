-- 142_equipamento_pareamento.sql — pareamento seguro do PC (Fase 3).
--
-- Hoje o PC se identifica só com o header `X-Terminal-Id`, que é o id guardado
-- no localStorage — sem segredo nenhum. Qualquer usuário logado pode trocar esse
-- valor no navegador e se passar por OUTRO terminal da própria empresa, herdando
-- o caixa e a unidade dele. Não vaza para outra empresa (o tenant vem do JWT
-- assinado), mas quebra a atribuição de gaveta/turno, que é justamente o
-- controle que o PDV precisa ter.
--
-- Modelo do mercado (Square, Toast, Stripe Terminal): o gestor gera um CÓDIGO
-- curto de uso único; o PC troca esse código por um SEGREDO, que fica guardado
-- ali e passa a identificá-lo. Revogável a qualquer momento. Idempotente.

-- Código de pareamento (uso único, expira) — mostrado ao gestor uma vez.
alter table equipamento add column if not exists pareamento_codigo text;
alter table equipamento add column if not exists pareamento_expira_em timestamptz;

-- Segredo do device: guardamos só o hash (nunca o valor em claro).
alter table equipamento add column if not exists segredo_hash text;
alter table equipamento add column if not exists pareado_em timestamptz;
alter table equipamento add column if not exists ultimo_uso_em timestamptz;

-- Revogação: PC roubado/trocado para de ser aceito na hora.
alter table equipamento add column if not exists revogado_em timestamptz;

-- Dois PCs nunca podem estar com o mesmo código pendente.
create unique index if not exists equipamento_pareamento_codigo_uidx
  on equipamento (pareamento_codigo)
  where pareamento_codigo is not null;
