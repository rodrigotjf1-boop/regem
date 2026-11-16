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
| `mister` | `/mister` e `/diretoria` | Em Visão C&O, o Mister nasce desligado, a chave DESLIGADA aparece sobre o cartão (contraste mínimo de 3:1) e um toque liga. Módulo desligado e gerente não abrem a tela nem chamam as rotas da IA; a chave colada vai sem espaço, o campo esvazia e ela não fica na página; a situação e o teste; a recusa do servidor; apagar com confirmação; o uso (rótulos, tokens, custo, total, vazio, erro, atalhos, período invertido); o guia em gaveta; larguras com a gaveta e o diálogo abertos. **Pessoas:** o presidente vê as duas partes e a lista inteira (quem é quem, o final do número, avisos parados, quem não ligou), sem telefone inteiro e sem "Editar o que pode"; a parte da IA só é lida quando aberta; ligar o próprio WhatsApp (a mensagem `MISTER …`, o código para a câmera, o link, a espera até "Ligado" e a tela parando de perguntar, o código vencido e "Gerar outro código", a recusa do servidor); desligar pede confirmação e manda a pessoa certa; o Mister indisponível trava o "Ligar"; o gerente vê só a própria linha, sem a faixa de partes, sem chamar a IA e com o item no menu; execução não entra; e as 16 larguras com os dois diálogos abertos. |
| `mister-console` | `/distribuicao`, aba Mister | A aba só existe para a Diretoria. Número não conectado: "Conectar com a Meta" só libera com a forma escolhida (e, na forma "só na API", com o PIN de seis dígitos); o que vai ao servidor e o caminho com que a janela da Meta abre; a janela fechada e a recusa do servidor não mudam nada; os avisos da Meta aparecem; conectar não liga a chave geral. Conectado: os dados do número e o aviso da coexistência. Desligar o Mister e desconectar pedem confirmação (foco em "Cancelar", Tab preso, Esc cancela sem chamada). O número que caiu mostra a data e o motivo. As empresas com os rótulos, a busca que vai ao servidor (só a resposta mais nova vale), vazio, teto de linhas e erro com "Tentar de novo". Em cada largura: sem barra lateral, nada passa da tela, tabela no largo e cartões no estreito, com o diálogo aberto. A conexão por QR Code (Q2, `mockups/regem-mister-qr.html`): o aceite antes do 1º QR (e não de novo com o de agora), o QR na tela com a conferência a cada 3 s e o QR novo a cada 20 s ("renovar"), conectado (a forma vira o QR e o painel é relido), a troca nos dois sentidos com confirmação, desconectar, bloqueado com "Conectar outro número", caiu, o Evolution não configurado e a recusa do servidor; em cada largura, o aceite e o QR inteiros na tela e legíveis. |
| `area-entrega` | `/delivery/configuracoes?aba=area` | Os três modos (bairro, distância, desenhada), com a troca gravada na hora — e "Desenhada no mapa" sem área NÃO grava o modo (o servidor recusaria). Desenhar uma área clicando os cantos no mapa e fechando no primeiro; a gaveta (nome, taxa, tempo); salvar manda a lista inteira e liga o modo ("valendo"); "Testar um endereço" dentro e fora; "Converter as faixas de km em áreas"; a seta da ordem; apagar com confirmação; a recusa do servidor com a mensagem dele (e as alterações ficam); a única área pausada com o modo ligado não é mandada. Em cada largura: sem barra lateral, com a gaveta e com o diálogo abertos. O fundo do mapa vem vazio (sem rede). |
| `delivery-painel` | `/delivery` | As listas "Pedidos pendentes" e "Entregas em andamento" nunca rolam para o lado (ERR-430): em cada largura, a tabela inteira, a compacta (sem "Cód. ext." e a data) ou os cartões, pelo espaço que a lista tem — tabela na tela larga, cartões no celular. Nos cartões: tocar seleciona o pedido, a caixa marca sem selecionar, "Todos" marca a lista, o "Ordenar" e a seta reordenam. Na tabela: o cabeçalho ordena, a linha seleciona, a caixa marca. |
| `listas-largas` | `/formas-pagamento`, `/delivery/relatorios` e `/ordens-producao` (aba Relatório) | As três listas que rolavam para o lado (ERR-476): em cada largura, sem barra lateral e nada fora da janela — tabela na tela larga, cartões no celular. Nos cartões: "Editar" abre a forma certa (o diálogo inteiro na janela) e "N bairro(s)" abre os bairros do entregador. A faixa de partes desliza sem barra abaixo de 640 px, como decidido (07/10/2026). |
| `candidatos-conducao` | `/candidatos` | Os indicadores do topo de Candidatos e a condução dos aprovados (F5b das vagas): em cada largura, os cinco números, "Ver por pessoa" abre a gaveta com cada pessoa (valor do mês, os dias da escala, quem fica fora da soma e por quê), sem barra lateral e nada fora da janela com a gaveta aberta, nenhum texto esmagado e a foto de cada indicador e de cada pessoa (ERR-432). A leitura que falha mostra "Tentar de novo", nunca R$ 0,00; ninguém aprovado: a gaveta explica. |
| `candidatos-origens` | `/candidatos` (aba QR codes e links) e `/v/<codigo>` | "De onde vêm as fichas" (F5a das vagas, mig 430): em cada largura, os totais do período, as origens com as barras e a taxa, a conta de cada QR, sem barra lateral, nada fora da janela, nenhum texto esmagado e a foto de cada origem. "7 dias" mostra a leitura de 7 mesmo com a de 30 chegando depois; a leitura que falha mostra "Tentar de novo", nunca zeros; sem abertura, o estado vazio. A página pública conta UMA abertura por aparelho por dia (o cookie guarda só o dia). |
| `candidatos-banco` | `/candidatos` | Avisar o banco de talentos (F4b, parte 1): a faixa "Vaga aberta" com quantos podem ser avisados; a gaveta com quem recebe ("Abrir no WhatsApp" com a mensagem pronta, "Marquei como avisado") e quem não recebe, com o motivo; em cada largura, nada fora da janela, nenhum texto esmagado e a foto de cada pessoa. "Marquei" manda a pessoa e a função e relê; trocar a função pede `?funcao=`; a leitura que falha mostra "Tentar de novo"; sem ninguém, a faixa some. F4b parte 2 (pelo número de marketing): todos marcados, a mensagem do modelo com os botões e "Por onde sai"; desmarcar atualiza o "Avisar N pessoas"; o envio manda a função e só os marcados, e quem entrou aparece "na fila" sem se marcar de novo; sem o modelo, "Avisar" trava e "Enviar o modelo à Meta" pede uma vez (depois, "em análise"); pelo Evolution, as respostas escritas e o ritmo; em cada largura, nada fora da janela nem esmagado. |
| `mister-link` | `/m/<código>` | A página do link com PIN do Mister (F4.2a, mig 433). Cada estado (pede o PIN, fazendo, feito, não deu, não autorizou, venceu, bloqueado) em cada largura: o texto, o rodapé, o topo com o nome comprido da empresa, sem barra lateral, nada fora da janela, nenhum texto esmagado, botões de toque. O PIN só com dígitos (até 6), "Autorizar" só com 4 ou mais, o errado diz quantas restam, limpa e volta ao campo; o certo mostra "Fazendo agora…" e a página acompanha até "Feito"; cinco errados bloqueiam; "Não autorizar" fecha sem PIN; o limite por minuto; o prazo que passa com a página aberta. Isolada: só as rotas do link, nada guardado no aparelho, `referrer` desligado, fora da busca, o campo sem guardar o PIN. |

Protótipo de referência das quatro primeiras: `mockups/regem-kds-cozinha.html`. Do `mister` e do `mister-console`: `mockups/regem-mister.html`. Do `mister-link`: `mockups/regem-mister-pin.html`. Do `area-entrega`: `mockups/regem-area-entrega-mapa.html`.

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
