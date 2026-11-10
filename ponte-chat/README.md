# Regem · Ponte do chat (o programa do PC da loja)

Parte B da ponte do chat do iFood e da 99 (plano e protótipos v3 aprovados pelo dono em 04/11/2026). O programa abre o
**Gestor de Pedidos do iFood dentro dele** — a pessoa da loja entra com o login dela, uma vez; a senha nunca passa pelo
Regem — e liga o chat à nuvem do Regem.

## O que a versão 0.4 faz

- **Pareia este PC por código:** Configurações › Equipamentos › cadastrar "Ponte do chat (iFood e 99, no PC)" › Gerar
  código → digitar os 6 números no programa (`publico/terminal/parear`, tipo `ponte_chat`). O segredo fica cifrado pelo
  Windows (safeStorage/DPAPI), nunca em texto claro.
- **Sinal de vida a cada 30 s** (`ponte-chat/estado`): logado ou não no iFood, a versão, o nome da máquina. A resposta diz
  se a ponte está **ligada** nos ajustes do Regem (Delivery › Configurações › Atendimento) e se este PC responde ou é reserva.
- **Lê o chat** (o WebSocket do Sendbird do Gestor, pelo depurador do Chromium): cada mensagem do cliente ou da loja, uma
  vez só (`msg_id` — chega repetida, uma por conexão), **com o pedido**: a conversa é por pedido e o canal diz qual —
  `sendbird_gc_cm_<id do pedido no iFood>_<id da loja>` (conferido em 04/11 na lista de conversas do Gestor: o 1º id é o
  `metadata.orderId` em todas; no Regem, é o `external_id` do pedido). **Com a ponte ligada**, manda à nuvem em lotes de
  até 50 (`ponte-chat/mensagens`, com `pedido.externo`); **desligada, não manda nada** e não guarda conversa de cliente
  (a nuvem também recusa).
- **Diagnóstico** (`diagnostico.jsonl`): só marcas (sha-256 com um sal deste PC) — nenhum texto, nome, telefone ou id
  em claro. Anota as mensagens, as chamadas que o Gestor faz ao chat e aos pedidos (a forma do endereço) e onde aparecem
  os ids nas respostas; quando a leitura de um corpo falha, o motivo (ERR-373).
- **Revogada no Regem** (`TERMINAL_REVOGADO`): esquece o pareamento e pede código novo. "Não reconhecido", falta de rede,
  limite e falha da nuvem só fazem esperar e tentar de novo (V70).

- **Teste de envio (manual)** — ícone R perto do relógio › botão direito › "Teste de envio (ensaio)…": o programa digita
  na tela do Gestor como a pessoa faria (cartão do pedido no quadro "Pedidos" › resumo › botão de chat do resumo › a
  conversa) e, ANTES de escrever, confere: o topo da conversa diz "#<número>"; o canal que o Gestor carregou é o do pedido
  (quando ele recarrega — conversa já aberta fica na memória do Gestor e aí vale o topo); há um só "Campo de mensagem".
  **Ensaio** = escreve, segura 5 s e APAGA, nunca aperta "Enviar". **Enviar de verdade** só depois de um ensaio certo do
  MESMO pedido (10 min), com confirmação na janela e um texto que não seja o de teste; dá por enviado só quando a mensagem
  volta pelo chat (o eco — escutado ANTES de apertar, ERR-375). O texto segue a regra da nuvem (sem telefone, WhatsApp,
  Instagram ou link — `regras.js`, igual ao `texto-do-chat.ts`; até 300 letras). Testado no Gestor de verdade em 04/11
  (ensaio no pedido real, nada enviado).

