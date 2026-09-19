# Plano — Melhoria no restore e reinstalação do edge

> **Status: PENDENTE** (planejado, sem código). Fonte da verdade deste tópico.
> Contexto: incidente potitjf (set/2026). Sync ponta-a-ponta já OK no 1.28; estas
> melhorias reduzem/eliminam a dor de reinstalar (re-sync do zero).

## Fatos verificados no código (sem achismo)
- **`.zip`** (`atualizar.ps1`): NÃO apaga o `pgdata` (l.281) + roda `apply-all-local.mjs` (l.298-300) → **preserve + migrate JÁ funciona no `.zip`**.
- **`.exe`** (`instalar-tudo.ps1`): reaproveita o `pgdata` se já existe (l.462) e roda migrations (l.750); **MAS o `.iss` passa `-Limpar` sempre** → nuke forçado → re-sync do zero.
- **`apply-all-local.mjs`**: re-roda TODAS as migrations em ordem, idempotente (engole 42P07/42701… como benigno). **SEM tabela de controle** (l.50). Pula `@cloud-only` no edge.
- `initdb -k` (data-checksums) **já ligado** → detecta corrupção de página cedo.
- **Snapshot**: keyset por `id` (uuid), **NÃO por data**; commit atômico só no `__fim` (sem carga progressiva). Janela `mirror_dias`=60 nas 8 tabelas pesadas.
- `escala/tarefa/checklist/desperdício/vistoria` **NÃO** estão em `TABELAS_SYNC` (não descem ao edge hoje).
- Branch `feat/edge-cursor-seed-log-ts` (1.29 pendente): seed de cursor no fim do restore + log carimbado.

## Plano (ordem de ataque)
1. **Processo (hoje, 0 código):** correção de bug sai como **`.zip`** (já preserve+migrate). `-Limpar` só para instalação limpa real.
2. **Tabela de controle de migrations** `_migracoes_aplicadas(arquivo pk, aplicada_em)` (edge + nuvem): aplica **só as pendentes**, sabe a versão exata, detecta drift. Baseline na 1ª vez (re-aplica idempotente + registra).
3. **Smoke-test na instalação (portão do wipe):** serviços `RegemEdge*` Running; `GET /api/v1/ping` 200; `select 1` + `count(*)` em `produto`/`comanda` sem erro; nenhuma migration pendente; `GET /sync/pull` de teste 200; (opc.) `pg_checksums --check`. **Verde → mantém o banco; vermelho → nuke + restore faseado + telemetria com o motivo.**
4. **`.iss` sem `-Limpar` incondicional:** reaproveita + migra; nuke só se o smoke-test reprovar.
5. **Restore faseado (FALLBACK, quando o wipe acontece):** snapshot recente→antigo com marcador de fase; commita **2 dias (hoje+ontem) primeiro** → operacional visível em segundos; resto (até 60d) em 2º plano → merge; aviso "reinicie para atualizar relatórios". Prioridade por tabela: `pedido_externo`/`comanda`/`produção` antes de `caixa`/financeiro.

## Fluxo alvo
```
Reinstalar (.exe) → reaproveita pgdata → migrations pendentes → SMOKE-TEST
   ├─ passou → pronto (dados intactos, schema atual, SEM re-sync)   ← caminho comum
   └─ falhou → nuke → restore faseado (2 dias primeiro, resto em 2º plano)  ← exceção
```

## Risco
Migrations passam a rodar sobre **base populada** no edge (o `-Limpar` sempre dava banco vazio). **Baixo:** a nuvem (nunca apagada) já roda as mesmas migrations sobre produção populada → provadas. Validar **1x em edge populado** antes de tirar o `-Limpar`.

## Premissas a confirmar
- Janela quente = **hoje + ontem**? (operação que vira a meia-noite conta "ontem" até fechar o caixa?)
- `escala/tarefa` não descem — **intencional** (edge = PDV) ou gap a fechar?
- `mirror_dias`=60 — mantém como janela fria total?

## Opções em aberto (decidir na implementação)
- Restore faseado: **1A** dois endpoints × **1B** commit progressivo × **1C** stream único recente→antigo com marcador de fase — **recomendado 1C**.
- Migrations: **adicionar** tabela de controle × manter re-apply idempotente — **recomendado adicionar**.

## Relacionados
`docs/plano-snapshot-restore.md` (Solução A), `docs/arquitetura-edge.md`, `RELEASES.md` (acumulado 1.29), `instalador-reinstalador-defensivo` (princípio: destrutivo só se dado inacessível).
