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

// Rodada 7, MIS-F-11 (ERR-658): o código que ABRE a página sem login vem no CAMINHO, não na consulta — o relatório e o PIN do
// Mister (`/publico/mister/relatorio/<código>`, `/publico/mister/link/<código>`) e o rastreio do pedido (`/rastreio/<token>`).
// Num 500, o log e a telemetria guardavam o código, e quem os lê abria a página. O token do cardápio é público: fica.
const CODIGO_NO_CAMINHO = /(\/(?:publico\/mister\/(?:relatorio|link)|rastreio)\/)[^/?#]+/gi;

export function urlParaLog(url: string | null | undefined): string {
  const bruto = String(url ?? '').replace(CODIGO_NO_CAMINHO, '$1***');
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
