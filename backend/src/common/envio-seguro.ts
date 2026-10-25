// O ENVIO SEGURO para um endereço que vem de FORA da distribuição: o aviso do aplicativo de parceiro (Hub DMS, F4 parte F;
// Padrão §9). CÓPIA FIEL do simulador do hub (`C:\HubDMS\servidor\src\simulador\envio-seguro.ts`, commit `49d0cdc`,
// revisado e provado na F4 E2). NÃO EDITAR AQUI: a mudança vai ao hub e as duas cópias andam juntas, até a 0.10 do pacote
// comum levar o arquivo (aí esta cópia sai). As diferenças da cópia são só de encaixe: o `enderecoInterno` vem da cópia
// do pacote no Regem, os módulos do Node entram por namespace (o build sem esModuleInterop, ver ssrf-guard) e a frase da
// recusa do domínio da DMS fala do Regem.
//
// O endereço é do parceiro, então o Regem não confia nele: só https na porta padrão, um NOME (nunca IP), nada de domínio da
// DMS nem dos serviços do próprio Regem (`proibidos`); resolve o nome pelo resolvedor próprio do Node (c-ares: com prazo,
// fora do grupo de threads que o banco e os arquivos usam, e sem o /etc/hosts da máquina) e recusa se QUALQUER endereço for
// interno (a regra do pacote e as faixas de túnel do IPv6); conecta só nos endereços que conferiu (o `lookup` da conexão
// devolve os conferidos, o IPv4 primeiro: um DNS que muda entre a conferência e a conexão não leva a outro lugar), e o TLS
// confere o certificado pelo NOME. Não segue redirecionamento (3xx é a resposta), 5 s no total contando a resolução, no
// máximo 16 KB da resposta, e um teto de envios ao mesmo tempo. Nunca rejeita: o resultado diz o status ou o erro. O
// motivo do erro nunca leva o segredo nem o corpo.
//
// Neste caminho ele SUBSTITUI o `urlPublicaSegura` (V68): aquele confere e depois o `fetch` resolve o nome de novo; aqui a
// conexão vai ao IP conferido. As opções de teste (`resolver`, `ehInterno`, `requisitar`, `porta`, `ca`) só se ligam por
// código, nunca por variável de ambiente.
import { Resolver } from 'node:dns/promises';
import type { ClientRequest, IncomingMessage } from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import { enderecoInterno } from '../dms/integracao-dms';

/** Os domínios dos produtos e serviços da DMS: o aviso de parceiro não vai para eles (nem para subdomínio). */
export const DOMINIOS_DA_DMS: readonly string[] = [
  'dmstecnologias.com',
  'dmsregem.com',
  'monitorfarol.com.br',
  'agencialiame.com',
  'gogem.com.br',
  'orzuni.com',
  'muraljob.com.br',
];
export const PRAZO_DO_ENVIO_MS = 5000;
/** A resolução do nome tem prazo próprio, dentro do prazo do envio. */
export const PRAZO_DO_DNS_MS = 2000;
export const TETO_DA_RESPOSTA = 16 * 1024;
/** Os nomes que só valem dentro de uma rede (o resolvedor da máquina pode responder por eles). */
const SUFIXOS_LOCAIS = ['localhost', 'local', 'internal', 'lan', 'home.arpa'];

// As faixas de IPv6 que levam um IPv4 dentro ou são túnel (6to4, Teredo, o IPv4 "compatível" e o NAT64 local), além do
// que o `enderecoInterno` do pacote já recusa: por elas, um endereço "público" pode chegar a uma rede interna.
const TUNEIS_IPV6 = new net.BlockList();
TUNEIS_IPV6.addSubnet('2002::', 16, 'ipv6');
TUNEIS_IPV6.addSubnet('2001::', 32, 'ipv6');
TUNEIS_IPV6.addSubnet('::', 96, 'ipv6');
TUNEIS_IPV6.addSubnet('64:ff9b:1::', 48, 'ipv6');

