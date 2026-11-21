import { BadRequestException } from '@nestjs/common';
import { exigirBooleano } from '../../common/exigir';
import { somarDias } from '../../common/data';

// CLUBE DE RECOMPRA — as regras puras (fase A0 do `docs/plano-clube-e-banner.md`; protótipo `mockups/regem-clube-banner.html`,
// parte "Marketing › Clube"; mig 471). Três ferramentas que ligam e desligam sozinhas — o prêmio surpresa (raspadinha ou
// roleta), o álbum de selos e a meta do mês — e o catálogo de prêmios. O prêmio vira CUPOM PESSOAL de desconto quando o
// cliente ganha (D3); nada aqui sorteia: todo mundo que cumpre a regra recebe, e a raspadinha e a roleta só revelam.

export const FORMAS_DO_SURPRESA = ['raspadinha', 'roleta'] as const;
export type FormaDoSurpresa = (typeof FORMAS_DO_SURPRESA)[number];
export const TIPOS_DE_PREMIO = ['percentual', 'valor', 'fretegratis', 'produto'] as const;
export type TipoDePremio = (typeof TIPOS_DE_PREMIO)[number];
export const VALIDADES_DO_PREMIO = [3, 7, 15, 30] as const;
export const SELOS = { min: 3, max: 12 } as const;
export const VALIDADES_DO_SELO = [6, 12] as const;
export const VALIDADES_DA_META = [15, 30] as const;
export const MINIMO_MAX = 1000;
export const NOME_MAX = 60;
export const NIVEIS_MAX = 3;
export const PREMIOS_POR_ESCOLHA_MAX = 6;

/**
 * As ferramentas que já existem para ligar. Cada fase acende a sua (A1: o prêmio surpresa; A2: o álbum; A3: a meta). O
 * servidor recusa ligar a que ainda não existe — a tela nem mostra o liga/desliga dela (nada de botão que não faz nada).
 */
export const FERRAMENTAS_PRONTAS: Readonly<Record<Ferramenta, boolean>> = { surpresa: true, album: true, meta: true };
export type Ferramenta = 'surpresa' | 'album' | 'meta';

/**
 * O gatilho "Pedido entregue" do prêmio surpresa (fase A1, mig 474): todo pedido do cardápio online ou do robô, concluído,
 * a partir do pedido mínimo do clube, dá ao cliente o prêmio escolhido. `desde` = quando foi ligado: só vale para os
 * pedidos concluídos DEPOIS (ligar não dá prêmio pelos pedidos de antes). Guardado em `clube_config.surpresa_gatilhos`
 * (a chave `entregue`; as outras fases gravam as suas — V82).
 */
export type GatilhoEntregue = { ativo: boolean; premioId: string | null; desde: string | null };
export const GATILHO_ENTREGUE_PADRAO: GatilhoEntregue = { ativo: false, premioId: null, desde: null };

/**
 * O gatilho "Depois de uma reclamação" (fase A1b, sem migration — a chave `reclamacao` do mesmo jsonb): a equipe manda um
 * prêmio de desculpas pelo caso do Atendimento, escolhendo entre os prêmios que o presidente liberou. É cortesia de
 * atendimento (não depende de compra nova): um por caso, com um limite por cliente, e só quem o presidente escolheu manda.
 */
export const LIMITES_DA_RECLAMACAO = {
  mes1: { rotulo: '1 por mês', dias: 30, maximo: 1 },
  mes2: { rotulo: '2 por mês', dias: 30, maximo: 2 },
  tri1: { rotulo: '1 a cada 3 meses', dias: 90, maximo: 1 },
} as const;
export type LimiteDaReclamacao = keyof typeof LIMITES_DA_RECLAMACAO;
export const QUEM_MANDA_DESCULPAS = {
  gerencia: { rotulo: 'Gerente e supervisão', perfis: ['presidente', 'gerente', 'supervisao'] },
  gerente: { rotulo: 'Só o gerente', perfis: ['presidente', 'gerente'] },
  atendimento: { rotulo: 'Qualquer pessoa do atendimento', perfis: ['presidente', 'gerente', 'supervisao', 'execucao'] },
} as const;
export type QuemMandaDesculpas = keyof typeof QUEM_MANDA_DESCULPAS;
export type GatilhoReclamacao = { ativo: boolean; premios: string[]; limite: LimiteDaReclamacao; quem: QuemMandaDesculpas };
export const GATILHO_RECLAMACAO_PADRAO: GatilhoReclamacao = { ativo: false, premios: [], limite: 'mes1', quem: 'gerencia' };

