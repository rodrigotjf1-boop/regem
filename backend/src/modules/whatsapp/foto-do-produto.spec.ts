import {
  escolherProduto,
  esquecerFotosConferidas,
  fotoServe,
  legendaDoProduto,
  linkComProduto,
  pedeFoto,
  produtoCitado,
  produtoDoLink,
} from './foto-do-produto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A FOTO NO LINK DO PRODUTO (F5 — decisão do dono, 31/10/2026: "sempre que falar de 1 produto"). A foto é um endereço que
// a loja cadastrou: só vai se for pública, JPEG/PNG e até 5 MB — senão a mensagem vai sem a foto.
const ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const LINK = `https://app.dmsregem.com/c/tk-abc?produto=${ID}`;
const FOTO = 'https://storage.googleapis.com/loja/trio-07.jpg';
const resposta = (status: number, h: Record<string, string>) =>
  ({ status, headers: { get: (k: string) => h[k.toLowerCase()] ?? null }, body: { cancel: async () => undefined } }) as any;

describe('foto do produto no link do robô', () => {
  beforeEach(() => esquecerFotosConferidas());

  it('o id do produto sai do link direto; link do cardápio todo ou id estranho, não', () => {
    expect(produtoDoLink(LINK)).toBe(ID);
    expect(produtoDoLink('https://app.dmsregem.com/c/tk-abc')).toBeNull();
    expect(produtoDoLink('https://app.dmsregem.com/c/tk-abc?produto=1%27or%271')).toBeNull();
    expect(produtoDoLink('não é link')).toBeNull();
  });

  it('serve: JPEG/PNG até 5 MB (pelo tamanho total do Content-Range); lembra a conferência', async () => {
    let chamadas = 0;
    const buscar: any = async () => {
      chamadas++;
      return resposta(206, { 'content-type': 'image/jpeg', 'content-range': 'bytes 0-0/180000' });
    };
    expect(await fotoServe(FOTO, buscar)).toBe(true);
    expect(await fotoServe(FOTO, buscar)).toBe(true);
    expect(chamadas).toBe(1);
  });

  it('não serve: grande demais, WEBP, fora do ar ou endereço bloqueado (null do guarda) — a mensagem vai sem foto', async () => {
    expect(await fotoServe('https://x/a.jpg', (async () => resposta(206, { 'content-type': 'image/jpeg', 'content-range': 'bytes 0-0/9000000' })) as any)).toBe(false);
    expect(await fotoServe('https://x/b.webp', (async () => resposta(200, { 'content-type': 'image/webp', 'content-length': '1000' })) as any)).toBe(false);
    expect(await fotoServe('https://x/c.jpg', (async () => resposta(404, {})) as any)).toBe(false);
    expect(await fotoServe('https://x/d.jpg', (async () => null) as any)).toBe(false);
    expect(await fotoServe('https://x/e.jpg', (async () => { throw new Error('timeout'); }) as any)).toBe(false);
  });

});

