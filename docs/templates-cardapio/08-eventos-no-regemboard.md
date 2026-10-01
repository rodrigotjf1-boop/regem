# 08 · Eventos sazonais nas TVs (RegemBoard) — cópia de referência

> Cópia de `docs/eventos-sazonais-tv.md` do repositório `regemboard` (branch `docs/eventos-sazonais-tv`). A versão que vale para implementar é a de lá.

> Especificação para o Claude Code do RegemBoard. O mesmo conjunto de eventos do cardápio digital do Regem (`regem/docs/templates-cardapio/06-eventos-sazonais.md`), adaptado para a TV: sem toque, vista de longe, várias TVs lado a lado e hardware fraco.
>
> Referência visual: o protótipo do cardápio (`regem/docs/templates-cardapio/prototipo/prototipo-interativo.html`, painel "Evento sazonal"). As artes, cores, textos e partículas são as mesmas.

## 1. O que a TV ganha

Uma **camada de evento** por cima de qualquer modelo (tela cheia, grade, cardápio, quadro de preços…), sem mexer nos modelos:

1. **Partículas** caindo pela tela: neve no Natal, confete no Carnaval, corações no Dia dos Namorados, morcegos no Halloween, gergelim no Dia do Hambúrguer etc.
2. **Enfeite no topo**: pisca-pisca, bandeirinhas, teia com aranha, faixa de gramado com a bola rolando.
3. **Selo do evento** num canto: um círculo com a arte do evento e a contagem, como "Faltam 12 dias para o Natal" ou "Bola rola às 21:30".
4. **Cartaz do evento**, um modelo novo (`templates/evento.html`) que entra no rodízio de tempos em tempos. Ocupa a tela inteira com a arte grande, o título, a contagem e de 2 a 4 produtos da coleção do evento com preço.

Os 13 eventos e as datas automáticas são iguais aos do Regem:

| Evento | Período | Evento | Período |
|---|---|---|---|
| Réveillon | 26/12 a 01/01 | Dia dos Pais | 7 dias antes do 2º domingo de agosto |
| Carnaval | sexta a quarta de cinzas (Páscoa − 47) | Dia das Crianças | 01/10 a 12/10 |
| Páscoa | Páscoa − 7 até a Páscoa | Halloween | 20/10 a 31/10 |
| Dia das Mães | 7 dias antes do 2º domingo de maio | Black Friday | segunda a domingo da semana da Black |
| Dia do Hambúrguer | 21/05 a 28/05 | Natal | 01/12 a 25/12 |
| Dia dos Namorados | 05/06 a 12/06 | **Dia de jogo** | por jogo cadastrado: 3 h antes até 2h30 depois |
| Festa Junina | 01/06 a 30/06 | | |

Prioridade quando duas janelas se cruzam: Dia de jogo > Namorados e Dia do Hambúrguer > os demais > Junina.

### Dia de jogo

- O lojista cadastra **data, hora e uma chamada opcional** (até 40 caracteres, ex.: "Final do campeonato").
- **Nunca nome de time, escudo, cores de clube ou marca de campeonato.** A arte é neutra: gramado, bola, uma TV com "AO VIVO".
- O campo avisa "Não use nome de time nem de campeonato" e a API recusa uma lista básica de termos (clubes das Séries A e B, "Brasileirão", "Libertadores", "Copa do Brasil"…).
- Na TV, a contagem segue o jogo:
  1. antes: "Hoje tem jogo · Bola rola às 21:30";
  2. durante: "Bola rolando: peça o combo da torcida";
  3. depois: "Fim de jogo: a saideira é aqui".
- No período do jogo, o cartaz do evento entra no rodízio com **mais frequência**: a cada 4 min, em vez de 10.

## 2. Onde entra no código (levantado do repositório)

- **O player é o `docs/modelos/player.html`.** Ele carrega os modelos em iframes, faz a troca com crossfade e roda no `ModelosView.kt` (WebView), servido offline pelo `PonteBoard.kt` em `tv.regemboard.local`.
- **A camada de evento mora no `player.html`, acima dos iframes.** Assim vale para todos os modelos de uma vez e não reinicia a cada troca de modelo.
- **Módulos novos em `docs/modelos/shared/`**, no mesmo padrão do `agenda.js` (funções puras que rodam no navegador e no Node):
  - `eventos.js`: calendário (datas móveis, janelas, prioridade, jogos), `eventoAtivo(agora, config)`, `contagem(evento, agora)` e textos;
  - `eventos-arte.js`: as artes em SVG inline (acessórios, ícones, herói), copiadas do protótipo;
  - `eventos-camada.js`: canvas de partículas, enfeite do topo e selo do canto;
  - `eventos.css`: tokens `--ev-*` por evento e animações.
- **Modelo novo** `templates/evento.html`, registrado em `shared/modelos.js` (o padrão de "modelo novo" do README). Recebe pelo contrato de dados atual os produtos da coleção e `opcoes.evento`.
- **Pacote dos modelos:** os arquivos novos entram em `entraNoPacote` (`api/src/publicacoes/pacote-modelos.service.ts`). Hoje o pacote tem cerca de 180 KB. **Orçamento: no máximo +60 KB.** Por isso as artes são SVG inline e **não há fonte nova**: títulos em Archivo e Figtree, que já vão no pacote.
- **Modos `imagens` e `video`:** nesta fase o evento só aparece no modo `modelos` (WebView). Uma camada nativa para os outros modos fica para depois.

## 3. Várias TVs como um painel só

As TVs do mural sincronizam pelo relógio (`floor(instante/intervalo) % n`). As partículas e o enfeite do topo seguem a mesma ideia, para a neve **atravessar de uma TV para a outra**:

