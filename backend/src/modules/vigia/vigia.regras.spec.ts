import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLOUD_ONLY_MODULES } from '../../edge-manifest';
import { VigiaProcessor } from './vigia.processor';
import { LIMITES_DO_VIGIA, REGRAS_DO_VIGIA, ServidorVigiado, acharProblemas, chaveDoServidor, semSinal } from './vigia.regras';
import { vigiaLigado } from './vigia.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS REGRAS DO VIGIA DO SERVIDOR DA LOJA (mig 413), sem banco: dada a linha de um servidor e a hora, quais problemas ele
// tem. O que se prova: cada regra dispara no limite certo e só nele; servidor sem sinal só tem a regra do sinal; dado
// torto é "não sei" e nunca vira achado nem erro; a evidência só leva o que as regras leem; os limites são os dos selos
// do console; e a rotina nasce desligada e não roda no servidor da loja.

const AGORA = new Date('2026-11-12T15:00:00.000Z');
const haMin = (m: number) => new Date(AGORA.getTime() - m * 60_000);
const E = '11111111-1111-4111-8111-111111111111';

const saudeBoa = () => ({
  servicos: { pg: 'Running', api: 'Running', web: 'Running', sync: 'Running', impressao: 'Running' },
  restaurando: false,
  backup: { ok: true, em: haMin(300).toISOString(), horas: 5, mb: 120, erro: null },
  bancoFalhasChecksum: 0,
  bancoPctTransacoes: 3.2,
  relogioDesvioS: 2,
  syncFalhandoDesde: null,
  impressorasSemResponder: [],
  impressorasComAviso: [],
});
const servidor = (o: Partial<ServidorVigiado> = {}, saude: any = {}): ServidorVigiado => ({
  equipamentoId: E,
  tenantId: '22222222-2222-4222-8222-222222222222',
  unidadeId: null,
  recebidoEm: haMin(1),
  discoLivreMb: 50_000,
  saude: saude === null ? null : { ...saudeBoa(), ...saude },
  ...o,
});
const regras = (s: ServidorVigiado) => acharProblemas(s, AGORA).map((a) => a.regra);

