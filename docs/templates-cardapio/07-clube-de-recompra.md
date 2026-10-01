# 07 · Clube de recompra: raspadinha, selos, aniversário e sorteio do mês

> Pré-requisito: Fase 0 do `00-base-cardapio.md` e o `05-recursos-integrados.md` (conta do cliente). Referência visual: protótipo, painel **Clube de recompra** e a seção "Sorteio do mês: o que a lei pede".

## Resumo para apresentar

**Problema.** O cliente compra uma vez pelo anúncio e some. Cupom genérico vira desconto para quem já ia comprar.

**Proposta.** Quatro mecânicas que dão motivo para o próximo pedido, todas ligadas à conta do cliente que o Regem já tem (telefone + token):

| Mecânica | O que o cliente vê | Por que traz de volta | Sorte? |
|---|---|---|---|
| **Raspadinha** | Na confirmação, raspa com o dedo e revela um cupom para o próximo pedido | Cupom pessoal com prazo curto (7 dias) | Não. Prêmio garantido, valor por regra |
| **Álbum de selos** | 1 selo por mês com pedido (com a arte do evento do mês); juntou 4, ganha um prêmio | Hábito mensal; ninguém quer perder a sequência | Não |
| **Aniversário** | Na semana do aniversário, "Parabéns, Rodrigo!" com bolo e confete, e um presente já aplicado | Momento afetivo, alta conversão | Não |
| **Sorteio do mês** | "Faça 3 pedidos em outubro e concorra"; lista de prêmios da loja; número da sorte ao completar | Frequência: o 2º e o 3º pedido do mês | **Sim**: exige autorização da SPA/MF |

**Configurável pelo lojista:** pedidos para concorrer (padrão 3, de 1 a 10), valor mínimo do pedido que conta, números da sorte por ciclo, lista de prêmios, valor do cupom da raspadinha, meta e prêmio do álbum, presente de aniversário.

**O que muda no Regem:**
- 1 migration com 5 tabelas novas e 2 colunas;
- um módulo `clube` no backend;
- uma tela "Clube" em Marketing;
- os blocos no cardápio, na confirmação e na conta do cliente.

## 1. Regras legais (sorteio)

Sorteio ligado a compra é **promoção comercial** (Lei 5.768/1971). A autorização, a fiscalização e as sanções são da **Secretaria de Prêmios e Apostas (SPA/MF)**, hoje com a Portaria SPA/MF nº 1.818/2026. O sistema não decide a parte jurídica, mas **não deixa publicar** sem os itens abaixo e guarda o que a prestação de contas pede.

| Exigência | Como o Regem garante |
|---|---|
| Autorização prévia (pedida de 40 a 120 dias antes do início) | Campo obrigatório "Certificado de autorização" + PDF. Sem ele, o sorteio fica em **rascunho** e nada aparece no cardápio. |
| Apuração pela extração da Loteria Federal | O lojista escolhe a data da extração (quartas e sábados). Na apuração, digita os 5 primeiros prêmios e o Regem calcula o número ganhador pelo método do regulamento. |
| Prêmio nunca em dinheiro nem conversível em dinheiro | O cadastro de prêmio aceita produto, serviço ou consumo na loja; recusa "dinheiro", "Pix", "vale em R$" e similares (lista de termos + aceite do lojista). |
| Propriedade dos prêmios comprovada antes da apuração | Upload da nota de compra por prêmio; a apuração só abre com todos anexados. |
| Regulamento público e aceito | Página pública do regulamento; o cliente aceita antes de receber o número. |
| Ganhador identificado | CPF pedido só ao participar (reaproveita `cliente.cpf` se já existir), com finalidade explicada. |
| Prestação de contas | Exportação CSV/PDF: participantes, números, apuração, ganhadores, comprovantes de entrega. Tudo em auditoria append-only. |

