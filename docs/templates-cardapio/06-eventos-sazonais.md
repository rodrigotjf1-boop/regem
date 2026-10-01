# 06 · Eventos sazonais do cardápio

> Pré-requisito: Fase 0 do `00-base-cardapio.md` e pelo menos um template novo. Referência visual: protótipo, painel **Evento sazonal** (ou a tabela **Agenda de eventos**, botão "Ver no celular").

## 1. Conceito

Uma **camada de evento** que se aplica por cima de qualquer template (`galeria`, `balcao`, `oferta`, `fluxo`). O template continua o mesmo; o evento acrescenta clima e diversão:

- partículas animadas (neve, confete, corações, morcegos…);
- enfeite no topo (pisca-pisca, bandeirinhas, teia de aranha…);
- acessório em 1 a cada 3 fotos (touca de Papai Noel, orelhas de coelho, chapéu de bruxa…);
- ícone temático nos títulos de seção;
- faixa do evento com contagem regressiva e uma coleção de produtos;
- trilha temática nas etapas do checkout (o trenó, o coelho ou o fantasminha andam conforme o cliente avança);
- textos do toast e da confirmação no clima do evento;
- explosão de partículas ao adicionar um item e na confirmação;
- mini-jogo opcional que libera cupom (Páscoa e Halloween).

**Regra de ouro: festa na vitrine, foco no checkout, festa de novo na confirmação.** No checkout não caem partículas; só a trilha das etapas e as cores lembram o evento.

## 2. Os 13 eventos

| Chave | Evento | No ar (automático) | Cor | Partículas | Topo | Acessório na foto | Trilha | Extra |
|---|---|---|---|---|---|---|---|---|
| `reveillon` | Réveillon | 26/12 a 01/01 | dourado `#B8860B` | estrelas + fogos | estrelas penduradas | chapéu de festa | foguete | fogos na confirmação |
| `carnaval` | Carnaval | sexta antes até quarta de cinzas (Páscoa − 47) | roxo `#7C3AED` | confete + serpentina | serpentinas | máscara de colombina | máscara | trilha arco-íris correndo |
| `pascoa` | Páscoa | semana santa (Páscoa − 7 até Páscoa) | chocolate `#7B4A2E` | pétalas + ovinhos pastel | varal de ovos | orelhas de coelho | coelho pulando | **caça aos ovos** |
| `maes` | Dia das Mães | 7 dias antes do 2º domingo de maio | rosa `#D6455D` | pétalas de rosa | ramo de flores | flor | flor | — |
| `namorados` | Dia dos Namorados | 05/06 a 12/06 | vermelho `#E11D48` | corações subindo | varal de corações | coração flechado | coração com asas | — |
| `junina` | Festa Junina | 01/06 a 30/06 (Namorados tem prioridade) | laranja `#C2410C` | pipoca | bandeirinhas | chapéu de palha | fogueira | faixa em chita |
| `pais` | Dia dos Pais | 7 dias antes do 2º domingo de agosto | azul `#1E3A5F` | confete azul e caramelo | faixa xadrez + gravata | bigode | gravata-borboleta | — |
| `criancas` | Dia das Crianças | 01/10 a 12/10 | azul `#2563EB` | balões + confete | bandeirolas + balões | boné de hélice girando | aviãozinho | — |
| `halloween` | Halloween | 20/10 a 31/10 | abóbora `#EA580C` | morcegos + folhas | teia com aranha descendo | chapéu de bruxa | fantasminha | **gostosuras ou travessuras** |
| `blackfriday` | Black Friday | segunda a domingo da semana da Black (sexta após a 4ª quinta de novembro) | preto `#0A0A0A` | etiquetas caindo | fita "Black Friday" correndo | etiqueta Black | carrinho | contagem até o fim, ao vivo |
| `natal` | Natal | 01/12 a 25/12 | vermelho `#C8102E` | neve | pisca-pisca | touca de Papai Noel | trenó | neve acumulada nos botões |
| `hamburguer` | Dia do Hambúrguer | 21/05 a 28/05 (vence Dia das Mães se cruzar) | ketchup `#C1121F` | gergelim + mini burguers | varal de hambúrgueres | chapéu de chef | burguer de pernas correndo | faixa mostarda com gergelim |
| `jogo` | Dia de jogo | **por jogo cadastrado**: 3 h antes até 2h30 depois do horário | gramado `#15803D` | papel picado branco e verde | faixa de gramado com a bola rolando | bola de futebol | bola rolando | contagem até a bola rolar, **sem times** |