- **Envio automático pela fila da nuvem (v0.4, `saida.js`)** — o que a nuvem enfileira para o chat do iFood (os avisos
  "saiu"/"chegando"; depois, o robô e a equipe) sai por aqui, uma mensagem por vez, pelo mesmo caminho conferido do envio
  manual. As travas:
  - **só pega a vez** (`ponte-chat/saida/pegar` — cada pega gasta uma das 3 tentativas) com o PC pareado, a ponte LIGADA,
    este PC respondendo pelo iFood, logado — e com a **tela do Gestor livre**: no quadro "Pedidos", **nenhum texto no
    "Campo de mensagem"** (o rascunho de alguém) e **ninguém mexendo há 10 s** (um vigia na página anota a última tecla,
    clique ou rolagem DE GENTE — `isTrusted`; os cliques e o texto do programa não contam; vigia recém-posto conta como
    "mexeram agora");
  - **não toma o teclado**: escreve pelo "setter" do campo (o mesmo jeito do apagar, aceito pelo Gestor de verdade no
    ensaio), sem trazer a janela para a frente — quem usa outro programa no PC segue usando; a janela do Gestor roda sem
    freio mesmo escondida (`backgroundThrottling: false`);
  - **nunca mexe no rascunho de alguém**: campo com texto → não escreve, não apaga, não aperta (o ensaio manual também —
    na 0.3 ele apagaria o rascunho se a escrita falhasse: ERR-378); apagar só apaga o texto que o PROGRAMA escreveu; se a
    pessoa volta a mexer no meio, desiste antes de apertar;
  - **sem envio em dobro**: antes de digitar, e de novo com a conversa aberta (o Gestor carrega o histórico), confere se
    a mesma mensagem da loja já está na conversa do pedido depois de o aviso nascer — está: dá por enviada com o id que
    achou, sem digitar (`memoria-do-chat.js`: só o resumo sha-256 do texto, na memória). O **diário** `envios.jsonl`
    anota "apertei" ANTES do clique e o id do eco (sem texto): se o programa cai entre apertar e avisar a nuvem, a nuvem
    devolve o aviso e o programa, reaberto, confere antes — sem prova de que saiu, NÃO digita de novo ("envio incerto",
    definitivo, para a equipe conferir no Gestor);
  - **o resultado** vai à nuvem (`saida/<id>/resultado`) com o id da mensagem no chat (o eco) ou o motivo. Definitivos
    (não adianta tentar de novo): texto proibido, sem o número do pedido, pedido fora do quadro, envio incerto. Voltam
    para a fila: tela ocupada (depois de pegar, espera até 45 s), conferência que falhou;
  - **volta a tela** ao quadro: fecha a conversa e o resumo SÓ por um botão de rótulo EXATO "Fechar" (nunca "fechar"
    solto — o Gestor tem "fechar a loja"); sem esse botão, deixa como está.
- **O aviso automático do iFood** ("…pedidos nos últimos 30 dias", que só a loja vê) chega como mensagem da loja, mas
  quem manda é a CONTA da loja (o 2º id do canal — visto ao vivo em 05/11 no #8916): vem marcado (`avisoDoIfood`, pelo
  texto — `AVISOS_DO_IFOOD` em `src/sendbird.js`), não vai à nuvem, não conta como eco nem como "já enviada".
- **A 1ª fala de uma conversa nova** também chega pela conta da loja (a da equipe no Gestor e a da própria ponte): desde a
  0.7.1 ela VAI à nuvem como fala da loja (a da ponte a nuvem reconhece como o próprio envio pelo id e não guarda duas).

**A 99** entra na 0.6 (abaixo), só lendo e com o usuário EXTRA da loja: ela aceita um login por usuário (ERR-365).

## O que a versão 0.5 soma (peça 6 do protótipo de conexão)

- **Pausar a ponte neste PC** (menu do ícone e janela do estado; "Retomar a ponte neste PC" volta): pausada, não leva nada
  ao Regem (o que chega no chat nesse tempo não fica guardado) e não pega a vez na fila de saída — a reserva assume. A
  pausa fica guardada (`pausadaEm` em `ponte.json`): segue pausada depois de reiniciar, até alguém retomar. O sinal de
  vida manda `pausada: true` e a nuvem anota desde quando (mig 368): Equipamentos e o Atendimento dizem "pausada neste PC".
- **A janela "Estado da ponte"** (o clique no ícone, ou "Ver o estado da ponte"): o PC, um selo, UMA faixa com o que
  fazer agora, a situação (Regem, iFood e o papel deste PC, 99, mensagens levadas, fila de saída, último aviso) e os
  botões "Abrir o iFood", "Pausar/Retomar a ponte neste PC" e "Abrir o Atendimento".
