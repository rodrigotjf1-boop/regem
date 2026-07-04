# Regem — Decisões de Design e Contratos de Dados

> Documento vivo. Toda decisão nova aprovada em sessão vai no changelog (§6). Fonte: mockups em `mockups/`. **Nota de nomenclatura:** nos contratos abaixo, `loja` = `unidade` no schema; `tenant` = `empresa`.

---

## 1. Identidade

- Conceito: "no comando de todo o negócio, do balcão ao balanço". Autoridade + operação saudável.
- Logo: monograma **R.O. em órbita** (Rodrigo Oliveira), anel dourado. (Nos mockups aparece "Ω" — placeholder Omera; usar sempre o `RegemMark`.)
- Assinatura visual do produto: **Linha do Tempo Operacional** — o dia da loja em faixas horizontais por setor, com marcador "AGORA" em tempo real.

## 2. Design tokens

### 2.1 Tema claro (app principal + app do colaborador) — classe `.app-light`

```css
.app-light{
  /* superfícies */
  --canvas:#EDF0F4;      /* fundo geral (cinza-azulado frio) */
  --surface:#FFFFFF;     /* cards */
  --surface-2:#F6F8FA;   /* áreas rebaixadas, tracks, inputs */
  --line:#DCE3E9;        /* bordas */
  --line-2:#C6D0D9;      /* bordas de inputs */
  /* tinta */
  --ink:#0F2230;         /* texto principal / sidebar (petróleo) */
  --ink-2:#3D5566;       /* secundário */
  --ink-3:#7A8FA0;       /* terciário, rótulos */
  /* AÇÃO PRIMÁRIA / MARCA = ÂMBAR (Regem). ⚠️ Âmbar é SEMPRE ação/marca —
     nunca cor de estado. (mockups Fable 2026-07-02) */
  --primary:#E8A845;     --primary-ink:#2A1D06;
  /* semânticas de status — dessincronizadas do âmbar de propósito */
  --ok:#1FA875;  --ok-soft:#E1F3EC;    /* verde: sucesso/operação saudável */
  --warn:#E06A3C; --warn-soft:#FCEAE1; /* laranja-avermelhado: atenção/pendência (NÃO é âmbar) */
  --danger:#D64545; --danger-soft:#FAE4E4; /* vermelho: crítico (dark: #E05252) */
  --info:#3A7FB8; --info-soft:#E4EFF7;
  /* forma e tipografia */
  --radius:10px; --radius-lg:14px;
  --font-display:'Archivo',sans-serif;    /* títulos, rótulos caps, marca */
  --font-body:'Figtree',sans-serif;       /* corpo */
  --font-mono:'JetBrains Mono',monospace; /* KPIs, horários, valores, códigos */
}
```

### 2.2 Tema escuro (KDS e Terminal de Ponto — leitura à distância)

```css
:root{
  --bg:#0B141B;     /* KDS */   /* Ponto: #0F2230 */
  --panel:#12202A;  /* Ponto: #16303F */
  --panel-2:#182B37;/* Ponto: #1D3B4D */
  --line:#24394699; /* Ponto: #2A495C */
  --text:#EAF2F7; --text-2:#8FA9BA;
  --ok:#19C08F; --warn:#FFB13D; --danger:#FF5A4E; --info:#4AA8E0;
}
```

### 2.3 Regras de uso

- **Dourado (`--primary`)** é a única cor de ação primária/CTA e de marca. **Verde (`--ok`)** = status de sucesso, nunca CTA. **Âmbar (`--warn`)** nunca é ação primária, só alerta/correção.
- Números sempre em `--font-mono` (KPIs, horários, NSR, preços, pontos).
- Rótulos de seção/setor: Archivo 700, caps, letter-spacing `.12em–.18em`, 10–11px.
- Status nunca por cor apenas: sempre acompanha texto na `Tag`.
- Avatares: iniciais sobre cor derivada do id do colaborador (paleta `#0E7C66 #2C6E9B #6B3FA0 #8A5A10 #C2453A`).

## 3. Matriz RBAC (view × perfil) — **aplicada no servidor**

Perfis (categoria da hierarquia): `presidente` > `gerente` > `supervisao` > `execucao`.

