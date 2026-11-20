# Roteiros de tela

Roteiros que abrem o app **buildado** num Chrome sem janela, com a **API e o tempo real simulados** (nada de banco nem de
login de verdade), tocam na tela como a pessoa tocaria e conferem o resultado. Também medem cada tela em **16 larguras**
(320 a 1920), com a gaveta e cada diálogo abertos: nenhuma barra de rolagem horizontal, nada cortado, nada fora da janela
e toque grande o bastante.

**Não rodam no CI** (para não gastar a cota do GitHub Actions): rodam no PC, antes do PR que mexe nessas telas.

## Rodar

Dentro de `frontend/`:

```sh
cd roteiros && npm ci && cd ..   # uma vez: instala o Playwright (sem baixar navegador; usa o Chrome do PC)
npm run build                    # depois de mexer na tela
npm run roteiros                 # todos
npm run roteiros -- kds tv       # só esses
npm run roteiros -- --rapido     # 5 larguras em vez de 16
npm run roteiros -- --tudo       # mostra também cada conferência que passou
```

O comando sobe o `next start` numa porta livre, roda, para o servidor e mostra um quadro com as conferências e as falhas
de cada roteiro. Sai com código 1 se algo falhou. O detalhe fica em `roteiros/ultimo-resultado.txt` e as fotos em
`roteiros/fotos/` (os dois fora do git).

- Sem o Chrome: usa o Edge. Outro navegador: `ROTEIRO_CHROME=<caminho do executável>`.
- Contra um app que já está no ar: `npm run roteiros -- --base=http://localhost:3000` (não sobe outro).

## Os roteiros

