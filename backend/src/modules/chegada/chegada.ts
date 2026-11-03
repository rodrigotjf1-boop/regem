import { BadRequestException } from '@nestjs/common';
import { exigirBooleano } from '../../common/exigir';

// "CHEGUEI" NA RETIRADA (Onda 3; mig 354; protótipo `mockups/regem-relacionamento.html` aprovado em 03/11/2026).
// O que conta como "cheguei" no WhatsApp, o que o cliente pode mandar e os textos de resposta — sem banco, testável.

export const ONDES = ['balcao', 'porta'] as const;
export type Onde = (typeof ONDES)[number];
export type Origem = 'cardapio' | 'whatsapp';

/** "Como te achar?" — o que cabe no cartão da equipe. */
export const OBS_MAX = 80;
/** "Avisar de novo se ninguém entregar em" (e o "avisar de novo" do cliente): as opções do protótipo. */
export const MINUTOS_DE_NOVO = [3, 5, 10] as const;

export type AjusteCheguei = { ativo: boolean; perguntarOnde: boolean; todasTelas: boolean; deNovoMin: number };
/** Nasce DESLIGADO (regra de implementar em cima do que existe); o resto, como o protótipo. */
export const AJUSTE_CHEGUEI_PADRAO: AjusteCheguei = { ativo: false, perguntarOnde: true, todasTelas: true, deNovoMin: 5 };

/** Status em que o pedido de retirada ainda espera o cliente (o "Cheguei" vale até o pedido sair). */
export const STATUS_ESPERANDO = ['novo', 'confirmado', 'pronto'] as const;

/**
 * O que a tela mandou para o grupo "Retirada · cliente chegou", conferido (V16: ausente fica de fora; V15: liga/desliga
 * só com booleano). Pura — a rota confere ANTES de gravar qualquer grupo dos ajustes do atendimento.
 */
export function lerAjusteCheguei(dto: unknown): Partial<AjusteCheguei> {
  const d = (dto ?? {}) as Record<string, unknown>;
  const parcial: Partial<AjusteCheguei> = {};
  if (d.ativo !== undefined) parcial.ativo = exigirBooleano(d.ativo, 'ativo');
  if (d.perguntarOnde !== undefined) parcial.perguntarOnde = exigirBooleano(d.perguntarOnde, 'perguntarOnde');
  if (d.todasTelas !== undefined) parcial.todasTelas = exigirBooleano(d.todasTelas, 'todasTelas');
  if (d.deNovoMin !== undefined) {
    const m = typeof d.deNovoMin === 'number' ? d.deNovoMin : NaN;
    if (!(MINUTOS_DE_NOVO as readonly number[]).includes(m))
      throw new BadRequestException('Avisar de novo: escolha 3, 5 ou 10 minutos.');
    parcial.deNovoMin = m;
  }
  return parcial;
}

/** A linha de `cardapio_config` como ajuste (sem linha: o padrão; valor torto no banco: o padrão daquele campo). */
export function ajusteDaLinha(row: any): AjusteCheguei {
  if (!row) return { ...AJUSTE_CHEGUEI_PADRAO };
  const min = Number(row.chegueiDeNovoMin ?? row.cheguei_de_novo_min);
  return {
    ativo: (row.chegueiAtivo ?? row.cheguei_ativo) === true,
    perguntarOnde: (row.chegueiPerguntarOnde ?? row.cheguei_perguntar_onde) !== false,
    todasTelas: (row.chegueiTodasTelas ?? row.cheguei_todas_telas) !== false,
    deNovoMin: (MINUTOS_DE_NOVO as readonly number[]).includes(min) ? min : AJUSTE_CHEGUEI_PADRAO.deNovoMin,
  };
}

/** "Onde você está?": vazio = não disse; fora da lista é recusado (a tela só manda as duas opções). */
export function lerOnde(v: unknown): Onde | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'string' && (ONDES as readonly string[]).includes(v)) return v as Onde;
  throw new BadRequestException('Onde você está: no balcão ou na porta.');
}

/** "Como te achar?": texto curto, numa linha, sem caractere de controle. Vazio = nada. */
export function limparObs(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, OBS_MAX)
    .trim();
  return t || null;
}