- **Os comandos** (para o ícone "Regem neste PC" do mesmo PC, e atalhos): `--abrir` (a janela do estado), `--pausar`,
  `--retomar`, `--abrir-ifood`. Abrir o programa de novo com o comando entrega o pedido ao que já está aberto.
- **`estado-da-ponte.json`** (na pasta de dados): o resumo do estado, gravado a cada sinal e a cada mudança — o que o
  ícone "Regem neste PC" vai ler (no próximo `.exe`). Sem segredo nem conversa; leva o caminho do executável.

## O que a versão 0.5.1 corrige (1º teste real do envio automático, 05/11 — ERR-380)

No Gestor de verdade, com a loja aberta, o envio automático nunca abria a conversa ("o topo da conversa não mostra
#número" em todo pedido; nada foi digitado). A causa, achada pela inspeção do Gestor real (a porta de depuração do
programa, só leitura e texto mascarado): o clique no botão de chat do resumo vinha ~80 ms depois de abrir o pedido, com o
resumo ainda montando — e se perdia. Agora o programa espera o resumo DESTE pedido, dá 700 ms para ele assentar, clica e,
se nada abrir (nada na tela e o Gestor sem pedir a conversa), clica de novo uma vez. E os "X" de hoje: o do resumo é
"Fechar detalhes"; o da conversa, um ícone `close-icon` sem rótulo. Conferido no Gestor real (abre no 1º clique; conversa e
resumo fecham).

**E o eco da 1ª mensagem (ERR-381).** Com a correção acima, o 1º envio de verdade (05/11, #0845) SAIU — mas ficou "envio
incerto": a 1ª mensagem da loja numa conversa nova sai pelo iFood (o `POST` do chat do pedido) e volta com o remetente = a
CONTA da loja, a mesma cara do aviso automático do iFood, que a ponte descartava como eco. Agora o eco e a memória do "já
enviada" aceitam a mensagem da conta da loja quando o texto é EXATAMENTE o que a ponte mandou (um aviso do iFood nunca tem
esse texto). Ela segue fora do que vai à nuvem como fala da equipe.

**Pendências:** nenhuma desta parte. Feitos: o envio com o eco confirmado no Gestor de verdade (05/11); a janela
minimizada e escondida (06/11 — no Gestor de verdade o vigia lê e o chat segue conectado; na prova, os avisos saem na 1ª
tentativa); a 1ª fala da equipe numa conversa nova entra no Atendimento (0.7.1).

## O que a versão 0.6 soma (Etapa 4a — a ponte LÊ o chat da 99)

- **"Abrir a 99 (usuário extra)"** — desde a 0.7.3, "(conta principal)", ver abaixo — (menu do ícone e janela do estado): abre o portal da 99 numa janela própria, com a
  sessão à parte (`persist:99`). Na 1ª vez pergunta e avisa: entre com o **usuário EXTRA** da loja (com e-mail próprio)
  — a 99 aceita um login por usuário, e entrar com o login do PC da loja derruba a 99 de lá (ERR-365); o usuário extra tem
  sessão própria (conferido em 05/11). A escolha fica guardada (`usar99` em `ponte.json`): a janela reabre sozinha ao
  reiniciar (e ao parear de novo). **"Parar de ler a 99 neste PC"** fecha a janela e esquece a escolha (o login fica na
  sessão da janela). Fechar a janela só a esconde.
- **A leitura** (`src/leitor-99.js`): a página da 99 pergunta ao IM da DiDi (`lion.didiglobal.com/im/polling/`); a ponte
  lê as respostas pelo depurador do Chromium (como no iFood) — só a CONVERSA (`session_type` 1): texto e imagem (vai
  "📷 (o cliente mandou uma imagem — veja no portal da 99)"); aviso de sistema fica fora. Os ids passam de 2^53 e são
  lidos como TEXTO (o `sid` de 05/11 arredondava). Uma vez por mensagem (`uniq_msg_id`). Quem é a loja vem na resposta
  (`backfill_uid`): sem nunca saber, não leva nada (a fala da loja viraria caso de cliente).
