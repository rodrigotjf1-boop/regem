import { linhasDaAgenda } from './mister-clima-eventos';
import { avaliarRegra, conferirRegra, descreverRegra, textoDoDisparo } from './mister-regra';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Versão 8, E3: "me avisa um dia antes de jogo do meu time" vira regra, na mesma linguagem das outras fontes.
const RIO = 3304557;
const cidades = [{ tenantId: 't', unidadeId: 'u1', municipio: RIO, uf: 'RJ' }];
const jogo = (o: any = {}) => ({
  id: 'e1',
  tipo: 'jogo',
  nome: 'Botafogo x São Paulo',
  dia_inteiro: false,
  inicio: '2026-11-24T23:00:00.000Z',
  fuso: 'America/Sao_Paulo',
  abrangencia: [{ nivel: 'municipio', valor: String(RIO) }],
  situacao: 'confirmado',
  ...o,
});
const quem = { presidente: true, pode: () => true, verValores: true };
const REGRA = {
  fonte: 'agenda',
  titulo: 'Jogo do Botafogo amanhã',
  filtros: [
    { campo: 'tipo', op: '=', valor: 'jogo' },
    { campo: 'nome', op: 'contem', valor: 'botafogo' },
    { campo: 'dias_para', op: '=', valor: 1 },
  ],
  medida: 'cada_item',
  quando: { em: '18:00' },
  vezes: 'sempre',
  agrupar: false,
};
const agora = (dia: string, hora = '18:00') => ({ instante: new Date(`${dia}T21:00:00.000Z`), dia, diaDaSemana: new Date(`${dia}T12:00:00Z`).getUTCDay(), hora });

describe('a fonte agenda', () => {
  it('cada evento com o dia, a hora, os dias que faltam e se é na cidade', () => {
    expect(linhasDaAgenda(cidades, [jogo()], '2026-11-23', '2026-11-30')).toEqual([
      {
        id: 'e1',
        alvoId: 'e1',
        tenantId: 't',
        unidadeId: 'u1',
        rotulo: 'Botafogo x São Paulo · terça, 24/11 às 20:00',
        campos: { tipo: 'jogo', nome: 'Botafogo x São Paulo', dias_para: 1, na_cidade: true },
      },
    ]);
  });

  it('jogo do time em outra cidade entra marcado; de outro lugar só por município, fora do período ou sem id não', () => {
    const fora = jogo({ id: 'e2', abrangencia: [{ nivel: 'nacional', valor: 'BR' }] });
    expect(linhasDaAgenda(cidades, [fora], '2026-11-23', '2026-11-30')[0].campos).toMatchObject({ na_cidade: false });
    expect(linhasDaAgenda(cidades, [jogo({ abrangencia: [{ nivel: 'municipio', valor: '3550308' }] })], '2026-11-23', '2026-11-30')).toEqual([]);
    expect(linhasDaAgenda(cidades, [jogo({ inicio: '2026-12-24T23:00:00.000Z' })], '2026-11-23', '2026-11-30')).toEqual([]);
    expect(linhasDaAgenda(cidades, [jogo({ id: undefined })], '2026-11-23', '2026-11-30')).toEqual([]);
  });
});

describe('a regra do jogo do meu time', () => {
  const r: any = conferirRegra(REGRA, quem, () => true);

  it('passa na conferência e o código descreve o que vai fazer', () => {
    expect(r.erro).toBeUndefined();
    const texto = descreverRegra(r.regra);
    expect(texto).toContain('18:00');
    expect(texto.toLowerCase()).toContain('botafogo');
  });

  it('avisa na véspera, às 18:00, uma vez, e fica calada nos outros dias', () => {
    const linhasDe = (hoje: string) => linhasDaAgenda(cidades, [jogo()], hoje, '2026-11-30') as any[];
    const antes = avaliarRegra(r.regra, linhasDe('2026-11-22'), {}, agora('2026-11-22'));
    expect(antes.disparos).toEqual([]);
    const naVespera = avaliarRegra(r.regra, linhasDe('2026-11-23'), {}, agora('2026-11-23'));
    expect(naVespera.disparos).toHaveLength(1);
    expect(textoDoDisparo(r.regra, naVespera.disparos[0])).toBe('⏱ Jogo do Botafogo amanhã\n• Botafogo x São Paulo · terça, 24/11 às 20:00');
    expect(avaliarRegra(r.regra, linhasDe('2026-11-23'), naVespera.estado, agora('2026-11-23', '18:02')).disparos).toEqual([]);
  });

  it('jogo de outro time não dispara', () => {
    const outro = linhasDaAgenda(cidades, [jogo({ nome: 'Santos x Grêmio' })], '2026-11-23', '2026-11-30') as any[];
    expect(avaliarRegra(r.regra, outro, {}, agora('2026-11-23')).disparos).toEqual([]);
  });
});
