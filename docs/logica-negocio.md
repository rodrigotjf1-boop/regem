# Regem — Lógica de Negócio do ERP (fórmulas, contratos e integrações)

> Documento vivo, par do `decisoes-design.md`. Define **como se calcula** cada regra de dinheiro, estoque e jornada — e onde ela se encaixa nos módulos que já existem. Nomes de tabelas/campos seguem o schema Drizzle atual (`empresa/unidade`, `item_estoque`, `movimento_estoque`, `lote`, `ficha_tecnica`, `ficha_ingrediente`, `titulo_financeiro`, `lancamento_caixa`, `ponto_marcacao`, `escala_alocacao`).
> Regra de ouro (já em vigor): **saldos nunca são armazenados — sempre derivados de lançamentos imutáveis.** Estorno = lançamento inverso, nunca UPDATE/DELETE.

---

## 1. Estoque e produção

### 1.1 Custo Médio Ponderado móvel (CANÔNICO — já implementado no recebimento)

A cada **entrada com custo**:

```
novo_custo_medio = (saldo_antes × custo_medio_atual + qtd_entrada × custo_unitario_entrada)
                   ÷ (saldo_antes + qtd_entrada)
```

Regras:
- `saldo_antes` = soma do ledger ANTES da entrada (como já está em `recebimento.service.ts`) — sempre dentro da mesma transação.
- Saídas e ajustes **não alteram** o custo médio; apenas entradas com custo.
- Se `saldo_antes ≤ 0` (estoque zerado ou negativo por ajuste), `novo_custo_medio = custo_unitario_entrada`.
- Entrada **sem custo informado** não altera o custo médio (movimento entra, custo fica).
- `item_estoque.custo_medio` é um **cache de leitura** recalculável; a verdade são os movimentos. Criar script `npm run recalc:custo-medio` que reprocessa o ledger em ordem cronológica e confere o cache (usar também como teste de integridade).

### 1.2 Explosão de ficha técnica (baixa por venda/produção)

Quando 1 unidade de uma `ficha_tecnica` é vendida ou produzida, baixa cada ingrediente:

```
qtd_baixa(ingrediente) = qtd_liquida × fc × qtd_vendida ÷ rendimento_da_ficha
```

- `fc` = fator de correção (perdas de limpeza/cocção) já presente em `ficha_ingrediente`.
- Gera 1 `movimento_estoque` tipo `saida` por ingrediente, `motivo = 'venda'` (ou `'producao'`), com `ref_tipo/ref_id` apontando à venda/produção (adicionar essas colunas se ainda não existem — ver §6).
- **Fichas aninhadas** (ficha que usa outra ficha como ingrediente): explosão recursiva com limite de profundidade 3 e detecção de ciclo (A usa B que usa A → rejeitar no cadastro).
- **Idempotência:** a explosão de uma mesma venda (`ref_id`) só pode ocorrer uma vez — índice único `(tenant_id, ref_tipo, ref_id, item_id)` no movimento ou verificação prévia na transação.
- Estorno/cancelamento de venda = movimentos **inversos** (`entrada`, motivo `estorno_venda`, mesma `ref`).

### 1.3 CMV teórico × CMV real (o KPI diferencial)

```
custo_teorico_porcao = Σ(qtd_liquida × fc × custo_medio_do_item) ÷ rendimento
cmv_teorico_%        = custo_teorico_porcao ÷ preco_venda × 100        (já na tela de fichas)

cmv_real_periodo     = estoque_inicial + compras_do_periodo − estoque_final
                       (valores a custo médio; estoque_inicial/final = snapshot do ledger na data)

desvio = cmv_real − cmv_teorico_consumido
```

- `cmv_teorico_consumido` = Σ(explosões do período a custo médio) — o que DEVERIA ter saído pelas vendas.
- **Desvio** = desperdício não registrado + porção fora do padrão + furo de contagem. Exibir no dashboard como "Desvio de CMV" ao lado do desperdício registrado (tela de desperdício já existe): `desvio − desperdicio_registrado = furo inexplicado`.
- Snapshots de estoque: job mensal grava `estoque_snapshot (tenant, unidade, item, data, saldo, custo_medio)` no fechamento — barato e torna o CMV real O(1).

