-- 272_paridade_cursores_e_exclusao.sql — o que a loja produz passa a PODER sincronizar.
--
-- ⚠️ NÃO é @cloud-only: nuvem e servidor local usam as duas colunas e os dois gatilhos.
--    Aplicar nos DOIS bancos (o servidor local recebe pelo pacote).
-- ⚠️ Aplicar ANTES do merge. Idempotente (roda de novo sem efeito).
-- Depende da 259 (marca de sessão `regem.sync`) e da 262 (funções `bump_updated_at`,
-- `bump_atualizado_em` e `registrar_exclusao_sync`).
--
-- POR QUÊ
-- O banco da loja tem 146 tabelas com dado de cliente e só 43 sincronizam. As demais
-- existem SÓ na loja: NFC-e emitida no PDV, tarefas, checklists, vistorias, escala,
-- cupons, formas de pagamento, mesas, ordens de produção… Numa reinstalação isso era
-- apagado, e no dia a dia a nuvem simplesmente não enxerga o que a loja faz.
--
-- O sync só consegue levar uma tabela quando ela tem (a) `id` uuid, (b) `tenant_id` e
-- (c) uma COLUNA DE DATA que sirva de marca-d'água. A maioria tem só a data de criação —
-- o que basta para tabela imutável (só insere e apaga), mas NÃO para tabela que muda de
-- estado: a alteração nunca entraria no delta. Esta migration dá a coluna que falta e
-- liga os dois gatilhos:
--   • carimbo (`updated_at`/`atualizado_em`) — respeita a marca de sessão do sync, então
--     aplicar uma linha recebida NÃO gera eco de volta;
--   • exclusão (`sync_exclusao`) — sem ele, linha apagada de um lado ressuscita no outro
--     no ciclo seguinte. Importa em tudo que é regravado por apagar-e-inserir.
--
-- NADA muda no comportamento hoje: as colunas são aditivas e os gatilhos só carimbam.
-- Quem passa a levar cada tabela é o código do sync (PR que acompanha esta migration).

-- ── 1) Tabelas que MUDAM DE ESTADO e só tinham data de criação ────────────────────────
-- Estilo de coluna por tabela (o projeto tem os dois): `updated_at` onde já existe
-- `created_at`; `atualizado_em` onde já existe `criado_em`.
alter table comunicado            add column if not exists updated_at timestamptz not null default now();
alter table clima_pesquisa        add column if not exists updated_at timestamptz not null default now();
alter table dia_especial          add column if not exists updated_at timestamptz not null default now();
alter table forma_pagamento       add column if not exists updated_at timestamptz not null default now();
alter table mesa                  add column if not exists updated_at timestamptz not null default now();
alter table cupom                 add column if not exists updated_at timestamptz not null default now();
alter table encomenda_regra_sinal add column if not exists updated_at timestamptz not null default now();
alter table encomenda_recorrencia add column if not exists updated_at timestamptz not null default now();
alter table nota_fiscal           add column if not exists updated_at timestamptz not null default now();
alter table alerta_estoque        add column if not exists atualizado_em timestamptz not null default now();
alter table pagamento_tef         add column if not exists atualizado_em timestamptz not null default now();
alter table atendimento_chamado   add column if not exists atualizado_em timestamptz not null default now();

-- A linha antiga nasce com a data de AGORA por causa do default. Isso faria o primeiro
-- ciclo de sync enxergar todas como "mudadas agora" e subir o histórico inteiro de uma vez.
-- Alinhar com a data de criação mantém o delta honesto: só sobe de novo o que mudar mesmo.
update comunicado            set updated_at = created_at where updated_at > created_at;
update clima_pesquisa        set updated_at = created_at where updated_at > created_at;
update dia_especial          set updated_at = created_at where updated_at > created_at;
update forma_pagamento       set updated_at = created_at where updated_at > created_at;
update mesa                  set updated_at = created_at where updated_at > created_at;
update cupom                 set updated_at = created_at where updated_at > created_at;
update encomenda_regra_sinal set updated_at = created_at where updated_at > created_at;
update encomenda_recorrencia set updated_at = created_at where updated_at > created_at;
update nota_fiscal           set updated_at = created_at where updated_at > created_at;
update alerta_estoque        set atualizado_em = criado_em where atualizado_em > criado_em;
update pagamento_tef         set atualizado_em = criado_em where atualizado_em > criado_em;
update atendimento_chamado   set atualizado_em = criado_em where atualizado_em > criado_em;

-- ── 2) Tabelas de SÓ ANEXAR que não tinham data nenhuma ───────────────────────────────
-- Imutáveis (a linha nasce e, no máximo, é apagada): a data de criação já serve de
-- marca-d'água. Só não existia coluna nenhuma com esse papel.
alter table ciencia             add column if not exists created_at timestamptz not null default now();
alter table comunicado_leitura  add column if not exists created_at timestamptz not null default now();
alter table clima_participacao  add column if not exists created_at timestamptz not null default now();
alter table cupom_uso           add column if not exists created_at timestamptz not null default now();
alter table produto_faixa_preco add column if not exists created_at timestamptz not null default now();

-- Data real de cada linha, quando a tabela já guardava o momento com outro nome.
update ciencia            set created_at = data       where data is not null and created_at > data;
update comunicado_leitura set created_at = lido_em    where lido_em is not null and created_at > lido_em;
update clima_participacao set created_at = respondeu_em where respondeu_em is not null and created_at > respondeu_em;
update cupom_uso          set created_at = usado_em   where usado_em is not null and created_at > usado_em;

