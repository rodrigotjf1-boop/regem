// A TRAVA NA SAÍDA DO ROBÔ (F6 do docs/plano-perfil-cliente.md, §4.6 e §6.1): o prompt não é cofre (OWASP LLM07) — a
// instrução diz "nunca cite o cartão", mas a garantia mora FORA da IA. Antes de a resposta sair, em TODO canal, a frase que
// revela o perfil ou rotula o cliente sai inteira: "seu perfil", "vi que você é…", "impaciente", quantos pedidos fez,
// quanto gastou, a nota média dele. O resto da resposta segue.

const PROIBIDAS: RegExp[] = [
  /\b(seu|teu) perfil\b/i,
  /\bcart[ãa]o do cliente\b/i,
  /\bvi (aqui )?(no sistema |no cadastro )?que (voc[eê]|vc) (é|e|costuma|sempre|tem)\b/i,
  /\b(voc[eê]|vc) (foi|está|esta|é|e) (classificad|marcad|rotulad)/i,
  /\bimpaciente\b/i,
  /\breclam[ãa]o\b/i,
  /\b(voc[eê]|vc) (j[áa] )?(fez|tem|tinha) (mais de )?\d+ pedidos\b/i,
  /\b(voc[eê]|vc) (j[áa] )?gastou\b/i,
  /\bsua nota m[ée]dia\b/i,
];

const ALTERNATIVA = 'Como posso te ajudar?';

/** Tira as frases proibidas. `tirou` = quantas saíram (para o log). Texto que ficaria vazio vira uma pergunta neutra. */
export function semRevelarPerfil(texto: string): { texto: string; tirou: number } {
  if (!texto) return { texto, tirou: 0 };
  let tirou = 0;
  const linhas = texto.split('\n').map((linha) => {
    if (!linha.trim()) return linha;
    const frases = linha.split(/(?<=[.!?…])\s+/);
    const ficam = frases.filter((f) => {
      const proibida = PROIBIDAS.some((re) => re.test(f));
      if (proibida) tirou++;
      return !proibida;
    });
    return ficam.length ? ficam.join(' ') : null;
  });
  if (!tirou) return { texto, tirou: 0 };
  const limpo = linhas
    .filter((l) => l !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { texto: limpo || ALTERNATIVA, tirou };
}
