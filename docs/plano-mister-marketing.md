# Regem — Plano: o marketing do Liame no Mister (PC11)

> **Aprovado pelo dono em 28/11/2026 ("aprovados"), com o protótipo P49** (`mockups/regem-mister-marketing.html`) e as decisões D-PC-40 a D-PC-49 como recomendadas. É a PC11 do plano de conteúdo do Liame (`liame/docs/plano-conteudo.md`), aprovado pelo dono em 28/11/2026 com as decisões D-PC-1 a D-PC-18 como recomendadas. As que valem aqui:
> - **D-PC-12:** o Liame envia; o Regem guarda; o Mister lê do próprio banco.
> - **D-PC-13:** quem vê é o presidente; o gerente, só se liberado e sem dinheiro.
> - **D-PC-14:** na fase 1, o Mister mostra e manda o link.
>
> As decisões do protótipo, D-PC-40 a D-PC-49, estão na seção 4.

## 1. O que é

O presidente da loja não precisa abrir o Liame para saber como vai o marketing. O Liame calcula, por código, nove blocos (A a I, §9.2 do plano do Liame) e manda ao Regem; o Mister responde quando o presidente pergunta ("como foram os posts da semana?"), põe um bloco no resumo da semana e avisa quando algo pede atenção. O Mister é IA (regra do dono de 25/11): recebe os números e as sugestões com o motivo de cada uma e conversa com eles, sem frase pronta.

**O que nunca vem:** dado de cliente (nome, telefone), texto de comentário ou de Direct, segredo ou token. Só números agregados, os links dos posts da própria marca e as sugestões.

## 2. O que já existe

- **A ligação Regem–Liame pelo clique:** a página de autorizar fica em `/integracoes/autorizar`, fora do menu. O servidor monta a página em `backend/src/modules/integracao-api/autorizacao-clique.tela.ts`, com as regras e os textos em `autorizacao-clique.regras.ts`.
- **A gestão das ligações:** em Configurações › Aplicativos conectados (`/integracoes`), só para o presidente e só na nuvem. Hoje não dá para tirar uma permissão só, apenas revogar a ligação inteira.
- **O Mister:**
  - as consultas de leitura (o mapa em `mister/mapa/mapa-do-regem.ts`, V81);
  - o resumo do dia e o da semana (F3.2, migration 420);
  - os avisos com "Vai para" (F1.2, migration 419);
  - o modelo `mister_aviso` para fora das 24 horas.

## 3. O que muda (PC11)

| Peça | O que entra |
| --- | --- |
| **Permissão** | `marketing.resumo.enviar` em `escopos.ts`, com o texto em `PERMISSAO_NA_TELA` e em `APLICATIVOS_DO_CLIQUE.liame.opcionais` (motivos e "sem elas"); um grupo novo na tela de autorizar, "O que o Liame envia ao seu Regem" (é a única permissão que grava no Regem); `VERSAO_DO_TEXTO` de 1 para 2; o texto no front (`TEXTO_ESCOPO`) e no e-mail aos presidentes |
| **Rota de entrada** | A primeira escrita do Liame no Regem: pelo acesso da loja, conferindo a permissão; o corpo com decorador em todo campo (V100), até 64 KB, com a versão do formato e os links só do endereço do Liame; idempotente pela ligação, o tipo (semana, dia, aviso) e a referência, vencendo o mais novo pela hora em que o Liame gerou; a mesma régua de acesso das outras portas (V75); a permissão retirada devolve um código próprio |
| **Tabela `marketing_resumo`** | `-- @cloud-only`, com RLS. Colunas: tenant, loja e ligação; tipo, referência e período; `gerado_em`; `recebido_em` com `clock_timestamp()` (V9); os blocos em jsonb; a situação do aviso. Índice único pela ligação, o tipo e a referência. A rotina apaga com 13 meses e 30 dias depois da revogação. O número da migration sai da `origin/main` |
| **Sync** | A tabela como `SO_NUVEM` no `sync-daemon.mjs` (V21) e as suítes de `modules/sync/` com Postgres; não pede `.exe` |
| **Mister** | A consulta `marketing_da_loja`, com a data de cada resumo e a régua da loja; os blocos C e D cortados no servidor para o gerente; a linha no `mapa-do-regem.ts` (V81), com a marca de valores em C e D (V124); os casos na avaliação de regressão; o bloco no resumo da semana (F3.2) |
| **Avisos** | O grupo novo "Marketing (Liame)" em `TIPOS_DE_AVISO`, com cinco tipos. O tipo é texto, sem migration. Os quatro do Liame chegam pela rota (abrem e fecham pela chave); o quinto ("o Liame parou de mandar o resumo") vem de uma rotina do Regem. Fora das 24 h, pelo modelo `mister_aviso` |
| **Telas** | "Mister na loja": o cartão "Marketing (Liame)" no Resumo; o grupo em Avisos e relatórios com os dois ajustes ("O gerente vê o marketing da loja dele" e "Marketing no resumo da semana"); "Parar de receber o resumo" na gaveta do Liame em Aplicativos conectados |
| **Fora do código** | A Política de Privacidade do Regem ganha o recebimento do resumo. O manifesto DMS e o `openapi.json` ganham a permissão e a rota (mudança aditiva; skill `mudanca-produto-dms`) |

