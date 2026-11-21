import {
  CANAIS_DA_PAUSA,
  CanalDaPausa,
  MOTIVOS,
  MOTIVOS_DA_PAUSA,
  NOME_DO_CANAL,
  TEMPOS_DA_99,
  TEMPOS_DO_CARDAPIO,
  ateDa99,
  ateDoCardapio,
  lerMotivo,
  voltaDaPausa,
} from '../../common/pausa-do-canal';

// AS AÇÕES DO MISTER — a porta `propor_acao` (versão 6, M6j; plano aprovado em 20/11/2026, `docs/plano-mister.md` § "Versão
// 6", Frente C — "Uma porta só para as ações"; protótipo `mockups/regem-mister-v6.html`, "Fazer pelo WhatsApp, com
// segurança"). As consultas seguem como ferramentas; as AÇÕES passam por uma ferramenta só, com o catálogo e o formato de
// cada uma conferidos AQUI, pelo código. A ação só acontece no "Autorizar" de quem pediu (o tamanho do risco: botão), pelo
// MESMO serviço da tela, e o "feito" só sai com o efeito conferido. Lote 1: o Delivery (os canais e os pedidos).

/** O catálogo das ações. Ação nova entra aqui, com a execução pelo serviço da tela e a conferência do efeito. */
export const ACOES_DO_MISTER = [
  'pausar_canal',
  'reabrir_canal',
  'aceitar_pedido',
  'pedido_pronto',
  'despachar_pedido',
  // Lote 2: as tarefas do dia e a pausa do produto.
  'concluir_tarefa',
  'pausar_produto',
  'reativar_produto',
  // Lote 3: criar a tarefa de hoje.
  'criar_tarefa',
  // M6l: uma imagem pelo DMS Graph (cartaz, post), com o pedido mostrado antes.
  'criar_imagem',
  // Lote 7: entrada, saída ou o saldo contado de um produto do estoque.
  'movimentar_estoque',
] as const;
export type AcaoDoMister = (typeof ACOES_DO_MISTER)[number];
export const ehAcaoDoMister = (p: unknown): p is AcaoDoMister => (ACOES_DO_MISTER as readonly string[]).includes(String(p));

export interface DefinicaoDaAcao {
  id: AcaoDoMister;
  /** O tamanho do risco (decisão do plano): o botão de quem pediu. As de PIN (preço, horário, pagar) são os lotes seguintes. */
  nivel: 'botao';
  /** A permissão do perfil — a MESMA da rota da tela. O presidente pode tudo. */
  permissao: 'delivery' | 'meu_dia' | 'loja' | 'checklist' | 'estoque';
  /** Por quanto tempo a pergunta vale. */
  prazoMin: number;
  /** O nome curto, para a auditoria e o histórico das propostas. */
  nome: string;
}

