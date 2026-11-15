import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { PRECOS_POR_MILHAO } from '../modules/ia/ia.regras';
import { INTEGRACOES_EM_USO, MODELO_NO_CODIGO, VERSAO_DA_GRAPH_NO_CODIGO } from './integracoes-em-uso';

// O inventário da vigilância de dependências (F3, parte 2) contra o código de verdade: mudar uma versão de API ou um
// modelo de IA passa pelo inventário — senão este teste acusa.
const SRC = join(__dirname, '..');

function arquivosDoCodigo(dir: string, fora: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosDoCodigo(caminho, fora);
    else if (nome.endsWith('.ts') && !nome.endsWith('.spec.ts') && !nome.endsWith('.teste-spec.ts')) fora.push(caminho);
  }
  return fora;
}

const CODIGO = arquivosDoCodigo(SRC).map((c) => ({ arquivo: relative(SRC, c).split(sep).join('/'), texto: readFileSync(c, 'utf8') }));

describe('o inventário das integrações em uso', () => {
  it('toda versão da Graph API escrita no código é a do inventário, e só nos arquivos listados', () => {
    const achadas: string[] = [];
    for (const { arquivo, texto } of CODIGO) {
      if (arquivo === 'common/integracoes-em-uso.ts') continue;
      for (const m of texto.matchAll(VERSAO_DA_GRAPH_NO_CODIGO)) {
        const versao = m[1] ?? m[2];
        const dono = INTEGRACOES_EM_USO.find((i) => i.arquivosDaVersao?.includes(arquivo));
        if (!dono) achadas.push(`${arquivo}: ${versao} fora do inventário`);
        else if (dono.versao !== versao) achadas.push(`${arquivo}: ${versao}, o inventário diz ${dono.versao} (${dono.id})`);
      }
    }
    expect(achadas).toEqual([]);
  });

  it('cada arquivo listado ainda tem a versão (o inventário não fica velho)', () => {
    for (const i of INTEGRACOES_EM_USO.filter((x) => x.versao)) {
      for (const arquivo of i.arquivosDaVersao ?? []) {
        const texto = CODIGO.find((c) => c.arquivo === arquivo)?.texto ?? '';
        expect({ arquivo, temAVersao: texto.includes(i.versao!) }).toEqual({ arquivo, temAVersao: true });
      }
    }
  });

  it('todo modelo de IA usado no código está no inventário e tem preço na tabela do "IA e uso"', () => {
    const doInventario = INTEGRACOES_EM_USO.flatMap((i) => i.modelos ?? []);
    const usados = new Set<string>();
    for (const { arquivo, texto } of CODIGO) {
      if (arquivo === 'common/integracoes-em-uso.ts') continue;
      for (const m of texto.matchAll(MODELO_NO_CODIGO)) usados.add(m[1]);
    }
    expect(usados.size).toBeGreaterThan(0);
    for (const modelo of usados) {
      expect({ modelo, noInventario: doInventario.includes(modelo), comPreco: !!PRECOS_POR_MILHAO[modelo] }).toEqual({ modelo, noInventario: true, comPreco: true });
    }
  });

  it('cada endereço base do inventário ainda é chamado pelo código', () => {
    for (const i of INTEGRACOES_EM_USO.filter((x) => x.base)) {
      const usa = CODIGO.some(({ arquivo, texto }) => arquivo !== 'common/integracoes-em-uso.ts' && texto.includes(i.base!));
      expect({ id: i.id, usa }).toEqual({ id: i.id, usa: true });
    }
  });

  it('ids únicos e cada um com nome, tipo e o que usamos', () => {
    const ids = INTEGRACOES_EM_USO.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of INTEGRACOES_EM_USO) expect(i.nome && i.tipo && i.usamos).toBeTruthy();
  });
});
