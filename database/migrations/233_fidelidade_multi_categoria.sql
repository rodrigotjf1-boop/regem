-- 233_fidelidade_multi_categoria.sql — fidelidade: qualificador por MÚLTIPLAS categorias
-- (ou produtos). Antes era 1 qualificador_id único. Adiciona qualificador_ids (jsonb) e
-- migra o valor atual para dentro do array. Aditivo/idempotente/não-destrutivo (mantém
-- qualificador_id para compatibilidade). No edge, se a tabela não existir, pula 42P01.

alter table fidelidade_plano add column if not exists qualificador_ids jsonb not null default '[]';

-- Backfill não-destrutivo: leva o qualificador_id atual para o array (só quando vazio).
update fidelidade_plano
   set qualificador_ids = jsonb_build_array(qualificador_id::text)
 where qualificador_id is not null
   and (qualificador_ids is null or qualificador_ids = '[]'::jsonb);
