# Contrato de integração — Monitor de Visão ⇄ Regem

> **Para o time do Monitor de Visão.** Este documento define o que o Regem espera receber e o que o Regem vai chamar. É o contrato da integração — **nada foi implementado ainda de nenhum dos lados**; serve para alinharmos os formatos antes de codar.
>
> Princípio: **o Regem é cliente do Monitor**. A dependência é sempre Regem → API do Monitor. O Monitor continua um produto autônomo, vendável isolado; se o Regem estiver fora do ar, o Monitor segue operando e notificando pelo n8n normalmente.

---

## 1. Divisão de responsabilidades (o que ficou combinado)

| Responsável | Faz |
|---|---|
| **Monitor de Visão** | Captura, IA, decide **o tipo e a urgência** do alerta e **para onde ele vai** (roteamento). Continua dono do **WhatsApp** (via n8n). |
| **Regem** | **Recebe** o evento, **registra**, e **exibe** no destino que o evento indicar (KDS / painel / diretoria / registro). **Não** dispara WhatsApp. |
| **Empresa-cliente** | Responsável legal (LGPD) pelo monitoramento dos setores e pela autorização dos funcionários **em contrato**. Ver seção 5. |

**Regra anti-dupla-notificação:** WhatsApp = só n8n. Tela / KDS / registro = só Regem. O mesmo evento pode ir pros dois canais, mas cada canal tem um dono único.

---

## 2. O que o Monitor envia ao Regem (endpoint receiver)

O Regem vai expor um receiver. O Monitor faz um `POST` por evento.

```
POST  https://api.dmsregem.com/api/v1/monitor/eventos
      (ou o endereço do servidor local da loja, se a integração for on-premise)

Headers:
  Content-Type: application/json
  x-monitor-token: <SECRET>          ← chave combinada, uma por instalação/loja

Autenticação (recomendada):
  secret compartilhado no header + "loja.id" no corpo.
  O Regem resolve tenant + unidade a partir de (loja.id + secret).
  → É o modelo mais desacoplado, coerente com "produto autônomo".
```

### Corpo do evento — mantém o schema 2.0 de vocês, com 1 campo novo

```json
{
  "evento_id": "uuid",                      // OBRIGATÓRIO — idempotência (ver nota)
  "origem": "monitor-visao",
  "versao_schema": "2.0",
  "timestamp": "2026-07-20T17:26:37-03:00",
  "loja": { "id": "loja-01", "nome": "Mister Burguer" },
  "setor": { "nome": "Chapa / Grelha", "canal": 5 },
  "verificacao": { "nome": "EPI na chapa", "criterio": "..." },
  "resultado": {
    "status": "nao_conforme",               // conforme | nao_conforme | ...
    "confianca": 0.85,
    "observacao": "Funcionário sem touca."
  },
  "urgencia_sugerida": "alta",              // alta | media | baixa
  "destino": ["kds", "gerente"],            // ← NOVO: onde o Regem exibe (seção 3)
  "snapshot_base64": "<jpeg base64 ou null>"
}
```

Evento de falha técnica (câmera sem sinal), igual ao de vocês:
```json
{ "origem": "monitor-visao", "tipo": "falha_captura",
  "loja": { "id": "loja-01" }, "setor": { "canal": 5 },
  "urgencia_sugerida": "baixa", "destino": ["registro"], "timestamp": "..." }
```

**O campo `destino` é a peça-chave do combinado:** como o roteamento é decidido **por vocês** (por tipo de alerta), é o Monitor que marca pra onde o evento vai. O Regem só honra. Se `destino` vier ausente, o Regem aplica um padrão a partir da `urgencia_sugerida` (seção 3).

**Idempotência:** o Regem deduplica por `evento_id`. Reenviar o mesmo `evento_id` (retry, reconexão) **não duplica** — o receiver responde `{ "duplicado": true }`. Por favor mantenham o `evento_id` estável no retry.

### Resposta do Regem
```
200 { "ok": true, "evento_id": "<id interno>", "duplicado": false }
200 { "ok": true, "duplicado": true }              // já recebido
401 { "ok": false, "erro": "token inválido" }
422 { "ok": false, "erro": "loja/canal não mapeado" }   // loja.id/canal sem de-para no Regem
```

---

## 3. Catálogo de destinos do Regem (para o Monitor rotear)

Estes são os **locais definidos no Regem**. O Monitor escolhe um ou mais por evento, no campo `destino`:

