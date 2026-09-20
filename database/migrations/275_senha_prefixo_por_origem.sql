-- 275_senha_prefixo_por_origem.sql — senha do balcão e do delivery param de brigar.
--
-- ⚠️ NÃO é @cloud-only: o PDV local e a nuvem geram senha. Aplicar nos dois bancos.
-- ⚠️ Aplicar ANTES do merge. Idempotente.
--
-- O PROBLEMA
-- A senha é um contador por loja. Quando a internet da loja cai, os dois lados continuam
-- atendendo: o PDV local segue vendendo no balcão e a NUVEM segue recebendo delivery
-- (ela assume a loja após 3 minutos sem sinal). Cada lado incrementa o seu contador e os
-- dois chegam ao mesmo número — duas senhas 47 no mesmo dia, uma no balcão e outra no
-- delivery. Não é conserto de código: enquanto dois lugares numerarem a mesma sequência
-- sem conversar, existe o intervalo entre ler e gravar.
--
-- A DECISÃO (dono, 20/09/2026): PREFIXO POR ORIGEM
-- Cada origem numera a SUA sequência: balcão `B-12`, delivery `D-07`. Sem coordenação
-- nenhuma entre os lados, então é imune a queda de luz, queda de internet, oscilação,
-- restauração e servidor duplicado — a duplicidade fica impossível por construção, não
-- "evitada por trava". E ainda fica mais claro para quem chama a senha no balcão.
--
-- Alternativa analisada e recusada: um "regente" único entregando os números. O daemon
-- roda no PC da loja e a nuvem não o alcança justamente quando mais precisa (queda de
-- internet), além de entrar no caminho da venda — daemon reiniciando travaria o caixa.

-- ── 1) O contador passa a ser por ORIGEM ──────────────────────────────────────────────
alter table senha_contador add column if not exists prefixo text not null default 'B';

-- A chave única antiga (empresa + loja) permitia UMA sequência por loja. Agora é uma por
-- origem dentro da loja. Ordem importa: cria a nova antes de largar a velha, para não
-- ficar nenhum instante sem proteção contra duplicidade.
create unique index if not exists uq_senha_tenant_unidade_prefixo
  on senha_contador (tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid), prefixo);
drop index if exists uq_senha_tenant_unidade;

-- ── 2) A senha gravada guarda de onde veio ────────────────────────────────────────────
alter table comanda          add column if not exists senha_prefixo text;
alter table producao_pedido  add column if not exists senha_prefixo text;

-- Histórico: tudo o que já existe nasceu do contador único da loja, que era usado pelo
-- balcão e pelo canal externo. Marcar como balcão preserva o que está impresso e exibido
-- (senha 47 continua 47, agora escrita B-47) sem inventar origem que não dá para saber.
update comanda         set senha_prefixo = 'B' where senha is not null and senha_prefixo is null;
update producao_pedido set senha_prefixo = 'B' where senha is not null and senha_prefixo is null;

-- ── 3) Índice de busca ────────────────────────────────────────────────────────────────
-- O KDS procura o pedido pela senha digitada; agora a busca é (senha, origem).
create index if not exists idx_producao_pedido_senha
  on producao_pedido (tenant_id, unidade_id, senha_prefixo, senha);
