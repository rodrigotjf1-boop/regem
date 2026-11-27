# Mister · C4 — as próximas áreas e a revisão das marcas de escrita (proposta de 26/11/2026)

Versão 10, fase C4 (`docs/plano-mister.md`). O mapa do Regem tem 265 funções de escrita: 175 de botão (a pessoa confirma com um toque) e 90 de PIN. A C4a abriu 8 (marcadas "aberta"). As marcas são da DMS: antes de abrir cada onda, o dono confere a coluna "Proposta".

Como ler: **Hoje** é a marca do mapa; **Proposta** só aparece quando proponho trocar — "fora do Mister" (credencial, aparelho, rotina técnica ou dado de pessoa), "só na tela" (o Mister manda o link) ou "PIN" (mexe em dinheiro, fiscal, pessoas ou apaga o que tem histórico). As ações prontas do Mister (aceitar e despachar pedido, pausar canal e produto, mudar preço, movimentar estoque, cadastrar insumo e fornecedor, criar e concluir tarefa, trocar turno, folga, contar estoque, fechar caixa, sangria, pagar e lançar conta, cupom, produto e categoria) já funcionam e não dependem desta lista.

> **27/11/2026 — revisão aplicada e Onda 1 aberta.** O dono mandou "prosseguir para as 4 ondas": as propostas da coluna
> "Proposta" das quatro ondas entraram no mapa (29 fora do Mister, 6 só na tela, 10 para PIN). A Onda 1 abriu 35 tarefas novas
> (43 com as da C4a). Ficaram fora, de propósito: o que já tem ação pronta, as alterações que trocam o formulário inteiro, o que
> pede um colaborador, o "submeter checklist" e os campos de foto (`docs/plano-mister.md` § "C4 Onda 1"). As Ondas 2 a 4 abrem
> depois, uma de cada vez.
>
> **27/11/2026 — Onda 2 aberta.** 14 tarefas novas de delivery e cardápio (57 no total). O aviso e a situação "vindos da loja"
> viraram `interna` (só a credencial do servidor da loja). Ficaram fora, de propósito: as mudanças de situação do pedido (o id
> só vem com dado de cliente), o pedido manual, as rotas que trocam a lista inteira, criar e editar complemento e opção, a
> troca de códigos PDV em massa, a configuração do delivery e a conferência com os apps (`docs/plano-mister.md` § "C4 Onda 2").
>
> **27/11/2026 — Onda 3 aberta.** 6 tarefas novas (63 no total): as ordens de produção (criar, liberar, iniciar, cancelar com
> PIN), limpar a fila da cozinha (PIN, só de uma loja) e o fechamento do ponto do mês. Ficaram fora, de propósito: a escala e o
> ponto de cada pessoa, os candidatos e os QR das vagas, a configuração do KDS, avançar e "visto" no cartão, concluir a ordem
> (PIN de quem produziu), cancelar o pedido em produção, a recorrência e o banco (`docs/plano-mister.md` § "C4 Onda 3").
>
> **27/11/2026 — Onda 4 aberta (as 4 ondas concluídas).** 6 tarefas novas, todas com PIN (69 no total): cancelar e estornar a
> conta, ativar a forma de pagamento, transmitir a contingência fiscal e encerrar os planos de fidelidade e cashback. Ficaram
> fora, de propósito: o caixa do terminal e a venda do PDV, as pessoas e os acessos, as lojas e a empresa, os formulários de
> forma de pagamento, conta e plano, emitir, cancelar e inutilizar nota e as consultas com PIN (`docs/plano-mister.md`
> § "C4 Onda 4").

## Onda 1 — a rotina da loja (botão) — 68 funções, 3 com troca proposta

