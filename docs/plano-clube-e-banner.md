# Plano — Clube de recompra, banner criado com IA e tempo da fila

> **Estado: APROVADO em 20/11/2026, com as dez decisões recomendadas (D1–D10).** Pedido do dono em 20/11, depois do fim
> da versão 5 do Mister: planejar as três ferramentas do clube ("algo que é ativado ou desativado"), o banner criado com a
> ajuda da IA pelo DMS Graph e o tempo da fila do atendimento. O Hermes interno fica guardado e a mudança da VPS para São
> Paulo será a última. Protótipo: `mockups/regem-clube-banner.html`. Implementação pelas fases da seção 5.
>
> **Decisão do dono sobre a observação do fim (20/11):** o link do Google continua só para quem avaliou bem o pedido do
> Cardápio Regem (como aprovado em 18/11). Fica registrado que o risco com a política do Google foi apresentado.

## 0. O que já existe (conferido na `origin/main` e no banco de produção, só lendo, em 20/11)

| Peça | Onde | O que serve para este plano |
|---|---|---|
| Plano de fidelidade ("N pedidos → prêmio") | Delivery › Marketing | O caminho do prêmio como **desconto** (`resgateId` → `avaliarPremio` → `marcarPremioUsado`) |
| Presente de aniversário | módulo `aniversario` + automáticas do relacionamento | Já é o "aniversário" do `07-clube-de-recompra.md`: fica fora deste plano |
| Cupons, cashback e "Regras de desconto" | Delivery › Cupons | O cupom pessoal do prêmio e o empilhamento |
| Segmentos do perfil (Campeões, Leais, Em risco, Inativos…) | `common/segmentos-do-perfil.ts` | A "classificação do marketing" |
| Campanhas (disparos) com grupo de controle | Delivery › Marketing | O "envio em disparos" e a medida do efeito |
| Eventos sazonais com arte do mês | Delivery › Configurações › Eventos | A arte do selo do mês |
| Banners do cardápio (até 3, carrossel, link para produto, categoria, cupom ou endereço) | Delivery › Configurações › Banners | O lugar do banner novo; o link já abre `item:`, `category:`, `coupon:` e `https://` |
| DMS Graph (fotos, áudio e voz, com franquia por empresa) | produto à parte, porta MCP | Ganha a ferramenta de criar imagem |
| Fila do atendimento com posição, urgente na frente, chateado = urgente, aviso ao gerente em 3 min | Atendimento › Fila e avisos | Falta só o tempo |

## 1. A lei e as regras que valem para o clube (o que mudou o desenho)

- **Sorteio precisa de autorização.** Dar prêmio por sorte (ou em quantidade limitada) "a título de propaganda" é
  promoção comercial: exige autorização prévia da Secretaria de Prêmios e Apostas (SPA/MF), pedida pelo SCPC com 40 a
  120 dias de antecedência, com regulamento (Lei 5.768/1971; a SPA multou empresas em 2026). Leituras recentes dizem que
  **limitar a quantidade** ou exigir **outro critério além da compra** também passam a exigir. Fontes: Mattos Filho
  ("Promoções comerciais: pontos de atenção"), Migalhas ("As novas regras das ações de compre e ganhe"), ABC da
  Comunicação ("Mecânica comprou-ganhou: novo entendimento"), gov.br (serviço de autorização da SPA). Não é parecer de
  advogado: antes de ligar para os clientes, vale uma consulta.
- **Por isso o clube nasce com cinco travas:** todo mundo que cumpre a regra recebe; o prêmio é definido pela regra, não
  pela sorte (a raspadinha e a roleta só **revelam**); sem limite de quantidade nem "enquanto durar"; o critério é
  comprar (ou um motivo de atendimento, ou a classificação pelas próprias compras); nada a pagar para receber.
- **Google proíbe benefício em troca de avaliação**, positiva ou negativa, e também pedir avaliação só a quem gostou
  (política de conteúdo do Perfil da Empresa; reforçada em fev/2026). Pena: avaliações tiradas do ar e o perfil
  bloqueado para avaliações novas.
