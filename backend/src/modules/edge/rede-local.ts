import { execFile } from 'node:child_process';
import type { NetworkInterfaceInfo } from 'node:os';

// O ENDEREÇO DO SERVIDOR DA LOJA NA REDE (conexão PC ↔ servidor, parte 1 — plano do dono de 20/10/2026).
//
// Os PCs da loja acham o servidor pelo nome `regem.local` (o servidor se anuncia na rede — EdgeService,
// mDNS). Quando a rede não resolve o nome, o dono precisa do IP para digitar numa emergência, e do MAC
// para fixar o IP no roteador (sem reserva, o roteador pode dar outro IP ao servidor quando ele reinicia).
// Aqui se lê o que a tela "Servidor local" mostra: o IP que os PCs usam (o da ROTA PADRÃO — a placa
// ligada ao roteador; um PC com adaptador virtual ou VPN tem outros IPs que nenhum PC da loja alcança),
// o roteador, o MAC e o nome do PC. As funções puras ficam separadas da leitura do Windows para teste.

export const NOME_NA_REDE = 'regem.local';

export type InterfaceIPv4 = { nome: string; ip: string; mac: string | null; prefixo: number | null };

export type HistoricoIp = { ip: string | null; desde: string | null; anterior: string | null };

export type RedeLocal = {
  /** O nome que os PCs usam (o instalador do PC cliente já vem com ele). */
  nome: string;
  maquina: string | null;
  /** O IP que os PCs usam: o da placa da rota padrão. */
  ip: string | null;
  interface: string | null;
  mac: string | null;
  /** O roteador (gateway da rota padrão) — é nele que se fixa o IP. */
  gateway: string | null;
  /** Os outros IPs desta máquina (adaptador virtual, VPN): os PCs da loja não usam. */
  outros: Array<{ ip: string; interface: string }>;
  portas: { app: number; api: number };
  /** Desde quando o IP é este — só quando o Regem VIU a troca. */
  desde: string | null;
  anterior: string | null;
  medidoEm: string;
};

// Nomes de adaptador que não são a rede da loja (virtualização, VPN, túnel).
const PARECE_VIRTUAL = /virtual|vmware|vbox|hyper-v|vethernet|docker|wsl|tailscale|zerotier|loopback|bluetooth|vpn|tap-|tun\b|teredo|isatap/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function ehPrivado(ip: string): boolean {
  const m = IPV4.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** "3c:52:82:4a:19:7e" → "3C-52-82-4A-19-7E" (como o Windows e os roteadores mostram); nulo se vazio. */
export function macLegivel(mac: string | null | undefined): string | null {
  const s = String(mac ?? '').trim();
  if (!s || /^(00[:-]){5}00$/i.test(s)) return null;
  return s.replace(/:/g, '-').toUpperCase();
}

/**
 * As interfaces IPv4 de verdade, a partir do `os.networkInterfaces()`: sem a de loopback e sem
 * `169.254.x.x` (o endereço que o Windows inventa quando a placa não recebeu IP do roteador).
 */
export function interfacesIPv4(lista: NodeJS.Dict<NetworkInterfaceInfo[]>): InterfaceIPv4[] {
  const out: InterfaceIPv4[] = [];
  for (const [nome, enderecos] of Object.entries(lista ?? {})) {
    for (const a of enderecos ?? []) {
      const familia = (a as any).family;
      if ((familia !== 'IPv4' && familia !== 4) || a.internal) continue;
      if (!IPV4.test(a.address) || a.address.startsWith('169.254.')) continue;
      const cidr = typeof a.cidr === 'string' ? Number(a.cidr.split('/')[1]) : NaN;
      out.push({ nome, ip: a.address, mac: macLegivel(a.mac), prefixo: Number.isFinite(cidr) ? cidr : null });
    }
  }
  return out;
}

/**
 * A rota padrão na saída do `route print -4 0.0.0.0`. Os cabeçalhos mudam com o idioma do Windows
 * ("Rotas ativas", "Active Routes"), a linha de números não: destino 0.0.0.0, máscara 0.0.0.0,
 * gateway, IP da placa, custo. As "rotas persistentes" não têm a coluna da placa e ficam de fora.
 * Com mais de uma rota padrão (cabo e Wi-Fi), vale a de menor custo — é por ela que o Windows sai.
 */
export function rotaPadrao(saida: string): { gateway: string; ip: string } | null {
  let melhor: { gateway: string; ip: string; custo: number } | null = null;
  for (const linha of String(saida ?? '').split(/\r?\n/)) {
    const m = /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\d+)\s*$/.exec(linha);
    if (!m) continue;
    const custo = Number(m[3]);
    if (!melhor || custo < melhor.custo) melhor = { gateway: m[1], ip: m[2], custo };
  }
  return melhor ? { gateway: melhor.gateway, ip: melhor.ip } : null;
}

/**
 * O IP que os PCs da loja usam: o da placa da rota padrão. Sem rota padrão (sem roteador, ou fora do
 * Windows), o primeiro IP privado de uma placa que não parece virtual; por último, qualquer um.
 */