| `destino` | Onde aparece no Regem | Comportamento | Bom para |
|---|---|---|---|
| `kds` | Tela de cozinha (KDS) | **Tempo real** — alerta no topo da fila **com bip**. | Ação imediata na operação (EPI, higiene na hora). |
| `gerente` | Painel do gerente | Card de alerta na tela do gerente. | Correção pelo responsável do turno. |
| `diretoria` | Visão C&O (presidente) | Consolidado estratégico, visão de rede. | Tendência/recorrência, não ação pontual. |
| `registro` | Só grava (histórico/auditoria) | **Sem alertar ninguém**, só fica registrado. | Baixa urgência, evidência, relatório. |

**Padrão se `destino` vier vazio** (espelha o roteamento que o n8n de vocês já faz):

| `urgencia_sugerida` | `destino` aplicado |
|---|---|
| `alta` | `["kds", "gerente", "diretoria"]` |
| `media` | `["gerente"]` |
| `baixa` | `["registro"]` |

Podemos adicionar `mural` (comunicado interno) depois, se fizer sentido.

---

## 4. O que o Regem vai chamar no Monitor

Duas chamadas de saída, ambas com `Authorization: Bearer <API_KEY>` (chave do Monitor, guardada em variável de ambiente no Regem):

### 4.1 Registrar o receiver — `POST /api/v1/assinaturas`
O Regem se inscreve uma vez apontando para o endpoint da seção 2. Precisamos saber de vocês:
- formato exato do corpo de `POST /assinaturas` (URL de destino, filtros disponíveis, secret);
- se dá para filtrar por loja/urgência na assinatura.

### 4.2 Empurrar a janela de pico — `PUT /api/v1/contexto/pico`
O Regem **já tem** as janelas de pico cadastradas por loja (dia da semana + hora início/fim). Vamos empurrar assim:
```
PUT /api/v1/contexto/pico
{ "ativo": true, "janelas": ["11:30-14:00", "18:30-21:30"] }
```
Disparado por um agendador diário no Regem **e/ou** ao editar a janela no painel (reflexo imediato).

**Dúvida para vocês (seção 6):** como o `PUT /contexto/pico` sabe **de qual loja** é a janela? A API-key já é por loja? Ou precisa mandar `loja.id` no corpo?

---

## 5. LGPD / snapshot — divisão combinada

- A **empresa-cliente** que usa o Monitor é a responsável legal: deve ter, **em contrato de trabalho / política interna**, que **monitora os setores internos** e que os funcionários **autorizam**. A responsabilidade por identificação e proteção dos dados é dela.
- O **Monitor** emite avisos **configuráveis e editáveis**, e deixa claro ao cliente que essa responsabilidade é dele.
- **Monitoramento por zona/setor, nunca por identificação de pessoa** — mantido. O Regem **não** vincula o evento a um funcionário específico (só registra quem *resolveu* o alerta, do lado da gestão).
- **Snapshot:** com o consentimento contratual acima, o Regem **pode armazenar** a imagem — mas **nunca em rota pública**, sempre com token, e com **expurgo automático** (o Regem já tem essa rotina para fotos de ponto/tarefa). Sugerimos vocês enviarem o `snapshot_base64`; o Regem guarda como arquivo protegido e apaga no prazo de retenção. Se preferirem **não** enviar imagem (só o texto do evento), o Regem também aceita `snapshot_base64: null`.

---

## 6. O que precisamos de vocês para fechar

- [ ] **Auth:** aceitam o modelo `x-monitor-token` (secret) + `loja.id` no corpo? Ou preferem HMAC / outro?
- [ ] **`destino`:** ok incluir o campo `destino` no payload (roteando por tipo de alerta)? Ou preferem que o Regem derive só da `urgencia_sugerida`?
- [ ] **`POST /assinaturas`:** formato do corpo e filtros disponíveis.
- [ ] **`PUT /contexto/pico`:** como é feito o escopo por loja (API-key por loja? `loja.id` no corpo?). Aceita o shape `{ ativo, janelas: ["HH:MM-HH:MM"] }`?
- [ ] **Alvo do push:** o Monitor posta na **nuvem** do Regem (`api.dmsregem.com`) ou no **servidor local da loja**? (o Regem roda nos dois; muda só o endereço).
- [ ] **`loja.id`:** o identificador que vocês mandam ("loja-01") é fixo por instalação? O Regem faz um de-para `loja.id → unidade` + `canal → setor`.
- [ ] **Volume esperado** de eventos por hora (para dimensionar; hoje 1 POST por evento aguenta bem).

---

## 7. Status

Nada implementado ainda no Regem — este é o contrato. Assim que os itens da seção 6 estiverem fechados, a implementação no Regem sai em fases pequenas: receiver + registro + exibição no KDS → de-para loja/canal + módulo ligável pelo presidente → push da janela de pico → (opcional) live nos dashboards. Do lado de vocês, o principal é confirmar/expor `POST /assinaturas`, `PUT /contexto/pico` e aceitar o campo `destino`.
