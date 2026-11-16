import { PROCEDIMENTOS, botoesDaProposta, idDoBotao, lerBotao, perguntaDaProposta, propostaDoAviso, resultadoDaConsulta, textoDoDesfecho } from './mister-procedimentos';

// O catálogo das propostas do Mister (F4.1): puro. O banco, o toque e a execução pelos serviços das telas estão em
// `mister-pg.teste-spec.ts` (rodado pela `ia/ia-empresa-pg.spec.ts`).

const NOTA = '0e1b9a54-7f3a-4c2d-9b8e-1a2b3c4d5e6f';

describe('o catálogo das propostas do Mister', () => {
  it('todo procedimento é de botão, com prazo de 10 minutos e um tipo de aviso', () => {
    for (const p of Object.values(PROCEDIMENTOS)) {
      expect(p).toMatchObject({ nivel: 'botao', prazoMin: 10 });
      expect(p.conferirMin).toBeGreaterThan(0);
    }
  });

  it('o aviso da nota sem resposta pede a consulta da nota da chave; outra chave ou outro tipo, nada', () => {
    expect(propostaDoAviso({ tipo: 'nota_sem_resposta', chave: `nota:${NOTA}` })).toEqual({ procedimento: 'consultar_nota', parametros: { notaId: NOTA } });
    expect(propostaDoAviso({ tipo: 'nota_sem_resposta', chave: 'nota:nao-e-uuid' })).toBeNull();
    expect(propostaDoAviso({ tipo: 'caixa_24h', chave: `caixa:${NOTA}` })).toBeNull();
    expect(propostaDoAviso({ tipo: 'certificado', chave: 'qualquer' })).toBeNull();
  });

  it('o aviso da impressora parada pede a via de teste da impressora e do servidor da chave do vigia', () => {
    expect(propostaDoAviso({ tipo: 'impressora', chave: 'vigia:impressora_parada:srv:abc:impressora:9' })).toEqual({
      procedimento: 'imprimir_teste',
      parametros: { servidorId: 'abc', impressoraId: '9' },
    });
    expect(propostaDoAviso({ tipo: 'impressora', chave: 'vigia:servico_parado:srv:abc' })).toBeNull();
  });

  it('o botão leva a proposta e a escolha; o que não é botão de proposta não é lido', () => {
    expect(idDoBotao(NOTA, true)).toBe(`prop:${NOTA}:sim`);
    expect(lerBotao(`prop:${NOTA}:sim`)).toEqual({ propostaId: NOTA, autorizar: true });
    expect(lerBotao(`prop:${NOTA}:nao`)).toEqual({ propostaId: NOTA, autorizar: false });
    expect(lerBotao(`prop:${NOTA}:talvez`)).toBeNull();
    expect(lerBotao('emp:1')).toBeNull();
    expect(lerBotao(null)).toBeNull();
    expect(botoesDaProposta(NOTA).map((b) => b.titulo)).toEqual(['Autorizar', 'Não agora']);
    // O título do botão cabe no limite da Meta (20 caracteres).
    for (const b of botoesDaProposta(NOTA)) expect(b.titulo.length).toBeLessThanOrEqual(20);
  });

  it('a pergunta diz o que vai ser feito e o prazo', () => {
    expect(perguntaDaProposta('consultar_nota')).toBe('Posso consultar esta nota de novo na SEFAZ? Leva alguns segundos. A pergunta vale por 10 minutos.');
    expect(perguntaDaProposta('imprimir_teste')).toContain('via de teste');
  });

  it('a resposta da SEFAZ vira o desfecho: a situação final é "feito"; a pendente é "não deu"', () => {
    expect(resultadoDaConsulta({ status: 'autorizada', numero: 12 })).toEqual({ feita: true, texto: 'A SEFAZ autorizou a nota nº 12.' });
    expect(resultadoDaConsulta({ status: 'rejeitada', numero: 12, motivo: '539 - Duplicidade' })).toEqual({
      feita: true,
      texto: 'A SEFAZ rejeitou a nota nº 12 (539 - Duplicidade). Veja a nota no Regem para corrigir e emitir de novo.',
    });
    expect(resultadoDaConsulta({ status: 'cancelada' }).texto).toBe('A SEFAZ diz que a nota está cancelada.');
    expect(resultadoDaConsulta({ status: 'pendente' }).feita).toBe(false);
    expect(resultadoDaConsulta({}).feita).toBe(false);
    expect(textoDoDesfecho(true, 'A SEFAZ autorizou a nota nº 12.', '21:03')).toBe('✅ Feito às 21:03. A SEFAZ autorizou a nota nº 12.');
    expect(textoDoDesfecho(false, 'a SEFAZ continua sem responder.', '21:03')).toBe('Não deu: a SEFAZ continua sem responder.');
  });
});
