// Conferência rápida dos pedidos (ERR-280): a cada ~30 s o servidor da loja pergunta à nuvem quais pedidos desta loja
// ele precisa ter (id e versão) e pede PELO ID o que falta aqui ou está mais velho. Não depende do cursor do pull — o
// cursor anda pela data, e um pedido gravado com data anterior a ele nunca desceria por ele.
// Aqui ficam o ritmo e as decisões, sem rede nem banco (testável como texto, como o `sync-push-ritmo.mjs`).

export const PEDIDOS_INTERVALO_MS = 30000;
// Conferência falhando seguida: na 10ª (~5 min) vai para a telemetria — o pedido segue descendo pelo ciclo (≤ 1 min),
// mas a nuvem fica sabendo que a conferência parou.
export const FALHAS_ATE_AVISAR = 10;
// Nuvem sem a rota (404, antes do deploy): pergunta de novo em 10 min, sem encher o log.
export const PAUSA_SEM_ROTA_MS = 10 * 60 * 1000;
// Teto da lista e do pedido pelo id (os mesmos da nuvem).
export const LIMITE_LISTA = 500;
export const LIMITE_POR_ID = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Próxima conferência: o intervalo com ±20% — as lojas não batem juntas na nuvem.
export function proximaConferencia(base = PEDIDOS_INTERVALO_MS, sorteio = Math.random()) {
  return Math.round(Number(base) * (0.8 + Number(sorteio) * 0.4));
}

// Pode conferir agora? Devolve o motivo de esperar, ou null. Não enquanto o pull ou a restauração gravam (as duas
// transações disputariam as mesmas linhas), nem com o banco ainda sem a empresa (instalação nova antes da primeira carga:
// o pedido não teria a quem pertencer), nem na pausa depois de um 404. NÃO espera o pull dar certo: com o pull falhando,
// a conferência é o caminho que ainda traz o pedido.
export function motivoParaEsperar({ gravandoDaNuvem, bancoPronto, pausadoAte = 0, agora = Date.now() } = {}) {
  if (gravandoDaNuvem) return 'o pull está gravando';
  if (!bancoPronto) return 'o banco ainda não tem a empresa';
  if (Number(agora) < Number(pausadoAte)) return 'a nuvem ainda não tem a conferência';
  return null;
}

// A conferência falhou `seguidas` vezes sem parar: é a vez de avisar a telemetria? Uma vez por sequência.
export function avisarFalha(seguidas) {
  return Number(seguidas) === FALHAS_ATE_AVISAR;
}

// A lista da nuvem, saneada: id (uuid) e versão em texto, sem repetidos, até o teto. O resto é descartado em silêncio —
// a nuvem é a mesma que manda o pull.
export function listaDaNuvem(corpo, teto = LIMITE_LISTA) {
  const vistos = new Set();
  const ids = [];
  const versoes = [];
  for (const p of Array.isArray(corpo?.pedidos) ? corpo.pedidos : []) {
    const id = String(p?.id ?? '');
    const v = p?.v == null ? '' : String(p.v);
    if (!UUID.test(id) || !v || vistos.has(id)) continue;
    vistos.add(id);
    ids.push(id);
    versoes.push(v);
    if (ids.length >= teto) break;
  }
  return { ids, versoes };
}
