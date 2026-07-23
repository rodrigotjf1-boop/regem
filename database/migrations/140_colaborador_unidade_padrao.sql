-- 140_colaborador_unidade_padrao.sql — conserta os colaboradores "invisíveis".
-- O cadastro nunca gravava `unidade_id`, mas a listagem filtra por loja: o
-- colaborador era criado com sucesso (sem erro nenhum) e sumia da tela, como se
-- não tivesse salvo. Aqui adotamos cada órfão na MATRIZ do próprio tenant
-- (ou, se não houver matriz, na unidade mais antiga). Idempotente.

update colaborador c
   set unidade_id = u.id,
       updated_at = now()
  from (
    select distinct on (tenant_id) tenant_id, id
      from unidade
     where deleted_at is null
     order by tenant_id, (tipo = 'matriz') desc, created_at asc
  ) u
 where c.unidade_id is null
   and c.tenant_id = u.tenant_id;
