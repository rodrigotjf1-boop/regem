-- @cloud-only
-- 422 — Corrige o nome da empresa do dono: "Rodrigo de oliveira" → "Mister Burguer Steakhouse" (pedido do dono, 14/11/2026:
-- "no início da criação do Regem, ao criar, ao invés de ficar com o nome correto pegou meu nome — realizar a mudança, sem
-- protótipo nem tela, só o nome alterar").
--
-- A loja (unidade) e o nome público do cardápio já eram "Mister Burguer Steakhouse"; só `empresa.nome` ficou com o nome da
-- pessoa que criou a conta. Não há tela nem rota que edite esse nome (o PATCH de configuração da empresa aceita só a janela do
-- espelho e a hora do retrato do estoque), por isso a correção vai por migration.
--
-- Integrações não dependem do nome: iFood, 99, Orzuni, WhatsApp, Stripe e a porta de integração ligam pela id da empresa e da
-- loja. O nome aparece só para ler (seletor de empresa, páginas de autorização, avisos do Mister, cupom/etiqueta quando o
-- cardápio não tem nome público). Os que guardaram uma CÓPIA do nome quando foram ligados (o nome da conta no Orzuni, o
-- cliente no Stripe) continuam com o antigo até serem ligados de novo — só texto, nada para de funcionar.
--
-- SÓ NUVEM: o gatilho `trg_empresa_updated` renova o `updated_at`, e a sincronização (a `empresa` desce da nuvem pelo
-- `updated_at`) leva o nome novo ao servidor da loja. Idempotente: só troca se o nome ainda for o antigo; na segunda vez não
-- grava nem audita nada. Não apaga nada. Registra na auditoria, encadeado como o `AuditoriaService` faz.
set local lock_timeout = '5s';

do $$
declare
  c_empresa constant uuid := '4b324104-f283-4685-96c0-add58e362391';
  c_antigo constant text := 'Rodrigo de oliveira';
  c_novo constant text := 'Mister Burguer Steakhouse';
  v_de text;
  v_ult record;
  v_seq integer;
  v_prev text;
  v_det jsonb;
  v_canon text;
begin
  select e.nome into v_de from empresa e where e.id = c_empresa for update;
  if v_de is null or lower(btrim(v_de)) <> lower(c_antigo) then
    raise notice '422: nada a trocar (a empresa não existe aqui ou o nome já não é o antigo).';
    return;
  end if;

  update empresa set nome = c_novo where id = c_empresa;

  perform pg_advisory_xact_lock(hashtext(c_empresa::text), 0);
  select a.seq, a.hash into v_ult
    from audit_log a
   where a.tenant_id = c_empresa and a.seq is not null
   order by a.seq desc
   limit 1;
  v_seq := coalesce(v_ult.seq, 0) + 1;
  v_prev := coalesce(v_ult.hash, '');
  v_det := jsonb_build_object('de', v_de, 'migration', '422', 'para', c_novo);
  -- Forma canônica do AuditoriaService (chaves em ordem; `at` entra porque o ator não é 'usuario').
  v_canon := '{"ac":' || to_json('corrigiu_nome_da_empresa'::text)::text
          || ',"ai":null'
          || ',"ap":' || to_json('servico'::text)::text
          || ',"at":' || to_json('distribuicao'::text)::text
          || ',"d":{"de":' || to_json(v_de)::text
          ||       ',"migration":' || to_json('422'::text)::text
          ||       ',"para":' || to_json(c_novo)::text || '}'
          || ',"ei":' || to_json(c_empresa::text)::text
          || ',"et":' || to_json('empresa'::text)::text
          || ',"o":' || to_json('migracao'::text)::text
          || ',"s":' || v_seq::text
          || ',"t":' || to_json(c_empresa::text)::text
          || ',"ti":' || to_json('cadastro'::text)::text
          || ',"u":null'
          || '}';
  insert into audit_log (tenant_id, unidade_id, actor_tipo, actor_id, actor_perfil, tipo, acao, entidade_tipo,
                         entidade_id, detalhe, origem, seq, prev_hash, hash)
  values (c_empresa, null, 'distribuicao', null, 'servico', 'cadastro', 'corrigiu_nome_da_empresa',
          'empresa', c_empresa, v_det, 'migracao', v_seq, v_prev,
          encode(sha256(convert_to(v_prev || '|' || v_canon, 'UTF8')), 'hex'));

  raise notice '422: nome da empresa trocado de "%" para "%".', v_de, c_novo;
end
$$;

-- Conferência no MESMO Run: `ok` tem de vir true onde a empresa existe — o nome novo gravado, nenhuma empresa com o nome
-- antigo nesta id, uma linha de auditoria da troca, ligada ao elo anterior.
select (x.empresa_existe = 0 or (x.nome_novo = 1 and x.auditadas = 1 and x.elos_quebrados = 0)) as ok,
       x.*
  from (
    select
      (select count(*) from empresa where id = '4b324104-f283-4685-96c0-add58e362391') as empresa_existe,
      (select count(*) from empresa
        where id = '4b324104-f283-4685-96c0-add58e362391' and nome = 'Mister Burguer Steakhouse') as nome_novo,
      (select count(*) from audit_log
        where tenant_id = '4b324104-f283-4685-96c0-add58e362391' and acao = 'corrigiu_nome_da_empresa') as auditadas,
      (select count(*) from audit_log a
        where a.tenant_id = '4b324104-f283-4685-96c0-add58e362391'
          and a.acao = 'corrigiu_nome_da_empresa'
          and a.prev_hash is distinct from coalesce((select b.hash from audit_log b
                                                      where b.tenant_id = a.tenant_id and b.seq = a.seq - 1), '')) as elos_quebrados
  ) x;
