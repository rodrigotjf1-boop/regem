-- 136_etiquetas_validade.sql — Estoque → "Etiquetas" (validade / manipulados).
-- Impressão de etiquetas de validade conforme ANVISA RDC 216 (nome do produto,
-- data de abertura/fabricação e validade após aberto — máx 30 dias). Template editável,
-- código de barras/QR p/ identificação e BAIXA por leitura, alertas a vencer/vencidas.
-- OBS: já existe a tabela `etiqueta` (rótulo de escala) — esta frente usa `etiqueta_validade`.
-- Idempotente.

-- ── Produto: controle de validade (fonte da etiqueta) ──
alter table produto add column if not exists controla_validade boolean not null default false;
alter table produto add column if not exists validade_fechado_dias integer;   -- shelf-life fechado
alter table produto add column if not exists validade_aberto_dias integer;    -- validade após aberto (RDC 216: ≤30)

-- Ficha técnica também pode ser fonte (manipulado produzido).
alter table ficha_tecnica add column if not exists validade_dias integer;
alter table ficha_tecnica add column if not exists validade_aberto_dias integer;

-- ── Template da etiqueta (por tenant) — campos, destaques, tamanho, código ──
create table if not exists etiqueta_template (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  nome text not null default 'Padrão',
  -- ordem + visibilidade + negrito por campo:
  -- [{campo:'produto',visivel:true,negrito:true}, {campo:'validade',...}, ...]
  -- campos: loja, produto, unidade, fabricacao, compra, status, validade, responsavel, lote
  campos jsonb not null default '[]',
  tamanho text not null default '40x40',   -- 40x40 | 60x40 | 40x25 (mm)
  codigo_tipo text not null default 'code128', -- nenhum | ean13 | code128 | qr
  padrao boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Etiqueta emitida (unidade de rastreio: identifica e dá baixa) ──
create table if not exists etiqueta_validade (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  produto_id uuid,
  ficha_id uuid,
  template_id uuid,

  descricao text not null,               -- snapshot do nome (produto/ficha)
  unidade_medida text,
  tipo text not null default 'novo',     -- novo (fechado) | usado (aberto)
  status text not null default 'fechado',-- fechado | em_uso | baixado | vencido

  fabricacao date,                       -- dia de fabricação/produção
  compra date,                           -- dia da compra/recebimento
  abertura timestamptz,                  -- quando foi aberto (tipo usado / leitura)
  validade date not null,                -- data de validade calculada

  codigo text,                           -- payload do código de barras/QR (identificação)
  impressa_em timestamptz,
  baixado_em timestamptz,                -- baixa por leitura (uso/consumo)
  baixado_por_id uuid,
  virou_perda boolean,                   -- vencida → perda (alimenta desperdício/CMV)
  desperdicio_id uuid,                   -- vínculo com o lançamento de desperdício

  criado_por_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_etiqueta_validade_vigentes
  on etiqueta_validade (tenant_id, status, validade)
  where deleted_at is null;

create index if not exists idx_etiqueta_validade_codigo
  on etiqueta_validade (tenant_id, codigo)
  where deleted_at is null;
