# Plano — Mister (camada de agentes de controle)

> **Status:** PROPOSTO. A **F0 (levantamento)** foi feita em 12/11/2026 sobre `origin/main` `7b7a573f`, só com leitura do código. Nada da F1 em diante está implementado. Cada fase espera o "pode" do dono; decisões novas se registram em `docs/decisoes-design.md` §6 quando forem aprovadas.

## 0. O que é

O **Mister** é o administrador virtual do Regem: um coordenador que observa a operação, responde consultas do gestor, acompanha dependências e propõe ações, sempre dentro das permissões do backend. O desenho completo (papéis, contratos e critérios de aceite) está na especificação do dono, versão 1.2. Este documento é a parte que cabe no repositório: **o que já existe para reaproveitar, o que falta, e o plano da primeira fase de código (F1)**.

Três decisões de desenho valem para todas as fases:

1. **A IA roda na nuvem da distribuição**, num processo separado da API de venda. O servidor da loja fica com detecção e alerta por regras fixas, que funcionam sem internet, e com a execução de procedimentos do catálogo. A chave do provedor de IA não vai para a loja (o código atual já segue isso: copiloto do atendimento e marcações do Instagram só rodam na nuvem).
2. **Primeiro os olhos, depois a IA.** A F1 não usa IA: são monitores em código. O laço de IA só entra na F2.
3. **Em cima do que existe.** Nada de segunda central, segundo padrão de credencial ou segundo canal de aviso: o levantamento abaixo mostra o que reaproveitar.

## 1. O que já existe (levantamento da F0)

Estado de cada item: **[C]** confirmado no código · **[D]** só na documentação · **[A]** ausente.

### 1.1 Saúde do servidor da loja

- **[C]** O servidor da loja manda uma batida a cada ciclo do sync (60 s por padrão) para a nuvem (`backend/edge/sync-daemon.mjs`, `heartbeat` e `coletarSaude`; nuvem em `modules/licenca/licenca.service.ts`, `heartbeat`).
- **[C]** A batida do fim do ciclo traz a saúde completa: os 5 serviços do Windows (api, web, sync, impressao, pg), disco livre, RAM, desvio do relógio, backup (quando, tamanho, erro), tamanho e integridade do banco, impressoras sem responder, impressoras com aviso (sem papel, tampa), fila por impressora, estações de impressão, rede e PCs conectados, conferência de pedidos e desde quando o sync falha.
- **[C]** `edge_status` guarda **o último sinal de cada servidor** (uma linha por equipamento). `edge_heartbeat` virou amostra de 30 minutos, com 30 dias de retenção: não serve para "agora".
- **[C]** Quem lê: o console da distribuição (`/distribuicao`, selos por serviço, disco, backup), a tela "Servidor local" da loja, Equipamentos, e várias decisões de roteamento (`common/edge-ativo.ts`, fallback de pedidos, impressão).
- **[C]** A tradução da saúde para o que a loja pode ver já existe (`saudeDoLojista`): diagnóstico de infraestrutura é da distribuição; a loja recebe só "acione o suporte".
- **[A]** Ninguém é avisado quando o servidor some, um serviço para, o disco enche ou o backup atrasa. Existem só selos nas telas, para quem abrir a tela.
- **[A]** Histórico de transições (online → fora → voltou) e conceito de incidente com começo e fim.
- **[D]** `docs/plano-frota-edge.md` ainda descreve o alerta de serviço caído como plano; a coleta da saúde já está no código, o alerta não.

### 1.2 Telemetria de erros

- **[C]** Erros do servidor da loja, da nuvem, do daemon, do instalador e do navegador chegam a `telemetria_evento`, com deduplicação por assinatura da mensagem e redação de dado pessoal (`modules/edge/edge.service.ts`, `registrarTelemetria`).
- **[C]** A primeira ocorrência de cada assinatura avisa a distribuição por webhook. Reocorrência só soma no contador.
- **[C]** Aparece no console da distribuição (aba Telemetria), com "marcar resolvido".
- **[A]** Dono, prazo e estado de incidente. A telemetria é registro de erro, não fila de trabalho.