- **O pedido:** a conversa da 99 não diz o pedido — diz o CLIENTE (o `uid` dele = `receive_address.uid` do pedido que o
  Regem já recebe da 99). A ponte manda `pedido.cliente99` e a nuvem liga ao pedido mais recente dele na 99 (2 dias),
  preenchendo o id e o número do pedido (a mesma conversa dos avisos — `ext:`). A fala da loja leva o cliente daquela
  conversa. Quando o portal abre uma conversa (`/im/broker/`, op_type 12), a ponte aprende a sessão ↔ pedido e passa a
  mandar o id do pedido dela (vence o "mais recente").
- **Só lendo:** o sinal de vida diz `99food: { logado: false, lendo: true }` — a nuvem não põe esta ponte para responder
  nem para reserva pela 99 (o envio é a 4b). O robô não responde a 99 (ninguém envia por ela — vira caso para a equipe);
  a faixa do Atendimento e Equipamentos dizem "99 só lendo: responda pelo portal da 99".
- "Logada na 99" = a janela no portal e o polling do IM respondendo nos últimos 5 min.

**Pendências (teste real):** o usuário extra logado na janela da 99 no PC da loja (o 1º login pode pedir SMS no celular da
loja); conferir que a fala mandada pela 99 do PC da loja (o outro usuário) chega com o `uid` da loja; o ícone "Regem neste
PC" ainda mostra só o iFood (pede `.exe`).

## O que a versão 0.7 soma (Etapa 4b — a ponte ENVIA pela 99)

- **"Responder pela 99 neste PC"** (menu do ícone, caixinha, e a janela do estado; nasce DESLIGADO, só com a 99 lida
  neste PC; ligar pergunta antes): o sinal passa a dizer `99food: { logado: true }` e a nuvem põe este PC para enviar
  pela 99 os avisos ("saiu", "chegando"), o robô (se ligado) e as respostas da equipe pelo Atendimento — como no iFood.
  Desligar ("Só ler a 99") volta a "lendo". "Parar de ler a 99 neste PC" desliga os dois.
- **O envio** (`src/envio-99.js`, mapeado em 06/11 no portal de verdade, só leitura): busca o pedido pelo número
  (`Nº pedido/índice do pedido` + Enter — a 99 mostra só ele, com o resumo aberto, de qualquer aba; "nada encontrado" =
  falha DEFINITIVA, não gasta as 3 tentativas); confere o número no resumo; clica no balão do chat com clique de MOUSE de
  verdade pelo depurador (`Input.dispatchMouseEvent` — o `click()` no elemento não abre; sem mexer no mouse do PC), de novo
  UMA vez se nada abrir; confere o número da conversa (`.im-order-id`); espera o campo (até 45 s — a conversa levou 30 s
  para carregar com a loja fechada); escreve pelo setter; aperta o "Enviar" DA GAVETA (`button.im-chat-window-edit-btn`,
  texto exato — o rodapé do resumo tem um "Cheguei" com a mesma cara: nunca); confirma pela resposta da 99 ao envio
  (`/im/broker/` op 3, o `uniq_msg_id`) ou pelo eco no polling. Depois devolve a tela: fecha a conversa (voltar), limpa a
  busca e volta à aba que estava.
- **A tela livre na 99:** só com o portal na lista de pedidos, nenhuma conversa aberta, nada escrito, a busca vazia e
  ninguém mexendo há 10 s. O clique do próprio programa avisa o vigia antes (`window.__ponteCliqueAte`): é "de verdade"
  e, sem o aviso, o programa se acharia uma pessoa mexendo.
- **A fila de saída da 99** é o mesmo trabalhador do iFood (`saida.js`, canal `99food`): "já está no chat?" pela memória
  do leitor (a fala da loja com o texto exato, na conversa cuja sessão ↔ pedido o portal abriu), "apertei" no diário antes
  do clique, "incerto" sem confirmação (definitivo).

**Pendências (teste real):** o 1º envio de verdade pela 99 (ligar "Responder pela 99 neste PC" e olhar o 1º aviso de um
pedido da 99 de entrega própria). A janela da 99 minimizada e escondida foi conferida em 06/11: o clique pelo depurador
chega e a busca do programa funciona no portal de verdade.

