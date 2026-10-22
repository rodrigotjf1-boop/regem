import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CONFERÊNCIA RÁPIDA DOS PEDIDOS do servidor da loja (edge/sync-pedidos-rapido.mjs, ERR-280): a cada ~30 s, pelo id,
// sem depender do cursor do pull. O arquivo é ESM puro sem import (o jest roda em CommonJS): avaliado como texto — é
// exatamente o código que o daemon usa.
function carregar(arquivo: string): Record<string, any> {
  const fonte = readFileSync(join(__dirname, '..', '..', '..', 'edge', arquivo), 'utf8');
  const nomes = [...fonte.matchAll(/^export (?:const|async function|function) (\w+)/gm)].map((x) => x[1]);
  const corpo = fonte.replace(/^export (const|async function|function) /gm, '$1 ') + `\nreturn { ${nomes.join(', ')} };`;
  return new Function(corpo)();
}
const m = carregar('sync-pedidos-rapido.mjs');
const daemon = readFileSync(join(__dirname, '..', '..', '..', 'edge', 'sync-daemon.mjs'), 'utf8');
const ID = '3f9a1c2e-0b4d-4e5f-8a6b-7c8d9e0f1a2b';

describe('conferência rápida dos pedidos (edge/sync-pedidos-rapido.mjs)', () => {
  it('a cada 30 s, com ±20% para as lojas não baterem juntas', () => {
    expect(m.PEDIDOS_INTERVALO_MS).toBe(30000);
    expect(m.proximaConferencia(30000, 0)).toBe(24000);
    expect(m.proximaConferencia(30000, 0.5)).toBe(30000);
    expect(m.proximaConferencia(30000, 1)).toBe(36000);
  });

  it('espera o pull e a restauração gravarem, o banco ter a empresa e a pausa do 404 — e não espera o pull dar certo', () => {
    const pronto = { gravandoDaNuvem: false, bancoPronto: true, pausadoAte: 0, agora: 1000 };
    expect(m.motivoParaEsperar(pronto)).toBeNull();
    expect(m.motivoParaEsperar({ ...pronto, gravandoDaNuvem: true })).toMatch(/pull está gravando/);
    expect(m.motivoParaEsperar({ ...pronto, bancoPronto: false })).toMatch(/empresa/);
    expect(m.motivoParaEsperar({ ...pronto, pausadoAte: 5000 })).toMatch(/ainda não tem/);
    expect(m.motivoParaEsperar({ ...pronto, pausadoAte: 1000 })).toBeNull();
    // Com o pull falhando, a conferência é o caminho que ainda traz o pedido: não há condição de "pull ok".
    expect(m.motivoParaEsperar({ ...pronto, pullOk: false, falhasDoCiclo: 9 })).toBeNull();
  });

  it('avisa a telemetria uma vez por sequência de falhas, na 10ª', () => {
    expect(m.avisarFalha(1)).toBe(false);
    expect(m.avisarFalha(m.FALHAS_ATE_AVISAR - 1)).toBe(false);
    expect(m.avisarFalha(m.FALHAS_ATE_AVISAR)).toBe(true);
    expect(m.avisarFalha(m.FALHAS_ATE_AVISAR + 1)).toBe(false);
  });

  it('a lista da nuvem é saneada: só uuid com versão, sem repetidos, até o teto', () => {
    const corpo = {
      pedidos: [
        { id: ID, v: '2026-10-22 08:48:50.581643+00' },
        { id: ID, v: '2026-10-22 08:49:00+00' }, // repetido: vale o primeiro
        { id: 'nao-e-uuid', v: '2026-10-22 08:48:50+00' },
        { id: '5b1e2d3c-4a5f-4b6c-9d7e-8f9a0b1c2d3e' }, // sem versão
        { id: '6c2f3e4d-5b6a-4c7d-8e9f-0a1b2c3d4e5f', v: '2026-10-22 08:47:00+00' },
        null,
      ],
    };
    expect(m.listaDaNuvem(corpo)).toEqual({
      ids: [ID, '6c2f3e4d-5b6a-4c7d-8e9f-0a1b2c3d4e5f'],
      versoes: ['2026-10-22 08:48:50.581643+00', '2026-10-22 08:47:00+00'],
    });
    expect(m.listaDaNuvem({})).toEqual({ ids: [], versoes: [] });
    expect(m.listaDaNuvem(null)).toEqual({ ids: [], versoes: [] });
    expect(m.listaDaNuvem({ pedidos: 'x' })).toEqual({ ids: [], versoes: [] });
    const muitos = Array.from({ length: 3 }, (_, i) => ({ id: `0000000${i}-0000-4000-8000-000000000000`, v: 'x' }));
    expect(m.listaDaNuvem({ pedidos: muitos }, 2).ids).toHaveLength(2);
  });
});

describe('o daemon usa a conferência (edge/sync-daemon.mjs)', () => {
  it('importa o módulo e liga o laço ao lado do ciclo', () => {
    expect(daemon).toMatch(/from '\.\/sync-pedidos-rapido\.mjs'/);
    expect(daemon).toMatch(/\nagendarConferencia\(\);\s*$/);
  });

  it('o ciclo espera a conferência em curso e marca o pull e a restauração como "gravando"', () => {
    expect(daemon).toMatch(
      /if \(conferenciaEmCurso\) await conferenciaEmCurso;\s*gravandoDaNuvem = true;\s*try \{\s*p = await pull\(\);\s*\} finally \{\s*gravandoDaNuvem = false;\s*\}/,
    );
    expect(daemon).toMatch(
      /if \(conferenciaEmCurso\) await conferenciaEmCurso;\s*gravandoDaNuvem = true;[^\n]*\n\s*try \{\s*await restaurarSnapshot\(\);/,
    );
  });

  it('o pedido que a loja já tocou não é escolhido nem sobrescrito: a trava vai na escolha E na gravação', () => {
    expect(daemon).toMatch(/const PEDIDO_AINDA_NAO_TOCADO = "pedido_externo\.status = 'novo' and pedido_externo\.comanda_id is null";/);
    expect(daemon).toMatch(/or \(pedido_externo\.updated_at < x\.v and \$\{PEDIDO_AINDA_NAO_TOCADO\}\)/);
    expect((daemon.match(/upsertLocal\('pedido_externo', [^\n]*PEDIDO_AINDA_NAO_TOCADO\)/g) ?? []).length).toBe(2);
  });

  it('a gravação da conferência nunca mexe no cursor nem fecha a reconciliação (é um pedaço do pull, não o pull)', () => {
    const corpo = daemon.slice(daemon.indexOf('async function gravarPedidosDaNuvem('), daemon.indexOf('async function contarForaDoCursor('));
    expect(corpo.length).toBeGreaterThan(200);
    expect(corpo).not.toMatch(/gravarEstadoNa|setState\(|pull_cursor|concluirPull|registrarAusentes|aplicarExclusoes/);
    // Cliente e pagamento: só cria o que falta (sobrescrever desfaria o que a loja mudou e não subiu).
    expect(corpo).toMatch(/await criar\('cliente', tabelas\.cliente\)/);
    expect(corpo).toMatch(/await criar\('pedido_externo_pagamento', tabelas\.pedido_externo_pagamento\)/);
    expect(corpo).toMatch(/inserirSeFaltar\(tabela, row, cli\)/);
  });
});
