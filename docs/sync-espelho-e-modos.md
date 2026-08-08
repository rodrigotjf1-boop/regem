# Regem — Sync espelhado + modos Local/Nuvem (design)

> Evolui `arquitetura-edge.md` (§2 dizia "não é espelhar tudo"). Decisão 2026‑08‑08:
> **prioridade LOCAL**, nuvem = uso do presidente, e sync **o mais espelhado possível**
> (inicial completo + deltas bidirecionais). Fonte da verdade desta frente. Ainda **não
> codado** — este doc é o plano; implementação vem por fases, uma frente por vez.

## 0. Princípios

1. **Local‑first de verdade.** 80–90% da operação roda no **app do edge** (`https://<IP>:3001`).
   Impressão e equipamentos são **locais** (impressora na LAN só o edge alcança).
2. **Nuvem = presidente.** Visualização, configuração e **lançamento de emergência/suporte**
   (acessar o turno aberto por um atendente e registrar/alterar uma venda).
3. **Espelho, não uma via.** Depois de instalado, nuvem e local ficam quase idênticos; o
   sync existe pras **alterações**. Inicial = puxar tudo; contínuo = só o que mudou.
4. **À prova de falhas.** Idempotente por `id`, `deleted_at` propaga exclusão, retry de FK,
   e conflito resolvido de forma determinística (LWW com exceção — §3).

## 1. Modos + RBAC de login

Nuvem e edge são **deploys diferentes** → o portão é o **endpoint de login de cada lado**:

- **Login no edge (local):** permissivo — qualquer perfil da loja loga.
- **Login na nuvem (cloud API):** checa a flag **`colaborador.pode_nuvem`**.

| Perfil | Local | Nuvem (padrão) |
|---|---|---|
| execução | ✅ | ❌ (só se o presidente liberar) |
| supervisão / gerente | ✅ | ❌ → presidente libera |
| presidente / C&O | ✅ | ✅ (sempre) |