### 1.3 Comandos para o servidor da loja

- **[C]** `edge_comando`: a nuvem enfileira, o servidor da loja busca na batida e confirma (`common/edge-comando.ts`; execução em `sync-daemon.mjs`). Comandos de hoje: `rollback`, `testar_impressora`, `imprimir`, `imprimir_danfe`, `alterar_pedido`.
- **[A]** Prazo de validade, verificação posterior do efeito e catálogo com pré-condições. É o que a F4 (propor e aprovar) acrescenta.

### 1.4 Avisos que já chegam a uma pessoa

| Canal | Quem recebe | O que leva hoje | Onde está |
|---|---|---|---|
| Rodapé do KDS | quem está na cozinha ou no despacho | alertas cadastrados, estoque, gestão, compras, contagem, manutenção, Farol; com "Ciente" e histórico de 90 dias | evento `kds.alerta.sistema` → `modules/kds/alerta-kds.service.ts`, tabela `alerta_kds` |
| Central de atendimento | equipe com a permissão de pedidos, em qualquer tela (sino) e no app | casos de cliente e casos abertos pelo sistema (ex.: estorno de Pix que não saiu) | `atendimento_chamado` + evento `atendimento.novo` |
| "Ninguém pegou" | gerente e presidente | caso aberto que ninguém pegou no tempo do ajuste | `modules/atendimento/fila-e-avisos.service.ts` |
| Gerente no WhatsApp | gerente e presidente com o telefone ligado | decisões (disputa, cancelamento) e casos que ninguém pegou | `modules/atendimento/gestor-whatsapp*.ts`, mig 375 |
| Telemetria + webhook | distribuição | erros (1.2) | `edge.service.ts` |
| Ícone da bandeja | quem está no PC do servidor | PDV, estação ou KDS que caiu | `modules/bandeja`, `backend/edge/bandeja` |

- **[A]** Central de notificações genérica do gestor. O sino do topo é só do atendimento.
- **[A]** Função genérica "avisar o gestor pelo WhatsApp": o envio de hoje é amarrado ao caso do atendimento (tabela, tipos e modelo aprovado na Meta).

### 1.5 Sinais de operação

- **[C]** Pedido: estados em `pedido_externo`, `comanda` e `producao_pedido`; aceite automático; resgate pela nuvem quando o servidor da loja não responde (`modules/delivery/cloud-fallback.processor.ts`), que hoje só registra em log.
- **[A]** Monitor de pedido parado numa etapa (novo sem aceite em loja de aceite manual, pronto sem despacho, despachado sem concluir). Hoje só há sinais visuais na tela ("Atrasados").
- **[C]** Fiscal: nota em estado desconhecido é reconsultada com intervalos crescentes; contingência tem ciclo próprio; a tela `/notas` mostra pendências.
- **[A]** Aviso quando a reconsulta se esgota, quando o prazo da contingência aperta ou quando o certificado A1 está perto de vencer. A validade do certificado já está guardada (`fiscal_credencial.cert_valido_ate`) e aparece na tela de configuração.
- **[C]** IBPT: a vigência por UF é conferida todo dia e avisa a distribuição.
- **[C]** Impressão: estado da fila, das impressoras e das estações já chega à nuvem dentro da saúde (1.1).
- **[C]** Canais: falha repetida de poller vai para a telemetria; a 99 guarda o último erro de autenticação.
- **[A]** Estado de saúde consolidado de cada integração, visível para a loja.

### 1.6 Padrões da casa que a camada segue

