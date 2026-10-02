# 06 · Eventos sazonais do cardápio

> Referência visual: protótipo, painel **Evento sazonal** (ou a tabela **Agenda de eventos**, botão "Ver no celular").
>
> **Implementado em 01/10/2026.** Este arquivo já descreve o que está no código; onde a primeira versão da especificação dizia outra coisa, a seção 9 explica o que mudou e por quê.

## 1. Conceito

Uma **camada de evento** que se aplica por cima de qualquer template (`galeria`, `balcao`, `oferta`, `fluxo`). O template continua o mesmo; o evento acrescenta clima e diversão:

- partículas animadas (neve, confete, corações, morcegos…);
- enfeite no topo (pisca-pisca, bandeirinhas, teia de aranha…);
- acessório em 1 a cada 3 fotos (touca de Papai Noel, orelhas de coelho, chapéu de bruxa…);
- ícone temático nos títulos de seção;
- faixa do evento com contagem regressiva e uma coleção de produtos;
- trilha temática nas etapas do checkout (o trenó, o coelho ou o fantasminha andam conforme o cliente avança);
- textos do aviso "item na sacola" e da confirmação no clima do evento;
- explosão de partículas ao adicionar um item e na confirmação;
- mini-jogo opcional que libera cupom (Páscoa e Halloween).

**Regra de ouro: festa na vitrine, foco no checkout, festa de novo na confirmação.** No checkout não caem partículas; só a trilha das etapas e as cores lembram o evento. Na confirmação, a festa só começa com o **pedido garantido**: com Pix pendente, vencido ou pedido cancelado, a tela fica limpa (nada cai sobre o código Pix) e a comemoração aparece quando o pagamento cai.

**Nenhum evento liga sozinho.** O presidente liga, em Delivery → Configurações → Eventos, só os eventos que quer usar. Ligado, o evento entra no ar no período dele e sai sozinho no fim; desligado, o cardápio nunca muda. Tudo é enfeite: o evento não altera preço, pedido, pagamento nem o que vai ao servidor.

## 2. Os 13 eventos

| Chave | Evento | Dia do evento | Período padrão | Cor | Partículas | Topo | Acessório na foto | Trilha | Extra |
|---|---|---|---|---|---|---|---|---|---|
| `reveillon` | Réveillon | 01/01 | 26/12 a 01/01 (6 dias antes) | dourado `#B8860B` | estrelas + fogos | estrelas penduradas | chapéu de festa | foguete | fogos na confirmação |
| `carnaval` | Carnaval | terça de Carnaval (Páscoa − 47) | sexta até a quarta de cinzas (4 antes, 1 depois) | roxo `#7C3AED` | confete + serpentina | serpentinas | máscara de colombina | máscara | trilha arco-íris correndo |
| `pascoa` | Páscoa | domingo de Páscoa | 7 dias antes até o domingo | chocolate `#7B4A2E` | pétalas + ovinhos pastel | varal de ovos | orelhas de coelho | coelho pulando | **caça aos ovos** |
| `maes` | Dia das Mães | 2º domingo de maio | 7 dias antes | rosa `#D6455D` | pétalas de rosa | ramo de flores | flor | flor | — |
| `hamburguer` | Dia do Hambúrguer | 28/05 | 21/05 a 28/05 | ketchup `#C1121F` | gergelim + mini burguers | varal de hambúrgueres | chapéu de chef | burguer de pernas correndo | faixa mostarda com gergelim |
| `namorados` | Dia dos Namorados | 12/06 | 05/06 a 12/06 | vermelho `#E11D48` | corações subindo | varal de corações | coração flechado | coração com asas | — |
| `junina` | Festa Junina | 24/06 | 01/06 a 30/06 (23 antes, 6 depois) | laranja `#C2410C` | pipoca | bandeirinhas | chapéu de palha | fogueira | faixa em chita |
| `pais` | Dia dos Pais | 2º domingo de agosto | 7 dias antes | azul `#1E3A5F` | confete azul e caramelo | faixa xadrez + gravata | bigode | gravata-borboleta | — |
| `criancas` | Dia das Crianças | 12/10 | 01/10 a 12/10 | azul `#2563EB` | balões + confete | bandeirolas + balões | boné de hélice girando | aviãozinho | — |
| `halloween` | Halloween | 31/10 | 20/10 a 31/10 | abóbora `#EA580C` | morcegos + folhas | teia com aranha descendo | chapéu de bruxa | fantasminha | **gostosuras ou travessuras** |
| `blackfriday` | Black Friday | sexta após a 4ª quinta de novembro | segunda a domingo da semana (4 antes, 2 depois) | preto `#0A0A0A` | etiquetas caindo | fita "Black Friday" correndo | etiqueta Black | carrinho | contagem até o fim, ao vivo |
| `natal` | Natal | 25/12 | 01/12 a 25/12 | vermelho `#C8102E` | neve | pisca-pisca | touca de Papai Noel | trenó | neve acumulada nos botões |
| `jogo` | Dia de jogo | **por jogo cadastrado** | 3 h antes até 2h30 depois do horário | gramado `#15803D` | papel picado branco e verde | faixa de gramado com a bola rolando | bola de futebol | bola rolando | contagem até a bola rolar, **sem times** |

