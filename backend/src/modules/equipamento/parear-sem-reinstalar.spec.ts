import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lastValueFrom, of } from 'rxjs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { EquipamentoService } from './equipamento.service';
import { TerminalSegredoInterceptor } from '../../auth/terminal-segredo.interceptor';
import { mesmoLugarDeParear, ondeDigitar } from '../../common/onde-digitar';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PAREAR SEM REINSTALAR (pedido do dono de 22/10/2026): "temos que ter a opção de parear item já configurado que não
// está mais conectado sem ter de instalar, e novas instalações ou atualizações estavam inutilizando as configs de pdv e
// impressoras ou estação de impressões". Aqui (servidor):
//  • o código só vale no aparelho certo: digitado no errado é recusado SEM ser gasto (antes trocava o segredo do dono);
//    o garçom pareia pela tela do caixa; a estação antiga (sem o tipo) segue aceita;
//  • "Gerar código" e "Reativar" devolvem ONDE digitar (o ícone "Regem neste PC"; o instalador só para PC novo);
//  • a estação expõe quando pareou e o PC ("Novo PC com impressora" pareia de novo a que já existia);
//  • a recusa do terminal diz o motivo: só a revogação faz o PC esquecer o pareamento; o servidor recém-reinstalado
//    (cadastro voltando da nuvem) responde "carregando a loja", não "não pareado".

