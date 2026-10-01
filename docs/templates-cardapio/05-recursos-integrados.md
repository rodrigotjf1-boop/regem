# 05 · Recursos do cardápio de hoje dentro dos templates novos

> Conferência feita em 01/10/2026 contra `origin/main` (`e3183a2`). Os arquivos `00` a `04` descrevem vitrine, produto, checkout em etapas, situação da loja e benefícios. Este arquivo cobre **tudo o mais que o cardápio já faz hoje** e que os templates novos não podem perder: onde cada recurso fica, quando aparece e o que a especificação assumia diferente do código.
>
> Regra: **nenhum template novo vai ao ar sem os recursos da seção 2.** O protótipo (`prototipo/prototipo-interativo.html`) já mostra os marcados com ●; os marcados com ○ estão só descritos aqui.

## 1. O que a conferência achou

O pacote cobria bem o caminho do pedido. Ficaram de fora recursos que hoje vivem fora do `cart-sheet`:

- a **conta do cliente** (entrar com código, endereços, sair, excluir conta) e os painéis **Pedidos** e **Promos**;
- os dois avisos de privacidade do checkout: **promoções pelo WhatsApp** (PR #598, entrou depois do pacote) e **origem do anúncio** (PR #593);
- o **sinal da encomenda**, a **recorrência**, as **variações** do produto e as regras de opção (repetição, informativa, pré-marcada);
- os estados do **pós-pedido** (verificar pagamento, Pix expirado, Pix indisponível, avisos do servidor, link de acompanhamento);
- **QR de mesa** e os ramos **serviços** e **indústria**, que mudam o checkout.

## 2. Onde cada recurso fica nos quatro templates

### 2.1 Conta do cliente (novo ponto de entrada)

Hoje, Pedidos, Promos e Busca só aparecem na navegação inferior, que exige cliente identificado **e** carrinho vazio. Quem está montando um pedido não alcança nada disso. Nos templates novos a navegação inferior **não é usada**: a barra da sacola ocupa o rodapé e a conta fica sempre no topo.

| Template | Acesso |
|---|---|
| Galeria | ícone de pessoa no topo, ao lado da busca |
| Balcão | botão redondo sobre a capa (canto superior esquerdo) |
| Oferta | botão redondo sobre a faixa da loja (canto superior esquerdo) |
| Regem Fluxo | ícone de pessoa no topo, ao lado da busca |

O ícone abre a tela **"Sua conta"** (componente comum `Conta`, em `components/loja/conta/`), com três abas. É a mesma lógica de `cliente-panel`, `pedidos-panel` e `promos-panel`, reorganizada; nenhuma rota muda.

| Aba | Conteúdo (tudo já existe hoje) | Protótipo |
|---|---|---|
| **Entrar** (sem sessão) | telefone → "Enviar código" → nome + código de 6 dígitos (`cliente/otp/enviar`, `otp/confirmar`); texto "Seus dados ficam salvos e você pode apagá-los quando quiser"; o link mágico `?u=` continua entrando direto | ● |
| **Pedidos** | em andamento: status, previsão, **código de entrega** (entrega própria), "Acompanhar entrega" (`rastreioUrl`, abre `/r/[token]`), "Pedir alteração", "Pedir cancelamento", "Cancelar encomenda" (com o estorno do sinal e o prazo); **avisos do pedido** (notificações, marcadas como lidas ao abrir); **encomendas recorrentes** (pausar, retomar, cancelar); anteriores com detalhe e "Pedir de novo" | ● (recorrência e avisos: ○) |
| **Benefícios** | só o que a loja usa: saldo de cashback e vales, "Troque seus pontos" (`cashback/resgatar`), plano de fidelidade com progresso, prêmios para resgatar (`fidelidade/resgatar`) e prêmios na carteira, cupons com "Usar" (aplica na sacola), ofertas do dia. Sem nada ativo: "Esta loja não tem benefícios ativos no momento." | ● (troca de pontos e resgate de prêmio: ○) |
| **Perfil** | nome e WhatsApp; endereços salvos (usar, excluir, novo, **definir principal** — a rota existe e hoje não tem botão); chave **"Promoções pelo WhatsApp"** (2.2); aparência claro/escuro (2.6); "Sair"; "Excluir conta" (aviso + código pelo WhatsApp) | ● (endereços: só leitura; aparência: ○) |

A busca fica na vitrine de cada template (já especificada nos arquivos `01` a `04`), para qualquer cliente.

### 2.2 Promoções pelo WhatsApp (PR #598)

| Onde | Regra |
|---|---|
| Checkout | caixinha **já marcada**, logo abaixo do campo WhatsApp: "Receber promoções de {loja} pelo WhatsApp" + "Desmarque se não quiser. Para sair depois, responda SAIR ou desligue no seu Perfil." As frases vêm de `loja.promocoes` (são as que ficam gravadas). |
| Etapa | Galeria, Oferta e Regem Fluxo: fim de "Entrega e contato". Balcão: etapa "Dados". |
| Quando aparece | `loja.promocoes` não nulo (loja que manda promoção), fora do QR de mesa e só no **primeiro pedido** do aparelho (`promocoesRespondida`); cliente identificado que já respondeu (`perfil.promocoes.respondeu`) não é perguntado. |
| Pedido expresso (Fluxo) | não pergunta: quem tem último pedido já respondeu. Se o servidor disser que não respondeu, a caixinha aparece na revisão, abaixo do cartão de nome e WhatsApp. |
| Envio | `promocoes: true|false` no corpo do pedido só quando a caixinha apareceu. |
| Perfil | chave "Promoções pelo WhatsApp", com os três textos de estado que o servidor manda (`ligado`, `desligado`, `fora`). |

`falta()` **não** considera a caixinha: ela nunca bloqueia o pedido. Protótipo: ● (recurso "Loja manda promoção").

### 2.3 Origem do anúncio (PR #593)

O aviso "A loja registra por qual anúncio ou link você chegou." com **Saiba mais** e **Não registrar** fica **logo acima do botão final**, como hoje:

- Galeria, Balcão, Oferta e Fluxo (cliente novo): no fim da etapa **Pagamento**, depois do resumo.
- Fluxo, pedido expresso: no fim de **Revisar e pedir**.
- Depois de "Não registrar": "Pronto: este pedido vai sem esse registro." + **Desfazer**.
- Condição: `loja.medeAnuncios`, fora do QR de mesa, e só quando existe origem capturada. A captura (`origem-clique.ts`) e o diálogo `SaibaMaisOrigem` não mudam.

Protótipo: ● (recurso "Chegou por anúncio").

### 2.4 Encomenda: sinal e recorrência

Entram no componente `Quando` (base §6), na etapa Entrega:

- **Sinal** (`loja.encomenda.sinal`): ao escolher agendar, caixa de aviso com o valor (regra por faixa de quantidade, senão a base), o percentual e o prazo de cancelamento com reembolso, ou "o sinal não é reembolsável". O botão final continua "Agendar pedido"; o resumo do Pagamento ganha a linha "Sinal agora" e "Restante na entrega". Protótipo: ● (recurso "Encomenda com sinal", com valores de exemplo).
- **Recorrência**: "Repetir toda semana" + dias da semana + a nota sobre o link do sinal de cada entrega. Só com encomenda ativa em food/varejo. ○
- A gestão (pausar, retomar, cancelar) fica na aba Pedidos da conta (2.1).

### 2.5 Produto

O componente `Grupos` (base §6) precisa manter o que o `item-sheet` faz hoje:

- **Variações** (`variacoes`): bloco obrigatório de seleção única, **antes** dos grupos; conta como o primeiro obrigatório na numeração do Fluxo. ○
- **Repetição** (`regra === 'varias_com_repeticao'`): contador − n + por opção. ● (grupo "Adicionais")
- **Opção informativa** (`informativa`): mostra a etiqueta "obs" no lugar do preço. ○
- **Pré-marcadas** (`padraoMarcada`): já vêm escolhidas ao abrir, respeitando o `max`. ○
- **Duração** (`duracaoMin`, serviços): "N min" ao lado do preço, na linha/card e no produto. ○
- **Parcelamento** (`parcelasMax > 1`): "em até Nx" no card e, no Pagamento, abaixo do cartão online. ○

### 2.6 Vitrine

| Recurso | Onde fica | Protótipo |
|---|---|---|
| Informações da loja | **Não existe painel hoje** (o `02-balcao.md` mandava reaproveitar). Criar o componente comum `InfoLoja`: endereço, horários por dia, formas de pagamento, WhatsApp, Instagram e site — tudo já vem em `menu.loja` e `menu.horarios`. Balcão: "Ver informações". Demais: toque no nome/status da loja. | ● (Balcão) |
| Tema claro/escuro | hoje é o botão ☀️/🌙 do cabeçalho. Nos templates: aba Perfil da conta ("Aparência") e, para quem não entrou, no rodapé da folha de informações da loja. Continua valendo `loja.tema` (claro, escuro, auto) e a escolha guardada no aparelho. | ○ |
| Selos | os seis de `SELO` (Mais pedido, Novo, Veg, S/ glúten, S/ lactose, Picante) + "SUGERIDO" (`destaque`). Cada template mostra o primeiro selo no card e todos no produto. | ● (parcial) |
| Deep-link do banner | `item:ID`, `category:ID`, `coupon:CODE` e `http(s)://` continuam; `coupon:` aplica o cupom e abre a Sacola. | ● (item) |
| Legenda do banner | o payload só manda `imagemRef`, `titulo` e `link`. O "kicker" e a linha de preço da Galeria saem do **produto do deep-link** (`item:ID`: selo e preço); sem `item:`, só o título. | ○ |
| WhatsApp da loja | hoje só aparece depois do pedido. Entra também na folha de informações da loja. | ● |
| Faixa "Mesa N" | abaixo do topo, em todos os templates, com `?mesa=`. | ○ |
| Carregando e erro | o esqueleto de carregamento e a tela "Cardápio indisponível" continuam comuns (fora do template). | ○ |

### 2.7 Pós-pedido

Além do que a base §5.7 descreve, a confirmação mantém:

- **"Já paguei, verificar pagamento"** (`verificar-pagamento`), além da atualização automática. ●
- Pix **expirado**: "Tempo esgotado" + "Fazer novo pedido"; o contador é de **10 minutos** (o protótipo mostrava 15). ● (tempo corrigido)
- Pix **indisponível** (`pixErro`): o pedido foi registrado e a tela diz por quê não há QR. ○
- **Avisos do servidor** (`avisos`: regras de cupom, resgate e pontuação), em lista. ○
- **Link para acompanhar depois** (`/c/{token}/pedido/{id}?ref=`). ●
- WhatsApp com a mensagem pronta; desabilitado enquanto o Pix não cai. ● (texto)
- Orçamento (indústria) e agendamento (serviços) com os títulos próprios. ○
- A página `/c/[token]/pedido/[id]` passa a usar os tokens do template da loja (hoje usa a cor fixa `#E2A340`).

### 2.8 QR de mesa e ramos

| Caso | O que muda no checkout em etapas |
|---|---|
| **QR de mesa** (`modo === 'mesa'` e `?mesa=`) | só a Sacola; o botão é "Enviar pedido" e envia direto. Sem nome, telefone, caixinha de promoções e aviso de origem. Confirmação: "Foi para a cozinha (mesa N)", sem linha do tempo. |
| `?mesa=` com outro modo | checkout normal. |
| **Serviços** | etapa "Atendimento" no lugar de Entrega: data e hora obrigatórias + "Profissional (opcional)"; sem tipo, endereço, frete e encomenda. Botão "Confirmar agendamento"; loja fechada não bloqueia. |
| **Indústria** | sem "quando" e **sem etapa Pagamento**: Sacola → Entrega e contato (com "CNPJ para faturamento"). Total rotulado "Estimativa", sem pontos. Botão "Solicitar orçamento". |

## 3. O que a especificação assumia e o código faz diferente

| # | A base dizia | O código faz | O que fazer |
|---|---|---|---|
| 1 | Sacola só avança com subtotal ≥ `pedidoMinimo` | o pedido mínimo é **só informativo**: nem a tela nem o servidor barram | é mudança de regra. Barrar na tela **e** validar no servidor no mesmo PR, ou manter informativo. **Decisão do dono.** |
| 2 | Beacons novos `etapa_entrega`, `etapa_dados`, `etapa_pagamento` | o servidor só aceita `view_menu`, `add_carrinho`, `checkout`, `pagamento`, `pedido` e descarta o resto; `pagamento` é aceito e nunca enviado | usar `pagamento` na etapa Pagamento e acrescentar `etapa_entrega` e `etapa_dados` à lista do servidor na Fase 0 |
| 3 | "Ver informações" reaproveita o painel existente | não existe painel de informações da loja | criar `InfoLoja` (2.6) |
| 4 | Entrega / Retirada / Consumir no local | `local` cai em retirada; a tela só oferece Entrega e Retirada | manter duas opções na Fase 0 |
| 5 | "entrega a partir das HH:MM" e `horariosRetirada` | o payload traz `horarioLabel`, `horarios` e `abertoPorTipo`; não há `horariosRetirada` | calcular a próxima abertura por tipo no servidor e mandar pronta (`proximaAbertura { entrega, retirada }`), para a tela não refazer a conta |
| 6 | Banner com kicker, título e linha de preço | o payload só traz `imagemRef`, `titulo`, `link` | derivar do produto do deep-link (2.6) |
| 7 | (não tratava) | **o erro do envio do pedido não aparece na tela**: `erro` só é desenhado antes de o cardápio carregar. Recusa do servidor, nome ou CPF inválido falham em silêncio | todo rodapé de etapa tem uma área de erro (`role="alert"`) acima do botão; `submitPedido()` devolve o erro para o template. Corrigir também no cardápio atual. |
| 8 | (não tratava) | a barra de frete grátis usa `freteGratisAcima != null` e o cálculo usa `> 0`: com valor 0 a barra diz "Você ganhou frete grátis!" sem zerar a taxa | a base já manda sumir com 0; usar `> 0` nos dois |
| 9 | (não tratava) | "Pedir de novo" não recompõe os complementos | no `reordenarUltimo()`, produto com escolha obrigatória abre o produto em vez de entrar incompleto |
| 10 | (não tratava) | textos citam "Meus dados"; a tela se chama "Perfil" | usar "Perfil" em todos os textos novos |

## 4. Acréscimo ao checklist de aceite de cada template

- [ ] Ícone de conta na vitrine abre "Sua conta" com Pedidos, Benefícios e Perfil; sem sessão, o login por código.
- [ ] Caixinha de promoções já marcada abaixo do WhatsApp só no primeiro pedido e só com `loja.promocoes`; não aparece na mesa; `promocoes` vai no pedido só quando ela apareceu.
- [ ] Aviso de origem acima do botão final (Pagamento, ou Revisar no pedido expresso), com "Saiba mais", "Não registrar" e "Desfazer".
- [ ] Encomenda com sinal mostra valor, percentual e prazo antes de agendar; recorrência disponível.
- [ ] Produto com variação, opção com repetição, informativa e pré-marcada se comporta como hoje.
- [ ] Confirmação com "Já paguei, verificar", Pix expirado (10 min), Pix indisponível, avisos e link de acompanhamento.
- [ ] Erro do envio aparece acima do botão final, com `role="alert"`.
- [ ] QR de mesa, serviços e indústria seguem a seção 2.8.
