import { JanelaPorChave } from './janela-por-chave';
import { FilaCheia, UmPorVez } from './um-por-vez';

// Os dois utilitários da segunda rodada da avaliação de segurança (16/11/2026, B-02): a fila por chave (o PIN confere
// um de cada vez por loja) e o teto por identidade (códigos por telefone e por e-mail).

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('UmPorVez', () => {
  it('a mesma chave roda um de cada vez, na ordem de chegada', async () => {
    const fila = new UmPorVez(10);
    const marcas: string[] = [];
    let rodando = 0;
    let maximoJunto = 0;
    const tarefa = (nome: string, ms: number) => async () => {
      rodando++;
      maximoJunto = Math.max(maximoJunto, rodando);
      marcas.push(`entrou ${nome}`);
      await esperar(ms);
      marcas.push(`saiu ${nome}`);
      rodando--;
      return nome;
    };
    const r = await Promise.all([fila.rodar('loja-1', tarefa('a', 30)), fila.rodar('loja-1', tarefa('b', 5)), fila.rodar('loja-1', tarefa('c', 1))]);
    expect(r).toEqual(['a', 'b', 'c']);
    expect(maximoJunto).toBe(1);
    expect(marcas).toEqual(['entrou a', 'saiu a', 'entrou b', 'saiu b', 'entrou c', 'saiu c']);
  });

  it('chaves diferentes não esperam uma à outra', async () => {
    const fila = new UmPorVez(10);
    let rodando = 0;
    let maximoJunto = 0;
    const tarefa = async () => {
      rodando++;
      maximoJunto = Math.max(maximoJunto, rodando);
      await esperar(20);
      rodando--;
    };
    await Promise.all([fila.rodar('loja-1', tarefa), fila.rodar('loja-2', tarefa)]);
    expect(maximoJunto).toBe(2);
  });

  it('o erro de um não impede o próximo, e chega a quem chamou', async () => {
    const fila = new UmPorVez(10);
    const primeiro = fila.rodar('k', async () => {
      throw new Error('falhou');
    });
    const segundo = fila.rodar('k', async () => 'ok');
    await expect(primeiro).rejects.toThrow('falhou');
    await expect(segundo).resolves.toBe('ok');
  });

  it('a fila cheia recusa na hora, sem rodar; a fila vazia sai da memória', async () => {
    const fila = new UmPorVez(3);
    let rodaram = 0;
    const tarefa = async () => {
      rodaram++;
      await esperar(15);
    };
    const resultados = await Promise.allSettled(Array.from({ length: 8 }, () => fila.rodar('k', tarefa)));
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const recusas = resultados.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(recusas).toHaveLength(5);
    for (const r of recusas) expect(r.reason).toBeInstanceOf(FilaCheia);
    expect(rodaram).toBe(3);
    expect(fila.chaves).toBe(0);
    // depois de esvaziar, cabe de novo
    await expect(fila.rodar('k', async () => 'de novo')).resolves.toBe('de novo');
  });
});

describe('JanelaPorChave', () => {
  it('conta por chave e recusa o que passa do teto na janela', () => {
    const j = new JanelaPorChave(3, 1000);
    expect([j.contar('a', 0), j.contar('a', 10), j.contar('a', 20), j.contar('a', 30)]).toEqual([true, true, true, false]);
    // outra chave tem a conta dela
    expect(j.contar('b', 30)).toBe(true);
    // a janela vira: a chave volta a caber
    expect(j.contar('a', 1000)).toBe(true);
  });

  it('o recusado não conta (a janela não se estende)', () => {
    const j = new JanelaPorChave(1, 1000);
    expect(j.contar('a', 0)).toBe(true);
    for (let t = 100; t < 1000; t += 100) expect(j.contar('a', t)).toBe(false);
    expect(j.contar('a', 1000)).toBe(true);
  });

  it('o mapa não cresce sem fim: as chaves vencidas saem quando ele enche', () => {
    const j = new JanelaPorChave(1, 1000, 100);
    for (let i = 0; i < 100; i++) j.contar(`velha-${i}`, 0);
    // todas vencidas em t = 2000: a chave nova entra e as velhas saem
    expect(j.contar('nova', 2000)).toBe(true);
    expect((j as any).contagem.size).toBe(1);
    // cheio de chaves ainda válidas: esvazia em vez de crescer
    for (let i = 0; i < 99; i++) j.contar(`viva-${i}`, 2000);
    expect(j.contar('mais-uma', 2000)).toBe(true);
    expect((j as any).contagem.size).toBeLessThanOrEqual(100);
  });
});