/**
 * O gatilho "Pela classificação do marketing" (fase A1c, sem migration — a chave `classificacao` do mesmo jsonb): TODOS os
 * clientes dos segmentos escolhidos (o perfil do cliente, pelas compras de cada um) ganham o prêmio, no máximo uma vez a
 * cada N dias. Ninguém é escolhido por sorte. O prêmio espera na conta do cliente (o aviso pelo WhatsApp sai pela campanha).
 * Só com o módulo "Perfil do cliente" ligado; quem pediu "não quero ser analisado" fica fora.
 */
export const SEGMENTOS_DA_CLASSIFICACAO = {
  campeoes: 'Campeões',
  leais: 'Leais',
  atencao: 'Precisam de atenção',
  em_risco: 'Em risco',
  inativos: 'Inativos',
  atrasado: 'Atrasados no próprio ritmo',
} as const;
export type SegmentoDaClassificacao = keyof typeof SEGMENTOS_DA_CLASSIFICACAO;
export const PERIODOS_DA_CLASSIFICACAO = [30, 60, 90] as const;
export type GatilhoClassificacao = { ativo: boolean; segmentos: SegmentoDaClassificacao[]; premioId: string | null; periodoDias: number };
export const GATILHO_CLASSIFICACAO_PADRAO: GatilhoClassificacao = { ativo: false, segmentos: [], premioId: null, periodoDias: 60 };

/**
 * O gatilho "Em disparo (campanha)" (fase A1d, mig 477 — a chave `campanha` do mesmo jsonb): ligado, a criação da campanha
 * oferece "🎁 Mandar um prêmio surpresa" com um prêmio da lista; TODOS os destinatários ganham (o direito nasce na hora de
 * mandar a cada um) e o link da campanha leva ao link pessoal do prêmio. Só para quem aceitou mensagens (a regra da
 * campanha de sempre).
 */
export type GatilhoCampanha = { ativo: boolean };
export const GATILHO_CAMPANHA_PADRAO: GatilhoCampanha = { ativo: false };

export type GatilhosDoSurpresa = {
  entregue: GatilhoEntregue;
  reclamacao: GatilhoReclamacao;
  classificacao: GatilhoClassificacao;
  campanha: GatilhoCampanha;
};

/** O que a tela mandou para o gatilho "Em disparo (campanha)" (V15/V16). */
export function lerGatilhoCampanha(dto: unknown): Partial<GatilhoCampanha> {
  const d = (dto !== null && typeof dto === 'object' ? dto : {}) as Record<string, unknown>;
  return d.ativo !== undefined ? { ativo: exigirBooleano(d.ativo, 'Em disparo (campanha)') } : {};
}

const ehSegmento = (x: unknown): x is SegmentoDaClassificacao => typeof x === 'string' && x in SEGMENTOS_DA_CLASSIFICACAO;

/** O que a tela mandou para o gatilho "Pela classificação do marketing" (V15/V16; cada escolha só entre as opções). */
export function lerGatilhoClassificacao(dto: unknown): Partial<GatilhoClassificacao> {
  const d = (dto !== null && typeof dto === 'object' ? dto : {}) as Record<string, unknown>;
  const p: Partial<GatilhoClassificacao> = {};
  if (d.ativo !== undefined) p.ativo = exigirBooleano(d.ativo, 'Pela classificação do marketing');
  if (d.segmentos !== undefined) {
    if (!Array.isArray(d.segmentos) || !d.segmentos.every(ehSegmento))
      throw new BadRequestException('Pela classificação do marketing: escolha os segmentos da lista.');
    p.segmentos = [...new Set(d.segmentos as SegmentoDaClassificacao[])];
  }
  if (d.premioId !== undefined) {
    if (d.premioId === null || d.premioId === '') p.premioId = null;
    else if (typeof d.premioId === 'string' && UUID_DO_PREMIO.test(d.premioId.trim())) p.premioId = d.premioId.trim().toLowerCase();
    else throw new BadRequestException('Pela classificação do marketing: escolha o prêmio da lista.');
  }
  if (d.periodoDias !== undefined) {
    if (!(PERIODOS_DA_CLASSIFICACAO as readonly number[]).includes(d.periodoDias as number))
      throw new BadRequestException('Pela classificação do marketing: escolha de quanto em quanto tempo da lista.');
    p.periodoDias = d.periodoDias as number;
  }
  return p;
}

