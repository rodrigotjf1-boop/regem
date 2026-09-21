import { sql, type SQL } from 'drizzle-orm';

// Config direcional do sync (ver docs/arquitetura-edge.md §2).
// Cada tabela tem um dono e uma direção. O cursor é o campo de delta.
export type Direcao = 'sobe' | 'desce' | 'ambos';
export type TabelaSync = {
  tabela: string;
  direcao: Direcao;
  cursor: 'created_at' | 'updated_at' | 'criado_em' | 'atualizado_em';
  escopo?: 'tenant_id' | 'id'; // coluna que amarra ao tenant (empresa usa 'id')
  // Filtro SQL FIXO (constante do código, nunca entrada do usuário) que restringe as
  // linhas sincronizadas. Ex.: equipamento só sincroniza impressora/pdv/salao — nunca
  // 'servidor_local' (o device de auth/licença; sincronizá-lo deixaria o edge
  // sobrescrever uma revogação da nuvem por LWW).
  filtroSql?: string;
};

// v1: apenas tabelas com `tenant_id` direto + cursor confiável.
// (append-only / hard-deletes / produto_variacao etc. entram no endurecimento v2.)
export const TABELAS_SYNC: TabelaSync[] = [
  // Controle (nuvem → local) — empresa 1º (pais antes dos filhos p/ FK); escopo por id.
  { tabela: 'empresa', direcao: 'desce', cursor: 'updated_at', escopo: 'id' },
  { tabela: 'unidade', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'setor', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'funcao', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'perfil_acesso', direcao: 'desce', cursor: 'updated_at' }, // pai do colaborador (RBAC)
  { tabela: 'colaborador', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'turno', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'etiqueta', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'kds_alerta_config', direcao: 'desce', cursor: 'updated_at' }, // motor de alertas KDS (nuvem → edge)
  // CONFIGS ESPELHADAS (mig 181, P1): impressoras/terminais e cupom/perfis sincronizam
  // cloud↔edge — config feita na nuvem desce pro edge ativo, e a feita no local sobe
  // (backup) e volta num banco novo/reinstalado. equipamento é FILTRADO: só impressora/
  // pdv/salao (NUNCA servidor_local — anti auto-reativação por LWW).
  {
    tabela: 'equipamento',
    direcao: 'ambos',
    cursor: 'updated_at',
    // `ponto_baixa` (mig 251): o desperdício aponta para o ponto que o registrou; sem
    // subir, a nuvem teria desperdício apontando para um equipamento que não conhece.
    // `kds` entrou com a paridade (mig 272/273): as tabelas de DESTINO DE PRODUÇÃO
    // (produto/setor/complemento/opção → equipamento) apontam para o KDS. Sem o tipo aqui,
    // toda linha de destino que aponta para um KDS morreria por chave estrangeira do outro
    // lado — o mesmo sintoma do cliente em instalação nova.
    filtroSql: "tipo in ('impressora','pdv','salao','ponto_baixa','kds')",
  },
  { tabela: 'delivery_config', direcao: 'ambos', cursor: 'updated_at' },
  // Template da etiqueta de validade (mig 245): config espelhada como as de cima —
  // desenhada na gestão, usada pela impressora da loja, e volta num banco novo.
  { tabela: 'etiqueta_template', direcao: 'ambos', cursor: 'updated_at' },
  // Categoria: BIDIRECIONAL (P3 completo) — editada no edge, espelha na nuvem.
  { tabela: 'categoria_produto', direcao: 'ambos', cursor: 'updated_at' },
  // Produto é BIDIRECIONAL: no modo híbrido (local prioritário) o catálogo é editado
  // no edge; disponibilidade/esgotado/preço SOBEM para o cardápio ONLINE (nuvem) por
  // LWW (updated_at, bumpado em atualizar/sincronizarEsgotados). Flash-sync acelera.
  { tabela: 'produto', direcao: 'ambos', cursor: 'updated_at' },
  // Pausa por falta de estoque POR LOJA (mig 260). 'ambos': o servidor local calcula a pausa
  // da própria loja; a nuvem, a das lojas sem servidor local. id = md5 do par. Depois de
  // `produto` e `unidade` (FK).
  { tabela: 'produto_pausa_estoque', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'ficha_tecnica', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'bot_regra', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'feriado', direcao: 'desce', cursor: 'created_at' },
  { tabela: 'tipo_ocorrencia', direcao: 'desce', cursor: 'updated_at' },
  // ── PARIDADE (mig 272/273) — o que a loja PRODUZ e antes só existia nela ─────────────
  // Estas tabelas nunca sincronizaram: a nuvem não via a operação da loja, e a
  // reinstalação apagava tudo. Ordem = pai antes do filho (chave estrangeira).
  // Vínculos de cadastro: master na nuvem, regravados por apagar-e-inserir — por isso
  // dependem do gatilho de exclusão da mig 272 para o vínculo removido não ressuscitar.
  { tabela: 'funcao_setor', direcao: 'desce', cursor: 'created_at' },
  { tabela: 'colaborador_funcao', direcao: 'desce', cursor: 'created_at' },
  // Módulos ligados/desligados pelo presidente: o edge LÊ para cortar acesso offline e
  // nunca escreve — se subisse, reativaria por última-escrita o que a nuvem desligou.
  { tabela: 'modulo_ativacao', direcao: 'desce', cursor: 'updated_at' },
  // Configuração e cadastro da própria loja, editáveis dos dois lados.
  { tabela: 'entitlement', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'janela_pico', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'contador', direcao: 'ambos', cursor: 'updated_at' }, // o contabilista da empresa
  { tabela: 'categoria_item', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'forma_pagamento', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'kds_cor_config', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'tef_config', direcao: 'ambos', cursor: 'updated_at' },
  // `mesa` vem ANTES de `comanda` (a comanda aponta para a mesa).
  { tabela: 'mesa', direcao: 'ambos', cursor: 'updated_at' },
  // Documentos e rotina da operação (nascem dos dois lados e mudam de estado).
  { tabela: 'documento_controlado', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'ciencia', direcao: 'ambos', cursor: 'created_at' }, // prova de treinamento (só anexa)
  { tabela: 'checklist', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'checklist_item', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'pop', direcao: 'ambos', cursor: 'updated_at' }, // publicação do checklist
  { tabela: 'tarefa_def', direcao: 'ambos', cursor: 'updated_at' }, // depois de checklist/pop (FK)
  // Tarefa do dia e escala (mig 277): ficaram por último porque são MATERIALIZADAS por
  // rotina, e a rotina roda nos dois lados. Agora o id nasce da chave de negócio
  // (definição + loja + dia; loja + dia + turno + pessoa), então os dois lados chegam à
  // MESMA linha e o sincronismo concilia em vez de duplicar.
  { tabela: 'tarefa_instancia', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'escala_alocacao', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'guia', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'guia_passo', direcao: 'ambos', cursor: 'created_at' },
  { tabela: 'comunicado', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'comunicado_leitura', direcao: 'ambos', cursor: 'created_at' },
  { tabela: 'clima_pesquisa', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'clima_resposta', direcao: 'ambos', cursor: 'created_at' }, // anônima por desenho
  { tabela: 'clima_participacao', direcao: 'ambos', cursor: 'created_at' }, // trava de voto duplo
  { tabela: 'escala_regra', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'dia_especial', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'vistoria', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'ocorrencia', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'pedido_manutencao', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'atendimento_chamado', direcao: 'ambos', cursor: 'atualizado_em' },
  { tabela: 'alerta_estoque', direcao: 'ambos', cursor: 'atualizado_em' },
  // Cupom: criado na nuvem (campanha/marketing) e precisa ser honrado no PDV local —
  // sem ele o caixa offline não consegue nem validar. O USO sobe (o estorno acontece no
  // edge e hoje não voltava, deixando o limite consumido para sempre).
  { tabela: 'cupom', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'cupom_uso', direcao: 'ambos', cursor: 'created_at' },
  { tabela: 'encomenda_regra_sinal', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'encomenda_recorrencia', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'banner', direcao: 'desce', cursor: 'created_at' },
  // ── DINHEIRO DO CLIENTE (mig 274) — cashback e fidelidade ────────────────────────────
  // O crédito acontece nos DOIS lados (o painel de delivery roda no servidor local) e o
  // gasto só na nuvem. Sem sincronismo: cashback creditado na loja que o cliente nunca
  // consegue gastar, estorno que não chega, prêmio usado duas vezes e plano criado na loja
  // que não existe para o cliente.
  // ⚠️ O SALDO (`cashback_saldo`, `fidelidade_cliente`) NÃO entra aqui de propósito: é um
  // número, e número sincronizado por última-escrita-vence faz um crédito apagar o outro.
  // Ele é recalculado do extrato por gatilho (mig 274) nos dois lados.
  { tabela: 'cashback_plano', direcao: 'ambos', cursor: 'atualizado_em' },
  { tabela: 'cashback_produto_valor', direcao: 'ambos', cursor: 'criado_em' }, // depois do plano e do produto
  { tabela: 'cashback_movimento', direcao: 'ambos', cursor: 'criado_em' }, // o EXTRATO: só anexa
  { tabela: 'cashback_vale', direcao: 'ambos', cursor: 'atualizado_em' }, // muda de estado (usado)
  { tabela: 'fidelidade_plano', direcao: 'ambos', cursor: 'atualizado_em' },
  { tabela: 'fidelidade_ponto', direcao: 'ambos', cursor: 'atualizado_em' }, // `estornado` muda
  { tabela: 'fidelidade_resgate', direcao: 'ambos', cursor: 'atualizado_em' }, // o prêmio
  { tabela: 'fidelidade_ajuste', direcao: 'ambos', cursor: 'criado_em' }, // ajuste manual (só anexa)
  { tabela: 'cardapio_config', direcao: 'ambos', cursor: 'updated_at' }, // bidirecional: config/horários editados no edge sobem p/ o cardápio online
  // ── Catálogo reutilizável (P3 completo) — BIDIRECIONAL. Editado no edge (modo
  // híbrido) e espelhado na nuvem p/ o cardápio online + editor. LWW por updated_at,
  // exclusão por deleted_at (mig 118). Ordem: opção/complemento antes das ligações (FK).
  { tabela: 'opcao', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'complemento', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'complemento_item', direcao: 'ambos', cursor: 'updated_at' }, // liga complemento↔opção
  { tabela: 'produto_complemento', direcao: 'ambos', cursor: 'updated_at' }, // liga produto↔complemento
  // Complementos/opções do PRODUTO (materializados p/ o motor: PDV/garçom/cardápio).
  // BIDIRECIONAL (P3): a materialização local do edge SOBE p/ a nuvem servir o cardápio
  // online. Regeração/exclusão propaga por deleted_at; updated_at (mig 118) guia o push.
  { tabela: 'complemento_grupo', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'complemento_opcao', direcao: 'ambos', cursor: 'updated_at' },
  // Filhas do catálogo que faltavam (mig 272/273). Sugestão e faixa de atacado são do
  // produto; os DESTINOS dizem em qual impressora/KDS cada coisa sai — sem eles, a loja
  // reinstalada perde o roteamento inteiro da cozinha. Depois de produto/complemento/
  // opção/equipamento (chave estrangeira).
  { tabela: 'produto_sugestao', direcao: 'ambos', cursor: 'created_at' },
  { tabela: 'produto_faixa_preco', direcao: 'ambos', cursor: 'created_at' }, // preço do atacado
  { tabela: 'produto_destino_producao', direcao: 'ambos', cursor: 'created_at' },
  { tabela: 'setor_destino_producao', direcao: 'ambos', cursor: 'created_at' },
  { tabela: 'complemento_destino_producao', direcao: 'ambos', cursor: 'created_at' },
  { tabela: 'opcao_destino_producao', direcao: 'ambos', cursor: 'created_at' },
  // Bidirecional (LWW) — INTENCIONAL: são cadastros, mas editáveis TANTO na nuvem
  // quanto no edge (compra/recebimento no local cria item/fornecedor). Diferente de
  // empresa/colaborador (só descem), aqui a última escrita vence por updated_at, então
  // uma edição na nuvem pode sobrescrever a local (e vice-versa) — aceitável porque o
  // dado é o mesmo cadastro e o conflito real é raro.
  { tabela: 'item_estoque', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'fornecedor', direcao: 'ambos', cursor: 'updated_at' },
  // Custo médio, mínimo e dias de segurança POR LOJA (mig 257). 'ambos': o recebimento e a
  // produção no edge ponderam o custo; o mínimo pode ser editado na nuvem. O id vem do par
  // (insumo, loja), então as duas pontas geram a MESMA linha e o LWW resolve. Depois de
  // `item_estoque` e `unidade` (FK).
  { tabela: 'item_estoque_unidade', direcao: 'ambos', cursor: 'updated_at' },
  // Filhas do insumo (mig 272/273): de quais fornecedores ele vem e como converter a
  // unidade de compra. Sem a conversão, o recebimento feito na loja calcula quantidade
  // errada — e ela nunca chegava à nuvem.
  { tabela: 'item_fornecedor', direcao: 'ambos', cursor: 'created_at' },
  { tabela: 'item_conversao', direcao: 'ambos', cursor: 'created_at' },
  // ⚠️ CADEIA DA FICHA — sem estas três o edge NÃO BAIXA ESTOQUE NENHUM.
  // A explosão (vendas.service → acumularFicha/acumularProduto) lê `ficha_ingrediente`,
  // `produto_combo_item` e `produto_variacao`. Elas nunca estiveram aqui: no servidor
  // local a ficha descia VAZIA, a venda não gerava movimento e — porque `consumo` vazio
  // é tratado como "ilimitado" — nada nunca esgotava. Ficam DEPOIS de `item_estoque`
  // (FK ficha_ingrediente.item_id) e depois de `produto` (FK das outras duas).
  // 'desce': o catálogo é master na nuvem. Cursor/exclusão vêm da mig 242.
  { tabela: 'ficha_ingrediente', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'produto_variacao', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'produto_combo_item', direcao: 'desce', cursor: 'updated_at' },
  // ⚠️ DOCUMENTOS DE ESTOQUE — nascem no EDGE (Recebimento/Contagem/Compras/Desperdício
  // são EDGE_CORE) e nunca estiveram aqui. O `movimento_estoque` subia, então o saldo na
  // nuvem batia — mas a ORIGEM sumia: entrava estoque sem dizer de qual nota, de qual
  // contagem, de qual perda. E `titulo_financeiro` (a CONTA A PAGAR que o recebimento
  // cria) não chegava: quem abria o Financeiro não via a dívida com o fornecedor.
  // 'ambos' com LWW: o documento pode nascer dos dois lados e MUDA DE ESTADO (recebimento
  // confirma, contagem fecha, título é pago) — o gatilho da mig 243 faz o bump propagar.
  // Ordem = pai antes do filho (fornecedor/item_estoque/colaborador já vieram acima).
  { tabela: 'recebimento', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'recebimento_item', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'lote', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'desperdicio', direcao: 'ambos', cursor: 'updated_at' },
  // Etiqueta de validade (mig 245): nasce na loja e MUDA DE ESTADO (fechado → em_uso
  // → baixado/vencido). Depois de `desperdicio`: a etiqueta vencida vira perda e
  // aponta para o desperdício que a consumiu.
  { tabela: 'etiqueta_validade', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'contagem_lista', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'contagem_lista_item', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'contagem_execucao', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'contagem_item', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'compra_lista', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'compra_item', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'titulo_financeiro', direcao: 'ambos', cursor: 'updated_at' },
  // Operacional (local → nuvem) — usadas no push (slice 2); cursor por criação.
  // movimento_estoque e lancamento_caixa TAMBÉM DESCEM (espelho — ver TABELAS_PULL_APPEND),
  // mas continuam 'sobe' aqui p/ o push tratar como append puro (do-nothing, imutáveis).
  { tabela: 'movimento_estoque', direcao: 'sobe', cursor: 'created_at' },
  // De qual lote saiu cada baixa (mig 248). Append-only como o ledger, e pela MESMA
  // razão: o saldo do lote é a soma destas linhas, não um campo mutável que o LWW
  // sobrescreveria perdendo baixa concorrente.
  { tabela: 'movimento_lote', direcao: 'sobe', cursor: 'created_at' },
  { tabela: 'ponto_marcacao', direcao: 'sobe', cursor: 'created_at' },
  // Abono/atestado lançado pela gestão (mig 272): o espelho local precisa ver. Depois de
  // `ponto_marcacao` (aponta para a marcação ajustada).
  { tabela: 'ponto_ajuste', direcao: 'ambos', cursor: 'created_at' },
  { tabela: 'lancamento_caixa', direcao: 'sobe', cursor: 'created_at' },
  { tabela: 'audit_log', direcao: 'sobe', cursor: 'created_at' },
  // Comprovante do TEF (NSU/autorização) — nasce no terminal da loja e a conciliação na
  // nuvem não enxergava. Só sobe: o terminal físico é de lá.
  { tabela: 'pagamento_tef', direcao: 'sobe', cursor: 'atualizado_em' },
  // Cliente do cardápio/CRM (mig 071 em diante): BIDIRECIONAL. Nasce na nuvem
  // (link mágico, marketplaces, ingest de CRM) e PRECISA DESCER — pedido_externo.
  // cliente_id tem FK para cliente(id), então sem essa tabela o edge dropava todo
  // pedido identificado no pull (23503). Também sobe (LWW) porque o edge pode
  // identificar cliente num pedido de balcão. Cursor = atualizado_em (o ingest do
  // CRM o bumpa a cada pedido → cliente recorrente re-desce junto com o pedido).
  // Vem ANTES dos transacionais (pai antes dos filhos p/ FK).
  { tabela: 'cliente', direcao: 'ambos', cursor: 'atualizado_em' },
  // Endereço de entrega (mig 276): sem ele, o atendente digita o telefone de um cliente
  // recorrente no balcão e NÃO vem nada — redigita o endereço inteiro a cada pedido.
  // Depois de `cliente` (chave estrangeira).
  { tabela: 'cliente_endereco', direcao: 'ambos', cursor: 'atualizado_em' },
  // Frete por bairro (mig 276): o painel de Delivery da loja LÊ esta tabela para montar o
  // seletor de bairro e recalcular a taxa quando alguém corrige o endereço. Vazia no
  // servidor local, o pedido saía com a taxa antiga ou zero — cobrança errada, calada.
  { tabela: 'cardapio_bairro', direcao: 'ambos', cursor: 'atualizado_em' },
  // ESPELHO (S1, ago/2026): transacionais viram BIDIRECIONAIS (antes só 'sobe').
  // Descem também p/ o edge espelhar o que o presidente faz na nuvem e o que a nuvem
  // materializou (pedido online → comanda). LWW por updated_at (gatilho da mig 095); o
  // edge aplica update-se-mais-nova no pull, com exceção p/ comanda em estado terminal.
  { tabela: 'caixa_sessao', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'comanda', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'comanda_item', direcao: 'ambos', cursor: 'updated_at' },
  // Complementos escolhidos em cada item (adicional, "sem cebola"). Nunca estiveram no sync:
  // a nuvem via o item sem o complemento. Linha imutável (só insere/apaga) → cursor created_at;
  // a exclusão chega pelo `sync_exclusao`. Depois de comanda_item (FK).
  { tabela: 'comanda_item_complemento', direcao: 'ambos', cursor: 'created_at' },
  // Como a conta foi dividida (mig 272): sem isto o Financeiro na nuvem via o total e não
  // sabia em quais formas de pagamento a comanda foi quitada. Depois de `comanda` (FK).
  { tabela: 'comanda_pagamento', direcao: 'ambos', cursor: 'created_at' },
  // Acerto do subcaixa do garçom: dinheiro pendente que nasce na loja e muda de estado
  // (pendente → baixado). Depois de caixa_sessao/comanda/mesa/equipamento (FK).
  { tabela: 'acerto_subpdv', direcao: 'ambos', cursor: 'updated_at' },
  // NFC-e. 'ambos' desde a mig 278 — era 'sobe', e isso deixava dois furos:
  //  • guarda de 5 anos: o documento subia, mas NÃO voltava. Reinstalar o servidor local
  //    apagava o arquivo fiscal da loja, que é justamente quem tem a obrigação de guardar;
  //  • numeração: a reserva de número se recupera lendo o maior número já emitido na série
  //    (fiscal.service). Num banco novo, sem as notas de volta, o contador reiniciaria em 1
  //    e repetiria CHAVE DE ACESSO.
  // A loja e a nuvem emitem em SÉRIES DIFERENTES (fiscal_serie), então as duas pontas nunca
  // disputam a mesma linha — 'ambos' aqui é espelho, não concorrência.
  { tabela: 'nota_fiscal', direcao: 'ambos', cursor: 'updated_at' },
  // Configuração do emitente (CNPJ, IE, endereço, CSC, série de cada origem). DESCE: é
  // configuração de distribuição, master na nuvem. Sem ela no servidor local a loja não
  // tinha como montar o cupom — a tabela simplesmente não existia lá, e ainda bloqueava a
  // reinstalação por não estar classificada.
  { tabela: 'fiscal_config', direcao: 'desce', cursor: 'updated_at' },
  // Ordem de produção (mig 272): documento que muda de estado (planejada → concluída) e
  // nasce dos dois lados. Depois de `ficha_tecnica` (FK).
  { tabela: 'ordem_producao', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'producao_pedido', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'producao_pedido_item', direcao: 'ambos', cursor: 'updated_at' },
  // Pedido externo é BIDIRECIONAL (P1): pedidos ONLINE nascem na nuvem (cardápio/
  // marketplaces) e precisam DESCER para o edge processá-los localmente (KDS/garçom);
  // pedidos locais SOBEM. LWW por updated_at resolve conflito de estado.
  { tabela: 'pedido_externo', direcao: 'ambos', cursor: 'updated_at' },
  // Pagamento dividido do PDV (mig 230): gravado no edge, nunca sincronizava. Refeito com
  // delete + insert a cada alteração → cursor created_at + `sync_exclusao`. Depois do pedido (FK).
  { tabela: 'pedido_externo_pagamento', direcao: 'ambos', cursor: 'created_at' },
  // Exclusões físicas (mig 262): o gatilho grava (tabela, id) aqui e quem recebe apaga a mesma
  // linha do seu lado. Sobe como anexo e desce pelo TABELAS_PULL_APPEND. Por ÚLTIMO no push,
  // para a exclusão chegar depois das linhas do mesmo ciclo.
  { tabela: 'sync_exclusao', direcao: 'sobe', cursor: 'created_at' },
];