/** O endereço é interno, reservado ou de túnel? (a regra padrão do envio) */
export function enderecoRecusado(ip: string): boolean {
  if (enderecoInterno(ip)) return true;
  return net.isIP(ip) === 6 && TUNEIS_IPV6.check(ip, 'ipv6');
}

export type EnderecoResolvido = { address: string; family: number };
export type Requisitar = (url: URL, opcoes: https.RequestOptions, aoResponder: (res: IncomingMessage) => void) => ClientRequest;

/** O teto de envios ao mesmo tempo (um por processo): quem passa espera a vez, sem fila sem fim. */
export class Vagas {
  private ocupadas = 0;
  private readonly espera: Array<() => void> = [];
  constructor(private readonly total: number) {}
  async entrar(): Promise<() => void> {
    if (this.ocupadas >= this.total) await new Promise<void>((r) => this.espera.push(r));
    else this.ocupadas += 1;
    let saiu = false;
    return () => {
      if (saiu) return;
      saiu = true;
      const proximo = this.espera.shift();
      if (proximo) proximo();
      else this.ocupadas -= 1;
    };
  }
}

export type OpcoesDoEnvio = {
  /** Os endereços de um nome (padrão: o resolvedor próprio do Node, A e AAAA, com prazo). */
  resolver?: (host: string) => Promise<EnderecoResolvido[]>;
  /** O endereço é recusado? (padrão: `enderecoRecusado`) */
  ehInterno?: (ip: string) => boolean;
  /** Quem faz a requisição (padrão: `https.request`). Os testes passam uma em http. */
  requisitar?: Requisitar;
  /** A porta da conexão (só nos testes; o endereço de verdade é sempre a 443). */
  porta?: number;
  /** A autoridade certificadora em que confiar (só nos testes, com o certificado de teste; na produção, a do sistema). */
  ca?: string;
  prazoMs?: number;
  prazoDnsMs?: number;
  /** Domínios a mais que o envio recusa (os serviços do próprio Regem, lidos do ambiente). */
  proibidos?: readonly string[];
  vagas?: Vagas;
};

export type DestinoConferido = { url: URL; host: string; enderecos: EnderecoResolvido[] };
export type RespostaDoDestino = { status: number | null; tipoConteudo: string; texto: string; erro: string | null; duracaoMs: number };

const ehDoDominio = (host: string, dominio: string) => host === dominio || host.endsWith(`.${dominio}`);

/** A resolução padrão: A e AAAA pelo c-ares, uma tentativa, com prazo; os dois falhando, o nome não resolve. */
function resolverPadrao(prazoMs: number): (host: string) => Promise<EnderecoResolvido[]> {
  return async (host) => {
    const r = new Resolver({ timeout: prazoMs, tries: 1 });
    const [v4, v6] = await Promise.allSettled([r.resolve4(host), r.resolve6(host)]);
    const lista = [
      ...(v4.status === 'fulfilled' ? v4.value.map((address) => ({ address, family: 4 })) : []),
      ...(v6.status === 'fulfilled' ? v6.value.map((address) => ({ address, family: 6 })) : []),
    ];
    if (!lista.length) throw new Error('o nome não resolve');
    return lista;
  };
}

/**
 * O que se confere sem rede (a base aprovada e o registro do aviso usam o mesmo): https na porta padrão, sem usuário e
 * senha, um nome completo (nunca IP, nem nome de rede local) e nada da DMS. Nulo = serve.
 */
