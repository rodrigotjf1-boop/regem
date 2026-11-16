import { entregarAoRobo } from './entregar-ao-robo';
import { soFalaDePagamento } from '../../common/comprovante-do-cliente';

/* eslint-disable @typescript-eslint/no-explicit-any */

// JUNTAR AS MENSAGENS SEGUIDAS DO CLIENTE (Fase 2 do robô). Quem escreve "oi" / "tudo bem?" / "tem x-bacon?" em três
// mensagens recebia três respostas. Aqui o texto de cada conversa espera ROBO_JUNTAR_MS (padrão 3 s) por mais
// mensagens; chegando outra, o relógio recomeça; parando, vai UMA mensagem ao robô com os textos em linhas. Mídia
// (áudio, foto) não espera: entrega o texto que estava juntando e vai em seguida, sozinha.
//
// Em memória deste processo (como a dedup das mensagens): a conversa é sempre da mesma loja e os avisos chegam à
// mesma API. Com 0, desliga (vai uma por uma, como antes).

type Pendente = { msg: any; textos: string[]; ids: string[]; timer: ReturnType<typeof setTimeout> };
const pendentes = new Map<string, Pendente>();

const espera = () => {
  const n = Number(process.env.ROBO_JUNTAR_MS ?? 3000);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 15_000) : 3000;
};
const chave = (m: any) => `${m?.tenantId}:${m?.de}`;
const ehTexto = (m: any) => m?.tipo === 'text' || m?.tipo === 'interactive' || m?.tipo === 'poll';

async function soltar(k: string, entregar: (m: any) => Promise<any>): Promise<void> {
  const p = pendentes.get(k);
  if (!p) return;
  pendentes.delete(k);
  clearTimeout(p.timer);
  const juntas = p.textos.length > 1;
  await entregar({
    ...p.msg,
    texto: p.textos.join('\n'),
    ...(juntas ? { mensagensJuntadas: p.ids.length, mensagemIds: p.ids } : {}),
  });
}

/**
 * O PORTEIRO DA PAUSA (F3 da pausa dos pedidos, mig 395): olha a mensagem JÁ JUNTADA antes de ela ir ao robô — com o
 * cardápio digital pausado, a 1ª mensagem do cliente na pausa é respondida pelo Regem com a mensagem pronta e não vai ao
 * robô ('respondido'); F4 (mig 396): o cliente que insiste vai ao robô com `responderFalado: true` ('falar') — o nó
 * "Prepara a resposta" do n8n responde em áudio com a voz de sempre. Registrado UMA vez, quando o servidor sobe
 * (`PausaNoAtendimentoService`); sem ele (testes, servidor da loja), entrega direto. Falha do porteiro nunca segura a
 * mensagem: entrega ao robô.
 */
type Porteiro = (msg: any) => Promise<'segue' | 'respondido' | 'falar'>;
let porteiro: Porteiro | null = null;
export function definirPorteiroDaPausa(p: Porteiro | null): void {
  porteiro = p;
}
export async function entregarComPorteiro(msg: any, entregar: (m: any) => Promise<any> = entregarAoRobo): Promise<any> {
  if (porteiro) {
    const decisao = await porteiro(msg).catch(() => 'segue' as const);
    if (decisao === 'respondido') return true;
    if (decisao === 'falar') return entregar({ ...msg, responderFalado: true });
  }
  return entregar(msg);
}

/**
 * O ANOTADOR DA CONFIRMAÇÃO (mig 431 — o documento do dono de 16/11/2026): olha CADA mensagem do cliente, antes de juntar e
 * antes da IA, e anota no carrinho do robô que o cliente confirmou o resumo que acabou de receber ("Pode registrar", "1",
 * um sim claro). O registro do pedido exige essa anotação — quem confirma é o cliente, não a leitura que a IA faz. Registrado
 * UMA vez, quando o servidor sobe (`RoboPedidoService`, só na nuvem); sem ele (testes, servidor da loja), nada acontece.
 * Falha do anotador nunca segura a mensagem.
 */
