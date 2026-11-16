// Guard anti-SSRF para URLs que o LOJISTA cadastra (webhook n8n, webhook de OTP,
// baseUrl de integração). Sem isto, o servidor faria fetch para hosts arbitrários
// — inclusive metadata da cloud (169.254.169.254), localhost e a rede interna da
// VPS. Bloqueia protocolo não-http(s), hostnames locais e IPs privados, resolvendo
// o DNS (defesa contra DNS rebinding: checa TODOS os IPs resolvidos).
import { lookup } from 'node:dns/promises';
// Namespace import (não default): com o build sem esModuleInterop, `import net from
// 'node:net'` vira `undefined` em runtime → `net.isIP` crasha ("reading 'isIP'"),
// derrubando TODO webhook (OTP e avisos n8n). `import * as net` funciona sempre.
import * as net from 'node:net';
import * as http from 'node:http';
import * as https from 'node:https';
import { Readable } from 'node:stream';

function ipPrivadoOuLocal(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 0) return true; // não é IP válido → trata como suspeito
  if (v === 4) {
    if (/^127\./.test(ip)) return true; // loopback
    if (/^10\./.test(ip)) return true; // privado
    if (/^192\.168\./.test(ip)) return true; // privado
    if (/^169\.254\./.test(ip)) return true; // link-local / metadata cloud
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true; // 172.16–172.31
    if (/^0\./.test(ip)) return true;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true; // CGNAT 100.64/10
    return false;
  }
  // IPv6
  const low = ip.toLowerCase();
  if (low === '::1' || low === '::') return true;
  if (low.startsWith('fc') || low.startsWith('fd')) return true; // ULA
  if (low.startsWith('fe80')) return true; // link-local
  if (low.startsWith('::ffff:')) return ipPrivadoOuLocal(low.slice(7)); // IPv4-mapped
  return false;
}

export type EnderecoConferido = { address: string; family: number };
/** As trocas de TESTE (só por código, nunca por variável de ambiente): o resolvedor e a regra de "é interno". */
export type OpcoesDaConferencia = {
  resolver?: (host: string) => Promise<EnderecoConferido[]>;
  ehInterno?: (ip: string) => boolean;
};

/**
 * Confere o endereço e devolve os IPs CONFERIDOS (nulo = não é público): protocolo http(s), nada de nome local, e
 * nenhum dos endereços que o nome resolve é interno. Quem vai conectar usa ESTES endereços (`fetchNoIpConferido`).
 */
export async function conferirUrlPublica(
  u: string | null | undefined,
  o: OpcoesDaConferencia = {},
): Promise<{ url: URL; enderecos: EnderecoConferido[] } | null> {
  if (!u) return null;
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^\[|\]$/g, ''); // tira colchetes de IPv6
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal'))
    return null;
  const ehInterno = o.ehInterno ?? ipPrivadoOuLocal;
  const familia = net.isIP(host);
  if (familia) return ehInterno(host) ? null : { url, enderecos: [{ address: host, family: familia }] };
  try {
    const enderecos = o.resolver ? await o.resolver(host) : await lookup(host, { all: true });
    if (!enderecos.length) return null;
    if (enderecos.some((e) => ehInterno(e.address))) return null;
    return { url, enderecos: enderecos.map((e) => ({ address: e.address, family: e.family })) };
  } catch {
    return null; // não resolveu → não arrisca
  }
}

// true = URL pública e segura para fetch a partir do servidor.
export async function urlPublicaSegura(u?: string | null): Promise<boolean> {
  return (await conferirUrlPublica(u)) !== null;
}

/** O endereço deixou de ser público entre a conferência de quem chama e a conexão (ou nunca foi). */
export class EnderecoNaoPublico extends Error {
  constructor() {
    super('endereço bloqueado: não é um endereço público da internet');
    this.name = 'EnderecoNaoPublico';
  }
}

/**
 * O `fetch` PRESO AO IP CONFERIDO, para endereço que vem de fora (o webhook que a loja cadastra, a base de uma
 * integração, a foto de um produto). Confere o endereço e conecta SÓ nos IPs que conferiu: o `lookup` da conexão devolve
 * os conferidos, então um DNS que muda entre a conferência e a conexão não leva a outro lugar — era a brecha de conferir
 * com `urlPublicaSegura` e depois chamar o `fetch`, que resolve o nome de novo (avaliação de segurança de 16/11/2026,
 * A-05). No HTTPS o certificado segue conferido pelo NOME. Nunca segue redirecionamento (o 3xx é a resposta). Devolve a
 * `Response` de sempre (`ok`, `status`, `headers`, `text()`, `body`); endereço que não é público → `EnderecoNaoPublico`.
 */