**Período = dias antes e dias depois do dia do evento.** O presidente pode mudar os dois números (0 a 60 antes, 0 a 30 depois). Como o período é contado a partir do dia do evento, a mesma regra serve para data fixa e para data móvel, ano após ano, e o Réveillon cruza o ano sem tratamento especial.

**Quando dois períodos se cruzam** (só entre os eventos ligados): Dia de jogo > Namorados e Dia do Hambúrguer > os demais > Junina. No empate vale a ordem da lista do código (`EVENTOS_CARDAPIO`): reveillon, carnaval, pascoa, maes, hamburguer, namorados, junina, pais, criancas, halloween, blackfriday, natal — por exemplo, em 01/12/2030 valem os dois, Black Friday (domingo) e Natal, e fica a Black Friday.

Datas móveis, calculadas no servidor pelo dia de Brasília (`America/Sao_Paulo`):
- **Páscoa:** cômputo gregoriano (Meeus).
- **Carnaval:** terça = Páscoa − 47 dias.
- **Dia das Mães:** 2º domingo de maio.
- **Dia dos Pais:** 2º domingo de agosto.
- **Black Friday:** sexta seguinte à 4ª quinta de novembro.

### Textos de cada evento (padrão, editáveis pelo presidente)

Os padrões servem para **qualquer loja** e para **entrega, retirada e mesa**: não citam o nome de uma loja, não prometem prazo nem dizem "chega já já". O presidente troca o título e o texto da faixa no painel (por exemplo, "Natal do Mister" e "encomende até 23/12").

