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
