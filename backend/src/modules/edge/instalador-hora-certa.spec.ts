import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A HORA CERTA NO SERVIDOR DA LOJA (ERR-618, 1.30.16). O Windows da loja piloto nunca sincronizou a hora ("Local CMOS
// Clock", 9 s atrasado) — e o servidor decide conflito pela hora. O instalador liga a sincronização pelo NTP.br no fim
// (modo Servidor), por um script próprio que o teste roda em `-SoMostrar` (lista o que faria, sem mexer na máquina).
const EDGE = join(__dirname, '..', '..', '..', 'edge');
const SCRIPT = join(EDGE, 'hora-certa.ps1');
const INSTALADOR = join(EDGE, 'instalar-tudo.ps1');
const PS = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const temPs = () => spawnSync(PS, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;

jest.setTimeout(60_000);

describe('instalador: hora certa (ERR-618)', () => {
  const fonte = readFileSync(SCRIPT, 'utf8');

  it('o script é ASCII puro (PowerShell 5.1 lê .ps1 sem BOM como ANSI — V19, V52)', () => {
    const fora = [...fonte].filter((ch) => ch.charCodeAt(0) > 0x7e && ch !== '\r' && ch !== '\n');
    expect(fora).toEqual([]);
  });

  it('o PowerShell lê o script sem erro e o -SoMostrar lista: w32time automático, NTP.br de hora em hora e a sincronização agora', () => {
    if (!temPs()) return console.warn(`instalador-hora-certa.spec: sem ${PS} — execução PULADA`);
    const sintaxe = spawnSync(
      PS,
      ['-NoProfile', '-Command', `$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${SCRIPT}',[ref]$t,[ref]$e);$e.Count`],
      { encoding: 'utf8' },
    );
    expect(sintaxe.stdout.trim().split(/\r?\n/).pop()).toBe('0');
    const r = spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-SoMostrar'], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`PowerShell saiu com ${r.status}: ${r.stderr}`);
    const cmds: any[] = JSON.parse(r.stdout.trim().split(/\r?\n/).pop()!);
    expect(cmds.map((c) => c.tipo)).toEqual(['servico', 'registro', 'w32tm', 'reiniciar', 'w32tm']);
    expect(cmds[0]).toMatchObject({ nome: 'w32time', inicio: 'Automatic' });
    expect(cmds[1]).toMatchObject({ valor: 'SpecialPollInterval', dado: 3600 });
    expect(cmds[2].args).toEqual(['/config', '/manualpeerlist:a.ntp.br,0x9 b.ntp.br,0x9', '/syncfromflags:manual', '/reliable:no', '/update']);
    expect(cmds[4].args).toEqual(['/resync', '/rediscover']);
  });

  it('o instalador chama o script no fim, só no modo Servidor (depois do backup, antes de conferir os dados), sem derrubar a instalação', () => {
    const inst = readFileSync(INSTALADOR, 'utf8');
    const cliente = inst.indexOf("if ($Modo -eq 'cliente') {");
    const backup = inst.indexOf('Backup diario cifrado registrado');
    const chamada = inst.indexOf("Join-Path $root 'edge\\hora-certa.ps1'");
    const dados = inst.indexOf('Conferindo se os dados da loja chegaram');
    expect([cliente > 0, backup > cliente, chamada > backup, dados > chamada]).toEqual([true, true, true, true]);
    const trecho = inst.slice(chamada - 200, dados);
    expect(trecho).toMatch(/try \{[\s\S]*\} catch \{ Diga "\(aviso\) nao consegui ligar a hora certa/);
  });
});
