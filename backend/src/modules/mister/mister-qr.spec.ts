import { TEXTO_DO_ACEITE, VERSAO_DO_ACEITE, nomeDaInstancia, numeroDoDono, situacaoPelaConexao, textoDoNumeroNovo } from './mister-qr';

// A conexão por QR Code do número do Mister (Q2 e Q3, mig 437): as regras puras.
describe('mister-qr', () => {
  it('a instância do Mister tem nome próprio, separado das lojas, só com letras e números', () => {
    expect(nomeDaInstancia('A1b2-C3d4')).toBe('regem-mister-a1b2c3d4');
    expect(nomeDaInstancia('../x y')).toBe('regem-mister-xy');
    expect(nomeDaInstancia('0123456789abcdef')).toBe('regem-mister-0123456789ab');
  });

  it('o número do celular sai do dono da instância, com ou sem o aparelho', () => {
    expect(numeroDoDono('5521988887777@s.whatsapp.net')).toBe('5521988887777');
    expect(numeroDoDono('5521988887777:12@s.whatsapp.net')).toBe('5521988887777');
    expect(numeroDoDono('123@s.whatsapp.net')).toBeNull();
    expect(numeroDoDono(null)).toBeNull();
    expect(numeroDoDono('')).toBeNull();
  });

  it('a situação pela conexão: aberta, o celular saiu (401), bloqueado (403), caiu por outro motivo; "conectando" não muda', () => {
    expect(situacaoPelaConexao('open', null)).toEqual({ situacao: 'conectado', motivo: null });
    expect(situacaoPelaConexao('OPEN', undefined)).toEqual({ situacao: 'conectado', motivo: null });
    expect(situacaoPelaConexao('close', 401)).toMatchObject({ situacao: 'caiu', motivo: expect.stringContaining('saiu da conta') });
    expect(situacaoPelaConexao('close', '403')).toMatchObject({ situacao: 'bloqueado', motivo: expect.stringContaining('bloqueou') });
    expect(situacaoPelaConexao('close', 428)).toMatchObject({ situacao: 'caiu', motivo: expect.stringContaining('A conexão caiu') });
    expect(situacaoPelaConexao('close', null)).toMatchObject({ situacao: 'caiu' });
    expect(situacaoPelaConexao('connecting', null)).toBeNull();
    expect(situacaoPelaConexao(undefined, null)).toBeNull();
  });

  it('o aviso do número novo chama pelo primeiro nome, e sem nome segue sem saudação', () => {
    expect(textoDoNumeroNovo('Ana Souza')).toMatch(/^Oi, Ana! Este é o novo número do Mister, do Regem\. Salve este contato/);
    expect(textoDoNumeroNovo('  ')).toMatch(/^Este é o novo número do Mister/);
    expect(textoDoNumeroNovo(null)).toMatch(/O número antigo não responde mais\.$/);
  });

  it('o aceite tem versão e o texto do protótipo aprovado (duas partes)', () => {
    expect(VERSAO_DO_ACEITE).toBe('v1');
    const partes = TEXTO_DO_ACEITE.split('\n');
    expect(partes).toHaveLength(2);
    expect(partes[0]).toMatch(/^O WhatsApp não autoriza conexões fora da API oficial\./);
    expect(partes[1]).toBe('Use um número só para o Mister, num celular que fique na distribuição, ligado e com internet.');
  });
});
