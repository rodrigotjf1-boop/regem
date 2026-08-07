-- 168_impressao_vias_etiqueta.sql
-- Fase 2 — VIAS separadas por tipo (cliente/produção) por impressora.
-- Fase 5 — ETIQUETA de produto personalizado: uma etapa/complemento pode gerar
--          uma etiqueta extra (nº do pedido + item + complemento/obs) para colar
--          no produto, roteada pela impressora do complemento (mig 127/Fase 1).
-- Aditiva e idempotente. NÃO é @cloud-only (o edge também imprime).

-- Fase 2: nº de vias por tipo. NULL = herda o `vias` atual (o código faz o fallback),
-- então nada muda de comportamento para as impressoras já cadastradas.
alter table equipamento add column if not exists vias_cliente  integer;
alter table equipamento add column if not exists vias_producao integer;

-- Fase 5: a etapa reutilizável (complemento) marca se gera etiqueta do item.
alter table complemento add column if not exists imprime_etiqueta boolean not null default false;
