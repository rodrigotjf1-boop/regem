-- 410 — A Rota da cozinha: a ordem e o nome das etapas de cada loja (auditoria do KDS de 11/11/2026, onda 2 — R3, R7, R9,
-- R11; protótipo aprovado pelo dono, `mockups/regem-kds-cozinha.html`, aba 2: "essa ordem pode ser alterada ou editada,
-- de acordo com o layout de cada cozinha").
--
-- Configurações › Rota da cozinha mostra a corrente inteira num lugar só (KDS1 → KDS2 → imprime → TV) e deixa "Editar a
-- ordem": as colunas são as ETAPAS (numeradas pela posição, com um nome opcional) e cada KDS fica numa etapa — dois KDS na
-- mesma etapa preparam em paralelo. Quem move o cartão continua sendo o "vai para" de cada KDS (`equipamento.
-- proximo_kds_id`), que a edição grava; esta coluna guarda só a ORDEM e os NOMES, para a tela desenhar a rota como a loja
-- montou. NULO = a tela monta a ordem pelo "vai para" de cada KDS (o que valia até aqui).
--
-- Formato: {"<id da loja>": [{"nome": "Chapa", "kds": ["<id do KDS>", …]}, …], …} — de cada loja, da primeira etapa à
-- última (empresa sem loja: a chave "empresa").
--
-- Na linha da EMPRESA (`unidade_id` nulo) em `kds_cor_config`, uma chave por loja — NUNCA numa linha da loja: nas cores do
-- KDS a linha da loja vence a da empresa inteira, e uma linha criada só para a rota (com verde 5 e amarelo 10) passaria por
-- cima das cores que a empresa ajustou. Cada loja grava só a sua chave (mesclando no banco). A linha sincroniza nos dois
-- sentidos (o sync copia só as colunas que existem dos dois lados). Só a tela da Rota grava esta coluna. ⚠️ Aplicar na
-- NUVEM ANTES do merge: a Rota lê e grava a coluna. Idempotente, sem `drop`.

alter table kds_cor_config add column if not exists rota jsonb;

comment on column kds_cor_config.rota is
  'A Rota da cozinha, na linha da empresa: {"<loja>": [{nome, kds:[equipamento.id]}]} da primeira etapa à última; sem a chave da loja = pela ordem do "vai para" (mig 410).';