export const ACOES: Record<AcaoDoMister, DefinicaoDaAcao> = {
  pausar_canal: { id: 'pausar_canal', nivel: 'botao', permissao: 'delivery', prazoMin: 10, nome: 'pausar canais de venda' },
  reabrir_canal: { id: 'reabrir_canal', nivel: 'botao', permissao: 'delivery', prazoMin: 10, nome: 'reabrir canais de venda' },
  aceitar_pedido: { id: 'aceitar_pedido', nivel: 'botao', permissao: 'delivery', prazoMin: 10, nome: 'aceitar um pedido' },
  pedido_pronto: { id: 'pedido_pronto', nivel: 'botao', permissao: 'delivery', prazoMin: 10, nome: 'marcar um pedido como pronto' },
  despachar_pedido: { id: 'despachar_pedido', nivel: 'botao', permissao: 'delivery', prazoMin: 10, nome: 'despachar um pedido' },
  // Lote 2. A tarefa: a permissão da rota `PATCH /tarefas-instancias/:id/estado` (Tarefas). O produto: a de
  // `PUT /produtos/:id/pausa-canal` (Loja).
  concluir_tarefa: { id: 'concluir_tarefa', nivel: 'botao', permissao: 'meu_dia', prazoMin: 10, nome: 'marcar uma tarefa do dia' },
  pausar_produto: { id: 'pausar_produto', nivel: 'botao', permissao: 'loja', prazoMin: 10, nome: 'pausar um produto' },
  reativar_produto: { id: 'reativar_produto', nivel: 'botao', permissao: 'loja', prazoMin: 10, nome: 'reativar um produto' },
  // Lote 3: a permissão das rotas `POST /tarefas` e `POST /tarefas-instancias/instanciar` (Checklist & registros).
  criar_tarefa: { id: 'criar_tarefa', nivel: 'botao', permissao: 'checklist', prazoMin: 10, nome: 'criar uma tarefa para hoje' },
  // M6l: quem cuida do Delivery e do Marketing; vale por 30 minutos, para dar tempo de ler o pedido.
  criar_imagem: { id: 'criar_imagem', nivel: 'botao', permissao: 'delivery', prazoMin: 30, nome: 'criar uma imagem' },
  // Lote 7: a permissão da rota `POST /estoque/movimentos` é `estoque.editar` (a conferência é a `temAPermissao` do serviço).
  movimentar_estoque: { id: 'movimentar_estoque', nivel: 'botao', permissao: 'estoque', prazoMin: 10, nome: 'lançar um movimento de estoque' },
};

// ───────────────────────────── M6l: a imagem ─────────────────────────────

/** Nasce desligada: quem liga é o dono, com `MISTER_CRIAR_IMAGEM=1` (a imagem é paga, pela franquia do DMS Graph). */
export const imagemLigada = (): boolean => process.env.MISTER_CRIAR_IMAGEM === '1';
export const PROPORCOES_DA_IMAGEM = ['1:1', '9:16', '16:9'] as const;
export type ProporcaoDaImagem = (typeof PROPORCOES_DA_IMAGEM)[number];
/** O pedido vai no corpo da mensagem com botões, que a Meta limita a 1.024 letras. */
export const PEDIDO_DA_IMAGEM_MAX = 800;
export const BOTOES_DA_IMAGEM = { autorizar: 'Gerar', naoAgora: 'Mudar' } as const;
/** Telefone, CPF ou CNPJ (10 dígitos ou mais em sequência) e e-mail não vão à IA de imagem. */
export const pareceDadoPessoal = (t: string): boolean => /[^\s@]+@[^\s@]+\.[^\s@]+/.test(t) || /(?:\d[\s().\/-]*){10,}/.test(t);
/** O que a IA faz com a resposta da ação. */
export const sigaDaAcao = (acao: AcaoDoMister): string =>
  acao === 'criar_imagem'
    ? 'Mostre o "oQueVouFazer" como veio, entre aspas, e diga que os botões "Gerar" e "Mudar" chegam logo abaixo e que usa 1 da franquia de imagens do mês. Nada é gerado sem o "Gerar". Não diga que gerou.'
    : 'Mostre o "oQueVouFazer" como veio e diga que os botões "Autorizar" e "Não agora" chegam logo abaixo. Nada é feito sem o "Autorizar". Não diga que fez.';

// ───────────────────────────── lote 2: a tarefa e o produto ─────────────────────────────

export const ESTADOS_DA_TAREFA = ['feita', 'parcial', 'nao_feita'] as const;
export type EstadoDaTarefa = (typeof ESTADOS_DA_TAREFA)[number];
const NOME_DO_ESTADO: Record<EstadoDaTarefa, string> = { feita: 'feita', parcial: 'feita em parte', nao_feita: 'não feita' };
export const nomeDoEstadoDaTarefa = (e: string): string =>
  NOME_DO_ESTADO[e as EstadoDaTarefa] ?? ({ pendente: 'pendente', em_execucao: 'em execução', impossibilitada: 'impossibilitada' } as Record<string, string>)[e] ?? e;

