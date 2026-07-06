-- PDV/Caixa: número do turno (sessão de caixa sequencial por dia).
alter table caixa_sessao add column if not exists turno_numero integer;