| Roteiro | Tela | O que confere |
|---|---|---|
| `kds` | `/kds` | Larguras + 3 tablets, nos dois temas e nas letras 85/100/150%, com a gaveta, a aba "Avisos" e o diálogo abertos. Letras, cartão neutro, encomenda, o toque e a resposta do servidor, a recusa, o cancelado até o "Ciente", "Finalizar todos" só do que está na tela, as faixas (falha de leitura, aberto pela internet, sem conexão), os avisos de cada tela, a faixa da pausa. Cada origem (balcão, mesa, totem, iFood, 99 com o entregador, Anota Aí, cardápio com encomenda), o cartão cancelado e o pedido alterado (NOVO/TIRAR, o "Visto" no cartão e no rodapé). Os avisos guardados: o urgente do Farol que a tela recupera ao abrir, o "Ciente" no servidor e o dado noutra tela, o histórico de avisos com os filtros (também medido em cada largura). |
| `tv` | `/senhas` | A senha medida em pixels pela largura da TV; 8, 16, 25 e 60 senhas (a letra diminui até 60%, depois páginas a cada 8 s; nenhuma some). |
| `alertas` | `/kds/alertas` | Zoom livre, a loja e os KDS de cada alerta, "até o Ciente", a validação, a prévia da faixa, o "Testar"; larguras com a gaveta e o diálogo abertos. |
| `rota-cozinha` | `/rota-cozinha` | A rota, as notas, as impressoras, "Editar a ordem" (antes, depois, junto, incluir, renomear, arrastar), a recusa do despacho fora do fim, o corpo salvo, o simulador, a gaveta do KDS, a loja com servidor; larguras com a edição, o diálogo e a gaveta abertos. |
| `caixa-turno` | `/pdv/retirada` | O turno aberto há mais de 24 horas: o de hoje não pede nada; o de 2 dias pede o fechamento ao abrir a tela ("Depois", a faixa em alerta com a idade e a data, "Fechar turno" abrindo a contagem); larguras com o pedido aberto. |
| `pdv-balcao` | `/pdv` | O cartão do produto (17/11/2026): GRANDE por padrão (180 px ou mais, foto 4:3, nome de 17 px) e "Compactos" que encolhe na hora, grava nas preferências e reabre compacto; a foto do cadastro em cima (ou o ícone, sem foto), o nome dentro do cartão em 15 px ou mais, o preço, a contagem no pedido, o ícone do totem a pagar. A janela das etapas: larga no monitor, as opções em grade (as 6 bebidas em até 2 linhas), a foto de cada opção ao lado do nome, o combo de três etapas sem rolagem a 1080 px, e escolher e pôr no pedido. Em cada largura: a grade e a janela aberta sem barra para o lado. |
| `mister` | `/mister` e `/diretoria` | Em Visão C&O, o Mister nasce desligado, a chave DESLIGADA aparece sobre o cartão (contraste mínimo de 3:1) e um toque liga. Módulo desligado e gerente não abrem a tela nem chamam as rotas da IA; a chave colada vai sem espaço, o campo esvazia e ela não fica na página; a situação e o teste; a recusa do servidor; apagar com confirmação; o uso (rótulos, tokens, custo, total, vazio, erro, atalhos, período invertido); o guia em gaveta; larguras com a gaveta e o diálogo abertos. **Pessoas:** o presidente vê as duas partes e a lista inteira (quem é quem, o final do número, avisos parados, quem não ligou), sem telefone inteiro e sem "Editar o que pode"; a parte da IA só é lida quando aberta; ligar o próprio WhatsApp (a mensagem `MISTER …`, o código para a câmera, o link, a espera até "Ligado" e a tela parando de perguntar, o código vencido e "Gerar outro código", a recusa do servidor); desligar pede confirmação e manda a pessoa certa; o Mister indisponível trava o "Ligar"; o gerente vê só a própria linha, sem a faixa de partes, sem chamar a IA e com o item no menu; execução não entra; e as 16 larguras com os dois diálogos abertos. **Documentos (M3a parte 3):** o grupo "Conversa" em Avisos e relatórios salva pela mesma barra (só o ajuste da conversa, inteiro); a parte "Documentos" com a contagem, as cinco situações que filtram, a busca, o período que vai ao servidor, como cada um foi lido, o horário da loja, a gaveta com a origem de cada campo e "Ver nas contas a pagar", "Desfazer o lançamento" com o diálogo e a lista relida; vazio, erro com "Tentar de novo" e o gerente sem chamar a rota; em cada largura, a lista, a gaveta e o diálogo inteiros, nenhum texto esmagado e a foto da lista e da gaveta. **Boleto perto de vencer (M3a parte 4a):** o aviso no grupo "Documentos e dinheiro", com o "Já paguei" na descrição, e "Quando avisar do boleto" (o padrão 3 dias; "só no dia" salvo pela barra, com o aviso inteiro). |
| `mister-console` | `/distribuicao`, aba Mister | A aba só existe para a Diretoria. Número não conectado: "Conectar com a Meta" só libera com a forma escolhida (e, na forma "só na API", com o PIN de seis dígitos); o que vai ao servidor e o caminho com que a janela da Meta abre; a janela fechada e a recusa do servidor não mudam nada; os avisos da Meta aparecem; conectar não liga a chave geral. Conectado: os dados do número e o aviso da coexistência. Desligar o Mister e desconectar pedem confirmação (foco em "Cancelar", Tab preso, Esc cancela sem chamada). O número que caiu mostra a data e o motivo. As empresas com os rótulos, a busca que vai ao servidor (só a resposta mais nova vale), vazio, teto de linhas e erro com "Tentar de novo". Em cada largura: sem barra lateral, nada passa da tela, tabela no largo e cartões no estreito, com o diálogo aberto. A conexão por QR Code (Q2, `mockups/regem-mister-qr.html`): o aceite antes do 1º QR (e não de novo com o de agora), o QR na tela com a conferência a cada 3 s e o QR novo a cada 20 s ("renovar"), conectado (a forma vira o QR e o painel é relido), a troca nos dois sentidos com confirmação, desconectar, bloqueado com "Conectar outro número", caiu, o Evolution não configurado e a recusa do servidor; em cada largura, o aceite e o QR inteiros na tela e legíveis. |
| `area-entrega` | `/delivery/configuracoes?aba=area` | Os três modos (bairro, distância, desenhada), com a troca gravada na hora — e "Desenhada no mapa" sem área NÃO grava o modo (o servidor recusaria). Desenhar uma área clicando os cantos no mapa e fechando no primeiro; a gaveta (nome, taxa, tempo); salvar manda a lista inteira e liga o modo ("valendo"); "Testar um endereço" dentro e fora; "Converter as faixas de km em áreas"; a seta da ordem; apagar com confirmação; a recusa do servidor com a mensagem dele (e as alterações ficam); a única área pausada com o modo ligado não é mandada. Em cada largura: sem barra lateral, com a gaveta e com o diálogo abertos. O fundo do mapa vem vazio (sem rede). |
| `delivery-painel` | `/delivery` | As listas "Pedidos pendentes" e "Entregas em andamento" nunca rolam para o lado (ERR-430): em cada largura, a tabela inteira, a compacta (sem "Cód. ext." e a data) ou os cartões, pelo espaço que a lista tem — tabela na tela larga, cartões no celular. Nos cartões: tocar seleciona o pedido, a caixa marca sem selecionar, "Todos" marca a lista, o "Ordenar" e a seta reordenam. Na tabela: o cabeçalho ordena, a linha seleciona, a caixa marca. |
| `listas-largas` | `/formas-pagamento`, `/delivery/relatorios` e `/ordens-producao` (aba Relatório) | As três listas que rolavam para o lado (ERR-476): em cada largura, sem barra lateral e nada fora da janela — tabela na tela larga, cartões no celular. Nos cartões: "Editar" abre a forma certa (o diálogo inteiro na janela) e "N bairro(s)" abre os bairros do entregador. A faixa de partes desliza sem barra abaixo de 640 px, como decidido (07/10/2026). |
| `importar` | `/operacao?aba=produtos`, "Importar" | O assistente de importar produtos com a prévia simulada (ERR-476, a pendência da varredura). Em cada largura e de 640 a 712 px de 8 em 8 (a faixa que rolava), os passos 2 e 3 com o diálogo aberto: sem barra lateral e nada fora da janela. A conferência fica em colunas quando cabe no diálogo e empilhada quando não cabe, com a situação de cada produto uma vez só, e a caixa "Importar" responde ao toque. Girar o celular (660 → 1024 → 660) com a conferência aberta decide de novo pelo espaço. |
| `landing` | `/` (a página pública, antes do login) | Em cada largura: sem barra lateral e nada fora da janela (o botão "Testar grátis" do topo ficava cortado no celular e a 834 px); os três planos com os preços da tabela do app (129 / 199 / 299) e o do meio "recomendado"; o TEF com "em breve"; nenhuma das promessas que o produto não cumpre; nenhum link para `#`; sem botão flutuante. O `npm run check:landing` confere os planos contra o catálogo do servidor. |
| `candidatos-conducao` | `/candidatos` | Os indicadores do topo de Candidatos e a condução dos aprovados (F5b das vagas): em cada largura, os cinco números, "Ver por pessoa" abre a gaveta com cada pessoa (valor do mês, os dias da escala, quem fica fora da soma e por quê), sem barra lateral e nada fora da janela com a gaveta aberta, nenhum texto esmagado e a foto de cada indicador e de cada pessoa (ERR-432). A leitura que falha mostra "Tentar de novo", nunca R$ 0,00; ninguém aprovado: a gaveta explica. |
| `candidatos-origens` | `/candidatos` (aba QR codes e links) e `/v/<codigo>` | "De onde vêm as fichas" (F5a das vagas, mig 430): em cada largura, os totais do período, as origens com as barras e a taxa, a conta de cada QR, sem barra lateral, nada fora da janela, nenhum texto esmagado e a foto de cada origem. "7 dias" mostra a leitura de 7 mesmo com a de 30 chegando depois; a leitura que falha mostra "Tentar de novo", nunca zeros; sem abertura, o estado vazio. A página pública conta UMA abertura por aparelho por dia (o cookie guarda só o dia). |
| `candidatos-banco` | `/candidatos` | Avisar o banco de talentos (F4b, parte 1): a faixa "Vaga aberta" com quantos podem ser avisados; a gaveta com quem recebe ("Abrir no WhatsApp" com a mensagem pronta, "Marquei como avisado") e quem não recebe, com o motivo; em cada largura, nada fora da janela, nenhum texto esmagado e a foto de cada pessoa. "Marquei" manda a pessoa e a função e relê; trocar a função pede `?funcao=`; a leitura que falha mostra "Tentar de novo"; sem ninguém, a faixa some. F4b parte 2 (pelo número de marketing): todos marcados, a mensagem do modelo com os botões e "Por onde sai"; desmarcar atualiza o "Avisar N pessoas"; o envio manda a função e só os marcados, e quem entrou aparece "na fila" sem se marcar de novo; sem o modelo, "Avisar" trava e "Enviar o modelo à Meta" pede uma vez (depois, "em análise"); pelo Evolution, as respostas escritas e o ritmo; em cada largura, nada fora da janela nem esmagado. |
| `mister-link` | `/m/<código>` | A página do link com PIN do Mister (F4.2a, mig 433). Cada estado (pede o PIN, fazendo, feito, não deu, não autorizou, venceu, bloqueado) em cada largura: o texto, o rodapé, o topo com o nome comprido da empresa, sem barra lateral, nada fora da janela, nenhum texto esmagado, botões de toque. O PIN só com dígitos (até 6), "Autorizar" só com 4 ou mais, o errado diz quantas restam, limpa e volta ao campo; o certo mostra "Fazendo agora…" e a página acompanha até "Feito"; cinco errados bloqueiam; "Não autorizar" fecha sem PIN; o limite por minuto; o prazo que passa com a página aberta. Isolada: só as rotas do link, nada guardado no aparelho, `referrer` desligado, fora da busca, o campo sem guardar o PIN. |
| `mister-relatorio-link` | `/m/r/<código>` | A página do link para encaminhar do Mister (M3c, mig 443): o relatório do insumo para quem não tem usuário. Por hora e por dia (30 colunas) em cada largura, e sem venda em quatro: o título, quem pediu, o aviso "Só leitura · vale até", os números, o gráfico com os rótulos sem se encostar nem ser cortados, "De onde saiu", a fonte, o rodapé e o topo com o nome comprido da empresa; sem barra lateral, nada fora da janela, nenhum texto esmagado, botão de toque. Só leitura: nenhum campo, sem "Mudar o período", a página só faz GET. "Baixar PDF" baixa com o nome do servidor; o limite por minuto tem frase (nunca o erro cru); o link que deixa de valer com a página aberta tira o relatório da tela; "não vale" e a falha com "Tentar de novo". Isolada: só as rotas do link, nada guardado no aparelho, `referrer` desligado, fora da busca, nenhum link para fora. |
| `whatsapp-gasto` | `/whatsapp/gasto` | WhatsApp › Uso e gasto (G1 do protótipo `mockups/regem-whatsapp-gasto.html`, mig 445): em cada largura, sem barra para o lado nem texto esmagado, o gasto do mês, os tipos, o gráfico por dia, "De onde veio", os meses anteriores e a franquia de cada número; os estados (a Meta não respondeu com "Tentar de novo" que lê de novo, a primeira leitura, a conexão por QR Code, nenhum gasto); "Últimos 3 meses" vira "Gasto por mês", "Outro período" mostra as datas e o número escolhido vai na consulta; o gerente vê que a tela é do presidente e ela nem pede o gasto. |
| `graph-clique` | `/delivery/configuracoes?aba=integracoes`, `?aba=atendimento` e `/integracoes/graph/volta` | O DMS Graph pelo clique (G5b, mig 450): o cartão só com o Graph liberado para a empresa (fora do piloto, nem cartão nem linha); a janela antes de ligar (vale para a empresa inteira, a única permissão, "Conectar" leva à página do Graph) e para o gerente (sem "Conectar"); ligada (quem ligou, a última leitura em palavras, a reserva com o caminho de Mister › IA e uso, a franquia com os números e a barra rotulada, "Desligar" com confirmação e Cancelar que não desliga); a franquia acabou, sem reserva e desligada no Graph; "Quem lê as fotos agora" em Fotos do cliente; a volta (manda code, state e iss; ligou → Integrações; não ligou → a frase do servidor, o endereço limpo e "Voltar às integrações"); a empresa sem CNPJ (GR-8: o bloco, "Conectar" desligado, o campo com rótulo, "Salvar CNPJ" só com 14 números, vai ao servidor só com os números, o bloco some e "Conectar" liga; a recusa do servidor no bloco; o gerente sem o campo). Em cada largura, a janela aberta antes de ligar, sem CNPJ e na confirmação do desligar, e a volta que falhou: sem barra para o lado, nada fora da tela, texto não esmagado, botão de toque. |
| `avaliacoes` | `/delivery/avaliacoes`, `/r/…` e `/delivery/configuracoes?aba=robo` | A nota do pedido (fase A1 do protótipo `mockups/regem-avaliacao-pedido.html`, mig 453): Delivery › Avaliações em cada largura, sem barra para o lado nem texto esmagado, os números e a lista, a gaveta ABERTA medida; "não leu" com "Tentar de novo" que lê de novo, o período na consulta, "Nota 1 ou 2" que filtra, o vazio com o ajuste desligado; a página do pedido em cada largura: enviar sem nota avisa, as setas mudam a nota, o que vai ao servidor, o Google só na nota 5 (a 4 e a 2 sem ele), "Você já avaliou", "encerrou", desligado sem formulário; o ajuste do Robô de atendimento com o "Salvar nota" que manda só o que mudou. |
| `calendario` | `/clientes/calendario` | O calendário de eventos (F2 do perfil do cliente, mig 461): em cada largura, sem barra para o lado nem texto esmagado, a lista, a gaveta "Evento da loja" ABERTA e o diálogo de excluir ABERTO; as situações que filtram, o selo "costume", as ações só no evento que a pessoa pode mudar, o feriado da Escala; o período na consulta; criar (o corpo que sai), editar (PATCH no id) e excluir (DELETE no id); "não leu" com "Tentar de novo"; o vazio; o módulo desligado sem ler o calendário. |

