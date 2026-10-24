import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    // O pacote compila os dois ícones pelo mesmo caminho: edge/bandeja/<nome>.exe.
    expect(pacote).toMatch(/join\(out, 'edge', 'bandeja', `\$\{nome\}\.exe`\)/);
    expect(pacote).toMatch(/compilarIcone\('RegemEstacao', /);
    expect(iss).toMatch(/\{app\}\\backend\\edge\\bandeja\\RegemEstacao\.exe/);
    expect(iss).toMatch(/--raiz ""\{app\}\\estacao""/);
    expect(ler('instalar-estacao-impressao.ps1')).toMatch(/\$dados = Join-Path \$app 'estacao'/);
    // O fonte do ícone não vai para a loja (só o .exe compilado).
    expect(pacote).toMatch(/const VAZA_LOGICA = \/[^\n]*\\\.cs\$/);
  });

  // Fase 4 do pedido de 22–23/10/2026: o ícone do SERVIDOR da loja ("Regem — servidor da loja").
  it('o ícone do servidor: só no modo Servidor, com a raiz do sistema (onde nasce bandeja.key), em todo login; sai se virar Cliente', () => {
    const iss = ler('regem-edge.iss');
    const pacote = ler('package.mjs');
    expect(pacote).toMatch(/compilarIcone\('RegemServidor', \['-r:System\.ServiceProcess\.dll'\]/);
    expect(iss).toMatch(/Filename: "\{app\}\\backend\\edge\\bandeja\\RegemServidor\.exe"; Parameters: "--raiz ""\{app\}\\backend"""/);
    expect(iss).toMatch(/Flags: nowait postinstall runasoriginaluser skipifdoesntexist; Check: TemIconeDoServidor/);
    expect(iss).toMatch(/ValueName: "RegemServidor"; \\\r?\n\s+ValueData: """\{app\}\\backend\\edge\\bandeja\\RegemServidor\.exe"" --raiz ""\{app\}\\backend"""; Flags: uninsdeletevalue; Check: TemIconeDoServidor/);
    expect(iss).toMatch(/ValueType: none; ValueName: "RegemServidor"; \\\r?\n\s+Flags: deletevalue; Check: EhCliente/);
    expect(iss).toMatch(/function TemIconeDoServidor: Boolean;\s+begin\s+Result := not EhCliente;/);
    // Reinstalar fecha o ícone antes de copiar; desinstalar também.
    expect(iss).toMatch(/taskkill\.exe'\), '\/IM RegemServidor\.exe \/F'/);
    expect(iss).toMatch(/\[UninstallRun\][\s\S]*\/IM RegemServidor\.exe \/F/);
    // O sistema cria a chave na pasta em que roda (o serviço RegemEdgeApi roda em $Raiz = {app}\backend).
    expect(ler('instalar-servicos.ps1')).toMatch(/Svc "RegemEdgeApi" "\$Raiz\\dist\\main\.js" \$Raiz/);
    // A conferência antes do corte reprova pacote sem os dois ícones.
    expect(ler('preflight-release.mjs')).toMatch(/'edge\/bandeja\/RegemEstacao\.exe', 'edge\/bandeja\/RegemServidor\.exe'/);
    // O fonte do ícone do servidor é ASCII (o csc lê na página de código do Windows): os acentos vão como ç.
    const cs = ler('bandeja/RegemServidor.cs');
    expect([...cs].filter((c) => c.charCodeAt(0) > 127)).toEqual([]);
  });

  it('reinstalação para o serviço da estação e fecha o ícone antes de copiar; desinstalar remove os dois', () => {
    const iss = ler('regem-edge.iss');
    expect(iss).toMatch(/nomes\[5\] := 'RegemEstacaoImpressao'/);
    expect(iss).toMatch(/taskkill\.exe'\), '\/IM RegemEstacao\.exe \/F'/);
    expect(iss).toMatch(/\[UninstallRun\][\s\S]*remove RegemEstacaoImpressao confirm/);
    expect(iss).toMatch(/ValueName: "RegemEstacao";[\s\S]*Flags: uninsdeletevalue; Check: TemEstacao/);
  });

  it('atalhos, instalador e o .exe da bandeja com o ícone do Regem (edge/regem.ico); o atalho do cliente abre no login', () => {
    // O .ico: cabeçalho de ícone (0, 1, N) com o 16 px (lista do Explorer) e o 256 px (ícones grandes).
    const ico = readFileSync(join(EDGE, 'regem.ico'));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
    const larguras = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico.readUInt8(6 + 16 * i) || 256);
    expect(larguras).toEqual(expect.arrayContaining([16, 32, 48, 256]));
    // Os dois blocos de atalho (cliente e servidor) apontam para o arquivo que o pacote leva a {app}\backend\edge.
    const tudo = ler('instalar-tudo.ps1');
    expect(tudo.match(/\$iconeRegem = Join-Path \$Raiz 'edge\\regem\.ico'/g)).toHaveLength(2);
    expect(tudo).toMatch(/\$s\.IconLocation = if \(Test-Path \$iconeRegem\) \{ "\$iconeRegem,0" \} else \{ \$browser \}/);
    expect(tudo).toMatch(/\$sc\.IconLocation = if \(\$temIcone\) \{ "\$iconeRegem,0" \} else \{ \$navegador \}/);
    expect(tudo).toMatch(/IconFile=\$iconeRegem/); // o .url (PC sem Edge nem Chrome)
    // O atalho do PC cliente abre direto no login, como o do servidor (a raiz "/" é a página de apresentação).
    expect(tudo).toMatch(/--app="\{0\}\/entrar" --start-fullscreen/);
    const iss = ler('regem-edge.iss');
    expect(iss).toMatch(/^SetupIconFile=regem\.ico\r?$/m);
    expect(iss).toMatch(/^UninstallDisplayIcon=\{app\}\\backend\\edge\\regem\.ico\r?$/m);
    // O empacotamento leva o .ico (nenhum filtro o barra) e o usa no .exe da bandeja.
    const pacote = ler('package.mjs');
    const regexDe = (nome: string) => {
      const m = pacote.match(new RegExp(`const ${nome} = /(.+)/(\\w*);`));
      return new RegExp(m![1], m![2]);
    };
    expect(regexDe('VAZA_LOGICA').test('edge/regem.ico')).toBe(false);
    expect(regexDe('SEGREDO').test('edge/regem.ico')).toBe(false);
    expect(pacote).toMatch(/`-win32icon:\$\{join\(raiz, 'edge', 'regem\.ico'\)\}`/);
  });

  it('a atualização (.zip) põe o ícone nos atalhos que a instalação já criou, sem parar a atualização se falhar', () => {
    const comum = ler('atualizacao-comum.ps1');
    const atualizar = ler('atualizar.ps1');
    expect(comum).toMatch(/^function Icone-Regem-Nos-Atalhos\(\$icone, \$pastas\) \{/m);
    // O passo roda com o script da versão instalada (a tarefa chama o atualizar.ps1 que já está no PC), dentro de
    // try/catch, nas pastas onde o instalador cria os atalhos.
    expect(atualizar).toMatch(
      /try \{\s+\$nIcone = Icone-Regem-Nos-Atalhos \(Join-Path \$Raiz 'edge\\regem\.ico'\) @\(\s+\[Environment\]::GetFolderPath\('CommonDesktopDirectory'\),\s+\(Join-Path \(\[Environment\]::GetFolderPath\('CommonPrograms'\)\) 'Regem'\)\)[\s\S]{0,120}\} catch \{ Diga "\(aviso\) nao troquei o icone dos atalhos/,
    );
    // Os dois são lidos pelo PowerShell 5.1 sem BOM (ANSI): nada fora do ASCII.
    for (const fonte of [comum, atualizar]) expect([...fonte].filter((c) => c.charCodeAt(0) > 127)).toEqual([]);
  });

  // Roda de verdade só no Windows (o WScript.Shell vem no sistema); no CI (Linux) é pulado.
  const ps = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '';
  (ps && existsSync(ps) ? it : it.skip)('a atualização troca só o ícone dos atalhos "Regem..." do navegador, e uma vez só', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'regem-atalhos-'));
    try {
      const roteiro = join(pasta, 'roteiro.ps1');
      writeFileSync(roteiro, [
        'param($Edge, $Pasta, $Ico)',
        "$ErrorActionPreference = 'Stop'",
        ". (Join-Path $Edge 'atualizacao-comum.ps1')",
        '$wsh = New-Object -ComObject WScript.Shell',
        "$nav = Join-Path $Pasta 'msedge.exe'; Set-Content -Path $nav -Value ''",
        "$notas = Join-Path $Pasta 'notas.exe'; Set-Content -Path $notas -Value ''",
        "function Criar($nome, $alvo) { $sc = $wsh.CreateShortcut((Join-Path $Pasta $nome)); $sc.TargetPath = $alvo; $sc.Arguments = '--app=https://localhost:3443/pdv'; $sc.IconLocation = \"$alvo,0\"; $sc.Save() }",
        "Criar 'Regem PDV (local).lnk' $nav",
        "Criar 'Regem notas.lnk' $notas",
        "Criar 'Outro.lnk' $nav",
        "$n1 = Icone-Regem-Nos-Atalhos $Ico @($Pasta, (Join-Path $Pasta 'nao-existe'))",
        '$n2 = Icone-Regem-Nos-Atalhos $Ico @($Pasta)',
        '$lidos = @{}',
        "foreach ($l in Get-ChildItem $Pasta -Filter *.lnk) { $sc = $wsh.CreateShortcut($l.FullName); $lidos[$l.Name] = @($sc.IconLocation, $sc.Arguments) }",
        '@{ n1 = $n1; n2 = $n2; lidos = $lidos } | ConvertTo-Json -Compress -Depth 4',
      ].join('\r\n'));
      const ico = join(EDGE, 'regem.ico');
      const saida = execFileSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', roteiro, '-Edge', EDGE, '-Pasta', pasta, '-Ico', ico], { encoding: 'utf8' });
      let r: any;
      try {
        r = JSON.parse(saida);
      } catch {
        throw new Error(`o PowerShell não devolveu JSON (ERR-144):\n${saida}`);
      }
      expect([r.n1, r.n2]).toEqual([1, 0]); // a pasta que não existe não derruba; na segunda vez não há o que trocar
      expect(r.lidos['Regem PDV (local).lnk']).toEqual([`${ico},0`, '--app=https://localhost:3443/pdv']);
      expect(r.lidos['Regem notas.lnk'][0]).toMatch(/notas\.exe,0$/); // não é atalho do navegador
      expect(r.lidos['Outro.lnk'][0]).toMatch(/msedge\.exe,0$/); // não é atalho do Regem
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  // PAREAR SEM REINSTALAR, parte 2 (pedido do dono de 22/10/2026): o PC cliente ganha um atalho que abre o "Parear com
  // código..." do ícone; o servidor reinstalado mantém o certificado e, se trocar, o dono fica sabendo no fim.
  it('parear sem reinstalar: o atalho "Regem - parear este PC" do cliente acorda o ícone da estação e sai ao desinstalar', () => {
    const tudo = ler('instalar-tudo.ps1');
    const cliente = tudo.slice(tudo.indexOf("$dadosEst = Join-Path $appCli 'estacao'"), tudo.indexOf('=== Cliente configurado.'));
    expect(cliente).toMatch(/\$exeIcone = Join-Path \$Raiz 'edge\\bandeja\\RegemEstacao\.exe'/);
    expect(cliente).toContain(`$sp.Arguments = ('--raiz "{0}" --abrir parear' -f $dadosEst)`);
    expect(cliente).toMatch(/foreach \(\$pastaAtalho in @\(\[Environment\]::GetFolderPath\('CommonDesktopDirectory'\), \$menuRegem\)\)/);
    expect(cliente).toContain("'Regem - parear este PC.lnk'");
    // A pasta de dados do atalho é a do serviço (e a do ícone no login).
    expect(ler('instalar-estacao-impressao.ps1')).toMatch(/\$dados = Join-Path \$app 'estacao'/);
    const iss = ler('regem-edge.iss');
    expect(iss).toMatch(/\[UninstallDelete\][\s\S]*\{commondesktop\}\\Regem - parear este PC\.lnk[\s\S]*\{commonprograms\}\\Regem\\Regem - parear este PC\.lnk/);
    // A segunda instância (o atalho com o ícone já aberto) acorda a primeira pelo mesmo sinal que ela escuta.
    const cs = ler('bandeja/RegemEstacao.cs');
    expect(cs).toContain('public const string SinalDeParear = "Local\\\\RegemEstacaoParear";');
    expect(cs).toMatch(/new EventWaitHandle\(false, EventResetMode\.AutoReset, SinalDeParear\)/);
    expect(cs).toMatch(/if \(abrir == "parear"\)[\s\S]{0,200}EventWaitHandle\.OpenExisting\(Bandeja\.SinalDeParear\)\) ev\.Set\(\)/);
    expect([...cs].filter((c) => c.charCodeAt(0) > 127)).toEqual([]); // o csc lê na página de código do Windows
    // A atualização (.zip) troca o ícone só de atalho do navegador: este (aponta para o .exe do ícone) fica como está.
    expect(ler('atualizacao-comum.ps1')).toContain("$sc.TargetPath -match '(msedge|chrome)\\.exe$'");
  });

  it('parear sem reinstalar: o certificado de UMA máquina não vai no pacote; certificado trocado vira aviso ao dono', () => {
    const pacote = ler('package.mjs');
    const corpo = pacote.slice(pacote.indexOf('const semBundle = (s) =>'), pacote.indexOf('cpSync(src'));
    const barras = [...corpo.matchAll(/!\/(.+?)\/\.test\(s\)/g)].map((m) => new RegExp(m[1]));
    const barra = (p: string) => barras.some((r) => r.test(p));
    expect(barra('C:\\pacote\\backend\\edge\\certs')).toBe(true);
    expect(barra('C:\\pacote\\backend\\edge\\certs\\servidor-ca.pem')).toBe(true);
    expect(barra('/pacote/backend/edge/certs/key.pem')).toBe(true);
    expect(barra('C:\\pacote\\backend\\edge\\gen-cert.mjs')).toBe(false);
    expect(barra('C:\\pacote\\backend\\edge\\regem.ico')).toBe(false);
    // O gen-cert diz quando trocou um certificado que havia; o instalador lê a linha e avisa o dono.
    expect(ler('gen-cert.mjs')).toContain('if (havia) console.log(`CERT-TROCADO: ${motivo}`)');
    const tudo = ler('instalar-tudo.ps1');
    expect(tudo).toContain('$saidaCert = & $node "edge\\gen-cert.mjs" $ip');
    expect(tudo).toContain(`$certTrocado = @($saidaCert) | Where-Object { "$_" -like 'CERT-TROCADO:*' } | Select-Object -First 1`);
    expect(tudo).toMatch(/if \(\$certTrocado\) \{\s+Avisar-Dono/);
    expect(tudo.charCodeAt(0)).toBe(0xfeff); // tem acento nos comentários: com o BOM o PowerShell 5.1 lê como UTF-8 (V19)
  });

  (ps && existsSync(ps) ? it : it.skip)('o instalador parseia no PowerShell 5.1 e os avisos ao dono se ACUMULAM (o do certificado não some sob outro)', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'regem-avisos-'));
    try {
      const roteiro = join(pasta, 'roteiro.ps1');
      writeFileSync(roteiro, [
        'param($Instalador, $Pasta)',
        "$ErrorActionPreference = 'Stop'",
        '$t = $null; $e = $null',
        '$ast = [System.Management.Automation.Language.Parser]::ParseFile($Instalador, [ref]$t, [ref]$e)',
        "$f = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Avisar-Dono' }, $true)",
        '. ([ScriptBlock]::Create($f.Extent.Text))',
        '$logDir = $Pasta',
        '$script:avisosAoDono = New-Object System.Collections.Generic.List[string]',
        "Avisar-Dono 'Os dados da loja ainda nao chegaram.'",
        "Avisar-Dono ''",
        "Avisar-Dono 'O certificado deste servidor foi trocado.'",
        '@{ erros = @($e | ForEach-Object { $_.Message }); versao = $PSVersionTable.PSVersion.Major } | ConvertTo-Json -Compress',
      ].join('\r\n'));
      const saida = execFileSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', roteiro, '-Instalador', join(EDGE, 'instalar-tudo.ps1'), '-Pasta', pasta], { encoding: 'utf8' });
      const r = JSON.parse(saida.trim().split(/\r?\n/).pop()!);
      expect(r).toEqual({ erros: [], versao: 5 });
      const aviso = readFileSync(join(pasta, 'INSTALOU-AVISO.txt'), 'utf8').replace(/^\uFEFF/, '');
      expect(aviso.trimEnd().split('\r\n\r\n')).toEqual(['Os dados da loja ainda nao chegaram.', 'O certificado deste servidor foi trocado.']);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  // Compila de verdade só no Windows (o .NET Framework 4.8 vem no sistema); no CI (Linux) é pulado.
  const csc =process.env.SystemRoot ? join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe') : '';
  (csc && existsSync(csc) ? it : it.skip)('o ícone (RegemEstacao.cs) compila com o compilador do Windows, com o ícone do Regem no .exe', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'regem-icone-'));
    try {
      const saida = join(pasta, 'RegemEstacao.exe');
      execFileSync(csc, ['-nologo', '-target:winexe', `-out:${saida}`, `-win32icon:${join(EDGE, 'regem.ico')}`,
        '-r:System.Web.Extensions.dll', '-r:System.Windows.Forms.dll', '-r:System.Drawing.dll',
        join(EDGE, 'bandeja', 'RegemEstacao.cs')], { stdio: 'pipe' });
      expect(existsSync(saida)).toBe(true);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });
});
