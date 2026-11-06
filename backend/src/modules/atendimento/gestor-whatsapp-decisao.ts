import { MOTIVOS_DE_RECUSA_IFOOD } from './disputa-ifood.service';
import type { CasoDoAviso } from './gestor-whatsapp';

/* eslint-disable @typescript-eslint/no-explicit-any */

// GERENTE NO WHATSAPP — A DECISÃO POR BOTÃO (parte 5b; protótipo `mockups/regem-central-atendimento.html`, versão 4,
// celulares 2 a 4). Regras puras: os passos de cada decisão, as opções de cada passo, o valor do que devolve dinheiro e
// o limite. O serviço manda e executa; aqui só se decide o que perguntar e o que a resposta quer dizer.
//  • Os passos: AÇÃO (Aceitar · R$ X / Recusar) → MOTIVO (só quando a plataforma exige um da lista dela) → INSUMOS (só no
//    aceite do cancelamento do cardápio: reutilizados ou perda, como no painel) → CONFIRMAR (Confirmar / Voltar). A
//    escolha fica gravada no aviso (`escolha`) até a confirmação — como a senha no computador e o PIN no app.
//  • O botão leva o VALOR da opção (aceitar, recusar, o código do motivo), nunca a posição: se o limite mudar entre o
//    envio e o toque, um "Aceitar" velho não vira "Recusar" — ele simplesmente não está mais entre as opções.
//  • O LIMITE vale só para aceitar (o que devolve dinheiro). Sem valor conhecido, conta como acima do limite (a não ser
//    "sem limite"). Recusar não tem limite.

export type Acao = 'aceitar' | 'recusar';
export type Rascunho = { acao?: Acao; motivo?: string; reaproveitado?: boolean };
export type Passo = 'acao' | 'motivo' | 'insumos' | 'confirmar';
export type Opcao = { valor: string; titulo: string };
export type CasoDaDecisao = CasoDoAviso & { totalCentavos: number | null };
export type PassoDaDecisao = { passo: Passo; pergunta: string; aviso: string | null; opcoes: Opcao[] };

/** Os limites da lista "Aceitar pelo WhatsApp até" (centavos); `null` = sem limite; 0 = não aceitar pelo WhatsApp. */
export const LIMITES_DO_ACEITE = [0, 3000, 5000, 10000, 20000] as const;
export const LIMITE_PADRAO = 10000;

// Os nomes dos motivos como a equipe fala — os mesmos da tela (`disputa-ifood.tsx` MOTIVO_IFOOD; `pedido-99.tsx`).
const MOTIVO_IFOOD: Record<string, string> = {
  HIGH_STORE_DEMAND: 'Loja em capacidade máxima',
  UNKNOWN_ISSUE: 'Problema não especificado',
  CUSTOMER_SATISFACTION: 'Satisfação do cliente',
  INVENTORY_CHECK: 'Verificação de disponibilidade',
  SYSTEM_ISSUE: 'Problema técnico',
  WRONG_ORDER: 'Pedido incorreto',
  PRODUCT_QUALITY: 'Qualidade do produto',
  LATE_DELIVERY: 'Entrega atrasada',
  CUSTOMER_REQUEST: 'Solicitação do cliente',
};
const MOTIVO_CANCELAMENTO_99: Record<string, string> = {
  preparing: 'O pedido já está em preparo',
  prepared: 'O pedido já está pronto',
  'courier arrived': 'O entregador já chegou à loja',
  'courier taken': 'O entregador já levou o pedido',
};
const MOTIVO_REEMBOLSO_99: Record<string, string> = {
  'communication with user redo a delivery': 'Combinado com o cliente: entregar de novo',
  'communication with user replace with others': 'Combinado com o cliente: trocar por outro item',
  'the merchandise already give courier': 'O pedido já foi entregue ao entregador',
  'courier sent miss': 'O entregador errou a entrega',
  'user misunderstands': 'O cliente se enganou',
  'i just want refund a part': 'Reembolso só de uma parte',
  'missing user information': 'Faltam dados do cliente',
  other: 'Outro',
};
const traduzir = (mapa: Record<string, string>, s: string) => mapa[s] ?? mapa[s.trim().toLowerCase()] ?? s;

// O valor com espaço comum (o formatador põe o espaço que não quebra, U+00A0).
export const brl = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
/** Onde o aceite devolve o valor ao cliente pela própria plataforma (no cancelamento, depende do pagamento). */
const devolveComOAceite = (c: CasoDaDecisao) => c.tipo === 'disputa' || c.tipo === 'reembolso_99';