| Evento | Faixa (título · texto) | Coleção | Aviso ao adicionar | Confirmação |
|---|---|---|---|---|
| Réveillon | A virada é com a gente · Monte o pedido da festa e comece o ano de mesa cheia. | Pra virada | "{item} garantido pra virada" | Feliz Ano Novo! · Seu pedido já entrou na festa. |
| Carnaval | O bloco passa aqui · Peça pra recarregar entre um bloco e outro. | Pra curtir o bloco | "{item} entrou no bloco" | Ê, folia! · Seu pedido já entrou no bloco. |
| Páscoa | Páscoa na mesa · Escolha os favoritos pra dividir com a família. — com o jogo: Caça aos ovos · Ache os 3 ovinhos escondidos no cardápio e ganhe um cupom de desconto. | Para a Páscoa | "{item} foi pra cesta" | Pedido na cesta! · O coelho já está preparando tudo. |
| Dia das Mães | Pra mãe, o melhor · É presente? Conte na observação e a gente capricha. | Pra mãe | "{item} na sacola, com carinho" | Com carinho! · Feito com o mesmo cuidado de mãe. |
| Dia do Hambúrguer | O dia mais gostoso do ano · 28/05 é o nosso feriado: monte o seu e comemore com a gente. | Os campeões da casa | "{item} foi pra chapa" | Na chapa! · Seu pedido já foi pra chapa. |
| Namorados | Amor à primeira mordida · Pra dividir a dois. Ou não, a gente não julga. | Pra dividir a dois | "{item} conquistou seu coração" | Match perfeito! · Seu pedido está sendo preparado com carinho. |
| Junina | É festa no arraiá · Anarriê! Escolha os quitutes pra sua quadrilha. | Do arraiá | "Anarriê! {item} tá na sacola" | Anarriê! · Seu pedido já tá no arraiá, sô! |
| Pais | Paizão merece · O pedido completo, do jeito que ele gosta. | Pro paizão | "{item} na sacola do paizão" | Paizão aprovou! · Pedido confirmado, sem enrolação. |
| Crianças | Hoje a criançada manda · Peça o favorito da turma e comemore com a gente. | Pra criançada | "Oba! {item} na sacola" | Oba! · Pedido confirmado, criançada! |
| Halloween | Gostosuras ou travessuras? · As gostosuras da casa estão te esperando. — com o jogo: Toque na abóbora e descubra o que te espera. | Gostosuras | "{item} caiu no caldeirão" | Gostosura garantida! · Seu pedido já está no caldeirão. |
| Black Friday | Preço Black · Ofertas com até X% off. Só até domingo. | Ofertas Black | "{item} garantido no preço Black" | Oferta garantida! · Você pegou o preço Black. |
| Natal | Natal é aqui · Ceia sem trabalho: a gente prepara e você aproveita. | Ceia de Natal | "{item} foi pro saco do Papai Noel" | Ho ho ho! · Seu pedido já está no trenó. |
| Dia de jogo | Hoje tem jogo na TV · Monte o pedido da torcida e garanta antes da bola rolar. | Pra torcida | "{item} escalado pro jogo" | Golaço! · Seu pedido já entrou em campo. |

O "X%" da Black Friday é o maior desconto real entre os produtos com preço "de/por"; sem nenhum produto em promoção, o texto vira "As ofertas da semana estão aqui." "Só até domingo" vira "Só até dd/mm" se o presidente mudar o fim do período.

### Dia de jogo: regras próprias

- **Não é por data fixa.** O presidente cadastra os jogos em Eventos → Dia de jogo: data, hora (de Brasília) e uma chamada opcional de até 40 caracteres (ex.: "Final do campeonato", "Jogo das 21h30").
- **Sem times, escudos ou marcas de campeonato.** O campo de chamada mostra o aviso "Não use nome de time nem de campeonato" e o servidor recusa uma lista básica de termos (clubes das séries A e B, "Brasileirão", "Libertadores", "Copa do Brasil" e similares — lista em `eventos-cardapio.ts`). A arte é neutra: gramado, bola, "AO VIVO".
- **Liga e desliga sozinho:** do início da janela (3 h antes) até 2h30 depois do horário. Nesse período **vence qualquer outro evento** e depois devolve o evento do dia. Com o cardápio aberto, a tela tira o tema sozinha quando a janela acaba.
- **A contagem acompanha o jogo:** "Bola rola às 21:30 · faltam 2h05" → "Bola rolando: peça sem sair do sofá" → "Fim de jogo: pede a saideira".
- O mesmo cadastro deve alimentar o RegemBoard no futuro (seção 8).

## 3. Onde fica a configuração (sem migration)

No `cardapio_config.tema_config` (jsonb que já existe), chave `eventos`. A configuração do cardápio é uma linha por empresa, então o evento vale para a empresa inteira.

```jsonc
"eventos": {
  "animacoes": true,          // partículas e enfeites em movimento
  "coresDoEvento": true,      // botões na cor do evento; false mantém a cor da loja
  "jogos": [{ "inicio": "2026-10-01T21:30:00-03:00", "chamada": "Jogo das 21h30" }],  // Dia de jogo (horário de Brasília)
  "porEvento": {
    "natal": {
      "ativo": true,           // só entra no ar o que estiver ligado (padrão: desligado)
      "diasAntes": 10,         // opcional: troca o período padrão
      "diasDepois": 1,
      "titulo": "Natal do Mister", "texto": "Encomende até 23/12…",
      "colecao": ["<produtoId>", "..."],   // vazio = destaques da loja (Black Friday: produtos em promoção)
      "cupomJogo": "<cupomId>" // só Páscoa/Halloween (seção 6)
    }
  }
}
```