/** Os gatilhos como estão gravados (o jsonb da linha), com os padrões no que faltar. */
export function gatilhosDaLinha(j: unknown): GatilhosDoSurpresa {
  const doJson = (k: string) => (j && typeof j === 'object' ? (j as Record<string, unknown>)[k] : null) as Record<string, unknown> | null;
  const e = doJson('entregue');
  const r = doJson('reclamacao');
  const cl = doJson('classificacao');
  const ca = doJson('campanha');
  const ids = Array.isArray(r?.premios) ? (r!.premios as unknown[]).filter((x): x is string => typeof x === 'string' && UUID_DO_PREMIO.test(x)) : [];
  return {
    entregue: {
      ativo: e?.ativo === true,
      premioId: typeof e?.premioId === 'string' && UUID_DO_PREMIO.test(e.premioId) ? e.premioId.toLowerCase() : null,
      desde: typeof e?.desde === 'string' && !Number.isNaN(Date.parse(e.desde)) ? e.desde : null,
    },
    reclamacao: {
      ativo: r?.ativo === true,
      premios: [...new Set(ids.map((x) => x.toLowerCase()))].slice(0, PREMIOS_POR_ESCOLHA_MAX),
      limite: typeof r?.limite === 'string' && r.limite in LIMITES_DA_RECLAMACAO ? (r.limite as LimiteDaReclamacao) : 'mes1',
      quem: typeof r?.quem === 'string' && r.quem in QUEM_MANDA_DESCULPAS ? (r.quem as QuemMandaDesculpas) : 'gerencia',
    },
    classificacao: {
      ativo: cl?.ativo === true,
      segmentos: Array.isArray(cl?.segmentos) ? [...new Set((cl!.segmentos as unknown[]).filter(ehSegmento))] : [],
      premioId: typeof cl?.premioId === 'string' && UUID_DO_PREMIO.test(cl.premioId) ? cl.premioId.toLowerCase() : null,
      periodoDias: (PERIODOS_DA_CLASSIFICACAO as readonly number[]).includes(cl?.periodoDias as number) ? Number(cl!.periodoDias) : 60,
    },
    campanha: { ativo: ca?.ativo === true },
  };
}

/** O que a tela mandou para o gatilho "Depois de uma reclamação" (V15/V16: ausente mantém; cada escolha só entre as opções). */
export function lerGatilhoReclamacao(dto: unknown): Partial<GatilhoReclamacao> {
  const d = (dto !== null && typeof dto === 'object' ? dto : {}) as Record<string, unknown>;
  const p: Partial<GatilhoReclamacao> = {};
  if (d.ativo !== undefined) p.ativo = exigirBooleano(d.ativo, 'Depois de uma reclamação');
  if (d.premios !== undefined) {
    if (!Array.isArray(d.premios) || d.premios.some((x) => typeof x !== 'string' || !UUID_DO_PREMIO.test(x)))
      throw new BadRequestException('Depois de uma reclamação: escolha os prêmios da lista.');
    const unicos = [...new Set((d.premios as string[]).map((x) => x.toLowerCase()))];
    if (unicos.length > PREMIOS_POR_ESCOLHA_MAX)
      throw new BadRequestException(`Depois de uma reclamação: no máximo ${PREMIOS_POR_ESCOLHA_MAX} prêmios para a equipe escolher.`);
    p.premios = unicos;
  }
  if (d.limite !== undefined) {
    if (typeof d.limite !== 'string' || !(d.limite in LIMITES_DA_RECLAMACAO))
      throw new BadRequestException('Depois de uma reclamação: escolha o limite por cliente da lista.');
    p.limite = d.limite as LimiteDaReclamacao;
  }
  if (d.quem !== undefined) {
    if (typeof d.quem !== 'string' || !(d.quem in QUEM_MANDA_DESCULPAS))
      throw new BadRequestException('Depois de uma reclamação: escolha quem pode mandar da lista.');
    p.quem = d.quem as QuemMandaDesculpas;
  }
  return p;
}

/** Quem pode mandar o prêmio de desculpas: o perfil está entre os que o presidente escolheu. */
export function podeMandarDesculpas(quem: QuemMandaDesculpas, perfil: unknown): boolean {
  return (QUEM_MANDA_DESCULPAS[quem].perfis as readonly string[]).includes(String(perfil ?? ''));
}

/** A mensagem do prêmio de desculpas, com o link para revelar (o texto da equipe, ou o padrão). */
export const MENSAGEM_DESCULPAS_PADRAO = 'Pedimos desculpas pelo transtorno. Para compensar, um prêmio surpresa no seu próximo pedido.';
export const MENSAGEM_DESCULPAS_MAX = 300;
export function mensagemDasDesculpas(texto: unknown, link: string): string {
  const t = typeof texto === 'string' ? texto.trim() : '';
  if (t.length > MENSAGEM_DESCULPAS_MAX) throw new BadRequestException(`A mensagem tem no máximo ${MENSAGEM_DESCULPAS_MAX} letras.`);
  return `${t || MENSAGEM_DESCULPAS_PADRAO}\n\n🎁 Toque para revelar o seu prêmio: ${link}`;
}

