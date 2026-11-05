# Regem · Ponte do chat (o programa do PC da loja)

Parte B da ponte do chat do iFood e da 99 (plano e protótipos v3 aprovados pelo dono em 04/11/2026). O programa abre o
**Gestor de Pedidos do iFood dentro dele** — a pessoa da loja entra com o login dela, uma vez; a senha nunca passa pelo
Regem — e liga o chat à nuvem do Regem.

## O que a versão 0.3 faz

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

**Ainda não envia sozinho** (a fila de saída da nuvem — avisos "saiu"/"chegando" — entra na próxima versão, depois do
envio de verdade com o dono olhando). **A 99 fica fora** por enquanto: ela aceita um login só (ERR-365) — abrir aqui
derrubaria a 99 da loja.

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
| `REGEM_PONTE_SO_OBSERVAR=1` | o mesmo que `npm run observar` |

## Onde guarda (neste PC)

`%APPDATA%\Regem Ponte do chat\`: `ponte.json` (o pareamento, com o segredo cifrado, e o sal do diagnóstico),
`diagnostico.jsonl` (marcas) e a sessão do iFood (o perfil do navegador do programa). Apagar a pasta despareia o PC e
sai do iFood nele.

## Instalador

Sob comando do dono (como os outros artefatos — `RELEASES.md`): electron-builder (NSIS) com a assinatura pela CA
interna, no molde de `desktop/`. Ainda não gerado.