// O PRODUTO CERTO NA FOTO (2º teste do dono, 31/10/2026 — ERR-335): "Tem foto do trio 07?" saiu com o link e a foto do
// lanche "Numero 07"; "Tem foto do trio 08?" saiu com um id inventado pela IA, sem foto. O Regem confere o produto.
describe('qual produto vai na foto (o Regem confere o link da IA)', () => {
  const P = (id: string, nome: string, imagem: string | null = null) => ({ id, nome, imagem });
  const PRODUTOS = [
    P('11111111-1111-4111-8111-111111111107', 'Numero 07', 'https://x/n07.png'),
    P('22222222-2222-4222-8222-2222222207aa', 'TRIO 07', 'https://x/t07.jpg'),
    P('22222222-2222-4222-8222-2222222207bb', 'TRIO 07', 'https://x/t07.jpg'),
    P('33333333-3333-4333-8333-333333333308', 'TRIO 08', 'https://x/t08.jpg'),
    P('44444444-4444-4444-8444-444444444401', 'TRIO 01'),
    P('44444444-4444-4444-8444-444444444410', 'TRIO 10'),
    P('55555555-5555-4555-8555-5555555555xb', 'X-Bacon'),
    P('55555555-5555-4555-8555-555555555txb', 'TRIO X-BACON'),
    P('66666666-6666-4666-8666-666666666666', 'Água'),
    P('77777777-7777-4777-8777-777777777777', 'Coca cola lata'),
  ];
  const [N07, T07A, T07B, T08] = PRODUTOS;
  const INVENTADO = 'deadbeef-0000-4000-8000-000000000000'; // um id que a loja não tem (a IA inventou um assim no teste)

  it('o produto citado PELO NOME: o trio não é o lanche; as duas cópias vêm juntas; "x bacon" = "X-Bacon"', () => {
    expect(produtoCitado('Tem foto do trio 07?', PRODUTOS)).toEqual({ nome: 'TRIO 07', ids: [T07A.id, T07B.id] });
    expect(produtoCitado('e o numero 7?', PRODUTOS)?.ids).toEqual([N07.id]);
    expect(produtoCitado('manda a foto do x bacon', PRODUTOS)?.nome).toBe('X-Bacon');
    // O nome maior que contém o menor é um só produto.
    expect(produtoCitado('foto do trio x-bacon', PRODUTOS)?.nome).toBe('TRIO X-BACON');
    // "trio 1" não é o "TRIO 10"; "aguardando" não é "Água" (palavra inteira).
    expect(produtoCitado('foto do trio 1', PRODUTOS)?.nome).toBe('TRIO 01');
    expect(produtoCitado('estou aguardando a foto', PRODUTOS)).toBeNull();
    // Dois produtos diferentes: não dá para saber de qual.
    expect(produtoCitado('foto do trio 07 e da coca cola lata', PRODUTOS)).toBeNull();
    expect(produtoCitado('', PRODUTOS)).toBeNull();
  });

  it('pediu para VER: foto, imagem, "me mostra"', () => {
    for (const t of ['Tem foto do trio 07?', 'manda umas fotos', 'tem imagem?', 'me mostra o x-bacon']) expect(pedeFoto(t)).toBe(true);
    for (const t of ['quanto custa o trio 07?', 'quero o trio 07', 'Pode registrar']) expect(pedeFoto(t)).toBe(false);
  });

  it('o caso do teste: pediu a foto do TRIO 07 e a IA mandou o link do lanche → vai o trio, com a legenda do Regem', () => {
    const e = escolherProduto({
      idDoLink: N07.id,
      produtos: PRODUTOS,
      pergunta: 'Tem foto do trio 07?',
      resposta: 'Dá uma olhada na foto e nos detalhes do Número 07 no cardápio',
    });
    expect(e).toEqual({ ids: [T07A.id, T07B.id], nome: 'TRIO 07', motivo: 'foto_pedida', trocou: true, legenda: true });
  });

  it('o caso do teste: pediu a foto do TRIO 08 e a IA inventou o link → vai o TRIO 08', () => {
    const e = escolherProduto({
      idDoLink: INVENTADO,
      produtos: PRODUTOS,
      pergunta: 'Tem foto do trio 08?',
      resposta: 'Dá uma olhada na foto e nos detalhes do Número 08 no cardápio',
    });
    expect(e).toMatchObject({ ids: [T08.id], nome: 'TRIO 08', motivo: 'foto_pedida', trocou: true, legenda: true });
  });

  it('a IA acertou (o produto pedido, qualquer das cópias): o link e o texto dela ficam', () => {
    const e = escolherProduto({ idDoLink: T07B.id, produtos: PRODUTOS, pergunta: 'tem foto do trio 07?', resposta: 'Olha o Trio 07' });
    expect(e).toEqual({ ids: [T07B.id], nome: 'TRIO 07', motivo: 'link_do_robo', trocou: false, legenda: false });
  });

  it('sem pedido de foto, o link da IA que existe vale (ela pode indicar OUTRO produto)', () => {
    const e = escolherProduto({ idDoLink: T08.id, produtos: PRODUTOS, pergunta: 'o trio 07 acabou? me indica outro', resposta: 'Tem o Trio 08' });
    expect(e).toMatchObject({ ids: [T08.id], motivo: 'link_do_robo', trocou: false });
  });

  it('link inventado: o produto citado na resposta; senão o da pergunta; senão o cardápio (sem produto)', () => {
    const base = { idDoLink: INVENTADO, produtos: PRODUTOS };
    expect(escolherProduto({ ...base, pergunta: 'e o lanche com bacon?', resposta: 'O X-Bacon sai por R$ 26,00' })).toMatchObject({
      ids: [PRODUTOS[6].id],
      motivo: 'citado_na_resposta',
      trocou: true,
      legenda: false,
    });
    expect(escolherProduto({ ...base, pergunta: 'quanto é o trio 08?', resposta: 'Sai por R$ 32,50' })).toMatchObject({
      ids: [T08.id],
      motivo: 'citado_na_pergunta',
      legenda: false,
    });
    expect(escolherProduto({ ...base, pergunta: null, resposta: 'Olha que delícia' })).toEqual({
      ids: [],
      nome: null,
      motivo: 'sem_produto',
      trocou: true,
      legenda: true,
    });
  });

  it('a IA mandou o link do cardápio TODO: só muda se o cliente pediu a foto de um produto pelo nome', () => {
    const base = { idDoLink: null, produtos: PRODUTOS, resposta: 'Dá uma olhada no cardápio', linkDeProduto: false };
    expect(escolherProduto({ ...base, pergunta: 'tem foto do trio 07?' })).toMatchObject({ ids: [T07A.id, T07B.id], motivo: 'foto_pedida', legenda: true });
    expect(escolherProduto({ ...base, pergunta: 'quero pedir o trio 07' })).toMatchObject({ ids: [], motivo: 'link_do_cardapio', trocou: false });
    expect(escolherProduto({ ...base, pergunta: 'tem foto?' })).toMatchObject({ ids: [], motivo: 'link_do_cardapio', trocou: false });
  });

  it('o link do produto conferido: o da IA com o produto trocado (fica o "u=" do link personalizado); de outro lugar, o da loja', () => {
    const LOJA = 'https://app.dmsregem.com/c/tok1';
    expect(linkComProduto(`${LOJA}?u=ab12`, LOJA, T07A.id)).toBe(`${LOJA}?u=ab12&produto=${T07A.id}`);
    expect(linkComProduto(`${LOJA}?produto=${N07.id}`, LOJA, T07A.id)).toBe(`${LOJA}?produto=${T07A.id}`);
    expect(linkComProduto(`https://app.dmsregem.com/c/OUTRA?u=x`, LOJA, T07A.id)).toBe(`${LOJA}?produto=${T07A.id}`);
    expect(linkComProduto('não é link', LOJA, T07A.id)).toBe(`${LOJA}?produto=${T07A.id}`);
  });

  it('sem os produtos da loja (não deu para ler): nada muda', () => {
    expect(escolherProduto({ idDoLink: INVENTADO, produtos: [], pergunta: 'foto do trio 08', resposta: 'x' })).toMatchObject({
      ids: [],
      motivo: 'sem_cadastro',
      trocou: false,
    });
  });

  it('a legenda do Regem: o nome do produto, com ou sem foto; sem produto, o convite ao cardápio', () => {
    expect(legendaDoProduto('TRIO 07', true)).toBe('📸 *TRIO 07*\nToque em "Ver no cardápio" para ver os detalhes e pedir.');
    expect(legendaDoProduto('TRIO 07', false)).toMatch(/^\*TRIO 07\* ainda não tem foto no cardápio/);
    expect(legendaDoProduto(null, false)).toMatch(/^Dá uma olhada no cardápio/);
  });
});
