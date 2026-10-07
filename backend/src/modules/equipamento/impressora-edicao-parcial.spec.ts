import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { EquipamentoService } from './equipamento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// EDIÇÃO PARCIAL DE IMPRESSORA — contra o Postgres real.
//
// Duas telas editam a mesma impressora com campos diferentes: "Equipamentos" (o que imprime,
// acentos, papel, setores atendidos, impressora padrão) e "Impressoras e cupons" (direcionamento,
// conexão, vias). O salvar regravava TODOS os campos: o de uma tela zerava, com os valores padrão,
// o que a outra tinha configurado — salvar o nome em "Impressoras e cupons" desligava os acentos,
// trocava o papel de 58 para 80 mm e apagava os setores atendidos. Campo ausente tem de manter.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('impressora-edicao-parcial.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('edição parcial de impressora', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const svc = new EquipamentoService(db, { registrar: async () => undefined } as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const edgeOriginal = process.env.EDGE_MODE;
  const SETOR = '00000000-0000-4000-8000-0000000000b1';

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

  async function empresa() {
    const t = (await q(`insert into empresa (nome) values ('teste impressora parcial') returning id`))[0].id as string;
    empresas.push(t);
    return t;
  }
  /** Como a tela de Equipamentos cadastra: tudo configurado. */
  const completa = (t: string) =>
    svc.salvarImpressora(t, {
      nome: 'Cozinha de teste', fazCupom: true, fazProducao: true, conexao: 'rede', host: '192.168.0.50', porta: 9100,
      largura: 58, codepage: 'cp860', setoresAtendidos: [SETOR], padrao: true, vias: 2, viasCliente: 1, viasProducao: 3, ativo: true,
    });
  const gravada = async (id: string) =>
    (await q(`select nome, papel, faz_cupom, faz_producao, faz_etiqueta, conexao, host, porta, dispositivo, largura, codepage, setores_atendidos, padrao, vias, vias_cliente, vias_producao, ativo from equipamento where id = $1`, [id]))[0];

  it('salvar só "ativo" (a chave da lista) não mexe em mais nada', async () => {
    const t = await empresa();
    const imp: any = await completa(t);
    const antes = await gravada(imp.id);
    await svc.salvarImpressora(t, { id: imp.id, ativo: false });
    expect(await gravada(imp.id)).toEqual({ ...antes, ativo: false });
  });

  it('salvar nome e vias mantém o que a outra tela configurou (acentos, papel, setores, padrão, o que imprime)', async () => {
    const t = await empresa();
    const imp: any = await completa(t);
    await svc.salvarImpressora(t, { id: imp.id, nome: 'Cozinha nova', viasCliente: 2 });
    expect(await gravada(imp.id)).toMatchObject({
      nome: 'Cozinha nova', vias_cliente: 2, vias_producao: 3, vias: 2,
      codepage: 'cp860', largura: 58, setores_atendidos: [SETOR], padrao: true, faz_cupom: true, faz_producao: true,
      conexao: 'rede', host: '192.168.0.50', porta: 9100,
    });
  });

  it('o que VEM é gravado: direcionamento pelo papel, vias vazias, troca de conexão', async () => {
    const t = await empresa();
    const imp: any = await completa(t);
    await svc.salvarImpressora(t, { id: imp.id, papel: 'producao', viasCliente: null });
    expect(await gravada(imp.id)).toMatchObject({ papel: 'producao', faz_cupom: false, faz_producao: true, vias_cliente: null, codepage: 'cp860' });
    // rede → local: o par host/porta sai e entra o nome no Windows
    await svc.salvarImpressora(t, { id: imp.id, conexao: 'local', dispositivo: 'TERMICA-DE-TESTE' });
    expect(await gravada(imp.id)).toMatchObject({ conexao: 'local', host: null, porta: null, dispositivo: 'TERMICA-DE-TESTE', largura: 58 });
    // e etiqueta é exclusiva: deixa de fazer cupom e produção
    await svc.salvarImpressora(t, { id: imp.id, papel: 'etiqueta', linguagemEtiqueta: 'zpl' });
    expect(await gravada(imp.id)).toMatchObject({ papel: 'etiqueta', faz_etiqueta: true, faz_cupom: false, faz_producao: false });
  });

  it('o pedido completo (como a tela de Equipamentos manda) continua gravando tudo', async () => {
    const t = await empresa();
    const imp: any = await completa(t);
    await svc.salvarImpressora(t, {
      id: imp.id, nome: 'Outra', fazCupom: true, fazProducao: false, conexao: 'rede', host: '192.168.0.60', porta: 9101,
      largura: 80, codepage: '', setoresAtendidos: [], padrao: false, vias: 1, ativo: true,
    });
    expect(await gravada(imp.id)).toMatchObject({
      nome: 'Outra', faz_cupom: true, faz_producao: false, host: '192.168.0.60', porta: 9101, largura: 80, codepage: null,
      setores_atendidos: [], padrao: false, vias: 1,
    });
  });

  it('cadastro novo continua com os padrões; impressora de outra empresa não é alterada', async () => {
    const t = await empresa();
    const outra = await empresa();
    const nova: any = await svc.salvarImpressora(t, { nome: 'Caixa de teste', papel: 'cupom', conexao: 'rede', host: '192.168.0.70' });
    expect(await gravada(nova.id)).toMatchObject({ papel: 'cupom', faz_cupom: true, faz_producao: false, largura: 80, codepage: null, vias: 1, ativo: true, padrao: false });
    await expect(svc.salvarImpressora(outra, { id: nova.id, nome: 'Indevida' })).rejects.toThrow('Impressora não encontrada');
    expect((await gravada(nova.id)).nome).toBe('Caixa de teste');
  });
});
