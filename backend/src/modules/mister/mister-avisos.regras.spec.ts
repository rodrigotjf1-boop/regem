import {
  DESTINOS,
  TIPOS_DE_AVISO,
  TIPO_DA_REGRA_DO_VIGIA,
  conferirRegras,
  dentroDaJanelaDoWhatsapp,
  deveEscalar,
  regraQueVale,
  situacaoDaChave,
  situacaoDoCaixa,
  situacaoDoVigia,
  textoDoAviso,
  textoDoDesfecho,
} from './mister-avisos.regras';
import { REGRAS_DO_VIGIA } from '../vigia/vigia.regras';

// Os avisos do Mister (mig 419): o padrão aprovado pelo dono em 14/11/2026, a conferência do que a tela salva, de onde vem
// cada situação e os textos.

describe('Mister — os avisos: o padrão aprovado em 14/11', () => {
  it('nove avisos, na ordem do protótipo, cada um com os destinos da tabela aprovada', () => {
    const tabela = Object.fromEntries(TIPOS_DE_AVISO.map((t) => [t.tipo, { ...t.padrao }]));
    expect(TIPOS_DE_AVISO.map((t) => t.tipo)).toEqual(['impressora', 'pedido_parado', 'caixa_24h', 'canal_desconectado', 'servidor_sem_sinal', 'servidor_tecnico', 'nota_sem_resposta', 'certificado', 'chave_ia']);
    expect(tabela.impressora).toEqual({ ligado: true, destinos: ['tela'], escalaMin: 5, escalaPara: ['gerente'], parametro: null });
    expect(tabela.pedido_parado).toEqual({ ligado: false, destinos: ['kds', 'tela', 'gerente'], escalaMin: null, escalaPara: [], parametro: 20 });
    expect(tabela.caixa_24h.destinos).toEqual(['gerente']);
    expect(tabela.canal_desconectado.destinos).toEqual(['gerente', 'tela']);
    expect(tabela.servidor_sem_sinal.destinos).toEqual(['gerente', 'dms']);
    expect(tabela.servidor_tecnico).toMatchObject({ destinos: ['dms'], escalaMin: 120, escalaPara: ['gerente'] });
    expect(tabela.nota_sem_resposta.destinos).toEqual(['atendimento', 'presidente']);
    expect(tabela.certificado.destinos).toEqual(['presidente']);
    expect(tabela.chave_ia.destinos).toEqual(['presidente']);
    for (const t of TIPOS_DE_AVISO) for (const d of [...t.padrao.destinos, ...t.padrao.escalaPara]) expect(DESTINOS).toContain(d);
  });
  it('sem escolha da empresa vale o padrão (uma cópia: mudar a regra devolvida não muda o padrão)', () => {
    const r = regraQueVale('impressora', null);
    r.destinos.push('kds');
    expect(regraQueVale('impressora', undefined).destinos).toEqual(['tela']);
  });
  it('a escolha salva vale, e destino desconhecido (de outra versão) fica de fora', () => {
    expect(regraQueVale('caixa_24h', { ligado: false, destinos: ['presidente', 'fax' as any], escalaMin: null, escalaPara: [] })).toEqual({
      ligado: false,
      destinos: ['presidente'],
      escalaMin: null,
      escalaPara: [],
      parametro: null,
    });
    // O parâmetro só existe no pedido parado.
    expect(regraQueVale('caixa_24h', { ligado: true, destinos: ['gerente'], parametro: 30 }).parametro).toBeNull();
    expect(regraQueVale('pedido_parado', { ligado: true, destinos: ['kds'], parametro: 30 }).parametro).toBe(30);
  });
  it('todas as regras do vigia que viram aviso existem no vigia', () => {
    for (const r of Object.keys(TIPO_DA_REGRA_DO_VIGIA)) expect(REGRAS_DO_VIGIA as readonly string[]).toContain(r);
    for (const r of REGRAS_DO_VIGIA) expect(TIPO_DA_REGRA_DO_VIGIA[r]).toBeDefined();
  });
});

describe('Mister — os avisos: o que a tela manda salvar', () => {
  const ok = { tipo: 'impressora', ligado: true, destinos: ['tela', 'kds'], escalaMin: 15, escalaPara: ['presidente'] };
  it('a regra inteira de cada tipo que mudou', () => {
    expect(conferirRegras({ regras: [ok, { tipo: 'pedido_parado', ligado: true, destinos: ['kds'], escalaMin: null, escalaPara: [], parametro: 30 }] })).toEqual([
      { tipo: 'impressora', regra: { ligado: true, destinos: ['tela', 'kds'], escalaMin: 15, escalaPara: ['presidente'], parametro: null } },
      { tipo: 'pedido_parado', regra: { ligado: true, destinos: ['kds'], escalaMin: null, escalaPara: [], parametro: 30 } },
    ]);
    // Sem escala, o "para quem" é descartado.
    expect(conferirRegras({ regras: [{ ...ok, escalaMin: null }] })).toEqual([{ tipo: 'impressora', regra: { ligado: true, destinos: ['tela', 'kds'], escalaMin: null, escalaPara: [], parametro: null } }]);
    // Desligado pode ficar sem destino.
    expect(conferirRegras({ regras: [{ tipo: 'certificado', ligado: false, destinos: [], escalaMin: null, escalaPara: [] }] })).not.toHaveProperty('erro');
  });
  it('cada recusa tem a sua frase', () => {
    const erro = (regras: any) => (conferirRegras({ regras }) as { erro: string }).erro;
    expect(erro([])).toBe('Nada para salvar.');
    expect(erro([{ ...ok, tipo: 'outro' }])).toBe('Aviso desconhecido.');
    expect(erro([ok, ok])).toBe('O mesmo aviso veio duas vezes.');
    expect(erro([{ ...ok, ligado: 'sim' }])).toContain('fica ligado ou desligado');
    expect(erro([{ ...ok, destinos: ['tela', 'pombo'] }])).toBe('Destino desconhecido.');
    expect(erro([{ ...ok, destinos: [] }])).toContain('Escolha pelo menos um destino');
    expect(erro([{ ...ok, escalaMin: 7 }])).toContain('inválido');
    expect(erro([{ ...ok, escalaPara: ['tela'] }])).toContain('só cabe o WhatsApp');
    expect(erro([{ ...ok, escalaPara: [] }])).toBe('Escolha quem fica sabendo se ninguém resolver.');
    expect(erro([{ tipo: 'pedido_parado', ligado: true, destinos: ['kds'], escalaMin: null, escalaPara: [], parametro: 25 }])).toContain('15, 20 ou 30');
    expect(conferirRegras(null)).toEqual({ erro: 'Nada para salvar.' });
  });
});

