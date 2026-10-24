import { createHash } from 'node:crypto';
import type { AplicativoAprovado } from '../../dms/integracao-dms';
import { ESCOPOS_DO_PARCEIRO, ESCOPOS_INTEGRACAO, ESCOPOS_SENSIVEIS } from './escopos';
import {
  aplicativoNoHub,
  clienteDoParceiro,
  ehClienteDeParceiro,
  lerParceirosLigados,
  lojasDoParceiro,
  motivoParaNaoValer,
  parceirosQueValem,
  permissoesDoParceiro,
} from './parceiros.regras';
import { motivoDaRecusaDaLigacao } from './ligacao.regras';

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