| Área | Tarefa | Hoje | Proposta |
|---|---|---|---|
| estoque | estoque: resolver alerta (aberta) — `POST /api/v1/estoque/alertas/{id}/resolver` | botão |  |
| estoque | estoque: criar categoria (aberta) — `POST /api/v1/estoque/categorias-item` | botão |  |
| estoque | estoque: remover categoria — `DELETE /api/v1/estoque/categorias-item/{id}` | botão |  |
| estoque | estoque: criar item — `POST /api/v1/estoque/itens` | botão |  |
| estoque | estoque: remover item — `DELETE /api/v1/estoque/itens/{id}` | botão | **PIN**: apaga item com histórico |
| estoque | estoque: alterar item — `PATCH /api/v1/estoque/itens/{id}` | botão |  |
| estoque | estoque: criar movimento — `POST /api/v1/estoque/movimentos` | botão |  |
| estoque | estoque: snapshot — `POST /api/v1/estoque/snapshot` | botão | **fora do Mister**: rotina técnica |
| compras | compras: criar lista — `POST /api/v1/compras/listas` | botão |  |
| compras | compras: remover lista — `DELETE /api/v1/compras/listas/{id}` | botão |  |
| compras | compras: marcar enviado — `POST /api/v1/compras/listas/{id}/enviado` | botão |  |
| compras | compras: gerar lista do que faltou — `POST /api/v1/compras/listas/{id}/faltante` | botão |  |
| compras | compras: informar validade — `POST /api/v1/compras/listas/{id}/itens/{itemId}/validade` | botão |  |
| compras | compras: receber — `POST /api/v1/compras/listas/{id}/receber` | botão |  |
| recebimentos | recebimento: criar — `POST /api/v1/recebimentos` | botão |  |
| recebimentos | recebimento: confirmar — `POST /api/v1/recebimentos/{id}/confirmar` | botão |  |
| fornecedores | fornecedor: criar — `POST /api/v1/fornecedores` | botão |  |
| fornecedores | fornecedor: excluir — `DELETE /api/v1/fornecedores/{id}` | botão | **PIN**: apaga fornecedor com notas |
| fornecedores | fornecedor: alterar — `PATCH /api/v1/fornecedores/{id}` | botão |  |
| fichas | fichas: criar — `POST /api/v1/fichas` | botão |  |
| fichas | fichas: excluir — `DELETE /api/v1/fichas/{id}` | botão |  |
| fichas | fichas: alterar — `PATCH /api/v1/fichas/{id}` | botão |  |
| fichas | fichas: acrescentar ingrediente — `POST /api/v1/fichas/{id}/ingredientes` | botão |  |
| fichas | fichas: definir embalagem — `POST /api/v1/fichas/embalagem` | botão |  |
| fichas | fichas: excluir ingrediente — `DELETE /api/v1/fichas/ingredientes/{id}` | botão |  |
| contagem | contagem: salvar — `POST /api/v1/contagem/execucoes/{id}/salvar` | botão |  |
| contagem | contagem: criar lista — `POST /api/v1/contagem/listas` | botão |  |
| contagem | contagem: remover lista — `DELETE /api/v1/contagem/listas/{id}` | botão |  |
| contagem | contagem: alterar lista — `PATCH /api/v1/contagem/listas/{id}` | botão |  |
| contagem | contagem: iniciar — `POST /api/v1/contagem/listas/{id}/iniciar` | botão |  |
| tarefas-instancias | tarefa instancia: excluir — `DELETE /api/v1/tarefas-instancias/{id}` | botão |  |
| tarefas-instancias | tarefa instancia: editar — `PATCH /api/v1/tarefas-instancias/{id}` | botão |  |
| tarefas-instancias | tarefa instancia: concluir — `PATCH /api/v1/tarefas-instancias/{id}/estado` | botão |  |
| tarefas-instancias | tarefa instancia: instanciar — `POST /api/v1/tarefas-instancias/instanciar` | botão |  |
| tarefas | tarefa def: criar — `POST /api/v1/tarefas` | botão |  |
| checklists | checklist: criar — `POST /api/v1/checklists` | botão |  |
| checklists | checklist: acrescentar item — `POST /api/v1/checklists/{id}/itens` | botão |  |
| checklists | checklist: publicar — `POST /api/v1/checklists/{id}/publicar` | botão |  |
| checklists | checklist: submeter — `POST /api/v1/checklists/{id}/submeter` | botão |  |
| checklists | checklist: excluir item — `DELETE /api/v1/checklists/itens/{itemId}` | botão |  |
| manutencao | pedido manutencao: criar (aberta) — `POST /api/v1/manutencao` | botão |  |
| manutencao | pedido manutencao: decisao — `POST /api/v1/manutencao/{id}/decisao-15d` | botão |  |
| manutencao | pedido manutencao: delegar — `POST /api/v1/manutencao/{id}/delegar` | botão |  |
| manutencao | pedido manutencao: excluir — `POST /api/v1/manutencao/{id}/excluir` | botão |  |
| manutencao | pedido manutencao: status (aberta) — `POST /api/v1/manutencao/{id}/status` | botão |  |
| desperdicios | desperdicio: criar — `POST /api/v1/desperdicios` | botão |  |
| ocorrencias | ocorrencia: criar ocorrencia — `POST /api/v1/ocorrencias` | botão |  |
| ocorrencias | ocorrencia: anular — `PATCH /api/v1/ocorrencias/{id}/anular` | botão |  |
| tipos-ocorrencia | ocorrencia: criar tipo — `POST /api/v1/tipos-ocorrencia` | botão |  |
| vistorias | vistoria: criar — `POST /api/v1/vistorias` | botão |  |
| calendario-da-loja | calendario da loja: criar — `POST /api/v1/calendario-da-loja/eventos` | botão |  |
| calendario-da-loja | calendario da loja: excluir — `DELETE /api/v1/calendario-da-loja/eventos/{id}` | botão |  |
| calendario-da-loja | calendario da loja: editar — `PATCH /api/v1/calendario-da-loja/eventos/{id}` | botão |  |
| dias-especiais | dia especial: criar (aberta) — `POST /api/v1/dias-especiais` | botão |  |
| dias-especiais | dia especial: remover — `DELETE /api/v1/dias-especiais/{id}` | botão |  |
| dias-especiais | dia especial: alterar — `PATCH /api/v1/dias-especiais/{id}` | botão |  |
| janelas-pico | pico: criar (aberta) — `POST /api/v1/janelas-pico` | botão |  |
| janelas-pico | pico: excluir — `DELETE /api/v1/janelas-pico/{id}` | botão |  |
| janelas-pico | pico: alterar — `PATCH /api/v1/janelas-pico/{id}` | botão |  |
| setores | setor: criar (aberta) — `POST /api/v1/setores` | botão |  |
| setores | setor: excluir — `DELETE /api/v1/setores/{id}` | botão |  |
| setores | setor: alterar — `PATCH /api/v1/setores/{id}` | botão |  |
| turnos | turno: criar (aberta) — `POST /api/v1/turnos` | botão |  |
| turnos | turno: excluir — `DELETE /api/v1/turnos/{id}` | botão |  |
| turnos | turno: alterar — `PATCH /api/v1/turnos/{id}` | botão |  |
| funcoes | funcao: criar — `POST /api/v1/funcoes` | botão |  |
| funcoes | funcao: excluir — `DELETE /api/v1/funcoes/{id}` | botão |  |
| funcoes | funcao: alterar — `PATCH /api/v1/funcoes/{id}` | botão |  |

