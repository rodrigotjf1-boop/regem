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
- Alerta local sem internet (bandeja e tela da loja), a única parte da F1 que pede `.zip`.

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

## 5. O que depende do dono

1. ~~Onde a IA roda~~ — decidido: nuvem.
2. ~~Número do Mister no WhatsApp~~ — decidido: um número próprio, da distribuição, para todas as lojas.
3. Quem paga a IA: decide-se ao fim, com o gasto medido (ver as decisões de 12/11 acima).
4. ~~Canal dos avisos da F1 para a loja~~ — decidido em 14/11: depende do tipo; tabela na F1.2.
5. ~~Regra do horário para `servidor_sem_sinal`~~ — decidido: só com pedido esperando.
6. ~~Mockup do módulo~~ — aprovado em 13/11. Faltam os mockups da F1.4.
7. ~~Releitura dos documentos e imagens no grafo de engenharia~~ — feita em 12/11.
8. O perfil de permissões por hierarquia (o que cada gerente pode pelo Mister): fim do projeto.
9. **Pendência de implementação para o fim (pedido do dono em 13/11/2026):** a opção de conectar o número do Mister pela conexão gratuita do Evolution, além da API oficial da Meta. O argumento: o Mister só fala com quem ligou o próprio telefone, então o risco de denúncia do número é baixo. O Regem já fala com o Evolution no WhatsApp das lojas; o que falta é o número do Mister ganhar uma porta de provedor (oficial ou Evolution), escolhida pela distribuição no console. Pede mockup da opção.

## 6. Como foi levantado

Três varreduras de leitura no checkout limpo de `origin/main` `7b7a573f`, por área (saúde e comandos; sinais de operação e vencimentos; canal, acesso e sync), com conferência manual dos pontos que sustentam o plano. Limites: nada foi executado; hardware, conta Meta, provedores de pagamento e homologação fiscal não foram testados; onde a documentação e o código divergiam, valeu o código.
