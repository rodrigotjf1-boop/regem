import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O INSTALADOR E A PRIMEIRA CARGA DA LOJA (ERR-132).
//
// Na loja piloto (30/09), a reinstalação limpa refez o banco do zero, a primeira carga do sync
// esgotou as travas do Postgres e entrou em laço — e o instalador disse "concluída" com o banco
// vazio. Agora: o Postgres da loja nasce com mais vagas de trava, o banco novo pede a restauração
// por arquivo (o histórico vem de uma vez, sem os órfãos da carga página a página) e o instalador
// só dá por pronta a instalação quando a loja e os usuários chegaram — senão avisa o motivo.
const INSTALADOR = join(__dirname, '..', '..', '..', 'edge', 'instalar-tudo.ps1');
const ISS = join(__dirname, '..', '..', '..', 'edge', 'regem-edge.iss');

jest.setTimeout(60_000);

describe('instalador: primeira carga da loja (ERR-132)', () => {
  const fonte = readFileSync(INSTALADOR, 'utf8');

  it('todo initdb ganha as vagas de trava e marca o banco como novo', () => {
    const initdbs = [...fonte.matchAll(/initdb\.exe"\) -U postgres/g)].length;
    expect(initdbs).toBeGreaterThanOrEqual(2); // instalação nova + último recurso
    const depois = fonte.split(/initdb\.exe"\) -U postgres[^\n]*\n/).slice(1);
    for (const trecho of depois) {
      const logo = trecho.split('\n').slice(0, 4).join('\n');
      expect(logo).toContain('$null = Garantir-TravasPostgres $pgData');
      expect(logo).toContain('$bancoNovo = $true');
    }
  });

  it('reinstalação que preserva o banco também ganha as vagas (com o Postgres reiniciado)', () => {
    expect(fonte).toMatch(/if \(Garantir-TravasPostgres \$pgData\) \{[\s\S]{0,400}nssm stop RegemEdgePg/);
  });

  it('banco novo — ou preservado sem a loja instalada — pede a restauração por arquivo sozinho', () => {
    expect(fonte).toContain('$semALoja = -not (Conferir-DadosDaLoja $node $dbLocal $UnidadeId 0).loja');
    expect(fonte).toContain('if ($Restaurar -or $bancoNovo -or $semALoja) {');
  });

  it('só dá por pronta quando a loja e os usuários chegaram; senão avisa e manda para a Telemetria', () => {
    const aviso = fonte.indexOf('$dados = Conferir-DadosDaLoja $node $dbLocal $UnidadeId 5');
    const pronto = fonte.indexOf("Set-Content -Path (Join-Path $logDir 'INSTALOU-OK.flag')", aviso);
    expect(aviso).toBeGreaterThan(-1);
    expect(pronto).toBeGreaterThan(aviso); // confere ANTES de marcar a instalação
    // Com o nome da loja (rota autenticada pelo token do servidor) e, sem ela, pela pública.
    expect(fonte).toContain(`-Uri "$cloudBase/edge/telemetria" -Headers @{ 'x-sync-token' = $SyncToken }`);
    expect(fonte).toContain(`-Uri "$cloudBase/edge/telemetria/erro"`);
    expect(fonte).toContain("tipo = 'install_aviso'");
    expect(fonte).toContain("'INSTALOU-AVISO.txt'");
    // O assistente mostra o aviso em vez de "concluído".
    const iss = readFileSync(ISS, 'utf8');
    expect(iss).toContain("INSTALOU-AVISO.txt'));");
    expect(iss).toContain("'Instalado - dados da loja a caminho'");
  });

  // O node da loja não acha o pacote pg num script da pasta TEMP, e num arquivo o argumento é o
  // process.argv[2] (o [1] é o próprio arquivo) — o -Restaurar nunca marcou a restauração assim.
  it('script do node escrito pelo instalador fica na raiz do backend e lê argv[2]', () => {
    expect(fonte).not.toMatch(/Join-Path \$env:TEMP \("regem-[a-z]+-\{0\}\.c?js"/);
    const scripts = [...fonte.matchAll(/= @'\r?\n(const \{ Client \} = require\('pg'\);[\s\S]*?)\r?\n'@/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThanOrEqual(2); // restauração + conferência
    for (const js of scripts) {
      expect(js).not.toContain('process.argv[1]');
      expect(js).toContain('process.argv[2]');
    }
    expect(fonte).toContain("$restoreFile = Novo-ScriptNode 'regem-restore' $jsRestore");
    expect(fonte).toContain("$arq = Novo-ScriptNode 'regem-conferir' $js");
  });

  it('Garantir-TravasPostgres anexa uma vez só e devolve se mudou', () => {
    const ps = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
    const tem = spawnSync(ps, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
    if (tem.status !== 0) return console.warn(`instalador-primeira-carga.spec: sem ${ps} — execução PULADA`);
    const dir = mkdtempSync(join(tmpdir(), 'regem-pgconf-'));
    try {
      writeFileSync(join(dir, 'postgresql.conf'), "# gerado pelo initdb\nmax_connections = 100\n", 'ascii');
      const script = join(dir, 'teste.ps1');
      writeFileSync(
        script,
        [
          'param([string]$Instalador, [string]$Dir)',
          "$ErrorActionPreference = 'Stop'",
          '$t = $null; $e = $null',
          '$ast = [System.Management.Automation.Language.Parser]::ParseFile($Instalador, [ref]$t, [ref]$e)',
          "$f = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Garantir-TravasPostgres' }, $true)",
          '. ([ScriptBlock]::Create($f.Extent.Text))',
          '$a = Garantir-TravasPostgres $Dir',
          '$b = Garantir-TravasPostgres $Dir',
          '$c = Garantir-TravasPostgres (Join-Path $Dir "nao-existe")',
          '@{ primeira = $a; segunda = $b; semArquivo = $c } | ConvertTo-Json -Compress',
        ].join('\r\n'),
        'ascii',
      );
      const r = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Instalador', INSTALADOR, '-Dir', dir], {
        encoding: 'utf8',
      });
      if (r.status !== 0) throw new Error(`PowerShell saiu com ${r.status}: ${r.stderr}`);
      const saida = JSON.parse(r.stdout.trim().split(/\r?\n/).pop()!);
      expect(saida).toEqual({ primeira: true, segunda: false, semArquivo: false });
      const conf = readFileSync(join(dir, 'postgresql.conf'), 'utf8');
      expect(conf.match(/max_locks_per_transaction = 256/g)).toHaveLength(1);
      expect(conf).toContain('max_connections = 100'); // o que já havia fica
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// A conferência roda de verdade: o script embutido, gravado na raiz do backend como o instalador
// grava, contra o Postgres real (V6: SQL em string se testa no banco, com as colunas reais).
const URL_PG = process.env.TEST_PG_URL;
const descreverPg = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('instalador-primeira-carga.spec: sem TEST_PG_URL — conferência no banco PULADA');

descreverPg('instalador: conferência dos dados da loja no banco local (ERR-132)', () => {
  const fonte = readFileSync(INSTALADOR, 'utf8');
  const RAIZ = join(__dirname, '..', '..', '..');
  let pool: Pool;
  const empresas: string[] = [];
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;

  // O script da função Conferir-DadosDaLoja, como o instalador o grava (Novo-ScriptNode).
  const conferir = (unidadeId: string) => {
    const funcao = fonte.slice(fonte.indexOf('function Conferir-DadosDaLoja'));
    const js = /\$js = @'\r?\n([\s\S]*?)\r?\n'@/.exec(funcao)![1];
    const arq = join(RAIZ, `regem-conferir-teste-${randomUUID()}.cjs`);
    writeFileSync(arq, js, 'ascii');
    try {
      const r = spawnSync(process.execPath, [arq, URL_PG!, unidadeId], { encoding: 'utf8', cwd: tmpdir() });
      return JSON.parse(r.stdout.trim().split(/\r?\n/).pop() || '{}');
    } finally {
      rmSync(arq, { force: true });
    }
  };

  beforeAll(() => {
    pool = new Pool({ connectionString: URL_PG });
  });
  afterAll(async () => {
    for (const t of empresas) {
      await q('delete from colaborador where tenant_id = $1', [t]).catch(() => {});
      await q('delete from funcao where tenant_id = $1', [t]).catch(() => {});
      await q('delete from unidade where tenant_id = $1', [t]).catch(() => {});
      await q('delete from empresa where id = $1', [t]).catch(() => {});
    }
    await pool?.end();
  });

  it('loja que ainda não chegou → não está pronta', () => {
    const r = conferir(randomUUID());
    expect(r.loja).toBe(false);
    expect(r.usuarios).toBe(0);
    expect(String(r.erro ?? '')).not.toMatch(/banco local|Cannot find module/);
  });

  it('loja e usuários no banco → pronta; usuário de OUTRA loja não conta', async () => {
    const t = (await q(`insert into empresa (nome) values ('Teste conferência') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja conferida') returning id`, [t]))[0].id as string;
    expect(conferir(u)).toMatchObject({ loja: true, usuarios: 0 }); // chegou a loja, faltam os usuários
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Dona','presidente') returning id`, [t]))[0].id;
    await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1,'Dona',$2)`, [t, funcao]);
    expect(conferir(u)).toMatchObject({ loja: true, usuarios: 1 });
  });

  it('banco fora do ar → devolve o motivo em vez de quebrar', () => {
    const funcao = fonte.slice(fonte.indexOf('function Conferir-DadosDaLoja'));
    const js = /\$js = @'\r?\n([\s\S]*?)\r?\n'@/.exec(funcao)![1];
    const arq = join(RAIZ, `regem-conferir-teste-${randomUUID()}.cjs`);
    writeFileSync(arq, js, 'ascii');
    try {
      const r = spawnSync(process.execPath, [arq, 'postgresql://postgres:x@127.0.0.1:1/nada', randomUUID()], { encoding: 'utf8' });
      const saida = JSON.parse(r.stdout.trim().split(/\r?\n/).pop() || '{}');
      expect(saida.loja).toBe(false);
      expect(saida.erro).toMatch(/^banco local: /);
    } finally {
      rmSync(arq, { force: true });
    }
  });
});
