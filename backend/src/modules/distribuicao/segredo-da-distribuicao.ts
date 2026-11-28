import { createHmac } from 'crypto';

/**
 * A chave que assina e confere o token do CONSOLE DA DISTRIBUIÇÃO — nunca a mesma das lojas.
 *
 * Rodada 7, MIS-G-01 (ERR-659): sem `DIST_JWT_SECRET`, o console assinava com o `JWT_SECRET` das lojas — um token do console
 * passava na assinatura do guarda das lojas e vice-versa (os outros campos é que barravam). Agora:
 *  - `DIST_JWT_SECRET` configurado e diferente do das lojas → é ela;
 *  - faltando (ou igual ao das lojas) → uma chave DERIVADA do das lojas por HMAC com um rótulo fixo: separa os dois sem exigir
 *    variável nova (a API não deixa de subir) e sem tela; quem tinha sessão aberta no console entra de novo uma vez.
 * Sem nenhuma das duas → vazio (assinar e conferir falham, como antes).
 */
export function segredoDaDistribuicao(env: NodeJS.ProcessEnv = process.env): string {
  const proprio = String(env.DIST_JWT_SECRET ?? '');
  const lojas = String(env.JWT_SECRET ?? '');
  if (proprio && proprio !== lojas) return proprio;
  if (!lojas) return '';
  return createHmac('sha256', lojas).update('regem:console-da-distribuicao:v1').digest('hex');
}
