import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CONEXÃO PC ↔ SERVIDOR, parte 2 — achar o servidor da loja quando o roteador troca o IP dele.
// 20/10/2026: o PC do delivery parou de achar o servidor depois de uma atualização; o servidor nem
// sempre tem IP fixo no roteador (DHCP). A estação de cada PC procura nesta ordem: o endereço
// configurado → regem.local → o último IP que funcionou → o IP que o servidor informou à nuvem → a
// rede deste PC; e anota regem.local no hosts do Windows quando o nome não resolve (decisão D2).
//
// edge/achar-servidor.mjs é ESM puro sem import (o jest roda em CommonJS): avaliado como texto —
// é exatamente o código que a estação usa.
function carregar(): Record<string, any> {
  const fonte = readFileSync(join(__dirname, '..', '..', '..', 'edge', 'achar-servidor.mjs'), 'utf8');
  const nomes = [...fonte.matchAll(/^export (?:const|async function|function) (\w+)/gm)].map((m) => m[1]);
  const corpo = fonte.replace(/^export (const|async function|function) /gm, '$1 ') + `\nreturn { ${nomes.join(', ')} };`;
  return new Function(corpo)();
}
const m = carregar();

describe('achar o servidor da loja (edge/achar-servidor.mjs)', () => {
  it('os endereços rápidos: configurado → regem.local → último IP, sem repetir', () => {
    expect(m.candidatosRapidos({ configurado: '192.168.0.23', ultimoIp: '192.168.0.30' })).toEqual([
      { host: '192.168.0.23', como: 'configurado' },
      { host: 'regem.local', como: 'nome' },
      { host: '192.168.0.30', como: 'ultimo-ip' },
    ]);
    // O configurado já é o nome (o padrão do instalador): testado uma vez só.
    expect(m.candidatosRapidos({ configurado: 'REGEM.local', ultimoIp: null })).toEqual([{ host: 'regem.local', como: 'configurado' }]);
    expect(m.candidatosRapidos({ configurado: '192.168.0.23', ultimoIp: '192.168.0.23' })).toHaveLength(2);
  });

  it('a rede deste PC: a faixa /24 de cada placa privada, sem o próprio IP, loopback, 169.254 e IPv6', () => {
    const rede = m.enderecosDaRede({
      Ethernet: [
        { address: '192.168.0.50', family: 'IPv4', internal: false },
        { address: 'fe80::1', family: 'IPv6', internal: false },
      ],
      'Wi-Fi': [{ address: '10.0.5.7', family: 4, internal: false }], // Node 18.0–18.3 dava a família em número
      Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      APIPA: [{ address: '169.254.10.2', family: 'IPv4', internal: false }],
      VPN: [{ address: '200.150.1.9', family: 'IPv4', internal: false }], // público: não se varre
    });
    expect(rede).toHaveLength(253 * 2);
    expect(rede).toContain('192.168.0.1');
    expect(rede).toContain('192.168.0.254');
    expect(rede).not.toContain('192.168.0.50');
    expect(rede).toContain('10.0.5.1');
    expect(rede.some((ip: string) => ip.startsWith('127.') || ip.startsWith('169.254.') || ip.startsWith('200.'))).toBe(false);
    expect(m.enderecosDaRede({ a: [{ address: '172.16.3.4', family: 'IPv4' }] }, 10)).toHaveLength(10);
    expect(m.enderecosDaRede({ a: [{ address: '172.32.3.4', family: 'IPv4' }] })).toEqual([]); // 172.32 não é privado
  });

  it('o endereço digitado na emergência: limpa esquema, porta e caminho; recusa o que não é endereço', () => {
    expect(m.enderecoDigitado(' https://192.168.0.30:3001/balcao ')).toBe('192.168.0.30');
    expect(m.enderecoDigitado('Regem.Local')).toBe('regem.local');
    expect(m.enderecoDigitado('servidor-mb')).toBe('servidor-mb');
    for (const ruim of ['', '999.1.1.1', '192.168.0', 'a b', '-x', 'x_y', null]) expect(m.enderecoDigitado(ruim)).toBeNull();
  });

  describe('a busca', () => {
    const testadorQueAceita = (bons: string[]) => {
      const testados: string[] = [];
      return {
        testados,
        testar: async (h: string) => {
          testados.push(h);
          return bons.includes(h);
        },
      };
    };

    it('o configurado respondeu: para ali', async () => {
      const t = testadorQueAceita(['regem.local']);
      const r = await m.acharServidor({ configurado: 'regem.local', ultimoIp: '192.168.0.23', testar: t.testar, rede: ['192.168.0.1'] });
      expect(r).toMatchObject({ host: 'regem.local', como: 'configurado' });
      expect(t.testados).toEqual(['regem.local']);
    });

    it('o nome não resolve e o IP mudou: acha pelo IP que o servidor informou à nuvem', async () => {
      const t = testadorQueAceita(['192.168.0.31']);
      const r = await m.acharServidor({ configurado: 'regem.local', ultimoIp: '192.168.0.23', nuvem: async () => '192.168.0.31', testar: t.testar, rede: [] });
      expect(r).toMatchObject({ host: '192.168.0.31', como: 'nuvem' });
      expect(t.testados).toEqual(['regem.local', '192.168.0.23', '192.168.0.31']);
      expect(r.passos.map((p: any) => `${p.como}:${p.ok}`)).toEqual(['configurado:false', 'ultimo-ip:false', 'nuvem:true']);
    });

    it('sem internet (a nuvem não responde): varre a rede em lotes e para no primeiro que responde', async () => {
      const t = testadorQueAceita(['192.168.0.77']);
      const rede = Array.from({ length: 254 }, (_, i) => `192.168.0.${i + 1}`);
      const r = await m.acharServidor({
        configurado: 'regem.local',
        nuvem: async () => { throw new Error('sem internet'); },
        testar: t.testar,
        rede,
        emParalelo: 32,
      });
      expect(r).toMatchObject({ host: '192.168.0.77', como: 'varredura' });
      // Lotes de 32: o 77 está no 3º lote — os lotes seguintes não são testados.
      expect(t.testados.filter((h) => h.startsWith('192.168.0.'))).toHaveLength(96);
      expect(r.passos.at(-1)).toMatchObject({ como: 'varredura', ok: true, procurados: 96 });
    });

    it('o IP da nuvem já testado não é testado de novo; quem responde sem ser o servidor não vale', async () => {
      const t = testadorQueAceita([]); // o "impostor" da rede não passa no certificado da loja
      const r = await m.acharServidor({ configurado: '192.168.0.23', nuvem: async () => '192.168.0.23', testar: t.testar, rede: ['192.168.0.5', '192.168.0.23'] });
      expect(r.host).toBeNull();
      expect(t.testados).toEqual(['192.168.0.23', 'regem.local', '192.168.0.5']);
      expect(r.passos.at(-1)).toMatchObject({ como: 'varredura', host: null, ok: false, procurados: 1 });
    });

    it('nunca rejeita: o teste que lança vale como "não respondeu"; os passos chegam ao vivo na lista', async () => {
      const passos: any[] = [];
      const r = await m.acharServidor({
        configurado: 'regem.local',
        testar: async (h: string) => {
          if (h === 'regem.local') throw new Error('ENOTFOUND');
          return h === '10.0.0.9';
        },
        rede: ['10.0.0.9'],
        passos,
      });
      expect(r.host).toBe('10.0.0.9');
      expect(r.passos).toBe(passos);
      expect(passos[0]).toEqual({ como: 'configurado', host: 'regem.local', ok: false });
    });
  });

  describe('o arquivo hosts do Windows (decisão D2: só a linha do Regem)', () => {
    const original = [
      '# Copyright (c) 1993-2009 Microsoft Corp.',
      '#',
      '# localhost name resolution is handled within DNS itself.',
      '#\t127.0.0.1       localhost',
      '10.1.1.1 intranet.empresa',
      '',
    ].join('\r\n');

    it('acrescenta a linha do Regem, mantém o resto e o CRLF', () => {
      const novo = m.hostsComServidor(original, '192.168.0.31');
      expect(novo.startsWith(original.trimEnd())).toBe(true);
      expect(novo).toMatch(/\r\n192\.168\.0\.31 regem\.local # regem: servidor da loja \(anotado pela estacao\)\r\n$/);
      expect(novo.split('\r\n').filter((l: string) => l.includes(m.MARCA_HOSTS))).toHaveLength(1);
      expect(m.ipNoHosts(novo)).toBe('192.168.0.31');
    });

    it('o IP mudou de novo: troca a linha do Regem, sem repetir; a segunda vez não muda nada', () => {
      const uma = m.hostsComServidor(original, '192.168.0.31');
      const duas = m.hostsComServidor(uma, '192.168.0.44');
      expect(duas.split('\r\n').filter((l: string) => l.includes('regem.local'))).toEqual([
        `192.168.0.44 regem.local ${m.MARCA_HOSTS}`,
      ]);
      expect(m.hostsComServidor(duas, '192.168.0.44')).toBe(duas);
    });

    it('a linha de regem.local escrita à mão (IP velho) fica comentada — o Windows usaria a dela', () => {
      const comManual = `${original}192.168.0.23   regem.local\r\n`;
      const novo = m.hostsComServidor(comManual, '192.168.0.31');
      expect(novo).toContain(`# 192.168.0.23   regem.local ${m.MARCA_DESATIVADA}`);
      expect(novo).toContain('10.1.1.1 intranet.empresa'); // a de outro nome fica
      expect(m.ipNoHosts(novo)).toBe('192.168.0.31');
      // Já comentada: não comenta de novo.
      expect(m.hostsComServidor(novo, '192.168.0.31')).toBe(novo);
    });

    it('tirar a linha do Regem deixa o resto; IP inválido não entra; arquivo vazio funciona', () => {
      const com = m.hostsComServidor(original, '192.168.0.31');
      expect(m.hostsSemServidor(com)).toBe(original);
      expect(() => m.hostsComServidor(original, 'regem.local')).toThrow();
      expect(m.hostsComServidor('', '10.0.0.2')).toBe(`10.0.0.2 regem.local ${m.MARCA_HOSTS}\n`);
      expect(m.ipNoHosts('192.168.0.23 regem.local')).toBeNull(); // só a linha COM a marca é do Regem
    });
  });
});
