-- 278_fiscal_serie_por_origem.sql — a NFC-e para de poder nascer sem emitente, e cada
-- ponto de emissão passa a ter a própria série.
--
-- ⚠️ NÃO é @cloud-only: `fiscal_config`, `nota_fiscal` e a nova `fiscal_serie` existem nos
--    dois bancos — a loja emite o cupom do balcão. Aplicar nos dois.
-- ⚠️ Aplicar ANTES do merge. Idempotente. Depende da 259, 262, 264 e 272.
--
-- POR QUÊ
--
-- 1) NUMERAÇÃO. O Ajuste SINIEF 19/16 (cl. 4ª, II) numera de 1 a 999.999.999 **por
--    estabelecimento E por série**, e o §1º permite séries distintas sem comunicar nada ao
--    Fisco — o manual da NFC-e fala em série "por checkout ou caixa". Até aqui existia UM
--    contador em `fiscal_config.proximo_numero`, compartilhado pela nuvem e pelo servidor
--    local. Com o link da loja caído, os dois lados andariam a mesma sequência às cegas e
--    emitiriam DUAS notas com o mesmo número — mesma chave de acesso, rejeição por
--    duplicidade, e a venda sem documento. Uma série por ORIGEM elimina isso por desenho:
--    cada lado tem o seu contador e nenhum fura a sequência do outro.
--    A série 0 nunca é usada: o texto nacional só a admite como "série única", e ES e AL
--    publicam que o zero é vedado.
--
-- 2) CONTADOR QUE SE RECUPERA. O contador sozinho não sobrevive a uma reinstalação. Por
--    isso a reserva toma `greatest(proximo_numero, maior número já emitido na série + 1)`:
--    banco novo, restauração ou troca de máquina não fazem o número voltar atrás. O índice
--    único abaixo transforma qualquer falha disso em erro na hora, não em duplicata calada.
--
-- 3) EMITENTE INCOMPLETO. O XML saía com `N/D` no logradouro, a UF no lugar do município e
--    `00000000000000` no CNPJ quando a configuração estava vazia, e ainda assim a nota era
--    gravada como emitida. Faltavam as colunas do endereço (o grupo `enderEmit` exige
--    bairro) e a URL de consulta do QR Code, que é POR UF — estava fixa em São Paulo no
--    código, o que produz QR inválido em qualquer outro estado. Agora são campos da
--    configuração, e sem eles a emissão é recusada.
--
-- 4) NOTA SIMULADA. Enquanto não existe assinatura nem transmissão, o emissor devolvia
--    "autorizada" sem falar com a SEFAZ. A coluna `simulada` marca essas notas para que
--    elas nunca se confundam com documento fiscal — inclusive as que já estão gravadas.

-- ── 1) Configuração do emitente: endereço completo e QR por UF ────────────────────────
alter table fiscal_config add column if not exists municipio           text;
alter table fiscal_config add column if not exists bairro              text;
alter table fiscal_config add column if not exists numero              text;
alter table fiscal_config add column if not exists cep                 text;
-- URL de consulta do QR Code, por UF e por ambiente (a do código era a de SP, fixa).
-- Preenchidas pela DISTRIBUIÇÃO, nunca pelo lojista.
alter table fiscal_config add column if not exists url_qrcode_prod     text;
alter table fiscal_config add column if not exists url_qrcode_homolog  text;
-- Série usada pela NUVEM. A da loja continua em `fiscal_config.serie` (default 1).
alter table fiscal_config add column if not exists serie_nuvem integer not null default 2;

-- Duas origens não podem cair na mesma série: seria o contador compartilhado de novo,
-- com outro nome. Empurra a da nuvem para a seguinte quando alguém configurou igual.
update fiscal_config set serie_nuvem = serie + 1 where serie_nuvem = serie;
-- A série 0 é reservada a "série única" no texto nacional e vedada em ES/AL.
update fiscal_config set serie = 1 where serie = 0 or serie is null;
update fiscal_config set serie_nuvem = 2 where serie_nuvem = 0;

-- ── 2) Nota simulada fica marcada como tal ────────────────────────────────────────────
alter table nota_fiscal add column if not exists simulada boolean not null default false;
-- As que já existem: o transmissor simulado sempre escreveu "SIMULADO" no motivo.
update nota_fiscal set simulada = true
 where simulada = false and coalesce(motivo, '') like '%SIMULADO%';

-- ── 3) Contador por ORIGEM (ponto de emissão) ─────────────────────────────────────────
-- `origem` é ONDE o código roda: 'loja' (servidor local) ou 'nuvem'. É o único critério à
-- prova de partição — os dois lados nunca compartilham contador.
create table if not exists fiscal_serie (
  id             uuid primary key,
  tenant_id      uuid not null references empresa(id) on delete cascade,
  unidade_id     uuid,
  origem         text not null,
  serie          integer not null,
  proximo_numero integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from information_schema.table_constraints
                  where table_schema = current_schema() and table_name = 'fiscal_serie'
                    and constraint_name = 'ck_fiscal_serie_origem') then
    alter table fiscal_serie add constraint ck_fiscal_serie_origem check (origem in ('loja','nuvem'));
  end if;
  if not exists (select 1 from information_schema.table_constraints
                  where table_schema = current_schema() and table_name = 'fiscal_serie'
                    and constraint_name = 'ck_fiscal_serie_serie') then
    -- Série 0 proibida (ver acima); o campo do leiaute tem 3 dígitos.
    alter table fiscal_serie add constraint ck_fiscal_serie_serie check (serie between 1 and 999);
  end if;