// Append-only que TAMBÉM DESCEM no espelho (S1). Ficam 'sobe' no push (imutáveis),
// mas o pull precisa trazê-las p/ o dashboard/relatórios locais baterem com a nuvem.
// O upsert por id é aditivo e idempotente (sem updated_at → sem LWW, e não têm conflito).
export const TABELAS_PULL_APPEND: TabelaSync[] = [
  { tabela: 'lancamento_caixa', direcao: 'desce', cursor: 'created_at' },
  { tabela: 'movimento_estoque', direcao: 'desce', cursor: 'created_at' },
  { tabela: 'movimento_lote', direcao: 'desce', cursor: 'created_at' },
  // Exclusões feitas na nuvem descem para o edge. ÚLTIMA da lista: o edge aplica as exclusões
  // depois das linhas da mesma resposta.
  { tabela: 'sync_exclusao', direcao: 'desce', cursor: 'created_at' },
];

// O servidor local PUXA o que a nuvem manda pra baixo (desce/ambos) + os append-que-descem.
export const TABELAS_PULL: TabelaSync[] = [
  ...TABELAS_SYNC.filter((t) => t.direcao === 'desce' || t.direcao === 'ambos'),
  ...TABELAS_PULL_APPEND,
];

// Janela de espelho (mirror_dias): tabelas TRANSACIONAIS pesadas que o edge puxa só
// dos últimos N dias (default 60, config no Financeiro via empresa.mirror_dias). A NUVEM
// mantém histórico integral; a janela afeta só o que DESCE. Controle/catálogo = integral.
export const TABELAS_JANELA_MIRROR = new Set<string>([
  'comanda',
  'comanda_item',
  'caixa_sessao',
  'producao_pedido',
  'producao_pedido_item',
  'lancamento_caixa',
  'pedido_externo',
  // Filhas do transacional janelado acompanham a janela dos pais.
  'comanda_item_complemento',
  'pedido_externo_pagamento',
]);
// Registro ainda ABERTO desce mesmo fora da janela: a janela corta pela data de CRIAÇÃO, e uma
// sessão de caixa aberta há 64 dias (com 480 lançamentos recentes, na loja de teste) não descia
// — o PDV local não enxergava o caixa aberto e os lançamentos dela ficavam órfãos. Tabela →
// condição SQL fixa (constante daqui, nunca do usuário).
export const JANELA_ABERTOS: Record<string, string> = {
  caixa_sessao: "status = 'aberta'",
  comanda: "status = 'aberta'",
};
// ⚠️ `movimento_estoque` FOI TIRADO da janela de propósito. Para um transacional de
// evento (comanda, caixa) a janela é inócua — o edge só perde histórico de consulta.
// Para o LEDGER de estoque não é: o SALDO É A SOMA DE TODO O LEDGER (estoque.service
// e vendas.saldoItem), e não existe saldo materializado. Truncando em 60 dias, o saldo
// local nasce errado pelo tamanho do histórico que ficou de fora — no banco de
// desenvolvimento, 505 dos 509 movimentos estavam fora da janela. Em cadeia isso
// dispara alerta de reposição do catálogo inteiro, zera a disponibilidade do atacado
// e contamina o snapshot diário. Ledger cumulativo não pode ser janelado.

