import { createHash } from 'node:crypto';
import type { AplicativoAprovado } from '../../dms/integracao-dms';
import { ESCOPOS_DO_PARCEIRO, ESCOPOS_INTEGRACAO, ESCOPOS_SENSIVEIS } from './escopos';
import {
  aplicativoDoClique,
  aplicativoNoHub,
  clienteDoParceiro,
  cnpjDoParceiroComMascara,
  ehClienteDeParceiro,
  enderecoDeVoltaDoParceiro,
  lerParceirosLigados,
  lojasDoParceiro,
  motivoParaNaoValer,
  parceiroNoClique,
  parceirosQueValem,
  permissoesDoParceiro,
} from './parceiros.regras';
import { motivoDaRecusaDaLigacao } from './ligacao.regras';
import { conferirPedido, VERSAO_DO_TEXTO_PARCEIRO } from './autorizacao-clique.regras';
import { montarTela, resumoDaTela, textoGuardado } from './autorizacao-clique.tela';

// As regras do aplicativo de PARCEIRO (Hub DMS, F4, parte F), sem banco nem rede. Os dados são fictícios.

const aprovado = (o: Partial<AplicativoAprovado> = {}): AplicativoAprovado => ({
  aplicativo: 'aplicativoparceiro01',
  nome: 'Painel Exemplo',
  para_que_serve: 'mostra os pedidos da loja num painel',
  empresa: { razao_social: 'Exemplo Sistemas Ltda', cnpj: '12ABC34501DE36' },
  etapa: 'teste',
  permissoes: [
    { nome: 'pedidos.ler', motivo: 'Mostrar os pedidos da loja no painel.', necessaria: true },
    { nome: 'catalogo.ler', motivo: 'O nome dos itens no painel.', necessaria: false },
  ],
  enderecos_de_volta: ['https://app.exemplo.test/volta'],
  bases_dos_avisos: ['https://api.exemplo.test/avisos/'],
  lojas_max: 3,
  so_leitura: true,
  dado_pessoal: false,
  aprovado_em: '2026-10-24T12:00:00.000Z',
  ...o,
});

describe('a chave PARCEIROS_LIGADOS', () => {
  it('só "true" liga; ausente, vazia ou outra coisa = desligado', () => {
    expect(lerParceirosLigados({ PARCEIROS_LIGADOS: 'true' })).toBe(true);
    for (const v of [undefined, '', 'TRUE', '1', 'sim', 'false']) expect(lerParceirosLigados({ PARCEIROS_LIGADOS: v })).toBe(false);
  });
});

describe('o cliente do parceiro no Regem', () => {
  it('é "parceiro_" + 24 hex do SHA-256 do client_id: não leva o client_id e cabe na trava das tabelas (até 40)', () => {
    const c = clienteDoParceiro('aplicativoparceiro01');
    expect(c).toBe(`parceiro_${createHash('sha256').update('aplicativoparceiro01').digest('hex').slice(0, 24)}`);
    expect(c).toHaveLength(33);
    expect(c).not.toContain('aplicativoparceiro01');
    expect(c).toMatch(/^[a-z][a-z0-9_-]{1,39}$/); // o check das tabelas do clique (mig 336)
    expect(clienteDoParceiro('outro-aplicativo')).not.toBe(c);
  });

  it('ehClienteDeParceiro reconhece só a forma exata; os clientes da DMS nunca são parceiro', () => {
    expect(ehClienteDeParceiro(clienteDoParceiro('x'))).toBe(true);
    for (const c of ['liame', 'regemcast', 'farol', 'gogem', 'parceiro_', 'parceiro_ABC', `parceiro_${'a'.repeat(25)}`, 'parceiro-' + 'a'.repeat(24), null, 3]) {
      expect(ehClienteDeParceiro(c)).toBe(false);
    }
  });

  it('no hub, o parceiro vai pelo client_id e o produto da DMS pelo cliente', () => {
    expect(aplicativoNoHub(clienteDoParceiro('app-x'), 'app-x')).toBe('app-x');
    expect(aplicativoNoHub('liame', 'aplicativo-do-liame')).toBe('liame');
    expect(aplicativoNoHub('liame')).toBe('liame');
  });
});