export function problemaDoNomeDoDestino(url: URL, proibidos: readonly string[] = []): string | null {
  if (url.protocol !== 'https:') return 'o endereço precisa ser https';
  if (url.port !== '') return 'o endereço precisa usar a porta padrão do https (443)';
  if (url.username || url.password) return 'o endereço não pode ter usuário e senha';
  const host = url.hostname.toLowerCase();
  if (net.isIP(host.replace(/^\[|\]$/g, ''))) return 'o endereço precisa ser um nome, não um IP';
  if (host.endsWith('.') || !host.includes('.')) return 'o endereço precisa ser um nome completo, sem ponto no fim';
  if (SUFIXOS_LOCAIS.some((s) => ehDoDominio(host, s))) return 'o endereço precisa ser público, não de rede local';
  if ([...DOMINIOS_DA_DMS, ...proibidos].some((d) => ehDoDominio(host, d.toLowerCase()))) return 'o Regem não manda aviso de parceiro para endereço da DMS';
  return null;
}

/** Confere o endereço e resolve o nome, dentro do prazo. O motivo da recusa vai para o parceiro: diz o que fazer, nunca a rede de dentro. */
export async function conferirDestino(endereco: string, o: OpcoesDoEnvio = {}): Promise<DestinoConferido | { motivo: string }> {
  let url: URL;
  try {
    url = new URL(endereco);
  } catch {
    return { motivo: 'não é um endereço' };
  }
  const problema = problemaDoNomeDoDestino(url, o.proibidos);
  if (problema) return { motivo: problema };
  const host = url.hostname.toLowerCase();
  const prazoDns = o.prazoDnsMs ?? PRAZO_DO_DNS_MS;
  let relogio: NodeJS.Timeout | undefined;
  let enderecos: EnderecoResolvido[];
  try {
    enderecos = await Promise.race([
      (o.resolver ?? resolverPadrao(prazoDns))(host),
      new Promise<never>((_, nao) => {
        relogio = setTimeout(() => nao(new Error('prazo')), prazoDns);
      }),
    ]);
  } catch (erro) {
    return { motivo: (erro as Error)?.message === 'prazo' ? 'o nome do endereço não resolveu a tempo' : 'o nome do endereço não resolve' };
  } finally {
    if (relogio) clearTimeout(relogio);
  }
  if (!enderecos.length) return { motivo: 'o nome do endereço não resolve' };
  const recusado = o.ehInterno ?? enderecoRecusado;
  // um endereço interno entre os resolvidos já recusa: escolher só o público abriria a porta ao DNS que alterna
  if (enderecos.some((e) => recusado(e.address))) return { motivo: 'o nome do endereço aponta para uma rede interna' };
  // o IPv4 primeiro: a máquina sem IPv6 conecta de primeira; com `all`, o Node tenta os outros se o primeiro não responder
  const ordenados = [...enderecos].sort((a, b) => (a.family === 6 ? 1 : 0) - (b.family === 6 ? 1 : 0));
  return { url, host, enderecos: ordenados.map((e) => ({ address: e.address, family: e.family === 6 ? 6 : 4 })) };
}

const semResposta = (prazoMs: number) => `o destino não respondeu em ${prazoMs >= 1000 ? `${Math.round(prazoMs / 1000)} s` : `${prazoMs} ms`}`;

/** O motivo de uma falha de rede ou de TLS, sem nada do que foi enviado. */
function motivoDaRede(erro: unknown): string {
  const codigo = (erro as { code?: unknown } | null)?.code;
  if (typeof codigo === 'string' && /^[A-Z0-9_]{2,40}$/.test(codigo)) return `falha de conexão (${codigo})`;
  return 'falha de conexão';
}

