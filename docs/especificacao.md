# Regem — Especificação do Produto

> Requisitos e conceito. Detalhes de tokens/RBAC/contratos em `decisoes-design.md`; referência visual em `mockups/`.

## 1. Visão

Plataforma de **gestão operacional** multi-ramo e multi-loja (SaaS), do **proprietário à ponta**. Objetivo: dar ao dono **controle total** da operação — escala, execução padronizada, qualidade, custo e pessoas — com adesão fácil no dia a dia. Ramo-âncora: **food service** (bares, restaurantes, fast food); arquitetura generaliza para varejo, indústria leve e serviços via **wizard por ramo**.

Valor de marca: quanto mais completo/configurado, maior o valor — o projeto vira **ativo de revenda** (módulos ativáveis, white-label futuro). Duas formas de uso: **digital** (apps) e **impressa** (POPs/guias exportados em PDF).

## 2. Hierarquia e papéis

`empresa (tenant) → unidade (loja) → setor → função → colaborador → turno`.

- **Presidente / C&O** — visão da rede, comparativo entre lojas, módulos on/off, auditoria, ranking (opaco a todos os outros).
- **Gerente** — operação completa da loja; aprova ajustes/extras; sobrescreve responsável (audita). **Não** vê relatórios da diretoria.
- **Supervisão** — dados e cadastros do(s) setor(es) que supervisiona.
- **Execução** — só segue o que está escalado: cumpre tarefas/POPs, conclui itens, registra quando designado. **Não preenche checklist nem faz cadastros** — apenas executa e marca "feito/não feito/parcial/impossibilitada".

Regem funciona **offline com sincronização** na rede interna (nó local por unidade) e consolida na nuvem para o dashboard do dono.

## 3. Pilares funcionais

### 3.1 A escala é a fonte da verdade
Tudo deriva da escala. **Etiquetas** (vagas) têm sigla + cor (cor = categoria; setor = agrupamento visual/ícone) e contador (AUXC1, AUXC2…). A tarefa é criada por **data/hora + setor/etiqueta** e o sistema resolve o **colaborador escalado** (late-binding). Gerente pode sobrescrever para diarista/PJ (gera auditoria). Modelos de escala BR: 6x1, 5x2, 12x36, 4x3, horista, diarista, PJ, autônomo. Alerta de **buraco de escala** (vaga descoberta).

### 3.2 Tarefas, checklists e POP
Checklist do turno é **acompanhado pelo gerente**; cada item pode ter **POP** (procedimento) com passos e foto/vídeo. Publicar um checklist gera um **POP versionado** (snapshot, exportável em PDF para treinamento/impressão). Tarefas de **ociosidade** podem ser adiantadas em baixa demanda. Tarefas proibidas no **pico** (janela configurável).

### 3.3 Qualidade: vistorias e desperdício
Vistorias de abertura/fechamento/padrão, com foto (obrigatória se o dono definir) e assinatura. Desperdício com registro rápido + foto. Ambos com data (permite retroativo).

### 3.4 Estoque, PVPS, recebimento e fichas técnicas
Estoque por **ledger** (saldo derivado de movimentos). **PVPS** (primeiro que vence, primeiro que sai) por lote/validade. **Recebimento**: foto da nota → dados extraídos → encaminha ao financeiro; itens "não veio" alimentam o **índice de faltas do fornecedor**. **Fichas técnicas** padronizam produção e calculam **CMV** (custo × FC ÷ rendimento vs. preço de venda) e a necessidade de compra.

### 3.5 Gamificação (opaca)
Boas ações somam, erros descontam (pode ficar negativo). Ranking e premiações são **visíveis apenas ao presidente** — nem o gerente vê o ranking geral (opacidade total é decisão de produto). Colaborador vê só a própria pontuação (no app dele).

### 3.6 Documentos controlados + ciência
Regimentos/treinamentos/comunicados versionados; colaborador dá **ciência** (assinatura), rastreável.

### 3.7 Pessoas & Ponto
Espelho de ponto (jornada real × escala), extras e ajustes com aprovação; terminais pareados. Estrutura compatível com **Portaria 671/2021** (NSR, comprovante, AFD/AEJ) desde já.

### 3.8 Multiunidade / Visão C&O
Consolidado da rede: faturamento (quando houver Vendas), CMV, desperdício, aderência a checklists, comparativo entre lojas, conformidade/licenças (alertas 60/30/15 dias), relatórios agendados. **Restrito ao presidente**.

### 3.9 Módulos satélites e integrações
- **KDS** (rede local, WebSocket): fila de alertas do gerente com som e "CIENTE"; prioriza o pico.
- **Terminal de Ponto** (PIN/crachá/facial → marcação → comprovante NSR; fila offline).
- **App do Colaborador** (Hoje/Tarefas/Escala/Pontos).
- **Bot de suporte** (respostas predefinidas por gatilho; escala p/ gerência; elogios viram pontos).
- **API pública + webhooks** (delivery, WhatsApp, contabilidade).

## 4. Entitlements / revenda
Módulos (KDS, Ponto, App Colaborador, Bot/IA…) são **feature flags** ligadas/desligadas pelo presidente por rede ou por unidade; desativar corta acesso na hora e audita. Base para planos e revenda.

## 5. Não-funcionais
Multi-tenant rígido (nunca query sem `tenant_id`); **RBAC no servidor**; auditoria imutável; offline-first (fila idempotente, LWW + log); LGPD (consentimento/retenção de fotos, clima anônimo); acessibilidade; pt-BR.

## 6. Ordem de MVP
1. Wizard de configuração por ramo → 2. Escalas → 3. Delegação de tarefas → 4. Checklist/POP → 5. Desperdício/vistoria → 6. Exportação (PDF/planilha). Depois: fichas/CMV, multiunidade, ponto, fornecedores, mural, bot, KDS. *(Núcleo 1–6 + fichas/CMV + multiunidade + POP já implementados — ver CLAUDE.md "estado atual".)*
