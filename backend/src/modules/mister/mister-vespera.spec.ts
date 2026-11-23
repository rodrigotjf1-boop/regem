import { type DaVespera, type DiaDaAgenda, botoesDaVespera, lerBotaoDaVespera, linhaDeAmanha, oQueAvisar, textoDaVespera } from './mister-vespera';

// Versão 8, E3: o aviso da véspera e a linha "Amanhã". Texto fixo, sem IA, e só com o que vale avisar (V8-8, V8-9).
const fonte = (resumo: string, maxima: number, minima: number, chuva: boolean) => ({ resumo, maxima, minima, chuva });
const comChuva: DiaDaAgenda['previsao'] = { inmet: fonte('Chuva', 26, 20, true), cptec: fonte('Pancadas de chuva', 27, 20, true), chuva: 'as_duas_dao_chuva' };
const blackFriday = { tipo: 'Data comemorativa', nome: 'Black Friday' };
const dia = (o: Partial<DiaDaAgenda>): DiaDaAgenda => ({ rotulo: 'sexta, 27/11', eventos: [], previsao: null, ...o });

describe('o que vale avisar', () => {
  it('evento, jogo da cidade e chuva nas duas previsões', () => {
    expect(oQueAvisar('Centro', dia({ eventos: [blackFriday] }))).toMatchObject({ chuva: false, eventos: [blackFriday] });
    expect(oQueAvisar('Centro', dia({ previsao: comChuva }))).toMatchObject({ chuva: true, eventos: [] });
    expect(oQueAvisar('Centro', dia({ eventos: [{ tipo: 'Jogo', nome: 'A x B', hora: '20:00', alcance: 'cidade' }] }))).not.toBeNull();
  });
  it('dia comum, jogo só na TV ou previsões que discordam: fica calado', () => {
    expect(oQueAvisar('Centro', dia({}))).toBeNull();
    expect(oQueAvisar('Centro', null)).toBeNull();
    expect(oQueAvisar('Centro', dia({ eventos: [{ tipo: 'Jogo', nome: 'A x B', alcance: 'nacional' }] }))).toBeNull();
    for (const chuva of ['discordam', 'so_uma_fonte', 'as_duas_sem_chuva', 'sem_dado'] as const) {
      expect(oQueAvisar('Centro', dia({ previsao: { inmet: fonte('Pancadas isoladas', 30, 20, true), cptec: null, chuva } }))).toBeNull();
    }
  });
});

describe('o texto', () => {
  const v = (o: Partial<DaVespera> = {}): DaVespera => oQueAvisar('Centro', dia({ eventos: [blackFriday], previsao: comChuva }))! && { ...oQueAvisar('Centro', dia({ eventos: [blackFriday], previsao: comChuva }))!, ...o };

  it('o aviso como no protótipo: o dia, o que vem, as duas previsões e a sugestão', () => {
    expect(textoDaVespera([v()])).toBe(
      '*Amanhã, sexta, 27/11*\n\nBlack Friday. As duas previsões dão chuva.\nINMET: Chuva, 26° / 20°\nCPTEC: Pancadas de chuva, 27° / 20°\n\n*Minha sugestão:* Conferir embalagem de entrega e quantos entregadores você tem para a noite.',
    );
    expect(textoDaVespera([])).toBeNull();
  });

  it('a sugestão muda pelo que vem, e o que não está confirmado vem marcado', () => {
    const jogo = oQueAvisar('Centro', dia({ eventos: [{ tipo: 'Jogo', nome: 'A x B', hora: '20:00', alcance: 'cidade', aConfirmar: true }] }))!;
    expect(textoDaVespera([jogo])).toContain('A x B às 20:00 (a confirmar).');
    expect(textoDaVespera([jogo])).toContain('a equipe e o estoque para o horário do jogo');
    expect(textoDaVespera([oQueAvisar('Centro', dia({ eventos: [blackFriday] }))!])).toContain('o estoque e a equipe para o dia');
  });

  it('duas lojas com o mesmo dia saem juntas; com dias diferentes, um bloco por loja', () => {
    expect(textoDaVespera([v(), v({ loja: 'Sul' })])).not.toContain('*Sul*');
    const outra = oQueAvisar('Sul', dia({ eventos: [{ tipo: 'Da loja', nome: 'Show da casa' }] }))!;
    const t = textoDaVespera([v(), outra])!;
    expect(t).toContain('*Centro*');
    expect(t).toContain('*Sul*\nShow da casa.');
  });

  it('a linha "Amanhã" do resumo, com a máxima das duas fontes', () => {
    expect(linhaDeAmanha([v()])).toBe('*Amanhã:* Black Friday. As duas previsões dão chuva, máxima de 26° a 27°.');
    expect(linhaDeAmanha([oQueAvisar('Centro', dia({ eventos: [blackFriday] }))!])).toBe('*Amanhã:* Black Friday.');
    expect(linhaDeAmanha([])).toBeNull();
  });
});

describe('os botões', () => {
  const id = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
  it('cada botão se lê de volta e cabe no limite da Meta; o torto não', () => {
    const b = botoesDaVespera(id);
    expect(b.map((x) => lerBotaoDaVespera(x.id))).toEqual([
      { id, acao: 'estoque' },
      { id, acao: 'ok' },
    ]);
    for (const x of b) expect(x.titulo.length).toBeLessThanOrEqual(20);
    expect(lerBotaoDaVespera(`vs:${id}:outra`)).toBeNull();
    expect(lerBotaoDaVespera('vs:naoeuuid:ok')).toBeNull();
    expect(lerBotaoDaVespera(`lc:${id}:ok`)).toBeNull();
  });
});
