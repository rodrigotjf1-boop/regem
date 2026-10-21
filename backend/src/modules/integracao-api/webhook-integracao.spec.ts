import { createHmac, randomBytes } from 'node:crypto';
import {
  assinarAviso,
  basesDoWebhook,
  cabecalhosDoAviso,
  chaveDoSegredo,
  corpoDoAviso,
  desfechoDoEnvio,
  enderecoPermitido,
  EVENTO_DO_RECURSO,
  EVENTO_DO_RETRATO,
  PAUSA_APOS_FALHA_SEG,
  PAUSA_APOS_SUMICO_SEG,
  recuoSeg,
} from './webhook-integracao';
import { CLIENTES_INTEGRACAO, ESCOPOS_INTEGRACAO, ESCOPOS_SEM_CARIMBO } from './escopos';

// AVISOS (webhooks) da API de integração — as regras puras (mig 304).

const BASE = 'https://api.agencialiame.com/v1/inbox/regem/';
const ID = '0199c0de-7a11-7c3a-9f2e-5b1d2c3e4f50';

describe('para onde o Regem pode avisar', () => {
  it('o Liame tem o endereço de produção por padrão; o ambiente troca a lista inteira', () => {
    expect(basesDoWebhook('liame', {})).toEqual([BASE]);
    expect(basesDoWebhook('liame', { INTEGRACAO_LIAME_WEBHOOK_URLS: ' http://127.0.0.1:3101/v1/inbox/regem/ , https://b.exemplo/x/ ' })).toEqual([
      'http://127.0.0.1:3101/v1/inbox/regem/',
      'https://b.exemplo/x/',
    ]);
  });

  it('http só na própria máquina (Hub DMS, F3-8): base http de fora é descartada, nunca vira destino sem TLS', () => {
    expect(
      basesDoWebhook('liame', { INTEGRACAO_LIAME_WEBHOOK_URLS: 'http://liame.exemplo/v1/inbox/regem/,http://localhost:3101/v1/inbox/regem/' }),
    ).toEqual(['http://localhost:3101/v1/inbox/regem/']);
    expect(basesDoWebhook('liame', { INTEGRACAO_LIAME_WEBHOOK_URLS: 'http://10.0.0.5/v1/inbox/regem/' })).toEqual([]);
  });

  it('o Farol também tem endereço de produção (mig 316), e só o dele', () => {
    const baseFarol = 'https://api.monitorfarol.com.br/v1/regem/avisos/';
    expect(basesDoWebhook('farol', {})).toEqual([baseFarol]);
    expect(basesDoWebhook('farol', { INTEGRACAO_FAROL_WEBHOOK_URLS: 'http://127.0.0.1:3201/v1/regem/avisos/' })).toEqual([
      'http://127.0.0.1:3201/v1/regem/avisos/',
    ]);
    // A variável de um cliente não muda a lista do outro.
    expect(basesDoWebhook('farol', { INTEGRACAO_LIAME_WEBHOOK_URLS: 'https://b.exemplo/x/' })).toEqual([baseFarol]);
    expect(enderecoPermitido(`${baseFarol}${ID}`, basesDoWebhook('farol', {}))).toBe(`${baseFarol}${ID}`);
    expect(enderecoPermitido(`${BASE}${ID}`, basesDoWebhook('farol', {}))).toBeNull(); // o endereço do Liame não serve ao Farol
    expect(enderecoPermitido(`${baseFarol}${ID}/outro`, basesDoWebhook('farol', {}))).toBeNull();
  });

  it('o GoGeM tem o endereço dele (fase 2 da credencial própria), e só o dele', () => {
    const baseGogem = 'https://api.gogem.com.br/api/v1/sync/regem/avisos/';
    expect(basesDoWebhook('gogem', {})).toEqual([baseGogem]);
    expect(basesDoWebhook('gogem', { INTEGRACAO_GOGEM_WEBHOOK_URLS: 'http://127.0.0.1:3301/api/v1/sync/regem/avisos/' })).toEqual([
      'http://127.0.0.1:3301/api/v1/sync/regem/avisos/',
    ]);
    expect(basesDoWebhook('gogem', { INTEGRACAO_FAROL_WEBHOOK_URLS: 'https://b.exemplo/x/' })).toEqual([baseGogem]);
    expect(enderecoPermitido(`${baseGogem}integ_42`, basesDoWebhook('gogem', {}))).toBe(`${baseGogem}integ_42`);
    // As rotas de hoje do GoGeM não servem de endereço de aviso: só um trecho depois da base.
    expect(enderecoPermitido('https://api.gogem.com.br/api/v1/sync/regem/pedido-cancelado', basesDoWebhook('gogem', {}))).toBeNull();
    expect(enderecoPermitido(`${BASE}${ID}`, basesDoWebhook('gogem', {}))).toBeNull(); // o do Liame não serve ao GoGeM
    expect(enderecoPermitido(`${baseGogem}${ID}`, basesDoWebhook('liame', {}))).toBeNull(); // nem o do GoGeM ao Liame
  });

  it('o GoGeM nunca recebe aviso de frescor: nenhum escopo dele libera um evento (lista fechada)', () => {
    // O job dos avisos escolhe o que mandar pelo escopo do token. Se um escopo do GoGeM passar a
    // liberar evento, o endereço dele começa a receber o que o contrato não prevê — decida antes.
    const doFrescor = [...Object.values(EVENTO_DO_RECURSO), ...Object.values(EVENTO_DO_RETRATO)].map((e) => e.escopo as string);
    expect(CLIENTES_INTEGRACAO.gogem.escopos.filter((e) => doFrescor.includes(e))).toEqual([]);
  });

  it('cliente sem lista (o RegemCast, um desconhecido) não registra aviso', () => {
    expect(basesDoWebhook('regemcast', {})).toEqual([]);
    expect(basesDoWebhook('qualquer', {})).toEqual([]);
    expect(basesDoWebhook('constructor', {})).toEqual([]);
  });

  it('base mal escrita no ambiente é ignorada (sem barra no fim, com parâmetro, com usuário, outro protocolo)', () => {
    const env = {
      INTEGRACAO_LIAME_WEBHOOK_URLS:
        'https://a.exemplo/inbox,https://a.exemplo/inbox/?x=1,https://u:p@a.exemplo/inbox/,ftp://a.exemplo/inbox/,nada,https://ok.exemplo/inbox/',
    };
    expect(basesDoWebhook('liame', env)).toEqual(['https://ok.exemplo/inbox/']);
  });

  it('aceita o endereço dentro da base, com um trecho só depois dela', () => {
    expect(enderecoPermitido(`${BASE}${ID}`, [BASE])).toBe(`${BASE}${ID}`);
    expect(enderecoPermitido(`${BASE}abc_DEF-123`, [BASE])).toBe(`${BASE}abc_DEF-123`);
  });

  it.each([
    ['outro domínio', `https://api.agencialiame.com.evil.example/v1/inbox/regem/${ID}`],
    ['domínio no usuário', `https://api.agencialiame.com@evil.example/v1/inbox/regem/${ID}`],
    ['outra porta', `https://api.agencialiame.com:8443/v1/inbox/regem/${ID}`],
    ['http no lugar de https', `http://api.agencialiame.com/v1/inbox/regem/${ID}`],
    ['outro caminho', `https://api.agencialiame.com/v1/outra/${ID}`],
    ['sobe de pasta', `https://api.agencialiame.com/v1/inbox/regem/../../admin`],
    ['sobe de pasta codificado', `https://api.agencialiame.com/v1/inbox/regem/%2e%2e/%2e%2e/admin`],
    ['dois trechos', `https://api.agencialiame.com/v1/inbox/regem/${ID}/mais`],
    ['sem o trecho', BASE],
    ['com parâmetro', `${BASE}${ID}?redirect=https://evil.example`],
    ['com âncora', `${BASE}${ID}#x`],
    ['trecho com caractere estranho', `${BASE}a%20b`],
    ['trecho comprido demais', `${BASE}${'a'.repeat(65)}`],
    ['não é endereço', 'nada'],
    ['vazio', ''],
  ])('recusa: %s', (_nome, url) => {
    expect(enderecoPermitido(url, [BASE])).toBeNull();
  });

  it('recusa o que não é texto e o endereço comprido demais', () => {
    expect(enderecoPermitido(null, [BASE])).toBeNull();
    expect(enderecoPermitido({ href: `${BASE}${ID}` }, [BASE])).toBeNull();
    expect(enderecoPermitido(`${BASE}${'a'.repeat(600)}`, [BASE])).toBeNull();
    expect(enderecoPermitido(`${BASE}${ID}`, [])).toBeNull();
  });
});

