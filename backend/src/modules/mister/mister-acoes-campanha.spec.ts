import { acharCampanhaDaLista, apresentacaoDaCampanha, conferirCampanha, nomeDaCampanha, recusaDaRepeticao, resumoDaRepeticao, textoDoCusto, type LinhaDaCampanha } from './mister-acoes-campanha';
import { ACOES, conferirAcao } from './mister-acoes';

const camp = (x: Partial<LinhaDaCampanha>): LinhaDaCampanha => ({
  id: 'c-' + (x.tipo ?? 'avulsa'),
  segmento: 'todos',
  tipo: 'avulsa',
  mensagem: 'Chegou o smash de costela, peça já',
  status: 'concluida',
  criado_em: '2026-11-20T14:00:00Z',
  total: 380,
  enviados: 377,
  ...x,
});

describe('as campanhas pela conversa (etapa 8 de 24/11)', () => {
  it('pausar é de botão e repetir é de PIN, pela permissão de Delivery › Marketing', () => {
    expect(ACOES.pausar_campanha).toMatchObject({ nivel: 'botao', permissao: 'delivery' });
    expect(ACOES.repetir_campanha).toMatchObject({ nivel: 'pin', permissao: 'delivery' });
  });

  it('a conferência pede qual campanha; nunca recebe mensagem', () => {
    expect(conferirCampanha('repetir_campanha', {})).toEqual({ erro: 'Diga qual campanha (um pedaço da mensagem, o tipo ou "a última").' });
    expect(conferirCampanha('pausar_campanha', { campanhaDaConversa: 'frete grátis' })).toEqual({
      parametros: { acao: 'pausar_campanha', campanha: 'frete grátis', retomar: false },
      resumo: 'Pausar a campanha "frete grátis".',
    });
    expect(conferirCampanha('pausar_campanha', { campanhaDaConversa: 'a última', retomarCampanha: true })).toMatchObject({ parametros: { retomar: true } });
    expect(conferirAcao('repetir_campanha', { campanhaDaConversa: 'a última', mensagem: 'texto novo' })).toEqual({
      parametros: { acao: 'repetir_campanha', campanha: 'a última' },
      resumo: 'Repetir a campanha "a última" para o mesmo público.',
    });
  });

  it('acha pela "última", por um pedaço da mensagem ou pelo tipo; duas viram pergunta', () => {
    const frete = camp({ id: 'f', tipo: 'frete_gratis', mensagem: 'Hoje o frete é grátis acima de R$ 40' });
    const smash = camp({ id: 's' });
    const smash2 = camp({ id: 's2', mensagem: 'Smash em dobro hoje' });
    const quando = () => '20/11 11:00';
    expect(acharCampanhaDaLista([frete, smash], 'a última', quando)).toEqual({ linha: frete });
    expect(acharCampanhaDaLista([frete, smash], 'costela', quando)).toEqual({ linha: smash });
    expect(acharCampanhaDaLista([frete, smash], 'frete grátis', quando)).toEqual({ linha: frete });
    expect(acharCampanhaDaLista([frete, smash, smash2], 'smash', quando)).toEqual({
      erro: 'Há mais de uma campanha assim: a campanha avulsa de 20/11 11:00 ("Chegou o smash de costela, peça já"); a campanha avulsa de 20/11 11:00 ("Smash em dobro hoje"). Diga um pedaço da mensagem que só uma tem.',
    });
    expect(acharCampanhaDaLista([], 'x', quando)).toEqual({ erro: 'Não há campanha em Delivery › Marketing.' });
    expect(nomeDaCampanha(camp({ mensagem: 'x'.repeat(60) }), '20/11 11:00')).toBe(`a campanha avulsa de 20/11 11:00 ("${'x'.repeat(50)}…")`);
  });

  it('o que só se repete na tela', () => {
    expect(recusaDaRepeticao(camp({}))).toBeNull();
    expect(recusaDaRepeticao(camp({ clube_premio_id: 'p' }))).toContain('prêmio do Clube');
    expect(recusaDaRepeticao(camp({ envio_habitual: true }))).toContain('hora habitual');
    expect(recusaDaRepeticao(camp({ agendada: true }))).toContain('agendada');
    expect(recusaDaRepeticao({ ...camp({}), cupom_codigo: 'FRETE10' })).toContain('cupom');
    expect(recusaDaRepeticao(camp({ segmento: 'recuperacao' }))).toContain('não pede há N dias');
    expect(recusaDaRepeticao(camp({ mensagem: '' }))).toBe('Essa campanha não tem mensagem guardada: repetir só pela tela.');
    expect(recusaDaRepeticao(camp({ mensagem: '', template_nome: 'oferta_semana' }))).toBeNull();
  });

  it('o custo antes, o resumo e a página do PIN', () => {
    expect(textoDoCusto(false, null)).toBe('Pela conexão por QR Code a Meta não cobra, mas mandar para muita gente tem risco de bloqueio do número.');
    expect(textoDoCusto(true, { estimativa: 128.68, preco: 0.3217, fonte: 'tabela' })).toBe('Custo estimado: R$ 128,68 (R$ 0,32 por mensagem, pelo preço publicado da Meta).');
    expect(textoDoCusto(true, null)).toBe('O custo não pôde ser estimado agora.');
    expect(resumoDaRepeticao('a campanha avulsa de 20/11 11:00', { total: 400, foraPorOferta: 12 }, 'Custo estimado: R$ 128,68.')).toBe(
      'Repetir a campanha avulsa de 20/11 11:00 AGORA, para o mesmo público: 400 clientes (12 ficam de fora por terem recebido oferta há pouco). Custo estimado: R$ 128,68. Quem pediu para sair não recebe.',
    );
    expect(apresentacaoDaCampanha({ nomeDaCampanha: 'a campanha avulsa', publico: 400, textoDoCusto: 'Custo estimado: R$ 128,68.', estimativa: 128.68 })).toEqual({
      titulo: 'Repetir a campanha',
      itens: ['Campanha: a campanha avulsa', 'Clientes: 400', 'Custo estimado: R$ 128,68.'],
      detalhe: 'Começa a mandar logo depois do PIN. Para parar, peça para pausar a campanha.',
      valor: 128.68,
      botao: 'Repetir a campanha',
    });
  });
});