describe('o vigia do servidor da loja — as regras', () => {
  it('servidor saudável não tem achado', () => {
    expect(acharProblemas(servidor(), AGORA)).toEqual([]);
  });

  it('sem sinal: passa do limite (não no limite) e é a ÚNICA regra, mesmo com a saúde guardada ruim', () => {
    expect(semSinal(servidor({ recebidoEm: haMin(LIMITES_DO_VIGIA.semSinalMin) }), AGORA)).toBe(false);
    expect(semSinal(servidor({ recebidoEm: haMin(LIMITES_DO_VIGIA.semSinalMin + 1) }), AGORA)).toBe(true);
    const mudo = servidor({ recebidoEm: haMin(45), discoLivreMb: 10 }, { servicos: { pg: 'Stopped', api: 'Running', web: 'Running', sync: 'Running', impressao: 'Running' } });
    const achados = acharProblemas(mudo, AGORA);
    expect(achados).toHaveLength(1);
    expect(achados[0]).toMatchObject({ regra: 'servidor_sem_sinal', chave: chaveDoServidor(E), gravidade: 'critico', publico: 'ambos' });
    expect(achados[0].evidencia).toEqual({ ultimoSinalEm: haMin(45).toISOString(), minutosSemSinal: 45 });
  });

  it('quem nunca deu sinal não está "sem sinal" (não houve sinal para perder); a data como texto também vale', () => {
    expect(acharProblemas(servidor({ recebidoEm: null }), AGORA)).toEqual([]);
    expect(regras(servidor({ recebidoEm: haMin(30).toISOString() }))).toEqual(['servidor_sem_sinal']);
    expect(acharProblemas(servidor({ recebidoEm: 'não é data' }), AGORA)).toEqual([]);
  });

  it('serviço parado: um achado por serviço; banco e API são críticos, os outros atenção; sem a leitura, não sei', () => {
    const a = acharProblemas(servidor({}, { servicos: { pg: 'Stopped', api: 'Running', web: 'ausente', sync: 'Running', impressao: 'Running' } }), AGORA);
    expect(a.map((x) => [x.regra, x.chave, x.gravidade, x.publico])).toEqual([
      ['servico_parado', chaveDoServidor(E, 'servico', 'pg'), 'critico', 'distribuicao'],
      ['servico_parado', chaveDoServidor(E, 'servico', 'web'), 'atencao', 'distribuicao'],
    ]);
    expect(a[0].evidencia).toEqual({ servico: 'pg', estado: 'Stopped', restaurando: false });
    expect(regras(servidor({}, { servicos: null }))).toEqual([]);
    expect(regras(servidor({}, { servicos: { pg: 'Running' } }))).toEqual([]); // serviço que não veio na leitura não é "parado"
  });

  it('disco: abaixo de 2 GB (não em 2 GB); vale mesmo sem a saúde rica', () => {
    expect(regras(servidor({ discoLivreMb: LIMITES_DO_VIGIA.discoMinimoMb }))).toEqual([]);
    expect(regras(servidor({ discoLivreMb: LIMITES_DO_VIGIA.discoMinimoMb - 1 }))).toEqual(['disco_baixo']);
    expect(regras(servidor({ discoLivreMb: '1500' }, null))).toEqual(['disco_baixo']);
    expect(regras(servidor({ discoLivreMb: null }))).toEqual([]);
  });

  it('backup: falhou, passou de 48 h ou nunca foi reportado', () => {
    expect(regras(servidor({}, { backup: { ok: true, horas: LIMITES_DO_VIGIA.backupMaximoHoras } }))).toEqual([]);
    const velho = acharProblemas(servidor({}, { backup: { ok: true, horas: 49, erro: null } }), AGORA);
    expect(velho.map((x) => x.regra)).toEqual(['backup_atrasado']);
    expect(velho[0].evidencia).toMatchObject({ nuncaReportou: false, falhou: false, horas: 49 });
    const falhou = acharProblemas(servidor({}, { backup: { ok: false, horas: 2, erro: 'x'.repeat(300) } }), AGORA);
    expect(falhou[0].evidencia).toMatchObject({ falhou: true });
    expect(String(falhou[0].evidencia.erro)).toHaveLength(120);
    expect(acharProblemas(servidor({}, { backup: null }), AGORA)[0].evidencia).toMatchObject({ nuncaReportou: true });
    expect(regras(servidor({}, null))).toEqual([]); // sem saúde rica nenhuma, não sei do backup
  });

  it('banco: checksum acima de zero é crítico; transações acima de 50% é atenção e acima de 80%, crítico', () => {
    expect(regras(servidor({}, { bancoPctTransacoes: LIMITES_DO_VIGIA.transacoesAtencaoPct }))).toEqual([]);
    expect(acharProblemas(servidor({}, { bancoPctTransacoes: 51 }), AGORA)[0]).toMatchObject({ regra: 'banco_em_risco', gravidade: 'atencao' });
    expect(acharProblemas(servidor({}, { bancoPctTransacoes: 81 }), AGORA)[0]).toMatchObject({ regra: 'banco_em_risco', gravidade: 'critico' });
    expect(acharProblemas(servidor({}, { bancoFalhasChecksum: 1 }), AGORA)[0]).toMatchObject({ regra: 'banco_em_risco', gravidade: 'critico' });
    expect(regras(servidor({}, { bancoFalhasChecksum: null, bancoPctTransacoes: null }))).toEqual([]);
  });

  it('relógio: mais de 120 s para qualquer lado', () => {
    expect(regras(servidor({}, { relogioDesvioS: LIMITES_DO_VIGIA.relogioMaximoS }))).toEqual([]);
    expect(regras(servidor({}, { relogioDesvioS: 121 }))).toEqual(['relogio_desviado']);
    expect(regras(servidor({}, { relogioDesvioS: -121 }))).toEqual(['relogio_desviado']);
  });

  it('sync falhando: há mais de 15 min sem parar', () => {
    expect(regras(servidor({}, { syncFalhandoDesde: haMin(LIMITES_DO_VIGIA.syncFalhandoMin).toISOString() }))).toEqual([]);
    const a = acharProblemas(servidor({}, { syncFalhandoDesde: haMin(16).toISOString() }), AGORA);
    expect(a[0]).toMatchObject({ regra: 'sync_falhando', gravidade: 'critico', publico: 'distribuicao' });
    expect(a[0].evidencia).toEqual({ desde: haMin(16).toISOString(), minutos: 16 });
    expect(regras(servidor({}, { syncFalhandoDesde: 'ontem' }))).toEqual([]);
  });

  it('impressora parada: uma por impressora (a que não responde vence o aviso), público a loja', () => {
    const a = acharProblemas(
      servidor({}, {
        impressorasSemResponder: [{ id: 'imp-1', nome: 'Chapa', desde: '2026-11-12T14:00:00Z', erro: 'ETIMEDOUT', falhas: 4 }, { nome: 'sem id' }, 'lixo'],
        impressorasComAviso: [{ id: 'imp-1', nome: 'Chapa', estado: 'sem_papel' }, { id: 'imp-2', nome: 'Balcão', estado: 'sem_papel', detalhe: 'papel acabou' }],
      }),
      AGORA,
    );
    expect(a.map((x) => [x.chave, x.publico, x.evidencia.motivo])).toEqual([
      [chaveDoServidor(E, 'impressora', 'imp-1'), 'loja', 'sem_responder'],
      [chaveDoServidor(E, 'impressora', 'imp-2'), 'loja', 'aviso'],
    ]);
  });

  it('tudo errado ao mesmo tempo: uma chave por regra e alvo, todas das regras conhecidas', () => {
    const a = acharProblemas(
      servidor({ discoLivreMb: 100 }, {
        servicos: { pg: 'Stopped', api: 'Stopped', web: 'Stopped', sync: 'Stopped', impressao: 'Stopped' },
        backup: { ok: false, horas: 90, erro: 'falhou' },
        bancoFalhasChecksum: 3,
        bancoPctTransacoes: 90,
        relogioDesvioS: 600,
        syncFalhandoDesde: haMin(60).toISOString(),
        impressorasSemResponder: [{ id: 'a' }],
        impressorasComAviso: [{ id: 'b' }],
      }),
      AGORA,
    );
    const chaves = a.map((x) => `${x.regra}|${x.chave}`);
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(a).toHaveLength(12); // disco + 5 serviços + backup + banco + relógio + sync + 2 impressoras
    for (const x of a) expect(REGRAS_DO_VIGIA).toContain(x.regra);
  });

  it('dado torto é "não sei": nunca lança e nunca vira achado', () => {
    for (const saude of ['texto', 42, [], true, { servicos: 'x', backup: 'y', impressorasSemResponder: 'z', impressorasComAviso: 7, relogioDesvioS: 'abc', bancoPctTransacoes: {} }])
      expect(() => acharProblemas({ ...servidor(), saude } as any, AGORA)).not.toThrow();
    expect(acharProblemas({ ...servidor(), saude: 'texto' } as any, AGORA)).toEqual([]);
    expect(acharProblemas({ ...servidor(), saude: [] } as any, AGORA)).toEqual([]);
  });

  it('a evidência só leva o que as regras leem (a rede e os PCs conectados da saúde não passam)', () => {
    const a = acharProblemas(
      servidor({ discoLivreMb: 1 }, { rede: { ip: '192.168.0.77', mac: 'AA-BB' }, presenca: [{ nome: 'PC DO FULANO' }], servicos: { pg: 'Stopped' } }),
      AGORA,
    );
    const texto = JSON.stringify(a);
    expect(texto).not.toContain('192.168.0.77');
    expect(texto).not.toContain('FULANO');
  });

  it('os limites são os dos selos do console da distribuição (mudou um lado, muda o outro)', () => {
    const console_ = readFileSync(join(__dirname, '../../../../frontend/src/app/distribuicao/page.tsx'), 'utf8');
    expect(console_).toContain(`disco < ${LIMITES_DO_VIGIA.discoMinimoMb}`);
    expect(console_).toContain(`h > ${LIMITES_DO_VIGIA.backupMaximoHoras}`);
    expect(console_).toContain(`> ${LIMITES_DO_VIGIA.relogioMaximoS} &&`);
    expect(console_).toContain(`pct > ${LIMITES_DO_VIGIA.transacoesAtencaoPct}`);
    expect(console_).toContain(`pct > ${LIMITES_DO_VIGIA.transacoesCriticoPct}`);
  });
});

