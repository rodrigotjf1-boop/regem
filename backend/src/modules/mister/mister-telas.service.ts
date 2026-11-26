import { Injectable, Logger, Optional } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { CABECALHO_DO_BILHETE, emitirBilhete } from '../../auth/bilhete-do-mister';
import { semDadoPessoal } from '../graph/graph.regras';
import { funcaoDoMapa, LEITURAS_DO_MISTER, parametrosDoCaminho, procurarNoMapa } from './mapa/busca-no-mapa';
import { limparLeitura } from './mapa/leitura-limpa';
import type { FuncaoDoMapa } from './mapa/mapa-do-regem';
import type { EscopoDoMister, ResultadoDaFerramenta } from './mister-ferramentas.service';

// LER QUALQUER TELA (Mister, versão 10, fase C3; `docs/plano-mister.md` § "C3"). Duas ferramentas:
//  • `procurar_no_regem`: a busca no mapa revisado (`mapa/busca-no-mapa.ts`) — só as leituras `le` sem dado de pessoa;
//  • `ler_no_regem`: lê UMA dessas funções "como se a pessoa abrisse a tela": a chamada vai à PRÓPRIA API, por dentro do
//    servidor (127.0.0.1), com o bilhete de uma chamada (`auth/bilhete-do-mister.ts`). O `JwtAuthGuard` troca o bilhete pela
//    pessoa lida no banco agora, e valem as travas da tela (perfil, permissões, módulos, loja, empresa). A resposta passa pelo
//    filtro (`mapa/leitura-limpa.ts`) antes de ir à IA.
// Nasce desligado (`MISTER_LER_TELAS=1`, `telasNoMister` em `mister-agente.regras.ts`): entra na conversa depois da avaliação.

export const PRAZO_DA_LEITURA_MS = 10_000;
/** A resposta maior que isto nem se lê (a tela devolve uma lista sem fim): pede um período ou um filtro. */
export const RESPOSTA_DA_TELA_NO_MAXIMO = 3_000_000;
const CONSULTAS_NO_MAXIMO = 8;
const VALOR_DO_PARAMETRO = /^[A-Za-z0-9_.:-]{1,80}$/;

export const TEXTOS_DAS_TELAS = {
  semBusca: 'Diga em poucas palavras o dado que procura (ex.: "cupons do cardápio", "taxa de entrega por bairro").',
  nadaAchado: 'Nenhuma tela do Regem que o Mister lê combina com isso. Diga que ainda não tem acesso a essa informação e chame anotar_o_que_falta.',
  soComDadoDePessoa:
    'O que combina com isso são telas com dado de pessoa (clientes, conversas, candidatos, contatos): o Mister não lê essas telas pela conversa. Diga isso em uma frase e indique a tela do Regem.',
  rotaFora: 'Essa função não está entre as leituras que o Mister faz. Procure com procurar_no_regem e use uma rota que ela trouxe.',
  pessoal: 'Essa tela traz dado de pessoa (cliente, conversa, candidato, contato): o Mister não a lê pela conversa. Indique a tela do Regem.',
  naoELeitura: 'Essa função muda algo no Regem: não é leitura. Ler é só com as rotas que procurar_no_regem trouxe.',
  semServidor: 'Não consegui ler esta tela agora.',
  semPermissao: 'O perfil desta pessoa no Regem não abre esta tela. Quem muda o perfil é o presidente.',
  naoAchou: 'A tela não achou esse registro (o id não existe nesta empresa ou nesta loja).',
  grandeDemais: 'A resposta desta tela é grande demais para a conversa: peça um período menor ou um filtro (os de "consulta").',
  naoEJson: 'Esta tela devolve um arquivo, não dados: indique a tela do Regem.',
  esperaOPin: 'As telas do Regem esperam o PIN: o link para confirmar vai logo depois desta resposta. Diga isso em uma frase.',
} as const;

const recusa = (erro: string): ResultadoDaFerramenta => ({ ok: false, dados: { erro } });