// Tabelas cujo delta começa do ZERO quando o edge ainda não tem cursor PRÓPRIO delas.
//
// O pull tem um piso global (`pull_cursor`). Num edge já instalado esse piso está em
// "agora", então uma tabela ADICIONADA depois desceria só com o que mudasse a partir de
// hoje — as fichas que já existem nunca chegariam, e a loja seguiria sem baixar estoque
// até alguém reeditar cada ficha. Para estas, o piso global é ignorado enquanto não
// houver cursor da própria tabela; no ciclo seguinte o edge já grava o seu e a exceção
// deixa de valer sozinha. Autocurável e sem intervenção manual.
//
// ⚠️ Isto NÃO rebobina cursor já existente. Edge que já sincronizava `movimento_estoque`
// com a janela de 60 dias tem cursor gravado e não vai buscar o histórico anterior
// sozinho — precisa do reset de uma vez do `.zip` (ver RELEASES.md).
export const TABELAS_DESDE_ZERO = new Set<string>([
  'ficha_ingrediente',
  'produto_variacao',
  'produto_combo_item',
  'movimento_estoque',
  // Documentos de estoque (mig 243) — o histórico precisa descer uma vez.
  'recebimento',
  'recebimento_item',
  'lote',
  'desperdicio',
  'contagem_lista',
  'contagem_lista_item',
  'contagem_execucao',
  'contagem_item',
  'compra_lista',
  'compra_item',
  'titulo_financeiro',
  // Etiquetas de validade (mig 245) — mesma razão.
  'etiqueta_validade',
  // Pausa por estoque por loja (mig 260): a 261 cria o estado inicial, que precisa descer.
  'produto_pausa_estoque',
  // Entraram no sync com a mig 262.
  'comanda_item_complemento',
  'pedido_externo_pagamento',
  'sync_exclusao',
  // Custo/mínimo por loja (mig 257): os valores iniciais da 258 precisam descer uma vez.
  'item_estoque_unidade',
  // PARIDADE (mig 272/273): tudo isto já existe nos dois bancos há tempo. Sem a exceção,
  // o edge já instalado só receberia o que mudasse a partir de hoje — o checklist, o guia,
  // o cupom e a forma de pagamento que já existem nunca chegariam.
  'funcao_setor', 'colaborador_funcao', 'modulo_ativacao', 'entitlement', 'janela_pico', 'contador',
  'categoria_item', 'forma_pagamento', 'kds_cor_config', 'tef_config', 'mesa',
  'documento_controlado', 'ciencia', 'checklist', 'checklist_item', 'pop', 'tarefa_def',
  'guia', 'guia_passo', 'comunicado', 'comunicado_leitura', 'clima_pesquisa', 'clima_resposta',
  'clima_participacao', 'escala_regra', 'dia_especial', 'vistoria', 'ocorrencia',
  'pedido_manutencao', 'atendimento_chamado', 'alerta_estoque',
  'cupom', 'cupom_uso', 'encomenda_regra_sinal', 'encomenda_recorrencia', 'banner',
  'produto_sugestao', 'produto_faixa_preco', 'produto_destino_producao', 'setor_destino_producao',
  'complemento_destino_producao', 'opcao_destino_producao',
  'item_fornecedor', 'item_conversao', 'ordem_producao', 'comanda_pagamento', 'acerto_subpdv',
  'ponto_ajuste',
  // Dinheiro do cliente (mig 274): o histórico tem de descer uma vez, senão o saldo
  // recalculado na loja nasceria só com o que mudou de hoje em diante.
  'cashback_plano', 'cashback_produto_valor', 'cashback_movimento', 'cashback_vale',
  'fidelidade_plano', 'fidelidade_ponto', 'fidelidade_resgate', 'fidelidade_ajuste',
  // Endereço do cliente e frete por bairro (mig 276): o que já existe precisa descer uma
  // vez, senão a loja ficaria com a lista de bairros só do que mudar de hoje em diante.
  'cliente_endereco', 'cardapio_bairro', 'tarefa_instancia', 'escala_alocacao',
]);

