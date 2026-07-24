-- 145_escalas_crud.sql — permissão de Escalas vira CRUD (ver/criar/editar/excluir).
--
-- Antes "Escalas" era um toggle liga/desliga: não dava para autorizar SÓ a
-- visualização (o que a execução precisa — a escala é a fonte da verdade do dia
-- dela, mas ela não edita). Agora é CRUD, como Estoque e Ponto.
--
-- Converte o valor booleano já gravado em cada perfil para o objeto CRUD
-- correspondente ao nível. Só toca em quem ainda está como booleano (idempotente:
-- rodar de novo não mexe em quem já é objeto).

update perfil_acesso
   set permissoes = jsonb_set(
         permissoes,
         '{escalas}',
         case
           when (permissoes->'escalas') = 'false'::jsonb
             then '{"ver":false,"criar":false,"editar":false,"excluir":false}'::jsonb
           when nivel in ('presidente','gerente')
             then '{"ver":true,"criar":true,"editar":true,"excluir":true}'::jsonb
           when nivel = 'supervisao'
             then '{"ver":true,"criar":false,"editar":true,"excluir":false}'::jsonb
           else
             '{"ver":true,"criar":false,"editar":false,"excluir":false}'::jsonb
         end
       ),
       updated_at = now()
 where jsonb_typeof(permissoes->'escalas') = 'boolean';