Protótipo de referência das quatro primeiras: `mockups/regem-kds-cozinha.html`. Do `mister`, do `mister-console` e do `mister-relatorio-link`: `mockups/regem-mister.html`. Do `mister-link`: `mockups/regem-mister-pin.html`. Do `area-entrega`: `mockups/regem-area-entrega-mapa.html`. Do `graph-clique`: `mockups/regem-graph-clique.html`.

## Acrescentar um roteiro

1. Crie `roteiros/<nome>.mjs` exportando `default async function ({ nav, base, ok, foto, larguras, rapido, escrever })`:
   - `nav`: o navegador (abra um `nav.newContext(...)` por largura e feche no fim);
   - `base`: o endereço do app;
   - `ok(condição, mensagem)`: anota a conferência e **segue** (o roteiro não para na primeira falha);
   - `foto(arquivo)`: o caminho da foto em `roteiros/fotos/`;
   - `larguras`: as 16 (ou 5 no `--rapido`).
2. Simule a API com `page.route('**/api/v1/**', ...)` e `responder(route, corpo)` de `comum.mjs`; o login é
   `tokenFalso({...})` no `localStorage` (`regen_token`). O tempo real: `page.route('**/socket.io/**', r => r.abort())`,
   ou o Engine.IO simulado do `kds.mjs` quando a tela depende de evento.
