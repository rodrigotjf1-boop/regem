import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AVISOS_DA_DISTRIBUICAO,
  SEGREDO_ABERTO_H,
  TIPOS_DA_DISTRIBUICAO,
  ehAvisoDaDistribuicao,
  situacaoDoSegredo,
  DESTINOS,
  MARCOS_DO_CERTIFICADO,
  TIPOS_DE_AVISO,
  situacaoDaValidadePendente,
  situacaoDoPedidoAtrasado,
  diaDoAvisoDeAtraso,
  botoesDoPedidoAtrasado,
  lerBotaoDoPedidoAtrasado,
  PONTE_ATALHO,
  PONTE_ICONE,
  PONTE_MENU_ABRIR_IFOOD,
  TIPO_DA_REGRA_DO_VIGIA,
  conferirRegras,
  dentroDaJanelaDoWhatsapp,
  deveEscalar,
  marcoDoCertificado,
  mudouDeMarco,
  regraQueVale,
  situacaoDa99SemLogin,
  situacaoDaChave,
  situacaoDaNotaSemResposta,
  situacaoDoCaixa,
  situacaoDoCertificadoDaLoja,
  situacaoDoChatSemResposta,
  situacaoDoIfoodSemResposta,
  situacaoDoPedidoParado,
  situacaoDoVigia,
  textoDoAviso,
  textoDoDesfecho,
  textoDoLembrete,
  ANTECEDENCIAS_DO_BOLETO,
  boletoNoPrazoDoAviso,
  botoesDoAvisoDoBoleto,
  diaDoAvisoDoBoleto,
  situacaoDoBoleto,
  QUANDO_DO_PONTO,
  faltaNoTurno,
  pontoNoTempoDoAviso,
  situacoesDoPonto,
  ONDE_VER_O_GASTO,
  chaveDaFranquia,
  chaveDoGasto,
  conferirValoresDoGasto,
  emReais,
  situacaoDaFranquia,
  situacaoDoGasto,
  valoresQueAvisam,
} from './mister-avisos.regras';
import { REGRAS_DO_VIGIA } from '../vigia/vigia.regras';
import { diasParaVencer } from '../fiscal/certificado';
import { POLLER_ERRO_APOS_MS } from '../../common/falhas-do-poller';
import { GUIA_DE_USO } from './mister-guia-de-uso';

// Os avisos do Mister (mig 419): o padrão aprovado pelo dono em 14/11/2026, a conferência do que a tela salva, de onde vem
// cada situação e os textos.

