import { createHash } from 'crypto';

// Limite de requisições POR DISPOSITIVO para as rotas da fila de impressão.
//
// O limite global é por IP (120/min). Numa loja com vários caixas na mesma internet, os
// agentes de impressão + o sync + o próprio app dividem esse balde — e a impressão parava
// calada no 429. Trocar a chave do limite para o TOKEN abriria uma brecha: cada token
// inventado ganharia um balde novo. Por isso:
//  • o SyncTokenGuard registra aqui o token que ELE validou no banco;
//  • o CfThrottlerGuard só isenta do limite por IP as rotas de impressão com token JÁ
//    validado (desconhecido continua limitado por IP, como sempre);
//  • esses tokens passam a ter o limite próprio abaixo, por dispositivo.
// Em memória por processo: é proteção de carga, não de segurança (a autenticação continua
// sendo o SyncTokenGuard em toda requisição).

const VALIDADE_MS = 10 * 60 * 1000;
const JANELA_MS = 60 * 1000;
export const LIMITE_POR_MINUTO = 240;

const validados = new Map<string, number>(); // hash do token → validado até
const contagem = new Map<string, { inicio: number; n: number }>();

const hash = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 32);

export function registrarTokenValidado(token: string) {
  validados.set(hash(token), Date.now() + VALIDADE_MS);
  if (validados.size > 50_000) limparVencidos();
}

export function tokenJaValidado(token: string | undefined | null): boolean {
  if (!token) return false;
  const ate = validados.get(hash(String(token)));
  return !!ate && ate > Date.now();
}

// true = dentro do limite. Janela fixa de 1 minuto por dispositivo.
export function dentroDoLimite(equipamentoId: string): boolean {
  const agora = Date.now();
  const c = contagem.get(equipamentoId);
  if (!c || agora - c.inicio >= JANELA_MS) {
    contagem.set(equipamentoId, { inicio: agora, n: 1 });
    if (contagem.size > 50_000) limparVencidos();
    return true;
  }
  c.n++;
  return c.n <= LIMITE_POR_MINUTO;
}

function limparVencidos() {
  const agora = Date.now();
  for (const [k, ate] of validados) if (ate <= agora) validados.delete(k);
  for (const [k, c] of contagem) if (agora - c.inicio >= JANELA_MS) contagem.delete(k);
}

// Rotas cobertas: a fila de impressão consumida pelo agente (não as rotas de gestão).
export function rotaDaFilaDeImpressao(url: string | undefined): boolean {
  return /\/impressao\/(pendentes|[0-9a-f-]{36}\/(impresso|erro|devolver))(\?|$)/i.test(String(url ?? ''));
}
