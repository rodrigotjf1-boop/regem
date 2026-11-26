// A REDE NA BATIDA DO SERVIDOR (1.30.16; análise de rede de 25–26/11/2026). ESM puro, sem import: o teste avalia este
// arquivo como texto. O defeito daquela semana (35–50% das conexões novas sem resposta, até o roteador ser reiniciado)
// só foi visto porque alguém mediu. Agora o servidor manda na batida as duas taxas que funcionaram na medição, tiradas
// dos contadores TCP do próprio Windows (Win32_PerfRawData_Tcpip_TCPv4/v6 — números brutos, não dependem do idioma):
//   • aberturas que falharam: falhas de conexão ÷ aberturas ativas (no pico: 41%);
//   • retransmissão: segmentos retransmitidos ÷ enviados (no pico: 3,7%).
// Os contadores somam desde que o Windows ligou: a taxa é a DIFERENÇA entre duas batidas (a janela, ~1 min).

/** As quatro contagens, como o PowerShell da batida devolve (números ou textos de número). */
export function contadoresTcp(bruto) {
  if (!bruto || typeof bruto !== 'object') return null;
  const n = (v) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : null;
  };
  const c = { aberturas: n(bruto.abertas), falhas: n(bruto.falhas), enviados: n(bruto.enviados), retransmitidos: n(bruto.retransmitidos) };
  return Object.values(c).some((v) => v === null) ? null : c;
}

/**
 * As taxas entre a leitura anterior e a atual — ou null: sem anterior, janela curta demais ou contador que voltou
 * (o Windows reiniciou). Porcentagens com uma casa; sem abertura/envio na janela, a taxa é 0.
 */
export function taxasTcp(anterior, atual, msDecorridos) {
  if (!anterior || !atual || !(msDecorridos >= 5000)) return null;
  const d = {};
  for (const k of ['aberturas', 'falhas', 'enviados', 'retransmitidos']) {
    d[k] = atual[k] - anterior[k];
    if (!(d[k] >= 0)) return null;
  }
  const pct = (parte, total) => (total > 0 ? Math.round((parte / total) * 1000) / 10 : 0);
  return {
    aberturas: d.aberturas,
    falhas: d.falhas,
    falhasPct: pct(d.falhas, d.aberturas),
    enviados: d.enviados,
    retransmitidos: d.retransmitidos,
    retransmissaoPct: pct(d.retransmitidos, d.enviados),
    janelaS: Math.round(msDecorridos / 1000),
  };
}
