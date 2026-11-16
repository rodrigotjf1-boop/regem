import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ehServidorLocal } from './modo';

// "ESTE PROCESSO É O SERVIDOR DA LOJA?" — UM LUGAR PARA A PERGUNTA (V2 do registro de erros).
// O código comparava `process.env.EDGE_MODE` à mão em 26 lugares, de três jeitos: uns aceitavam "TRUE", outros só "true"
// exato, nenhum aceitava "1" — que o `ehServidorLocal()` aceita. Com o valor que o instalador grava (`true`) todos
// concordavam; com qualquer outro, metade do código se achava loja e metade nuvem (rota só-nuvem aberta na loja, rotina da
// nuvem rodando nela). Este teste impede a comparação à mão de voltar.

describe('ehServidorLocal', () => {
  const antes = process.env.EDGE_MODE;
  afterEach(() => {
    if (antes === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = antes;
  });

  it.each([
    ['true', true],
    ['TRUE', true],
    [' true ', true],
    ['1', true],
    ['false', false],
    ['0', false],
    ['', false],
    ['sim', false],
  ])('EDGE_MODE="%s" → %s', (valor, esperado) => {
    process.env.EDGE_MODE = valor;
    expect(ehServidorLocal()).toBe(esperado);
  });

  it('sem a variável: é a nuvem', () => {
    delete process.env.EDGE_MODE;
    expect(ehServidorLocal()).toBe(false);
  });
});

// O script das migrations da loja (`scripts/apply-all-local.mjs`) não pode importar o `modo.ts`, mas tem de responder
// IGUAL: se a API se acha loja e ele não, ele cria na loja as tabelas que só existem na nuvem. As três linhas dele são
// avaliadas aqui a partir do TEXTO do arquivo.
describe('o script das migrations da loja decide como a API', () => {
  const fonte = readFileSync(join(__dirname, '..', '..', 'scripts', 'apply-all-local.mjs'), 'utf8').replace(/\r\n/g, '\n');
  const linha = (nome: string) => {
    const l = fonte.match(new RegExp(`^const ${nome} = .*$`, 'm'))?.[0];
    if (!l) throw new Error(`apply-all-local.mjs mudou: não achei "const ${nome}"`);
    return l;
  };
  const decidir = (envDoArquivo: string, variavel?: string): boolean =>
    new Function('env', 'process', `${linha('valeComoLoja')}\n${linha('noArquivo')}\n${linha('ehEdge')}\nreturn ehEdge;`)(envDoArquivo, {
      env: { EDGE_MODE: variavel },
    });
  const antes = process.env.EDGE_MODE;
  afterEach(() => {
    if (antes === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = antes;
  });

  it.each(['true', 'TRUE', ' true ', '1', 'false', '0', '', 'sim'])('a variável "%s": o script e a API respondem igual', (valor) => {
    process.env.EDGE_MODE = valor;
    expect(decidir('', valor)).toBe(ehServidorLocal());
  });

  it.each([
    ['EDGE_MODE=true', true],
    ['EDGE_MODE="true"', true],
    ["EDGE_MODE='true' # servidor da loja", true],
    ['PORT=4000\nEDGE_MODE=TRUE\nOUTRA=x', true],
    ['EDGE_MODE = 1', true],
    ['EDGE_MODE=false', false],
    ['EDGE_MODE=', false],
    ['# EDGE_MODE=true', false],
    ['OUTRA_EDGE_MODE_X=true', false],
    ['', false],
  ])('o arquivo .env.local com %j → %s', (arquivo, esperado) => {
    expect(decidir(arquivo, undefined)).toBe(esperado);
  });
});

describe('ninguém mais lê o EDGE_MODE à mão', () => {
  const RAIZ = join(__dirname, '..');
  const arquivos: string[] = [];
  const andar = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) andar(p);
      // Só o código do app: os testes (`.spec.ts`, `.teste-spec.ts`) definem a variável para simular a loja.
      else if (n.endsWith('.ts') && !n.endsWith('.spec.ts') && !n.endsWith('-spec.ts')) arquivos.push(p);
    }
  };
  andar(RAIZ);

  it('achou o código do app para conferir', () => {
    expect(arquivos.length).toBeGreaterThan(300);
  });

  it('só o `common/modo.ts` lê `process.env.EDGE_MODE`', () => {
    const fora = arquivos
      .filter((a) => !a.replace(/\\/g, '/').endsWith('/common/modo.ts'))
      // Fora os comentários: eles explicam a regra e citam a variável.
      .filter((a) =>
        readFileSync(a, 'utf8')
          .split('\n')
          .some((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /process\.env\.EDGE_MODE|process\.env\[['"]EDGE_MODE['"]\]/.test(l.replace(/\/\/.*$/, ''))),
      )
      .map((a) => a.replace(/\\/g, '/').replace(RAIZ.replace(/\\/g, '/') + '/', ''));
    expect(fora).toEqual([]);
  });
});