- **Só nuvem:** migration com `-- @cloud-only`, nome em `SO_NUVEM` no `sync-daemon.mjs`, rotas com `@CloudOnly()`, rotina com `ehServidorLocal()`; módulo inteiro da nuvem entra em `CLOUD_ONLY_IMPORTS` e no `edge-manifest.ts`.
- **Rotina agendada:** `@Interval` + `ehServidorLocal()` + trava `rodando` + uma consulta para todas as empresas + nunca rejeita. O agendador roda em instância única; a deduplicação tem de estar no banco (índice único e `on conflict do nothing`), não só em memória.
- **Acesso:** `@Roles` + `@RequirePerm` + `@UnidadeAtual()` com `sqlUnidade`; perfis próprios da distribuição (`@PerfilDist`); sessão de suporte (`suporte_sessao`) para a distribuição olhar dado de loja.
- **Interruptor:** módulo do presidente (`modulo_ativacao`, `@RequireModulo`) ou direito ligado pela distribuição (`entitlement` + `idEntitlement`), sempre nascendo desligado.
- **Auditoria:** `AuditoriaService.registrar`, tabela só de inclusão com cadeia de hash.
- **Tela de lista:** modelo do Estoque (`components/ui/lista.tsx`: título com contagem, situações, filtros, ações na linha, gaveta), sem barra horizontal.

## 2. O que muda no desenho da F1 depois do levantamento

1. **A F1 começa só na nuvem.** Tudo o que um monitor do servidor da loja precisa já chega em `edge_status` a cada minuto. Avaliar na nuvem não mexe no servidor da loja e não pede `.zip`. O alerta local sem internet (ícone da bandeja e tela da loja) fica como segunda entrega.
2. **Incidente por episódio, em tabela própria.** A telemetria avisa só na primeira vez que uma mensagem aparece; para um problema que vai e volta (servidor fora hoje, de novo na semana que vem) é preciso guardar cada episódio, com começo, última observação e fim.
3. **Dois públicos, dois destinos.** O que é de infraestrutura (serviço parado, disco, backup, banco) é da distribuição. O que a loja consegue resolver (servidor sem sinal com pedido esperando, impressora sem papel, fila de impressão parada) vai para a loja, pelos canais que já existem.
4. **O caminho mais curto até o gestor já está pronto:** um caso urgente no Atendimento acende o sino em todas as telas, aparece no app e, se ninguém pegar, chega ao WhatsApp do gestor. O estorno de Pix que falha já usa esse caminho.

## 3. F1 em entregas

### F1.1 — Fundação: incidentes e vigia do servidor (sem aviso a ninguém)

- **O que entra:** tabela `vigia_incidente` (só nuvem), as regras puras da saúde do servidor e a rotina que abre, atualiza e fecha incidentes. Nasce desligada (variável de ambiente da nuvem).
- **Arquivos:** `database/migrations/NNN_vigia_incidente.sql`; `backend/src/modules/vigia/` (regras, serviço, módulo, specs); `backend/edge/sync-daemon.mjs` (só o nome da tabela em `SO_NUVEM`); `backend/src/app.module.ts` e `edge-manifest.ts`.
- **Contrato do incidente:** empresa, loja, servidor, regra, chave do alvo, gravidade, situação (`aberto` ou `recuperado`), evidência (números observados, sem dado pessoal), primeira e última observação, recuperação, quantas vezes foi visto. Um incidente aberto por regra e alvo (índice único parcial).
- **Regras da primeira versão** (os mesmos limites que o console já usa nos selos):

| Regra | Fonte | Dispara quando | Público |
|---|---|---|---|
| `servico_parado` | `saude.servicos` | api, web, impressao ou pg diferente de `Running` | distribuição |
| `disco_baixo` | `disco_livre_mb` | menos de 2 GB livres | distribuição |
| `backup_atrasado` | `saude.backup` | falhou, mais de 48 h ou nunca reportou | distribuição |
| `banco_em_risco` | `saude.bancoFalhasChecksum`, `saude.bancoPctTransacoes` | falha de checksum, ou mais de 50% do limite de transações (crítico acima de 80%) | distribuição |
| `relogio_desviado` | `saude.relogioDesvioS` | mais de 120 s de diferença | distribuição |
| `sync_falhando` | `saude.syncFalhandoDesde` | falhando há mais de 15 min | distribuição |
| `impressora_parada` | `saude.impressorasSemResponder`, `saude.impressorasComAviso` | impressora sem responder ou com aviso (sem papel, tampa) | loja |
| `servidor_sem_sinal` | `recebido_em` | sem batida há mais de 10 min, tendo dado sinal nas últimas 24 h | loja e distribuição |

