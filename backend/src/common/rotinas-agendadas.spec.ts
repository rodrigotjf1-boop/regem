import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// TODA ROTINA AGENDADA DIZ ONDE RODA (ERR-075). O servidor da loja roda a MESMA dist da nuvem: todo `@Cron`/`@Interval`
// dispara nos dois lados, a não ser que a rotina decida. Em 16/11/2026 isso escondia três defeitos (o expurgo que zerava
// a foto que o outro lado é quem apaga, o aviso de uma loja tocando em outra, o alerta de estoque nascendo em dobro).
// A regra: a rotina tem uma GUARDA de lado no corpo (`ehServidorLocal()`, `this.isEdge`, `ehEdge()`) OU o comentário
// logo acima dela diz `ONDE RODA: …` (nos dois lados de propósito, e por quê). Este teste impede a rotina nova de nascer
// sem a decisão.

const RAIZ = join(__dirname, '..');
const GUARDA = /ehServidorLocal\(\)|this\.isEdge\b|ehEdge\(\)|this\.edge\b/;

type Rotina = { onde: string; nome: string; decide: boolean };

function rotinasAgendadas(): Rotina[] {
  const arquivos: string[] = [];
  const andar = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) andar(p);
      else if (n.endsWith('.ts') && !n.endsWith('.spec.ts') && !n.endsWith('-spec.ts')) arquivos.push(p);
    }
  };
  andar(RAIZ);
  const achadas: Rotina[] = [];
  for (const a of arquivos) {
    const texto = readFileSync(a, 'utf8').replace(/\r\n/g, '\n');
    if (!/@(Cron|Interval)\(/.test(texto)) continue;
    const linhas = texto.split('\n');
    for (let i = 0; i < linhas.length; i++) {
      if (!/^\s*@(Cron|Interval)\(/.test(linhas[i])) continue;
      // O comentário logo acima: linhas de comentário (ou outros decoradores) coladas na rotina.
      let c = i - 1;
      while (c >= 0 && /^\s*(\/\/|\/\*|\*|@)/.test(linhas[c])) c--;
      const comentario = linhas.slice(c + 1, i).join('\n');
      // O corpo: até a chave que fecha o método (dois espaços de recuo, o padrão do projeto).
      let f = i + 1;
      while (f < linhas.length && !/^ {2}\}\s*$/.test(linhas[f])) f++;
      const corpo = linhas.slice(i, f + 1).join('\n');
      const nome = (corpo.match(/^\s*(?:async\s+)?(\w+)\s*\(/m) ?? [])[1] ?? '?';
      achadas.push({
        onde: `${a.replace(/\\/g, '/').replace(RAIZ.replace(/\\/g, '/') + '/', '')}:${i + 1}`,
        nome,
        decide: /ONDE RODA/.test(comentario) || GUARDA.test(corpo),
      });
    }
  }
  return achadas;
}

describe('toda rotina agendada diz onde roda (ERR-075)', () => {
  const rotinas = rotinasAgendadas();

  it('achou as rotinas agendadas do backend', () => {
    expect(rotinas.length).toBeGreaterThan(60);
  });

  it('cada uma tem a guarda de lado no corpo ou o comentário "ONDE RODA:" logo acima', () => {
    const semDecisao = rotinas.filter((r) => !r.decide).map((r) => `${r.onde} ${r.nome}`);
    expect(semDecisao).toEqual([]);
  });
});