/** Manda o POST ao destino já conferido, conectando só nos endereços conferidos. Nunca rejeita. */
export function enviarAoDestino(d: DestinoConferido, cabecalhos: Record<string, string>, corpo: string, o: OpcoesDoEnvio = {}): Promise<RespostaDoDestino> {
  const prazo = o.prazoMs ?? PRAZO_DO_ENVIO_MS;
  const inicio = performance.now();
  return new Promise((resolver) => {
    let terminou = false;
    let relogio: NodeJS.Timeout | undefined;
    const terminar = (r: Omit<RespostaDoDestino, 'duracaoMs'>) => {
      if (terminou) return;
      terminou = true;
      if (relogio) clearTimeout(relogio);
      resolver({ ...r, duracaoMs: Math.round(performance.now() - inicio) });
    };
    const primeiro = d.enderecos[0] as EnderecoResolvido;
    // a conexão vai só aos endereços conferidos, venha o pedido com `all` (a escolha de família do Node) ou sem
    const lookup: net.LookupFunction = (_host, opcoes, cb) => {
      if ((opcoes as { all?: boolean } | undefined)?.all) (cb as unknown as (e: null, l: EnderecoResolvido[]) => void)(null, d.enderecos);
      else cb(null, primeiro.address, primeiro.family);
    };
    const opcoes: https.RequestOptions = {
      method: 'POST',
      headers: { ...cabecalhos, 'content-length': String(Buffer.byteLength(corpo, 'utf8')) },
      lookup,
      servername: d.host,
      port: o.porta ?? 443,
      // conexão própria: o `lookup` vale só para ela, e nada fica aberto para outro pedido
      agent: false,
      ...(o.ca ? { ca: o.ca } : {}),
    };
    let req: ClientRequest;
    try {
      req = (o.requisitar ?? https.request)(d.url, opcoes, (res) => {
        const partes: Buffer[] = [];
        let lidos = 0;
        const fechar = () =>
          terminar({
            status: res.statusCode ?? null,
            tipoConteudo: String(res.headers['content-type'] ?? '').slice(0, 200),
            texto: Buffer.concat(partes).toString('utf8'),
            erro: null,
          });
        res.on('data', (pedaco: Buffer) => {
          const cabe = TETO_DA_RESPOSTA - lidos;
          if (cabe > 0) partes.push(pedaco.subarray(0, cabe));
          lidos += pedaco.length;
          // passou do teto: o que veio basta (o status já chegou); o resto não se lê
          if (lidos >= TETO_DA_RESPOSTA) {
            fechar();
            res.destroy();
          }
        });
        res.on('end', fechar);
        res.on('close', fechar);
        res.on('error', fechar);
      });
    } catch (erro) {
      terminar({ status: null, tipoConteudo: '', texto: '', erro: motivoDaRede(erro) });
      return;
    }
    relogio = setTimeout(
      () => {
        terminar({ status: null, tipoConteudo: '', texto: '', erro: semResposta(prazo) });
        req.destroy();
      },
      Math.max(1, prazo),
    );
    req.on('error', (erro) => terminar({ status: null, tipoConteudo: '', texto: '', erro: motivoDaRede(erro) }));
    req.end(corpo);
  });
}

/** Confere e manda, no prazo total (a resolução conta) e dentro do teto de envios ao mesmo tempo. A recusa do endereço volta como erro, sem conexão. */
export async function enviarComSeguranca(endereco: string, cabecalhos: Record<string, string>, corpo: string, o: OpcoesDoEnvio = {}): Promise<RespostaDoDestino> {
  const sair = o.vagas ? await o.vagas.entrar() : () => undefined;
  try {
    const inicio = performance.now();
    const prazo = o.prazoMs ?? PRAZO_DO_ENVIO_MS;
    const destino = await conferirDestino(endereco, { ...o, prazoDnsMs: Math.min(o.prazoDnsMs ?? PRAZO_DO_DNS_MS, prazo) });
    if ('motivo' in destino) return { status: null, tipoConteudo: '', texto: '', erro: destino.motivo, duracaoMs: Math.round(performance.now() - inicio) };
    const resto = Math.max(1, Math.round(prazo - (performance.now() - inicio)));
    const r = await enviarAoDestino(destino, cabecalhos, corpo, { ...o, prazoMs: resto });
    // o prazo que se diz é o do envio inteiro (a resolução conta), não o que sobrou para a conexão
    const erro = r.status === null && r.erro?.startsWith('o destino não respondeu') ? semResposta(prazo) : r.erro;
    return { ...r, erro, duracaoMs: Math.round(performance.now() - inicio) };
  } finally {
    sair();
  }
}
