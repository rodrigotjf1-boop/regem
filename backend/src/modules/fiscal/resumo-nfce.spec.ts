import { resumoNfce } from './resumo-nfce';

// F1 — este é o contrato de quem IMPRIME o cupom fiscal. Faltar QR ou protocolo aqui
// significa DANFE inválido na mão do cliente; faltar `simulada` ou `contingencia`
// significa entregar como documento fiscal algo que não é (ou sem a mensagem que a
// norma exige).
describe('resumoNfce (F1)', () => {
  const autorizada = {
    status: 'autorizada',
    chave: '33260900000000000191650510000000021000000029',
    numero: 2,
    serie: 51,
    protocolo: '333260002547395',
    qrcode: 'https://www.homologacao.nfce.fazenda.rj.gov.br/consulta?p=3326...|2|2|1|ABC',
    ambiente: '2',
    simulada: false,
    xml: '<NFe>…</NFe>',
    emitidaEm: new Date('2026-09-22T18:30:00.000Z'),
  };

  it('entrega o necessário para imprimir o DANFE', () => {
    const r = resumoNfce(autorizada)!;
    expect(r.chave).toBe(autorizada.chave);
    expect(r.numero).toBe(2);
    expect(r.serie).toBe(51);
    expect(r.protocolo).toBe('333260002547395');
    expect(r.qrcode).toBe(autorizada.qrcode);
    expect(r.emitidaEm).toBe('2026-09-22T18:30:00.000Z');
  });

  it('NÃO manda o XML (a guarda dos 5 anos é do emitente, não do aparelho)', () => {
    expect('xml' in (resumoNfce(autorizada) as any)).toBe(false);
  });

  it('marca nota SIMULADA — ela não é documento fiscal', () => {
    expect(resumoNfce({ ...autorizada, simulada: true })!.simulada).toBe(true);
    expect(resumoNfce(autorizada)!.simulada).toBe(false);
  });

  it('marca CONTINGÊNCIA (o DANFE precisa da mensagem exigida pela norma)', () => {
    expect(resumoNfce({ ...autorizada, status: 'contingencia' })!.contingencia).toBe(true);
    expect(resumoNfce(autorizada)!.contingencia).toBe(false);
  });

  it('ambiente vem sempre preenchido; sem informação, assume homologação', () => {
    expect(resumoNfce(autorizada)!.ambiente).toBe('2');
    expect(resumoNfce({ ...autorizada, ambiente: '1' })!.ambiente).toBe('1');
    // Ausente → '2' (homologação): o padrão seguro é NÃO afirmar que vale como fiscal.
    expect(resumoNfce({ status: 'autorizada' })!.ambiente).toBe('2');
  });

  it('nota rejeitada/pendente passa com os campos vazios, sem quebrar', () => {
    const r = resumoNfce({ status: 'rejeitada', numero: 7, serie: 51 })!;
    expect(r.status).toBe('rejeitada');
    expect(r.chave).toBeNull();
    expect(r.qrcode).toBeNull();
    expect(r.protocolo).toBeNull();
  });

  it('sem nota, devolve null (fiscal desligado na loja)', () => {
    expect(resumoNfce(null)).toBeNull();
    expect(resumoNfce(undefined)).toBeNull();
  });
});
