import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ASSISTENTE DO INSTALADOR CONVERSANDO COM A NUVEM (ERR-124) — o Pascal de verdade.
//
// O código da trava passou a ser pedido e conferido nas telas do assistente, ANTES de copiar os
// arquivos. Quem conversa com a nuvem é o `edge/assistente-nuvem.iss` (incluído no regem-edge.iss).
// Este teste gera um instalador mínimo que inclui esse arquivo, compila com o Inno Setup da
// máquina e o roda contra uma nuvem falsa: prova a leitura das respostas (acentos e aspas
// inclusive), a frase da nuvem nos erros, a nuvem antiga (404) e — o que faz o código conferido
// valer no fim — que o assistente calcula a MESMA identificação da máquina que o script e o daemon.
// Só roda no Windows com o Inno Setup instalado (o CI é Linux: lá ele é pulado).
const EDGE = join(__dirname, '..', '..', '..', 'edge');
const INCLUDE = join(EDGE, 'assistente-nuvem.iss');
const INSTALADOR = join(EDGE, 'instalar-tudo.ps1');

const ISCC = [
  process.env.ISCC,
  'C:\\Program Files\\Inno Setup 7\\ISCC.exe',
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
].find((c) => !!c && process.platform === 'win32' && existsSync(c));
if (!ISCC) console.warn('assistente-instalador.spec: sem Windows + Inno Setup (ISCC) — PULADO');
const descrever = ISCC ? describe : describe.skip;

jest.setTimeout(180_000);

const EXPIRADO = 'Código expirado (vale 10 minutos). Peça um novo código.';
const NOME_DIFICIL = 'Loja "Centro" — São João';

type Pedido = { rota: string; corpo: any };

function responder(rota: string, corpo: any): [number, any] {
  if (rota === '/api/v1/provisionamento/verificar') {
    switch (corpo.email) {
      case 'pronto@teste':
        return [201, { situacao: 'pronto' }];
      case 'lojas@teste':
        return [
          201,
          {
            situacao: 'escolher_loja',
            unidades: [
              { id: 'u-1', nome: 'Matriz', matriz: true },
              { id: 'u-2', nome: NOME_DIFICIL, matriz: false },
            ],
          },
        ];
      case 'codigo@teste':
        return [201, { situacao: 'codigo', metodoPreferido: 'totp', temTotp: true, jaConferido: false }];
      case 'errada@teste':
        return [401, { message: 'E-mail ou senha inválidos.', error: 'Unauthorized', statusCode: 401 }];
      default: // a nuvem de antes do deploy não tem a rota
        return [404, { message: `Cannot POST ${rota}`, error: 'Not Found', statusCode: 404 }];
    }
  }
  if (rota === '/api/v1/provisionamento/reautorizar/solicitar') return [201, { metodo: 'email', destino: 'do***@teste' }];
  if (rota === '/api/v1/provisionamento/reautorizar/verificar') {
    return corpo.codigo === '123456'
      ? [201, { ok: true, validoAte: '2026-09-30T02:00:00.000Z' }]
      : [400, { message: EXPIRADO, error: 'Bad Request', statusCode: 400 }];
  }
  return [404, { message: 'rota desconhecida' }];
}