// RESTAURAÇÃO (nuvem → edge, SÓ sob demanda): tabelas TRANSACIONAIS que podem ter
// sido criadas na NUVEM enquanto o edge esteve fora (operação no modo nuvem). Ao
// voltar pro local, o botão de restaurar PUXA essas tabelas por delta e faz UPSERT
// por id (aditivo — nunca apaga o que é só local). Ordem = pais antes dos filhos
// (o daemon ainda tem retry de FK como rede de segurança). NÃO é sync contínuo.
export const TABELAS_RESTORE: TabelaSync[] = [
  // Cliente antes dos transacionais (FK pedido_externo.cliente_id → cliente.id):
  // senão o botão Restaurar dropava pedidos identificados igual ao pull contínuo.
  { tabela: 'cliente', direcao: 'desce', cursor: 'atualizado_em' },
  // Cursor por updated_at (v2) para trazer também MUDANÇAS DE ESTADO feitas na
  // nuvem durante a queda (ex.: comanda fechada), não só as criadas.
  { tabela: 'caixa_sessao', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'comanda', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'comanda_item', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'comanda_item_complemento', direcao: 'desce', cursor: 'created_at' },
  // Como a conta foi dividida (mig 272): a nuvem cria isto quando assume a loja caída, e
  // sem descer no restore a comanda voltava sem saber em que formas foi paga.
  { tabela: 'comanda_pagamento', direcao: 'desce', cursor: 'created_at' },
  { tabela: 'producao_pedido', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'producao_pedido_item', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'pedido_externo', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'pedido_externo_pagamento', direcao: 'desce', cursor: 'created_at' },
  { tabela: 'lancamento_caixa', direcao: 'desce', cursor: 'created_at' }, // append (sem updated_at)
  { tabela: 'movimento_estoque', direcao: 'desce', cursor: 'created_at' }, // append
];

