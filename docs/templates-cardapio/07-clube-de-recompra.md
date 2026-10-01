# 07 · Clube de recompra: raspadinha, selos, aniversário e meta do mês

> Pré-requisito: Fase 0 do `00-base-cardapio.md` e o `05-recursos-integrados.md` (conta do cliente). Referência visual: protótipo, painel **Clube de recompra** e a seção "Clube de recompra: dentro da lei, sem burocracia".

## Resumo para apresentar

**Problema.** O cliente compra uma vez pelo anúncio e some. Cupom genérico vira desconto para quem já ia comprar.

**Proposta.** Quatro mecânicas que dão motivo para o próximo pedido, todas ligadas à conta do cliente que o Regem já tem (telefone + token). **Nenhuma usa sorte**, então nenhuma precisa de autorização do governo:

| Mecânica | O que o cliente vê | Por que traz de volta |
|---|---|---|
| **Raspadinha** | Na confirmação, raspa com o dedo e revela um cupom para o próximo pedido | Cupom pessoal com prazo curto (7 dias) |
| **Álbum de selos** | 1 selo por mês com pedido (com a arte do evento do mês); juntou 4, ganha um prêmio | Hábito mensal; ninguém quer perder a sequência |
| **Aniversário** | Na semana do aniversário, "Parabéns, Rodrigo!" com bolo e confete, e um presente já aplicado | Momento afetivo, alta conversão |
| **Meta do mês** | "Faça 3 pedidos em outubro e escolha um prêmio. Com 6, um prêmio maior." O cliente escolhe da lista da loja e o prêmio entra grátis no próximo pedido | Frequência: o 2º e o 3º pedido do mês |

**Configurável pelo lojista:**
- pedidos para a meta (padrão 3, de 1 a 10);
- valor mínimo do pedido que conta;
- canais que contam;
- níveis e lista de prêmios de cada nível;
- prazo para usar o prêmio;
- valor do cupom da raspadinha;
- meta e prêmio do álbum;
- presente de aniversário.

**O que muda no Regem:**
- 1 migration com 3 tabelas novas e 3 colunas;
- um módulo `clube` no backend;
- uma tela "Clube" em Marketing;
- os blocos no cardápio, na confirmação e na conta do cliente.

## 1. Por que não tem sorteio (e o que garante que não precisa de autorização)

Sorteio ligado a compra é promoção comercial (Lei 5.768/1971) e exige autorização prévia da Secretaria de Prêmios e Apostas (SPA/MF), apuração pela Loteria Federal e prestação de contas. Burocracia demais para uma lanchonete. Já o **"compre e ganhe" em que todo mundo que cumpre a regra ganha** dispensa autorização, desde que siga as condições abaixo. O cadastro do Regem trava cada uma:

| Condição para dispensar autorização | Trava no Regem |
|---|---|
| Todo mundo que cumpre a regra recebe | Prêmio criado por regra no pedido concluído; não existe "primeiros N" |
| Sem limite de estoque nem quantidade fixa de prêmios | O cadastro não tem campo de quantidade total nem "enquanto durar o estoque"; a loja só escolhe itens que consegue entregar a todos |
| Sem sorte | Nenhum valor de benefício é aleatório (revisão de código e teste). A raspadinha só **revela** um prêmio já definido |
| O único critério é comprar | Nada de curtir, compartilhar, marcar amigos ou responder pergunta |
| Uma loja só e sem promoção autorizada ao mesmo tempo | O admin avisa se o lojista marcar que tem campanha autorizada em andamento |
| Sem pagamento extra para receber | O prêmio entra no pedido com preço zero; não exige comprar algo a mais além da regra |

