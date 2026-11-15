import {
  DIAS_DE_AVISO_DA_LICENCA,
  certificadoParaOMister,
  dataDeCalendario,
  ibptParaOMister,
  instagramParaOMister,
  servidorParaOMister,
} from './mister-vencimentos';

const agora = new Date('2026-11-14T15:00:00Z');
const daqui = (dias: number) => new Date(agora.getTime() + dias * 86_400_000 + 3_600_000);

describe('o que vence ou está desatualizado (a 17ª consulta do Mister)', () => {
  it('certificado: com a nota ligada, vencendo ou vencido pede atenção com o caminho da tela', () => {
    const vence = certificadoParaOMister({ loja: 'Centro', validoAte: daqui(4), ligada: true, ambiente: '1' }, agora);
    expect(vence.dados).toMatchObject({ loja: 'Centro', diasParaVencer: 4, situacao: 'vence em breve', notaFiscal: 'ligada, valendo' });
    expect(vence.atencao).toContain('vence em');
    expect(vence.atencao).toContain('Financeiro › Configuração');
    const vencido = certificadoParaOMister({ loja: null, validoAte: daqui(-3), ligada: true, ambiente: '2' }, agora);
    expect(vencido.dados).toMatchObject({ loja: 'a empresa toda', situacao: 'vencido', notaFiscal: 'ligada, em teste' });
    expect(vencido.atencao).toContain('sem ele a nota fiscal não sai');
  });

  it('certificado: com a nota DESLIGADA aparece, mas não pede atenção (o caso da loja hoje)', () => {
    const r = certificadoParaOMister({ loja: null, validoAte: daqui(4), ligada: false, ambiente: '2' }, agora);
    expect(r.dados).toMatchObject({ situacao: 'vence em breve', notaFiscal: 'desligada', observacao: expect.stringContaining('desligada') });
    expect(r.atencao).toBeNull();
    expect(certificadoParaOMister({ loja: null, validoAte: daqui(300), ligada: true, ambiente: '1' }, agora).atencao).toBeNull();
  });

  it('IBPT: vencida com a nota ligada pede atenção e diz quem resolve; desligada só informa', () => {
    const base = { uf: 'RJ', emUso: null, propriaAte: null, regemAte: null, situacaoDaDms: 'vencida' as const, diasParaVencerDaDms: null, ultimaAte: '2026-10-31' };
    const ligada = ibptParaOMister({ ...base, notaLigada: true });
    expect(ligada.dados).toMatchObject({ estado: 'RJ', situacao: 'vencida desde 31/10/2026' });
    expect(ligada.atencao).toContain('venceu em 31/10/2026');
    expect(ligada.atencao).toContain('Lei 12.741');
    expect(ligada.atencao).toContain('DMS');
    const desligada = ibptParaOMister({ ...base, notaLigada: false });
    expect(desligada.atencao).toBeNull();
    expect(desligada.dados.observacao).toContain('desligada');
    expect(ibptParaOMister({ ...base, ultimaAte: null, notaLigada: true }).atencao).toContain('não foi enviada');
  });

  it('IBPT: a da DMS em dia não pede nada; vencendo sem a próxima pede; a própria da loja se atualiza sozinha', () => {
    const dms = { uf: 'RJ', emUso: 'regem' as const, propriaAte: null, regemAte: '2026-12-31', ultimaAte: '2026-12-31', notaLigada: true };
    expect(ibptParaOMister({ ...dms, situacaoDaDms: 'ok', diasParaVencerDaDms: 47 })).toEqual({
      dados: { estado: 'RJ', emUso: 'a da DMS (quem atualiza é a DMS)', valeAte: '31/12/2026', diasParaVencer: 47 },
      atencao: null,
    });
    expect(ibptParaOMister({ ...dms, situacaoDaDms: 'vence_logo', diasParaVencerDaDms: 3 }).atencao).toContain('a próxima ainda não chegou');
    const propria = ibptParaOMister({ uf: 'RJ', emUso: 'propria', propriaAte: '2026-12-15', regemAte: null, situacaoDaDms: 'vencida', diasParaVencerDaDms: null, ultimaAte: '2026-12-15', notaLigada: true });
    expect(propria.dados).toMatchObject({ emUso: expect.stringContaining('própria loja'), valeAte: '15/12/2026' });
    expect(propria.atencao).toBeNull();
    expect(ibptParaOMister({ uf: null, emUso: null, propriaAte: null, regemAte: null, situacaoDaDms: null, diasParaVencerDaDms: null, ultimaAte: null, notaLigada: false }).atencao).toBeNull();
  });

  it('servidor: licença vencendo em até 15 dias pede atenção (o servidor para de gravar vendas); sem prazo, nada', () => {
    const base = { instalado: true as const, versao: '1.30.12', versaoDisponivel: null, soPeloInstalador: false, versaoRecolhida: false };
    const [lic, ver] = servidorParaOMister({ ...base, validaAte: daqui(7) }, agora);
    expect(lic.dados).toEqual({ licenca: { valeAte: expect.any(String), diasParaVencer: 7, situacao: 'vence em breve', acompanha: expect.stringContaining('Planos & assinatura') } });
    expect(lic.atencao).toContain('para de gravar vendas');
    expect(ver).toEqual({ dados: { versao: { instalada: '1.30.12', disponivel: null, emDia: true } }, atencao: null });
    expect(servidorParaOMister({ ...base, validaAte: daqui(DIAS_DE_AVISO_DA_LICENCA + 5) }, agora)[0].atencao).toBeNull();
    expect(servidorParaOMister({ ...base, validaAte: daqui(-2) }, agora)[0]).toMatchObject({ dados: { licenca: { situacao: 'vencida', diasParaVencer: 0 } }, atencao: expect.stringContaining('venceu') });
    expect(servidorParaOMister({ ...base, validaAte: null }, agora)[0]).toEqual({ dados: { licenca: { semPrazo: true } }, atencao: null });
  });

  it('servidor: versão nova, recolhida ou só pelo instalador pedem atenção; sem servidor, só informa', () => {
    const base = { instalado: true as const, validaAte: null, versao: '1.30.12', soPeloInstalador: false, versaoRecolhida: false };
    expect(servidorParaOMister({ ...base, versaoDisponivel: '1.30.13' }, agora)[1].atencao).toContain('Configurações › Servidor local');
    const recolhida = servidorParaOMister({ ...base, versaoDisponivel: null, versaoRecolhida: true }, agora)[1];
    expect(recolhida.atencao).toContain('recolhida');
    expect((recolhida.dados.versao as any).emDia).toBe(false);
    expect(servidorParaOMister({ ...base, versao: '1.29.4', versaoDisponivel: null, soPeloInstalador: true }, agora)[1].atencao).toContain('instalador novo');
    expect(servidorParaOMister({ instalado: false }, agora)).toEqual([{ dados: { instalado: false, observacao: expect.any(String) }, atencao: null }]);
  });

  it('Instagram: só com erro ou vencido pede reconectar; sem conta, nada', () => {
    expect(instagramParaOMister(null, agora)).toBeNull();
    expect(instagramParaOMister({ usuario: 'misterburguer', venceEm: daqui(40), erro: null }, agora)).toEqual({
      dados: { conta: '@misterburguer', acesso: 'em dia (a Regem renova sozinha)' },
      atencao: null,
    });
    const comErro = instagramParaOMister({ usuario: 'misterburguer', venceEm: daqui(40), erro: 'Não deu para renovar' }, agora)!;
    expect(comErro.atencao).toContain('Reconectar');
    expect(instagramParaOMister({ usuario: null, venceEm: daqui(-1), erro: null }, agora)!.dados.acesso).toBe('precisa reconectar');
  });

  it('data de calendário', () => {
    expect(dataDeCalendario('2026-10-31')).toBe('31/10/2026');
    expect(dataDeCalendario(null)).toBeNull();
  });
});
