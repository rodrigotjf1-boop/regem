import {
  FRASES_DO_DOCUMENTO,
  LeituraDaFoto,
  centavosDoTexto,
  decidirDocumento,
  diaComSemana,
  lerLeituraDaFoto,
  lerRespostaDoQueFaltou,
} from './documento-por-foto';

// O DOCUMENTO POR FOTO (M3a, conversas 11 a 13 do protótipo aprovado): a IA lê, o código confere, e a decisão é pura.
// As linhas digitáveis são as do teste do boleto (calculadas à mão): o bancário de R$ 1.284,90 para 25/11/2026 e a conta
// de luz de R$ 480,00 (o vencimento não está no código).

const HOJE = new Date(Date.UTC(2026, 10, 17));
const BANCARIO = '00191234546789012345767890123457716410000128490';
const CONTA = '836400000045800001234569789012345672890123456786';

const leitura = (p: Partial<LeituraDaFoto>): LeituraDaFoto => ({
  tipo: 'boleto',
  linhaDigitavel: null,
  beneficiario: 'Distribuidora Sabor Ltda.',
  cnpj: null,
  valorCentavos: null,
  vencimento: null,
  legivel: true,
  ...p,
});

describe('o que a IA devolve', () => {
  it('lê o JSON, mesmo com texto em volta, e normaliza os campos', () => {
    const r = lerLeituraDaFoto('Aqui está: {"tipo":"Boleto","linhaDigitavel":"00191.23454 67890.123457 67890.123457 7 16410000128490","beneficiario":"  Distribuidora   Sabor ","cnpj":"12.345.678/0001-90","valor":"1.284,90","vencimento":"2026-11-25","legivel":true} fim');
    expect(r).toEqual({
      tipo: 'boleto',
      linhaDigitavel: BANCARIO,
      beneficiario: 'Distribuidora Sabor',
      cnpj: '12345678000190',
      valorCentavos: 128490,
      vencimento: '2026-11-25',
      legivel: true,
    });
  });
  it('fora do formato: nada (o Mister pede outra foto, não chuta)', () => {
    expect(lerLeituraDaFoto('não consegui')).toBeNull();
    expect(lerLeituraDaFoto('{"tipo":"cheque"}')).toBeNull();
    expect(lerLeituraDaFoto('{quebrado')).toBeNull();
  });
  it('linha curta, CNPJ incompleto e data impossível viram null', () => {
    const r = lerLeituraDaFoto('{"tipo":"conta","linhaDigitavel":"8364","cnpj":"123","vencimento":"2026-02-30","valor":"abc"}');
    expect(r).toMatchObject({ linhaDigitavel: null, cnpj: null, vencimento: null, valorCentavos: null });
  });
  it('os valores como aparecem impressos', () => {
    expect(centavosDoTexto('1.284,90')).toBe(128490);
    expect(centavosDoTexto('R$ 480,00')).toBe(48000);
    expect(centavosDoTexto('1284.90')).toBe(128490);
    expect(centavosDoTexto('1.284')).toBe(128400);
    expect(centavosDoTexto('480')).toBe(48000);
    expect(centavosDoTexto('0,00')).toBeNull();
    expect(centavosDoTexto('')).toBeNull();
  });
});