Fontes: [LRI Advogados — cuidados com o "compre e ganhe"](https://lrilaw.com.br/2021/05/25/atencao-e-cuidados-com-as-promocoes-compre-e-ganhe/), [Migalhas — novas regras do "compre e ganhe"](https://www.migalhas.com.br/depeso/300928/as-novas-regras-das-acoes-promocionais-de-compre-e-ganhe), [Mattos Filho — promoções comerciais](https://www.mattosfilho.com.br/unico/promocoes-comerciais-pontos-de-atencao/). O Regem não é assessoria jurídica: a tela da meta mostra um resumo dessas condições para o lojista.

Os mini-jogos do `06-eventos-sazonais.md` (caça aos ovos, abóbora) seguem a mesma linha: liberam só **desconto igual para todos**, nunca produto ou brinde sorteado.

## 2. Modelo de dados

Uma migration nova. Antes de criar, verifique o **último número em `origin/main`** (hoje 303) e use o próximo (regra do `CLAUDE.md`). Idempotente, com `tenant_id` em tudo.

```sql
-- NNN_clube_recompra.sql
alter table cliente add column if not exists aniversario text;          -- 'MM-DD' (sem ano), opcional
alter table cupom   add column if not exists cliente_id uuid;           -- cupom pessoal
alter table cupom   add column if not exists origem text;               -- 'raspadinha' | 'aniversario' | null

create table if not exists clube_config (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, unidade_id uuid,
  raspadinha jsonb not null default '{"ativo":false}',  -- {ativo, tipo:'percentual'|'valor', valor, teto, minimo, validadeDias}
  selos jsonb not null default '{"ativo":false}',       -- {ativo, meta:4, premio:{produtoId}, janelaMeses:12}
  aniversario jsonb not null default '{"ativo":false}', -- {ativo, cupom:{tipo, valor, teto}, diasAntes:3, diasDepois:3, whatsapp:true}
  meta jsonb not null default '{"ativo":false}',        -- {ativo, pedidosPorNivel:3, valorMinimo:30, canais:['cardapio'], prazoUsoDias:30,
                                                        --  niveis:[{multiplicador:1, itens:[produtoId...]}, {multiplicador:2, itens:[...]}]}
  atualizado_em timestamptz not null default now()
);
create unique index if not exists clube_config_loja on clube_config (tenant_id, coalesce(unidade_id,'00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists clube_selo (                                 -- 1 por cliente por mês
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, cliente_id uuid not null,
  mes date not null, evento text, pedido_id uuid not null, criado_em timestamptz not null default now(),
  unique (tenant_id, cliente_id, mes)
);
create table if not exists clube_meta_premio (                          -- prêmio conquistado na meta do mês
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, cliente_id uuid not null,
  mes date not null, nivel int not null,
  produto_id uuid,                                                      -- escolhido pelo cliente (null = ainda não escolheu)
  status text not null default 'a_escolher',                            -- a_escolher | escolhido | usado | expirado | estornado
  pedido_uso_id uuid, expira_em date not null, criado_em timestamptz not null default now(),
  unique (tenant_id, cliente_id, mes, nivel)
);
```

## 3. Regras de negócio (backend, módulo `clube`)

O gatilho é o **pedido concluído**, no mesmo ponto em que a fidelidade já credita o pedido (`FidelidadeService.creditarPedido`). Pedido cancelado depois **estorna** o que gerou. Tudo idempotente pelo `pedido_id`.

1. **Raspadinha.** Ao concluir o pedido, cria um `cupom` pessoal (`cliente_id`, `origem='raspadinha'`, `max_usos=1`, validade = hoje + `validadeDias`) com o valor **fixo** da config. A raspadinha na confirmação é só visual (`POST /publico/cardapio/:token/clube/raspadinha/:pedidoId/revelar` registra que ele viu). O cupom vale mesmo sem raspar e aparece como cupom sugerido no próximo pedido.
2. **Selos.** 1 selo por cliente por mês civil (fuso de São Paulo), no primeiro pedido concluído do mês. O campo `evento` guarda o evento sazonal ativo no dia (arte do selo). Ao completar a `meta` dentro da `janelaMeses`, gera um prêmio pelo fluxo de prêmios da fidelidade (abate automático, como hoje) e reinicia a contagem.
3. **Aniversário.** `cliente.aniversario` (MM-DD, opcional, com consentimento) é preenchido em "Sua conta → Perfil". Um job diário às 06:00 gera o cupom pessoal `origem='aniversario'` para a janela `[dia − diasAntes, dia + diasDepois]`, 1 por ano. Mensagem pelo WhatsApp no dia é opcional e só vai para quem não tem `opt_out_marketing`.
4. **Meta do mês.**
   - **O que conta:** pedido concluído no mês civil, de canal permitido, com `total ≥ valorMinimo` e cliente identificado.
   - **Prêmio:** ao atingir `pedidosPorNivel × multiplicador`, cria `clube_meta_premio` com `status='a_escolher'`, `expira_em = último dia do mês + prazoUsoDias`.
   - **Escolha:** `POST .../clube/meta/premio/:id/escolher {produtoId}`. Só aceita itens da lista do nível; muda para `escolhido`.
   - **Resgate:** no próximo pedido, o servidor inclui a linha do produto escolhido com **preço zero** e marca `usado` com o `pedido_uso_id`. O prêmio não conta para pedido mínimo nem para a meta do mês.
   - **Estorno:** se um pedido que contou for cancelado e o cliente cair abaixo da meta, o prêmio ainda não usado vira `estornado`.
5. **Endpoints públicos.** A identidade vem sempre do token do cliente, nunca de telefone solto.
   - `GET /publico/cardapio/:token/clube?ct=` devolve:
     ```
     { raspadinha,
       selos: {tem[], meta, premio},
       aniversario: {hoje, cupom},
       meta: {mes, fim, pedidosPorNivel, valorMinimo, pedidosNoMes,
              niveis[{pedidos, itens[{id, nome, imagem}]}], premios[{id, nivel, status, produto}]} }
     ```
   - O pedido concluído (`/pedido/:id`) ganha `clube: { raspadinha:{codigo, texto, validade, revelada}, seloNovo, meta:{contou, pedidosNoMes, nivelNovo} }`.
6. **Admin** (`/marketing/clube`, RBAC no servidor: gerente e acima).
   - Abas Raspadinha, Selos, Aniversário e Meta do mês.
   - Na Meta: níveis, itens por nível com o seletor de produtos, valor mínimo, canais e prazo.
   - Painel por mês: clientes por faixa de pedidos, prêmios escolhidos e usados.
   - Aviso fixo com as condições da seção 1.

## 4. Cardápio (todos os templates)

| Onde | O que aparece |
|---|---|
| Vitrine, após a faixa do evento | Cartão **Aniversário** (bolo com velas animadas, confete na 1ª vez da sessão) e cartão **Meta do mês** em formato de bilhete: trilha de pedidos com troféus nos marcos, dias até o fim, "Ver prêmios" e "Escolher agora" quando bater a meta |
| Folha **Prêmios da meta** | Níveis ("3 pedidos · escolha 1 prêmio", "6 pedidos · escolha 1 prêmio maior") com foto dos itens, "Como funciona" e "Todos que chegam à meta ganham. Não é sorteio" |
| Confirmação | **Raspe e ganhe** (canvas, apaga com o dedo, revela ao passar de 50%, confete; botão "Revelar sem raspar" para acessibilidade). **Meta**: "Este pedido contou: 3 pedidos em outubro"; ao bater, a escolha do prêmio ali mesmo. **Selo do mês** carimbando no álbum |
| Próximo pedido | Prêmio da meta na sacola por R$ 0,00 ("prêmio da meta") e cupom da raspadinha aplicado, com aviso |
| Sua conta → Benefícios | Meta do mês, álbum de selos, cupom da raspadinha |
| Sua conta → Perfil | "Aniversário (dia e mês)", opcional |

Tudo respeita `prefers-reduced-motion`: sem confete, e a raspadinha vira o botão "Revelar".

## 5. Plano de PRs e prompts para o Claude Code

Cada PR segue o fluxo branch → plano aprovado → implementação → `npm run build` nos dois → CI verde → merge. A mudança distribuível vai para o `RELEASES.md`.

1. **PR 1 · Migration + módulo `clube` (raspadinha e selos).**
   > Leia `CLAUDE.md` e `docs/templates-cardapio/07-clube-de-recompra.md` (seções 1 a 3, itens 1, 2, 5 e 6). Verifique o último número de migration em `origin/main` e apresente o plano: migration, módulo `clube`, gancho no pedido concluído junto da fidelidade, estorno no cancelamento, endpoints e config no admin. Aguarde aprovação. Implemente só raspadinha e selos, com testes de idempotência (mesmo pedido concluído duas vezes) e de estorno.
2. **PR 2 · Meta do mês.**
   > Implemente o item 4 da seção 3 do `07-clube-de-recompra.md` e as travas da seção 1: níveis, escolha do prêmio, linha de preço zero no próximo pedido validada no servidor, expiração e estorno. Testes: pedido abaixo do mínimo não conta, canal fora não conta, item fora da lista é recusado, prêmio não conta para pedido mínimo. Plano antes do código.
3. **PR 3 · Aniversário.**
   > Implemente o item 3 da seção 3 do `07-clube-de-recompra.md`: campo de aniversário (MM-DD) no perfil com consentimento, job diário do cupom pessoal e WhatsApp opcional respeitando `opt_out_marketing`. Plano antes do código.
4. **PR 4 · Cardápio.**
   > Implemente a seção 4 do `07-clube-de-recompra.md` nos templates novos, usando `GET /clube` e o bloco `clube` do pedido. Compare com o protótipo (`docs/templates-cardapio/prototipo/prototipo-interativo.html`, painel "Clube de recompra") e liste as divergências no PR.

## 6. Checklist de aceite

- [ ] Nenhum benefício aleatório (sem `random` em valor de cupom ou prêmio); raspadinha só revela.
- [ ] Nada de "primeiros N", estoque limitado ou quantidade total de prêmios no cadastro.
- [ ] Raspadinha: cupom pessoal no pedido concluído, uso único, validade, sugerido no próximo pedido.
- [ ] Selos: 1 por mês (fuso de São Paulo), arte do evento do mês, prêmio ao completar, estorno no cancelamento.
- [ ] Aniversário: só com data informada e consentimento; cupom na janela; WhatsApp respeita opt-out.
- [ ] Meta: contagem por mês, mínimo e canal; escolha só da lista; prêmio a R$ 0,00 no próximo pedido, validado no servidor; expira e estorna.
- [ ] Cardápio: vitrine, prêmios, confirmação, próximo pedido e conta como no protótipo; movimento reduzido respeitado.
- [ ] RBAC no servidor para o admin; cliente só vê o próprio estado (token do cliente).
