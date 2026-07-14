-- Modo de tema do cardápio público (Etapa 5): o lojista escolhe claro/escuro/auto;
-- o cliente ainda pode alternar. Aplicado via classe no wrapper da página pública.
alter table cardapio_config add column if not exists tema text not null default 'claro';
-- valores: 'claro' | 'escuro' | 'auto' (auto segue o sistema do cliente)
