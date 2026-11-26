'use strict';

// O PESO DA PONTE NO PC (0.7.9). Pedido do dono em 25/11/2026: "como verificar o peso da ponte do chat, está usando muito
// processador e memória". A ponte soma os processos dela (o principal, uma página por janela — o Gestor do iFood e a 99 —,
// o de vídeo e os utilitários) pelo `app.getAppMetrics()` e grava no resumo (`estado-da-ponte.json`): dá para acompanhar
// ao longo do turno, sem depender de uma amostra solta do Gerenciador de Tarefas.
//
// `percentCPUUsage` do Electron é a porcentagem de UM núcleo desde a leitura anterior; o Gerenciador de Tarefas mostra a
// porcentagem da MÁQUINA — por isso divide pelos núcleos. `workingSetSize` vem em KB.

/**
 * @param {{ type: string, cpu?: { percentCPUUsage?: number }, memory?: { workingSetSize?: number } }[]} metricas
 * @param {number} nucleos núcleos lógicos do PC (`os.cpus().length`)
 */
function pesoDasMetricas(metricas, nucleos) {
  const lista = Array.isArray(metricas) ? metricas : [];
  const n = Math.max(1, Number(nucleos) || 1);
  const porTipo = {};
  let cpu = 0;
  let memKb = 0;
  for (const m of lista) {
    const c = Number(m && m.cpu && m.cpu.percentCPUUsage) || 0;
    const k = Number(m && m.memory && m.memory.workingSetSize) || 0;
    cpu += c;
    memKb += k;
    const t = String((m && m.type) || 'outro');
    const g = (porTipo[t] = porTipo[t] || { processos: 0, cpuPct: 0, memoriaMb: 0 });
    g.processos += 1;
    g.cpuPct += c / n;
    g.memoriaMb += k / 1024;
  }
  const r1 = (x) => Math.round(x * 10) / 10;
  for (const g of Object.values(porTipo)) {
    g.cpuPct = r1(g.cpuPct);
    g.memoriaMb = Math.round(g.memoriaMb);
  }
  return { processos: lista.length, cpuPct: r1(cpu / n), memoriaMb: Math.round(memKb / 1024), nucleos: n, porTipo };
}

module.exports = { pesoDasMetricas };
