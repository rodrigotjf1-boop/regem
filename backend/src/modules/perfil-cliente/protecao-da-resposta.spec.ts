import { semRevelarPerfil } from './protecao-da-resposta';
import { montarCartao } from './cartao-do-cliente';

// F6 do plano do perfil do cliente: a trava na saída do robô e o cartão em forma de instruções.
describe('semRevelarPerfil — a frase que revela o perfil sai, o resto segue', () => {
  it.each([
    'Vi aqui que você é bem impaciente, então vou ser rápido.',
    'Pelo seu perfil, o de sempre é o X-Bacon.',
    'Você já fez 14 pedidos com a gente!',
    'Você já gastou bastante aqui.',
    'Sua nota média é 3.',
    'Você foi classificado como cliente campeão.',
    'Segundo o cartão do cliente, prefere áudio.',
  ])('tira: %s', (frase) => {
    const r = semRevelarPerfil(`Oi, Ana! ${frase} Quer o de sempre?`);
    expect(r.tirou).toBe(1);
    expect(r.texto).toBe('Oi, Ana! Quer o de sempre?');
  });

  it('não mexe em resposta normal (nem no "o de sempre")', () => {
    const t = 'Boa noite, Ana! 🍔 O de sempre é o *X-Bacon da casa* com *Coca 2 L*. Confirma?\n\n- Entrega: Rua das Acácias';
    expect(semRevelarPerfil(t)).toEqual({ texto: t, tirou: 0 });
  });

  it('mantém as linhas da lista e, se nada sobrar, pergunta de forma neutra', () => {
    expect(semRevelarPerfil('Seu perfil diz que você é impaciente.').texto).toBe('Como posso te ajudar?');
    const r = semRevelarPerfil('Opções:\n- X-Bacon\n- Smash\nVocê já fez 3 pedidos.');
    expect(r.texto).toBe('Opções:\n- X-Bacon\n- Smash');
  });
});

describe('montarCartao — instruções, nunca números nem rótulos', () => {
  const perfil = {
    faixa_habitual: 'inicio_noite',
    dia_habitual: 5,
    camadas: {
      gosto: { de_sempre: { nome: 'X-Bacon da casa', pedidos: 8 } },
      ritmo: { hora_habitual: '20:40' },
      reclamacoes: { grupos: [{ motivo: 'atraso', nome: 'atraso', vezes: 2 }] },
    },
  };

  it('monta o de sempre, quando costuma pedir, o jeito pedido e os cuidados', () => {
    const c = montarCartao(perfil, [
      { chave: 'respostas_curtas', valor: true },
      { chave: 'time', valor: 'Flamengo' },
      { chave: 'alergia', valor: 'camarão' },
    ])!;
    expect(c.deSempre).toMatch(/^X-Bacon da casa/);
    expect(c.costumaPedir).toBe('sexta, no início da noite (por volta das 20:40)');
    expect(c.jeito).toEqual(['pediu respostas curtas']);
    expect(c.time).toBe('Flamengo');
    expect(c.cuidados?.[0]).toMatch(/^alergia a camarão/);
    expect(c.cuidados?.[1]).toMatch(/reclamou de atraso mais de uma vez: dê a previsão real/);
    expect(c.comoUsar).toMatch(/NUNCA cite/);
    // Nada de número do cliente no cartão (fora a regra de uso, que só NOMEIA o que não citar).
    const { comoUsar, ...resto } = c;
    expect(comoUsar).toBeTruthy();
    expect(JSON.stringify(resto)).not.toMatch(/\b8\b|vezes|gasto|nota/);
  });

  it('sem perfil nem nada contado: sem cartão', () => {
    expect(montarCartao(null, [])).toBeNull();
  });
});
