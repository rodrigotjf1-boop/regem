import { BadRequestException } from '@nestjs/common';
import {
  ASSUNTOS_DO_CONHECIMENTO,
  PERGUNTA_MAX,
  REGRA_DOS_NUMEROS,
  RESPOSTA_MAX,
  TETO_NAS_INSTRUCOES,
  TITULO_DO_CONHECIMENTO,
  blocoDoConhecimento,
  lerMudancaDoItem,
  lerNovoItem,
} from './conhecimento-do-atendente';
import { instrucoesDoDirect, instrucoesDoRobo, VERSAO_DO_DIRECT, VERSAO_INSTRUCOES } from './robo-instrucoes';
import { blocoDasInstrucoes } from './assuntos-do-atendente';
import { jeitoDoAtendente } from './perfis-do-atendente';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O QUE O ATENDENTE APRENDEU (F4, mig 382) — as partes puras: a conferência do que a tela manda, a seção "O QUE A LOJA
// ENSINOU" das instruções (agrupada, com teto, os mais novos primeiro) e a regra que a tela promete — preço, taxa, prazo e
// horário SEMPRE das ferramentas, mesmo com um número na resposta ensinada (V39). Sem itens, as instruções ficam IGUAIS.

const item = (assunto: string, pergunta: string, resposta: string, criadoEm: string) => ({ assunto, pergunta, resposta, criadoEm }) as any;

describe('o que o atendente aprendeu — a conferência', () => {
  it('o item novo: assunto e origem da lista; a pergunta numa linha, até 300; a resposta até 600 (as quebras ficam)', () => {
    expect(lerNovoItem({ assunto: 'entrega', pergunta: '  entrega   no\ncentro? ', resposta: ' Entregamos sim!\r\n\r\n\r\nPeça pelo link. ', origem: 'teste' })).toEqual({
      assunto: 'entrega',
      pergunta: 'entrega no centro?',
      resposta: 'Entregamos sim!\n\nPeça pelo link.',
      origem: 'teste',
    });
    expect(lerNovoItem({ assunto: 'outro', pergunta: 'p'.repeat(PERGUNTA_MAX), resposta: 'r'.repeat(RESPOSTA_MAX), origem: 'manual' }).assunto).toBe('outro');
    const ok = { assunto: 'pagamento', pergunta: 'aceita vale?', resposta: 'Aceitamos.', origem: 'caso' };
    for (const ruim of [
      { ...ok, assunto: 'troca' },
      { ...ok, assunto: undefined },
      { ...ok, pergunta: '   ' },
      { ...ok, pergunta: 'p'.repeat(PERGUNTA_MAX + 1) },
      { ...ok, resposta: '' },
      { ...ok, resposta: 'r'.repeat(RESPOSTA_MAX + 1) },
      { ...ok, resposta: 10 },
      { ...ok, origem: 'robo' },
      { ...ok, origem: undefined },
      null,
    ])
      expect(() => lerNovoItem(ruim)).toThrow(BadRequestException);
    for (const a of ASSUNTOS_DO_CONHECIMENTO) expect(lerNovoItem({ ...ok, assunto: a }).assunto).toBe(a);
  });

  it('a mudança: parcial, só o que veio; sem nada para mudar (ou com só a origem) = 400', () => {
    expect(lerMudancaDoItem({ resposta: ' Nova ' })).toEqual({ resposta: 'Nova' });
    expect(lerMudancaDoItem({ assunto: 'horario', pergunta: 'abre domingo?' })).toEqual({ assunto: 'horario', pergunta: 'abre domingo?' });
    for (const ruim of [{}, null, { origem: 'teste' }, { assunto: 'x' }, { pergunta: '' }, { resposta: 'r'.repeat(RESPOSTA_MAX + 1) }])
      expect(() => lerMudancaDoItem(ruim)).toThrow(BadRequestException);
  });
});

