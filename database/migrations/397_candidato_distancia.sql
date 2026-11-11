-- @cloud-only
-- 397 · VAGAS — F2: A DISTÂNCIA DO CANDIDATO ATÉ A LOJA (pedido do dono, 10/11/2026: "não precisamos de chave do Google
-- Maps, usamos o mapa auto-hospedado na VPS"). O endereço da ficha vira ponto no mapa (Nominatim, o mesmo do delivery) e o
-- NOSSO OSRM mede a distância pela rua e o tempo de carro até o "Ponto da loja no mapa" (Configurações › Loja). O OSRM é
-- de carro: não conta ônibus nem baldeação — as conduções seguem sendo a resposta do candidato (F1).
--
-- O que entra (só colunas novas na `candidato`, tabela @cloud-only da 389 — a loja não a tem):
--   lat / lng              — o ponto do endereço do candidato (dado pessoal: cai junto com a ficha no expurgo e no
--                            "Apagar dados", é a mesma linha).
--   distancia_km           — a distância pela rua até a loja (OSRM), uma casa decimal.
--   minutos_carro          — o tempo de carro pelo OSRM.
--   distancia_em           — quando mediu; nulo = ainda não medida.
--   distancia_tentativas   — quantas vezes tentou (a rotina para em 3; "Medir de novo" na ficha zera).
--   distancia_tentada_em   — a última tentativa (a rotina espera antes de tentar de novo).
--   distancia_falha        — o motivo da última falha: sem_ponto_da_loja, endereco_nao_achado, mapa_fora.
-- O reenvio com o endereço mudado zera a medida (o serviço), para medir de novo.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. A tabela é pequena (fichas de candidatos).
set local lock_timeout = '5s';

alter table candidato add column if not exists lat                  double precision;
alter table candidato add column if not exists lng                  double precision;
alter table candidato add column if not exists distancia_km         numeric(6,1);
alter table candidato add column if not exists minutos_carro        smallint;
alter table candidato add column if not exists distancia_em         timestamptz;
alter table candidato add column if not exists distancia_tentativas smallint not null default 0;
alter table candidato add column if not exists distancia_tentada_em timestamptz;
alter table candidato add column if not exists distancia_falha      text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_candidato_distancia_falha'
                   and conrelid = to_regclass(current_schema() || '.candidato')) then
    alter table candidato add constraint ck_candidato_distancia_falha
      check (distancia_falha is null or distancia_falha in ('sem_ponto_da_loja', 'endereco_nao_achado', 'mapa_fora'));
  end if;
end $$;

-- A rotina que mede o que falta: só as fichas ainda sem medida e com tentativa sobrando (a condição do pulo no índice — V84).
create index if not exists idx_candidato_sem_distancia on candidato (distancia_tentada_em nulls first, recebido_em)
  where distancia_em is null and distancia_tentativas < 3;

-- Conferência no MESMO Run: as linhas têm de vir com `ok = true`.
select 'candidato: as 8 colunas da distância' as objeto,
       (select count(*) = 8 from pg_attribute a
         where a.attrelid = to_regclass(current_schema() || '.candidato') and a.attnum > 0 and not a.attisdropped
           and a.attname in ('lat', 'lng', 'distancia_km', 'minutos_carro', 'distancia_em', 'distancia_tentativas',
                             'distancia_tentada_em', 'distancia_falha')) as ok
union all
select 'candidato: o motivo da falha conferido',
       (select count(*) = 1 from pg_constraint where conname = 'ck_candidato_distancia_falha'
         and conrelid = to_regclass(current_schema() || '.candidato'))
union all
select 'índice das fichas sem distância',
       (select count(*) = 1 from pg_indexes where schemaname = current_schema() and indexname = 'idx_candidato_sem_distancia');
