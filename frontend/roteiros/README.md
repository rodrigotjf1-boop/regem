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
| `mister-console` | `/distribuicao`, aba Mister | A aba só existe para a Diretoria. Número não conectado: "Conectar com a Meta" só libera com a forma escolhida (e, na forma "só na API", com o PIN de seis dígitos); o que vai ao servidor e o caminho com que a janela da Meta abre; a janela fechada e a recusa do servidor não mudam nada; os avisos da Meta aparecem; conectar não liga a chave geral. Conectado: os dados do número e o aviso da coexistência. Desligar o Mister e desconectar pedem confirmação (foco em "Cancelar", Tab preso, Esc cancela sem chamada). O número que caiu mostra a data e o motivo. As empresas com os rótulos, a busca que vai ao servidor (só a resposta mais nova vale), vazio, teto de linhas e erro com "Tentar de novo". Em cada largura: sem barra lateral, nada passa da tela, tabela no largo e cartões no estreito, com o diálogo aberto. |

Protótipo de referência das quatro primeiras: `mockups/regem-kds-cozinha.html`. Do `mister` e do `mister-console`: `mockups/regem-mister.html`.

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
