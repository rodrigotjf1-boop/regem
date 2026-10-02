import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { EquipamentoService } from './equipamento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AUDITORIA DO CADASTRO DE EQUIPAMENTOS (pedido do dono, 02/10/2026) — contra o Postgres real.
//
// Sete mutações mexiam em terminal, KDS e impressora sem deixar registro de quem fez: parear por
// token, impressora do terminal, impressão por etapa, próximo KDS, papéis, criar/editar e excluir
// impressora. Todas passam a auditar com `entidadeTipo = 'equipamento'` — é por esse campo que a
// tela de Equipamentos monta o histórico. O registrador aqui é de mentira (a `audit_log` é
// imutável: o que o teste gravasse nunca mais sairia do banco).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('equipamento-auditoria.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('auditoria do cadastro de equipamentos', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const auditorias: any[] = [];
  const svc = new EquipamentoService(db, { registrar: async (a: any) => void auditorias.push(a) } as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const edgeOriginal = process.env.EDGE_MODE;
  const ATOR = { id: '00000000-0000-4000-8000-0000000000a1', perfil: 'gerente' };

  beforeAll(() => {
    delete process.env.EDGE_MODE;
  });
  afterAll(async () => {
    if (edgeOriginal !== undefined) process.env.EDGE_MODE = edgeOriginal;
    if (empresas.length) {
      await pool.query('delete from equipamento where tenant_id = any($1::uuid[])', [empresas]);
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    }
    await pool.end();
  }, 120_000);
  beforeEach(() => {
    auditorias.length = 0;
  });

  async function empresa() {
    const t = (await q(`insert into empresa (nome) values ('teste auditoria equipamento') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id as string;
    return { t, u };
  }
  const equip = async (t: string, u: string | null, tipo: string, nome: string) =>
    (
      await q(`insert into equipamento (tenant_id, unidade_id, nome, tipo, token, ativo) values ($1,$2,$3,$4,$5,true) returning id, token`, [
        t,
        u,
        nome,
        tipo,
        randomBytes(24).toString('hex'),
      ])
    )[0] as { id: string; token: string };

  /** O único registro gravado, já conferido no que TODO registro de equipamento tem de ter. */
  const unico = (t: string, id: string) => {
    expect(auditorias).toHaveLength(1);
    expect(auditorias[0]).toMatchObject({ tenantId: t, atorId: ATOR.id, atorPerfil: 'gerente', tipo: 'config', entidadeTipo: 'equipamento', entidadeId: id });
    return auditorias[0];
  };

  it('cadastrar, editar e excluir impressora: três registros, com o destino e o estado da impressora', async () => {
    const { t, u } = await empresa();
    const criada = await svc.salvarImpressora(t, { nome: 'Cozinha', unidadeId: u, host: '192.168.0.50', porta: 9100, papel: 'producao', largura: 80 }, ATOR);
    expect(unico(t, criada.id)).toMatchObject({ acao: 'cadastrou_impressora', unidadeId: u, detalhe: { nome: 'Cozinha', destino: '192.168.0.50:9100', papel: 'producao', conexao: 'rede', ativo: true } });

    auditorias.length = 0;
    await svc.salvarImpressora(t, { id: criada.id, nome: 'Cozinha fria', conexao: 'local', dispositivo: 'EPSON TM-T20', largura: 58 }, ATOR);
    expect(unico(t, criada.id)).toMatchObject({ acao: 'editou_impressora', detalhe: { nome: 'Cozinha fria', destino: 'EPSON TM-T20', conexao: 'local', largura: 58 } });

    auditorias.length = 0;
    await svc.removerImpressora(t, criada.id, ATOR);
    expect(unico(t, criada.id)).toMatchObject({ acao: 'excluiu_impressora', detalhe: { nome: 'Cozinha fria', destino: 'EPSON TM-T20' } });
    expect(await q(`select 1 from equipamento where id = $1`, [criada.id])).toHaveLength(0);
  });

  it('papéis da impressora: guarda só o que mudou', async () => {
    const { t, u } = await empresa();
    const imp = await equip(t, u, 'impressora', 'Balcão');
    await svc.setPapeisImpressora(t, imp.id, { fazCupom: true }, ATOR);
    const a = unico(t, imp.id);
    expect(a).toMatchObject({ acao: 'alterou_papeis_impressora', detalhe: { nome: 'Balcão', fazCupom: true } });
    expect(a.detalhe).not.toHaveProperty('fazProducao');
  });

  it('impressora do terminal: registra de qual para qual, pelo nome; sem mudança não registra', async () => {
    const { t, u } = await empresa();
    const pdv = await equip(t, u, 'pdv', 'Caixa 1');
    const a = await equip(t, u, 'impressora', 'Cupom A');
    const b = await equip(t, u, 'impressora', 'Cupom B');

    await svc.setImpressoraTerminal(t, pdv.id, a.id, ATOR);
    expect(unico(t, pdv.id)).toMatchObject({ acao: 'alterou_impressora_do_terminal', detalhe: { nome: 'Caixa 1', impressoraAntes: null, impressoraDepois: 'Cupom A' } });

    auditorias.length = 0;
    await svc.setImpressoraTerminal(t, pdv.id, a.id, ATOR); // a mesma de novo
    expect(auditorias).toHaveLength(0);

    await svc.setImpressoraTerminal(t, pdv.id, b.id, ATOR);
    expect(unico(t, pdv.id).detalhe).toEqual({ nome: 'Caixa 1', impressoraAntes: 'Cupom A', impressoraDepois: 'Cupom B' });

    auditorias.length = 0;
    await svc.setImpressoraTerminal(t, pdv.id, null, ATOR);
    expect(unico(t, pdv.id).detalhe).toEqual({ nome: 'Caixa 1', impressoraAntes: 'Cupom B', impressoraDepois: null });
  });

  it('KDS: impressão por etapa e próximo KDS registram com o nome do destino', async () => {
    const { t, u } = await empresa();
    const kds = await equip(t, u, 'kds', 'KDS Chapa');
    const montagem = await equip(t, u, 'kds', 'KDS Montagem');
    const imp = await equip(t, u, 'impressora', 'Expedição');

    await svc.setImpressaoEtapa(t, kds.id, { imprimeAoAvancar: true, imprimeNoStatus: 'pronto', impressoraDestinoId: imp.id }, ATOR);
    expect(unico(t, kds.id)).toMatchObject({ acao: 'alterou_impressao_por_etapa', detalhe: { nome: 'KDS Chapa', imprimeAoAvancar: true, imprimeNoStatus: 'pronto', impressoraDestino: 'Expedição' } });

    auditorias.length = 0;
    await svc.setProximoKds(t, kds.id, montagem.id, ATOR);
    expect(unico(t, kds.id)).toMatchObject({ acao: 'alterou_proximo_kds', detalhe: { nome: 'KDS Chapa', proximoKds: 'KDS Montagem' } });

    auditorias.length = 0;
    await svc.setProximoKds(t, kds.id, null, ATOR);
    expect(unico(t, kds.id).detalhe).toEqual({ nome: 'KDS Chapa', proximoKds: null });
  });

  it('parear o terminal pelo token: registra quem pareou', async () => {
    const { t, u } = await empresa();
    const pdv = await equip(t, u, 'pdv', 'Caixa 2');
    const r = await svc.parear(t, pdv.token, ATOR);
    expect(r).toMatchObject({ id: pdv.id, nome: 'Caixa 2' });
    expect(unico(t, pdv.id)).toMatchObject({ acao: 'terminal_pareado', detalhe: { nome: 'Caixa 2', tipo: 'pdv', por: 'token' } });
  });

  it('o que falha não registra: equipamento de outra empresa, token errado, tipo errado', async () => {
    const { t, u } = await empresa();
    const outra = await empresa();
    const impDaOutra = await equip(outra.t, outra.u, 'impressora', 'Da outra empresa');
    const pdv = await equip(t, u, 'pdv', 'Caixa 3');

    await expect(svc.removerImpressora(t, impDaOutra.id, ATOR)).rejects.toThrow('Impressora não encontrada');
    await expect(svc.setPapeisImpressora(t, impDaOutra.id, { fazCupom: true }, ATOR)).rejects.toThrow();
    await expect(svc.setProximoKds(t, pdv.id, null, ATOR)).rejects.toThrow('KDS não encontrado'); // pdv não é KDS
    await expect(svc.parear(t, 'token-que-nao-existe', ATOR)).rejects.toThrow();
    expect(auditorias).toHaveLength(0);
    expect(await q(`select 1 from equipamento where id = $1`, [impDaOutra.id])).toHaveLength(1);
  });

  it('sem ator (chamada interna) a mutação funciona igual e o registro sai sem autor', async () => {
    const { t, u } = await empresa();
    const criada = await svc.salvarImpressora(t, { nome: 'Sem autor', unidadeId: u, host: '10.0.0.9' });
    expect(auditorias).toHaveLength(1);
    expect(auditorias[0]).toMatchObject({ acao: 'cadastrou_impressora', atorId: null, atorPerfil: null, entidadeId: criada.id });
  });
});
