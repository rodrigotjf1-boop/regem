// ACHAR O SERVIDOR DA LOJA (conexão PC ↔ servidor, parte 2 — protótipo aprovado em 20/10/2026, peça 4).
//
// O roteador pode dar outro IP ao servidor quando ele reinicia. O PC que só sabia o IP antigo perdia o
// servidor, e o certificado (emitido para o IP da instalação) nem servia no IP novo. Aqui a estação
// procura, nesta ordem: o endereço configurado → o nome regem.local → o último IP que funcionou → o IP
// que o servidor informou à nuvem → a rede deste PC (a faixa /24 de cada placa). Cada endereço é
// TESTADO por quem chama com a CA da loja e o nome regem.local (servername): outra máquina da rede não
// se passa pelo servidor. Achou por IP: a estação anota regem.local → IP no arquivo hosts deste PC
// (decisão D2 do dono), e o navegador continua no mesmo endereço (o pareamento e a fila offline ficam).
//
// SEM import de propósito: o teste avalia este arquivo como texto (como o impressao-fila.mjs).

export const NOME_DO_SERVIDOR = 'regem.local';
/** A marca da linha que a estação escreve no hosts — só ela é trocada ou apagada. */
export const MARCA_HOSTS = '# regem: servidor da loja (anotado pela estacao)';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
export function ehIpv4(v) {
  const m = IPV4.exec(String(v ?? '').trim());
  return !!m && m.slice(1).every((x) => Number(x) <= 255);
}
function privado(ip) {
  const m = IPV4.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * O endereço que a pessoa digitou ("Trocar endereço do servidor"): um IP ou um nome, sem esquema, porta
 * ou caminho. Devolve o endereço limpo ou null (a tela diz o que digitar).
 */
export function enderecoDigitado(v) {
  let s = String(v ?? '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '');
  if (!s || s.length > 253) return null;
  if (/^[\d.]+$/.test(s)) return ehIpv4(s) ? s : null; // só números e pontos: tem de ser um IP inteiro
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(s) ? s : null;
}

/** Os endereços rápidos, na ordem e sem repetir: o configurado, o nome regem.local, o último IP bom. */
export function candidatosRapidos({ configurado, ultimoIp }) {
  const vistos = new Set();
  const out = [];
  const incluir = (host, como) => {
    const h = String(host ?? '').trim().toLowerCase();
    if (!h || vistos.has(h)) return;
    vistos.add(h);
    out.push({ host: h, como });
  };
  incluir(configurado, 'configurado');
  incluir(NOME_DO_SERVIDOR, 'nome');
  incluir(ultimoIp, 'ultimo-ip');
  return out;
}

/**
 * Os endereços da rede deste PC para procurar: a faixa /24 de cada placa IPv4 privada (sem loopback, sem
 * 169.254 e sem o IP do próprio PC). `interfaces` tem o formato do `os.networkInterfaces()`.
 */
export function enderecosDaRede(interfaces, limite = 512) {
  const proprios = new Set();
  const faixas = [];
  for (const lista of Object.values(interfaces ?? {})) {
    for (const a of lista ?? []) {
      const familia = a?.family;
      if ((familia !== 'IPv4' && familia !== 4) || a.internal || !ehIpv4(a.address) || a.address.startsWith('169.254.')) continue;
      if (!privado(a.address)) continue;
      proprios.add(a.address);
      const base = a.address.split('.').slice(0, 3).join('.');
      if (!faixas.includes(base)) faixas.push(base);
    }
  }
  const out = [];
  for (const base of faixas) {
    for (let i = 1; i <= 254 && out.length < limite; i++) {
      const ip = `${base}.${i}`;
      if (!proprios.has(ip)) out.push(ip);
    }
  }
  return out;
}

/**
 * Procura o servidor. `testar(host)` → true quando o servidor DA LOJA respondeu ali (quem chama confere
 * a CA). `nuvem()` → o IP que o servidor informou à nuvem, ou null. `rede` → os IPs para a varredura.
 * `passos`: a lista que recebe cada tentativa enquanto a busca anda (o ícone mostra ao vivo).
 * Devolve o achado (`host`, `como`) e os passos. Nunca rejeita.
 */
export async function acharServidor({ configurado, ultimoIp, nuvem, rede = [], testar, emParalelo = 32, passos = [] }) {
  const tentar = async (host, como) => {
    let ok = false;
    try { ok = !!(await testar(host)); } catch { ok = false; }
    passos.push({ como, host, ok });
    return ok;
  };
  for (const c of candidatosRapidos({ configurado, ultimoIp })) {
    if (await tentar(c.host, c.como)) return { host: c.host, como: c.como, passos };
  }
  let ipNuvem = null;
  if (nuvem) {
    try { ipNuvem = await nuvem(); } catch { ipNuvem = null; }
    if (ipNuvem && ehIpv4(ipNuvem) && !passos.some((p) => p.host === ipNuvem)) {
      if (await tentar(ipNuvem, 'nuvem')) return { host: ipNuvem, como: 'nuvem', passos };
    } else {
      passos.push({ como: 'nuvem', host: ipNuvem, ok: false });
    }
  }
  // A varredura: em lotes, e para no primeiro que responder.
  const resta = rede.filter((ip) => !passos.some((p) => p.host === ip));
  for (let i = 0; i < resta.length; i += emParalelo) {
    const lote = resta.slice(i, i + emParalelo);
    const r = await Promise.all(lote.map(async (ip) => { try { return (await testar(ip)) ? ip : null; } catch { return null; } }));
    const achou = r.find(Boolean);
    if (achou) {
      passos.push({ como: 'varredura', host: achou, ok: true, procurados: Math.min(i + emParalelo, resta.length) });
      return { host: achou, como: 'varredura', passos };
    }
  }
  if (resta.length) passos.push({ como: 'varredura', host: null, ok: false, procurados: resta.length });
  return { host: null, como: null, passos };
}

/** A marca da linha de regem.local escrita à mão que a estação desativou (fica comentada, não some). */
export const MARCA_DESATIVADA = '# (desativada pela estacao do Regem)';

// A linha ativa (não comentada) dá um IP para regem.local?
function mapeiaONome(linha) {
  const s = String(linha).replace(/#.*$/, '').trim();
  if (!s) return false;
  return s.split(/\s+/).slice(1).some((n) => n.toLowerCase() === NOME_DO_SERVIDOR);
}

/**
 * O arquivo hosts com UMA linha do Regem: `IP regem.local` com a marca. A linha antiga do Regem sai; a
 * linha de regem.local escrita à mão (um técnico, antes) fica COMENTADA — o Windows usaria a dela, com o
 * IP velho. As outras linhas ficam como estavam (inclusive as de outros programas). Mantém o fim de
 * linha do arquivo (CRLF no Windows).
 */
export function hostsComServidor(texto, ip) {
  if (!ehIpv4(ip)) throw new Error('IP inválido para o hosts');
  const eol = /\r\n/.test(texto ?? '') ? '\r\n' : '\n';
  const linhas = String(texto ?? '')
    .split(/\r?\n/)
    .filter((l) => !l.includes(MARCA_HOSTS))
    .map((l) => (mapeiaONome(l) ? `# ${l.trim()} ${MARCA_DESATIVADA}` : l));
  while (linhas.length && linhas[linhas.length - 1] === '') linhas.pop();
  linhas.push(`${ip} ${NOME_DO_SERVIDOR} ${MARCA_HOSTS}`);
  return linhas.join(eol) + eol;
}

/** O hosts sem a linha do Regem (as outras ficam). */
export function hostsSemServidor(texto) {
  const eol = /\r\n/.test(texto ?? '') ? '\r\n' : '\n';
  const linhas = String(texto ?? '').split(/\r?\n/).filter((l) => !l.includes(MARCA_HOSTS));
  while (linhas.length && linhas[linhas.length - 1] === '') linhas.pop();
  return linhas.join(eol) + eol;
}

/** O IP que o hosts dá hoje para regem.local pela linha do Regem (null se não há). */
export function ipNoHosts(texto) {
  for (const l of String(texto ?? '').split(/\r?\n/)) {
    if (!l.includes(MARCA_HOSTS)) continue;
    const ip = l.trim().split(/\s+/)[0];
    if (ehIpv4(ip)) return ip;
  }
  return null;
}
