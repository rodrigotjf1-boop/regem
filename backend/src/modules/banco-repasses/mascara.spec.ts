import { descricaoCrua, ehLinhaDeSaldo, mascararDescricao, origemDaDescricao, resumoComSal, textoDaRegra } from './mascara';
import { fitidVale, maiorBuraco, prepararLinhas, situacaoDoTipo } from './banco-repasses.regras';
import type { LinhaOfx } from './ofx';

// A MÁSCARA (V8-3) e as regras puras do extrato. Exemplos no formato real dos bancos, com nomes e documentos inventados.

const linha = (o: Partial<LinhaOfx>): LinhaOfx => ({ tipo: 'CREDIT', data: '2026-11-05', valorCentavos: 1000, fitid: '', memo: '', nome: '', numeroDoCheque: '', ...o });

describe('máscara do extrato (V8-3)', () => {
  it.each([
    ['PIX RECEBIDO - FULANO DE TAL 123.456.789-00', 'PIX RECEBIDO · F*** T*** · CPF ***.456.***-**'],
    ['Pix enviado: Maria da Silva Souza', 'PIX ENVIADO · M*** S*** S***'],
    ['TED RECEBIDA 341 0001 JOAO PEREIRA CPF 111.444.777-35', 'TED RECEBIDA *** · J*** P*** · CPF ***.444.***-**'],
    ['DOC ENVIADO ANA B COSTA', 'DOC ENVIADO · A*** B*** C***'],
    ['TRANSFERENCIA RECEBIDA / CARLOS EDUARDO', 'TRANSFERENCIA RECEBIDA · C*** E***'],
    ['PIX ENVIADO HORTIFRUTI BOM PRECO LTDA 12.345.678/0001-90', 'PIX ENVIADO · HORTIFRUTI *** LTDA · CNPJ **.***.678/0001-**'],
    ['BOLETO DIST ALIMENTOS NORTE LTDA', 'BOLETO · DIST *** LTDA'],
    ['PIX RECEBIDO JOAO DA SILVA ME', 'PIX RECEBIDO · J*** S*** ME'],
    ['PIX RECEBIDO MARIA DE SA', 'PIX RECEBIDO · M*** S***'],
    ['TED RECEBIDA IFOOD', 'TED RECEBIDA IFOOD'],
    ['TED RECEBIDA 99 TECNOLOGIA', 'TED RECEBIDA 99 TECNOLOGIA'],
    ['PIX RECEBIDO CARDAPIO DIGITAL', 'PIX RECEBIDO CARDAPIO DIGITAL'],
    ['PAGTO SALARIOS LOTE 11', 'PAGTO SALARIOS LOTE 11'],
    ['CRED MAQUININHA LOTE 1103', 'CRED MAQUININHA LOTE 1103'],
    ['TARIFA PACOTE DE SERVICOS', 'TARIFA PACOTE DE SERVICOS'],
    ['CONTA DE LUZ E AGUA', 'CONTA DE LUZ E AGUA'],
    ['DAS SIMPLES NACIONAL', 'DAS SIMPLES NACIONAL'],
    ['RENDIMENTO DA CONTA', 'RENDIMENTO DA CONTA'],
  ])('%s', (cru, esperado) => expect(mascararDescricao(cru)).toBe(esperado));

  it.each([
    ['CPF sem pontos, válido', 'PIX ENVIADO 11144477735', '11144477735'],
    ['CNPJ sem pontos', 'PIX ENVIADO 12345678000190', '12345678000190'],
    ['celular com DDD', 'PIX RECEBIDO (21) 99876-5432', '99876'],
    ['celular em grupos', 'PIX ENVIADO +55 21 99876 5432', '5432'],
    ['celular sem pontuação', 'PIX ENVIADO 21998765432', '21998765432'],
    ['e-mail', 'PIX ENVIADO fulano.silva@exemplo.com.br', 'EXEMPLO'],
    ['agência e conta', 'TED ENVIADA AG 1234 CC 56789-0', '56789'],
    ['agência curta', 'TED ENVIADA AG 1234 CC 567', '1234'],
    ['conta colada na letra', 'TRANSF CC123456', '123456'],
  ])('não sobra %s', (_n, cru, proibido) => {
    const m = mascararDescricao(cru);
    expect(m).not.toContain(proibido);
    expect(m).not.toMatch(/\d{5,}/);
  });

  it('nenhum nome de pessoa sobra nos formatos comuns de Pix, TED e DOC', () => {
    const nomes = ['FULANO', 'BELTRANO', 'SICRANA'];
    const formatos = ['PIX RECEBIDO {n}', 'PIX ENVIADO - {n}', 'TED {n}', 'DOC RECEBIDO {n}', 'TRANSF {n}', 'PAGAMENTO {n}', 'DEP {n}', 'PIX QR CODE {n}', 'CRED PIX {n}'];
    for (const f of formatos) for (const n of nomes) expect(mascararDescricao(f.replace('{n}', `${n} DE TAL`))).not.toContain(n);
  });

  // Os formatos de cada banco, com nome e documento inventados.
  it.each([
    ['Itaú, com a data colada', 'PIX TRANSF FULANO18/11', ['FULANO']],
    ['Bradesco', 'TRANSFERENCIA PIX REM: Fulano de Tal 18/11', ['FULANO', 'TAL']],
    ['Caixa', 'PIX RECEBIDO CP :12345678-FULANO DE TAL', ['FULANO', '12345678']],
    ['Banco do Brasil', 'Pix - Recebido 18/11 14:32 00012345678 FULANO TAL', ['FULANO', '00012345678']],
    ['Nubank', 'Transferência recebida pelo Pix - FULANO DE TAL - •••.456.789-•• - BCO DO BRASIL S.A. (0001) Agência: 1234 Conta: 56789-0', ['FULANO', '456.789', '1234', '56789']],
    ['Sicoob, com pontos entre as palavras', 'CRÉD.TRANSF.PIX CONTA FULANO DE TAL', ['FULANO']],
    ['gatilho colado', 'PIXRECEBIDO FULANO', ['FULANO']],
    ['chave aleatória', 'PIX ENVIADO 123e4567-e89b-12d3-a456-426614174000', ['123E4567', '426614174000']],
    ['CNPJ com letras (desde 07/2026)', 'TARIFA 12.ABC.345/01DE-35', ['ABC', '01DE']],
    ['CNPJ com letras em Pix', 'PIX RECEBIDO 12.ABC.345/01DE-35 FULANO', ['ABC', '01DE', 'FULANO']],
    ['conta sem rótulo de transferência', 'TARIFA CONTA: 7788', ['7788']],
  ])('formato real: %s', (_n, cru, proibidos) => {
    const m = mascararDescricao(cru);
    for (const p of proibidos) expect(m).not.toContain(p);
    expect(m).not.toMatch(/\d{5,}/);
  });

  it.each([
    ['SAQUE FULANO', 'SAQUE · F***'],
    ['COMPRA CARTAO FULANO DE TAL', 'COMPRA CARTAO · F*** T***'],
    ['FULANO DE TAL', 'F*** T***'],
    ['MENSALIDADE FULANO', 'MENSALIDADE · F***'],
    ['PIX RECEBIDO MARIA DA LUZ', 'PIX RECEBIDO · M*** L***'],
    ['PIX RECEBIDO JOAO BRASIL', 'PIX RECEBIDO · J*** B***'],
    ['PIX RECEBIDO LUZ', 'PIX RECEBIDO · L***'],
    ['PIX ENVIADO JOAO SILVA TERCEIRO', 'PIX ENVIADO · J*** S*** T***'],
    ['TED RECEBIDA BANCO DO BRASIL', 'TED RECEBIDA BANCO DO BRASIL'],
    ['CRED REDE', 'CRED REDE'],
    ['MERCADO PAGO LIQUIDACAO', 'MERCADO PAGO LIQUIDACAO'],
    ['CESTA DE SERVICOS', 'CESTA DE SERVICOS'],
  ])('nome em qualquer linha, sem apagar o termo do banco: %s', (cru, esperado) => expect(mascararDescricao(cru)).toBe(esperado));

  it('o CNPJ com letras sai com o rótulo', () => {
    expect(mascararDescricao('TARIFA 12.ABC.345/01DE-35')).toBe('TARIFA · CNPJ **.***.***/****-**');
  });

  it('data não é documento; texto vazio não quebra', () => {
    expect(mascararDescricao('PIX RECEBIDO 22/11')).toContain('22/11');
    expect(mascararDescricao('PIX RECEBIDO 22/11/2026')).toContain('22/11/2026');
    expect(mascararDescricao('')).toBe('SEM DESCRICAO');
    expect(mascararDescricao('   ')).toBe('SEM DESCRICAO');
  });

  it('texto gigante ou estranho não trava nem quebra', () => {
    for (const t of ['1'.repeat(100_000), 'A '.repeat(50_000), '-.'.repeat(50_000), '@'.repeat(50_000), '(((('.repeat(20_000)]) {
      const ini = Date.now();
      expect(typeof mascararDescricao(t)).toBe('string');
      expect(Date.now() - ini).toBeLessThan(1500);
    }
  });

  it('NAME e MEMO viram uma descrição só, sem repetir', () => {
    expect(descricaoCrua('', 'PIX')).toBe('PIX');
    expect(descricaoCrua('PIX', '')).toBe('PIX');
    expect(descricaoCrua('FULANO', 'PIX RECEBIDO FULANO')).toBe('PIX RECEBIDO FULANO');
    expect(descricaoCrua('PIX RECEBIDO FULANO', 'FULANO')).toBe('PIX RECEBIDO FULANO');
    expect(descricaoCrua('FULANO', 'PIX RECEBIDO')).toBe('PIX RECEBIDO FULANO');
  });

  it('a regra casa por descrição e sentido, sem número (o lote muda) e o resumo depende do sal', () => {
    expect(textoDaRegra('CRED MAQUININHA LOTE 1103', 100)).toBe(textoDaRegra('Cred  Maquininha - lote 1106', 900));
    expect(textoDaRegra('TRANSFERENCIA', 100)).not.toBe(textoDaRegra('TRANSFERENCIA', -100));
    expect(textoDaRegra('12345', 100)).toBe('E|12345');
    const t = textoDaRegra('PIX FULANO', 100);
    expect(resumoComSal('a', t)).not.toBe(resumoComSal('b', t));
    expect(resumoComSal('a', t)).not.toContain('FULANO');
  });

  it.each([
    ['TED RECEBIDA IFOOD.COM AGENCIA', 100, 'ifood'],
    ['CRED IFOOD PAGO', 100, 'ifood_pago'],
    ['PIX ANOTA AI', 100, 'ifood_pago'],
    ['TED RECEBIDA 99 TECNOLOGIA', 100, '99'],
    ['CRED 99FOOD', 100, '99'],
    ['CRED STONE PAGAMENTOS', 100, 'maquininha'],
    ['CIELO VENDAS', 100, 'maquininha'],
    ['MERCADO PAGO LIQUIDACAO', 100, 'maquininha'],
    ['PIX RECEBIDO 99 REAIS', 100, 'banco'],
    ['PIX RECEBIDO FULANO', 100, 'banco'],
    ['TARIFA STONE', -100, 'banco'],
    ['PIX ENVIADO IFOOD', -100, 'banco'],
  ])('origem de "%s" (%d) = %s', (t, v, o) => expect(origemDaDescricao(t, v)).toBe(o));

  it('linha que só informa saldo', () => {
    for (const t of ['S A L D O', 'SALDO DO DIA', 'Saldo anterior', 'SALDO']) expect(ehLinhaDeSaldo(t)).toBe(true);
    for (const t of ['SALDO DEVEDOR JUROS', 'PIX RECEBIDO', 'PAGAMENTO SALDO FORNECEDOR']) expect(ehLinhaDeSaldo(t)).toBe(false);
  });
});

