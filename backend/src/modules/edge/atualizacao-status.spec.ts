import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EdgeService } from './edge.service';
import { progressoEmCurso, progressoParaTela } from './progresso-atualizacao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ERR-055: o atualizar.ps1 das versões até a 1.29.x grava logs/update-status.json pelo
// PowerShell 5.1 (Set-Content -Encoding UTF8) — COM BOM. O JSON.parse falhava e a barra de
// progresso da tela Servidor nunca aparecia. O mesmo vale para logs/update-revertida.txt.
describe('progresso da atualização (arquivos gravados pelo PowerShell)', () => {
  const cwdAntes = process.cwd();
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'regem-status-'));
    mkdirSync(join(dir, 'logs'));
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(cwdAntes);
    rmSync(dir, { recursive: true, force: true });
  });

  const svc = () => new EdgeService({} as any) as any;
  const status = { fase: 'instalando', estagio: 'migrando', pct: 65, versao: '1.30.0', ts: '2026-09-18T20:00:00Z' };

  it('lê o status COM BOM (PS 5.1) e sem BOM (script novo)', () => {
    writeFileSync(join(dir, 'logs', 'update-status.json'), '\uFEFF' + JSON.stringify(status), 'utf8');
    expect(svc().lerProgresso()).toMatchObject({ fase: 'instalando', estagio: 'migrando', pct: 65 });
    writeFileSync(join(dir, 'logs', 'update-status.json'), JSON.stringify(status), 'utf8');
    expect(svc().lerProgresso()).toMatchObject({ fase: 'instalando', pct: 65 });
  });

  it('versão revertida é lida mesmo com BOM', () => {
    writeFileSync(join(dir, 'logs', 'update-revertida.txt'), '\uFEFF1.30.1\r\n', 'utf8');
    expect(svc().versaoRevertida()).toBe('1.30.1');
  });

  it('instalação em curso = status recente e não terminado', () => {
    const agora = new Date().toISOString();
    writeFileSync(join(dir, 'logs', 'update-status.json'), JSON.stringify({ ...status, ts: agora }), 'utf8');
    expect(svc().atualizacaoEmCurso()).toBe(true);
    writeFileSync(join(dir, 'logs', 'update-status.json'), JSON.stringify({ ...status, fase: 'ok', ts: agora }), 'utf8');
    expect(svc().atualizacaoEmCurso()).toBe(false);
    // parado há mais de 20 min = execução presa, não em curso (o /aplicar pode encerrá-la)
    writeFileSync(join(dir, 'logs', 'update-status.json'), JSON.stringify({ ...status, ts: '2026-01-01T00:00:00Z' }), 'utf8');
    expect(svc().atualizacaoEmCurso()).toBe(false);
  });

  // ERR-322: o status de uma tentativa que parou (script antigo que não fechava o status) ficava como
  // "instalando" para sempre; a tela travava os botões e mostrava "Iniciando… 2%" — a loja não
  // conseguia instalar a 1.30.12. Arquivo EXATO encontrado na loja (gravado pela 1.30.5 em 20/10).
  describe('status que parou sem terminar (ERR-322)', () => {
    const daLoja = '{"versao":"","pct":2,"erro":null,"ts":"2026-10-20T18:37:39.8283201-03:00","estagio":"iniciando"}';
    const edgeAntes = process.env.EDGE_MODE;
    beforeEach(() => { process.env.EDGE_MODE = 'true'; });
    afterEach(() => {
      if (edgeAntes === undefined) delete process.env.EDGE_MODE;
      else process.env.EDGE_MODE = edgeAntes;
    });

    it('vai para a tela como "interrompida", e a API também não o trata como em curso', async () => {
      writeFileSync(join(dir, 'logs', 'update-status.json'), '﻿' + daLoja, 'utf8');
      const s = svc();
      const st = await s.statusAtualizacao();
      expect(st.progresso).toMatchObject({ fase: 'interrompida', estagio: 'iniciando', pct: 2 });
      expect(s.atualizacaoEmCurso()).toBe(false);
    });

    it('instalação de verdade em curso continua aparecendo como está', async () => {
      const agora = new Date().toISOString();
      writeFileSync(join(dir, 'logs', 'update-status.json'), JSON.stringify({ ...status, ts: agora }), 'utf8');
      const st = await svc().statusAtualizacao();
      expect(st.progresso).toMatchObject({ fase: 'instalando', estagio: 'migrando' });
    });
  });
});

describe('regra única de "em curso" (progresso-atualizacao)', () => {
  const agora = Date.parse('2026-10-29T16:00:00Z');
  const p = (fase: string, ts: string | null) =>
    ({ fase, estagio: 'baixando', pct: 40, versao: '1.30.12', baixadoMb: 10, totalMb: 30, erro: null, acaoFinal: null, ts });

  it('em curso só se não terminou e mudou nos últimos 20 min', () => {
    expect(progressoEmCurso(p('baixando', '2026-10-29T15:50:00Z'), agora)).toBe(true);
    expect(progressoEmCurso(p('baixando', '2026-10-29T15:39:00Z'), agora)).toBe(false);
    expect(progressoEmCurso(p('baixando', null), agora)).toBe(false);
    expect(progressoEmCurso(p('ok', '2026-10-29T15:59:00Z'), agora)).toBe(false);
    expect(progressoEmCurso(null, agora)).toBe(false);
  });

  it('para a tela: parado vira "interrompida"; terminado e em curso ficam como estão', () => {
    expect(progressoParaTela(p('instalando', '2026-10-29T15:00:00Z'), agora)?.fase).toBe('interrompida');
    expect(progressoParaTela(p('baixando', null), agora)?.fase).toBe('interrompida');
    expect(progressoParaTela(p('baixando', '2026-10-29T15:59:00Z'), agora)?.fase).toBe('baixando');
    expect(progressoParaTela(p('erro', '2026-01-01T00:00:00Z'), agora)?.fase).toBe('erro');
    expect(progressoParaTela(p('ok', '2026-01-01T00:00:00Z'), agora)?.fase).toBe('ok');
    expect(progressoParaTela(null, agora)).toBeNull();
  });
});