// Push: append-only ('sobe', on conflict do nothing) e LWW ('ambos', on conflict
// do update se a linha recebida for mais nova — ver venceLWW / arquitetura-edge §3).
export const TABELAS_PUSH_APPEND = new Set(
  TABELAS_SYNC.filter((t) => t.direcao === 'sobe').map((t) => t.tabela),
);
export const TABELAS_PUSH_LWW = new Set(
  TABELAS_SYNC.filter((t) => t.direcao === 'ambos').map((t) => t.tabela),
);
// Tabelas em que uma exclusão recebida pelo `sync_exclusao` pode apagar linha (mig 262): as
// sincronizadas com estado. Nunca as de só-anexar (ledger, caixa, ponto, auditoria), nunca
// `empresa` e nunca o próprio registro de exclusões. É a trava de segurança do push: o id da
// tabela vem do edge, e só apaga dentro da empresa do token.
export const TABELAS_EXCLUIVEIS = new Set(
  TABELAS_SYNC.filter((t) => t.direcao !== 'sobe' && t.tabela !== 'empresa').map((t) => t.tabela),
);

// ── ESCOPO POR LOJA NO PULL (decisão do dono, 17/09/2026) ──────────────────────────────────
// "Ele só baixa os dados da unidade caso a empresa tenha mais de uma. Em casos de grande volume
// em cada unidade vai ser um tráfego de informações desnecessárias e riscos de bugs e erros."
//
// O que é filtrado: o TRANSACIONAL e os DOCUMENTOS — o que cresce com o movimento da loja.
// O que NÃO é filtrado: cadastro e configuração (pessoas, perfis, catálogo, fichas,
// complementos, insumos, equipamentos, configs). São poucas linhas e valem para a rede;
// filtrar pessoa/perfil arriscaria o login de quem atende as duas lojas, e filtrar catálogo
// deixaria o PDV sem produto.
// Linha SEM loja (`unidade_id is null` = da rede) sempre desce — é o insumo/lançamento que
// pertence à empresa, não a uma loja.
// Empresa de UMA loja não filtra nada (o comportamento de hoje), e edge sem loja definida
// (instalação antiga, sem EDGE_UNIDADE_ID no equipamento) também não.
//
// Tabela filha (sem `unidade_id` próprio) é filtrada PELO PAI — senão desceria a filha da
// outra loja, que falharia por FK e engordaria a fila de órfãos.
export const LOJA_COLUNA = new Set<string>([
  'comanda', 'caixa_sessao', 'lancamento_caixa', 'producao_pedido', 'pedido_externo',
  'movimento_estoque', 'desperdicio', 'recebimento', 'lote', 'etiqueta_validade',
  'contagem_lista', 'compra_lista', 'titulo_financeiro',
  // PARIDADE (mig 272): documentos que CRESCEM com o movimento da loja. Cadastro e
  // configuração continuam de fora (valem para a rede inteira).
  'nota_fiscal', 'ordem_producao', 'acerto_subpdv', 'vistoria', 'pagamento_tef', 'alerta_estoque',
  'tarefa_instancia', 'escala_alocacao',
]);