| View / recurso | presidente | gerente | supervisao | execucao |
|---|:--:|:--:|:--:|:--:|
| dashboard | ● | ● | ◐ (só seu setor) | ✕ |
| escalas | ● | ● CRUD | ◐ leitura do setor | ◐ só as próprias (app) |
| tarefas / checklists | ● | ● CRUD | ● CRUD no setor | ● concluir apenas |
| estoque / recebimento | ● | ● | ● registrar no setor | ✕ |
| fichas técnicas | ● | ● | ◐ leitura | ✕ |
| vistorias / desperdício | ● | ● | ● registrar no setor | ● quando designado |
| POP & guias | ● | ● CRUD | ● CRUD no setor | ◐ leitura |
| desempenho / gamificação | ● rede | ● loja | ◐ setor | ◐ só o próprio |
| pessoas & ponto (gerencial) | ● | ● aprova ajustes/extras | ✕ | ◐ espelho próprio (app) |
| fornecedores | ● | ● | ✕ | ✕ |
| mural & clima | ● rede | ● loja | ● setor | ◐ lê e responde |
| **visão C&O (relatórios rede)** | ● | ✕ **nunca** | ✕ | ✕ |
| **bot (editar regras)** | ● | ◐ consulta log | ✕ | ✕ |
| **módulos on/off** | ● | ✕ | ✕ | ✕ |
| wizard de configuração | ● | ● | ✕ | ✕ |
| log de auditoria | ● rede | ● loja | ✕ | ✕ |

Legenda: ● acesso/edição · ◐ só leitura (escopo indicado) · ✕ a API não retorna o recurso.

Adicionais: `gerente` pode ser a mesma pessoa que `presidente`. `supervisao` tem escopo = setor(es) atribuído(s). Sobrescrever responsável de tarefa: `gerente`+; sempre audita.

## 4. Contratos de dados (referência p/ a API)

### 4.1 Hierarquia base
```json
{ "empresa": {"id":"t_01","nome":"Grupo Vieira"},
  "unidade": {"id":"l_01","tenant_id":"t_01","nome":"Loja 01 — Centro","ramo":"food_service"},
  "setor":   {"id":"s_coz","unidade_id":"l_01","nome":"Brigada de Cozinha"},
  "funcao":  {"id":"f_sous","setor_id":"s_coz","nome":"Sous-chef","categoria":"supervisao"},
  "colaborador": {"id":"c_042","unidade_id":"l_01","funcao_id":"f_sous","nome":"Paulo Lima",
    "matricula":"00042","vinculo":"clt","escala_modelo":"6x1",
    "lgpd":{"consentimento_foto":true,"data_consentimento":"2026-01-10"}} }
```

### 4.2 Escala e turno
```json
{ "turno": {"id":"sh_9911","colaborador_id":"c_042","unidade_id":"l_01","setor_id":"s_coz",
  "data":"2026-07-02","inicio":"08:00","fim":"17:00","intervalo_previsto":"12:00",
  "modelo":"6x1","tipo":"regular"} }
```
Modelos: `6x1, 5x2, 12x36, 4x3, horista, diarista, pj, autonomo`. `tipo`: regular | plantao_12x36 | diaria | pj | folga | descoberto.

### 4.3 Timeline operacional — `GET /unidades/{id}/timeline?data=YYYY-MM-DD`
Formato do `TIMELINE_DATA` do mockup (horas decimais, janela 06–22 configurável):
```json
[ { "setor":"Cozinha", "blocos":[
  { "ini":10.8, "fim":16.2, "rot":"Linha do almoço", "quem":"Sous-chef P. Lima",
    "colaborador_id":"c_042", "st":"exec" } ] } ]
```
`st`: ok | exec | atencao | feito.

### 4.4 Tarefa e checklist
```json
{ "tarefa": {"id":"tk_501","setor_id":"s_coz","data":"2026-07-02","hora":"14:30",
  "titulo":"Higienização de bancadas pós-almoço",
  "responsavel":{"colaborador_id":"c_042","origem":"escala"},
  "pop_id":"POP-COZ-004","status":"pendente","ociosidade":false,
  "conclusao":{"quando":null,"por":null,"foto_url":null}} }
```
`origem`: escala | manual (manual audita). `status`: pendente | concluida | atrasada | impossivel.