describe('a chave do lançamento', () => {
  const SAL = 'sal-de-teste';
  const chaves = (l: LinhaOfx[]) => prepararLinhas(SAL, { linhas: l }).lancamentos.map((x) => x.chave);

  it('o mesmo FITID + data + valor dá a mesma chave em outra exportação, mesmo com a descrição mudada', () => {
    expect(chaves([linha({ fitid: 'ABC', memo: 'PIX FULANO' })])).toEqual(chaves([linha({ fitid: 'ABC', memo: 'PIX RECEBIDO FULANO' })]));
  });

  it('banco que repete o FITID em linhas diferentes: não colapsa nem duplica', () => {
    const c = chaves([linha({ fitid: 'R', memo: 'A' }), linha({ fitid: 'R', memo: 'B' }), linha({ fitid: 'R', memo: 'A' })]);
    expect(new Set(c).size).toBe(3);
  });

  it('FITID vazio: dois Pix iguais no mesmo dia são dois, e reimportar dá as mesmas chaves', () => {
    const l = [linha({ memo: 'PIX X' }), linha({ memo: 'PIX X' }), linha({ memo: 'PIX Y' })];
    const a = chaves(l);
    expect(new Set(a).size).toBe(3);
    expect(chaves(l)).toEqual(a);
  });

  it('sem FITID, outra exportação com mais linhas no dia não muda a chave das que já entraram', () => {
    const antes = chaves([linha({ memo: 'PIX A' }), linha({ memo: 'PIX B' })]);
    const depois = chaves([linha({ memo: 'PIX Z' }), linha({ memo: 'PIX A' }), linha({ memo: 'PIX C' }), linha({ memo: 'PIX B' })]);
    expect(depois).toEqual(expect.arrayContaining(antes));
  });

  it('FITID que é só a numeração do arquivo não vale como identidade', () => {
    for (const f of ['1', '2', '0', '9001', '000123', '0000000012', '9999999', '', '  ']) expect(fitidVale(f)).toBe(false);
    for (const f of ['A', 'ABC123', '10000000', '20261101000123', 'e3b0c442-98fc']) expect(fitidVale(f)).toBe(true);
    const a = chaves([linha({ fitid: '1', memo: 'PIX A' }), linha({ fitid: '2', memo: 'PIX B' })]);
    const b = chaves([linha({ fitid: '1', memo: 'PIX B' }), linha({ fitid: '2', memo: 'PIX A' })]);
    expect(new Set([...a, ...b]).size).toBe(2);
  });

  it('banco que numera as linhas, com a linha de saldo no meio: outra exportação não duplica', () => {
    const a = chaves([linha({ fitid: '1', memo: 'PIX A' }), linha({ fitid: '2', memo: 'SALDO DO DIA' }), linha({ fitid: '3', memo: 'PIX B' })]);
    const b = chaves([linha({ fitid: '1', memo: 'PIX Z' }), linha({ fitid: '2', memo: 'PIX A' }), linha({ fitid: '3', memo: 'SALDO DO DIA' }), linha({ fitid: '4', memo: 'PIX B' })]);
    expect(b).toEqual(expect.arrayContaining(a));
  });

  it('arquivo de uma linha só, com a numeração do banco: a exportação maior não duplica', () => {
    const a = chaves([linha({ fitid: '1', memo: 'PIX A' })]);
    const b = chaves([linha({ fitid: '1', memo: 'PIX Z' }), linha({ fitid: '2', memo: 'PIX A' })]);
    expect(b).toEqual(expect.arrayContaining(a));
  });

  it('PDV-F-01: arquivo de uma linha com FITID "1" e depois o maior com "1" e "20" — a mesma transação tem a mesma chave', () => {
    // Antes: o arquivo curto parecia numeração (chave pelo conteúdo) e o maior não (chave pelo FITID): duas chaves, duas linhas.
    const curto = chaves([linha({ fitid: '1', memo: 'PIX A' })]);
    const maior = chaves([linha({ fitid: '1', memo: 'PIX A' }), linha({ fitid: '20', memo: 'PIX B' })]);
    expect(maior).toEqual(expect.arrayContaining(curto));
    expect(new Set([...curto, ...maior]).size).toBe(2);
    // e na ordem inversa (o maior primeiro): o curto não traz nada novo
    expect(maior).toEqual(expect.arrayContaining(chaves([linha({ fitid: '1', memo: 'PIX A' })])));
  });

  it('PDV-F-01: a escolha da chave não depende das outras linhas do arquivo', () => {
    const sozinha = (f: string) => chaves([linha({ fitid: f, memo: 'PIX A' })])[0];
    const comOutras = (f: string) => chaves([linha({ fitid: 'XYZ-9', memo: 'PIX Q' }), linha({ fitid: f, memo: 'PIX A' }), linha({ fitid: '7', memo: 'PIX W' })])[1];
    for (const f of ['1', '0', '20', 'ABC123', '']) expect(comOutras(f)).toBe(sozinha(f));
  });

  it('PDV-F-01: dois Pix legítimos com a mesma data, valor e descrição continuam dois, com e sem FITID, em qualquer exportação', () => {
    const semFitid = [linha({ memo: 'PIX X' }), linha({ memo: 'PIX X' })];
    const comFitid = [linha({ fitid: 'P-1', memo: 'PIX X' }), linha({ fitid: 'Q-2', memo: 'PIX X' })];
    const numerados = [linha({ fitid: '1', memo: 'PIX X' }), linha({ fitid: '2', memo: 'PIX X' })];
    for (const l of [semFitid, comFitid, numerados]) {
      const c = chaves(l);
      expect(new Set(c).size).toBe(2);
      // a exportação do dia seguinte (o mesmo dia inteiro + outro lançamento) não duplica nenhum dos dois
      expect(chaves([...l, linha({ fitid: 'Z-3', memo: 'PIX Y' })])).toEqual(expect.arrayContaining(c));
    }
    // o banco que repete o FITID no mesmo dia e valor: as duas ficam, e a primeira mantém a chave de sempre
    const repetido = chaves([linha({ fitid: 'R-1', memo: 'PIX X' }), linha({ fitid: 'R-1', memo: 'PIX X' })]);
    expect(new Set(repetido).size).toBe(2);
    expect(repetido[0]).toBe(chaves([linha({ fitid: 'R-1', memo: 'PIX X' })])[0]);
  });

  it('a linha que só informa saldo e a de valor zero não viram lançamento, e nada cru fica no preparado', () => {
    const r = prepararLinhas(SAL, {
      linhas: [linha({ memo: 'SALDO DO DIA', valorCentavos: 5000 }), linha({ memo: 'X', valorCentavos: 0 }), linha({ fitid: 'F', memo: 'PIX RECEBIDO - FULANO DE TAL 123.456.789-00' })],
    });
    expect(r.informativas).toBe(2);
    expect(r.lancamentos).toHaveLength(1);
    const s = JSON.stringify(r.lancamentos);
    expect(s).not.toContain('FULANO');
    expect(s).not.toContain('123.456');
    expect(r.lancamentos[0].descricao).toBe('PIX RECEBIDO · F*** T*** · CPF ***.456.***-**');
  });

  it('a situação: a descrição do iFood fica a conferir; a de um Pix qualquer, só no banco; "Não é da loja" tira', () => {
    const r = prepararLinhas(SAL, { linhas: [linha({ fitid: 'A', memo: 'TED RECEBIDA IFOOD' }), linha({ fitid: 'B', memo: 'PIX RECEBIDO FULANO' })] });
    expect(r.lancamentos.map((x) => [x.fonte, x.situacao])).toEqual([['ifood', 'a_conferir'], ['banco', 'so_no_banco']]);
    expect(situacaoDoTipo('nao_e_da_loja', 'ifood')).toBe('nao_e_da_loja');
    expect(situacaoDoTipo('fornecedor', 'ifood')).toBe('a_conferir');
    expect(situacaoDoTipo(null, 'banco')).toBe('so_no_banco');
  });
});

describe('o período sem lançamento', () => {
  it('acha o maior trecho, dentro do período e nas pontas', () => {
    expect(maiorBuraco(['2026-11-01', '2026-11-08', '2026-11-16', '2026-11-20'], '2026-11-01', '2026-11-20')).toEqual({ de: '2026-11-09', ate: '2026-11-15', dias: 7 });
    expect(maiorBuraco(['2026-11-10', '2026-11-11'], '2026-11-01', '2026-11-11')).toEqual({ de: '2026-11-01', ate: '2026-11-09', dias: 9 });
    expect(maiorBuraco(['2026-11-01', '2026-11-02'], '2026-11-01', '2026-11-20')).toEqual({ de: '2026-11-03', ate: '2026-11-20', dias: 18 });
  });

  it('trecho curto não é buraco; sem linha não há o que medir; atravessa o mês', () => {
    expect(maiorBuraco(['2026-11-01', '2026-11-05'], '2026-11-01', '2026-11-05')).toBeNull();
    expect(maiorBuraco([], '2026-11-01', '2026-11-30')).toBeNull();
    expect(maiorBuraco(['2026-10-29', '2026-11-05'], null, null)).toEqual({ de: '2026-10-30', ate: '2026-11-04', dias: 6 });
  });
});
