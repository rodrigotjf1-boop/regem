# Regem — Arquitetura Edge (local-first + sync com a nuvem)

> Fonte da verdade da **nova rota** (decidida 2026-07-04). Substitui a ideia antiga de
> "apps satélites nativos (Tauri/Electron + mDNS)" — o mDNS **não sai do navegador/PWA**
> e a API é cloud. O objetivo é **operar offline** (queda/oscilação de internet não afeta
> o funcionamento interno da loja) com sincronização à nuvem.

## 1. Topologia

```
                 ☁️  NUVEM (Supabase + API)
                 • backup/restore  • presidente/C&O remoto  • agregação multi-loja
                           ↕ sync (intervalos configuráveis)
     ┌────────────────────────────────────────────────┐
     │  🖥️ SERVIDOR LOCAL = PDV com Postgres local       │  (sempre ligado; fonte da verdade na LAN)
     └───────────────┬────────────────────────────────┘
        LAN / WiFi    │
  ┌──────────┬────────┼────────────┬──────────────────┐
 PDV cliente  KDS      Ponto(kiosk)  Tablet gerente/colab   Impressoras
 (vendas)    (telas)   (digital)     (tempo real)
```

- **Um servidor local = uma loja** (`unidade_id`). Clientes são **PWAs** que apontam para o
  endereço do servidor local (descoberta por **config/QR** — mDNS não sai do PWA).
- **Auth offline:** o servidor local valida login/PIN contra a tabela local; C&O remoto pela nuvem.

## 2. Sync **direcional** (o que torna viável)

Não é espelhar tudo. Cada dado tem um dono e uma direção:

| Classe | Tabelas (ex.) | Direção | Conflito |
|---|---|---|---|
| **Operacional** (nasce na loja) | `movimento_estoque`, `ponto_marcacao`, `ponto_ajuste`, `lancamento_caixa`, `audit_log`, `comanda(_item)`, `ocorrencia`, `desperdicio`, `vistoria`, `recebimento(_item)`, `lote`, `clima_resposta` | **sobe** (local→nuvem) | ~nenhum (append-only + UUID/idempotência) |
| **Controle** (nasce online, presidente/C&O) | `empresa`, `unidade`, `setor`, `funcao`, `turno`, `etiqueta`, `colaborador`, `entitlement`, `produto(_variacao/_combo)`, `categoria_produto`, `ficha_tecnica(_ingrediente)`, `pop`, `guia`, `tarefa_def`, `bot_regra`, `feriado`, `tipo_ocorrencia` | **desce** (nuvem→local) | nuvem vence |
| **Bidirecional** | `item_estoque` (custo médio), `comanda.status`, `escala_alocacao`, `titulo_financeiro`, `caixa_sessao`, `fornecedor` | **ambos** | **last-write-wins + log** |

Como quase todo operacional é **append-only com UUID gerado no cliente**, o "sobe" é empurrar
linhas novas desde um **cursor** — sem duplicar (upsert idempotente por PK).

## 3. Mecânica do sync

- **Cursor de delta por tabela:** `updated_at` (mutáveis) ou `created_at` (append-only).
  O servidor local guarda o último cursor por tabela e pede "o que mudou desde então".
- **API de sync (na nuvem):**
  - `GET /sync/pull?desde=<ISO>` → devolve deltas das tabelas **desce/ambos** (tenant do token).
  - `POST /sync/push` → ingere deltas das tabelas **sobe/ambos** (upsert idempotente + LWW). *(slice 2)*
- **Conflito:** função pura `venceLWW(tsLocal, tsRemoto, idLocal, idRemoto)` — vence o `updated_at`
  mais novo; empate desempata por id (determinístico). Toda sobrescrita gera log.

## 4. Limitações conhecidas (v1) e endurecimento (v2)

- **Cursor por relógio** (`updated_at`): sujeito a *clock skew* e colisão no mesmo ms.
  **v2:** sequência monotônica atribuída pelo servidor (`bigserial`/outbox) — migration.
- **Hard-deletes** (ex.: `ficha_ingrediente` apagado) não são capturados por cursor.
  **v2:** *tombstones* (soft-delete universal) ou change-log.
- **Auth de serviço:** o servidor local precisa de um **token de serviço por tenant** para
  chamar `/sync/*`. v1 usa JWT de `presidente`; **v2:** credencial de dispositivo/servidor.

## 5. Fases

- **Fase 0/1 (nuvem, testável sem hardware):** config de sync + `venceLWW` puro (testes) +
  `GET /sync/pull` (deltas). *(este slice)* → depois `POST /sync/push` + sequência monotônica (migration).
- **Fase 2 (infra, não testável aqui):** empacotar backend como servidor local + Postgres;
  clientes apontam pro local; PWA quiosque (manifest+SW) + fila IndexedDB; deploy por loja;
  backup/restore; descoberta por QR.

## 6. Changelog

| Data | Decisão |
|---|---|
| 2026-07-04 | Arquitetura edge definida; substitui "satélites nativos/mDNS". Início pelo núcleo do sync (config + `venceLWW` + `GET /sync/pull`), sem migration. |
| 2026-07-04 | Slice 2: `POST /sync/push` seguro (token de dispositivo `servidor_local`, tenant forçado, whitelist tabela+coluna, idempotente) + redação de segredos no pull. Slice 3: LWW-update para tabelas `ambos`. |
| 2026-07-04 | Slice 4: **soft-deletes propagam no pull** (delta considera `deleted_at` por introspecção — sem trigger). **DECISÃO DE SEGURANÇA:** sequência monotônica + tombstones de **hard-delete** exigem **triggers nas tabelas centrais** — NÃO deployar sem ambiente de teste (uma trigger com erro derruba todos os writes). **Adiado para a Fase 2**, que terá Postgres local para validar o CDC antes. |