describe('o segredo da assinatura', () => {
  const b64 = (n: number) => randomBytes(n).toString('base64');

  it('aceita whsec_ + base64 de 24 a 64 bytes (com ou sem o preenchimento)', () => {
    for (const n of [24, 32, 64]) {
      const s = b64(n);
      expect(chaveDoSegredo(`whsec_${s}`)?.length).toBe(n);
      expect(chaveDoSegredo(`whsec_${s.replace(/=+$/, '')}`)?.length).toBe(n);
    }
  });

  it.each([
    ['sem o prefixo', b64(32)],
    ['curto', `whsec_${b64(23)}`],
    ['comprido', `whsec_${b64(65)}`],
    ['com lixo no meio', `whsec_${b64(32).slice(0, 10)}!!${b64(32).slice(10)}`],
    ['base64url', `whsec_${randomBytes(48).toString('base64').replace(/[+/]/g, '-')}-_`],
    ['vazio', 'whsec_'],
  ])('recusa: %s', (_nome, s) => {
    expect(chaveDoSegredo(s)).toBeNull();
  });

  it('recusa o que não é texto', () => {
    expect(chaveDoSegredo(undefined)).toBeNull();
    expect(chaveDoSegredo(12345)).toBeNull();
    expect(chaveDoSegredo(['whsec_x'])).toBeNull();
  });
});

