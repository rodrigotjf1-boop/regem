// O TEXTO que sai no chat do iFood e da 99 pela ponte (mig 366): os avisos automáticos e a trava do que a plataforma
// proíbe. Regra única — o serviço dos ajustes recusa o texto com contato; a rotina e o "chegando" montam por aqui.

export type MotivoDoAviso = 'saiu' | 'chegando' | 'obrigado';

/** O texto padrão de cada aviso (texto vazio nos ajustes = este). */
export const TEXTO_PADRAO: Record<MotivoDoAviso, string> = {
  saiu: 'Seu pedido saiu para entrega! Chega por volta das {hora}.',
  chegando: '{nome}, o entregador está chegando! Já pode ir até a porta.',
  obrigado: 'Obrigado pelo pedido, {nome}! Bom apetite.',
};

export const TEXTO_MAX = 300;

/**
 * O iFood e a 99 proíbem passar telefone, WhatsApp, Instagram ou link pelo chat (termo do iFood 3.3 — o cliente não pode
 * ser levado a outro canal). Vale para os textos dos avisos e, na etapa 2, para o que a equipe escreve.
 */
export function temContatoProibido(texto: string): boolean {
  // "insta" só como palavra ("em instantes" passa); o telefone pede 10 ou 11 dígitos (o número do pedido passa).
  return /(https?:\/\/|www\.|\.com\b|\.com\.br\b|wa\.me|whats|\bzap\b|\binsta(gram)?\b|@[a-z0-9_.]{3,}|\(?\d{2}\)?\s?9?\d{4}[-.\s]?\d{4})/i.test(texto);
}

/** O primeiro nome do cliente como a plataforma mandou ("MARIA S." → "Maria"); sem nome, vazio. */
export function primeiroNome(nome: string | null | undefined): string {
  const p = String(nome ?? '').trim().split(/\s+/)[0] ?? '';
  if (!p || !/\p{L}/u.test(p)) return '';
  return p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1).toLocaleLowerCase('pt-BR');
}

/**
 * Monta o aviso: `{nome}` vira o primeiro nome (sem nome, sai com a vírgula ao lado); `{hora}` vira a previsão ("20h15") —
 * sem previsão, sai a FRASE que tinha a hora ("Chega por volta das {hora}."), para não mandar uma promessa vazia.
 */
export function montarAviso(modelo: string, dados: { nome?: string | null; hora?: string | null }): string {
  const nome = primeiroNome(dados.nome);
  let t = String(modelo ?? '');
  if (dados.hora) t = t.replace(/\{hora\}/g, () => String(dados.hora));
  else {
    // Tira cada frase com {hora}: do começo da frase (ou do texto) até o ponto/exclamação/interrogação seguinte.
    t = t.replace(/(^|[.!?]\s+)[^.!?]*\{hora\}[^.!?]*[.!?]?/g, (_m, antes: string) => (antes ? antes.trimEnd() + ' ' : ''));
  }
  if (nome) t = t.replace(/\{nome\}/g, () => nome);
  else t = t.replace(/,\s*\{nome\}|\{nome\}\s*,?\s*/g, '');
  t = t.replace(/\s{2,}/g, ' ').trim();
  // Primeira letra maiúscula (o "{nome}, o entregador…" sem nome começaria com "o").
  return t ? t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1) : t;
}

// ───────────────────────── a TRAVA DA PLATAFORMA para o que o atendente virtual escreve (F5, mig 383) ─────────────────────────
// O atendente virtual (o robô com IA do n8n) escreve livre; no chat do iFood e da 99 só sai o que a plataforma aceita:
//  • uma linha só — a ponte põe o texto no campo do chat e confere o envio pelo eco com o texto EXATO (ERR-381); quebra de
//    linha é o que a plataforma pode mudar no caminho (os avisos e as frases do robô por regras já são de uma linha);
//  • até 3 mensagens de até 300 letras, cortadas no fim de uma frase (senão num espaço) — o que não cabe fica de fora;
//  • NADA de telefone, WhatsApp, Instagram, e-mail ou link (`temContatoProibido`, termo do iFood 3.3): se o texto INTEIRO
//    ou qualquer parte tem, nada do texto do atendente sai (quem chama põe a resposta por regras ou abre o caso).
// Pura: a resposta do robô (`atendente-no-chat.ts`) e a conversa de teste do atendente (F4) usam a MESMA regra (V74).