3. Ponha o nome na lista `ROTEIROS` de `rodar.mjs` e na tabela acima.
4. Confira que a conferência **pega o defeito**: desfaça de propósito o que ela protege, rode e veja a falha.

## Fora dos roteiros: o atlas de letras do gráfico do Mister

`fonte-do-grafico.mjs` não é roteiro (não está no `rodar.mjs`): usa o mesmo navegador para desenhar, uma vez, as letras da
Figtree (`src/fonts/figtree-var.woff2`, licença SIL OFL) e grava a transparência delas em
`backend/src/modules/mister/grafico/fonte-do-grafico.ts` — o servidor monta a imagem do gráfico do Mister com elas, sem
biblioteca de imagem. Rodar de novo (dentro de `frontend/`, `node roteiros/fonte-do-grafico.mjs`) só ao mudar a fonte, os
tamanhos ou as letras.

## As imagens do "como faço" do Mister

`fotoDoComoFaco(page, id, marcas)` (em `comum.mjs`) marca, na tela de verdade e com os dados de exemplo do roteiro, os
lugares numerados (1, 2, 3…) num contorno dourado e salva `public/como-faco/<id>.png` — o Mister manda a imagem pelo
endereço público quando alguém pergunta "como faço". Sem variável, o roteiro só confere que as marcas estão na tela; para
gerar de novo (a tela mudou): `GERAR_COMO_FACO=1 node roteiros/rodar.mjs <roteiro>`, e o PNG entra no git. O assunto do
guia (`backend/src/modules/mister/mister-guia-de-uso.ts`) diz em `imagem` o que cada número marca, e a spec do guia confere
que o arquivo existe.