## O que a versão 0.7.2 corrige (07/11 — o envio pela 99 na loja de verdade)

- **O balão do chat com o painel ainda entrando.** Logo depois da busca, o painel do pedido ainda entra na tela: o balão
  vinha "há algo na frente" e livre 2,5 s depois (medido na 99 de verdade, 07/11). A ponte desistia na 1ª conferência —
  o envio pela 99 nunca saía. Agora confere de novo até 4 s (`BALAO_MS`); o resumo de OUTRO pedido continua parando na
  hora.
- **Achado da leitura (sem correção nesta versão — decisão do dono):** na 99 cada usuário da loja tem as PRÓPRIAS conversas.
  Com o chat fechado, o polling do IM do usuário extra responde vazio (`max_mid` parado) e a conversa de um pedido aberta
  por ele não mostra o que o cliente e o usuário principal trocaram. As mensagens do cliente só chegam à ponte se ela usar
  a conta que conversa com o cliente (a principal) — ou se a 99 tiver uma permissão de chat para o usuário extra.

## O que a versão 0.7.5 muda (09/11 — o Gestor volta sozinho ao quadro "Pedidos")

- **Ao reiniciar, o Gestor do iFood abre em "Início", não no quadro "Pedidos"** — e a fila de saída só envia com o quadro
  aberto (é nele que o programa acha o cartão do pedido). Em 09/11, logo depois de reiniciar na 0.7.4, a fila do iFood
  ficou 5 min "esperando a tela do Gestor (o Gestor não está no quadro "Pedidos")" até alguém clicar em "Pedidos" — o
  diagnóstico novo da 0.7.4 mostrou o motivo; é a explicação provável da fila parada de 08/11.
- **Agora a ponte volta sozinha:** com o Gestor fora de "Pedidos" (o item do menu lateral não é a página atual), sem
  rascunho no campo de mensagem e ninguém mexendo há 60 s (`REGEM_PONTE_VOLTAR_MS`), clica no item "Pedidos" do menu.
  É só navegação — não aceita pedido, não abre nem fecha a loja. Se o clique não levar, não insiste antes de outros 60 s.
  Cada volta vai ao diagnóstico (`gestor_voltou_ao_quadro`, com o começo do endereço da página de onde saiu, sem id).
- **Quadro "Pedidos" aberto e vazio** (nenhum cartão): o motivo agora diz "o quadro "Pedidos" está sem cartões", e não
  mais "não está no quadro".

## O que a versão 0.7.4 muda (09/11 — o envio pela 99 destravado e o motivo da fila parada no diagnóstico)

- **A notificação da 99 na frente do botão do chat é fechada.** A "Por favor, verifique sua conexão de internet" fica
  fixa no canto de cima da página da 99, por cima do resumo do pedido — e a ponte, que só clica com o botão LIVRE,
  desistia ("há algo na frente do botão do chat"): o envio pela 99 nunca saiu (06–09/11). Agora, quando o que está na
  frente é uma notificação da própria 99 (`.pb-notification`), a ponte fecha no X dela e confere de novo. Qualquer outra
  peça na frente: não clica, e o motivo diz qual (só a tag e as classes).
- **A situação da fila de saída vai ao diagnóstico quando muda** (`saida_situacao`, de → para): em 08/11, das 19:15 às
  20:45, a fila do iFood ficou parada (11 avisos "saiu" venceram) e o motivo só existia na memória. Os motivos são textos
  fixos do programa (sem nome de cliente nem texto de mensagem). A janela "pronto para iniciar?" do Gestor na abertura NÃO
  é fechada pela ponte (mexe na abertura da loja): se ela segurar a fila, o diagnóstico mostra.

## O que a versão 0.7.3 muda (08/11 — a 99 com a CONTA PRINCIPAL, decisão do dono)

- **A 99 entra com a conta principal da loja**, não mais com o usuário extra: é com ela que o cliente conversa (o achado da
  0.7.2). A janela da 99, o item do menu ("Abrir a 99 (conta principal)"), o aviso da 1ª vez e a faixa do estado dizem isso.