/** O que a tela mandou para o gatilho "Pedido entregue": liga/desliga só com booleano (V15), o prêmio da lista (V16). */
export function lerGatilhoEntregue(dto: unknown): { ativo?: boolean; premioId?: string | null } {
  const d = (dto !== null && typeof dto === 'object' ? dto : {}) as Record<string, unknown>;
  const p: { ativo?: boolean; premioId?: string | null } = {};
  if (d.ativo !== undefined) p.ativo = exigirBooleano(d.ativo, 'Pedido entregue');
  if (d.premioId !== undefined) {
    if (d.premioId === null || d.premioId === '') p.premioId = null;
    else if (typeof d.premioId === 'string' && UUID_DO_PREMIO.test(d.premioId.trim())) p.premioId = d.premioId.trim().toLowerCase();
    else throw new BadRequestException('Pedido entregue: escolha o prêmio da lista.');
  }
  return p;
}
const UUID_DO_PREMIO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NivelDaMeta = { pedidos: number; premios: string[] };
export type ConfigDoClube = {
  surpresaAtivo: boolean;
  surpresaForma: FormaDoSurpresa;
  albumAtivo: boolean;
  albumSelos: number;
  albumValidadeMeses: number;
  albumPremios: string[];
  metaAtivo: boolean;
  metaNiveis: NivelDaMeta[];
  metaValidadeDias: number;
  minimo: number;
};

/** Sem linha da empresa: tudo desligado, como o protótipo e a 471 (o presidente liga). */
export const CONFIG_PADRAO: ConfigDoClube = {
  surpresaAtivo: false,
  surpresaForma: 'raspadinha',
  albumAtivo: false,
  albumSelos: 4,
  albumValidadeMeses: 12,
  albumPremios: [],
  metaAtivo: false,
  metaNiveis: [
    { pedidos: 3, premios: [] },
    { pedidos: 6, premios: [] },
  ],
  metaValidadeDias: 15,
  minimo: 30,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inteiro = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) ? v : NaN);
const dinheiro = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN);

/** Uma lista de prêmios escolhidos (ids), sem repetir, até o limite. */
function lerListaDePremios(v: unknown, onde: string): string[] {
  if (!Array.isArray(v)) throw new BadRequestException(`${onde}: escolha os prêmios da lista.`);
  const ids = v.map((x) => (typeof x === 'string' ? x.trim().toLowerCase() : ''));
  if (ids.some((x) => !UUID.test(x))) throw new BadRequestException(`${onde}: um dos prêmios não é da lista.`);
  const unicos = Array.from(new Set(ids));
  if (unicos.length > PREMIOS_POR_ESCOLHA_MAX) throw new BadRequestException(`${onde}: no máximo ${PREMIOS_POR_ESCOLHA_MAX} prêmios.`);
  return unicos;
}

/**
 * O que a tela mandou para a configuração do clube, conferido. Pura: a rota confere ANTES de gravar (V86). Ausente fica
 * de fora (V16); liga/desliga só com booleano (V15); cada escolha só entre as opções. Os prêmios citados são conferidos
 * com o banco no serviço (que existem e são desta empresa).
 */
