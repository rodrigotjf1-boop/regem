import { avaliacoesLigadas, chaveDaAvaliacao, lerAvaliacao, mensagemDaAvaliacao, prioridadeDaAvaliacao, viraCaso } from './ifood-avaliacao';

// As AVALIAÇÕES DO iFOOD na central (06/11/2026): como a avaliação da Review API v2.0 é lida, o que vira caso e com que
// prioridade. A forma: a lista com `status`, `replies[]` (from MERCHANT/CUSTOMER) e `questions` (valores inventados).
const v2 = (o: Record<string, unknown> = {}) => ({
  id: 'rev-1',
  score: 2,
  comment: 'A pizza chegou fria e demorou bastante',
  customerName: 'Luiza F.',
  createdAt: '2026-11-06T20:41:00Z',
  status: 'NOT_REPLIED',
  order: { id: 'aaaaaaaa-1111-2222-3333-444444444444', shortId: '4511' },
  replies: [],
  questions: [
    { title: 'Entrega', answers: [{ title: 'Ruim' }] },
    { title: 'Embalagem', answers: ['Boa'] },
  ],
  visibility: 'PUBLIC',
  version: 'v2',
  ...o,
});

describe('avaliação do iFood — leitura', () => {
  it('lê a nota, o comentário, o pedido, o cliente e as respostas às perguntas', () => {
    expect(lerAvaliacao(v2())).toEqual({
      id: 'rev-1',
      nota: 2,
      comentario: 'A pizza chegou fria e demorou bastante',
      pedidoExterno: 'aaaaaaaa-1111-2222-3333-444444444444',
      pedidoNumero: '4511',
      cliente: 'Luiza F.',
      criadaEm: '2026-11-06T20:41:00Z',
      status: 'NOT_REPLIED',
      respondida: false,
      perguntas: [
        { pergunta: 'Entrega', resposta: 'Ruim' },
        { pergunta: 'Embalagem', resposta: 'Boa' },
      ],
    });
    expect(lerAvaliacao({})).toBeNull();
    expect(lerAvaliacao(null)).toBeNull();
  });

  it('respondida: a resposta da LOJA em replies[], a situação REPLIED/PUBLISHED, ou o campo antigo `reply` (v1)', () => {
    expect(lerAvaliacao(v2({ replies: [{ from: 'MERCHANT', text: 'Obrigado!' }] }))!.respondida).toBe(true);
    expect(lerAvaliacao(v2({ replies: [{ from: 'CUSTOMER', text: 'tréplica' }] }))!.respondida).toBe(false);
    expect(lerAvaliacao(v2({ status: 'PUBLISHED' }))!.respondida).toBe(true);
    expect(lerAvaliacao(v2({ reply: { text: 'Obrigado!' } }))!.respondida).toBe(true);
  });
});

describe('avaliação do iFood — o que vira caso', () => {
  const a = (o: Record<string, unknown> = {}) => lerAvaliacao(v2(o))!;

  it('sem resposta e aceitando resposta: com comentário (qualquer nota) ou nota até 3', () => {
    expect(viraCaso(a())).toBe(true);
    expect(viraCaso(a({ score: 5, comment: 'Muito bom, voltarei!' }))).toBe(true);
    expect(viraCaso(a({ score: 3, comment: null }))).toBe(true);
    expect(viraCaso(a({ status: 'CREATED' }))).toBe(true);
  });

  it('não vira: nota boa sem comentário (lotaria a fila), já respondida, publicada, descartada ou inválida', () => {
    expect(viraCaso(a({ score: 5, comment: '' }))).toBe(false);
    expect(viraCaso(a({ score: 4, comment: null }))).toBe(false);
    expect(viraCaso(a({ replies: [{ from: 'MERCHANT', text: 'ok' }] }))).toBe(false);
    for (const status of ['REPLIED', 'PUBLISHED', 'DISCARDED', 'INVALID']) expect(viraCaso(a({ status }))).toBe(false);
  });

  it('nota até 2 é urgente; a chave do caso não se confunde com a da disputa; a mensagem sem comentário diz a nota', () => {
    expect(prioridadeDaAvaliacao(a({ score: 1 }))).toBe('urgente');
    expect(prioridadeDaAvaliacao(a({ score: 2 }))).toBe('urgente');
    expect(prioridadeDaAvaliacao(a({ score: 3 }))).toBe('normal');
    expect(prioridadeDaAvaliacao(a({ score: null }))).toBe('normal');
    expect(chaveDaAvaliacao('rev-1')).toBe('avaliacao:rev-1');
    expect(mensagemDaAvaliacao(a({ comment: null, score: 3 }))).toBe('Nota 3 sem comentário');
    expect(mensagemDaAvaliacao(a())).toBe('A pizza chegou fria e demorou bastante');
  });

  it('o ajuste nasce DESLIGADO: só `true` liga', () => {
    expect(avaliacoesLigadas(null)).toBe(false);
    expect(avaliacoesLigadas({})).toBe(false);
    expect(avaliacoesLigadas({ atendimentoIfood: { chat: true } })).toBe(false);
    expect(avaliacoesLigadas({ atendimentoIfood: { avaliacoes: 'sim' } })).toBe(false);
    expect(avaliacoesLigadas({ atendimentoIfood: { avaliacoes: true } })).toBe(true);
  });
});
