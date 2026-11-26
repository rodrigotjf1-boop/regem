-- @cloud-only
-- 509 — MISTER: "Imagem na conversa" por empresa (versão 10, fase C10c; aprovada pelo dono em 25/11/2026 — "a imagem para todos,
-- só se o teste passar" — `docs/plano-mister.md` § "Versão 10", protótipo `mockups/regem-mister-v10.html`, "Na loja" › Avisos e
-- relatórios › Conversa › "Imagem na conversa"). O teste (C10a, 26/11) passou: 8 conferências, todas "bateu", e o dono mandou
-- concluir a versão.
--
--   mister_conversa_config.imagem_na_conversa  a imagem pedida na conversa (cartaz, representação, infográfico), gerada pelo DMS
--     Graph com os números do Regem conferidos nela antes de sair. Cerca de R$ 0,35 por imagem e 1 da franquia de imagem do DMS
--     Graph. A variável `MISTER_CRIAR_IMAGEM=1` continua sendo a chave da instalação; este ajuste é o de cada empresa. Nasce
--     DESLIGADO (regra do dono de 20/11: IA e pago nascem desligados, com o preço ao lado) e só o presidente muda.
--
-- A empresa que já gerou imagem pelo Mister no teste (a única até 26/11: a do dono) fica com o ajuste LIGADO, para a imagem
-- não parar de funcionar no meio do uso; as outras nascem desligadas. Isso roda só quando a coluna é criada: aplicar o arquivo
-- de novo não religa o que o presidente desligou depois.
--
-- ⚠️ SÓ NUVEM: `mister_conversa_config` é SO_NUVEM no sync-daemon, e o servidor da loja pula o arquivo. Sem instrução destrutiva:
-- vai pelo MCP (LIC-171). Idempotente; não apaga dado.
set local lock_timeout = '5s';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = current_schema() and table_name = 'mister_conversa_config' and column_name = 'imagem_na_conversa'
  ) then
    alter table mister_conversa_config add column imagem_na_conversa boolean not null default false;
    if to_regclass('mister_proposta') is not null then
      insert into mister_conversa_config (tenant_id, imagem_na_conversa, atualizado_em)
      select distinct p.tenant_id, true, now()
        from mister_proposta p
       where p.procedimento = 'criar_imagem' and p.situacao = 'feita'
      on conflict (tenant_id) do update set imagem_na_conversa = true, atualizado_em = now();
    end if;
  end if;
end $$;

comment on column mister_conversa_config.imagem_na_conversa is
  'Versão 10, C10c: a imagem pedida na conversa pelo DMS Graph, com os números conferidos (cerca de R$ 0,35 por imagem). Nasce desligado; só o presidente muda.';