describe('a seção "O QUE A LOJA ENSINOU"', () => {
  it('sem itens (ou só lixo): vazia', () => {
    expect(blocoDoConhecimento([])).toBe('');
    expect(blocoDoConhecimento(null)).toBe('');
    expect(blocoDoConhecimento([item('troca', 'x', 'y', '2026-11-01'), item('entrega', '  ', 'y', '2026-11-01')])).toBe('');
  });

  it('agrupada por assunto (a ordem da tela), cada grupo na ordem em que a loja ensinou; a regra dos números está lá', () => {
    const t = blocoDoConhecimento([
      item('outro', 'tem wifi?', 'Temos sim, a senha está no balcão.', '2026-11-03T10:00:00Z'),
      item('entrega', 'entrega no centro?', 'Entregamos!\nA taxa aparece no link.', '2026-11-02T10:00:00Z'),
      item('entrega', 'demora quanto?', 'Uns 40 min.', '2026-11-01T10:00:00Z'),
      item('pagamento', 'aceita VR?', 'Aceitamos VR na entrega.', '2026-11-04T10:00:00Z'),
    ]);
    expect(t.split('\n')).toEqual([
      TITULO_DO_CONHECIMENTO,
      '- Quando a pergunta do cliente combinar com uma destas, responda como a loja ensinou: pode ajustar as palavras ao que o cliente disse e ao seu jeito de conversar, sem mudar o sentido.',
      REGRA_DOS_NUMEROS,
      '- O resto destas instruções continua valendo (cliente chateado, quando chamar uma pessoa, os únicos links que você pode mandar).',
      'ENTREGA',
      '- Cliente: demora quanto?',
      '  Responda: Uns 40 min.',
      '- Cliente: entrega no centro?',
      '  Responda: Entregamos! A taxa aparece no link.',
      'PAGAMENTO',
      '- Cliente: aceita VR?',
      '  Responda: Aceitamos VR na entrega.',
      'OUTROS ASSUNTOS',
      '- Cliente: tem wifi?',
      '  Responda: Temos sim, a senha está no balcão.',
    ]);
    // a promessa da tela (V39): o número vem SEMPRE da ferramenta, a resposta ensinada dá o jeito
    expect(REGRA_DOS_NUMEROS).toContain('Preço, taxa, prazo e horário vêm SEMPRE das ferramentas');
    expect(REGRA_DOS_NUMEROS).toContain('mesmo que a resposta ensinada traga um valor: a resposta ensinada dá o jeito de responder, não o número');
    expect(t).not.toContain('\n\n'); // a seção é UMA parte das instruções (as partes se separam por linha em branco)
  });

  it('passando do teto (~6.000 letras): entram os MAIS NOVOS; o mais velho sai primeiro', () => {
    const muitos = Array.from({ length: 40 }, (_, i) =>
      item('cardapio', `pergunta número ${String(i).padStart(2, '0')}`, `${'resposta longa '.repeat(20)}${i}`, new Date(Date.UTC(2026, 9, 1 + i)).toISOString()),
    );
    const t = blocoDoConhecimento(muitos);
    expect(t.length).toBeLessThanOrEqual(TETO_NAS_INSTRUCOES);
    expect(t).toContain('pergunta número 39'); // o mais novo
    expect(t).not.toContain('pergunta número 00'); // o mais velho
    const dentro = [...t.matchAll(/pergunta número (\d\d)/g)].map((m) => Number(m[1]));
    expect(dentro.length).toBeGreaterThan(5);
    expect(dentro).toEqual([...dentro].sort((a, b) => a - b)); // na ordem em que a loja ensinou
    expect(Math.min(...dentro)).toBe(40 - dentro.length); // um bloco contínuo dos mais novos
  });
});

describe('instruções do robô — o que a loja ensinou (mig 382)', () => {
  const LOJA = 'Mister Burguer';
  const ITENS = [item('pagamento', 'aceita VR?', 'Aceitamos VR na entrega, R$ 5 de taxa.', '2026-11-04T10:00:00Z')];
  const gerar = (conhecimento: unknown, assuntos?: string, jeito?: string) => ({
    f1: instrucoesDoRobo({ loja: LOJA, jeito, assuntos, conhecimento: conhecimento as any }, '1').texto,
    f2: instrucoesDoRobo({ loja: LOJA, jeito, assuntos, conhecimento: conhecimento as any }, '2').texto,
    direct: instrucoesDoDirect({ loja: LOJA, jeito, assuntos, conhecimento: conhecimento as any }, '2').texto,
  });
  const antes = { f1: instrucoesDoRobo({ loja: LOJA }, '1').texto, f2: instrucoesDoRobo({ loja: LOJA }, '2').texto, direct: instrucoesDoDirect({ loja: LOJA }, '2').texto };

  it('as versões subiram (.f19 e .d5)', () => {
    expect(VERSAO_INSTRUCOES).toBe('2026-11-08.f19');
    expect(VERSAO_DO_DIRECT).toBe('2026-11-08.d5');
  });

  it('sem itens: o texto é IDÊNTICO ao de antes, nos três lugares', () => {
    for (const vazio of [undefined, null, '', '   ', blocoDoConhecimento([])]) expect(gerar(vazio)).toEqual(antes);
    for (const k of ['f1', 'f2', 'direct'] as const) expect(antes[k]).not.toContain(TITULO_DO_CONHECIMENTO);
  });

  it('com itens: a seção entra antes de COMO DESCOBRIR AS COISAS (depois dos assuntos, quando há), com a regra dos números; o resto não muda', () => {
    const secao = blocoDoConhecimento(ITENS);
    const assuntos = blocoDasInstrucoes({ vaga: { modo: 'recado' } }, 'whatsapp');
    const jeito = jeitoDoAtendente({ whatsapp: { perfil: 'cordial' } }, 'whatsapp', true);
    for (const [com, sem] of [
      [gerar(secao), antes],
      [gerar(secao, assuntos, jeito), gerar('', assuntos, jeito)],
    ] as const) {
      for (const k of ['f1', 'f2', 'direct'] as const) {
        const partes = com[k].split('\n\n');
        const i = partes.findIndex((p) => p.startsWith(TITULO_DO_CONHECIMENTO));
        expect(i).toBeGreaterThan(0);
        expect(partes[i]).toBe(secao);
        expect(partes[i + 1].startsWith('COMO DESCOBRIR AS COISAS')).toBe(true);
        expect([...partes.slice(0, i), ...partes.slice(i + 1)].join('\n\n')).toBe(sem[k]); // tirando a seção, letra por letra
        expect(partes[i]).toContain('Preço, taxa, prazo e horário vêm SEMPRE das ferramentas (o cadastro da loja), mesmo que a resposta ensinada traga um valor');
        expect(partes[i]).toContain('- Cliente: aceita VR?');
      }
    }
    // com os assuntos, a seção vem logo depois deles
    const comAssuntos = gerar(secao, assuntos).f1.split('\n\n');
    const i = comAssuntos.findIndex((p) => p.startsWith(TITULO_DO_CONHECIMENTO));
    expect(comAssuntos[i - 1].startsWith('ASSUNTOS QUE NÃO SÃO PEDIDO')).toBe(true);
  });
});