/** O que o aceite devolve (centavos), ou `null` se não dá para saber — que conta como acima do limite. */
export function valorDoAceite(c: CasoDaDecisao): number | null {
  if (c.tipo === 'disputa') {
    const d = c.detalhe?.disputa ?? {};
    if (d.acao === 'PROPOSED_ADDITIONAL_TIME') return 0; // aceitar = dar mais tempo, sem dinheiro
    if (d.acao === 'CANCELLATION' && d.tipo !== 'AFTER_DELIVERY_PARTIALLY') return c.totalCentavos;
    const itens: any[] = Array.isArray(d.itens) ? d.itens : [];
    // Item sem valor (`null` vira 0 em `Number`): o total não é conhecido — conta como acima do limite, nunca como R$ 0.
    const temValor = (i: any) => i?.centavos !== null && i?.centavos !== undefined && i?.centavos !== '' && Number.isFinite(Number(i.centavos));
    if (itens.length && itens.every(temValor)) return itens.reduce((s, i) => s + Number(i.centavos), 0);
    return null;
  }
  if (c.tipo === 'reembolso_99') {
    const v = Number(c.detalhe?.pedido99?.valorCentavos);
    return Number.isFinite(v) && v > 0 ? v : c.totalCentavos; // sem o valor pedido, o pedido inteiro (o mais cauteloso)
  }
  return c.totalCentavos; // cancelamento na 99 ou no cardápio: o pedido inteiro
}

/** O limite deixa aceitar este valor? */
export function podeAceitar(valor: number | null, limite: number | null): boolean {
  if (limite === null) return true;
  if (limite <= 0 || valor === null) return false;
  return valor <= limite;
}

/** Os motivos que a plataforma exige para esta ação: [] = não pede motivo; `null` = não dá para responder pelo WhatsApp. */
export function motivosDe(c: CasoDaDecisao, acao: Acao): Opcao[] | null {
  if (c.tipo === 'disputa') {
    const d = c.detalhe?.disputa ?? {};
    const codigos: string[] = acao === 'aceitar' ? (Array.isArray(d.motivosParaAceitar) ? d.motivosParaAceitar.map(String) : []) : [...MOTIVOS_DE_RECUSA_IFOOD];
    return codigos.map((m) => ({ valor: m, titulo: traduzir(MOTIVO_IFOOD, m) }));
  }
  if (c.tipo === 'cancelamento_99' || c.tipo === 'reembolso_99') {
    if (acao === 'aceitar') return [];
    const p = c.detalhe?.pedido99 ?? {};
    if (c.tipo === 'cancelamento_99') {
      const lista: string[] = Array.isArray(p.motivosDeRecusa) ? p.motivosDeRecusa.map(String).filter(Boolean) : [];
      return lista.length ? lista.map((m) => ({ valor: m, titulo: traduzir(MOTIVO_CANCELAMENTO_99, m) })) : null;
    }
    const lista: any[] = Array.isArray(p.motivosDoReembolso) ? p.motivosDoReembolso.filter((m) => m?.id) : [];
    return lista.length ? lista.map((m) => ({ valor: String(m.id), titulo: traduzir(MOTIVO_REEMBOLSO_99, String(m.motivo ?? m.id)) })) : null;
  }
  return []; // cancelamento do cardápio: o motivo é o do cliente
}

const daPlataforma = (c: CasoDaDecisao) => (c.tipo === 'disputa' ? 'do iFood' : c.tipo === 'cancelamento' ? '' : 'da 99');

/** A frase do que foi escolhido (o "Confirma?" e o "Feito"). */
export function resumoDaEscolha(c: CasoDaDecisao, r: Rascunho, valor: number | null): string {
  const num = c.pedidoNumero ? ` do pedido ${c.pedidoNumero}` : '';
  const motivo = r.motivo ? (motivosDe(c, r.acao ?? 'recusar') ?? []).find((m) => m.valor === r.motivo)?.titulo ?? r.motivo : null;
  const comMotivo = motivo ? ` (motivo: ${motivo})` : '';
  const quanto = r.acao === 'aceitar' && valor && devolveComOAceite(c) ? `, devolvendo ${brl(valor)}` : '';
  if (c.tipo === 'disputa') return `${r.acao === 'aceitar' ? 'aceitar' : 'recusar'} a disputa${num}${quanto}${comMotivo}`;
  if (c.tipo === 'reembolso_99') return `${r.acao === 'aceitar' ? 'aceitar' : 'recusar'} o reembolso${num}${quanto}${comMotivo}`;
  const insumos = r.acao === 'aceitar' && c.tipo === 'cancelamento' ? (r.reaproveitado === false ? '; insumos como perda' : '; insumos reutilizados') : '';
  return `${r.acao === 'aceitar' ? 'aceitar' : 'recusar'} o cancelamento${num}${quanto}${comMotivo}${insumos}`;
}