describe('Mister — os avisos: de onde vem a situação e os textos', () => {
  it('o incidente do vigia vira aviso com a loja no texto, e a regra sem tipo não avisa', () => {
    const i = { tenantId: 't', unidadeId: 'u', chave: 'srv:1:impressora:9', evidencia: { impressora: 'Cozinha' } };
    expect(situacaoDoVigia({ ...i, regra: 'impressora_parada' }, 'Loja Centro')).toEqual({
      tenantId: 't',
      unidadeId: 'u',
      tipo: 'impressora',
      chave: 'vigia:impressora_parada:srv:1:impressora:9',
      titulo: 'Loja Centro · impressora Cozinha parada',
      detalhe: 'Confira se ela está ligada, com papel e no cabo ou na rede.',
    });
    expect(situacaoDoVigia({ ...i, regra: 'servidor_sem_sinal', chave: 'srv:1' }, 'Loja Centro')).toMatchObject({ tipo: 'servidor_sem_sinal', titulo: 'Loja Centro · servidor sem sinal' });
    expect(situacaoDoVigia({ ...i, regra: 'disco_baixo', chave: 'srv:1' }, 'Loja Centro')).toMatchObject({ tipo: 'servidor_tecnico', titulo: 'Loja Centro · o disco do servidor está quase cheio' });
    expect(situacaoDoVigia({ ...i, regra: 'regra_nova' }, 'Loja Centro')).toBeNull();
  });
  it('o caixa: em horas até 2 dias, depois em dias; com quem abriu', () => {
    expect(situacaoDoCaixa({ tenantId: 't', unidadeId: 'u', id: 'c1', horas: 30, abertoPor: 'Carlos', origem: 'pdv' }, 'Loja Centro')).toMatchObject({
      tipo: 'caixa_24h',
      chave: 'caixa:c1',
      titulo: 'Loja Centro · caixa do balcão aberto há 30 horas (aberto por Carlos)',
    });
    expect(situacaoDoCaixa({ tenantId: 't', unidadeId: null, id: 'c2', horas: 2400, abertoPor: null, origem: 'delivery' }, 'Burger').titulo).toBe('Burger · caixa do delivery aberto há 100 dias');
  });
  it('a chave de IA: só as situações que param a IA viram aviso', () => {
    expect(situacaoDaChave({ tenantId: 't', situacao: 'sem_credito' })).toMatchObject({ tipo: 'chave_ia', chave: 'chave_ia', titulo: 'A IA do Mister parou: a chave de IA está sem crédito' });
    expect(situacaoDaChave({ tenantId: 't', situacao: 'ok' })).toBeNull();
  });
  it('o texto do aviso e o do desfecho', () => {
    expect(textoDoAviso({ titulo: 'Loja Centro · servidor sem sinal', detalhe: 'Confira o computador.' })).toBe('⚠️ Loja Centro · servidor sem sinal.\n\nConfira o computador.');
    expect(textoDoDesfecho({ titulo: 'Loja Centro · servidor sem sinal' }, 9)).toBe('✅ Resolvido: Loja Centro · servidor sem sinal. Durou 9 min.');
    expect(textoDoDesfecho({ titulo: 'X' }, 135)).toBe('✅ Resolvido: X. Durou 2 h 15 min.');
  });
  it('o "se ninguém resolver" sai uma vez, depois do tempo, e só com alguém para avisar', () => {
    const r = regraQueVale('impressora', null); // 5 min → gerente
    const aberto = new Date('2026-11-14T20:00:00Z');
    expect(deveEscalar({ abertoEm: aberto, escaladoEm: null }, r, aberto.getTime() + 4 * 60_000)).toBe(false);
    expect(deveEscalar({ abertoEm: aberto, escaladoEm: null }, r, aberto.getTime() + 5 * 60_000)).toBe(true);
    expect(deveEscalar({ abertoEm: aberto, escaladoEm: new Date() }, r, aberto.getTime() + 60 * 60_000)).toBe(false);
    expect(deveEscalar({ abertoEm: aberto, escaladoEm: null }, regraQueVale('caixa_24h', null), aberto.getTime() + 999 * 60_000)).toBe(false);
  });
  it('a janela de 24 horas do WhatsApp', () => {
    const agora = Date.parse('2026-11-14T20:00:00Z');
    expect(dentroDaJanelaDoWhatsapp(new Date(agora - 23 * 3_600_000), agora)).toBe(true);
    expect(dentroDaJanelaDoWhatsapp(new Date(agora - 24 * 3_600_000), agora)).toBe(false);
    expect(dentroDaJanelaDoWhatsapp(null, agora)).toBe(false);
  });
});
