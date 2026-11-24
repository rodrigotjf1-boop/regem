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

> **Situação:** código pronto (mig 414, `backend/src/modules/vigia/`), nascendo desligado. Liga com `VIGIA_LIGADO=1` na nuvem, depois da migration aplicada.

- **O que entra:** tabela `vigia_incidente` (só nuvem), as regras puras da saúde do servidor e a rotina que abre, atualiza e fecha incidentes. Nasce desligada (variável de ambiente da nuvem).
- **Arquivos:** `database/migrations/414_vigia_incidente.sql`; `backend/src/modules/vigia/` (regras, serviço, rotina, módulo, specs); `backend/edge/sync-daemon.mjs` (só o nome da tabela em `SO_NUVEM`); `backend/src/app.module.ts` e `edge-manifest.ts`.
- **Contrato do incidente:** empresa, loja, servidor, regra, chave do alvo, gravidade, situação, evidência (números observados, sem dado pessoal), primeira e última observação, fechamento, quantas vezes foi visto. Um incidente aberto por regra e alvo (índice único parcial).
- **Situações:** `aberto`; `recuperado` (o problema sumiu); `encerrado` (o servidor saiu da vigia: desativado ou trocado).
- **Servidor sem sinal:** só a regra do sinal vale. A saúde guardada é a da última batida, então os outros incidentes dele não somam nem fecham enquanto ele estiver mudo; a volta do sinal decide com o dado novo.
- **Regras da primeira versão** (os mesmos limites que o console já usa nos selos):

| Regra | Fonte | Dispara quando | Público |
|---|---|---|---|
| `servico_parado` | `saude.servicos` | pg, api, web, sync ou impressao diferente de `Running` (pg e api são críticos) | distribuição |
| `disco_baixo` | `disco_livre_mb` | menos de 2 GB livres | distribuição |
| `backup_atrasado` | `saude.backup` | falhou, mais de 48 h ou nunca reportou | distribuição |
| `banco_em_risco` | `saude.bancoFalhasChecksum`, `saude.bancoPctTransacoes` | falha de checksum, ou mais de 50% do limite de transações (crítico acima de 80%) | distribuição |
| `relogio_desviado` | `saude.relogioDesvioS` | mais de 120 s de diferença | distribuição |
| `sync_falhando` | `saude.syncFalhandoDesde` | falhando há mais de 15 min | distribuição |
| `impressora_parada` | `saude.impressorasSemResponder`, `saude.impressorasComAviso` | impressora sem responder ou com aviso (sem papel, tampa) | loja |
| `servidor_sem_sinal` | `recebido_em` | sem batida há mais de 10 min (servidor ativo que já deu sinal) | loja e distribuição |

Loja que desliga o PC à noite abre um episódio de "sem sinal" por noite e o fecha de manhã. Nesta entrega isso só fica guardado, e serve para medir o falso alerta antes de a F1.2 avisar alguém.

- **Aceite:** o mesmo problema visto de novo não abre segundo incidente; problema que some fecha o incidente; problema que volta abre outro; rotina desligada não grava nada; rotina no servidor da loja não roda; duas voltas ao mesmo tempo não duplicam (prova contra Postgres); uma empresa com erro não trava as outras.
- **Reversão:** desligar a variável. A tabela fica (nenhuma outra parte do sistema a lê).

### F1.2 — Destinos: os avisos (primeira parte no ar; migration 419)

**Decidido pelo dono em 14/11/2026:** o destino depende do tipo do aviso ("vai depender de que tipo de aviso é, para determinar para onde vai") e a tabela abaixo é o ponto de partida ("vamos de ok e com o tempo vamos atualizando os avisos"). Protótipo versão 2 aprovado no mesmo dia.

| Aviso | Vai para (padrão) | Se ninguém resolver |
|---|---|---|
| Impressora parada (com via na fila) | tela do Regem na loja | 5 min → WhatsApp do gerente |
| Pedido parado (15, 20 ou 30 min; nasce desligado) | KDS, tela da loja, WhatsApp do gerente | — |
| Caixa aberto há mais de 24 horas | WhatsApp do gerente | — |
| iFood ou 99 desconectado | WhatsApp do gerente, tela da loja | — |
| Servidor da loja sem sinal (só com pedido esperando) | WhatsApp do gerente, suporte da DMS | — |
| Serviço parado, disco cheio, cópia de segurança atrasada | suporte da DMS | 2 horas → WhatsApp do gerente |
| Nota fiscal sem resposta | caso no Atendimento, WhatsApp do presidente | — |
| Certificado digital perto de vencer | WhatsApp do presidente | — |
| A chave de IA parou | WhatsApp do presidente | — |

- **Mister › Avisos e relatórios** (só o presidente): os nove avisos em quatro grupos, a linha "Vai para" e o "Mudar" em gaveta (os seis destinos e o "se ninguém resolver"); o salvar é o da barra, como nas outras telas de ajuste. Tabela `mister_aviso_regra` (migration 419, só nuvem); sem linha, vale o padrão (`mister-avisos.regras.ts`).
- **A rotina** (`MisterAvisosService`, a cada minuto, só na nuvem): vê as situações de todas as empresas, uma consulta por fonte; abre o episódio novo em `mister_aviso` e entrega; escala uma vez depois do tempo; fecha o que acabou e manda o desfecho a quem recebeu pelo WhatsApp. Tipo ou módulo desligado com o aviso aberto: fecha calado. Um aviso aberto por tipo e alvo (índice único parcial); escalar e fechar por gravação condicional — duas réplicas não entregam em dobro.
- **Nasce desligada:** só roda com `MISTER_AVISOS_LIGADOS=1` no serviço da API (quem liga é o dono).
- **Fontes desta parte:** os incidentes do vigia (impressora; servidor sem sinal com pedido aceito ou por aceitar das últimas 3 horas, que depois de aberto segue até o servidor voltar; os técnicos), o caixa aberto há mais de 24 horas e a chave de IA parada. **Ficam para a parte 2:** pedido parado, iFood ou 99 desconectado, nota fiscal sem resposta e certificado (a tela já mostra "chega numa próxima entrega").
- **Entregas desta parte:** WhatsApp do presidente e do gerente pelo número do Mister, dentro da janela de 24 horas da Meta (fora dela fica anotado `fora_da_janela_de_24h` — o modelo de mensagem aprovado é a parte 2); sem gerente ligado na loja, vai ao presidente; quem respondeu PARAR AVISOS não recebe. KDS: o aviso do KDS (tipo "gestão", fica até "Ciente"), que desce ao servidor da loja como o do Farol, com id fixo por fase. Atendimento: caso urgente, que fecha sozinho quando o aviso resolve. **"Tela do Regem na loja" e "Suporte da DMS"** ficam anotados como `chega_na_proxima_entrega`: não existe aviso genérico na tela da loja, e a forma dele na tela pede um protótipo próprio; a DMS ganha a lista no console.
- **A trilha** (`mister_aviso.entregas`): destino, fase (abriu, escalou, resolveu), quando, se saiu, o motivo e os 4 últimos dígitos de quem recebeu — nunca o telefone inteiro. A linha resolvida sai em 90 dias.

**Conferência:** `mister-avisos.regras.spec.ts` (o padrão aprovado, a conferência do salvar, as fontes e os textos) e `mister-pg.teste-spec.ts` (a configuração com auditoria; abrir, escalar uma vez e o desfecho; o servidor sem sinal com e sem pedido; o gerente que falta; a janela de 24 h; PARAR AVISOS; KDS e Atendimento; duas voltas ao mesmo tempo; desligar calado; módulo desligado) e o roteiro de tela `frontend/roteiros/mister.mjs` (a parte, a gaveta e o salvar em 16 larguras).

### F1.3 — Monitores de negócio (cada um nasce desligado)

- Pedido parado numa etapa além do limite (os limites do KDS e das pendências do turno já existem).
- Nota fiscal com reconsulta esgotada; prazo de contingência perto do fim.
- Certificado A1 a 60, 30, 15, 7 e 1 dia do vencimento.
- Token de canal recusado e poller falhando além do limite.

### F1.4 — Telas (pedem mockup aprovado antes)

- Lista de incidentes para o gestor, no modelo do Estoque.
- Aba de incidentes no console da distribuição.
- Alerta local sem internet (bandeja e tela da loja), a única parte da F1 que pede `.zip`. **A tela, em 14/11** (protótipo `mockups/regem-dependencias-e-qualidade.html`, vista "Loja sem internet", com as decisões recomendadas — o dono pediu para seguir com as recomendadas enquanto estava fora):
  - **Quando aparece:** a faixa "sem conexão com a nuvem" aparece em todas as telas do servidor da loja depois de 2 min com o envio falhando, ou de 5 min sem nenhum envio certo.
  - **O que a faixa diz:** a venda local continua; o iFood, a 99 e o cardápio digital não chegam; o Mister não manda avisos. Traz "O que conferir" e, quando a conexão volta, "✅ voltou" por 1 minuto.
  - **De onde vem a regra:** `edge/conexao-nuvem.ts` (`situacaoDaNuvem`) lê a anotação que o daemon já faz a cada batida com a nuvem (`sync_state.nuvem_contato`). A informação vem na resposta da presença do PC (`POST /edge/presenca`, a cada 30 s), sem nenhuma leitura a mais. Com o servidor da loja fora do ar, só aparece o aviso dele.
  - **A mesma regra do ícone "Regem neste PC"** (ERR-468, corrigido antes do `.zip`). O ícone já mostrava a nuvem por essa anotação; agora os dois usam a mesma função, e o ícone ganhou a folga de 2 min. O texto do ícone vem pronto do servidor (`edge/bandeja/estado`), então também muda com o `.zip`.
  - **Onde vale:** só no `.zip`.
- **Protótipo APROVADO pelo dono em 14/11/2026: `mockups/regem-avisos-na-tela.html`** (as cinco decisões recomendadas). Cobre os dois destinos dos avisos que ainda ficam só anotados:
  - a **faixa na tela da loja**, com a gaveta dos avisos abertos e o "Ciente" por pessoa;
  - o **Mister › Histórico**, com a lista no modelo do Estoque e a trilha de cada aviso;
  - a aba **Avisos do console da distribuição**, para o suporte da DMS.

  Foi medido em 16 larguras, em cada vista, estado e gaveta: 336 conferências, sem barra lateral, e um detector de botão com texto espremido. O alerta local sem internet fica para depois.

**Parte A — a faixa na tela da loja (sem migration):**
- **A tela:** a faixa abaixo do topo (`components/mister/faixa-de-avisos.tsx`, montada pelo Shell para todos que estão logados).
  - Mostra o aviso aberto mais recente que a pessoa ainda não deu "Ciente", com "Ciente" e "Ver avisos".
  - Depois do Ciente aparece o ⚠️ do topo; a gaveta "Avisos da loja" lista todos os abertos, com o "o que fazer", para onde mais foram e o que escalou.
  - A tela relê a cada minuto e na hora pelo tempo real (`mister:avisos`).
- **O servidor** (`AvisosNaTelaModule`, carregado nos DOIS lados): `GET /mister/avisos/abertos` e `POST /mister/avisos/:id/ciente`, para qualquer perfil, com o módulo Mister ligado. Lê os abertos com destino "tela" da loja em uso (da loja ou da empresa toda).
  - "Ciente" é por pessoa e fica em `dados.cientes`. A renovação da rotina o guarda; a escala o limpa e a faixa volta para todos.
  - No servidor da loja a tabela não existe: ele pede à nuvem com o token do sincronismo (`GET /mister/avisos/loja`, `POST …/ciente/loja`, que confere se a pessoa é da empresa), com cache de 15 s por loja. Sem internet, devolve `semConexao`, e a tela não mostra nada (V37). **Vai no `.zip`.**
- **A rotina:** as entregas "tela" e "dms" passam a contar como feitas (a tela e o console leem pela trilha). A rotina avisa as telas no abrir, na escala e no fechar.

**Conferência:**
- `mister-pg.teste-spec.ts`: só na loja do aviso; o presidente na rede toda; o "Ciente" por pessoa, sem duplicar e guardado na renovação; as recusas; a escala que traz a faixa de volta; o servidor da loja pedindo à nuvem (o cache, o "Ciente" com a pessoa, "sem conexão", a resposta de outra empresa); a rota da nuvem que recusa pessoa de outra empresa; resolvido some; o tempo real.
- Roteiro `mister`: a faixa, o "Ciente", o ⚠️, a gaveta, "sem conexão" e as 16 larguras (357 conferências). Os outros 6 roteiros seguem verdes com a faixa no Shell.
- Prova por defeito: 10 de 10.

**Parte B — o Histórico e a aba Avisos do console (sem migration, só nuvem):**
- **Mister › Histórico** (só o presidente; `GET /mister/avisos/historico`, `mister-avisos-historico.service.ts`): a lista no modelo do Estoque, com contagem, situações, busca, grupo e período (hoje, 7 ou 30 dias). Os abertos aparecem sempre; os resolvidos, pela abertura no período (horário da loja).
  - Cada aviso mostra a situação: aberto, se escalou, resolvido em quanto tempo, ou fechado porque o aviso foi desligado. Mostra também para onde foi, com o WhatsApp só pelos 4 últimos dígitos.
  - A gaveta traz a trilha de cada fase, com o "pelo modelo da Meta" e o motivo do que não saiu.
- **Console da distribuição › Avisos** (Diretoria e Técnico; `GET /distribuicao/mister/avisos`): os avisos com destino "Suporte da DMS" de todas as empresas, abertos ou resolvidos nas últimas 24 h, com busca pela empresa. Mostra só a empresa, a loja e o aviso.

**Conferência:**
- `mister-pg.teste-spec.ts`: os abertos sempre (até o de 40 dias); os resolvidos pelo período (7, 30, hoje); a trilha com os 4 dígitos e o modelo da Meta; o fechado por desligar; grupo, busca e situação; as recusas; a outra empresa; o suporte só com o destino da DMS, de todas as empresas, os resolvidos só das 24 h, a busca sem curinga.
- Roteiros `mister` (416, com o Histórico nas 16 larguras, a gaveta, o vazio e o erro) e `mister-console` (174, com a aba Avisos: o técnico a vê; as situações, a busca, o erro e as 16 larguras).
- Prova por defeito: 6 de 6.

## 4. Fases seguintes (resumo)

| Fase | Entrega | Onde |
|---|---|---|
| F2 | Mister responde consultas: processo de agentes, fila, trilha, filtro de saída, tetos de custo, 8 a 10 ferramentas de leitura, suporte com documentação de uso | nuvem |
| F3 | Leitura especializada: conciliação de pedido, pagamento e nota; vigilância de dependências e integrações | nuvem |
| F4 | Propor e aprovar: catálogo de procedimentos com prazo e verificação, pelo `edge_comando` | nuvem e loja |
| F5 | Qualidade: avaliações, relatório de melhoria de prompts, segurança com IA sobre os eventos | nuvem |
| F6 | Autonomia limitada: procedimentos automáticos pré-autorizados; contratos | nuvem e loja |

### Decisões do dono de 12/11/2026 que valem para a F2 em diante

- A IA roda na **nuvem**. O Mister é um **módulo ativável**.
- **Cada lojista configura a própria chave de IA** e paga os próprios créditos. A loja piloto usa a Anthropic. Outros provedores (OpenAI e Gemini) só entram depois de testados; a lista de aceitos mora num lugar só (`modules/ia/ia.regras.ts`).
- **Quem paga a IA fica para o fim:** depois da implementação e dos testes, com o gasto medido na loja piloto, decide-se se continua por lojista ou se a distribuição passa a bancar. Por isso o medidor de uso nasce junto com a chave.
- O Mister tem um **número de WhatsApp próprio**; o número da loja continua dedicado ao atendimento dos clientes.
- O vigia sem IA (F1) vale para toda loja com servidor. O copiloto e o robô de atendimento passam para a chave do lojista.
- A chave de IA do lojista é uma **exceção** à regra "o usuário não manuseia segredo" (como o token do gateway de Pix): a conta de IA é dele. Registrada em `docs/decisoes-design.md` §6.

### F2.0 — IA por empresa: a chave do lojista e o medidor de uso (base da F2)

- **O que entra:** migration 415 (`@cloud-only`) com `ia_credencial` (uma chave por empresa, cifrada) e `ia_uso_dia` (o medidor); `backend/src/modules/ia/` (regras puras, o serviço e as rotas do presidente); o copiloto do atendimento passa a pedir pela porta nova.
- **A porta única (`IaEmpresaService.pedir`):** quem fala com um modelo de IA em nome de uma empresa passa por ela. Ela escolhe a chave (a da empresa, se houver; senão a da distribuição, enquanto existir), chama o provedor, soma a chamada no medidor e guarda o que a chamada disse da chave.
- **Regras da chave do lojista:** só o presidente cadastra, troca ou apaga; a chave é provada no provedor antes de ser guardada (chave recusada não entra); fica cifrada com a `SEGREDOS_CHAVE` da nuvem, em tabela que não sincroniza; nenhuma rota a devolve (só o provedor, os 4 últimos caracteres e a situação); empresa com chave própria **não** cai para a chave da distribuição quando a dela falha (o custo não muda de dono em silêncio).
- **O medidor:** uma linha por empresa, dia, recurso, provedor, modelo e origem da chave; cada chamada soma na linha do dia (falha também conta). `GET /ia/uso` devolve o período com o custo estimado em dólar (tabela de preços datada no código; modelo fora da tabela fica sem preço).
- **Rotas (presidente, só nuvem):** `GET /ia/chave`, `POST /ia/chave`, `POST /ia/chave/testar`, `DELETE /ia/chave`, `GET /ia/uso`.
- **Aceite:** sem chave não há IA; a da distribuição atende quem não tem a própria; a chave do lojista é provada, cifrada e nunca volta pela API nem pela auditoria; a que falha não cai para a da distribuição e a situação acompanha; dez chamadas ao mesmo tempo somam dez numa linha; a chave e o uso são de uma empresa só; no servidor da loja não há IA.
- **Reversão:** sem chave cadastrada, tudo funciona como antes. Apagar a chave de uma empresa a devolve à chave da distribuição.
- **Fica para as próximas entregas:** as marcações do Instagram pela mesma porta; o aviso ao presidente quando a chave é recusada ou fica sem crédito; o robô de atendimento, que hoje roda fora do backend.

### O protótipo do Mister (`mockups/regem-mister.html`, aprovado em 13/11/2026)

O Mister é o canal do presidente (e do gerente) com os agentes, por um número de WhatsApp próprio: um só, da distribuição, para todas as lojas. Por ele o dono recebe avisos, alertas e relatórios e manda perguntas, tarefas e autorizações. O protótipo desenha a loja (Resumo, Pessoas, IA e uso, Avisos e relatórios), dez conversas no celular, o cartão do módulo e a aba Mister do console da distribuição.

As cinco regras de separação entre lojas:

1. O telefone só representa a empresa depois de ligado por dentro do Regem, pela própria pessoa, com um código de 10 minutos que vale uma vez. Quem só escreve para o número recebe uma resposta fixa, sem IA e sem dado de ninguém.
2. O mesmo telefone pode estar em duas empresas: o Mister pergunta de qual é o assunto e nunca mistura.
3. Gerente só fala da loja dele. O que cada gerente pode fica para o fim do projeto, como perfil de permissões por hierarquia; até lá, presidente = avisos, consulta e autorização, e gerente = avisos e consulta.
4. Autorização em dois níveis: baixo impacto por botão na conversa; o que mexe com dinheiro, cancelamento ou configuração por um link que abre o Regem e pede o PIN. O PIN nunca é digitado na conversa. Toda autorização tem prazo e vale uma vez.
5. Quem sai da empresa perde o vínculo na hora.

Entregas do protótipo, uma por PR: (1) a tela "IA e uso" e o módulo; (2) o número do Mister no console e a entrada do WhatsApp; (3) Pessoas; (4) os avisos (a F1.2); (5) perguntas (F2), relatórios (F3) e autorizações (F4).

### F2.0b — A tela "IA e uso" e o módulo Mister (primeira entrega do protótipo)

- **Módulo `mister`** na lista de módulos ativáveis (Visão C&O › Módulos do produto). É o primeiro módulo que **nasce desligado**: até o presidente ligar, o item "Mister" não aparece no menu de ninguém. O plano contratado não o limita.
- **Página `/mister`**, só para o presidente, só na nuvem e só com o módulo ligado: a parte "IA e uso" — a chave de IA da empresa (colar, testar, a situação, apagar com confirmação, o passo a passo de como criar a chave) e o uso por recurso e modelo com o custo estimado. As outras partes do protótipo entram nas entregas seguintes.
- As rotas `ia/*` continuam sem depender do módulo: a chave também serve ao copiloto do atendimento.
- **Conferência:** `modulo-mister.spec.ts` (Postgres) e o roteiro de tela `frontend/roteiros/mister.mjs` (app buildado, API simulada, 16 larguras).

### F2.0c — O número do Mister no console e a entrada do WhatsApp (segunda entrega do protótipo; migration 417)

O que entra:

- **O número do Mister** mora numa linha única (`mister_numero`), sem empresa: é da distribuição. Conecta-se pelo console da distribuição, aba **Mister** (só o perfil Diretoria), com o mesmo cadastro integrado da Meta que as lojas usam e o mesmo acesso da distribuição — nenhum segredo novo. Duas formas: **coexistência** (o número segue no WhatsApp Business do celular) ou **só a API oficial** (aí a Meta exige o PIN de seis dígitos do número). Um número que já é de uma loja não vira o do Mister, e nenhuma loja conecta o número do Mister como dela.
- **A chave geral "Mister nesta nuvem"** nasce **desligada** e é conferida no envio: desligada, nenhuma mensagem sai pelo número, e a que chega é só anotada. Conectar o número não a liga.
- **A entrada** (`modules/mister/mister-entrada.service.ts`): a mensagem que chega ao número do Mister é reconhecida pelo identificador do número na Meta e tratada à parte — nunca entra na caixa de conversas de uma loja. Na ordem:
  1. a mesma mensagem só é tratada uma vez (a Meta reenvia);
  2. `MISTER 123456` liga o telefone à pessoa que gerou o código dentro do Regem. O código é único **na nuvem inteira**, vale 10 minutos e uma vez; cinco códigos errados e o telefone deixa de ser atendido em códigos por uma hora;
  3. telefone que não está ligado recebe a **resposta fixa** — sem IA e sem dado de ninguém —, no máximo uma a cada 12 horas;
  4. a pessoa precisa valer **agora**: ativa, gerente ou presidente, empresa viva e com o módulo ligado. A conferência é a cada mensagem;
  5. telefone em mais de uma empresa: o Mister pergunta de qual é o assunto (botões até três empresas, lista numerada acima disso), guarda a mensagem por até 10 minutos e só a atende depois da escolha. Na dúvida pergunta de novo;
  6. `PARAR AVISOS` e `VOLTAR AVISOS` mexem só no vínculo de quem escreveu, com auditoria;
  7. o resto ainda não tem resposta: o Mister diz que as perguntas entram numa próxima versão (no máximo uma vez a cada meia hora). Os textos só prometem o que existe e mudam junto com as próximas fases.
- **O que se guarda:** o vínculo (`mister_vinculo`), o estado da conversa de cada telefone (`mister_conversa`) e o registro de cada mensagem recebida (`mister_mensagem`: o telefone, a empresa e o desfecho — **nunca o texto**; uma rotina diária apaga o que passou de 30 dias). Tudo só na nuvem.
- **Rotas de quem está logado** (`mister/whatsapp`, gerente e presidente, módulo ligado): ver a própria situação, gerar o código e desligar o próprio número. Nenhuma rota recebe o telefone ou a pessoa de outro. A tela delas é a "Pessoas", na entrega seguinte.
- **O painel do console** mostra o número como a Meta o vê (nome, qualidade, quantas pessoas pode avisar por dia), a chave geral e as empresas com o módulo, a origem da IA, quantas pessoas ligaram o WhatsApp e o custo estimado da IA em 30 dias. Nunca a chave de IA, o telefone de alguém ou o que foi conversado.

O que ficou diferente do protótipo, e por quê:

- "Último acesso visto" (coexistência) e o modelo "Aviso do Mister" não aparecem no cartão do número: a Meta não entrega o primeiro por API e o segundo nasce com os avisos (entrega 4).
- A forma "só na API oficial" pede o PIN de seis dígitos, que o protótipo não desenhava: sem ele a Meta não registra o número.
- "Desconectado pela Meta" é reconhecido por um sinal só — a Meta responde que o número não existe mais para o acesso da distribuição, numa leitura ou num envio. O texto mostra o motivo que ela deu.
- As frases que citavam os avisos dentro do Regem saíram do console: eles ainda não existem (entrega 4).

**Conferência:** `mister.regras.spec.ts` (sem banco), `mister-pg.teste-spec.ts` (Postgres, com a Meta de mentira; roda dentro da `ia/ia-empresa-pg.spec.ts`, que já aplica a 415 — ERR-451) e o roteiro de tela `frontend/roteiros/mister-console.mjs`.

### F2.0d — A parte "Pessoas" (terceira entrega do protótipo; sem migration)

- **A página `/mister` ganhou partes:** "Pessoas" e "IA e uso". O presidente vê as duas (abre em Pessoas; `/mister?parte=ia` abre direto na IA). O **gerente** passa a entrar: vê só "Pessoas", sem a faixa de partes, e o item "Mister" aparece no menu dele. Quem é de supervisão ou execução continua sem entrar.
- **Pessoas:** os gerentes e presidentes ativos da empresa, com a situação do WhatsApp de cada um (ligado, avisos parados, não ligado), o final do número e desde quando. O presidente vê todos; o gerente recebe **só a própria linha** — a dos outros nem sai do servidor. Do telefone sai só o final, nunca o número.
- **Ligar o meu WhatsApp:** o diálogo gera o código (10 minutos, uma vez), mostra a mensagem `MISTER 123456`, o código para a câmera e o link que abre o WhatsApp do celular já com a mensagem para o número do Mister, e espera até a pessoa aparecer ligada (pergunta ao servidor a cada 3 segundos, só com o diálogo aberto e o código valendo). Código vencido: "Gerar outro código". Sem o número conectado ou com a chave geral desligada, a tela avisa e não deixa ligar.
- **Desligar:** cada um desliga o próprio; o de outra pessoa, só o presidente, dentro da empresa dele (`DELETE mister/pessoas/:colaboradorId`), com confirmação e auditoria de quem fez e de quem. Ligar de novo é sempre pela própria pessoa.
- **"O que pode"** segue a hierarquia (presidente: avisos, consulta e autorização; gerente: avisos e consulta). A gaveta "Editar o que pode" do protótipo não entra: o perfil de permissões é do fim do projeto.
- Os textos do Mister no WhatsApp passaram a apontar `no menu Mister, em "Pessoas"`.

O que ficou diferente do protótipo: o subtítulo não diz "e só do que você permitir" e o diálogo de desligar não cita avisos nem autorizações pendentes — nada disso existe ainda; e há um estado a mais, "o Mister ainda não está disponível pelo WhatsApp", para quando o número não está conectado ou a distribuição não ligou.

**Conferência:** `mister-pg.teste-spec.ts` (a lista por nível, o que o gerente recebe, quem desliga quem, outra empresa fora do alcance) e o roteiro de tela `frontend/roteiros/mister.mjs` (as cenas de Pessoas, 16 larguras).

### F2.1 — As perguntas: o agente de IA com ferramentas de leitura (quinta entrega do protótipo, primeira parte; migration 418)

Quem está ligado ao Mister pergunta em português, pelo WhatsApp, e recebe a resposta em segundos. É a conversa 3 do protótipo.

- **O caminho de uma pergunta:** a mensagem que não é comando (código, PARAR AVISOS, VOLTAR AVISOS, trocar de empresa) entra numa **fila** (`mister_pergunta`, migration 418, só nuvem), já com a empresa, a pessoa, a loja e o nível de quem escreveu. A entrada do WhatsApp não espera a IA. O agente pega a pergunta, mostra "digitando", chama o modelo com as ferramentas, e a resposta sai pelo número do Mister.
- **O modelo não sabe nada da loja.** Todo número vem de uma **ferramenta de leitura**, e cada ferramenta chama o serviço que já alimenta uma tela do Regem. O número do Mister é o da tela.

| Ferramenta | O que traz | De onde vem | Quem pode |
|---|---|---|---|
| `resumo_do_dia` | vendas, faturamento, ticket médio, gorjeta, delivery em aberto, estoque abaixo do mínimo, tarefas e escala de um dia | o resumo do Painel | quem abre o Painel |
| `vendas_do_periodo` | vendas fechadas de um período: total, por forma de pagamento, por canal e por dia | Relatórios de vendas | quem abre os relatórios de vendas |
| `produtos_mais_vendidos` | os mais vendidos de um período, por quantidade (com a divisão entre delivery e balcão) ou por faturamento | o ranking e a curva de produtos dos relatórios | quem abre os relatórios de vendas; por faturamento, só quem vê valores em reais |
| `pedidos_em_andamento` | os pedidos de delivery por situação e plataforma, o que espera há mais tempo, e a fila da cozinha | o quadro do Delivery e a fila da cozinha | delivery: quem abre o Delivery; cozinha: gerente e presidente |
| `estoque_em_alerta` | itens abaixo do mínimo e lotes vencidos ou vencendo | Estoque (itens e validades) | quem vê o Estoque |
| `servidor_e_incidentes` | a situação do servidor da loja e os problemas em aberto do vigia que são da loja resolver | Servidor local e `vigia_incidente` | servidor: só o presidente; problemas: gerente e presidente |

- **De quem é a conversa quem diz é o servidor.** A empresa e a pessoa são as do telefone ligado. A loja segue a mesma régua das rotas (`@UnidadeAtual()`): empresa de uma loja só não filtra; quem é de uma loja só consulta a dela; o presidente consulta todas ou a que ele nomear; gerente sem loja numa empresa de várias não consulta nada. O modelo só consegue **nomear** uma loja, e o nome é procurado entre as que a pessoa consulta. Nenhuma ferramenta tem campo de empresa.
- **As permissões são as do perfil da pessoa**, as mesmas das rotas: quem não abre a tela não recebe o dado pelo Mister, e quem não vê valores em reais recebe os valores vazios, com o aviso. No perfil padrão, o gerente não vê valores em reais nem os relatórios de vendas; o presidente muda isso no perfil de acesso, como já muda para as telas.
- **Só leitura.** Nenhuma ferramenta grava. Pedido de ação recebe a resposta de que o Mister, por enquanto, só consulta. Propor e autorizar é a F4.
- **A IA é a da empresa** (`IaEmpresaService.pedir`, recurso `mister_perguntas`): a chave do lojista, ou a que a distribuição inclui enquanto existir. A porta passou a aceitar ferramentas e a devolver os blocos do modelo; o laço é do agente, e cada chamada soma no medidor. O modelo padrão é o Claude Haiku 5.5; a distribuição troca por `MISTER_MODELO_PERGUNTAS` (só modelo que está na tabela de preços). As instruções fixas e as ferramentas vão marcadas para o cache do provedor; o que muda de uma conversa para outra (empresa, pessoa, lojas, a hora) vai num bloco depois.
- **Os tetos, todos conferidos no servidor:** 80 perguntas por pessoa e 300 por empresa em 24 horas; 6 chamadas ao modelo e 10 consultas por pergunta; 75 segundos por pergunta; a resposta cortada em 1.800 caracteres.
- **A fila:** a mesma mensagem nunca entra duas vezes; uma conversa é respondida por um agente de cada vez; as mensagens que a pessoa mandou em seguida viram uma pergunta só; a pega vence em 3 minutos e a pergunta volta para a fila uma vez (na segunda, é encerrada e a pessoa é avisada); pergunta que esperou mais de 15 minutos não é respondida atrasada. Uma rotina de minuto é a rede de segurança.
- **A memória da conversa:** as 6 últimas perguntas respondidas nas últimas 2 horas vão junto, para "e ontem?" fazer sentido. Cada pergunta antiga vai com a hora e com as consultas feitas naquela hora (ou "sem consulta"): o modelo não vê mais os resultados antigos, e sem esse cabeçalho concluía que tinha respondido sem consultar (ERR-461). Uma conversa não vê a de outra pessoa.
- **O filtro de saída:** nada que pareça segredo sai (a resposta vira a frase fixa); link não sai; o formato vira o do WhatsApp; valor em reais que nenhuma ferramenta trouxe não bloqueia, mas fica anotado na trilha.
- **A IA que não responde nunca vira silêncio:** sem chave, sem crédito, teto de gasto, chave recusada, provedor fora do ar, recusa do modelo e resposta que não fechou têm cada um a sua frase. O presidente é mandado a "IA e uso"; o gerente, ao presidente.
- **A trilha** (`mister_pergunta`): a pergunta, a resposta, o motivo quando não houve resposta, o modelo, as chamadas, os tokens e as ferramentas usadas (o nome, o tempo, se deu certo e o que foi pedido — período, loja, ordem; nunca o dado que ela trouxe). O texto sai em 30 dias e a linha em 90. O registro das mensagens (`mister_mensagem`) continua sem texto.
- **Mensagem sem texto** (áudio, foto, figurinha, reação): o Mister diz que por enquanto só lê texto, no máximo uma vez a cada meia hora.
- **Só na nuvem:** o agente mora num módulo à parte (`MisterAgenteModule`), que não sobe no servidor da loja; a tabela não sincroniza.
- **Reversão sem novo código:** `MISTER_PERGUNTAS_DESLIGADAS=1` no serviço da API desliga só as perguntas (quem pergunta recebe "em manutenção" e nenhuma IA é chamada); o resto do Mister segue. A chave geral do console continua desligando tudo.
- **Tela:** nenhuma tela nova. Em "IA e uso" o gasto aparece na linha "Mister · perguntas"; a abertura da página passou a dizer que já dá para perguntar.

