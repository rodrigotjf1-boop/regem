import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

// ESTAÇÃO DE IMPRESSÃO, PR 4b: o instalador (modo cliente, "Este PC tem impressora"), o serviço
// RegemEstacaoImpressao e o ícone na bandeja. As peças moram em arquivos diferentes (o .iss, o
// orquestrador, o script da estação, o empacotamento e o .cs) — este teste amarra uma à outra.
const EDGE = join(__dirname, '..', '..', '..', 'edge');
const ler = (nome: string) => readFileSync(join(EDGE, nome), 'utf8');

describe('instalador da estação de impressão (PR 4b)', () => {
  it('o script da estação é ASCII puro (V19: .ps1 sem acento — o PowerShell 5.1 lê sem BOM como ANSI)', () => {
    const ps1 = ler('instalar-estacao-impressao.ps1');
    expect(ps1).toMatch(/RegemEstacaoImpressao/);
    expect([...ps1].filter((c) => c.charCodeAt(0) > 127)).toEqual([]);
  });

  it('o código nunca vai na linha de comando: arquivo no {tmp} → ambiente (ESTACAO_CODIGO), e o arquivo é apagado por .NET', () => {
    const iss = ler('regem-edge.iss');
    expect(iss).toMatch(/-EstacaoArq "' \+ ExpandConstant\('\{tmp\}\\regem-estacao\.txt'\)/);
    expect(iss).toMatch(/SaveStringToFile\(ExpandConstant\('\{tmp\}\\regem-estacao\.txt'\)/);
    const ps1 = ler('instalar-estacao-impressao.ps1');
    expect(ps1).toMatch(/\$env:ESTACAO_CODIGO = \$codigo/);
    expect(ps1).toMatch(/\[System\.IO\.File\]::Delete\(\$CodigoArq\)/); // ERR-243: Remove-Item falha no caminho curto
    expect(ps1).not.toMatch(/--parear', \$codigo|--parear \$codigo/);
    const tudo = ler('instalar-tudo.ps1');
    expect(tudo).toMatch(/instalar-estacao-impressao\.ps1'\) -Raiz \$Raiz -ServidorHost \$ServidorHost -CodigoArq \$EstacaoArq/);
    expect(tudo).toMatch(/\[System\.IO\.File\]::Delete\(\$CredFile\)/);
  });

  it('o ícone: o caminho do instalador é o que o empacotamento gera; a pasta de dados é a do serviço', () => {
    const iss = ler('regem-edge.iss');
    const pacote = ler('package.mjs');
    expect(pacote).toMatch(/join\(out, 'edge', 'bandeja', 'RegemEstacao\.exe'\)/);
    expect(iss).toMatch(/\{app\}\\backend\\edge\\bandeja\\RegemEstacao\.exe/);
    expect(iss).toMatch(/--raiz ""\{app\}\\estacao""/);
    expect(ler('instalar-estacao-impressao.ps1')).toMatch(/\$dados = Join-Path \$app 'estacao'/);
    // O fonte do ícone não vai para a loja (só o .exe compilado).
    expect(pacote).toMatch(/const VAZA_LOGICA = \/[^\n]*\\\.cs\$/);
  });

  it('reinstalação para o serviço da estação e fecha o ícone antes de copiar; desinstalar remove os dois', () => {
    const iss = ler('regem-edge.iss');
    expect(iss).toMatch(/nomes\[5\] := 'RegemEstacaoImpressao'/);
    expect(iss).toMatch(/taskkill\.exe'\), '\/IM RegemEstacao\.exe \/F'/);
    expect(iss).toMatch(/\[UninstallRun\][\s\S]*remove RegemEstacaoImpressao confirm/);
    expect(iss).toMatch(/ValueName: "RegemEstacao";[\s\S]*Flags: uninsdeletevalue; Check: TemEstacao/);
  });

  // Compila de verdade só no Windows (o .NET Framework 4.8 vem no sistema); no CI (Linux) é pulado.
  const csc = process.env.SystemRoot ? join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe') : '';
  (csc && existsSync(csc) ? it : it.skip)('o ícone (RegemEstacao.cs) compila com o compilador do Windows', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'regem-icone-'));
    try {
      const saida = join(pasta, 'RegemEstacao.exe');
      execFileSync(csc, ['-nologo', '-target:winexe', `-out:${saida}`, '-r:System.Web.Extensions.dll',
        '-r:System.Windows.Forms.dll', '-r:System.Drawing.dll', join(EDGE, 'bandeja', 'RegemEstacao.cs')], { stdio: 'pipe' });
      expect(existsSync(saida)).toBe(true);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });
});
