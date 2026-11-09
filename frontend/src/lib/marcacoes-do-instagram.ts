// AS MARCAÇÕES DO INSTAGRAM (mig 387; protótipo `mockups/regem-central-atendimento.html` versão 18): os tipos que a API
// devolve e o que a tela mostra. A regra de verdade é do servidor (V74): a menção no story o atendente virtual agradece no
// Direct (ou vira caso, quando parece reclamação); o @ da loja no post de outra pessoa fica "a decidir" até a equipe publicar
// ou ignorar — uma vez só.

export type TipoDaMarcacao = 'story' | 'post' | 'reels' | 'comentario';
export type EstadoDaMarcacao = 'sugerida' | 'publicada' | 'ignorada' | 'agradecida' | 'caso' | 'sem_acao' | 'falhou';
export type ClimaDaMarcacao = 'positivo' | 'neutro' | 'negativo';

export type MarcacaoDoInstagram = {
  id: string;
  tipo: TipoDaMarcacao;
  usuario: string | null;
  marcadoEm: string;
  link: string | null;
  legenda: string | null;
  texto: string | null;
  viu: string | null;
  clima: ClimaDaMarcacao | null;
  /** A sugestão da IA (só enquanto está "a decidir"). */
  sugestao: string | null;
  estado: EstadoDaMarcacao;
  resposta: {
    texto: string;
    por: 'robo' | 'padrao' | 'equipe';
    em: string | null;
    quem: string | null;
  } | null;
  chamadoId: string | null;
  erro: string | null;
};

export type ListaDeMarcacoes = {
  itens: MarcacaoDoInstagram[];
  contagem: { aDecidir: number; todas: number };
  proximo: string | null;
  /** Os ajustes da loja e se a IA da distribuição existe (a tela diz o que está ligado). */
  ajustes: { story: boolean; post: boolean; ia: boolean; permitido: boolean };
};

/** O comentário da equipe: até 300 letras (o servidor recusa acima), sem link e sem contato. */
export const MAX_COMENTARIO_DA_MARCACAO = 300;

export const ROTULO_DO_TIPO_DA_MARCACAO: Record<TipoDaMarcacao, string> = {
  post: '🖼️ Post',
  reels: '🎬 Reels',
  comentario: '💬 Comentário',
  story: '📸 Story',
};

export const ONDE_DA_MARCACAO: Record<TipoDaMarcacao, string> = {
  story: 'no story',
  post: 'num post',
  reels: 'num reels',
  comentario: 'num comentário',
};

export const CLIMA_DA_MARCACAO: Record<ClimaDaMarcacao, { texto: string; tom: 'ok' | 'neutro' | 'warn' }> = {
  positivo: { texto: '😊 Elogio', tom: 'ok' },
  neutro: { texto: '😐 Neutro', tom: 'neutro' },
  negativo: { texto: '⚠️ Parece reclamação', tom: 'warn' },
};

/** A linha de ajuda da lista: o que está ligado (a mesma frase do protótipo). */
export function ajudaDasMarcacoes(a: ListaDeMarcacoes['ajustes'] | null): string {
  const base = 'Quando alguém marca a loja: o @ num post, reels ou comentário de outra pessoa e a menção no story, nos últimos 30 dias.';
  if (!a) return base;
  const post = a.post
    ? a.ia
      ? 'A IA sugere o comentário olhando a imagem; nada sai sozinho.'
      : 'A IA de imagem ainda não está liberada pela Regem: as marcações chegam sem sugestão.'
    : '"Sugerir comentário nas marcações" está desligado (Delivery › Configurações › Atendimento › Instagram · Direct e comentários): elas chegam sem sugestão.';
  const story = a.story ? 'No story, o atendente virtual agradece no Direct.' : 'O agradecimento no story está desligado.';
  return `${base} ${post} ${story}`;
}

/** O texto do agradecimento que saiu (quem escreveu). */
export const quemAgradeceu = (por: 'robo' | 'padrao' | 'equipe' | undefined): string =>
  por === 'padrao' ? 'texto padrão' : por === 'equipe' ? 'equipe' : 'atendente virtual';