Prioridade extra: Dia de jogo > Namorados e Dia do Hambúrguer > os demais > Junina.

Datas móveis, calculadas no servidor (fuso `America/Sao_Paulo`):
- **Páscoa:** algoritmo de Gauss/Meeus (computus gregoriano).
- **Carnaval:** terça = Páscoa − 47 dias.
- **Dia das Mães:** 2º domingo de maio.
- **Dia dos Pais:** 2º domingo de agosto.
- **Black Friday:** sexta seguinte à 4ª quinta de novembro.
- **Dia do Hambúrguer:** fixo em 28/05.


### Textos de cada evento (padrão, editáveis pelo lojista)

| Evento | Faixa (título · texto) | Coleção | Toast ao adicionar | Confirmação |
|---|---|---|---|---|
| Réveillon | A virada é com a gente · Combos pra festa. Pedidos até 31/12 às 20h. | Pra virada | "{item} garantido pra virada" | Feliz Ano Novo! · Seu pedido chega antes da contagem regressiva. |
| Carnaval | Bloco do Mister · Combos pra recarregar entre um bloco e outro. | Pra curtir o bloco | "{item} entrou no bloco" | Ê, folia! · Seu pedido saiu no bloco e chega já já. |
| Páscoa | Caça aos ovos · Ache os 3 ovinhos escondidos no cardápio e ganhe 10% de desconto. | Doces de Páscoa | "{item} foi pra cesta" | Pedido na cesta! · O coelho já está preparando tudo. |
| Dia das Mães | Pra mãe, o melhor · É presente? Conte na observação e a gente capricha. | Pra mãe | "{item} na sacola, com carinho" | Com carinho! · Feito com o mesmo cuidado de mãe. |
| Namorados | Amor à primeira mordida · Combos pra dividir a dois. Ou não, a gente não julga. | Pra dividir a dois | "{item} conquistou seu coração" | Match perfeito! · Seu pedido sai da cozinha com carinho. |
| Junina | Arraiá do Mister · Anarriê! Porções e doces pra sua quadrilha. | Do arraiá | "Arriá! {item} tá na sacola" | Anarriê! · Seu pedido tá vindo, sô! |
| Pais | Paizão merece · O combo completo, sem dividir a batata. | Pro paizão | "{item} na sacola do paizão" | Paizão aprovou! · Pedido a caminho, sem enrolação. |
| Crianças | Hoje a criançada manda · Trio Kids, milkshake e sobremesas pra comemorar. | Kids | "Oba! {item} na sacola" | Oba! · Pedido a caminho, criançada! |
| Halloween | Gostosuras ou travessuras? · Toque na abóbora e descubra o que te espera. | Gostosuras | "{item} caiu no caldeirão" | Gostosura garantida! · Seu pedido vai voando… de vassoura. |
| Black Friday | Preço Black no Mister · Combos com até X% off. Só até domingo. | Ofertas Black | "{item} garantido no preço Black" | Oferta garantida! · Você pegou o preço Black. |
| Natal | Natal do Mister · Ceia sem trabalho: encomende até 23/12 e receba na véspera. | Ceia do Mister | "{item} foi pro saco do Papai Noel" | Ho ho ho! · Seu pedido já está no trenó. |
| Dia do Hambúrguer | O dia mais gostoso do ano · 28/05 é o nosso feriado: monte o seu e comemore com a gente. | Os campeões da casa | "{item} foi pra chapa" | Na chapa! · Seu burguer já está fritando. |
| Dia de jogo | Hoje tem jogo na TV · Monte o combo da torcida e receba antes da bola rolar. | Combo da torcida | "{item} escalado pro jogo" | Golaço! · Seu pedido já entrou em campo. |

### Dia de jogo: regras próprias

- **Não é por data fixa.** O lojista cadastra os jogos em "Eventos → Dias de jogo": data, hora e uma chamada opcional de até 40 caracteres (ex.: "Final do campeonato", "Jogo das 21h30").
- **Sem times, escudos ou marcas de campeonato.** O campo de chamada mostra o aviso "Não use nome de time nem de campeonato" e o servidor recusa uma lista básica de termos (nomes dos clubes da Série A e B, "Brasileirão", "Libertadores", "Copa do Brasil" e similares, configurável no console de distribuição). A arte é neutra: gramado, bola, "AO VIVO".
- **Liga e desliga sozinho:** do início da janela (3 h antes) até 2h30 depois do horário. Nesse período **vence qualquer outro evento** e depois devolve o evento do dia.
- **A contagem acompanha o jogo:** "Bola rola às 21:30 · faltam 2h05" → "Bola rolando: peça sem sair do sofá" → "Fim de jogo: pede a saideira".
- O mesmo cadastro alimenta o RegemBoard (seção 8).

