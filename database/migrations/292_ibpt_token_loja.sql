-- 292 — Token do IBPT da LOJA (opcional) e a tabela própria que ele traz (Lei 12.741).
--
-- Até aqui a única tabela era a da DISTRIBUIÇÃO: a Regem baixa no site do IBPT e envia todo mês no
-- console (mig 291). Continua sendo o padrão — nada muda para quem não fizer nada.
--
-- O manual do IBPT (0.13, §3.3) diz que o token do webservice é do EMPRESÁRIO: ele se cadastra no
-- site "De Olho no Imposto", cadastra a empresa e entrega o token a quem faz o sistema. Então o
-- lojista PODE, se quiser, informar o token dele na Configuração fiscal. Com token, a nuvem consulta
-- todo dia a API do IBPT pelos NCMs dos produtos da loja e guarda uma tabela PRÓPRIA da empresa; a
-- emissão usa a própria quando ela cobre todos os NCMs da nota e cai na da Regem quando não cobre —
-- nunca mistura as duas numa nota.
--
-- 1) `fiscal_credencial` ganha o token CIFRADO (AES-256-GCM, `SEGREDOS_CHAVE`) e o que a tela pode
--    mostrar sem decifrar: os 4 últimos caracteres, a situação da última verificação e quando foi.
--    A tabela não sincroniza (mig 279): o token fica só na nuvem, que é quem chama o IBPT. No
--    servidor da loja as colunas existem e ficam vazias.
-- 2) `ibpt_versao` ganha o DONO: `tenant_id` nulo = tabela da distribuição (a de sempre); preenchido
--    = tabela própria daquela empresa. A identidade passa a ser (dono, uf, versão, chave) — a mesma
--    versão do IBPT pode existir uma vez para a Regem e uma vez para cada empresa com token.
--
-- NÃO é @cloud-only: as duas tabelas existem nos dois bancos (mig 279 e 291) — o servidor da loja
-- guarda a tabela própria da empresa dele para emitir sem internet.
-- ⚠️ Aplicar na NUVEM ANTES do merge: o código novo grava `tenant_id` e usa o índice novo no
--    `on conflict` (sem ele, todo envio de tabela no console dá 42P10). Idempotente.
-- ⚠️ Entre aplicar e o deploy terminar, NÃO enviar tabela do IBPT no console: o código antigo usa
--    `on conflict (uf, versao, chave)`, que deixa de existir aqui (dá 42P10). A emissão não é
--    afetada — ela só lê.

-- ── 1) Token da loja ────────────────────────────────────────────────────────────────────────
alter table fiscal_credencial add column if not exists ibpt_token_cifrado text;
alter table fiscal_credencial add column if not exists ibpt_token_final text;     -- 4 últimos, p/ a tela
alter table fiscal_credencial add column if not exists ibpt_status text;          -- ok | invalido | erro
alter table fiscal_credencial add column if not exists ibpt_mensagem text;
alter table fiscal_credencial add column if not exists ibpt_verificado_em timestamptz;

-- ── 2) Dono da tabela ───────────────────────────────────────────────────────────────────────
alter table ibpt_versao add column if not exists tenant_id uuid references empresa(id) on delete cascade;

create unique index if not exists uq_ibpt_versao_dono
  on ibpt_versao (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), uf, versao, chave);

-- A unicidade antiga (uf, versao, chave) impediria a tabela própria de ter a mesma versão da Regem.
-- O índice novo acima já cobre a da distribuição (dono nulo), então a antiga sai.
alter table ibpt_versao drop constraint if exists ibpt_versao_uf_versao_chave_key;

create index if not exists idx_ibpt_versao_tenant
  on ibpt_versao (tenant_id, uf, vigencia_inicio desc) where tenant_id is not null;