/** Os canais da pausa do produto (os da tela: o Regem — balcão e cardápio digital juntos —, o iFood e a 99). */
export const CANAIS_DO_PRODUTO = ['regem', 'ifood', '99food'] as const;
export type CanalDoProduto = (typeof CANAIS_DO_PRODUTO)[number];
export function lerCanalDoProduto(v: unknown): CanalDoProduto | null {
  const t = String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (t === 'regem' || t === 'cardapio' || t === 'cardapio digital' || t === 'balcao' || t === 'loja') return 'regem';
  if (t === 'ifood') return 'ifood';
  if (t === '99' || t === '99food' || t === 'food99') return '99food';
  return null;
}
/** "no Regem (balcão e cardápio digital)", "no iFood e na 99". */
export function ondeOProduto(canais: readonly CanalDoProduto[]): string {
  const um = (c: CanalDoProduto) => (c === 'regem' ? 'no Regem (balcão e cardápio digital)' : c === 'ifood' ? 'no iFood' : 'na 99');
  const n = canais.map(um);
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}`;
}
/** Sem canal dito: os canais em que o produto está (o "Pausar em todos" da Gestão do catálogo). */
export function canaisDoProduto(p: { noIfood: boolean; na99: boolean }): CanalDoProduto[] {
  return ['regem', ...(p.noIfood ? (['ifood'] as const) : []), ...(p.na99 ? (['99food'] as const) : [])];
}
/** O produto ficou como a ação pediu em cada canal? (o Regem: balcão e cardápio; os apps: a lista `canais_pausados`). */
export function produtoFicou(p: { disponivelBalcao: boolean; disponivelCardapio: boolean; canaisPausados: string[] }, canais: readonly CanalDoProduto[], pausado: boolean): CanalDoProduto[] {
  return canais.filter((c) => (c === 'regem' ? p.disponivelBalcao === !pausado && p.disponivelCardapio === !pausado : p.canaisPausados.includes(c) === pausado));
}

/** O canal como a pessoa (ou a IA) diz: "cardapio", "ifood", "99" (ou o nome interno "food99"). */
export function lerCanal(v: unknown): CanalDaPausa | null {
  const t = String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (t === '99' || t === 'food99' || t === '99food') return 'food99';
  if (t === 'cardapio' || t === 'cardapio digital') return 'cardapio';
  if (t === 'ifood') return 'ifood';
  return null;
}

/** "o iFood", "o iFood e a 99", "o cardápio digital, o iFood e a 99". */
export function nomesDosCanais(canais: readonly CanalDaPausa[]): string {
  const um = (c: CanalDaPausa) => (c === 'food99' ? 'a 99' : c === 'ifood' ? 'o iFood' : 'o cardápio digital');
  const n = canais.map(um);
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}`;
}

// ───────────────────────────── lote 7: o movimento de estoque ─────────────────────────────

