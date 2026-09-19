import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EdgeService } from './edge.service';

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
});