export function lerConfigDoClube(dto: unknown): Partial<ConfigDoClube> {
  const d = (dto !== null && typeof dto === 'object' ? dto : {}) as Record<string, unknown>;
  const p: Partial<ConfigDoClube> = {};
  if (d.surpresaAtivo !== undefined) p.surpresaAtivo = exigirBooleano(d.surpresaAtivo, 'Prêmio surpresa');
  if (d.albumAtivo !== undefined) p.albumAtivo = exigirBooleano(d.albumAtivo, 'Álbum de selos');
  if (d.metaAtivo !== undefined) p.metaAtivo = exigirBooleano(d.metaAtivo, 'Meta do mês');
  if (d.surpresaForma !== undefined) {
    if (!(FORMAS_DO_SURPRESA as readonly unknown[]).includes(d.surpresaForma))
      throw new BadRequestException('Como o cliente revela: escolha raspadinha ou roleta.');
    p.surpresaForma = d.surpresaForma as FormaDoSurpresa;
  }
  if (d.albumSelos !== undefined) {
    const n = inteiro(d.albumSelos);
    if (!(n >= SELOS.min && n <= SELOS.max)) throw new BadRequestException(`Selos para completar o álbum: de ${SELOS.min} a ${SELOS.max}.`);
    p.albumSelos = n;
  }
  if (d.albumValidadeMeses !== undefined) {
    if (!(VALIDADES_DO_SELO as readonly unknown[]).includes(d.albumValidadeMeses))
      throw new BadRequestException('Validade de cada selo: escolha 6 ou 12 meses.');
    p.albumValidadeMeses = d.albumValidadeMeses as number;
  }
  if (d.albumPremios !== undefined) p.albumPremios = lerListaDePremios(d.albumPremios, 'Prêmio de quem completa o álbum');
  if (d.metaValidadeDias !== undefined) {
    if (!(VALIDADES_DA_META as readonly unknown[]).includes(d.metaValidadeDias))
      throw new BadRequestException('Validade do prêmio da meta: escolha 15 ou 30 dias.');
    p.metaValidadeDias = d.metaValidadeDias as number;
  }
  if (d.metaNiveis !== undefined) {
    if (!Array.isArray(d.metaNiveis) || d.metaNiveis.length < 1 || d.metaNiveis.length > NIVEIS_MAX)
      throw new BadRequestException(`Meta do mês: de 1 a ${NIVEIS_MAX} níveis.`);
    const niveis = d.metaNiveis.map((x, i) => {
      const n = (x ?? {}) as Record<string, unknown>;
      const pedidos = inteiro(n.pedidos);
      if (!(pedidos >= 1 && pedidos <= 30)) throw new BadRequestException(`Meta do mês, nível ${i + 1}: de 1 a 30 pedidos.`);
      return { pedidos, premios: lerListaDePremios(n.premios ?? [], `Meta do mês, nível ${i + 1}`) };
    });
    for (let i = 1; i < niveis.length; i++)
      if (niveis[i].pedidos <= niveis[i - 1].pedidos)
        throw new BadRequestException('Meta do mês: cada nível pede mais pedidos que o anterior.');
    p.metaNiveis = niveis;
  }
  if (d.minimo !== undefined) {
    const v = dinheiro(d.minimo);
    if (!(v >= 0 && v <= MINIMO_MAX)) throw new BadRequestException(`Pedido mínimo para contar: de R$ 0 a R$ ${MINIMO_MAX}.`);
    p.minimo = v;
  }
  return p;
}

/** As ferramentas que este salvar tenta LIGAR e que ainda não existem — o serviço recusa. */
export function ligandoAntesDaHora(p: Partial<ConfigDoClube>, prontas: Readonly<Record<Ferramenta, boolean>> = FERRAMENTAS_PRONTAS): Ferramenta[] {
  const fora: Ferramenta[] = [];
  if (p.surpresaAtivo === true && !prontas.surpresa) fora.push('surpresa');
  if (p.albumAtivo === true && !prontas.album) fora.push('album');
  if (p.metaAtivo === true && !prontas.meta) fora.push('meta');
  return fora;
}

/** Os prêmios citados na configuração (para conferir que existem e para o "em uso"). */
export function premiosCitados(c: Pick<ConfigDoClube, 'albumPremios' | 'metaNiveis'>): string[] {
  return Array.from(new Set([...c.albumPremios, ...c.metaNiveis.flatMap((n) => n.premios)]));
}

/** Onde cada prêmio está em uso (o selo "Em uso" da lista e a recusa ao excluir). `gatilhos`: os do prêmio surpresa. */
export function ondeEstaEmUso(c: Pick<ConfigDoClube, 'albumPremios' | 'metaNiveis'>, premioId: string, gatilhos?: GatilhosDoSurpresa): string[] {
  const onde: string[] = [];
  if (gatilhos?.entregue.premioId === premioId) onde.push('Prêmio surpresa · pedido entregue');
  if (gatilhos?.reclamacao.premios.includes(premioId)) onde.push('Prêmio surpresa · reclamação');
  if (gatilhos?.classificacao.premioId === premioId) onde.push('Prêmio surpresa · classificação');
  if (c.albumPremios.includes(premioId)) onde.push('Álbum de selos');
  c.metaNiveis.forEach((n, i) => {
    if (n.premios.includes(premioId)) onde.push(`Meta do mês, nível ${i + 1}`);
  });
  return onde;
}

export type DadosDoPremio = {
  nome: string;
  tipo: TipoDePremio;
  valor: number;
  teto: number | null;
  produtoId: string | null;
  minimo: number;
  validadeDias: number;
};