### 1.4 Ponto de pedido e estoque de segurança (automatiza o "pedido antecipado")

```
consumo_medio_diario (CMD) = Σ saídas dos últimos 28 dias ÷ 28        (janela configurável)
estoque_seguranca (ES)     = CMD × dias_seguranca                     (default 2; por item)
ponto_pedido (ROP)         = CMD × lead_time_fornecedor + ES
qtd_sugerida               = (CMD × dias_cobertura_alvo + ES) − saldo_atual   (default cobertura 7d)
```

- `lead_time_fornecedor` = média de `recebimento.data − pedido.data` do fornecedor; enquanto não houver pedido formal, usar campo manual `fornecedor.lead_time_dias` (default 2).
- Job diário: itens com `saldo ≤ ROP` → alerta ao gerente + entra na lista "Pedido antecipado" (tela de estoque já tem o botão).
- Itens sem giro (CMD = 0) não geram sugestão.

### 1.5 Curva ABC (prioriza contagem e negociação)

Sobre o valor consumido no período (`Σ saídas × custo_medio`), ordenar itens desc e acumular:
- **A** = até 80% do valor (contar semanalmente; negociar preço)
- **B** = 80–95% (contar quinzenalmente)
- **C** = restante (contar mensalmente)

Exibir a classe na listagem de itens e usar para sugerir a **contagem programada** (job já previsto).

### 1.6 FEFO / PVPS por lote (já há tabela `lote`)

- Toda **saída** consome lotes em ordem de `validade ASC` (First-Expire-First-Out): decrementa o lote mais próximo do vencimento até zerar, passa ao próximo.
- Saldo por lote = quantidade de entrada − consumos atribuídos (tabela `lote_consumo` ou coluna `saldo` derivável; preferir derivado).
- Alertas: `validade − hoje ≤ 2 dias` → crítico (vermelho); `≤ 5` → atenção. Lote vencido com saldo > 0 → sugerir registro de desperdício com 1 clique (pré-preenchido: item, qtd, motivo `vencimento`, custo).
- Inconformidade PVPS (item "no fundo" com vencimento mais próximo) segue registro manual da vistoria — o sistema não tem como saber a posição física.

---

## 2. Financeiro

### 2.1 Títulos e origem automática

- Recebimento de mercadoria **conferido** → gera `titulo_financeiro` tipo `pagar`, `origem='recebimento'`, `valor = Σ(qtd × custo_unitario)`, vencimento = data + prazo do fornecedor (campo `fornecedor.prazo_pagamento_dias`, default 28). Nunca duplicar: título único por recebimento (`ref_id`).
- Baixa (pagar/receber) = registro em `lancamento_caixa` vinculado ao título; **baixa parcial** permitida (saldo do título = valor − Σ baixas). Estorno de baixa = lançamento inverso.

### 2.2 Fluxo de caixa projetado (visão que o presidente mais usa)

```
saldo_projetado(dia D) = saldo_atual
                       + Σ titulos_receber com vencimento ≤ D (em aberto)
                       − Σ titulos_pagar   com vencimento ≤ D (em aberto)
```

- Série diária de 30/60/90 dias; títulos recorrentes projetam as próximas ocorrências dentro da janela.
- `saldo_atual` = Σ `lancamento_caixa` (ledger, nunca campo).
- Destacar o **primeiro dia negativo** ("caixa fura em 14/08") — é o alerta de ouro.

### 2.3 Margem, markup e preço sugerido (evitar a confusão clássica)

```
margem_% = (preco − custo) ÷ preco × 100          (sobre o PREÇO)
markup   = preco ÷ custo                           (multiplicador sobre o CUSTO)
preco_sugerido = custo_porcao ÷ (meta_cmv_% ÷ 100) (inverso do CMV — já sugerido na tela de fichas)
```