describe('a assinatura (Standard Webhooks)', () => {
  it('confere com o exemplo do padrão: HMAC-SHA256 de "id.timestamp.corpo", em base64, com "v1,"', () => {
    // Vetor do próprio padrão (standardwebhooks.com).
    const chave = chaveDoSegredo('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw');
    expect(chave).not.toBeNull();
    const corpo = '{"test": 2432232314}';
    expect(assinarAviso(chave as Buffer, 'msg_p5jXN8AQM9LWM0D4loKWxJek', 1614265330, corpo)).toBe(
      'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
    );
  });

  it('os cabeçalhos levam o id, o instante em segundos e a assinatura do corpo exato', () => {
    const chave = randomBytes(32);
    const corpo = JSON.stringify({ tipo: 'pedido.alterado', id: ID, versao: 3 });
    const agora = new Date('2026-10-01T12:00:00.900Z');
    const h = cabecalhosDoAviso(chave, 'aviso-1', corpo, agora);
    expect(h['webhook-id']).toBe('aviso-1');
    expect(h['webhook-timestamp']).toBe('1790856000');
    expect(h['content-type']).toBe('application/json');
    const esperado = createHmac('sha256', chave).update(`aviso-1.1790856000.${corpo}`).digest('base64');
    expect(h['webhook-signature']).toBe(`v1,${esperado}`);
  });
});

describe('o corpo do aviso (contrato do Liame)', () => {
  it('cada recurso vira o evento do contrato', () => {
    expect(corpoDoAviso({ recurso: 'venda', id: ID, versao: 18 })).toEqual({ tipo: 'pedido.alterado', id: ID, versao: 18 });
    expect(corpoDoAviso({ recurso: 'cupom', id: ID, versao: 5 })).toEqual({ tipo: 'cupom.alterado', id: ID, versao: 5 });
    expect(corpoDoAviso({ recurso: 'cliente', id: ID, versao: 2 })).toEqual({ tipo: 'cliente.anonimizado', id: ID });
    expect(corpoDoAviso({ recurso: 'cupom_uso', id: ID, versao: 1, cupom_id: 'c', pedido_id: null })).toEqual({
      tipo: 'cupom.usado',
      id: ID,
      cupom_id: 'c',
      pedido_id: null,
    });
  });

  it('com a loja do token, o aviso diz de qual loja é (a conexão do cliente pode ter várias)', () => {
    const loja = '0199c0de-0000-7000-8000-000000000001';
    expect(corpoDoAviso({ recurso: 'venda', id: ID, versao: 18 }, loja)).toEqual({ tipo: 'pedido.alterado', id: ID, versao: 18, loja_id: loja });
    expect(corpoDoAviso({ recurso: 'cliente', id: ID, versao: 1 }, loja)).toEqual({ tipo: 'cliente.anonimizado', id: ID, loja_id: loja });
    expect(corpoDoAviso({ recurso: 'cupom_uso', id: ID, versao: 1, cupom_id: 'c', pedido_id: 'p' }, loja)).toEqual({
      tipo: 'cupom.usado',
      id: ID,
      cupom_id: 'c',
      pedido_id: 'p',
      loja_id: loja,
    });
    // Token da empresa inteira: sem o campo.
    expect(corpoDoAviso({ recurso: 'cupom', id: ID, versao: 2 }, null)).toEqual({ tipo: 'cupom.alterado', id: ID, versao: 2 });
  });

  it('retrato (catálogo e fichas): só o tipo e a loja — sem id nem versão (contrato do Farol)', () => {
    const loja = '0199c0de-0000-7000-8000-000000000001';
    expect(corpoDoAviso({ recurso: 'catalogo', id: null, versao: null }, loja)).toEqual({ tipo: 'catalogo.alterado', loja_id: loja });
    expect(corpoDoAviso({ recurso: 'fichas', id: null, versao: null }, loja)).toEqual({ tipo: 'fichas.alterado', loja_id: loja });
    expect(corpoDoAviso({ recurso: 'catalogo', id: null, versao: null }, null)).toEqual({ tipo: 'catalogo.alterado' });
  });

  it('todo retrato avisado pede um escopo de leitura na hora, que o Farol pode ter — e nenhum é do carimbador', () => {
    for (const r of Object.values(EVENTO_DO_RETRATO)) {
      expect(ESCOPOS_INTEGRACAO).toContain(r.escopo);
      expect(ESCOPOS_SEM_CARIMBO).toContain(r.escopo);
      expect(CLIENTES_INTEGRACAO.farol.escopos).toContain(r.escopo);
    }
    // Os nomes não se confundem com os dos recursos publicados (a busca do job junta os dois).
    for (const r of Object.keys(EVENTO_DO_RETRATO)) expect(Object.keys(EVENTO_DO_RECURSO)).not.toContain(r);
  });

  it('todo recurso avisado pede um escopo que existe e que o Liame pode ter', () => {
    for (const r of Object.values(EVENTO_DO_RECURSO)) {
      expect(ESCOPOS_INTEGRACAO).toContain(r.escopo);
      expect(CLIENTES_INTEGRACAO.liame.escopos).toContain(r.escopo);
    }
  });
});

