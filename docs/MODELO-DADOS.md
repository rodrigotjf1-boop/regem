# Modelo de dados — Fases 0–1 (lógico)

Convenção: `[C]` = config, dono na **nuvem** (desce) · `[O]` = operação, dono no **nó local** (sobe).

## Base comum (toda tabela sincronizável)

`id` **uuid** (PK) · `tenant_id` · `unidade_id?` · `created_at` · `updated_at` · `deleted_at?` (soft delete) · `created_by?` · `updated_by?`. Outbox/change-feed no nível de infra (alimenta sync **e** webhooks).

---

## Fase 0 — Fundação  *(migrations 001–002)*

- **empresa** `[C]` — nome, cnpj, **ramo**, plano, status *(raiz do tenant)*
- **entitlement** `[C]` — tenant, **modulo**, ativo *(feature-flags = "complexidade=valor")*
- **unidade** `[C]` — empresa_id, nome, endereço, timezone
- **no_local** `[C/infra]` — unidade_id, identificador/MAC, versão, **last_sync_at**, status
- **setor** `[C]` — unidade_id, nome, **icone**
- **funcao** `[C]` — empresa_id, nome, **categoria** (`presidente|gerente|supervisao|execucao`), setor_id?
- **colaborador** `[C]` — empresa_id, nome, foto, funcao_id, **vinculo** (`clt|horista|diarista|pj|autonomo`), **pin_hash**, status
- **colaborador_unidade** `[C]` — **N:N** colaborador × unidade
- **equipe** / **equipe_membro** `[C]` — agrupamento leve (usado em metas)
- **api_client** `[C]` — nome, secret_hash, **scopes**, status *(credencial de máquina)*
- **webhook_subscription** `[C]` — evento, url, secret *(push via outbox)*
- **audit_log** `[O]` — actor(tipo/id), ação, entidade, detalhe(jsonb), ts

RBAC = `categoria` (da função) + escopo de `setor`/`unidade`, filtrado por `entitlement`.

---

## Fase 1 — Núcleo de valor  *(próxima migration)*

- **turno** `[C]` — unidade/setor, nome, hora_inicio, hora_fim
- **janela_pico** `[C]` — unidade/setor, dia_semana, hora_inicio, hora_fim
- **etiqueta** `[C]` — unidade, setor, funcao, **sigla**, cor(=categoria), icone(=setor), **contador**, **titular_padrao_colaborador_id?** *(a vaga/slot)*
- **escala_alocacao** `[O]` — unidade, **data**, turno, **etiqueta_id**, **colaborador_id?** (null=aberta), tipo (`titular|diarista|cobertura|avulso`)
- **ausencia** `[O]` — colaborador, período, tipo (`falta|atestado|folga`), cobertura_alocacao_id?
- **checklist** `[C]` — unidade/setor, nome, **versao**, **estado** (`rascunho|pendente_aprovacao|vigente|arquivado`), autor_id, aprovador_id?
- **checklist_item** `[C]` — checklist_id, ordem, descrição, procedimento, foto_ref?
- **pop** `[C]` — checklist_id, **versao**, conteudo_snapshot, publicado_em, pdf_ref?
- **tarefa_def** `[C]` — unidade/setor, **origem** (`recorrente|avulsa`), título, **etiqueta_id**, colaborador_override_id?, recorrência/horário/janela, **proibida_no_pico**, antecipavel, pop_id?
- **tarefa_instancia** `[O]` — tarefa_def_id?, **data**, etiqueta_id, colaborador_resolvido_id?, **estado** (`pendente|em_execucao|feita|parcial|nao_feita|impossibilitada`), motivo?, foto?, concluido_por_id?, **conclusao_em_massa**, justificativa_pico?
- **documento_controlado** `[C]` — tipo (`pop|regimento|treinamento|comunicado`), escopo, versão, estado
- **ciencia** `[O]` — colaborador, documento, versão, data, assinatura_ref

### Relações-chave

- **Late-binding:** `tarefa` → `etiqueta`; a pessoa vem de `escala_alocacao` daquela `data`.
- **Fonte tríplice:** `checklist` (versão vigente) → `pop` + `tarefa_def` recorrentes + **folha mensal** (render de `tarefa_instancia`, não é tabela).
- **Aprovação:** `checklist.estado` + `autor.categoria` → Gerente publica direto; Supervisão passa por `pendente_aprovacao`.

---

## Fora do escopo das Fases 0–1 (Fase 2+)

Estoque (item/lote/**movimento-ledger**/recebimento/fornecedor), ocorrência, manutenção/ativo, meta, kpi, premiação. A base já os suporta.
