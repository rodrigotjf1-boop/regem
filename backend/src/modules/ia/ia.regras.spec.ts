import {
  FALHA_QUE_MARCA_A_CHAVE,
  PRECOS_POR_MILHAO,
  classificarFalha,
  custoEstimadoUsd,
  ehProvedorAceito,
  finalDaChave,
  lerUso,
  motivoDaChaveInvalida,
  periodoDoUso,
} from './ia.regras';

// IA POR EMPRESA (mig 415) — as regras puras: o formato da chave, o que cada recusa do provedor quer dizer (pela
// documentação da Anthropic), o consumo de uma chamada, o custo estimado e o período do medidor.

const BOA = `sk-ant-api03-${'a'.repeat(60)}ZZ99`;

describe('a chave colada', () => {
  it('o formato da Anthropic passa; o que não é chave leva a frase do que há de errado', () => {
    expect(motivoDaChaveInvalida('anthropic', BOA)).toBeNull();
    expect(motivoDaChaveInvalida('anthropic', '')).toBe('Cole a chave de IA.');
    expect(motivoDaChaveInvalida('anthropic', `sk-ant-api03-${'a'.repeat(30)} ${'a'.repeat(30)}`)).toContain('espaço');
    expect(motivoDaChaveInvalida('anthropic', `${BOA}\nresto`)).toContain('quebra de linha');
    expect(motivoDaChaveInvalida('anthropic', 'sk-ant-api03-curta')).toContain('incompleta');
    expect(motivoDaChaveInvalida('anthropic', `sk-ant-${'a'.repeat(500)}`)).toContain('incompleta');
    expect(motivoDaChaveInvalida('anthropic', `sk-proj-${'a'.repeat(60)}`)).toContain('começa com "sk-ant-"');
  });

  it('a chave de administração da conta é recusada: o Regem só usa a chave comum', () => {
    expect(motivoDaChaveInvalida('anthropic', `sk-ant-admin01-${'a'.repeat(60)}`)).toContain('chave de administração');
  });

  it('nenhuma frase repete a chave', () => {
    for (const ruim of [`sk-proj-${'q'.repeat(60)}`, `sk-ant-admin01-${'q'.repeat(60)}`, `sk-ant-api03-${'q'.repeat(30)} ${'q'.repeat(30)}`])
      expect(motivoDaChaveInvalida('anthropic', ruim)).not.toContain('qqqq');
  });

  it('os 4 últimos caracteres identificam a chave salva', () => {
    expect(finalDaChave(BOA)).toBe('ZZ99');
  });

  it('só a Anthropic é aceita hoje', () => {
    expect(ehProvedorAceito('anthropic')).toBe(true);
    for (const p of ['openai', 'gemini', '', null, undefined, 'Anthropic ']) expect(ehProvedorAceito(p)).toBe(false);
  });
});

describe('o que a recusa do provedor quer dizer', () => {
  it('401 e 403: a chave foi recusada', () => {
    expect(classificarFalha({ status: 401, tipo: 'authentication_error', mensagem: 'invalid x-api-key' })).toBe('chave_recusada');
    expect(classificarFalha({ status: 403, tipo: 'permission_error' })).toBe('chave_recusada');
  });

  it('402 e o 400 de saldo: sem crédito', () => {
    expect(classificarFalha({ status: 402, tipo: 'billing_error' })).toBe('sem_credito');
    expect(classificarFalha({ status: 400, tipo: 'invalid_request_error', mensagem: 'Your credit balance is too low to access the Anthropic API.' })).toBe('sem_credito');
  });

  it('o teto que o dono da conta definiu (400) e o teto do nível da conta (429 com o código) são "teto atingido"', () => {
    expect(classificarFalha({ status: 400, mensagem: 'You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.' })).toBe('teto_atingido');
    expect(classificarFalha({ status: 400, mensagem: 'You have reached your specified workspace API usage limits.' })).toBe('teto_atingido');
    expect(classificarFalha({ status: 429, tipo: 'rate_limit_error', codigo: 'enforced_spend_limit_reached' })).toBe('teto_atingido');
  });

  it('os outros 429 passam sozinhos: limite por minuto (também a subida brusca)', () => {
    expect(classificarFalha({ status: 429, tipo: 'rate_limit_error' })).toBe('limite_por_minuto');
    expect(classificarFalha({ status: 429, codigo: 'ramp_limit_exceeded' })).toBe('limite_por_minuto');
  });

  it('os outros 4xx são defeito do pedido; 5xx, 529 e sem status são o provedor fora', () => {
    expect(classificarFalha({ status: 400, mensagem: 'max_tokens: Field required' })).toBe('pedido_invalido');
    for (const s of [404, 409, 413, 422]) expect(classificarFalha({ status: s })).toBe('pedido_invalido');
    for (const s of [500, 504, 529]) expect(classificarFalha({ status: s })).toBe('indisponivel');
    expect(classificarFalha({ status: null, mensagem: 'Connection error.' })).toBe('indisponivel');
    expect(classificarFalha({})).toBe('indisponivel');
  });

  it('só o que diz algo da CHAVE muda a situação guardada', () => {
    expect([...FALHA_QUE_MARCA_A_CHAVE].sort()).toEqual(['chave_recusada', 'sem_credito', 'teto_atingido']);
  });
});