describe('permissoesDoParceiro: o teto da classe, o que o hub aprovou e a etapa', () => {
  it('fica só o que o hub aprovou E está no teto, na ordem do catálogo', () => {
    const a = aprovado({
      permissoes: [
        { nome: 'catalogo.ler', motivo: 'O nome dos itens no painel.', necessaria: false },
        { nome: 'pedidos.ler', motivo: 'Mostrar os pedidos da loja.', necessaria: true },
        { nome: 'cupons.criar', motivo: 'Criar cupom pela loja.', necessaria: false }, // fora do teto: só DMS
        { nome: 'clientes.ler', motivo: 'Ler a lista de clientes.', necessaria: false }, // fora do teto
        { nome: 'nao.existe', motivo: 'Uma permissão inventada.', necessaria: false },
      ],
    });
    expect(permissoesDoParceiro(a)).toEqual(['pedidos.ler', 'catalogo.ler']);
  });

  it('as sensíveis só na produção com dado pessoal aprovado — na etapa de teste, nunca, nem com a lista dizendo que sim', () => {
    const todas = ESCOPOS_DO_PARCEIRO.map((nome) => ({ nome, motivo: `Motivo de ${nome}.`, necessaria: true }));
    const sensiveisDoTeto = ESCOPOS_DO_PARCEIRO.filter((e) => ESCOPOS_SENSIVEIS.includes(e));
    expect(sensiveisDoTeto).toEqual(['clientes.telefone.ler', 'custos.ler']);
    const semSensivel = ESCOPOS_INTEGRACAO.filter((e) => ESCOPOS_DO_PARCEIRO.includes(e) && !ESCOPOS_SENSIVEIS.includes(e));
    expect(permissoesDoParceiro(aprovado({ permissoes: todas, etapa: 'teste', dado_pessoal: true }))).toEqual(semSensivel);
    expect(permissoesDoParceiro(aprovado({ permissoes: todas, etapa: 'producao', dado_pessoal: false }))).toEqual(semSensivel);
    // na produção com dado pessoal: o teto inteiro, na ordem do catálogo
    expect(permissoesDoParceiro(aprovado({ permissoes: todas, etapa: 'producao', dado_pessoal: true }))).toEqual(
      ESCOPOS_INTEGRACAO.filter((e) => ESCOPOS_DO_PARCEIRO.includes(e)),
    );
  });

  it('as lojas: na etapa de teste, o número da lista até 3 (ou 3 sem número); na produção, sem teto', () => {
    expect(lojasDoParceiro(aprovado({ etapa: 'teste', lojas_max: 2 }))).toBe(2);
    expect(lojasDoParceiro(aprovado({ etapa: 'teste', lojas_max: 3 }))).toBe(3);
    expect(lojasDoParceiro(aprovado({ etapa: 'teste', lojas_max: 50 }))).toBe(3);
    expect(lojasDoParceiro(aprovado({ etapa: 'teste', lojas_max: null }))).toBe(3);
    expect(lojasDoParceiro(aprovado({ etapa: 'producao', lojas_max: null }))).toBeNull();
  });
});

describe('a lista do hub que vale no Regem', () => {
  it('o aplicativo de exemplo vale', () => {
    expect(motivoParaNaoValer(aprovado())).toBeNull();
  });

  it('nome de produto da DMS (sem acento, espaço ou maiúscula) não vale', () => {
    for (const nome of ['Liame', 'regem cast', 'FAROL', 'Go GeM', 'Regem', 'Hub DMS', 'dms-id']) {
      expect(motivoParaNaoValer(aprovado({ nome }))).toBe('o nome é o de um produto da DMS');
    }
    expect(motivoParaNaoValer(aprovado({ nome: 'Regem Painel' }))).toBeNull();
  });

  it('sem nenhuma necessária dentro do teto e da etapa, não vale (a necessária sensível na etapa de teste não conta)', () => {
    const soSensivel = aprovado({ permissoes: [{ nome: 'clientes.telefone.ler', motivo: 'O telefone para o painel.', necessaria: true }] });
    expect(motivoParaNaoValer(soSensivel)).toBe('nenhuma permissão necessária cabe no teto da classe e na etapa');
    const necessariaForaDoTeto = aprovado({
      permissoes: [
        { nome: 'cupons.criar', motivo: 'Criar cupom pela loja.', necessaria: true },
        { nome: 'pedidos.ler', motivo: 'Mostrar os pedidos.', necessaria: false },
      ],
    });
    expect(motivoParaNaoValer(necessariaForaDoTeto)).toBe('nenhuma permissão necessária cabe no teto da classe e na etapa');
  });

  it('client_id repetido: nenhum dos dois vale', () => {
    const r = parceirosQueValem({
      versao: 7,
      itens: [aprovado(), aprovado({ nome: 'Outro Painel' }), aprovado({ aplicativo: 'aplicativoparceiro02' }), aprovado({ aplicativo: 'aplicativoparceiro03', nome: 'Liame' })],
    });
    expect([...r.validos.keys()]).toEqual(['aplicativoparceiro02']);
    expect(r.fora).toEqual([
      { aplicativo: 'aplicativoparceiro01', motivo: 'o client_id aparece mais de uma vez na lista' },
      { aplicativo: 'aplicativoparceiro03', motivo: 'o nome é o de um produto da DMS' },
    ]);
  });
});

