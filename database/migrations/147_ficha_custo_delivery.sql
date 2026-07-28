-- Custos delivery na ficha técnica.
-- Uma linha de insumo pode ser marcada como "somente delivery": só entra no
-- custo (e na baixa de estoque) de PEDIDOS EXTERNOS — cardápio digital (próprio
-- ou integrado) e marketplaces (iFood/99food/Keeta). Serve para embalagens e
-- itens que o balcão/kiosk/mesa não usa. A ficha passa a ter dois custos:
-- balcão (linhas normais) e delivery (balcão + linhas somente_delivery).
alter table ficha_ingrediente
  add column if not exists somente_delivery boolean not null default false;