Na ficha técnica, mostrar os três lado a lado ao digitar o preço; nunca rotular markup como margem.

### 2.4 DRE gerencial simplificada (por unidade, mensal)

```
Receita bruta (vendas)                              [futuro: PDV/integrações]
(−) CMV real (§1.3)
(=) Lucro bruto
(−) Pessoal (folha estimada: horas apuradas × custo/h da função — prévia gerencial)
(−) Despesas fixas (títulos pagos por categoria: aluguel, energia, etc.)
(=) Resultado operacional gerencial
```

Alimenta o comparativo da Visão C&O. Enquanto não há PDV, `Receita` pode ser lançamento manual mensal ou import.

### 2.5 Fechamento de caixa cego (quando houver PDV)

Operador informa o contado SEM ver o esperado; sistema calcula `diferenca = contado − esperado` por meio de pagamento (dinheiro, cartão, Pix). Sangria/suprimento = lançamentos com motivo. Diferença acima do limite configurável → ocorrência automática (liga com a gamificação) + auditoria.

---

## 3. Jornada e ponto (prévia gerencial — fechamento oficial valida com contador)

Sobre `ponto_marcacao` do dia × `escala_alocacao`/turno previsto:

```
horas_trabalhadas = (saida − entrada) − intervalo_real
extra             = max(0, horas_trabalhadas − jornada_prevista)
  → 50% em dia útil; 100% em domingo/feriado (tabela de feriados por unidade)
adicional_noturno = horas entre 22:00–05:00 × 20%
  → hora noturna reduzida: 52min30s contam como 1h (fator 60/52,5 ≈ 1,1428)
atraso            = max(0, entrada_real − entrada_prevista − tolerancia)   (tolerância default 5 min; CLT: 10 min/dia total)
DSR sobre extras  = (Σ extras do mês ÷ dias úteis) × (domingos + feriados)  → exibir como estimativa
intervalo mínimo  = jornada > 6h exige ≥ 1h de intervalo → sem marcação = alerta de conformidade (não bloquear)
```

- Tudo rotulado na UI como **"prévia gerencial — confira com sua contabilidade"** (convenções coletivas alteram percentuais).
- Banco de horas: fora do MVP; registrar decisão quando entrar.
- Exportação AFD/AEJ (Portaria 671): próxima entrega do módulo ponto — os dados já suportam.

---

## 4. Integrações (mapa e prioridade)

| # | Integração | Via | Fase | Encaixe no código |
|---|---|---|---|---|
| 1 | **NF-e entrada (Distribuição DF-e)** | Hub fiscal API (PlugNotas/Focus/eNotas) | Próxima | XML da SEFAZ → pré-preenche `recebimento` + itens + custos; foto vira fallback |
| 2 | **NFC-e/SAT emissão** | Mesmo hub fiscal | Com PDV | Nunca falar direto com SEFAZ |
| 3 | **Pix dinâmico + conciliação** | API do PSP/banco | Com PDV | Webhook → `lancamento_caixa`; conciliar esperado × liquidado |
| 4 | **iFood (pedidos/cardápio)** | API oficial | Alta demanda | Pedido → explosão de ficha (§1.2) + fila do KDS + bot |
| 5 | **WhatsApp Business** | Cloud API (Meta) | Média | Bot + relatórios agendados no zap do dono |
| 6 | **Contábil** | Export layout Domínio + envio XMLs | Barata/alto valor | Job mensal |
| 7 | **Open Finance (extratos)** | Agregador (Pluggy/Belvo) | Depois | Conciliação automática do caixa |
| 8 | **Impressoras ESC/POS** | Nó local/terminal | Com etiquetas | Etiquetas PVPS e cupom |

Regras transversais de integração:
- **Todo webhook é idempotente**: chave única do evento (`provider_event_id`) gravada; repetido = ignorar com 200.
- Toda integração escreve nos **mesmos ledgers** (movimento_estoque, lancamento_caixa) com `origem` identificada — nunca cria caminho paralelo de saldo.
- Segredos de integração por tenant em tabela própria criptografada, nunca em código.
- Confirmar docs/planos atuais de cada provedor antes de implementar (mudam com frequência).

