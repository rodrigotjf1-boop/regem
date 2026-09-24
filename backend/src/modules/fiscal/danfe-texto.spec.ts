import { montarDanfeTexto } from './danfe-texto';

// K6 — este texto é o DOCUMENTO que chega na mão do consumidor. Cada asserção aqui
// guarda uma exigência do Manual do DANFE NFC-e (Anexo IV do MOC) ou uma tarja que
// impede entregar como fiscal algo que não é.
describe('montarDanfeTexto (K6)', () => {
  const nota = {
    serie: 51,
    numero: 2,
    ambiente: '1',
    simulada: false,
    status: 'autorizada',
    valorTotal: 23.5,
    chave: '33260900000000000191650510000000021000000029',
    protocolo: '333260002547395',
    qrcode: 'https://www.nfce.fazenda.rj.gov.br/consulta?p=3326...|2|1|1|ABC',
  };
  const itens = [
    { descricao: 'X-BURGER', quantidade: 2, precoUnitario: 10 },
    { descricao: 'REFRI LATA', quantidade: 1, precoUnitario: 3.5 },
  ];

  it('traz o que identifica a nota: série, número, chave e protocolo', () => {
    const t = montarDanfeTexto(nota, itens);
    expect(t).toContain('DANFE NFC-e');
    expect(t).toContain('Serie 51 No 2');
    expect(t).toContain(`Chave: ${nota.chave}`);
    expect(t).toContain('Protocolo: 333260002547395');
  });

  it('o QR vai como MARCADOR (@QR:), para ser desenhado — nunca como endereço em texto', () => {
    const t = montarDanfeTexto(nota, itens);
    expect(t).toContain(`@QR:${nota.qrcode}`);
    // A linha do QR é só dele: o conversor centraliza a linha inteira.
    expect(t.split('\n').some((l) => l === `@QR:${nota.qrcode}`)).toBe(true);
  });

  it('lista os itens com quantidade e valor da linha', () => {
    const t = montarDanfeTexto(nota, itens);
    expect(t).toContain('2x X-BURGER');
    expect(t).toContain('R$ 20,00'.replace(/ /g, ' ').trim().slice(0, 2)); // moeda pt-BR
    expect(t).toMatch(/2x X-BURGER\n\s+R\$\s?20,00/);
    expect(t).toMatch(/1x REFRI LATA\n\s+R\$\s?3,50/);
  });

  it('tarja SEM VALOR FISCAL em homologação E em nota simulada (ERR-088)', () => {
    expect(montarDanfeTexto({ ...nota, ambiente: '2' }, itens)).toContain(
      '*** SEM VALOR FISCAL ***',
    );
    // Simulada em ambiente de PRODUÇÃO é o caso perigoso: sem a tarja sai com cara de válida.
    expect(montarDanfeTexto({ ...nota, simulada: true }, itens)).toContain(
      '*** SEM VALOR FISCAL ***',
    );
    expect(montarDanfeTexto(nota, itens)).not.toContain('SEM VALOR FISCAL');
  });

  it('contingência: a mensagem exigida pela norma sai no papel', () => {
    const t = montarDanfeTexto({ ...nota, status: 'contingencia', protocolo: null }, itens);
    expect(t).toContain('*** EMITIDA EM CONTINGENCIA ***');
    // Sem protocolo ainda — a autorização vem depois, e o papel não pode inventar um.
    expect(t).toContain('Protocolo: -');
    expect(montarDanfeTexto(nota, itens)).not.toContain('CONTINGENCIA');
  });

  it('diz quem é o consumidor — identificado ou não', () => {
    expect(montarDanfeTexto(nota, itens)).toContain('CONSUMIDOR NAO IDENTIFICADO');
    const t = montarDanfeTexto(nota, itens, { consumidor: '12345678909' });
    expect(t).toContain('CONSUMIDOR: CPF 123.456.789-09');
  });

  it('desconto e entrega aparecem, senão o total não bate com a soma impressa', () => {
    const t = montarDanfeTexto({ ...nota, valorTotal: 26 }, itens, {
      desconto: 2.5,
      frete: 5,
    });
    expect(t).toMatch(/DESCONTO: -R\$\s?2,50/);
    expect(t).toMatch(/ENTREGA: R\$\s?5,00/);
    expect(t).toMatch(/TOTAL: R\$\s?26,00/);
    // Sem valor, a linha não polui o cupom.
    expect(montarDanfeTexto(nota, itens)).not.toContain('ENTREGA');
  });

  // Lei estadual 5.817/10 (RJ): telefone e endereço do PROCON-RJ e da Comissão de Defesa do
  // Consumidor da ALERJ IMPRESSOS no campo de mensagem de interesse do contribuinte do DANFE.
  // Estar só no XML não cumpre — a lei fala do documento que o consumidor leva.
  it('no RJ, o rodapé do PROCON e da ALERJ sai impresso, no fim do documento', () => {
    const t = montarDanfeTexto(nota, itens, { uf: 'RJ' });
    expect(t).toContain('PROCON-RJ: 151');
    expect(t).toContain('0800 282 7060');
    expect(t.indexOf('PROCON-RJ')).toBeGreaterThan(t.indexOf('@QR:'));
  });

  it('fora do RJ (ou sem UF), nenhum rodapé estadual é inventado', () => {
    expect(montarDanfeTexto(nota, itens, { uf: 'SP' })).not.toContain('PROCON');
    expect(montarDanfeTexto(nota, itens)).not.toContain('PROCON');
  });
});
