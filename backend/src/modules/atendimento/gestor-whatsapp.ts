import { randomInt } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { horaNoFuso } from '../../common/data';

// GERENTE NO WHATSAPP (item 5 do checkpoint da Central, mig 375; protótipo `mockups/regem-central-atendimento.html`,
// versão 4) — as regras puras: o código de ligar, as palavras que o gestor manda, os textos dos avisos e o ajuste.
// O serviço (`gestor-whatsapp.service.ts`) envia; a entrada (`gestor-whatsapp-entrada.ts`) trata o que o gestor responde.

/** Quanto vale o código de ligar (e uma vez só). */
export const CODIGO_VALE_MIN = 10;

/** Os casos que pedem uma DECISÃO (os mesmos que só gerente e presidente respondem, mais o cancelamento do cardápio). */
export const TIPOS_DE_DECISAO = ['disputa', 'cancelamento_99', 'reembolso_99', 'cancelamento'] as const;

/** Quem liga o WhatsApp e recebe: gerente e presidente (a regra da disputa e da 99 — decisão do dono de 01/11/2026). */
export const NIVEIS_DO_GESTOR_WA = ['presidente', 'gerente'] as const;

/** O modelo da API oficial para fora da janela de 24 h, e o botão dele (o toque manda o texto inteiro). */
export const MODELO_DO_GESTOR = 'aviso_ao_gestor';
export const BOTAO_DO_MODELO = 'Ver por aqui';

/** O que vale dentro da janela de 24 h da API oficial: a margem de 30 min evita mandar texto que a Meta já recusa. */
export const JANELA_HORAS = 23.5;

/** `limiteCentavos` = "Aceitar pelo WhatsApp até" (parte 5b): `null` = sem limite; 0 = não aceitar pelo WhatsApp. */
export type AjusteGestorWa = { ligado: boolean; decisoes: boolean; ninguemPegou: boolean; limiteCentavos: number | null };
export const AJUSTE_GESTOR_WA_PADRAO: AjusteGestorWa = { ligado: false, decisoes: true, ninguemPegou: true, limiteCentavos: 10000 };
/** As escolhas da lista "Aceitar pelo WhatsApp até" (a mesma regra da coluna, mig 375). */
export const LIMITES_DO_GESTOR_WA = [0, 3000, 5000, 10000, 20000] as const;

const ROTULO_DO_CANAL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  cardapio: 'Cardápio',
  anotaai: 'Anota AI',
  ifood: 'iFood',
  '99food': '99Food',
};
// Os mesmos rótulos da fila (`frontend/src/lib/atendimento.ts`, ROTULO_DO_TIPO).
const ROTULO_DO_TIPO: Record<string, string> = {
  mudanca: 'Mudança no pedido',
  erro: 'Problema no pedido',
  humano: 'Quer falar com alguém',
  cancelamento: 'Pedido de cancelamento',
  outro: 'Atendimento',
  disputa: 'Disputa',
  avaliacao: 'Avaliação',
  cancelamento_99: 'Cancelamento pedido à 99',
  reembolso_99: 'Reembolso pedido à 99',
  chat: 'Mensagem no chat',
  atendimento: 'Atendimento',
};
// O que o iFood faz sozinho se ninguém responder — as frases da tela (`disputa-ifood.tsx`, SOZINHO).
const IFOOD_SOZINHO: Record<string, string> = {
  ACCEPT_CANCELLATION: 'o iFood aceita sozinho: cancela e o cliente recebe o valor de volta.',
  REJECT_CANCELLATION: 'o iFood recusa sozinho o pedido do cliente.',
  VOID: 'nada acontece sozinho, mas a loja perde a chance de responder.',
};

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const umaLinha = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const cortar = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);
const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** "REGEM 482913" (com ou sem espaço, maiúscula ou não, com o negrito do WhatsApp) → "482913". */
export function lerCodigoDeLigar(texto: unknown): string | null {
  const m = /^\s*\*?regem\*?\s*[:-]?\s*(\d{6})\s*[.!]?\s*$/i.exec(String(texto ?? ''));
  return m ? m[1] : null;
}

/** "PARAR AVISOS" — "PARAR" sozinho continua sendo o pedido para sair das ofertas (opt-out de marketing). */
export function ehPararAvisos(texto: unknown): boolean {
  return /^\s*parar\s+(os\s+)?avisos\s*[.!]?\s*$/i.test(String(texto ?? ''));
}