- **Backend (`backend/src/modules/cardapio/`):**
  - `eventos-cardapio.ts` — puro: calendário, leitura tolerante do que está gravado (`lerEventos`), gravação conferida campo a campo (`aplicarEventos`: campo ausente mantém; valor torto é recusado com o motivo), `eventoNoAr`, `eventoEmPrevia`, `agendaDeEventos`.
  - `eventos-cardapio.service.ts` + `eventos-cardapio.controller.ts` — `GET /cardapio/eventos` (quem tem a permissão da loja vê) e `PUT /cardapio/eventos` (**só presidente**; audita `cardapio_eventos_alterados`). A gravação troca **só** a chave `eventos`, numa instrução (`tema_config || {eventos}`), e confere que produtos e cupom são da própria empresa.
  - `PUT /cardapio/config` (a rota geral, que aceita gerente) **ignora** `temaConfig.eventos`: a tela "Editar tema" manda o tema inteiro que carregou e regravaria eventos antigos por cima dos novos.
  - `GET /publico/cardapio/:token` devolve um campo novo **`evento`**, já resolvido — `{ chave, inicio, fim, dia, titulo, texto, colecao, cores, animacoes, partida, cupomJogo, previa }` ou `null`. **O servidor decide o evento pelo dia de Brasília**, para todos os clientes verem o mesmo tema sem depender do relógio do celular. A configuração crua nunca vai para o cardápio público.
  - `GET /publico/cardapio/:token?evento=natal` devolve o evento **em prévia** (ligado ou não, em qualquer data): é o "Ver prévia" do painel.
- **Painel:** Delivery → Configurações → **Eventos** (`frontend/src/components/delivery/eventos-panel.tsx`):
  - o que está no ar agora;
  - chaves "Animações" e "Cores do evento";
  - agenda dos próximos 12 meses, uma linha por evento com a chave de ligar, as datas, a situação e "Ver prévia";
  - "Personalizar": dias antes/depois, título, texto, coleção (seletor de produtos) e, na Páscoa e no Halloween, o "Cupom do mini-jogo" (cupons ativos da loja; sem cupom, o jogo não aparece);
  - Dia de jogo: chave, lista de jogos (data e hora com seletor nativo) e chamada.

## 4. Estrutura no front

```
frontend/src/components/loja/eventos/
├── contexto.tsx     ← o que fica no pacote principal: carrega as peças só quando há evento e os "encaixes"
│                      (EvTopo, EvFaixa, EvIcone, EvFoto, EvTrilha, EvChamadaOk, EvApoioOk, EvSeloOk)
├── catalogo.ts      ← os 13 eventos: cor, textos padrão, partículas, peças de arte, contagem — só apresentação
├── arte.ts          ← SVGs desenhados à mão (acessórios, corredores, ícones, arte grande), vindos do protótipo
├── guirlanda.ts     ← enfeite do topo na largura da tela
├── particulas.ts    ← um canvas, lista fixa (máx. 50), pausa com a aba oculta
└── pecas.tsx        ← Topo, FaixaEColecao, Icone, NaFoto (acessório e ovo), Trilha, confirmação e Camada (canvas)
frontend/src/app/c/[token]/temas/eventos.css  ← tokens --ev-* e animações, sempre sob .p-root.ev-on.ev-<chave>
frontend/src/fonts/eventos/*.woff2            ← as 12 fontes dos títulos de evento, embutidas
```

