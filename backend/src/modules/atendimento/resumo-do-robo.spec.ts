import { lerResumoDaMensagem, resumoDoRobo } from './resumo-do-robo';

// O RESUMO QUE O ROBÔ FAZ DO CASO (Onda 1, PR 4): das linhas da mensagem (como as instruções pedem) ou dos campos
// próprios (quando o fluxo do n8n os manda).

describe('as linhas "Motivo / Quer / Já fiz" da mensagem', () => {
  it('uma por linha, como as instruções pedem', () => {
    const m = 'Motivo: atraso, pedido 1180 saiu às 19:31\nQuer: saber quando chega\nJá fiz: mandei o rastreio às 19:46';
    expect(lerResumoDaMensagem(m)).toEqual({ motivo: 'atraso, pedido 1180 saiu às 19:31', quer: 'saber quando chega', jaFez: 'mandei o rastreio às 19:46' });
  });

  it('todas numa linha só, com ponto, ponto e vírgula ou barra; "o cliente quer" e "o robô já fez" também valem', () => {
    expect(lerResumoDaMensagem('Motivo: faltou item. O cliente quer: a Coca que faltou; O robô já fez: pediu a foto da sacola.')).toEqual({
      motivo: 'faltou item',
      quer: 'a Coca que faltou',
      jaFez: 'pediu a foto da sacola',
    });
    expect(lerResumoDaMensagem('- motivo: link não abre / quer: 1 X-Bacon / ja fiz: mandei o link 2 vezes')).toEqual({
      motivo: 'link não abre',
      quer: '1 X-Bacon',
      jaFez: 'mandei o link 2 vezes',
    });
  });

  it('mensagem livre (o fluxo antigo): nada', () => {
    expect(lerResumoDaMensagem('Não consegue abrir o link do cardápio no celular; quer 1 X-Bacon e 1 Coca')).toEqual({});
    expect(lerResumoDaMensagem(null)).toEqual({});
  });

  it('valor longo é cortado; rótulo repetido vale o primeiro', () => {
    expect(lerResumoDaMensagem(`Motivo: ${'a'.repeat(400)}`).motivo).toHaveLength(300);
    expect(lerResumoDaMensagem('Motivo: um\nMotivo: dois').motivo).toBe('um');
  });
});

describe('o resumo do caso', () => {
  it('o campo próprio vence a linha da mensagem', () => {
    expect(resumoDoRobo({ mensagem: 'Motivo: da linha\nQuer: da linha', motivo: 'do campo' }, false)).toEqual({
      motivo: 'do campo',
      quer: 'da linha',
      jaFez: null,
      humor: null,
    });
  });

  it('urgente = cliente chateado; o humor dito também vale', () => {
    expect(resumoDoRobo({ mensagem: 'Motivo: atraso' }, true)!.humor).toBe('chateado');
    expect(resumoDoRobo({ mensagem: 'Motivo: atraso', humor: 'irritado' }, false)!.humor).toBe('chateado');
    expect(resumoDoRobo({ mensagem: 'Motivo: dúvida', humor: 'calmo' }, false)!.humor).toBe('calmo');
    expect(resumoDoRobo({ mensagem: 'Motivo: dúvida', humor: 'feliz' }, false)!.humor).toBeNull();
  });

  it('sem motivo, sem "quer" e sem "já fiz": nenhum resumo (a tela mostra a mensagem como sempre)', () => {
    expect(resumoDoRobo({ mensagem: 'quer falar com alguém', humor: 'calmo' }, true)).toBeNull();
    expect(resumoDoRobo(undefined, false)).toBeNull();
  });
});