export function escolherPrincipal(ifs: InterfaceIPv4[], rota: { ip: string } | null): InterfaceIPv4 | null {
  if (rota) {
    const daRota = ifs.find((i) => i.ip === rota.ip);
    if (daRota) return daRota;
  }
  return (
    ifs.find((i) => ehPrivado(i.ip) && !PARECE_VIRTUAL.test(i.nome)) ??
    ifs.find((i) => !PARECE_VIRTUAL.test(i.nome)) ??
    ifs[0] ??
    null
  );
}

/**
 * O histórico do IP: quando o IP muda, o de antes vira `anterior` e `desde` é agora. Na primeira medição
 * não se sabe desde quando — `desde` fica nulo (a tela não inventa data). Sem IP agora (placa sem rede
 * naquele instante), mantém o que havia: não é troca, é queda passageira.
 */
export function historicoDoIp(antes: HistoricoIp | null, ip: string | null, agora: Date): HistoricoIp {
  if (!ip) return antes ?? { ip: null, desde: null, anterior: null };
  if (!antes?.ip) return { ip, desde: null, anterior: null };
  if (antes.ip === ip) return antes;
  return { ip, desde: agora.toISOString(), anterior: antes.ip };
}

/** Monta o que a tela mostra, a partir das leituras (puro — o teste passa as leituras prontas). */
export function montarRede(p: {
  maquina: string | null;
  interfaces: InterfaceIPv4[];
  rota: { gateway: string; ip: string } | null;
  historico: HistoricoIp;
  portas: { app: number; api: number };
  agora: Date;
}): RedeLocal {
  const principal = escolherPrincipal(p.interfaces, p.rota);
  return {
    nome: NOME_NA_REDE,
    maquina: p.maquina || null,
    ip: principal?.ip ?? null,
    interface: principal?.nome ?? null,
    mac: principal?.mac ?? null,
    gateway: p.rota && principal && p.rota.ip === principal.ip ? p.rota.gateway : null,
    outros: p.interfaces.filter((i) => i.ip !== principal?.ip).map((i) => ({ ip: i.ip, interface: i.nome })).slice(0, 8),
    portas: p.portas,
    desde: p.historico.ip && p.historico.ip === principal?.ip ? p.historico.desde : null,
    anterior: p.historico.ip && p.historico.ip === principal?.ip ? p.historico.anterior : null,
    medidoEm: p.agora.toISOString(),
  };
}

/**
 * O endereço que a NUVEM mostra na tela "Servidor local", a partir da saúde da batida: só os campos da
 * tela, com tipo e tamanho conferidos (o JSON veio de fora). Sem IP medido: null (a tela some com o cartão).
 */
export function redeDaSaude(bruto: any): RedeLocal | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const texto = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const ip = texto(bruto.ip, 64);
  if (!ip) return null;
  const quando = (v: unknown) => {
    const t = Date.parse(String(v ?? ''));
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  };
  const porta = (v: unknown, padrao: number) => (Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 65536 ? Number(v) : padrao);
  return {
    nome: NOME_NA_REDE,
    maquina: texto(bruto.maquina, 120),
    ip,
    interface: texto(bruto.interface, 120),
    mac: texto(bruto.mac, 32),
    gateway: texto(bruto.gateway, 64),
    outros: (Array.isArray(bruto.outros) ? bruto.outros : [])
      .map((o: any) => ({ ip: texto(o?.ip, 64), interface: texto(o?.interface, 120) ?? '' }))
      .filter((o: { ip: string | null }) => !!o.ip)
      .slice(0, 8) as Array<{ ip: string; interface: string }>,
    portas: { app: porta(bruto.portas?.app, 3001), api: porta(bruto.portas?.api, 3002) },
    desde: quando(bruto.desde),
    anterior: texto(bruto.anterior, 64),
    medidoEm: quando(bruto.medidoEm) ?? new Date(0).toISOString(),
  };
}

/** Quantos PCs (IPs diferentes) falaram com o servidor nos últimos `dentroDeMs`, pelo resumo da batida. */
export function pcsConectadosDaSaude(presenca: any, agoraMs: number = Date.now(), dentroDeMs = 3 * 60_000): number {
  const ips = new Set<string>();
  for (const p of Array.isArray(presenca?.pcs) ? presenca.pcs : []) {
    const visto = Date.parse(String(p?.vistoEm ?? ''));
    if (Number.isFinite(visto) && agoraMs - visto <= dentroDeMs) ips.add(String(p?.ip || `sem-ip:${p?.id}`));
  }
  return ips.size;
}

/**
 * A rota padrão do Windows (`route.exe`, ~50 ms — o PowerShell levaria mais de 1 s). Fora do Windows, ou
 * se o comando falhar, devolve null: a escolha cai para a placa privada que não parece virtual.
 */
export function lerRotaPadrao(timeoutMs = 5000): Promise<{ gateway: string; ip: string } | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('route.exe', ['print', '-4', '0.0.0.0'], { timeout: timeoutMs, windowsHide: true, encoding: 'latin1' }, (erro, saida) => {
      resolve(erro ? null : rotaPadrao(String(saida ?? '')));
    });
  });
}
