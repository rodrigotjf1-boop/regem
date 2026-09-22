-- 279_fiscal_credencial_cifrada.sql — certificado A1 e CSC passam a existir só CIFRADOS,
-- numa tabela que não sincroniza.
--
-- ⚠️ NÃO é @cloud-only: a tabela existe nos dois bancos. A cópia-mestra fica na nuvem; o
--    servidor local terá a SUA cópia, cifrada com a chave DELE (entrega pelo canal
--    autenticado do sync — etapa seguinte do P2). Aplicar nos dois.
-- ⚠️ Aplicar ANTES do merge. Idempotente.
--
-- POR QUÊ
--
-- 1) O CSC ficava em TEXTO PURO em `fiscal_config.csc_token` (achado da auditoria). E desde a
--    mig 278 a `fiscal_config` DESCE para o servidor local — ou seja, o segredo em texto puro
--    passaria a ser copiado para o banco de cada loja. Além disso só cabia UM CSC, mas cada
--    ambiente tem o seu (homologação e produção têm IDs e valores diferentes).
--
-- 2) O certificado A1 nem tinha onde morar: `cert_ref` era um texto solto que nenhum código
--    carregava. A emissão real precisa do .pfx e da senha — o segredo mais sensível da loja
--    (um e-CNPJ assina em nome da empresa em qualquer sistema do governo, não só na NFC-e).
--
-- Por isso uma tabela PRÓPRIA, fora do sincronismo: cada lado cifra com a sua chave
-- (`SEGREDOS_CHAVE`, AES-256-GCM), então um valor cifrado na nuvem não serve de nada num
-- banco de loja e vice-versa. Se ela sincronizasse, ou a loja receberia um blob que não
-- consegue abrir, ou todas as lojas precisariam da chave da nuvem — e uma loja comprometida
-- abriria o certificado de todas as outras.
--
-- O que é PÚBLICO fica em claro, porque a tela precisa mostrar sem decifrar: titular, CNPJ,
-- número de série e validade do certificado (estão dentro do próprio certificado, que é
-- enviado em toda assinatura), e o ID de cada CSC (vai impresso dentro do QR Code).

-- ── 1) Tabela das credenciais fiscais ─────────────────────────────────────────────────
create table if not exists fiscal_credencial (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references empresa(id) on delete cascade,
  unidade_id           uuid,
  -- Certificado A1: o .pfx inteiro e a senha, cada um cifrado.
  cert_pfx_cifrado     text,
  cert_senha_cifrada   text,
  -- Dados públicos do certificado (lidos dele no envio), para a tela e para os avisos.
  cert_titular         text,
  cert_cnpj            text,
  cert_serial          text,
  cert_valido_de       timestamptz,
  cert_valido_ate      timestamptz,
  -- CSC por ambiente: 2 = homologação (teste), 1 = produção. O ID é público; o valor, cifrado.
  csc_id_homolog       text,
  csc_homolog_cifrado  text,
  csc_id_prod          text,
  csc_prod_cifrado     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists uq_fiscal_credencial_loja
  on fiscal_credencial (tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid));

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = current_schema() and table_name = 'fiscal_credencial'
                and column_name = 'updated_at') then
    drop trigger if exists trg_bump_updated_at on fiscal_credencial;
    create trigger trg_bump_updated_at before update on fiscal_credencial
      for each row execute function bump_updated_at();
  end if;
end $$;

-- ── 2) Complemento do endereço do emitente ────────────────────────────────────────────
-- O leiaute 4.00 tem `xCpl`, e o endereço oficial da loja-piloto (conferido na consulta da
-- SEFAZ-RJ) é "..., 39587, LOJA 02, PENHA": sem esta coluna o "LOJA 02" não tinha onde ir.
alter table fiscal_config add column if not exists complemento text;

-- ── 3) O CSC em texto puro SAI da fiscal_config ───────────────────────────────────────
-- Não dá para cifrar aqui (a chave não existe no banco — é esse o ponto). E manter o valor
-- é o pior dos mundos: a `fiscal_config` desce para as lojas desde a mig 278, então ele
-- seria COPIADO em texto puro para cada servidor local. Nenhuma nota real foi emitida com
-- ele (o emissor era simulado — ver ERR-070), então nada deixa de funcionar: quem tinha
-- CSC ali cadastra de novo pela tela, e ele passa a ser guardado cifrado.
update fiscal_config set csc_token = null where csc_token is not null;