describe('Mister — os avisos: o padrão aprovado em 14/11', () => {
  it('nove avisos, na ordem do protótipo, cada um com os destinos da tabela aprovada — e o do boleto (versão 3) por último', () => {
    const tabela = Object.fromEntries(TIPOS_DE_AVISO.map((t) => [t.tipo, { ...t.padrao }]));
    expect(TIPOS_DE_AVISO.map((t) => t.tipo)).toEqual([
      'impressora',
      'pedido_parado',
      'caixa_24h',
      'canal_desconectado',
      'servidor_sem_sinal',
      'servidor_tecnico',
      'nota_sem_resposta',
      'certificado',
      'chave_ia',
      'boleto_vencendo',
      'ponto_esquecido',
      'ponto_do_mes',
      // G2 do gasto do WhatsApp oficial (18/11/2026): no fim; a tela os põe no grupo "Documentos e dinheiro".
      'gasto_whatsapp',
      'franquia_atendimento',
      // P1 de "Pedidos e recebimento" (25/11): a validade pendente, ao gerente; a tela o põe em "Na loja".
      'validade_pendente',
      // P3 de "Pedidos e recebimento" (25/11): o pedido atrasado, ao gerente, também em "Na loja".
      'pedido_atrasado',
      // H2b dos dias especiais (27/11): o feriado sem resposta, ao presidente e ao gerente, DESLIGADO, em "Na loja".
      'feriado_chegando',
    ]);
    expect(TIPOS_DE_AVISO.find((t) => t.tipo === 'feriado_chegando')).toMatchObject({
      grupo: 'Na loja',
      titulo: 'Feriado chegando',
      padrao: { ligado: false, destinos: ['presidente', 'gerente'], escalaMin: null, escalaPara: [], parametro: null },
    });
    // M3e parte 2: o arquivo do ponto do mês, ao presidente (o protótipo: "Vai para: WhatsApp do presidente"), sem parâmetro.
    expect(TIPOS_DE_AVISO.find((t) => t.tipo === 'ponto_do_mes')).toMatchObject({
      grupo: 'Pessoas e ponto',
      titulo: 'Arquivo do ponto do mês',
      padrao: { ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: null },
    });
    // A mensagem do arquivo do ponto vai com a pasta, não com o sinal de alerta.
    expect(textoDoAviso({ tipo: 'ponto_do_mes', titulo: 'Ponto de outubro · Mister Burger (1 a 31/10)', detalhe: 'x' })).toBe('📁 Ponto de outubro · Mister Burger (1 a 31/10).\n\nx');
    expect(textoDoAviso({ tipo: 'impressora', titulo: 'A impressora parou', detalhe: null })).toBe('⚠️ A impressora parou.');
    expect(TIPOS_DE_AVISO.find((t) => t.tipo === 'gasto_whatsapp')).toMatchObject({
      grupo: 'Documentos e dinheiro',
      padrao: { ligado: false, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: null, valores: [] },
    });
    expect(TIPOS_DE_AVISO.find((t) => t.tipo === 'franquia_atendimento')).toMatchObject({
      grupo: 'Documentos e dinheiro',
      padrao: { ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: null },
    });
    // M3e: o ponto esquecido, ao gerente, com o resumo no dia seguinte (parâmetro 0).
    expect(TIPOS_DE_AVISO.find((t) => t.tipo === 'ponto_esquecido')).toMatchObject({
      grupo: 'Pessoas e ponto',
      padrao: { ligado: true, destinos: ['gerente'], escalaMin: null, escalaPara: [], parametro: 0 },
    });
    expect(TIPOS_DE_AVISO.find((t) => t.tipo === 'boleto_vencendo')).toMatchObject({
      grupo: 'Documentos e dinheiro',
      padrao: { ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: 3 },
    });
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
    // F4.4: o motivo do vigia vai nos dados (é ele que diz se reiniciar a impressão serve); outro valor não entra.
    expect(situacaoDoVigia({ ...i, regra: 'impressora_parada', evidencia: { nome: 'Cozinha', motivo: 'sem_responder' } }, 'Loja Centro')).toMatchObject({ dados: { motivo: 'sem_responder' } });
    expect(situacaoDoVigia({ ...i, regra: 'impressora_parada', evidencia: { nome: 'Cozinha', motivo: 'aviso' } }, 'Loja Centro')).toMatchObject({ dados: { motivo: 'aviso' } });
    expect(situacaoDoVigia({ ...i, regra: 'impressora_parada', evidencia: { motivo: 'qualquer' } }, 'Loja Centro')).not.toHaveProperty('dados');
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

describe('Mister — o boleto perto de vencer (M3a parte 4)', () => {
  const b = (dias: number, o: Partial<Parameters<typeof situacaoDoBoleto>[0]> = {}) =>
    situacaoDoBoleto({
      tenantId: 't',
      unidadeId: null,
      tituloId: 'tit',
      documentoId: 'doc',
      beneficiario: 'Distribuidora Sabor',
      valorCentavos: 128490,
      vencimento: '2026-11-25',
      linhaDigitavel: '00191.23454 67890.123457 67890.123457 7 16410000128490',
      dias,
      ...o,
    });
  it('o dia do aviso vira às 9h da loja (antes, ainda é o dia anterior)', () => {
    expect(diaDoAvisoDoBoleto(new Date('2026-11-22T11:59:00Z'))).toBe('2026-11-21'); // 8h59 em Brasília
    expect(diaDoAvisoDoBoleto(new Date('2026-11-22T12:00:00Z'))).toBe('2026-11-22'); // 9h00
    expect(diaDoAvisoDoBoleto(new Date('2026-11-23T02:30:00Z'))).toBe('2026-11-22'); // 23h30 do dia 22 em Brasília (na nuvem, já é 23 em UTC)
    expect(diaDoAvisoDoBoleto(new Date('2026-11-23T10:00:00Z'))).toBe('2026-11-22'); // 7h do dia 23: ainda o 22
  });
  it('o título, a linha e os marcos (antes, no dia, venceu); a chave é a da conta', () => {
    expect(b(3)).toMatchObject({ chave: 'boleto:tit', titulo: 'Boleto vence em 3 dias (25/11) · Distribuidora Sabor · R$ 1.284,90', dados: { marco: 'antes', documentoId: 'doc' } });
    expect(b(1).titulo).toContain('vence amanhã (25/11)');
    expect(b(0)).toMatchObject({ titulo: expect.stringContaining('vence hoje (25/11)'), dados: { marco: 'dia' } });
    expect(b(-1)).toMatchObject({ titulo: expect.stringContaining('venceu em 25/11 e não foi marcado como pago'), dados: { marco: 'vencido' } });
    expect(b(2).detalhe).toContain('Linha digitável: 00191.23454 67890.123457 67890.123457 7 16410000128490');
    expect(b(2, { linhaDigitavel: null, beneficiario: null }).detalhe).toContain('entrou sem a linha digitável');
    expect(b(2, { beneficiario: null }).titulo).toBe('Boleto vence em 2 dias (25/11) · boleto · R$ 1.284,90');
  });
  it('a antecedência da empresa e o vencido até 30 dias', () => {
    expect(ANTECEDENCIAS_DO_BOLETO).toEqual([3, 1, 0]);
    expect([4, 3, 1, 0].map((d) => boletoNoPrazoDoAviso(d, 3))).toEqual([false, true, true, true]);
    expect([2, 1, 0].map((d) => boletoNoPrazoDoAviso(d, 1))).toEqual([false, true, true]);
    expect([1, 0, -1].map((d) => boletoNoPrazoDoAviso(d, 0))).toEqual([false, true, true]);
    expect([-30, -31].map((d) => boletoNoPrazoDoAviso(d, 3))).toEqual([true, false]);
    expect(boletoNoPrazoDoAviso(3, null)).toBe(true);
  });
  it('o botão "Já paguei" leva o documento; sem documento, nenhum', () => {
    expect(botoesDoAvisoDoBoleto('d1')).toEqual([
      { id: 'doc:pago:d1', titulo: 'Já paguei' },
      { id: 'doc:pdf:d1', titulo: 'Ver o PDF' },
    ]);
    expect(botoesDoAvisoDoBoleto(undefined)).toEqual([]);
  });
  it('a regra: a antecedência salva vale; fora da lista, o padrão; a conferência recusa o que não é 3, 1 ou 0', () => {
    expect(regraQueVale('boleto_vencendo', { ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: 0 }).parametro).toBe(0);
    expect(regraQueVale('boleto_vencendo', { ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: 7 }).parametro).toBe(3);
    expect(regraQueVale('boleto_vencendo', { ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: null }).parametro).toBe(3);
    const base = { tipo: 'boleto_vencendo', ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [] };
    expect(conferirRegras({ regras: [{ ...base, parametro: 1 }] })).toEqual([{ tipo: 'boleto_vencendo', regra: { ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: 1 } }]);
    for (const p of [2, null, undefined, '', 'tres'])
      expect(conferirRegras({ regras: [{ ...base, parametro: p }] })).toEqual({ erro: expect.stringContaining('quando avisar do boleto') });
  });
});

describe('Mister — os avisos, parte 2: fiscal', () => {
  const agora = new Date('2026-11-14T15:00:00Z');
  const em = (dias: number, horas = 1) => new Date(agora.getTime() + dias * 86_400_000 + horas * 3_600_000);

  it('os nove avisos da tabela aprovada já funcionam (o pedido parado entrou por último, desligado)', () => {
    expect(TIPOS_DE_AVISO.filter((t) => !t.jaFunciona).map((t) => t.tipo)).toEqual([]);
    expect(TIPOS_DE_AVISO.find((t) => t.tipo === 'pedido_parado')!.padrao.ligado).toBe(false);
  });

  it('o marco do certificado nas bordas: 60, 30, 15, 7 e 1 dia, e vencido abaixo de zero', () => {
    expect(MARCOS_DO_CERTIFICADO).toEqual([60, 30, 15, 7, 1]);
    const casos: [number, string | null][] = [
      [61, null],
      [60, '60'],
      [31, '60'],
      [30, '30'],
      [16, '30'],
      [15, '15'],
      [8, '15'],
      [7, '7'],
      [2, '7'],
      [1, '1'],
      [0, '1'],
      [-1, 'vencido'],
      [-400, 'vencido'],
    ];
    for (const [dias, marco] of casos) expect([dias, marcoDoCertificado(dias)]).toEqual([dias, marco]);
    expect(marcoDoCertificado(NaN)).toBeNull();
  });

  it('a conta dos dias é a MESMA da tela do certificado (`diasParaVencer`, V74): o marco sai dela, inclusive nas meias horas', () => {
    for (const [d, h] of [[61, -1], [60, 23], [30, 0.5], [7, 23.5], [1, 0], [0, 0.1], [0, -0.1], [-2, 0]] as [number, number][]) {
      const validoAte = em(d, h);
      const s = situacaoDoCertificadoDaLoja({ tenantId: 't', unidadeId: null, credencialId: 'c', validoAte }, 'Burger', agora);
      const daTela = diasParaVencer(validoAte, agora);
      expect([d, h, s?.dados?.marco ?? null]).toEqual([d, h, marcoDoCertificado(daTela)]);
      if (s) expect(s.dados?.dias).toBe(daTela);
    }
  });

  it('o certificado: título com a data (não muda todo dia), os dias no detalhe, o caminho do guia, e vencido', () => {
    const s = situacaoDoCertificadoDaLoja({ tenantId: 't', unidadeId: 'u', credencialId: 'c1', validoAte: em(10) }, 'Loja Centro', agora)!;
    expect(s).toMatchObject({ tipo: 'certificado', chave: 'certificado:c1', titulo: 'Loja Centro · certificado digital da nota vence em 24/11', dados: { marco: '15', dias: 10, venceEm: '24/11' } });
    expect(s.detalhe).toBe('Faltam 10 dias. Sem certificado válido, nenhuma nota fiscal sai, nem em contingência. Renove com a certificadora e envie o novo em Financeiro › Configuração, em "Certificado A1 (.pfx)".');
    expect(situacaoDoCertificadoDaLoja({ tenantId: 't', unidadeId: 'u', credencialId: 'c1', validoAte: em(9) }, 'Loja Centro', agora)!.titulo).toBe(s.titulo.replace('24/11', '23/11'));
    expect(situacaoDoCertificadoDaLoja({ tenantId: 't', unidadeId: 'u', credencialId: 'c1', validoAte: em(1) }, 'L', agora)!.detalhe).toMatch(/^Vence amanhã\./);
    expect(situacaoDoCertificadoDaLoja({ tenantId: 't', unidadeId: 'u', credencialId: 'c1', validoAte: em(0) }, 'L', agora)!.detalhe).toMatch(/^Vence hoje\./);
    const vencido = situacaoDoCertificadoDaLoja({ tenantId: 't', unidadeId: 'u', credencialId: 'c1', validoAte: em(-3) }, 'L', agora)!;
    expect(vencido).toMatchObject({ titulo: 'L · certificado digital da nota venceu em 11/11', dados: { marco: 'vencido' } });
    expect(vencido.detalhe).toMatch(/^Nenhuma nota fiscal sai, nem em contingência, até o certificado novo\./);
    expect(situacaoDoCertificadoDaLoja({ tenantId: 't', unidadeId: 'u', credencialId: 'c1', validoAte: em(90) }, 'L', agora)).toBeNull();
  });

  it('a nota sem resposta: número, série, as tentativas e o caminho do guia com o botão', () => {
    const s = situacaoDaNotaSemResposta({ tenantId: 't', unidadeId: 'u', id: 'n1', numero: 77, serie: 2, tentativas: 12, emitidaEm: new Date('2026-11-13T23:10:00Z') }, 'Loja Centro');
    expect(s).toEqual({
      tenantId: 't',
      unidadeId: 'u',
      tipo: 'nota_sem_resposta',
      chave: 'nota:n1',
      titulo: 'Loja Centro · nota fiscal nº 77 (série 2) sem resposta da SEFAZ',
      detalhe: 'Emitida em 13/11 às 20:10; o Regem consultou 12 vezes e parou. Consulte de novo em Financeiro › Notas fiscais, em "Consultar na SEFAZ"; se continuar sem resposta, fale com o suporte.',
      dados: { numero: 77, serie: 2, tentativas: 12 },
    });
    expect(situacaoDaNotaSemResposta({ tenantId: 't', unidadeId: null, id: 'n2', numero: 1, serie: 1, tentativas: 12, emitidaEm: null }, 'L').detalhe).toMatch(/^O Regem consultou 12 vezes/);
  });

  it('o lembrete: só quando o marco do aviso aberto mudou', () => {
    expect(textoDoLembrete({ titulo: 'L · certificado digital da nota vence em 24/11', detalhe: 'Faltam 7 dias.' })).toBe('🔔 Lembrete: L · certificado digital da nota vence em 24/11.\n\nFaltam 7 dias.');
    expect(mudouDeMarco({ marco: '7', marcoAnterior: '15' })).toBe(true);
    expect(mudouDeMarco({ marco: 'vencido', marcoAnterior: '1' })).toBe(true);
    expect(mudouDeMarco({ marco: '7', marcoAnterior: '7' })).toBe(false);
    // Aviso sem marco (os outros tipos) nunca lembra.
    expect(mudouDeMarco({ horas: 30 })).toBe(false);
    expect(mudouDeMarco(null)).toBe(false);
  });
});

describe('Mister — os avisos, parte 2: o canal desconectado', () => {
  const agora = new Date('2026-11-14T15:00:00Z');
  const ha = (ms: number) => new Date(agora.getTime() - ms);
  const base = { tenantId: 't', unidadeId: 'u', integracaoId: 'ig1' };

  it('o iFood sem responder: só depois do MESMO tempo em que a telemetria trata como erro (antes é falha passageira)', () => {
    expect(POLLER_ERRO_APOS_MS).toBe(5 * 60_000);
    expect(situacaoDoIfoodSemResposta({ ...base, desde: ha(POLLER_ERRO_APOS_MS - 1000), motivo: 'sem_resposta' }, 'Loja Centro', agora)).toBeNull();
    const s = situacaoDoIfoodSemResposta({ ...base, desde: ha(POLLER_ERRO_APOS_MS), motivo: 'sem_resposta' }, 'Loja Centro', agora)!;
    expect(s).toMatchObject({
      tipo: 'canal_desconectado',
      chave: 'canal:ifood:ig1',
      titulo: 'Loja Centro · pedidos do iFood sem chegar ao Regem desde 14/11 às 11:55',
      dados: { canal: 'ifood', minutos: 5, motivo: 'sem_resposta' },
    });
    expect(s.detalhe).toBe(
      'Há 5 min o iFood não responde. Enquanto isso, aceite os pedidos pelo Gestor de Pedidos do iFood. Se continuar, confira a ligação em Delivery › Configurações, em "Integrações" ou fale com o suporte.',
    );
    // Data inválida não vira aviso.
    expect(situacaoDoIfoodSemResposta({ ...base, desde: new Date('x'), motivo: null }, 'L', agora)).toBeNull();
  });

  it('o motivo em português, e o tempo em horas quando passa de uma', () => {
    const motivo = (m: string | null) => situacaoDoIfoodSemResposta({ ...base, desde: ha(95 * 60_000), motivo: m }, 'L', agora)!.detalhe;
    expect(motivo('sem_token')).toMatch(/^Há 1 h 35 min o iFood não liberou o acesso do Regem\./);
    expect(motivo('http_401')).toContain('o iFood recusou o acesso do Regem');
    expect(motivo('http_403')).toContain('o iFood recusou o acesso do Regem');
    expect(motivo('http_500')).toContain('o iFood respondeu com erro');
    expect(motivo(null)).toContain('o iFood respondeu com erro');
  });

  it('a 99 sem login: só com código de recusa (o -1 é rede, não recusa), com o botão do guia', () => {
    expect(situacaoDa99SemLogin({ ...base, errno: -1 }, 'L')).toBeNull();
    expect(situacaoDa99SemLogin({ ...base, errno: 0 }, 'L')).toBeNull();
    expect(situacaoDa99SemLogin({ ...base, errno: NaN }, 'L')).toBeNull();
    const s = situacaoDa99SemLogin({ ...base, errno: 10101 }, 'Loja Centro')!;
    expect(s).toMatchObject({ tipo: 'canal_desconectado', chave: 'canal:99:ig1', titulo: 'Loja Centro · a 99 recusou o login do Regem', dados: { canal: '99', errno: 10101 } });
    expect(s.detalhe).toBe(
      'Sem o login, o Regem não confirma os pedidos da 99 nem avisa a saída para entrega (código 10101). Conecte de novo em Delivery › Configurações, em "Integrações", no botão "Conectar com 99Food".',
    );
    // O botão citado é um dos que o guia confere contra a tela.
    expect(GUIA_DE_USO.find((x) => x.id === 'ligar-ifood-99')!.botoes).toEqual(expect.arrayContaining(['Integrações', 'Conectar com 99Food']));
  });

  it('o chat do iFood sem resposta: um aviso por loja, o motivo no título (sem hora nem contagem) e o que fazer no detalhe', () => {
    const base = { tenantId: 't1', unidadeId: 'u1', ponte: 'Servidor com ponte', maquina: 'DESKTOP-SERVIDOR', pedidos: 1 };
    const semLogin = situacaoDoChatSemResposta({ ...base, motivo: 'sem_login' }, 'Loja Centro');
    expect(semLogin).toMatchObject({
      tenantId: 't1',
      unidadeId: 'u1',
      tipo: 'canal_desconectado',
      chave: 'chat:ifood:u1',
      titulo: 'Loja Centro · chat do iFood sem resposta: a ponte do chat "Servidor com ponte" está sem login no iFood',
      dados: { canal: 'ifood', chat: true, motivo: 'sem_login', pedidos: 1 },
    });
    expect(semLogin.detalhe).toBe(
      'No computador da ponte (DESKTOP-SERVIDOR), clique no ícone "Regem · Ponte do chat", perto do relógio, depois em "Abrir o Gestor do iFood", ' +
        'e entre com o login da loja nessa janela (o login feito em outro navegador não vale). Até lá, responda os clientes pelo Gestor de Pedidos do iFood. ' +
        'Há 1 pedido do iFood em andamento.',
    );
    const semSinal = situacaoDoChatSemResposta({ ...base, unidadeId: null, maquina: null, ponte: '', motivo: 'sem_sinal', pedidos: 0 }, 'Burger do Zé');
    // a ponte sem loja atende a empresa inteira: a chave é a da empresa; sem nome nem máquina, o texto não deixa buraco
    expect(semSinal).toMatchObject({ unidadeId: null, chave: 'chat:ifood:empresa', titulo: 'Burger do Zé · chat do iFood sem resposta: a ponte do chat parou de dar sinal' });
    expect(semSinal.detalhe).toBe(
      'O computador da ponte está desligado, sem internet ou com o programa fechado. Ligue o computador e abra o "Regem Ponte do chat" pelo atalho da Área de trabalho. ' +
        'Até lá, responda os clientes pelo Gestor de Pedidos do iFood.',
    );
    // o título não muda enquanto dura (o desfecho o repete): nem hora, nem número
    expect(semLogin.titulo).not.toMatch(/\d/);
    expect(situacaoDoChatSemResposta({ ...base, motivo: 'sem_login', pedidos: 9 }, 'Loja Centro').titulo).toBe(semLogin.titulo);
  });

  it('os nomes que o aviso do chat cita existem no programa da ponte e no instalador (V65)', () => {
    const raiz = join(__dirname, '..', '..', '..', '..');
    const ponte = readFileSync(join(raiz, 'ponte-chat', 'src', 'main.js'), 'utf8');
    expect(ponte).toContain(`{ label: '${PONTE_MENU_ABRIR_IFOOD}', click: () => abrirGestor() }`);
    expect(ponte).toContain(`bandeja.setToolTip(\`${PONTE_ICONE}\\n`);
    const instalador = readFileSync(join(raiz, 'backend', 'edge', 'regem-edge.iss'), 'utf8');
    expect(instalador).toContain(`Name: "{commondesktop}\\${PONTE_ATALHO}"`);
    // e a descrição do tipo, na tela Mister › Avisos, fala do chat
    expect(TIPOS_DE_AVISO.find((t) => t.tipo === 'canal_desconectado')?.descricao).toContain('o chat do iFood ficou sem ninguém respondendo');
  });
});

describe('Mister — o pedido parado', () => {
  const pedido = { id: 'p1', tenantId: 't', unidadeId: 'u', canal: 'ifood', numero: 284, displayId: '4821', parametro: 20 };

  it('as três etapas, com o pedido citado como no quadro do Delivery e um aviso por pedido e etapa', () => {
    expect(situacaoDoPedidoParado({ ...pedido, status: 'novo' }, 'Loja Centro')).toEqual({
      tenantId: 't',
      unidadeId: 'u',
      tipo: 'pedido_parado',
      chave: 'pedido:p1:novo',
      titulo: 'Loja Centro · pedido #284 · iFood 4821 sem aceite há mais de 20 min',
      detalhe: 'Aceite ou recuse em Delivery › Painel, em "AVANÇAR".',
      dados: { pedidoId: 'p1', etapa: 'novo', parametro: 20 },
    });
    expect(situacaoDoPedidoParado({ ...pedido, status: 'confirmado' }, 'Loja Centro')).toMatchObject({
      chave: 'pedido:p1:confirmado',
      titulo: 'Loja Centro · pedido #284 · iFood 4821 aceito há mais de 20 min e ainda consta em produção',
      detalhe: expect.stringMatching(/^Se já saiu, atualize em .*"AVANÇAR"\. Se não saiu, confira na cozinha\.$/),
    });
    expect(situacaoDoPedidoParado({ ...pedido, status: 'pronto', parametro: 30 }, 'Loja Centro')).toMatchObject({
      chave: 'pedido:p1:pronto',
      titulo: 'Loja Centro · pedido #284 · iFood 4821 pronto há mais de 30 min sem sair para a entrega',
      detalhe: 'Confira o entregador e despache em Delivery › Painel, em "Despachar".',
    });
    // O pedido do nosso cardápio, sem número do canal.
    expect(situacaoDoPedidoParado({ ...pedido, canal: 'cardapio', displayId: null, status: 'novo' }, 'L').titulo).toBe('L · pedido #284 · Cardápio sem aceite há mais de 20 min');
    // Os botões citados são dos que o guia confere contra a tela.
    expect(GUIA_DE_USO.find((x) => x.id === 'aceitar-avancar')!.botoes).toEqual(expect.arrayContaining(['AVANÇAR', 'Despachar']));
  });
});

describe('os avisos SÓ DA DISTRIBUIÇÃO (decisão 4 do protótipo Sentinela e Mentor)', () => {
  it('o segredo tirado vai só ao suporte da DMS, com a regra fixa, e não é um tipo que a loja configura', () => {
    expect(TIPOS_DA_DISTRIBUICAO).toEqual(['segredo_na_resposta']);
    expect(AVISOS_DA_DISTRIBUICAO.segredo_na_resposta).toEqual({ ligado: true, destinos: ['dms'], escalaMin: null, escalaPara: [], parametro: null });
    expect(TIPOS_DE_AVISO.map((t) => t.tipo)).not.toContain('segredo_na_resposta');
    expect(ehAvisoDaDistribuicao('segredo_na_resposta')).toBe(true);
    expect(ehAvisoDaDistribuicao('impressora')).toBe(false);
    expect(SEGREDO_ABERTO_H).toBe(24);
  });
  it('o aviso diz a hora e as consultas — nunca o segredo; um por pergunta', () => {
    const s = situacaoDoSegredo({ tenantId: 't', perguntaId: 'p1', quando: '16/11 03:12', consultas: ['canais_e_integracoes', ''] });
    expect(s).toEqual({
      tenantId: 't', unidadeId: null, tipo: 'segredo_na_resposta', chave: 'segredo:p1', titulo: 'Segredo tirado da resposta do Mister',
      detalhe: 'Em 16/11 03:12, o filtro de saída trocou a resposta inteira pela frase fixa (consultas: canais_e_integracoes). O segredo não foi enviado nem guardado. Veja em Console › Mister › Segurança.',
      dados: { consultas: ['canais_e_integracoes'] },
    });
    expect(situacaoDoSegredo({ tenantId: 't', perguntaId: 'p2', quando: '16/11 03:12', consultas: [] }).detalhe).toContain('pela frase fixa. O segredo');
  });
});

describe('Mister — o ponto esquecido (M3e, conversa 19 da versão 3)', () => {
  // 16/11/2026 (segunda) às 10:30 de Brasília = 13:30 UTC.
  const AGORA = new Date('2026-11-16T13:30:00Z');
  const turno = (o: Record<string, unknown>) => ({
    alocacaoId: 'a1',
    tenantId: 't',
    unidadeId: 'u',
    loja: 'Loja Centro',
    nome: 'Bruno Dias',
    data: '2026-11-15',
    inicio: '18:00',
    fim: '02:00',
    // 15/11 18:00 e 16/11 02:00 de Brasília.
    inicioEm: new Date('2026-11-15T21:00:00Z'),
    fimEm: new Date('2026-11-16T05:00:00Z'),
    entradas: 1,
    saidas: 0,
    ...o,
  });
  it('o que falta: a entrada depois do início; a saída depois do fim (com a entrada); com as duas, nada', () => {
    const t = turno({});
    expect(faltaNoTurno(t, new Date('2026-11-16T05:20:00Z').getTime(), 30)).toBeNull(); // 02:20: ainda nos 30 min
    expect(faltaNoTurno(t, new Date('2026-11-16T05:31:00Z').getTime(), 30)).toBe('saida');
    expect(faltaNoTurno({ ...t, entradas: 0 }, new Date('2026-11-15T21:31:00Z').getTime(), 30)).toBe('entrada');
    expect(faltaNoTurno({ ...t, saidas: 1 }, AGORA.getTime(), 0)).toBeNull();
  });
  it('o resumo do dia seguinte (a partir das 10h): os turnos de ONTEM de cada loja numa lista, com onde ajustar', () => {
    const r = situacoesDoPonto(
      [turno({}), turno({ alocacaoId: 'a2', nome: 'Lia Rocha', entradas: 0, inicio: '18:00' }), turno({ alocacaoId: 'a3', nome: 'Caio', saidas: 1 })],
      AGORA,
    );
    const resumo = r.find((s) => (s.dados as any).modo === 'resumo')!;
    expect(resumo).toMatchObject({
      tipo: 'ponto_esquecido',
      chave: 'ponto:u:2026-11-15',
      titulo: 'Loja Centro · ponto esquecido ontem, 15/11',
      dados: { modo: 'resumo', dia: '2026-11-15', faltas: 2 },
    });
    expect(resumo.detalhe).toBe('• Bruno Dias, sem a saída (turno até 02:00)\n• Lia Rocha, sem a entrada (turno das 18:00)\n\nO ajuste é em Pessoas › Gerenciamento de ponto.');
    // Antes das 10h ainda não há resumo; o turno a turno segue (até 12 h depois do fim).
    const cedo = situacoesDoPonto([turno({})], new Date('2026-11-16T12:00:00Z'));
    expect(cedo.map((s) => (s.dados as any).modo)).toEqual(['turno']);
    expect(cedo[0]).toMatchObject({ chave: 'ponto:a1:saida', titulo: 'Loja Centro · Bruno Dias sem a saída do ponto (turno até 02:00)', dados: { atrasoMin: 420 } }); // 09:00 contra o fim às 02:00
    // 12 horas depois do fim, o turno a turno some.
    expect(situacoesDoPonto([turno({})], new Date('2026-11-16T17:01:00Z')).filter((s) => (s.dados as any).modo === 'turno')).toEqual([]);
  });
  it('a regra da empresa escolhe: o resumo (0) ou o turno a turno pelo tempo (30, 60)', () => {
    expect(QUANDO_DO_PONTO).toEqual([0, 30, 60]);
    expect(pontoNoTempoDoAviso({ modo: 'resumo' }, 0)).toBe(true);
    expect(pontoNoTempoDoAviso({ modo: 'resumo' }, 30)).toBe(false);
    expect(pontoNoTempoDoAviso({ modo: 'turno', atrasoMin: 45 }, 30)).toBe(true);
    expect(pontoNoTempoDoAviso({ modo: 'turno', atrasoMin: 45 }, 60)).toBe(false);
    expect(pontoNoTempoDoAviso({ modo: 'turno', atrasoMin: 45 }, 0)).toBe(false);
    // A tela: o tempo fora da lista é recusado; o salvo fora da lista volta ao padrão.
    expect(conferirRegras({ regras: [{ tipo: 'ponto_esquecido', ligado: true, destinos: ['gerente'], escalaMin: null, escalaPara: [], parametro: 15 }] })).toEqual({
      erro: 'Escolha quando avisar do ponto esquecido: no dia seguinte às 10h, 30 minutos depois ou 1 hora depois.',
    });
    expect(regraQueVale('ponto_esquecido', { ligado: true, destinos: ['gerente'], parametro: 99 }).parametro).toBe(0);
    expect(regraQueVale('ponto_esquecido', { ligado: true, destinos: ['gerente'], parametro: 60 }).parametro).toBe(60);
  });
});

// G2 do protótipo `mockups/regem-whatsapp-gasto.html` (aprovado em 18/11/2026; mig 445/446): os alertas de gasto do
// WhatsApp oficial pelo Mister — os valores, a regra, o salvar, os textos e quem avisa.
describe('Mister — o gasto do WhatsApp oficial (G2)', () => {
  const ERRO_DO_VALOR = 'Cada valor do alerta de gasto vai de R$ 1,00 a R$ 100.000,00.';
  it('os valores do alerta: de R$ 1 a R$ 100.000 (duas casas), sem repetir, até 10, em ordem', () => {
    expect(conferirValoresDoGasto([400, 100, '200'])).toEqual([100, 200, 400]);
    expect(conferirValoresDoGasto([100.456])).toEqual([100.46]);
    expect(conferirValoresDoGasto(null)).toEqual([]);
    expect(conferirValoresDoGasto(undefined)).toEqual([]);
    expect(conferirValoresDoGasto('100')).toEqual({ erro: 'Os valores do alerta de gasto vêm numa lista.' });
    expect(conferirValoresDoGasto([0.5])).toEqual({ erro: ERRO_DO_VALOR });
    expect(conferirValoresDoGasto([100001])).toEqual({ erro: ERRO_DO_VALOR });
    expect(conferirValoresDoGasto(['abc'])).toEqual({ erro: ERRO_DO_VALOR });
    expect(conferirValoresDoGasto([''])).toEqual({ erro: ERRO_DO_VALOR });
    expect(conferirValoresDoGasto([100, 100.001])).toEqual({ erro: 'O valor R$ 100,00 está repetido no alerta de gasto.' });
    expect(conferirValoresDoGasto(Array.from({ length: 11 }, (_, i) => i + 1))).toEqual({ erro: 'O alerta de gasto aceita até 10 valores.' });
    expect(emReais(1284.9)).toBe('R$ 1.284,90');
    expect(emReais(12.5, 'USD')).toBe('USD 12,50');
  });

  it('a regra que vale: os valores só no gasto, em ordem — o valor estragado no banco não derruba a regra', () => {
    expect(regraQueVale('gasto_whatsapp', null)).toEqual({ ligado: false, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: null, valores: [] });
    expect(regraQueVale('gasto_whatsapp', { ligado: true, destinos: ['presidente'], valores: [400, 100] }).valores).toEqual([100, 400]);
    expect(regraQueVale('gasto_whatsapp', { ligado: true, destinos: ['presidente'], valores: [0] }).valores).toEqual([]);
    expect(regraQueVale('franquia_atendimento', null)).toEqual({ ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: null });
    expect('valores' in regraQueVale('impressora', null)).toBe(false);
  });

  it('salvar: só os destinos de dinheiro, sem "se ninguém resolver"; o gasto ligado pede pelo menos um valor', () => {
    const r = (x: Record<string, unknown>) =>
      conferirRegras({ regras: [{ tipo: 'gasto_whatsapp', ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [], valores: [200, 100], ...x }] });
    expect(r({})).toEqual([{ tipo: 'gasto_whatsapp', regra: { ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: null, valores: [100, 200] } }]);
    expect(r({ destinos: ['presidente', 'tela', 'dms', 'gerente'] })).toEqual([expect.objectContaining({ tipo: 'gasto_whatsapp' })]);
    expect(r({ destinos: ['kds'] })).toEqual({ erro: expect.stringContaining('o KDS e o Atendimento não recebem aviso de gasto') });
    expect(r({ escalaMin: 5, escalaPara: ['gerente'] })).toEqual({ erro: expect.stringContaining('não tem "se ninguém resolver"') });
    expect(r({ valores: [] })).toEqual({ erro: 'Ponha pelo menos um valor no alerta de gasto, ou desligue o aviso.' });
    expect(r({ ligado: false, valores: [] })).toEqual([{ tipo: 'gasto_whatsapp', regra: expect.objectContaining({ ligado: false, valores: [] }) }]);
    expect(r({ valores: [100, 100] })).toEqual({ erro: 'O valor R$ 100,00 está repetido no alerta de gasto.' });
    expect(conferirRegras({ regras: [{ tipo: 'franquia_atendimento', ligado: true, destinos: ['atendimento'], escalaMin: null, escalaPara: [] }] })).toEqual({
      erro: expect.stringContaining('não recebem aviso de gasto'),
    });
    // Os outros avisos não ganham valores.
    expect(conferirRegras({ regras: [{ tipo: 'caixa_24h', ligado: true, destinos: ['gerente'], escalaMin: null, escalaPara: [], valores: [1] }] })).toEqual([
      { tipo: 'caixa_24h', regra: { ligado: true, destinos: ['gerente'], escalaMin: null, escalaPara: [], parametro: null } },
    ]);
  });

  const G = { tenantId: 't1', mes: '2026-11', custo: 201.4, marketing: 160.21, utilidade: 36.19, atendimento: 5, quando: '18/11, 20:05', projecao: 339.6, moeda: 'BRL' };
  it('o aviso de um valor passado: quanto foi, de onde veio, a projeção, o próximo valor e onde ver', () => {
    const s = situacaoDoGasto(G, 200, [100, 200, 400]);
    expect(s).toMatchObject({ tipo: 'gasto_whatsapp', chave: 'gasto:2026-11:200.00', unidadeId: null, dados: { mes: '2026-11', valor: 200, custo: 201.4, proximo: 400 } });
    expect(textoDoAviso(s)).toBe(
      '⚠️ O gasto do WhatsApp oficial de novembro passou de R$ 200,00.\n\n' +
        'R$ 201,40 até agora (18/11, 20:05).\n' +
        'Marketing: R$ 160,21 · avisos do pedido: R$ 36,19 · atendimento: R$ 5,00.\n' +
        'Neste ritmo, o mês fecha perto de R$ 340,00.\n' +
        'Próximo alerta: R$ 400,00.\n' +
        'Veja no Regem, no menu WhatsApp, em "Uso e gasto".',
    );
    const ultimo = situacaoDoGasto({ ...G, custo: 402.9, projecao: null }, 400, [100, 200, 400]);
    expect(ultimo.detalhe).toContain('Este era o último alerta do mês. Para avisar acima disso, ponha mais um valor no Regem, no menu Mister, em "Avisos e relatórios".');
    expect(ultimo.detalhe).not.toContain('Neste ritmo');
    // O próximo pula o valor que o gasto também já passou.
    expect(situacaoDoGasto({ ...G, custo: 250 }, 100, [100, 200, 400]).dados).toMatchObject({ proximo: 400 });
    expect(situacaoDoGasto({ ...G, moeda: 'USD' }, 200, [200]).titulo).toBe('O gasto do WhatsApp oficial de novembro passou de USD 200,00');
  });

  it('quem avisa: os valores que o gasto passou e ainda não avisaram no mês — o aberto segue; o fechado não volta; mês novo recomeça', () => {
    const doMes = new Map<string, 'aberto' | 'resolvido'>([
      [chaveDoGasto('2026-11', 100), 'resolvido'],
      [chaveDoGasto('2026-11', 200), 'aberto'],
    ]);
    expect(valoresQueAvisam({ mes: '2026-11', custo: 250 }, [100, 200, 400], doMes)).toEqual([200]);
    expect(valoresQueAvisam({ mes: '2026-11', custo: 450 }, [100, 200, 400], doMes)).toEqual([200, 400]);
    expect(valoresQueAvisam({ mes: '2026-12', custo: 150 }, [100, 200, 400], doMes)).toEqual([100]);
    expect(valoresQueAvisam({ mes: '2026-11', custo: 99.99 }, [100], new Map())).toEqual([]);
  });

  it('a franquia: passou de 900, ou já das 1.000 na primeira leitura; a chave pelos 8 últimos dígitos (com e sem o nono)', () => {
    const s = situacaoDaFranquia({ tenantId: 't1', mes: '2026-11', numero: '552199992210', usadas: 900 });
    expect(s).toMatchObject({ tipo: 'franquia_atendimento', chave: 'franquia:2026-11:99992210', unidadeId: null, dados: { usadas: 900, final: '2210' } });
    expect(s.titulo).toBe('O número final 2210 já usou 900 das 1.000 mensagens de atendimento grátis de novembro');
    expect(s.detalhe).toContain('sem ela, a Meta para de entregar essas respostas até o dia 1º');
    expect(situacaoDaFranquia({ tenantId: 't1', mes: '2026-11', numero: '552199992210', usadas: 1010 }).titulo).toBe(
      'O número final 2210 já passou das 1.000 mensagens de atendimento grátis de novembro (1.010 até agora)',
    );
    expect(chaveDaFranquia('2026-11', '5521999992210')).toBe(chaveDaFranquia('2026-11', '552199992210'));
  });

  it('"no menu WhatsApp, em Uso e gasto" e "no menu Mister, em Avisos e relatórios": o menu e a tela têm o caminho (V65)', () => {
    const raiz = join(__dirname, '../../../../frontend/src');
    const shell = readFileSync(join(raiz, 'components/app-shell/shell.tsx'), 'utf8');
    const tela = readFileSync(join(raiz, 'app/whatsapp/page.tsx'), 'utf8');
    expect(ONDE_VER_O_GASTO).toBe('Veja no Regem, no menu WhatsApp, em "Uso e gasto".');
    expect(shell).toMatch(/href: '\/whatsapp', label: 'WhatsApp'/);
    expect(tela).toContain('href="/whatsapp/gasto"');
    expect(tela).toMatch(/>\s*Uso e gasto\s*</);
    expect(shell).toMatch(/href: '\/mister', label: 'Mister'/);
    expect(readFileSync(join(raiz, 'app/mister/page.tsx'), 'utf8')).toContain("avisos: 'Avisos e relatórios'");
  });
});

describe('o aviso da validade pendente (P1 de "Pedidos e recebimento", PR-2)', () => {
  it('ao gerente, em "Na loja", ligado de partida; a situação por pedido, com o dia como marco (lembra uma vez por dia)', () => {
    expect(TIPOS_DE_AVISO.find((t) => t.tipo === 'validade_pendente')).toMatchObject({
      grupo: 'Na loja',
      titulo: 'Validade pendente',
      padrao: { ligado: true, destinos: ['gerente'], escalaMin: null, escalaPara: [], parametro: null },
      jaFunciona: true,
    });
    const s = situacaoDaValidadePendente({
      tenantId: 't', unidadeId: 'u', listaId: 'l1', pedido: 'Nota 48.213', recebidaEm: '2026-11-23T21:00:00Z', itens: 5,
      nomes: ['Carne 56 g', 'Queijo', 'Tomate'], dia: '2026-11-25',
    });
    expect(s).toEqual({
      tenantId: 't',
      unidadeId: 'u',
      tipo: 'validade_pendente',
      chave: 'validade:l1',
      titulo: 'Falta a validade de 5 itens recebidos: Carne 56 g, Queijo, Tomate e mais 2 (Nota 48.213, recebido em 23/11)',
      detalhe: 'Responda a data (ex.: "a carne vence 02/12") ou informe em Estoque › Pedidos › Validade pendente.',
      dados: { marco: '2026-11-25', listaId: 'l1', itens: 5 },
    });
    expect(situacaoDaValidadePendente({ tenantId: 't', unidadeId: null, listaId: 'l2', pedido: 'Semanal', recebidaEm: null, itens: 1, nomes: ['Carne 56 g'], dia: '2026-11-25' }).titulo).toBe(
      'Falta a validade de 1 item recebido: Carne 56 g (Semanal)',
    );
  });
});

describe('o aviso do pedido atrasado (P3 de "Pedidos e recebimento", PR-6)', () => {
  it('ao gerente, em "Na loja", ligado de partida', () => {
    expect(TIPOS_DE_AVISO.find((t) => t.tipo === 'pedido_atrasado')).toMatchObject({
      grupo: 'Na loja',
      titulo: 'Pedido de fornecedor atrasado',
      padrao: { ligado: true, destinos: ['gerente'], escalaMin: null, escalaPara: [], parametro: null },
      jaFunciona: true,
    });
  });

  it('o dia do aviso vira às 10h da loja: a previsão de ontem só atrasa às 10h de hoje', () => {
    expect(diaDoAvisoDeAtraso(new Date('2026-11-25T12:59:00Z'))).toBe('2026-11-24'); // 09:59 em Brasília
    expect(diaDoAvisoDeAtraso(new Date('2026-11-25T13:00:00Z'))).toBe('2026-11-25'); // 10:00
    expect(diaDoAvisoDeAtraso(new Date('2026-11-26T02:30:00Z'))).toBe('2026-11-25'); // 23:30 do dia 25
  });

  it('a situação por pedido, com os dias de atraso no título e o dia como marco (lembra uma vez por dia)', () => {
    const s = situacaoDoPedidoAtrasado({ tenantId: 't', unidadeId: 'u', listaId: 'l1', pedido: 'Pedido da semana', fornecedor: 'Rucas', previsao: '2026-11-22', dia: '2026-11-24' });
    expect(s).toEqual({
      tenantId: 't',
      unidadeId: 'u',
      tipo: 'pedido_atrasado',
      chave: 'atraso:l1',
      titulo: 'Tem pedido de fornecedor em aberto para receber: Pedido da semana · Rucas (previsão 22/11, 2 dias de atraso)',
      detalhe: 'Quando chegar, receba em Estoque › Pedidos › Conferir e receber. Se a data mudou, toque em "Mudar a previsão".',
      dados: { marco: '2026-11-24', listaId: 'l1', previsao: '2026-11-22', diasDeAtraso: 2 },
    });
    expect(situacaoDoPedidoAtrasado({ tenantId: 't', unidadeId: null, listaId: 'l2', pedido: 'Compras do mercado', fornecedor: null, previsao: '2026-11-24', dia: '2026-11-25' }).titulo).toBe(
      'Tem pedido de fornecedor em aberto para receber: Compras do mercado (previsão 24/11, 1 dia de atraso)',
    );
    // Com o 📦 do protótipo, e não o ⚠️ dos outros avisos.
    expect(textoDoAviso(s).startsWith('📦 Tem pedido de fornecedor em aberto para receber: Pedido da semana · Rucas')).toBe(true);
  });

  it('"Já chegou" e "Mudar a previsão", com o pedido no id; outro id não é deste aviso', () => {
    const id = '0b0e8f3e-6d5c-4a9f-9a51-3c1f0e2d7a10';
    expect(botoesDoPedidoAtrasado(id)).toEqual([
      { id: `ped:chegou:${id}`, titulo: 'Já chegou' },
      { id: `ped:prev:${id}`, titulo: 'Mudar a previsão' },
    ]);
    expect(botoesDoPedidoAtrasado(undefined)).toEqual([]);
    expect(botoesDoPedidoAtrasado('nao-e-id')).toEqual([]);
    expect(lerBotaoDoPedidoAtrasado(`ped:chegou:${id}`)).toEqual({ acao: 'chegou', listaId: id });
    expect(lerBotaoDoPedidoAtrasado(`ped:prev:${id.toUpperCase()}`)).toEqual({ acao: 'prev', listaId: id });
    expect(lerBotaoDoPedidoAtrasado(`ped:apagar:${id}`)).toBeNull();
    expect(lerBotaoDoPedidoAtrasado(`doc:pago:${id}`)).toBeNull();
  });
});