- Cada TV simula as partículas no **espaço do painel inteiro** (largura = número de TVs × largura de uma tela), com a mesma semente: `semente = dia do ano + chave do evento`.
- A posição de cada partícula é **função do tempo**, `x(t), y(t)` calculados a partir de `Date.now()`, e não de um estado acumulado quadro a quadro. Assim TVs ligadas em momentos diferentes mostram a mesma cena.
- Cada TV desenha só a sua fatia: `deslocamento = posicao × largura` (de `prog.tela.posicao`, a mesma posição do rodízio) e o total de TVs do grupo. Confira no código se o manifesto já informa o total do grupo; se não, acrescente `tela.totalNoGrupo`. Sem grupo, a TV roda sozinha (deslocamento 0, total 1).
- O enfeite do topo (varal, gramado) também é desenhado em coordenadas do painel, então o fio do pisca-pisca continua de uma TV para a outra. A bola da faixa de gramado atravessa as 3 TVs.
- O selo do canto aparece **só na TV da direita** (maior `posicao`). O cartaz do evento usa o rodízio que já existe.

## 4. Desempenho (TV box com Android 10 e WebView Chromium 74)

1. **Compatibilidade:**
   - nada de `color-mix`, `clamp()`, `gap` em flex, `:has()` ou CSS aninhado;
   - rode `node scripts/compat-webview74.mjs` antes do PR;
   - JS em ES2017, sem `?.` nem `??` no código do player (siga o estilo do `player.html`, com `var` e `function`).
2. **Partículas:**
   - um único `<canvas>` em tela cheia, `pointer-events: none`;
   - no máximo **40 partículas** por TV;
   - **30 quadros por segundo** (pula um quadro sim, outro não no `requestAnimationFrame`);
   - sem `shadowBlur` e sem filtros no canvas.
3. **Capacidade da TV:** use o que o app já reporta em `POST tv/capacidade`. Em aparelho fraco, ou com "Animações" desligado, não há canvas: enfeite e selo ficam **estáticos**.
4. **Pausar:** pare de desenhar quando a TV sai do horário de funcionamento (`telaFora`) e quando o modo não é `modelos`.
5. **Limites de tela:** o enfeite ocupa no máximo **6% da altura** e nada cobre preço nem nome de produto. As partículas ficam no máximo com `opacity: .85` e não cruzam a faixa de preço do rodapé (saem pela borda acima dela).

## 5. Dados e configuração

- **Onde fica:** em `contas.aparencia` (jsonb, mig. 020), chave `eventos`, validada em `api/src/catalogo/aparencia.ts`. **Sem migration.**
  ```jsonc
  "eventos": {
    "modo": "auto",              // auto | desligado | <chave fixa>
    "animacoes": true,
    "cartazACada": 10,           // minutos entre um cartaz e outro (no jogo: 4)
    "cartazSegundos": 15,
    "porEvento": { "natal": { "ativo": true, "inicio": "12-01", "fim": "12-25", "titulo": "Natal do Mister", "texto": "…", "colecao": ["<produtoId>"] } },
    "jogos": [{ "inicio": "2026-10-01T21:30:00-03:00", "chamada": "Jogo das 21h30" }]
  }
  ```
- **Vai para a TV** pelo manifesto (`GET tv/manifesto`), dentro de `opcoes`. A TV **decide o evento sozinha pelo relógio** com `shared/eventos.js`, para funcionar offline.
- **Fuso:** use `prog.tela.fuso` (já existe no player) para calcular o dia.
- **Admin:**
  - página "Aparência → Eventos" com a agenda dos próximos 12 meses e um interruptor por evento;
  - edição de datas, textos e coleção (com o `seletor-produtos.tsx`);
  - lista de **Dias de jogo** (data, hora, chamada);
  - "Animações" ligado ou desligado, e o intervalo do cartaz;
  - **prévia na parede simulada** (`parede-simulada.tsx`) com um seletor de data simulada.

## 6. Testes

- `docs/modelos/testes/eventos.test.mjs` (`node --test`), no padrão do `agenda.test.mjs`. Deve conferir:
  - as datas móveis: Páscoa 2026 = 05/04, Carnaval 2026 = 17/02, Mães 2026 = 10/05, Pais 2026 = 09/08, Black Friday 2026 = 27/11, Páscoa 2027 = 28/03;
  - as prioridades: jogo vence tudo; Namorados vence Junina;
  - a janela do jogo: 3 h antes, 2h30 depois;
  - o determinismo: a mesma semente e o mesmo instante dão as mesmas posições nas 3 TVs.
- Testes da API (jest) para a validação de `eventos` na aparência: datas `MM-DD`, ids de produto da própria conta, chamada do jogo sem termos proibidos e com até 40 caracteres.
- Teste manual: 3 TVs (ou 3 abas do `player.html` com `?posicao=0/1/2`) mostrando a neve contínua.

## 7. Checklist de aceite

- [ ] Os 13 eventos aparecem em todos os modelos no modo `modelos`, com partículas, enfeite do topo e selo do canto.
- [ ] Cartaz do evento entra no rodízio no intervalo configurado (no jogo, com mais frequência).
- [ ] Dia de jogo: liga 3 h antes, desliga 2h30 depois, contagem antes/durante/depois, nenhum nome de time aceito.
- [ ] Mural: a neve e o enfeite continuam de uma TV para a outra; o selo aparece só na TV da direita.
- [ ] Funciona offline com o relógio da TV e o fuso da tela.
- [ ] `compat-webview74.mjs` verde; pacote dos modelos com no máximo +60 KB; no máximo 40 partículas a 30 fps.
- [ ] TV fraca ou "Animações" desligado: tudo estático.
- [ ] Nada cobre preço nem nome de produto.
