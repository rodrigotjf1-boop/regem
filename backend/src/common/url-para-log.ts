/**
 * Endereço da requisição pronto para o log: tira o valor dos parâmetros que são credencial (senha do
 * robô, sessão do cliente, código) e encurta o telefone. O log de erro e a telemetria guardam o
 * endereço inteiro — sem isto, um 500 numa rota do robô gravava a senha que vale para todas as lojas.
 */
const CREDENCIAIS = new Set([
  'secret',
  'segredo',
  'token',
  'clientetoken',
  'ct',
  'senha',
  'password',
  'code',
  'codigo',
  'otp',
  'pin',
  'access_token',
  'hub.verify_token',
]);
const PESSOAIS = new Set(['telefone', 'para', 'numero', 'cpf', 'documento']);

export function urlParaLog(url: string | null | undefined): string {
  const bruto = String(url ?? '');
  const i = bruto.indexOf('?');
  if (i < 0) return bruto;
  const partes = bruto
    .slice(i + 1)
    .split('&')
    .map((par) => {
      const igual = par.indexOf('=');
      if (igual < 0) return par;
      const nome = par.slice(0, igual);
      let chave = nome;
      try {
        chave = decodeURIComponent(nome);
      } catch {
        /* nome malformado: compara como veio */
      }
      chave = chave.toLowerCase();
      if (CREDENCIAIS.has(chave)) return `${nome}=***`;
      if (PESSOAIS.has(chave)) {
        const valor = par.slice(igual + 1);
        return `${nome}=${valor.length > 4 ? `***${valor.slice(-4)}` : '***'}`;
      }
      return par;
    });
  return `${bruto.slice(0, i)}?${partes.join('&')}`;
}
