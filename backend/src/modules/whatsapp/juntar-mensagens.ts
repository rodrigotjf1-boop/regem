import { entregarAoRobo } from './entregar-ao-robo';

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

/** Entrega ao robô juntando o texto das mensagens seguidas da mesma conversa. Nunca lança. */
export async function entregarJuntando(msg: any, entregar: (m: any) => Promise<any> = entregarAoRobo): Promise<void> {
  const ms = espera();
  const k = chave(msg);
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