export const TIPOS_DO_MOVIMENTO = ['entrada', 'saida', 'ajuste'] as const;
export type TipoDoMovimento = (typeof TIPOS_DO_MOVIMENTO)[number];
const ESTOQUE_MAX = 1_000_000;
/** Número de estoque vindo da IA: só número de verdade, dentro do teto, com até 3 casas (V109). */
const numeroDoEstoque = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= ESTOQUE_MAX ? Math.round(v * 1000) / 1000 : null;
const NOMES_DA_UNIDADE: Record<string, string> = {
  kg: 'kg', kgs: 'kg', quilo: 'kg', quilos: 'kg', kilo: 'kg', kilos: 'kg', quilograma: 'kg', quilogramas: 'kg',
  g: 'g', gr: 'g', grs: 'g', grama: 'g', gramas: 'g',
  l: 'l', lt: 'l', lts: 'l', litro: 'l', litros: 'l',
  ml: 'ml', mililitro: 'ml', mililitros: 'ml',
  un: 'un', und: 'un', unid: 'un', unidade: 'un', unidades: 'un',
};
const unidadeNormal = (u: unknown): string => {
  const t = String(u ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f.]/g, '');
  return NOMES_DA_UNIDADE[t] ?? t;
};
/** A unidade que a pessoa disse é a do item? ("2 caixas" num item em kg não se lança: a conta seria errada.) */
export const mesmaUnidade = (dita: unknown, doItem: unknown): boolean => unidadeNormal(dita) === unidadeNormal(doItem);
export const quantidadeBr = (n: number): string => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
/** O "o que vou fazer" do movimento: o item, a loja, e o saldo antes e depois. */
export function resumoDoMovimento(
  m: { tipo: TipoDoMovimento; quantidade: number | null; saldoContado: number | null; motivo: string | null },
  a: { nome: string; unidade: string; saldo: number; loja: string | null },
): string {
  const un = (x: number) => `${quantidadeBr(x)} ${a.unidade}`;
  const naLoja = a.loja ? ` na ${a.loja}` : '';
  const porque = m.motivo ? ` (motivo: ${m.motivo})` : '';
  const q = m.quantidade ?? 0;
  const depois = Math.round((m.tipo === 'entrada' ? a.saldo + q : m.tipo === 'saida' ? a.saldo - q : (m.saldoContado ?? 0)) * 1000) / 1000;
  const oQue =
    m.tipo === 'entrada'
      ? `Dar entrada de ${un(q)} em "${a.nome}"${naLoja}${porque}.`
      : m.tipo === 'saida'
        ? `Dar saída de ${un(q)} em "${a.nome}"${naLoja}${porque}.`
        : `Acertar o saldo de "${a.nome}"${naLoja} pelo que foi contado${porque}.`;
  return `${oQue} Saldo: ${un(a.saldo)} → ${un(depois)}.${depois < 0 ? ' O saldo fica negativo.' : ''}`;
}

/** O que a ação leva, já conferido (vai em `mister_proposta.parametros`, junto com quem pediu). */
export type ParametrosDaAcao =
  | { acao: 'pausar_canal'; canais: CanalDaPausa[]; motivo: string; motivoTexto: string | null; minutos: number | null; ate: string | null; fimDoDia: boolean }
  | { acao: 'reabrir_canal'; canais: CanalDaPausa[] }
  | { acao: 'aceitar_pedido' | 'pedido_pronto' | 'despachar_pedido'; numero: string }
  | { acao: 'concluir_tarefa'; tarefa: string; estado: EstadoDaTarefa; justificativa: string | null }
  | { acao: 'pausar_produto' | 'reativar_produto'; produto: string; canais: CanalDoProduto[] | null }
  | { acao: 'criar_tarefa'; titulo: string; funcao: string; horario: string | null; responsavel: string | null }
  | { acao: 'criar_imagem'; pedido: string; proporcao: ProporcaoDaImagem }
  | { acao: 'movimentar_estoque'; item: string; tipo: TipoDoMovimento; quantidade: number | null; saldoContado: number | null; motivo: string | null };

const TEMPOS_TEXTO = `cardápio digital e iFood: ${TEMPOS_DO_CARDAPIO.join(', ')} min ou "até HH:MM"; 99: ${TEMPOS_DA_99.join(', ')} min ou até o fim do dia`;

/**
 * Confere o que a IA mandou para a ação — os MESMOS limites da tela (o motivo, os tempos de cada canal). Devolve os
 * parâmetros limpos e o "o que vou fazer" da pergunta, ou o erro em português (volta à IA, que pergunta à pessoa).
 */
