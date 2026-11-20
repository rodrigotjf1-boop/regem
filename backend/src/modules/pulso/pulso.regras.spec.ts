import { createHash, randomBytes } from 'node:crypto';
import {
  RAMO_DO_REGEM,
  corpoDosInteresses,
  lerClima,
  lerConfigPulso,
  lerMudancas,
  ligacaoDoPulsoValida,
  resumoDosInteresses,
} from './pulso.regras';

/** Uma ligação do Pulso no formato do pacote comum (corpo de 43 e 6 dígitos de conferência). */
function ligacaoDeTeste(): string {
  const corpo = randomBytes(32).toString('base64url');
  return `dms_lg_pulso_${corpo}_${createHash('sha256').update(corpo, 'utf8').digest('base64url').slice(0, 6)}`;
}

const AMBIENTE = (extra: Record<string, string> = {}) => ({
  NODE_ENV: 'production',
  DMS_ID_EMISSOR: 'https://id.dmstecnologias.com/',
  HUB_APLICATIVO: 'pdwsmmjut59ev8n638s0s',
  HUB_SEGREDO: 'um-segredo-de-teste-comprido',
  ...extra,
});

describe('o Regem lê o Pulso — as regras', () => {
  it('a ligação: o formato e os dígitos de conferência do pacote comum; de outro produto ou adulterada não vale', () => {
    const boa = ligacaoDeTeste();
    expect(ligacaoDoPulsoValida(boa)).toBe(true);
    expect(ligacaoDoPulsoValida(boa.replace('_pulso_', '_graph_'))).toBe(false);
    expect(ligacaoDoPulsoValida(`${boa.slice(0, -1)}${boa.endsWith('a') ? 'b' : 'a'}`)).toBe(false);
    expect(ligacaoDoPulsoValida('dms_lg_pulso_curta_abcdef')).toBe(false);
    expect(ligacaoDoPulsoValida(undefined)).toBe(false);
  });

  it('nasce desligado: sem a ligação, com ligação torta, sem a credencial ou com endereço ruim, nada roda', () => {
    expect(lerConfigPulso(AMBIENTE())).toMatchObject({ ligado: false, motivo: expect.stringMatching(/PULSO_LIGACAO não configurada/) });
    expect(lerConfigPulso(AMBIENTE({ PULSO_LIGACAO: 'dms_lg_graph_x' })).ligado).toBe(false);
    expect(lerConfigPulso({ ...AMBIENTE({ PULSO_LIGACAO: ligacaoDeTeste() }), HUB_SEGREDO: 'curto' }).ligado).toBe(false);
    expect(lerConfigPulso(AMBIENTE({ PULSO_LIGACAO: ligacaoDeTeste(), PULSO_URL: 'http://pulso.dmstecnologias.com/v1' })).motivo).toMatch(/https/);
    expect(lerConfigPulso(AMBIENTE({ PULSO_LIGACAO: ligacaoDeTeste(), PULSO_URL: 'https://pulso.dmstecnologias.com/api' })).motivo).toMatch(/\/v1/);
    const ok = lerConfigPulso(AMBIENTE({ PULSO_LIGACAO: ligacaoDeTeste() }));
    expect(ok).toMatchObject({ ligado: true, motivo: null, base: 'https://pulso.dmstecnologias.com/v1', recurso: 'https://pulso.dmstecnologias.com/v1', emissor: 'https://id.dmstecnologias.com' });
  });

  it('as mudanças: o retirado entra como retirado; o torto fica de fora; o cursor e o "tem mais"', () => {
    const id = '9b1f1e8a-3f7c-5d2e-8a1b-2c3d4e5f6a7b';
    const l = lerMudancas({
      eventos: [
        { id, chave: 'feriado:regra:consciencia-negra:2026', tipo: 'feriado', nome: 'Consciência Negra', dia_inteiro: true, inicio: '2026-11-20', fim: '2026-11-20', fuso: 'America/Sao_Paulo', janela: { antes_min: 0, depois_min: 0 }, abrangencia: [{ nivel: 'nacional', valor: 'BR' }], situacao: 'ativo', detalhes: { grupo: 'feriado' }, versao: 7, fonte: { id: 'lei' }, credito: null },
        { id: '1c2d3e4f-5a6b-5c7d-8e9f-0a1b2c3d4e5f', chave: 'x:fechada', situacao: 'retirado', versao: 8 },
        { id: 'nao-e-uuid', chave: 'y', versao: 9 },
        { id: '2d3e4f5a-6b7c-5d8e-9f0a-1b2c3d4e5f6a', chave: 'z', versao: -1 },
      ],
      proxima_versao: 8,
      tem_mais: true,
    });
    expect(l.proximaVersao).toBe(8);
    expect(l.temMais).toBe(true);
    expect(l.eventos.map((e) => [e.chave, e.situacao, e.tipo, e.versao])).toEqual([
      ['feriado:regra:consciencia-negra:2026', 'ativo', 'feriado', 7],
      ['x:fechada', 'retirado', 'retirado', 8],
    ]);
    expect(lerMudancas({ eventos: [] }).proximaVersao).toBeNull();
  });

  it('o clima: um item por dia, o torto fora', () => {
    expect(
      lerClima({ municipio: { ibge: '3304557' }, dias: [{ dia: '2026-11-21', chuva_prevista: true, inmet: { resumo: 'chuva' }, cptec: null }, { dia: '21/11', chuva_prevista: true }] }),
    ).toEqual([{ dia: '2026-11-21', chuvaPrevista: true, inmet: { resumo: 'chuva' }, cptec: null }]);
    expect(lerClima(null)).toEqual([]);
  });

  it('os interesses: a lista somada, sem repetir, em ordem, só código IBGE, o ramo do Regem e NADA de loja ou empresa', () => {
    const c = corpoDosInteresses(['3304557', '3304557', 3550308, 'abc', '0000000', null]);
    expect(c).toEqual({ municipios: ['3304557', '3550308'], temas: [], ramos: [RAMO_DO_REGEM] });
    expect(Object.keys(c).sort()).toEqual(['municipios', 'ramos', 'temas']);
    expect(resumoDosInteresses(c)).toBe(resumoDosInteresses(corpoDosInteresses(['3550308', '3304557'])));
  });
});