describe('motivoDaRecusaDaLigacao com o parceiro', () => {
  const aplicativos = { liame: 'aplicativo-do-liame' };
  const cliente = clienteDoParceiro('aplicativoparceiro01');
  const ligacao = (o: Partial<{ aplicativo: string; cliente: string; revogada: boolean; motivoDoToken: string | null }> = {}) => ({
    aplicativo: 'aplicativoparceiro01',
    cliente,
    revogada: false,
    motivoDoToken: null,
    ...o,
  });

  it('a ligação do parceiro vale com o parceiro aprovado e o cliente dele', () => {
    expect(motivoDaRecusaDaLigacao(ligacao(), 'aplicativoparceiro01', aplicativos, { cliente })).toBeNull();
  });

  it('sem o parceiro (chave desligada ou fora da lista do hub), a mesma ligação cai na lista da distribuição', () => {
    expect(motivoDaRecusaDaLigacao(ligacao(), 'aplicativoparceiro01', aplicativos)).toMatch(/fora da lista da distribuição/);
  });

  it('a ligação de outro cliente (um da DMS, ou de outro parceiro) não vale para o parceiro', () => {
    expect(motivoDaRecusaDaLigacao(ligacao({ cliente: 'liame' }), 'aplicativoparceiro01', aplicativos, { cliente })).toMatch(/outro cliente/);
    expect(motivoDaRecusaDaLigacao(ligacao({ cliente: clienteDoParceiro('outro') }), 'aplicativoparceiro01', aplicativos, { cliente })).toMatch(/outro cliente/);
  });

  it('as recusas de sempre continuam: outro aplicativo, revogada, token revogado', () => {
    expect(motivoDaRecusaDaLigacao(ligacao({ aplicativo: 'outro' }), 'aplicativoparceiro01', aplicativos, { cliente })).toBe('ligação de outro aplicativo');
    expect(motivoDaRecusaDaLigacao(ligacao({ revogada: true }), 'aplicativoparceiro01', aplicativos, { cliente })).toBe('ligação revogada');
    expect(motivoDaRecusaDaLigacao(ligacao({ motivoDoToken: 'vencido' }), 'aplicativoparceiro01', aplicativos, { cliente })).toBe('token da ligação vencido');
  });
});

// ───────────────────────────── R1b: a autorização por clique do parceiro ─────────────────────────────

