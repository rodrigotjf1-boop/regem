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
  quem manda é a CONTA da loja (o 2º id do canal — visto ao vivo em 05/11 no #8916): vem marcado (`avisoDaPlataforma`),
  não vai à nuvem (que ainda não tem esse tipo de autor), não conta como eco nem como "já enviada".

**A 99 fica fora** por enquanto: ela aceita um login só (ERR-365) — abrir aqui derrubaria a 99 da loja.

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

**Pendências de teste no Gestor de verdade** (provado só com o Gestor de mentira): o 1º envio automático com o dono
olhando, num pedido de entrega própria saindo; o "Fechar" da conversa e do resumo (o rótulo do X no Gestor real não está
mapeado — sem ele, a tela fica na conversa); o "setter" com a janela escondida.

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

## Onde guarda (neste PC)

`%APPDATA%\Regem Ponte do chat\`: `ponte.json` (o pareamento, com o segredo cifrado, e o sal do diagnóstico),
`diagnostico.jsonl` (marcas), `envios.jsonl` (o diário dos envios da fila: ids, sem texto), `estado-da-ponte.json` (o
resumo do estado para o ícone "Regem neste PC") e a sessão do iFood (o perfil
do navegador do programa). Apagar a pasta despareia o PC e
sai do iFood nele.

## Instalador

Sob comando do dono (como os outros artefatos — `RELEASES.md`): electron-builder (NSIS) com a assinatura pela CA
interna, no molde de `desktop/`. Ainda não gerado.