describe('a decisão', () => {
  it('boleto bancário com o código conferido e fornecedor cadastrado: lança sozinho, com o valor e o vencimento do código', () => {
    // A IA leu o valor errado (R$ 1.248,90): vale o do código.
    const d = decidirDocumento(leitura({ linhaDigitavel: BANCARIO, valorCentavos: 124890 }), true, 'sozinho', HOJE);
    expect(d).toMatchObject({ acao: 'lancar', dados: { tipo: 'boleto', valorCentavos: 128490, vencimento: '2026-11-25', origem: { valor: 'codigo', vencimento: 'codigo' } } });
  });
  it('fornecedor novo: confirma antes', () => {
    expect(decidirDocumento(leitura({ linhaDigitavel: BANCARIO }), false, 'sozinho', HOJE)).toMatchObject({ acao: 'confirmar', porque: 'fornecedor_novo' });
  });
  it('a empresa no modo "pergunta antes": confirma mesmo com tudo certo', () => {
    expect(decidirDocumento(leitura({ linhaDigitavel: BANCARIO }), true, 'perguntar', HOJE)).toMatchObject({ acao: 'confirmar', porque: 'modo' });
  });
  it('conta de consumo: o valor do código, o vencimento da foto, e confirma antes', () => {
    const d = decidirDocumento(leitura({ tipo: 'conta', linhaDigitavel: CONTA, vencimento: '2026-11-30', beneficiario: 'Gás Rio' }), true, 'sozinho', HOJE);
    expect(d).toMatchObject({ acao: 'confirmar', porque: 'conta', dados: { tipo: 'conta', valorCentavos: 48000, vencimento: '2026-11-30', origem: { valor: 'codigo', vencimento: 'ia' } } });
  });
  it('conta sem o vencimento legível: pergunta só o vencimento', () => {
    expect(decidirDocumento(leitura({ tipo: 'conta', linhaDigitavel: CONTA }), true, 'sozinho', HOJE)).toMatchObject({ acao: 'perguntar', falta: ['vencimento'] });
  });
  it('linha digitável lida com um número errado: outra foto (nunca vira outro boleto)', () => {
    const errada = BANCARIO.slice(0, 30) + (BANCARIO[30] === '9' ? '0' : '9') + BANCARIO.slice(31);
    expect(decidirDocumento(leitura({ linhaDigitavel: errada, valorCentavos: 128490, vencimento: '2026-11-25' }), true, 'sozinho', HOJE)).toEqual({ acao: 'outra_foto', porque: 'codigo_nao_confere' });
  });
  it('sem código, com valor e vencimento lidos: confirma antes (entra sem a linha)', () => {
    expect(decidirDocumento(leitura({ valorCentavos: 48000, vencimento: '2026-11-30' }), true, 'sozinho', HOJE)).toMatchObject({ acao: 'confirmar', porque: 'sem_codigo' });
  });
  it('sem código e sem valor: pergunta o que faltou', () => {
    expect(decidirDocumento(leitura({ vencimento: '2026-11-30' }), true, 'sozinho', HOJE)).toMatchObject({ acao: 'perguntar', falta: ['valor'] });
  });
  it('foto ilegível sem código (conversa 13): pergunta o valor e o vencimento — o que a IA leu numa foto ruim não vale', () => {
    expect(decidirDocumento(leitura({ legivel: false }), true, 'sozinho', HOJE)).toMatchObject({ acao: 'perguntar', falta: ['valor', 'vencimento'] });
    expect(decidirDocumento(leitura({ legivel: false, valorCentavos: 48000 }), true, 'sozinho', HOJE)).toMatchObject({
      acao: 'perguntar',
      falta: ['valor', 'vencimento'],
      dados: { valorCentavos: null, vencimento: null, beneficiario: 'Distribuidora Sabor Ltda.' },
    });
    // Ilegível, mas com os dois lidos: não dá para confiar nem para perguntar — outra foto.
    expect(decidirDocumento(leitura({ legivel: false, valorCentavos: 48000, vencimento: '2026-11-30' }), true, 'sozinho', HOJE)).toEqual({ acao: 'outra_foto', porque: 'ilegivel' });
  });
  it('nota do fornecedor e outra imagem', () => {
    expect(decidirDocumento(leitura({ tipo: 'nota' }), true, 'sozinho', HOJE)).toEqual({ acao: 'nota' });
    expect(decidirDocumento(leitura({ tipo: 'outro' }), true, 'sozinho', HOJE)).toEqual({ acao: 'nao_e_documento' });
  });
});