const TESTE_ISS = (include: string) =>
  [
    '[Setup]',
    'AppName=Teste do assistente Regem',
    'AppVersion=0',
    'CreateAppDir=no',
    'PrivilegesRequired=lowest',
    'Uninstallable=no',
    'OutputBaseFilename=teste-assistente',
    '',
    '[Code]',
    `#include "${include}"`,
    '',
    'procedure Linha(var saida: TArrayOfString; const texto: string);',
    'var n: Integer;',
    'begin',
    '  n := GetArrayLength(saida);',
    '  SetArrayLength(saida, n + 1);',
    '  saida[n] := texto;',
    'end;',
    '',
    'function SimNao(b: Boolean): string;',
    "begin if b then Result := 'sim' else Result := 'nao'; end;",
    '',
    'function InitializeSetup: Boolean;',
    'var saida: TArrayOfString; erro, destino: string; ok: Boolean; i: Integer;',
    'begin',
    "  gApiNuvem := ExpandConstant('{param:nuvem|}');",
    '  gFingerprint := FingerprintMaquina;',
    "  Linha(saida, 'fp=' + gFingerprint);",
    "  ok := ConsultarInstalacao('pronto@teste', 'Sé-1 \"x\" \\ y', '', erro);",
    "  Linha(saida, 'pronto=' + SimNao(ok) + '|' + gSituacao + '|' + erro);",
    "  ok := ConsultarInstalacao('lojas@teste', 'x', '', erro);",
    "  Linha(saida, 'lojas=' + SimNao(ok) + '|' + gSituacao + '|' + IntToStr(GetArrayLength(gUnidadesIds)));",
    '  for i := 0 to GetArrayLength(gUnidadesIds) - 1 do',
    "    Linha(saida, 'loja' + IntToStr(i) + '=' + gUnidadesIds[i] + '|' + gUnidadesNomes[i] + '|' + SimNao(gUnidadesMatriz[i]));",
    "  ok := ConsultarInstalacao('codigo@teste', 'x', 'u-2', erro);",
    "  Linha(saida, 'codigo=' + SimNao(ok) + '|' + gSituacao + '|' + gMetodoPreferido + '|' + SimNao(gTemTotp) + '|' + SimNao(gJaConferido));",
    "  ok := ConsultarInstalacao('errada@teste', 'x', '', erro);",
    "  Linha(saida, 'errada=' + SimNao(ok) + '|' + erro);",
    "  ok := ConsultarInstalacao('velha@teste', 'x', '', erro);",
    "  Linha(saida, 'velha=' + SimNao(ok) + '|' + gSituacao);",
    "  ok := PedirCodigo('codigo@teste', 'x', 'email', destino, erro);",
    "  Linha(saida, 'pedir=' + SimNao(ok) + '|' + destino);",
    "  ok := ConferirCodigo('codigo@teste', 'x', '111111', erro);",
    "  Linha(saida, 'vencido=' + SimNao(ok) + '|' + erro);",
    "  ok := ConferirCodigo('codigo@teste', 'x', '123456', erro);",
    "  Linha(saida, 'certo=' + SimNao(ok) + '|' + erro);",
    "  gApiNuvem := 'http://127.0.0.1:9/api/v1';",
    "  ok := ConsultarInstalacao('pronto@teste', 'x', '', erro);",
    "  Linha(saida, 'semrede=' + SimNao(ok) + '|' + erro);",
    "  SaveStringsToUTF8File(ExpandConstant('{param:resultado|}'), saida, False);",
    '  Result := False; // nao instala nada',
    'end;',
    '',
  ].join('\r\n');

/** A identificação da máquina como o sync-daemon calcula: sha256 do MachineGuid em maiúsculas. */
function fingerprintDoNode(): string {
  const r = spawnSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'], {
    encoding: 'utf8',
  });
  const guid = /MachineGuid\s+REG_SZ\s+(\S+)/.exec(r.stdout ?? '')?.[1] ?? '';
  return createHash('sha256').update(guid.toUpperCase(), 'utf8').digest('hex');
}

/** A do script do instalador (FingerprintForte, extraída pelo AST). */
function fingerprintDoScript(dir: string): string {
  const script = join(dir, 'fp.ps1');
  writeFileSync(
    script,
    [
      'param([string]$Instalador)',
      '$t = $null; $e = $null',
      '$ast = [System.Management.Automation.Language.Parser]::ParseFile($Instalador, [ref]$t, [ref]$e)',
      "$f = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'FingerprintForte' }, $true)",
      '. ([ScriptBlock]::Create($f.Extent.Text))',
      'FingerprintForte',
    ].join('\r\n'),
    'ascii',
  );
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Instalador', INSTALADOR], {
    encoding: 'utf8',
  });
  return (r.stdout ?? '').trim().split(/\r?\n/).pop() ?? '';
}