/**
 * O prêmio que a tela mandou, conferido (inteiro — criar e editar mandam tudo). Os mesmos limites do `check` da 471: o
 * desconto em % de 1 a 100 (teto opcional), em R$ maior que zero, o frete grátis sem valor, o produto grátis com o produto.
 * O produto é conferido com o banco no serviço (da empresa e ativo).
 */
export function lerPremio(dto: unknown): DadosDoPremio {
  const d = (dto !== null && typeof dto === 'object' ? dto : {}) as Record<string, unknown>;
  const nome = typeof d.nome === 'string' ? d.nome.trim().replace(/\s+/g, ' ') : '';
  if (!nome) throw new BadRequestException('Escreva o nome que o cliente vê.');
  if (nome.length > NOME_MAX) throw new BadRequestException(`O nome do prêmio tem no máximo ${NOME_MAX} letras.`);
  if (!(TIPOS_DE_PREMIO as readonly unknown[]).includes(d.tipo))
    throw new BadRequestException('Tipo do prêmio: desconto em %, desconto em R$, frete grátis ou produto grátis.');
  const tipo = d.tipo as TipoDePremio;
  let valor = 0;
  let teto: number | null = null;
  let produtoId: string | null = null;
  if (tipo === 'percentual') {
    valor = dinheiro(d.valor);
    if (!(valor >= 1 && valor <= 100)) throw new BadRequestException('Desconto em %: de 1 a 100.');
    if (d.teto !== undefined && d.teto !== null && d.teto !== '') {
      teto = dinheiro(d.teto);
      if (!(teto > 0 && teto <= MINIMO_MAX)) throw new BadRequestException(`Teto do desconto: de R$ 0,01 a R$ ${MINIMO_MAX}, ou vazio.`);
    }
  } else if (tipo === 'valor') {
    valor = dinheiro(d.valor);
    if (!(valor > 0 && valor <= MINIMO_MAX)) throw new BadRequestException(`Desconto em R$: de R$ 0,01 a R$ ${MINIMO_MAX}.`);
  } else if (tipo === 'produto') {
    produtoId = typeof d.produtoId === 'string' ? d.produtoId.trim().toLowerCase() : '';
    if (!UUID.test(produtoId)) throw new BadRequestException('Escolha o produto grátis.');
  }
  const minimo = d.minimo === undefined || d.minimo === null || d.minimo === '' ? 0 : dinheiro(d.minimo);
  if (!(minimo >= 0 && minimo <= MINIMO_MAX)) throw new BadRequestException(`Pedido mínimo para usar: de R$ 0 a R$ ${MINIMO_MAX}.`);
  if (!(VALIDADES_DO_PREMIO as readonly unknown[]).includes(d.validadeDias))
    throw new BadRequestException('Validade do prêmio: escolha 3, 7, 15 ou 30 dias.');
  return { nome, tipo, valor, teto, produtoId, minimo, validadeDias: d.validadeDias as number };
}

const reais = (v: number) => {
  const t = v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
  return t.endsWith(',00') ? t.slice(0, -3) : t;
};

/** "15% de desconto, até R$ 20 · em pedido a partir de R$ 30 · vale 7 dias" — a linha da lista e das regras do clube. */
export function descricaoDoPremio(p: Pick<DadosDoPremio, 'tipo' | 'valor' | 'teto' | 'minimo' | 'validadeDias'> & { produtoNome?: string | null }): string {
  const base =
    p.tipo === 'percentual'
      ? `${p.valor}% de desconto${p.teto ? `, até ${reais(p.teto)}` : ''}`
      : p.tipo === 'valor'
        ? `${reais(p.valor)} de desconto`
        : p.tipo === 'fretegratis'
          ? 'entrega grátis'
          : `${p.produtoNome || 'um produto'} grátis`;
  const minimo = p.minimo > 0 ? ` · em pedido a partir de ${reais(p.minimo)}` : '';
  return `${base}${minimo} · vale ${p.validadeDias} dias`;
}

// ───────────────────────── O álbum de selos (fase A2, mig 479) ─────────────────────────

const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
/** A arte padrão do selo de cada mês (a do evento do mês, quando a loja liga o evento, chega depois). */
const ARTE_DO_MES = ['🎆', '🎭', '🍃', '🐰', '💐', '🌽', '❄️', '👔', '🌸', '🎃', '🍔', '🎄'];

export type SeloDoAlbum = { mes: string; rotulo: string; arte: string };
export type EstadoDoAlbum = { selos: SeloDoAlbum[]; tem: number; total: number; completo: boolean };

