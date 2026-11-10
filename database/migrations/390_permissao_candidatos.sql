-- 390 · PERMISSÃO `candidatos` NOS PERFIS QUE JÁ EXISTEM (Vagas e candidatos, F1 — pedido do dono, 10/11/2026).
--
-- ⚠️ NÃO é @cloud-only: `perfil_acesso` desce para o servidor da loja (aplicar na nuvem E na loja, como a 252).
-- ⚠️ Nuvem ANTES do merge: o pacote salvo em `perfil_acesso.permissoes` é usado COMO ESTÁ (não se mescla com o padrão
-- do nível). Sem esta migration, a chave nova estaria AUSENTE nos perfis salvos e ausente = negado: a gerência não veria
-- Pessoas › Candidatos.
--
-- A regra (decisão do dono no plano aprovado em 10/11/2026): as fichas de candidato são dado pessoal — gerente e
-- presidente por padrão; supervisão e execução DESLIGADAS (o presidente libera no perfil, se quiser). Perfil que já tiver
-- a chave (editado depois) não é tocado. Idempotente.
update perfil_acesso
   set permissoes = jsonb_set(
         coalesce(permissoes, '{}'::jsonb),
         '{candidatos}',
         to_jsonb(nivel in ('presidente', 'gerente')),
         true
       ),
       updated_at = now()
 where not (coalesce(permissoes, '{}'::jsonb) ? 'candidatos');

-- Conferência no MESMO Run: nenhum perfil ficou sem a chave.
select 'nenhum perfil sem a chave candidatos' as objeto,
       (select count(*) = 0 from perfil_acesso where not (coalesce(permissoes, '{}'::jsonb) ? 'candidatos')) as ok;