export async function fetchNoIpConferido(
  endereco: string,
  init: { method?: string; headers?: Record<string, string>; body?: string | Buffer | null; signal?: AbortSignal | null } = {},
  o: OpcoesDaConferencia = {},
): Promise<Response> {
  const c = await conferirUrlPublica(endereco, o);
  if (!c) throw new EnderecoNaoPublico();
  const metodo = (init.method ?? 'GET').toUpperCase();
  const lib = c.url.protocol === 'https:' ? https : http;
  // O `lookup` da conexão: só os endereços conferidos (o Node pede um ou a lista inteira, conforme a versão).
  const lookupFixo = (_host: string, opcoes: any, cb: (...a: any[]) => void) => {
    if (opcoes?.all) cb(null, c.enderecos);
    else cb(null, c.enderecos[0].address, c.enderecos[0].family);
  };
  // O `fetch` manda estes dois por conta própria, e há servidor que recusa pedido sem eles; quem chama pode trocar.
  // Sem `accept-encoding`: a resposta vem sem compressão (aqui ninguém descomprime).
  const cabecalhosDoPedido: Record<string, string> = { accept: '*/*', 'user-agent': 'node' };
  for (const [nome, valor] of Object.entries(init.headers ?? {})) cabecalhosDoPedido[nome.toLowerCase()] = valor;
  const temCorpo = init.body != null && metodo !== 'GET' && metodo !== 'HEAD';
  // O tamanho do corpo, como o `fetch` manda (sem ele o Node enviaria em pedaços, e há destino que não aceita).
  if (temCorpo && !cabecalhosDoPedido['content-length']) cabecalhosDoPedido['content-length'] = String(Buffer.byteLength(init.body as string | Buffer));
  return new Promise<Response>((resolve, reject) => {
    const req = lib.request(
      c.url,
      { method: metodo, headers: cabecalhosDoPedido, lookup: lookupFixo as any, ...(init.signal ? { signal: init.signal } : {}) },
      (res) => {
        const cabecalhos = new Headers();
        for (const [nome, valor] of Object.entries(res.headers)) {
          if (Array.isArray(valor)) for (const v of valor) cabecalhos.append(nome, v);
          else if (valor != null) cabecalhos.set(nome, String(valor));
        }
        const status = res.statusCode ?? 502;
        const semCorpo = metodo === 'HEAD' || status === 204 || status === 205 || status === 304;
        if (semCorpo) res.resume();
        try {
          resolve(new Response(semCorpo ? null : (Readable.toWeb(res) as any), { status, statusText: res.statusMessage ?? '', headers: cabecalhos }));
        } catch (e) {
          res.destroy();
          reject(e);
        }
      },
    );
    req.on('error', reject);
    if (temCorpo) req.write(init.body as string | Buffer);
    req.end();
  });
}

// GET de um endereço que a LOJA informou (foto de produto, imagem de campanha), seguindo no máximo
// `saltos` redirecionamentos — e conferindo CADA destino com a mesma trava. O `fetch` sozinho segue o
// redirecionamento sem perguntar: um endereço público que responde 302 para 169.254.169.254 passava
// pela conferência do primeiro endereço e lia a rede interna. Devolve null quando algum endereço do
// caminho não é público ou os saltos acabam. (Webhook — POST — não segue redirecionamento nenhum:
// `redirect: 'manual'` direto no fetch.)
export async function buscarUrlPublica(
  url: string,
  init: RequestInit = {},
  saltos = 3,
  // Só os testes trocam (a rede simulada): em produção é sempre o envio preso ao IP conferido.
  buscar: (url: string, init: { method?: string; headers?: Record<string, string>; signal?: AbortSignal | null }) => Promise<Response> = fetchNoIpConferido,
): Promise<Response | null> {
  let atual = url;
  const cabecalhos = Object.fromEntries(new Headers(init.headers ?? {}).entries());
  for (let i = 0; i <= saltos; i++) {
    // Conferido e conectado no MESMO endereço (A-05): o `fetch` resolveria o nome de novo depois da conferência.
    let res: Response;
    try {
      res = await buscar(atual, { method: 'GET', headers: cabecalhos, signal: init.signal ?? null });
    } catch (e) {
      if (e instanceof EnderecoNaoPublico) return null;
      throw e;
    }
    const destino = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!destino) return res;
    await res.body?.cancel().catch(() => undefined); // libera a conexão do salto
    try {
      atual = new URL(destino, atual).toString();
    } catch {
      return null;
    }
  }
  return null;
}

// O corpo da resposta até `teto` bytes: passou (pelo Content-Length ou lendo), para de ler e devolve null — uma
// imagem de um endereço de fora nunca enche a memória do servidor.
export async function lerCorpoAte(res: Response, teto: number): Promise<Buffer | null> {
  const declarado = Number(res.headers.get('content-length') ?? '0');
  if (declarado > teto) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  const leitor = res.body?.getReader();
  if (!leitor) return Buffer.alloc(0);
  const partes: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > teto) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    partes.push(Buffer.from(value));
  }
  return Buffer.concat(partes);
}