- **Meta:** mensagem que oferece prêmio é de **marketing** (paga, só para quem aceitou receber). Não pode ir dentro de um
  modelo de utilidade (o "Chegou tudo certo?").

## 2. Parte A — Clube de recompra (três ferramentas, cada uma liga e desliga)

Lugar: **Delivery › Marketing › Clube**. Só o presidente liga, desliga e muda as regras (auditado); o gerente vê os
resultados e manda o prêmio de desculpas pelo Atendimento. Desligar uma ferramenta para de dar direitos novos na hora; o
que o cliente já ganhou vale até a validade.

### A1. Prêmio surpresa — raspadinha ou roleta

- **A forma** (a loja escolhe uma): **Raspadinha** (raspa com o dedo) ou **Roleta de prêmios** (toca e gira). As duas
  revelam o mesmo prêmio, que já foi definido quando o cliente ganhou o direito. A tela diz isso: "Seu prêmio já está
  garantido — raspe para ver" / "gire para descobrir". A roleta mostra os prêmios da lista da loja, mas sempre para no
  prêmio do cliente.
- **Quando o cliente ganha o direito** (cada um liga e desliga, cada um com o seu prêmio):

| # | Gatilho | Como funciona | Situação |
|---|---|---|---|
| G1 | **Pedido entregue** | Todo pedido do Cardápio Regem a partir de R$ X (ou a cada N pedidos) | ✅ recomendado como o principal |
| G2 | **Depois de uma reclamação** | A equipe toca "Mandar um prêmio de desculpas" no caso do Atendimento e escolhe o prêmio da lista; no máximo 1 por cliente por mês | ✅ é cortesia de atendimento, não propaganda |
| G3 | **Pela classificação do marketing** | A loja escolhe um segmento (Em risco, Inativos, Campeões…); **todos** do segmento ganham, uma vez por período; o prêmio espera no cardápio e pode sair pela campanha (G4) | ✅ a classificação vem das compras |
| G4 | **Em disparo (campanha)** | A campanha leva "🎁 Raspe o seu prêmio" com o link pessoal; todos os destinatários ganham | ✅ só para quem aceitou mensagens |
| G5 | **Depois da avaliação** | — | ⚠️ **não recomendado**: o Google proíbe e a SPA trata como "outro critério". Em troca: G1 (o prêmio sai na entrega, antes de qualquer pedido de nota) |
| G6 | **Aleatório, N por dia** | — | ⛔ **sorteio**: só com o Certificado de Autorização da SPA. Fica como fase futura, travada: liga só com o número do certificado, o período e o regulamento informados |

- **O prêmio** entra como **cupom pessoal** (desconto, nunca item a R$ 0,00 — evita mexer em nota fiscal, estoque e
  faturamento): desconto em % (com teto), desconto em R$, frete grátis, ou um produto grátis (desconto de 100% naquele
  produto). Validade (padrão 7 dias), pedido mínimo, vale só no Cardápio Regem e no robô (iFood e 99 não aceitam cupom
  nosso), um por pedido.
- **Onde o cliente revela:** na página do pedido (`/r/…`) depois da entrega (G1), na "Minha conta" do cardápio
  ("Prêmios para revelar") e pelo link pessoal da mensagem (G2–G4). Sem login novo: a conta do cardápio que já existe.
- **Regras do clube:** uma página gerada sozinha com as regras de cada ferramenta ligada (quem ganha, o prêmio, a
  validade, "não há sorteio"), com o link em cada tela do jogo.

### A2. Álbum de selos

- 1 selo por mês com pelo menos um pedido (pedido mínimo e canais configuráveis). Juntou N selos (padrão 4, de 3 a 12),
  o cliente escolhe um prêmio da lista. Os selos não precisam ser seguidos e valem 12 meses; depois do prêmio, o álbum
  recomeça.
- A arte do selo é a do evento do mês (se a loja ligou o evento) ou a arte padrão do mês.
- O cliente vê o álbum na "Minha conta" e o selo novo na página do pedido ("Você ganhou o selo de novembro — 3 de 4").

