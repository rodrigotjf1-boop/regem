-- 282 — NFC-e: INUTILIZAÇÃO de numeração (P19).
--
-- POR QUE ISTO EXISTE
--
-- Número de NFC-e que não virou documento autorizado deixa um BURACO na sequência. A lei não
-- ignora buraco: o Ajuste SINIEF 19/16, cl. 16ª, manda pedir a inutilização daqueles números
-- **até o 10º dia do mês seguinte**; e a cl. 11ª, §5º diz o que acontece se não pedir —
-- "constatada, a partir do 11º dia do mês subsequente, quebra da ordem sequencial (…) sem que
-- tenha havido a inutilização, considerar-se-á que a numeração correspondente a esse intervalo
-- se refere a documentos emitidos em contingência e não transmitidos". Ou seja: o Fisco presume
-- venda sem nota.
--
-- E não existe a saída fácil de reaproveitar o número: o MOC 7.0 (Anexo III, nota 2) é literal —
-- "a manutenção do número e série somente se aplica para os casos de rejeição da NF-e que foi
-- emitida em contingência, e NUNCA para os casos em que a NF-e foi normalmente emitida mas o
-- contribuinte não obteve êxito na consulta sobre o resultado da autorização (as NF-e pendentes
-- de retorno)". O mesmo manual manda, para essas: "inutilizar a numeração das NF-e Pendentes de
-- Retorno que não foram autorizadas ou denegadas".
--
-- Esta tabela é o registro desses pedidos: o que foi pedido, o que a SEFAZ respondeu e o XML
-- protocolado (que é o comprovante a guardar, como o da nota).
--
-- NÃO é só-nuvem: a loja emite as próprias notas, deixa as próprias lacunas e pede a própria
-- inutilização — o pedido é por (estabelecimento, série), e a série da loja é dela.

create table if not exists fiscal_inutilizacao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  unidade_id uuid,

  -- O que se está inutilizando. `ano` com 2 dígitos é o que vai no Id do pedido (AA).
  ano integer not null,
  modelo text not null default '65',
  serie integer not null,
  numero_inicial integer not null,
  numero_final integer not null,
  justificativa text not null, -- a SEFAZ exige de 15 a 255 caracteres

  -- O que a SEFAZ respondeu. 102 = "Inutilização de número homologado".
  status text not null default 'pendente', -- pendente|homologada|rejeitada
  cstat text,
  motivo text,
  protocolo text,
  ambiente text not null default '2',
  xml text, -- procInutNFe (pedido + protocolo): é o comprovante a guardar

  solicitado_por_id uuid,
  homologada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fiscal_inut_tenant
  on fiscal_inutilizacao (tenant_id, serie, numero_inicial);
create index if not exists idx_fiscal_inut_status
  on fiscal_inutilizacao (tenant_id, status);

-- A faixa tem de fazer sentido, senão o pedido sai errado e a SEFAZ rejeita (ou pior: homologa
-- uma faixa que engole número autorizado — e número inutilizado NÃO volta atrás).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_fiscal_inut_faixa') then
    alter table fiscal_inutilizacao
      add constraint ck_fiscal_inut_faixa
      check (numero_inicial >= 1 and numero_final >= numero_inicial and serie between 0 and 999);
  end if;
end $$;

-- Duas homologações para a MESMA faixa seriam dois pedidos do mesmo número: o segundo volta
-- como 563 ("já existe pedido de inutilização"). Melhor nem chegar lá.
create unique index if not exists uq_fiscal_inut_faixa
  on fiscal_inutilizacao (tenant_id,
                          coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid),
                          ano, modelo, serie, numero_inicial, numero_final)
  where status <> 'rejeitada';
