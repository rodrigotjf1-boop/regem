# Épico — Roteirização e rastreio com ROTA REAL (OSRM self-hosted)

> **Status: PLANEJADO** (aprovação + Fase 0 antes de codar). Decisão do gestor (01/09): Opção B, **OSRM self-hosted** — dado em casa, sem custo por chamada, multi-tenant Brasil-wide. Prioridade = projeto completo e personalizável, não menor esforço.

## Regras de negócio (do gestor)
1. **Rastreio só vai ao cliente quando o entregador está indo até ELE** (por parada, não no lote todo).
2. **Roteirização prioriza o pedido perto do fim do prazo** — mesmo o mais LONGE de uma lista — **salvo se o cálculo mostrar que ele ainda chega a tempo** pela rota rápida.

## Estado atual (verificado, sem achismo)
- **Nenhum serviço de rota hoje.** ETA (`etaAcumulado`, entregador.service:876-897) e ordenação (`roteirizar`, :743-769) usam **distância reta (haversine) ÷ 25 km/h** (`distanciaM` :959).
- Rastreio do cliente = `/r/[token]` (Leaflet + tiles OSM externos); hoje mostra 2 marcadores (🛵 + 📍) e enquadra — **sem linha de rota**.
- Multi-parada JÁ EXISTE: `proximaSaida` (:791-820) pega até `maxPedidosEntregador` prontos, roteiriza (vizinho-mais-próximo) e manda o link **só da parada 1**; as próximas a cada entrega+código (`avancarSaida`→`enviarLinkRastreio`). O **scan** (:114) despacha **1** e manda o link **na hora** (ignora o lote).
- **Prazo:** `cardapio_config.tempo_entrega_min` (schema:2458) — por loja, **sincroniza pro edge**. Deadline do pedido = `aceito_em`/`created_at` + `tempo_entrega_min`.
- O app do entregador **NÃO precisa mudar** — já posta GPS (`POST /entregador/localizacao`); a rota usa posição + destino que o sistema já tem.

## Fase 0 — Infra OSRM self-hosted (FUNDACIONAL)
- Serviço `osrm` (Docker, imagem `ghcr.io/project-osrm/osrm-backend`) no EasyPanel/VPS, perfil **car**, algoritmo **MLD** (mais leve em RAM que CH).
- Pipeline de preparo (one-time + refresh mensal): baixar `brazil-latest.osm.pbf` (Geofabrik, ~1.6 GB) → `osrm-extract -p /opt/car.lua` → `osrm-partition` → `osrm-customize` → `osrm-routed --algorithm mld`.
- **Recursos:** Brasil no MLD exige RAM/disco consideráveis (processados vários GB; runtime ~2-4 GB+). Se a VPS estiver apertada: (a) extract só dos ESTADOS atendidos, (b) serviço/VPS dedicado ao OSRM, (c) container com volume próprio. **← decisão de infra (specs da VPS).**
- Endpoints internos: `http://osrm:5000/route/v1/driving/{lng},{lat};...` e `/table/v1/driving/...`.
- **Distribuição gerencia** (infra é da distribuição, nunca do usuário). Env `OSRM_URL` no `regem-api`.

## Fase 1 — Rota real no rastreio do cliente (a feature visível)
- Backend `rastreioPublico`: chama OSRM `/route` (pos do entregador → destino) → geometria (polyline6) + duração/distância reais. **Cache por pedido** — recalcula a cada ~20-30 s OU quando o entregador moveu > X m (nunca em todo poll/viewer).
- Payload `/rastreio/:token` passa a incluir `rota` (geometria) + ETA real.
- Frontend `/r/[token]`: decodifica e desenha a **polyline dourada** da rota + usa o ETA real + enquadra na rota.

## Fase 2 — ETA real (substitui a reta)
- `etaAcumulado` soma as pernas via OSRM `/table` (matriz de durações) no lugar de reta÷25. Vale pro rastreio e pro painel/mapa do gestor.

## Fase 3 — Roteirização por PRAZO (a regra do gestor)
- Deadline por pedido = `aceito_em` + `cardapio_config.tempo_entrega_min`.
- `roteirizar` deixa de ser vizinho-mais-próximo puro:
  1. OSRM `/table` → matriz de tempos entre a posição do entregador e as N paradas.
  2. Monta a rota rápida (ex.: vizinho-próximo/2-opt sobre TEMPO real) e **projeta a chegada em cada parada**.
  3. **Se todas chegam no prazo → mantém a rota rápida.**
  4. **Se alguma estoura → re-sequencia priorizando a(s) em risco** (a mais perto do prazo primeiro), reavaliando a viabilidade das demais (EDD com checagem de folga).
- É exatamente: prioriza o que vai atrasar, salvo se ainda chega a tempo.

## Fase 4 — Reconciliar scan × lote × "só quando indo até o cliente"
- Com **lote>1**: o scan JUNTA os pedidos **sem** mandar link; o botão **"Rota"** (app) dispara `proximaSaida` (já existe) que roteiriza (agora por prazo) e manda o link **só da parada 1**; ao entregar+código, manda a próxima. Já casa com a regra 1.
- Ajustar o `scan` pra **não** mandar link imediato quando há lote (hoje despacha 1 + link na hora).

## Personalização (multi-tenant)
- Brazil-wide cobre todas as lojas; `tempo_entrega_min` por loja personaliza o prazo; "raio de aviso de chegada" já é config por loja. Perfil `car` hoje (moto no futuro).

## Questões a confirmar (decisões do gestor)
1. **Infra OSRM:** specs da VPS (RAM/disco)? Brasil inteiro ou só os estados atendidos? Mesmo EasyPanel ou serviço/VPS dedicado?
2. **Deadline:** ok `aceito_em + tempo_entrega_min` (por loja)? Ou quer promessa por-pedido?
3. **Cadência de recálculo da rota** (custo CPU): a cada X s / Y m?

## Ordem de implementação
0. Infra OSRM (destrava tudo) → 1. Rota no rastreio (você testa) → 2. ETA real → 3. Roteirização por prazo → 4. Reconciliar scan/lote.

## Relacionados
[[app-entregador-epico]], [[entregador-multiparada-rastreio-roadmap]], [[delivery-entregador-fixes-arquitetura]], `modelo-distribuicao-acesso` (infra/segredos = distribuição).
