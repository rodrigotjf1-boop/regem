/* eslint-disable @typescript-eslint/no-explicit-any */
import { agoraEmSaoPaulo } from './robo-consultas';
import { opcoesDePagamento } from './robo-pedido';
import type { SituacaoConferida } from './situacao-da-loja';
import { faixaDeHoras, linhaDoAtendente } from './dias-especiais';

/**
 * A SITUAÇÃO DA LOJA AGORA, dentro das instruções do atendente (27/11/2026, teste do dono — ver ERR-629). O atendente lia o
 * horário e as formas de pagamento só pelas ferramentas e guardava o que viu na memória da conversa (6 horas): depois que
 * o dono mudou o horário da entrega, ele seguiu dizendo "a loja não está recebendo pedidos"; e repetiu, letra por letra, as
 * formas de pagamento de um pedido de 5 horas antes — sem o Pix, que entrou depois. As instruções saem do Regem a CADA
 * mensagem: este bloco é lido do cardápio naquela hora (a MESMA regra do cardápio online e do `consultar_loja`, com o
 * veredito conferido com os aplicativos) e vai no fim, dizendo que vale mais que qualquer coisa dita antes na conversa.
 */
export function situacaoAgoraParaAsInstrucoes(menu: any, conferida: SituacaoConferida | null, agora: Date = new Date()): string {
  const { diaDaSemana, hora } = agoraEmSaoPaulo(agora);
  const tipos = menu?.tipos ?? {};
  const porTipo = menu?.abertoPorTipo ?? {};
  const fechaAs = menu?.fechaAs ?? {};
  const proxima = menu?.proximaAbertura ?? {};
  const fechadaPelosApps = conferida?.veredito === 'fechada';
  const linhaDoTipo = (rotulo: string, t: 'entrega' | 'retirada', oferece: boolean): string | null => {
    if (!oferece) return null;
    if (fechadaPelosApps) return `- ${rotulo}: fechada agora (conferido com os aplicativos da loja).`;
    if (porTipo[t]) return `- ${rotulo}: aberta${fechaAs[t] ? `, recebe pedido até ${fechaAs[t]}` : ''}.`;
    const volta = proxima[t] ? ` (abre ${String(proxima[t]).includes(' ') ? proxima[t] : `às ${proxima[t]}`})` : '';
    return `- ${rotulo}: fechada agora${volta}.`;
  };
  const pausa = menu?.pausa;
  const pagamentos = opcoesDePagamento(menu, null).map((o) => o.titulo);
  // Os dias especiais (H1, mig 512): o de hoje e os dos próximos 30 dias. Feriado que não está na lista segue o horário
  // daquele dia da semana (decisão 3 do protótipo) — a mesma regra do cardápio, para as duas respostas baterem.
  const esp = menu?.diasEspeciais ?? {};
  const hoje = esp.hoje;
  const proximos: any[] = Array.isArray(esp.proximos) ? esp.proximos : [];
  const linhaDeHoje = hoje
    ? `- Hoje é dia especial (${hoje.nome}): ${hoje.funcionamento === 'fechada' ? 'a loja não abre hoje' : `a loja abre ${faixaDeHoras(String(hoje.abre), String(hoje.fecha))}`}. Diga o motivo e quando volta.`
    : null;
  const linhaDosDias = proximos.length
    ? `- Dias especiais (nestas datas vale este horário, não o da semana): ${proximos.slice(0, 8).map(linhaDoAtendente).join('; ')}. Feriado ou data que não está aqui: vale o horário daquele dia da semana.`
    : '- Nenhum dia especial nos próximos 30 dias: feriado ou data comemorativa segue o horário daquele dia da semana.';
  const linhas = [
    `SITUAÇÃO DA LOJA AGORA (lida do sistema nesta mensagem: ${diaDaSemana}, ${hora}). Ela vale mais que qualquer coisa dita antes nesta conversa: se antes você disse que estava fechada, deu outro horário ou mostrou outras formas de pagamento, siga o que está aqui.`,
    linhaDoTipo('Entrega', 'entrega', tipos.delivery !== false),
    linhaDoTipo('Retirada', 'retirada', !!tipos.retirada),
    pausa
      ? `- Pedidos pausados pela loja${pausa.rotulo ? ` (${pausa.rotulo})` : ''}${pausa.volta?.texto ? `, voltam ${pausa.volta.texto}` : ''}: não monte pedido até lá.`
      : null,
    linhaDeHoje,
    linhaDosDias,
    fechadaPelosApps && conferida?.comoResponder ? `- ${conferida.comoResponder}` : null,
    conferida?.veredito === 'incerta' && conferida.comoResponder ? `- ${conferida.comoResponder}` : null,
    pagamentos.length ? `- Formas de pagamento pela conversa agora: ${pagamentos.join(', ')}.` : null,
    '- Para o pedido, cada passo (a entrega, o endereço, o pagamento) só está feito quando a ferramenta deste passo responder ok NESTA mensagem. Nunca repita uma mensagem, opções ou uma confirmação de antes na conversa, que pode ser de outro pedido.',
  ];
  return linhas.filter(Boolean).join('\n');
}
