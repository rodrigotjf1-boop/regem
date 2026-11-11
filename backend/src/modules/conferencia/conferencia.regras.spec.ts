import { comparar, leituraDa99, leituraDoIfood, normalizar, pendentes, precisaLer, precosParaUsar, type DoApp, type DoRegem } from './conferencia.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "Conferir com os apps" (R3 F4a): as regras puras — a leitura de cada app no formato do Regem, as situações da comparação
// pelo código PDV (protótipo `mockups/regem-conciliacao-ifood.html`), o "usar o preço do app" e quando ler.

// A saída do Orzuni como o contrato diz (`Orzuni/docs/porta-mcp.md`, "Saída das leituras") e o código dele monta
// (`catalogo.service.ts`: `cardapio` e `complementos`).
const CARDAPIO_IFOOD = {
  itens: [
    { pdv: '2051', nome: 'X-Bacon', descricao: '', categoria: 'Burgers', preco: 39.9, promo: null, status: 'no_ar', imagem: null, ordem: 0 },
    { pdv: '2060', nome: 'Smash Duplo', descricao: '', categoria: 'Burgers', preco: 44.9, promo: { de: 49.9 }, status: 'pausado', imagem: null, ordem: 1 },
    { pdv: '', nome: 'Molho especial extra', descricao: '', categoria: 'Adicionais', preco: 3, promo: null, status: 'no_ar', imagem: null, ordem: 2 },
  ],
};
const COMPLEMENTOS_IFOOD = {
  grupos: [
    {
      id: 'g1',
      nome: 'Adicionais',
      tipo: 'INGREDIENTES',
      min: 0,
      max: 3,
      ordem: 0,
      opcoes: [
        { id: 'o1', nome: 'Bacon extra', preco: 6, status: 'AVAILABLE', pdv: 'A01', imagem: null, ordem: 0 },
        { id: 'o2', nome: 'Ao ponto', preco: 0, status: 'AVAILABLE', pdv: '', imagem: null, ordem: 1 },
      ],
      itens: [{ nome: 'X-Bacon', pdv: '2051' }],
    },
    {
      id: 'g2',
      nome: 'Adicionais do Smash',
      tipo: 'INGREDIENTES',
      min: 0,
      max: 3,
      ordem: 1,
      opcoes: [{ id: 'o3', nome: 'Bacon  Extra', preco: 6.5, status: 'UNAVAILABLE', pdv: 'A01', imagem: null, ordem: 0 }],
      itens: [],
    },
  ],
};

// O `data` da 99 como a doc 1961 mostra (`GET /v3/item/item/list`): preços em centavos, status 1/2.
const CARDAPIO_99 = {
  menus: [{ app_menu_id: 'regem-menu', menu_name: 'Cardápio', app_category_ids: ['cat-1'] }],
  categories: [{ app_category_id: 'cat-1', category_name: 'Burgers', app_item_ids: ['2051', 'b5c2a9e0-0000-4000-8000-000000000001'] }],
  items: [
    { app_item_id: '2051', item_name: 'X-Bacon', price: 4490, status: 1, is_sold_separately: true },
    { app_item_id: 'b5c2a9e0-0000-4000-8000-000000000001', item_name: 'Sem código', price: 2000, status: 2, is_sold_separately: true },
    { app_item_id: 'A01', item_name: 'Bacon extra', price: 600, status: 1, is_sold_separately: false },
    { app_item_id: 'COCA', item_name: 'Coca lata', price: 700, status: 1, is_sold_separately: true },
    { app_item_id: 'SOLTO', item_name: 'Fora de grupo', price: 100, status: 1, is_sold_separately: false },
  ],
  modifier_groups: [
    { app_modifier_group_id: 'mg1', modifier_group_name: 'Adicionais', app_mg_items: [{ app_item_id: 'A01', price: 600 }] },
    { app_modifier_group_id: 'mg2', modifier_group_name: 'Bebida do combo', app_mg_items: [{ app_item_id: 'A01', price: 650 }, { app_item_id: 'COCA', price: 0 }] },
  ],
};

const regem = (o: Partial<DoRegem> & { id: string; nome: string }): DoRegem => ({ codigo: null, preco: null, marcado: false, ativo: true, ...o });
const app = (o: Partial<DoApp> & { id: string; nome: string }): DoApp => ({ pdv: null, grupos: [], precos: [], promoDe: null, pausado: false, ...o });

