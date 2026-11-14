import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { CATALOGO_PERMISSOES } from '../../auth/permissoes';
import { MODULOS } from '../modulo/modulo.service';
import { MisterFerramentasService } from './mister-ferramentas.service';
import {
  GUIA_DE_USO,
  PONTOS_MINIMOS,
  SECOES_POR_RESPOSTA,
  SecaoDoGuia,
  buscarNoGuia,
  mesmaPalavra,
  palavrasDoTexto,
  pontosDaSecao,
  quemAbre,
} from './mister-guia-de-uso';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ───────────────────────────── o menu de verdade (shell.tsx) ─────────────────────────────

interface ItemDoMenu {
  caminho: string[];
  href: string;
  tambem: string[];
  perm: string | null;
  soPres: boolean;
  modulo: string | null;
}

const FRONT = join(__dirname, '../../../../frontend/src');

/** As linhas do `NAV` do Shell: grupo (linha com `label` sem `href`) e itens (`href` + `label`; 2 espaços = 1º nível). */
function menuDoShell(): ItemDoMenu[] {
  const texto = readFileSync(join(FRONT, 'components/app-shell/shell.tsx'), 'utf8');
  const ini = texto.indexOf('const NAV: NavNode[] = [');
  const fim = texto.indexOf('\n];', ini);
  expect(ini).toBeGreaterThan(0);
  expect(fim).toBeGreaterThan(ini);
  const itens: ItemDoMenu[] = [];
  let grupo: string | null = null;
  for (const l of texto.slice(ini, fim).split('\n')) {
    const href = /href: '([^']+)'/.exec(l);
    const label = /label: '([^']+)'/.exec(l);
    if (label && !href) {
      grupo = label[1];
      continue;
    }
    if (!href || !label) continue;
    const primeiroNivel = /^ {2}\{/.test(l);
    if (primeiroNivel) grupo = null;
    itens.push({
      caminho: primeiroNivel || !grupo ? [label[1]] : [grupo, label[1]],
      href: href[1],
      tambem: [...(/tambem: \[([^\]]*)\]/.exec(l)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]),
      perm: /perm: '([^']+)'/.exec(l)?.[1] ?? null,
      soPres: /soPres: true/.test(l),
      modulo: /modulo: '([^']+)'/.exec(l)?.[1] ?? null,
    });
  }
  return itens;
}

/** Todo o código do frontend (sem testes), num texto só, para achar os nomes de botão como estão escritos. */
function codigoDoFront(): string {
  const partes: string[] = [];
  const andar = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      const cheio = join(dir, nome);
      if (statSync(cheio).isDirectory()) andar(cheio);
      else if (/\.(tsx?|jsx?)$/.test(nome) && !/\.(spec|test)\./.test(nome)) partes.push(readFileSync(cheio, 'utf8'));
    }
  };
  andar(FRONT);
  return partes.join('\n');
}

const textoDaSecao = (s: SecaoDoGuia) => [s.titulo, ...s.passos, ...(s.notas ?? [])].join('\n');
const citados = (s: SecaoDoGuia) => [...[...s.passos, ...(s.notas ?? [])].join('\n').matchAll(/"([^"]+)"/g)].map((m) => m[1]);