- **A 99 aceita um login por conta (ERR-365): a 99 fica aberta SÓ na ponte.** Entrar com a conta principal em outro
  aparelho (o PC da loja, um tablet) derruba a da ponte, e a ponte derruba a de lá. A loja combina que a 99 fica aberta só
  aqui; os pedidos seguem no Regem. Se a ponte cair do login, o estado mostra "99: sem login" — entrar de novo só com a
  loja fechada ou depois de conferir que ninguém está usando a 99 em outro lugar.
- Na troca (08/11, loja fechada), a sessão do usuário extra foi apagada só na janela da 99 da ponte (cookies dos domínios
  da 99/DiDi e os dados do portal); o iFood não foi tocado.

## Rodar (desenvolvimento)

```bash
cd ponte-chat
npm install                       # se faltar node_modules/electron/dist: node node_modules/electron/install.js
npm start                         # o programa (pede o pareamento na primeira vez)
npm run observar                  # sem pareamento e sem nuvem: só abre o Gestor e anota o diagnóstico
npm test                          # testes dos módulos sem Electron (node:test; também rodam no CI)
```

Aberto do terminal do VS Code, o Electron herda `ELECTRON_RUN_AS_NODE` e rodaria como Node puro (ERR-363): o programa
percebe e se reabre sem ela.

### Variáveis (só para teste)

| Variável | Para quê |
|---|---|
| `REGEM_PONTE_NUVEM` | outra API (ex.: `http://localhost:3056/api/v1`, o servidor local) |
| `REGEM_PONTE_GESTOR` | outra página no lugar do Gestor (o chat de mentira da prova) |
| `REGEM_PONTE_CHAT_WS` | o padrão do endereço do WebSocket do chat (padrão: `sendbird.com`) |
| `REGEM_PONTE_DADOS` | outra pasta de dados (a prova usa uma pasta temporária) |
| `REGEM_PONTE_SINAL_MS`, `REGEM_PONTE_FILA_MS` | intervalos menores na prova |
| `REGEM_PONTE_SAIDA_MS`, `REGEM_PONTE_PARADA_MS`, `REGEM_PONTE_ESPERA_TELA_MS`, `REGEM_PONTE_ECO_MS` | a fila de saída na prova (5 s · 10 s de tela parada · 45 s de espera pela tela · 20 s pelo eco) |
| `REGEM_PONTE_SO_OBSERVAR=1` | o mesmo que `npm run observar` |
| `REGEM_PONTE_APP` | outro endereço do app no "Abrir o Atendimento" (padrão: `https://app.dmsregem.com`) |
| `REGEM_PONTE_99` | outra página no lugar do portal da 99 (a 99 de mentira da prova) |
| `REGEM_PONTE_99_IM`, `REGEM_PONTE_99_BROKER` | o padrão do endereço do polling e do broker do IM (padrão: `lion.didiglobal.com/im/…`) |
| `REGEM_PONTE_ABRIR_99=1` | abre a 99 sem a pergunta (a prova não pilota o diálogo do Windows) |
| `REGEM_PONTE_99_LOGADA_MS` | quanto tempo sem polling conta como "sem login na 99" (padrão: 5 min) |
| `REGEM_PONTE_RESPONDER_99=1` | liga "Responder pela 99 neste PC" sem a pergunta (a prova) |

## Onde guarda (neste PC)

`%APPDATA%\Regem Ponte do chat\`: `ponte.json` (o pareamento, com o segredo cifrado, e o sal do diagnóstico),
`diagnostico.jsonl` (marcas), `envios.jsonl` (o diário dos envios da fila: ids, sem texto), `estado-da-ponte.json` (o
resumo do estado para o ícone "Regem neste PC") e as sessões do iFood e da 99 (os perfis
do navegador do programa). Apagar a pasta despareia o PC e
sai do iFood e da 99 nele.

## Instalador

Sob comando do dono (como os outros artefatos — `RELEASES.md`): electron-builder (NSIS) com a assinatura pela CA
interna, no molde de `desktop/`. Ainda não gerado.