## Onda 2 — delivery e cardápio — 69 funções, 11 com troca proposta

| Área | Tarefa | Hoje | Proposta |
|---|---|---|---|
| delivery | delivery loja: aviso da loja — `POST /api/v1/delivery/aviso-da-loja` | botão |  |
| delivery | delivery: backfill valores — `POST /api/v1/delivery/backfill-valores` | botão | **fora do Mister**: rotina técnica |
| delivery | delivery: definir config — `PUT /api/v1/delivery/config` | botão |  |
| delivery | entregadores ao vivo: mostrar nos kds — `PUT /api/v1/delivery/entregadores-ao-vivo/telas-kds` | botão |  |
| delivery | delivery: ingest — `POST /api/v1/delivery/ingest` | botão | **fora do Mister**: rotina técnica |
| delivery | delivery: salvar integracao — `PUT /api/v1/delivery/integracoes` | botão | **fora do Mister**: credencial de integração (é da distribuição) |
| delivery | delivery: testar pix — `POST /api/v1/delivery/integracoes/{canal}/testar-pix` | botão | **fora do Mister**: credencial de integração (é da distribuição) |
| delivery | delivery: pausar canais — `POST /api/v1/delivery/pausas` | botão |  |
| delivery | delivery: estender canal — `POST /api/v1/delivery/pausas/estender` | botão |  |
| delivery | delivery: reabrir canal — `POST /api/v1/delivery/pausas/reabrir` | botão |  |
| delivery | delivery: criar manual — `POST /api/v1/delivery/pedidos` | botão |  |
| delivery | delivery: aceitar — `POST /api/v1/delivery/pedidos/{id}/aceitar` | botão |  |
| delivery | delivery: alterar — `POST /api/v1/delivery/pedidos/{id}/alterar` | botão |  |
| delivery | delivery: avancar — `POST /api/v1/delivery/pedidos/{id}/avancar` | botão |  |
| delivery | delivery: avisar pronto — `POST /api/v1/delivery/pedidos/{id}/avisar-pronto` | botão |  |
| delivery | delivery: cancelar — `POST /api/v1/delivery/pedidos/{id}/cancelar` | PIN |  |
| delivery | delivery: confirmar codigo — `POST /api/v1/delivery/pedidos/{id}/confirmar-codigo` | botão |  |
| delivery | delivery: cupom entregador — `POST /api/v1/delivery/pedidos/{id}/cupom-entregador` | PIN |  |
| delivery | delivery: despachar — `POST /api/v1/delivery/pedidos/{id}/despachar` | botão |  |
| delivery | delivery: entregar — `POST /api/v1/delivery/pedidos/{id}/entregar` | botão |  |
| delivery | delivery: finalizar — `POST /api/v1/delivery/pedidos/{id}/finalizar` | botão |  |
| delivery | delivery: nf — `POST /api/v1/delivery/pedidos/{id}/nf` | botão | **PIN**: emite nota fiscal |
| delivery | delivery: registrar perda — `POST /api/v1/delivery/pedidos/{id}/perda` | botão |  |
| delivery | delivery: receber pagamento — `POST /api/v1/delivery/pedidos/{id}/receber-pagamento` | PIN |  |
| delivery | delivery: confirmar repetido — `POST /api/v1/delivery/pedidos/{id}/repetido/confirmar` | botão |  |
| delivery | delivery: retornar — `POST /api/v1/delivery/pedidos/{id}/retornar` | botão |  |
| delivery | delivery: avisar sem contato — `POST /api/v1/delivery/pedidos/{id}/sem-contato` | botão |  |
| delivery | delivery: voltar — `POST /api/v1/delivery/pedidos/{id}/voltar` | botão |  |
| delivery | delivery: definir pix prioritario — `PATCH /api/v1/delivery/pix-prioritario` | botão |  |
| delivery | delivery: simular — `POST /api/v1/delivery/simular` | botão | **fora do Mister**: rotina técnica |
| delivery | delivery loja: status da loja — `POST /api/v1/delivery/status-da-loja` | botão |  |
| delivery | delivery: totem conclui pronto — `POST /api/v1/delivery/totem-conclui-pronto` | botão | **fora do Mister**: aparelho (totem) |
| delivery | delivery: totem dinheiro — `POST /api/v1/delivery/totem-dinheiro` | botão | **fora do Mister**: aparelho (totem) |
| delivery | delivery: totem modo — `POST /api/v1/delivery/totem-modo` | botão | **fora do Mister**: aparelho (totem) |
| produtos | produto: criar — `POST /api/v1/produtos` | botão |  |
| produtos | produto: remover — `DELETE /api/v1/produtos/{id}` | botão | **PIN**: apaga produto que vende nos canais |
| produtos | produto: atualizar — `PATCH /api/v1/produtos/{id}` | botão |  |
| produtos | produto: definir produto complementos — `PUT /api/v1/produtos/{id}/complementos-catalogo` | botão |  |
| produtos | produto: criar grupo — `POST /api/v1/produtos/{id}/complementos/grupos` | botão |  |
| produtos | produto: duplicar — `POST /api/v1/produtos/{id}/duplicar` | botão |  |
| produtos | produto: definir faixas — `PUT /api/v1/produtos/{id}/faixas` | botão |  |
| produtos | produto: pausa do canal — `PUT /api/v1/produtos/{id}/pausa-canal` | botão |  |
| produtos | produto: permite negativo — `POST /api/v1/produtos/{id}/permite-negativo` | botão |  |
| produtos | produto: preco do canal — `PUT /api/v1/produtos/{id}/preco-canal` | PIN |  |
| produtos | produto: criar categoria — `POST /api/v1/produtos/categorias` | botão |  |
| produtos | produto: excluir categoria — `DELETE /api/v1/produtos/categorias/{id}` | botão |  |
| produtos | produto: atualizar categoria — `PATCH /api/v1/produtos/categorias/{id}` | botão |  |
| produtos | produto: reordenar categorias — `POST /api/v1/produtos/categorias/reordenar` | botão |  |
| produtos | produto: trocar codigos pdv — `PATCH /api/v1/produtos/codigos-pdv` | botão |  |
| produtos | produto: criar complemento catalogo — `POST /api/v1/produtos/complementos-catalogo` | botão |  |
| produtos | produto: excluir complemento catalogo — `DELETE /api/v1/produtos/complementos-catalogo/{id}` | botão |  |
| produtos | produto: atualizar complemento catalogo — `PATCH /api/v1/produtos/complementos-catalogo/{id}` | botão |  |
| produtos | produto: definir complemento destinos — `PUT /api/v1/produtos/complementos-catalogo/{id}/destinos` | botão |  |
| produtos | produto: preco da opcao no grupo — `PUT /api/v1/produtos/complementos-catalogo/{id}/opcoes/{opcaoId}/preco` | PIN |  |
| produtos | produto: sincronizar complementos — `POST /api/v1/produtos/complementos-catalogo/sincronizar` | botão | **fora do Mister**: rotina técnica |
| produtos | produto: remover grupo — `DELETE /api/v1/produtos/complementos/grupos/{gid}` | botão |  |
| produtos | produto: criar opcao — `POST /api/v1/produtos/complementos/grupos/{gid}/opcoes` | botão |  |
| produtos | produto: remover opcao — `DELETE /api/v1/produtos/complementos/opcoes/{oid}` | botão |  |
| produtos | produto: definir direcionamento — `PUT /api/v1/produtos/direcionamento` | botão |  |
| produtos | produto: criar opcao catalogo — `POST /api/v1/produtos/opcoes` | botão |  |
| produtos | produto: excluir opcao — `DELETE /api/v1/produtos/opcoes/{id}` | botão |  |
| produtos | produto: atualizar opcao — `PATCH /api/v1/produtos/opcoes/{id}` | botão |  |
| produtos | produto: definir opcao destinos — `PUT /api/v1/produtos/opcoes/{id}/destinos` | botão |  |
| produtos | produto: pausa da opcao no canal — `PUT /api/v1/produtos/opcoes/{id}/pausa-canal` | botão |  |
| produtos | produto: preco da opcao no canal — `PUT /api/v1/produtos/opcoes/{id}/preco-canal` | PIN |  |
| produtos | produto: excluir opcoes massa — `POST /api/v1/produtos/opcoes/massa/excluir` | botão |  |
| produtos | produto: preco custo opcoes massa — `PATCH /api/v1/produtos/opcoes/massa/preco` | PIN |  |
| catalogo | conferencia: mandar preco ao app — `POST /api/v1/catalogo/conferencia/mandar-preco-ao-app` | PIN |  |
| catalogo | conferencia: usar preco do app — `POST /api/v1/catalogo/conferencia/usar-preco-do-app` | PIN |  |

