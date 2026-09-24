import { request } from 'node:https';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { autoridadesSefaz } from './icp-brasil';
import { METODO_SOAP, NS_WSDL, ServicoSefaz } from './webservices';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CHAMADA A UM WEBSERVICE DA SEFAZ (SOAP 1.2 com certificado de cliente).
//
// Três coisas não negociáveis:
//   • o CERTIFICADO A1 da loja vai no aperto de mão TLS (a SEFAZ recusa a conexão sem ele);
//   • o servidor da SEFAZ é VERIFICADO contra a raiz da ICP-Brasil — nunca se desliga a
//     verificação: sem ela, qualquer um no caminho se passaria pela SEFAZ e "autorizaria" a nota;
//   • cada falha volta com a CAUSA certa, porque a emissão reage diferente a cada uma: SEFAZ fora
//     do ar (dá para esperar/contingenciar) não é o mesmo que certificado recusado (não adianta
//     insistir).

export interface CertificadoCliente {
  chavePrivadaPem: string;
  certificadoPem: string;
}

/** A SEFAZ não respondeu (rede, DNS, tempo esgotado, TLS). Candidata a nova tentativa/contingência. */
export class SefazInalcancavel extends Error {
  constructor(motivo: string, public readonly codigo?: string) {
    super(`A SEFAZ não respondeu: ${motivo}`);
    this.name = 'SefazInalcancavel';
  }
}

/** A SEFAZ respondeu, mas recusou a CHAMADA (SOAP Fault, HTTP de erro). Não é rejeição da nota. */
export class SefazRecusouChamada extends Error {
  constructor(motivo: string, public readonly status?: number) {
    super(`A SEFAZ recusou a chamada: ${motivo}`);
    this.name = 'SefazRecusouChamada';
  }
}

const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);

export function envelopeSoap(servico: ServicoSefaz, corpoXml: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    `<soap12:Body><nfeDadosMsg xmlns="${NS_WSDL(servico)}">${corpoXml}</nfeDadosMsg></soap12:Body>` +
    '</soap12:Envelope>'
  );
}

function primeiroPorNome(no: any, nome: string): any {
  const todos = no.getElementsByTagNameNS('*', nome);
  return todos && todos.length ? todos[0] : null;
}

/** Extrai o elemento de resposta (ex.: <retConsStatServ>) de dentro do <nfeResultMsg>. */
export function extrairResultado(respostaSoap: string): string {
  const doc = new DOMParser().parseFromString(respostaSoap, 'text/xml');
  const falha = primeiroPorNome(doc, 'Fault');
  if (falha) {
    const texto = (primeiroPorNome(falha, 'Text') ?? primeiroPorNome(falha, 'faultstring'))?.textContent;
    throw new SefazRecusouChamada(String(texto ?? 'SOAP Fault sem motivo').trim().slice(0, 300));
  }
  const res = primeiroPorNome(doc, 'nfeResultMsg');
  if (!res) throw new SefazRecusouChamada('resposta sem <nfeResultMsg>');
  for (let n = res.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) return new XMLSerializer().serializeToString(n);
  }
  throw new SefazRecusouChamada('<nfeResultMsg> vazio');
}

/** Lê o texto de um campo (por nome local) de um XML de retorno da SEFAZ. */
export function campo(xml: string, nome: string): string | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const el = primeiroPorNome(doc, nome);
  return el ? String(el.textContent ?? '').trim() : null;
}

export interface ChamadaSefaz {
  url: string;
  servico: ServicoSefaz;
  corpoXml: string; // o elemento de dados (consStatServ, enviNFe…), sem envelope
  cert: CertificadoCliente;
  ca?: string[]; // só para teste: por padrão, raízes do Node + ICP-Brasil
  /** Tempo de OCIOSIDADE do socket (padrão 30 s): dispara só quando nada chega nesse intervalo. */
  timeoutMs?: number;
  /**
   * Prazo TOTAL da chamada, do DNS ao último byte. O `timeoutMs` sozinho não limita nada: uma
   * resposta que chega aos pingos o renova a cada pacote. Quem tem gente esperando na frente
   * (o totem, com o cliente olhando a tela) passa este prazo; estourou, é SILÊNCIO — e silêncio
   * leva à contingência, nunca a "rejeitada".
   */
  prazoTotalMs?: number;
}

/** Faz a chamada e devolve o XML do elemento de resposta. */
export function chamarSefaz(p: ChamadaSefaz): Promise<string> {
  const envelope = envelopeSoap(p.servico, p.corpoXml);
  const acao = `${NS_WSDL(p.servico)}/${METODO_SOAP[p.servico]}`;
  const corpo = Buffer.from(envelope, 'utf8');
  const timeoutMs = p.timeoutMs ?? 30_000;

  return new Promise((resolveChamada, rejectChamada) => {
    let prazo: NodeJS.Timeout | undefined;
    const encerrar = () => {
      if (prazo) clearTimeout(prazo);
      prazo = undefined;
    };
    const resolve = (v: string) => {
      encerrar();
      resolveChamada(v);
    };
    const reject = (e: unknown) => {
      encerrar();
      rejectChamada(e);
    };
    const req = request(
      p.url,
      {
        method: 'POST',
        key: p.cert.chavePrivadaPem,
        cert: p.cert.certificadoPem,
        ca: p.ca ?? autoridadesSefaz(),
        // Verificação do servidor LIGADA (padrão do Node) — ver o topo do arquivo.
        headers: {
          'Content-Type': `application/soap+xml; charset=utf-8; action="${acao}"`,
          'Content-Length': corpo.length,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (d) => partes.push(d));
        res.on('end', () => {
          const texto = Buffer.concat(partes).toString('utf8');
          const status = res.statusCode ?? 0;
          try {
            // SOAP Fault costuma vir com HTTP 500 — o motivo está no corpo, então tenta ler.
            if (status >= 200 && status < 300) return resolve(extrairResultado(texto));
            try {
              extrairResultado(texto);
            } catch (e) {
              if (e instanceof SefazRecusouChamada) return reject(e);
            }
            reject(new SefazRecusouChamada(`HTTP ${status} — ${esc(texto.slice(0, 200))}`, status));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('tempo esgotado'), { code: 'ETIMEDOUT' })));
    if (p.prazoTotalMs && p.prazoTotalMs > 0) {
      const ms = p.prazoTotalMs;
      prazo = setTimeout(() => {
        // Decide AQUI, antes de derrubar a conexão: o que vier depois (um 'end' com a resposta
        // pela metade, o 'error' da destruição) não pode transformar silêncio em "recusa".
        reject(new SefazInalcancavel(`ETIMEDOUT — prazo de ${ms} ms esgotado`, 'ETIMEDOUT'));
        req.destroy(Object.assign(new Error(`prazo de ${ms} ms esgotado`), { code: 'ETIMEDOUT' }));
      }, ms);
      prazo.unref?.();
    }
    req.on('error', (e: any) => {
      const codigo = String(e?.code ?? '');
      // Certificado do SERVIDOR não confere: NÃO é "SEFAZ fora do ar" — é alguém no caminho
      // ou raiz faltando. Mensagem própria, e nunca tratado como falha temporária.
      if (/CERT|SELF_SIGNED|UNABLE_TO|ERR_TLS/i.test(codigo))
        return reject(
          new SefazRecusouChamada(
            `o certificado do servidor não pôde ser verificado (${codigo}) — conexão recusada por segurança`,
          ),
        );
      reject(new SefazInalcancavel(`${codigo || 'erro de rede'} — ${e?.message ?? ''}`.trim(), codigo));
    });
    req.end(corpo);
  });
}
