import { sql } from 'drizzle-orm';
import { chaveTelefone, sqlChaveTelefone } from '../../common/telefone-chave';
import { Emitir, JANELA_DO_MESMO_CHAMADO_H, abrirChamadoPeloRobo } from '../atendimento/abrir-chamado';
import { normalizar } from '../cardapio/robo-consultas';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ROBÔ DO OUTRO LADO (Bloco 4 do plano de 31/10/2026 — pedido do dono: "detecção de respostas automáticas para não
// conversar com outro chatbot, sem confundir humano"). Do outro lado pode estar a resposta automática de outra empresa
// (o WhatsApp Business de um fornecedor, um menu "digite 1", outro assistente virtual) — e os dois robôs ficam
// respondendo um ao outro sem fim, pelo número da loja.
//
// A regra aprovada: DOIS sinais diferentes, ou o TETO de mensagens, e o robô cala nesta conversa e abre um chamado para a
// equipe conferir. Um sinal sozinho nunca basta: gente de verdade escreve "não entendi sua mensagem", cola um endereço
// comprido logo depois da pergunta ou manda a mesma pergunta duas vezes. Os sinais:
//   • texto de resposta automática ("mensagem automática", "digite 1", "opção inválida", "em breve retornaremos", um menu
//     numerado de 3 linhas ou mais);
//   • rapidez: duas mensagens compridas que chegam poucos segundos depois da nossa — mais rápido do que alguém lê e digita
//     (botão tocado e mensagem curta não contam);
//   • repetição: a mesma mensagem comprida chegando de novo (o menu que volta, o "opção inválida").
// O teto é o laço que nenhum pedido de verdade alcança: mensagens demais nossas ou dele em 10 minutos.
// Só olha o que CHEGOU (as nossas respostas nunca contam como sinal) e só a conversa recente. Sem banco aqui.

export type MensagemDaConversa = { direcao: 'entrada' | 'saida'; texto: string | null; tipo?: string | null; em: Date };

/** A conversa olhada: os últimos 30 minutos. */
export const JANELA_MIN = 30;
/** Resposta comprida que chega em até 4 s depois da nossa: ninguém lê e digita tão rápido. */
export const RAPIDO_MS = 4000;
export const CARACTERES_DA_RAPIDA = 40;
export const CARACTERES_DA_REPETIDA = 15;
/** O teto em 10 minutos. Um pedido inteiro conduzido pelo Regem leva umas 15 respostas nossas. */
export const TETO_SAIDAS = 30;
export const TETO_ENTRADAS = 40;
const DEZ_MIN = 10 * 60_000;

export type Sinal = 'texto_automatico' | 'rapidez' | 'repeticao';
export type Avaliacao = { robo: boolean; sinais: Sinal[]; teto: boolean };

const AUTOMATICA: RegExp[] = [
  /\b(mensagem|resposta|atendimento) automatic[ao]\b/,
  /\benviada automaticamente\b/,
  /\bassistente virtual\b/,
  /\bsou (o |a |um |uma )?(robo|bot|chatbot|assistente)\b/,
  /\bdigite (o numero|a opcao|uma opcao|\d)/,
  /\b(escolha|selecione) (uma|a) (das )?opc(ao|oes)\b/,
  /\bopcao invalida\b/,
  /\bnao (entendi|reconheci) (a |sua |a sua )?(mensagem|resposta|opcao)\b/,
  /\bobrigad[oa] (por|pelo) (entrar em )?contato\b/,
  /\bem breve (retornaremos|responderemos|entraremos|um de nossos|um atendente|voce sera atendid)/,
  /\b(nosso|o) horario de atendimento\b/,
  /\bfora do (nosso )?horario\b/,
  /\bprotocolo( de atendimento)?( n| numero)? ?\d{4,}/,
];

/** "1 - Pedidos / 2 - Financeiro / 3 - Falar com…": três linhas ou mais começando por número (ou 1️⃣) e um separador. */
export function menuNumerado(texto: unknown): boolean {
  const linhas = String(texto ?? '').split(/\r?\n/);
  const numeradas = linhas.filter((l) => /^\s*(\*?\d{1,2}\*?\s*[-–).:]|[0-9]️?⃣)\s*\S/.test(l));
  return numeradas.length >= 3;
}

/** Texto típico de resposta automática (ou um menu numerado). */
export function textoAutomatico(texto: unknown): boolean {
  if (menuNumerado(texto)) return true;
  const t = normalizar(texto);
  return !!t && AUTOMATICA.some((r) => r.test(t));
}