/** `procurar_no_regem` (a avaliação usa a MESMA): as leituras do mapa que mais combinam com o que a IA descreveu. */
export function procurarTelas(entrada: unknown): ResultadoDaFerramenta {
  const en = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
  const busca = String(en.busca ?? '').slice(0, 200).trim();
  if (!busca) return recusa(TEXTOS_DAS_TELAS.semBusca);
  const r = procurarNoMapa(busca);
  if (!r.achadas.length) return { ok: true, dados: { achadas: [], siga: r.comDadoDePessoa ? TEXTOS_DAS_TELAS.soComDadoDePessoa : TEXTOS_DAS_TELAS.nadaAchado } };
  return {
    ok: true,
    dados: {
      achadas: r.achadas,
      siga: 'Escolha a que responde à pergunta e chame ler_no_regem com a rota exata, os parametros do caminho e, se precisar, a consulta. Nenhuma serve: diga que ainda não tem acesso e chame anotar_o_que_falta.',
      ...(r.comDadoDePessoa ? { comDadoDePessoa: TEXTOS_DAS_TELAS.soComDadoDePessoa } : {}),
    },
  };
}

export interface PedidoDaLeitura {
  f: FuncaoDoMapa;
  /** O caminho exato que vai à API (e que o bilhete abre): `/api/v1/…?a=1&b=2`, a consulta em ordem de nome. */
  caminho: string;
  pares: Array<[string, string]>;
}

/**
 * Confere o pedido de `ler_no_regem` (a avaliação usa a MESMA conferência): a rota é uma leitura do Mister (`le`, sem dado
 * de pessoa); cada parâmetro do caminho tem um valor simples, codificado; a consulta só tem os nomes que a função aceita.
 */
export function pedidoDaLeitura(entrada: unknown): PedidoDaLeitura | { erro: string } {
  const en = (entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {}) as Record<string, unknown>;
  const f = funcaoDoMapa(en.rota);
  if (!f) return { erro: TEXTOS_DAS_TELAS.rotaFora };
  if (f.marca !== 'le') return { erro: f.marca === 'interna' ? TEXTOS_DAS_TELAS.rotaFora : TEXTOS_DAS_TELAS.naoELeitura };
  if (f.pessoal) return { erro: TEXTOS_DAS_TELAS.pessoal };
  if (!LEITURAS_DO_MISTER.includes(f)) return { erro: TEXTOS_DAS_TELAS.rotaFora };

  // O caminho: cada {parametro} com um valor simples (id, código, sigla), codificado.
  const params = (en.parametros && typeof en.parametros === 'object' && !Array.isArray(en.parametros) ? en.parametros : {}) as Record<string, unknown>;
  let caminho = f.rota.split(' ')[1];
  for (const p of parametrosDoCaminho(f.rota)) {
    const v = params[p];
    const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
    // Só pontos ("..") o endereço resolveria para OUTRO caminho: recusa antes.
    if (!VALOR_DO_PARAMETRO.test(s) || /^\.+$/.test(s)) return { erro: `Falta o "${p}" desta tela (um valor simples, como o id que outra leitura trouxe).` };
    caminho = caminho.replace(`{${p}}`, encodeURIComponent(s));
  }
  // A consulta: só os nomes que a função aceita (do contrato), valores simples.
  const cons = (en.consulta && typeof en.consulta === 'object' && !Array.isArray(en.consulta) ? en.consulta : {}) as Record<string, unknown>;
  const aceitos = new Set(f.consulta ?? []);
  const pares: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(cons)) {
    if (v === undefined || v === null || v === '') continue;
    if (!aceitos.has(k)) return { erro: `Esta tela não aceita "${k}". Aceita: ${[...aceitos].join(', ') || 'nenhuma consulta'}.` };
    if (!['string', 'number', 'boolean'].includes(typeof v)) return { erro: `O valor de "${k}" precisa ser simples (texto, número ou sim/não).` };
    const s = String(v).trim().slice(0, 100);
    if (s) pares.push([k, s]);
  }
  if (pares.length > CONSULTAS_NO_MAXIMO) return { erro: 'Consulta demais de uma vez.' };
  pares.sort((a, b) => a[0].localeCompare(b[0]));
  if (pares.length) caminho += `?${new URLSearchParams(pares).toString()}`;
  return { f, caminho, pares };
}

/** O que a leitura devolve à IA: a frase da tela, a loja, a consulta usada e a resposta já filtrada. */
export function resultadoDaLeitura(f: FuncaoDoMapa, loja: string, pares: Array<[string, string]>, bruto: unknown, verValores: boolean): ResultadoDaFerramenta {
  const limpa = limparLeitura(bruto, { verValores });
  if (!limpa) return recusa(TEXTOS_DAS_TELAS.grandeDemais);
  return {
    ok: true,
    dados: {
      tela: f.frase,
      loja,
      ...(pares.length ? { consulta: Object.fromEntries(pares) } : {}),
      resposta: limpa.dados,
      ...(limpa.observacoes.length ? { observacoes: limpa.observacoes } : {}),
      ...(verValores ? {} : { valores: 'Os valores em reais ficam de fora para esta pessoa.' }),
    },
  };
}

