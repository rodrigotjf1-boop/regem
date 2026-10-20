import {
  ehPrivado,
  escolherPrincipal,
  historicoDoIp,
  interfacesIPv4,
  macLegivel,
  montarRede,
  pcsConectadosDaSaude,
  redeDaSaude,
  rotaPadrao,
} from './rede-local';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ENDEREÇO DO SERVIDOR DA LOJA NA REDE (conexão PC ↔ servidor, parte 1): as regras puras.
// Os PCs usam o IP da ROTA PADRÃO — a placa ligada ao roteador. Um adaptador virtual ou de VPN tem IP
// que nenhum PC da loja alcança; mostrar esse IP na tela mandaria o dono digitar o endereço errado.

// Saída real do `route print -4 0.0.0.0` num Windows em português (com cabeçalhos em latin1).
const ROTA_PT = `===========================================================================
Lista de interfaces
  8...0c cc 47 ec 36 f3 ......Realtek PCIe GbE Family Controller
  6...........................Tailscale Tunnel
  1...........................Software Loopback Interface 1
===========================================================================

Tabela de rotas IPv4
===========================================================================
Rotas ativas:
Endereço de rede          Máscara   Ender. gateway       Interface   Custo
          0.0.0.0          0.0.0.0    192.168.1.254     192.168.1.25     35
===========================================================================
Rotas persistentes:
  Nenhuma`;

const ROTA_EN = `IPv4 Route Table
===========================================================================
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0      192.168.0.1     192.168.0.10     25
          0.0.0.0          0.0.0.0      10.10.0.1       10.10.0.57       50
===========================================================================
Persistent Routes:
  Network Address          Netmask  Gateway Address  Metric
          0.0.0.0          0.0.0.0      192.168.0.1  Default`;

const interfaces = {
  Ethernet: [
    { address: 'fe80::1', family: 'IPv6', internal: false, mac: '3c:52:82:4a:19:7e', cidr: 'fe80::1/64' },
    { address: '192.168.0.10', family: 'IPv4', internal: false, mac: '3c:52:82:4a:19:7e', cidr: '192.168.0.10/24' },
  ],
  'VirtualBox Host-Only Network': [{ address: '192.168.56.1', family: 'IPv4', internal: false, mac: '0a:00:27:00:00:0d', cidr: '192.168.56.1/24' }],
  'Wi-Fi': [{ address: '169.254.10.20', family: 'IPv4', internal: false, mac: 'c0:35:32:c2:73:d7', cidr: '169.254.10.20/16' }],
  'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', family: 'IPv4', internal: true, mac: '00:00:00:00:00:00', cidr: '127.0.0.1/8' }],
} as any;

describe('a rota padrão do Windows (qualquer idioma)', () => {
  it('lê a linha de números do Windows em português', () => {
    expect(rotaPadrao(ROTA_PT)).toEqual({ gateway: '192.168.1.254', ip: '192.168.1.25' });
  });

  it('com cabo e Wi-Fi, vale a de menor custo; a rota persistente (sem placa) fica de fora', () => {
    expect(rotaPadrao(ROTA_EN)).toEqual({ gateway: '192.168.0.1', ip: '192.168.0.10' });
  });

  it('sem rota padrão (PC sem roteador) ou saída estranha: nada', () => {
    expect(rotaPadrao('Rotas ativas:\n  Nenhuma')).toBeNull();
    expect(rotaPadrao('')).toBeNull();
    expect(rotaPadrao(undefined as any)).toBeNull();
  });
});

describe('as placas e o IP que os PCs usam', () => {
  it('só IPv4 de verdade: sem loopback e sem 169.254 (placa que não recebeu IP)', () => {
    expect(interfacesIPv4(interfaces).map((i) => i.ip)).toEqual(['192.168.0.10', '192.168.56.1']);
    expect(interfacesIPv4(interfaces)[0]).toEqual({ nome: 'Ethernet', ip: '192.168.0.10', mac: '3C-52-82-4A-19-7E', prefixo: 24 });
  });

  it('o IP da rota padrão vence; sem rota, o privado que não parece virtual', () => {
    const ifs = interfacesIPv4(interfaces);
    expect(escolherPrincipal(ifs, { ip: '192.168.56.1' })?.ip).toBe('192.168.56.1'); // a rota manda
    expect(escolherPrincipal(ifs, null)?.ip).toBe('192.168.0.10'); // o VirtualBox fica de fora
    const soVirtual = interfacesIPv4({ 'vEthernet (WSL)': [{ address: '172.20.0.1', family: 'IPv4', internal: false, mac: '00:15:5d:00:00:01' }] } as any);
    expect(escolherPrincipal(soVirtual, null)?.ip).toBe('172.20.0.1'); // não havendo outro, mostra o que há
    expect(escolherPrincipal([], null)).toBeNull();
  });

  it('MAC como o roteador mostra; MAC zerado é nada', () => {
    expect(macLegivel('3c:52:82:4a:19:7e')).toBe('3C-52-82-4A-19-7E');
    expect(macLegivel('00:00:00:00:00:00')).toBeNull();
    expect(macLegivel('')).toBeNull();
  });

  it('faixas privadas', () => {
    expect(['10.0.0.5', '192.168.0.10', '172.16.0.1', '172.31.255.1'].every(ehPrivado)).toBe(true);
    expect(['172.32.0.1', '8.8.8.8', '169.254.1.1', 'regem.local'].some(ehPrivado)).toBe(false);
  });
});