### A3. Meta do mês

- Até 3 níveis (padrão: 3 pedidos → escolhe um prêmio da lista 1; 6 pedidos → um da lista 2). Contam os pedidos do mês
  acima do mínimo, do Cardápio Regem, não cancelados.
- O prêmio escolhido vira cupom pessoal para o próximo pedido (validade padrão 15 dias). A barra de progresso aparece na
  "Minha conta" e na página do pedido.

### A4. As regras de convivência

- **Com o Plano de fidelidade:** somam (são ferramentas diferentes). **Um benefício por pedido:** o cupom do clube não
  junta com outro cupom; o cashback continua. Entra nas "Regras de desconto" como mais um tipo de cupom.
- **Onde roda:** só na nuvem. Uma rotina olha os pedidos entregues do Cardápio Regem (que sobem da loja pelo sync) e dá
  os direitos e selos com id pela chave do pedido (idempotente, V42) — sem tabela nova na loja, sem `.zip`.
- **Resultados** (Marketing › Clube › Resultados): direitos dados, revelados, usados, pedidos com prêmio, desconto dado;
  na campanha, contra o grupo de controle que já existe.

## 3. Parte B — Banner criado com IA pelo DMS Graph

Lugar: **Delivery › Configurações › Banners** (a tela de hoje), botão novo **"✨ Criar com IA"** que abre uma gaveta.

1. **O tamanho certo, sozinho:** o Regem lê o modelo do cardápio em uso e manda à IA os pixels (faixa do Oferta e do
   Fluxo: 1200 × 500; capa do Balcão: 1200 × 675), com o centro seguro, porque o recorte muda entre celular e computador.
2. **O pedido:** a pessoa escreve o que quer ("hambúrguer duplo com bacon, fundo escuro, clima de sexta"). **"Melhorar o
   pedido"** reescreve com a IA (mostra o antes e o depois, dá para editar). Pode **anexar uma foto ou arquivo** (a foto
   do produto, o logo) que vai junto como referência.
3. **O texto do banner por cima, escrito pelo Regem** (recomendado): a IA cria a imagem sem letras e o Regem escreve o
   título e a chamada com as fontes da marca — sem erro de português e dá para mudar o texto depois sem gerar de novo.
   Opção: "deixar a IA escrever o texto".
4. **Animado (GIF):** "Animar" faz o GIF a partir da imagem criada (aproximação lenta, brilho, o texto entrando), pelo
   DMS Graph, sem custo de IA e com até 1 MB. Quem pediu "menos movimento" no aparelho vê a imagem parada.
5. **Prévia** no celular e no computador, "Criar outra", "Usar este banner".
6. **Depois de aplicado, "Ao tocar, abre":** um produto, uma categoria, um cupom, **a página de vagas da loja**, **o
   Clube** (a raspadinha e o álbum), **uma página do Regem** (lista fixa: encomendas, avaliação, regras do clube) ou um
   **link externo** (só `https://`, abre em outra aba). Período opcional (de, até) e o texto para leitor de tela.

**No DMS Graph** (produto à parte): ferramentas novas `criar_imagem` (pedido, tamanho, referência opcional) e
`animar_imagem` (GIF), com a mesma permissão de arquivos, franquia e idempotência das outras. Mudança aditiva na porta
(skill `mudanca-produto-dms`: manifesto, nota no hub).

**Custo e quem paga:** a IA de imagem do Google custa por imagem (Gemini 2.5 Flash Image ≈ US$ 0,039, cerca de R$ 0,22;
a versão Pro ≈ US$ 0,13 — conferir na página de preços do Google antes de ligar). Paga a DMS, pela chave do projeto com
faturamento. Pela regra de custo mínimo: **nasce desligado**, com o preço ao lado do botão, e com franquia própria por
empresa (proposta: 20 imagens por mês). "Melhorar o pedido" usa o modelo de texto (fração de centavo).