describe('onde digitar e o mesmo lugar de parear (sem banco)', () => {
  it('cada tipo diz o lugar com os nomes das telas; a estação lembra o instalador só para o PC novo', () => {
    expect(ondeDigitar('pdv')?.passos.join(' ')).toContain('"Código do terminal"');
    expect(ondeDigitar('salao')?.titulo).toBe('No celular ou tablet do garçom');
    expect(ondeDigitar('estacao_impressao')?.passos[0]).toContain('"Regem neste PC"');
    expect(ondeDigitar('estacao_impressao')?.obs).toContain('na tela "Este PC", marque "Este PC tem impressora"');
    expect(ondeDigitar('tela_senhas')?.passos[0]).toContain('"Parear esta TV"');
    expect(ondeDigitar('kds')).toBeNull();
  });
  // V65: cada nome que o texto cita existe onde ele manda a pessoa (a tela, o ícone, o instalador).
  it('parte 2: o atalho "Regem - parear este PC" e a faixa da tela Equipamentos citam o que existe', () => {
    const raiz = join(__dirname, '..', '..', '..', '..');
    const ler = (...p: string[]) => readFileSync(join(raiz, ...p), 'utf8');
    const atalho = 'Regem - parear este PC';
    expect(ondeDigitar('estacao_impressao')?.obs).toContain(`"${atalho}" na área de trabalho`);
    expect(ler('backend', 'edge', 'instalar-tudo.ps1')).toContain(`'${atalho}.lnk'`);
    const pagina = ler('frontend', 'src', 'app', 'equipamentos', 'page.tsx');
    const faixa = pagina.slice(pagina.indexOf('Trocou o servidor da loja de máquina?'), pagina.indexOf('</p>', pagina.indexOf('Trocou o servidor da loja de máquina?')));
    expect(faixa).toContain(`“${atalho}”`);
    expect(faixa).toContain('<strong>Gerar código</strong>');
    expect(pagina).toContain("rotulo: 'Gerar código'"); // a ação na linha da estação
    expect(faixa).toContain('<strong>Parear com codigo...</strong>');
    expect(ler('backend', 'edge', 'bandeja', 'RegemEstacao.cs')).toContain('"Parear com codigo..."');
    expect(faixa).toContain('“Regem — servidor da loja”');
    expect(ler('backend', 'edge', 'bandeja', 'RegemServidor.cs')).toContain('Titulo = "Regem \\u2014 servidor da loja"');
    expect(faixa).not.toMatch(/um a um|token\/pareamento novo/); // o texto antigo mandava reinstalar e parear tudo de novo
  });

  it('o caixa e o garçom pareiam pela mesma tela; os demais só no próprio tipo', () => {
    expect(mesmoLugarDeParear('salao', 'pdv')).toBe(true);
    expect(mesmoLugarDeParear('pdv', 'salao')).toBe(true);
    expect(mesmoLugarDeParear('pdv', 'estacao_impressao')).toBe(false);
    expect(mesmoLugarDeParear('estacao_impressao', 'pdv')).toBe(false);
    expect(mesmoLugarDeParear('tela_senhas', 'pdv')).toBe(false);
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('parear-sem-reinstalar.spec: sem TEST_PG_URL — a parte com Postgres foi PULADA');

descrever('parear sem reinstalar (Postgres real)', () => {
  jest.setTimeout(60_000);
  let pool: Pool;
  let svc: EquipamentoService;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const LOJA = randomUUID();
  const modoAntes = process.env.EDGE_MODE;

  const equip = async (tipo: string, nome: string, extra: Record<string, any> = {}) => {
    const cols = { id: randomUUID(), tenant_id: T, unidade_id: LOJA, tipo, nome, token: 'tok-' + randomUUID(), ...extra };
    const nomes = Object.keys(cols);
    await q(`insert into equipamento (${nomes.join(',')}) values (${nomes.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(cols));
    return cols.id as string;
  };
  const codigoDe = async (id: string) => (await q('select pareamento_codigo from equipamento where id = $1', [id]))[0].pareamento_codigo;

  beforeAll(async () => {
    process.env.EDGE_MODE = 'true';
    pool = new Pool({ connectionString: URL_PG });
    svc = new EquipamentoService(drizzle(pool, { schema }) as any, { registrar: async () => undefined } as any);
    await q(`create table if not exists sync_state (chave text primary key, valor text)`);
    await q(`insert into empresa (id, nome) values ($1, 'teste parear')`, [T]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1, $2, 'Loja')`, [LOJA, T]);
  });
  afterAll(async () => {
    if (modoAntes === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = modoAntes;
    if (!pool) return;
    await q(`delete from sync_state where chave in ('restaurar_solicitado', 'restaurando')`).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from unidade where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it('"Gerar código" e "Reativar" devolvem onde digitar, por tipo', async () => {
    const pdv = await equip('pdv', 'Caixa 1');
    const est = await equip('estacao_impressao', 'PC do delivery');
    expect((await svc.gerarCodigo(T, pdv, null, null)).onde?.titulo).toBe('No caixa');
    expect((await svc.gerarCodigo(T, est, null, null)).onde?.passos[0]).toContain('"Regem neste PC"');
    await svc.revogar(T, pdv, null, null);
    const r: any = await svc.reativar(T, pdv, null, null);
    expect(r.codigo).toMatch(/^\d{6}$/);
    expect(r.onde?.titulo).toBe('No caixa');
  });

  it('o código do caixa digitado na estação é recusado SEM ser gasto — e diz onde ele vale', async () => {
    const pdv = await equip('pdv', 'Caixa delivery');
    const { codigo } = await svc.gerarCodigo(T, pdv, null, null);
    await expect(svc.parearPorCodigo(codigo, 'CX-DELIVERY', 'estacao_impressao')).rejects.toThrow(
      'Este código é de "Caixa delivery", não deste aparelho — digite-o no caixa. Ele continua valendo.',
    );
    expect(await codigoDe(pdv)).toBe(codigo); // não foi gasto
    const ok: any = await svc.parearPorCodigo(codigo, undefined, 'pdv');
    expect(ok).toMatchObject({ terminalId: pdv, tipo: 'pdv' });
    expect(await codigoDe(pdv)).toBeNull();
  });

  it('o garçom pareia pela tela do caixa; o código da estação na tela do caixa é recusado sem gastar', async () => {
    const salao = await equip('salao', 'Garçom 1');
    const c1 = (await svc.gerarCodigo(T, salao, null, null)).codigo;
    expect(await svc.parearPorCodigo(c1, undefined, 'pdv')).toMatchObject({ terminalId: salao, tipo: 'salao' });
    const est = await equip('estacao_impressao', 'PC da cozinha');
    const c2 = (await svc.gerarCodigo(T, est, null, null)).codigo;
    await expect(svc.parearPorCodigo(c2, undefined, 'pdv')).rejects.toThrow('digite-o no PC da estação de impressão');
    expect(await codigoDe(est)).toBe(c2);
    // A estação antiga (sem o tipo) segue aceita — e grava o PC que pareou.
    expect(await svc.parearPorCodigo(c2, 'PC-COZINHA')).toMatchObject({ terminalId: est, tipo: 'estacao_impressao' });
  });

  it('a estação mostra QUANDO pareou e QUAL PC (o "Novo PC com impressora" espera o pareamento novo)', async () => {
    const est = await equip('estacao_impressao', 'PC do balcão');
    let e: any = ((await svc.listar(T)) as any[]).find((x) => x.id === est);
    expect(e).toMatchObject({ pareado: false, pareadoEm: null, maquinaPareada: null });
    await svc.parearPorCodigo((await svc.gerarCodigo(T, est, null, null)).codigo, 'PC-BALCAO', 'estacao_impressao');
    e = ((await svc.listar(T)) as any[]).find((x) => x.id === est);
    expect(e).toMatchObject({ pareado: true, maquinaPareada: 'PC-BALCAO' });
    // A tela compara o texto que chega no JSON (ISO, com milissegundos) — como aqui.
    const antes = JSON.parse(JSON.stringify(e)).pareadoEm;
    await new Promise((r) => setTimeout(r, 20));
    // Parear de novo a MESMA estação (o PC que já tinha uma): a data muda, o id e as impressoras ficam.
    await svc.parearPorCodigo((await svc.gerarCodigo(T, est, null, null)).codigo, 'PC-BALCAO', 'estacao_impressao');
    e = ((await svc.listar(T)) as any[]).find((x) => x.id === est);
    expect(JSON.parse(JSON.stringify(e)).pareadoEm).not.toBe(antes);
    // Os outros tipos não ganham esses campos.
    const pdv: any = ((await svc.listar(T)) as any[]).find((x) => x.tipo === 'pdv');
    expect(pdv).not.toHaveProperty('maquinaPareada');
  });

  describe('a recusa do terminal diz o motivo (só a revogação faz o PC esquecer)', () => {
    const inter = () => new TerminalSegredoInterceptor(svc);
    const chamar = async (terminalId: string, segredo: string) => {
      const req: any = { headers: { 'x-terminal-id': terminalId, 'x-terminal-secret': segredo }, user: { tenantId: T } };
      const ctx: any = { switchToHttp: () => ({ getRequest: () => req }) };
      const obs = await inter().intercept(ctx, { handle: () => of('ok') } as any);
      return lastValueFrom(obs);
    };
    const erro = async (p: Promise<unknown>) => {
      try { await p; return null; } catch (e: any) { return { status: e.getStatus(), ...(e.getResponse() as any) }; }
    };

    it('pareado e certo: passa; revogado: TERMINAL_REVOGADO (403)', async () => {
      const pdv = await equip('pdv', 'Caixa 2');
      const { segredo } = await svc.parearPorCodigo((await svc.gerarCodigo(T, pdv, null, null)).codigo, undefined, 'pdv');
      expect(await chamar(pdv, segredo)).toBe('ok');
      await svc.revogar(T, pdv, null, null);
      expect(await erro(chamar(pdv, segredo))).toMatchObject({ status: 403, code: 'TERMINAL_REVOGADO' });
    });

    it('segredo de outro PC (pareado de novo noutro lugar): TERMINAL_NAO_RECONHECIDO — não é revogação', async () => {
      const pdv = await equip('pdv', 'Caixa 3');
      await svc.parearPorCodigo((await svc.gerarCodigo(T, pdv, null, null)).codigo, undefined, 'pdv');
      expect(await erro(chamar(pdv, 'segredo-antigo'))).toMatchObject({ status: 403, code: 'TERMINAL_NAO_RECONHECIDO' });
    });

    it('servidor recém-reinstalado: o terminal ainda não voltou da nuvem → LOJA_CARREGANDO (409) enquanto restaura', async () => {
      const ausente = randomUUID();
      expect(await erro(chamar(ausente, 's'))).toMatchObject({ status: 403, code: 'TERMINAL_NAO_RECONHECIDO' });
      await q(`insert into sync_state (chave, valor) values ('restaurando', '1') on conflict (chave) do update set valor = '1'`);
      (svc as any).carregandoAte = 0; // sem esperar os 10 s da leitura guardada
      expect(await erro(chamar(ausente, 's'))).toMatchObject({ status: 409, code: 'LOJA_CARREGANDO' });
      // Na nuvem não há "carregando": é só "não reconhecido".
      process.env.EDGE_MODE = 'false';
      (svc as any).carregandoAte = 0;
      expect(await erro(chamar(ausente, 's'))).toMatchObject({ status: 403, code: 'TERMINAL_NAO_RECONHECIDO' });
      process.env.EDGE_MODE = 'true';
      await q(`update sync_state set valor = '0' where chave = 'restaurando'`);
      (svc as any).carregandoAte = 0;
      expect(await erro(chamar('nao-e-uuid', 's'))).toMatchObject({ status: 403, code: 'TERMINAL_NAO_RECONHECIDO' });
    });
  });
});