const ehDigitada = (m: MensagemDaConversa) => !m.tipo || m.tipo === 'text';

/**
 * A conversa recente diz que do outro lado é um robô? `conversa` em qualquer ordem; `agora` é a hora da mensagem que
 * acabou de chegar (ela já deve estar na conversa).
 */
export function avaliarRoboDoOutroLado(conversa: MensagemDaConversa[], agora: Date = new Date()): Avaliacao {
  const desde = agora.getTime() - JANELA_MIN * 60_000;
  const recente = conversa
    .filter((m) => m && m.em instanceof Date && !isNaN(m.em.getTime()) && m.em.getTime() >= desde && m.em.getTime() <= agora.getTime() + 60_000)
    .sort((a, b) => a.em.getTime() - b.em.getTime());
  const entradas = recente.filter((m) => m.direcao === 'entrada');
  const sinais: Sinal[] = [];

  if (entradas.some((m) => textoAutomatico(m.texto))) sinais.push('texto_automatico');

  // Rapidez: a mensagem comprida digitada que chega logo depois da nossa — duas vezes.
  let rapidas = 0;
  let ultimaSaida: number | null = null;
  for (const m of recente) {
    if (m.direcao === 'saida') {
      ultimaSaida = m.em.getTime();
      continue;
    }
    if (ultimaSaida != null && ehDigitada(m) && String(m.texto ?? '').trim().length >= CARACTERES_DA_RAPIDA) {
      const dt = m.em.getTime() - ultimaSaida;
      if (dt >= 0 && dt <= RAPIDO_MS) rapidas++;
    }
    ultimaSaida = null; // só a primeira resposta depois da nossa conta
  }
  if (rapidas >= 2) sinais.push('rapidez');

  // Repetição: a mesma mensagem comprida mais de uma vez.
  const vistas = new Map<string, number>();
  for (const m of entradas) {
    const t = normalizar(m.texto);
    if (t.length < CARACTERES_DA_REPETIDA) continue;
    vistas.set(t, (vistas.get(t) ?? 0) + 1);
  }
  if ([...vistas.values()].some((n) => n >= 2)) sinais.push('repeticao');

  const dezMin = agora.getTime() - DEZ_MIN;
  const ultimos = recente.filter((m) => m.em.getTime() >= dezMin);
  const teto =
    ultimos.filter((m) => m.direcao === 'saida').length >= TETO_SAIDAS || ultimos.filter((m) => m.direcao === 'entrada').length >= TETO_ENTRADAS;

  return { robo: teto || sinais.length >= 2, sinais, teto };
}

/** O começo fixo da mensagem do chamado — é por ele que o Regem sabe que a conversa está calada por isso. */
export const MARCA_DO_CHAMADO = 'Parece um atendimento automático do outro lado';

const NOME_DO_SINAL: Record<Sinal, string> = {
  texto_automatico: 'texto de resposta automática',
  rapidez: 'respostas compridas em poucos segundos',
  repeticao: 'a mesma mensagem chegando de novo',
};

/** A mensagem do chamado: o que se viu e o que a equipe faz (baixa prioridade — não é cliente esperando). */
export function mensagemDoChamado(a: Avaliacao): string {
  const visto = [...a.sinais.map((s) => NOME_DO_SINAL[s]), ...(a.teto ? ['mensagens demais em 10 minutos'] : [])].join(', ');
  return (
    `${MARCA_DO_CHAMADO} (baixa prioridade): ${visto}. O robô parou de responder nesta conversa. ` +
    'Se for uma pessoa, resolva este chamado e o robô volta a atender.'
  );
}

// ───────────────────────── a conversa recente ─────────────────────────

const linhasDe = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

/** API oficial: a conversa dos últimos 30 minutos, do que o Regem grava (`whatsapp_mensagem`, mig 215 — só nuvem). */
export async function conversaRecenteOficial(db: any, tenantId: string, telefone: string): Promise<MensagemDaConversa[]> {
  const r = await db.execute(sql`
    select direcao, texto, tipo, criado_em
      from whatsapp_mensagem
     where tenant_id = ${tenantId}::uuid and telefone = ${telefone}
       and criado_em >= now() - make_interval(mins => ${JANELA_MIN}::int)
     order by criado_em desc
     limit 80`);
  return linhasDe(r).map((x: any) => ({
    direcao: x.direcao === 'saida' ? 'saida' : 'entrada',
    texto: x.texto ?? null,
    tipo: x.tipo ?? null,
    em: x.criado_em instanceof Date ? x.criado_em : new Date(x.criado_em),
  }));
}