describe('a lista do hub: os tamanhos e a escrita do nome (R1b)', () => {
  it('nome com letra de outra escrita (imita outro nome) não vale; acento e sinal comum valem', () => {
    expect(motivoParaNaoValer(aprovado({ nome: 'Lіame Painel' }))).toMatch(/outra escrita/); // "і" cirílico
    expect(motivoParaNaoValer(aprovado({ nome: 'Ελλάδα Painel' }))).toMatch(/outra escrita/);
    expect(motivoParaNaoValer(aprovado({ nome: 'Pão & Café — Painel 2' }))).toBeNull();
  });
  it('letra matemática e de largura cheia viram as comuns antes de comparar (imitam "Liame"); nome só de sinais não vale', () => {
    expect(motivoParaNaoValer(aprovado({ nome: '\u{1D40B}\u{1D422}\u{1D41A}\u{1D426}\u{1D41E}' }))).toBe('o nome é o de um produto da DMS'); // 𝐋𝐢𝐚𝐦𝐞
    expect(motivoParaNaoValer(aprovado({ nome: 'Ｌｉａｍｅ' }))).toBe('o nome é o de um produto da DMS'); // Ｌｉａｍｅ
    expect(motivoParaNaoValer(aprovado({ nome: '!!! ***' }))).toMatch(/letra nem número/);
  });
  it('caractere de controle ou de formatação em qualquer texto do parceiro não vale (inverte ou esconde o que se lê)', () => {
    expect(motivoParaNaoValer(aprovado({ nome: '‮emaiL' }))).toMatch(/controle ou de formatação/); // aparece como "Liame"
    expect(motivoParaNaoValer(aprovado({ nome: 'Pai​nel' }))).toMatch(/controle ou de formatação/);
    expect(motivoParaNaoValer(aprovado({ para_que_serve: 'mostra os pedidos‮' }))).toMatch(/controle ou de formatação/);
    expect(motivoParaNaoValer(aprovado({ empresa: { razao_social: 'Exemplo⁦ Ltda', cnpj: '12ABC34501DE36' } }))).toMatch(/controle ou de formatação/);
    expect(motivoParaNaoValer(aprovado({ permissoes: [{ nome: 'pedidos.ler', motivo: 'Mostrar\npedidos.', necessaria: true }] }))).toMatch(/controle ou de formatação/);
  });
  it('nome, "para que serve", razão social e motivo longos demais (ou vazios) não valem', () => {
    expect(motivoParaNaoValer(aprovado({ nome: 'x'.repeat(81) }))).toMatch(/nome/);
    expect(motivoParaNaoValer(aprovado({ nome: '   ' }))).toMatch(/nome/);
    expect(motivoParaNaoValer(aprovado({ para_que_serve: '' }))).toMatch(/para que serve/);
    expect(motivoParaNaoValer(aprovado({ empresa: { razao_social: 'x'.repeat(201), cnpj: '12ABC34501DE36' } }))).toMatch(/razão social/);
    expect(motivoParaNaoValer(aprovado({ permissoes: [{ nome: 'pedidos.ler', motivo: 'x'.repeat(401), necessaria: true }] }))).toMatch(/motivo/);
  });
});

