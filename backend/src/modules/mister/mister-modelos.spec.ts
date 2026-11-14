import {
  MODELO_DO_AVISO,
  MODELO_DO_RESUMO,
  MODELOS_DO_MISTER,
  PARAMETRO_MAX,
  codigoDoBotao,
  ehRecusaDoModelo,
  mensagemDoModelo,
  parametro,
  parametrosDoAviso,
  parametrosDoResumo,
  pedidoDeAprovacao,
  situacaoDoModelo,
  toqueNoModelo,
} from './mister-modelos';

// Os modelos de mensagem do Mister na Meta: o texto, o pedido de aprovação no formato da documentação, os parâmetros
// que a Meta aceita, o código do botão e a leitura do toque.

const ID = '0b9f6c2e-3a1d-4c5e-9f00-12ab34cd56ef';

describe('Mister — os modelos de mensagem da Meta', () => {
  it('os dois modelos: utilidade, dois parâmetros, sem começar nem terminar em parâmetro, botão curto', () => {
    expect(MODELOS_DO_MISTER.map((m) => m.nome)).toEqual(['mister_aviso', 'mister_resumo_pronto']);
    for (const m of MODELOS_DO_MISTER) {
      // A Meta recusa corpo que começa ou termina com parâmetro, e parâmetros lado a lado.
      expect(m.corpo.match(/\{\{\d\}\}/g)).toEqual(['{{1}}', '{{2}}']);
      expect(m.corpo.startsWith('{{')).toBe(false);
      expect(/\{\{\d\}\}[.!?]?$/.test(m.corpo)).toBe(false);
      expect(/\}\}\s*\{\{/.test(m.corpo)).toBe(false);
      expect(m.exemplo).toHaveLength(2);
      expect(m.botao.length).toBeLessThanOrEqual(25);
      // Nome de modelo da Meta: só minúsculas, números e sublinhado.
      expect(m.nome).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('o pedido de aprovação segue a documentação: corpo com o exemplo em lista dentro de lista e o botão de resposta rápida', () => {
    expect(pedidoDeAprovacao(MODELO_DO_AVISO)).toEqual({
      name: 'mister_aviso',
      language: 'pt_BR',
      category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text: 'Aviso do Mister para {{1}}: {{2}}. Toque no botão para ver o que fazer.',
          example: { body_text: [['Burger da Praça', 'a impressora da cozinha está parada']] },
        },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Ver o que fazer' }] },
      ],
    });
    expect(pedidoDeAprovacao(MODELO_DO_RESUMO).components[1]).toEqual({ type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Ver resumo' }] });
  });

  it('o parâmetro como a Meta aceita: sem quebra de linha, tabulação ou espaços seguidos, sem o ponto final, nunca vazio, com teto', () => {
    expect(parametro('Loja Centro\n\nconfira\tagora')).toBe('Loja Centro confira agora');
    expect(parametro('a     b')).toBe('a b');
    expect(parametro('impressora parada.')).toBe('impressora parada');
    expect(parametro('  ')).toBe('—');
    expect(parametro(null)).toBe('—');
    const longo = parametro('x'.repeat(500));
    expect(longo.length).toBe(PARAMETRO_MAX);
    expect(longo.endsWith('…')).toBe(true);
  });

  it('os parâmetros do aviso: a loja e o quê, pelo título "<loja> · <o quê>"; sem loja no título, a empresa', () => {
    expect(parametrosDoAviso('Loja Centro · impressora Cozinha parada', 'Burger')).toEqual(['Loja Centro', 'impressora Cozinha parada']);
    expect(parametrosDoAviso('Loja Centro · nota fiscal nº 12 (série 1) sem resposta da SEFAZ', 'Burger')).toEqual(['Loja Centro', 'nota fiscal nº 12 (série 1) sem resposta da SEFAZ']);
    expect(parametrosDoAviso('A IA do Mister parou: sem crédito', 'Burger da Praça')).toEqual(['Burger da Praça', 'A IA do Mister parou: sem crédito']);
  });

  it('os parâmetros do resumo: qual resumo, por extenso, e a empresa', () => {
    expect(parametrosDoResumo('resumo_dia', { referencia: '2026-11-13', ate: '2026-11-13' }, 'Burger')).toEqual(['resumo de sexta, 13/11', 'Burger']);
    expect(parametrosDoResumo('resumo_semana', { referencia: '2026-11-02', ate: '2026-11-08' }, 'Burger')).toEqual(['resumo da semana de 02/11 a 08/11', 'Burger']);
  });

  it('a mensagem que usa o modelo: o nome, o idioma, os parâmetros limpos e o código no botão', () => {
    const m = mensagemDoModelo(MODELO_DO_AVISO, '5521900000000', ['Loja Centro', 'impressora parada.'], { tipo: 'aviso', id: ID });
    expect(m).toEqual({
      messaging_product: 'whatsapp',
      to: '5521900000000',
      type: 'template',
      template: {
        name: 'mister_aviso',
        language: { code: 'pt_BR' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'Loja Centro' }, { type: 'text', text: 'impressora parada' }] },
          { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: `mister:aviso:${ID}` }] },
        ],
      },
    });
  });

  it('o toque: só o código do Mister, com tipo conhecido e id que é uuid', () => {
    expect(toqueNoModelo(codigoDoBotao({ tipo: 'aviso', id: ID }))).toEqual({ tipo: 'aviso', id: ID });
    expect(toqueNoModelo(`mister:resumo:${ID.toUpperCase()}`)).toEqual({ tipo: 'resumo', id: ID });
    expect(toqueNoModelo(`mister:outro:${ID}`)).toBeNull();
    expect(toqueNoModelo('mister:aviso:1; drop table x')).toBeNull();
    expect(toqueNoModelo('empresa:123')).toBeNull();
    expect(toqueNoModelo(null)).toBeNull();
    expect(toqueNoModelo('')).toBeNull();
  });

  it('a situação na Meta e as recusas do modelo no envio', () => {
    expect(['APPROVED', 'PENDING', 'IN_APPEAL', 'REJECTED', 'PAUSED', 'DISABLED', 'LIMIT_EXCEEDED', undefined].map(situacaoDoModelo)).toEqual([
      'aprovado',
      'em_analise',
      'em_analise',
      'recusado',
      'pausado',
      'desativado',
      'outra',
      'nao_pedido',
    ]);
    expect([132000, 132001, 132015, 132016, '132001'].every(ehRecusaDoModelo)).toBe(true);
    expect([131047, 100, undefined].some(ehRecusaDoModelo)).toBe(false);
  });
});