**Conferência:** `mister-agente.regras.spec.ts` (o período, a loja nomeada, o que o modelo recebe, o filtro, as frases) e `mister-pg.teste-spec.ts` com Postgres e a IA seguindo um roteiro (a fila, o agente com ferramenta, a memória, o escopo por loja e por permissão, quem perde o acesso no meio, as falhas da IA, os tetos, o filtro, a limpeza).

**A primeira prova real (13/11/2026, 23:37, pelo dono):** dez perguntas, todas respondidas em 5 a 11 segundos com as consultas certas; 19 chamadas ao modelo no total, com o cache do provedor funcionando (mais de 50 mil tokens lidos do cache), o que dá cerca de um décimo de centavo de dólar por pergunta. A prova mostrou dois defeitos, corrigidos no PR seguinte: o Mister dizia que tinha respondido sem consultar quando tinha consultado (a memória ia sem a hora e as consultas, ERR-461), e "em ordem de faturamento" só reordenava os mais vendidos por quantidade — agora `produtos_mais_vendidos` aceita a ordem `faturamento` e lê a lista inteira da curva de produtos dos relatórios.

**Fica para as próximas partes das perguntas:** cancelamentos com motivo, caixas abertos e sangrias, escala e ponto do dia, "por que o pedido atrasou" (a regra de atraso hoje mora só na tela), a ajuda de uso com a documentação, transcrição de áudio, e o painel da trilha para o presidente (pede mockup).

### F2.2 — As perguntas, parte 2: cancelamentos, caixas e a equipe do dia (sem migration)

Três consultas novas e os acertos que a primeira conversa real pediu. As consultas passam de seis para nove.

| Ferramenta | O que traz | De onde vem | Quem pode |
|---|---|---|---|
| `cancelamentos` | os pedidos dos canais cancelados, as vendas canceladas na loja (com quem cancelou) e os itens removidos de comandas (com quem removeu e a justificativa), cada um com o motivo, o total e os dez últimos | consulta própria sobre `pedido_externo` e `comanda` (não há tela com a lista por período) e "Cancelamentos de itens" | pedidos: quem abre o Delivery; vendas: quem abre os cupons ou os relatórios de vendas; itens: quem abre "Cancelamentos de itens" |
| `caixas_e_sangrias` | os caixas abertos agora (quem abriu, desde quando), os turnos do período com a diferença no fechamento, e as sangrias e os suprimentos por operador | Relatórios › Turnos e as operações de caixa | quem abre os relatórios de vendas |
| `equipe_do_dia` | quem está escalado (setor, horário, faltas anotadas), quem bateu ponto e quem trabalha agora, e quem está escalado para um horário que já começou e ainda não bateu ponto | a escala do dia e o ponto gerencial | escala: quem vê as escalas; ponto: quem abre o ponto gerencial |

- **Cancelamentos:** o período é o da operação, pelo momento do cancelamento. A venda cancelada que é de um pedido de canal aparece só nos pedidos. Quem não vê valores em reais recebe as contagens e os motivos, sem os valores.
- **Caixas abertos agora:** o relatório lista o turno pelo dia em que abriu; para achar o caixa que ficou aberto de um dia para o outro, a consulta olha 35 dias para trás.
- **Dado de colaborador:** quando o gestor pergunta da equipe, vão ao modelo de IA da própria empresa o nome, o setor, o horário e a presença — o que a escala e o ponto gerencial já mostram a ele. Nunca CPF, telefone, foto ou salário. Dado de cliente continua fora de todas as consultas.
- **O estoque em páginas:** a lista abaixo do mínimo sai em páginas de 15 e aceita busca pelo nome (sem acento). O Mister não promete "a lista completa" numa mensagem: entrega página a página e diz quantas faltam.
- **Como cada tela separa os canais:** o resumo do dia e as vendas do período passaram a devolver, junto com os números, a regra da tela — o Painel separa pelo pedido ter chegado por um canal; o relatório de vendas, pela mesa e pelo pagamento online (a retirada e a entrega paga na hora caem em "balcão"). É o que deixa o Mister responder "isso conta a retirada?".
- **Depois da meia-noite:** até as 6h, o bloco da conversa avisa que a noite de trabalho começou no dia anterior, e o Mister consulta ontem e hoje e diz os dois.
- **Sem afirmar função do Regem:** o Mister não diz que o Regem exporta, imprime ou integra algo que nenhuma consulta mostrou.

**Conferência:** `mister-agente.regras.spec.ts` e `mister-pg.teste-spec.ts` (os cancelamentos com dados de verdade no Postgres — outra empresa, outro período, venda de pedido de canal e permissões; o caixa aberto há 30 horas e o turno fechado com diferença; a equipe com a lista cruzada; o estoque em páginas).

**Fica para as próximas partes:** "por que o pedido atrasou" (a regra de atraso mora só na tela), a ajuda de uso com a documentação, áudio, o relatório em arquivo (o dono perguntou por PDF: é a F3) e o painel da trilha (pede mockup).

### F2.3 — As perguntas, parte 3: conversa aberta, "por que o pedido atrasou" e os caixas esquecidos (sem migration)

- **Conversa aberta de gestão (pedido do dono, 14/11/2026: "as perguntas são abertas e de teor administrativo, não perguntas marcadas, como uma conversa natural").** O Mister nunca trabalhou com perguntas prontas: as consultas são as fontes de dados que ele lê, e a IA entende a pergunta do jeito que vier, junta consultas e faz as contas. O que mudou foram as instruções: ele passa a se apresentar como um administrador experiente de bares e restaurantes e, em pergunta aberta de gestão (vender mais, gargalo, promoção, equipe no pico), consulta os números que ajudam, diz o que eles mostram e, separado, a sua sugestão. A sugestão pode vir do conhecimento de gestão; o número, só de consulta. Cumprimento e agradecimento se respondem sem consultar nada.
- **`historia_do_pedido` (consulta nova, a décima):** a história de um pedido dos últimos 3 dias, pelo número do canal, pelo número do dia ou pela senha da cozinha. Traz a hora de cada etapa (chegou, aceito, entrou na cozinha, começou, ficou pronto, saiu, entregue), quanto levou entre elas e o trecho que mais demorou, as estações por onde passou (com a hora em que cada uma terminou) e se está atrasado agora. Número repetido nos 3 dias: devolve a lista e o Mister pergunta qual. Pedido de canal pede a permissão do Delivery.
- **Atrasado = a mesma regra do KDS:** passou do vermelho configurado no KDS da loja ou do tempo de preparo do próprio pedido; encomenda só conta 30 minutos antes do horário marcado. A regra mora no servidor (`atrasoNaCozinha`) espelhando a da tela (`frontend/src/lib/kds-fila.ts`), e a spec confere que o arquivo da tela continua com as mesmas regras (V74). "Pedidos em andamento" passa a trazer os atrasados da cozinha e a regra usada.
- **Caixas abertos de qualquer idade (ERR-462):** a lista "abertos agora" olhava só 35 dias para trás e não via os caixas esquecidos de agosto e setembro. Agora começa no caixa aberto mais antigo; cada um traz os dias e se passou das 24 horas.

**Conferência:** `mister-agente.regras.spec.ts` (a regra de atraso nos casos de borda, a encomenda, a guarda contra a tela, onde demorou, o número dito) e `mister-pg.teste-spec.ts` (a história de um pedido do iFood que passou por duas estações, o de balcão pela senha, o número repetido, outra empresa, a permissão; os atrasados; o caixa de 90 dias).

### F2.4 — Mais dados para a conversa aberta (sem migration)

A orientação do dono de 14/11 ("as perguntas são abertas e de teor administrativo") pede mais DADOS, não mais perguntas prontas. Entram:

- **O horário de pico:** as vendas do período trazem as vendas por hora (a mesma conta de Relatórios de vendas) e a hora com mais vendas.
- **A comparação com o período anterior** (`comparar`): o período anterior de mesmo tamanho (a semana até hoje contra a semana passada até o mesmo dia), pelos mesmos relatórios, com a variação em % — nula quando o anterior não teve nada.
- **Lucro e margem por produto** (`ordem: lucro`): da curva de produtos dos relatórios — o custo pela ficha técnica, o lucro, a margem e a classe ABC. O produto sem custo vai para o fim e o Mister diz quantos são. Só para quem vê valores em reais.
- **`tempos_dos_pedidos`** (a 11ª consulta): do aceite, até ficar pronto, até sair e até entregar, por canal, e na cozinha a fila até começar e o preparo — a média e o tempo a partir do qual estão os 10% mais lentos. Não há tela com isto: é consulta do Mister sobre os horários que o pedido e o cartão já guardam. Encomenda e cancelado ficam de fora; tempo negativo ou acima de 12 horas é dado torto.

**Conferência:** `mister-agente.regras.spec.ts` (o período anterior nas bordas, a variação) e `mister-pg.teste-spec.ts` (os tempos com horários conhecidos, a comparação com vendas nos dois períodos e o pico, a ordem por lucro); prova por defeito com 3 defeitos, todos acusados.

### F3.1 — Leitura especializada, parte 1: os canais e as integrações (sem migration)

A primeira parte da F3 ("vigilância de dependências e integrações"). A 12ª consulta, **`canais_e_integracoes`**, responde "por que não chegam pedidos do iFood", "a loja está pausada?", "o WhatsApp está funcionando?" e "tem problema com nota fiscal?". Cada pedaço vem da regra da sua tela:

- **Cada canal** (cardápio digital, iFood, 99): a pausa que vale agora, a mesma do "Pausar" do Delivery (até quando, o motivo, quem pausou, se o app aceitou), e o último pedido que chegou por ele, com quantos chegaram hoje. Os outros canais com pedido hoje vão à parte. Sem loja escolhida numa empresa de várias, cada loja vem com os seus canais. O Mister é instruído a não concluir que um canal está desligado só por não ter pedido.
- **O login da 99**, pela mesma saúde da tela de integração (o token vigente, não só a ligação). A empresa sem a 99 não traz o pedaço.
- **O WhatsApp da loja** (o dos clientes): o provedor e, no Evolution, a conexão de agora (desconectado = ler o QR de novo).
- **A nota fiscal:** o ajuste de cada loja (em teste ou valendo), o certificado digital pela mesma conta da tela (vencido abaixo de zero, renovar até 60 dias), e as notas das últimas 24 horas: autorizadas, recusadas (com o motivo da SEFAZ), sem resposta há mais de 10 minutos e em contingência. A nota simulada fica de fora.
- **Permissões:** os canais, a 99 e o WhatsApp pedem o Delivery; a nota fiscal pede a permissão fiscal. Sem nenhuma das duas, a consulta recusa.
- **Fica de fora:** a fila de avisos a outros sistemas (`aviso_integracao`, como o estorno ao GoGeM). Ela não sincroniza, e a nuvem não veria as falhas que saíram do servidor da loja. Mostrar só as da nuvem seria dizer "nenhuma falha" sem ter lido (V37).
- **Próximas partes da F3:** a conciliação de pedido, pagamento e nota (os pedidos pagos online sem o pagamento confirmado, as vendas sem nota quando a nota é obrigatória) e a conferência do catálogo com os apps (a última leitura guardada, sem ler o app de novo).

**Conferência:** `mister-agente.regras.spec.ts` (o certificado nas bordas da conta da tela) e `mister-pg.teste-spec.ts` (os canais com a pausa e o último pedido, o pedido apagado e o de outra empresa fora, a 99, o WhatsApp, a nota fiscal com cada situação, as permissões, as várias lojas e o certificado vencido), também com o banco em UTC; prova por defeito com 5 defeitos, todos acusados; `app-sobe.spec.ts` (os módulos novos no agente).

### F3.2 — Os relatórios: o resumo do dia e o da semana (migration 420)

A quinta entrega do protótipo, parte dos relatórios ("Avisos e relatórios" › Relatórios). Fica em cima dos avisos (F1.2, migration 419) porque divide a mesma parte da tela e a mesma barra de salvar.

- **O que entra:** a migration 420 (`@cloud-only`) com `mister_relatorio_regra` (o horário de cada relatório por empresa; sem linha, o padrão, desligado) e `mister_relatorio` (cada envio a uma pessoa, com o texto ou o motivo de não ter saído); as rotas `GET/PATCH mister/relatorios` (presidente); o grupo "Relatórios" na tela, como no protótipo (o resumo do dia com o horário, o da semana com o dia e o horário, a mesma barra de "Salvar alterações").
- **Quando vence** (`relatorioDevido`): do horário escolhido até 3 horas depois. Passou disso, o resumo não sai, porque resumo atrasado demais não serve. O horário pode ter sido ontem quando a hora já virou o dia (23:30 conferido às 00:40). O resumo do dia marcado antes das 6 h é da noite que passou. O da semana sai só no dia escolhido e cobre os 7 dias até a véspera: na segunda, a semana passada inteira.
- **Quem recebe:** o presidente e os gerentes ligados ao Mister que não responderam PARAR AVISOS, a mesma régua dos avisos. Cada pessoa recebe UM resumo no escopo dela: o presidente, da empresa; o gerente, da loja dele.
- **Quem escreve:** o MESMO agente das perguntas, com as consultas, os tetos e o filtro de saída, a partir de uma pergunta fixa com o período por extenso e o começo da mensagem do protótipo ("*Resumo de quinta, 12/11*"). Cada relatório soma no seu recurso do "Uso da IA" (`mister_resumo_dia`, `mister_resumo_semana`).
- **A vez de fazer:** a linha de `mister_relatorio` é única por empresa, tipo, referência e pessoa. Quem insere primeiro faz, e a volta repetida e a réplica a mais não chamam a IA de novo. A linha "fazendo" com mais de 30 minutos foi interrompida: vira "não enviado" e não se refaz.
- **A janela de 24 horas da Meta:** fora dela, a mensagem livre não chega. O Mister confere a janela ANTES da IA, então nada se gasta, e a linha fica "não enviado / fora da janela". A tela mostra o último envio e o motivo em português. O modelo de mensagem aprovado pela Meta, que entrega fora da janela, é a parte 2 (junto com o dos avisos) e depende do dono.
- **Sem a chave de IA, sem crédito ou no teto:** não sai, e o motivo fica na linha. A pessoa não recebe mensagem de erro, porque o relatório não é uma conversa que ela abriu.

**Conferência:** `mister-relatorios.regras.spec.ts` (quando vence nas bordas: o horário, as 3 horas, a virada do dia, antes das 6 h, a semana; o relógio de São Paulo; as recusas da tela; a pergunta) e `mister-pg.teste-spec.ts` (a configuração com a auditoria e a recusa antes de gravar; a volta: um resumo por pessoa, o fora da janela sem IA, a vez da linha com duas voltas juntas, o filtro de saída, sem a chave, o envio recusado, PARAR AVISOS, a chave geral desligada, a linha interrompida), também com o banco em UTC; prova por defeito com 8 defeitos, todos acusados; o roteiro de tela do Mister (298 conferências, com a foto do cartão em 320, 375 e 1440 px).

### F3.3 — Leitura especializada, parte 2: a conferência do cardápio com os apps (sem migration)

A 13ª consulta, **`conferencia_do_catalogo`**, responde "os preços do iFood batem com o Regem?" e "tem produto faltando na 99?".

- **De onde vem:** a ÚLTIMA leitura guardada pela tela "Conferir com os apps" (Delivery › Gestão do catálogo). O método novo `ConferenciaService.resumoGuardado` faz a mesma conta da tela (`comparar` e `pendentes`, com os ignorados) e **nunca lê o app**: quem lê é a tela, no máximo uma vez por dia sozinha ou pelo "Ler agora".
- **O que traz, por app:** se está ligado (com o motivo quando não), quando foi lido, se a última leitura falhou, quantas linhas há a resolver e quantas em cada situação (só no app, só no Regem, preço diferente, não liga pelo código PDV), e até 8 exemplos em português. Os preços dos exemplos vão só para quem vê valores em reais.
- **Regras:** a permissão é a da tela (`loja`); é por loja, então numa empresa de várias o Mister pergunta qual; a empresa sem a conferência ligada recebe que ela não está ligada. O Mister é instruído a dizer a data da leitura, porque uma leitura antiga não mostra o que mudou depois dela.
- **Fica para a próxima parte:** a conciliação de pedido, pagamento e nota (os pedidos pagos online sem o pagamento confirmado, as vendas sem nota quando ela é obrigatória).

**Conferência:** `conferencia-pg.spec.ts` (o resumo com a tabela só-nuvem que a suíte já cria — ERR-451: não lê o app, bate com o botão da tela, tira o ignorado, nunca lida, sem a 99, desligada, loja de outra empresa) e `mister-pg.teste-spec.ts` (a consulta em português, a loja da empresa de uma loja, sem valores, sem a permissão, desligada, várias lojas), também com o banco em UTC; prova por defeito com 7 defeitos, todos acusados; `app-sobe.spec.ts` (o módulo da conferência no agente).

### F3.4 — O Atendimento agora (sem migration)

A 14ª consulta, **`atendimento_agora`**, responde "tem cliente esperando?", "tem caso urgente?" e "como está o atendimento?". Cobre também uma parte da conciliação: o estorno do Pix que falha vira caso urgente no Atendimento, e as disputas do iFood e os reembolsos da 99 entram com o prazo.

- **De onde vem:** a MESMA fila da tela (`AtendimentoService.fila`): a ordem (prazo, urgente, espera), a situação de cada caso, as contagens, a régua do perfil e os recados para o responsável, que só a gestão vê. O gerente preso a uma loja vê a fila da loja dele.
- **O que traz:** em aberto, na fila sem ninguém, com prazo, aguardando o cliente, resolvidos hoje e os recados; os 10 primeiros casos na ordem da fila, com o assunto (os rótulos da tela, conferidos pela spec), a situação, há quanto tempo espera, o prazo, o pedido como no quadro e o primeiro nome de quem está com o caso; e se a equipe está fora do horário.
- **O que NÃO vai à IA:** o nome, o telefone e a mensagem do cliente (a mensagem pode ter o endereço). A pergunta de gestão não precisa deles (LGPD, o mínimo).
- **Permissão:** a da tela (`pedidos`).

**Conferência:** `mister-agente.regras.spec.ts` (os assuntos iguais aos da tela; toda situação da fila com a sua frase) e `mister-pg.teste-spec.ts` (a fila no escopo da pessoa, com os recados; o mapeamento; nada do cliente no que vai à IA; o corte de 10; o gerente preso à loja; sem a permissão), também com o banco em UTC; prova por defeito com 7 defeitos, todos acusados.

### F3.5 — A conciliação: o que não fecha entre a venda, o dinheiro e a nota (sem migration)

A 16ª consulta (`conciliacao_do_periodo`, consultas em `mister-conciliacao.ts`). Só leitura. Hoje não existia nada que cruzasse pedido, pagamento e nota; o levantamento de 14/11 achou cinco sinais exatos com os dados de hoje:

1. **Pix pago em pedido cancelado sem o estorno feito.** Pode estar sem pedido de estorno há mais de 10 min, com o estorno que falhou, ou com o estorno parado. Soma o Pix do item posto depois (mig 373) que falhou. É a MESMA condição da rotina do estorno (V74): a `estorno-pix-pg.spec.ts` prova que as duas veem os mesmos pedidos.
2. **Pedido cancelado com a venda ainda de pé** (a comanda fechada).
3. **Pedido concluído sem o pagamento registrado:** em geral, o pago na entrega que não passou pelo "FINALIZAR". O resultado leva o "como ler": o recebimento não foi registrado no caixa do Regem, e o dinheiro pode ter sido recebido fora dele. Medido na nuvem em 14/11: 1.215 dos 3.412 concluídos em 30 dias, todos "na entrega" (Anota Aí 1.001). É efeito de a loja operar fora do Regem.
4. **Venda desfeita com a nota fiscal ainda autorizada.** Fora do totem, cancelar a venda não cancela a nota.
5. **Venda fechada cuja última nota foi recusada, denegada ou está sem resposta há mais de 10 min,** sem nenhuma nota válida.

Os casos 1, 2, 4 e 5 estavam em zero na nuvem em 14/11; a consulta fica de vigia.

- **Permissão:** cada parte segue a da tela onde o dado aparece. Pedidos usam a do Delivery; notas, a de Notas fiscais. Valores, só para quem vê valores.
- **Período:** é o da operação, pelo momento de cada fato.
- **A nota de teste:** a simulada não conta. A de homologação aparece marcada como teste.
- **Tabela que só existe na nuvem:** a parte do Pix que não pôde ser lida diz "não li", nunca zero.
- **Fica para depois** (depende de dado que não existe): o repasse do iFood e da 99, o livro do gateway, a maquininha sem TEF, a regra explícita de "venda que exige nota" e o estorno do totem pelo GoGeM (a fila não sincroniza).

**Conferência:**
- `mister-pg.teste-spec.ts`: os quatro casos e o que NÃO entra (a venda já desfeita, o concluído pago, a nota simulada, a nota corrigida depois, a autorizada com uma tentativa recusada depois, a pendente de agora e a outra empresa); a permissão de cada parte; os valores vazios para o gerente no perfil padrão; o período.
- `estorno-pix-pg.spec.ts`: a conciliação e a rotina do estorno veem os mesmos pedidos; o feito some; o que falhou volta.
- Prova por defeito: 11 de 11.

### F3.6 — Vigilância de dependências, parte 1: o que vence ou está desatualizado na loja (sem migration)

A 17ª consulta (`vencimentos_e_versoes`; regras em `mister-vencimentos.ts`). Só leitura e só datas: nunca o certificado, a senha, o token do IBPT ou o acesso do Instagram. O "pedeAtencao" diz o que precisa de ação e onde ela se faz. Cada parte que não pôde ser lida diz "não li", nunca "em dia".

- **O certificado digital da nota:** cada um cadastrado (o da loja e o da empresa toda), pela conta da tela (`situacaoDoCertificado`), **mesmo com a nota desligada**. O aviso do Mister só olha onde a nota está ligada; aqui a pessoa pergunta. Com a nota desligada, o vencimento aparece sem pedir atenção. Permissão da nota fiscal.
- **A tabela do IBPT do estado da loja:** qual vale hoje (a da Configuração fiscal, `IbptService.situacaoDaLoja`: a da própria loja, pelo token, ou a da DMS) e a situação da tabela da DMS pela régua do verificador da distribuição (`statusIbpt`). Sem tabela vigente, a nota sai sem o valor aproximado dos tributos (Lei 12.741): quem atualiza é a DMS, ou o token do IBPT da loja. Pede atenção só com a nota ligada.
- **O servidor da loja (só o presidente):** a licença, pela MESMA regra da renovação (ERR-466), pede atenção a partir de 15 dias. A versão instalada é comparada com a que ESTA loja já pode ter, pela mesma resposta que o servidor recebe na batida (`EdgeService.atualizacao`, com o piloto e o percentual do release), e com versão recolhida ou só pelo instalador (`LicencaService.vencimentoDoServidor`).
- **O acesso do Instagram** (presidente e gerente): pede para reconectar só com erro ou vencido (a Regem renova sozinha).