describe('o parceiro no clique (R1b)', () => {
  it('o endereço de volta: só https, com nome, sem usuário, senha ou fragmento, e nunca localhost', () => {
    expect(enderecoDeVoltaDoParceiro('https://app.exemplo.test/volta')).toBe(true);
    for (const u of ['http://app.exemplo.test/volta', 'https://localhost/volta', 'https://x.localhost/v', 'https://u:s@app.exemplo.test/v', 'https://app.exemplo.test/v#x', 'não', 3]) {
      expect(enderecoDeVoltaDoParceiro(u)).toBe(false);
    }
  });

  it('necessárias e opcionais pela marca do parceiro, cortadas pelo teto e pela etapa; o início é a origem do primeiro endereço que vale', () => {
    const p = parceiroNoClique(
      aprovado({
        enderecos_de_volta: ['http://inseguro.exemplo/v', 'https://app.exemplo.test/volta'],
        permissoes: [
          { nome: 'pedidos.ler', motivo: 'Mostrar os pedidos.', necessaria: true },
          { nome: 'catalogo.ler', motivo: 'O nome dos itens.', necessaria: false },
          { nome: 'custos.ler', motivo: 'A margem.', necessaria: false }, // sensível: fora no teste
          { nome: 'cupons.criar', motivo: 'Criar cupom.', necessaria: false }, // passa do teto
        ],
      }),
    );
    expect(p).not.toBeNull();
    expect(p).toMatchObject({ necessarias: ['pedidos.ler'], opcionais: ['catalogo.ler'], inicio: 'https://app.exemplo.test', enderecos: ['https://app.exemplo.test/volta'], lojas: 3, dadoPessoal: [], financeiras: [] });
    expect(p?.semElas['catalogo.ler']).toMatch(/não recebe isto/);
  });

  it('sem endereço de volta que valha, ou sem necessária dentro do teto, o parceiro não é oferecido', () => {
    expect(parceiroNoClique(aprovado({ enderecos_de_volta: ['http://inseguro.exemplo/v'] }))).toBeNull();
    expect(parceiroNoClique(aprovado({ permissoes: [{ nome: 'catalogo.ler', motivo: 'O nome dos itens.', necessaria: false }] }))).toBeNull();
  });

  it('o CNPJ do parceiro com máscara (alfanumérico também); o que não tem a forma sai como veio', () => {
    expect(cnpjDoParceiroComMascara('12abc34501de36')).toBe('12.ABC.345/01DE-36');
    expect(cnpjDoParceiroComMascara('11222333000100')).toBe('11.222.333/0001-00');
    expect(cnpjDoParceiroComMascara('123')).toBe('123');
  });

  it('o pedido do parceiro só pede o que ele pode (o pedido só com opcionais vale: é o modo "mais" pedindo a nova)', () => {
    const app = aplicativoDoClique(parceiroNoClique(aprovado())!);
    const base = {
      response_type: 'code',
      redirect_uri: 'https://app.exemplo.test/volta',
      state: 's'.repeat(20),
      code_challenge_method: 'S256',
      code_challenge: 'a'.repeat(43),
      conta_nome: 'Conta',
      conta_email: 'conta@exemplo.test',
    };
    expect(conferirPedido({ ...base, scope: 'pedidos.ler catalogo.ler' }, app, 'aplicativoparceiro01', ['https://app.exemplo.test/volta'])).toMatchObject({ necessarias: ['pedidos.ler'], opcionais: ['catalogo.ler'] });
    expect(conferirPedido({ ...base, scope: 'catalogo.ler' }, app, 'aplicativoparceiro01', ['https://app.exemplo.test/volta'])).toMatchObject({ necessarias: [], opcionais: ['catalogo.ler'] });
    expect(conferirPedido({ ...base, scope: 'pedidos.ler custos.ler' }, app, 'aplicativoparceiro01', ['https://app.exemplo.test/volta'])).toEqual({ erro: expect.stringMatching(/custos\.ler/) });
  });
});

