# Regem — Plataforma de Gestão Operacional (multi-ramo, multi-loja)

> **Leia este arquivo por inteiro antes de qualquer tarefa.** Define as regras permanentes do projeto. Em caso de conflito entre este arquivo e uma instrução pontual, **pergunte antes de agir**. Não iniciar tarefas grandes sem apresentar um plano e aguardar aprovação.

## O que é o produto

SaaS de gestão operacional com hierarquia completa do proprietário à ponta. Ramo-âncora de validação: **food service (bares, restaurantes, fast food)**; depois generaliza. Nome **Regem** (latim *regere/rex* — "no comando"), voz de marca: *"No comando de todo o negócio · do balcão ao balanço"*.

## Stack e estrutura (monorepo — pasta `C:\Regen`, repo `github.com/rodrigotjf1-boop/regem`)

- **backend/** — NestJS 10 + TypeScript + Drizzle ORM + `pg` (Postgres/Supabase). Prefixo de API `/api/v1`. Auth JWT (senha + PIN), multi-tenant + RBAC. Módulos em `src/modules/*` (um módulo por domínio: controller + service + dto). Schema Drizzle em `src/db/schema.ts`. **Contrato da API:** Swagger em `/api/v1/docs` (em produção só com `SWAGGER_ENABLED=true`); `docs/openapi.json` gerado por `npm run build && npm run openapi` é o contrato para integrações externas.
- **frontend/** — Next.js 14 (App Router) + Tailwind + componentes shadcn-style à mão. Design system em `src/app/globals.css` (classe `.app-light`) + `tailwind.config.ts`. Shell (sidebar+topbar) em `src/components/app-shell/shell.tsx`. Cliente de API em `src/lib/api.ts`.
- **database/migrations/** — SQL escrito à mão `NNN_nome.sql`, aplicado por `backend/scripts/apply-sql.mjs` (usa `backend/.env` → `DATABASE_URL`). **Sempre criar o `.sql` ao entregar uma migration.**
- **docs/** — fonte da verdade (abaixo). **mockups/** — referência visual/comportamental.
- **Deploy:** EasyPanel na VPS (serviços `regem-api` e `regem-web`) + Supabase. **Auto-deploy ligado**: todo push em `main` sobe sozinho — nunca dar push com build quebrado (rodar `npm run build` nos dois antes).
- **CI (`.github/workflows/ci.yml`)**: roda `npm ci` + `npm run build` (e `npm test`) em `backend/` e `frontend/` a cada push/PR. **Fluxo obrigatório: branch → PR → conferir CI verde (aba Actions) → merge.** ⚠️ *Branch protection* foi criada em `main`, mas o GitHub **não a aplica em repo privado no plano grátis** (precisa Team/Enterprise) — então o portão é **por disciplina** (opção B): não fazer merge com CI vermelho. O EasyPanel deploya a `main` após o merge. Nunca commitar segredos; `.env` fica no `.gitignore`.

## Fontes da verdade (ordem de prioridade)

1. `docs/especificacao.md` — requisitos e conceito do produto.
2. `docs/decisoes-design.md` — design tokens, matriz RBAC, contratos JSON, decisões técnicas + changelog.
3. `docs/logica-negocio.md` — fórmulas e regras de cálculo do ERP (estoque, financeiro, jornada, integrações).
4. `mockups/*.html` — referência **visual e comportamental**. Ao implementar/ajustar uma tela, abra o mockup correspondente e replique layout, textos, estados vazios e interações.

| Mockup | Conteúdo |
|---|---|
| `mockups/regem-ui.html` | App principal (14+ telas): login RBAC, dashboard, escalas, tarefas/checklists, estoque/PVPS, fichas técnicas, vistorias, POP, desempenho, ponto gerencial, fornecedores, mural/clima, visão C&O, bot, wizard por ramo, auditoria |
| `mockups/regem-colaborador.html` | App mobile do colaborador (perfil execução) — 4 abas |
| `mockups/regem-kds.html` | KDS de alertas (app **independente**, rede local, tema escuro) |
| `mockups/regem-ponto.html` | Terminal de ponto (PIN → marcação → comprovante NSR) |

## Identidade Regem (⚠️ difere do mockup Omera)

- Nome **Regem**; logo = monograma **R.O. em órbita** (`components/brand/regem-mark.tsx`), NÃO o "Ω".
- **Cor de ação primária = DOURADO `#E2A340`** (marca Regem). O **verde `#0E7C66` é apenas status "ok/sucesso"**, não a primária (no mockup Omera o verde era primária — reconciliado; ver changelog em decisoes-design).
- Base clara `#EDF0F4`, sidebar navy `#0F2230`, tinta `#0F2230`. Tema claro escopado na classe **`.app-light`** (Shell).
- Fontes: **Archivo** (display/títulos/rótulos), **Figtree** (corpo), **JetBrains Mono** (KPIs, horários, códigos, valores).
- Apps satélites (KDS/Ponto): tema **escuro** de alto contraste (tokens próprios nos mockups).

## Regras invioláveis

- **RBAC no servidor, não no front.** Perfis: `presidente` > `gerente` > `supervisao` > `execucao`. A API não pode sequer retornar dados de views não permitidas ao perfil (ex.: gerente jamais recebe payload da Visão C&O). O front apenas oculta. Matriz completa em decisoes-design §3.
- **Multi-tenant desde sempre:** todo registro tem `tenant_id` (empresa) e, quando aplicável, `unidade_id` (= "loja" nos docs). Nenhuma query sem filtro de tenant.
- **A escala é a fonte da verdade.** Tarefas, checklists, ponto, timeline e delegação derivam dela. Hierarquia: `empresa → unidade → setor → função → colaborador → turno`. Tarefa com data/hora+setor resolve o colaborador escalado (gerente pode sobrescrever → gera auditoria).
- **Auditoria imutável (append-only):** toda mutação relevante registra `quem, perfil, ação, detalhe, origem, timestamp`.
- **Offline-first:** fila local de mutações com **ID idempotente** no cliente; conflito = **last-write-wins com log**; sincroniza ao reconectar; indicador visual de offline.
- **Ponto (Portaria 671/2021):** NSR sequencial por equipamento, comprovante, exportação AFD/AEJ; foto com `consentimento_lgpd` + `data_expurgo`. Modelar assim desde já.
- **LGPD:** consentimento + retenção para fotos (ponto/desperdício/vistoria); pesquisa de clima anônima; diretoria vê só o consolidado.
- **Módulos ativáveis** (KDS, Terminal de Ponto, App do Colaborador, Bot/IA): `presidente` liga/desliga por rede ou loja; desativar corta acesso na hora + audita.
- **KDS e Ponto são apps INDEPENDENTES** que falam com o app principal por **WebSocket na rede local** (descoberta mDNS/MAC não roda em navegador → app nativo/empacotado: Tauri/Electron Win, ou Android). Alertas entram no topo da fila com som. O mockup é referência de UI, não de arquitetura de rede.

## Convenções de código

- Front: componentes pequenos, um por arquivo; usar tokens (nada de cor crua/estilo inline repetido). Reusar `Shell`, `EntityForm`, `Card`, `Button`, etc.
- Acessibilidade: `aria-pressed` em toggles, `aria-expanded` em dropdowns, `caption` sr-only em tabelas, foco visível, `prefers-reduced-motion`.
- Textos em **pt-BR, sentence case, voz ativa** ("Salvar ficha"). Toda ação tem feedback (toast/estado). Estados vazios sempre implementados.
- Datas/horas **sempre com seletor nativo** (nunca digitação); selects que podem faltar item oferecem "＋ cadastrar nova".

## O que NÃO fazer

- Não inventar telas/fluxos sem mockup — pergunte.
- Não alterar paleta/tokens/tipografia sem aprovação.
- Não implementar RBAC só no front. Não guardar segredos em código.
- Não usar `localStorage` para dado de negócio (camada offline = IndexedDB).

## Estado atual da implementação (2026-07-02)

**No ar** (app.dmsregem.com / api.dmsregem.com): auth (senha+PIN), onboarding guiado (`/inicio`), **Dashboard** (`/painel`), **Meu Dia**, **Escala**, **Operação** (estoque/desperdício/vistoria), **Documentos** (checklist→POP + docs/ciência), **Cadastros** (hub), **Fichas Técnicas** (`/fichas`, CMV), **Visão C&O** (`/diretoria`, presidente), **POP & Guias** (`/guias`). Migrations 001–008 aplicadas.

**Pendente** (tem mockup, falta implementar): grade **semanal** de escala, **linha do tempo operacional**, **PVPS/lotes/validade** + **recebimento de nota**, **Pessoas & Ponto** (gerencial), **Fornecedores**, **Bot de Suporte**, **Wizard por ramo** (versão rica), **Log de Auditoria**, **upload de mídia**, e as frentes **Vendas & Comandas + Financeiro**. Apps satélites **KDS** e **Ponto** (independentes, WebSocket). *(Mural & Clima entregue — `/mural`, migration 026.)*

## Fluxo de trabalho

1. Tarefa grande: **plano antes do código** → aprovação → implementação (destacar migrations).
2. Uma tela/módulo por vez; ao concluir, **compare com o mockup e liste divergências**.
3. Decisões novas: registrar em `docs/decisoes-design.md` §6 (changelog).
4. Ordem de MVP sugerida: wizard por ramo → escalas → delegação de tarefas → checklist → desperdício/vistoria → exportação. Depois, o resto.