describe('Mister — o guia de uso confere com o menu e as telas de verdade (V65, ERR-269)', () => {
  const menu = menuDoShell();
  const front = codigoDoFront();

  it('o leitor do menu acha o menu inteiro (senão as conferências abaixo não valem nada)', () => {
    expect(menu.length).toBeGreaterThan(40);
    expect(menu).toContainEqual(expect.objectContaining({ caminho: ['Delivery', 'Painel'], href: '/delivery', perm: 'delivery' }));
    expect(menu).toContainEqual(expect.objectContaining({ caminho: ['Estoque'], href: '/operacao', perm: 'estoque' }));
    expect(menu).toContainEqual(expect.objectContaining({ caminho: ['Configurações', 'Loja'], soPres: true }));
    expect(menu).toContainEqual(expect.objectContaining({ caminho: ['Mister'], href: '/mister', perm: null, modulo: 'mister' }));
  });

  it('o guia tem conteúdo, com ids únicos', () => {
    expect(GUIA_DE_USO.length).toBeGreaterThanOrEqual(20);
    const ids = GUIA_DE_USO.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(GUIA_DE_USO.map((s) => [s.id, s] as const))('%s: o caminho e a rota são uma linha do menu, com a mesma permissão', (_id, s) => {
    const linha = menu.find((m) => m.caminho.join(' › ') === s.caminho.join(' › '));
    expect(linha).toBeDefined();
    expect([linha!.href, ...linha!.tambem]).toContain(s.rota);
    expect(s.perm).toBe(linha!.perm);
    expect(!!s.soPresidente).toBe(linha!.soPres);
    expect(s.modulo ?? null).toBe(linha!.modulo);
  });

  it.each(GUIA_DE_USO.map((s) => [s.id, s] as const))('%s: cada nome de botão citado existe no frontend, escrito igual', (_id, s) => {
    expect(s.botoes.length).toBeGreaterThan(0);
    const falta = s.botoes.filter((b) => !front.includes(b));
    expect(falta).toEqual([]);
  });

  it.each(GUIA_DE_USO.map((s) => [s.id, s] as const))('%s: o que está entre aspas nos passos é exatamente a lista conferida', (_id, s) => {
    expect([...new Set(citados(s))].sort()).toEqual([...new Set(s.botoes)].sort());
  });

  it.each(GUIA_DE_USO.map((s) => [s.id, s] as const))('%s: curto, com palavras de busca, sem valor em reais e sem endereço', (_id, s) => {
    expect(s.palavras.length).toBeGreaterThanOrEqual(2);
    expect(s.passos.length).toBeGreaterThanOrEqual(1);
    expect(s.passos.length).toBeLessThanOrEqual(7);
    const texto = textoDaSecao(s);
    // O filtro de saída do Mister tira link e confere todo valor em reais contra as consultas: nada disso no guia.
    expect(texto).not.toMatch(/R\$|https?:|www\./i);
    // Caminho de outra tela só pelo `veja` (que aponta para uma seção conferida), nunca escrito à mão nos passos.
    expect([...s.passos, ...(s.notas ?? [])].join('\n')).not.toContain('›');
    for (const id of s.veja ?? []) {
      expect(id).not.toBe(s.id);
      expect(GUIA_DE_USO.some((x) => x.id === id)).toBe(true);
    }
    for (const p of s.passos) expect(p.length).toBeLessThanOrEqual(260);
  });

  it('a permissão e o módulo citados existem nos catálogos (o nome que a tela de acessos e a Visão C&O mostram)', () => {
    for (const s of GUIA_DE_USO) {
      if (s.perm) expect(CATALOGO_PERMISSOES.some((p) => p.chave === s.perm)).toBe(true);
      if (s.modulo) expect(MODULOS.some((m) => m.chave === s.modulo)).toBe(true);
    }
  });

  it('a resposta mais longa possível cabe (3 seções, poucos milhares de caracteres)', () => {
    const tamanhos = GUIA_DE_USO.map((s) => JSON.stringify({ ...s, quemAbre: quemAbre(s) }).length).sort((a, b) => b - a);
    expect(tamanhos.slice(0, SECOES_POR_RESPOSTA).reduce((a, b) => a + b, 0)).toBeLessThan(6000);
  });
});

// ───────────────────────────── a busca ─────────────────────────────

describe('Mister — a busca no guia', () => {
  const s = (id: string, titulo: string, palavras: string[], passos: string[] = ['Abra a tela.']): SecaoDoGuia => ({
    id,
    titulo,
    caminho: ['X'],
    rota: '/x',
    perm: null,
    palavras,
    passos,
    botoes: [],
  });
  const guia = [
    s('pausa', 'Pausar os pedidos de um canal', ['pausar', 'pausa', 'fechar a loja', 'ifood', '99']),
    s('preco', 'Mudar o preço de um produto num canal', ['preço', 'ifood', 'valor']),
    s('entregador', 'Cadastrar um entregador', ['entregador', 'motoboy']),
  ];

  it('tira acento, maiúscula e as palavras que não dizem o assunto', () => {
    expect(palavrasDoTexto('Como faço para PAUSAR o iFood?')).toEqual(['pausar', 'ifood']);
    expect(palavrasDoTexto('onde fica a tela de preço')).toEqual(['preco']);
  });

  it('a mesma palavra em outra forma (pauso · pausa · pausar · pausado) conta; palavra parecida, não', () => {
    expect(mesmaPalavra('pausa', 'pausado')).toBe(true);
    expect(mesmaPalavra('pauso', 'pausar')).toBe(true);
    expect(mesmaPalavra('pausei', 'pausa')).toBe(true);
    expect(mesmaPalavra('ligo', 'ligar')).toBe(true);
    expect(mesmaPalavra('cadastrar', 'cadastro')).toBe(true);
    expect(mesmaPalavra('caixa', 'caixas')).toBe(true);
    expect(mesmaPalavra('cancelar', 'cancelamento')).toBe(true);
    expect(mesmaPalavra('entregadores', 'entregador')).toBe(true);
    expect(mesmaPalavra('cai', 'caixa')).toBe(false);
    expect(mesmaPalavra('preco', 'prato')).toBe(false);
    expect(mesmaPalavra('estoque', 'estorno')).toBe(false);
    expect(mesmaPalavra('contagem', 'conta')).toBe(false);
    expect(mesmaPalavra('produto', 'producao')).toBe(false);
  });

  it('a melhor seção vem primeiro; a que só esbarrou numa palavra fica de fora', () => {
    expect(buscarNoGuia('como pauso o ifood', guia).map((x) => x.id)).toEqual(['pausa']);
    expect(buscarNoGuia('quero mudar o preço no ifood', guia).map((x) => x.id)[0]).toBe('preco');
    expect(buscarNoGuia('cadastrar motoboy novo', guia).map((x) => x.id)).toEqual(['entregador']);
  });

  it('assunto vazio, só palavras vazias ou fora do guia: nada', () => {
    expect(buscarNoGuia('', guia)).toEqual([]);
    expect(buscarNoGuia('como faço isso?', guia)).toEqual([]);
    expect(buscarNoGuia('qual a previsão do tempo amanhã', guia)).toEqual([]);
    expect(pontosDaSecao(guia[0], 'previsão do tempo')).toBeLessThan(PONTOS_MINIMOS);
  });

  it('nunca mais de 3 seções', () => {
    const muitas = Array.from({ length: 6 }, (_, i) => s(`c${i}`, 'Caixa', ['caixa']));
    expect(buscarNoGuia('caixa', muitas)).toHaveLength(SECOES_POR_RESPOSTA);
  });
});

describe('Mister — perguntas reais contra o guia de verdade', () => {
  // [como a pessoa escreve, a seção que tem de vir primeiro]
  const casos: [string, string][] = [
    ['como pauso o ifood?', 'pausar-canal'],
    ['quero fechar a loja por 30 minutos que tá cheio', 'pausar-canal'],
    ['como mudo o preço do x-burguer no ifood', 'preco-no-canal'],
    ['acabou o bacon, como tiro o produto do ar', 'pausar-produto'],
    ['como cadastro um motoboy novo', 'cadastrar-entregador'],
    ['onde pago os entregadores', 'pagamento-entregador'],
    ['como abro o caixa', 'abrir-caixa'],
    ['como fecho o caixa no fim do dia', 'fechar-caixa'],
    ['como faço uma sangria', 'sangria'],
    ['como crio um cupom de desconto', 'cupom-desconto'],
    ['como mudo a taxa de entrega do bairro', 'taxa-e-area'],
    ['qual o horário de funcionamento, como mudo', 'horario'],
    ['como ligo o ifood no regem', 'ligar-ifood-99'],
    ['o whatsapp da loja desconectou, como conecto de novo', 'whatsapp-da-loja'],
    ['como ligo meu whatsapp ao mister', 'mister-ligar-whatsapp'],
    ['onde coloco a chave de ia', 'mister-chave-de-ia'],
    ['como ligo o resumo do dia', 'mister-resumo-e-avisos'],
    ['como cadastro um funcionário novo', 'cadastrar-colaborador'],
    ['como cadastro um produto novo no cardápio com adicional', 'produto-do-cardapio'],
    ['como faço a contagem do estoque', 'contagem'],
    ['como registro um desperdício', 'desperdicio'],
    ['como imprimo etiqueta de validade', 'etiqueta-de-validade'],
    ['chegou mercadoria do fornecedor, como dou entrada', 'compra-e-recebimento'],
    ['como monto a escala da semana', 'escala'],
    ['como adiciono uma impressora nova', 'adicionar-impressora'],
    ['a via do delivery está saindo na impressora errada', 'onde-cada-documento-sai'],
    ['como mudo a ordem das estações da cozinha', 'rota-da-cozinha'],
    ['o produto não aparece no kds da chapa', 'produtos-do-kds'],
    ['como mudo o tempo do amarelo no kds', 'cores-do-kds'],
    ['como libero o gerente para ver o financeiro', 'permissoes-do-perfil'],
    ['como bloqueio o acesso de um funcionário que saiu', 'acesso-da-pessoa'],
    ['como cancelo uma nota fiscal', 'nota-fiscal'],
    ['onde coloco o certificado digital', 'configurar-nota'],
    ['como reimprimo uma venda do balcão', 'reimprimir-cancelar-venda'],
    ['como vejo se o caixa de ontem bateu', 'ver-turno'],
    ['onde vejo o relatório de vendas do mês', 'relatorios-de-vendas'],
    ['quem cancelou item da mesa', 'cancelamentos-de-itens'],
    ['como vejo quem alterou o preço', 'auditoria'],
    ['como pego um caso no atendimento', 'atendimento'],
    ['como cancelo um pedido do delivery', 'cancelar-pedido'],
    ['como despacho o pedido para o motoboy', 'aceitar-avancar'],
    ['como mudo o tempo de preparo', 'tempo-de-preparo'],
    ['como pauso o robô numa conversa', 'conversas-whatsapp'],
    ['como confiro se os preços do ifood batem', 'conferir-apps'],
  ];
  it.each(casos)('"%s" → %s', (pergunta, esperada) => {
    expect(buscarNoGuia(pergunta).map((x) => x.id)[0]).toBe(esperada);
  });
  // Perguntas escritas DEPOIS do ajuste da busca e medidas sem mexer nela (14/11/2026): a certa veio em 1º em 10 de 16 e
  // entre as 3 devolvidas em 15 de 16 (a que não achou — "tamanho grande e pequeno no açaí" — ficou de fora: o Mister
  // consulta de novo pelos assuntos que o guia devolve). Ficam como guarda das 3 primeiras.
  const avulsas: [string, string][] = [
    ['tem como deixar o delivery fechado até amanhã?', 'pausar-canal'],
    ['como troco o valor do refrigerante na 99', 'preco-no-canal'],
    ['onde vejo o fechamento do caixa da maria', 'ver-turno'],
    ['preciso dar acesso pro gerente que entrou', 'acesso-da-pessoa'],
    ['a impressora da cozinha não está imprimindo', 'adicionar-impressora'],
    ['como faço o inventário do mês', 'contagem'],
    ['como dou baixa no que estragou', 'desperdicio'],
    ['como aceito os pedidos que chegam', 'aceitar-avancar'],
    ['como mudo o raio de entrega', 'taxa-e-area'],
    ['como conecto a 99', 'ligar-ifood-99'],
    ['como coloco frete grátis', 'tempo-de-entrega'],
    ['como cancelo uma venda do pdv', 'reimprimir-cancelar-venda'],
    ['como gero etiqueta', 'etiqueta-de-validade'],
    ['como faço o pedido de compra pro fornecedor', 'compra-e-recebimento'],
    ['como troco a senha de um funcionário', 'cadastrar-colaborador'],
  ];
  it.each(avulsas)('"%s" traz %s entre as 3', (pergunta, esperada) => {
    expect(buscarNoGuia(pergunta).map((x) => x.id)).toContain(esperada);
  });
  it('toda seção do guia é achada por pelo menos uma pergunta pelo próprio título', () => {
    for (const s of GUIA_DE_USO) expect(buscarNoGuia(s.titulo).map((x) => x.id)).toContain(s.id);
  });
});

// ───────────────────────────── a consulta do Mister ─────────────────────────────

describe('Mister — a consulta "como usar o Regem"', () => {
  // A consulta não usa banco nem serviço: o objeto sem construtor basta (a régua `pode` é do próprio serviço).
  const ferramentas = Object.create(MisterFerramentasService.prototype) as MisterFerramentasService;
  const escopo = (nivel: 'presidente' | 'gerente', permissoes: any = {}, semLoja = false): any => ({
    tenantId: 't',
    colaboradorId: 'c',
    empresa: 'Empresa',
    nome: 'Ana',
    nivel,
    lojas: [],
    lojaUnica: true,
    presa: null,
    semLoja,
    permissoes,
    verValores: true,
  });

  it('sem assunto, recusa e diz o que falta', async () => {
    const r = await ferramentas.executar(escopo('presidente'), 'como_usar_o_regem', {});
    expect(r.ok).toBe(false);
  });

  it('fora do guia: devolve os assuntos que o guia tem', async () => {
    for (const assunto of ['previsão do tempo amanhã', 'receita de bolo de chocolate']) {
      const r = await ferramentas.executar(escopo('presidente'), 'como_usar_o_regem', { assunto });
      expect(r).toEqual({ ok: true, dados: { encontrado: false, assunto, assuntosDoGuia: GUIA_DE_USO.map((x) => x.titulo) } });
    }
  });

  it('responde também a quem está sem loja (o guia não lê dado de loja)', async () => {
    const r = await ferramentas.executar(escopo('gerente', {}, true), 'como_usar_o_regem', { assunto: GUIA_DE_USO[0].titulo });
    expect(r.ok).toBe(true);
    expect((r.dados as any).encontrado).toBe(true);
  });

  it('o gerente sem a permissão da tela fica sabendo que não abre; o presidente abre tudo; tela só do presidente, nunca o gerente', async () => {
    const comPerm = GUIA_DE_USO.find((x) => x.perm && !x.soPresidente)!;
    const soPres = GUIA_DE_USO.find((x) => x.soPresidente);
    const sem = await ferramentas.executar(escopo('gerente', { [comPerm.perm!]: false }), 'como_usar_o_regem', { assunto: comPerm.titulo });
    const secaoSem = (sem.dados as any).secoes.find((x: any) => x.assunto === comPerm.titulo);
    expect(secaoSem.estaPessoaAbre).toBe(false);
    expect(secaoSem.ondeFica).toBe(comPerm.caminho.join(' › '));
    const com = await ferramentas.executar(escopo('gerente', { [comPerm.perm!]: true }), 'como_usar_o_regem', { assunto: comPerm.titulo });
    expect((com.dados as any).secoes.find((x: any) => x.assunto === comPerm.titulo).estaPessoaAbre).toBe(true);
    const pres = await ferramentas.executar(escopo('presidente'), 'como_usar_o_regem', { assunto: comPerm.titulo });
    expect((pres.dados as any).secoes.find((x: any) => x.assunto === comPerm.titulo).estaPessoaAbre).toBe(true);
    if (soPres) {
      const ger = await ferramentas.executar(escopo('gerente', { [soPres.perm!]: true }), 'como_usar_o_regem', { assunto: soPres.titulo });
      expect((ger.dados as any).secoes.find((x: any) => x.assunto === soPres.titulo).estaPessoaAbre).toBe(false);
    }
  });

  it('quem abre sai com o nome da permissão da tela de acessos e o do módulo', () => {
    const comModulo = GUIA_DE_USO.find((x) => x.modulo);
    const comPerm = GUIA_DE_USO.find((x) => x.perm && !x.soPresidente)!;
    expect(quemAbre(comPerm)).toContain(CATALOGO_PERMISSOES.find((p) => p.chave === comPerm.perm)!.rotulo);
    if (comModulo) expect(quemAbre(comModulo)).toContain(MODULOS.find((m) => m.chave === comModulo.modulo)!.label);
  });
});