O "X%" da Black Friday é o maior desconto real entre os produtos com `precoDe`. Textos com data (Natal, Réveillon) só aparecem se o lojista confirmar a data no admin; sem confirmação, usa a versão sem data.

## 3. Onde fica a configuração (sem migration)

No `cardapio_config.tema_config` (jsonb que já existe), chave `eventos`:

```jsonc
"eventos": {
  "modo": "auto",            // "auto" (pela data) | "desligado" | uma chave fixa, ex. "natal"
  "animacoes": true,          // partículas e explosões
  "coresDoEvento": true,      // botões na cor do evento; false mantém a cor da loja
  "jogos": [{ "inicio": "2026-10-01T21:30:00-03:00", "chamada": "Jogo das 21h30" }],  // Dia de jogo
  "porEvento": {
    "natal": {
      "ativo": true,           // false tira o evento do modo automático
      "inicio": "12-01", "fim": "12-25",   // opcional: sobrescreve a janela padrão (MM-DD)
      "titulo": "Natal do Mister", "texto": "Ceia sem trabalho…",
      "colecao": ["<produtoId>", "..."],   // vazio = usa os produtos com selo/destaque
      "cupomJogo": null        // só Páscoa/Halloween: id de um cupom da loja (seção 6)
    }
  }
}
```

- **Backend (`cardapio.service.ts`):**
  - a gravação (≈ l.379) já faz merge de `temaConfig`; validar `eventos` com DTO (chaves conhecidas, datas `MM-DD`, ids de produto do próprio tenant, cupom do próprio tenant);
  - a leitura pública (≈ l.1369) devolve um campo novo **`evento` já resolvido**: `{ chave, nome, inicio, fim, dia, titulo, texto, colecao: [ids], cores, animacoes, jogo: { tipo, cupomCodigo } | null }` ou `null`. **O servidor decide o evento ativo pela data em `America/Sao_Paulo`**, para todos os clientes verem o mesmo tema e não depender do relógio do celular;
  - `evento` entra no cache do cardápio público; a virada de dia invalida a chave (TTL até a próxima meia-noite).
- **Admin:** nova aba **Delivery → Aparência → Eventos** com:
  - modo (automático, desligado, fixo);
  - agenda dos próximos 12 meses com um interruptor por evento e "Ver prévia";
  - edição de datas, título, texto e coleção (seletor de produtos);
  - interruptores "Animações" e "Cores do evento";
  - para Páscoa e Halloween, o seletor "Cupom do jogo" (lista os cupons ativos da loja; sem cupom, o jogo não aparece).

  Registrar a decisão em `docs/decisoes-design.md` §6.

## 4. Estrutura no front

```
frontend/src/components/loja/eventos/
├── eventos.ts            ← catálogo dos 13 eventos (cores, textos padrão, tipo de partícula, peças) — só apresentação
├── CamadaParticulas.tsx  ← 1 <canvas> fixo sobre o cardápio, pointer-events: none
├── Guirlanda.tsx         ← enfeite do topo (varal genérico + teia, fita, xadrez, serpentinas)
├── FaixaEvento.tsx       ← faixa com contagem, botão para a coleção e o mini-jogo
├── ColecaoEvento.tsx     ← carrossel da coleção
├── Acessorio.tsx         ← acessório na foto (canto, topo ou bigode)
├── TrilhaEtapas.tsx      ← trilha das etapas com o "corredor"
├── jogos/CacaOvos.tsx, jogos/Abobora.tsx
└── arte/*.tsx            ← SVGs desenhados à mão (um componente por peça), sem imagem externa
app/c/[token]/eventos.css ← tokens --ev-* e animações, sempre sob .ev-on.ev-<chave>
```

