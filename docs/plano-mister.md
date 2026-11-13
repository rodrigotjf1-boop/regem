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

## 5. O que depende do dono

1. ~~Onde a IA roda~~ — decidido: nuvem.
2. ~~Número do Mister no WhatsApp~~ — decidido: um número próprio, da distribuição, para todas as lojas.
3. Quem paga a IA: decide-se ao fim, com o gasto medido (ver as decisões de 12/11 acima).
4. Canal dos avisos da F1 para a loja (recomendado: caso urgente no Atendimento).
5. Regra do horário para `servidor_sem_sinal`.
6. ~~Mockup do módulo~~ — aprovado em 13/11. Faltam os mockups da F1.4.
7. ~~Releitura dos documentos e imagens no grafo de engenharia~~ — feita em 12/11.
8. O perfil de permissões por hierarquia (o que cada gerente pode pelo Mister): fim do projeto.

## 6. Como foi levantado

Três varreduras de leitura no checkout limpo de `origin/main` `7b7a573f`, por área (saúde e comandos; sinais de operação e vencimentos; canal, acesso e sync), com conferência manual dos pontos que sustentam o plano. Limites: nada foi executado; hardware, conta Meta, provedores de pagamento e homologação fiscal não foram testados; onde a documentação e o código divergiam, valeu o código.
