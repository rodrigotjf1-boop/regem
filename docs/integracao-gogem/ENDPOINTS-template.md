# Regem × GoGeM — Contrato de Integração (ENDPOINTS)
> Gerado por Claude Code a partir do código-fonte do Regem em {DATA}. Commit base: {HASH}.
> Regra: todo exemplo de payload deve vir de DTO/serializer real do código. Onde faltar, marcar `LACUNA:` + proposta.

## 0. Visão geral técnica
- Framework/linguagem:
- Padrão de rotas (arquivo(s) onde são registradas):
- Autenticação atual (tipo, header, expiração):
- Banco e ORM:
- Multiempresa? (como o tenant/loja é resolvido em cada request):

## 1. Autenticação de serviço (máquina-a-máquina)
| Item | Valor |
|---|---|
| Endpoint de token | |
| Grant/fluxo | |
| Escopos/perfis | |
| Exemplo de request/response | |
| LACUNAS | |

## 2. Catálogo (leitura)
### 2.1 Produtos
- `GET ...` — descrição, filtros, paginação
- Payload de resposta (exemplo real):
- **Campo do código PDV** (tabela.coluna): — crítico para o de-para do GoGeM
### 2.2 Categorias
### 2.3 Complementos/adicionais (se existirem no Regem)
### 2.4 Preços e listas de preço (por loja?)
### 2.5 Disponibilidade/estoque consultável
### LACUNAS do catálogo

## 3. Lançamento de venda (escrita) — CRÍTICO
- Endpoint existente para registrar venda de origem externa? (método, path)
- Corpo esperado: itens (código PDV, qtd, valor), pagamentos (forma, valor, NSU/autorização), CPF, identificação do terminal/origem
- Resposta: identificador do lançamento no Regem
- **Idempotência**: aceita chave única do pedido (UUID)? Comportamento em reenvio?
- Side effects: caixa? financeiro? estoque (ficha técnica)? fiscal?
- LACUNA/proposta de endpoint mínimo (se não existir):

## 4. Estoque / ficha técnica
- A baixa ocorre automaticamente no lançamento da venda? Onde no código?
- Consulta de saldo por produto:
- LACUNAS

## 5. Fechamento de caixa
- Como o Regem representa caixa/turno; endpoint de consulta e de conciliação
- Como uma origem externa (totem) deve aparecer no fechamento
- LACUNAS

## 6. Fiscal
- O Regem emite (NFC-e/SAT)? Módulo/serviço responsável
- Endpoint para: emitir a partir de venda externa OU consultar status de emissão
- Dados devolvidos p/ impressão do DANFE (chave, QR, protocolo)
- LACUNAS

## 7. Eventos / Webhooks
- Existe barramento de eventos ou webhooks hoje? Quais eventos?
- LACUNA/proposta mínima (`order.registered`, `stock.low`, `cashclosing.done`)

## 8. Mapa de modelos (tabelas relevantes)
| Tabela | Campos-chave p/ integração | Observações |
|---|---|---|

## 9. Plano de mudanças mínimas no Regem
| # | Tarefa | Arquivos | Tamanho (P/M/G) | Bloqueia piloto? |
|---|---|---|---|---|
