import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A PONTE DO CHAT NO ÍCONE "REGEM NESTE PC" (peça 6 do protótipo de conexão, "o ícone do Regem"). O programa da ponte
// (`ponte-chat/`) grava o estado em `%APPDATA%\Regem Ponte do chat\estado-da-ponte.json` e atende --abrir/--pausar/
// --retomar; o ícone (`RegemEstacao.cs`) lê o arquivo, mostra a linha da ponte e chama o programa. As peças moram em dois
// programas — este teste amarra uma à outra. A parte que compila o C# roda só no Windows (no CI, Linux, é pulada).
const RAIZ = join(__dirname, '..', '..', '..', '..');
const CS = join(RAIZ, 'backend', 'edge', 'bandeja', 'RegemEstacao.cs');
const ler = (...p: string[]) => readFileSync(join(RAIZ, ...p), 'utf8');
jest.setTimeout(120_000);

describe('a ponte do chat no ícone "Regem neste PC" — as peças amarradas', () => {
  it('o arquivo, a pasta e os comandos são os mesmos nos dois programas; o .cs segue ASCII', () => {
    const cs = readFileSync(CS, 'utf8');
    expect([...cs].filter((c) => c.charCodeAt(0) > 127)).toEqual([]); // o csc lê na página de código do Windows
    // a pasta de dados do programa da ponte (app.setName / productName) e o nome do arquivo
    expect(ler('ponte-chat', 'src', 'main.js')).toContain("app.setName('Regem Ponte do chat');");
    expect(JSON.parse(ler('ponte-chat', 'package.json')).productName).toBe('Regem Ponte do chat');
    expect(ler('ponte-chat', 'src', 'estado-local.js')).toContain("const ARQUIVO = 'estado-da-ponte.json';");
    expect(cs).toContain('Environment.SpecialFolder.ApplicationData), "Regem Ponte do chat"), "estado-da-ponte.json")');
    // os comandos que o ícone manda são os que o programa entende
    const local = ler('ponte-chat', 'src', 'estado-local.js');
    for (const c of ['--abrir', '--pausar', '--retomar']) {
      expect(local).toContain(`if (a === '${c}')`);
      expect(cs).toContain(`"${c}"`);
    }
    // o executável que o ícone aceita é o do instalador da ponte (productName + .exe)
    expect(cs).toContain('nome != "regem ponte do chat.exe"');
    // o prazo de "aberta" é o mesmo da nuvem (VIVA_POR_MS = 2 min)
    expect(ler('backend', 'src', 'modules', 'ponte-chat', 'lideranca.ts')).toContain('export const VIVA_POR_MS = 2 * 60_000;');
    expect(cs).toContain('public const int AbertaPorSegundos = 120;');
  });

  const csc = process.env.SystemRoot ? join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe') : '';
  (csc && existsSync(csc) ? describe : describe.skip)('compilado de verdade (Windows)', () => {
    let pasta: string;
    let icone: string;
    let falsa: string;
    let chamadas: string;
    const arquivoDaPonte = () => join(pasta, 'estado-da-ponte.json');
    const estado = (o: Record<string, unknown> = {}, minAtras = 0) =>
      writeFileSync(
        arquivoDaPonte(),
        JSON.stringify({
          versao: '0.5.0', maquina: 'CX-DELIVERY', pareada: true, nome: 'Ponte do delivery', soObservar: false, pausadaEm: null,
          ligada: true, papel: 'responde', nuvem: 'ok', ifood: { logado: true }, lidas: 0, saida: null, ultimoAviso: null,
          abrir: { exe: falsa, args: ['C:\\pasta da ponte'] },
          atualizadoEm: new Date(Date.now() - minAtras * 60_000).toISOString(),
          ...o,
        }),
      );
    // o que o menu mostraria (o serviço da impressão não está de pé: vem o erro e, mesmo assim, a ponte)
    const diagnostico = async (): Promise<string[]> => {
      const saida = join(pasta, 'diag.txt');
      await new Promise<void>((ok) =>
        execFile(icone, ['--raiz', join(pasta, 'estacao'), '--porta', '1', '--ponte', arquivoDaPonte(), '--diagnostico', saida], { timeout: 60_000 }, () => ok()),
      );
      return readFileSync(saida, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('ponte'));
    };
    const chamar = (comando: string) =>
      new Promise<number>((ok) =>
        execFile(icone, ['--ponte', arquivoDaPonte(), '--chamar-ponte', comando], { timeout: 60_000 }, (e: any) => ok(e ? e.code ?? 1 : 0)),
      );
    const esperarChamada = async (ms = 15_000) => {
      const fim = Date.now() + ms;
      while (Date.now() < fim) {
        if (existsSync(chamadas)) return readFileSync(chamadas, 'utf8').trim().split(/\r?\n/);
        await new Promise((r) => setTimeout(r, 200));
      }
      return [];
    };

    beforeAll(() => {
      pasta = mkdtempSync(join(tmpdir(), 'regem-icone-ponte-'));
      mkdirSync(join(pasta, 'estacao'));
      icone = join(pasta, 'RegemEstacao.exe');
      execFileSync(csc, ['-nologo', '-target:winexe', `-out:${icone}`, '-r:System.Web.Extensions.dll', '-r:System.Windows.Forms.dll', '-r:System.Drawing.dll', CS], { stdio: 'pipe' });
      // a "ponte" de mentira: um programa com o nome do da ponte que anota os argumentos que recebeu
      const pastaFalsa = join(pasta, 'ponte');
      mkdirSync(pastaFalsa);
      falsa = join(pastaFalsa, 'Regem Ponte do chat.exe');
      chamadas = join(pastaFalsa, 'chamadas.txt');
      const fonte = join(pasta, 'falsa.cs');
      writeFileSync(
        fonte,
        'using System; using System.IO;\nclass P { static void Main(string[] a) { File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "chamadas.txt"), string.Join("|", a) + Environment.NewLine); } }\n',
      );
      execFileSync(csc, ['-nologo', '-target:winexe', `-out:${falsa}`, fonte], { stdio: 'pipe' });
    });
    afterAll(() => rmSync(pasta, { recursive: true, force: true }));
    beforeEach(() => rmSync(chamadas, { force: true }));

    it('PC sem a ponte: nenhuma linha nem item', async () => {
      rmSync(arquivoDaPonte(), { force: true });
      expect(await diagnostico()).toEqual(['ponte=-']);
    });

    it('a ponte aberta: a linha diz o papel e o login; "Abrir" e "Pausar" chamam o programa com o comando', async () => {
      estado();
      expect(await diagnostico()).toEqual([
        'ponte=Ponte do chat: responde o chat - iFood logado',
        `ponteItem=Abrir a ponte do chat|${falsa} "C:\\pasta da ponte" --abrir`,
        `ponteItem=Pausar a ponte do chat|${falsa} "C:\\pasta da ponte" --pausar`,
      ]);
      expect(await chamar('pausar')).toBe(0);
      expect(await esperarChamada()).toEqual(['C:\\pasta da ponte|--pausar']);
    });

    it('pausada: a linha diz "pausada neste PC" e o item vira "Retomar"', async () => {
      estado({ pausadaEm: new Date().toISOString() });
      const l = await diagnostico();
      expect(l[0]).toBe('ponte=Ponte do chat: pausada neste PC - iFood logado');
      expect(l).toEqual([
        'ponte=Ponte do chat: pausada neste PC - iFood logado',
        `ponteItem=Abrir a ponte do chat|${falsa} "C:\\pasta da ponte" --abrir`,
        `ponteItem=Retomar a ponte do chat|${falsa} "C:\\pasta da ponte" --retomar`,
      ]);
      expect(await chamar('retomar')).toBe(0);
      expect(await esperarChamada()).toEqual(['C:\\pasta da ponte|--retomar']);
    });

    it('cada situação na linha, na ordem da janela da ponte', async () => {
      const linha = async (o: Record<string, unknown>, min = 0) => {
        estado(o, min);
        return (await diagnostico())[0];
      };
      expect(await linha({ papel: 'reserva', ifood: { logado: true } })).toBe('ponte=Ponte do chat: reserva - iFood logado');
      expect(await linha({ ifood: { logado: false }, papel: 'fora' })).toBe('ponte=Ponte do chat: no ar - iFood sem login');
      expect(await linha({ ligada: false })).toBe('ponte=Ponte do chat: desligada nos ajustes - iFood logado');
      expect(await linha({ nuvem: 'rede' })).toBe('ponte=Ponte do chat: sem a nuvem - iFood logado');
      expect(await linha({ pareada: false })).toBe('ponte=Ponte do chat: falta parear - iFood logado');
      // sem pareamento: só "Abrir" (não há o que pausar)
      expect((await diagnostico()).filter((x) => x.startsWith('ponteItem=')).map((x) => x.split('|')[0])).toEqual(['ponteItem=Abrir a ponte do chat']);
    });

    it('fechada (estado de mais de 2 min): "fechada neste PC" e só "Abrir" (o programa abre)', async () => {
      estado({}, 5);
      expect((await diagnostico()).map((x) => x.split('|')[0])).toEqual(['ponte=Ponte do chat: fechada neste PC', 'ponteItem=Abrir a ponte do chat']);
      expect(await chamar('abrir')).toBe(0);
      expect(await esperarChamada()).toEqual(['C:\\pasta da ponte|--abrir']);
    });

    it('o ícone não abre outro programa pelo arquivo, nem outro comando', async () => {
      estado({ abrir: { exe: join(process.env.SystemRoot!, 'System32', 'notepad.exe'), args: [] } });
      expect(await diagnostico()).toEqual(['ponte=Ponte do chat: responde o chat - iFood logado']);
      expect(await chamar('pausar')).toBe(2);
      estado();
      expect(await chamar('formatar')).toBe(2);
      expect(await esperarChamada(2000)).toEqual([]);
      // arquivo estragado: como se não houvesse
      writeFileSync(arquivoDaPonte(), '{meio gravado');
      expect(await diagnostico()).toEqual(['ponte=-']);
    });
  });
});
