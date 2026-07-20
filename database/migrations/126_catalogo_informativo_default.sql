-- 126_catalogo_informativo_default.sql — semântica de complemento/opção:
--   • opção sem código PDV = INFORMATIVA (observação: "ponto de carne", "talheres");
--     opção COM código PDV = item real (controle de estoque + preço).
--   • opção pré-marcada por padrão (default) para perguntas tipo "Talheres? Sim".
-- Idempotente. Aplica na nuvem e no edge (catálogo é bidirecional).

-- Opção reutilizável: pré-marcada por padrão (talheres/ponto de carne com default).
alter table opcao add column if not exists padrao_marcada boolean not null default false;

-- Item do complemento reutilizável: também pode nascer pré-marcado.
alter table complemento_item add column if not exists padrao_marcada boolean not null default false;

-- Opção MATERIALIZADA (o que o motor lê — PDV/cardápio/baixa): carrega o discriminador.
-- codigo_pdv null/''  => informativa (nota de produção, sem preço nem baixa de estoque).
-- codigo_pdv preenchido => item real; controla_estoque decide a baixa na conclusão.
alter table complemento_opcao add column if not exists codigo_pdv text;
alter table complemento_opcao add column if not exists controla_estoque boolean not null default false;
alter table complemento_opcao add column if not exists padrao_marcada boolean not null default false;