/** "2026-11" → { mes, rotulo: "Nov", arte: "🍔" }. */
export function seloDoMes(mes: string): SeloDoAlbum {
  const i = Number(mes.slice(5, 7)) - 1;
  return { mes, rotulo: MESES_CURTOS[i] ?? mes, arte: ARTE_DO_MES[i] ?? '⭐' };
}
/** "2026-11" → "novembro". */
export const mesPorExtenso = (mes: string) => MESES_LONGOS[Number(mes.slice(5, 7)) - 1] ?? mes;

/**
 * O álbum do cliente a partir dos meses com pedido que contam (já filtrados: depois de ligar, dentro da validade e depois
 * da última troca): um selo por mês, sem repetir, até o total; completo quando junta o total.
 */
export function estadoDoAlbum(meses: string[], total: number): EstadoDoAlbum {
  const unicos = [...new Set(meses)].sort().slice(0, total);
  return { selos: unicos.map(seloDoMes), tem: unicos.length, total, completo: unicos.length >= total };
}

// ───────────────────────── A meta do mês (fase A3, mig 479 `meta_desde`) ─────────────────────────

/** Até que dia do mês seguinte o cliente ainda escolhe o prêmio da meta que bateu no mês anterior. */
export const DIA_LIMITE_DO_MES_ANTERIOR = 7;

export type NivelNoMes = { nivel: number; pedidos: number; falta: number; atingido: boolean; escolhido: boolean };
export type EstadoDaMeta = {
  /** AAAA-MM (relógio da operação). */
  mes: string;
  /** "novembro". */
  mesNome: string;
  /** Pedidos do mês que contam. */
  pedidos: number;
  niveis: NivelNoMes[];
  /** O próximo nível a bater (nulo = bateu todos). */
  proximo: { nivel: number; pedidos: number; falta: number } | null;
  /** Bateu um nível e ainda não escolheu o prêmio dele. */
  pendente: boolean;
};