- **Flag por colaborador** `pode_nuvem` (decisão #3), com **default derivado do perfil**
  (presidente=true; demais=false). O presidente liga/desliga por pessoa.
- **Migração:** `alter table colaborador add column pode_nuvem boolean not null default false;`
  + `update colaborador set pode_nuvem = true where categoria = 'presidente';`
  (na criação de colaborador: presidente já nasce com `true`).
- **Erro claro** ao barrar na nuvem: *"Seu acesso é pelo servidor local da loja. Peça ao
  presidente para liberar o acesso online."* (login é portão: `false` sempre aborta com msg).
- **Tela de gestão** (Config → Acessos / Pessoas): toggle "Pode acessar pela nuvem" por
  colaborador — só presidente/C&O edita. Auditado.
- **Acessar turno de outro (nuvem):** só **presidente** pode operar sobre um `caixa_sessao`
  aberto por outro colaborador (registrar venda / alterar). Checado no servidor.

## 2. Sync espelhado

### 2.1 O que muda no `sync-config.ts`
O transacional deixa de ser "só sobe" e passa a **descer também** (para espelhar o que o
presidente faz na nuvem e o que a nuvem materializou):

| Tabela | Hoje | Novo | Cursor | Conflito |
|---|---|---|---|---|
| comanda | sobe | **ambos** | updated_at | LWW + exceção (§3) |
| comanda_item | sobe | **ambos** | updated_at | LWW |
| caixa_sessao | sobe | **ambos** | updated_at | LWW |
| producao_pedido | sobe | **ambos** | updated_at | LWW |
| producao_pedido_item | sobe | **ambos** | updated_at | LWW |
| lancamento_caixa | sobe | **desce+sobe** | created_at | append (sem conflito) |
| movimento_estoque | sobe | **desce+sobe** | created_at | append |

Controle (empresa/colaborador/…) continua **desce**; catálogo continua **ambos**.

### 2.2 Inicial = mirror completo, contínuo = deltas
- **1º sync (cursor 1970):** puxa **tudo**, inclusive transacional → dashboard e reimpressão
  passam a bater com a nuvem desde o começo (resolve "dashboard local zerado").
- **Contínuo:** intervalo **60s** (era 30s). Verifica `updated_at`/`created_at` e sincroniza
  **nuvem↔local** (vice‑versa) só do que mudou.
- **Janela de histórico (decisão #2):** tabelas transacionais **pesadas**
  (comanda/comanda_item/lancamento_caixa/movimento_estoque/producao_pedido) espelham por uma
  **janela padrão de 60 dias**; controle/catálogo espelham **integral**. Evita inchar o edge
  sem perder o que o dashboard usa (período recente).
  - **Configurável no menu Financeiro** (presidente/C&O): setting **`mirror_dias`** por empresa,
    com **texto bem descritivo** na tela — *"Período que o SERVIDOR LOCAL da loja puxa da nuvem
    (vendas, caixa, pedidos, movimentações de estoque). Dados mais antigos continuam disponíveis
    para consulta NA NUVEM; o servidor local guarda só a janela definida, para operar rápido e
    offline. Aumentar o período usa mais espaço no PC da loja."*
  - Fallback técnico: env `EDGE_MIRROR_DIAS` (override no edge). **A nuvem guarda histórico
    integral**; a janela afeta **só o que desce** para o local.

### 2.3 Robustez
- Upsert idempotente por `id`; `deleted_at` propaga exclusão; **retry de FK** (já existe no
  daemon — pais antes dos filhos).
- **Push em lotes menores** (corrige o `413 request entity too large` que apareceu): fatiar
  por tamanho/qtd e subir por tabela; complementar com limite de corpo maior na `regem-api`.
- **Gatilho `updated_at`** garantido nas tabelas que viram `ambos` (comanda/comanda_item/
  caixa_sessao/producao_pedido*) — parte já existe (mig 095); auditar e completar por migração.

## 3. Conflito (LWW com exceção) — decisão #1

- Regra base: **last‑write‑wins por `updated_at`** (empate desempata por `id`, determinístico),
  com **log** de toda sobrescrita.
- **Exceção (prioridade local):** **nunca** sobrescrever uma `comanda` **`fechada`/`paga`**
  local por uma versão da nuvem **mais antiga**. Estado terminal local ganha de delta velho.
- Append‑only (lancamento_caixa/movimento_estoque) não tem conflito — só passa a descer.

## 4. Fluxo de impressão nuvem → caixa local — decisão #4

Responde "presidente lança online e sai na impressora do caixa da loja?":

```
Presidente (nuvem) registra venda no turno aberto
   → cria comanda + job de impressão (producao_pedido) NO BANCO DA NUVEM
   → sync: comanda + producao_pedido DESCEM para o edge (agora 'ambos')
   → impressao-daemon do edge (LISTEN impressao_nova no banco LOCAL) pega o job
   → EDGE resolve a impressora pelo PAPEL do job (caixa/cupom/produção-setor)
   → imprime na USB do caixa. ✅
```

- **Roteamento resolvido no edge:** o job carrega o **papel** (caixa/cupom/produção+setor),
  **não** um `equipamento_id` da nuvem (a nuvem não conhece a USB). Se vier `equipamento_id`
  que não existe/está inativo no edge, o edge **re‑resolve** pela prioridade local
  (terminal padrão → `faz_cupom`/`faz_producao` da unidade → qualquer ativa).
- Isso também conserta **"Comanda não encontrada"** na reimpressão: com `comanda` descendo,
  a via referenciada pelo `pedido_externo.comandaId` existe no edge.

## 5. Fases de implementação (uma por vez, com aprovação)

| Fase | Entrega | Migração |
|---|---|---|
| **S1 — Espelho de sync** | transacional vira `ambos`/desce; pull inicial full; janela **60d** + setting `mirror_dias` no **Financeiro**; intervalo 60s; LWW+exceção; push em lotes | `empresa.mirror_dias` (default 60) + gatilhos `updated_at` faltantes (auditar mig 095) |
| **S2 — RBAC de modo** | flag `pode_nuvem`; gate no login da nuvem; tela do presidente; presidente acessa turno de outro | `colaborador.pode_nuvem` + seed presidentes |
| **S3 — Impressão nuvem→edge** | `producao_pedido` desce; job por **papel**; edge re‑resolve impressora | (talvez coluna de papel em producao_pedido) |
| **S4 — Botões por canal** | pronto / entregar(=cobrar se não pago) / cancelar em TODOS os canais; ao marcar "pronto" numa integração, chamar o endpoint de status da integração | — |
| **S5 — Roteamento por perfil** | na tela Impressoras & cupons: por perfil, lista de impressoras + vias por local (estende `/direcionamento`, mig 167/168) | talvez |

**Regra de negócio transversal (retirada):** entregar/cobrar uma retirada exige **turno
aberto**; a entrada de valor **soma ao turno** aberto. Vale para S4.

## 6. Fora de escopo agora
- Sequência monotônica global / tombstones de hard‑delete (endurecimento v2 do
  `arquitetura-edge.md` §4) — segue adiado; o espelho aqui usa cursor `updated_at`+`deleted_at`.

## 7. Changelog
| Data | Decisão |
|---|---|
| 2026‑08‑08 | Design "sync espelhado + modos" aprovado (4 decisões: LWW+exceção; **janela 60d default, configurável no Financeiro** — só afeta o que o local puxa, nuvem mantém histórico integral; `pode_nuvem` por colaborador; roteamento de impressão resolvido no edge). Prioridade LOCAL; nuvem = presidente. Fases S1–S5. |