export const LOJA_PELO_PAI: Record<string, (uid: string) => SQL> = {
  comanda_item: (uid) => sql`exists (select 1 from comanda p
    where p.id = comanda_item.comanda_id and (p.unidade_id = ${uid} or p.unidade_id is null))`,
  comanda_item_complemento: (uid) => sql`exists (select 1 from comanda_item ci
    join comanda p on p.id = ci.comanda_id
    where ci.id = comanda_item_complemento.comanda_item_id and (p.unidade_id = ${uid} or p.unidade_id is null))`,
  producao_pedido_item: (uid) => sql`exists (select 1 from producao_pedido p
    where p.id = producao_pedido_item.pedido_id and (p.unidade_id = ${uid} or p.unidade_id is null))`,
  pedido_externo_pagamento: (uid) => sql`exists (select 1 from pedido_externo p
    where p.id = pedido_externo_pagamento.pedido_externo_id and (p.unidade_id = ${uid} or p.unidade_id is null))`,
  movimento_lote: (uid) => sql`exists (select 1 from movimento_estoque m
    where m.id = movimento_lote.movimento_id and (m.unidade_id = ${uid} or m.unidade_id is null))`,
  recebimento_item: (uid) => sql`exists (select 1 from recebimento p
    where p.id = recebimento_item.recebimento_id and (p.unidade_id = ${uid} or p.unidade_id is null))`,
  contagem_lista_item: (uid) => sql`exists (select 1 from contagem_lista p
    where p.id = contagem_lista_item.lista_id and (p.unidade_id = ${uid} or p.unidade_id is null))`,
  contagem_execucao: (uid) => sql`exists (select 1 from contagem_lista p
    where p.id = contagem_execucao.lista_id and (p.unidade_id = ${uid} or p.unidade_id is null))`,
  contagem_item: (uid) => sql`exists (select 1 from contagem_execucao ce
    join contagem_lista p on p.id = ce.lista_id
    where ce.id = contagem_item.execucao_id and (p.unidade_id = ${uid} or p.unidade_id is null))`,
  compra_item: (uid) => sql`exists (select 1 from compra_lista p
    where p.id = compra_item.lista_id and (p.unidade_id = ${uid} or p.unidade_id is null))`,
  // PARIDADE (mig 272): como a conta foi dividida acompanha a comanda da loja.
  comanda_pagamento: (uid) => sql`exists (select 1 from comanda p
    where p.id = comanda_pagamento.comanda_id and (p.unidade_id = ${uid} or p.unidade_id is null))`,
};