describe('a leitura de cada app no formato do Regem', () => {
  it('iFood: itens com a categoria, o "de" da promoção e a pausa; a mesma opção (código e nome) em dois grupos vira uma', () => {
    const l = leituraDoIfood(CARDAPIO_IFOOD, COMPLEMENTOS_IFOOD)!;
    expect(l.itens).toEqual([
      { id: 'i0', pdv: '2051', nome: 'X-Bacon', grupos: ['Burgers'], precos: [39.9], promoDe: null, pausado: false, imagem: null },
      { id: 'i1', pdv: '2060', nome: 'Smash Duplo', grupos: ['Burgers'], precos: [44.9], promoDe: 49.9, pausado: true, imagem: null },
      { id: 'i2', pdv: null, nome: 'Molho especial extra', grupos: ['Adicionais'], precos: [3], promoDe: null, pausado: false, imagem: null },
    ]);
    // "Bacon  Extra" (espaço e caixa diferentes) é a mesma opção; o preço de cada grupo fica.
    expect(l.opcoes).toEqual([
      { id: 'o1', pdv: 'A01', nome: 'Bacon extra', grupos: ['Adicionais', 'Adicionais do Smash'], precos: [6, 6.5], promoDe: null, pausado: true, imagem: null },
      { id: 'o2', pdv: null, nome: 'Ao ponto', grupos: ['Adicionais'], precos: [0], promoDe: null, pausado: false, imagem: null },
    ]);
  });
  it('iFood: sem a lista em qualquer das duas respostas = falha da leitura', () => {
    expect(leituraDoIfood({}, COMPLEMENTOS_IFOOD)).toBeNull();
    expect(leituraDoIfood(CARDAPIO_IFOOD, { grupos: 'x' })).toBeNull();
    expect(leituraDoIfood({ itens: [] }, { grupos: [] })).toEqual({ itens: [], opcoes: [] });
  });
  it('99: centavos em reais, a categoria pelo `categories`, 2 = pausado; o complemento vira opção com o preço de cada grupo', () => {
    const l = leituraDa99(CARDAPIO_99)!;
    expect(l.itens).toEqual([
      { id: '2051', pdv: '2051', nome: 'X-Bacon', grupos: ['Burgers'], precos: [44.9], promoDe: null, pausado: false, imagem: null },
      { id: 'b5c2a9e0-0000-4000-8000-000000000001', pdv: 'b5c2a9e0-0000-4000-8000-000000000001', nome: 'Sem código', grupos: ['Burgers'], precos: [20], promoDe: null, pausado: true, imagem: null },
      { id: 'COCA', pdv: 'COCA', nome: 'Coca lata', grupos: [], precos: [7], promoDe: null, pausado: false, imagem: null },
    ]);
    // A Coca se vende sozinha E está num grupo: aparece nas duas listas (no Regem, produto e opção); o item que não se vende
    // sozinho e não está em grupo fica nas opções sem grupo.
    expect(l.opcoes).toEqual([
      { id: 'A01', pdv: 'A01', nome: 'Bacon extra', grupos: ['Adicionais', 'Bebida do combo'], precos: [6, 6.5], promoDe: null, pausado: false, imagem: null },
      { id: 'COCA', pdv: 'COCA', nome: 'Coca lata', grupos: ['Bebida do combo'], precos: [0], promoDe: null, pausado: false, imagem: null },
      { id: 'SOLTO', pdv: 'SOLTO', nome: 'Fora de grupo', grupos: [], precos: [1], promoDe: null, pausado: false, imagem: null },
    ]);
    expect(leituraDa99({ items: 'x' })).toBeNull();
    expect(leituraDa99(null)).toBeNull();
  });
  it('normalizar: sem acento, sem caixa, espaços juntados', () => {
    expect(normalizar('  Pão  de Açúcar ')).toBe('pao de acucar');
  });
  it('a foto de cada app (F6): `imagem` no Orzuni, `head_img` na 99; só endereço http(s); a opção leva a 1ª foto dos grupos', () => {
    const ifood = leituraDoIfood(
      { itens: [{ pdv: '1', nome: 'A', imagem: 'https://static.ifood.com/a.jpg' }, { pdv: '2', nome: 'B', imagem: 'pratos/b.jpg' }] },
      { grupos: [{ nome: 'G1', opcoes: [{ id: 'o1', pdv: 'X', nome: 'Op', imagem: null }] }, { nome: 'G2', opcoes: [{ id: 'o2', pdv: 'X', nome: 'Op', imagem: 'https://static.ifood.com/x.jpg' }] }] },
    )!;
    expect(ifood.itens.map((i) => i.imagem)).toEqual(['https://static.ifood.com/a.jpg', null]);
    expect(ifood.opcoes[0].imagem).toBe('https://static.ifood.com/x.jpg');
    expect(leituraDa99({ items: [{ app_item_id: '1', item_name: 'A', price: 100, status: 1, head_img: 'https://img.99app.com/a.png' }] })!.itens[0].imagem).toBe('https://img.99app.com/a.png');
    // A linha leva a foto do app; a leitura de antes da F6 (sem o campo) não diz nada.
    const linhas = comparar({ canal: 'ifood', tipo: 'item', doApp: [app({ id: 'i', pdv: '1', nome: 'A', precos: [1], imagem: null }), app({ id: 'j', pdv: '2', nome: 'B', precos: [1] })], doRegem: [], ignorados: new Set() });
    expect(linhas.map((l) => ('imagem' in l ? l.imagem : 'ausente'))).toEqual([null, 'ausente']);
  });
});

