// Consulta a EXISTÊNCIA/situação de um CNPJ na Receita Federal via BrasilAPI
// (endpoint público, sem chave). Usado no cadastro self-service da landing para
// barrar CNPJ com dígitos válidos mas inexistente.
//
// Política deliberada: só retorna 'nao_existe' quando a API responde 404 (CNPJ
// realmente não encontrado). Qualquer erro de rede/limite/timeout → 'indeterminado'
// → o chamador NÃO bloqueia o cadastro (não punir o cliente por indisponibilidade
// de um serviço externo). O CNPJ já passou pelo checksum antes desta consulta.

export type ReceitaResultado = {
  estado: 'existe' | 'nao_existe' | 'indeterminado';
  situacao?: string; // ex.: "ATIVA", "BAIXADA"
  razaoSocial?: string;
};

export async function consultarCnpjReceita(cnpj: unknown, timeoutMs = 4000): Promise<ReceitaResultado> {
  const c = String(cnpj ?? '').replace(/\D/g, '');
  if (!/^\d{14}$/.test(c)) return { estado: 'indeterminado' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Host fixo e confiável; `c` é só dígitos (sanitizado acima) → sem risco de SSRF/injeção.
    // User-Agent é OBRIGATÓRIO: sem ele a BrasilAPI responde 403 (proteção anti-bot).
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${c}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Regem/1.0 (+https://dmsregem.com)', Accept: 'application/json' },
    });
    if (res.status === 404) return { estado: 'nao_existe' };
    if (!res.ok) return { estado: 'indeterminado' };
    const j: any = await res.json().catch(() => null); // eslint-disable-line @typescript-eslint/no-explicit-any
    return {
      estado: 'existe',
      situacao: j?.descricao_situacao_cadastral ?? j?.situacao_cadastral ?? undefined,
      razaoSocial: j?.razao_social ?? undefined,
    };
  } catch {
    return { estado: 'indeterminado' }; // timeout/rede → não bloqueia
  } finally {
    clearTimeout(t);
  }
}