/** Para comparar: minúsculas, sem acento, só letras e números, espaços simples. */
export function normalizar(t: unknown): string {
  return String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// As frases que ABREM a mensagem de quem chegou (comparadas já normalizadas). Começo da mensagem, não "contém": quem
// escreve "o motoboy disse que cheguei…" está em outra conversa. E só vale com pedido de RETIRADA esperando o cliente
// hoje (o serviço confere) — a palavra tem de ser inequívoca no canal (ERR-317).
const ABERTURAS = [
  'ja cheguei', 'cheguei', 'ja chegamos', 'chegamos',
  'ja to aqui', 'ja tou aqui', 'ja estou aqui', 'to aqui', 'tou aqui', 'estou aqui', 'estamos aqui',
  'to na porta', 'tou na porta', 'estou na porta', 'estamos na porta',
  'to na loja', 'tou na loja', 'estou na loja', 'estamos na loja',
  'to no balcao', 'estou no balcao', 'to la fora', 'estou la fora', 'to ai fora', 'estou ai fora',
  'to em frente', 'estou em frente', 'to na frente', 'estou na frente',
].sort((a, b) => b.length - a.length); // a mais longa primeiro ("ja cheguei" antes de "cheguei")

/** Mensagem longa não é "cheguei": é conversa (vai ao robô ou à equipe, como sempre). */
export const MENSAGEM_MAX = 80;

/**
 * A mensagem é um "cheguei"? Devolve o resto (o que o cliente escreveu depois — "tô de moto vermelha"), que vai para a
 * equipe. `cheguei em casa…` não é chegada à loja.
 */
export function lerCheguei(texto: unknown): { ok: boolean; resto: string } {
  const bruto = String(texto ?? '').trim();
  const n = normalizar(bruto);
  if (!n || bruto.length > MENSAGEM_MAX) return { ok: false, resto: '' };
  const abertura = ABERTURAS.find((a) => n === a || n.startsWith(`${a} `));
  if (!abertura) return { ok: false, resto: '' };
  const restoNormal = n.slice(abertura.length).trim();
  if (/(^| )(em|na|de|a) casa( |$)/.test(restoNormal) || /^casa( |$)/.test(restoNormal)) return { ok: false, resto: '' };
  // O resto no texto original (com acento e maiúscula): pula as palavras da abertura.
  let palavras = abertura.split(' ').length;
  const tokens = bruto.split(/\s+/);
  let i = 0;
  while (i < tokens.length && palavras > 0) {
    palavras -= normalizar(tokens[i]).split(' ').filter(Boolean).length;
    i += 1;
  }
  const resto = (palavras <= 0 ? tokens.slice(i).join(' ') : '').replace(/^[\s,.;:!?\-–—]+/, '').trim();
  return { ok: true, resto: limparObs(resto) ?? '' };
}

export type Situacao = 'novo' | 'de_novo' | 'ja_avisado';

/** O primeiro nome, para a resposta ("Avisamos a equipe, Marina!"). */
export function primeiroNome(nome: unknown): string {
  return String(nome ?? '').trim().split(/\s+/)[0] ?? '';
}

/** A resposta ao cliente no WhatsApp (a página do pedido mostra o equivalente). */
export function textoDaResposta(p: {
  situacao: Situacao;
  nome?: string | null;
  numero?: string | null;
  pronto: boolean;
  hora?: string | null;
}): string {
  const nome = primeiroNome(p.nome);
  const vNome = nome ? `, ${nome}` : '';
  const num = p.numero ? ` #${p.numero}` : '';
  if (p.situacao === 'ja_avisado')
    return `A equipe já sabe que você chegou${p.hora ? ` (às ${p.hora})` : ''}${vNome}. Já, já te atendem. 🙏`;
  if (p.situacao === 'de_novo')
    return p.pronto
      ? `Avisamos a equipe de novo${vNome}. Seu pedido${num} está pronto no balcão.`
      : `Avisamos a equipe de novo${vNome}. Seu pedido${num} ainda está em preparo.`;
  return p.pronto
    ? `Avisamos a equipe${vNome}! 🙋 Seu pedido${num} está no balcão: diga o seu nome${p.numero ? ` ou o número ${p.numero}` : ''}.`
    : `Avisamos a cozinha que você chegou${vNome}! Seu pedido${num} ainda está em preparo.`;
}