- O root do cardápio ganha `ev-on ev-<chave>` quando `menu.evento` existe. Tudo fica escopado nessas classes; sem evento, nada muda.
- `CardapioTemplate` (00, §4.2) ganha um ponto de inserção: `slotsEvento: { aposCabecalho, seletoresFotos, cabecalhoCheckout }`, para cada template dizer onde a faixa entra e quais fotos recebem acessório. Templates não importam nada de `eventos/` diretamente.
- **Fontes do evento** (só no título da faixa e no "kicker" da confirmação): Mountains of Christmas, Cinzel, Bungee, Sniglet, Playfair Display itálico, Dancing Script, Rye, Alfa Slab One, Fredoka, Creepster, Anton. Usar `next/font/google` dentro do módulo do evento, carregado com `dynamic()`, para só baixar a fonte do evento ativo.
- Cupom do jogo e desconto continuam **validados no servidor** (`cardapioCupomValidar`); o front só preenche o código.

## 5. Regras de desempenho e acessibilidade

1. **Um canvas só**, lista fixa de partículas (máx. 50 no celular), sem alocar por quadro. Pausa com `document.hidden` e para de desenhar quando não há partículas.
2. **Sem partículas no checkout.** Na vitrine e na confirmação, sim.
3. `prefers-reduced-motion` ou "Animações" desligado: sem canvas, sem pisca-pisca, sem balanço; enfeites e acessórios ficam estáticos.
4. Acessório no máximo em **1 a cada 3 fotos** e nunca sobre preço, selo de desconto ou botão +. Fotos ficam com cantos arredondados por dentro; o acessório pode sair para fora.
5. Tudo decorativo com `aria-hidden="true"`. Os ovos da Páscoa são `role="button"` com rótulo e funcionam no teclado.
6. Contraste: textos da faixa testados com os fundos do evento (AA). As cores do evento só trocam a cor de ação; os tokens do template continuam.
7. Sem som e sem vibração.
8. Peso: as artes são SVG inline (poucos KB). Nada de GIF ou vídeo.

## 6. Mini-jogos (opcionais, liberam só desconto)

- **Caça aos ovos (Páscoa).** 3 ovinhos escondidos em fotos de produtos de seções diferentes (escolha fixa por sessão). Cada ovo tocado some com uma chuva de ovinhos e o contador "N de 3" na faixa avança. No terceiro, o código do cupom configurado é aplicado e aparece "Cupom aplicado".
- **Gostosuras ou travessuras (Halloween).** A abóbora da faixa balança. Ao tocar, 50% "Gostosura!" (chuva de doces) e 50% "Travessura!" (a tela treme e uma revoada de morcegos atravessa). Nos dois casos o cupom é aplicado. Uma vez por sessão.
- Sem cupom configurado, o jogo não aparece e a faixa usa o texto normal. Limite de uso do cupom é regra do próprio cupom (por telefone, como hoje).

## 7. Checklist de aceite

- [ ] `temaConfig.eventos` validado; leitura pública devolve `evento` resolvido pela data de São Paulo, com cache que vira à meia-noite.
- [ ] Datas móveis corretas: Páscoa 2026 = 05/04, Carnaval 2026 = 17/02, Mães 2026 = 10/05, Pais 2026 = 09/08, Black Friday 2026 = 27/11, Páscoa 2027 = 28/03.
- [ ] Namorados vence Junina entre 05/06 e 12/06.
- [ ] Os 13 eventos renderizam nos 4 templates: topo, faixa com contagem, coleção, acessório em 1 a cada 3 fotos, ícone nas seções.
- [ ] Partículas na vitrine e na confirmação; nenhuma no checkout; pausa com a aba oculta.
- [ ] Trilha das etapas com o corredor do evento andando a cada etapa (some a barra de progresso padrão do template).
- [ ] Toast e confirmação com os textos do evento; explosão ao adicionar e na confirmação.
- [ ] Natal: neve acumulada nos botões principais. Black Friday: contagem ao vivo até o fim.
- [ ] Páscoa e Halloween: jogo só com cupom configurado; cupom validado no servidor.
- [ ] "Cores do evento" desligado mantém a cor da loja; "Animações" desligado e movimento reduzido deixam tudo estático.
- [ ] Sem evento ativo: cardápio idêntico ao template puro.
- [ ] 375 px sem rolagem horizontal; nada decorativo intercepta toque.

## 8. RegemBoard (menu board nas TVs)

O mesmo evento aparece nas TVs. A especificação do lado do RegemBoard está em `docs/eventos-sazonais-tv.md` do repositório `regemboard` (cópia em `08-eventos-no-regemboard.md` aqui). Enquanto não existir integração entre os dois sistemas, cada um tem o próprio cadastro de eventos com as **mesmas regras de calendário**; a integração (o Regem publica a config e o RegemBoard lê) fica para a Fase B.