- A raiz do cardápio ganha `ev-on ev-<chave>` quando `menu.evento` existe. Tudo fica escopado nessas classes; sem evento, nada muda — e **nada é baixado**: `pecas.tsx`, o CSS e as fontes só carregam com evento no ar, e só a fonte do evento ativo é baixada.
- Os templates não importam nada de `pecas`. Têm os encaixes de `contexto.tsx` nos pontos em que o evento entra: topo da área que rola, abaixo do cabeçalho, título das seções, foto do produto (`<Foto enfeite produtoId>`), entre o cabeçalho e o corpo do checkout, e a confirmação. Cada encaixe devolve `null` sem evento.
- **Fontes do evento** (só no título da faixa e na chamada da confirmação): Mountains of Christmas, Cinzel, Bungee, Sniglet, Playfair Display itálico, Dancing Script, Rye, Alfa Slab One, Fredoka, Creepster, Anton e Titan One — `@font-face` no `eventos.css`, com os arquivos do repositório. **Nunca `next/font/google`:** o build do `.zip` do servidor da loja roda sem internet.
- Cupom do jogo e desconto continuam **validados no servidor** (`cardapioCupomValidar`); a tela só entrega o código ao `aplicarCupom` de sempre.

## 5. Regras de desempenho e acessibilidade

1. **Um canvas só**, lista fixa de partículas (máx. 50), sem alocar por quadro. Pausa com `document.hidden` e para de desenhar quando não há partículas.
2. **Sem partículas no checkout.** Na vitrine, sim. Na confirmação, só com o pedido garantido (nunca com Pix pendente).
3. `prefers-reduced-motion` ou "Animações" desligado: sem canvas, sem pisca-pisca, sem balanço; enfeites e acessórios ficam estáticos.
4. Acessório no máximo em **1 a cada 3 fotos** de cada lista e nunca sobre preço, selo de desconto ou botão +. A foto continua com os cantos arredondados; o acessório pode sair para fora.
5. Tudo decorativo com `aria-hidden="true"` e sem toque (`pointer-events: none`). Os ovos da Páscoa são `role="button"` com rótulo e funcionam no teclado.
6. As cores do evento só trocam a cor de ação; os tokens do template continuam, e a cor de cabeçalho escolhida pela loja também. No **modo escuro**, os eventos de cor escura (Black Friday, Dia dos Pais, Páscoa…) usam uma cor de ação clara.
7. Sem som e sem vibração.
8. Peso: as artes são SVG no próprio código (poucos KB). Nada de GIF ou vídeo.
9. O enfeite do topo corta o que passa da largura da tela (a fita da Black Friday é mais larga): nenhuma rolagem lateral.

## 6. Mini-jogos (opcionais, liberam só desconto)

- **Caça aos ovos (Páscoa).** 3 ovinhos escondidos em fotos de produtos de terços diferentes do cardápio (sempre os mesmos enquanto o cardápio não mudar). Cada ovo tocado some com uma chuva de ovinhos e o contador "N de 3" na faixa avança. No terceiro, o cupom configurado é aplicado e a faixa mostra "Cupom … guardado".
- **Gostosuras ou travessuras (Halloween).** A abóbora da faixa balança. Ao tocar, sai "Gostosura!" (chuva de doces) ou "Travessura!" (a tela treme e uma revoada de morcegos atravessa). O sorteio é **só da animação**: nos dois casos o cupom é o mesmo. Uma vez por visita.
- Sem cupom configurado, o jogo não aparece e a faixa usa o texto normal. Limite de uso do cupom é regra do próprio cupom (por telefone, como hoje). Ninguém ganha prêmio por sorte: todo cliente que joga recebe o mesmo cupom.

## 7. Checklist de aceite