### 4.5 Ponto (Portaria 671/2021)
```json
{ "marcacao": {"nsr":"000048292","equipamento_id":"PONTO-ENTRADA-01","colaborador_id":"c_042",
  "tipo":"entrada","timestamp":"2026-07-02T07:54:12-03:00","turno_id":"sh_9911",
  "hash_integridade":"sha256:…","foto":{"url":null,"consentimento":true,"data_expurgo":"2027-07-02"},
  "origem":"terminal","geoloc":null,"offline_sync":false} }
```
`tipo`: entrada | inicio_intervalo | fim_intervalo | saida. `origem`: terminal | celular_geolocalizado.

### 4.6 Estoque, PVPS e recebimento
```json
{ "item_estoque": {"id":"i_tom","nome":"Tomate italiano","unidade":"kg","lote":"L-2481",
    "quantidade":6,"vencimento":"2026-07-04","posicao_pvps":"frente"},
  "recebimento": {"id":"rc_301","fornecedor_id":"fo_01","nf":"48211","foto_nota_url":"…",
    "itens":[{"item_id":"i_tom","qtd_nf":10,"qtd_recebida":10,"status":"ok"},
             {"item_id":"i_ceb","qtd_nf":5,"qtd_recebida":0,"status":"nao_veio"}],
    "encaminhado_financeiro":{"quando":null,"formato":"json"}} }
```
Índice de faltas do fornecedor = `nao_veio / total_itens` acumulado. `posicao_pvps`: frente | fundo (fundo = inconformidade).

### 4.7 Ficha técnica (alimenta CMV e compras) — **implementado**
```json
{ "ficha": {"id":"FT-021","nome":"Molho base de tomate","setor_id":"s_coz",
  "rendimento":{"qtd":10,"unidade":"porcao_500ml"},"validade_pos_producao_dias":6,
  "ingredientes":[{"item_id":"i_tom","qtd_liquida":4.5,"fc":1.15,"custo_unit_ref":"ultimo_recebimento"}],
  "preco_venda":14.90,"meta_cmv_pct":31.5,"pop_id":"POP-COZ-002",
  "passos":[{"ordem":1,"texto":"…","midia_url":null}]} }
```
Cálculo: `custo_total = Σ(qtd × fc × custo_unit)`; `custo_porcao = custo_total / rendimento`; `cmv = custo_porcao / preco_venda`.

### 4.8 Gamificação — **implementado**
```json
{ "ocorrencia": {"colaborador_id":"c_042","tipo_id":"oc_cobriu_turno","pontos":8,
  "registrado_por":"c_gerente","origem":"manual"} }
```
Pode ficar negativa. Ranking é **opaco**: só o `presidente` vê (nem o gerente). Tipos/premiações predefinidos pelo presidente.

### 4.9 Auditoria (imutável, append-only)
```json
{ "auditoria": {"id":"au_88","tenant_id":"t_01","unidade_id":"l_01",
  "quando":"2026-07-02T13:40:00-03:00","quem":{"colaborador_id":"c_ger","perfil":"gerente"},
  "tipo":"ponto","acao":"aprovou_hora_extra",
  "detalhe":{"alvo":"c_jul","valor":"+1h10","ref":"2026-07-01"},"origem":"web"} }
```
`tipo`: escala | ponto | recebimento | checklist | modulos | vistoria | bot | mural. `origem`: web | mobile | app_colaborador | kds | terminal.

### 4.10 Bot de suporte
```json
{ "regra_bot": {"id":"rb_01","tipo":"pedido_atrasado",
  "gatilhos":["atraso","demorando","cadê meu pedido"],
  "resposta":"Seu pedido está em preparo prioritário. Tempo: {tempo_estimado}.",
  "canais":["delivery"],"escalar":{"modo":"condicional","condicao":"atraso_min > 15"},
  "ativa":true,"editavel_por":"presidente"} }
```

### 4.11 Módulos (feature flags)
```json
{ "modulos":{"app_colaborador":true,"kds":true,"terminal_ponto":true,"bot_ia":false},
  "escopo":"rede" }
```
`escopo`: rede | unidade:{id}. Alteração só por `presidente`, sempre audita.

