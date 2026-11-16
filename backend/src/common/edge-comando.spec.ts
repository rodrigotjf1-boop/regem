import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { comandosDoServidor, enfileirarComandoEdge } from './edge-comando';

/* eslint-disable @typescript-eslint/no-explicit-any */

// COMANDOS REMOTOS POR SERVIDOR LOCAL (mig 269) — contra Postgres (TEST_PG_URL).
// Antes o comando era por empresa: com duas lojas, o primeiro servidor que buscava executava e
// o outro nunca recebia (teste de impressora da loja errada; rollback só num servidor).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
const MIG = join(__dirname, '..', '..', '..', 'database', 'migrations');

// Ganchos com banco (criar schema, aplicar migrations, limpar com os gatilhos do sync) passam dos
// 5 s padrão quando todos os arquivos de teste compilam e rodam juntos (CI com cache frio).
jest.setTimeout(60_000);

descrever('edge_comando com destino (Postgres real)', () => {
  const schema = `teste_comando_${Date.now()}`;
  let pool: Pool;
  let db: any;
  const T = randomUUID();
  const A = randomUUID();
  const B = randomUUID();
  const SRV_A = randomUUID();
  const SRV_B = randomUUID();
  const SRV_GOGEM = randomUUID(); // a credencial do GoGeM: também é servidor_local (mig 290)
  const q = (s: string, p: any[] = []) => pool.query(s, p);

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${schema}` });
    db = drizzle(pool);
    await q(`create schema ${schema}`);
    await q(`create table equipamento (id uuid primary key, tenant_id uuid not null, unidade_id uuid,
             tipo text not null, ativo boolean not null default true)`);
    // A marca da credencial de integração vem da migration de verdade (a mesma da nuvem): sem a
    // coluna, a consulta cai na linha sem destino — e todo servidor pegaria todo comando.
    await q(readFileSync(join(MIG, '290_equipamento_integrador.sql'), 'utf8'));
    // edge_comando é só-nuvem: a tabela vem da migration original + a 269 (as mesmas da nuvem).
    await q(readFileSync(join(MIG, '124_edge_release_comando.sql'), 'utf8'));
    await q(readFileSync(join(MIG, '269_impressora_status_codepage_comando_destino.sql'), 'utf8'));
    await q(`insert into equipamento (id, tenant_id, unidade_id, tipo) values
             ($1,$3,$4,'servidor_local'), ($2,$3,$5,'servidor_local')`, [SRV_A, SRV_B, T, A, B]);
    await q(`insert into equipamento (id, tenant_id, unidade_id, tipo, integrador) values ($1,$2,$3,'servidor_local','gogem')`, [
      SRV_GOGEM,
      T,
      A,
    ]);
  });
  afterAll(async () => {
    if (!pool) return;
    await q(`drop schema if exists ${schema} cascade`);
    await pool.end();
  });
  beforeEach(() => q(`delete from edge_comando`));

  it('comando da loja A só chega ao servidor da loja A', async () => {
    await enfileirarComandoEdge(db, T, 'testar_impressora', { unidadeId: A });
    expect((await comandosDoServidor(db, T, SRV_A)).map((c: any) => c.comando)).toEqual(['testar_impressora']);
    expect(await comandosDoServidor(db, T, SRV_B)).toHaveLength(0);
  });

  it('comando da empresa (rollback) chega aos DOIS servidores — um não "rouba" do outro', async () => {
    await enfileirarComandoEdge(db, T, 'rollback');
    const a = await comandosDoServidor(db, T, SRV_A);
    const b = await comandosDoServidor(db, T, SRV_B);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    await q(`update edge_comando set status='executado' where id=$1`, [a[0].id]); // A confirma
    expect(await comandosDoServidor(db, T, SRV_B)).toHaveLength(1); // B continua com o dele
  });

  it('leva os dados (ex.: texto da DANFE)', async () => {
    await enfileirarComandoEdge(db, T, 'imprimir_danfe', { unidadeId: B, dados: { conteudo: 'DANFE', comandaId: null } });
    const [c] = await comandosDoServidor(db, T, SRV_B);
    expect(c.dados).toEqual({ conteudo: 'DANFE', comandaId: null });
  });

  it('a credencial do GoGeM (também servidor_local) nunca recebe comando — ficaria pendente para sempre', async () => {
    await enfileirarComandoEdge(db, T, 'testar_impressora', { unidadeId: A }); // a loja dela
    await enfileirarComandoEdge(db, T, 'rollback'); // a empresa inteira
    const destinos = (await q(`select equipamento_id from edge_comando`)).rows.map((r: any) => r.equipamento_id);
    expect(destinos).not.toContain(SRV_GOGEM);
    expect(destinos.sort()).toEqual([SRV_A, SRV_A, SRV_B].sort());
  });

  it('linha antiga (sem destino) continua valendo para qualquer servidor', async () => {
    await q(`insert into edge_comando (tenant_id, comando) values ($1,'reprocessar')`, [T]);
    expect(await comandosDoServidor(db, T, SRV_A)).toHaveLength(1);
    expect(await comandosDoServidor(db, T, SRV_B)).toHaveLength(1);
  });

  it('F4.4: com o servidor indicado, só ele recebe — mesmo com dois na loja; servidor que saiu da empresa vale a loja', async () => {
    const SRV_A2 = randomUUID();
    await q(`insert into equipamento (id, tenant_id, unidade_id, tipo) values ($1,$2,$3,'servidor_local')`, [SRV_A2, T, A]);
    try {
      expect(await enfileirarComandoEdge(db, T, 'reiniciar_impressao', { unidadeId: A, equipamentoId: SRV_A2 })).toBe(1);
      expect(await comandosDoServidor(db, T, SRV_A2)).toHaveLength(1);
      expect(await comandosDoServidor(db, T, SRV_A)).toHaveLength(0);
      // O servidor do aviso desativado: o comando vai aos da loja (nunca a linha sem destino, que qualquer um pegaria).
      await q(`delete from edge_comando`);
      await q(`update equipamento set ativo = false where id = $1`, [SRV_A2]);
      expect(await enfileirarComandoEdge(db, T, 'reiniciar_impressao', { unidadeId: A, equipamentoId: SRV_A2 })).toBe(1);
      expect((await q(`select equipamento_id from edge_comando`)).rows.map((r: any) => r.equipamento_id)).toEqual([SRV_A]);
      // Id torto não vira filtro (nem erro): vale a loja.
      await q(`delete from edge_comando`);
      expect(await enfileirarComandoEdge(db, T, 'reiniciar_impressao', { unidadeId: B, equipamentoId: 'nao-e-id' })).toBe(1);
      expect((await q(`select equipamento_id from edge_comando`)).rows.map((r: any) => r.equipamento_id)).toEqual([SRV_B]);
    } finally {
      await q(`delete from equipamento where id = $1`, [SRV_A2]);
    }
  });
});

// O comando 'reiniciar_impressao' do servidor da loja (F4.4 do Mister; edge/comando-reiniciar-impressao.mjs é ESM — roda num
// node à parte, com a execução do Windows de mentira).
describe('reiniciar o serviço de impressão no servidor da loja', () => {
  const rodar = (situacao: string, falhaNoReinicio: boolean) => {
    const mod = join(__dirname, '..', '..', 'edge', 'comando-reiniciar-impressao.mjs').replace(/\\/g, '/');
    const code = `import { reiniciarServicoDeImpressao } from 'file:///${mod.replace(/^\//, '')}';
      const chamadas = [];
      const executar = async (arq, args) => {
        chamadas.push([arq, ...args].join(' '));
        if (${falhaNoReinicio} && args.join(' ').includes('Restart-Service')) { const e = new Error('falhou'); e.stderr = 'Acesso negado.'; throw e; }
        return { stdout: args.join(' ').includes('Get-Service') ? ${JSON.stringify(`${situacao}\r\n`)} : '' };
      };
      let r; try { r = await reiniciarServicoDeImpressao(executar); } catch (e) { r = 'ERRO: ' + e.message; }
      process.stdout.write(JSON.stringify({ r, chamadas }));`;
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code]).toString()) as { r: string; chamadas: string[] };
  };

  it('reinicia o RegemEdgeImpressao e confere que voltou a rodar', () => {
    const { r, chamadas } = rodar('Running', false);
    expect(r).toBe('serviço de impressão reiniciado');
    expect(chamadas).toEqual([
      'powershell.exe -NoProfile -NonInteractive -Command Restart-Service -Name RegemEdgeImpressao -Force -ErrorAction Stop',
      'powershell.exe -NoProfile -NonInteractive -Command (Get-Service -Name RegemEdgeImpressao).Status',
    ]);
  });

  it('o serviço que não voltou e o Windows que recusou viram erro com a frase (o retorno do comando vai à nuvem)', () => {
    expect(rodar('Stopped', false).r).toBe('ERRO: o serviço não voltou a rodar depois de reiniciar');
    const recusa = rodar('Running', true);
    expect(recusa.r).toBe('ERRO: o Windows recusou o reinício (Acesso negado)');
    expect(recusa.chamadas).toHaveLength(1);
  });
});

// Página de código do conversor ESC/POS (edge/escpos.mjs é ESM — roda num node à parte).
describe('escpos: acentos por impressora', () => {
  const rodar = (codepage: string | null) => {
    const mod = join(__dirname, '..', '..', 'edge', 'escpos.mjs').replace(/\\/g, '/');
    const code = `import { renderEscpos } from 'file:///${mod.replace(/^\//, '')}';
      const b = renderEscpos('Pão ação\\n@LRCafé|R$ 1', 80, null, ${JSON.stringify(codepage)});
      process.stdout.write(JSON.stringify([...b]));`;
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code]).toString()) as number[];
  };
  const tem = (b: number[], seq: number[]) => b.some((_, i) => seq.every((x, k) => b[i + k] === x));

  it('sem página: sem acento e sem ESC t (como sempre)', () => {
    const b = rodar(null);
    expect(tem(b, [0x50, 0x61, 0x6f])).toBe(true); // "Pao"
    expect(tem(b, [0x1b, 0x74])).toBe(false);
  });
  it('CP860: seleciona a página e grava ã/ç/é nos bytes do português', () => {
    const b = rodar('cp860');
    expect(tem(b, [0x1b, 0x74, 3])).toBe(true);
    expect(tem(b, [0x50, 0x84, 0x6f])).toBe(true); // Pão
    expect(tem(b, [0x61, 0x87, 0x84, 0x6f])).toBe(true); // ação
    expect(tem(b, [0x43, 0x61, 0x66, 0x82])).toBe(true); // Café
  });
  it('CP850: numeração e bytes do multilíngue', () => {
    const b = rodar('cp850');
    expect(tem(b, [0x1b, 0x74, 2])).toBe(true);
    expect(tem(b, [0x50, 0xc6, 0x6f])).toBe(true); // Pão
  });
});
