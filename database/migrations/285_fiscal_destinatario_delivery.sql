-- 285 — NFC-e: DESTINATÁRIO, ENTREGA A DOMICÍLIO e INTERMEDIADOR.
--
-- ⚠️ NÃO é @cloud-only: a loja emite as próprias notas e recebe os próprios pedidos.
-- ⚠️ Aplicar ANTES do merge. Idempotente (roda de novo sem efeito).
--
-- POR QUE EXISTE
--
-- 1) IDENTIFICAÇÃO DO CONSUMIDOR. O Ajuste SINIEF 9/26 (efeitos desde 03/08/2026) trocou a alínea
--    "c" do inciso VII da cláusula 4ª do Ajuste 19/16: o gatilho deixou de ser "entrega em
--    domicílio" e passou a ser **"operações não presenciais"**, com CPF/CNPJ E endereço. Isso
--    alcança delivery, marketplace, site, WhatsApp — e até a retirada na loja pedida pelo app.
--    No RJ o piso de valor é R$ 2.000 (RICMS, Livro VI, Anexo I, art. 50, VI), não os R$ 10.000
--    do default nacional — e a regra de validação W16-40 diz, no texto vigente, "R$ 10.000,00 OU
--    OUTRO VALOR DEFINIDO PELA UF". Logo: limite é configuração, nunca constante.
--
-- 2) ENTREGA A DOMICÍLIO. Com `indPres=4` a SEFAZ exige destinatário (787), endereço (788) e
--    transportador (786). E frete só existe com `indPres=4`: declarar `modFrete<>9` sem isso é
--    rejeição 753 — que é o defeito que temos hoje em toda nota de delivery com taxa da loja.
--
-- 3) INTERMEDIADOR. A regra B25c-10 (produção desde 04/04/2022) exige `indIntermed` sempre que
--    `indPres` for 1, 2, 3, 4 ou 9 — e a NFC-e só aceita 1 ou 4. Ou seja: SEMPRE. Pedido de
--    marketplace leva `indIntermed=1` + o grupo `infIntermed` (CNPJ do canal + identificação da
--    loja no app); venda própria leva `indIntermed=0`.
--
-- 4) SEM CPF, a venda não pode ficar sem documento. A loja escolhe o que fazer (coluna
--    `delivery_sem_cpf`): emitir declarando operação presencial — sem frete e sem transportador,
--    com a taxa de entrega como item, para o total bater com o que o cliente pagou — ou não
--    emitir e sinalizar. O padrão é emitir: venda sem nota é multa de 5% no RJ.

-- ── 1) O documento que o cliente informou para a nota ─────────────────────────────────────
alter table pedido_externo add column if not exists documento_cliente text;
comment on column pedido_externo.documento_cliente is
  'CPF/CNPJ informado para a NFC-e (cardápio, painel, ou vindo do canal). Só dígitos.';

-- Endereço fiscal da entrega. O que já existe (rua, número, bairro) não basta para o grupo
-- `enderDest`, que exige município e UF. Quando ficar nulo, a emissão usa o município do
-- EMITENTE — o delivery é intramunicipal na esmagadora maioria dos casos, e a NFC-e só vale
-- dentro do estado; mas a coluna existe para corrigir onde não for.
alter table pedido_externo add column if not exists endereco_cidade text;
alter table pedido_externo add column if not exists endereco_municipio_ibge integer;
alter table pedido_externo add column if not exists endereco_uf text;
alter table pedido_externo add column if not exists endereco_cep text;

-- ── 2) O CPF do cliente, para não pedir de novo a cada pedido ─────────────────────────────
alter table cliente add column if not exists cpf text;
comment on column cliente.cpf is
  'Informado pelo próprio cliente quando pede a nota com CPF. Serve para pré-preencher o próximo pedido.';

-- ── 3) Configuração fiscal da loja ────────────────────────────────────────────────────────
-- Piso a partir do qual o destinatário tem de ser identificado. NULO = usar o padrão da UF
-- (RJ: 2000). Nunca um literal no código: a norma nacional diz "ou outro valor definido pela UF".
alter table fiscal_config add column if not exists limite_identificacao numeric(12,2);

-- O que fazer no pedido não presencial SEM documento do cliente.
--   'presencial'  → emite declarando operação presencial (sem frete/transportador; taxa vira item)
--   'nao_emitir'  → não emite e sinaliza o pedido
alter table fiscal_config add column if not exists delivery_sem_cpf text not null default 'presencial';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_fiscal_delivery_sem_cpf') then
    alter table fiscal_config
      add constraint ck_fiscal_delivery_sem_cpf
      check (delivery_sem_cpf in ('presencial', 'nao_emitir'));
  end if;
end $$;

-- ── 4) Como a nota saiu, para a auditoria e para o contador ───────────────────────────────
-- Sem isto, ninguém consegue depois separar as notas que saíram pelo caminho conforme das que
-- saíram declaradas como presenciais por falta de CPF.
alter table nota_fiscal add column if not exists ind_pres text;
alter table nota_fiscal add column if not exists sem_documento_cliente boolean not null default false;
comment on column nota_fiscal.sem_documento_cliente is
  'true = venda não presencial emitida sem documento do consumidor (declarada como presencial).';

create index if not exists idx_nota_sem_documento
  on nota_fiscal (tenant_id, emitida_em)
  where sem_documento_cliente;