- **Aceite:** o mesmo problema visto de novo não abre segundo incidente; problema que some fecha o incidente; problema que volta abre outro; rotina desligada não grava nada; rotina no servidor da loja não roda; duas voltas ao mesmo tempo não duplicam (prova contra Postgres); uma empresa com erro não trava as outras.
- **Reversão:** desligar a variável. A tabela fica (nenhuma outra parte do sistema a lê).

### F1.2 — Destinos (depende de decisão do dono)

- **Distribuição:** aviso por episódio (abriu e recuperou) pelo webhook que já existe, e uma aba de incidentes no console.
- **Loja:** para as regras de público "loja", abrir um caso urgente no Atendimento (recomendado, reaproveita sino, app e WhatsApp do gestor) ou um aviso de gestão no KDS.
- **A decidir:** qual canal para a loja; se `servidor_sem_sinal` respeita o horário de funcionamento (e de onde vem o horário) ou só dispara com pedido esperando; o texto de cada aviso.

### F1.3 — Monitores de negócio (cada um nasce desligado)

- Pedido parado numa etapa além do limite (os limites do KDS e das pendências do turno já existem).
- Nota fiscal com reconsulta esgotada; prazo de contingência perto do fim.
- Certificado A1 a 60, 30, 15, 7 e 1 dia do vencimento.
- Token de canal recusado e poller falhando além do limite.

### F1.4 — Telas (pedem mockup aprovado antes)

- Lista de incidentes para o gestor, no modelo do Estoque.
- Aba de incidentes no console da distribuição.
- Alerta local sem internet (bandeja e tela da loja), a única parte da F1 que pede `.zip`.

## 4. Fases seguintes (resumo)

| Fase | Entrega | Onde |
|---|---|---|
| F2 | Mister responde consultas: processo de agentes, fila, trilha, filtro de saída, tetos de custo, 8 a 10 ferramentas de leitura, suporte com documentação de uso | nuvem |
| F3 | Leitura especializada: conciliação de pedido, pagamento e nota; vigilância de dependências e integrações | nuvem |
| F4 | Propor e aprovar: catálogo de procedimentos com prazo e verificação, pelo `edge_comando` | nuvem e loja |
| F5 | Qualidade: avaliações, relatório de melhoria de prompts, segurança com IA sobre os eventos | nuvem |
| F6 | Autonomia limitada: procedimentos automáticos pré-autorizados; contratos | nuvem e loja |

## 5. O que depende do dono

1. Onde a IA roda (recomendado: nuvem da distribuição).
2. Número do Mister no WhatsApp (recomendado: um só, da distribuição).
3. Modelo de IA por papel e quem paga a IA.
4. Canal dos avisos da F1 para a loja (recomendado: caso urgente no Atendimento).
5. Regra do horário para `servidor_sem_sinal`.
6. Mockups da F1.4.
7. Releitura dos 41 documentos e 12 imagens no grafo de engenharia (precisa de IA; o código já foi atualizado).

## 6. Como foi levantado

Três varreduras de leitura no checkout limpo de `origin/main` `7b7a573f`, por área (saúde e comandos; sinais de operação e vencimentos; canal, acesso e sync), com conferência manual dos pontos que sustentam o plano. Limites: nada foi executado; hardware, conta Meta, provedores de pagamento e homologação fiscal não foram testados; onde a documentação e o código divergiam, valeu o código.
