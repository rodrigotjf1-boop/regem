import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A REDE NA BATIDA DO SERVIDOR (edge/tcp-taxas.mjs, 1.30.16 — análise de rede de 25–26/11/2026). O defeito daquela semana
// só foi visto porque alguém mediu; agora o servidor manda as taxas de aberturas que falharam e de retransmissão, pelos
// contadores TCP do Windows, e o vigia alerta (rede_instavel). O arquivo é ESM puro sem import: avaliado como texto.
const EDGE = join(__dirname, '..', '..', '..', 'edge');
function carregar(): Record<string, any> {
  const fonte = readFileSync(join(EDGE, 'tcp-taxas.mjs'), 'utf8');
  const nomes = [...fonte.matchAll(/^export (?:const|async function|function) (\w+)/gm)].map((m) => m[1]);
  const corpo = fonte.replace(/^export (const|async function|function) /gm, '$1 ') + `\nreturn { ${nomes.join(', ')} };`;
  return new Function(corpo)();
}
const t = carregar();

describe('as taxas TCP da batida (edge/tcp-taxas.mjs)', () => {
  it('lê os contadores como o PowerShell devolve; faltando ou torto, null', () => {
    expect(t.contadoresTcp({ abertas: 207482, falhas: '46386', enviados: 45341070, retransmitidos: 63985 })).toEqual({
      aberturas: 207482, falhas: 46386, enviados: 45341070, retransmitidos: 63985,
    });
    expect(t.contadoresTcp({ abertas: 1, falhas: 0, enviados: 5 })).toBeNull();
    expect(t.contadoresTcp({ abertas: -1, falhas: 0, enviados: 5, retransmitidos: 0 })).toBeNull();
    expect(t.contadoresTcp(null)).toBeNull();
  });

  it('a taxa é a diferença entre duas batidas: o pico de 25/11 (41% e 3,7%) e a rede boa (0%)', () => {
    const antes = { aberturas: 1000, falhas: 100, enviados: 200000, retransmitidos: 1000 };
    expect(t.taxasTcp(antes, { aberturas: 1100, falhas: 141, enviados: 210000, retransmitidos: 1370 }, 60_000)).toEqual({
      aberturas: 100, falhas: 41, falhasPct: 41, enviados: 10000, retransmitidos: 370, retransmissaoPct: 3.7, janelaS: 60,
    });
    expect(t.taxasTcp(antes, { aberturas: 1120, falhas: 100, enviados: 205000, retransmitidos: 1000 }, 61_000)).toMatchObject({
      falhasPct: 0, retransmissaoPct: 0, janelaS: 61,
    });
    // janela sem abertura nem envio: taxa 0 (não divide por zero)
    expect(t.taxasTcp(antes, antes, 60_000)).toMatchObject({ aberturas: 0, falhasPct: 0, retransmissaoPct: 0 });
  });

  it('sem leitura anterior, janela curta ou contador que voltou (o Windows reiniciou): null — sem taxa inventada', () => {
    const atual = { aberturas: 10, falhas: 1, enviados: 100, retransmitidos: 0 };
    expect(t.taxasTcp(null, atual, 60_000)).toBeNull();
    expect(t.taxasTcp(atual, atual, 1000)).toBeNull();
    expect(t.taxasTcp({ aberturas: 5000, falhas: 1, enviados: 9999, retransmitidos: 0 }, atual, 60_000)).toBeNull();
  });

  it('o daemon lê os contadores na MESMA chamada do PowerShell da batida e manda as taxas em saude.tcp', () => {
    const daemon = readFileSync(join(EDGE, 'sync-daemon.mjs'), 'utf8');
    expect(daemon).toContain('Win32_PerfRawData_Tcpip_TCPv4');
    expect(daemon).toContain('Win32_PerfRawData_Tcpip_TCPv6');
    expect(daemon).toMatch(/discoLivreMb=\$d;tcp=\$tcp\}\|ConvertTo-Json -Compress/);
    expect(daemon).toMatch(/tcp: contadoresTcp\(o\.tcp\)/);
    expect(daemon).toMatch(/saude\.tcp = taxasTcp\(tcpAnterior\?\.contadores, sd\.tcp, /);
  });
});