describe('comparar pelo código PDV', () => {
  const ign = new Set<string>();
  it('as situações dos itens, na ordem do protótipo (não liga > só no app > só no Regem > preço > igual > ignorada)', () => {
    const linhas = comparar({
      canal: 'ifood',
      tipo: 'item',
      doApp: [
        app({ id: 'i0', pdv: '2051', nome: 'X-Bacon', grupos: ['Burgers'], precos: [39.9] }),
        app({ id: 'i1', pdv: '2052', nome: 'X-Salada', grupos: ['Burgers'], precos: [29.9] }),
        app({ id: 'i2', pdv: '2053', nome: 'X-Tudo', grupos: ['Burgers'], precos: [49.9] }),
        app({ id: 'i3', pdv: '3000', nome: 'Combo do app', grupos: ['Combos'], precos: [59.9] }),
        app({ id: 'i4', pdv: null, nome: 'Molho extra', grupos: ['Adicionais'], precos: [3] }),
        app({ id: 'i5', pdv: '2060', nome: 'Smash Duplo', grupos: ['Burgers'], precos: [44.9] }),
        app({ id: 'i6', pdv: '2060', nome: 'Smash Duplo Cheddar', grupos: ['Burgers'], precos: [47.9] }),
        app({ id: 'i7', pdv: '2070', nome: 'Wrap', grupos: ['Burgers'], precos: [25] }),
      ],
      doRegem: [
        regem({ id: 'p1', nome: 'X-Bacon', codigo: '2051', preco: 39.9, marcado: true }),
        regem({ id: 'p2', nome: 'X-Salada', codigo: '2052', preco: 32.9, marcado: true }),
        regem({ id: 'p3', nome: 'X-Tudo', codigo: ' 2053 ', preco: null, marcado: true }),
        regem({ id: 'p4', nome: 'Wrap', codigo: '2070', preco: 25 }),
        regem({ id: 'p5', nome: 'Wrap (cópia)', codigo: '2070', preco: 25 }),
        regem({ id: 'p6', nome: 'Hot dog', codigo: '2080', preco: 19.9, marcado: true }),
        regem({ id: 'p7', nome: 'Sem código no Regem', codigo: null, marcado: true }),
        regem({ id: 'p8', nome: 'Inativo marcado', codigo: '2090', marcado: true, ativo: false }),
        regem({ id: 'p9', nome: 'Fora do iFood', codigo: '2091', marcado: false }),
      ],
      ignorados: ign,
    });
    const por = (nome: string) => linhas.find((l) => l.nome === nome)!;
    expect(por('X-Bacon')).toMatchObject({ situacao: 'igual', motivo: null, chave: 'pdv:2051', regem: { id: 'p1', preco: 39.9 } });
    expect(por('X-Salada')).toMatchObject({ situacao: 'preco', motivo: 'precoDiferente', precos: [29.9], regem: { preco: 32.9 } });
    expect(por('X-Tudo')).toMatchObject({ situacao: 'preco', motivo: 'semPrecoNoRegem', regem: { id: 'p3', preco: null } });
    expect(por('Combo do app')).toMatchObject({ situacao: 'soApp', regem: null, chave: 'pdv:3000' });
    expect(por('Molho extra')).toMatchObject({ situacao: 'naoLiga', motivo: 'semCodigo', chave: 'nome:molho extra' });
    expect(por('Smash Duplo')).toMatchObject({ situacao: 'naoLiga', motivo: 'repetidoNoApp', outros: ['Smash Duplo Cheddar'], chave: 'pdv:2060|smash duplo' });
    expect(por('Smash Duplo Cheddar')).toMatchObject({ situacao: 'naoLiga', outros: ['Smash Duplo'] });
    expect(por('Wrap')).toMatchObject({ situacao: 'naoLiga', motivo: 'repetidoNoRegem', outros: ['Wrap', 'Wrap (cópia)'], regem: null });
    // Só no Regem: marcado "Está no iFood", ativo e que o app não tem; sem código no Regem, o motivo diz isso.
    expect(por('Hot dog')).toMatchObject({ situacao: 'soRegem', chave: 'regem:p6', pdv: '2080', pausado: null, precos: [] });
    expect(por('Sem código no Regem')).toMatchObject({ situacao: 'soRegem', motivo: 'semCodigoNoRegem' });
    expect(linhas.find((l) => l.nome === 'Inativo marcado')).toBeUndefined();
    expect(linhas.find((l) => l.nome === 'Fora do iFood')).toBeUndefined();
    expect(linhas.map((l) => l.situacao)).toEqual(['naoLiga', 'naoLiga', 'naoLiga', 'naoLiga', 'soApp', 'soRegem', 'soRegem', 'preco', 'preco', 'igual']);
    expect(pendentes(linhas)).toBe(9);
  });
  it('preço igual em centavos (29.9 = 29.90); o "Ignorar" vale pela chave e sai das pendências', () => {
    const doApp = [app({ id: 'i0', pdv: '1', nome: 'A', precos: [29.9] }), app({ id: 'i1', pdv: '2', nome: 'B', precos: [10] })];
    const doRegem = [regem({ id: 'p1', nome: 'A', codigo: '1', preco: 29.900000001 }), regem({ id: 'p2', nome: 'B', codigo: '2', preco: 11 })];
    const l1 = comparar({ canal: 'ifood', tipo: 'item', doApp, doRegem, ignorados: ign });
    expect(l1.map((l) => [l.nome, l.situacao])).toEqual([['B', 'preco'], ['A', 'igual']]);
    const l2 = comparar({ canal: 'ifood', tipo: 'item', doApp, doRegem, ignorados: new Set(['pdv:2']) });
    expect(l2.find((l) => l.nome === 'B')).toMatchObject({ situacao: 'ignorada', motivo: 'precoDiferente' });
    expect(pendentes(l2)).toBe(0);
  });
  it('99: o item exportado sem código liga pelo id do produto; o código vence o id', () => {
    const linhas = comparar({
      canal: '99food',
      tipo: 'item',
      doApp: [app({ id: 'p1', pdv: 'p1', nome: 'Pelo id', precos: [20] }), app({ id: '77', pdv: '77', nome: 'Pelo código', precos: [5] })],
      doRegem: [regem({ id: 'p1', nome: 'Pelo id', preco: 20, marcado: true }), regem({ id: '77x', nome: 'Pelo código', codigo: '77', preco: 5, marcado: true })],
      ignorados: ign,
    });
    expect(linhas.find((l) => l.nome === 'Pelo id')).toMatchObject({ situacao: 'igual', ligaPeloId: true, regem: { id: 'p1' } });
    expect(linhas.find((l) => l.nome === 'Pelo código')).toMatchObject({ situacao: 'igual', ligaPeloId: false });
    // No iFood não há liga pelo id: o mesmo item seria "só no app".
    const ifood = comparar({ canal: 'ifood', tipo: 'item', doApp: [app({ id: 'p1', pdv: 'p1', nome: 'Pelo id', precos: [20] })], doRegem: [regem({ id: 'p1', nome: 'Pelo id', preco: 20 })], ignorados: ign });
    expect(ifood[0]).toMatchObject({ situacao: 'soApp', ligaPeloId: false });
  });
  it('opções: preços diferentes nos grupos; sem código = chave pelo id do app; nunca "só no Regem"', () => {
    const linhas = comparar({
      canal: '99food',
      tipo: 'opcao',
      doApp: [app({ id: 'A01', pdv: 'A01', nome: 'Bacon extra', grupos: ['G1', 'G2'], precos: [6, 6.5, 6] }), app({ id: 'o9', pdv: null, nome: 'Ao ponto', precos: [0] })],
      doRegem: [regem({ id: 'op1', nome: 'Bacon extra', codigo: 'A01', preco: 6 }), regem({ id: 'op2', nome: 'Cheddar', codigo: 'C01', preco: 4 })],
      ignorados: ign,
    });
    expect(linhas).toHaveLength(2);
    expect(linhas.find((l) => l.nome === 'Bacon extra')).toMatchObject({ situacao: 'preco', motivo: 'precosDiferentesNosGrupos', precos: [6, 6.5] });
    expect(linhas.find((l) => l.nome === 'Ao ponto')).toMatchObject({ situacao: 'naoLiga', motivo: 'semCodigo', chave: 'app:o9' });
  });
});

