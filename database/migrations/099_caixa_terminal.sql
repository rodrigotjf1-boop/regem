-- 099 — Terminal de PDV F2: caixa por terminal.
-- Cada sessão de caixa (origem 'pdv') passa a pertencer a um terminal (equipamento
-- tipo='pdv'). A trava "1 caixa aberto" vira por terminal, e a unidade da sessão
-- deriva do terminal — fechando o gap do caixa multi-unidade na nuvem.
-- Delivery (origem 'delivery') segue sem terminal (gaveta lógica única).

alter table caixa_sessao add column if not exists terminal_id uuid;