describe('o que fazer com a resposta do destino', () => {
  it('2xx é entregue', () => {
    for (const status of [200, 202, 204]) {
      expect(desfechoDoEnvio({ status, falhasSeguidas: 4, falhandoHaSeg: 9999 })).toEqual({ resultado: 'entregue' });
    }
  });

  it('falha recua: 1, 2, 5, 15, 30 min e daí 1 h', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 50].map(recuoSeg)).toEqual([60, 120, 300, 900, 1800, 3600, 3600, 3600]);
    expect(recuoSeg(0)).toBe(60);
    expect(desfechoDoEnvio({ status: 500, falhasSeguidas: 0, falhandoHaSeg: null })).toEqual({ resultado: 'falha', recuoSeg: 60 });
    expect(desfechoDoEnvio({ status: null, falhasSeguidas: 2, falhandoHaSeg: 180 })).toEqual({ resultado: 'falha', recuoSeg: 300 });
  });

  it('redirecionamento, 401 e 429 são falha (nunca "entregue")', () => {
    for (const status of [301, 302, 307, 401, 403, 429]) {
      expect(desfechoDoEnvio({ status, falhasSeguidas: 0, falhandoHaSeg: null }).resultado).toBe('falha');
    }
  });

  it('404/410 só pausa depois de uma hora assim (a troca de versão do destino responde 404 por instantes)', () => {
    expect(desfechoDoEnvio({ status: 404, falhasSeguidas: 0, falhandoHaSeg: null }).resultado).toBe('falha');
    expect(desfechoDoEnvio({ status: 404, falhasSeguidas: 3, falhandoHaSeg: PAUSA_APOS_SUMICO_SEG - 1 }).resultado).toBe('falha');
    expect(desfechoDoEnvio({ status: 404, falhasSeguidas: 5, falhandoHaSeg: PAUSA_APOS_SUMICO_SEG }).resultado).toBe('pausa');
    expect(desfechoDoEnvio({ status: 410, falhasSeguidas: 5, falhandoHaSeg: PAUSA_APOS_SUMICO_SEG + 1 }).resultado).toBe('pausa');
  });

  it('qualquer falha por três dias seguidos pausa', () => {
    expect(desfechoDoEnvio({ status: 503, falhasSeguidas: 70, falhandoHaSeg: PAUSA_APOS_FALHA_SEG - 1 }).resultado).toBe('falha');
    expect(desfechoDoEnvio({ status: 503, falhasSeguidas: 70, falhandoHaSeg: PAUSA_APOS_FALHA_SEG }).resultado).toBe('pausa');
    expect(desfechoDoEnvio({ status: null, falhasSeguidas: 70, falhandoHaSeg: PAUSA_APOS_FALHA_SEG + 5 }).resultado).toBe('pausa');
  });
});
