-- 293 — Mapa dos entregadores no KDS: a chave da loja (decisão do dono, 29/09/2026).
--
-- O "Mapa ao vivo" do delivery pode rodar numa tela de KDS, para a cozinha/expedição acompanhar
-- os entregadores. É localização de pessoas: fica DESLIGADO por padrão e só o gestor (presidente
-- ou gerente) liga, em Delivery → Configurações (auditado). Ligado, cada tela de KDS escolhe no ⚙
-- se mostra os Pedidos ou o Mapa.
--
-- NÃO é @cloud-only: `delivery_config` existe nos dois bancos e sincroniza nos dois sentidos — o
-- servidor da loja precisa ler a chave para liberar o mapa no KDS da LAN.
-- ⚠️ Aplicar na NUVEM ANTES do merge: o Drizzle nomeia todas as colunas de `delivery_config` no
-- select (sem a coluna, toda leitura da configuração do delivery dá 42703). Idempotente.

alter table delivery_config add column if not exists kds_mapa_entregadores boolean not null default false;
