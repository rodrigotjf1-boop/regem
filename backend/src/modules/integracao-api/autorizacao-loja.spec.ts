import { createHash, randomBytes } from 'node:crypto';
import {
  SEGREDO_MINIMO,
  clienteAutorizacao,
  desafioValido,
  estadoValido,
  formatoCodigoAutorizacao,
  gerarCodigoAutorizacao,
  hashCodigoAutorizacao,
  redirectPermitido,
  segredoConfere,
  urlDeVolta,
  verificadorConfere,
} from './autorizacao-loja';
import { AUTORIZACAO_LOJA, CLIENTES_INTEGRACAO, ESCOPOS_INTEGRACAO } from './escopos';

// AUTORIZAÇÃO PELA LOJA (trilha C, C1b) — as peças sem banco: código, PKCE, cliente e endereço
// de volta. O fluxo inteiro (página, troca, revogação) está em `autorizacao-loja.http.spec.ts`.

describe('autorização pela loja — código de uso único', () => {
  it('nasce com o formato do contrato e o banco só precisa do hash', () => {
    const a = gerarCodigoAutorizacao();
    const b = gerarCodigoAutorizacao();
    expect(a.codigo).toMatch(/^rgm_ac_[A-Za-z0-9_-]{43}$/);
    expect(a.codigo).not.toBe(b.codigo);
    expect(a.hash).toBe(createHash('sha256').update(a.codigo).digest('hex'));
    expect(hashCodigoAutorizacao(a.codigo)).toBe(a.hash);
    expect(a.hash).not.toContain(a.codigo.slice(7));
  });

  it('o que não tem a cara de um código nem é procurado (inclusive um token de loja)', () => {
    expect(formatoCodigoAutorizacao(gerarCodigoAutorizacao().codigo)).toBe(true);
    for (const v of [undefined, null, 42, '', 'rgm_ac_curto', `rgm_it_${'a'.repeat(43)}`, `rgm_ac_${'a'.repeat(44)}`, `rgm_ac_${'a'.repeat(42)}!`]) {
      expect(formatoCodigoAutorizacao(v)).toBe(false);
    }
  });
});

describe('autorização pela loja — PKCE (S256) e state', () => {
  // O par que o Liame gera (`connections/oauth.ts`): verificador de 48 bytes em base64url e o
  // desafio = SHA-256 do verificador, em base64url.
  const verificador = randomBytes(48).toString('base64url');
  const desafio = createHash('sha256').update(verificador, 'ascii').digest('base64url');

  it('o verificador certo confere; outro, vazio ou fora do formato não', () => {
    expect(desafioValido(desafio)).toBe(true);
    expect(verificadorConfere(verificador, desafio)).toBe(true);
    expect(verificadorConfere(randomBytes(48).toString('base64url'), desafio)).toBe(false);
    expect(verificadorConfere(verificador.slice(0, 42), desafio)).toBe(false); // menos de 43 caracteres
    expect(verificadorConfere(`${verificador} `, desafio)).toBe(false);
    expect(verificadorConfere(undefined, desafio)).toBe(false);
    expect(verificadorConfere(['a'], desafio)).toBe(false);
    // O próprio desafio no lugar do verificador (o método "plain") não passa.
    expect(verificadorConfere(desafio, desafio)).toBe(false);
  });

  it('desafio: só 43 caracteres de base64url; state: 16 a 200 caracteres visíveis, sem espaço', () => {
    for (const d of ['', 'curto', `${desafio}=`, desafio.slice(1), `${desafio.slice(0, 42)}+`, null, 7]) expect(desafioValido(d)).toBe(false);
    expect(estadoValido(randomBytes(32).toString('base64url'))).toBe(true);
    expect(estadoValido('a'.repeat(16))).toBe(true);
    expect(estadoValido('a'.repeat(200))).toBe(true);
    for (const s of ['a'.repeat(15), 'a'.repeat(201), 'com espaço no meio aqui', `quebra\n${'a'.repeat(20)}`, `acento-é-${'a'.repeat(20)}`, undefined, 123]) {
      expect(estadoValido(s)).toBe(false);
    }
  });
});

