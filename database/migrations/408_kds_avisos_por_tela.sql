-- 408 — Os avisos que cada KDS recebe (auditoria do KDS de 11/11/2026, onda 2 — A13; protótipo aprovado pelo dono,
-- `mockups/regem-kds-cozinha.html`, aba 3 "Avisos deste KDS").
--
-- Na gaveta ⚙ do KDS (aba "Avisos"), quem configura a produção liga e desliga, POR TELA, os tipos de aviso do rodapé:
-- alertas da loja, Farol, pausa dos canais, estoque, cliente chegou e avisos de gestão (cancelado e alterado não
-- desligam). Fica no servidor e vale para qualquer aparelho que opere aquele KDS.
--
-- ONDE: na `kds_tela_ajuste` (mig 338) — uma linha por KDS, o `id` é o do próprio KDS, sincroniza nos dois sentidos. Não
-- em `equipamento`: o uso do aparelho grava na linha dele (último uso, ping) e, no sync pela data, desfaria a escolha
-- (ERR-235). Cada escritor grava SÓ a sua coluna (o painel do Delivery, `mostra_mapa`; a gaveta do KDS, `avisos`).
--
-- NULO = o padrão do tipo de tela (`common/avisos-do-kds.ts`): preparo sem os "avisos de gestão" e sem o "cliente
-- chegou"; despacho, entrega e avisos com tudo (decisão do dono, a recomendada).
--
-- NÃO é @cloud-only (o KDS da rede da loja lê no servidor da loja). O sync copia só as colunas que existem dos dois lados:
-- a loja ainda sem esta migration (antes do `.zip`) só não recebe a coluna. ⚠️ Aplicar na NUVEM ANTES do merge: a lista
-- das telas de KDS (`GET /producao/kds/telas`) passa a ler a coluna. Idempotente, sem `drop`.

alter table kds_tela_ajuste add column if not exists avisos jsonb;

comment on column kds_tela_ajuste.avisos is
  'Os avisos que este KDS recebe: {loja, farol, pausa, estoque, chegou, gestao} → true/false. Nulo = o padrão do tipo de tela (mig 408).';
