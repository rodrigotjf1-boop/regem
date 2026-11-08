// TREINAR O ATENDENTE (F4 do atendente virtual, mig 382; protótipo `mockups/regem-central-atendimento.html`, versão 13).
// A conversa de teste fala com o MESMO robô da loja (o servidor entrega com uma chave de teste — nada sai para clientes) e
// o "Corrigir" vira conhecimento, que entra nas instruções do robô. Aqui ficam os tipos, os rótulos e a sugestão de
// assunto; a regra (limites, quem pode, o que o robô faz com a chave de teste) mora no servidor.

/** `chat` = o chat do iFood e da 99 (F5): as instruções e o perfil do chat e a trava da plataforma na resposta. */
export type CanalDoTeste = 'whatsapp' | 'direct' | 'chat';

export type MensagemDoTeste = {
  id: string;
  autor: 'cliente' | 'robo' | 'sistema';
  texto: string;
  opcoes?: { titulo: string; descricao?: string }[] | null;
  /** Na linha 'sistema': o que aconteceria na conversa real (equipe chamada, recado, pedido…). */
  simulado?: { tipo: 'equipe' | 'recado' | 'responsavel' | 'nao' | 'pedido' | 'link' | 'plataforma'; detalhe?: string } | null;
  criadoEm: string;
};

export type ConversaDeTeste = {
  id: string;
  canal: CanalDoTeste;
  foraDoHorario: boolean;
  esperandoResposta: boolean;
  mensagens: MensagemDoTeste[];
};

export type AssuntoDoConhecimento = 'entrega' | 'pagamento' | 'cardapio' | 'horario' | 'pedido' | 'outro';
export type OrigemDoConhecimento = 'teste' | 'caso' | 'manual';

export type ItemDeConhecimento = {
  id: string;
  assunto: AssuntoDoConhecimento;
  pergunta: string;
  resposta: string;
  origem: OrigemDoConhecimento;
  criadoPorNome: string | null;
  criadoEm: string;
  atualizadoEm: string;
};

export const ASSUNTOS_DO_CONHECIMENTO: { valor: AssuntoDoConhecimento; rotulo: string }[] = [
  { valor: 'entrega', rotulo: 'Entrega e taxa' },
  { valor: 'pagamento', rotulo: 'Pagamento' },
  { valor: 'cardapio', rotulo: 'Cardápio e ingredientes' },
  { valor: 'horario', rotulo: 'Horário e funcionamento' },
  { valor: 'pedido', rotulo: 'Pedido e troca' },
  { valor: 'outro', rotulo: 'Outro assunto' },
];

export const ROTULO_DA_ORIGEM: Record<OrigemDoConhecimento, string> = {
  teste: 'corrigida no teste',
  caso: 'corrigida numa conversa',
  manual: 'ensinada à mão',
};

/** Os limites que o servidor confere (a tela avisa antes, o servidor decide). */
export const LIMITE_DO_CONHECIMENTO = 100;
export const MAX_PERGUNTA = 300;
export const MAX_RESPOSTA = 600;
export const MAX_MENSAGEM_DE_TESTE = 1000;

const semAcento = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** O assunto que a tela sugere pela pergunta (a pessoa troca se quiser). */
export function sugerirAssunto(pergunta: string): AssuntoDoConhecimento {
  const t = semAcento(pergunta);
  if (/entreg|taxa|bairro|frete/.test(t)) return 'entrega';
  if (/pix|cartao|pagamento|pagar|troco/.test(t)) return 'pagamento';
  if (/horario|abre|abrem|fecha|aberto|domingo|feriado/.test(t)) return 'horario';
  if (/faltou|troca|errad|pedido|cancel|demor/.test(t)) return 'pedido';
  if (/ingrediente|cardapio|sabor|lanche|vegano|gluten|lactose/.test(t)) return 'cardapio';
  return 'outro';
}

/** A pergunta de uma resposta: a última mensagem do cliente antes dela. */
export function perguntaAntes<T extends { autor: string; texto: string }>(mensagens: T[], indice: number): string {
  for (let j = indice - 1; j >= 0; j--) if (mensagens[j].autor === 'cliente') return mensagens[j].texto;
  return '';
}

/** Uma linha só (a pergunta guardada é de uma linha), aparada e no limite. */
export const umaLinha = (t: string, max: number) => t.replace(/\s+/g, ' ').trim().slice(0, max);