type Anotador = (msg: any) => Promise<unknown>;
let anotador: Anotador | null = null;
export function definirAnotadorDaConfirmacao(a: Anotador | null): void {
  anotador = a;
}
async function anotarConfirmacao(msg: any): Promise<void> {
  if (!anotador) return;
  try {
    await anotador(msg);
  } catch {
    /* a mensagem segue para o robô do mesmo jeito; sem a anotação, o registro pede a confirmação de novo */
  }
}

/**
 * O PORTEIRO DO COMPROVANTE (16/11/2026 — pedido do dono; `common/comprovante-do-cliente.ts`): olha a FOTO ou o DOCUMENTO
 * que o cliente manda, com o texto que estava esperando para juntar ("paguei, segue o comprovante"). Quando é um
 * comprovante, o Regem confere o pedido e responde ele mesmo ('respondido') — a mídia não vai ao robô. Registrado UMA vez,
 * quando o servidor sobe (`ComprovanteDoClienteService`, só na nuvem); sem ele (testes, servidor da loja), nada muda.
 * Falha do porteiro nunca segura a mensagem: vai ao robô.
 */
type PorteiroDoComprovante = (msg: any, antes: string[]) => Promise<'segue' | 'respondido'>;
let porteiroDoComprovante: PorteiroDoComprovante | null = null;
export function definirPorteiroDoComprovante(p: PorteiroDoComprovante | null): void {
  porteiroDoComprovante = p;
}
async function comprovanteRespondido(msg: any, k: string): Promise<boolean> {
  if (!porteiroDoComprovante) return false;
  const antes = pendentes.get(k)?.textos ?? [];
  let decisao: 'segue' | 'respondido' = 'segue';
  try {
    decisao = await porteiroDoComprovante(msg, [...antes]);
  } catch {
    decisao = 'segue';
  }
  if (decisao !== 'respondido') return false;
  // O texto que esperava para juntar: se era SÓ do pagamento, a resposta do comprovante já o respondeu (mandá-lo ao robô
  // daria uma segunda resposta, talvez contrária); com outro assunto junto, segue para o robô no tempo dele.
  const p = pendentes.get(k);
  if (p && p.textos.every(soFalaDePagamento)) {
    clearTimeout(p.timer);
    pendentes.delete(k);
  }
  return true;
}

/** Entrega ao robô juntando o texto das mensagens seguidas da mesma conversa. Nunca lança. */
export async function entregarJuntando(msg: any, entregar: (m: any) => Promise<any> = entregarComPorteiro): Promise<void> {
  // Antes de juntar: "sim" + "tira a cebola" em duas mensagens — o "sim" anota, e a mudança sobe a versão (não vale mais).
  await anotarConfirmacao(msg);
  const ms = espera();
  const k = chave(msg);
  // A foto ou o documento que é um comprovante: o Regem respondeu — não vai ao robô.
  if (!ehTexto(msg) && (await comprovanteRespondido(msg, k))) return;
  if (!ms) {
    await entregar(msg);
    return;
  }
  if (!ehTexto(msg)) {
    await soltar(k, entregar); // o texto que estava esperando vai antes
    await entregar(msg);
    return;
  }
  const p = pendentes.get(k);
  if (p) {
    clearTimeout(p.timer);
    p.textos.push(String(msg.texto ?? ''));
    p.ids.push(String(msg.mensagemId ?? ''));
    p.msg = { ...p.msg, ...msg, texto: p.msg.texto }; // o mais novo manda nos campos (opção tocada, hora)
    p.timer = setTimeout(() => void soltar(k, entregar).catch(() => {}), ms);
    return;
  }
  pendentes.set(k, {
    msg,
    textos: [String(msg.texto ?? '')],
    ids: [String(msg.mensagemId ?? '')],
    timer: setTimeout(() => void soltar(k, entregar).catch(() => {}), ms),
  });
}

/** Só para teste. */
export function esquecerPendentes(): void {
  for (const p of pendentes.values()) clearTimeout(p.timer);
  pendentes.clear();
}
