// OS COMENTÁRIOS DOS POSTS DO INSTAGRAM (F6 do atendente virtual, mig 384; protótipo `mockups/regem-central-atendimento.html`
// versão 15): os tipos que a API devolve e as regras que a tela mostra. A regra de verdade é do servidor (V74): "sem
// resposta" = sem resposta no post, sem mensagem no Direct e não escondido; a privada é uma só, até 7 dias depois do
// comentário. Aqui só a mesma leitura, para a tela não oferecer o que o servidor vai recusar.

export type FiltroDosComentarios = 'sem-resposta' | 'respondidos' | 'escondidos' | 'todos';

export type ComentarioDoInstagram = {
  id: string;
  comentarioId: string;
  /** O comentário de cima, quando este é resposta a outro (a conversa do comentário). */
  paiId?: string | null;
  autorUsuario: string | null;
  texto: string;
  comentadoEm: string;
  midia: { id: string; tipo: string | null; link: string | null; legenda: string | null };
  resposta: { texto: string; por: 'robo' | 'equipe'; em: string } | null;
  privada: { texto: string; em: string } | null;
  podePrivada: boolean;
  escondido: boolean;
  casoId: string | null;
  erro: string | null;
};

export type ListaDeComentarios = {
  itens: ComentarioDoInstagram[];
  contagem: { semResposta: number; respondidos: number; escondidos: number; todos: number };
  proximo: string | null;
  /** A conta do Instagram conectada COM a permissão dos comentários (sem conta, ou conectada antes dela: `false`). */
  permitido: boolean;
};

/** Quem cuida dos comentários (o servidor confere): gerente e presidente. */
export const QUEM_CUIDA_DOS_COMENTARIOS = ['presidente', 'gerente'];

export const FILTROS_DOS_COMENTARIOS: { filtro: FiltroDosComentarios; nome: string; conta: keyof ListaDeComentarios['contagem'] }[] = [
  { filtro: 'sem-resposta', nome: 'Sem resposta', conta: 'semResposta' },
  { filtro: 'respondidos', nome: 'Respondidos', conta: 'respondidos' },
  { filtro: 'escondidos', nome: 'Escondidos', conta: 'escondidos' },
  { filtro: 'todos', nome: 'Todos', conta: 'todos' },
];

/** Até quanto a resposta no post e a mensagem no Direct podem ter (o servidor recusa acima). */
export const MAX_RESPOSTA_NO_POST = 1000;
export const MAX_MENSAGEM_NO_DIRECT = 1000;

/** A mesma regra do servidor: nada no post, nada no Direct e visível. */
export const semResposta = (c: Pick<ComentarioDoInstagram, 'resposta' | 'privada' | 'escondido'>): boolean => !c.resposta && !c.privada && !c.escondido;

/** "@lu.martins" (ou "alguém", quando o Instagram não mandou o usuário). */
export const arroba = (u: string | null | undefined): string => (u ? `@${u.replace(/^@/, '')}` : 'alguém');

/** Por que não dá mais para responder no Direct — vazio quando ainda dá. */
export function motivoSemPrivada(c: Pick<ComentarioDoInstagram, 'privada' | 'podePrivada'>): string {
  if (c.privada) return 'já recebeu a mensagem no Direct';
  if (!c.podePrivada) return 'passou de 7 dias do comentário';
  return '';
}

/** O nome do post para a lista: a legenda curta, ou o tipo. */
export function nomeDoPost(m: ComentarioDoInstagram['midia']): string {
  const legenda = (m.legenda ?? '').replace(/\s+/g, ' ').trim();
  if (legenda) return legenda.length > 70 ? `${legenda.slice(0, 69)}…` : legenda;
  return m.tipo === 'REELS' ? 'Reels' : m.tipo === 'STORY' ? 'Story' : 'Post';
}
