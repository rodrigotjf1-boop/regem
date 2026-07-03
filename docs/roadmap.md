# Regem — Roadmap & Plano de Ação

> **Fonte da verdade do plano.** Gerado a partir da análise de 02/07/2026 (motor de estoque/CMV, financeiro, PDV, integrações). Plano **travado** — executar fase a fase sem mudar o caminho. Atualizar o "estado atual" ao concluir cada entrega.

## 1. Estado atual — o que já está no ar

Produção: `app.dmsregem.com` / `api.dmsregem.com` (EasyPanel + Supabase, auto-deploy em `main`).

- **Auth**: senha + PIN, RBAC no servidor (`presidente>gerente>supervisao>execucao`), multi-tenant.
- **Marketing/entrada**: landing pública (`/`), login split-screen (`/entrar`), criar conta, PIN (`/pin`).
- **Operação**: Dashboard (`/painel`), Meu Dia, **Escala + grade semanal**, **Linha do Tempo + janelas de pico**, Operação (estoque **ledger** / desperdício / vistoria — ambos **com foto real**), Documentos, POP & Guias.
- **Gestão**: Cadastros (redesign Fable + hub) · **Equipamentos & Apps** (KDS/Terminal, device token) · **Fichas Técnicas + CMV teórico** · **Fornecedores + recebimento c/ divergências + lotes/FEFO** · **Pessoas & Ponto** (Portaria 671, **foto no ponto com LGPD**) · **Terminal de Ponto** kiosk · **Auditoria** (`/auditoria`, `audit_log` append-only).
- **Tempo real (Fase F-A)**: gateway socket.io (rooms tenant/unidade, handshake JWT/device), **KDS web** (`/kds`), eventos `ponto:marcado`/`kds:alerta`/`device:status`, **NSR por equipamento**.
- **Design**: tokens Fable — **âmbar `#E8A845` = marca/ação**; atenção `#E06A3C`, crítico `#E05252`, ok verde. Fontes Archivo/Figtree/JetBrains.
- **Migrations aplicadas**: 001 → 016.

## 2. Pilar de arquitetura (o que guia tudo)

**Ledger imutável + derivar saldo** — já vivo em: **estoque** (`movimento_estoque`, saldo = `sum()`), **auditoria** (`audit_log`), **ponto** (marcações imutáveis + ajustes). Estender o mesmo padrão a:

- **Financeiro** = partidas dobradas (título/lançamento; estorno = lançamento inverso, nunca delete).
- **Custo** = o movimento de estoque passa a **carregar custo** (hoje o custo só vive no `lote`).
- **Idempotência** nos webhooks (chave idempotente — já é padrão no offline/WS) + **agendador de jobs** (cron; hoje não existe).

## 3. Plano em fases (travado)

> Ordem escolhida para **entregar valor antes do PDV**: metade do "motor" sai de dados que já temos.

### Fase G — Motor de custo & analytics · **PONTO DE PARTIDA**
Sem depender de PDV nem de integrações. Módulos:
- **G1 · Custo no ledger**: adicionar custo ao `movimento_estoque` + **custo médio ponderado móvel** por item (recalcula a cada recebimento). *Migration.*
- **G2 · CMV real do período**: `EI + Compras − EF`; comparar com o CMV **teórico** da ficha → **desperdício + desvio** (o "KPI de ouro").
- **G3 · Ponto de pedido (ROP)**: `consumo médio diário × lead time + estoque de segurança` (lead time o fornecedor já registra).
- **G4 · Curva ABC** de insumos (valor consumido).
- **G5 · Preço sugerido / markup vs margem** na ficha técnica (inverso do CMV-alvo).

### Fase H — Financeiro base (partidas dobradas)
- **Ledger financeiro** (fundação) + **Contas a pagar** nascendo do recebimento (gancho já existe) + **Fluxo de caixa projetado** + **DRE gerencial por loja** → alimenta a Visão C&O.
- **Transversal aqui**: **agendador de jobs** (habilita expurgo de fotos, DF-e periódico, relatórios agendados) + idempotência.

### Fase I — Fiscal de entrada (DF-e)
- Consulta automática à SEFAZ puxa o **XML** das notas contra o CNPJ → recebimento vira **conferência** (foto = fallback). Alimenta custo (G1) e contas a pagar (H) sozinho. Via hub fiscal.

### Fase J — Vendas & PDV (comandas) — frente grande, sub-fases
- Comanda por mesa · divisão de conta · taxa de serviço 10% · sangria/suprimento · **fechamento de caixa cego**.
- Dispara **baixa por explosão de ficha** (venda → decrementa insumos × FC, consumindo lote FEFO), o **CMV real** e o **caixa**.
- **Fiscal de saída**: NFC-e / SAT via hub. **Pagamentos**: TEF/POS + Pix + conciliação.

### Fase K — Integrações externas
- **iFood** (+ Bot) · **WhatsApp Business** (bot + relatórios no zap) · **pagamentos/conciliação** · **Open Finance** (Pluggy/Belvo) · **exportação contábil** (layout Domínio + XMLs).
- **Hardware**: impressora ESC/POS + balança EAN-13 — casa com a **Fase F-B** (apps nativos).

## 4. Módulos vendáveis (o que vira produto/receita)

A base de **feature-flags/entitlements** já existe (presidente liga/desliga por rede ou loja). Empacotamento comercial:

| Módulo (SKU) | Entrega em | Tier sugerido |
|---|---|---|
| **Núcleo** (escala, tarefas, checklist, desperdício, vistoria, POP, docs) | ✅ no ar | Balcão |
| **Estoque & CMV Pro** (G1–G5: CMP, CMV real, ROP, ABC, preço sugerido) | Fase G | Operação |
| **Financeiro** (contas a pagar, caixa projetado, DRE) | Fase H | Rede / add-on |
| **Fiscal** (DF-e entrada + NFC-e/SAT saída) | Fases I + J | add-on por unidade |
| **PDV / Vendas & Comandas** | Fase J | Operação / add-on |
| **Ponto & Folha Pro** (extra 50/100%, noturno, DSR, AFD/AEJ) | estende ponto | add-on |
| **KDS** · **Terminal de Ponto** · **App do Colaborador** · **Bot/IA** | ✅ base (F-A) / roadmap | add-ons ativáveis |
| **Integrações** (iFood, WhatsApp, pagamentos, Open Finance, contábil) | Fase K | add-ons individuais (marketplace) |

## 5. Pendências (encaixadas no plano)

- **Rotina de expurgo de fotos de ponto (LGPD)** → com o agendador (Fase H).
- **PIN autenticando direto no login** → pontual, encaixa em qualquer momento.
- **Preview real do "Template por ramo"** em Cadastros → pontual.
- **Fase F-B** — apps nativos (Tauri/Electron/Android) + mDNS/MAC → com hardware ESC/POS (Fase K).
- **Frentes com mockup não iniciadas**: Mural & Clima, Bot de Suporte, Wizard por ramo rico.

## 6. Ponto de partida

**Fase G, módulo G1 (Custo no ledger)** — custo no movimento de estoque + custo médio ponderado móvel. É a fundação de todo o motor de CMV e do financeiro. Maior valor pelo menor esforço, sem PDV nem integrações.
