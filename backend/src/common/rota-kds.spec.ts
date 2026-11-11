import { chaveDaRota, conferirRota, rotaDaLoja, rotaPeloVaiPara, type KdsDaRota } from './rota-kds';

// A Rota da cozinha (auditoria do KDS de 11/11/2026, onda 2 — mig 410): a ordem pelo "vai para", a salva e a conferência.
const k = (id: string, o: Partial<KdsDaRota> = {}): KdsDaRota => ({ id, escopo: 'producao', ativo: true, proximoKdsId: null, ...o });
const NOMES: Record<string, string> = { chapa: 'Chapa', frita: 'Fritadeira', mont: 'Montagem', desp: 'Despacho', bar: 'Bar', off: 'Desligado' };
const nome = (id: string) => NOMES[id] ?? id;

describe('Rota da cozinha', () => {
  const lanchonete = [
    k('chapa', { proximoKdsId: 'mont' }),
    k('frita', { proximoKdsId: 'mont' }),
    k('mont', { proximoKdsId: 'desp' }),
    k('desp', { escopo: 'despacho' }),
    k('bar'), // ninguém manda, não manda a ninguém
    k('off', { ativo: false, proximoKdsId: 'mont' }),
  ];

  it('pelo "vai para": a maior distância desde o começo; o paralelo junto; o despacho no fim; o desligado fora', () => {
    expect(rotaPeloVaiPara(lanchonete)).toEqual([
      { nome: '', kds: ['chapa', 'frita', 'bar'] },
      { nome: '', kds: ['mont'] },
      { nome: '', kds: ['desp'] },
    ]);
    // Um KDS só (o caso mais comum): uma etapa.
    expect(rotaPeloVaiPara([k('coz')])).toEqual([{ nome: '', kds: ['coz'] }]);
    // Só o despacho e uma estação sem "vai para": o despacho ainda fica depois.
    expect(rotaPeloVaiPara([k('coz'), k('desp', { escopo: 'despacho' })])).toEqual([{ nome: '', kds: ['coz'] }, { nome: '', kds: ['desp'] }]);
    // Círculo antigo (A → B → A) não trava: cada um entra uma vez.
    const circulo = rotaPeloVaiPara([k('a', { proximoKdsId: 'b' }), k('b', { proximoKdsId: 'a' })]);
    expect(circulo.flatMap((e) => e.kds).sort()).toEqual(['a', 'b']);
    expect(rotaPeloVaiPara([])).toEqual([]);
  });

  it('a salva vale, limpa: sem KDS que sumiu, sem repetir, sem etapa vazia; nada sobrando = pelo "vai para"', () => {
    const salva = [
      { nome: '  Chapa e fritura  ', kds: ['chapa', 'frita', 'sumiu'] },
      { nome: '', kds: ['sumiu2'] },
      { nome: 'Montagem', kds: ['mont', 'chapa'] },
      { nome: 'x'.repeat(60), kds: ['desp', 'off'] },
    ];
    expect(rotaDaLoja(salva, lanchonete)).toEqual([
      { nome: 'Chapa e fritura', kds: ['chapa', 'frita'] },
      { nome: 'Montagem', kds: ['mont'] },
      { nome: 'x'.repeat(40), kds: ['desp', 'off'] }, // o desligado aparece onde a loja o pôs (pulado na corrente)
    ]);
    expect(rotaDaLoja(null, lanchonete)).toEqual(rotaPeloVaiPara(lanchonete));
    expect(rotaDaLoja([{ nome: 'Velha', kds: ['sumiu'] }], lanchonete)).toEqual(rotaPeloVaiPara(lanchonete));
    expect(rotaDaLoja('lixo', lanchonete)).toEqual(rotaPeloVaiPara(lanchonete));
    // A chave da loja na linha da empresa; empresa sem loja, "empresa".
    expect(chaveDaRota('u1')).toBe('u1');
    expect(chaveDaRota(null)).toBe('empresa');
  });

  it('conferir: a rota boa passa, com o "vai para" de cada KDS (o que não veio termina)', () => {
    const etapas = [{ nome: 'Chapa', kds: ['chapa', 'frita'] }, { nome: '', kds: ['mont'] }, { nome: 'Saída', kds: ['desp'] }];
    const r = conferirRota(etapas, { chapa: 'mont', frita: 'desp', mont: 'desp' }, lanchonete, nome);
    expect(r.motivos).toEqual([]);
    // O desligado fora da rota (off → mont) não é mexido: a tela não o mostra; o ligado fora da rota (bar) termina.
    expect(r.vai).toMatchObject({ chapa: 'mont', frita: 'desp', mont: 'desp', desp: null, bar: null, off: 'mont' });
    expect(r.etapas).toEqual(etapas);
    expect(conferirRota(etapas, { chapa: 'mont', off: 'chapa' }, lanchonete, nome).vai.off).toBe('mont');
  });

  it('conferir: recusa com o motivo — despacho fora do fim, "vai para" para trás ou na mesma etapa, fora da rota, círculo', () => {
    const motivos = (etapas: any, vai: any) => conferirRota(etapas, vai, lanchonete, nome).motivos.join(' | ');
    expect(motivos([{ nome: '', kds: ['desp'] }, { nome: '', kds: ['chapa'] }], {})).toMatch(/Despacho é o despacho e só pode ficar na última etapa/);
    expect(motivos([{ nome: '', kds: ['chapa'] }, { nome: '', kds: ['mont'] }], { mont: 'chapa' })).toMatch(/Montagem só pode mandar o pedido para um KDS de uma etapa depois/);
    expect(motivos([{ nome: '', kds: ['chapa', 'frita'] }], { chapa: 'frita' })).toMatch(/etapa depois da dele/); // mesma etapa
    expect(motivos([{ nome: '', kds: ['chapa'] }], { bar: 'chapa' })).toMatch(/Bar está fora da rota/);
    expect(motivos([{ nome: '', kds: ['chapa'] }, { nome: '', kds: ['desp'] }], { desp: 'chapa' })).toMatch(/despacho: ele não manda/);
    expect(motivos([{ nome: '', kds: ['chapa'] }], { chapa: 'outro' })).toMatch(/não é um KDS desta loja/);
    expect(motivos([{ nome: '', kds: ['chapa'] }, { nome: '', kds: ['chapa'] }], {})).toMatch(/Chapa está em duas etapas/);
    expect(motivos([{ nome: '', kds: ['outro'] }], {})).toMatch(/não é desta loja ou foi excluído/);
    expect(motivos([], {})).toMatch(/pelo menos um KDS/);
    expect(motivos([{ nome: '', kds: [] }], {})).toMatch(/etapa 1 está vazia/);
    expect(motivos([{ nome: 'x'.repeat(41), kds: ['chapa'] }], {})).toMatch(/passa de 40 letras/);
    expect(motivos(Array.from({ length: 13 }, (_, i) => ({ nome: '', kds: [`k${i}`] })), {})).toMatch(/no máximo 12 etapas/);
    expect(motivos('lixo', {})).toMatch(/pelo menos um KDS/);
  });
});