describe('o vigia do servidor da loja — a rotina', () => {
  const antes = { ligado: process.env.VIGIA_LIGADO, edge: process.env.EDGE_MODE };
  afterEach(() => {
    for (const [k, v] of [['VIGIA_LIGADO', antes.ligado], ['EDGE_MODE', antes.edge]] as const)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  });
  const rotina = () => {
    const volta = jest.fn(async () => ({}));
    return { volta, processor: new VigiaProcessor({ volta } as any) };
  };

  it('nasce DESLIGADA: sem a variável não roda; "1" e "true" ligam', async () => {
    delete process.env.EDGE_MODE;
    delete process.env.VIGIA_LIGADO;
    expect(vigiaLigado()).toBe(false);
    const a = rotina();
    await a.processor.processar();
    expect(a.volta).not.toHaveBeenCalled();
    for (const v of ['0', 'false', 'sim', '']) {
      process.env.VIGIA_LIGADO = v;
      expect(vigiaLigado()).toBe(false);
    }
    for (const v of ['1', 'true', ' TRUE ']) {
      process.env.VIGIA_LIGADO = v;
      expect(vigiaLigado()).toBe(true);
    }
    await a.processor.processar();
    expect(a.volta).toHaveBeenCalledTimes(1);
  });

  it('no servidor da loja não roda, mesmo ligada (a tabela nem existe lá)', async () => {
    process.env.VIGIA_LIGADO = '1';
    process.env.EDGE_MODE = 'true';
    const a = rotina();
    await a.processor.processar();
    expect(a.volta).not.toHaveBeenCalled();
  });

  it('uma volta por vez, e a volta que falha não derruba a próxima', async () => {
    delete process.env.EDGE_MODE;
    process.env.VIGIA_LIGADO = '1';
    let soltar: () => void = () => {};
    const volta = jest
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (soltar = r)))
      .mockImplementationOnce(async () => {
        throw new Error('banco fora');
      })
      .mockImplementationOnce(async () => ({}));
    const processor = new VigiaProcessor({ volta } as any);
    const primeira = processor.processar();
    await processor.processar(); // a primeira ainda roda: esta sai sem chamar
    expect(volta).toHaveBeenCalledTimes(1);
    soltar();
    await primeira;
    await expect(processor.processar()).resolves.toBeUndefined(); // a que falha não rejeita
    await processor.processar();
    expect(volta).toHaveBeenCalledTimes(3);
  });

  it('o módulo é só da nuvem (manifesto)', () => {
    expect(CLOUD_ONLY_MODULES).toContain('VigiaModule');
  });
});