---

## 5. Jobs agendados (consolidação)

| Job | Quando | Faz |
|---|---|---|
| Expurgo LGPD fotos ponto | 03:00 diário | ✓ já existe |
| Ponto de pedido (§1.4) | 06:00 diário | alerta + lista de compra sugerida |
| Validades FEFO (§1.6) | 06:10 diário | alertas 2d/5d + vencidos → sugestão de desperdício |
| Snapshot de estoque (§1.3) | dia 1, 02:00 | grava `estoque_snapshot` |
| Curva ABC (§1.5) | segunda, 05:00 | reclassifica itens |
| Recorrência de títulos | 04:00 diário | base existe → garantir projeção no fluxo (§2.2) |
| Relatórios agendados C&O | conforme agenda | e-mail/WhatsApp |

(Instância única no EasyPanel: manter os jobs idempotentes; se escalar horizontalmente, adicionar lock — ex.: `pg_advisory_lock`.)

---

## 6. Ajustes de schema necessários (migration única)

- `movimento_estoque`: + `ref_tipo` (venda|producao|recebimento|desperdicio|ajuste|estorno), `ref_id uuid`, índice único parcial `(tenant_id, ref_tipo, ref_id, item_id) where ref_id is not null` (idempotência da explosão).
- `fornecedor`: + `lead_time_dias int default 2`, `prazo_pagamento_dias int default 28`.
- `item_estoque`: + `dias_seguranca int default 2`, `classe_abc char(1)`.
- Nova `estoque_snapshot` (tenant, unidade, item, data, saldo, custo_medio) — PK composta.
- Nova `feriado` (tenant, unidade nullable, data, nome) para §3.
- (Com PDV) `venda`/`venda_item` mínimas para ancorar a explosão — definir quando chegar a fase.

---

## 7. Casos de teste obrigatórios (adicionar à suíte do P3)

1. Custo médio: estoque zerado → custo = custo da entrada; entrada sem custo não altera; sequência de 3 entradas bate com cálculo manual.
2. Explosão: venda de 2un de ficha rendimento 10 baixa `qtd_liquida×fc×2/10` de cada ingrediente; repetir a mesma `ref_id` NÃO duplica; ficha cíclica é rejeitada.
3. CMV real: EI + compras − EF confere com soma dos movimentos do período.
4. ROP: item com CMD 4/dia, lead 2d, ES 2d → ROP 16; saldo 15 dispara, 17 não.
5. FEFO: saída de 8 com lotes [5 vence dia 4, 10 vence dia 9] consome 5 do primeiro e 3 do segundo.
6. Fluxo projetado: identifica corretamente o primeiro dia negativo; recorrente projeta ocorrências na janela.
7. Jornada: 07:54–17:03 com intervalo 58min e previsto 8h → extra correta; hora entre 22h–5h aplica fator noturno.
8. Estorno: venda estornada zera efeito líquido no saldo E no CMV do período.

---

## 8. Ordem de implementação sugerida

1. Migration §6 + `ref_*` no ledger (destrava tudo).
2. Explosão de ficha (§1.2) com endpoint interno `POST /producao` (produzir X unidades de uma ficha → baixa insumos + entrada do produto com custo teórico) — valor imediato sem PDV.
3. Jobs de ROP + validades (§1.4/1.6) — automatiza compra e reduz perda.
4. CMV real + snapshot + desvio no dashboard (§1.3) — o KPI de venda do produto.
5. Fluxo de caixa projetado (§2.2) na tela financeiro.
6. Jornada calculada no espelho de ponto (§3) como prévia.
7. Integração 1 (DF-e via hub) — upgrade do recebimento.

## Changelog
| Data | Decisão | Motivo |
|---|---|---|
| 2026-07-03 | Documento criado; custo médio do recebimento declarado canônico | Base da fase ERP |
| _adicionar aqui_ | | |