-- ── 3) Carimbo automático (gatilho) ───────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'comunicado','clima_pesquisa','dia_especial','forma_pagamento','mesa','cupom',
    'encomenda_regra_sinal','encomenda_recorrencia','nota_fiscal',
    -- Já tinham a coluna, mas dependiam de o código gravar a data na mão (e nem sempre
    -- gravava) — mesmo defeito que a 262 corrigiu nas outras quinze.
    'tarefa_def','tarefa_instancia','checklist','checklist_item','pop','documento_controlado',
    'vistoria','ocorrencia','guia','escala_alocacao','escala_regra','janela_pico','entitlement',
    'categoria_item','ordem_producao','kds_cor_config','tef_config','acerto_subpdv',
    'pedido_manutencao','contador','modulo_ativacao'
  ] loop
    if exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = t and column_name = 'updated_at') then
      execute format('drop trigger if exists trg_bump_updated_at on %I', t);
      execute format('create trigger trg_bump_updated_at before update on %I '
                     || 'for each row execute function bump_updated_at()', t);
    end if;
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['alerta_estoque','pagamento_tef','atendimento_chamado'] loop
    if exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = t and column_name = 'atualizado_em') then
      execute format('drop trigger if exists trg_bump_atualizado_em on %I', t);
      execute format('create trigger trg_bump_atualizado_em before update on %I '
                     || 'for each row execute function bump_atualizado_em()', t);
    end if;
  end loop;
end $$;

-- ── 4) Marcador de mudança (mig 264) ─────────────────────────────────────────────────
-- O pull não varre 59 tabelas por ciclo: ele lê UMA linha por tabela no `sync_marcador`
-- e só busca o que mudou. Tabela sincronizada sem esse gatilho fica invisível para o pull
-- (o marcador nunca muda → o pull nunca a consulta). Mesmo padrão da 264.
do $$
declare t text;
begin
  foreach t in array array[
    'funcao_setor','colaborador_funcao','modulo_ativacao','entitlement','janela_pico','contador',
    'categoria_item','forma_pagamento','kds_cor_config','tef_config','mesa',
    'documento_controlado','ciencia','checklist','checklist_item','pop','tarefa_def',
    'guia','guia_passo','comunicado','comunicado_leitura','clima_pesquisa','clima_resposta',
    'clima_participacao','escala_regra','dia_especial','vistoria','ocorrencia',
    'pedido_manutencao','atendimento_chamado','alerta_estoque',
    'cupom','cupom_uso','encomenda_regra_sinal','encomenda_recorrencia','banner',
    'produto_sugestao','produto_faixa_preco','produto_destino_producao','setor_destino_producao',
    'complemento_destino_producao','opcao_destino_producao',
    'item_fornecedor','item_conversao','ordem_producao','comanda_pagamento','acerto_subpdv',
    'ponto_ajuste','pagamento_tef','nota_fiscal'
  ] loop
    if exists (select 1 from information_schema.tables
                where table_schema = current_schema() and table_name = t) then
      execute format('drop trigger if exists trg_sync_marcador_ins on %I', t);
      execute format('drop trigger if exists trg_sync_marcador_upd on %I', t);
      execute format('drop trigger if exists trg_sync_marcador_del on %I', t);
      execute format('create trigger trg_sync_marcador_ins after insert on %I '
                     || 'referencing new table as novas for each statement execute function marcar_mudanca_sync()', t);
      execute format('create trigger trg_sync_marcador_upd after update on %I '
                     || 'referencing new table as novas for each statement execute function marcar_mudanca_sync()', t);
      execute format('create trigger trg_sync_marcador_del after delete on %I '
                     || 'referencing old table as removidas for each statement execute function marcar_mudanca_sync()', t);
    end if;
  end loop;
end $$;

-- ── 5) Exclusão física passa a sincronizar ────────────────────────────────────────────
-- Sem isto, a linha apagada de um lado volta no ciclo seguinte. Vale para TUDO que é
-- regravado por apagar-e-inserir (vínculo de função, item de checklist, passo do guia,
-- destino de produção, faixa de preço, conversão de unidade) e para o que o usuário
-- apaga de verdade (mesa, cupom, forma de pagamento, banner).
do $$
declare t text;
begin
  foreach t in array array[
    'tarefa_def','tarefa_instancia','checklist','checklist_item','pop','documento_controlado',
    'ciencia','vistoria','ocorrencia','ponto_ajuste','guia','guia_passo','comunicado',
    'comunicado_leitura','clima_pesquisa','clima_resposta','clima_participacao',
    'escala_alocacao','escala_regra','dia_especial','entitlement','janela_pico',
    'funcao_setor','colaborador_funcao','modulo_ativacao','item_fornecedor','categoria_item',
    'item_conversao','forma_pagamento','comanda_pagamento','ordem_producao','mesa',
    'alerta_estoque','produto_sugestao','produto_faixa_preco','produto_destino_producao',
    'setor_destino_producao','complemento_destino_producao','opcao_destino_producao',
    'kds_cor_config','tef_config','pagamento_tef','cupom','cupom_uso','encomenda_regra_sinal',
    'encomenda_recorrencia','banner','acerto_subpdv','pedido_manutencao','contador',
    'atendimento_chamado','nota_fiscal'
  ] loop
    if exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = t and column_name = 'tenant_id')
       and exists (select 1 from information_schema.columns
                    where table_schema = current_schema() and table_name = t and column_name = 'id' and data_type = 'uuid') then
      execute format('drop trigger if exists trg_sync_exclusao on %I', t);
      execute format('create trigger trg_sync_exclusao after delete on %I '
                     || 'for each row execute function registrar_exclusao_sync()', t);
    end if;
  end loop;
end $$;