export function ehVoltarAvisos(texto: unknown): boolean {
  return /^\s*voltar\s+(os\s+)?avisos\s*[.!]?\s*$/i.test(String(texto ?? ''));
}

/** O toque no botão do modelo (chega como o texto do botão). */
export function ehVerPorAqui(texto: unknown): boolean {
  return semAcento(umaLinha(texto)).toLowerCase() === semAcento(BOTAO_DO_MODELO).toLowerCase();
}

export function novoCodigo(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Os 4 últimos dígitos — o que a tela mostra do número de alguém. */
export function finalDoNumero(telefone: unknown): string {
  return soDigitos(telefone).slice(-4);
}

/** O endereço do Regem na nuvem (o link do caso). */
function baseDoApp(): string {
  return String(process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '');
}

/** O caso aberto na tela Atendimento (a tela abre o caso pelo `?caso=`, como o sino). */
export function linkDoCaso(id: string): string {
  return `${baseDoApp()}/atendimento?caso=${encodeURIComponent(id)}`;
}

/** O link que abre o WhatsApp do celular com a mensagem pronta para a loja (o "clique para conversar"). */
export function linkParaLigar(numeroDaLoja: string, codigo: string): string {
  return `https://wa.me/${soDigitos(numeroDaLoja)}?text=${encodeURIComponent(`REGEM ${codigo}`)}`;
}

export type CasoDoAviso = {
  id: string;
  tipo: string;
  canal: string | null;
  cliente: string | null;
  pedidoNumero: string | null;
  mensagem: string | null;
  prazoEm: Date | string | null;
  criadoEm: Date | string;
  detalhe: any;
};

const hora = (d: Date | string | null) => (d ? horaNoFuso(new Date(d)) : '');
const doPedido = (c: CasoDoAviso) => (c.pedidoNumero ? ` · pedido ${c.pedidoNumero}` : '');
const citacao = (t: unknown) => {
  const s = cortar(umaLinha(t), 160);
  return s ? `"${s}"` : '';
};

/** O que o cliente escreveu, de onde cada plataforma manda. */
function oQueDisse(c: CasoDoAviso): string {
  if (c.tipo === 'cancelamento_99' || c.tipo === 'reembolso_99') return citacao(c.detalhe?.pedido99?.motivoDoCliente ?? c.mensagem);
  if (c.tipo === 'disputa') return citacao(c.mensagem ?? c.detalhe?.disputa?.mensagem);
  return citacao(c.mensagem);
}

/** O prazo e o que acontece sozinho, com as mesmas frases da tela (V39). */
function linhaDoPrazo(c: CasoDoAviso): string {
  if (!c.prazoEm) return '';
  const h = hora(c.prazoEm);
  if (c.tipo === 'disputa')
    return `⏱ Se ninguém responder até ${h}, ${IFOOD_SOZINHO[String(c.detalhe?.disputa?.acaoAutomatica ?? '')] ?? 'o iFood decide sozinho.'}`;
  if (c.tipo === 'cancelamento_99') return `⏱ Se ninguém responder até ${h}, a 99 recusa sozinha.`;
  if (c.tipo === 'reembolso_99')
    return c.detalhe?.semMotivoParaRecusar
      ? `⏱ Se ninguém responder até ${h}, a 99 reembolsa sozinha.`
      : `⏱ Se ninguém responder até ${h}, o Regem recusa com o motivo do ajuste.`;
  return `⏱ Responda até ${h}.`;
}

function titulo(c: CasoDoAviso): string {
  if (c.tipo === 'disputa') return `⚖️ *Disputa do iFood${doPedido(c)}*`;
  if (c.tipo === 'cancelamento_99') return `*99Food · cancelamento${doPedido(c)}*`;
  if (c.tipo === 'reembolso_99') return `*99Food · reembolso${doPedido(c)}*`;
  return `*Cancelamento pedido no cardápio${doPedido(c)}*`;
}

function quemPediu(c: CasoDoAviso): string {
  const nome = umaLinha(c.cliente) || 'O cliente';
  const disse = oQueDisse(c);
  if (c.tipo === 'disputa') return disse ? `${nome} diz: ${disse}` : `${nome} abriu uma disputa.`;
  if (c.tipo === 'cancelamento_99') return disse ? `${nome} pediu para cancelar: ${disse}` : `${nome} pediu para cancelar.`;
  if (c.tipo === 'reembolso_99') return disse ? `${nome} pediu o reembolso: ${disse}` : `${nome} pediu o reembolso.`;
  return disse ? `${nome} pediu para cancelar: ${disse}` : `${nome} pediu para cancelar.`;
}

/** Minutos desde que o caso abriu (o "esperando há"). */
function minutosDesde(d: Date | string, agora: Date): number {
  return Math.max(0, Math.floor((agora.getTime() - new Date(d).getTime()) / 60_000));
}

/**
 * O texto que vai ao WhatsApp do gestor (dentro da janela de 24 h ou depois do "Ver por aqui"). `comBotoes`: a decisão vai
 * com os botões (parte 5b) — o link fica de reserva.
 */
export function textoDoAviso(c: CasoDoAviso, tipo: 'decisao' | 'ninguem_pegou', agora: Date = new Date(), comBotoes = false): string {
  if (tipo === 'ninguem_pegou') {
    const partes = [
      umaLinha(c.cliente) || 'Cliente',
      ROTULO_DO_CANAL[String(c.canal ?? '')] ?? null,
      c.pedidoNumero ? `pedido ${c.pedidoNumero}` : null,
      ROTULO_DO_TIPO[c.tipo] ?? 'Atendimento',
    ].filter(Boolean);
    return [
      '🔔 *Ninguém pegou um caso*',
      `${partes.join(' · ')}. Esperando há ${minutosDesde(c.criadoEm, agora)} min.`,
      `Abrir no Regem: ${linkDoCaso(c.id)}`,
    ].join('\n');
  }
  const link = comBotoes ? `Responda aqui ou no Regem: ${linkDoCaso(c.id)}` : `Para responder, abra no Regem: ${linkDoCaso(c.id)}`;
  return [titulo(c), quemPediu(c), linhaDoPrazo(c), link]
    .filter(Boolean)
    .join('\n');
}

/** A variável do modelo "Atendimento" (uma linha só — a Meta não aceita quebra de linha na variável). */
export function resumoDoModelo(c: CasoDoAviso, tipo: 'decisao' | 'ninguem_pegou', agora: Date = new Date()): string {
  const ate = c.prazoEm ? `, responder até ${hora(c.prazoEm)}` : '';
  const num = c.pedidoNumero ? ` no pedido ${c.pedidoNumero}` : '';
  let t: string;
  if (tipo === 'ninguem_pegou') t = `um caso de ${umaLinha(c.cliente) || 'cliente'} espera há ${minutosDesde(c.criadoEm, agora)} min sem ninguém`;
  else if (c.tipo === 'disputa') t = `disputa do iFood${num}${ate}`;
  else if (c.tipo === 'cancelamento_99') t = `pedido de cancelamento na 99${num}${ate}`;
  else if (c.tipo === 'reembolso_99') t = `pedido de reembolso na 99${num}${ate}`;
  else t = `pedido de cancelamento pelo cardápio${num}${ate}`;
  return cortar(umaLinha(t), 200);
}

/** A resposta ao gestor que acabou de ligar o WhatsApp. */
export function textoDeLigado(nome: string, loja: string): string {
  const primeiro = umaLinha(nome).split(' ')[0] || 'tudo certo';
  return [
    `Pronto, ${primeiro}! Este WhatsApp está ligado a você no Regem da ${umaLinha(loja) || 'loja'}.`,
    '',
    'Daqui chegam as decisões do atendimento com prazo, para responder com um toque, e o caso que ninguém pegou.',
    '',
    'Para parar estes avisos, responda PARAR AVISOS.',
  ].join('\n');
}

/** O ajuste do grupo "Gerente no WhatsApp", conferido (V15: liga/desliga só com booleano — nunca `!!dto.campo`). */
export function lerAjusteGestorWa(dto: unknown): Partial<AjusteGestorWa> {
  const d = (dto ?? {}) as Record<string, unknown>;
  const parcial: Partial<AjusteGestorWa> = {};
  for (const k of ['ligado', 'decisoes', 'ninguemPegou'] as const) {
    if (d[k] === undefined) continue;
    if (typeof d[k] !== 'boolean') throw new BadRequestException('Gerente no WhatsApp: escolha ligado ou desligado.');
    parcial[k] = d[k] as boolean;
  }
  if (d.limiteCentavos !== undefined) {
    const v = d.limiteCentavos;
    if (v !== null && !(typeof v === 'number' && (LIMITES_DO_GESTOR_WA as readonly number[]).includes(v)))
      throw new BadRequestException('Aceitar pelo WhatsApp até: escolha um valor da lista.');
    parcial.limiteCentavos = v as number | null;
  }
  return parcial;
}