describe('o consumo e o custo estimado', () => {
  it('lê o `usage` da resposta; campo ausente, nulo ou estranho vale zero', () => {
    expect(lerUso({ input_tokens: 120, output_tokens: 30, cache_creation_input_tokens: 5, cache_read_input_tokens: 900 })).toEqual({ entrada: 120, cacheEscrita: 5, cacheLeitura: 900, saida: 30 });
    expect(lerUso({ input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: null, cache_read_input_tokens: null })).toEqual({ entrada: 10, cacheEscrita: 0, cacheLeitura: 0, saida: 2 });
    expect(lerUso(undefined)).toEqual({ entrada: 0, cacheEscrita: 0, cacheLeitura: 0, saida: 0 });
    expect(lerUso({ input_tokens: -5, output_tokens: 'x' })).toEqual({ entrada: 0, cacheEscrita: 0, cacheLeitura: 0, saida: 0 });
  });

  it('o custo sai da tabela de preços por milhão de tokens', () => {
    const milhao = { entrada: 1_000_000, cacheEscrita: 1_000_000, cacheLeitura: 1_000_000, saida: 1_000_000 };
    expect(custoEstimadoUsd('claude-haiku-5-5', milhao)).toBeCloseTo(0.1 + 0.125 + 0.01 + 0.5, 6);
    expect(custoEstimadoUsd('claude-sonnet-5-5', milhao)).toBeCloseTo(2 + 2.5 + 0.1 + 10, 6);
    expect(custoEstimadoUsd('claude-opus-5-5', milhao)).toBeCloseTo(4 + 5 + 0.2 + 20, 6);
    // a pergunta simples da estimativa do plano: 13 mil de entrada e 1,5 mil de saída no Haiku
    expect(custoEstimadoUsd('claude-haiku-5-5', { entrada: 13_000, cacheEscrita: 0, cacheLeitura: 0, saida: 1_500 })).toBeCloseTo(0.00205, 6);
  });

  it('modelo fora da tabela não ganha preço inventado', () => {
    expect(custoEstimadoUsd('modelo-que-nao-existe', { entrada: 1000, cacheEscrita: 0, cacheLeitura: 0, saida: 1000 })).toBeNull();
    expect(Object.keys(PRECOS_POR_MILHAO).sort()).toEqual(['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5']);
  });
});

describe('o período do medidor', () => {
  const HOJE = '2026-11-12';

  it('sem datas: os últimos 30 dias até hoje', () => {
    expect(periodoDoUso(undefined, undefined, HOJE)).toEqual({ de: '2026-10-14', ate: '2026-11-12' });
    expect(periodoDoUso('', '', HOJE)).toEqual({ de: '2026-10-14', ate: '2026-11-12' });
  });

  it('só o fim: 30 dias até ele; as duas datas: como vieram', () => {
    expect(periodoDoUso(undefined, '2026-03-01', HOJE)).toEqual({ de: '2026-01-31', ate: '2026-03-01' });
    expect(periodoDoUso('2026-11-01', '2026-11-05', HOJE)).toEqual({ de: '2026-11-01', ate: '2026-11-05' });
  });

  it('data que não existe, ordem trocada e período maior que um ano: a frase do erro', () => {
    expect(periodoDoUso('2026-02-30', '2026-03-01', HOJE)).toEqual({ erro: 'A data inicial não é uma data válida.' });
    expect(periodoDoUso('2026-11-01', "2026-11-05'; drop table x", HOJE)).toEqual({ erro: 'A data final não é uma data válida.' });
    expect(periodoDoUso('2026-11-06', '2026-11-05', HOJE)).toEqual({ erro: 'A data inicial vem depois da final.' });
    expect(periodoDoUso('2024-01-01', '2026-11-05', HOJE)).toEqual({ erro: 'Escolha um período de até um ano.' });
  });
});