end $$;

-- Uma linha por (loja, origem) e nenhuma série repetida dentro da mesma loja.
-- `coalesce` porque `unidade_id` nulo (rede) não se compara em índice único.
create unique index if not exists uq_fiscal_serie_origem
  on fiscal_serie (tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid), origem);
create unique index if not exists uq_fiscal_serie_numero
  on fiscal_serie (tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid), serie);

-- Semeia a partir do que já estava configurado. O `id` vem da CHAVE DE NEGÓCIO
-- (md5 de tenant+unidade+origem), igual à tarefa e à escala da mig 277: as duas pontas
-- materializam a MESMA linha em vez de duas.
insert into fiscal_serie (id, tenant_id, unidade_id, origem, serie, proximo_numero)
select md5(c.tenant_id::text || coalesce(c.unidade_id::text, '') || o.origem)::uuid,
       c.tenant_id, c.unidade_id, o.origem,
       case when o.origem = 'loja' then c.serie else c.serie_nuvem end,
       -- Continua de onde o contador único parou, nunca abaixo do que já foi emitido.
       greatest(
         c.proximo_numero,
         coalesce((select max(n.numero) + 1 from nota_fiscal n
                    where n.tenant_id = c.tenant_id
                      and n.unidade_id is not distinct from c.unidade_id
                      and n.serie = case when o.origem = 'loja' then c.serie else c.serie_nuvem end), 1)
       )
  from fiscal_config c
  cross join (values ('loja'), ('nuvem')) as o(origem)
 on conflict do nothing;

-- ── 4) Duas notas com o mesmo número na mesma série: erro, não duplicata calada ───────
do $$
declare dup int;
begin
  select count(*) into dup from (
    select 1 from nota_fiscal
     where numero is not null and serie is not null
     group by tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid), modelo, serie, numero
    having count(*) > 1
  ) d;
  if dup = 0 then
    create unique index if not exists uq_nota_fiscal_numero
      on nota_fiscal (tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid), modelo, serie, numero);
  else
    -- Não falha a migration: o índice é uma trava para o futuro, e a duplicata que já
    -- existe é assunto de análise (nota simulada de teste, na prática).
    raise notice 'uq_nota_fiscal_numero NAO criado: % combinacao(oes) duplicada(s) em nota_fiscal', dup;
  end if;
end $$;

-- ── 5) Carimbo automático, marcador de sync e exclusão ────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['fiscal_config','fiscal_serie'] loop
    if exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = t and column_name = 'updated_at') then
      execute format('drop trigger if exists trg_bump_updated_at on %I', t);
      execute format('create trigger trg_bump_updated_at before update on %I '
                     || 'for each row execute function bump_updated_at()', t);
    end if;
  end loop;
end $$;

-- `fiscal_config` passa a DESCER para o servidor local (mig 278): sem ela a loja não tem
-- CNPJ, CSC nem endereço para montar o cupom, e hoje ela simplesmente não existia lá.
-- `fiscal_serie` NÃO sincroniza — cada lado é dono do próprio contador —, mas ganha os
-- mesmos gatilhos para que apagar do lado certo não ressuscite do outro.
do $$
declare t text;
begin
  foreach t in array array['fiscal_config','fiscal_serie'] loop
    if exists (select 1 from information_schema.tables
                where table_schema = current_schema() and table_name = t) then
      execute format('drop trigger if exists trg_sync_marcador_ins on %I', t);
      execute format('drop trigger if exists trg_sync_marcador_upd on %I', t);
      execute format('drop trigger if exists trg_sync_marcador_del on %I', t);
      execute format('create trigger trg_sync_marcador_ins after insert on %I '
                     || 'referencing new table as novas for each statement execute function marcar_mudanca_sync()', t);
      execute format('create trigger trg_sync_marcador_upd after update on %I '
                     || 'referencing new table as novas for each statement execute function marcar_mudanca_sync()', t);
      execute format('create trigger trg_sync_marcador_del after delete on %I '
                     || 'referencing old table as removidas for each statement execute function marcar_mudanca_sync()', t);
      execute format('drop trigger if exists trg_sync_exclusao on %I', t);
      execute format('create trigger trg_sync_exclusao after delete on %I '
                     || 'for each row execute function registrar_exclusao_sync()', t);
    end if;
  end loop;
end $$;

-- ── 6) Índices de delta ───────────────────────────────────────────────────────────────
create index if not exists idx_fiscal_config_sync on fiscal_config (tenant_id, updated_at, id);
create index if not exists idx_fiscal_serie_sync  on fiscal_serie  (tenant_id, updated_at, id);
-- Recuperação do contador: maior número já emitido numa série.
create index if not exists idx_nota_fiscal_serie_numero on nota_fiscal (tenant_id, unidade_id, serie, numero);
