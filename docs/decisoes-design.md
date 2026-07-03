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
| _adicionar novas linhas aqui_ | | |