export function conferirAcao(acao: unknown, en: Record<string, unknown>, agora: Date = new Date()): { parametros: ParametrosDaAcao; resumo: string } | { erro: string } {
  if (!ehAcaoDoMister(acao)) return { erro: `Essa ação não existe. As ações são: ${ACOES_DO_MISTER.join(', ')}.` };
  if (acao === 'pausar_canal' || acao === 'reabrir_canal') {
    const brutos = Array.isArray(en.canais) ? en.canais : en.canal !== undefined ? [en.canal] : [];
    const canais = [...new Set(brutos.map(lerCanal))];
    if (!canais.length || canais.some((c) => c === null)) return { erro: 'Diga qual canal: cardapio, ifood ou 99 (um ou mais).' };
    const lista = (CANAIS_DA_PAUSA as readonly CanalDaPausa[]).filter((c) => canais.includes(c));
    if (acao === 'reabrir_canal') return { parametros: { acao, canais: lista }, resumo: `Reabrir ${nomesDosCanais(lista)} agora.` };
    const m = lerMotivo(en.motivo, en.motivoTexto);
    if (!m.ok) return { erro: `${m.erro} Os motivos: ${MOTIVOS.join(', ')} (outro pede o texto, até 80 letras).` };
    const minutos = en.minutos === undefined || en.minutos === null || en.minutos === '' ? null : Number(en.minutos);
    const ate = typeof en.ate === 'string' && en.ate.trim() ? en.ate.trim() : null;
    const fimDoDia = en.fimDoDia === true;
    const voltas: string[] = [];
    for (const c of lista) {
      const r = c === 'food99' ? ateDa99({ minutos, fimDoDia }, agora) : ateDoCardapio(minutos !== null ? { minutos } : { ate }, agora);
      if (!r.ok) return { erro: `${NOME_DO_CANAL[c]}: ${r.erro} Os tempos: ${TEMPOS_TEXTO}.` };
      voltas.push(`${nomesDosCanais([c])} ${voltaDaPausa(r.ate, agora).texto}`);
    }
    const motivo = m.motivo === 'outro' ? m.motivoTexto! : MOTIVOS_DA_PAUSA[m.motivo].rotulo;
    return {
      parametros: { acao, canais: lista, motivo: m.motivo, motivoTexto: m.motivoTexto, minutos, ate, fimDoDia },
      resumo: `Pausar ${nomesDosCanais(lista)} (motivo: ${motivo}). Volta: ${voltas.join('; ')}.`,
    };
  }
  if (acao === 'concluir_tarefa') {
    const tarefa = String(en.tarefa ?? '').trim().replace(/\s+/g, ' ');
    if (tarefa.length < 2 || tarefa.length > 80) return { erro: 'Diga a tarefa de hoje como ela aparece na lista (o título).' };
    const estado = (en.estado === undefined || en.estado === null || en.estado === '' ? 'feita' : String(en.estado)) as EstadoDaTarefa;
    if (!(ESTADOS_DA_TAREFA as readonly string[]).includes(estado)) return { erro: 'A tarefa fica feita, parcial ou nao_feita.' };
    // A MESMA regra da tela (`TarefaInstanciaService.concluir`): "não feita" pede o motivo.
    const justificativa = typeof en.justificativa === 'string' && en.justificativa.trim() ? en.justificativa.trim().slice(0, 200) : null;
    if (estado === 'nao_feita' && !justificativa) return { erro: 'Para marcar como não feita, diga o motivo (vai junto na tarefa).' };
    return {
      parametros: { acao, tarefa, estado, justificativa: estado === 'nao_feita' ? justificativa : null },
      resumo: `Marcar a tarefa "${tarefa}" como ${nomeDoEstadoDaTarefa(estado)}${estado === 'nao_feita' ? ` (motivo: ${justificativa})` : ''}.`,
    };
  }
  if (acao === 'pausar_produto' || acao === 'reativar_produto') {
    const produto = String(en.produto ?? '').trim().replace(/\s+/g, ' ');
    if (produto.length < 2 || produto.length > 80) return { erro: 'Diga o produto como ele aparece no cardápio.' };
    const brutos = Array.isArray(en.canais) ? en.canais : en.canal !== undefined ? [en.canal] : [];
    const lidos = [...new Set(brutos.map(lerCanalDoProduto))];
    if (lidos.some((c) => c === null)) return { erro: 'Os canais do produto são regem (balcão e cardápio digital), ifood e 99.' };
    const canais = lidos.length ? (CANAIS_DO_PRODUTO as readonly CanalDoProduto[]).filter((c) => lidos.includes(c)) : null;
    const verbo = acao === 'pausar_produto' ? 'Pausar' : 'Reativar';
    return { parametros: { acao, produto, canais }, resumo: `${verbo} "${produto}" ${canais ? ondeOProduto(canais) : 'em todos os canais em que ele está'}.` };
  }
  if (acao === 'criar_tarefa') {
    // A MESMA exigência da tela (`TarefaDefService.create`): o título e a função ("Selecione a função da tarefa.").
    const titulo = String(en.titulo ?? '').trim().replace(/\s+/g, ' ');
    if (titulo.length < 2 || titulo.length > 120) return { erro: 'Diga o título da tarefa (de 2 a 120 letras).' };
    const funcao = String(en.funcao ?? '').trim().replace(/\s+/g, ' ');
    if (funcao.length < 2 || funcao.length > 60) return { erro: 'Diga a função da tarefa (quem faz: a cozinha, o caixa, a limpeza…), como está no cadastro das funções.' };
    const horario = typeof en.horario === 'string' && en.horario.trim() ? en.horario.trim() : null;
    if (horario !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(horario)) return { erro: 'O horário da tarefa vai em HH:MM (por exemplo 15:30).' };
    const responsavel = typeof en.responsavel === 'string' && en.responsavel.trim() ? en.responsavel.trim().slice(0, 80) : null;
    return {
      parametros: { acao, titulo, funcao, horario, responsavel },
      resumo: `Criar para hoje a tarefa "${titulo}"${horario ? ` às ${horario}` : ''}, da função ${funcao}${responsavel ? `, para ${responsavel}` : ''}.`,
    };
  }
  if (acao === 'criar_imagem') {
    const pedido = String(en.pedidoDaImagem ?? '').trim().replace(/[ \t]+/g, ' ');
    if (pedido.length < 20 || pedido.length > PEDIDO_DA_IMAGEM_MAX)
      return { erro: `Escreva o pedido da imagem completo (o que aparece, o texto exato, o estilo e as cores), de 20 a ${PEDIDO_DA_IMAGEM_MAX} letras.` };
    if (pareceDadoPessoal(pedido)) return { erro: 'O pedido da imagem não pode levar telefone, e-mail, CPF ou CNPJ. Tire isso e mande de novo.' };
    const proporcao = String(en.proporcao ?? '1:1') as ProporcaoDaImagem;
    if (!PROPORCOES_DA_IMAGEM.includes(proporcao)) return { erro: 'A proporção é 1:1 (feed), 9:16 (story ou cartaz vertical) ou 16:9 (horizontal).' };
    return { parametros: { acao, pedido, proporcao }, resumo: pedido };
  }
  if (acao === 'movimentar_estoque') {
    const item = String(en.item ?? '').trim().replace(/\s+/g, ' ');
    if (item.length < 2 || item.length > 80) return { erro: 'Diga o produto do estoque como ele aparece em Estoque › Produtos.' };
    const tipo = String(en.tipo ?? '') as TipoDoMovimento;
    if (!TIPOS_DO_MOVIMENTO.includes(tipo)) return { erro: 'O movimento é entrada, saida ou ajuste (o saldo que a pessoa contou).' };
    const motivo = typeof en.motivoDoMovimento === 'string' && en.motivoDoMovimento.trim() ? en.motivoDoMovimento.trim().replace(/\s+/g, ' ').slice(0, 120) : null;
    if (tipo === 'ajuste') {
      const saldoContado = numeroDoEstoque(en.saldoContado);
      if (saldoContado === null) return { erro: 'Para acertar o saldo, diga quanto foi contado (zero ou mais), na unidade do produto.' };
      return { parametros: { acao, item, tipo, quantidade: null, saldoContado, motivo }, resumo: `Acertar o saldo de "${item}" para ${quantidadeBr(saldoContado)}.` };
    }
    const quantidade = numeroDoEstoque(en.quantidade);
    if (quantidade === null || quantidade <= 0) return { erro: 'Diga a quantidade (maior que zero), na unidade do produto.' };
    return { parametros: { acao, item, tipo, quantidade, saldoContado: null, motivo }, resumo: `${tipo === 'entrada' ? 'Dar entrada de' : 'Dar saída de'} ${quantidadeBr(quantidade)} em "${item}".` };
  }
  const numero = String(en.numero ?? '').trim().replace(/^#/, '');
  if (!numero || numero.length > 40) return { erro: 'Diga o número do pedido como aparece no painel do Delivery.' };
  return { parametros: { acao, numero }, resumo: '' };
}

/** A situação que cada ação de pedido exige, e o que a pessoa vê quando o pedido está em outra. */
export function pedidoServe(acao: 'aceitar_pedido' | 'pedido_pronto' | 'despachar_pedido', p: { status: string; tipo: string | null }): string | null {
  if (p.status === 'cancelado') return 'Esse pedido está cancelado.';
  if (acao === 'aceitar_pedido') return p.status === 'novo' ? null : 'Esse pedido já foi aceito.';
  if (p.status === 'novo') return 'Esse pedido ainda não foi aceito: aceite antes.';
  if (acao === 'pedido_pronto') return p.status === 'confirmado' ? null : 'Esse pedido não está em preparo (já ficou pronto ou já saiu).';
  if (p.tipo === 'retirada') return 'Esse pedido é para retirar: ele não sai para entrega.';
  return p.status === 'confirmado' || p.status === 'pronto' ? null : 'Esse pedido já saiu para a entrega.';
}

/** O "o que vou fazer" das ações de pedido (o pedido como aparece no quadro do Delivery). */
export function resumoDoPedido(acao: 'aceitar_pedido' | 'pedido_pronto' | 'despachar_pedido', pedido: string): string {
  if (acao === 'aceitar_pedido') return `Aceitar o pedido ${pedido}.`;
  if (acao === 'pedido_pronto') return `Marcar o pedido ${pedido} como pronto.`;
  return `Despachar o pedido ${pedido} (saiu para a entrega).`;
}

/** A situação esperada depois de cada ação de pedido (a conferência do efeito). */
export function pedidoAndou(acao: 'aceitar_pedido' | 'pedido_pronto' | 'despachar_pedido', status: string): boolean {
  const depois: Record<string, string[]> = {
    aceitar_pedido: ['confirmado', 'pronto', 'despachado', 'entregue', 'concluido'],
    pedido_pronto: ['pronto', 'despachado', 'entregue', 'concluido'],
    despachar_pedido: ['despachado', 'entregue', 'concluido'],
  };
  return depois[acao].includes(status);
}

export const TEXTOS_DAS_ACOES = {
  pergunta: (resumo: string, prazo: number) => `${resumo}\n\nAutorizo? A pergunta vale por ${prazo} minutos.`,
  autorizada: 'Autorizado. Fazendo agora…',
  perguntaDaImagem: (pedido: string, prazo: number) => `Vou pedir assim:\n\n${pedido}\n\nGero assim? Usa 1 da franquia de imagens do mês. A pergunta vale por ${prazo} minutos.`,
  semPermissaoEstoque: 'O seu perfil no Regem não permite lançar no estoque: essa ação não sai por aqui. Quem muda o perfil é o presidente.',
  itemNaoAchado: 'Não achei esse produto no estoque. Diga o nome como aparece em Estoque › Produtos.',
  itensDemais: (nomes: string) => `Achei mais de um produto com esse nome: ${nomes}. Diga qual.`,
  estoquePedeLoja: 'Cada loja tem o próprio estoque: diga de qual loja é esse lançamento.',
  estoqueOutraUnidade: (item: string, unidade: string) => `"${item}" é controlado em ${unidade}. Diga a quantidade em ${unidade}.`,
  imagemDesligada: 'A criação de imagem ainda não está ligada nesta instalação.',
  imagemGerando: 'Gerando a imagem. Pode levar até um minuto, e ela chega aqui.',
  imagemMudar: 'Certo, não gerei. Me diga o que mudar no pedido.',
  semPermissao: 'O seu perfil no Regem não dá acesso ao Delivery: essa ação não sai por aqui. Quem muda o perfil é o presidente.',
  soGestor: 'Só o presidente e o gerente fazem ações pelo Mister.',
  semBotao: 'Pela conexão por QR Code a ação não tem o botão "Autorizar". Faça no Regem, no painel do Delivery.',
  naoAchado: 'Não achei esse pedido nas últimas 24 horas das suas lojas. Confira o número como aparece no painel do Delivery.',
  maisDeUm: 'Achei mais de um pedido com esse número. Diga o número como aparece no painel (com as letras, se tiver).',
  naoDisponivel: 'Esta pergunta não está mais disponível para você.',
  pausado: (canais: string) => `${canais} pausado(s) no Regem; o iFood e a 99 recebem a pausa em seguida.`,
  reaberto: (canais: string) => `${canais} reaberto(s).`,
  pedidoFeito: (acao: 'aceitar_pedido' | 'pedido_pronto' | 'despachar_pedido', pedido: string) =>
    acao === 'aceitar_pedido' ? `O pedido ${pedido} foi aceito.` : acao === 'pedido_pronto' ? `O pedido ${pedido} está pronto.` : `O pedido ${pedido} saiu para a entrega.`,
  naoAndou: (pedido: string, situacao: string) => `o pedido ${pedido} continua "${situacao}". Confira no painel do Delivery.`,
  recusado: (motivo: string) => `o Regem recusou: ${motivo.replace(/[.\s]+$/, '')}. Nada foi feito.`,
  // Lote 2.
  semPermissaoTarefas: 'O seu perfil no Regem não dá acesso às Tarefas: essa ação não sai por aqui. Quem muda o perfil é o presidente.',
  semPermissaoLoja: 'O seu perfil no Regem não dá acesso ao cadastro dos produtos: essa ação não sai por aqui. Quem muda o perfil é o presidente.',
  tarefaNaoAchada: 'Não achei essa tarefa na lista de hoje das suas lojas. Diga o título como aparece na lista de tarefas.',
  tarefasDemais: (titulos: string) => `Achei mais de uma tarefa de hoje com esse nome: ${titulos}. Diga qual.`,
  tarefaJaMarcada: (estado: string) => `Essa tarefa já está ${estado}.`,
  tarefaPedeFoto: 'Essa tarefa pede a foto de comprovação para ser marcada assim: marque pelo app ou pela tela de tarefas, com a foto.',
  tarefaFeita: (titulo: string, estado: string) => `A tarefa "${titulo}" ficou ${estado}.`,
  tarefaNaoFicou: (titulo: string, estado: string) => `a tarefa "${titulo}" continua ${estado}. Confira na lista de tarefas.`,
  produtoNaoAchado: 'Não achei esse produto no cardápio. Diga o nome como aparece no cardápio.',
  produtosDemais: (nomes: string) => `Achei mais de um produto com esse nome: ${nomes}. Diga qual.`,
  produtoFeito: (nome: string, pausado: boolean, onde: string) => `"${nome}" ${pausado ? 'pausado' : 'reativado'} ${onde}.`,
  produtoNaoFicou: (nome: string, onde: string) => `"${nome}" não ficou como pedido ${onde}. Confira no cardápio.`,
  // Lote 3.
  semPermissaoChecklist: 'O seu perfil no Regem não dá acesso aos checklists e tarefas: essa ação não sai por aqui. Quem muda o perfil é o presidente.',
  lojaDaTarefa: 'A empresa tem mais de uma loja: diga de qual loja é a tarefa.',
  funcaoNaoAchada: 'Não achei essa função no cadastro das funções. Diga o nome como está cadastrado.',
  funcoesDemais: (nomes: string) => `Achei mais de uma função com esse nome: ${nomes}. Diga qual.`,
  responsavelNaoAchado: 'Não achei essa pessoa entre os colaboradores ativos da loja. Diga o nome como está no cadastro, ou crie sem responsável.',
  responsaveisDemais: (nomes: string) => `Achei mais de uma pessoa com esse nome: ${nomes}. Diga qual.`,
  tarefaCriada: (titulo: string) => `A tarefa "${titulo}" foi criada para hoje.`,
  tarefaNaoCriada: (titulo: string) => `a tarefa "${titulo}" não apareceu na lista de hoje. Confira na lista de tarefas.`,
} as const;
