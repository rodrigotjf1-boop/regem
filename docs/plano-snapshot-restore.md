# Plano — Restore por Snapshot (arquivo) do edge

> Correção **durável** do restore/catch-up do edge. Nasce do incidente potitjf (ago/2026):
> o restore linha-a-linha por delta ficou frágil (502 por lote, ordem de FK, cursor
> adiantado, tempestade de requests) e deixou o edge com snapshot velho por ~1 semana.
> **Trilha 1 (já feita, #409)** destravou no curto prazo (baixa-primeiro + sempre completo
> + log). **Trilha 2 (este plano)** mata a classe de erro: troca o row-a-row por **um
> arquivo**. Ideia proposta pelo usuário (Rodrigo).

## Problema com o modelo atual (row-a-row)

O `restaurar()` / `pull()` puxam **linha a linha por delta** (`/sync/restore`, `/sync/pull`):
- **Milhares de requests** → cada lote pode dar **502** (Cloudflare/origem) → sync trava/atrasa.
- **Ordem de FK** importa (pai antes de filho) → "N linha(s) sem pai (FK)"; filhos caem.
- **Cursor keyset** pode adiantar e "pular" linhas → restore conclui com 0.
- Sem visibilidade quando trava (mitigado na Trilha 1).

## Solução A — Snapshot por tenant (nuvem → arquivo → edge) — **a principal**

A nuvem gera **UM arquivo** com os dados **daquela loja** e o edge baixa e carrega de uma vez.

### Nuvem — endpoint `GET /sync/snapshot` (cloud-only, `SyncTokenGuard` → tenant)
- Para cada tabela de `TABELAS_RESTORE`, na **ordem pai→filho**:
  `COPY (SELECT * FROM <tabela> WHERE tenant_id = <ctx.tenant> [AND janela mirror_dias]) TO STDOUT`.
- **Segurança:** o `tenant_id` vem do **sync token** (nunca do body) → **só as linhas da loja**;
  nenhuma outra loja jamais entra no arquivo. Endpoint `@CloudOnly`.
- **Formato:** stream **NDJSON gzip** (1 objeto/linha, com um cabeçalho `{"tabela": "..."}`
  antes de cada bloco) — fácil de gerar/parsear em Node e resiliente a schema drift; OU
  `COPY ... (FORMAT binary)` por tabela (mais rápido, mas casado ao schema). **Recomendado:
  NDJSON gzip** na F1 (simples/robusto), avaliar binário depois se precisar de velocidade.
- **Janela:** respeita `mirror_dias` (mesma do pull) p/ transacional pesado; `cliente` e
  cadastros que o edge precisa vêm inteiros.
- Streaming (`pg-copy-streams` / cursor) — não carrega tudo em memória na API.

### Edge — carga do arquivo
1. Baixa p/ arquivo temporário (**GET resumível**, `Range`, retry em 502 — é idempotente).
2. Verifica integridade (tamanho/hash no cabeçalho).
3. **Numa transação**: `SET session_replication_role = replica` (**desliga FK/triggers na
   carga** → acaba o "sem pai (FK)" e a ordem deixa de importar) → por tabela:
   `upsert` (ON CONFLICT DO UPDATE) das linhas do bloco → `COMMIT`.
4. Restaura `session_replication_role = origin`. Atualiza os cursores de pull p/ "agora"
   (o snapshot já trouxe o estado; o pull contínuo segue só o **delta novo**).

### Vantagens
- **Uma transferência** em vez de milhares → sem tempestade de 502.
- **FK desligada na carga** → sem órfãos, sem ordem.
- **Atômico** → ou entra tudo, ou nada (sem estado meio-aplicado).
- **Rápido** (gzip) e **observável** (progresso por bytes/linhas).

## Solução B — Backup local no instalador (rede de segurança) — **complementar**

Antes do `-Limpar` (que zera o `pgdata`), o instalador roda:
`pg_dump regem_local` → `C:\regem-edge\backups\pre-reinstall-<data>.dump` (não auto-apagado).
- **Nunca perde dado local** numa reinstalação; restaurável à mão se preciso.
- ⚠️ **Não substitui o A**: se o local está desatualizado, o backup guarda o dado velho.
  Serve de seguro, não de fonte da verdade (a nuvem é a fonte).

## Fases

- **F1 — Export (nuvem):** endpoint `/sync/snapshot` (COPY por tenant, NDJSON gzip, ordem
  FK, janela). Testes: escopo por tenant (nunca cross-tenant), tamanho, integridade.
- **F2 — Import (edge):** download resumível + carga `replication_role=replica` + botão
  **"Restaurar (snapshot)"** no `/servidor` e no fim da instalação. Fallback: se o snapshot
  falhar, cai no restore row-a-row atual.
- **F3 — Backup do instalador (B):** `pg_dump` antes do `-Limpar`.
- **F4 — Aposentar o row-a-row** como caminho primário (fica só de fallback). Documentar.

## Segurança (invioláveis)

- `tenant_id` **sempre** do sync token; o body nunca escolhe tenant. Nenhum vazamento
  cross-tenant no arquivo. Endpoint `@CloudOnly` (realm da distribuição).
- Arquivo temporário no edge com ACL restrita (SYSTEM/Admin), apagado após a carga.
- Sem segredos no snapshot (mesma whitelist `REDIGIR` do pull, se aplicável).

## Impacto / esforço

- Backend: 1 endpoint + streaming COPY (médio). Edge: 1 módulo de import (médio).
- Sem migration (usa as tabelas existentes). Distribuível: novo `.zip`/`.exe`.
- Risco: baixo p/ o A (novo caminho, com fallback pro atual). B é trivial.

> **Aguardando aprovação p/ iniciar a F1.** Enquanto isso, a Trilha 1 (#409) segura o
> potitjf e a operação roda na nuvem.