describe('autorização pela loja — o cliente e o endereço de volta', () => {
  const segredo = 's'.repeat(SEGREDO_MINIMO);
  const cfg = AUTORIZACAO_LOJA.liame;

  it('só existe para cliente que usa a página; o RegemCast (token de empresa, pelo console) não', () => {
    expect(clienteAutorizacao('liame', {})?.rotulo).toBe('Liame');
    for (const c of ['regemcast', 'Liame', 'outro', '', undefined, null, {}, '__proto__', 'constructor']) {
      expect(clienteAutorizacao(c, { [cfg.envSegredo]: segredo })).toBeNull();
    }
  });

  it('sem o segredo no ambiente (ou curto demais) o cliente fica indisponível e ninguém confere', () => {
    const sem = clienteAutorizacao('liame', {})!;
    expect(sem.segredo).toBeNull();
    expect(segredoConfere(sem, '')).toBe(false);
    expect(segredoConfere(sem, undefined)).toBe(false);
    const curto = clienteAutorizacao('liame', { [cfg.envSegredo]: 's'.repeat(SEGREDO_MINIMO - 1) })!;
    expect(curto.segredo).toBeNull();
    expect(segredoConfere(curto, 's'.repeat(SEGREDO_MINIMO - 1))).toBe(false);
    const com = clienteAutorizacao('liame', { [cfg.envSegredo]: segredo })!;
    expect(segredoConfere(com, segredo)).toBe(true);
    expect(segredoConfere(com, `${segredo}x`)).toBe(false);
    expect(segredoConfere(com, segredo.slice(1))).toBe(false);
    expect(segredoConfere(com, 123)).toBe(false);
  });

  it('endereço de volta: o de produção por padrão; a variável troca a lista inteira; comparação exata', () => {
    const padrao = clienteAutorizacao('liame', {})!;
    expect(padrao.redirectUris).toEqual(['https://api.agencialiame.com/v1/oauth/callback']);
    expect(redirectPermitido(padrao, 'https://api.agencialiame.com/v1/oauth/callback')).toBe(true);
    for (const u of [
      'https://api.agencialiame.com/v1/oauth/callback/',
      'https://api.agencialiame.com/v1/oauth/callback?x=1',
      'https://api.agencialiame.com.evil.example/v1/oauth/callback',
      'http://api.agencialiame.com/v1/oauth/callback',
      'HTTPS://API.AGENCIALIAME.COM/v1/oauth/callback',
      '',
      undefined,
      ['https://api.agencialiame.com/v1/oauth/callback'],
    ]) {
      expect(redirectPermitido(padrao, u)).toBe(false);
    }
    const doAmbiente = clienteAutorizacao('liame', {
      [cfg.envRedirect]: ' https://liame.teste/v1/oauth/callback , http://localhost:3100/v1/oauth/callback ',
    })!;
    expect(doAmbiente.redirectUris).toEqual(['https://liame.teste/v1/oauth/callback', 'http://localhost:3100/v1/oauth/callback']);
    expect(redirectPermitido(doAmbiente, 'https://api.agencialiame.com/v1/oauth/callback')).toBe(false);
    // Endereço inseguro no ambiente não entra na lista: http de fora, com usuário e senha, com #.
    const ruins = clienteAutorizacao('liame', {
      [cfg.envRedirect]: 'http://liame.teste/cb,https://u:s@liame.teste/cb,https://liame.teste/cb#x,javascript:alert(1),nada',
    })!;
    expect(ruins.redirectUris).toEqual([]);
  });

  it('a volta leva só o que a resposta manda, codificado, sem perder o que o endereço já tinha', () => {
    expect(urlDeVolta('https://liame.teste/v1/oauth/callback', { code: 'rgm_ac_x', state: 'a b&c=d' })).toBe(
      'https://liame.teste/v1/oauth/callback?code=rgm_ac_x&state=a+b%26c%3Dd',
    );
    expect(urlDeVolta('https://liame.teste/cb?fixo=1', { error: 'access_denied', state: 's' })).toBe(
      'https://liame.teste/cb?fixo=1&error=access_denied&state=s',
    );
  });
});

describe('autorização pela loja — o que a página oferece', () => {
  it('todo escopo oferecido existe, é do cliente e aparece uma vez; o telefone do cliente não sai por aqui', () => {
    for (const [chave, cfg] of Object.entries(AUTORIZACAO_LOJA)) {
      const oferecidos = [...cfg.sempre, ...cfg.opcionais.map((o) => o.escopo)];
      expect(new Set(oferecidos).size).toBe(oferecidos.length);
      for (const e of oferecidos) {
        expect(ESCOPOS_INTEGRACAO).toContain(e);
        expect(CLIENTES_INTEGRACAO[chave].escopos).toContain(e);
      }
      expect(CLIENTES_INTEGRACAO[chave].abrangencia).toBe('loja');
      expect(new Set(cfg.opcionais.map((o) => o.campo)).size).toBe(cfg.opcionais.length);
      expect(cfg.redirectPadrao.every((u) => u.startsWith('https://'))).toBe(true);
    }
    const liame = AUTORIZACAO_LOJA.liame;
    expect([...liame.sempre, ...liame.opcionais.map((o) => o.escopo)]).not.toContain('clientes.telefone.ler');
    // O custo nasce ligado e exige permissão financeira; criar cupom nasce desligado.
    expect(liame.opcionais).toEqual([
      { escopo: 'custos.ler', campo: 'custo', padrao: true, financeiro: true },
      { escopo: 'cupons.criar', campo: 'cupom', padrao: false, financeiro: false },
    ]);
  });
});