/** O "Feito" (no passado): "disputa do pedido 4521 aceita (R$ 12,90 de volta ao cliente)". */
export function textoDoFeito(c: CasoDaDecisao, r: Rascunho, valor: number | null): string {
  const num = c.pedidoNumero ? ` do pedido ${c.pedidoNumero}` : '';
  const aceitou = r.acao === 'aceitar';
  // "de volta ao cliente" só onde a plataforma devolve com o aceite (disputa e reembolso); no cancelamento, depende do
  // pagamento (o Pix do cardápio volta sozinho; o pago na entrega não tem o que devolver).
  const quanto = aceitou && valor && devolveComOAceite(c) ? ` (${brl(valor)} de volta ao cliente)` : '';
  if (c.tipo === 'disputa') return `disputa${num} ${aceitou ? 'aceita' : 'recusada'}${quanto}`;
  if (c.tipo === 'reembolso_99') return `reembolso${num} ${aceitou ? 'aceito' : 'recusado'}${quanto}`;
  const insumos = aceitou && c.tipo === 'cancelamento' ? (r.reaproveitado === false ? ', insumos como perda' : ', insumos reutilizados') : '';
  return `cancelamento${num} ${aceitou ? 'aceito' : 'recusado'}${insumos}`;
}

/** O que acontece depois de confirmar (as frases sustentadas pelo serviço de cada caminho — V39). */
function depoisDeConfirmar(c: CasoDaDecisao, r: Rascunho): string {
  if (c.tipo === 'disputa') return 'A resposta vai ao iFood, que aceita uma só.';
  if (c.tipo !== 'cancelamento') return 'A resposta vai à 99 e não volta atrás.';
  return r.acao === 'aceitar'
    ? 'O pedido é cancelado aqui, como no painel; pago no Pix pelo cardápio, o valor volta ao cliente sozinho.'
    : 'O pedido segue normalmente.';
}

/**
 * O passo em que a decisão está, pelo que já foi escolhido. `null` = nada a perguntar pelo WhatsApp (nem aceitar nem
 * recusar dá por aqui): a mensagem vai só com o link.
 */
export function passoAtual(c: CasoDaDecisao, r: Rascunho, limite: number | null): PassoDaDecisao | null {
  const valor = valorDoAceite(c);
  if (!r.acao) {
    const aceita = podeAceitar(valor, limite);
    const opcoes: Opcao[] = [];
    if (aceita) opcoes.push({ valor: 'aceitar', titulo: valor ? `Aceitar · ${brl(valor)}` : 'Aceitar' });
    if (motivosDe(c, 'recusar') !== null) opcoes.push({ valor: 'recusar', titulo: 'Recusar' });
    if (!opcoes.length) return null;
    let aviso: string | null = null;
    if (!aceita)
      aviso =
        limite !== null && limite <= 0
          ? 'Aceitar só pelo Regem, com a sua senha. Recusar dá por aqui.'
          : valor === null
            ? 'Sem o valor do que volta ao cliente, aceitar só pelo Regem, com a sua senha. Recusar dá por aqui.'
            : `Acima do seu limite pelo WhatsApp (${brl(limite ?? 0)}): para aceitar, abra no Regem e confirme com a sua senha. Recusar dá por aqui.`;
    return { passo: 'acao', pergunta: 'O que responder?', aviso, opcoes };
  }
  const motivos = motivosDe(c, r.acao) ?? [];
  if (motivos.length && !r.motivo)
    return { passo: 'motivo', pergunta: `Qual o motivo? A lista é ${daPlataforma(c)}.`.replace(' é .', '.'), aviso: null, opcoes: motivos };
  if (c.tipo === 'cancelamento' && r.acao === 'aceitar' && r.reaproveitado === undefined)
    return {
      passo: 'insumos',
      pergunta: 'O que aconteceu com os insumos do pedido? Reutilizados ficam no estoque; perda sai do estoque como desperdício.',
      aviso: null,
      opcoes: [
        { valor: 'reutilizados', titulo: 'Reutilizados' },
        { valor: 'perda', titulo: 'Perda' },
      ],
    };
  return {
    passo: 'confirmar',
    pergunta: `Confirma? ${capital(resumoDaEscolha(c, r, valor))}. ${depoisDeConfirmar(c, r)}`,
    aviso: null,
    opcoes: [
      { valor: 'confirmar', titulo: 'Confirmar' },
      { valor: 'voltar', titulo: 'Voltar' },
    ],
  };
}