/** "2026-01" → "2025-12". */
export function mesAnterior(mes: string): string {
  const a = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * A meta de um mês a partir dos pedidos que contam (já filtrados: do Regem, a partir do mínimo, entregues, depois de
 * ligar) e dos níveis cujo prêmio o cliente já escolheu. Cada nível dá UM prêmio por mês; bater o 2º não tira o do 1º.
 */
export function estadoDaMeta(mes: string, pedidos: number, niveis: NivelDaMeta[], escolhidos: number[]): EstadoDaMeta {
  const lista = niveis.map((n, i) => {
    const nivel = i + 1;
    const atingido = pedidos >= n.pedidos;
    return { nivel, pedidos: n.pedidos, falta: Math.max(0, n.pedidos - pedidos), atingido, escolhido: atingido && escolhidos.includes(nivel) };
  });
  const prox = lista.find((n) => !n.atingido);
  return {
    mes,
    mesNome: mesPorExtenso(mes),
    pedidos,
    niveis: lista,
    proximo: prox ? { nivel: prox.nivel, pedidos: prox.pedidos, falta: prox.falta } : null,
    pendente: lista.some((n) => n.atingido && !n.escolhido),
  };
}

/** Os meses em que o cliente ainda escolhe: o atual e, até o dia 7, o anterior. `hoje` = AAAA-MM-DD da operação. */
export function mesesQueEscolhem(hoje: string): string[] {
  const mes = hoje.slice(0, 7);
  return Number(hoje.slice(8, 10)) <= DIA_LIMITE_DO_MES_ANTERIOR ? [mes, mesAnterior(mes)] : [mes];
}

// ───────────────────────── Os resultados do clube (fase A4) ─────────────────────────

export const PERIODOS_DOS_RESULTADOS = { mes: 'Este mês', mes_passado: 'Mês passado', '90d': 'Últimos 90 dias' } as const;
export type PeriodoDosResultados = keyof typeof PERIODOS_DOS_RESULTADOS;
/** Quantos dias depois da mensagem um pedido conta como "voltou" (o cartão das campanhas com prêmio). */
export const DIAS_PARA_VOLTAR = 15;

/**
 * O período dos resultados no relógio da operação (`hoje` = AAAA-MM-DD): o início e o fim (para `noPeriodo`) e o título.
 * O período que não existe vira "Este mês".
 */
export function periodoDosResultados(periodo: unknown, hoje: string): { periodo: PeriodoDosResultados; de: string; ate: string; titulo: string } {
  const p: PeriodoDosResultados = typeof periodo === 'string' && periodo in PERIODOS_DOS_RESULTADOS ? (periodo as PeriodoDosResultados) : 'mes';
  const inicioDoMes = `${hoje.slice(0, 7)}-01`;
  const titulo = (mes: string) => {
    const nome = mesPorExtenso(mes);
    return nome.charAt(0).toUpperCase() + nome.slice(1);
  };
  if (p === 'mes_passado') {
    const fim = somarDias(inicioDoMes, -1);
    return { periodo: p, de: `${fim.slice(0, 7)}-01 00:00:00`, ate: `${fim} 23:59:59`, titulo: titulo(fim.slice(0, 7)) };
  }
  if (p === '90d') return { periodo: p, de: `${somarDias(hoje, -89)} 00:00:00`, ate: `${hoje} 23:59:59`, titulo: 'Últimos 90 dias' };
  return { periodo: p, de: `${inicioDoMes} 00:00:00`, ate: `${hoje} 23:59:59`, titulo: titulo(hoje.slice(0, 7)) };
}

/**
 * As regras do clube que o cliente lê (o link "Regras do clube" de cada tela do jogo; "Ver as regras" na loja): só as
 * ferramentas ligadas, e sempre as travas que mantêm o clube fora da regra de sorteio (Lei 5.768/1971 — o plano, seção 1).
 */
export function regrasDoClube(c: ConfigDoClube, nomeDoPremio: (id: string) => string | null, gatilhos?: GatilhosDoSurpresa): string[] {
  const linhas: string[] = [];
  const lista = (ids: string[]) => ids.map(nomeDoPremio).filter((x): x is string => !!x).join(', ');
  const minimo = c.minimo > 0 ? ` a partir de ${reais(c.minimo)}` : '';
  if (c.surpresaAtivo) {
    const como = c.surpresaForma === 'roleta' ? 'uma roleta' : 'uma raspadinha';
    if (gatilhos?.entregue.ativo && gatilhos.entregue.premioId) {
      const premio = nomeDoPremio(gatilhos.entregue.premioId);
      linhas.push(`Prêmio surpresa: todo pedido entregue pelo cardápio online ou pelo WhatsApp${minimo} dá ${como}${premio ? ` com o prêmio "${premio}"` : ''}.`);
    }
    if (gatilhos?.reclamacao.ativo && gatilhos.reclamacao.premios.length) {
      const limite = LIMITES_DA_RECLAMACAO[gatilhos.reclamacao.limite].rotulo;
      linhas.push(`Prêmio de desculpas: depois de uma reclamação, a equipe pode mandar ${como} com um prêmio da lista da loja (no máximo ${limite} por cliente).`);
    }
    const cl = gatilhos?.classificacao;
    if (cl?.ativo && cl.premioId && cl.segmentos.length) {
      const grupos = cl.segmentos.map((s) => SEGMENTOS_DA_CLASSIFICACAO[s]).join(', ');
      const premio = nomeDoPremio(cl.premioId);
      linhas.push(
        `Prêmio pela classificação: todos os clientes dos grupos ${grupos} (pelas compras de cada um) ganham ${como}${premio ? ` com o prêmio "${premio}"` : ''}, no máximo 1 vez a cada ${cl.periodoDias} dias.`,
      );
    }
    if (gatilhos?.campanha.ativo)
      linhas.push(`Prêmio na campanha: a campanha da loja com prêmio surpresa dá ${como} a todos os que a recebem (só quem aceitou mensagens da loja).`);
    linhas.push(
      `O prêmio já vem definido pela regra quando o cliente ganha: a ${c.surpresaForma === 'roleta' ? 'roleta' : 'raspadinha'} só mostra.`,
    );
  }
  if (c.albumAtivo) {
    const premios = lista(c.albumPremios);
    linhas.push(
      `Álbum de selos: um selo por mês com pedido${minimo}; com ${c.albumSelos} selos, escolha um prêmio${premios ? ` (${premios})` : ''}. Os selos valem ${c.albumValidadeMeses} meses e não precisam ser seguidos.`,
    );
  }
  if (c.metaAtivo)
    for (const [i, n] of c.metaNiveis.entries()) {
      const premios = lista(n.premios);
      linhas.push(`Meta do mês${c.metaNiveis.length > 1 ? `, nível ${i + 1}` : ''}: ${n.pedidos} pedidos no mês${minimo} dão direito a escolher um prêmio${premios ? ` (${premios})` : ''}; vale ${c.metaValidadeDias} dias.`);
    }
  linhas.push('Não há sorteio: todo mundo que cumpre a regra recebe, e não há limite de prêmios.');
  linhas.push('Um benefício por pedido: o prêmio não junta com outro cupom.');
  linhas.push('Os prêmios valem só no cardápio online e no WhatsApp da loja, não no iFood nem na 99.');
  return linhas;
}