## Onda 3 — pessoas, escala e cozinha — 46 funções, 11 com troca proposta

| Área | Tarefa | Hoje | Proposta |
|---|---|---|---|
| escala | escala: criar — `POST /api/v1/escala` | botão |  |
| escala | escala: remover — `DELETE /api/v1/escala/{id}` | botão |  |
| escala | escala: alterar — `PATCH /api/v1/escala/{id}` | botão |  |
| escala | escala: editar horario — `PATCH /api/v1/escala/{id}/horario` | botão |  |
| escala | escala: presenca — `PATCH /api/v1/escala/{id}/presenca` | botão |  |
| escala | escala: gerar — `POST /api/v1/escala/gerar` | botão | **PIN**: refaz a escala da semana |
| ponto | ponto: criar ajuste — `POST /api/v1/ponto/ajuste` | botão | **PIN**: mexe no ponto de outra pessoa (Portaria 671) |
| ponto | ponto: enviar espelho — `POST /api/v1/ponto/fechamentos/{competencia}/enviar` | botão | **só na tela**: envia arquivo |
| ponto | ponto: gerar fechamento — `POST /api/v1/ponto/fechamentos/gerar` | botão |  |
| ponto | ponto: incluir marcacao — `POST /api/v1/ponto/marcacao-manual` | botão | **PIN**: mexe no ponto de outra pessoa (Portaria 671) |
| ponto | ponto: marcar — `POST /api/v1/ponto/marcar` | botão | **só na tela**: a marcação do próprio ponto é no terminal (Portaria 671) |
| vagas | vagas: marcar avisado — `POST /api/v1/vagas/banco/aviso` | botão |  |
| vagas | vagas: avisar pelo marketing — `POST /api/v1/vagas/banco/aviso/fila` | botão | **só na tela**: mensagem a muitos |
| vagas | vagas: pedir modelo da vaga — `POST /api/v1/vagas/banco/aviso/modelo` | botão |  |
| vagas | vagas: apagar — `DELETE /api/v1/vagas/candidatos/{id}` | botão | **PIN**: apaga dado de pessoa |
| vagas | vagas: anotacao — `POST /api/v1/vagas/candidatos/{id}/anotacao` | botão |  |
| vagas | vagas: contratar — `POST /api/v1/vagas/candidatos/{id}/contratar` | botão | **PIN**: cria colaborador |
| vagas | vagas: distancia — `POST /api/v1/vagas/candidatos/{id}/distancia` | botão |  |
| vagas | vagas: entrevista — `POST /api/v1/vagas/candidatos/{id}/entrevista` | botão |  |
| vagas | vagas: situacao — `PATCH /api/v1/vagas/candidatos/{id}/situacao` | botão |  |
| vagas | vagas: salvar pagina — `PUT /api/v1/vagas/pagina` | botão |  |
| vagas | vagas: criar qr — `POST /api/v1/vagas/qr` | botão |  |
| vagas | vagas: apagar qr — `DELETE /api/v1/vagas/qr/{id}` | botão |  |
| producao | producao: produzir — `POST /api/v1/producao` | botão |  |
| producao | producao aparelho: avancar — `POST /api/v1/producao/aparelho/pedidos/{id}/avancar` | botão | **fora do Mister**: aparelho (KDS) |
| producao | producao aparelho: visto — `POST /api/v1/producao/aparelho/pedidos/{id}/visto` | botão | **fora do Mister**: aparelho (KDS) |
| producao | producao pedido: definir cores — `PUT /api/v1/producao/cores` | botão |  |
| producao | producao pedido: limpar — `POST /api/v1/producao/fila/limpar` | botão | **PIN**: limpa a fila da cozinha |
| producao | producao pedido: definir avisos kds — `PUT /api/v1/producao/kds/{id}/avisos` | botão |  |
| producao | producao pedido: acao despacho — `POST /api/v1/producao/kds/{id}/despacho` | botão |  |
| producao | producao pedido: definir fluxo kds — `PUT /api/v1/producao/kds/{id}/fluxo` | botão |  |
| producao | producao pedido: definir produtos kds — `PUT /api/v1/producao/kds/{id}/produtos` | botão |  |
| producao | producao pedido: salvar rota kds — `PUT /api/v1/producao/kds/rota` | botão |  |
| producao | producao pedido: avancar — `POST /api/v1/producao/pedidos/{id}/avancar` | botão |  |
| producao | producao pedido: cancelar — `POST /api/v1/producao/pedidos/{id}/cancelar` | PIN |  |
| producao | producao pedido: visto — `POST /api/v1/producao/pedidos/{id}/visto` | botão |  |
| producao | producao pedido: definir destinos produto — `PUT /api/v1/producao/produtos/{id}/destinos` | botão |  |
| producao | producao pedido: definir senha periodo — `PUT /api/v1/producao/senha/config` | botão |  |
| producao | producao pedido: definir destinos setor — `PUT /api/v1/producao/setores/{id}/destinos` | botão |  |
| ordens-producao | ordem producao: criar — `POST /api/v1/ordens-producao` | botão |  |
| ordens-producao | ordem producao: cancelar — `POST /api/v1/ordens-producao/{id}/cancelar` | PIN |  |
| ordens-producao | ordem producao: concluir — `POST /api/v1/ordens-producao/{id}/concluir` | botão |  |
| ordens-producao | ordem producao: iniciar — `POST /api/v1/ordens-producao/{id}/iniciar` | botão |  |
| ordens-producao | ordem producao: liberar — `POST /api/v1/ordens-producao/{id}/liberar` | botão |  |
| ordens-producao | ordem producao: criar recorrencia — `POST /api/v1/ordens-producao/recorrencia` | botão |  |
| banco-repasses | banco repasses: classificar — `PATCH /api/v1/banco-repasses/lancamentos/{id}` | botão |  |