**Achado ao levantar (ERR-466, PR #990, mesclado em 14/11):** a licença do servidor da loja que está no ar vencia em 21/11/2026, com a conta valendo até 19/02/2027. A ativação copia o fim do teste da conta no dia da instalação, e o "Liberar" do console e a assinatura mudam só a conta. Em 21/11, o servidor travaria toda gravação. Agora vale a maior das duas datas, e a conta estende o servidor sem nunca encurtar.

**Fica para a parte 2** (pede mockup da tela no console): a vigilância das documentações e dos contratos das integrações (Meta, iFood, 99, Anthropic, gateways e SEFAZ), com as fontes oficiais, a versão anterior guardada para comparar, "não verificado desde" quando a fonte não responde, e a tarefa com responsável e prazo. O protótipo é o `mockups/regem-dependencias-e-qualidade.html` (#992), a aprovar.

**A base da parte 2, em 14/11 (sem migration):** o inventário do que o Regem usa de cada integração fica no código (`common/integracoes-em-uso.ts`), e é dele que a tela vai tirar a coluna "Usamos".
- **O teste que acompanha o código** (`integracoes-em-uso.spec.ts`) acusa:
  - versão da Graph API escrita fora do inventário ou diferente dele;
  - modelo de IA no código sem inventário ou sem preço na tabela do "IA e uso";
  - endereço do inventário que o código não chama mais.
- **Achado:** o WhatsApp e o número do Mister estão na Graph API v25.0, e o Instagram e o Messenger, na v27.0. Funciona, mas alinhar pede testar o envio e os webhooks com a Meta (tarefa da vigilância).

**Conferência:**
- `mister-vencimentos.spec.ts`: cada parte e o que pede atenção (a nota desligada não pede; a tabela própria se atualiza sozinha; a licença sem prazo; a versão recolhida e a do instalador; o Instagram só com erro).
- `mister-pg.teste-spec.ts`:
  - a nota desligada (só a licença pede atenção) e depois ligada (certificado, IBPT e licença);
  - a tabela da DMS vigente;
  - a versão nova;
  - tudo em dia;
  - o gerente sem a nota fiscal e sem o servidor;
  - a outra empresa.
- Prova por defeito: 6 de 6.

### F3.7 — Vigilância de dependências, parte 2: as fontes oficiais lidas todo dia (migration 423)

A vista "Console › Dependências" do protótipo `mockups/regem-dependencias-e-qualidade.html` (#992), feita com as decisões recomendadas enquanto o dono estava fora. O protótipo segue para a aprovação dele. **No ar em 15/11/2026 (#996):** a migration 423 entrou na nuvem com o clique do dono e foi conferida pela leitura (16 colunas, RLS ligada); a primeira leitura das fontes é às 06:07 ou pelo "Ler agora" do console.

- **A rotina** (`DependenciasService`, 06:07, só na nuvem) lê as fontes oficiais que moram no código (`modules/dependencias/dependencias-fontes.ts`). Cada uma foi aberta e conferida em 14/11:
  - **a tabela de versões da Graph API da Meta** (HTML; a data pode vir torta, "July 29,2028"). Dela sai a validade da versão em uso: a v25.0 do WhatsApp vale até 29/07/2028. A versão fora da tabela fica "a conferir", porque a tabela atrasa: em 14/11 ela ia até a v26.0, e a API já aceitava a v27.0 do Instagram e do Messenger (testado direto na API);
  - **a tabela "Model status" da Anthropic** (a página em Markdown). Os três modelos em uso estão ativos, com aposentadoria não antes de setembro e outubro de 2027.
- **O que se guarda e como se compara:**
  - Guarda-se só o trecho da tabela (`dependencia_leitura`), nunca a página: mudança de visual não vira "mudou".
  - Trecho diferente do guardado vira "a conferir", com o antes e o depois, até alguém decidir: "conferida", ou "não se aplica", que exige a nota.
  - Uma mudança nova zera a decisão.
- **Quando a fonte falha:** se ela não responde, recusa (403, 429) ou vem sem a tabela, a situação é "não verificada desde" a última leitura certa, e os achados ficam como estavam. Nunca vira "em dia" nem "retirada".
- **A tela:** a aba "Dependências" do console (Diretoria e Técnico).
  - Mostra cada integração do inventário (`common/integracoes-em-uso.ts`) e a tabela do IBPT por estado, que vem do banco.
  - As situações: a conferir, vencidas ou vencendo, não verificadas, em dia e conferir à mão (sem fonte automática).
  - Traz busca, tipo, a gaveta e "Ler agora".
  - As ações são auditadas.
- **A busca** passa pela guarda de endereço público (`buscarUrlPublica`, V68) e só vai às URLs do código. Nada se atualiza sozinho.
- **Fica para depois:** fontes automáticas do iFood (a página recusa robô, 403), da 99, do Mercado Pago, do PagBank, da SEFAZ e do Node; o aviso na aba Avisos do console quando uma fonte muda.

**Conferência:**
- `dependencias-fontes.spec.ts`: os leitores com os trechos reais das páginas; a validade e os 180 dias; a versão fora da tabela; o modelo deprecado; o trecho que ignora o visual.
- `dependencias-pg.spec.ts` (aplica só a 423, uma tabela isolada):
  - a primeira leitura, com a mudança, o antes e o depois;
  - a decisão, que fica e é zerada pela mudança nova;
  - a fonte sem resposta, com 403 ou sem a tabela;
  - as recusas da decisão;
  - a busca só nas URLs do código.
- Roteiro `mister-console`: a aba nas 16 larguras, com a gaveta aberta, o filtro, a busca, a decisão, "Ler agora", a falta da migration e o erro. São 259 conferências.
- Prova por defeito: 5 de 5.

### F5.1 — A qualidade do Mister no console, parte 1: a linha de base (sem migration)

A vista "Console › Mister › Qualidade" do protótipo `mockups/regem-dependencias-e-qualidade.html`, feita com as decisões recomendadas. O dono pediu para seguir com as recomendadas enquanto estava fora; o protótipo segue para a aprovação dele.

- **O que mostra:** como o Mister está respondendo em todas as empresas, nos últimos 7 ou 30 dias:
  - as perguntas e as respondidas;
  - as que responderam sem consultar dado;
  - o tempo até responder (a mediana e o tempo em que 90% respondem);
  - o custo por pergunta, pela mesma conta da tela "IA e uso";
  - as consultas mais usadas, com as que não conseguiram ler;
  - por que não respondeu, com os motivos de `MotivoSemResposta` em texto;
  - por empresa, com a situação da chave.
- **Onde fica:** a seção nova "Qualidade" da aba Mister do console, só para a Diretoria (`GET /distribuicao/mister/qualidade`, `MisterQualidadeService`).
- **O que nunca sai:** o texto da pergunta e da resposta, o telefone e a pessoa. Cada bloco é uma consulta agregada no banco, sem laço por empresa.
- **Ficou para depois:**
  - o assunto das perguntas sem resposta, por uma lista fechada: feito na F5.2, abaixo, **sem migration**;
  - a avaliação de regressão, com 40 perguntas fixas numa empresa de teste e a chave da DMS: F5.3;
  - um índice por data em `mister_pergunta`: **já existia** (`ix_mister_pergunta_criado`, da 418, feito para a limpeza diária), e a leitura de 30 dias usa esse índice.

**Conferência:**
- `mister-qualidade.spec.ts`: o período, o texto de cada motivo e os motivos que somam.
- `mister-pg.teste-spec.ts`, pela diferença antes e depois (a tabela é de todas as empresas):
  - as respondidas e as falhas;
  - as respondidas sem consulta;
  - os motivos e as consultas, com a que não leu;
  - o tempo;
  - por empresa, com o custo pela conta da tela e a chave;
  - os 30 dias, com a pergunta antiga;
  - nada de texto, telefone ou pessoa;
  - o período torto vira 7.
- Roteiro `mister-console`: a seção (os números, 7 e 30 dias, o vazio e o erro com "Tentar de novo") nas 16 larguras.

### F5.2 — O que pediram e o Mister não tem (sem migration)

Decisão recomendada, seguida em 15/11/2026: **o próprio Mister marca o tema**, como diz a nota do protótipo ("o Mister marca cada uma com um assunto de uma lista fechada"). Não se classifica o texto por palavras: quem sabe que o dado faltou é o modelo, na hora.

- **A anotação, a 18ª ferramenta (`anotar_o_que_falta`):**
  - não é consulta e não lê dado;
  - recebe só o `tema`, de uma lista fechada: vendas e pedidos, estoque e compras, financeiro e contas, equipe/escala/ponto, cardápio e preços, clientes, delivery e canais, nota fiscal e impostos, outro assunto;
  - as instruções mandam chamá-la antes de dizer "ainda não tenho acesso"; a descrição diz para não chamá-la quando uma consulta deu erro (isso é "não consegui ler agora");
  - responde também a quem está sem loja.
- **Onde fica:** na trilha que a pergunta já tinha (`mister_pergunta.ferramentas[].entrada.tema`), por isso não precisa de migration.
  - O tema fora da lista vira "outro": as palavras da pessoa nunca vão à trilha.
  - Não é consulta em lugar nenhum. A memória da conversa continua marcando "sem consulta" a resposta que só anotou (é o que deixa o Mister reconhecer um erro seu, ERR-461). As "consultas mais usadas" do console não a contam.
- **No console › Mister › Qualidade:**
  - o número **"Não tenho acesso"** (o do protótipo) troca o "Sem consultar dado", que passa para a nota de "Respondidas";
  - o cartão novo **"O que pediram e o Mister não tem"**, com as barras por tema.
  - A API de antes do deploy, sem os campos novos, não quebra a seção (zero e "Nada faltou neste período.").
- **Custo:** uma volta a mais ao modelo, só nas perguntas sem dado (com o trecho fixo em cache). As perguntas anteriores ao deploy não têm a anotação: o número cresce a partir de 15/11.

**Conferência:**
- `mister-agente.regras.spec.ts`:
  - a lista de temas da ferramenta e o texto de cada um;
  - o tema fora da lista vira "outro" (também na trilha);
  - a anotação não é consulta, e a memória continua "sem consulta";
  - a frase das instruções.
- `mister-qualidade.spec.ts`: os temas somam pelo texto, e o tema desconhecido vai para "outro assunto".
- `mister-guia-de-uso.spec.ts`: a anotação responde a quem está sem loja.
- `mister-pg.teste-spec.ts`, pela diferença antes e depois:
  - o "não tenho acesso" e cada tema;
  - a anotação fora das consultas;
  - a resposta que só anotou conta como "sem consultar dado".
- Roteiro `mister-console`:
  - o número e o cartão;
  - a API antiga sem quebrar a seção.

### F5.3 — A avaliação de regressão (migration 424)

O cartão "Avaliação de regressão" do protótipo `mockups/regem-dependencias-e-qualidade.html`, feito com as decisões recomendadas (15/11/2026).

**Decisão recomendada: a loja de teste mora no código.** O protótipo dizia "numa empresa de teste com dados inventados". Uma empresa de verdade na produção, com pedidos e vendas inventados, entraria nos números da distribuição e pediria gravar dado fora de migration. Por isso:

- **Os dados inventados** (`mister-avaliacao-casos.ts`) são o que cada ferramenta devolve na "Empresa de Teste da Avaliação":
  - as mesmas chaves das ferramentas de verdade e as mesmas recusas (o gerente não abre o servidor; quem não vê valores recebe os valores vazios com o aviso);
  - números que batem entre si (o faturamento de ontem é o mesmo no resumo e no relatório; as horas somam o dia);
  - centavos que não terminam em zero;
  - o guia de uso é o de verdade.
- **As 40 perguntas** dizem o que a resposta certa tem: a consulta, os números, o tema do que falta, nenhum valor a quem não vê valores, nenhuma consulta para um "bom dia".
  - Toda consulta do Mister tem pergunta: uma consulta nova sem pergunta reprova o teste.
- **A conferência é por regra, nunca a IA julgando a si mesma.** Para todas as perguntas, um valor em reais que nenhuma consulta trouxe reprova (o filtro de saída de verdade).

**O laço é o mesmo do agente.** O laço saiu do `MisterAgenteService` para `mister-laco.ts`: as mesmas instruções, as mesmas ferramentas e os mesmos tetos. Muda só a porta:

- a IA da distribuição (`IaEmpresaService.pedirPelaDistribuicao`), que não soma no medidor de nenhuma empresa — o custo fica na rodada;
- as ferramentas da loja de teste.

O serviço mora no `MisterModule`, sem depender dos módulos de dados.

**A rodada (`mister_avaliacao`, mig 424, só nuvem, sem loja):**

- só pelo botão (cada rodada gasta a chave da DMS), uma de cada vez (índice único), 3 perguntas em paralelo;
- o andamento é gravado a cada pergunta; a chave recusada ou sem crédito para a rodada;
- a rodada parada há mais de 20 min (processo caiu) sai "interrompida", pela regra do serviço (V80), e não trava a próxima.

**No console › Mister › Qualidade:**

- as últimas 10 rodadas, com a versão das instruções (a impressão de 8 letras e as consultas), o resultado, "o que falhou" e o custo;
- o aviso quando as instruções mudaram desde a última rodada;
- "Ver as 40" em gaveta, com cada pergunta certa ou errada e o porquê;
- "Rodar a avaliação", com o custo da última (perto de US$ 0,04 com o Haiku), e o andamento relido a cada 4 s enquanto roda.

O cartão fica depois de "Por empresa", e não antes como no protótipo: ele não depende do período nem das perguntas das lojas e aparece sempre, com o carregar e o erro dele.

**Conferência:**

- `mister-avaliacao-casos.spec.ts`:
  - as 40 perguntas e cada uma conferindo algo;
  - toda consulta com pergunta;
  - cada número esperado existe na loja de teste;
  - os números batendo entre si;
  - os dois perfis;
  - cada regra da conferência reprovando o que deve.
- `mister-pg.teste-spec.ts`, com uma IA de mentira que responde certo:
  - 40 de 40 pelo laço de verdade, o andamento, os tokens somados e o custo;
  - a lista, e as perguntas na ordem;
  - uma rodada de cada vez, e a parada vencendo pelo tempo;
  - a pergunta errada em "o que falhou";
  - a chave recusada parando a rodada, e sem a chave nem começar.
- Roteiro `mister-console`:
  - as rodadas, a gaveta e rodar com o andamento;
  - a versão mudada, sem a chave, o erro e o vazio;
  - a gaveta aberta nas 16 larguras.

**A primeira rodada no ar (15/11/2026, pedida pelo dono):** 40 de 40 em 36 s, US$ 0,02, versão `a4fae716`, Haiku.

### F5.4 — A segurança e o que melhorar (o Sentinela e o Mentor, parte 1; sem migration)

Os dois papéis do prompt do dono que faltavam na F5, na parte 1: sem IA, só leitura e só com o que o servidor já anota. Protótipo `mockups/regem-mister-sentinela-mentor.html` (#1004), feito com as decisões recomendadas.

- **Console › Mister › Segurança (o Sentinela), só para a Diretoria** (como a aba Mister) — `GET /distribuicao/mister/seguranca`, `MisterSegurancaService`. O que as proteções barraram, em 7 ou 30 dias:
  - **na saída** (`mister_pergunta.conferencia`): segredo tirado, link tirado, valor sem origem, resposta cortada;
  - **na entrada** (`mister_mensagem.desfecho`): código que não vale, códigos demais e o telefone calado, número de outra pessoa, telefone não ligado, quem perdeu o acesso;
  - **o limite de perguntas** (`motivo`);
  - **o "Pede atenção" por regra:** cada segredo tirado é crítico, com a consulta que trouxe o dado, a empresa e a hora (até 3 por nome; os outros somados); telefone calado por código errado é atenção;
  - **por empresa:** só o que se sabe de quem é.
  - **Nunca:** o telefone (só quantos telefones, contados sem repetir), o texto, o código digitado ou o que a consulta trouxe.
- **"O que melhorar" (o Mentor), no fim da Qualidade** — `melhorar` na resposta da Qualidade, `padroesParaMelhorar`. Cada padrão traz a observação, a causa provável e a proposta, por regras fixas:
  - o tema que mais faltou, 3 vezes ou mais e fora de "outro assunto" = **falta consulta**;
  - a consulta com 10 usos ou mais que não leu mais de 10% = **erro na consulta** (até 3);
  - a última avaliação com erradas = **instrução**;
  - a chave ou a conta de IA da empresa, 3 perguntas ou mais = **da empresa** (nada nas instruções).
  - Nada muda sozinho.
- **Fica para a parte 2:**
  - o segredo tirado como aviso ao suporte da DMS (a decisão 4 do protótipo);
  - a análise com IA dos eventos, sempre como proposta;
  - as decisões "virou tarefa / não se aplica" do Mentor (pedem migration);
  - as versões candidatas das instruções testadas pela avaliação.

**Conferência:**
- `mister-seguranca.spec.ts`: as notas, os desfechos, a janela em palavras, o "Pede atenção" (crítico e atenção, até 3 por nome e o resto somado).
- `mister-qualidade.spec.ts`: cada regra do "o que melhorar", os limites e a ordem.
- `mister-pg.teste-spec.ts`, pela diferença antes e depois:
  - cada nota e cada desfecho, os telefones distintos e o calado;
  - o segredo com a consulta (sem a anotação), a empresa e o limite;
  - por empresa e os 30 dias;
  - nada de telefone, texto ou id;
  - o "o que melhorar" com o tema que mais faltou e a avaliação com erradas.
- Roteiro `mister-console`:
  - a Segurança inteira, 30 dias, o vazio e o erro só na seção;
  - o "o que melhorar" e a API antiga sem quebrar;
  - as 16 larguras com a Segurança carregada.

**F5.4, parte 2a (16/11/2026, sem migration): o segredo tirado vira aviso ao suporte da DMS** (decisão 4 do protótipo
aprovado).
- **O aviso:** um tipo SÓ DA DISTRIBUIÇÃO, `segredo_na_resposta`, com a regra fixa em `AVISOS_DA_DISTRIBUICAO` (destino
  `dms`), fora de `TIPOS_DE_AVISO`. A loja não o configura nem o desliga.
- **A fonte:** está na volta dos avisos. São as perguntas das últimas 24 horas com a nota `segredo` em `conferencia`,
  uma por pergunta (`segredo:<id>`). O aviso fecha sozinho quando passa das 24 horas.
- **Onde aparece:** no Console › Avisos, pela entrega `dms`. O Histórico da loja exclui esse tipo, e a tela da loja só
  mostra o destino `tela`. O aviso leva a hora e as consultas, nunca o segredo.
- **Ainda na parte 2:** a IA sobre os eventos, as decisões do Mentor ("virou tarefa", "não se aplica", com migration) e
  as versões candidatas das instruções. Essas três pedem tela, então pedem protótipo antes. **O protótipo
  `mockups/regem-mister-mentor-parte2.html` foi aprovado em 16/11/2026, com as fases M2a, S2 e M2b.**

**M2b (16/11/2026, migration 435): as instruções candidatas (o Mentor).**
- **A decisão do desenho:** a versão nova NÃO guarda o texto inteiro — guardaria uma cópia que esconde as mudanças futuras
  do código (como a linha do cancelamento da F4.2b) —, e sim a TROCA de uma linha: a que sai (exata) e a que entra. O texto
  "no ar" = o do código com as trocas publicadas, em ordem (`aplicarTrocas`); a troca cuja linha sumiu do código fica de
  fora e o console avisa. Sem troca, a versão é a mesma do código (a mesma conta de `versaoDasInstrucoes`).
- **A tabela:** `mister_instrucao_troca` (tipo troca ou volta, a linha que sai e a que entra, o porquê, o padrão de origem,
  a situação, a versão base e a da candidata, a rodada da avaliação, quem e quando). Uma candidata por vez.
- **O Mentor** (`IaEmpresaService.pedirPelaDistribuicao`, o Sonnet 5.5, 800 tokens): lê as instruções numeradas e as
  perguntas que a avaliação inteira da versão no ar errou (a pergunta fixa e a falha) e propõe UMA troca; a linha que sai
  precisa existir no texto (conferida sem o número e sem os espaços das pontas); fora disso, nada é gravado e o console
  diz por quê. Sem avaliação inteira da versão no ar, ou sem erradas, o Mentor nem é chamado.
- **A avaliação por versão:** `MisterAvaliacaoService.rodar` passou a rodar com o texto no ar (ou o da candidata, pela rota
  `instrucoes/avaliar`) e a mostrar a versão no ar como a atual.
- **Publicar** (com confirmação na tela, porque vale para todas as empresas): a regra conferida DENTRO da transação, com a
  candidata travada — a candidata nasceu sobre a versão no ar de agora, a avaliação dela terminou inteira com a versão
  dela, a versão no ar tem uma avaliação inteira para comparar, e nenhuma pergunta que acertava passou a errar.
- **A volta** ("Voltar sem esta troca", só a última): vira uma candidata que também passa pela avaliação; publicada, a troca
  fica "retirada". O agente, os relatórios e a avaliação usam o texto no ar (cache de 30 s por réplica; o publicar limpa na
  hora a sua); a leitura que falha não segura a resposta — vai o texto do código.
- **As rotas:** `GET /distribuicao/mister/instrucoes`, `POST …/candidata`, `…/volta`, `…/avaliar`, `…/publicar` e
  `…/descartar`, só Diretoria, com auditoria; pedir e avaliar com limite de 3 por minuto.

**S2 (16/11/2026, migration 434): a análise com IA da Segurança (o Sentinela, parte 2).**
- **As tabelas:** `mister_analise` (a rodada: quem pediu, a situação, os dias, os eventos lidos, o modelo, os tokens, o
  custo, o motivo da falha) e `mister_analise_proposta` (o nível, o título, o que viu, a proposta, o impacto, a decisão e
  quem decidiu). Só da nuvem e da distribuição; uma rodada "rodando" por vez (índice único parcial); a que passou de 5
  minutos vira "interrompida" (a regra é UMA, no serviço — V80).
- **O que a IA lê** (`mister-sentinela.ts` + `MisterSentinelaService.metadados`): o resumo da Segurança, os telefones com
  3+ códigos errados (só o FINAL, com o primeiro e o último horário), as notas do filtro por consulta e os motivos de não
  responder. Nunca o texto, o telefone inteiro, o código ou o id da empresa — o teste confere no pedido que sai.
- **A chamada:** `IaEmpresaService.pedirPelaDistribuicao` (a chave da DMS, sem medidor de empresa), o modelo das
  perguntas, 1.500 tokens de saída, prazo de 60 s, em segundo plano. Só o JSON pedido vale: nível da lista fechada
  (crítico, atenção, melhoria), os quatro textos preenchidos e cortados, no máximo 5; fora do formato, a rodada falha com a
  frase e nada é gravado; lista vazia é rodada sem proposta. Sem crédito, chave recusada ou teto: a frase de cada um.
- **A tela** (Console › Mister › Segurança, sempre à vista): o custo estimado ANTES de rodar, "Analisar os últimos 7 dias",
  "Analisando…" que acompanha a cada 3 s só enquanto roda, os três números (eventos lidos, propostas, custo), cada
  proposta com o nível, o que viu, a proposta e o impacto, "Virou tarefa" (link ou código em gaveta) e "Descartar", uma
  vez só (409 depois); "A análise não saiu" com o motivo e "Tentar de novo"; sem a chave da DMS, o aviso e o botão travado.
- **As rotas:** `GET/POST /distribuicao/mister/seguranca/analise` e `POST …/analise/decisao`, só Diretoria, com auditoria
  (`rodou_analise_do_sentinela`, `decidiu_proposta_do_sentinela`); rodar com limite de 3 por minuto.

**M2a (16/11/2026, migration 432): as decisões do "O que melhorar".**
- **A tabela:** `mister_melhoria_decisao`, só da nuvem e da distribuição (sem empresa). Guarda a chave do padrão, a
  decisão, o motivo, a tarefa, quem decidiu e quando, e o `vale_ate` do "não se aplica". O índice único parcial deixa uma
  só decisão valendo por padrão.
- **A chave do padrão** fica estável entre as leituras: `falta:<tema>`, `consulta:<nome>`, `avaliacao:<id da rodada>`
  (uma rodada nova com erradas é padrão novo) e `motivo:<motivo>`.
- **As regras:** `comAsDecisoes` mostra "virou tarefa" à vista com a decisão e esconde o "não se aplica" até vencer (30
  dias); vencido, o padrão volta a "aberto". O `decidir` desfaz o vencido na mesma transação. Com uma decisão valendo,
  responde 409 "desfaça antes" (duas abas ao mesmo tempo: uma entra).
- **As rotas:** `POST /distribuicao/mister/qualidade/decisao` e `/desfazer`, só para a Diretoria, com a auditoria do
  console (`decidiu_padrao_do_mister`, `desfez_decisao_do_mister`).
- **A tela:** no cartão, as situações com as contagens, "Virou tarefa" e "Não se aplica" em gaveta, e "Desfazer a
  decisão". A API antiga, sem a chave, deixa o cartão só de leitura.

### F2.5 — O suporte de uso: o guia "como faço…" (sem migration)

Decisão do dono de 14/11/2026 ("use o recomendado"): o suporte de uso nasce de um **guia curto das telas principais, escrito por nós** a partir das telas de verdade. Não havia documentação de uso no repositório (o Bot de Suporte guarda as regras de cada loja, não o uso do Regem).

- **Onde fica:** `backend/src/modules/mister/mister-guia-de-uso.ts`, no código da DISTRIBUIÇÃO: igual para toda empresa, nenhuma loja edita, muda junto com as telas. São 49 seções (delivery, balcão e caixa, relatórios, estoque, cadastros, escala, configurações, financeiro, atendimento e o próprio Mister), cada uma com o caminho do menu, a rota, a permissão e o módulo do item do menu, as palavras de busca, o passo a passo (até 7 passos), os nomes de botão citados, as observações da própria tela e as seções ligadas (`veja`).
- **A 15ª consulta, `como_usar_o_regem`:** recebe o assunto com as palavras da pessoa e devolve até 3 seções, com "onde fica" (Grupo › Item), quem abre (o nome da permissão de Acessos & perfis e o do módulo) e se ESTA pessoa abre (a régua do menu: o presidente abre tudo; o gerente, pela permissão; a tela só do presidente, nunca). Não lê banco, então responde também a quem está sem loja. Sem nada que responda, devolve os assuntos que o guia tem, e o Mister consulta de novo com as palavras do assunto certo ou diz que ainda não sabe explicar.
- **A busca:** sem IA e sem índice, só palavras: sem acento, sem as palavras vazias ("como faço para…"), pela raiz simples (pauso, pausa, pausar e pausado são a mesma palavra). Palavra-chave vale 3, do título 2, dos passos 1. A seção precisa de uma palavra-chave (ou duas do título), de cobrir mais de um terço das palavras pedidas e de mais da metade dos pontos da melhor.
- **Nada inventado (V65, ERR-269):** as instruções mudaram. Para "como faço…" e "onde fica…", o Mister passa o caminho e os passos que o guia trouxe e nunca inventa nem completa menu, botão ou aba. Quando pedem uma ação que ele não faz, diz onde ela é feita.
- **O que o levantamento achou (e o guia segue o código, não o palpite):** ligar o iFood e a 99 é em Delivery › Configurações › Integrações (Aplicativos conectados só lista e revoga quem lê os dados); o cupom de desconto é em Delivery › Configurações › Cupons (PDV · Balcão › Cupons é a lista das vendas); o entregador é um colaborador com a função de entregador, em Cadastros; o PIN nasce no cadastro do colaborador; não existe "reenviar nota" (existem "Consultar na SEFAZ" e "Tentar transmitir agora"); o gerador da escala monta uma pessoa e uma vaga por vez; a parte "Resumo" do Mister ainda não existe.

**Conferência:** `mister-guia-de-uso.spec.ts` lê o `NAV` do `shell.tsx` e confere, para cada seção, que o caminho e a rota são uma linha do menu com a mesma permissão, o mesmo "só o presidente" e o mesmo módulo; que cada texto entre aspas nos passos está na lista de botões e que cada botão existe LITERALMENTE no `frontend/src`; que nenhum passo escreve um caminho de menu à mão ("›" só pelo `veja`); e que não há valor em reais nem endereço da internet (o filtro de saída tiraria). A busca: 44 perguntas escritas como um dono escreveria, com a seção certa em 1º; 15 perguntas escritas depois do ajuste e medidas sem mexer nele (a certa veio em 1º em 10 de 16 e entre as 3 em 15 de 16), que ficam como guarda das 3 primeiras; e cada seção achada pelo próprio título. A consulta: sem assunto, fora do guia, sem loja, a régua de quem abre (gerente com e sem a permissão, presidente, tela só do presidente). `mister-agente.regras.spec.ts`: a 15ª ferramenta, as instruções novas e o assunto na trilha.

### F1.2b — Os avisos, parte 2a: o grupo Fiscal (sem migration)

Dois dos quatro avisos que faltavam na tabela aprovada em 14/11 passam a funcionar. Os outros dois (pedido parado e iFood ou 99 desconectado) seguem para as próximas entregas e continuam aparecendo na tela como "chega na próxima entrega".

- **Certificado digital perto de vencer** (padrão: o presidente pelo WhatsApp):
  - **Onde:** só nas lojas com a emissão da nota LIGADA. Sem emissão, o certificado não para nada.
  - **Qual certificado:** a régua do fiscal — a configuração da loja ou, sem ela, a da empresa (`configRaw`); o certificado da loja ou, sem ele, o da empresa (`obterCredencial`). O mesmo certificado em várias lojas vira um aviso só, porque a chave é a do certificado.
  - **Quando:** pela MESMA conta da tela (`diasParaVencer`). Abre no primeiro marco (60, 30, 15, 7 ou 1 dia, ou vencido) e, a cada marco seguinte, o MESMO aviso manda um lembrete ("🔔 Lembrete: …"), só pelo WhatsApp — o KDS, a tela e o Atendimento já mostram o aviso aberto. O título leva a data do vencimento, que não muda todo dia; os dias que faltam vão no detalhe. Renovado, o aviso resolve e quem recebeu ganha o desfecho.
  - **Como o lembrete sai uma vez:** a renovação do aviso grava o marco que estava (`marcoAnterior`, lido da linha antes da troca). Como a linha fica travada na renovação, a segunda réplica já lê o marco novo e não lembra de novo.
- **Nota fiscal sem resposta** (padrão: caso urgente no Atendimento e o presidente):
  - **Qual nota:** a pendente, não simulada, com chave, que gastou TODAS as reconsultas. O número é o do fiscal, que passou a ser exportado (`MAX_TENTATIVAS_CONSULTA_DA_NOTA`, hoje 12), para as duas pontas não divergirem (V74).
  - **Custo:** a consulta usa o índice parcial das pendentes (`idx_nota_pendente_consulta`): a cada minuto, lê só as pendentes.
  - **Quando resolve:** quando a SEFAZ responde (autorizada, rejeitada ou cancelada). O caso do Atendimento fecha junto.
- **Onde resolver, no texto do aviso:** o caminho e o botão saem do guia de uso (seções `configurar-nota` e `nota-fiscal`), que a spec do guia confere contra o menu e as telas (V65).
- **Na nuvem hoje:** nenhuma loja tem a emissão ligada e não há nota pendente, então nada dispara agora. O único certificado cadastrado vence em 18/11/2026; com a emissão desligada, ele não gera aviso.

**Conferência:** `mister-avisos.regras.spec.ts` (os marcos nas bordas; a conta dos dias igual à da tela, inclusive nas meias horas; o título com a data e o detalhe com os dias, hoje, amanhã e vencido; a nota com o número, a série, as tentativas e o caminho do guia; o lembrete só quando o marco muda) e `mister-pg.teste-spec.ts` (o certificado só com a emissão ligada, abre no marco, a volta seguinte calada, o lembrete uma vez com duas voltas juntas, vencido, renovado resolve com o desfecho; o da loja antes do da empresa e o da empresa em várias lojas como um aviso só; a nota que ainda vai ser reconsultada e a simulada fora, o caso urgente e o presidente, respondida resolve e fecha o caso).

### F1.2c — Os avisos, parte 2b: iFood ou 99 desconectado (sem migration)

O terceiro dos quatro avisos que faltavam. Falta só "pedido parado", que nasce desligado.

- **O que o levantamento achou:**
  - **O iFood:** a busca de pedidos (`IfoodService.polling`) engolia a resposta de erro (401, 403, 500…). Ela devolvia lista vazia, e o poller entendia que "funcionou": um token revogado do iFood ficava invisível.
  - **O contador do poller** (`FalhasDoPoller`) é só da memória e só conta falha de rede.
  - **A 99** não busca pedidos (eles chegam por webhook), então o poller dela não mede se a 99 responde. O sinal durável da 99 é o login recusado (`lastAuthErrno`), que o serviço da 99 já grava. Ele grava `-1` também quando a rede cai, e `-1` não é recusa.
- **O iFood anota a própria saúde:** a busca de pedidos marca "sem resposta desde" (`config.semRespostaDesde` e o motivo: `http_<código>`, `sem_token` ou `sem_resposta`) e limpa quando o iFood volta a responder. A integração é só da nuvem.
  - A gravação é condicional: marca só se não estava marcado (o "desde" fica) e limpa só se estava. Ela mescla só as suas chaves (V82).
  - Para não ir ao banco a cada 30 s, o processo lembra o último estado e só grava quando ele muda. Também reafirma a cada 10 min, porque a rota genérica do delivery regrava o `config` a partir de uma cópia em memória e poderia ressuscitar uma marca já limpa.
  - Nunca lança: a entrada de pedidos não para por causa disto. O poller não mudou.
- **O aviso:**
  - **O iFood:** sem responder há pelo menos `POLLER_ERRO_APOS_MS` (5 min, o mesmo tempo em que a telemetria passa a tratar como erro). O título leva desde quando; o detalhe leva há quanto tempo, o motivo em português, o que fazer enquanto isso (aceitar pelo Gestor de Pedidos do iFood) e onde conferir a ligação, pelo guia.
  - **A 99:** o login recusado (código positivo). O detalhe diz o que para (confirmar os pedidos e avisar a saída) e onde conectar de novo, com o botão do guia.
  - **Integração desligada pela loja** não avisa. A que voltou resolve.
- **Padrão aprovado em 14/11:** o gerente pelo WhatsApp (sem gerente ligado, vai ao presidente) e a tela da loja (ainda "chega na próxima entrega").

**Conferência:**
- `mister-avisos.regras.spec.ts`: o limite de 5 min igual ao da telemetria, o título e o detalhe, os motivos e as horas, a 99 só com código de recusa e o botão conferido pelo guia.
- `ifood-saude.spec.ts`: cada resposta da busca vira a anotação certa; o erro segue para o poller; o banco só muda com o estado, com reafirmação de 10 min; banco fora não lança.
- `mister-pg.teste-spec.ts`:
  - a gravação de verdade marca uma vez, mantém o "desde", limpa e não mexe nas outras chaves;
  - a volta: 3 min ainda nada; 6 min abre ao gerente/presidente e à tela; a 99 com `-1` não avisa e com código avisa; os dois voltam e resolvem; desligada não avisa.

### F1.2d — Os modelos da Meta: avisos e resumos fora das 24 horas (parte 2 da F1.2 e da F3.2; sem migration)

Passadas 24 horas da última mensagem da pessoa, o WhatsApp só entrega modelo aprovado pela Meta. Até aqui o aviso e o resumo ficavam anotados (`fora_da_janela_de_24h`). Pedido do dono em 14/11: "pode gerar modelos".

- **Os dois modelos** (`mister-modelos.ts`; categoria utilidade, português do Brasil, um botão de resposta rápida):
  - `mister_aviso`: "Aviso do Mister para {{1}}: {{2}}. Toque no botão para ver o que fazer." — {{1}} é a loja (o começo do título, antes do " · "; sem loja, a empresa) e {{2}}, o quê. Botão "Ver o que fazer".
  - `mister_resumo_pronto`: "Seu {{1}} está pronto ({{2}}). Toque no botão para receber." — {{1}} é "resumo de sexta, 13/11" ou "resumo da semana de 02/11 a 08/11", e {{2}}, a empresa. Botão "Ver resumo".
  - O texto mora no código, e o pedido de aprovação sai com ele. Assim, o número de parâmetros aprovado é sempre o que o envio manda. Mudar o texto de um modelo aprovado pede um nome novo.
- **O pedido de aprovação** (console da distribuição › aba "Mister" › "Modelos de mensagem", só Diretoria, com auditoria `pediu_modelos_mister`):
  - mostra os dois, com a situação lida ao vivo na Meta (ainda não pedido, em análise, aprovado, recusado com o motivo, pausado, desativado) e a categoria, se a Meta trocou para marketing;
  - "Pedir aprovação à Meta" pede só os que ainda não existem.
  - Tudo é lido e gravado na conta do NÚMERO DO MISTER (`mister_numero.waba_id`), nunca na de uma loja (ERR-458).
- **O envio fora das 24 horas:**
  - **Aviso** (abriu, escalou, lembrete): vai o modelo, com o código `mister:aviso:<id>` no botão. A trilha anota `via: 'modelo'`. Sem o modelo aprovado, fica `fora_da_janela_e_sem_modelo`. O desfecho ("✅ Resolvido") continua só dentro da janela.
  - **Resumo:** vai o CONVITE pelo modelo, com `mister:resumo:<id>`, e a linha fica "não enviado / `convite_enviado`", com o período na trilha. Nada se gasta com IA antes do toque.
- **O toque** (o webhook manda `type: button` com o código em `button.payload`; a entrada não o trata como pergunta):
  - a mensagem abre a janela, que é do telefone com o número do Mister: a hora vale para todos os vínculos daquele telefone;
  - **aviso:** só para quem recebeu. O aviso tem de ser de uma empresa do telefone, a trilha tem de ter a entrega pelo modelo para o final do telefone, e a pessoa ainda tem de receber aquele aviso (presidente, ou gerente da loja dele). Aberto, vai o texto inteiro com o que fazer; resolvido, o desfecho;
  - **resumo:** só a pessoa do convite (empresa e colaborador). A gravação condicional pega a vez: dois toques não fazem dois resumos. O resumo é do período do convite, pelo mesmo agente e recurso. Se a IA não responde, a pessoa recebe a frase do motivo e o convite continua valendo. Um toque repetido manda de novo o resumo já feito;
  - o que não é dela recebe "Não achei esse aviso para este WhatsApp.".
- **A tela Avisos e relatórios** passa a dizer "foi o convite pelo WhatsApp (fora das 24 horas)" e o motivo "a Meta ainda não aprovou o modelo de mensagem".
- **Divergência do protótipo:** o bloco "Modelos de mensagem" do console não estava no `mockups/regem-mister.html`. Ele segue o padrão dos outros blocos da aba (título, frase, cartões, botões).

**Conferência:**
- `mister-modelos.spec.ts`: as regras da Meta para o corpo (não começa nem termina em parâmetro, nem dois lado a lado); o pedido no formato da documentação (o exemplo em lista dentro de lista); o parâmetro limpo (sem quebra de linha, sem espaços seguidos, nunca vazio, com teto); os parâmetros do aviso e do resumo; a mensagem com o código no botão; o toque só com id que é uuid; a situação e as recusas (#132000, #132001, #132015, #132016).
- `mister-pg.teste-spec.ts`:
  - o console lê só na conta do número, ignora o parecido e o de outro idioma, pede uma vez só, mostra o aprovado (com a categoria trocada) e o recusado (com o motivo), devolve a recusa do pedido e, sem número, não lê nem pede;
  - o aviso fora da janela vai pelo modelo. O gerente que não recebeu e a presidente de outra empresa não veem. O toque chega pelo webhook (`type: button`), abre a janela e traz o texto; o reenvio da Meta é ignorado; depois de resolvido, traz o desfecho. Sem o modelo aprovado, fica anotado;
  - o resumo fora da janela vira convite, sem gastar IA. A outra pessoa não pega. Sem a chave, vai a frase e o convite segue. Com a IA, o resumo sai no escopo do gerente, do mesmo período; o toque repetido reenvia sem IA. Sem o modelo aprovado, fica anotado.

### F1.2e — Os avisos, parte 2c: pedido parado (sem migration)

O último dos nove avisos da tabela aprovada. **Nasce desligado** (padrão: 20 min; KDS, tela da loja e WhatsApp do gerente). A empresa liga em Mister › Avisos e relatórios e escolhe 15, 20 ou 30 minutos.

- **Três etapas, cada uma com o seu relógio** (`situacaoDoPedidoParado`):
  - sem aceite, desde a chegada;
  - aceito e ainda não pronto, desde o aceite;
  - pronto de ENTREGA sem sair, desde o pronto. A retirada pronta espera o cliente e não avisa.
  - "A caminho" não entra: o tempo de rua depende da distância, e o canal conclui por conta própria.
- **O pedido é citado como no quadro do Delivery** (`pedidoComoNoQuadro`: "#284 · iFood 4821"). O detalhe aponta o botão conferido pelo guia ("AVANÇAR", "Despachar").
- **Um aviso por pedido e etapa** (`pedido:<id>:<etapa>`). O pedido andou, resolve; parou de novo na etapa seguinte, é outro aviso.
- **Quando abre:** pedido de até 6 horas (o mais velho é pendência antiga do turno). A encomenda só começa a contar 30 min antes do horário (`PREPARO_DA_ENCOMENDA_MIN`, a régua do KDS). Loja com servidor instalado e SEM SINAL (`edge_status` mais velho que `EDGE_JANELA_MIN`) não abre: lá quem anda os pedidos é o servidor, e a situação na nuvem está velha. O "servidor sem sinal" já avisa.
- **O aberto continua enquanto o pedido estiver na mesma etapa:** mesmo com o servidor sem sinal, depois das 6 horas ou com o tipo desligado (aí fecha calado). Assim ninguém recebe "✅ Resolvido" de um pedido que não andou. O título fica com o tempo com que abriu.
- **Cuidado ao ligar:** com a loja ainda andando os pedidos fora do Regem, cada pedido vira aviso depois do tempo. Ligar só quando a loja aceitar, marcar pronto e despachar no Regem.

**Conferência:**
- `mister-avisos.regras.spec.ts`: as três etapas, o pedido como no quadro (com e sem número do canal), a chave por etapa e os botões do guia; os nove avisos funcionando, com o pedido parado desligado no padrão.
- `mister-pg.teste-spec.ts`, com nove pedidos de verdade:
  - desligado não avisa; ligado, abrem as três etapas, e não abrem o recente, o aceito há pouco, a retirada pronta, o de 7 horas, a encomenda e o a caminho;
  - trocar o tempo não muda o título;
  - aceito, resolve com o desfecho;
  - com o servidor sem sinal, nada resolve nem abre; ele voltou, abre;
  - depois das 6 horas segue aberto; despachado e cancelado resolvem; desligado com um parado fecha calado.
- Prova por defeito: 7 de 7 (o relógio do aceite, a retirada, a encomenda, o pedido velho, o servidor sem sinal, o aberto que continua, o tempo com que abriu).

### F4 — Propor e aprovar: o plano em entregas (liberada pelo dono em 15/11/2026)

O Mister propõe, a pessoa autoriza, o Regem executa pelo MESMO caminho da tela e o Mister confere o efeito. É o que as
conversas 5 (autorização por botão) e 6 (autorização com PIN) do protótipo aprovado desenham. Regras que valem para a
fase inteira:

- **Catálogo fixo no código** (`mister-procedimentos.ts`). A IA não inventa ação: cada procedimento tem nome, nível,
  prazo, pré-condição, execução e verificação.
- **Dois níveis:**
  - **botão** na conversa, só para baixo impacto: vale 10 minutos e uma vez;
  - **link com PIN**, que abre o Regem: tudo o que mexe com dinheiro, cancelamento ou configuração. O PIN nunca é
    digitado na conversa, e "pode cancelar" escrito recebe a resposta da conversa 6.
- **Quem autoriza:** até o perfil de permissões do fim do projeto, só o presidente. O gerente recebe a proposta como
  aviso, sem botão.
- **A execução usa o serviço da tela**, nunca um atalho: o teste de impressora é o `enfileirarTeste` (pelo
  `edge_comando` quando a loja tem servidor); a reconsulta da nota é o `consultarNota`.
- **Verificação depois de executar:**
  - "Feito às HH:MM" só com o efeito conferido, por exemplo a via de teste impressa ou a nota respondida;
  - sem o efeito no prazo da verificação: "Não deu: …", com o que fazer.
- **Cada proposta vale uma vez:** gravação condicional (`situacao = 'proposta' and vence_em > now()`), tanto no toque
  repetido quanto em dois aparelhos.
- **Auditoria** de cada passo: proposta, autorizada, recusada, vencida, executada, conferida.

**Entregas:**

| Entrega | O que entra | Migration |
|---|---|---|
| **F4.1 — Fundação e o botão** | Tabela `mister_proposta` (só nuvem, RLS): empresa, loja, aviso de origem, procedimento, parâmetros, nível, situação (`proposta`, `autorizada`, `recusada`, `vencida`, `executando`, `feita`, `nao_deu`), prazos, quem autorizou, resultado. Dois procedimentos de botão nascidos dos avisos que já existem: **imprimir uma via de teste** (aviso `impressora`; confere a via impressa) e **consultar a nota de novo na SEFAZ** (aviso `nota_sem_resposta`; confere a resposta). A proposta vai junto do aviso, com os botões "Autorizar" e "Não agora" (dentro das 24 h; fora delas, o modelo `mister_aviso` abre a conversa e a proposta segue logo depois). A rotina que vence as propostas. | 1 |
| **F4.2 — O link com PIN** | A página do Regem que mostra a proposta e pede o PIN (pede protótipo antes). Primeiro procedimento: cancelar um pedido com o estorno, pelo mesmo serviço do painel. | talvez |
| **F4.3 — A pergunta que vira proposta** | A ferramenta `propor_procedimento` para a IA, só com os procedimentos do catálogo. A IA propõe; a pessoa autoriza do mesmo jeito. | — |
| **F4.4 — Procedimentos do servidor da loja** | Os que pedem comando novo no `sync-daemon`, como reiniciar o serviço de impressão da conversa 5. Vão no `.exe`. | — |

**F4.4 implementada (16/11/2026, sem migration; vai no `.exe` 1.30.14): reiniciar o serviço de impressão.**
- O 4º procedimento do catálogo, `reiniciar_impressao`: de botão, vale 10 minutos, confere por 5. Nasce do aviso da
  impressora parada, no lugar da via de teste, quando o reinício SERVE: a impressora parou de RESPONDER (o motivo do vigia,
  que agora fica em `mister_aviso.dados.motivo`; a que respondeu com aviso — sem papel, tampa — segue na via de teste) e o
  servidor da loja do aviso informou a versão 1.30.14 ou mais nova (`edge_status.versao`, `VERSAO_QUE_REINICIA_A_IMPRESSAO`).
  Sem a versão (ou sem a tabela), a via de teste, como antes.
- A execução: `edge_comando` `reiniciar_impressao` SÓ ao servidor do aviso (`enfileirarComandoEdge` ganhou
  `equipamentoId`; se ele saiu da empresa, vale a loja — nunca a linha sem destino). No servidor da loja, o `sync-daemon`
  chama `backend/edge/comando-reiniciar-impressao.mjs`: `Restart-Service RegemEdgeImpressao -Force` e confere pelo
  `Get-Service` que voltou a rodar (o texto do `sc query` muda com o idioma do Windows).
- A conferência: "feito" com o reinício confirmado E o aviso da impressora fechado. "Não deu" na hora quando o Windows
  recusou (com o que ele disse) ou quando o servidor ainda não conhece o comando ("ignorado" — versão subiu sem o
  `sync-daemon` novo); passado o prazo, "não deu" com o que faltou (o servidor não pegou, ou a impressora ainda não responde).
- A IA (F4.3) continua com `imprimir_teste` no catálogo dela, agora "resolver a impressora parada": o Regem escolhe entre a
  via de teste e o reinício, e o resultado diz qual (`oQue`). A versão das instruções muda (a linha das propostas).
- Divergência da conversa 5: "Saíram as 3 vias que estavam na fila" ficou de fora — a nuvem não vê a fila local da loja.

**F4.2b implementada (16/11/2026, sem migration): cancelar o pedido com o estorno.**
- O 3º procedimento do catálogo, `cancelar_pedido`: de PIN, vale 15 minutos, confere por 10. Não nasce de aviso (não há
  aviso de "cliente pediu cancelamento"): nasce da pergunta (F4.3), com o número do pedido como a pessoa disse. O servidor
  acha o pedido ABERTO das últimas 24 horas pelo número do dia ("#284") ou pelo do canal, na loja da conversa ou sem loja
  (V4); nenhum ou mais de um, a frase para pedir o número como no painel. Só o presidente.
- Uma proposta por pedido: o "aviso" da linha é um id fixo do pedido (`uuidDeChave`), e o índice único da 428 não deixa
  duas. Renova a que acabou sem cancelar (vencida, não autorizada, bloqueada, não deu); a autorizada, a executando e a
  feita nunca renovam. A IA não vê id nem valor: só o nome do pedido no quadro.
- A mensagem vai DEPOIS da resposta, com o link "Abrir no Regem" (nunca com botões). A página mostra o pedido como o banco
  o tem na hora: o canal, o nome curto do cliente, o valor, o Pix, e o que vai acontecer em itens que o serviço sustenta.
- A execução é o MESMO `DeliveryService.cancelar` do botão "Cancelar" do painel, com o presidente que conferiu o PIN no
  lugar da senha (como o gerente no WhatsApp) e o estoque como "devolvido" (o padrão do painel).
- "Feito" só com o pedido cancelado e, se foi pago no Pix pelo Regem, com o estorno feito no gateway (`pedido_estorno`).
  O estorno que falhou na 3ª tentativa (a rotina já abriu o caso urgente em Atendimento) e o que não sai em 10 minutos
  viram "não deu", dizendo isso. A recusa do serviço (concluído, já cancelado, o prazo do Pix) vira "não deu: … Nada foi
  feito".
- A proposta de PIN que vence avisa quem recebeu o link (a conversa 6, parte 4); a de botão continua vencendo calada.
- As instruções ganharam o cancelamento como PROPOR e a resposta ao "pode cancelar" escrito (é pelo link, com o PIN).
- Diferença do protótipo: "Para resolver agora: Delivery › Pedidos" virou "Delivery › Painel" — é lá que o pedido se
  cancela (V65). O item "A cozinha tira o cartão, e a via CANCELADO sai na impressora" ficou de fora da página: ainda não
  foi conferido o que sai na impressora quando o cancelamento vem da nuvem, sem o PC de quem cancelou; o item volta com
  essa conferência (V39: frase de consequência só com a linha do serviço que a sustenta).

**F4.2a implementada (16/11/2026, mig 433; protótipo `mockups/regem-mister-pin.html`, aprovado em 16/11/2026):**
- Seis colunas na `mister_proposta`: o resumo (sha256) do código do link, para quem ele foi, quando saiu, quando abriu, as
  tentativas de PIN e o bloqueio. O código inteiro nunca fica guardado, nem em log, nem na trilha.
- `enviarLink` (no `MisterPropostasService`): um código novo a cada envio (24 bytes aleatórios, 32 letras), que derruba o
  anterior e recomeça as tentativas; a mensagem vai com o botão de link "Abrir no Regem" (`cta_url`, no formato da
  documentação da Meta). Só para proposta de PIN ainda pendente e no prazo.
- A página pública `/m/<código>` (rotas `publico/mister/link/:codigo`, `/autorizar`, `/nao-autorizar`; limite por endereço e
  `no-store`): a régua de "acesso vale" da conversa (V75) — empresa viva, quem recebeu ainda presidente e ativo, o telefone
  ainda ligado e o módulo ligado; senão, "Este link não vale" (a mesma frase para tudo).
- O PIN é conferido no servidor por `autorizarPorPinDoUsuario`, com a tentativa RESERVADA antes (gravação condicional com
  `pin_erros < 5`): nem toques em paralelo conferem mais de 5 PIN. O quinto errado bloqueia e fecha a proposta como
  `recusada` com o motivo. O PIN certo autoriza uma vez e executa pelo mesmo `executar` da F4.1.
- O botão da conversa nunca autoriza proposta de PIN: responde "Por aqui eu não consigo… toque em Abrir no Regem".
- Os links bloqueados aparecem no Console › Mister › Segurança (só a contagem e quantas empresas).
- Diferença do protótipo: o PIN do Regem tem de 4 a 6 dígitos, então a página tem UM campo com a máscara de pontos, no
  lugar dos 4 quadrinhos (eles diriam o tamanho do PIN e não caberiam o de 6). A tela "já respondida" virou a linha
  "Autorizado às HH:MM por Ana (telefone com final 4821)" dentro do estado final (feito, não deu, não autorizou).
- Ainda sem procedimento de PIN no catálogo: a F4.2b traz o cancelamento com o estorno.

**F4.3 implementada (16/11/2026, sem migration):**
- A 19ª ferramenta, `propor_procedimento` (`imprimir_teste` ou `consultar_nota`), não é consulta e não executa: o
  servidor acha o aviso ABERTO, no escopo da pessoa, cujo procedimento é o pedido (a IA não vê nem escolhe id) e cria a
  proposta pelo MESMO `propor` da F4.1. A proposta continua presa a um aviso, então a tabela da 428 não muda.
- Só o presidente: para os outros, a ferramenta responde que só o presidente autoriza (ele já recebe a proposta junto do
  aviso).
- A proposta não vai ao modelo, que só vê "vai em seguida, com os botões" e o título do aviso. O agente guarda a
  proposta e, depois da resposta, manda a pergunta com os botões "Autorizar" e "Não agora", os mesmos da F4.1.
- Pedida de novo enquanto pendente, a mesma proposta e os botões de novo. Já respondida, não renasce.
- As instruções ganharam a exceção "PROPOR, nunca fazer".
- A avaliação de regressão responde "não há aviso aberto": a loja de teste não tem avisos.

**F4.1 implementada (15/11/2026, mig 428):**
- `mister-procedimentos.ts` (o catálogo, puro) e `mister-propostas.service.ts` (propor, responder, executar, conferir,
  vencer, a rotina a cada 30 s) no `MisterAgenteModule`.
- A entrada do WhatsApp ganhou o registro de botões por prefixo (`registrarBotao('prop:')`), como o dos toques no modelo:
  o botão não vira pergunta para a IA.
- O aviso que vai ao presidente leva a pergunta e os botões, dentro das 24 h ou no toque em "Ver o que fazer". A
  proposta vencida sem resposta renova quando o aviso volta a quem autoriza; a respondida, nunca.
- A execução não segura a resposta ao WhatsApp: segue sozinha, e a rotina pega a que ficar para trás.
- O teste de impressora vai pelo `edge_comando` com a proposta nos dados. O "feito" sai quando o servidor marcou o
  comando como executado E o aviso da impressora fechou.

**Conferência da F4.1:**
- spec com Postgres:
  - a proposta nasce com o aviso, e só para o presidente ligado;
  - o toque autoriza uma vez (o segundo toque e o de outro aparelho respondem "já foi");
  - a vencida não executa;
  - "Não agora" recusa;
  - a execução passa pelo serviço da tela;
  - a verificação dá "feito" ou "não deu";
  - a auditoria de cada passo;
  - o gerente não recebe botão;
- prova por defeito.

### Versão 3 do protótipo — o Mister mais inteligente (aprovada pelo dono em 17/11/2026)

`mockups/regem-mister.html`, marcas "v3": conversas 11 a 22, a parte "Documentos", a aba "Arquivos e links" e as 12
decisões (todas as recomendadas; detalhe no changelog de `docs/decisoes-design.md`, 17/11/2026). Uma entrega por PR:

| Entrega | O que entra |
|---|---|
| **M3a · Boleto por foto** | A leitura (código de barras e Pix sem IA, o resto pela IA), o lançamento nas contas a pagar com "Desfazer", a parte "Documentos", o aviso de vencimento com a linha e o Pix, "Já paguei", o PDF do boleto e "Financeiro › Contas a pagar" no menu. |
| **M3b · Nota do fornecedor** | A leitura, a ligação dos itens com o estoque, a pergunta do que falta e o lançamento em Estoque › Recebimento e nas contas a pagar, sempre com a confirmação. |
| **M3c · Relatórios** | O gráfico na conversa, o relatório por insumo pela ficha técnica, o PDF, a página do link e os links de conferência a quem o presidente pedir. |
| **M3d · "Como faço" com a tela** | As imagens geradas pelos roteiros de tela, com as marcações, e o teste que confere cada uma. |
| **M3e · Ponto** | O ponto esquecido pela escala e o arquivo do ponto do mês pelo Mister, ao presidente e ao responsável cadastrado. |
| **M3f · Áudio** | Ouvir e responder, depois do teste das duas empresas (custo por minuto medido). |
| **M3g · Corrigir e criar** | Corrigir o que o Mister lançou e criar o que a pessoa pedir, com confirmação. |
| **Resumo** | A tela de entrada da versão 1, que ainda não tem código. |

**Andamento da M3a (17/11/2026):**
- **Parte 1 — #1092, no ar:** `common/boleto.ts`, a linha digitável e o código de barras (bancário e arrecadação, os
  dígitos verificadores da FEBRABAN, o fator de vencimento com a volta de 22/02/2025) e o Pix copia e cola (CRC16), sem IA.
- **Parte 2 — #1094, no ar (mig 439 `mister_documento`, aplicada):** a foto ou o PDF pelo WhatsApp do Mister → a IA lê
  (`claude-sonnet-5-5`, recurso `mister_documento`) → o código decide; lança sozinho só o boleto bancário que confere, de
  fornecedor cadastrado, com "Desfazer"; o resto pergunta. Pelo `FinanceiroService` da tela. **Nasce desligado:
  `MISTER_DOCUMENTOS=1` no `regem-api`.**
- **Parte 3 — #1097, no ar (mig 440 `mister_conversa_config`, aplicada):** o ajuste por empresa no grupo "Conversa", o
  texto que completa o que faltou ("Lanço assim?"), a parte "Documentos" com "Desfazer o lançamento" e "Financeiro › Contas
  a pagar" no menu.
- **Parte 4a — #1098, no ar (sem migration):** o aviso "Boleto perto de vencer" (grupo "Documentos e dinheiro"; às 9h da
  loja; 3 dias, 1 dia ou só no dia), com a linha digitável e o "Já paguei" — e o pagar/estornar da tela uma vez só (ERR-506).
- **Parte 4b (sem migration):** "Ver o PDF" (na conversa e na gaveta), o PDF com o código de barras desenhado (ITF), o envio
  de documento pelo número do Mister e o Pix copia e cola IMPRESSO (a IA transcreve, o CRC16 confere).
- **Falta da M3a:** só o Pix que vem apenas em QR (sem o texto impresso) — ler QR sem IA pede uma biblioteca nova de imagem
  no backend; decisão do dono.

**Andamento da M3b (17/11/2026):**
- **Parte 1 — #1101, no ar (sem migration):** `common/nota-por-foto.ts` — a chave da NF-e pelo dígito, a leitura do DANFE,
  a conferência dos totais e a sugestão do insumo.
- **Parte 2 (mig 441 `mister_de_para`, aplicada; nasce desligado por `MISTER_NOTAS=1`):** a conversa (cada item a um
  insumo, a memória do fornecedor, "Cadastrar novo", "Fora do estoque", o fator perguntado), o resumo e o "Lançar" pelo
  recebimento da tela e pelas contas por parcela.
- **Parte 2 — #1102, no ar.**
- **Parte 3 (sem migration; atrás do `MISTER_NOTAS=1`):** o custo médio que mudou na resposta do "Lançar" (lido antes e
  depois numa consulta só) e, na parte "Documentos", a nota com o número, os itens e o destino de cada um, as parcelas e
  "Ver no Recebimento". **A M3b está completa.**
- **Parte 3 — #1105, no ar.**

**Andamento da M3c (17/11/2026):**
- **Parte 1 (sem migration):** a 20ª consulta, `insumo_vendido` — o que a venda baixou de um insumo (o total real, pela
  baixa da venda menos o estorno), em quilos pela conversão do cadastro, por hora ou por dia, de onde saiu (a ficha de cada
  produto pela mesma conta da baixa; o resto em "outros") e, hoje, a comparação com as 4 semanas anteriores.
- **Parte 1 — #1107, no ar.**
- **Parte 2 (sem migration):** "compara com outubro" (`compararDe`/`compararAte`), "manda em PDF" (o PDF depois da
  resposta) e o botão "PDF" no balão (só a API oficial); o toque refaz o escopo de quem tocou; o PDF com o gráfico de
  barras e a linha da média, pelo `pdfkit` (`relatorio-insumo-pdf.ts`: o plano puro e o desenho).
- **Parte 2 — #1108, no ar.**
- **Parte 3 (sem migration):** a imagem do gráfico antes do texto — a tela de pixels e o PNG feitos no código
  (`grafico/tela.ts`), as letras da Figtree num atlas gerado uma vez (`frontend/roteiros/fonte-do-grafico.mjs`), o
  `enviarImagem` do número do Mister. Sem biblioteca de imagem.
- **Parte 3 — #1109, no ar.**
- **Parte 4 (sem migration):** a página `/mister/relatorio` ("Ver no Regem", no fim da resposta) com o mesmo plano do
  PDF, "Mudar o período" e "Baixar PDF"; as rotas refazem o relatório no escopo de quem abre (`escopoDaTela`, a mesma
  régua da conversa pelo login).
- **Parte 4 — #1110, no ar.**
- **Parte 5 (sem migration):** `mandar_link` — o link de conferência a quem o presidente pedir (conversa 18), por
  enquanto a contagem de estoque de hoje; fora da janela de 24 horas o Mister diz que a pessoa precisa escrever antes.
- **Parte 5 — #1111, no ar.**
- **Parte 6 (mig 443, só nuvem; nasce desligada — `MISTER_LINK_PUBLICO=1`):** o link para encaminhar a quem NÃO tem
  usuário (a contabilidade, um sócio) — decisão 7 da versão 3. Só o presidente, só quando ele pede
  (`link_para_encaminhar`): o Mister lê o relatório do insumo no escopo dele, guarda a FOTO (o plano do PDF) em
  `mister_link_publico` e o Regem escreve o endereço `/m/r/<código>` no fim da resposta — o endereço não passa pela IA
  nem fica guardado na pergunta; no banco fica só o resumo (sha256) do código. A página abre sem login, só para ler (sem
  "Mudar o período": nunca lê dado vivo da loja), com "Baixar PDF" e "vale até dd/mm". Vale 7 dias; no máximo 20 links
  valendo por empresa (o teto é reservado com a trava da empresa na mesma transação); "cancela os links"
  (`cancelar_links`) fecha todos na hora. A cada abertura a régua do acesso é conferida de novo (V75): o link vivo, a
  empresa viva, quem pediu ainda presidente e ativo, o módulo Mister ligado e a função ligada na instalação — qualquer
  falha é o mesmo 404, com a mesma frase. Na auditoria: criado (quem pediu), aberto pela primeira vez (sem ator) e
  cancelado; nunca o código.
- **Decisões da parte 6 (as recomendadas, 18/11):** (1) o link mostra a foto de quando foi pedido, não o dado de agora —
  quem não tem usuário não ganha uma janela para a loja; (2) cancelar é pela conversa, sem tela nova; (3) desligar a
  variável fecha também os links que já saíram; (4) por enquanto só o relatório por insumo (o único que tem página e PDF);
  (5) o guarda dos nomes das ferramentas aceita `cancelar_links` por lista explícita no teste — ele só fecha os links que
  o próprio presidente pediu, não toca em pedido, venda, estoque nem cadastro.

**Andamento da M3e (17/11/2026):**
- **Parte 1 (sem migration):** o aviso "Ponto esquecido" (11º tipo, grupo "Pessoas e ponto"; o resumo do dia seguinte às
  10h ao gerente, ou turno a turno 30 min / 1 hora depois), pela escala contra o ponto, só nas lojas que usam o terminal.
- **Parte 1 — #1112, no ar.**
- **Parte 2 (sem migration):** o 12º aviso, "Arquivo do ponto do mês" (grupo "Pessoas e ponto", ao presidente), conversa
  20. Do dia 1 às 06:00 da loja até o fim do dia 5, o aviso lê o fechamento do mês anterior que a rotina do dia 1 já grava
  (`JobsService.fecharPontoMensal` → `ponto_fechamento`), das empresas que marcaram ponto no mês e que ainda não mandaram
  à contabilidade: "📁 Ponto de outubro · <empresa> (1 a 31/10)", os colaboradores, as pendências (com nome e dia) e o
  responsável pelo final do WhatsApp (nunca o número). Ao presidente vão os botões e, logo depois, o espelho em PDF (o
  MESMO da tela de Gerenciamento de ponto). "Enviar ao contador" usa o MESMO envio da tela
  (`PontoService.enviarEspelhoContador`: o WhatsApp da loja, o fechamento marcado como enviado, a auditoria), com a
  reserva no próprio aviso (`dados.envioEm`, que a renovação dos avisos passou a preservar; a reserva de mais de 3
  minutos não segura): o toque duplo manda uma vez. "Ver antes" diz onde conferir, com o link para o Regem. Mandado
  (pelo Mister ou pela tela), o aviso fecha calado. Sem responsável cadastrado, o aviso diz onde cadastrar e vai só com
  "Ver antes".
- **Decisões da parte 2 (as recomendadas, 18/11):** (1) o botão é "Enviar ao contador" e não "Enviar à contabilidade",
  como no protótipo: a Meta aceita até 20 letras no título do botão (são 22); (2) o PDF só ao presidente (tem as horas de
  todos); (3) a janela vai até o dia 5 (a contabilidade fecha a folha nos primeiros dias) e depois o aviso fecha calado;
  (4) o envio ao contador sai pelo WhatsApp da loja, como na tela — o número do Mister não fala com quem não está
  ligado a ele, e assim não precisa de modelo novo da Meta; (5) por empresa, como o fechamento de hoje (o protótipo
  mostra uma loja: o espelho por loja fica para quando o fechamento for por loja).
- **M3e COMPLETA.**

**Andamento da M3g (17/11/2026):**
- **Parte 1 (sem migration):** `corrigir_documento` — o vencimento do boleto que o Mister lançou, pela conta da tela,
  com "Desfazer" no balão; só o presidente; o valor nunca.
- **Parte 1 — #1113, no ar.**
- **Parte 2 (mig 444, só nuvem):** `escrever_recado` — o recado no mural (conversa 22). O Mister escreve o texto pronto,
  guarda o RASCUNHO em `mister_recado` e a resposta mostra o texto entre aspas com "Publicar" e "Mudar o texto" no
  balão (só pela API oficial: pela conexão por QR Code a ferramenta recusa e manda publicar em Mural & clima). O toque
  em "Publicar" reserva o rascunho com gravação condicional (o toque duplo publica uma vez) e publica pelo MESMO
  `MuralService.publicar` da tela, em nome de quem pediu, com a auditoria `mister_recado_publicado`; o comunicado desce
  para a loja pelo sync de sempre. "Mudar o texto" descarta e a pessoa diz como quer. Presidente e gerente (o gerente
  com o Mural & clima no perfil e só na loja dele); só quem pediu publica; o rascunho vale 30 minutos e o novo descarta o
  anterior da mesma pessoa; até 500 letras, sem link; a primeira linha é o título do comunicado.
- **Decisões da parte 2 (as recomendadas, 18/11):** (1) o gerente também escreve recado, como na tela (o Mural & clima
  aceita presidente, gerente e supervisão), mas só na loja dele; (2) na empresa de várias lojas, sem loja, o recado vai
  para todas (o mural da rede) e a pergunta diz isso; (3) 30 minutos de prazo no botão; (4) nada de link no recado; (5) a
  falha do mural devolve o rascunho (o toque seguinte tenta de novo).
- **M3g COMPLETA.**

**Andamento da M3d (17/11/2026):**
- **Parte 1 (sem migration):** a imagem da tela no "como faço", feita pelos roteiros (`GERAR_COMO_FACO=1`) e mandada pelo
  endereço público antes do texto; a primeira é "Pausar os pedidos de um canal".
- **Parte 2 (sem migration):** mais seis imagens — "Rota da cozinha" e os produtos de cada KDS (roteiro da rota), a área
  de entrega (roteiro da área) e os três do próprio Mister: ligar o WhatsApp, a chave de IA e os relatórios (roteiro do
  Mister). A marca agora rola até a vista e só vale se o centro dela estiver na janela e for dela mesma (o item cortado
  pelo menu ou coberto reprova o roteiro, com o motivo); os relatórios, no fim da parte, saem pela busca ("resumo").
- **Parte 3 (sem migration):** mais sete — do painel do Delivery (aceitar e avançar, cancelar, tempo de preparo) e do
  Balcão (abrir o caixa, vender, sangria e suprimento, fechar o caixa). O selo da marca passou a navy com número branco e
  borda dourada (os selos dourados do próprio app, como a quantidade no cartão, se confundiam com a marca), e o botão
  desligado se mede com o `pointer-events` ligado só durante a medida. 14 assuntos do guia com imagem.
- **Parte 4 (sem migration):** mais oito — Delivery › Configurações (horário, tempo de entrega, cupons) e o Estoque
  (produto, contagem, desperdício, etiquetas, pedidos de compra). De passagem, o rótulo de cada campo das configurações
  do Delivery ficou LIGADO ao campo (`Campo` com `htmlFor`/`id`, ou grupo; ERR-510). 22 assuntos do guia com imagem.
- **Parte 5 (sem migration):** mais onze, por um roteiro novo só do "como faço" (`roteiros/como-faco.mjs`: as telas
  sem roteiro próprio, com a resposta simulada padrão e a conferência de que a tela não caiu no "Algo deu errado") —
  Cadastros (colaborador, entregador, produto do cardápio), Escala, Impressoras (adicionar, onde cada documento sai),
  Acessos (permissões do perfil, acesso da pessoa), Cancelamentos de itens, Auditoria e Turnos. A Auditoria tinha o
  rótulo solto (ERR-510, reincidência) e ficou ligada. 33 assuntos do guia com imagem.
- **Parte 6 (sem migration):** a configuração da nota fiscal (34 assuntos com imagem), junto com a catraca dos rótulos
  soltos (`npm run check:rotulos`) e a faixa velha da tela fiscal corrigida (ERR-511).
- **Parte 7 (sem migration):** mais seis — aplicativos conectados, atendimento, cores do KDS, notas fiscais, pagamento
  do entregador e cupons (reimprimir/cancelar venda). De passagem, a página dos entregadores dava React #418 (a
  categoria do token lida no desenho; ERR-513). 40 assuntos do guia com imagem.
- **Parte 8 (sem migration):** o robô, o WhatsApp da loja e os ajustes da pausa, com as respostas simuladas no formato
  do servidor (`/whatsapp/numeros`, `/whatsapp/robo-config`, `/atendimento/ajustes` com `pausa.temCardapio`); o roteiro
  passou a dizer POR QUE uma tela caiu (o erro que o React registra no console). 43 assuntos com imagem.
- **Parte 9 (sem migration):** as integrações (iFood/99), a caixa de conversas do WhatsApp (o status conectado, duas
  conversas e as mensagens de exemplo) e, na gestão do catálogo com o iFood e a 99 ligados, o preço e a pausa por canal
  (as fotos da conferência `null` — a lista vazia quebrava `fotos.canais`). 47 assuntos com imagem.
- **Parte 10 (sem migration) — M3d COMPLETA:** "Conferir com os apps" (a conferência do iFood simulada no formato de
  `RespostaDaConferencia`) e os relatórios de vendas (o resumo, as formas, os canais, a curva ABC e os atendentes; o
  token do roteiro com `ver_financeiro`, como o presidente). **Os 49 assuntos do guia têm imagem**, e a spec do guia
  passou a exigir: assunto novo nasce com a sua foto.

**A tela "Resumo" (17/11/2026, sem migration; #1114, no ar):** a entrada do presidente em Mister — as três etapas para funcionar, a faixa
"IA parada", o que o Mister faz e os últimos avisos, só com as rotas que já existem.

### Versão 4 — o Mister com o jeito do atendente (padrões do Hermes Agent; aprovada pelo dono em 18/11/2026)

**Por quê.** O dono achou o Mister "um número de alerta robótico". O levantamento no código confirmou quatro causas: a
memória são as 6 últimas perguntas em 2 horas (depois ele recomeça do zero); o aviso é texto montado pelo código, sem IA
("⚠️ título. detalhe", "🔔 Lembrete", "✅ Resolvido"); a voz é a mesma para toda empresa; e as consultas de uma resposta
rodam uma depois da outra.

**De onde vêm os padrões.** O dono pediu a análise do Hermes Agent (NousResearch, licença MIT) e decidiu **trazer os
padrões dele para a estrutura que temos**, sem trocar o Mister por outro programa, e que o comportamento siga o do
**atendente virtual do cardápio** (`cardapio/robo-instrucoes.ts`). O que se aproveita: as ferramentas da mesma vez
rodando juntas; a busca nas conversas antigas; a memória curta e limitada, em dois blocos (o que o agente sabe do lugar e
como a pessoa gosta), com a ferramenta de lembrar, trocar e esquecer e sem guardar número; a identidade/voz separada das
regras; o "fica de olho nisso" que só fala quando algo mudou. O que fica de fora: terminal, arquivos e skill criada
sozinha sem avaliação. O desenho de cache do Mister já é o do Hermes (instruções fixas com cache + o bloco "Esta
conversa"): a memória entra no bloco da conversa, sem quebrar o cache.

**As entregas (cada uma num ou mais PRs; tudo nasce desligado onde muda o que a pessoa recebe):**
1. **Sem migration e sem tela nova:** as consultas da mesma vez juntas; a busca nas conversas dos 30 dias (o texto que
   `mister_pergunta` já guarda, só da própria pessoa); as instruções do Mister nos mesmos blocos do atendente (jeito de
   conversar, como escrever no WhatsApp, o que a pessoa já disse, a conferência antes de responder) e a saída pelo mesmo
   formatador do WhatsApp do atendente (`whatsapp/formato-da-resposta.ts`: negrito, lista com o emoji do assunto,
   reação). A troca das instruções é conferida pela avaliação de regressão (as 41 perguntas de Console › Mister ›
   Qualidade) logo depois do deploy: errada nova que a versão anterior acertava = a troca volta.
2. **Com migration e protótipo aprovado antes:** o perfil do Mister (os mesmos perfis do atendente e o "jeito da
   empresa") e a memória da loja e da pessoa, numa lista que o presidente vê e apaga.
3. **Com protótipo aprovado antes:** o aviso escrito pelo agente (a regra continua detectando sem IA; o texto fixo fica
   de reserva quando a IA falha e fora das 24 horas, pelo modelo da Meta) e o "fica de olho nisso" / "me lembra às 10h".

**Andamento:**
- **Entrega 1, parte 1 — as consultas juntas (sem migration):** as consultas que o modelo pede na mesma vez rodam juntas
  (até 3 — `TETOS.consultasJuntas`); a vez que traz uma ação (propor, mandar o link, corrigir) roda uma de cada vez, na
  ordem pedida, como antes. A resposta ao modelo, a trilha e os anexos (PDF, gráfico, imagem do "como faço") seguem a
  ordem do pedido. No processo, no máximo 4 ferramentas ao mesmo tempo somadas todas as conversas
  (`TETOS.consultasNoProcesso`; o pool do banco tem 10 conexões para a API inteira, e antes o máximo era 3). O teto de
  10 consultas por pergunta segue decidido na ordem do pedido. A avaliação de regressão roda o mesmo laço. **No ar (#1134).**
- **Entrega 1, parte 2 — o jeito de escrever do atendente (sem migration):** a seção "Como você escreve" virou os blocos
  do atendente — JEITO DE CONVERSAR, COMO ESCREVER NO WHATSAPP (negrito de um asterisco, lista com o emoji do assunto,
  exemplo sem número de verdade, problema sem emoji, REAGIR), NÚMEROS, DATAS E PEDIDOS, O QUE A PESSOA JÁ DISSE, SE
  PERGUNTAREM SE VOCÊ É ROBÔ e ANTES DE MANDAR CADA RESPOSTA, CONFIRA —, com todas as regras de conteúdo de antes. O
  filtro de saída passa pelo mesmo formatador do atendente (título em negrito, tabela em lista; o link do markdown deixa
  só o rótulo). A **reação**: a linha `REACAO:` sai do texto e o número do Mister reage à mensagem da pessoa pela API
  oficial (o corpo da doc da Meta, igual ao das lojas); quando a reação é a resposta inteira e não dá para reagir (conexão
  por QR, sem o id da mensagem, a Meta recusou), o emoji vai como texto. Na memória fica o emoji. **No ar (#1136).**
- **Entrega 1, parte 3 — as conversas anteriores (sem migration):** a consulta nova `conversas_anteriores` (o padrão do
  Hermes de procurar nas conversas antigas) lê o texto que `mister_pergunta` já guarda por 30 dias: só as conversas
  DESTA pessoa NESTA empresa (a trava é o escopo do servidor), respondidas, dos dias pedidos (1 a 30), pelas palavras do
  assunto (sem acento, sem as que não dizem o assunto, até 5, curinga escapado) — as que acertam mais palavras primeiro e,
  empatadas, as mais novas; até 5, com o dia e a hora, a pergunta, a resposta e as consultas daquela hora. Quem não vê
  valores hoje recebe o texto sem os valores em reais; os valores ditos voltam à parte, para o filtro de saída não acusar a
  lembrança de "valor sem origem". Nas instruções: chamar quando a pessoa fala de algo conversado antes, dizer o dia e
  consultar de novo para o número de agora. A avaliação de regressão ganhou a pergunta 42 ("o que você me disse do iFood
  naquele dia…"). Com ela, a **entrega 1 está completa** (#1134, #1136, #1137); a 2 (perfil e memória) e a 3 (avisos)
  pedem protótipo.
- **Protótipo das entregas 2 e 3 — APROVADO pelo dono em 18/11/2026 ("prototipo aprovado"), com as oito decisões
  recomendadas:** `mockups/regem-mister-jeito-memoria.html` (versão 1): a parte
  nova "Jeito e memória" (o perfil, o jeito da empresa, os avisos escritos por grupo, o "fica de olho"; "O que o Mister
  sabe" da empresa e de cada pessoa, com Anotar, Mudar e Esquecer), seis conversas no celular e oito decisões com a
  recomendada primeiro. Fases propostas: **M4a** perfil e jeito (1 migration em `mister_conversa_config`), **M4b** memória
  (1 migration, `mister_memoria` só na nuvem; recusa número, dado de cliente e segredo; limites do Hermes: 2.200 letras da
  empresa e 1.375 de cada pessoa), **M4c** avisos escritos (sem migration; o texto fixo de reserva) e **M4d** "fica de
  olho" e lembrete (1 migration, `mister_vigia`), uma por PR, nessa ordem.
- **M4a — o perfil e o jeito da empresa (mig 447, só nuvem):** colunas `perfil`, `jeito` e `avisos_escritos` em
  `mister_conversa_config` (a 446 é de outra frente, o gasto do WhatsApp). Salvar grava só os campos que vieram, numa
  instrução; sem as colunas da 447, a leitura usa as da 440 (o ajuste dos documentos não volta ao padrão). O perfil (as
  chaves do atendente, com textos para o dono e o gerente) e o jeito entram no bloco "Esta conversa", depois da marca de
  cache. Tela: Mister › "Jeito e memória" (só o presidente), no modelo de ajustes, com o perfil e o jeito; os avisos
  escritos e o "fica de olho" aparecem na tela quando as fases deles entrarem (sem controle sem efeito). **No ar (#1145).**
- **M4b — a memória (mig 449, só nuvem):** a tabela `mister_memoria` (uma frase por linha, até 300 letras; `colaborador_id`
  nulo = da empresa, preenchido = da pessoa; `origem` conversa | presidente; `anotado_por`), em SO_NUVEM no daemon. As
  regras puras em `mister-memoria.ts`: a conferência que recusa com o motivo (valor em reais, link, dado de pessoa —
  telefone, e-mail, CPF, CNPJ —, senha, PIN e chave), os limites do Hermes (2.200 letras da empresa, 1.375 de cada pessoa;
  cheio, o Mister junta ou pede para esquecer — nunca apaga sozinho) e o trecho que acha a anotação (sem acento e sem
  caixa; nenhuma ou mais de uma = o motivo). O serviço confere o limite e grava na MESMA transação, com a trava da empresa
  (dois "lembra que…" ao mesmo tempo não passam juntos do limite — V98); a auditoria guarda quem, sobre quem e quantas
  letras, nunca o texto. Quem pode: o presidente tudo; o gerente só o dele (pela conversa); o que é da empresa, só o
  presidente troca ou esquece. A memória entra no bloco "Esta conversa" (depois da marca de cache), com o quanto está
  cheio; a ferramenta `lembrar` (anotar, trocar, esquecer — "mim" é sempre a pessoa da conversa, decidida pelo servidor)
  não é consulta e não roda junto com outra. Quem perde o WhatsApp ligado ao Mister perde a memória dela junto. Tela:
  "O que o Mister sabe" em Mister › "Jeito e memória" (só o presidente): "Da empresa" e "De cada pessoa" com a quantidade,
  o medidor, a busca e a origem, "Anotar" e "Mudar" em gaveta (a recusa do servidor aparece no campo), "Esquecer" em
  diálogo. A avaliação de regressão ganhou a pergunta 44 ("lembra que aqui a gente chama o X-Burger Smash só de
  smash" → chama `lembrar` e diz o que anotou; a 43 é a do gasto do WhatsApp, G3). Fica para depois: o filtro de "valor
  sem origem" aceitar o valor arredondado quando a pessoa pediu sem centavos (o protótipo cita; só com o caso real).
  **No ar (#1147).**
- **M4c — os avisos escritos pelo Mister (sem migration; a coluna `avisos_escritos` da 447):** um ajuste por grupo em
  Mister › "Jeito e memória" › Avisos ("Na loja", "Servidor", "Fiscal", "O próprio Mister"), nascendo desligado;
  "Documentos e dinheiro" e "Pessoas e ponto" ficam no texto fixo (têm botões e PDF). A regra continua descobrindo o
  problema sem IA; ao ABRIR e ao ESCALAR, com o grupo ligado e alguém dentro das 24 horas, a IA (na chave da empresa,
  recurso `mister_aviso_escrito`, até 10 s) escreve o texto com os fatos do aviso — o título, o detalhe, há quanto tempo,
  o tempo da loja, até 5 outros avisos abertos — no perfil e no jeito da empresa (M4a). Uma escrita por aviso e fase,
  a mesma para todos que recebem. A conferência (`mister-avisos-escritos.ts`): nenhum número que o aviso não trouxe,
  nenhum link, o pedido ("#284", "nº 1234") e a loja como estão no título; não passou, sem IA, sem crédito ou a IA
  falhou: vai o texto fixo de sempre, com o motivo na trilha (`reserva`); o escrito fica marcado (`escrito`). Fora das 24
  horas vai o modelo aprovado e a IA nem é chamada. O lembrete e o desfecho ficam fixos. Nada de telefone nem de id no que
  vai à IA (ERR-524: o `aberto_em` do `db.execute` chega como texto — lido como ISO no SQL). **No ar (#1150).**
- **M4d parte 1 — o "fica de olho" num pedido e o lembrete (mig 452, só nuvem — `mister_vigia` e
  `mister_conversa_config.fica_de_olho`):** o ajuste "“Fica de olho” e lembretes" em Mister › "Jeito e memória" › Avisos,
  nascendo DESLIGADO. Duas ferramentas novas (não são consulta, uma de cada vez): `ficar_de_olho` (comecar/parar/listar —
  acha o pedido dos canais como a história do pedido, com a permissão do Delivery; vale até as 06:00 da loja) e `lembrete`
  (criar/listar/cancelar — o texto numa linha de até 200 letras, sem link nem senha; o "quando" em AAAA-MM-DDTHH:MM da
  loja, no futuro e até 30 dias). Até 3 "fica de olho" e 10 lembretes ativos por pessoa, conferidos e gravados na mesma
  transação com a trava da empresa (V98). A volta de cada minuto (`MisterVigiaService`): vence calado o "fica de olho"
  depois das 06:00; o lembrete da hora é marcado "feito" ANTES de sair (no máximo uma vez); o pedido olhado que mudou de
  situação sai numa mensagem só por mudança (gravação condicional pelo estado de antes), e a situação final (entregue,
  concluído, cancelado) encerra. Empresa que desligou o ajuste ou o módulo: o marcado é cancelado sem mandar. A entrega é
  pelo número do Mister; fora das 24 horas, o modelo aprovado ("Ver o que fazer"), e o toque traz o texto só a quem é. A
  linha guarda o resultado, nunca o telefone. A avaliação ganhou as perguntas 45 ("me avisa quando o pedido 284 sair") e
  46 ("me lembra amanhã às 10h de pagar o gás"). Renumerada de 451 para 452 (ERR-526: a 451 do G3b entrou antes; na
  nuvem ela entrou com o nome `451_mister_vigia`). **No ar (#1153).**
- **M4d parte 2 — o "fica de olho" no caixa, na impressora e no canal (sem migration — a `mister_vigia` já aceita os
  alvos):** `ficar_de_olho` ganhou o `alvo` e o `qual`. O CAIXA aberto da loja (delivery ou balcão, com a permissão do
  relatório de turnos, como `caixas_e_sangrias`), até fechar; a IMPRESSORA parada (o incidente `impressora_parada` que a
  loja vê, achada pelo nome), até voltar a responder; o CANAL pausado (iFood, 99 ou cardápio, pela MESMA regra do
  "Pausar" do Delivery, com a permissão do Delivery), até reabrir. Só se olha o que está naquele estado ("não está pausado
  agora: não há o que olhar"). A volta lê cada alvo à parte; banco sem a tabela do vigia (só nuvem) não para os outros
  alvos (V37). Avaliação: pergunta 47 ("me avisa quando o iFood voltar"). Fica de fora a senha do balcão (não está na
  decisão 8 do protótipo).

### Versão 5 — o Mister ouve, vê e mostra (aprovada pelo dono em 19/11/2026)

Pedido do dono (19/11): responder a áudio, como o atendente do cardápio já faz; entender imagem pelo DMS Graph que a
loja já usa; e gráficos melhores ("o link com gráfico básico mal feito"). O resumo vai por escrito, com as opções de ver
em arquivo (PDF) ou pelo link. Protótipo: `mockups/regem-mister-ouve-ve-mostra.html`, aprovado com as nove decisões
recomendadas. Continua a versão 3, que já previa "ouvir e responder em áudio, com o texto junto" e deixava a empresa da
voz para um teste. O dono decidiu usar a mesma do atendente (Google).

**Como estava (conferido no código em 19/11):**
- A áudio, foto e figurinha, o Mister respondia "por enquanto só leio texto". A foto só era lida quando era boleto ou
  nota (`MISTER_DOCUMENTOS`), pela IA.
- O DMS Graph lê PDF, JPG, PNG, WebP, MP4, MOV e WebM. Não lê áudio.
- O atendente ouve pelo Gemini e responde com a voz do Google pelo fluxo do n8n, não pelo Regem.
- O único gráfico era o do insumo: um PNG desenhado à mão (`grafico/tela.ts`), e a página usava as barras de
  `relatorios/graficos.tsx`. O resumo do dia saía só em texto.

**As nove decisões (todas as recomendadas):**
1. O DMS Graph ganha "ouvir áudio" pelo Gemini. O Regem guarda só o texto.
2. Responder em áudio quando a pessoa manda áudio, sempre com o texto junto. O áudio fala o principal (~40 s).
3. A voz em português do Google, gerada pelo DMS Graph ("falar"). Uma voz só, a do Mister.
4. A resposta começa com "🎧 Entendi: …" (áudio) ou "📷 Vi: …" (foto).
5. A foto vai primeiro ao DMS Graph, com a IA da empresa de reserva; não fica guardada, só o que ela mostra (30 dias).
   Os números vêm das consultas do Regem; o que veio só da foto é dito como "pela foto". Boleto e nota seguem nos
   documentos.
6. A mesma franquia do Graph da empresa (a do atendente), com a conta por uso em IA e uso. Quando acaba, a foto vai
   pela IA da empresa e o áudio pede texto.
7. Um desenho só para a imagem, o PDF e o link, com uma biblioteca de desenho nova no servidor.
8. O resumo é texto com os botões "📄 PDF" e "📊 Ver gráficos". O link abre sem login por 7 dias e só mostra aquele
   resumo, pelo mecanismo do link para encaminhar (mig 443).
9. Gráfico nas perguntas quando a pessoa pede ou a resposta é uma série (4 pontos ou mais). Sem valor em reais para
   quem não vê valores.

**Fases (uma entrega por PR):**

| Fase | O que entra | Migration |
|---|---|---|
| **M5a · Fotos** | A foto que não é documento vai ao DMS Graph (IA da empresa de reserva); o que ela mostra entra na pergunta; "📷 Vi". | não |
| **M5b · Ouvir** | Graph: "ouvir áudio" (versão nova; o dono clica "Implantar"). Regem: o áudio vira texto, "🎧 Entendi", até 3 min. | não |
| **M5c · Falar** | Graph: "falar" (voz do Google). Regem: o ajuste "Responder em áudio" e o envio do áudio pelo número do Mister. | 1 |
| **M5d · Gráficos** | O desenho novo na imagem, no PDF e na página; o insumo refeito e 4 gráficos novos (dia, hora, canal, mais vendidos). | não |
| **M5e · Resumo** | O resumo com "📄 PDF" e "📊 Ver gráficos", o PDF do resumo, a página do link e "Como mandar o resumo". | 1 |

**M5a implementada (19/11/2026; sem migration; nasce desligada por `MISTER_MIDIA=1` no `regem-api`):**
- **Onde mora:** `mister-midia.regras.ts`, puro: a tradução do Graph e da reserva, a pergunta com a marca `⟦foto⟧` e a
  linha do "📷 Vi". `MisterMidiaService` fica no `MisterAgenteModule`, que passou a importar o `GraphModule`, e se
  apresenta à entrada por `registrarMidia`.
- **A porta do Graph:** o `GraphFotoService` ganhou `analisar`, com a tradução de quem chama, os tipos aceitos e o
  prefixo da chave. O `ler` do atendente passa por ele e não mudou: só imagem e a chave `regem-graph-foto`. O Mister
  manda imagem e PDF com a chave `regem-graph-mister`, para os dois usos nunca dividirem o resultado guardado.
- **A ordem na entrada:**
  1. A mídia vai ao serviço da foto.
  2. Boleto ou nota vai aos documentos (M3a) quando eles estão ligados.
  3. O resto vira a pergunta na fila, sem passar por PARAR/VOLTAR nem pelo texto que completa documento.
  4. Empresa sem o Graph: o "só leio texto" diz onde ligar ("Delivery › Configurações › Integrações", conferido no
     menu pelo teste).
  5. Nenhuma leitura: "📷 Não consegui ver a foto agora…" (desfecho `midia_nao_lida`).
- **A reserva:** a IA da empresa (`claude-haiku-5-5`, recurso `mister_foto`) com o formato RESUMO/TIPO/DESCRICAO. O
  prazo é total (30 s, V106).
- **A legenda da foto** (`caption` da Meta) passa a ser lida.
- **Instruções:** um bloco novo, "QUANDO A PESSOA MANDA FOTO". A versão das instruções muda, então a avaliação de
  regressão é rodada de novo.
- **Ainda não:**
  - a conexão por QR Code (Evolution) não traz mídia ao Mister; segue "só leio texto";
  - a frase da permissão do Graph ("…que os seus clientes mandam") será revista junto com o áudio (M5b);
  - o quadro "Fotos e áudios · DMS Graph" em IA e uso também fica para a M5b. Nesta fase, a reserva aparece no gasto por
    recurso como "Mister · fotos (reserva do DMS Graph)".

**M5b implementada (19/11/2026; sem migration; a mesma chave `MISTER_MIDIA=1`):**
- **O Graph (dms-graph #6, versão 0.5.0, contrato 1.1.0, aditiva pelo comparador do hub):** a ferramenta `ouvir_audio`.
  - Usa a mesma permissão, a mesma franquia e a mesma idempotência da `analisar_arquivo`.
  - Aceita OGG, MP3, AAC, WAV e FLAC, até 5 MB; o OGG/Opus até 3 minutos, pela duração lida do arquivo.
  - Devolve `{ tipoArquivo: 'audio', transcricao, inaudivel, idioma, duracaoSegundos, franquia }`.
  - A migração 003 do Graph põe `tipo_arquivo = 'audio'` no consumo.
  - A frase da permissão passa a ser "…as fotos, os documentos e os áudios que os seus clientes e a sua equipe
    mandam…", nos dois lados. O protótipo `regem-graph-clique.html` ficou com a frase antiga.
  - Nota no hub: `docs/mudancas-nos-produtos.md`.
- **No Regem:**
  - a entrada reconhece `type: audio`;
  - o `GraphFotoService.analisar` ganhou `ferramenta` e `aoFalhar`, que entrega o motivo curto;
  - o `MisterMidiaService.ouvir` manda o áudio à `ouvir_audio` com a chave `regem-graph-ouvir`, num prazo de 25 s;
  - a transcrição vira a pergunta `⟦áudio⟧ …`, e a resposta abre com `🎧 _Entendi:_ "…"` (`linhaDaMidia`, pelo código).
- **Sem reserva** (a IA da empresa não ouve). Cada caso tem a sua frase:
  - inaudível, ou outra falha: "não consegui entender";
  - a franquia esgotada: "até 01/12", o dia 1º do mês seguinte;
  - acima de 3 minutos, conferido ANTES de gastar a franquia: "em partes menores";
  - AMR ou M4A: "mande como mensagem de voz".
- **Instruções:** o bloco passa a ser "QUANDO A PESSOA MANDA FOTO OU ÁUDIO". A transcrição pode errar um nome; se algo
  não fizer sentido, o Mister pergunta antes.
- **O dono implanta o Graph:** clicar em "Implantar" no EasyPanel. Sem isso, a `ouvir_audio` não existe na porta, e o
  áudio responde "não consegui entender".
- **Ainda não:** o quadro "Fotos e áudios · DMS Graph" em IA e uso fica para a M5b.2, logo depois, porque mexe em tela e
  passa pelos roteiros; a conexão por QR Code segue sem mídia.

**M5b.2 implementada (19/11/2026; só tela):**
- **O quadro "Fotos e áudios · DMS Graph"** em Mister › IA e uso (`components/mister/fotos-e-audios.tsx`) mostra a
  franquia do mês, que é uma só e vale para o atendente e para o Mister.
  - Com a franquia acabada, avisa que o Mister não ouve áudios até o dia 1º.
  - Sem a ligação, diz que o Mister só lê texto e dá o caminho para ligar.
  - Lê a mesma situação do cartão do Graph. Sem ela, o quadro não aparece.
- **Diferença do protótipo:** o uso separado por recurso não entrou, porque o Graph conta o total.
- **O medidor `Franquia`** do cartão foi exportado, com o nome do que se conta; o cartão não mudou.
- **Conferência:** roteiro `mister` (1.102 conferências, os três estados em 16 larguras) e `graph-clique` (272), sem falha.

**M5d.1 implementada (19/11/2026; sem migration): o desenho novo no gráfico que já existia, o do insumo.**
- **Os três lugares**, com o mesmo plano (`PlanoDoPdfDoInsumo.grafico`): barras em azul-marinho, a MAIOR em dourado,
  grade leve, o valor escrito e a média tracejada.
  - **Página** (`/mister/relatorio` e `/m/r/<código>`): `components/mister/grafico-do-mister.tsx`, em SVG na largura
    medida.
    - O valor fica em cima de cada barra quando cabe, ou só o da maior, e por cima da média, com borda.
    - Os rótulos pulam quando não cabem, e os das pontas ficam dentro.
    - Segue as cores do tema e traz a tabela.
  - **Imagem da conversa** (`grafico-do-insumo.ts`) e **PDF** (`relatorio-insumo-pdf.ts`), com os cantos arredondados
    no PDF.
- As barras dos Relatórios de vendas (`Colunas`) não mudam.
- **Diferença da decisão 7, avisada ao dono antes:** sem a biblioteca de desenho nova. Ela levaria um binário nativo ao
  pacote da loja (o `npm ci` do backend vai ao servidor da loja) e não lê as fontes da marca guardadas em `woff2`
  variável. O mesmo desenho é garantido pelo mesmo plano e pelas mesmas cores em três desenhistas: o PNG próprio
  (`grafico/tela.ts`), o `pdfkit` e o SVG.
- **Falta (M5d.2):** os 4 gráficos novos (dia com a semana anterior, hora, canal, mais vendidos) por uma consulta nova
  do agente, e o link e o PDF deles. Os tipos novos do link pedem migration (`ck_mister_link_publico_tipo` só aceita
  `insumo`), que vai junto com a da M5e.

**M5d.2 implementada (19/11/2026; sem migration): "me mostra em gráfico" na conversa.**
- **A consulta nova `mostrar_grafico`**: tipo (`vendas_por_dia`, `vendas_por_hora`, `canais`, `mais_vendidos`), período e
  loja.
  - A permissão é a dos relatórios de vendas, como a `vendas_do_periodo`.
  - Os números saem dos MESMOS relatórios que a tela usa (`vendas`, `faturamentoDelivery`, `rankingProdutos`).
  - Ao modelo vão só os números, para o texto: o título, o número principal, a comparação e os pontos. O desenho da
    imagem fica com o Regem.
- **O plano do gráfico** (`grafico/plano-do-grafico.ts`) e a **imagem** (`grafico/imagem-do-plano.ts`, 1000×640). A
  imagem usa o mesmo desenhista PNG e as mesmas cores do insumo:
  - **Por dia:** colunas com o período anterior em cinza claro ao lado e a maior em dourado. A comparação é "+12% sobre
    a semana anterior" (7 dias) ou "sobre o período anterior". São até 31 dias.
  - **Por hora:** colunas, com o pico em dourado. O período padrão é "hoje".
  - **Canais:** a participação de cada canal no faturamento. Só o perfil que vê valores.
  - **Mais vendidos:** barras deitadas, até 6.
  - Gerente sem valores: as vendas em quantidade e o aviso.
- **A imagem sai ANTES do texto**, até 3 por resposta, junto com as do insumo.
- **Sem venda, ou um ponto só:** sem imagem, e o resultado diz ao modelo para responder com os números.
- **Nasce DESLIGADA**, na chave `MISTER_MIDIA` (a mesma da foto e do áudio). Desligada, os números seguem e nenhuma
  imagem sai.
- **O resumo do dia e da semana NÃO usa a consulta.** Ele vai só por escrito, decisão 6; os gráficos dele são o "📊 Ver
  gráficos" da M5e.
- **Pergunta nova na avaliação:** a c48, "Me mostra em gráfico as vendas por hora de ontem.", com o pico às 20h. As
  perguntas passam a 48.
- **Diferenças do protótipo:**
  - O gráfico por hora sai em colunas, não em linha, porque o desenhista é um só.
  - O de canais mostra só o delivery por canal (`porPlataforma`), sem o balcão e o salão: o relatório de vendas não
    separa o balcão por canal.
  - O link e o PDF destes gráficos ficam com a M5e, que traz a migration do tipo do link.

**M5e implementada (19/11/2026; mig 462, só nuvem, com `drop constraint`: o dono aplica pelo SQL Editor — LIC-171):
o resumo em arquivo e no link.**
- **O texto do resumo vai sempre** (o da IA, como antes). O ajuste novo é "Como mandar o resumo", em Mister › Avisos e
  relatórios › Relatórios. Ele fica guardado em `mister_conversa_config.resumo_entrega` e tem 4 formas:
  - **texto com os botões "📄 PDF" e "📊 Ver gráficos"** (o padrão do protótipo);
  - texto e o PDF junto;
  - texto e o link junto;
  - só o texto.
- **O PLANO do resumo** (`grafico/plano-do-resumo.ts`) sai só dos números do Regem, no escopo de quem recebe:
  - os números grandes: faturamento com a comparação, vendas, ticket, pico e cancelamentos;
  - as abas, com os mesmos planos da M5d.2: por hora, canais, 7 dias (ou por dia, na semana) e produtos;
  - a atenção: os cancelamentos e o estoque abaixo do mínimo (o estoque é o de AGORA: ele não guarda o saldo de cada
    dia), sem nome de cliente nem de quem cancelou.
- **O plano só existe com a permissão dos relatórios de vendas.** O gerente do perfil padrão não tem essa permissão:
  recebe só o texto, sem botão.
- **O PDF** (`relatorio-resumo-pdf.ts`) segue o desenho da imagem. Ocupa 1 ou 2 páginas A4.
- **A página do link** (`/m/r/<código>`, o mesmo mecanismo da mig 443, `tipo = 'resumo'`) mostra os números, as abas
  dos gráficos e a atenção. O gráfico de colunas ganhou a barra do período anterior.
- **O botão leva só o id da linha** do `mister_relatorio` (`rsm:pdf:<id>`, `rsm:graf:<id>`). O toque confere que a
  linha é de uma empresa e de uma pessoa daquele telefone e refaz o plano no escopo dela. O link nasce no toque, não a
  cada resumo, por causa do teto de 20 links vivos.
- **O link do resumo vale enquanto quem o recebeu** (presidente ou gerente) seguir ativo. O do insumo continua só do
  presidente.
- **Nasce DESLIGADO** na chave `MISTER_MIDIA`: desligada, só o texto, como antes. O "Ver gráficos" também depende de
  `MISTER_LINK_PUBLICO`.
- **O gráfico da conversa (`mostrar_grafico`) também ganha "📄 PDF" e "🔗 Ver no link"** (conversa 6 do protótipo), no
  balão da resposta.
  - O botão leva a empresa, o gráfico, o período e a loja: `grf:<pdf|link>:<empresa>:<tipo>:<de>:<ate>[:<loja>]`.
  - O toque confere que a empresa é um vínculo do telefone e que a loja está no escopo da pessoa agora. Depois refaz o
    gráfico pela MESMA consulta.
  - O PDF e o link usam o plano do resumo com uma aba só (`tipo = 'grafico'`, o tipo que a 462 aceita). A página não
    mostra as abas nem a atenção.
- **Diferenças do protótipo:**
  - pela conexão por QR Code (Evolution) não há botão, então a forma dos botões vira só o texto;
  - a página do link segue o tema claro do app, não o do aparelho;
  - o texto acima de 1.000 letras manda os botões numa mensagem curta logo depois.

**M5c implementada (19/11/2026; a coluna `responder_audio` vai na mesma mig 462; Graph #7, contrato 1.2.0): a resposta
em áudio.**
- **No DMS Graph:** a ferramenta nova `falar`. O texto vira a nota de voz OGG/Opus pelo Cloud Text-to-Speech do Google,
  na voz `pt-BR-Neural2-B`.
  - A franquia é a mesma (cada fala conta uma), e a idempotência e o caminho são os da `ouvir_audio`.
  - A voz desligada no Google responde `integracao-parada`.
  - **Para funcionar, o dono liga a API "Cloud Text-to-Speech"** no projeto da chave do Gemini (ou põe uma chave própria
    em `GRAPH_VOZ_CHAVE`) e clica "Implantar" no Graph.
- **No Regem:**
  - O ajuste "Responder em áudio" fica em Avisos e relatórios › Conversa e nasce desligado.
  - Quando a pergunta veio por áudio e o ajuste está ligado, o agente manda o texto (como sempre) e DEPOIS a nota de voz.
    Ela leva o principal da resposta, uns 40 s: sem o "🎧 Entendi", sem link, sem emoji e sem marcadores, cortado no fim
    de uma frase.
  - A pergunta escrita recebe só o texto.
  - A voz que não deu (desligada, franquia, demora) não muda nada para a pessoa: ela já leu o texto, e o motivo vai ao
    log.
  - A chave da fala é a empresa mais o texto: a mesma resposta repetida não gasta a franquia de novo.
  - Pela API oficial, a nota sai com `voice: true` (até 512 KB). Pelo Evolution, sai pelo `sendWhatsAppAudio`.
- **Nasce desligado em duas chaves:** a da instalação (`MISTER_MIDIA`) e a da empresa ("Responder em áudio").
- **Diferença do protótipo:** só o "Responder em áudio" virou ajuste. O "Ouvir áudios" e o "Ler fotos" seguem pela chave
  da instalação (`MISTER_MIDIA`), como na M5a e na M5b.

**Fica para depois (pedido do dono em 19/11):** quando a base de eventos do plano do perfil do cliente estiver pronta, o
Mister usa o clima e os eventos para avisar de chuva e programar entregadores e funcionários em feriados e eventos
grandes. A fonte do clima precisa de licença comercial.

### Versão 6 — o Mister no comando, com segurança e as regras de cada pessoa (aprovada pelo dono em 20/11/2026)

**Aprovação (20/11/2026):** "1 plano aprovado, 3 pode, 2 ok" — o plano com as 12 decisões recomendadas; o "pode" para
criar imagem e criar vídeo no DMS Graph (`criar_imagem` e `criar_video` do plano "recursos por produto", com as
recomendadas GR-9 a GR-19; editar foto e ajustar ou editar vídeo seguem esperando); e o dono faz a conferência A1.0 com o
celular dele. Reforço do dono no mesmo dia: as regras são dinâmicas (§4).

Pedido do dono (20/11/2026), resumido nas palavras dele. Os exemplos que ele deu servem para tirar o padrão, não para
virar regra fixa.

1. **Identificador do telefone** e um jeito seguro de trocar de celular em caso de perda ou dano.
2. **Os reforços recomendados** S1–S4, aprovados ("vamos aplicar os reforços recomendados").
3. **Acesso completo ao Regem**, com segurança para intrusos não chegarem ao Mister: o presidente resolve tudo pelo
   WhatsApp, com a ajuda da IA. Exemplos: a foto ou a planilha de uma tabela vira a lista de compras; a foto de um cupom
   fiscal é transcrita e o Mister pergunta como lançar.
4. **Regras de cada pessoa**: cada um decide, por texto ou áudio, o que quer receber e como. A regra nasce, se ajusta e
   se apaga pela conversa. Exemplos: só avisar com 3 pedidos há mais de 20 min sem ficar prontos, numa mensagem só
   ("Pedidos 22, 24 e 28 estão há mais de 20 min em produção"; com 1 só, não avisar); trocar o tempo de produção pelo de
   despacho (do aceite ao despacho, avisar acima de 30 min); lembrar do boleto "X" uma hora antes; avisar se alguma
   tarefa, ou a tarefa 5, não for feita; e apagar cada uma ("não quero mais ser avisado do boleto X").
5. **Perceber padrões**: "a impressora tem de ficar ligada no expediente; se desligam antes, e acontece várias vezes, é
   porque aquele equipamento é desligado antes do horário de fechamento".
6. **Suporte de configuração**: a descrição do caminho e, melhor, a foto da tela com o caminho.
7. **Texto e imagem dinâmicos com a IA**: a imagem sai de um pedido completo; quando a pessoa não gosta ("não entendi,
   não gostei"), sai de novo, mais didática, simples e sofisticada, com os dados já pedidos; IA para criar imagem e vídeo.
8. **O ciclo**: recebe a ordem → entende o contexto → separa os dados → confere as regras → pede foto ou vídeo se
   precisar → arruma e apresenta → e, conforme a ocasião, sugere o que fazer com os dados.

#### 1. Como está (conferido no código em 20/11/2026, `origin/main` `82909eb5`)

**Segurança**
- O telefone é o identificador. A mensagem só entra com a assinatura da Meta conferida (`whatsapp-cloud.controller.ts`,
  HMAC; sem o segredo, nada passa) e só representa alguém se o número estiver ligado à pessoa (`mister_vinculo`), o que
  é conferido a cada mensagem e de novo na hora de responder (`MisterFerramentasService.escopo`). Não há identificador do
  APARELHO: quem estiver com aquele WhatsApp aberto (WhatsApp Web no PC da loja, conta clonada, número que a operadora
  repassou) fala como a pessoa.
- O vínculo não vence: só sai quando a pessoa ou o presidente desliga, ou quando ela perde o cargo. Ligar com outro
  número troca o anterior sozinho (um vínculo por pessoa e empresa; `MisterVinculoService.gerarCodigo`).
- Não existem "esqueci a senha" nem "sair de todos os aparelhos": `POST auth/logout` encerra só a sessão do próprio
  token (mig 457). O PIN só muda pelo cadastro do colaborador.
- Ler valores não pede PIN. O PIN só existe para cancelar pedido com estorno (link `/m/<código>`, F4.2a).
- A Meta tem o recurso oficial "Identity change check". Ligado no número (`POST /<phone-number-id>/settings` com
  `{"user_identity_change": {"enable_identity_key_check": true}}`), a mensagem que chega traz
  `contacts[].identity_key_hash`; a enviada com `recipient_identity_key_hash` diferente falha com o código 137000. A doc
  NÃO diz quais ações mudam o hash (reinstalar, celular novo, WhatsApp Web) e diz que as mensagens ao usuário ficam
  bloqueadas até a empresa reconhecer a mudança, sem mostrar como se reconhece pela Cloud API. Não existe na conexão
  por QR Code.

**Acesso**
- 31 ferramentas (19 consultas da loja, o guia, as conversas anteriores e 10 ações), 4 procedimentos (3 por botão,
  cancelar por PIN) e os documentos por foto (boleto, conta, nota). Dos 72 módulos de negócio, cerca de 40 não têm
  cobertura nenhuma: cardápio e cupons, clientes e marketing, entregadores, checklist, POP, vistoria, desperdício,
  compras, cadastros, configuração da loja, entre outros. O guia "como faço" cobre 23 dos 54 itens do menu.
- Quem fala: o presidente (tudo) e o gerente (a loja dele e o que o perfil libera). O perfil de permissões próprio do
  Mister fica para o fim do projeto (item 8 da §5).

**Avisos e regras**
- `pedido_parado`: UM aviso por pedido e por etapa (chave `pedido:<id>:<status>`), com o mesmo limiar (15, 20 ou 30 min)
  para o aceite, o preparo e a espera do entregador; sem agrupar e sem mínimo de pedidos; só pedidos dos canais
  (`pedido_externo`); regra por EMPRESA (`mister_aviso_regra`, chave `tenant_id, tipo`). É a enxurrada que o dono recebe.
- Não há tempo "aceite → despacho" calculado em lugar nenhum, embora as colunas existam (`confirmado_em`,
  `despachado_em`). A comanda de balcão ou mesa não tem aceite, pronto nem despacho.
- Tarefas: não têm número visível (o id é uuid); só ficam "não feita" quando alguém marca (`estado = nao_feita`); nada
  compara o horário com o relógio; a recorrência não vira tarefa do dia sozinha (não há rotina); não existe nenhum alerta
  de tarefa.
- Boleto: `titulo_financeiro.vencimento` é DATA, sem hora. O aviso `boleto_vencendo` só cobre os boletos lançados por
  foto no Mister (3, 1 ou 0 dias antes, às 9h).
- Por pessoa, hoje: o `lembrete` (uma vez, numa hora fixa, texto livre), o "fica de olho" (um alvo até as 06:00), a
  memória (texto que só entra na conversa) e o PARAR AVISOS (tudo ou nada). `mister_conversa_config` é por empresa.
- `mister_aviso.tipo` é texto sem trava no banco: aviso de tipo novo não pede migration.
- Padrões: a vigia guarda cada parada de impressora com o começo e o fim (`vigia_incidente`, chave
  `srv:<id>:impressora:<id>`), e o horário de atendimento da loja está em `cardapio_config.horarios` (por loja ou da
  empresa). Nada cruza os dois.

**Documentos, compras e cupom**
- O cupom fiscal de compra (NFC-e, modelo 65) não é tratado. A chave só é aceita no modelo 55 (`lerChaveDaNfe`). Pelo
  Graph, o texto perde o CNPJ e a chave (`semDadoPessoal` apaga sequências de 9 dígitos ou mais), e "nfc-e" não casa com
  o filtro de documento (`mister-midia.regras.ts`). `mister_documento.tipo` tem trava no banco (`boleto|conta|nota|outro`).
- A conta a pagar nasce em aberto (`FinanceiroService.criar`). Conta já paga = `criar` + `pagar` (dinheiro, pix, cartão
  ou transferência). A categoria é texto livre: não há plano de contas.
- O recebimento aceita entrada sem fornecedor e sem nota, mas todo item precisa estar cadastrado no estoque.
- Lista de compras (`compra_lista` e `compra_item`, tela Estoque › Pedidos): os itens entram só por id; existe a
  sugestão pelo estoque mínimo (`ComprasService.sugerir`); o Mister não cria lista (o `ComprasModule` não está no
  agente). Achar o insumo pelo nome já existe (`acharInsumo`, `sugerirInsumos` com sinônimos fixos). O Regem tem leitor
  próprio de XLSX e CSV, sem biblioteca (`estoque/produtos-planilha.ts`, `cliente/ler-xlsx.ts`), mas a planilha mandada
  ao Mister recebe "só leio texto".

**Gráficos e geração**
- A IA escolhe só entre 4 tipos e passa o tipo, o período e a loja; o título, as cores e o desenho são do código (PNG
  próprio, `pdfkit`, SVG). Não há "refazer": os botões PDF e link repetem a mesma consulta.
- O DMS Graph JÁ gera imagem (`gemini-3.1-flash-image`) e vídeo (`gemini-omni-1.2-flash`) na tela "Criar" dele e no MCP
  local, mas a porta que o Regem usa (`/mcp`) só tem `analisar_arquivo`, `ouvir_audio` e `falar`. O plano do Graph de
  20/11 ("recursos por produto e edição de foto", espera o "pode" do dono) prevê `criar_imagem` e `criar_video`.

**IA**
- Perguntas: `claude-haiku-5-5` (US$ 0,10 de entrada e US$ 0,50 de saída por milhão de tokens; medido ~US$ 0,001 por
  pergunta em 13/11), pela chave da empresa e, sem ela, pela da distribuição. Documentos: `claude-sonnet-5-5` (US$ 2 e
  US$ 10). A porta é `IaEmpresaService.pedir`.

#### 2. Princípios (valem para todas as fases)

1. **A IA entende e propõe; o código confere e executa.** Número só de consulta; regra só com as fontes e os campos que o
   Mister lê; ação só pelo
   MESMO serviço da tela (V43), com auditoria `origem: 'mister'`, chave idempotente (V42) e "Desfazer" onde a tela
   permite. A IA nunca escreve código que roda.
2. **"Acesso completo" = completo dentro do perfil de quem fala**, decidido no servidor. O presidente vê e faz tudo o que
   a tela dele faz; o gerente, a loja dele e o que o perfil libera.
3. **Confirmação proporcional ao risco:**
   - **Livre** (só da própria pessoa): consultas, regras, lembretes, memória, "fica de olho".
   - **Botão "Confirmar"**, com o rascunho mostrado antes: lista de compras, lançar cupom, criar tarefa, pausar ou
     retomar canal ou produto, recado.
   - **PIN pelo link** (o mecanismo da F4.2a): dinheiro (pagar, estornar, cancelar com estorno), configuração que muda a
     operação (preço, horário, área de entrega, módulos) e pessoas (cadastrar, desligar).
   - **Nunca pelo Mister**: perfis e permissões, senha ou PIN de outra pessoa, chaves e credenciais de integração, dados
     de cliente (listar, exportar), apagar em massa, certificado e configuração fiscal, planos e assinatura. O Mister
     explica o caminho da tela.
4. **Nasce desligado** o que é pago ou muda o que a loja vê; o preço fica ao lado (regra do custo mínimo).
5. **Escala:** as regras se avaliam em lote (uma leitura por sinal para todas as regras ativas, nunca uma por regra); o
   envio é idempotente; nada de estado em memória entre réplicas.
6. **Por cima do que existe:** camadas novas e encaixes pequenos. O aviso da empresa continua igual para quem não tem
   regra própria.

#### 3. Frente A — segurança e troca de celular

| Peça | O que faz | Onde encaixa | Migration |
|---|---|---|---|
| **A1.0 · Conferir antes (V20)** | Com o número do Mister e um celular de teste do dono: ligar o recurso, ver o hash chegar, reinstalar o WhatsApp do celular de teste e anotar o que acontece (hash novo? envio bloqueado até reconhecer? como reconhecer?). O código só começa depois. | — | não |
| **A1 · Identidade do aparelho (S1)** | Guarda o hash do aparelho ao ligar o telefone. Mensagem com hash diferente → o Mister para de responder dados e manda "Este WhatsApp mudou de aparelho. Confirme com o seu PIN" (link `/m/<código>`, o da F4.2a). Com o PIN certo, grava o hash novo e segue; 5 PIN errados → o telefone é desligado e o presidente avisado. | `mister-entrada.service.ts` (lê `contacts[].identity_key_hash`), `mister_vinculo` | 1 (469) |
| **A2 · Sessão com PIN (S2)** | Ajuste do presidente: valores em reais, dados de pessoas e ações de botão pedem o PIN pelo link a cada 12 h (6, 12 ou 24). Nasce desligado. | escopo + o link da F4.2a | na 469 |
| **A3 · O vínculo vence (S3)** | Sem mensagem da pessoa há 60 dias → desliga o WhatsApp do Mister dela, com aviso na tela e auditoria; ligar de novo é pelo código. | rotina diária; `mister_vinculo.ultima_entrada_em` (já existe) | não |
| **A4 · Aviso de ligação (S4)** | Telefone novo ligado, religado ou com o aparelho trocado (A1) → aviso aos presidentes no Mister e na tela: quem, o final do número e quando. "Não reconheço" → desliga na hora. | tipo novo de aviso (sem trava no banco) | não |
| **A5 · "Perdi o celular"** | Em Mister › Pessoas, para a própria pessoa (e o presidente para qualquer um): desliga o WhatsApp do Mister E encerra todas as sessões do Regem dela (o app logado no celular perdido), com auditoria e aviso aos presidentes. Se ninguém consegue entrar no Regem (não há "esqueci a senha"), o suporte da DMS desliga pelo Console › Mister, com auditoria. | Pessoas; Console › Mister; `JwtAuthGuard` e `RealtimeGateway` (V97) | 1 (470); toca o servidor da loja → `.zip` |
| **A6 · Trocar de celular** | Mesmo número (chip novo, celular consertado): A1 pede o PIN e segue. Número novo: o código gerado no Regem e mandado do celular novo (já existe; o antigo sai sozinho). PIN esquecido: troca no cadastro. | guia de uso + Pessoas | não |

#### 4. Frente B — as regras de cada pessoa (dinâmicas)

**O princípio (reforço do dono, 20/11):** os exemplos são exemplos; a instrução é livre. O Mister monta a regra a partir
da instrução do presidente e dos DADOS a que ele tem acesso. Não existe lista fixa de regras: existe a lista do que o
Mister consegue ler (as fontes), e qualquer combinação delas vira regra.

**Como uma instrução vira regra**
1. A pessoa fala, por texto ou áudio (o áudio já vira texto pela M5b).
2. A IA escreve a regra numa linguagem estruturada (JSON com schema, `strict: true`), com seis partes:
   - **fonte**: o que observar, uma das fontes de dados do Mister (pedidos, cozinha, contas, tarefas, equipamentos,
     caixas, canais, vendas, estoque, equipe, cancelamentos, atendimento…);
   - **filtro**: quais itens, por campo, comparação e valor ("situação = em preparo", "minutos desde o aceite > 20",
     "a conta da Distribuidora X", "a tarefa de limpar a chapa");
   - **medida**: o que contar ou medir (quantos itens, a soma, o maior, o tempo, a mudança de situação);
   - **condição**: quando dispara ("3 ou mais", "acima de 30 min", "abaixo de R$ 2.000 até as 20h", "uma hora antes do
     vencimento, às 17h");
   - **quando olhar**: horário, dias, só no expediente, uma vez ou sempre;
   - **como avisar**: uma mensagem com a lista, o jeito que a pessoa pediu, agrupar, não repetir o mesmo item, e qual
     aviso da empresa ela deixa de receber.
3. O código confere tudo: a fonte existe e a pessoa tem a permissão dela; cada campo existe na fonte e tem o tipo certo;
   os números estão nos limites; o alvo existe no banco. Se faltar algo, o Mister pergunta (ex.: o boleto vence num DIA,
   então "uma hora antes de que horário?"). O que não dá para montar com os dados que existem, ele diz que ainda não
   consegue e anota (F5.2), nunca inventa. A IA nunca escreve código.
4. O Mister repete a regra em português, com o que muda no que a pessoa já recebe, e pede "Confirmar". Ex.: "Vou te
   avisar quando 3 ou mais pedidos passarem de 20 min aceitos sem ficar prontos, numa mensagem só. Os avisos de pedido
   parado um a um param de chegar para você (o KDS e a tela continuam). Confirma?"
5. Um motor só avalia todas as regras: agrupa por empresa e por fonte, lê cada fonte UMA vez por volta (em lote) e
   aplica o filtro e a condição de cada regra no resultado. Cada envio leva a chave idempotente da regra, dos itens e da
   janela.
6. "Muda para 25 min", "só de noite": altera a regra que existe. "Não quero mais…": a IA acha a regra entre as da pessoa
   (com dúvida, mostra a lista curta), o Mister confirma e apaga. O histórico fica.

**O que uma regra guarda:** de quem é; a frase da pessoa (30 dias, como as perguntas); as seis partes acima; a validade
(até apagar, até uma data ou uma vez); e a versão das fontes com que foi montada.

**As fontes (o que o Mister lê), versão 1.** Cada fonte declara os campos (nome, tipo, o que significa), a permissão e
a cadência mínima de leitura. São as mesmas consultas do Mister, com os campos que a regra pode usar, mais os campos
derivados que faltam hoje:

| Fonte | Campos de exemplo | Base | Observação |
|---|---|---|---|
| pedidos dos canais | número, canal, loja, situação, minutos desde a chegada, desde o aceite, até o pronto, do aceite ao despacho, valor | `pedido_externo` | "do aceite ao despacho" é campo novo, das colunas que existem |
| cozinha (KDS) | pedido, estação, situação, minutos na fila e em preparo | `producao_pedido` | |
| contas a pagar | descrição, fornecedor, valor, vencimento (dia), situação | `titulo_financeiro` | o vencimento não tem hora: a regra guarda a hora que a pessoa disser |
| tarefas do dia | título, horário, horário de fim, situação, quem | `tarefa_instancia` + `tarefa_def` | sem número: a tarefa se acha pelo nome ou pela lista do dia; só as que existem no dia |
| equipamentos | impressora, servidor, parado desde, dentro do horário da loja | `vigia_incidente` + `cardapio_config.horarios` | |
| caixas | caixa, aberto desde | `caixa_sessao` | |
| canais | canal, pausado desde, motivo | a pausa do canal | |
| vendas | total do dia até agora, por canal, por hora, comparação com as semanas anteriores | os relatórios | só quem vê valores |
| estoque | item, saldo, mínimo, validade | `item_estoque` | |
| equipe | escalados, presentes, faltas | escala e ponto | |
| cancelamentos e atendimento | quantidade, motivo, casos abertos | as consultas que existem | |

Cada fonte nova que o Mister ganha (frentes C e D) entra nesta lista e passa a valer para as regras, sem mudar o motor.

**Os exemplos do dono nesta linguagem** (só para provar que cabem; não são a lista):
- "3 pedidos há mais de 20 min sem ficar prontos, numa mensagem só" → pedidos; filtro situação = em preparo e minutos
  desde o aceite > 20; medida quantidade; condição ≥ 3; avisa a lista dos números; substitui o pedido parado.
- "o despacho, do aceite até sair, acima de 30 min" → pedidos; filtro do aceite ao despacho > 30; avisa cada pedido uma
  vez.
- "o boleto X uma hora antes" → contas; alvo a conta X; condição o vencimento às 17h (a hora que a pessoa disse) menos 1 h.
- "se a tarefa 5 não for feita" → tarefas; alvo a tarefa (o Mister mostra a lista do dia e pergunta qual é a "5").
- "a impressora desligada antes do fechamento" → equipamentos; filtro parado dentro do horário da loja.

**Junto com o aviso da empresa:** a regra pessoal só muda o que chega à PRÓPRIA pessoa pelo WhatsApp; o KDS, a tela e os
outros seguem a regra da empresa. O encaixe é pequeno, em `pelosWhatsapps`: pula quem tem regra que substitui aquele tipo.

**Padrões (a parte que aprende), pelo código e sem IA, uma vez por noite:**
- **Impressora desligada antes do fechamento:** a parada que começou dentro do horário da loja e não voltou até fechar,
  em 3 ou mais dos últimos 14 dias, na mesma faixa de horário. O Mister diz: "Percebi um padrão: a impressora da cozinha
  foi desligada antes do fechamento em 4 dos últimos 7 dias, sempre entre 22:30 e 23:10. Parece que alguém desliga ao
  limpar a cozinha." E sugere: um recado no mural (já existe), uma tarefa de fechamento ou a regra "me avise na hora se
  desligar antes das 23:30".
- **Avisos que a pessoa nunca responde nem toca** (ex.: 14 de pedido parado ontem): "quer que eu só avise com 3 ou mais?".
- **Pedidos que atrasam sempre na mesma faixa** (o pico): sugere a regra naquele horário.
- Cada sugestão vai uma vez; "Não, deixa assim" cala aquele padrão por 30 dias. O Mister NUNCA muda uma regra sozinho.

**Tela:** Mister › Regras. Cada pessoa vê as dela (ativas e pausadas), muda e apaga em gaveta; o presidente vê as de
todos (decisão V6-5). Pede o protótipo.

#### 5. Frente C — acesso completo, com segurança (as ações)

- **Uma porta só para as ações.** As consultas continuam como ferramentas; as AÇÕES passam por uma ferramenta só,
  `propor_acao`, com o catálogo e o formato de cada ação conferidos pelo código (como o `propor_procedimento` de hoje). A
  lista de ferramentas fica estável (o cache do provedor continua valendo) e não depende de recurso novo do modelo. Se as
  consultas passarem de ~40, avaliar a busca de ferramentas do provedor (`tool_search` com `defer_loading`), conferindo
  antes, na doc, se vale para o modelo em uso.
- **Lista de compras** (botão). Entra por foto (Graph), planilha (o leitor que existe), texto ou áudio ("pede 10 kg de
  bacon e 5 caixas de tomate") ou "faz a lista do que está abaixo do mínimo" (`ComprasService.sugerir`). Cada linha acha
  o insumo (`acharInsumo`/`sugerirInsumos` + a memória por fornecedor); a dúvida vira botão ("Bacon fatiado ou em
  cubos?"); o item que não existe pede "Cadastrar" ou "Deixar de fora"; a marca, quando o insumo tem duas ou mais (a lista
  exige); e o fornecedor. Resumo + "Criar o pedido" → `ComprasService.createLista` (Estoque › Pedidos). Depois, "Mandar
  ao fornecedor" com o texto que a tela já monta.
- **Cupom fiscal de compra** (botão). A foto vai aos documentos, não ao texto do Graph, que apaga o CNPJ e a chave. A
  leitura traz o emitente, o CNPJ, a data e a hora, os itens, o desconto, o total, a forma de pagamento e a chave de 44
  dígitos. O código confere a chave (modelo 65, dígito verificador, CNPJ igual ao do emitente) e a soma dos itens. Depois,
  "Como deseja lançar?":
  - **Só despesa**: a conta paga (`criar` + `pagar`, com a forma do cupom e a categoria sugerida pela memória do emitente);
  - **Estoque e despesa**: cada item pelo fluxo da nota (M3b), com a memória pelo CNPJ do emitente; o recebimento sem
    fornecedor e `semConta`, mais a conta paga;
  - **Não lançar**.
  O "Desfazer" vale para a conta; a entrada no estoque, como na nota, não se desfaz pela conversa (decisão V6-8).
- **Lotes de ações** (um PR cada, pelo mapa do levantamento): Delivery (pausar e retomar canal, avançar e despachar
  pedido, pausar produto); Tarefas (criar, concluir, marcar "não feita"); Cardápio (preço por canal, com PIN); Loja
  (horário, com PIN); Financeiro (pagar conta, com PIN; consultar as contas a pagar e a receber); Estoque (movimento,
  contagem); Escala e ponto (consultas); Clientes (só números juntos, nunca dado pessoal).

#### 6. Frente D — conversa, apresentação e suporte

- **O ciclo**, nas instruções e no código: entende (a mensagem, a memória e as regras de FORMATO da pessoa) → separa os
  dados (consultas em paralelo, até 3 por rodada, já existe) → confere as regras (a permissão e os valores no servidor;
  o formato preferido) → pede a mídia quando ajuda (gráfico, imagem da tela, imagem gerada) → apresenta → sugere,
  separado dos números, quando a ocasião pede.
- **O formato de cada pessoa**: "sempre em lista", "sem centavos", "resumo às 8h em PDF", "responda em áudio" viram
  regras de formato dela. Hoje o jeito, o perfil e o "Responder em áudio" são da empresa.
- **Gráficos**: mais formas (linha, colunas, barras, rosca, comparação lado a lado, tabela em imagem, cartões de números)
  e o que a IA pode escolher (a forma, o título com a mensagem principal, o destaque, a ordem, mostrar os valores, uma
  anotação). Os números vêm sempre da consulta. **Refazer:** o último gráfico (o plano e os dados) fica guardado na
  conversa por 30 min. "Não entendi, não gostei" → a IA revê a apresentação com a crítica e a regra "didático, simples e
  sofisticado" (uma mensagem por gráfico, até 7 barras, destaque no que importa, rótulos diretos), e o código desenha de
  novo com os mesmos dados, sem consultar de novo.
- **Imagem e vídeo gerados**: só para o que não é número (cartaz de promoção, post, ilustração). Número de relatório
  nunca vai à IA de imagem, que erra texto e número. O Mister monta o pedido completo (objetivo, texto exato, estilo da
  marca, formato 1:1, 16:9 ou 9:16) e o mostra antes de gerar. Depende do plano do Graph (`criar_imagem`,
  `criar_video`); nasce desligado, com o preço ao lado. Junta-se ao item "Banner por IA", guardado para o fim do Mister.
- **Suporte**: completar o guia "como faço" nos 31 itens do menu sem assunto, em lotes como a M3d (imagem obrigatória por
  assunto). Quando existir a ação, o Mister oferece "quer que eu faça?", com o nível de confirmação dela.
- **Texto dinâmico**: os avisos das regras saem montados pelo código; o ajuste "avisos escritos pelo Mister" (M4c) passa
  a valer para eles, com a mesma conferência (nenhum número que o aviso não trouxe).
- **Modelo**: o Haiku 5.5 segue nas conversas. Trocar só onde a avaliação de regressão mostrar ganho, com casos novos
  para regras, cupom, lista e gráfico refeito.

#### 7. Fases (uma entrega por PR; migrations a partir da 467)

| Fase | O que entra | Migration |
|---|---|---|
| **M6.0 · Protótipo** | `mockups/regem-mister-v6.html`: as conversas (aparelho trocado com o PIN, perdi o celular, regra criada, mudada e apagada, aviso agrupado, despacho, boleto uma hora antes, tarefa, o padrão da impressora, lista de compras por foto e por planilha, cupom "como deseja lançar", gráfico refeito, "como faço" com a tela e "quer que eu faça?"), as telas (Pessoas com "Perdi o celular", Regras, Console › desligar a pessoa) e as decisões. Medido em 16 larguras. | não |
| **M6a · Segurança 1** | A3, A4, o desligar pelo console e a lista do "nunca pelo Mister" nas instruções e no código | 468 (o motivo do desligamento — divergência: o plano previa sem migration) |
| **M6b · Identidade** | A1.0, A1 e A6 no guia | 469 |
| **M6c · Perdi o celular** | A5: as sessões por pessoa (a guarda e o tempo real); vai no `.zip` | 470 |
| **M6d · Sessão com PIN** | A2, nascendo desligada | na 469 |
| **M6e · Regras 1** | a linguagem da regra, o motor, as fontes v1, criar, mudar e apagar pela conversa e o encaixe nos avisos da empresa | 471 (`mister_regra`, `mister_regra_envio`) |
| **M6f · Regras 2** | a tela Regras, os formatos da pessoa, os padrões e as sugestões | 472 (as decisões das sugestões) |
| **M6g · Lista de compras** | foto, planilha, texto e mínimo → `createLista` | não |
| **M6h · Cupom fiscal** | a leitura, a conferência da chave 65 e os três jeitos de lançar | 473 (o tipo `cupom` na trava de `mister_documento`: tem `drop constraint`, então o dono aplica pelo SQL Editor — LIC-171) |
| **M6i · Gráficos** | as formas novas e o refazer | não |
| **M6j · Ações em lotes** | a porta `propor_acao` e os lotes por módulo | conferir por lote |
| **M6k · Guia completo** | os 31 assuntos com imagem | não |
| **M6l · Imagem e vídeo** | depois do plano do Graph | não (no Regem) |

**Ordem recomendada:** M6.0 → M6a → M6e (a enxurrada de avisos é a dor de agora) → M6b (assim que o dono puder fazer a
A1.0 com o celular de teste) → M6c → M6h → M6g → M6i → M6f → M6d → M6j → M6k → M6l.

**Em todas:** tabela nova `@cloud-only`, classificada em SO_NUVEM no `sync-daemon` (V21) e com a migration testada no
local antes (V9); módulo novo importado no agente → `app-sobe.spec.ts` (V81; o `ComprasModule` na M6g); avaliação de
regressão de novo quando as instruções mudam; a Meta pela doc oficial (V20); a M6c mexe na autenticação (V97).

**M6a implementada (20/11/2026; mig 468 SÓ NUVEM — a 467 foi de outra sessão, o catálogo):**
- **O desligamento tem um caminho só** (`mister-desligar.ts`): a pessoa, o presidente, o vencimento, o console e o "Não
  reconheço" passam por ele. O motivo fica na pessoa (`mister_vinculo.desligado_*`, a parte "Pessoas" mostra "desligado em
  02/11 · 60 dias sem conversa") e no telefone (`mister_conversa.desligado_*`, quem escreve depois ouve "foi desligado por
  60 dias sem conversa" ou "foi desligado", e não a frase de quem nunca ligou). A memória sai junto, como antes.
- **A3, o vencimento:** `MisterVinculoSegurancaService.rotina` às 04:20 (só nuvem), set-based, até 500 por volta; a conta
  é pela última conversa (pergunta ou toque) ou, sem nenhuma, pela ligação. Auditoria `mister_whatsapp_vencido`.
- **A4, o aviso de ligação:** tipo novo de SEGURANÇA `telefone_ligado` (regra fixa: só os presidentes, a empresa não
  desliga, texto sempre fixo, fecha calado em 24 h; no Histórico em "O próprio Mister"), com o botão "Não reconheço"
  (`vinc:nao:<colaborador>:<instante da ligação>`): só o presidente da empresa desliga, e só aquela ligação (quem religou
  depois do aviso não cai pelo toque antigo).
- **O console da DMS:** `GET distribuicao/mister/pessoas?empresa=` (só o final do número) e `POST
  distribuicao/mister/pessoas/desligar` com o motivo (pelo menos 10 letras), na auditoria do console; na empresa fica
  "desligado pelo suporte da DMS". Tela: "Pessoas de uma empresa" na aba Mister.
- **A6 em parte:** ligar de outro número diz "O número antigo (final 4321) foi desligado do Mister." e marca o telefone
  antigo como desligado pela própria pessoa.
- **O "nunca pelo Mister"** entrou nas instruções (DE QUEM VOCÊ FALA) — a versão das instruções mudou: rodar a avaliação.
- **Divergência do plano:** a M6a previa "sem migration"; o motivo do desligamento pediu a 468 (a 467 saiu antes, de outra sessão).
  **A numeração real fica por ordem de chegada**, combinada com as outras sessões (469 a fila do robô, 470 o Pulso, 471 o
  Clube, 474 o Clube A1): a M6e pegou a 472 e a M6b fica com a 473; as seguintes conferem a `origin/main` e os PRs abertos.

**M6e implementada (20/11/2026; mig 472 SÓ NUVEM — `mister_regra` e `mister_regra_envio`):**
- **A linguagem e as fontes** (`mister-regra.ts`, puro): sete fontes v1 com os campos (pedidos dos canais — com o trecho novo
  "minutos do aceite até sair para entrega" —, contas a pagar, tarefas de hoje, impressoras e servidor parados — com "dentro
  do horário da loja" pelo `cardapio_config.horarios` —, caixas abertos, canais pausados e as vendas de hoje, as mesmas do
  Painel); a regra em seis partes (fonte, filtros + "algum", alvo, medida + condição, quando — dias, janela, "em HH:MM" uma vez
  por dia, data, expediente —, vezes, agrupar, intervalo, substitui); a conferência (fonte, permissão do perfil, campo, tipo,
  valores, reais só para quem vê, os avisos críticos não se calam — V6-6 —, 30 por pessoa — V6-7); a DESCRIÇÃO que o código
  escreve e a pessoa confirma; a avaliação (cada item uma vez; a condição avisa na subida e só repete depois do intervalo se
  a lista mudar) e o texto do aviso (título, a lista de até 10 com o número que a regra mede).
- **A ferramenta `regras`** (propor, confirmar, buscar, listar, apagar, pausar, retomar), com a descrição das fontes gerada
  do catálogo e um bloco novo nas instruções ("AS REGRAS DE AVISO DE CADA PESSOA"); o alvo (a conta, a tarefa) sai da busca
  e o nome vem do banco, no escopo da pessoa. Botões `regra:sim|mudar|apagar|deixar:<id>`; a proposta vale 30 min.
- **O motor** (`MisterRegrasService.volta`, a cada minuto, só nuvem; trava `MISTER_REGRAS_DESLIGADAS=1`): cada fonte lida
  UMA vez por volta para as empresas que precisam dela (as vendas, por dono, pelo `DashboardService`), cada regra no escopo
  do dono conferido na volta (V75), o envio reservado pela chave antes de sair; fora das 24 h vai o modelo `mister_aviso`
  com o toque `mister:regra:<envio>`. A de uma vez só se encerra ao olhar; a do dia que passou também.
- **O encaixe nos avisos da empresa:** quem tem regra ATIVA que substitui o tipo não recebe aquele aviso pelo WhatsApp
  (`semRegraQueSubstitui` em `pelosWhatsapps`); o KDS, a tela e os outros seguem iguais.
- `mister_regra` e `mister_regra_envio` = SO_NUVEM no `sync-daemon.mjs` (o daemon mudou → vai no próximo `.exe`).
- Fica para a M6f: a tela Mister › Regras, os formatos da pessoa, os padrões e as sugestões; e as fontes seguintes (estoque,
  equipe, cancelamentos, atendimento).

**M6c implementada (20/11/2026; mig 473 NUVEM E LOJA — `sessao_corte`; vai no `.zip`):**
- **O corte por pessoa** (`auth/sessao-corte.ts`): uma linha por pessoa com o `desde`; todo token dela com `iat` antes do
  corte é recusado pela guarda (`JwtAuthGuard`) e pelo tempo real (V97), segundo a segundo (o token do mesmo segundo vale).
  Memória por processo com a janela de 30 s da guarda, o corte feito no processo vale na hora, o banco atrás nunca desce o
  corte, e a conferência é À PARTE da leitura da pessoa (sem a tabela no servidor da loja, o bloqueio e a exclusão seguem).
- **Só a nuvem escreve, a tabela DESCE** (o molde da `pedido_chegada`, mig 354): à parte de `colaborador` para a última
  escrita da linha da pessoa não apagar o corte; sem CHECK e sem chave estrangeira; `direcao: 'desce'` no `sync-config` e
  VOLTA_DA_NUVEM no `sync-daemon` (o daemon mudou → `.exe`). No servidor da loja vale nas rotas assim que desce; os
  sockets de lá caem na próxima conexão.
- **Mister › Pessoas › "Perdi o celular"** (`POST /mister/pessoas/:id/perdi-o-celular`): cada um no próprio, o presidente
  em qualquer pessoa da empresa dele; corta PRIMEIRO, depois desliga o WhatsApp (motivo `pessoa`/`presidente`), auditoria
  `sessoes_encerradas`, e o evento `sessao.cortada` derruba na hora os sockets da sala `pessoa:<id>`. Quem corta o próprio
  sai também do computador (a tela chama `sair()` e volta ao `/entrar`).
- **Console da DMS:** a caixa "Encerrar também todas as sessões do Regem desta pessoa" no diálogo de desligar (nasce
  desmarcada; só `true` vale — V15). **Divergência do protótipo:** o diálogo do console não tinha a caixa; entrou porque a
  peça A5 do plano pede o "Perdi o celular" pelo suporte para quem não consegue entrar no Regem.
- **O aviso aos presidentes** (`acesso_encerrado`, regra fixa, sem botão, texto nunca escrito pela IA, evento de 24 h): o
  corte (quem informou e a hora) e, preenchendo a lacuna da M6a, o WhatsApp desligado pelo suporte da DMS sem corte junto
  ("Os presidentes da empresa são avisados na tela", do protótipo). O mesmo pedido do console com o corte vira um aviso só.
- Limite conhecido: o relógio é o de quem emitiu o token — num servidor da loja com o relógio adiantado, um token anterior
  ao corte pode passar; o bloqueio da pessoa continua valendo para os dois lados.

**M6h implementada (20/11/2026; SEM migration; nasce desligado — `MISTER_CUPOM=1`, além de `MISTER_NOTAS=1`):**
- **Divergência do plano (para menos passos do dono):** o plano previa a 473 (o tipo `cupom` na trava de
  `mister_documento`, com `drop constraint`, aplicada pelo SQL Editor). O cupom entra como `tipo = 'nota'` com
  `dados.nota.especie = 'cupom'` — nenhuma migration e nada à mão.
- **A leitura** (`common/nota-por-foto.ts`): as instruções da nota leem também o DANFE NFC-e (a espécie, o dia da emissão,
  a forma de pagamento e o desconto); a chave do modelo 65 entra pela leitura da nota (`lerChaveDaNfe(…, ['55','65'])`) e
  decide a espécie; a conferência desconta o desconto do total. A primeira leitura da foto só cita o cupom com a chave
  ligada (`instrucoesDoDocumento(cupomNaInstalacao())`).
- **"Como deseja lançar?"** (botões `doc:cl:<id>:d|e|n`, só o presidente, o toque repetido não muda nada): "Só despesa" →
  o resumo e "Lançar" — a conta entra JÁ PAGA (`financeiro.pagar` com a forma do cupom e o dia dele), sem estoque, com o
  "Desfazer" (estorno e cancelamento) na conversa e na tela; "Estoque e despesa" → os itens pelo caminho da nota (a
  memória pelo CNPJ do emitente), a entrada sem a conta pela soma (`semConta`) e a conta paga — a entrada não se desfaz
  pela conversa (V6-8); "Não lançar" → recusado. A categoria da despesa pela memória do emitente (a da última conta do mesmo
  CNPJ); sem memória, "compras" ou "fornecedor". A baixa que falhar depois da conta criada não volta a "confirmar" (o
  "Lançar" de novo criaria outra conta).
- **ERR-544** (achado no teste): a unidade impressa ("UN", "PCT") passa pelos apelidos do estoque antes da conversão — a
  nota do fornecedor perguntava "1 UN tem quantos unidade?".
- **Tela de Documentos:** "Cupom" no nome, o que foi feito ("a despesa já paga…"), os motivos novos e o texto do desfazer
  do cupom.

**M6g implementada (20/11/2026; mig 475 SÓ NUVEM — `mister_lista_compra`):**
- **Quem pode:** presidente ou gerente com "criar" no Estoque (a MESMA permissão da tela de Pedidos), na loja dele; a
  lista do presidente numa empresa de várias lojas sai da rede (como a tela em "todas").
- **Por onde entra:** a ferramenta `lista_de_compras` — "montar" (as linhas que a pessoa disse, por texto, áudio ou a foto
  de uma lista que o Graph leu) e "do_minimo" (`ComprasService.sugerir`) —, e a PLANILHA (xlsx/csv) que a entrada passa
  direto à lista (`registrarPlanilha`; o `lerTabela` do estoque, sem IA; cabeçalho nas 5 primeiras linhas, ou produto e
  quantidade nas duas primeiras colunas).
- **Cada linha** vai a um insumo pelo achador do relatório por insumo (`acharInsumo`); a dúvida vira botão — "É o X?",
  "Cadastrar novo" (pelo `EstoqueService.createItem`), "Deixar de fora"; a unidade que não chega à do estoque pergunta o
  fator (por texto, `registrarTextoDaLista`); a marca quando o insumo tem duas ou mais (botões, ou o nome escrito); o
  fornecedor quando os insumos têm fornecedores diferentes (um só: ele; nenhum: sem). Uma coisa por vez, na ordem.
- **"Criar o pedido"** pela passagem condicional "confirmar" → "criada" (dois toques juntos criam um só) e o MESMO
  `ComprasService.createLista` da tela (a marca e a loja conferidas por ele); falhou, volta a "confirmar" com o motivo.
  Uma lista aberta por pessoa (a nova descarta a anterior); a pela metade vence em 24 h.
- **O agente** ganhou o campo `mensagens` no resultado das ferramentas: a primeira pergunta da lista sai DEPOIS da resposta
  (como a proposta). `ComprasModule` exporta o serviço; o módulo do agente o importa (V81).
- Instruções: o bloco "A LISTA DE COMPRAS" — rodar a avaliação.
- Fica para depois: "Mandar ao fornecedor" pela conversa (hoje a frase manda abrir o pedido em Estoque › Pedidos).

**M6i implementada (20/11/2026; SEM migration):**
- **O "refazer"** (`grafico/refazer-do-grafico.ts`, puro, e a ferramenta `refazer_grafico`): o último gráfico de cada pessoa
  fica guardado 30 minutos (na memória do processo — a API roda num processo só; num reinício, o Mister pede para pedir o
  gráfico de novo) e a IA muda SÓ a apresentação: a forma (colunas, linha, barras deitadas, tabela — a série aceita as
  quatro; o ranking e a participação, não a linha), o título com a mensagem principal (número que o gráfico não mostra é
  recusado), o destaque (a posição na ordem que fica), a ordem (pelo maior, até 7 — "didático, simples e sofisticado") e
  os valores escritos. A consulta não roda de novo; os números são os mesmos.
- **As formas novas no desenho** (`imagem-do-plano.ts`): a TABELA (a linha do destaque com o fundo claro, "e mais N" quando
  não cabe) e a LINHA (os pontos ligados por segmentos, o período anterior em cinza, o destaque em dourado); o destaque
  escolhido vale também nas colunas e nas barras deitadas; "sem valores" tira os números de cima.
- Instruções: o bloco "REFAZER O GRÁFICO" — rodar a avaliação.
- Divergência do plano: a rosca e os cartões de números ficaram de fora (a participação e o número grande do cabeçalho já
  cobrem o mesmo); a IA escolhe a apresentação pela ferramenta, sem um "plano" livre.

**M6f, parte 1 implementada (20/11/2026; SEM migration) — a tela Mister › Regras:**
- A parte "Regras" no modelo de lista do Estoque (`components/mister/regras.tsx`): a contagem, as situações (ativas,
  pausadas), a busca, a pessoa (só o presidente), cada regra com o que faz, o que olha, de quem é e o último aviso; "Ver"
  em gaveta, "Pausar"/"Retomar" e "Apagar" (com a confirmação que diz que os avisos substituídos voltam). O gerente passa a
  ter as partes "Pessoas" e "Regras".
- As rotas `GET /mister/regras`, `POST /mister/regras/:id/pausar|retomar` e `DELETE /mister/regras/:id`
  (`MisterRegrasController`, só nuvem, módulo ligado): a régua da conversa (V6-5 — o presidente vê e mexe nas de todos, o
  gerente só nas dele), a auditoria com a origem "web"; a regra crua (o JSON) nunca vai à tela.
- **Divergência do protótipo:** a gaveta não edita os campos (fonte, filtro, condição) em texto livre — a regra é montada
  pelo Mister com os dados que lê e conferida pelo código; a gaveta mostra o que ela faz e diz para pedir a mudança na
  conversa ("muda para 25 minutos"), que propõe a nova e só troca com o "Confirmar".
- Fica para a parte 2: os formatos de cada pessoa, os padrões da noite (a impressora desligada antes do fechamento, os
  avisos que ninguém responde, os atrasos na mesma faixa) e as sugestões com "Não, deixa assim" (1 migration).

**M6f, parte 2 implementada (20/11/2026; mig 478 SÓ NUVEM — `mister_padrao`; nasce DESLIGADA, `MISTER_PADROES=1` no
`regem-api`) — os padrões e as sugestões:**
- **Pelo código e sem IA** (`mister-padroes.ts`, as regras puras; `mister-padroes.service.ts`, a volta e os botões): uma
  volta por hora, das 9h às 20h de São Paulo, com o que aconteceu ATÉ ONTEM. Três padrões:
  - **a impressora desligada antes do fechamento** — os incidentes `impressora_parada` do vigia × o horário do cardápio da
    loja: a parada que começou dentro do horário e não voltou até fechar, em 3 ou mais dos últimos 14 dias (cada parada
    conta uma vez, no dia em que a loja abriu — o horário que vira a noite não conta dobrado; a faixa sai na ordem do
    expediente). Sem horário cadastrado não há padrão. Botões: "Escrever o recado" (só a quem abre o Mural & clima; o
    rascunho do mural com "Publicar", o mesmo da M3g), "Avisar na hora" e "Não, deixa assim";
  - **os avisos de pedido parado sem resposta** — ontem chegaram 10 ou mais ao WhatsApp da pessoa (o final do telefone
    gravado na trilha, só quando é único na empresa) e ela não mandou nenhuma mensagem ao Mister depois do primeiro. A
    sugestão: "só avise quando forem 3 ou mais ao mesmo tempo, numa mensagem só" — a regra junta e SUBSTITUI o aviso;
  - **os atrasos na mesma faixa** — os pedidos que levaram mais que o tempo do pedido parado do aceite até ficar pronto
    (sem o agendado): a hora que teve 2 ou mais em 3 ou mais dos últimos 14 dias; a faixa de até 3 horas seguidas com mais
    dias. A sugestão: nessa faixa, avisar na hora o pedido aceito que passar do tempo sem ficar pronto.
- **A sugestão** vai uma vez por padrão e por pessoa; "Não, deixa assim" (e a que ficou sem resposta) cala por 30 dias
  (decisão V6-12). UMA sugestão por pessoa por dia. Só vai a quem poderia aceitar (a regra passa pela mesma conferência da
  conversa: o gerente sem o Delivery no perfil não recebe a dos pedidos) e a quem já não tem regra que cobre.
- **"Avisar na hora" / "Quero"** propõe a regra pelo MESMO caminho da conversa (o teto, a conferência e o "Confirmar"): o
  Mister nunca muda uma regra sozinho. O "Não, deixa assim" vai à auditoria.
- **Divergências do plano e do protótipo:**
  - a sugestão só sai DENTRO da janela de 24 horas da Meta (texto com botões, sem custo — a regra do custo mínimo); fora
    dela espera a pessoa voltar a falar com o Mister (por isso a volta é de hora em hora, não só às 9h). Pela conexão por QR
    Code (Evolution) não há botões e a sugestão não sai;
  - "não abriu nenhum" virou "**não respondeu a nenhum**": o Regem não guarda a confirmação de leitura da Meta;
  - a "tarefa de fechamento" do plano ficou de fora (o protótipo aprovado traz o recado e o aviso na hora);
  - **os formatos de cada pessoa** ("sempre em lista", "sem centavos", "responda em áudio") seguem na memória de cada pessoa
    (M4b, `mister_memoria`), que o Mister já lê em toda conversa — não viraram outra tabela.

**M6j, lote 1 implementado (20/11/2026; SEM migration) — a porta `propor_acao` e as ações do Delivery:**
- **Uma porta só para as ações** (`mister-acoes.ts`, o catálogo e as conferências; `MisterAcoesService`, a ferramenta e a
  execução): `pausar_canal` e `reabrir_canal` (cardápio digital, iFood, 99 — o motivo e os tempos da tela: 15/30/60 min ou
  "até HH:MM" no cardápio e no iFood; 10/20/30 min ou o fim do dia na 99), `aceitar_pedido`, `pedido_pronto` e
  `despachar_pedido` (o pedido pelo número do painel, nas lojas da pessoa, nas últimas 24 horas, na situação que serve).
- **O tamanho do risco: botão de QUEM pediu** — o presidente ou o gerente com o Delivery no perfil (a mesma permissão da
  rota da tela). A proposta é a das F4.x (`mister_proposta`, o procedimento = a ação, com quem pediu nos parâmetros); só o
  "Autorizar" dessa pessoa executa (o de outra recebe "não está mais disponível"; o id montado à mão não passa). A sessão
  com PIN (M6d) vale também aqui.
- **Pelo MESMO serviço da tela**: `PausaDoCanalService.pausar`/`reabrir` (a auditoria `pausou_canal` com a pessoa),
  `DeliveryService.aceitar`/`avancar`/`despachar`. A permissão é conferida DE NOVO na hora de executar (o perfil pode ter
  mudado). O "feito" só sai com o efeito conferido no banco (a pausa que vale agora, a situação do pedido); senão, "não
  deu" dizendo como ficou.
- A auditoria das propostas passou a gravar o perfil de quem autorizou (era sempre "presidente").
- **Fora deste lote** (os lotes seguintes, um PR cada): pausar produto; tarefas; preço por canal e horário da loja (de PIN);
  pagar conta (de PIN); estoque; as consultas de escala e ponto; os números dos clientes.
- As instruções mudaram (a frase "você só consulta" e a regra nova "Fazer pelo WhatsApp"): rodar a avaliação.

**M6j, lote 2 (20/11/2026; SEM migration) — a tarefa do dia e a pausa do produto:**
- `concluir_tarefa` — uma tarefa de HOJE (o dia da loja, V46) pelo título, nas lojas da pessoa: feita, parcial ou não feita
  (esta pede o motivo, a regra da tela). Pelo MESMO `TarefaInstanciaService.concluir` da tela, com a MESMA auditoria do
  controller (`concluiu_tarefa`, origem WhatsApp). A permissão é a da rota (Tarefas, `meu_dia`). Se a empresa exige a foto
  de comprovação para aquela situação, a recusa sai já na pergunta ("marque pelo app ou pela tela, com a foto") — o
  WhatsApp não leva a foto por este caminho. A mesma situação de novo é recusada.
- `pausar_produto` e `reativar_produto` — o produto do cardápio pelo nome; sem canal dito, nos canais em que ele está (o
  Regem — balcão e cardápio digital —, o iFood se ele está no iFood, a 99 se está na 99: o "Pausar em todos" da Gestão do
  catálogo); com canal, só ele. Pela MESMA `ProdutoService.pausaDoCanal` da tela (que audita), um canal por vez; a
  conferência olha o balcão E o cardápio no Regem e a lista dos pausados nos apps. A permissão é a da rota (Loja).
- O "criar tarefa" (duas etapas na tela: a definição e a do dia, com a função por nome) fica para o lote seguinte.
- Junto, num PR à parte (#1227): o "hoje" das telas no fuso da loja (ERR-551) — o levantamento das tarefas mostrou que a
  tela Tarefas usava o dia em UTC e, depois das 21h, mostrava as tarefas de amanhã.
- As instruções mudaram (a regra "Fazer pelo WhatsApp" com as ações novas): rodar a avaliação.

**M6j, lote 3 (20/11/2026; SEM migration) — criar a tarefa de hoje:**
- `criar_tarefa` — título, a função de quem faz (pelo nome, como no cadastro das funções: a tela exige), e, se a pessoa
  disser, o horário (HH:MM) e o responsável (pelo nome, entre os colaboradores ativos da loja). As DUAS etapas do "Nova
  tarefa" da tela: `TarefaDefService.create` (com quem criou — o nível que trava editar e excluir depois) e
  `TarefaInstanciaService.instanciar` para hoje (o responsável dito; senão o escalado ou em aberto). A permissão é a das
  rotas (Checklist & registros). A conferência é a tarefa na lista de hoje.
- A `propor_acao` passou a receber `loja` (como as consultas): a ação de uma loja (criar tarefa, pausar o cardápio) na
  empresa de várias lojas diz qual.
- Ficam para os próximos lotes: preço por canal e horário da loja (de PIN), pagar conta (de PIN), estoque (movimento e
  contagem), as consultas de escala e ponto e os números dos clientes.

**M6j, lote 4 (21/11/2026; SEM migration) — consultar as contas a pagar e a receber:**
- `contas_a_pagar_e_receber` (só leitura; a permissão `financeiro` e o filtro de loja das rotas de `financeiro/titulos`):
  as abertas em faixas que não se cruzam (vencidas, hoje, 7 dias, resto do mês, depois, sem data), mais `ateOFimDoMes`
  (vencidas + as do mês, para "quanto devo neste mês" sair sem conta da IA), e as 12 próximas a pagar. O dia é o da loja.
- A conta **a receber vai só em totais**: a descrição dela pode trazer o nome de um cliente, e dado de cliente não vai à
  IA. Quem não vê valores recebe só as quantidades. A busca filtra só as contas a pagar.
- Avaliação: a **c33** ("quanto devo aos fornecedores neste mês") deixa de ser "não tenho acesso" e passa a usar a consulta;
  a **c50** nova cobre quem não vê valores. São 50 perguntas: rodar a avaliação de novo depois do deploy.

**M6j, lote 5 (21/11/2026; SEM migration) — as faltas e as horas de um período:**
- `faltas_e_horas` (só leitura; a permissão de cada parte: `escalas` para as faltas, `ponto_gerencial` para as horas). Sem
  pessoa: quem faltou, justificadas e sem justificativa, e os dias (`EscalaService.faltas`, já com a loja em uso — o
  ERR-555 foi achado aqui). Com pessoa: as faltas dela e as horas pelo MESMO `PontoService.espelho` da tela (trabalhado,
  abonos, previsto, extra, noturno, saldo), como prévia gerencial. Para um dia só continua a `equipe_do_dia`.
- **O motivo da falta, a justificativa e o atestado não saem da consulta** (são dado de saúde ou da vida da pessoa), e ela
  entra em `FERRAMENTAS_DE_PESSOAS`: com a sessão com PIN pendente, espera o PIN.
- Avaliação: **c51** e **c52**, 52 perguntas.

**M6j, lote 6 (21/11/2026; SEM migration) — os clientes em números:**
- `clientes_em_numeros` (só leitura; a permissão `delivery` e o módulo `perfil_cliente` da rota): o total, os seis grupos
  com os nomes de Delivery › Clientes e quantos olharam e não pediram, pelo MESMO `PerfilClienteService.resumo` da tela.
  Vale para a empresa inteira, como a tela, e a resposta diz isso. **Nome, telefone e endereço não passam por aqui**;
  pedir QUEM é o cliente continua sendo "não sai pelo WhatsApp" (c34).
- Avaliação: **c53**, 53 perguntas. Ficam para os próximos lotes: estoque (movimento e contagem), preço por canal e horário
  da loja (de PIN), pagar conta (de PIN).

**Avaliação de 21/11, segunda rodada (depois dos lotes 4 a 6): 51 de 53, 24 consultas.** As duas erradas, corrigidas:
- **c05** (errava desde 18/11): a IA fazia a conta da diferença entre as semanas. Agora a consulta traz
  `diferencaDeVendas` e `diferencaDeFaturamento` (valor em centavos exatos e o sentido), e a instrução manda usar.
- **c29** (nova, do lote 4): a loja de teste dizia "2 vencidas, R$ 420" e listava só uma de R$ 420, e a IA tentou explicar a
  diferença com uma conta. A lista de teste passou a fechar com as faixas. Na consulta de verdade, com mais contas do que
  cabem na lista, a resposta agora avisa que a lista é parcial e que a soma vem dos totais de cada faixa.

**M6l, parte 1 (21/11/2026; SEM migration) — criar uma imagem pelo DMS Graph, a conversa 7 do protótipo:**
- A ação `criar_imagem` entra na porta `propor_acao`: a IA monta o pedido completo (objetivo, o que aparece, o texto exato,
  estilo, cores, proporção 1:1, 9:16 ou 16:9), o Mister mostra "Vou pedir assim", com "Gerar" e "Mudar" e o aviso de que usa
  1 da franquia. Só o "Gerar" de quem pediu chama o `GraphImagemService.criarImagem`, a imagem vai para a conversa e só
  então sai o "feito", com a franquia do mês. "Mudar" não gera nada e pergunta o que trocar.
- **Nasce desligada:** `MISTER_CRIAR_IMAGEM=1` no `regem-api`, e a empresa precisa ter `imagens.criar` no cartão do DMS Graph
  e franquia de imagem liberada (sem isso, a resposta é a frase do Graph). Ainda não saiu nenhuma imagem real.
- O código recusa pedido com telefone, e-mail, CPF ou CNPJ. "Número de relatório não vai à imagem" é instrução para a IA,
  porque a ferramenta não vê a fala da pessoa: a garantia é o pedido inteiro mostrado antes do "Gerar".
- A chave do Graph é a proposta, e o mesmo pedido repetido é a mesma proposta: não paga de novo. Permissão: a do Delivery
  (Marketing mora lá). O vídeo (`criar_video`) e editar foto pelo Mister ficam para quando o Graph tiver e o dono pedir.
- Avaliação: **c54**, 54 perguntas.

**M6j, lote 7 (21/11/2026; SEM migration) — lançar no estoque pelo WhatsApp:**
- `movimentar_estoque` na porta `propor_acao`, de botão: entrada, saída ou ajuste pelo saldo contado ("contei 12 kg"), pelo
  MESMO `EstoqueService.createMovimento` da tela (no ajuste, a diferença é feita por ele, no banco). A pergunta mostra o
  produto, a loja e o saldo antes e depois, e avisa se ficar negativo; o "feito" só sai com a linha gravada e o saldo relido.
- **A permissão é `estoque.editar`**, a da rota: as ações anteriores usam chaves simples, e `podeAcessar` numa chave CRUD olha
  só o `ver`. Sem o `temAPermissao`, quem só vê o estoque lançaria pelo Mister. O teste prova esse caso.
- **Unidade:** a pessoa diz "2 caixas" e o produto é em kg → recusa e pede em kg. O Mister não converte. Cada loja tem o
  próprio estoque: produto compartilhado sem loja definida, em empresa de várias lojas, pede a loja.
- Avaliação: **c55**, 55 perguntas. Ficam os lotes de PIN: preço por canal, horário da loja e pagar conta.

**Avaliação de 21/11, terceira rodada (depois dos lotes 4 a 7): 55 de 55, 24 consultas.** Liberou os lotes de PIN.

**M6j, lote 8 (21/11/2026; SEM migration) — mudar o preço por canal, com o PIN pelo link:**
- `mudar_preco` na porta `propor_acao`, a primeira ação de **PIN**: a mensagem vai com o link "Abrir no Regem", nunca com
  botões, e o preço muda pelo MESMO `ProdutoService.precoDoCanal` da Gestão do catálogo (que audita o "de → para" e põe o
  app na fila). O "feito" sai do que ficou gravado, canal a canal; um canal que recusa vira "não deu", dizendo o que ficou.
- **Quem autoriza:** quem pediu, com o PIN dele: o presidente ou o gerente com a Loja e "Ver valores em R$" (a regra da rota),
  conferidos ao propor e de novo ao executar.
- **Antes do PIN** a pessoa vê o preço de hoje e o novo em cada canal, e o aviso de salto (o dobro ou a metade), de promoção
  (o cardápio digital segue cobrando a promoção) e de produto da empresa (vale em todas as lojas). Com o PIN da sessão
  vencido, o preço de hoje não aparece.
- **Recusa na pergunta:** produto com variações (cada uma tem o próprio preço: fica na tela), canal desligado, canal em que o
  produto não está e preço igual. O canal nunca se supõe; "aumenta 10%" pede o preço final.
- **Um pedido por produto:** pedir outro preço troca a proposta e mata o link anterior. A autorização confere o resumo do
  código na própria gravação, para o PIN valer só para o que aquele link mostrou.
- Junto: a auditoria do link passa o perfil de quem autorizou (ERR-558).
- Avaliação: **c56**, 56 perguntas. Ficam os lotes de PIN: horário da loja e pagar conta.

**M6j, lote 9 (21/11/2026; SEM migration) — mudar o horário da semana da loja, com o PIN pelo link:**
- `mudar_horario` na porta `propor_acao`, de PIN: os dias da semana e a hora de abrir e de fechar, ou "fechado". Quem
  autoriza é quem pediu, com o PIN dele: o presidente ou o gerente com a Loja (a regra de `PUT /cardapio/config`).
- **Grava só os dias pedidos** (`common/horarios-da-loja.ts`), com a linha travada e relendo a lista na mesma transação. A
  tela regrava a configuração inteira; aqui, o que mudou ao lado no mesmo instante não se perde.
- **Duas armadilhas da regra do cardápio, recusadas:** a lista vazia quer dizer "sempre aberta" (gravar um dia só fecharia os
  outros seis) e a semana sem nenhum dia aberto quer dizer "sempre fechada". A recusa vale ao propor e de novo ao gravar.
- A escolha do cardápio é a MESMA da pausa (`lojaDoCardapio`). Com horário separado, pede se é o de entrega ou o de retirada.
- **Antes do PIN:** como cada dia está e como fica, o aviso de janela acima de 18 horas (o da tela), de "hoje é um dos dias", de
  cardápio da empresa (vale em todas as lojas) e que o horário do iFood e da 99 é o de lá (o Regem não o envia).
- **Só a semana:** "fechar só hoje" é a pausa do canal; a instrução manda perguntar quando a pessoa fala de um dia só.
- Avaliação: **c57**, 57 perguntas. Fica o último lote de PIN: pagar conta.

**M6j, lote 10 (21/11/2026; SEM migration) — marcar uma conta a pagar como paga, com o PIN pelo link. Fecha os lotes de PIN:**
- `pagar_conta` na porta `propor_acao`, pelo MESMO `FinanceiroService.pagar` da tela (uma vez só, pela troca condicional; lança
  a saída, cria a próxima recorrente e audita). Quem autoriza é quem pediu, com o PIN dele: o presidente ou o gerente com o
  Financeiro e "Ver valores em R$". Com o PIN da sessão vencido, espera o PIN: quem autoriza dinheiro vê o valor.
- **O Regem só registra a baixa.** A conversa e a página dizem, antes do PIN, que o pagamento no banco não sai daqui; a
  instrução proíbe dizer que pagou, transferiu ou fez Pix.
- **Uma conta só:** conta recorrente repete o nome, então o nome igual não decide. Com mais de uma, a pessoa escolhe pelo
  vencimento (DD/MM). Conta a receber, de outra empresa ou de outra loja não se acha; o curinga do ILIKE não vira "todas".
- **O valor que a pessoa viu:** valor dito diferente do da conta é recusado (valor diferente é pela tela). Se a conta mudar de
  valor ou for paga entre a pergunta e o PIN, nada é lançado. O "feito" só sai com a conta paga E a saída no caixa.
- A forma é obrigatória; a data é a de hoje ou a dita (até 60 dias para trás, nunca no futuro), fixa na proposta.
- Avaliação: **c58**, 58 perguntas. **Com este lote, os três lotes de PIN estão no ar** (preço, horário, pagar conta).

**Avaliação de regressão de 21/11 (rodada pelo dono depois da M6j lote 3): 45 de 48.** A c05 já errava antes (a diferença
entre as semanas, conta que nenhuma consulta trouxe). As duas novas, sem defeito do Mister: a **c32** ("Pausa o iFood para
mim agora") esperava o jeito antigo (explicar o caminho da tela) — desde a M6j ele pausa e, sem o motivo e o tempo,
pergunta (a resposta estava certa; o caso foi atualizado, e a **c49** nova cobre a pausa com o motivo e o tempo); a
**c48** (o gráfico) repetiu o total que a própria consulta escreveu em reais e o filtro de saída não lia valor em texto
(ERR-553: corrigido no `numerosDosResultados`; na loja de verdade era um falso "valor sem origem" na Segurança a cada
gráfico). A avaliação passa a 49 perguntas.

**M6b, peça A1.0 (21/11/2026; mig 484) — a ferramenta do teste, que SÓ OBSERVA:**
- O que a doc oficial da Meta confirma (página "Phone Numbers", lida em 21/11): o bloqueio (status `failed`, código 137000)
  vale para o envio com `recipient_identity_key_hash` DIFERENTE; a saída é reenviar SEM o hash. O Regem não manda o hash em
  envio nenhum. A doc não diz: quais ações mudam o hash, o que acontece com o envio sem hash depois da troca, e tem duas
  formas do corpo (`enable_identity_key_check` na página, `enabled` na referência de `/settings`). A leitura de `/settings`
  não devolve a situação do recurso, por isso quem ligou e quando ficam em `mister_numero`.
- Console › Mister › **Conferência do aparelho** (só Diretoria, com auditoria): liga e desliga o recurso na Meta (tenta as
  duas formas; passa à segunda só com HTTP 400; grava só depois de a Meta aceitar) e mostra os telefones vistos pelo FINAL,
  quando e se mudou. O hash não sai na API. Este bloco não está no protótipo: é a ferramenta do teste da A1.0.
- A entrada anota `contacts[].identity_key_hash` no vínculo (`mister-aparelho.ts`, `anotarAparelho`, uma instrução) e segue
  igual: nenhuma resposta depende disso. **O bloqueio com PIN (A1) só começa depois do teste do dono:** ligar, mandar
  mensagem, reinstalar o WhatsApp do celular de teste, mandar de novo e anotar se o hash mudou e se a resposta chegou.

**M6k, lote 1 (20/11/2026; SEM migration) — o guia "como faço" em mais 8 itens do menu, com imagem:**
- Eram 31 itens do menu sem assunto no guia (a conta sai do `shell.tsx` × os caminhos do `mister-guia-de-uso.ts`). O lote 1
  cobre 8: Dashboard (`painel-do-dia`), Tarefas › Tarefas (`criar-tarefa`), Mural & clima (`mural`), Delivery › Clientes
  (`clientes`), Delivery › Marketing (`campanha-whatsapp`), Financeiro › Contas a pagar (`conta-a-pagar`), Configurações ›
  Loja (`dados-da-loja`) e Configurações › Equipamentos (`equipamentos`). Faltam 23, nos lotes seguintes.
- Cada um com os passos e os nomes de botão copiados da tela (a spec do guia confere), e a imagem numerada feita pelo
  roteiro `roteiros/como-faco.mjs` com dados de exemplo (`GERAR_COMO_FACO=1`).
- Junto: o roteiro achou o React #418 (hidratação) no Mural e nas Contas a pagar — a categoria/permissão lida do token no
  primeiro desenho (ERR-547, reincidência do ERR-513); as duas leem agora num `useEffect`.

**M6k, lote 2 (20/11/2026; SEM migration) — mais 8:** PDV · Balcão › Retirada / Encomendas (`retirada-no-balcao`), PDV ·
Balcão › Mesas e comandas (`mesa-e-comanda`), Delivery › Avaliações (`avaliacoes`), Delivery › Encomendas · agenda
(`encomendas-agenda`), Tarefas › Meu ponto (`meu-ponto`), Checklist & registros (`checklist-pop`), Financeiro › Formas de
pagamento (`formas-de-pagamento`) e Configurações › Unidades (`unidades`). 16 dos 31; faltam 15. As leituras do token no
corpo do componente achadas nessas telas (o painel do caixa, os cartões de checklist e de documento, Unidades) não mudam o
primeiro desenho hoje (aparecem só depois da leitura dos dados) — o roteiro confere o #418 nelas a cada rodada.

**M6k, lote 3 (20/11/2026; SEM migration) — mais 8:** Delivery › Mapa ao vivo (`mapa-ao-vivo`), Delivery › Pedidos ·
produção (`pedidos-producao`), Tarefas › Pedidos de produção (`ordem-de-producao`), Tarefas › Pedidos de manutenção
(`pedido-de-manutencao`), Ponto de baixa (QR) (`ponto-de-baixa`), Financeiro › TEF / maquininha (`tef-maquininha`), Pessoas
› Gerenciamento de ponto (`espelho-de-ponto`) e Pessoas › Candidatos (`candidatos`). 24 dos 31; faltam 7 (Alertas do KDS,
Direcionamento do catálogo, Config. por ramo, Planos & assinatura, Servidor local, Relatórios › Atendimento e Visão C&O). O
roteiro passou a simular os azulejos do mapa (sem depender do OpenStreetMap) e a dar o endereço às respostas montadas na
hora (as ordens de produção leem a lista duas vezes, abertas e encerradas). A tela de manutenção lê a categoria no corpo do
componente, mas a lista começa em "Carregando…" (o primeiro desenho é igual): o roteiro confere o #418 a cada rodada.

**M6k, lote 4 (20/11/2026; SEM migration) — os 7 últimos; M6k COMPLETA:** Configurações › Alertas do KDS
(`alertas-do-kds`), Direcionamento do catálogo (`direcionamento-do-catalogo`), Config. por ramo (`config-por-ramo`), Planos &
assinatura (`planos-e-assinatura`), Servidor local (`servidor-local`), Relatórios › Atendimento (`numeros-do-atendimento`)
e Visão C&O (`visao-co`). **Os 54 itens do menu têm assunto no guia, todos com imagem.**
- Na imagem dos planos, o preço e os módulos de exemplo saem BORRADOS: a imagem vai a clientes de verdade, e um preço
  inventado engana (o de verdade está na tela e muda com o tempo).
- Junto: a Visão C&O dizia "Nenhuma unidade cadastrada." enquanto ainda carregava (ERR-550, V37) — agora "Carregando as
  unidades…", "Não consegui ler as unidades." com erro, e "Nenhuma" só com a resposta lida e vazia.
- Fica para depois: o "quer que eu faça?" do plano (o Mister oferecer a ação depois do "como faço") — entra com os lotes
  seguintes da M6j, assunto por assunto, quando a ação existir pela porta `propor_acao`.

**M6d implementada (20/11/2026; mig 476 SÓ NUVEM — `mister_conversa_config.pin_a_cada_h` e `mister_vinculo.pin_ate`;
nasce desligada):**
- **O ajuste** (Mister › Regras › "Segurança · só o presidente muda", pelo `PATCH /mister/conversa`): pedir o PIN a cada
  6, 12 ou 24 horas, ou desligado (o padrão). A linha "Desligar quem fica 60 dias sem conversa · sempre ligado" (M6a) vai
  junto; a do "Aparelho trocado pede o PIN" entra com a M6b.
- **A guarda** (`mister-sessao.ts`, uma leitura das duas tabelas; sem a migration, não exige): no escopo da CONVERSA (a tela
  entrou com a senha e não pede), com o ajuste ligado e o PIN vencido, os valores em reais saem escondidos (`verValores`
  falso), os dados de pessoas (`equipe_do_dia`) são recusados e a IA é avisada no bloco da conversa; o link para confirmar
  sai DEPOIS da resposta, uma vez por link que vale.
- **O PIN pelo mesmo link da F4.2a** (o procedimento `abrir_sessao`, de PIN, 15 minutos, uma proposta por pessoa renovada
  quando acaba): o PIN certo de QUEM pediu grava `pin_ate` pelas horas da empresa — o gerente também abre a dele (a
  leitura do link e a conferência do PIN aceitam o gerente só neste procedimento).
- **As ações de botão** esperam o PIN: com a sessão vencida, o "Autorizar" de uma proposta de botão responde que falta o
  PIN, manda o link da sessão e deixa a proposta pendente (no prazo dela).
- Junto: o teste do PIN na auditoria da F4.2a deixou de cair ao acaso (ERR-545 — o UUID aleatório continha "0000").
- O bloco da conversa (as instruções) mudou: rodar a avaliação.

#### 8. Custos

| Parte | Como começa | Se ligar ou usar |
|---|---|---|
| Regras, padrões e a avaliação deles | código, sem IA | — |
| Entender a regra ou a ordem | a IA da empresa (Haiku), 1 a 2 chamadas por regra criada | ~US$ 0,001 a 0,002 por regra (pela medida de 13/11) |
| Cupom e lista por foto | a IA dos documentos (Sonnet 5.5, chave da empresa); a lista por foto também pelo Graph (franquia de 500 por mês, a mesma do atendente) | centavos por cupom, como os boletos de hoje |
| Planilha | leitor próprio, sem IA para ler; IA só para casar nomes difíceis | — |
| Identidade do aparelho | recurso do número, sem custo na Meta | — |
| Avisos das regras fora das 24 h | o modelo da Meta já aprovado (`mister_aviso`) | o preço da mensagem de utilidade da Meta (em WhatsApp › Uso e gasto). Agrupar reduz o número de mensagens de hoje |
| Imagem e vídeo gerados | desligado | depende do plano do Graph (chave Google da DMS); preço medido antes de ligar |

**Começo: nada a mais que hoje.** As IAs são as que a empresa já usa.

#### 9. Decisões do dono (a recomendada primeiro)

1. **V6-1 · Aparelho trocado:** bloquear os dados até o PIN (recomendado) × só avisar o presidente.
2. **V6-2 · Conexão por QR Code (sem o hash):** a sessão com PIN fica obrigatória para valores (recomendado) × aceitar o
   risco como hoje.
3. **V6-3 · Vencimento do vínculo:** 60 dias (recomendado) × 30 × 90.
4. **V6-4 · Sessão com PIN:** nasce desligada, a cada 12 h (recomendado, como aprovado) × nasce ligada.
5. **V6-5 · Quem vê as regras:** o presidente vê e apaga as de todos, o gerente só as dele (recomendado) × cada um só as
   suas.
6. **V6-6 · Calar o aviso da empresa:** a regra pessoal tira da própria pessoa o aviso pelo WhatsApp, menos os críticos
   (servidor sem sinal com pedido esperando, certificado, chave de IA parada), que podem ser agrupados mas não calados
   (recomendado) × tudo pode ser calado.
7. **V6-7 · Teto:** 30 regras por pessoa (recomendado).
8. **V6-8 · Cupom:** "Só despesa", "Estoque e despesa" e "Não lançar"; a entrada no estoque não se desfaz pela conversa,
   como na nota (recomendado).
9. **V6-9 · Ações:** os três níveis de confirmação e a lista do "nunca pelo Mister" (recomendado).
10. **V6-10 · Gráficos:** o código desenha e a IA escolhe a apresentação (recomendado) × a IA desenha pelo ambiente de
    código do provedor (cobrado por uso, sem a garantia do número exato).
11. **V6-11 · Imagem e vídeo:** pelo Graph quando o plano dele for aprovado, nascendo desligados (recomendado).
12. **V6-12 · Padrões:** avisar uma vez por padrão; "Não, deixa assim" cala por 30 dias (recomendado).

#### 10. Riscos e o que se confere antes

- **A identidade da Meta** tem comportamento que a doc não fecha: a A1.0 confere antes de qualquer código.
- **Tarefas** não têm número nem recorrência automática: a regra só enxerga as tarefas que existem no dia. Criar sozinho
  as tarefas recorrentes é outra entrega, fora deste plano (levar ao dono).
- **Balcão e mesa** não têm aceite nem pronto: as regras de tempo valem para os pedidos dos canais e para o KDS.
- **Conta a pagar sem hora:** a hora da regra vem da pessoa.
- **A Meta aceita 3 botões por mensagem:** escolha maior vira lista numerada.
- **A M6c** mexe na autenticação (a guarda, o tempo real e o servidor da loja): V97 e `.zip`.

**Como foi levantado (20/11):** quatro varreduras de leitura na `origin/main` (módulos × Mister; avisos, tempos, tarefas
e boletos; documentos, compras e cupom; DMS Graph, gráficos e modelos), conferência manual dos pontos que sustentam o
plano e a doc oficial da Meta ("User identity changes" e "Phone Numbers"). Nada foi executado.

## 5. O que depende do dono

1. ~~Onde a IA roda~~ — decidido: nuvem.
2. ~~Número do Mister no WhatsApp~~ — decidido: um número próprio, da distribuição, para todas as lojas.
3. Quem paga a IA: decide-se ao fim, com o gasto medido (ver as decisões de 12/11 acima).
4. ~~Canal dos avisos da F1 para a loja~~ — decidido em 14/11: depende do tipo; tabela na F1.2.
5. ~~Regra do horário para `servidor_sem_sinal`~~ — decidido: só com pedido esperando.
6. ~~Mockup do módulo~~ — aprovado em 13/11. Faltam os mockups da F1.4.
7. ~~Releitura dos documentos e imagens no grafo de engenharia~~ — feita em 12/11.
8. O perfil de permissões por hierarquia (o que cada gerente pode pelo Mister): fim do projeto.
9. **Pendência de implementação para o fim (pedido do dono em 13/11/2026):** a opção de conectar o número do Mister pela conexão gratuita do Evolution, além da API oficial da Meta. O argumento: o Mister só fala com quem ligou o próprio telefone, então o risco de denúncia do número é baixo. O Regem já fala com o Evolution no WhatsApp das lojas; o que falta é o número do Mister ganhar uma porta de provedor (oficial ou Evolution), escolhida pela distribuição no console. Protótipo `mockups/regem-mister-qr.html` aprovado em 15/11/2026 (fases Q1–Q3).
   - **Q1 implementada (16/11/2026, mig 436): a porta do provedor.** Três colunas na `mister_numero` (`provedor` oficial |
     evolution, `instancia`, `instancia_numero` — o número do celular do QR, que as pessoas salvam e que a Q3 anuncia). O
     `MisterNumeroService.enviar` fala por UMA forma: no Evolution, `POST /message/sendText/<instância>` com `{number,
     text}` no Evolution da distribuição (`EVOLUTION_API_URL`/`EVOLUTION_API_KEY`, o mesmo das lojas, instância separada);
     os botões viram a lista numerada e o link vai escrito; ritmo de 20 por minuto em fila (por réplica); o modelo recusa
     (no Evolution não há janela nem modelo — os avisos e os resumos conferem `semJanela()` e mandam o texto); o
     "digitando" fica de fora. A entrada do Evolution (a porta assinada das lojas) entrega a instância do Mister a
     `MisterEntradaService.receberDoEvolution` ANTES de procurar a loja; o eco (`fromMe`) nunca vira pergunta; "1" e "2"
     viram o toque na última autorização de botão aberta do telefone (a pergunta "de qual empresa?" de pé tem a vez). O
     "disponível" e o número que se salva passam por uma regra só (`numeroDisponivel`, `numeroEmUso`). Nasce na API
     oficial: nada muda até a Diretoria trocar (Q2). O provedor é lido pelo `to_jsonb`: sem as colunas, o número segue na
     API oficial.
   - **Q2 e Q3 implementadas (16/11/2026, mig 437): o console e o número novo.** ⚠️ Divergência do protótipo: a Q2 previa
     "sem migration", mas o estado da conexão por QR ganhou colunas PRÓPRIAS na `mister_numero` (`instancia_situacao` sem |
     conectando | conectado | caiu | bloqueado, `instancia_motivo`, `instancia_situacao_em`, `instancia_conectada_em`, o
     aceite em `aceite_por`/`aceite_em`/`aceite_versao` e `numero_anunciado`) — reusar `situacao`/`motivo`/`numero` da API
     oficial apagaria o que ela sabe na volta. `MisterQrService` (só Diretoria, só nuvem; rotas `POST
     distribuicao/mister/qr/aceite|gerar|conferir|trocar|desconectar`, cada uma na auditoria do console): o aceite do texto
     de agora (versão `v1`) antes do 1º QR; a instância `regem-mister-<8 hex>` no Evolution da distribuição, com o webhook
     sempre na porta assinada do Regem (`MESSAGES_UPSERT` e `CONNECTION_UPDATE`); a tela confere a cada 3 s e troca o QR a
     cada 20 s (`renovar`: só o QR, fora da auditoria), até 6 trocas. ⚠️ Segunda divergência (mais segura): no protótipo a
     forma mudava no clique; aqui ela vira o QR quando o celular CONECTA — até lá a API oficial segue falando, sem buraco.
     Com o celular conectado e a oficial em uso, "Trocar para a conexão por QR Code" é direto; a volta para a oficial pede o
     número oficial conectado. O aviso de conexão do Evolution (`connection.update`) vem pela mesma porta: aberta =
     conectado (o número pelo `wuid` ou pelo dono da instância); fechada 403 = bloqueado; 401 = "o celular saiu"; outra =
     caiu; o QR que vence sem ninguém ler volta a "não conectado". O envio pelo Evolution só com o celular conectado (caiu,
     bloqueado ou o QR na tela: nada sai pelo WhatsApp; os avisos seguem no Regem). "Conectar outro número" (depois de
     bloqueado) sai da instância antiga e abre uma nova. **Q3:** ao conectar um número que ainda não foi anunciado, a
     gravação condicional em `numero_anunciado` escolhe quem manda, e "este é o novo número do Mister" sai pelo número novo,
     no ritmo do envio, a cada telefone ligado (sem quem pediu PARAR AVISOS), uma vez; reconectar o mesmo celular não
     anuncia de novo. Na API oficial o anúncio pelo modelo "Número novo do Mister" fica para quando a volta for pelo número
     oficial NOVO (hoje o número oficial é um só). Fora do protótipo, sem dado: "Mensagens que saíram hoje".
10. **Aprovar o protótipo `mockups/regem-dependencias-e-qualidade.html` (#992).** As partes foram feitas com as recomendadas enquanto o dono estava fora: a faixa sem nuvem (#993), a Qualidade parte 1 (#994), as Dependências parte 2 (F3.7, #996, com a migration 423 aplicada pelo clique dele em 15/11), o que falta (F5.2) e a avaliação de regressão (F5.3, que espera a **migration 424** pelo clique dele antes do merge; a loja de teste ficou no código, e não no banco).

## 6. Como foi levantado

Três varreduras de leitura no checkout limpo de `origin/main` `7b7a573f`, por área (saúde e comandos; sinais de operação e vencimentos; canal, acesso e sync), com conferência manual dos pontos que sustentam o plano. Limites: nada foi executado; hardware, conta Meta, provedores de pagamento e homologação fiscal não foram testados; onde a documentação e o código divergiam, valeu o código.

## Versão 7 — conversa natural, BI, financeiro e voz (aprovada em 22/11/2026)

Pedido do dono: a conversa "como num chat de uma renomada IA", que planeja, cria, edita, apresenta, confirma e aplica; análise de
vendas, picos, perdas, desperdício e cancelamentos; KPIs financeiros; reconciliação e idempotência; e, no áudio, responder no tom de
quem fala, "até risada se a ocasião assim se apresentar". Protótipo: `mockups/regem-mister-v7.html`.

**Etapas:**

| Etapa | O que entrega | Situação |
|---|---|---|
| V7a · Números únicos | O Mister usa a conta do Painel (`vendasOficiais`); a medida do atraso do Anota Aí | no ar (#1259, ERR-564) |
| V7b · Dinheiro sem duplicar | Pagar o entregador, conta recorrente e resultado do pinpad | mesclado (#1260, #1261, ERR-565, ERR-566) |
| V7c · Conversa natural | Plano em uma frase, ajuste na conversa, várias tarefas, conferir antes de dizer "pronto" | entregue (ERR-569); falta a avaliação com a IA real (63 casos) |
| V7e · BI | Semana, pico e itens do pico, fases do mês, perdas e cancelamentos, padrões | no ar (#1266, migs 490 e 491 aplicadas); avaliação real de 22/11: 76 de 78, c66 e c70 corrigidos (ERR-574), falta repetir |
| V7f · KPIs financeiros | Margem, CMV, inadimplência, prazo; saldo, folha e custo informados na conversa | no ar (#1267, mig 492 aplicada, ERR-572) |
| V7d · Voz | A voz com tom e a risada, pelo DMS Graph, nascendo desligada | no ar (#1268, mig 493 aplicada; Graph #15, 0.12.0, implantado em 22/11); falta o teste real da voz |

**As dez decisões (todas na recomendada):**

- V7-1: mostra o plano em uma frase e aplica depois do botão, em tudo o que muda algo.
- V7-2: um botão para o plano inteiro, e o PIN só nos passos que já pedem PIN.
- V7-3: quando um passo falha, diz o que entrou e o que não entrou e oferece tentar de novo.
- V7-4: risada só com a pessoa animada ou brincando, nunca em prejuízo, reclamação, cliente ou funcionário.
- V7-5: o tom de quem fala serve só para responder aquela mensagem: não fica guardado nem vira relatório.
- V7-6: "Voz com emoção" nasce desligada; o presidente liga, com o preço ao lado.
- V7-7: "Análises mais profundas" usa o modelo maior só nas análises e nasce desligada.
- V7-8: as sugestões vêm separadas dos números, e o Mister nunca as aplica sozinho.
- V7-9: o saldo do banco é informado na conversa, com a data; só o presidente vê; ele pede de novo a cada 7 dias.
- V7-10: indicador sem dado mostra o que falta e pede; nunca estima pela média do setor.

**O que pesa na loja real (medido em 22/11):** as fichas cobrem 71,4% da venda dos últimos 30 dias; há 1 conta a pagar e nenhuma a
receber lançadas, então inadimplência e prazo de pagamento ficam sem número até a loja lançar.

**Como a V7c ficou (22/11):**

- O plano tem de 2 a 5 passos, numa loja só. Cada passo passa pela mesma conferência e execução da ação sozinha, e o passo de preço,
  horário ou conta continua pedindo o PIN pelo link.
- Se o PIN de um passo vence ou é recusado, o plano para ali. "Tentar de novo" vale por 30 minutos.
- "Tentar de novo" não refaz o que pode já ter entrado: passo sem confirmação, lançamento de estoque e tarefa criada. O Mister manda
  conferir no Regem, para não lançar em dobro.
- Se o nome de um passo passar a apontar para outro item depois da pergunta, o passo não acontece.
- O dia da conferência de uma regra começa às 06:00, e a noite que passa da meia-noite conta como um dia só.
- Diferenças do protótipo: o botão da regra continua "Confirmar", recado no mural e imagem não entram no plano, e a sugestão na
  reclamação vem em texto, sem botões.

**Como a V7e ficou (22/11):**

- A ferramenta `analisar_vendas` tem quatro focos: semana, pico, fases do mês e perdas. A venda vem das mesmas linhas da conta oficial.
- O dia do pico vai das 06:00 às 05:59, e a faixa é definida por pedidos, para dar a mesma resposta a quem não vê valores.
- O motivo de cancelamento é texto livre e traz nome de funcionário: ele é classificado no servidor e só a causa vai à IA. Pedido de
  teste fica fora do total, e "cancelado pelo canal" conta como sem motivo informado.
- Sem desperdício ou contagem lançados, o Mister diz o que falta lançar, nunca "R$ 0 de perda".
- "Análises mais profundas" nasce desligada. Ligada, só a resposta depois de uma análise com dados usa o Sonnet 5.5; se ele falhar, o
  modelo de sempre responde. Custo estimado: de US$ 0,001 para US$ 0,01 a 0,08 por análise (o protótipo dizia até US$ 0,02, que só
  vale com o cache quente).
- O padrão do descarte (3 das últimas 5 semanas, no mesmo dia) depende da mig 491 e de `MISTER_PADROES=1`. Sem a 491, ele não é
  procurado e os outros padrões seguem.
- Diferenças do protótipo: sem o botão "Preparar o pedido" e sem "comprado × usado", porque o Regem não sabe quanto do item se usa até
  aquele dia; os gráficos das análises saem sem os botões de PDF e link.

**Como a V7f ficou (22/11):**

- A ferramenta `indicadores_financeiros` tem sete focos: margem e CMV, inadimplência, prazo de pagamento, caixa, margem líquida, giro
  de recebíveis e ROI de campanha. As definições estão em `docs/logica-negocio.md` § 2.6.
- **A loja real não tem custo cadastrado (0 de 527 ingredientes, 0 de 168 insumos):** margem, CMV e ROI respondem o que falta e onde
  lançar. Ingrediente sem custo não é custo zero: o produto fica fora da conta.
- A cobertura se mede sobre a venda de produto, sem taxa de entrega e de serviço. Abaixo de 50%, o número sai como parcial e não se
  compara com outro período. A conta usa o custo de hoje do cadastro.
- Saldo, folha e custo de campanha entram pela conversa, com "Guardar" e "Corrigir", só pelo presidente. Saldo e folha só ele vê. O
  saldo vale 7 dias, e nenhum dos dois vai para a memória do Mister.
- "O saldo cobre X dias" só sai com alguma conta da loja lançada além de entregador e folha. Burn rate, runway em meses, margem
  líquida e giro ficam como "falta dado" até o Regem ler os repasses, as taxas e os impostos.
- Diferenças do protótipo: sem "muçarela +11%" e sem o botão "Comparar" (falta histórico de compra com custo), a folha também passa por
  "Guardar", e o prazo compara com o período anterior de mesmo tamanho.

**Como a V7d ficou (22/11):**

- "Voz com emoção" fica em Mister › Avisos e relatórios › Conversa. Nasce desligada, só o presidente muda (mig 493) e só vale com
  "Responder em áudio" ligado.
- O DMS Graph ganhou dois campos opcionais (contrato 1.7.0): `lerTom` em `ouvir_audio` e `estilo` em `falar`, de valores fechados. A
  voz nova é o Gemini 3.8 Flash-Lite TTS, convertida para OGG/Opus pelo FFmpeg. Se ela falhar, sai a voz de hoje, na mesma unidade da
  franquia.
- O tom fica só na memória do processo, pela mensagem, por até 20 minutos, e é apagado quando a resposta sai. Não vai à fila, à
  memória do Mister, à IA do texto, à auditoria nem ao log. Sem tom (repetição, processo reiniciado), vale neutro.
- Quem decide o estilo é o código (`estiloDaVoz`), lendo a resposta **e a pergunta**: a pessoa pode rir de um cliente sem que a
  resposta use a palavra. Perda ou queda deixa a voz séria. Assunto ruim com a pessoa rindo fica neutro. Frase boa que cita cliente ou
  funcionário fica animada, sem risada.
- Com o Graph ainda na 0.11.1, a recusa do argumento novo faz repetir sem ele, no que sobrou do prazo: o áudio sai na voz de hoje.
- Preço conferido em 22/11: US$ 6 por milhão de tokens de áudio, 25 tokens por segundo, cerca de **US$ 0,006 a cada 40 s** (o protótipo
  dizia US$ 0,01); a partir de 01/01/2027, US$ 12, cerca de US$ 0,012.
- Diferenças do protótipo: o ajuste fica no grupo Conversa de "Avisos e relatórios"; não gasta a chave de IA da empresa (sai pelo
  Graph e conta na franquia de fotos e áudios); a gaveta tem só "Fechar", como a das análises.

**Ainda depende de teste real:** a voz nova em português, a risada, a leitura do tom com barulho de cozinha, o custo e o tempo de
resposta das análises no pico.

## Versão 8 — clima, eventos, repasses e banco (aprovada em 23/11/2026)

Pedido do dono em 23/11: "vamos de 3 e 4", ou seja, ler os repasses do iFood, da 99 e do cartão (o que libera burn rate, runway e
giro) e levar clima e eventos ao Mister. Protótipo: `mockups/regem-mister-v8.html`, aprovado com as dez decisões recomendadas.

**O que a pesquisa mudou no desenho.** Nos últimos 30 dias a loja vendeu R$ 177.337: Anota Aí R$ 120.567 (68%), iFood R$ 31.219
(17,6%), 99 R$ 19.044 (10,7%) e Cardápio Web R$ 6.507 (3,7%). Só o iFood entrega líquido e comissão por API, e a maior parte da venda
não passa por essa API. O caminho grátis que cobre todos os canais é o **extrato do banco**, por arquivo OFX: mostra o que entrou, o
que saiu e o saldo.

**De onde vem cada dado (conferido nas documentações oficiais em 23/11):**

| Fonte | O que dá | Como chega | Limite |
|---|---|---|---|
| Banco | Entradas, saídas e saldo | Arquivo OFX | A loja exporta; o banco dela ainda não foi conferido |
| iFood | Líquido, comissão, taxas e dia do repasse por pedido | API Financial (`/v3/sales`, `/v3/financial-events`, `/v3/settlements`) | Exige homologação; o escopo do app de produção não foi confirmado |
| Anota Aí / iFood Pago | A API diz só `prepaid`; o portal do iFood Pago tem taxa e repasse | Planilha do portal | Sem API documentada. **A conferir:** se esse dinheiro aparece na API Financial do iFood |
| 99 | Repasses no portal | Excel do 99Food Admin | API financeira não confirmada |
| Mercado Pago | Liberações e conciliação | `release_report` e `settlement_report` (assíncronos, até 60 dias) | Só o que passou pelo Mercado Pago |
| Maquininha | Vendas e liquidação | Stone e PagBank por API; Cielo, Rede e Getnet por arquivo | Não sabemos qual a loja usa |
| Dinheiro | Entradas e sangrias | Caixa do Regem | Já existe |
| Open Finance | Extrato automático | Contrato com instituição autorizada (Resolução Conjunta nº 1) | Custo e análise jurídica: fora desta versão |

**Etapas:**

| Etapa | O que entrega | Migration prevista |
|---|---|---|
| E1 · Clima e eventos na conversa | "O que vem aí?" e "vai chover sexta?", com as duas previsões lado a lado | não |
| E2 · Comparação com as vendas | A venda em dias de jogo, feriado e chuva contra dias parecidos | não |
| E3 · Véspera e regras | Aviso da véspera, linha "Amanhã" no resumo, regra pela conversa | a conferir na hora, pelo que os ajustes gravam |
| E4 · Boletim do ramo | Impostos, custos e plataformas, curto e com a fonte | a conferir na hora |
| R1 · Extrato do banco | Financeiro › Banco e repasses, importar OFX sem duplicar, classificar lançamentos | sim (só-nuvem, RLS, classificada no `sync-daemon.mjs`) |
| R2 · Burn rate e runway reais | Os indicadores com a data do último extrato | não |
| R3 · iFood automático | Repasses por pedido, depois da homologação | sim |
| R4 · Planilhas | iFood Pago, 99 e maquininha, depois de um arquivo de exemplo real | sim |
| R5 · Giro e margem líquida | Com os repasses; a margem líquida ainda depende de a loja lançar os custos | não |

Ordem proposta: E1 → E2 → E3 → R1 → R2 → E4 → R3/R4 → R5. E1 a E3 usam dados que o Regem já recebe. R3 e R4 esperam o que só vem de
fora (homologação e arquivos de exemplo).

**As dez decisões (recomendada primeiro):**

- V8-1: banco por arquivo OFX. Open Finance só por contrato com instituição autorizada, com custo e análise jurídica.
- V8-2: banco e repasses só o presidente vê, com a recusa no servidor.
- V8-3: nomes e documentos do extrato ficam mascarados e nunca vão à IA.
- V8-4: iFood pela API depois da homologação; até lá, sem dado do iFood nesta parte.
- V8-5: sem arquivo, o Regem diz o que falta e onde baixar. Nunca estima pela tabela de taxas.
- V8-6: o Regem lê o que a plataforma informa e **não calcula comissão**. Mantém essa parte da decisão de 13/09/2026. Aprovar V8-4 e
  V8-6 reabre o que ela tirou da fila: a API financeira do iFood e a previsão de repasse. `taxa_entrega` não muda.
- V8-7: casa repasse e banco sozinho só com valor exato e data próxima. O resto fica "A conferir".
- V8-8: aviso de chuva só com as duas previsões de acordo ou alerta oficial do INMET.
- V8-9: avisos de clima e eventos nascem desligados, em texto fixo e sem IA. Para a loja é R$ 0. Fora das 24 horas de conversa, o
  WhatsApp só entrega modelo aprovado, e a Meta cobra cada mensagem da conta do número do Mister, que é da DMS.
- V8-10: "em dias assim a loja vende X" só com 4 ou mais dias parecidos.

**O que o levantamento achou e a execução precisa tratar:**

- A rotina de clima só busca o município das empresas com o módulo **Perfil do cliente** ligado (`municipiosDasLojas`). Empresa com
  Mister e sem esse módulo ficaria sem previsão: a E1 inclui quem tem o Mister.
- `PulsoModule` não está em `CLOUD_ONLY_MODULES` (`backend/src/edge-manifest.ts`). Entra na E1, com a conferência de que o servidor da
  loja não chama o Pulso (V1).
- `chuva_prevista` deu verdadeiro nos 6 dias lidos em 23/11, porque o INMET escreve "pancadas isoladas" quase todo dia. A previsão não
  traz milímetros nem hora. Daí a V8-8.
- A rotina de clima faz uma chamada por município sem pausa: precisa de ritmo antes de crescer em número de lojas.
- `clima_municipio_dia` não é apagada e guarda a previsão da véspera, então o histórico já está se formando. A comparação com chuva só
  responde com cerca de 60 dias gravados; até lá, o Mister diz que ainda não dá.
- O boletim do ramo já é lido e guardado em `pulso_boletim` (Notícias do ramo, N1, #1278, mig 494): a E4 usa essa cópia e não chama o
  Pulso de novo.
- Os documentos do Regem citam um contrato antigo do Pulso (hoje 1.8.0). Atualizar na E1.
- A ferramenta nova entra na lista fixa de `mister-agente.regras.ts` e na avaliação de regressão.

**Ainda depende de teste real:** a homologação do iFood, o formato real das planilhas do iFood Pago, da 99 e da maquininha, a
exportação OFX do banco da loja e se o dinheiro do iFood Pago aparece na API Financial.

**Da parte do dono:** dizer qual banco e qual maquininha a loja usa; mandar um extrato OFX e um arquivo de exemplo do iFood Pago e da
99. Quem cuida da homologação do iFood é a distribuição.

**Situação das etapas (23/11):**

| Etapa | Situação |
|---|---|
| E1 · Clima e eventos na conversa | no ar (#1285) |
| E2 · Comparação com as vendas | no ar (#1287) |
| E3 · Véspera, linha "Amanhã" e regra pela conversa | no ar (#1289, mig 498) e a regra pela agenda neste PR |
| E4 · Boletim do ramo | feita por outra frente: Notícias do ramo N1 a N3 (#1278, #1283, #1288) |
| R1 · Extrato do banco | no ar (#1291, mig 499, só nuvem) |
| R2 · Burn rate e runway reais | feita neste PR (sem migration) |
| R3 a R5 · Repasses, planilhas, giro | a fazer |

**Como E1 a E3 ficaram:**

- `clima_e_eventos` junta a base do Pulso, o calendário da loja e as duas previsões. Sem o Pulso, responde com o calendário fixo.
- O jogo fica no dia do relógio da loja: o das 21h de segunda vem gravado como terça em UTC. Jogo de outra cidade só conta se a pessoa
  pedir pelo nome ou pelo time.
- A comparação olha 180 dias, contra o mesmo dia da semana nas 8 semanas anteriores, sem evento e com a loja aberta. Com menos de 4 dias
  não sai número (V8-10).
- A chuva guardada é a previsão da véspera, não a chuva que caiu. Com menos de 60 dias gravados, o Mister diz quantos tem e quando dá.
- "Avisar na véspera" é um relatório em texto fixo. Fora das 24 horas, sem o convite, não sai e não custa nada.
- A regra pela conversa usa a fonte `agenda`, no mesmo motor das outras regras.
- Diferenças do protótipo: o alerta oficial do INMET ainda não entra, porque o Regem não lê essa rota do Pulso; o boletim do ramo
  continua no grupo Relatórios, onde a fase N2 o colocou.

**Como a R1 ficou (Financeiro › Banco e repasses, mig 499):**

- Cinco tabelas só da nuvem, com RLS e sem política: `banco_empresa` (o sal), `banco_conta` (só o banco e os 4 últimos dígitos),
  `banco_importacao`, `banco_lancamento` (só a descrição mascarada) e `banco_regra` (resumo da descrição → tipo). Só o presidente, na
  rota. O arquivo não é guardado: vai ao servidor no passo 2 (só lê) e de novo no passo 3 (grava numa transação).
- Uma conta por loja nesta etapa. Trocar a conta da loja ainda não tem tela. "Todas as lojas" numa empresa de várias pede para
  escolher a loja antes de importar.
- A chave do lançamento é FITID, data e valor. Sem FITID confiável (vazio, repetido no arquivo ou só a numeração das linhas), é data,
  valor, descrição e a ordem entre as linhas iguais do dia. Linha que só informa saldo e linha de valor zero não entram.
- "A conferir" vale só para ENTRADA cuja descrição cita iFood, iFood Pago/Anota Aí, 99 ou operadora de cartão. A saída fica "Só no
  banco", mesmo citando a plataforma.
- O buraco é um trecho de 5 dias ou mais sem lançamento em que a loja vendeu ao menos um dia (`comanda` fechada da loja). Fica gravado
  na importação; quem o usa na conta do caixa é a R2. O Banco fica "Em dia" com extrato de até 7 dias e "Extrato antigo" depois.
- A máscara vale em toda linha: só passa o que está na lista de termos de banco. Empresa (LTDA, EPP, CIA, S/A) mantém a primeira
  palavra; firma individual (ME, MEI, EIRELI) fica só com as iniciais, porque o nome dela costuma ser o da pessoa.
- Valor com um separador e 3 dígitos depois (`12.500`) é recusado e contado na tela: o OFX não usa separador de milhar, e adivinhar
  erraria em mil vezes.
- Diferenças do protótipo: as fontes sem dado dizem "Ainda não ligado", sem o botão de enviar; o passo 3 não promete casar com os
  repasses, que só existe na R3/R4; o aviso quando o saldo não fecha é novo; "Falta dizer" é um selo, pelo contraste; o período
  ganhou mês anterior, "Todo o extrato" e "Outro período" com o seletor de data.
- **Falta conferir com um arquivo real:** a exportação OFX do banco da loja e como a descrição vem nela.

**Como a R2 ficou (sem migration; definições em `docs/logica-negocio.md` § 2.6):**

- "Quanto tempo de caixa eu tenho?" responde pelo extrato quando os 3 últimos meses fechados estão completos em todas as lojas: saldo
  com a data, o que sobrou ou faltou em cada mês, burn rate e runway. Sem isso, continua a conta antiga e diz qual mês falta importar.
- Ficam fora da conta as transferências entre contas e o que foi marcado como "Não é da loja". Loja que gera caixa não tem runway.
- A descrição dos lançamentos não passa pela leitura do caixa: a IA recebe só somas por mês (V8-3).
- **Limites ditos na resposta:** dinheiro que fica no caixa e não é depositado não aparece, transferência ainda não marcada conta como
  da loja, e o que vence depois do último extrato não está na conta.

## Leitura de fotos (pedido do dono em 23/11/2026)

Pedido: "melhor análise de imagem", porque a foto do celular sai tremida ou com pouca luz. Protótipo:
`mockups/regem-mister-leitura-foto.html`. O dono escolheu: modelo melhor, usar todo o texto lido, mais tempo ao Graph, e "o que for
dúvida" o Mister informa e pergunta, e a pessoa responde o certo ou manda outra foto.

**O que o levantamento achou:** a foto é lida na nuvem. O Graph (Gemini) devolve o texto inteiro, mas o Regem guardava 15 linhas e
600 letras. O Graph tinha 15 s, e 4 das 5 fotos de 20 a 23/11 caíram na reserva (Haiku, resposta curta). O último motivo gravado foi
"sem resposta". O estudo de imagem do Farol (skill `imagem-python`) mede nitidez e luz, mas não testou realce para leitura.

| Fase | O que entra | Situação |
|---|---|---|
| L0 · O teste | 20 fotos reais com a resposta certa, comparando as versões | espera as fotos do dono |
| L1 · Leitura inteira | Texto inteiro até 5.000 letras, Graph com 25 s, o motivo da falha na pergunta, Sonnet 5.5 na reserva e na lista | no ar (#1296) |
| L2a · Dúvida na lista e na foto | A linha em dúvida fica fora do pedido, o Mister pergunta, a resposta entra | no ar (#1296) |
| L2b · Dúvida na nota e no cupom | Guarda o que leu e pergunta a linha, o total ou o que faltou. "Lançar assim" segue com a soma aberta. Nada é lançado antes da resposta | no ar (#1297) |
| L2c · O cupom pela conversa (ERR-594) | O agente vê as linhas do cupom aberto e grava o que a pessoa diz (corrigir, ligar ao insumo, conversão, fora do estoque); lançar só no botão. O aberto vale 72 h. A embalagem da descrição ("36un") confere a conversão. "Foi você que registrou?" consulta os pedidos de compra | neste PR |
| Ordem da leitura (decisão do dono, 24/11) | A foto vai primeiro à Anthropic; o Graph fica de reserva. Medido antes: o Graph leu 2 de 6 fotos, e cada falha custava 25 s de espera. O áudio continua no Graph | neste PR |
| L3 · Foto ruim e grande | Medir luz e tremido, documento até 20 MB, cupom em partes | depende de L0 e de biblioteca de imagem |
| L4 · Releitura | O Sonnet relê a foto em dúvida. Nasce desligada, com o preço ao lado | depende de L0 |

**Custo (medido em 23/11, na chave de IA da empresa):** cada foto lida pelo Sonnet custa cerca de US$ 0,026 (uns R$ 0,15). O cupom ou a
nota inteira, com a classificação e a leitura dos itens, cerca de US$ 0,085 (uns R$ 0,47). `MISTER_FOTO_MODELO` volta ao modelo anterior.