## 4. Decisões do protótipo (aprovadas em 28/11/2026, todas como recomendadas)

| Decisão | Pergunta | Recomendação |
| --- | --- | --- |
| **D-PC-40** | Como a permissão nasce? | Opcional e desligada. O texto: "Resumo do marketing para o Mister · Mandar ao Regem o resumo do marketing: os números do plano de conteúdo, das postagens e das campanhas, as sugestões e os avisos. Sem dado de cliente." A versão do texto da autorização sobe |
| **D-PC-41** | Onde ela aparece na tela de autorizar? | Num grupo próprio, "O que o Liame envia ao seu Regem", porque é a única que grava no Regem. "O que o Liame não pode" ganha "Falar pelo Mister" |
| **D-PC-42** | Um resumo por quê? | Por loja ligada (cada loja tem a própria ligação). O presidente vê as lojas somadas; o gerente, só a dele |
| **D-PC-43** | Como o presidente libera ao gerente? | Um ajuste da empresa em Mister › Avisos e relatórios, desligado. Os blocos C e D são cortados no servidor. Quando o perfil por hierarquia chegar (decisão do dono de 13/11), o ajuste vai para ele |
| **D-PC-44** | Quais avisos? | O grupo "Marketing (Liame)" com cinco avisos, todos para o WhatsApp do presidente. Quatro vêm do Liame: conta desconectada, publicação que falhou, aprovação vencendo e plano acabando. O quinto é do Regem, "o Liame parou de mandar o resumo", e vai também ao suporte da DMS |
| **D-PC-45** | O marketing entra nos resumos? | Num bloco no fim do resumo da semana, com ajuste para tirar. O resumo do dia não leva |
| **D-PC-46** | Quando o número é velho? | O Mister sempre diz a data do resumo. Fica "velho" quando a atualização do dia passa de 36 h ou o resumo da semana passa de 8 dias; com 8 dias sem nada, abre o aviso |
| **D-PC-47** | De onde vem o link da tela do Liame? | Pronto do Liame. O Regem só aceita link do endereço do Liame |
| **D-PC-48** | Como parar de receber? | "Parar de receber o resumo", em Aplicativos conectados, tira só essa permissão; depois serve às outras opcionais |
| **D-PC-49** | Por quanto tempo se guarda? | 13 meses. Se a permissão sai ou a ligação é revogada, os resumos daquela ligação saem em 30 dias |

## 5. Entregas

Cada entrega nasce desligada; a migration vai à nuvem antes do merge; build dos dois lados antes do push.

| Entrega | O que faz | Migration |
| --- | --- | --- |
| **PC11a** | A permissão e a tela de autorizar, a rota de entrada, a tabela e o sync | 1 |
| **PC11b** | A consulta do Mister, o mapa, os casos da avaliação e o bloco no resumo da semana | — |
| **PC11c** | Os avisos, as telas do Mister e o "Parar de receber o resumo" | — |

**Depende do Liame:** a PC10 (o conjunto dos blocos A a I e o envio) e a PC8 (a medida de cada item). A PC11a pode vir antes, com a rota recebendo e guardando; o Mister só tem o que mostrar depois da PC10.

## 6. Andamento

| Entrega | Situação |
| --- | --- |
| Plano e protótipo P49 | Propostos e aprovados pelo dono em 28/11/2026 ("aprovados"), com as decisões D-PC-40 a D-PC-49 como recomendadas |
| PC11a, PC11b e PC11c | Esperam a ordem do plano do Liame (a PC11a pode vir antes da PC10; o Mister só tem o que mostrar depois dela) |
