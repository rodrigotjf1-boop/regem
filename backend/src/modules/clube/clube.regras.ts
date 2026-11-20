import { BadRequestException } from '@nestjs/common';
import { exigirBooleano } from '../../common/exigir';

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
export const FERRAMENTAS_PRONTAS: Readonly<Record<Ferramenta, boolean>> = { surpresa: false, album: false, meta: false };
export type Ferramenta = 'surpresa' | 'album' | 'meta';

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

/** Onde cada prêmio está em uso (o selo "Em uso" da lista e a recusa ao excluir). */
export function ondeEstaEmUso(c: Pick<ConfigDoClube, 'albumPremios' | 'metaNiveis'>, premioId: string): string[] {
  const onde: string[] = [];
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

/**
 * As regras do clube que o cliente lê (o link "Regras do clube" de cada tela do jogo; "Ver as regras" na loja): só as
 * ferramentas ligadas, e sempre as travas que mantêm o clube fora da regra de sorteio (Lei 5.768/1971 — o plano, seção 1).
 */
export function regrasDoClube(c: ConfigDoClube, nomeDoPremio: (id: string) => string | null): string[] {
  const linhas: string[] = [];
  const lista = (ids: string[]) => ids.map(nomeDoPremio).filter((x): x is string => !!x).join(', ');
  const minimo = c.minimo > 0 ? ` a partir de ${reais(c.minimo)}` : '';
  if (c.surpresaAtivo)
    linhas.push(
      `Prêmio surpresa: quem ganha o direito ${c.surpresaForma === 'roleta' ? 'gira a roleta' : 'raspa a raspadinha'} e vê o prêmio, que já vem definido pela regra — a ${c.surpresaForma === 'roleta' ? 'roleta' : 'raspadinha'} só mostra.`,
    );
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