describe('as frases', () => {
  it('o dia com a semana', () => {
    expect(diaComSemana('2026-11-25')).toBe('25/11 (quarta)');
    expect(diaComSemana('2026-11-30')).toBe('30/11 (segunda)');
  });
  it('lançado: o que leu e que confere (conversa 11)', () => {
    const d = decidirDocumento(leitura({ linhaDigitavel: BANCARIO }), true, 'sozinho', HOJE);
    if (d.acao !== 'lancar') throw new Error('esperava lançar');
    expect(FRASES_DO_DOCUMENTO.lancado(d.dados)).toBe(
      '📄 Boleto · Distribuidora Sabor Ltda.\nR$ 1.284,90 · vence 25/11 (quarta)\n\nO código de barras confere com o valor e o vencimento, e Distribuidora Sabor Ltda. já é seu fornecedor. Lancei nas contas a pagar.',
    );
  });
  it('a pergunta do que faltou: outra foto OU dizer o que faltou (conversa 13)', () => {
    expect(FRASES_DO_DOCUMENTO.perguntar(['valor', 'vencimento'])).toBe(
      'Não consegui ler o valor nem o vencimento com certeza.\n\nManda outra foto com o documento inteiro, de perto e com luz. Ou me diz o valor e o vencimento (por exemplo: 480,00, vence dia 30).',
    );
    expect(FRASES_DO_DOCUMENTO.perguntar(['vencimento'])).toContain('Ou me diz o vencimento (por exemplo: vence dia 30).');
  });
  it('completado na conversa: "Lanço assim?" (conversa 13)', () => {
    const d = decidirDocumento(leitura({ beneficiario: 'Gás Rio', valorCentavos: 48000, vencimento: '2026-11-30' }), true, 'sozinho', HOJE);
    if (d.acao !== 'confirmar') throw new Error('esperava confirmar');
    expect(FRASES_DO_DOCUMENTO.confirmar(d.dados, 'informado')).toBe(
      '📄 Boleto · Gás Rio\nR$ 480,00 · vence 30/11 (segunda)\n\nSem o código de barras, ele entra sem a linha para pagar. Lanço assim?',
    );
  });
});

describe('a resposta em texto ao que faltou', () => {
  const ambos: Array<'valor' | 'vencimento'> = ['valor', 'vencimento'];
  it('a frase da conversa 13', () => {
    expect(lerRespostaDoQueFaltou('vence dia 30, 480 reais, é do gás', ambos, HOJE)).toEqual({ valorCentavos: 48000, vencimento: '2026-11-30' });
  });
  it('as formas da data: dd/mm, dd/mm/aaaa, "30 de novembro", "dia 5" (o próximo dia 5)', () => {
    expect(lerRespostaDoQueFaltou('30/11', ['vencimento'], HOJE)).toEqual({ vencimento: '2026-11-30' });
    expect(lerRespostaDoQueFaltou('vence 05/01/2027', ['vencimento'], HOJE)).toEqual({ vencimento: '2027-01-05' });
    expect(lerRespostaDoQueFaltou('vence 5/1', ['vencimento'], HOJE)).toEqual({ vencimento: '2027-01-05' });
    expect(lerRespostaDoQueFaltou('vence 10/11', ['vencimento'], HOJE)).toEqual({ vencimento: '2026-11-10' }); // atrasado: este ano
    expect(lerRespostaDoQueFaltou('30 de novembro', ['vencimento'], HOJE)).toEqual({ vencimento: '2026-11-30' });
    expect(lerRespostaDoQueFaltou('dia 5', ['vencimento'], HOJE)).toEqual({ vencimento: '2026-12-05' });
    expect(lerRespostaDoQueFaltou('31/02', ['vencimento'], HOJE)).toBeNull();
  });
  it('as formas do valor, sem pegar os números da data', () => {
    expect(lerRespostaDoQueFaltou('R$ 1.284,90 vence 25/11', ambos, HOJE)).toEqual({ valorCentavos: 128490, vencimento: '2026-11-25' });
    expect(lerRespostaDoQueFaltou('480,00', ['valor'], HOJE)).toEqual({ valorCentavos: 48000 });
    expect(lerRespostaDoQueFaltou('25/11 e o valor é 90', ambos, HOJE)).toEqual({ valorCentavos: 9000, vencimento: '2026-11-25' });
  });
  it('só o que foi pedido; nada reconhecido = null (vira pergunta ao Mister)', () => {
    expect(lerRespostaDoQueFaltou('480 reais vence dia 30', ['vencimento'], HOJE)).toEqual({ vencimento: '2026-11-30' });
    expect(lerRespostaDoQueFaltou('quanto vendi hoje?', ambos, HOJE)).toBeNull();
  });
});