// Filtro por loja de uma tabela (vazio = desce inteira).
export function filtroLoja(tabela: string, colunas: Set<string>, uid: string | null): SQL {
  if (!uid) return sql``;
  if (LOJA_COLUNA.has(tabela) && colunas.has('unidade_id')) {
    return sql` and (${sql.identifier('unidade_id')} = ${uid} or ${sql.identifier('unidade_id')} is null)`;
  }
  const pelaPai = LOJA_PELO_PAI[tabela];
  return pelaPai ? sql` and ${pelaPai(uid)}` : sql``;
}

export function modoPush(tabela: string): 'append' | 'lww' | null {
  if (TABELAS_PUSH_APPEND.has(tabela)) return 'append';
  if (TABELAS_PUSH_LWW.has(tabela)) return 'lww';
  return null;
}

// Coluna de comparação do LWW no push (update-se-mais-nova). Quase tudo usa
// updated_at; cliente usa atualizado_em. Deriva do cursor configurado da tabela
// para o push não comparar uma coluna que não existe (ex.: cliente sem updated_at
// → 42703 derrubaria o push inteiro). Default seguro: updated_at.
export function colunaLWW(tabela: string): string {
  return TABELAS_SYNC.find((x) => x.tabela === tabela)?.cursor ?? 'updated_at';
}

// Segurança: colunas NUNCA enviadas no pull.
// NOTA sobre auth offline (decidido 14/07/2026): o edge é um appliance ON-PREMISE
// do próprio cliente licenciado — ele PRECISA de senha_hash/pin_hash locais para
// autenticar login (senha) e PIN sem internet. Os hashes são bcrypt (mão única),
// enviados só ao edge daquele tenant, pela rota /sync autenticada por sync token, e
// o pgdata é local (dono NetworkService). É o mesmo modelo de qualquer sistema
// on-prem, que sempre guarda os próprios hashes. Por isso NÃO redigimos mais aqui.
// Deixe o mapa pronto para redigir segredos futuros (ex.: tokens de integração).
export const REDIGIR: Record<string, string[]> = {};
