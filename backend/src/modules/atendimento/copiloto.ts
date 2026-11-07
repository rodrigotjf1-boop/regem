import { BadRequestException } from '@nestjs/common';
import { horaNoFuso } from '../../common/data';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O COPILOTO DO ATENDIMENTO (item 7 do checkpoint da Central, mig 376; protótipo `mockups/regem-central-atendimento.html`,
// versão 5) — as regras puras: o que a tela manda (as mensagens que ela mostra e as respostas prontas), o que sai da
// conversa antes de ir ao modelo (telefone, e-mail, CPF, número longo), o pedido ao modelo e a limpeza da sugestão. A
// sugestão só preenche a caixa de escrever: quem envia é a pessoa, pelo botão de sempre.

export const MAX_MENSAGENS = 30;
export const MAX_TEXTO = 1000;
export const MAX_PRONTAS = 10;
export const MAX_SUGESTAO = 700;
/** Quantas sugestões um caso pode pedir (o custo do modelo é da distribuição). */
export const VEZES_POR_CASO = 20;

export type QuemFalou = 'cliente' | 'loja' | 'robo' | 'sistema';
export type MensagemDoCaso = { de: QuemFalou; texto: string };
export type CanalDoCaso = 'whatsapp' | 'ifood' | '99food' | string | null;

const QUEM: QuemFalou[] = ['cliente', 'loja', 'robo', 'sistema'];
const umaLinha = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** O que a tela manda, conferido: até 30 mensagens (as mais novas) e até 10 respostas prontas, cada uma cortada. */
export function lerPedidoDeSugestao(dto: unknown): { mensagens: MensagemDoCaso[]; prontas: string[] } {
  const d = (dto ?? {}) as { mensagens?: unknown; prontas?: unknown };
  if (!Array.isArray(d.mensagens)) throw new BadRequestException('Mande as mensagens da conversa.');
  const mensagens = d.mensagens
    .map((m: any) => ({ de: (QUEM as string[]).includes(m?.de) ? (m.de as QuemFalou) : 'cliente', texto: umaLinha(m?.texto).slice(0, MAX_TEXTO) }))
    .filter((m) => m.texto)
    .slice(-MAX_MENSAGENS);
  if (!mensagens.some((m) => m.de === 'cliente')) throw new BadRequestException('Ainda não há mensagem do cliente para responder.');
  const prontas = (Array.isArray(d.prontas) ? d.prontas : [])
    .map((p) => umaLinha(p).slice(0, 300))
    .filter(Boolean)
    .slice(0, MAX_PRONTAS);
  return { mensagens, prontas };
}

/** O mínimo de dado ao modelo: telefone, e-mail, CPF e número longo (cartão, Pix) saem da conversa. */
export function mascarar(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[documento]')
    .replace(/\+?\(?\d[\d\s().-]{8,}\d/g, '[número]');
}

/** O que a plataforma proíbe no chat dela (a mesma régua do envio pela ponte — o Regem barra). */
export const PROIBIDO_NA_PLATAFORMA = /(https?:\/\/|www\.|\.com\b|wa\.me|whats|insta|@[a-z0-9_.]{3,}|\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4})/i;

const STATUS: Record<string, string> = {
  novo: 'novo (ainda não aceito)',
  confirmado: 'em produção',
  pronto: 'pronto',
  despachado: 'em rota de entrega',
  entregue: 'entregue',
  concluido: 'concluído',
  cancelado: 'cancelado',
};
const ONDE: Record<string, string> = { whatsapp: 'no WhatsApp', ifood: 'no chat do iFood', '99food': 'no chat da 99', instagram: 'no Direct do Instagram' };
const ROTULO_DE: Record<QuemFalou, string> = { cliente: 'Cliente', loja: 'Loja', robo: 'Robô da loja', sistema: 'Aviso' };

export type DadosDoPedido = {
  numero: string | null;
  status: string | null;
  tipo: string | null;
  itens: Array<{ nome: string; quantidade: number }>;
  criadoEm: Date | string | null;
  despachadoEm: Date | string | null;
  entregador: string | null;
} | null;

export type ContextoDaSugestao = {
  loja: string;
  canal: CanalDoCaso;
  tipoDoCaso: string;
  cliente: string | null;
  resumo: { motivo?: string | null; quer?: string | null; jaFez?: string | null } | null;
  pedido: DadosDoPedido;
  mensagens: MensagemDoCaso[];
  prontas: string[];
};

const primeiroNome = (n: string | null) => (umaLinha(n).split(' ')[0] || '').slice(0, 40);
const hora = (d: Date | string | null) => (d ? horaNoFuso(new Date(d)) : null);

/** As instruções e o conteúdo do pedido ao modelo. Nada além do necessário: o primeiro nome, a conversa e o pedido. */
export function montarPedido(c: ContextoDaSugestao): { system: string; conteudo: string } {
  const plataforma = c.canal === 'ifood' || c.canal === '99food';
  const system = [
    `Você escreve UMA sugestão de resposta para a equipe de atendimento da ${umaLinha(c.loja) || 'loja'} (restaurante com delivery) mandar ao cliente ${ONDE[String(c.canal)] ?? 'na conversa'}.`,
    'Regras:',
    '- Português do Brasil, tom cordial e direto, no máximo 3 frases curtas.',
    '- Trate o cliente pelo primeiro nome, se ele aparecer.',
    '- Use SÓ os fatos do pedido, do resumo e da conversa abaixo. Nunca invente prazo, valor, desconto, reembolso, troca ou promessa que não esteja nesses dados ou nas respostas prontas da loja. Se faltar a informação, diga que vai verificar e já responde.',
    '- Não peça dados pessoais (telefone, endereço, documento, cartão).',
    ...(plataforma ? ['- É o chat da plataforma: nunca escreva telefone, WhatsApp, Instagram, e-mail nem link.'] : []),
    '- Responda apenas com o texto da mensagem, sem aspas, sem título e sem explicação.',
  ].join('\n');
  const linhas: string[] = [];
  linhas.push(`Caso: ${umaLinha(c.tipoDoCaso) || 'atendimento'}.`);
  const nome = primeiroNome(c.cliente);
  if (nome) linhas.push(`Cliente: ${nome}.`);
  if (c.resumo && (c.resumo.motivo || c.resumo.quer || c.resumo.jaFez)) {
    linhas.push('Resumo do robô:');
    if (c.resumo.motivo) linhas.push(`- Motivo: ${mascarar(umaLinha(c.resumo.motivo))}`);
    if (c.resumo.quer) linhas.push(`- O cliente quer: ${mascarar(umaLinha(c.resumo.quer))}`);
    if (c.resumo.jaFez) linhas.push(`- O robô já fez: ${mascarar(umaLinha(c.resumo.jaFez))}`);
  }
  if (c.pedido) {
    const p = c.pedido;
    linhas.push(`Pedido${p.numero ? ` ${p.numero}` : ''}:`);
    if (p.status) linhas.push(`- Situação: ${STATUS[p.status] ?? p.status}${p.tipo === 'retirada' ? ' (retirada na loja)' : ''}.`);
    if (p.itens.length) linhas.push(`- Itens: ${p.itens.slice(0, 15).map((i) => `${i.quantidade}× ${i.nome}`).join(', ')}.`);
    if (p.criadoEm) linhas.push(`- Feito às ${hora(p.criadoEm)}.`);
    if (p.despachadoEm) linhas.push(`- Saiu para entrega às ${hora(p.despachadoEm)}${p.entregador ? ` com ${primeiroNome(p.entregador)}` : ''}.`);
  }
  if (c.prontas.length) {
    linhas.push('Respostas prontas da loja (o tom e o que a loja costuma oferecer):');
    for (const r of c.prontas) linhas.push(`- ${r}`);
  }
  linhas.push('Conversa, da mais antiga para a mais nova:');
  for (const m of c.mensagens) linhas.push(`${ROTULO_DE[m.de]}: ${mascarar(m.texto)}`);
  linhas.push('Escreva agora a próxima mensagem da loja.');
  return { system, conteudo: linhas.join('\n') };
}

/**
 * A sugestão pronta para a caixa de escrever: sem aspas em volta, uma mensagem só, até 700 letras. No chat da
 * plataforma, a que trouxer telefone, rede social ou link é descartada (`null`) — o envio barraria do mesmo jeito.
 */
export function limparSugestao(texto: unknown, canal: CanalDoCaso): string | null {
  let t = String(texto ?? '').trim();
  t = t.replace(/^["“”'«]+|["“”'»]+$/g, '').trim();
  t = t.replace(/^(sugest[aã]o( de resposta)?|resposta)\s*:\s*/i, '').trim();
  t = t.replace(/\n{3,}/g, '\n\n');
  if (!t) return null;
  if (t.length > MAX_SUGESTAO) t = `${t.slice(0, MAX_SUGESTAO - 1).trimEnd()}…`;
  if ((canal === 'ifood' || canal === '99food') && PROIBIDO_NA_PLATAFORMA.test(t)) return null;
  return t;
}