## Onda 4 — dinheiro, acesso e fiscal (PIN) — 82 funções, 20 com troca proposta

| Área | Tarefa | Hoje | Proposta |
|---|---|---|---|
| financeiro | financeiro: reconciliar caixa — `POST /api/v1/financeiro/caixa/{id}/reconciliar` | PIN |  |
| financeiro | financeiro: abrir caixa — `POST /api/v1/financeiro/caixa/abrir` | PIN |  |
| financeiro | financeiro: definir caixa livre — `POST /api/v1/financeiro/caixa/config/livre` | PIN |  |
| financeiro | financeiro: fechar caixa — `POST /api/v1/financeiro/caixa/fechar` | PIN |  |
| financeiro | financeiro: movimentar caixa — `POST /api/v1/financeiro/caixa/movimentar` | PIN |  |
| financeiro | financeiro: baixar pendencias antigas — `POST /api/v1/financeiro/caixa/pendencias/baixar-antigas` | PIN |  |
| financeiro | financeiro: criar forma pagamento — `POST /api/v1/financeiro/formas-pagamento` | PIN |  |
| financeiro | financeiro: remover forma pagamento — `DELETE /api/v1/financeiro/formas-pagamento/{id}` | PIN |  |
| financeiro | financeiro: atualizar forma pagamento — `PATCH /api/v1/financeiro/formas-pagamento/{id}` | PIN |  |
| financeiro | financeiro: ativar forma pagamento — `POST /api/v1/financeiro/formas-pagamento/{id}/ativa` | PIN |  |
| financeiro | financeiro: criar — `POST /api/v1/financeiro/titulos` | PIN |  |
| financeiro | financeiro: cancelar — `DELETE /api/v1/financeiro/titulos/{id}` | PIN |  |
| financeiro | financeiro: atualizar — `PATCH /api/v1/financeiro/titulos/{id}` | PIN |  |
| financeiro | financeiro: estornar — `POST /api/v1/financeiro/titulos/{id}/estornar` | PIN |  |
| financeiro | financeiro: pagar — `POST /api/v1/financeiro/titulos/{id}/pagar` | PIN |  |
| vendas | totem vendas: vender — `POST /api/v1/vendas` | PIN | **fora do Mister**: venda do totem |
| vendas | totem vendas: cancelar — `POST /api/v1/vendas/{id}/cancelar` | PIN | **fora do Mister**: venda do totem |
| vendas | totem vendas: falha impressao — `POST /api/v1/vendas/{id}/falha-impressao` | PIN | **fora do Mister**: aparelho (totem) |
| vendas | totem vendas: liberar — `POST /api/v1/vendas/{id}/liberar` | PIN | **fora do Mister**: aparelho (totem) |
| vendas | vendas: baixar acerto — `POST /api/v1/vendas/acertos/{id}/baixar` | PIN |  |
| vendas | vendas: preview atacado — `POST /api/v1/vendas/atacado/preview` | PIN |  |
| vendas | vendas: balcao — `POST /api/v1/vendas/balcao` | PIN |  |
| vendas | vendas: abrir — `POST /api/v1/vendas/comandas` | PIN |  |
| vendas | vendas: cancelar — `POST /api/v1/vendas/comandas/{id}/cancelar` | PIN |  |
| vendas | vendas: fechar — `POST /api/v1/vendas/comandas/{id}/fechar` | PIN |  |
| vendas | vendas: adicionar item — `POST /api/v1/vendas/comandas/{id}/itens` | PIN |  |
| vendas | vendas: remover item — `DELETE /api/v1/vendas/comandas/itens/{itemId}` | PIN |  |
| vendas | vendas: definir cancelamento livre — `POST /api/v1/vendas/config/cancelamento-livre` | PIN |  |
| vendas | vendas externa: vender totem — `POST /api/v1/vendas/externa-pdv` | PIN | **fora do Mister**: aparelho (totem) |
| vendas | vendas externa: falha totem — `POST /api/v1/vendas/externa-pdv/falha` | PIN | **fora do Mister**: aparelho (totem) |
| vendas | totem vendas: falha — `POST /api/v1/vendas/falha` | PIN | **fora do Mister**: aparelho (totem) |
| vendas | vendas: abrir mesa — `POST /api/v1/vendas/mesas` | PIN |  |
| vendas | vendas: excluir mesa — `DELETE /api/v1/vendas/mesas/{id}` | PIN |  |
| vendas | vendas: abrir comanda na mesa — `POST /api/v1/vendas/mesas/{id}/comandas` | PIN |  |
| vendas | vendas: fechar mesa — `POST /api/v1/vendas/mesas/{id}/fechar` | PIN |  |
| vendas | totem vendas: abrir retido — `POST /api/v1/vendas/retido` | PIN | **fora do Mister**: aparelho (totem) |
| fidelidade | fidelidade: salvar — `POST /api/v1/fidelidade/planos` | PIN |  |
| fidelidade | fidelidade: remover — `DELETE /api/v1/fidelidade/planos/{id}` | PIN |  |
| fidelidade | fidelidade: finalizar — `POST /api/v1/fidelidade/planos/{id}/finalizar` | PIN |  |
| fidelidade | fidelidade: ajustar — `PUT /api/v1/fidelidade/planos/{id}/pontos` | PIN |  |
| cashback | cashback: salvar — `POST /api/v1/cashback/planos` | PIN |  |
| cashback | cashback: remover — `DELETE /api/v1/cashback/planos/{id}` | PIN |  |
| cashback | cashback: finalizar — `POST /api/v1/cashback/planos/{id}/finalizar` | PIN |  |
| clube | clube da loja: mandar — `POST /api/v1/clube/da-loja/desculpas/{id}` | PIN |  |
| clube | clube link: revelar — `POST /api/v1/clube/premio/{codigo}/revelar` | PIN | **fora do Mister**: link público do cliente |
| atendimento | atendimento: decidir cancelamento — `POST /api/v1/atendimento/{id}/cancelamento` | PIN |  |
| colaboradores | colaborador: criar — `POST /api/v1/colaboradores` | PIN |  |
| colaboradores | colaborador: excluir — `DELETE /api/v1/colaboradores/{id}` | PIN |  |
| colaboradores | colaborador: alterar — `PATCH /api/v1/colaboradores/{id}` | PIN |  |
| colaboradores | colaborador: atualizar acesso — `PATCH /api/v1/colaboradores/{id}/acesso` | PIN |  |
| colaboradores | desligamento: desligar — `POST /api/v1/colaboradores/{id}/desligar` | PIN |  |
| colaboradores | colaborador: definir senha — `POST /api/v1/colaboradores/{id}/senha` | PIN |  |
| contadores | desligamento: salvar — `PUT /api/v1/contadores` | PIN |  |
| contadores | desligamento: remover — `DELETE /api/v1/contadores/{id}` | PIN |  |
| perfis | perfil: criar — `POST /api/v1/perfis` | PIN |  |
| perfis | perfil: remover — `DELETE /api/v1/perfis/{id}` | PIN |  |
| perfis | perfil: atualizar — `PATCH /api/v1/perfis/{id}` | PIN |  |
| unidades | unidade: criar — `POST /api/v1/unidades` | PIN |  |
| unidades | unidade: excluir — `DELETE /api/v1/unidades/{id}` | PIN |  |
| unidades | unidade: alterar — `PATCH /api/v1/unidades/{id}` | PIN |  |
| empresas | empresa: informar cnpj — `PATCH /api/v1/empresas/cnpj` | PIN |  |
| empresas | empresa: atualizar config — `PATCH /api/v1/empresas/config` | PIN |  |
| fiscal | fiscal: emitir — `POST /api/v1/fiscal/comandas/{id}/emitir` | PIN |  |
| fiscal | fiscal: definir config — `PUT /api/v1/fiscal/config` | PIN | **só na tela**: configuração fiscal |
| fiscal | fiscal: transmitir contingencia — `POST /api/v1/fiscal/contingencia/transmitir` | PIN |  |
| fiscal | fiscal: definir certificado — `PUT /api/v1/fiscal/credencial/certificado` | PIN | **fora do Mister**: certificado e CSC (credencial) |
| fiscal | fiscal: definir csc — `PUT /api/v1/fiscal/credencial/csc` | PIN | **fora do Mister**: certificado e CSC (credencial) |
| fiscal | fiscal: testar certificado — `POST /api/v1/fiscal/credencial/testar` | PIN | **fora do Mister**: certificado e CSC (credencial) |
| fiscal | fiscal: inutilizar — `POST /api/v1/fiscal/inutilizar` | PIN |  |
| fiscal | fiscal: cancelar — `POST /api/v1/fiscal/notas/{id}/cancelar` | PIN |  |
| fiscal | fiscal: cancelar por substituicao — `POST /api/v1/fiscal/notas/{id}/cancelar-substituicao` | PIN |  |
| fiscal | fiscal: consultar nota — `POST /api/v1/fiscal/notas/{id}/consultar` | PIN |  |
| fiscal | fiscal: status sefaz — `POST /api/v1/fiscal/sefaz/status` | PIN |  |
| fiscal | fiscal: emitir teste homologacao — `POST /api/v1/fiscal/sefaz/teste-homologacao` | PIN |  |
| fiscal | fiscal: definir terminal — `PUT /api/v1/fiscal/terminais/{id}` | PIN | **só na tela**: configuração fiscal |
| fiscal | tributos aprox: remover token — `DELETE /api/v1/fiscal/tributos-aprox/token` | PIN | **fora do Mister**: token do IBPT (credencial) |
| fiscal | tributos aprox: salvar token — `PUT /api/v1/fiscal/tributos-aprox/token` | PIN | **fora do Mister**: token do IBPT (credencial) |
| modulos | modulo: setar — `POST /api/v1/modulos` | PIN | **só na tela**: liga e desliga módulo da empresa |
| clientes | cliente admin: crm corrigir aniversario — `POST /api/v1/clientes/crm/{id}/aniversario` | botão |  |
| clientes | cliente admin: exportar — `POST /api/v1/clientes/export` | botão | **fora do Mister**: dado de cliente |
| clientes | cliente admin: otp teste — `POST /api/v1/clientes/otp-teste` | botão | **fora do Mister**: dado de cliente |
| colaborador | prefs: patch — `PATCH /api/v1/colaborador/me/prefs` | PIN | **fora do Mister**: preferência pessoal da tela |