@Injectable()
export class MisterTelasService {
  private readonly logger = new Logger('MisterTelas');

  constructor(@Optional() private readonly host?: HttpAdapterHost) {}

  /** `procurar_no_regem`: as leituras do mapa que mais combinam com o que a IA descreveu. */
  procurar(entrada: unknown): ResultadoDaFerramenta {
    return procurarTelas(entrada);
  }

  /**
   * `ler_no_regem`: lê a função pela API, como a pessoa. `loja` é a do escopo (a consulta da conversa já a resolveu): o
   * presidente manda a escolhida no cabeçalho da loja; quem está preso a uma loja tem a dele pelo cadastro (o cabeçalho
   * não muda nada, como na tela).
   */
  async ler(e: EscopoDoMister, entrada: unknown, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    if (e.pinPendente) return recusa(TEXTOS_DAS_TELAS.esperaOPin);
    const p = pedidoDaLeitura(entrada);
    if ('erro' in p) return recusa(p.erro);
    const { f, caminho, pares } = p;

    const base = this.base();
    if (!base) return recusa(TEXTOS_DAS_TELAS.semServidor);
    let bilhete: string;
    try {
      bilhete = emitirBilhete({ tenantId: e.tenantId, colaboradorId: e.colaboradorId, caminho });
    } catch {
      return recusa(TEXTOS_DAS_TELAS.semServidor);
    }
    let r: Response;
    try {
      r = await fetch(`${base}${caminho}`, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(PRAZO_DA_LEITURA_MS),
        headers: {
          [CABECALHO_DO_BILHETE]: bilhete,
          accept: 'application/json',
          ...(e.nivel === 'presidente' && loja.atual ? { 'x-unidade-id': loja.atual } : {}),
        },
      });
    } catch (err: any) {
      this.logger.warn(`leitura ${f.rota} não respondeu: ${String(err?.name ?? err?.message ?? err).slice(0, 120)}`);
      return recusa(TEXTOS_DAS_TELAS.semServidor);
    }
    if (r.status === 401 || r.status === 403) return recusa(TEXTOS_DAS_TELAS.semPermissao);
    if (r.status === 404) return recusa(TEXTOS_DAS_TELAS.naoAchou);
    if (r.status === 400) {
      const corpo = await r.text().catch(() => '');
      let msg = '';
      try {
        const j = JSON.parse(corpo);
        msg = Array.isArray(j?.message) ? j.message.join('; ') : String(j?.message ?? '');
      } catch {
        msg = '';
      }
      return recusa(`A tela recusou o pedido${msg ? `: ${semDadoPessoal(msg).slice(0, 200)}` : '.'}`);
    }
    if (r.status < 200 || r.status >= 300) {
      // V11: o motivo fica no log deste servidor; para a IA vai só "não li".
      this.logger.error(`leitura ${f.rota} respondeu ${r.status}`);
      return recusa(TEXTOS_DAS_TELAS.semServidor);
    }
    if (!/json/i.test(r.headers.get('content-type') ?? '')) return recusa(TEXTOS_DAS_TELAS.naoEJson);
    if (Number(r.headers.get('content-length') ?? 0) > RESPOSTA_DA_TELA_NO_MAXIMO) return recusa(TEXTOS_DAS_TELAS.grandeDemais);
    const texto = await r.text();
    if (texto.length > RESPOSTA_DA_TELA_NO_MAXIMO) return recusa(TEXTOS_DAS_TELAS.grandeDemais);
    let bruto: unknown;
    try {
      bruto = texto ? JSON.parse(texto) : null;
    } catch {
      return recusa(TEXTOS_DAS_TELAS.semServidor);
    }
    return resultadoDaLeitura(f, loja.nome, pares, bruto, e.verValores);
  }

  /** O endereço deste servidor por dentro (127.0.0.1 e a porta em que o app escuta), ou null se ele não escuta. */
  private base(): string | null {
    const srv: any = this.host?.httpAdapter?.getHttpServer?.();
    const a = srv?.address?.();
    if (!a || typeof a === 'string' || !a.port) return null;
    return `http://127.0.0.1:${a.port}`;
  }
}