/** No máximo tantas mensagens por resposta do atendente no chat da plataforma. */
export const PARTES_NO_CHAT = 3;

const umaLinhaSo = (t: string) => String(t ?? '').replace(/\s+/g, ' ').trim();

/** Onde cortar o texto (maior que `tamanho`): no fim da última frase que cabe (se não for cedo demais), senão no último espaço. */
function ondeCortar(t: string, tamanho: number): number {
  let fimDeFrase = -1;
  const re = /[.!?…]["')\]]*(?= )/g;
  for (let m = re.exec(t); m && m.index < tamanho; m = re.exec(t)) {
    const fim = m.index + m[0].length;
    if (fim <= tamanho) fimDeFrase = fim;
  }
  if (fimDeFrase >= Math.floor(tamanho / 3)) return fimDeFrase;
  const espaco = t.lastIndexOf(' ', tamanho);
  return espaco > 0 ? espaco : tamanho;
}

/** O texto numa linha só, em até `max` partes de até `tamanho` letras; `cortado` = sobrou texto que não coube. */
export function partirParaOChat(texto: string, max = PARTES_NO_CHAT, tamanho = TEXTO_MAX): { partes: string[]; cortado: boolean } {
  let resto = umaLinhaSo(texto);
  const partes: string[] = [];
  while (resto && partes.length < max) {
    if (resto.length <= tamanho) {
      partes.push(resto);
      resto = '';
      break;
    }
    const corte = ondeCortar(resto, tamanho);
    partes.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  return { partes: partes.filter(Boolean), cortado: !!resto };
}

/** As opções do atendente no chat da plataforma: uma lista numerada na mesma linha (o chat não tem botão). */
export function opcoesNoChat(texto: string, opcoes: ReadonlyArray<{ titulo: string; descricao?: string }>): string {
  const cabeca = umaLinhaSo(texto);
  if (!opcoes.length) return cabeca;
  const lista = opcoes.map((o, i) => `${i + 1}) ${umaLinhaSo(o.titulo)}${o.descricao ? ` (${umaLinhaSo(o.descricao)})` : ''}`).join('; ');
  return `${cabeca ? `${cabeca} ` : ''}${lista}. Responda com o número da opção.`;
}

export type MotivoDaTrava = 'vazio' | 'contato';
export type TravaDoChat = { ok: true; partes: string[]; cortado: boolean } | { ok: false; motivo: MotivoDaTrava };

/** Como o motivo da trava aparece (no log e na linha do teste do atendente) — sem o texto de ninguém. */
export const NOME_DO_MOTIVO_DA_TRAVA: Record<MotivoDaTrava, string> = {
  vazio: 'a resposta veio vazia',
  contato: 'tem telefone, WhatsApp, Instagram, e-mail ou link — a plataforma proíbe',
};

/** O que o atendente escreveu passa na trava da plataforma? Sim → as partes que saem; não → o motivo (nada sai). */
export function travaDaPlataforma(texto: string): TravaDoChat {
  const t = umaLinhaSo(texto);
  if (!t) return { ok: false, motivo: 'vazio' };
  if (temContatoProibido(t)) return { ok: false, motivo: 'contato' };
  const { partes, cortado } = partirParaOChat(t);
  if (!partes.length) return { ok: false, motivo: 'vazio' };
  if (partes.some((p) => temContatoProibido(p))) return { ok: false, motivo: 'contato' };
  return { ok: true, partes, cortado };
}