## 5. Arquitetura dos módulos satélites

| Módulo | Plataforma real | Comunicação | Observações |
|---|---|---|---|
| **KDS** | app nativo/empacotado (Tauri/Electron Win · Android) | **WebSocket na rede local**; descoberta mDNS; MAC cadastrado no servidor | Web não acessa MAC/mDNS → mockup é referência de UI. Alertas entram no topo da fila com som |
| **Terminal de Ponto** | tablet Android ou desktop empacotado | HTTPS + fila offline local | NSR por equipamento; exporta AFD/AEJ |
| **App Colaborador** | PWA ou app (React Native) | HTTPS + IndexedDB offline | Só leitura + concluir tarefas; sem cadastros |
| **Integrações externas** | — | API pública (OpenAPI) + webhooks | Delivery, WhatsApp Business, contabilidade |

## 6. Changelog de decisões

| Data | Decisão | Motivo |
|---|---|---|
| 2026-07-02 | RBAC no servidor; matriz §3 aprovada | Hierarquia é pilar do produto |
| 2026-07-02 | Timeline usa contrato §4.3 (horas decimais, janela configurável) | Mockup já renderiza deste formato |
| 2026-07-02 | Offline: last-write-wins + log de conflito; IDs idempotentes no cliente | Simplicidade no MVP |
| 2026-07-02 | Ponto estruturado p/ Portaria 671/2021 (NSR/AFD/AEJ) desde o MVP | Evitar retrabalho legal |
| 2026-07-02 | KDS/Ponto como apps independentes com WebSocket local | Limitações do navegador |
| 2026-07-02 | **Marca Regem: ação primária = DOURADO `#E2A340`; verde `#0E7C66` vira status "ok"** (mockup Omera usava verde como primária) | Decisão de marca do usuário ("Dourado Regem") |
| 2026-07-02 | Nomenclatura: `loja`=`unidade`, `tenant`=`empresa` no schema | Alinhar contratos ao schema Drizzle existente |
| 2026-07-02 | **Landing pública em `/`; login movido para `/entrar`** (redirects de auth/logout atualizados) | Ter tela de marketing antes do login (ref. brand-kit "Topo de landing page") |
| 2026-07-02 | **Fase F-A: tempo real via socket.io.** Gateway NestJS com rooms por tenant/unidade; handshake por JWT (gestor) ou token de equipamento (device). Eventos `ponto:marcado`, `kds:alerta`, `device:status`. Tabela `equipamento` (migration 015) + **NSR agora por equipamento** (Portaria 671). Superfície de teste: `/kds` web (tema escuro). | Base dos apps satélites. Escolha do usuário (socket.io + NSR por equipamento já). Packaging nativo/mDNS = Fase F-B |
| 2026-07-02 | **Conflito de cor resolvido (mockups Fable):** âmbar `#E8A845` é SÓ marca/ação; atenção passa a laranja-avermelhado `#E06A3C`, crítico vermelho `#E05252`/`#D64545`, verde segue "ok". Fontes do tema escuro unificadas em Archivo/Figtree/JetBrains (era Sora/Inter). Tokens em `globals.css`. | Se alertas ficassem âmbar, o usuário não distinguiria "ação" de "algo errado" |
| 2026-07-03 | **Hardening P1 (branch `hardening`):** `empresa.controller` protegido (só a empresa do token; POST/findAll removidos — vazamento cross-tenant sanado); `main.ts` com helmet + **fail-fast** de `JWT_SECRET` e de `CORS_ORIGIN` em produção; `@nestjs/throttler` global (120/min) + 5/min em `login`/`pin`/`register`; **lockout de PIN** (10 falhas/15 min por unidade) com falhas registradas na auditoria. | Exposição de dados em produção com auto-deploy ligado; anti brute-force/spam |
| 2026-07-03 | **CI/CD P2:** `.github/workflows/ci.yml` roda `npm ci` + `npm run build` (+ `npm test`) em backend e frontend a cada push/PR. Push em `main` exige CI verde (branch protection + PR). Documentado no CLAUDE.md. | Portão de qualidade antes do auto-deploy |
| 2026-07-03 | **Testes P3:** Jest no backend + regras críticas isoladas em `src/common/regras-negocio.ts` (usadas pelos services): custo médio ponderado, saldo do ledger, retry de NSR (23505), late-binding tarefa→escala, recorrência de títulos. 16 testes verdes. | Cobrir 100% as regras de cálculo de dinheiro/ponto |
| 2026-07-03 | **RBAC por escopo P4 (§3):** escopo `setor`/`unidade` resolvido no login (via `função→setor→unidade`, sem migration) e embutido no JWT; guard injeta `setorId`/`unidadeId`; `escopoPermiteSetor` (supervisor só o próprio setor) com testes. Filtro aplicado no `desperdicio.findAll` como referência — **rollout aos demais endpoints operacionais é incremental**. | Guard validava só a categoria, não o escopo |
| 2026-07-03 | **Auditoria P5:** migration 023 torna `audit_log` **append-only** (trigger aborta UPDATE/DELETE). Auditoria adicionada à conclusão de tarefa e submissão/publicação de checklist (onboarding template e alocação de escala já auditavam). **Ainda sem auditoria (rollout incremental, menor risco):** CRUD de colaborador/função e demais cadastros de configuração, override de tarefa, movimento manual de estoque. | Trilha imutável e cobertura das mutações sensíveis |
| 2026-07-03 | **Contrato de API P6:** `@nestjs/swagger` (plugin auto-anota DTOs no build); `/api/v1/docs` exposto (em prod só com `SWAGGER_ENABLED=true`); `npm run openapi` gera `docs/openapi.json` a partir do `dist`. Referenciado no CLAUDE.md. | Contrato versionado para integrações externas (Fase K) |
| 2026-07-03 | **Sessão no front P7:** qualquer 401 limpa o token e redireciona para `/entrar?expirada=1` (banner amigável); erro de rede distinto de erro de API. **Decisão consciente:** manter o JWT em `localStorage` no MVP (app e API em domínios distintos — `app.` × `api.`). **Plano:** migrar para cookie `httpOnly` quando houver domínio unificado (mitiga XSS). | Sessão previsível + decisão de segurança registrada |
| 2026-07-03 | **Portão de CI = por disciplina (opção B):** branch protection não é aplicada em repo privado no plano grátis do GitHub (exige Team/Enterprise). Regra criada em `main` mas "not enforced"; adotado o fluxo branch→PR→CI verde→merge por convenção. Migrar para Team quando o time crescer. | Limitação de plano do GitHub |
| 2026-07-03 | **Fase ERP passo 1+2** (ver `logica-negocio.md`): ledger de estoque ganha `ref_tipo`/`ref_id` (idempotência via índice único) + `POST /producao` (explosão de ficha: baixa insumos ao custo médio, entrada do produto ao custo teórico). Migration 024. Fichas aninhadas ficam de fora (schema não referencia sub-ficha) e `vendas.baixaFicha` ainda sem `ref_*` (follow-up). | Destravar o motor de estoque/custo sem depender de PDV |
| 2026-07-03 | **ERP passo 3** (ver `logica-negocio.md`): ROP real (dias_seguranca + qtd sugerida) e view de **validades FEFO** no `/estoque`; **jobs** 06:00 (ponto de pedido) e 06:10 (validades) emitindo alerta em tempo real ao KDS. Sem migration. | Automatiza compra e reduz perda |
| 2026-07-03 | **ERP passo 4** (ver `logica-negocio.md`): snapshot de estoque (endpoint + cron mensal) + **CMV real × teórico → desvio** (`/estoque/cmv`) com card no `/estoque`. Sem migration (usa `estoque_snapshot` da 024). "Furo" (desvio − desperdício) pendente pois desperdício não liga a item/custo. | O KPI de ouro que diferencia o produto |
| 2026-07-03 | **ERP passo 6 (jornada)** + **Furo de CMV**: espelho de ponto ganha prévia gerencial (extra 50/100%, noturno 22h–5h, DSR estimado; sem migration); desperdício vinculável a item baixa estoque e fecha **furo = desvio − desperdício** (migration 025). Ver `logica-negocio.md`. | Fecha jornada e o ciclo de custo |
| 2026-07-03 | **Mural & Clima** (migration 026): comunicados com **leitura rastreável** (`comunicado`/`comunicado_leitura`) + **pesquisa de clima anônima**. **Decisão de privacidade (LGPD):** `clima_resposta` não guarda `colaborador_id`; a contagem "N/total" e a trava de voto duplo vêm de `clima_participacao` (separada), sem ligar pessoa→resposta; API só devolve o consolidado. Publicar/criar = gestor; ler/responder = qualquer autenticado. Tela `/mural`. | Engajamento de equipe com anonimidade garantida no schema |
| 2026-07-03 | **Bot de Suporte** (migration 027): bot de **regras por palavra-chave** (não IA generativa) — `bot_regra` (tipo, gatilhos, resposta, escala nunca/sempre/condicional) + `bot_atendimento` (log → métrica). Casamento é função pura `casarRegraBot` (normaliza acento/caixa). Editar regras = **presidente** (mockup: "só Proprietário / C&O"); listar/métricas = gestor; perguntar = qualquer autenticado. Sem match ou regra 'sempre' → escala para humano. Tela `/bot` (tabela + chat de teste). | Suporte de 1º nível automatizável sem custo de LLM |
| 2026-07-03 | **Wizard por ramo (versão rica)** (sem migration — blueprints hardcoded em `onboarding/templates.ts`): 4 ramos (food_service/varejo/industria_leve/servicos) com setores+funções sugeridos. Wizard `/wizard` em 4 passos (ramo → setores → funções → escalas + resumo) com chips selecionáveis; `POST /onboarding/wizard` cria **só o selecionado** (setores/funções/etiquetas) em transação + auditoria `aplicou_wizard`. Reusa `setor`/`funcao`/`etiqueta`; `/inicio` e `POST /onboarding/template` (pacote completo) seguem intactos. Escalas = informativas. RBAC presidente/gerente. | Ativação com menos atrito, customizável por ramo |
| 2026-07-03 | **Fichas técnicas aninhadas** (migration 028: `ficha_ingrediente.sub_ficha_id`): um ingrediente pode ser item de estoque, **sub-receita** (outra ficha) ou avulso. Custo é **recursivo** (sub-ficha entra pelo custo/porção — pura `custoTotalFicha` com memo+guarda de ciclo); explosão de `POST /producao` é **recursiva** até os itens-raiz (agrega consumo, `visitados` anti-ciclo). Ciclo (direto/transitivo) barrado na escrita (`fichaAlcancavel`) + safety net na leitura (ramo repetido = 0). Front `/fichas` com seletor de sub-receita. | Aprofunda o motor de CMV/explosão p/ food service real |
| 2026-07-03 | **Revisão geral** (migration 029): corrigido bug — `vendas.baixaFicha` não explodia sub-fichas (venda com sub-receita não baixava insumos aninhados → CMV distorcido), agora recursiva. **Mural escopado por unidade** (`colaborador.unidade_id`; feed rede+loja; "alvo" por comunicado). **Venda idempotente** (`comanda.idempotency_key` único por tenant; PDV gera chave estável). **Wizard idempotente** (reusa setor/função por nome). **Clima** só revela consolidado com ≥3 respostas (anti-deanonimização). **Bot** métrica "hoje" no fuso America/Sao_Paulo. | Robustez multi-loja + integridade dos números |
| 2026-07-04 | **P-UI1 — Shell responsivo** (migration 030: `colaborador.ui_prefs jsonb`): prefs `{sidebar:expanded\|collapsed, side:left\|right}` no **localStorage `regem_ui`** (paint) + **servidor** (`GET/PATCH /colaborador/me/prefs`, fonte da verdade entre dispositivos; puras `sanitizeUiPrefs`/`mergeUiPrefs` testadas). Shell via **CSS Grid** com `[data-side]`/`[data-collapsed]` e `order` (markup único, 240/72px, `prefers-reduced-motion`); recolhido = ícones+tooltip, rótulos viram divisores, logo→monograma, botão recolher com `aria-expanded` + atalho **`[`**; **<860px = drawer** off-canvas do lado escolhido (Esc/clique-fora, **foco preso**, hambúrguer no mesmo lado). Menu da conta com **Preferências** (destro/canhoto + recolher). Toasts espelhados: adiado (sem toast global hoje). | Fundação responsiva/ergonômica (base do P-UI2/3) |
| 2026-07-04 | **Toast global** (sem migration): `lib/toast.ts` (pub/sub singleton — chamável de qualquer lugar) + `<Toaster>` no `layout.tsx`, `aria-live`, auto-dismiss. **Espelha para o lado oposto à sidebar** (lê `regem_ui.side`) — não nasce sob o polegar que navega (fecha o detalhe adiado do P-UI1). Adotado em `/estoque` (snapshot/alertas) e `/pdv` (venda); adoção nas demais telas é incremental. | Feedback consistente + ergonomia canhoto/destro |
| 2026-07-04 | **Alertas de estoque persistidos** (migration 031: `alerta_estoque`): ROP e FEFO deixam de ser só eventos efêmeros — os jobs (06:00/06:10) **gravam** um alerta por (tenant, tipo) via upsert-por-aberto (índice único parcial), **auto-resolvem** quando a condição some, e ainda emitem o evento em tempo real. `GET /estoque/alertas` + `POST /estoque/alertas/:id/resolver` (gestor); card no `/estoque` com "Resolver". | Alertas confiáveis (sobrevivem, listam, resolvem) |
| 2026-07-04 | **NOVA ROTA — Arquitetura Edge** (`docs/arquitetura-edge.md`): substitui "satélites nativos/mDNS" por **local-first** (servidor local = PDV com Postgres + sync direcional com a nuvem). **Slice 1 (sem migration):** config direcional `TABELAS_SYNC` (sobe/desce/ambos + cursor), função pura **`venceLWW`** (last-write-wins + desempate por id, testada) e **`GET /sync/pull?desde=`** (deltas de controle por cursor, tenant do token, whitelist de tabelas). v2: `POST /sync/push` + sequência monotônica (migration) + tombstones + token de serviço. | Operar offline na loja; sync/backup na nuvem |
| 2026-07-04 | **Sync Edge slice 2** (sem migration): **`POST /sync/push`** (ingestão do operacional local→nuvem, append-only). **Segurança 1ª classe:** autenticação por **token de dispositivo** (`equipamento.tipo='servidor_local'`, guard `SyncTokenGuard`, header `x-sync-token`) em vez de JWT de presidente; **`tenant_id` FORÇADO** ao do token (ignora o da linha); **whitelist de tabelas** (`TABELAS_PUSH`) + **colunas por introspecção** (só colunas reais); identificadores via `sql.identifier`; idempotente (`on conflict (id) do nothing` + trata 23505); limites de payload. **Redação de segredos no pull** (`colaborador.senha_hash/pin_hash` nunca saem — PIN 4 díg. é brute-forçável offline). v3: LWW-update ('ambos'), sequência monotônica, tombstones. | Sync seguro sem confiar no cliente |
| 2026-07-04 | **Sync Edge slice 3 — LWW-update** (sem migration): `POST /sync/push` passa a aceitar as tabelas **`ambos`** (`item_estoque`, `fornecedor`) com upsert **last-write-wins**: `on conflict (id) do update` só se a linha recebida for **mais nova** (`updated_at`) **e do mesmo tenant** (`where <t>.tenant_id = excluded.tenant_id`) — nunca sobrescreve `id`/`tenant_id`. Fecha o caminho bidirecional das tabelas mutáveis. Config `modoPush(tabela)` → append\|lww\|null. v4: sequência monotônica (cursor à prova de clock-skew, migration) + tombstones (hard-deletes/soft-delete que não bumpa `updated_at`). | Bidirecional seguro do estoque/custo |
| 2026-07-04 | **Sync Edge slice 4 — soft-deletes** (sem migration): `GET /sync/pull` passa a incluir no delta as linhas com `deleted_at > desde` (por introspecção, só onde a coluna existe) → **exclusões propagam** mesmo sem bump de `updated_at`. **Decisão de segurança:** sequência monotônica + tombstones de **hard-delete** exigem **triggers nas tabelas centrais** e **não serão deployados sem ambiente de teste** (trigger com erro derruba todos os writes) — **adiado para a Fase 2** (Postgres local valida o CDC antes). | Excluir propaga sem risco; CDC perigoso fica pra ambiente testável |
| _adicionar novas linhas aqui_ | | |