describe('a tela do parceiro (R1b)', () => {
  const L1 = '11111111-1111-4111-8111-111111111111';
  const L2 = '22222222-2222-4222-8222-222222222222';
  const app = aplicativoDoClique(parceiroNoClique(aprovado())!);
  const entrada = (o: { lojas?: any[]; lojasDoTeste?: { maximo: number; emOutras: number } | null; cnpjConta?: string | null } = {}) => ({
    cliente: clienteDoParceiro('aplicativoparceiro01'),
    app,
    dms: { empresa: 'DMS Exemplo Ltda', cnpj: '33444555000100' },
    pedido: {
      redirectUri: 'https://app.exemplo.test/volta',
      necessarias: ['pedidos.ler'] as any,
      opcionais: ['catalogo.ler'] as any,
      contaQuePede: { nome: 'Conta da Brasa', cnpj: o.cnpjConta === undefined ? '11222333000200' : o.cnpjConta, email: 'c@brasa.exemplo', marca: null },
    },
    empresa: { nome: 'Brasa', cnpj: '11222333000199' },
    lojas: o.lojas ?? [{ id: L1, nome: 'Brasa Centro', tipo: 'matriz', fuso: 'America/Sao_Paulo', conectadaDesde: null, jaLiberado: [] }],
    verFinanceiro: true,
    lojasDoTeste: o.lojasDoTeste === undefined ? { maximo: 3, emOutras: 1 } : o.lojasDoTeste,
  });

  it('a confirmação sempre — mesmo com a conta da mesma empresa —, gravada e exigida pela tela', () => {
    const t = montarTela(entrada());
    expect(t.contaQuePede.outraEmpresa).toBe(false);
    expect(t.confirmacao?.texto).toContain('vão para a Exemplo Sistemas Ltda (CNPJ 12.ABC.345/01DE-36)');
    expect(t.confirmacao?.texto).toContain('A conta “Conta da Brasa” (CNPJ 11.222.333/0002-00) foi informada pelo próprio aplicativo');
    expect(textoGuardado(t, { lojas: [L1], ligadas: [], confirmouOutraEmpresa: true }).confirmouOutraEmpresa).toBe(true);
  });

  it('a classe, a versão do texto do parceiro, as vagas e o resumo (que muda com o que o presidente lê, e não com as vagas)', () => {
    const t = montarTela(entrada());
    expect(t).toMatchObject({ classe: 'parceiro', versao: VERSAO_DO_TEXTO_PARCEIRO, lojasDoTeste: { maximo: 3, vagas: 2 } });
    expect(t.rodape).toContain(`versão ${VERSAO_DO_TEXTO_PARCEIRO}`);
    const { resumo, ...sem } = t;
    expect(resumo).toBe(resumoDaTela(sem));
    expect(montarTela(entrada({ lojasDoTeste: { maximo: 3, emOutras: 2 } })).resumo).toBe(resumo);
    const outroNome = montarTela({ ...entrada(), app: { ...app, nome: 'Outro Painel' } });
    expect(outroNome.resumo).not.toBe(resumo);
  });

  it('as vagas são para loja NOVA: as que ele já lê aqui contam no teto (B1 da revisão do código)', () => {
    const ligadaENova = [
      { id: L1, nome: 'Brasa Centro', tipo: 'matriz', fuso: 'America/Sao_Paulo', conectadaDesde: new Date('2026-10-01T15:00:00Z'), jaLiberado: ['pedidos.ler'] },
      { id: L2, nome: 'Brasa Praia', tipo: 'filial', fuso: 'America/Sao_Paulo', conectadaDesde: null, jaLiberado: [] },
    ];
    const t = montarTela(entrada({ lojas: ligadaENova, lojasDoTeste: { maximo: 3, emOutras: 1 } }));
    expect(t.lojasDoTeste).toEqual({ maximo: 3, vagas: 1 });
    expect(t.ajudaLojas).toContain('aqui, mais 1 loja (as que ele já lê podem ser marcadas de novo).');
    expect(montarTela(entrada({ lojas: ligadaENova, lojasDoTeste: { maximo: 2, emOutras: 1 } })).ajudaLojas).toContain('aqui, nenhuma loja nova');
  });

  it('a loja única sem vaga não vem marcada (a que ele já lê, sim)', () => {
    expect(montarTela(entrada({ lojasDoTeste: { maximo: 3, emOutras: 3 } })).lojas[0].marcada).toBe(false);
    expect(montarTela(entrada({ lojasDoTeste: { maximo: 3, emOutras: 2 } })).lojas[0].marcada).toBe(true);
    const ligada = [{ id: L1, nome: 'Brasa Centro', tipo: 'matriz', fuso: 'America/Sao_Paulo', conectadaDesde: new Date('2026-10-01T15:00:00Z'), jaLiberado: ['pedidos.ler'] }];
    expect(montarTela(entrada({ lojas: ligada, lojasDoTeste: { maximo: 3, emOutras: 3 } })).lojas[0].marcada).toBe(true);
  });

  it('a janela no "não pode": nova = desta autorização; mista = as duas datas', () => {
    const mista = [
      { id: L1, nome: 'Brasa Centro', tipo: 'matriz', fuso: 'America/Sao_Paulo', conectadaDesde: new Date('2026-10-01T15:00:00Z'), jaLiberado: ['pedidos.ler', 'catalogo.ler'] },
      { id: L2, nome: 'Brasa Praia', tipo: 'filial', fuso: 'America/Sao_Paulo', conectadaDesde: null, jaLiberado: [] },
    ];
    expect(montarTela(entrada()).naoPode.at(-1)?.frase).toBe('Ele não lê as vendas de antes desta autorização.');
    expect(montarTela(entrada({ lojas: mista })).naoPode.at(-1)?.frase).toBe(
      'Nas lojas novas, ele não lê as vendas de antes desta autorização; nas que já têm o Painel Exemplo, as de antes de 01/10/2026.',
    );
  });

  it('sem a etapa de teste (produção), nada de vagas', () => {
    const t = montarTela(entrada({ lojasDoTeste: null }));
    expect(t.lojasDoTeste).toBeNull();
    expect(t.ajudaLojas).toBeNull();
  });
});
