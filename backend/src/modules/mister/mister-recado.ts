// M3g parte 2 — O RECADO NO MURAL pela conversa (mig 444). Versão 3 do protótipo `mockups/regem-mister.html`, conversa 22
// e a decisão "Criar e publicar (recado no mural, por exemplo): ele mostra o texto e pergunta antes". As regras puras; o
// serviço (`mister-recados.service.ts`) guarda o rascunho e publica pelo MESMO serviço da tela do Mural & clima.
//
// O Mister escreve; quem publica é a pessoa, pelo botão "Publicar" da conversa dela. "Mudar o texto" descarta o rascunho e
// a pessoa diz como quer. O rascunho vale 30 minutos, e o novo descarta o anterior da mesma pessoa.

/** Quantos minutos o rascunho espera o "Publicar". */
export const VALIDADE_DO_RECADO_MIN = 30;
/** O tamanho máximo do recado (a resposta com o texto e os botões cabe num balão com botão). */
export const MAX_LETRAS_DO_RECADO = 500;
/** O prefixo dos botões do recado na conversa. */
export const PREFIXO_DO_RECADO = 'rec:';

export type AcaoDoRecado = 'pub' | 'mudar';

/** "rec:pub:<id>" e "rec:mudar:<id>". */
export const botaoDoRecado = (acao: AcaoDoRecado, id: string) => ({ id: `${PREFIXO_DO_RECADO}${acao}:${id}`, titulo: acao === 'pub' ? 'Publicar' : 'Mudar o texto' });

export function lerBotaoDoRecado(botaoId: unknown): { acao: AcaoDoRecado; id: string } | null {
  const m = /^rec:(pub|mudar):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(String(botaoId ?? ''));
  return m ? { acao: m[1] as AcaoDoRecado, id: m[2].toLowerCase() } : null;
}

/** Onde o recado vai, na frase: "da Loja Centro" ou "de todas as lojas". */
export const ondeVai = (lojaNome: string) => (lojaNome === 'todas as lojas' ? 'de todas as lojas' : `da ${lojaNome}`);

export const TEXTOS_DO_RECADO = {
  semPermissao: 'O seu perfil no Regem não abre o Mural & clima: o recado não sai por aqui.',
  soGestor: 'Só o presidente e o gerente escrevem recado no mural pelo Mister.',
  semBotao: 'Pela conexão por QR Code o recado não tem o botão "Publicar". Publique no Regem, em Mural & clima.',
  vazio: 'Diga o que o recado deve dizer.',
  longo: `O recado passa de ${MAX_LETRAS_DO_RECADO} letras. Encurte e peça de novo.`,
  comLink: 'O Mister não põe link no recado. Peça sem o link; se precisar dele, publique no Regem, em Mural & clima.',
  naoDa: 'Não consegui guardar o recado agora.',
  mudar: 'Certo. Escreva como quer o recado, que eu refaço.',
  publicado: (lojaNome: string, hora: string) => `Publicado no Mural & clima ${ondeVai(lojaNome)}, às ${hora}.`,
  jaPublicado: (hora: string) => `Este recado já foi publicado, às ${hora}.`,
  trocado: 'Este texto já foi trocado. Use o botão da mensagem mais nova.',
  venceu: `Este recado venceu (o botão vale ${VALIDADE_DO_RECADO_MIN} minutos). Peça de novo, se ainda quiser publicar.`,
  naoDisponivel: 'Este recado não está mais disponível para você.',
  falhou: 'Não consegui publicar agora. Toque em "Publicar" de novo daqui a pouco.',
} as const;

// Só o que é link sem dúvida: "dia.Com isso" (sem espaço depois do ponto) não pode ser lido como domínio.
const LINK = /\bhttps?:\/\/|\bwww\./i;

/**
 * O texto do recado como a IA escreveu: sem espaço sobrando nas pontas das linhas, sem linha em branco repetida, de 2 a
 * 500 letras e sem link (o Mister nunca põe link no que publica). Devolve o texto limpo ou o motivo da recusa.
 */
export function textoDoRecado(bruto: unknown): { texto: string } | { erro: string } {
  if (typeof bruto !== 'string') return { erro: TEXTOS_DO_RECADO.vazio };
  const texto = bruto
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (texto.length < 2) return { erro: TEXTOS_DO_RECADO.vazio };
  if (texto.length > MAX_LETRAS_DO_RECADO) return { erro: TEXTOS_DO_RECADO.longo };
  if (LINK.test(texto)) return { erro: TEXTOS_DO_RECADO.comLink };
  return { texto };
}

/**
 * O comunicado do mural a partir do recado: a primeira linha é o título (o que o mural mostra em destaque) e o resto é o
 * corpo. A primeira linha comprida demais para título vira um título encurtado, e o recado inteiro vai no corpo.
 */
export function partesDoRecado(texto: string): { titulo: string; corpo: string | null } {
  const linhas = texto.split('\n');
  const primeira = linhas[0].trim();
  const resto = linhas.slice(1).join('\n').trim();
  if (primeira.length > 160) return { titulo: `${primeira.slice(0, 157).trimEnd()}…`, corpo: texto };
  return { titulo: primeira, corpo: resto || null };
}
