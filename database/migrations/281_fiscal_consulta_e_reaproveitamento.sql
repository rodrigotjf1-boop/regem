-- 281 — NFC-e: resolver a nota que ficou "pendente" (P18) e devolver à fila o número
--       queimado por rejeição (P19a).
--
-- POR QUE ISTO EXISTE
--
-- 1) PENDENTE. Quando a SEFAZ não responde depois do envio, a nota fica `pendente` e ninguém
--    sabe se ela foi autorizada lá. Para resolver isso é preciso CONSULTAR pela chave e guardar
--    o que voltou: o código (`cstat`) diz o destino — 100 autorizada, 101/151 cancelada,
--    110/301/302 denegada, 217 "não consta na base" (a SEFAZ nunca registrou).
--
-- 2) NÚMERO QUEIMADO. Número reservado é número gasto: se a nota é rejeitada, ele vira BURACO
--    na sequência — e buraco não inutilizado até o 10º dia do mês seguinte é presumido pelo
--    Fisco como documento emitido em contingência e não transmitido (Ajuste SINIEF 19/16,
--    cl. 11ª, §5º). A saída certa é reaproveitar o número quando a SEFAZ comprovadamente NÃO
--    guardou nada. Para isso, a nota REJEITADA precisa poder conviver com a nota válida que
--    reusa aquele número — ou seja, ela sai da regra de unicidade (e continua guardada como
--    histórico, que é o que permite investigar depois).
--
-- Nada aqui é só-nuvem: a loja também emite, também fica com nota pendente e também reaproveita.
-- Tudo idempotente e aditivo; nenhum dado é apagado.

-- ── 1) O que a SEFAZ respondeu, guardado na nota ──────────────────────────────────────────
alter table nota_fiscal add column if not exists cstat text;
comment on column nota_fiscal.cstat is
  'Código de situação da SEFAZ (cStat) da última resposta: 100 autorizada, 217 não consta, 539 duplicidade…';

-- Controle da consulta de pendentes: quando foi consultada e quantas vezes. Sem isso, o job
-- ou consulta a mesma nota em laço, ou nunca desiste.
alter table nota_fiscal add column if not exists consultada_em timestamptz;
alter table nota_fiscal add column if not exists tentativas_consulta integer not null default 0;

-- Fila do job: só interessa quem está pendente, do mais antigo para o mais novo.
create index if not exists idx_nota_pendente_consulta
  on nota_fiscal (tenant_id, status, consultada_em)
  where status = 'pendente';

-- ── 2) Unicidade do número passa a IGNORAR a rejeitada ────────────────────────────────────
-- Antes: um número, uma linha — a rejeitada travava o próprio número para sempre.
-- Agora: um número pode ter N rejeitadas (histórico) e no máximo UMA nota válida
-- (pendente, autorizada, cancelada, denegada ou contingência).
--
-- ⚠️ `pendente` continua DENTRO da regra de propósito: enquanto não se sabe o que a SEFAZ fez,
-- aquele número não pode nascer de novo.
drop index if exists uq_nota_serie_numero;   -- mig 038 (unicidade total)
drop index if exists uq_nota_fiscal_numero;  -- mig 278 (unicidade total)

create unique index if not exists uq_nota_fiscal_numero_valida
  on nota_fiscal (tenant_id,
                  coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid),
                  modelo, serie, numero)
  where status <> 'rejeitada';

-- Busca do número livre para reaproveitar (as rejeitadas da série, em ordem).
create index if not exists idx_nota_rejeitada_numero
  on nota_fiscal (tenant_id,
                  coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid),
                  serie, numero)
  where status = 'rejeitada';

-- ── 3) Conferência: a unicidade que importa continua valendo ──────────────────────────────
-- Se existir número repetido entre notas NÃO rejeitadas, o índice parcial acima nem seria
-- criado — e a migration precisa gritar, não passar calada.
do $$
declare dup int;
begin
  select count(*) into dup from (
    select 1 from nota_fiscal
     where numero is not null and serie is not null and status <> 'rejeitada'
     group by tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid),
              modelo, serie, numero
    having count(*) > 1
  ) d;
  if dup > 0 then
    raise exception 'Existem % número(s) de nota repetidos entre notas NÃO rejeitadas. '
                    'Resolva antes: duas notas válidas com o mesmo número são a mesma chave de acesso.', dup;
  end if;
end $$;
