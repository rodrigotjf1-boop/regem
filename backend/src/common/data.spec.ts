import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { hojeISO, dataNoFuso, somarDias, horaAgora } from './data';

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

describe('data — aritmética sem fuso', () => {
  it('soma e subtrai dias', () => {
    expect(somarDias('2026-09-16', -1)).toBe('2026-09-15');
    expect(somarDias('2026-09-16', 20)).toBe('2026-10-06');
  });

  it('atravessa mês e ano', () => {
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(somarDias('2028-03-01', -1)).toBe('2028-02-29'); // bissexto
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
  });

  // A véspera do início do período é o estoque inicial do CMV: errar um dia aqui conta
  // as compras do primeiro dia duas vezes.
  it('a véspera é sempre o dia anterior, qualquer que seja o fuso do servidor', () => {
    for (const d of ['2026-01-01', '2026-06-15', '2026-11-02']) {
      expect(somarDias(somarDias(d, -1), 1)).toBe(d);
    }
  });

  it('horaAgora devolve HH:MM', () => {
    expect(horaAgora()).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
  });
});

// Guarda de deriva: foi a cópia local que fez o conserto ficar preso num arquivo.
describe('nenhuma cópia local de hojeISO', () => {
  it('só existe a definição em common/data.ts', () => {
    let saida = '';
    try {
      // `--untracked` para enxergar também uma cópia nova ainda não commitada. Sem
      // isso o teste passa local (arquivo novo não é rastreado) e só quebra no CI.
      // `-E` com as DUAS formas: a busca original só via `function hojeISO`, e a
      // quinta cópia (etiqueta-validade) era `const hojeISO = () =>` — passou por
      // baixo da guarda e ficou meses devolvendo a data em UTC.
      saida = execSync(
        'git grep -nE --untracked "(function hojeISO|const hojeISO\\s*=)" -- "*.ts"',
        { encoding: 'utf8' },
      );
    } catch {
      saida = ''; // git grep sai != 0 quando não encontra nada
    }
    const permitido = /common[\/]data(\.spec)?\.ts/; // a definição real e ESTE arquivo
    // Linha de COMENTÁRIO não é definição: sem esta exclusão, um comentário que
    // cita o nome do helper derruba a guarda — foi o que aconteceu ao ampliá-la
    // para a forma arrow.
    const comentario = /:\s*(\/\/|\*)/;
    const fora = saida
      .split('\n')
      .filter(Boolean)
      .filter((l) => !permitido.test(l) && !comentario.test(l));
    expect(fora).toEqual([]);
  });

  it('a guarda enxerga a forma arrow, não só `function`', () => {
    // Meta-teste: sem isto, ampliar a busca e quebrá-la de novo passaria calado.
    const re = /\(function hojeISO\|const hojeISO/;
    expect(readFileSync(__filename, 'utf8')).toMatch(re);
  });

  // A guarda acima procura pelo NOME (`hojeISO`) — e foi por isso que ela não viu a cópia do
  // contador de senha, que se chamava `diaStr` e devolvia a data em UTC. Das 21h à meia-noite
  // ela discordava da data gravada pelo banco, o contador concluía "virou o dia" a CADA pedido
  // e toda senha do horário de pico saía 1 (ERR-087). Esta guarda procura pelo PADRÃO, que
  // nenhum nome disfarça: "agora" transformado em data pelo caminho do UTC.
  it('ninguém monta a data de HOJE pelo UTC', () => {
    let saida = '';
    try {
      saida = execSync(
        'git grep -nE --untracked "new Date\\((Date\\.now\\(\\)[^)]*)?\\)\\.toISOString\\(\\)\\.slice\\(0, ?10\\)" -- "*.ts"',
        { encoding: 'utf8' },
      );
    } catch {
      saida = '';
    }
    // Dívida CONHECIDA: filtros e carimbos que erram no máximo um dia depois das 21h (período
    // padrão de relatório/estoque, semana inicial da escala, nome do arquivo de exportação,
    // data de expurgo de foto, dia do job de ordens recorrentes). Nenhum deles decide dinheiro
    // ou numeração. A lista existe para que NENHUM caso NOVO entre — não para abençoar estes.
    const dividaConhecida = [
      'src/modules/relatorios/relatorios.service.ts',
      'src/modules/estoque/estoque.controller.ts',
      'src/modules/escala/escala.controller.ts',
      'src/modules/cliente/cliente.service.ts',
      'src/modules/jobs/jobs.service.ts',
      'src/modules/tarefa/tarefa-instancia.service.ts',
    ];
    const comentario = /:\s*(\/\/|\*)/;
    const fora = saida
      .split('\n')
      .filter(Boolean)
      .filter((l) => !comentario.test(l))
      .filter((l) => !/common[\/]data(\.spec)?\.ts/.test(l))
      .filter((l) => !dividaConhecida.some((d) => l.startsWith(d)));
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
