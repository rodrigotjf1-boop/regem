import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { hojeISO, dataNoFuso } from './data';

// Data de REGISTRO em UTC é o erro que já aconteceu duas vezes neste projeto: foi
// corrigido só no ponto.controller e as outras três cópias seguiram erradas.
describe('data — hoje no fuso da operação', () => {
  const spDe = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

  it('devolve YYYY-MM-DD', () => {
    expect(hojeISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('é a data de São Paulo, não a de UTC', () => {
    expect(hojeISO()).toBe(spDe(new Date()));
  });

  it('21h30 em SP ainda é o MESMO dia (em UTC já seria o seguinte)', () => {
    // 2026-03-10T00:30:00Z = 2026-03-09 21:30 em São Paulo.
    const d = new Date('2026-03-10T00:30:00Z');
    expect(d.toISOString().slice(0, 10)).toBe('2026-03-10'); // o que o código fazia
    expect(dataNoFuso(d)).toBe('2026-03-09'); // o que a loja viveu
  });

  it('meia-noite e meia em SP é o dia novo', () => {
    const d = new Date('2026-03-10T03:30:00Z'); // 00:30 em SP
    expect(dataNoFuso(d)).toBe('2026-03-10');
  });
});

// Guarda de deriva: foi a cópia local que fez o conserto ficar preso num arquivo.
describe('nenhuma cópia local de hojeISO', () => {
  it('só existe a definição em common/data.ts', () => {
    let saida = '';
    try {
      saida = execSync('git grep -n "function hojeISO" -- "*.ts"', { encoding: 'utf8' });
    } catch {
      saida = ''; // git grep sai != 0 quando não encontra nada
    }
    const fora = saida
      .split('\n')
      .filter(Boolean)
      .filter((l) => !l.includes('common/data.ts'));
    expect(fora).toEqual([]);
  });

  it('o helper não usa toISOString para montar a data', () => {
    // Só as linhas de CÓDIGO: o arquivo cita `toISOString` no comentário justamente
    // para explicar o que NÃO fazer, e isso não pode derrubar o teste.
    const codigo = readFileSync(__dirname + '/data.ts', 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(codigo).not.toMatch(/toISOString\(\)\.slice\(0, ?10\)/);
    expect(codigo).toContain('America/Sao_Paulo');
  });
});