Cada marca rola até a vista antes da foto e só vale achada se o centro dela está dentro da janela **e** é dela mesma
(`elementFromPoint`): o item do menu cortado pela parte que rola, ou coberto por uma gaveta, reprova o roteiro com o motivo
("fora da janela (x, y)", "coberta por button …"), em vez de virar um contorno em cima do que está na frente. Se rolar até
uma marca tira outra da tela (o grupo no fim de uma página longa), traga a marca para cima pela própria tela — a busca de
ajustes, um filtro — e diga isso nos passos do guia. Marca de algo que um perfil não vê (a faixa de partes do Mister, que o
gerente não tem) fica de fora se o assunto vale para esse perfil.

O selo do número é navy com número branco e borda dourada — nunca dourado: o app já tem selos dourados com número (a
quantidade no cartão do Balcão, as contagens do painel do Delivery). Botão desligado tem `pointer-events: none` e o
`elementFromPoint` passa por ele; a medida liga o `pointer-events` só durante a conferência. Mudou o selo ou a marca:
gerar de novo TODAS as imagens (`GERAR_COMO_FACO=1` em cada roteiro que tem `fotoDoComoFaco`).

Tela sem roteiro próprio entra em `como-faco.mjs`: uma linha em `TELAS` com o assunto, o endereço, o passo (uma aba) e
as marcas. A resposta simulada padrão é a lista vazia nas leituras e `{}` no resto; tela que lê outro formato traz as
suas `respostas` (ou `respostasDinamicas`, montadas na hora, como o horário das mensagens). O roteiro confere também que
a tela não caiu no "Algo deu errado" (a fronteira de erro do React não gera `pageerror`) e, quando cai, diz o erro que o
React registrou no console. Desde 17/11 **todo assunto do guia tem imagem** — a spec do guia reprova assunto sem ela.