const capital = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/**
 * A escolha tocada no passo atual. `confirmar` = executar; `voltar` = recomeça; o rascunho novo = o próximo passo;
 * `null` = a opção não é do passo atual (botão de uma mensagem velha, ou o limite mudou).
 */
export function aplicarEscolha(
  c: CasoDaDecisao,
  r: Rascunho,
  limite: number | null,
  passo: Passo,
  valor: string,
): { tipo: 'rascunho'; rascunho: Rascunho } | { tipo: 'confirmar' } | { tipo: 'voltar' } | null {
  const atual = passoAtual(c, r, limite);
  if (!atual || atual.passo !== passo || !atual.opcoes.some((o) => o.valor === valor)) return null;
  if (passo === 'acao') return { tipo: 'rascunho', rascunho: { acao: valor as Acao } };
  if (passo === 'motivo') return { tipo: 'rascunho', rascunho: { ...r, motivo: valor } };
  if (passo === 'insumos') return { tipo: 'rascunho', rascunho: { ...r, reaproveitado: valor !== 'perda' } };
  return valor === 'confirmar' ? { tipo: 'confirmar' } : { tipo: 'voltar' };
}

/** O passo da opção pelo TÍTULO (a enquete da conexão por QR devolve o nome da opção). */
export function escolhaPeloTitulo(c: CasoDaDecisao, r: Rascunho, limite: number | null, titulo: string): { passo: Passo; valor: string } | null {
  const atual = passoAtual(c, r, limite);
  const o = atual?.opcoes.find((x) => x.titulo === titulo.trim());
  return atual && o ? { passo: atual.passo, valor: o.valor } : null;
}

// ---------------------------------------------------------------- os botões e a enquete

/** O id do botão (API oficial): o aviso, o passo e o VALOR da opção. Até 256 caracteres (limite da Meta). */
export function idDoBotao(avisoId: string, passo: Passo, valor: string): string {
  return `gw:${avisoId}:${passo}:${encodeURIComponent(valor)}`.slice(0, 256);
}

export function lerIdDoBotao(id: unknown): { avisoId: string; passo: Passo; valor: string } | null {
  const m = /^gw:([0-9a-f-]{36}):(acao|motivo|insumos|confirmar):(.{1,200})$/.exec(String(id ?? ''));
  if (!m) return null;
  try {
    return { avisoId: m[1], passo: m[2] as Passo, valor: decodeURIComponent(m[3]) };
  } catch {
    return null;
  }
}

/** A opção da enquete leva o número curto do caso (diz a qual decisão o voto responde). */
export function nomeNaEnquete(titulo: string, codigo: string): string {
  return `${titulo} · caso ${codigo}`.slice(0, 100);
}

export function lerVotoDaEnquete(texto: unknown): { titulo: string; codigo: string } | null {
  const m = /^(.+?)\s*·\s*caso\s+(\d{4})\s*$/i.exec(String(texto ?? '').trim());
  return m ? { titulo: m[1].trim(), codigo: m[2] } : null;
}

/** A resposta a uma decisão (botão da API oficial ou voto da enquete)? */
export function ehRespostaDeDecisao(texto: unknown, opcaoId: unknown): boolean {
  return !!lerIdDoBotao(opcaoId) || !!lerVotoDaEnquete(texto);
}

/** O rascunho gravado no aviso (texto JSON) — o que não for reconhecido vira vazio. */
export function lerRascunho(escolha: unknown): Rascunho {
  try {
    const o = typeof escolha === 'string' && escolha ? JSON.parse(escolha) : {};
    const r: Rascunho = {};
    if (o?.acao === 'aceitar' || o?.acao === 'recusar') r.acao = o.acao;
    if (typeof o?.motivo === 'string' && o.motivo) r.motivo = o.motivo;
    if (typeof o?.reaproveitado === 'boolean') r.reaproveitado = o.reaproveitado;
    return r;
  } catch {
    return {};
  }
}

/** O limite gravado (coluna), ou o padrão sem linha. */
export function lerLimite(v: unknown, temLinha: boolean): number | null {
  if (!temLinha) return LIMITE_PADRAO;
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : LIMITE_PADRAO;
}