describe('as ações', () => {
  const linhas = comparar({
    canal: 'ifood',
    tipo: 'item',
    doApp: [
      app({ id: 'i0', pdv: '1', nome: 'A', precos: [29.9] }),
      app({ id: 'i1', pdv: '2', nome: 'B', precos: [10] }),
      app({ id: 'i2', pdv: '3', nome: 'C', precos: [12] }),
      app({ id: 'i3', pdv: '4', nome: 'D', precos: [5, 6] }),
    ],
    doRegem: [
      regem({ id: 'p1', nome: 'A no Regem', codigo: '1', preco: 32.9 }),
      regem({ id: 'p2', nome: 'B', codigo: '2', preco: 10 }),
      regem({ id: 'p3', nome: 'C', codigo: '3', preco: null }),
      regem({ id: 'p4', nome: 'D', codigo: '4', preco: 5.5 }),
    ],
    ignorados: new Set(),
  });
  it('"usar o preço do app": só preço diferente (ou em branco) com UM preço no app; o resto volta com o motivo', () => {
    const r = precosParaUsar(linhas, ['pdv:1', 'pdv:3', 'pdv:2', 'pdv:4', 'pdv:9', 'pdv:1']);
    expect(r.usar).toEqual([
      { chave: 'pdv:1', regemId: 'p1', nome: 'A no Regem', de: 32.9, para: 29.9 },
      { chave: 'pdv:3', regemId: 'p3', nome: 'C', de: null, para: 12 },
    ]);
    expect(r.recusas.map((x) => x.chave)).toEqual(['pdv:2', 'pdv:4', 'pdv:9']);
    expect(r.recusas[1].motivo).toMatch(/preços diferentes nos grupos/);
    expect(r.recusas[2].motivo).toMatch(/leia de novo/);
  });
  it('quando ler: o botão sempre (menos segundos depois de ler); sozinha, 1 vez por dia e não logo depois de um erro', () => {
    const agora = new Date('2026-11-11T15:00:00Z');
    const ha = (ms: number) => new Date(agora.getTime() - ms);
    expect(precisaLer({ pediu: true, lidoEm: null, erroEm: null, agora })).toBe(true);
    expect(precisaLer({ pediu: true, lidoEm: ha(10_000), erroEm: null, agora })).toBe(false);
    expect(precisaLer({ pediu: true, lidoEm: ha(31_000), erroEm: ha(1_000), agora })).toBe(true);
    expect(precisaLer({ pediu: false, lidoEm: null, erroEm: null, agora })).toBe(true);
    expect(precisaLer({ pediu: false, lidoEm: ha(23 * 3_600_000), erroEm: null, agora })).toBe(false);
    expect(precisaLer({ pediu: false, lidoEm: ha(24 * 3_600_000), erroEm: null, agora })).toBe(true);
    expect(precisaLer({ pediu: false, lidoEm: null, erroEm: ha(5 * 60_000), agora })).toBe(false);
    expect(precisaLer({ pediu: false, lidoEm: null, erroEm: ha(16 * 60_000), agora })).toBe(true);
  });
});