descrever('assistente do instalador: conversa com a nuvem (Pascal compilado de verdade)', () => {
  let dir: string;
  let saida: Record<string, string>;
  let pedidos: Pedido[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'regem-assistente-'));
    // Com BOM: o teste leva acento no próprio fonte (a senha), e o Inno lê certo em qualquer versão.
    writeFileSync(join(dir, 'teste.iss'), '\ufeff' + TESTE_ISS(INCLUDE), 'utf8');
    const c = spawnSync(ISCC!, ['/Q', `/O${dir}`, join(dir, 'teste.iss')], { encoding: 'utf8' });
    if (c.status !== 0) throw new Error(`ISCC saiu com ${c.status}: ${c.stdout}\n${c.stderr}`);

    pedidos = [];
    const srv: Server = createServer((req, res) => {
      let b = '';
      req.setEncoding('utf8');
      req.on('data', (x) => (b += x));
      req.on('end', () => {
        let corpo: any = {};
        try {
          corpo = JSON.parse(b || '{}');
        } catch {
          corpo = { cru: b };
        }
        pedidos.push({ rota: req.url ?? '', corpo });
        const [st, resp] = responder(req.url ?? '', corpo);
        res.writeHead(st, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(resp));
      });
    });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/v1`;
    const resultado = join(dir, 'resultado.txt');
    try {
      await new Promise<void>((ok) => {
        const p = spawn(join(dir, 'teste-assistente.exe'), [`/nuvem=${url}`, `/resultado=${resultado}`, '/VERYSILENT', '/SUPPRESSMSGBOXES'], {
          stdio: 'ignore',
        });
        const prazo = setTimeout(() => p.kill(), 120_000);
        p.on('close', () => {
          clearTimeout(prazo);
          ok();
        });
      });
    } finally {
      srv.close();
    }
    saida = {};
    for (const l of readFileSync(resultado, 'utf8').replace(/^\ufeff/, '').split(/\r?\n/)) {
      const i = l.indexOf('=');
      if (i > 0) saida[l.slice(0, i)] = l.slice(i + 1);
    }
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('a identificação da máquina é a MESMA no assistente, no script e no daemon', () => {
    expect(saida.fp).toMatch(/^[0-9a-f]{64}$/);
    expect(saida.fp).toBe(fingerprintDoNode());
    expect(saida.fp).toBe(fingerprintDoScript(dir));
  });

  it('manda a conta, a máquina e a loja no corpo — senha com acento, aspas e barra inteira', () => {
    const pronto = pedidos.find((p) => p.corpo.email === 'pronto@teste');
    expect(pronto?.corpo).toEqual({ email: 'pronto@teste', senha: 'Sé-1 "x" \\ y', fingerprint: saida.fp });
    const codigo = pedidos.find((p) => p.corpo.email === 'codigo@teste' && p.rota.endsWith('/verificar') && !p.corpo.codigo);
    expect(codigo?.corpo.unidadeId).toBe('u-2');
  });

  it('lê pronto, a lista de lojas (acento e aspas no nome) e o pedido de código', () => {
    expect(saida.pronto).toBe('sim|pronto|');
    expect(saida.lojas).toBe('sim|escolher_loja|2');
    expect(saida.loja0).toBe('u-1|Matriz|sim');
    expect(saida.loja1).toBe(`u-2|${NOME_DIFICIL}|nao`);
    expect(saida.codigo).toBe('sim|codigo|totp|sim|nao');
  });

  it('erro mostra a frase da nuvem; nuvem antiga (404) segue como antes; sem rede avisa a internet', () => {
    expect(saida.errada).toBe('nao|E-mail ou senha inválidos.');
    expect(saida.velha).toBe('sim|antiga');
    expect(saida.semrede).toMatch(/^nao\|Nao consegui falar com a nuvem\. A loja esta com internet\?/);
  });

  it('pede e confere o código: vencido traz a frase da nuvem; o certo passa', () => {
    expect(saida.pedir).toBe('sim|do***@teste');
    expect(saida.vencido).toBe(`nao|${EXPIRADO}`);
    expect(saida.certo).toBe('sim|');
    const conferidos = pedidos.filter((p) => p.rota.endsWith('/reautorizar/verificar')).map((p) => p.corpo.codigo);
    expect(conferidos).toEqual(['111111', '123456']);
  });
});