Fontes: [Mattos Filho](https://www.mattosfilho.com.br/unico/promocoes-comerciais-pontos-de-atencao/), [Cescon Barrieu](https://cesconbarrieu.com.br/portaria-promocoes-comerciais/), [gov.br, serviço de autorização](https://www.gov.br/pt-br/servicos/obter-autorizacao-para-atividades-de-distribuicao-gratuita-de-premios-a-titulo-de-propaganda-ou-de-captacao-de-poupanca-popular). O Regem não é assessoria jurídica: a tela de criação mostra um aviso para o lojista confirmar o regulamento com quem cuida disso.

**Raspadinha, selos e aniversário ficam fora dessa regra porque o prêmio é garantido:** todo cliente que cumpre a regra recebe o mesmo benefício, definido por regra e nunca por sorte. Regra inviolável do módulo: **nenhum valor de benefício pode ser aleatório** fora do sorteio autorizado.

## 2. Modelo de dados

Uma migration nova. Antes de criar, verifique o **último número em `origin/main`** (hoje 303) e use o próximo (regra do `CLAUDE.md`). Idempotente, com `tenant_id` em tudo.

```sql
-- NNN_clube_recompra.sql
alter table cliente add column if not exists aniversario text;          -- 'MM-DD' (sem ano)
alter table cupom   add column if not exists cliente_id uuid;           -- cupom pessoal (raspadinha/aniversário)
alter table cupom   add column if not exists origem text;               -- 'raspadinha' | 'aniversario' | 'sorteio' | null

create table if not exists clube_config (                               -- 1 por tenant/unidade
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, unidade_id uuid,
  raspadinha jsonb not null default '{"ativo":false}',  -- {ativo, tipo:'percentual'|'valor', valor, teto, minimo, validadeDias}
  selos jsonb not null default '{"ativo":false}',       -- {ativo, meta:4, premio:{tipo, produtoId|valor}, janelaMeses:12}
  aniversario jsonb not null default '{"ativo":false}', -- {ativo, cupom:{tipo, valor, teto}, diasAntes:3, diasDepois:3, whatsapp:true}
  atualizado_em timestamptz not null default now()
);
create unique index if not exists clube_config_loja on clube_config (tenant_id, coalesce(unidade_id,'00000000-0000-0000-0000-000000000000'::uuid));
create table if not exists clube_selo (                                 -- 1 por cliente por mês
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, cliente_id uuid not null,
  mes date not null, evento text, pedido_id uuid not null, criado_em timestamptz not null default now(),
  unique (tenant_id, cliente_id, mes)
);
create table if not exists sorteio (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, unidade_id uuid,
  nome text not null, inicio date not null, fim date not null,
  pedidos_por_numero int not null default 3 check (pedidos_por_numero between 1 and 10),
  valor_minimo numeric not null default 0, max_numeros_cliente int,
  canais text[] not null default '{cardapio}',            -- cardapio | totem | balcao
  data_apuracao date not null,                            -- extração da Loteria Federal
  metodo_apuracao text not null default 'unidades_5_premios',
  certificado text, certificado_arquivo text, regulamento text, regulamento_url text,
  status text not null default 'rascunho',                -- rascunho | publicado | encerrado | apurado | finalizado
  resultado_loteria jsonb, criado_em timestamptz not null default now()
);
create table if not exists sorteio_premio (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, sorteio_id uuid not null,
  ordem int not null, nome text not null, descricao text, quantidade int not null default 1,
  valor_estimado numeric, imagem_ref text, nota_compra_ref text
);
create table if not exists sorteio_numero (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, sorteio_id uuid not null,
  cliente_id uuid not null, ordinal int not null, numero char(5) not null,
  pedidos uuid[] not null, aceite_em timestamptz not null, criado_em timestamptz not null default now(),
  unique (sorteio_id, numero), unique (sorteio_id, cliente_id, ordinal)
);
create table if not exists sorteio_ganhador (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, sorteio_id uuid not null,
  premio_id uuid not null, numero_id uuid not null, posicao int not null,
  status text not null default 'a_contatar', entrega_ref text, atualizado_em timestamptz not null default now()
);
```

## 3. Regras de negócio (backend, módulo `clube`)

O gatilho é o **pedido concluído**, no mesmo ponto em que a fidelidade já credita o pedido (`FidelidadeService.creditarPedido`). Pedido cancelado depois **estorna**: o selo some se era o único do mês, e o número é anulado. Tudo idempotente pelo `pedido_id`.

1. **Raspadinha.** Ao concluir um pedido com o recurso ativo, cria um `cupom` pessoal (`cliente_id`, `origem='raspadinha'`, `max_usos=1`, validade = hoje + `validadeDias`), com o valor da config. O cardápio mostra a raspadinha na confirmação e, ao revelar, só registra que o cliente viu (`POST /publico/cardapio/:token/clube/raspadinha/:pedidoId/revelar`). O cupom vale mesmo se ele nunca raspar, e entra sozinho no próximo pedido como "cupom sugerido".
2. **Selos.** 1 selo por cliente por mês civil (fuso de São Paulo), no primeiro pedido concluído do mês; `evento` = evento sazonal ativo no dia (arte do selo). Ao completar a `meta` dentro da `janelaMeses`, gera um prêmio no mesmo fluxo de prêmios da fidelidade (abate automático, como hoje) e reinicia a contagem.
3. **Aniversário.** `cliente.aniversario` (MM-DD, opcional, com consentimento) é preenchido em "Sua conta → Perfil". Na janela `[dia − diasAntes, dia + diasDepois]` existe um cupom pessoal `origem='aniversario'` (gerado por job diário às 06:00, 1 por ano). Opcional: mensagem pelo WhatsApp no dia, só para quem não tem `opt_out_marketing`.
4. **Sorteio.**
   - Um pedido conta se: o sorteio está `publicado`, o pedido está dentro de `inicio..fim`, é de canal permitido, tem `total ≥ valor_minimo` e o cliente está identificado.
   - A cada `pedidos_por_numero` pedidos que contam, o cliente ganha direito a 1 número.
   - O número só é emitido depois do aceite do regulamento (`POST .../sorteio/:id/participar` com CPF), em 00000–99999, aleatório e único no sorteio (`crypto.randomInt` + unique). Respeita `max_numeros_cliente`.
   - Direito sem aceite fica pendente até o fim do período.
5. **Apuração (`metodo_apuracao='unidades_5_premios'`).** O número ganhador é formado pelo algarismo da unidade do 1º ao 5º prêmio da Loteria Federal, lidos de cima para baixo. Se esse número não foi distribuído, vale o próximo superior distribuído e, depois, o inferior.
   - Prêmios seguintes: próximos números distribuídos na mesma ordem.
   - Um cliente ganha no máximo 1 prêmio, salvo se o regulamento disser outra coisa.
   - A apuração grava `resultado_loteria`, os ganhadores e a trilha de auditoria. O que valer é o que o regulamento aprovado disser; o método é configurável por código.
6. **Endpoints públicos** (identidade sempre pelo token do cliente, nunca por telefone solto):
   - `GET /publico/cardapio/:token/clube?ct=` devolve config ativa + estado do cliente: `{ raspadinha, selos:{tem[], meta, premio}, aniversario:{hoje, cupom}, sorteio:{id, nome, fim, premios[], pedidosPorNumero, contam, numeros[], direitoPendente} }`.
   - `POST .../clube/raspadinha/:pedidoId/revelar`, `POST .../sorteio/:id/participar {cpf, aceite:true}`, `GET .../sorteio/:id/regulamento`.
   - O payload do pedido concluído (`/pedido/:id`) ganha `clube: { raspadinha:{codigo, texto, validade, revelada}, seloNovo, sorteio:{contou, progresso, novoNumero} }`.
7. **Admin** (`/marketing/clube`, RBAC no servidor: gerente e acima):
   - abas Raspadinha, Selos e Aniversário, cada uma com a sua config;
   - aba Sorteios, com lista, criação, prêmios e anexos;
   - publicar só com os itens da seção 1;
   - painel do sorteio: participantes, números, progresso, botão "Apurar" com os 5 prêmios da Loteria;
   - ganhadores, com status de contato e entrega;
   - exportações.

## 4. Cardápio (todos os templates)

| Onde | O que aparece |
|---|---|
| Vitrine, após a faixa do evento | Cartão **Aniversário** (bolo com velas animadas, confete na 1ª vez da sessão) e cartão **Sorteio**, em formato de bilhete: progresso "2 de 3 pedidos", dias até o fim, "Ver prêmios" e, se tiver direito, "Pegar meu número" |
| Folha **Prêmios** | Prêmios com foto e quantidade, "Como participar" em 3 passos, data da Loteria, número do certificado, "Prêmios não podem ser trocados por dinheiro", link do regulamento |
| Confirmação | **Raspe e ganhe** (canvas, apaga com o dedo, revela ao passar de 50%, confete; botão "Revelar sem raspar" para acessibilidade). **Sorteio**: "Este pedido contou: 2 de 3" ou "Completou 3 de 3! Pegar meu número", e o bilhete com o número após o aceite. **Selo do mês** carimbando no álbum |
| Folha **Participar** | CPF (com máscara e validação), "Li e aceito o regulamento", Participar |
| Próximo pedido | Cupom da raspadinha aplicado sozinho, com aviso |
| Sua conta → Benefícios | Números da sorte, álbum de selos, cupom da raspadinha |
| Sua conta → Perfil | "Aniversário (dia e mês)", opcional |

Regras de UI: tudo respeita `prefers-reduced-motion` (sem confete, a raspadinha vira botão "Revelar"); textos sem promessa de chance onde não há sorte; o cartão do sorteio some quando o sorteio não está `publicado`.

## 5. Plano de PRs e prompts para o Claude Code

Cada PR: branch → plano aprovado → implementação → `npm run build` nos dois → CI verde → merge. Mudança distribuível registrada no `RELEASES.md`.

1. **PR 1 · Migration + módulo `clube` (raspadinha e selos).**
   > Leia `CLAUDE.md` e `docs/templates-cardapio/07-clube-de-recompra.md` (seções 2 e 3, itens 1, 2, 6 e 7). Verifique o último número de migration em `origin/main` e apresente o plano: migration, módulo `clube`, gancho no pedido concluído junto da fidelidade, estorno no cancelamento, endpoints e a config no admin. Aguarde aprovação. Implemente só raspadinha e selos, com testes de idempotência (mesmo pedido concluído duas vezes) e de estorno.
2. **PR 2 · Aniversário.**
   > Implemente o item 3 da seção 3 do `07-clube-de-recompra.md`: campo de aniversário (MM-DD) no perfil do cliente com consentimento, job diário do cupom pessoal e mensagem opcional pelo WhatsApp respeitando `opt_out_marketing`. Plano antes do código.
3. **PR 3 · Sorteio (backend + admin).**
   > Implemente os itens 4, 5, 6 e 7 da seção 3 do `07-clube-de-recompra.md` e as travas da seção 1: rascunho até ter certificado, regulamento e notas dos prêmios; números aleatórios únicos; apuração pelo método `unidades_5_premios` com aproximação; auditoria e exportações. Testes: limite de números, pedido cancelado, apuração com número não distribuído. Plano antes do código.
4. **PR 4 · Cardápio.**
   > Implemente a seção 4 do `07-clube-de-recompra.md` nos templates novos, usando `GET /clube` e o bloco `clube` do pedido. Compare com o protótipo (`docs/templates-cardapio/prototipo/prototipo-interativo.html`, painel "Clube de recompra") e liste as divergências no PR.

## 6. Checklist de aceite

- [ ] Nenhum benefício aleatório fora do sorteio (revisão de código: sem `random` em valor de cupom).
- [ ] Raspadinha: cupom pessoal criado no pedido concluído, uso único, validade, aplicado sozinho no próximo pedido; revelar é só visual.
- [ ] Selos: 1 por mês (fuso de São Paulo), arte do evento do mês, prêmio ao completar a meta, estorno no cancelamento.
- [ ] Aniversário: só com data informada e consentimento; cupom na janela; WhatsApp respeita opt-out.
- [ ] Sorteio: não publica sem certificado, regulamento e notas dos prêmios; prêmio em dinheiro recusado.
- [ ] Contagem por `pedidos_por_numero`, `valor_minimo` e canais; número só após aceite com CPF válido; números únicos.
- [ ] Apuração reproduzível a partir do resultado da Loteria e auditada; exportação para prestação de contas.
- [ ] Cardápio: vitrine, prêmios, confirmação, participar e conta como no protótipo; movimento reduzido respeitado.
- [ ] RBAC no servidor para o admin; cliente só vê o próprio estado (token do cliente).