- [x] `temaConfig.eventos` conferido na gravação; leitura pública devolve `evento` resolvido pelo dia de Brasília.
- [x] Nenhum evento liga sozinho: sem nada ligado, não há evento nem dentro do período.
- [x] Datas móveis corretas: Páscoa 2026 = 05/04, Carnaval 2026 = 17/02, Mães 2026 = 10/05, Pais 2026 = 09/08, Black Friday 2026 = 27/11, Páscoa 2027 = 28/03.
- [x] Namorados vence Junina entre 05/06 e 12/06; Dia de jogo vence qualquer outro durante a janela.
- [x] Os 13 eventos renderizam nos 4 templates: topo, faixa com contagem, coleção, acessório em 1 a cada 3 fotos, ícone nas seções.
- [x] Partículas na vitrine e na confirmação garantida; nenhuma no checkout nem sobre o Pix pendente; pausa com a aba oculta.
- [x] Trilha das etapas com o corredor do evento andando a cada etapa (some a barra de progresso padrão do template).
- [x] Aviso e confirmação com os textos do evento; explosão ao adicionar e na confirmação.
- [x] Natal: neve acumulada nos botões principais. Black Friday: contagem ao vivo até o fim.
- [x] Páscoa e Halloween: jogo só com cupom configurado; cupom validado no servidor.
- [x] "Cores do evento" desligado mantém a cor da loja; "Animações" desligado e movimento reduzido deixam tudo estático.
- [x] Sem evento ativo: cardápio idêntico ao template puro, sem baixar nada do evento.
- [x] 375 px sem rolagem horizontal; nada decorativo intercepta toque.
- [x] Só o presidente grava; o gerente vê. Alteração auditada.
- [x] O pedido enviado ao servidor é o mesmo com e sem evento.

## 8. RegemBoard (menu board nas TVs)

O mesmo evento aparece nas TVs. A especificação do lado do RegemBoard está em `docs/eventos-sazonais-tv.md` do repositório `regemboard` (cópia em `08-eventos-no-regemboard.md` aqui). Enquanto não existir integração entre os dois sistemas, cada um tem o próprio cadastro de eventos com as **mesmas regras de calendário**; a integração (o Regem publica a config e o RegemBoard lê) fica para a Fase B. ⚠️ A especificação do RegemBoard ainda descreve o período em `MM-DD` e o modo "automático"; ao implementar lá, usar o mesmo modelo daqui (ligado por evento, dias antes/depois).

## 9. O que mudou em relação à primeira versão desta especificação

| Estava | Ficou | Por quê |
|---|---|---|
| `modo: "auto"` como padrão (os eventos ligavam sozinhos pela data) | sem modo: cada evento tem a chave `ativo`, desligada por padrão | decisão do dono (01/10/2026): o presidente ativa só os que deseja usar. No automático, todas as lojas virariam "Dia das Crianças" no dia do deploy |
| período por `inicio`/`fim` em `MM-DD` | `diasAntes` / `diasDepois` do dia do evento | `MM-DD` não serve para data móvel (Páscoa, Carnaval, Mães, Pais, Black Friday) e quebra no Réveillon, que cruza o ano |
| `modo` fixo num evento (para testar) | prévia pelo link `?evento=` | ver um evento não pode exigir colocá-lo no ar |
| admin em "Delivery → Aparência → Eventos" | Delivery → Configurações → Eventos | a aba "Aparência" não existe; é ao lado de "Modelo do cardápio" |
| gravação pela rota geral de configuração | rota própria, só presidente, com auditoria | a rota geral aceita gerente, não confere os campos e junta o tema por cima (uma tela aberta antes apagaria os eventos) |
| `evento` entra no cache do cardápio público, que vira à meia-noite | calculado a cada leitura | não existe cache da leitura pública; a conta é barata |
| `slotsEvento` no contrato `CardapioTemplate` | encaixes de `contexto.tsx` nas vitrines | o contrato não existe no código; as vitrines são quatro componentes |
| fontes por `next/font/google` | `@font-face` com arquivos do repositório | o build do `.zip` do servidor da loja não pode buscar nada no Google |
| lista de termos do Dia de jogo no console de distribuição | lista fixa no código | menos uma tela; muda por PR |
| textos padrão com "do Mister", "chega já já", "encomende até 23/12" | textos neutros; o presidente escreve os da loja dele | o produto é multi-loja e o pedido pode ser retirada ou mesa; prazo é promessa que só a loja pode fazer |
| confirmação comemora sempre | só com o pedido garantido | com Pix pendente, o confete caía sobre o código e o botão "Copiar código" |