## 4. Parte C — Tempo da fila do atendimento

O dado de hoje não serve como média: em 30 dias, 63 casos, 49 resolvidos sem ninguém tocar em "Pegar", e a mediana até
resolver foi de 1 h 35 (a loja ainda atende pela Eclética). Então:

- **Ajuste novo** em Atendimento › Fila e avisos: **"Tempo médio para resolver um caso"** (minutos), definido pela loja.
  Vazio = o robô não fala de tempo.
- **O que o robô diz:** "Você é o 2º da fila. A equipe costuma resolver em cerca de 15 minutos." (posição × tempo, em
  faixas: até 10 min, cerca de 15, 20, 30, mais de 40).
- **Ao lado do campo, o medido** nos últimos 30 dias (casos resolvidos pelo Regem), para comparar. Quando houver casos
  suficientes resolvidos pelo Regem, a opção "usar o tempo medido" (fase seguinte).

## 5. Fases (cada uma um PR; migration destacada)

| Fase | O que entra | Migration | Onde roda |
|---|---|---|---|
| C1 | Tempo da fila (o ajuste, o que o robô diz, o medido ao lado) | 1 (coluna no `robo_config`) | nuvem |
| A0 | Base do clube: tabelas, catálogo de prêmios, cupom pessoal, Marketing › Clube (liga/desliga), regras do clube | 1 | nuvem |
| A1 | Prêmio surpresa: raspadinha e roleta no cardápio; G1, G2 (botão no caso), G3, G4 (na campanha) | — | nuvem |
| A2 | Álbum de selos | — ou 1 | nuvem |
| A3 | Meta do mês | — ou 1 | nuvem |
| A4 | Resultados do clube | — | nuvem |
| B1 | DMS Graph: `criar_imagem` e `animar_imagem` (repo do Graph + manifesto + nota no hub) | do Graph | Graph |
| B2 | "Criar com IA" na tela de Banners (pedido, melhorar, anexo, texto por cima, prévia) | 1 (campos do banner) | nuvem |
| B3 | GIF, os destinos novos do "Ao tocar, abre" e o período | — | nuvem e cardápio |

Ordem recomendada: **C1 → A0 → A1 → B1 → B2 → A2 → A3 → B3 → A4**. Tudo nasce desligado; o presidente liga.

## 6. Decisões (a recomendada primeiro)

| # | Decisão | Recomendada | Outras |
|---|---|---|---|
| D1 | Gatilho "depois da avaliação" | Não usar; o prêmio sai na entrega (G1) | Usar só com a avaliação interna, para qualquer nota, sem o link do Google na mesma conversa (risco com o Google e a SPA) |
| D2 | Gatilho "aleatório, N por dia" | Fase futura, travada até a loja ter o Certificado de Autorização da SPA | Não oferecer |
| D3 | Como o prêmio entra | Cupom pessoal de desconto | Item a R$ 0,00 (mexe em nota fiscal e estoque) |
| D4 | Com o Plano de fidelidade e outros cupons | Somam; um benefício por pedido; cashback continua | Substituir a fidelidade |
| D5 | Que pedidos contam | Só os do Cardápio Regem e do robô | Também balcão identificado pelo telefone |
| D6 | Onde roda | Só na nuvem, sem `.zip` | Também no servidor da loja |
| D7 | Texto do banner | Por cima, escrito pelo Regem | A IA escreve |
| D8 | GIF | Animação pelo Graph a partir da imagem (sem custo de IA) | Vídeo da IA convertido em GIF (caro) |
| D9 | Custo da IA de imagem | Desligado, preço ao lado, franquia de 20 por mês por empresa | Sem franquia |
| D10 | Tempo da fila | Definido pela loja; o medido ao lado | Só o medido (hoje daria 1 h 35) |

**Observação fora do plano:** a avaliação aprovada em 18/11 manda o link do Google só para a nota 5. O Google trata
"pedir avaliação só a quem gostou" como proibido (a mesma política acima). Vale decidir se o link vai para todas as notas
ou se sai.
