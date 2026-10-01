# Prompts prontos para o Claude Code

Cole um prompt por vez, na raiz do repositório certo. Cada um pede o plano antes do código, como manda o `CLAUDE.md` do Regem.

---

## 1. Regem: cardápio digital com eventos sazonais e clube de recompra

> Repositório: `rodrigotjf1-boop/regem`. Antes, faça o merge do PR da branch `docs/templates-cardapio` (só documentação e protótipo).

```text
Leia por inteiro o CLAUDE.md e, em docs/templates-cardapio/, os arquivos README.md, 00-base-cardapio.md, 05-recursos-integrados.md, 06-eventos-sazonais.md e 07-clube-de-recompra.md. Abra o protótipo docs/templates-cardapio/prototipo/prototipo-interativo.html e use o painel da esquerda: os 4 templates, a situação da loja, o "Evento sazonal" (13 eventos, incluindo Dia do Hambúrguer e Dia de jogo) e o "Clube de recompra" (raspadinha, selos, aniversário e meta do mês).

Objetivo: implementar, em PRs pequenos e nesta ordem,
1) Fase 0 da base dos templates (00 §4), sem mudar os temas classic, fastfood e grid;
2) o template Regem Fluxo (04);
3) a camada de eventos sazonais (06): backend do `evento` resolvido pela data de São Paulo com os jogos cadastrados, admin "Eventos" com a agenda e os Dias de jogo, depois a camada no front com Natal, Halloween, Dia do Hambúrguer e Dia de jogo, depois os demais eventos, depois os mini-jogos;
4) o clube de recompra (07 §5, PR 1 a PR 4).

Regras que não podem ser quebradas:
- Dia de jogo nunca mostra nome de time, escudo, cor de clube ou marca de campeonato; a chamada do lojista tem até 40 caracteres e a API recusa termos proibidos.
- No clube, nenhum benefício é sorteado: todo cliente que cumpre a regra ganha, sem "primeiros N", sem estoque limitado e sem quantidade total de prêmios (07 §1).
- Antes de criar migration, confira o último número em origin/main e use o próximo.
- RBAC e validação no servidor; cliente só vê o próprio estado pelo token do cliente.

Comece só pelo item 1: apresente o plano da Fase 0 e aguarde minha aprovação. Em cada PR, rode npm run build no backend e no frontend, compare com o protótipo, liste as divergências e use o checklist de aceite do arquivo correspondente.
```

---

## 2. RegemBoard: os mesmos eventos no menu board das TVs

> Repositório: `rodrigotjf1-boop/regemboard`. A especificação está na branch `docs/eventos-sazonais-tv`, em `docs/eventos-sazonais-tv.md` (abra o PR dela e faça o merge antes).

```text
Leia o README.md, docs/modelos/README.md, docs/modelos/IMPLEMENTACAO-REGEMBOARD.md e docs/eventos-sazonais-tv.md por inteiro. A referência visual é o protótipo do cardápio do Regem (repositório público rodrigotjf1-boop/regem, arquivo docs/templates-cardapio/prototipo/prototipo-interativo.html, painel "Evento sazonal"): as artes, cores, textos e partículas devem ser os mesmos, adaptados para TV.

Objetivo: uma camada de eventos sazonais no player das TVs, por cima de qualquer modelo, com os 13 eventos (incluindo Dia do Hambúrguer em 28/05 e Dia de jogo), mais o modelo novo "Cartaz do evento" no rodízio.

Pontos do código que já levantei (confirme antes de mexer):
- o player é docs/modelos/player.html (iframes com crossfade), rodando no ModelosView.kt e servido offline pelo PonteBoard.kt; a camada entra no player, acima dos iframes;
- módulos novos em docs/modelos/shared/ no padrão do agenda.js (funções puras): eventos.js, eventos-arte.js, eventos-camada.js e eventos.css; modelo novo templates/evento.html registrado em shared/modelos.js;
- os arquivos novos entram em entraNoPacote (api/src/publicacoes/pacote-modelos.service.ts), com no máximo +60 KB no pacote e sem fonte nova;
- a config fica em contas.aparencia.eventos (jsonb, sem migration), validada em api/src/catalogo/aparencia.ts, e vai para a TV no manifesto; a TV decide o evento pelo próprio relógio e pelo fuso da tela, para funcionar offline;
- nas TVs do mural, as partículas e o enfeite do topo são calculados no espaço do painel inteiro, com semente e tempo iguais, e cada TV desenha a sua fatia pela posicao; o selo do canto só aparece na TV da direita.

Regras que não podem ser quebradas:
- WebView Chromium 74: sem color-mix, clamp, gap em flex, :has, CSS aninhado, ?. e ??; rode node scripts/compat-webview74.mjs.
- No máximo 40 partículas a 30 fps, sem shadowBlur; TV fraca (tv/capacidade) ou "Animações" desligado deixa tudo estático; nada cobre preço nem nome de produto.
- Dia de jogo sem nome de time, escudo, cor de clube ou marca de campeonato; liga 3 h antes e desliga 2h30 depois de cada jogo cadastrado.

Apresente o plano e aguarde minha aprovação. Depois implemente em PRs: (1) shared/eventos.js com os testes em docs/modelos/testes/eventos.test.mjs (datas, prioridades, janela do jogo, determinismo entre TVs); (2) camada no player e cartaz do evento; (3) admin "Aparência → Eventos" com a agenda, os Dias de jogo e a prévia na parede simulada. Use o checklist de aceite do docs/eventos-sazonais-tv.md em cada PR.
```
