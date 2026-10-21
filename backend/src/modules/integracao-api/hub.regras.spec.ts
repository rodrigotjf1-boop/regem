import {
  aceitaIntegracoes,
  codigoDoHub,
  enderecoDeServico,
  ferramentaDaRota,
  lerConfigHub,
  montarAviso,
  montarChamada,
  semCredencialDoRegem,
  versaoNoAr,
} from './hub.regras';
import { buscarSoNoHub } from './hub-dms.service';

// O hub da DMS no Regem (Hub DMS, F3, parte A2): as regras puras. O caminho inteiro, com o hub de mentira por HTTP, a
// lista de parada e o registro, está em `hub-dms.http.spec.ts`.

describe('hub da DMS — regras', () => {
  describe('a configuração (ambiente da distribuição)', () => {
    const base = {
      HUB_LIGADO: 'true',
      HUB_URL: 'https://hub.exemplo.test/',
      HUB_RECURSO: 'https://hub.exemplo.test/api/v1',
      DMS_ID_EMISSOR: 'https://id.exemplo.test/oidc',
      HUB_APLICATIVO: 'aplicativo-regem-de-teste',
      HUB_SEGREDO: 'segredo-do-aplicativo-de-teste-0123456789',
    };

    it('ligado só com HUB_LIGADO=true e tudo certo (as barras do fim saem)', () => {
      expect(lerConfigHub({ ...base, HUB_LIGADO: undefined })).toEqual({ ligado: false, motivo: null });
      expect(lerConfigHub(base)).toEqual({
        ligado: true,
        url: 'https://hub.exemplo.test',
        recurso: 'https://hub.exemplo.test/api/v1',
        emissor: 'https://id.exemplo.test/oidc',
        aplicativo: 'aplicativo-regem-de-teste',
        segredo: base.HUB_SEGREDO,
      });
    });

    it('torto não liga (e não derruba a API): diz o que corrigir, nunca o segredo', () => {
      const casos: [Record<string, string>, RegExp][] = [
        [{ HUB_URL: '' }, /HUB_URL/],
        [{ HUB_URL: 'http://hub.exemplo.test' }, /HUB_URL/],
        [{ HUB_RECURSO: 'nao-e-endereco' }, /HUB_RECURSO/],
        [{ DMS_ID_EMISSOR: 'ftp://id.exemplo.test/oidc' }, /DMS_ID_EMISSOR/],
        [{ HUB_APLICATIVO: 'tem espaço' }, /HUB_APLICATIVO/],
        [{ HUB_SEGREDO: 'curto' }, /HUB_SEGREDO/],
      ];
      for (const [troca, motivo] of casos) {
        const c = lerConfigHub({ ...base, ...troca });
        expect(c.ligado).toBe(false);
        expect(c.ligado ? '' : c.motivo).toMatch(motivo);
        expect(JSON.stringify(c)).not.toContain('segredo-do-aplicativo');
      }
    });

    it('endereço de serviço: https; http só na própria máquina; sem usuário, consulta nem fragmento', () => {
      expect(enderecoDeServico('https://hub.exemplo.test/api')).not.toBeNull();
      expect(enderecoDeServico('http://127.0.0.1:3000/x')).not.toBeNull();
      expect(enderecoDeServico('http://localhost:3000/x')).not.toBeNull();
      for (const v of ['http://hub.exemplo.test', 'https://a:b@hub.exemplo.test', 'https://hub.exemplo.test/?x=1', 'https://hub.exemplo.test/#x', 'lixo']) {
        expect(enderecoDeServico(v)).toBeNull();
      }
    });
  });

  it('a chave própria ACEITAR_INTEGRACOES: ausente, vazia ou true aceita; qualquer outro valor para', () => {
    for (const v of [undefined, '', ' ', 'true', 'TRUE']) expect(aceitaIntegracoes({ ACEITAR_INTEGRACOES: v })).toBe(true);
    for (const v of ['false', 'nao', 'não', '0', 'off']) expect(aceitaIntegracoes({ ACEITAR_INTEGRACOES: v })).toBe(false);
  });

  it('a versão no ar: APP_VERSION, ou "nuvem"', () => {
    expect(versaoNoAr({ APP_VERSION: '1.30.6' })).toBe('1.30.6');
    expect(versaoNoAr({})).toBe('nuvem');
    expect(versaoNoAr({ APP_VERSION: 'x'.repeat(200) })).toHaveLength(80);
  });

  it('o código do pedido só vai como veio quando tem a forma do código do hub', () => {
    expect(codigoDoHub('6f1d2c3b-4a59-4e7f-8a0b-1c2d3e4f5a6b')).toBe('6f1d2c3b-4a59-4e7f-8a0b-1c2d3e4f5a6b');
    for (const v of ['curto', 'tem espaço no meio', 'x'.repeat(101), undefined, 42]) expect(codigoDoHub(v)).toBeNull();
  });

  it('a ferramenta é o método e a rota declarada, sem o /api/v1; rota que não existe tem um nome só', () => {
    expect(ferramentaDaRota('get', '/api/v1/integracao/pedidos')).toBe('GET /integracao/pedidos');
    expect(ferramentaDaRota('POST', '/api/v1/integracao/cupons/:id/desativar')).toBe('POST /integracao/cupons/:id/desativar');
    expect(ferramentaDaRota('GET', undefined)).toBe('GET (rota desconhecida)');
  });

  describe('o registro no contrato do hub', () => {
    const inicio = Date.parse('2026-10-21T02:00:00.000Z');
    const base = { codigo: 'rq_0123456789abcdef', ferramenta: 'GET /integracao/loja', terminou: true, agora: inicio + 87 };

    it('aceita: os campos do contrato, sem o problema', () => {
      const r = montarChamada(
        { inicio, credencial: 'dms_id', aplicativo: 'liame', ligacaoPrefixo: 'dms_lg_regem_Ab3dE', conta: 'loja-1', contaNome: 'Loja Centro', problema: 'x-qualquer' },
        { ...base, status: 200 },
      );
      expect(r).toEqual({
        codigo: 'rq_0123456789abcdef',
        ocorrido_em: '2026-10-21T02:00:00.000Z',
        credencial: 'dms_id',
        ferramenta: 'GET /integracao/loja',
        resultado: 'aceita',
        aplicativo: 'liame',
        ligacao_prefixo: 'dms_lg_regem_Ab3dE',
        conta: 'loja-1',
        conta_nome: 'Loja Centro',
        status_http: 200,
        duracao_ms: 87,
      });
    });

    it('recusada (4xx e a parada 503) leva o problema; 5xx e conexão caída são erro', () => {
      expect(montarChamada({ inicio, problema: 'token-invalido' }, { ...base, status: 401 })).toMatchObject({ resultado: 'recusada', problema: 'token-invalido', credencial: 'token_integracao' });
      expect(montarChamada({ inicio, problema: 'integracao-parada' }, { ...base, status: 503 })).toMatchObject({ resultado: 'recusada', problema: 'integracao-parada' });
      expect(montarChamada({ inicio, problema: 'erro-interno' }, { ...base, status: 500 })).toMatchObject({ resultado: 'erro', problema: 'erro-interno' });
      expect(montarChamada({ inicio }, { ...base, status: 200, terminou: false })).toMatchObject({ resultado: 'erro' });
    });

    it('o que não cabe no contrato sai ou é cortado, nunca vai torto', () => {
      const r = montarChamada(
        { inicio, ligacaoPrefixo: 'tem espaço', problema: 'Problema Torto!', aplicativo: 'a'.repeat(200), contaNome: '  ' },
        { ...base, ferramenta: 'x'.repeat(300), status: 999, agora: inicio - 5 },
      );
      expect(r.ligacao_prefixo).toBeUndefined();
      expect(r.problema).toBeUndefined();
      expect(r.aplicativo).toHaveLength(80);
      expect(r.conta_nome).toBeUndefined();
      expect(r.ferramenta).toHaveLength(120);
      expect(r.status_http).toBeUndefined();
      expect(r.duracao_ms).toBe(0);
    });
  });

  describe('o aviso no contrato do hub (F3, parte D)', () => {
    const base = {
      codigo: '7d1f3a52-9c0e-4b6a-8f21-3e5d7c9b1a04',
      inicio: Date.parse('2026-10-21T08:20:11.002Z'),
      agora: Date.parse('2026-10-21T08:20:11.065Z'),
      aplicativo: 'liame',
      prefixo: 'rgm_it_Ab1c2',
      conta: '6f0c2a1e-4b7d-4e8a-9c3f-2d1e0b9a8c7d',
      contaNome: 'Hamburgueria Exemplo',
      tipo: 'pedido.alterado',
      url: 'https://api.exemplo.test/v1/inbox/regem/conexao-1',
      status: 202 as number | null,
      pausado: false,
      tentativa: 1,
    };

    it('o envio entregue: o código, o tipo, só a origem do destino, o status, a duração e a tentativa', () => {
      expect(montarAviso(base)).toEqual({
        codigo: base.codigo,
        ocorrido_em: '2026-10-21T08:20:11.002Z',
        aplicativo: 'liame',
        ligacao_prefixo: 'rgm_it_Ab1c2',
        conta: base.conta,
        conta_nome: 'Hamburgueria Exemplo',
        tipo: 'pedido.alterado',
        destino: 'https://api.exemplo.test',
        resultado: 'entregue',
        status_http: 202,
        duracao_ms: 63,
        tentativa: 1,
      });
    });

    it('o resultado pelo status (sem resposta, 4xx, 5xx, 408, 429) e o pausado pelo Regem', () => {
      expect(montarAviso({ ...base, status: null })).toMatchObject({ resultado: 'falhou' });
      expect(montarAviso({ ...base, status: null })).not.toHaveProperty('status_http');
      expect(montarAviso({ ...base, status: 401 })).toMatchObject({ resultado: 'recusado', status_http: 401 });
      expect(montarAviso({ ...base, status: 503 })).toMatchObject({ resultado: 'falhou', status_http: 503 });
      expect(montarAviso({ ...base, status: 408 })).toMatchObject({ resultado: 'falhou' });
      expect(montarAviso({ ...base, status: 429 })).toMatchObject({ resultado: 'falhou' });
      expect(montarAviso({ ...base, status: 410, pausado: true })).toMatchObject({ resultado: 'pausado', status_http: 410 });
    });

    it('o que não cabe no contrato sai ou é cortado; código, tipo ou aplicativo fora da forma não registram', () => {
      const r = montarAviso({ ...base, aplicativo: 'x'.repeat(90), contaNome: 'n'.repeat(130), prefixo: 'prefixo com espaço', conta: null, url: 'ftp://x', status: 700, tentativa: 0, agora: base.inicio - 5 });
      expect(r?.aplicativo).toHaveLength(80);
      expect(r?.conta_nome).toHaveLength(120);
      expect(r).not.toHaveProperty('ligacao_prefixo');
      expect(r).not.toHaveProperty('conta');
      expect(r).not.toHaveProperty('destino');
      expect(r).not.toHaveProperty('status_http');
      expect(r?.resultado).toBe('falhou');
      expect(r?.tentativa).toBe(1);
      expect(r?.duracao_ms).toBe(0);
      expect(montarAviso({ ...base, codigo: 'curto' })).toBeNull();
      expect(montarAviso({ ...base, tipo: 'Pedido Alterado' })).toBeNull();
      expect(montarAviso({ ...base, tipo: `p.${'x'.repeat(60)}` })).toBeNull();
      expect(montarAviso({ ...base, aplicativo: '   ' })).toBeNull();
    });
  });

  it('a mensagem de erro sai sem as credenciais do Regem', () => {
    const token = `rgm_it_${'A'.repeat(43)}`;
    expect(semCredencialDoRegem(`falhou com ${token} e rgm_ac_${'b'.repeat(40)}`)).toBe('falhou com <segredo> e <segredo>');
    expect(semCredencialDoRegem(undefined)).toBe('');
  });

  it('o fetch do hub só vai às rotas do hub, sem seguir redirecionamento', async () => {
    const buscar = buscarSoNoHub('https://hub.exemplo.test');
    await expect(buscar('https://outro.exemplo.test/api/v1/registro')).rejects.toThrow(/fora do hub/);
    await expect(buscar('https://hub.exemplo.test/console')).rejects.toThrow(/fora do hub/);
  });
});