describe('quando o roteador troca o IP do servidor', () => {
  const t0 = new Date('2026-10-17T22:02:00Z');
  it('a primeira medição não inventa "desde quando"', () => {
    expect(historicoDoIp(null, '192.168.0.23', t0)).toEqual({ ip: '192.168.0.23', desde: null, anterior: null });
  });

  it('IP novo: o de antes vira "anterior" e "desde" é agora; mesmo IP: nada muda', () => {
    const h1 = historicoDoIp({ ip: '192.168.0.23', desde: null, anterior: null }, '192.168.0.10', t0);
    expect(h1).toEqual({ ip: '192.168.0.10', desde: t0.toISOString(), anterior: '192.168.0.23' });
    expect(historicoDoIp(h1, '192.168.0.10', new Date())).toBe(h1);
  });

  it('placa sem rede naquele instante não é troca: mantém o histórico', () => {
    const h = { ip: '192.168.0.10', desde: t0.toISOString(), anterior: '192.168.0.23' };
    expect(historicoDoIp(h, null, new Date())).toBe(h);
  });

  it('a tela: IP, roteador, MAC, os outros IPs e o histórico só quando é do IP de agora', () => {
    const ifs = interfacesIPv4(interfaces);
    const r = montarRede({
      maquina: 'SERVIDOR-MB',
      interfaces: ifs,
      rota: { gateway: '192.168.0.1', ip: '192.168.0.10' },
      historico: { ip: '192.168.0.10', desde: t0.toISOString(), anterior: '192.168.0.23' },
      portas: { app: 3001, api: 3002 },
      agora: t0,
    });
    expect(r).toMatchObject({
      nome: 'regem.local',
      maquina: 'SERVIDOR-MB',
      ip: '192.168.0.10',
      interface: 'Ethernet',
      mac: '3C-52-82-4A-19-7E',
      gateway: '192.168.0.1',
      outros: [{ ip: '192.168.56.1', interface: 'VirtualBox Host-Only Network' }],
      desde: t0.toISOString(),
      anterior: '192.168.0.23',
    });
    // Histórico de OUTRO IP (a medição de agora escolheu outra placa): não se mistura.
    const outro = montarRede({ maquina: 'X', interfaces: ifs, rota: null, historico: { ip: '10.0.0.9', desde: t0.toISOString(), anterior: '10.0.0.8' }, portas: { app: 3001, api: 3002 }, agora: t0 });
    expect([outro.ip, outro.desde, outro.anterior, outro.gateway]).toEqual(['192.168.0.10', null, null, null]);
  });
});

describe('o que a nuvem mostra (saúde da batida)', () => {
  it('só os campos da tela, com tipo conferido; sem IP medido, nada', () => {
    const r = redeDaSaude({
      ip: '192.168.0.10', maquina: 'SERVIDOR-MB', mac: '3C-52-82-4A-19-7E', gateway: '192.168.0.1', interface: 'Ethernet',
      outros: [{ ip: '192.168.56.1', interface: 'VirtualBox' }, { lixo: true }], portas: { app: 3001, api: 99999 },
      desde: '2026-10-17T22:02:00Z', anterior: '192.168.0.23', medidoEm: '2026-10-20T03:00:00Z', segredo: 'não sai',
    });
    expect(r).toEqual({
      nome: 'regem.local', maquina: 'SERVIDOR-MB', ip: '192.168.0.10', interface: 'Ethernet', mac: '3C-52-82-4A-19-7E',
      gateway: '192.168.0.1', outros: [{ ip: '192.168.56.1', interface: 'VirtualBox' }], portas: { app: 3001, api: 3002 },
      desde: '2026-10-17T22:02:00.000Z', anterior: '192.168.0.23', medidoEm: '2026-10-20T03:00:00.000Z',
    });
    expect(redeDaSaude({ maquina: 'SEM-IP' })).toBeNull();
    expect(redeDaSaude(null)).toBeNull();
    expect(redeDaSaude('texto' as any)).toBeNull();
  });

  it('PCs conectados: IPs diferentes vistos nos últimos 3 min', () => {
    const agora = Date.parse('2026-10-20T03:00:00Z');
    const pcs = [
      { id: 'a', ip: '192.168.0.23', vistoEm: '2026-10-20T02:59:30Z' }, // estação do CX-DELIVERY
      { id: 'b', ip: '192.168.0.23', vistoEm: '2026-10-20T02:59:50Z' }, // o terminal do mesmo PC
      { id: 'c', ip: '192.168.0.21', vistoEm: '2026-10-20T02:58:00Z' },
      { id: 'd', ip: '192.168.0.30', vistoEm: '2026-10-20T02:50:00Z' }, // há 10 min: não conta
    ];
    expect(pcsConectadosDaSaude({ pcs }, agora)).toBe(2);
    expect(pcsConectadosDaSaude(null, agora)).toBe(0);
  });
});
