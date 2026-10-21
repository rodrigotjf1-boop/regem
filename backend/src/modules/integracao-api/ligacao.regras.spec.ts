import { ErroPermissaoFaltando, ErroTokenDmsId, gerarChave } from '../../dms/integracao-dms';
import {
  CAMINHO_DOS_METADADOS,
  desafioDaRecusa,
  enderecoDosMetadados,
  EscopoFaltando,
  lerConfigDmsId,
  ligacaoDoCabecalho,
  motivoDaRecusaDaLigacao,
  PERMISSOES_DO_RECURSO,
  permissoesDaLigacao,
  permissoesDoCatalogo,
  podeTrocar,
} from './ligacao.regras';
import { ESCOPOS_INTEGRACAO } from './escopos';
import { ProblemaException } from './problema';

// A via do DMS ID (Hub DMS, F3, parte A): as regras puras — sem banco nem HTTP. O caminho inteiro, com o Postgres e o
// kit do Padrão, está em `dms-id.http.spec.ts`.

const APLICATIVOS = Object.freeze({ liame: 'aplicativo-liame', farol: 'aplicativo-farol' });
const METADADOS = 'https://api.exemplo.test/.well-known/oauth-protected-resource/api/v1/integracao';

describe('ligação do Hub DMS — regras', () => {
  it('o cabeçalho só vale com uma ligação do Regem, com os dígitos de conferência certos', () => {
    const boa = gerarChave('lg', 'regem').chave;
    expect(ligacaoDoCabecalho(boa)).toBe(boa);
    expect(ligacaoDoCabecalho(`  ${boa}  `)).toBe(boa);
    // de outro produto, chave de acesso próprio, conferência trocada, lista (cabeçalho repetido), vazio, nada
    const outroProduto = gerarChave('lg', 'regemcast').chave;
    const acessoProprio = gerarChave('ap', 'regem').chave;
    const conferenciaTrocada = `${boa.slice(0, -1)}${boa.endsWith('A') ? 'B' : 'A'}`;
    for (const v of [outroProduto, acessoProprio, conferenciaTrocada, [boa, boa], '', undefined, null, 42]) {
      expect(ligacaoDoCabecalho(v)).toBeNull();
    }
  });

  it('permissões: só as do catálogo; na chamada, as que a loja autorizou E o token tem, na ordem do catálogo', () => {
    expect(permissoesDoCatalogo(['cupons.criar', 'orcamento.ler', 'pedidos.ler'])).toEqual(['pedidos.ler', 'cupons.criar']);
    expect(permissoesDoCatalogo([])).toEqual([]);
    expect(permissoesDaLigacao(['cupons.ler', 'pedidos.ler', 'custos.ler'], ['pedidos.ler', 'cupons.ler', 'catalogo.ler'])).toEqual([
      'pedidos.ler',
      'cupons.ler',
    ]);
    expect(permissoesDaLigacao(['pedidos.ler'], ['catalogo.ler'])).toEqual([]);
    expect(PERMISSOES_DO_RECURSO).toEqual(ESCOPOS_INTEGRACAO);
  });

  it('troca e uso: só o aplicativo que a distribuição cadastrou para o cliente do token', () => {
    expect(podeTrocar('liame', 'aplicativo-liame', APLICATIVOS)).toBe(true);
    expect(podeTrocar('liame', 'aplicativo-farol', APLICATIVOS)).toBe(false); // o do Farol não troca o do Liame
    expect(podeTrocar('gogem', 'aplicativo-liame', APLICATIVOS)).toBe(false); // cliente sem aplicativo cadastrado
    expect(podeTrocar('constructor', 'aplicativo-liame', APLICATIVOS)).toBe(false); // nada herdado do Object
    expect(podeTrocar('liame', 'aplicativo-liame', {})).toBe(false);
  });

  it('a ligação que não vale tem um motivo (para o log); a que vale, nenhum', () => {
    const boa = { aplicativo: 'aplicativo-liame', cliente: 'liame', revogada: false, motivoDoToken: null };
    expect(motivoDaRecusaDaLigacao(boa, 'aplicativo-liame', APLICATIVOS)).toBeNull();
    expect(motivoDaRecusaDaLigacao(null, 'aplicativo-liame', APLICATIVOS)).toBe('ligação desconhecida');
    expect(motivoDaRecusaDaLigacao(boa, 'aplicativo-farol', APLICATIVOS)).toBe('ligação de outro aplicativo');
    expect(motivoDaRecusaDaLigacao(boa, 'aplicativo-liame', { farol: 'aplicativo-farol' })).toMatch(/fora da lista da distribuição/);
    expect(motivoDaRecusaDaLigacao({ ...boa, revogada: true }, 'aplicativo-liame', APLICATIVOS)).toBe('ligação revogada');
    for (const m of ['revogado', 'vencido', 'loja apagada', 'empresa apagada']) {
      expect(motivoDaRecusaDaLigacao({ ...boa, motivoDoToken: m }, 'aplicativo-liame', APLICATIVOS)).toBe(`token da ligação ${m}`);
    }
  });

  it('o endereço dos metadados fica entre a origem e o caminho do recurso (RFC 9728 §3.1)', () => {
    expect(enderecoDosMetadados('https://api.exemplo.test/api/v1/integracao')).toBe(METADADOS);
    expect(enderecoDosMetadados('https://api.exemplo.test/api/v1/integracao/')).toBe(METADADOS);
    expect(METADADOS.endsWith(`/${CAMINHO_DOS_METADADOS}`)).toBe(true);
  });

  describe('o desafio (WWW-Authenticate) de cada recusa', () => {
    it('via desligada: o 401 do token que veio é invalid_token; sem token, só "Bearer"', () => {
      const e401 = new ProblemaException(401, 'token-invalido', 'x');
      expect(desafioDaRecusa(e401, { veioToken: true })).toBe('Bearer error="invalid_token"');
      expect(desafioDaRecusa(e401, { veioToken: false })).toBe('Bearer');
    });

    it('via ligada: todo 401 leva os metadados e as permissões; só o token ruim é invalid_token', () => {
      const tokenRuim = desafioDaRecusa(new ErroTokenDmsId('vencido'), { veioToken: true, metadadosRecurso: METADADOS });
      expect(tokenRuim).toContain(`resource_metadata="${METADADOS}"`);
      expect(tokenRuim).toContain('error="invalid_token"');
      expect(tokenRuim).toContain(`scope="${ESCOPOS_INTEGRACAO.join(' ')}"`);
      const semToken = desafioDaRecusa(new ErroTokenDmsId('ausente'), { veioToken: false, metadadosRecurso: METADADOS });
      expect(semToken).not.toContain('error=');
      expect(semToken).toMatch(/^Bearer resource_metadata=/);
      // a ligação recusada com o token bom não é defeito do token
      const ligacao = desafioDaRecusa(new ProblemaException(401, 'ligacao-invalida', 'x'), { veioToken: true, metadadosRecurso: METADADOS });
      expect(ligacao).toMatch(/^Bearer resource_metadata=/);
      expect(ligacao).not.toContain('error=');
    });

    it('o 403 de permissão leva TODAS as que faltam; outras recusas não levam desafio', () => {
      expect(desafioDaRecusa(new EscopoFaltando(['cupons.criar', 'custos.ler'], 'ligacao'), { veioToken: true })).toBe(
        'Bearer error="insufficient_scope", scope="cupons.criar custos.ler"',
      );
      expect(desafioDaRecusa(new ErroPermissaoFaltando(['pedidos.ler']), { veioToken: true, metadadosRecurso: METADADOS })).toBe(
        `Bearer resource_metadata="${METADADOS}", error="insufficient_scope", scope="pedidos.ler"`,
      );
      expect(desafioDaRecusa(new ProblemaException(429, 'limite-de-chamadas', 'x'), { veioToken: true })).toBeNull();
      expect(desafioDaRecusa(new Error('qualquer'), { veioToken: true })).toBeNull();
    });

    it('a frase do 403 diz qual credencial (a mesma do token de sempre)', () => {
      expect(new EscopoFaltando(['cupons.criar'], 'token').message).toBe('Este token não tem o escopo cupons.criar.');
      expect(new EscopoFaltando(['cupons.criar'], 'ligacao').message).toBe('Esta ligação não tem o escopo cupons.criar.');
    });
  });

  describe('a configuração (ambiente da distribuição)', () => {
    const base = {
      DMS_ID_LIGADO: 'true',
      DMS_ID_EMISSOR: 'https://id.exemplo.test/oidc',
      DMS_ID_RECURSO: 'https://api.exemplo.test/api/v1/integracao',
      DMS_ID_APLICATIVOS: JSON.stringify(APLICATIVOS),
    };

    it('ligada só com DMS_ID_LIGADO=true e tudo certo', () => {
      expect(lerConfigDmsId({ ...base, DMS_ID_LIGADO: undefined })).toEqual({ ligado: false, motivo: null });
      expect(lerConfigDmsId({ ...base, DMS_ID_LIGADO: '1' })).toEqual({ ligado: false, motivo: null });
      const c = lerConfigDmsId(base);
      expect(c).toEqual({ ligado: true, emissor: base.DMS_ID_EMISSOR, recurso: base.DMS_ID_RECURSO, aplicativos: APLICATIVOS });
      // a barra no fim do emissor não muda o `iss` conferido
      expect(lerConfigDmsId({ ...base, DMS_ID_EMISSOR: 'https://id.exemplo.test/oidc/' })).toMatchObject({ emissor: base.DMS_ID_EMISSOR });
      // `http:` só na própria máquina (testes)
      expect(lerConfigDmsId({ ...base, DMS_ID_EMISSOR: 'http://127.0.0.1:4000/oidc', DMS_ID_RECURSO: 'http://127.0.0.1:3000/api/v1/integracao' }).ligado).toBe(true);
    });

    it('torta não liga, e diz o que corrigir', () => {
      const casos: [Record<string, string>, RegExp][] = [
        [{ DMS_ID_EMISSOR: '' }, /DMS_ID_EMISSOR/],
        [{ DMS_ID_EMISSOR: 'http://id.exemplo.test/oidc' }, /DMS_ID_EMISSOR/],
        [{ DMS_ID_EMISSOR: 'https://id.exemplo.test/oidc?x=1' }, /DMS_ID_EMISSOR/],
        [{ DMS_ID_RECURSO: 'https://api.exemplo.test/api/v1' }, /DMS_ID_RECURSO/],
        [{ DMS_ID_RECURSO: 'https://api.exemplo.test/api/v1/integracao/' }, /DMS_ID_RECURSO/],
        [{ DMS_ID_RECURSO: 'http://api.exemplo.test/api/v1/integracao' }, /DMS_ID_RECURSO/],
        [{ DMS_ID_APLICATIVOS: 'liame=x' }, /JSON/],
        [{ DMS_ID_APLICATIVOS: '["aplicativo-liame"]' }, /cliente → client_id/],
        [{ DMS_ID_APLICATIVOS: '{"outro":"aplicativo-x"}' }, /cliente que não existe: outro/],
        [{ DMS_ID_APLICATIVOS: '{"liame":"tem espaço"}' }, /DMS_ID_APLICATIVOS\.liame/],
        [{ DMS_ID_APLICATIVOS: '{"liame":"aplicativo-x","farol":"aplicativo-x"}' }, /dois clientes/],
        [{ DMS_ID_APLICATIVOS: '{}' }, /vazio/],
      ];
      for (const [troca, motivo] of casos) {
        const c = lerConfigDmsId({ ...base, ...troca });
        expect(c.ligado).toBe(false);
        expect(c.ligado ? '' : c.motivo).toMatch(motivo);
      }
    });
  });
});