// Evolution: o Regem não grava as mensagens dela — a conversa recente fica na memória deste processo (como o "juntar
// mensagens" e o registro de envios): com mais de uma réplica, cada uma vê parte da conversa e o detector só fica mais
// lento para decidir (nunca cala à toa). A chave é a instância + a chave do telefone.
const MAX_POR_CONVERSA = 60;
const MAX_CONVERSAS = 5000;
const memoria = new Map<string, MensagemDaConversa[]>();

export const chaveDaMemoria = (instancia: unknown, telefone: unknown): string | null => {
  const k = chaveTelefone(String(telefone ?? ''));
  const i = String(instancia ?? '').trim();
  return k && i ? `${i}:${k}` : null;
};

/** Guarda uma mensagem da conversa (entrada ou a resposta do Regem), tirando o que passou da janela. */
export function anotarNaMemoria(chave: string | null, m: MensagemDaConversa): void {
  if (!chave) return;
  const desde = m.em.getTime() - JANELA_MIN * 60_000;
  const lista = (memoria.get(chave) ?? []).filter((x) => x.em.getTime() >= desde);
  lista.push(m);
  if (lista.length > MAX_POR_CONVERSA) lista.splice(0, lista.length - MAX_POR_CONVERSA);
  memoria.delete(chave); // reinsere no fim: a mais antiga sai primeiro quando passa do limite
  memoria.set(chave, lista);
  if (memoria.size > MAX_CONVERSAS) {
    const primeira = memoria.keys().next().value;
    if (primeira !== undefined) memoria.delete(primeira);
  }
}

export function conversaNaMemoria(chave: string | null): MensagemDaConversa[] {
  return chave ? [...(memoria.get(chave) ?? [])] : [];
}

/** Só para teste. */
export function esquecerConversas(): void {
  memoria.clear();
}

// ───────────────────────── calar ─────────────────────────

/** Já está calado por isso? O chamado com a marca ainda aberto — resolver o chamado devolve a conversa ao robô. */
export async function caladoPorRobo(db: any, tenantId: string, telefone: string): Promise<boolean> {
  const k = chaveTelefone(telefone);
  if (!k) return false;
  const r = await db.execute(sql`
    select 1 from atendimento_chamado
     where tenant_id = ${tenantId}::uuid and status = 'aberto'
       and criado_em >= now() - make_interval(hours => ${JANELA_DO_MESMO_CHAMADO_H}::int)
       and ${sqlChaveTelefone(sql`telefone`)} = ${k}
       and position(${MARCA_DO_CHAMADO} in coalesce(mensagem, '')) > 0
     limit 1`);
  return linhasDe(r).length > 0;
}

/**
 * O portão do robô do outro lado, nas duas vias: calado por isso, ou a conversa recente diz que é robô (abre o chamado
 * para a equipe conferir — o mesmo chamado aberto do número recebe a mensagem, como o "chamar atendente") → `calar`.
 * O chamado aberto também cala o robô pelo tempo da loja (robo-pausa.ts); depois disso, a marca segura até alguém
 * resolver.
 */
export async function portaoDoRoboDoOutroLado(
  db: any,
  emitir: Emitir,
  e: { tenantId: string; unidadeId: string | null; telefone: string; nome?: string | null; conversa: MensagemDaConversa[] },
): Promise<{ calar: boolean; avaliacao: Avaliacao | null; abriuChamado: boolean }> {
  if (await caladoPorRobo(db, e.tenantId, e.telefone)) return { calar: true, avaliacao: null, abriuChamado: false };
  const agora = new Date(Math.max(Date.now(), ...e.conversa.map((m) => m.em.getTime())));
  const a = avaliarRoboDoOutroLado(e.conversa, agora);
  if (!a.robo) return { calar: false, avaliacao: a, abriuChamado: false };
  await abrirChamadoPeloRobo(db, emitir, e.tenantId, e.unidadeId, {
    tipo: 'outro',
    cliente: e.nome?.trim() || undefined,
    telefone: e.telefone,
    mensagem: mensagemDoChamado(a),
  });
  return { calar: true, avaliacao: a, abriuChamado: true };
}
