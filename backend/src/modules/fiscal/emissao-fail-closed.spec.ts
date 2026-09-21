import { camposFaltando, urlConsultaQr } from './emitente';
import {
  SefazDiretoTransmitter,
  SefazMockTransmitter,
  ehAutorizado,
  escolherTransmissor,
} from './transmitter';
import { competenciaChave, dhEmiSefaz, fusoDaUf, offsetMinutos } from './fuso-fiscal';

// EMISSÃO QUE FECHA EM CASO DE DÚVIDA (mig 278).
//
// O emissor devolvia "autorizada" sem falar com a SEFAZ sempre que a loja não tivesse
// certificado — inclusive com `ambiente = 1`. A venda era gravada como fiscal, com
// protocolo inventado, e o cupom saía sem tarja (a tarja só olhava o ambiente). Este
// arquivo guarda as três travas que impedem isso de voltar: a escolha do transmissor, o
// pré-voo do emitente e a marcação da nota simulada.

const CONFIG_OK = {
  cnpj: '12.345.678/0001-95',
  razaoSocial: 'Bar do Teste LTDA',
  ie: '123456789',
  uf: 'SP',
  codigoUf: 35,
  codigoMunicipio: '3550308',
  municipio: 'Sao Paulo',
  endereco: 'Rua das Flores',
  bairro: 'Centro',
  numero: '100',
  cscId: '000001',
  cscToken: 'CSC-SECRETO',
  ambiente: '2',
  urlQrcodeHomolog: 'https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode',
  urlQrcodeProd: 'https://www.nfce.fazenda.sp.gov.br/qrcode',
};

describe('escolha do transmissor', () => {
  const original = process.env.FISCAL_SIMULADO;
  afterEach(() => {
    if (original === undefined) delete process.env.FISCAL_SIMULADO;
    else process.env.FISCAL_SIMULADO = original;
  });

  it('PRODUÇÃO sem certificado NÃO cai no simulado — recusa', () => {
    process.env.FISCAL_SIMULADO = 'true'; // mesmo ligado, produção não aceita
    expect(() => escolherTransmissor({ ambiente: '1', certRef: null })).toThrow(
      /não configurada|certificado/i,
    );
  });

  it('homologação sem certificado e sem a chave ligada também recusa', () => {
    delete process.env.FISCAL_SIMULADO;
    expect(() => escolherTransmissor({ ambiente: '2', certRef: null })).toThrow();
  });

  it('homologação + FISCAL_SIMULADO=true é o ÚNICO caminho para o simulado', () => {
    process.env.FISCAL_SIMULADO = 'true';
    expect(escolherTransmissor({ ambiente: '2', certRef: null })).toBeInstanceOf(
      SefazMockTransmitter,
    );
  });

  it('com certificado vai para o transmissor direto (que ainda recusa, por não existir)', async () => {
    const t = escolherTransmissor({ ambiente: '1', certRef: 'loja-a.pfx' });
    expect(t).toBeInstanceOf(SefazDiretoTransmitter);
    await expect(t.autorizar('', '', {})).rejects.toThrow(/Nenhuma nota foi emitida/);
  });

  it('a nota do simulado vem marcada como simulada', async () => {
    const ret = await new SefazMockTransmitter().autorizar('<xml/>');
    expect(ret.simulado).toBe(true);
    expect(ret.motivo).toMatch(/SIMULADO/);
  });
});

describe('cStat de autorização', () => {
  // 120 = "autorizado o uso da NF-e, COM ALERTA" (NT 2026.002). Tratar como erro faz o PDV
  // cair em contingência e emitir DE NOVO uma nota que já está autorizada.
  it.each(['100', '120', '150'])('%s é autorização', (c) => {
    expect(ehAutorizado(c)).toBe(true);
  });
  it.each(['204', '703', '1115', '', null, undefined])('%s não é', (c) => {
    expect(ehAutorizado(c as any)).toBe(false);
  });
});

describe('pré-voo do emitente', () => {
  it('configuração completa passa', () => {
    expect(camposFaltando(CONFIG_OK)).toEqual([]);
  });

  it('configuração vazia lista tudo que falta (em vez de emitir com padrões)', () => {
    const faltando = camposFaltando({});
    expect(faltando).toContain('CNPJ');
    expect(faltando).toContain('município');
    expect(faltando).toContain('bairro');
    expect(faltando.length).toBeGreaterThan(8);
  });

  it.each([
    ['cnpj', 'CNPJ'],
    ['municipio', 'município'],
    ['bairro', 'bairro'],
    ['numero', 'número'],
    ['cscToken', 'CSC'],
    ['codigoMunicipio', 'código do município (IBGE)'],
  ])('sem %s a emissão não passa', (chave, rotulo) => {
    expect(camposFaltando({ ...CONFIG_OK, [chave]: null })).toContain(rotulo);
  });

  it('CNPJ com menos de 14 dígitos não passa', () => {
    expect(camposFaltando({ ...CONFIG_OK, cnpj: '1234' })).toContain('CNPJ');
  });

  it('a URL do QR é por AMBIENTE — a de produção não serve para homologação', () => {
    expect(urlConsultaQr({ ...CONFIG_OK, ambiente: '1' })).toBe(CONFIG_OK.urlQrcodeProd);
    expect(urlConsultaQr({ ...CONFIG_OK, ambiente: '2' })).toBe(CONFIG_OK.urlQrcodeHomolog);
    // Sem a URL da UF, não há QR conferível — e a emissão é recusada.
    expect(urlConsultaQr({ ...CONFIG_OK, urlQrcodeHomolog: null })).toBeNull();
    expect(camposFaltando({ ...CONFIG_OK, urlQrcodeHomolog: '' })).toContain(
      'URL de consulta do QR Code desta UF',
    );
  });
});

describe('data-hora de emissão no fuso da UF', () => {
  // 21/09/2026 00:30 UTC = 20/09/2026 21:30 em São Paulo (−03:00).
  const instante = new Date('2026-09-21T00:30:00.000Z');

  it('NÃO declara UTC como horário de Brasília (o defeito antigo, 3h no futuro)', () => {
    const antigo = instante.toISOString().replace(/\.\d{3}Z$/, '-03:00');
    expect(antigo).toBe('2026-09-21T00:30:00-03:00'); // o que saía
    expect(dhEmiSefaz(instante, 'SP')).toBe('2026-09-20T21:30:00-03:00'); // o que é
  });

  it('respeita as UFs que não são −03:00', () => {
    expect(dhEmiSefaz(instante, 'AM')).toBe('2026-09-20T20:30:00-04:00');
    expect(dhEmiSefaz(instante, 'AC')).toBe('2026-09-20T19:30:00-05:00');
    expect(dhEmiSefaz(instante, 'MT')).toBe('2026-09-20T20:30:00-04:00');
    expect(fusoDaUf('rr')).toBe('America/Boa_Vista');
    expect(fusoDaUf(null)).toBe('America/Sao_Paulo');
    expect(offsetMinutos(instante, 'America/Sao_Paulo')).toBe(-180);
  });

  it('a competência da chave sai do MESMO instante local (virada de mês)', () => {
    // 01/10/2026 01:00 UTC ainda é 30/09 em São Paulo: a chave tem de dizer 2609, não 2610.
    const virada = new Date('2026-10-01T01:00:00.000Z');
    expect(competenciaChave(virada, 'SP')).toEqual({ ano2: '26', mes2: '09' });
    expect(dhEmiSefaz(virada, 'SP')).toBe('2026-09-30T22:00:00-03:00');
  });
});
