// Kit de testes do Padrão DMS (Padrão §14): o que todo produto roda contra a PRÓPRIA porta antes de abri-la.
//
//   node kit-conformidade.mts caminho/da/config.json
//
// Cinco modos, escolhidos pela config: o do acesso próprio (chave `dms_ap_`, Padrão §2.2), o do DMS ID (`"modo":
// "dms_id"`: o token do DMS ID e o segredo da ligação, Padrão §2.1), na porta REST ou na MCP, o dos avisos (`"modo":
// "avisos"`: a bateria de ataque contra quem RECEBE aviso, Padrão §9), o de quem ENVIA aviso (`"modo": "envio"`: o kit
// faz o papel de quem recebe e confere o que o produto manda, Padrão §9) e o do manifesto (`"modo": "manifesto"`: o
// arquivo que descreve a porta, Padrão §13).
//
// Roda só contra ambiente de TESTE: a parte de escrita grava registros. A config diz os caminhos e os NOMES das
// variáveis de ambiente que guardam as credenciais de teste (as credenciais nunca ficam na config nem no repositório).
//
// Chega aos produtos por cópia, como o pacote (ADR-002). Roda direto no Node 22.18 ou mais, sem compilar; fica fora
// da pasta que o produto compila (por exemplo `scripts/dms/`).

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Versões publicadas do pacote comum e o SHA-256 do arquivo (fim de linha LF). Atualizar a cada versão nova. */
export const VERSOES_DO_PACOTE: Readonly<Record<string, string>> = {
  '0.1.0': '0f42a0cb73ccea56a7d9ff04e5f3c92c17a0f20fe277660ce843cf1161eb50fc',
  '0.1.1': 'ad4e4169bfba2df17f4415e5487ddc710ce73605cdb1882db1704226a95f4d95',
  '0.2.0': '3606860ca095695fcb7ca7bcbd562a88a1b182dc1fc3e0b3f7c8bfb77752aa39',
  '0.2.1': 'ea6ae71a822c05bb9dab4240dccb7076c98732a030b8f70cf4efc0080517f3e1',
  '0.3.0': 'ff406c2809c9f0845707622b03fad0cfb82dd62c373b9a9dda5293b592f41c37',
  '0.4.0': 'f57c798f1fd9c913fb8190fe5b8d5f15b9b52f6e0596fce80852c43bf79e63b9',
  '0.5.0': '4c9d403c4990471deab72b742a3c022d640b084708f70c7c7b6e3365813b4a9b',
  '0.6.0': 'a094abeee454939a08905cab7ed677793a5afa4037498d6fb2c47c8aa8d257ce',
  '0.7.0': '72d5155371de8f794edae159eff255921c216c70002e5c4eb7b4d2fd60838b8f',
  '0.7.1': 'aeadfd341bbd8bb255b88f5db0deff0a9630b2516bdeeb1d7eb52aaaa2532032',
  '0.7.2': 'b4ca278d635caae2fb6a9e225467393a2fda4967a5ca7fccdafd28fb10301f22',
  '0.8.0': '5794e1875c316861d73995682b3e0e5a29b0ccfb837a8f96f99ef2ded23758ad',
  '0.9.0': '1bee8b1b294ec3b221486f6ca0cb4a33607c6577d4a9b2bcf56be59e8c98ce97',
};

type Pacote = typeof import('../pacote/integracao-dms.ts');

/** Carrega a cópia do pacote do PRÓPRIO produto (a mesma que o kit confere); sem ela, a do hub. */
async function carregarPacote(copia: string | undefined): Promise<Pacote> {
  const alvo = copia ? pathToFileURL(resolve(copia)).href : new URL('../pacote/integracao-dms.ts', import.meta.url).href;
  return (await import(alvo)) as Pacote;
}

export type ConfigKit = {
  produto: string;
  base: string;
  /**
   * Uma rota de leitura protegida. `permissao` = a que ela exige (sem isto, a porta não tem permissões separadas e a
   * conferência `sem-permissao` é pulada). `lista: false` = a rota não é lista paginada (as conferências de cursor
   * são puladas).
   */
  leitura: { caminho: string; permissao?: string; lista?: boolean };
  /** Caminho de um recurso da empresa A, com `{id}` no lugar do id. Sem isto: a loja ou a empresa vem só da chave. */
  recursoDaEmpresaA?: string;
  /**
   * `modo: 'chave'` (padrão) = escrita com `Idempotency-Key`; `modo: 'substituicao'` = o envio troca o conjunto
   * inteiro (como o PUT das fichas do Farol), idempotente por natureza (Padrão §5).
   */
  escrita?: { caminho: string; metodo?: 'POST' | 'PUT'; modo?: 'chave' | 'substituicao'; corpo: unknown; corpoDiferente?: unknown };
  /** Quantas chamadas seguidas fazer para ver o 429 (o limite da porta mais um). Sem isto, a conferência é pulada. */
  limite?: { chamadas: number };
  /** Caminho da cópia do pacote comum no produto, para conferir que ela bate com uma versão publicada. */
  copiaDoPacote?: string;
  /** NOMES das variáveis de ambiente com as credenciais de teste. As três primeiras são obrigatórias. */
  credenciais: { valida: string; outraEmpresa: string; revogada: string } & Partial<Record<NomeCredencial, string>>;
};

export type NomeCredencial = 'valida' | 'outraEmpresa' | 'revogada' | 'vencida' | 'suspensa' | 'semPermissao' | 'idRecursoA';
export type Valores = { valida: string; outraEmpresa: string; revogada: string } & Partial<Record<NomeCredencial, string>>;
export type Resultado = { nome: string; ok: boolean; pulado?: boolean; detalhe: string };

type Resposta = { status: number; tipoConteudo: string; corpo: any; cabecalhos: Headers };
type ErroVisto = { onde: string; r: Resposta };

/* eslint-disable @typescript-eslint/no-explicit-any */

/** `versao` é `minima` ou mais nova? As três partes comparadas como números (0.10.0 vem depois de 0.2.0). */
function versaoAoMenos(versao: string, minima: string): boolean {
  const a = versao.split('.').map(Number);
  const b = minima.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * O conteúdo do arquivo do pacote bate com uma versão publicada? (CRLF vira LF antes do resumo.) `versaoMinima`: a
 * cópia também tem de ser desta versão ou mais nova (o modo do DMS ID pede a que confere o token; o do manifesto, a que
 * tem o manifesto). `falta` diz, na recusa, o que a cópia antiga não tem.
 */
export function conferirCopiaDoPacote(conteudo: string, versaoMinima?: string, falta = 'não confere o token do DMS ID'): { ok: boolean; detalhe: string } {
  const versao = /export const VERSAO_PACOTE = '([^']+)'/.exec(conteudo)?.[1];
  if (!versao) return { ok: false, detalhe: 'A cópia não tem VERSAO_PACOTE.' };
  if (versaoMinima && !versaoAoMenos(versao, versaoMinima)) {
    return { ok: false, detalhe: `A cópia é a ${versao}, que ${falta}. Copie a ${versaoMinima} ou mais nova do hub.` };
  }
  const esperado = VERSOES_DO_PACOTE[versao];
  if (!esperado) return { ok: false, detalhe: `A versão ${versao} não está entre as publicadas.` };
  const resumoDoArquivo = createHash('sha256').update(conteudo.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
  return resumoDoArquivo === esperado
    ? { ok: true, detalhe: `Cópia igual à versão ${versao}.` }
    : { ok: false, detalhe: `A cópia diz ${versao}, mas o conteúdo foi alterado. Copie de novo do hub.` };
}

function conferenciaDaCopia(caminho: string | undefined, versaoMinima?: string, falta?: string): Resultado {
  if (!caminho) return { nome: 'copia-do-pacote', ok: true, pulado: true, detalhe: 'A config não diz onde está a cópia do pacote.' };
  try {
    return { nome: 'copia-do-pacote', ...conferirCopiaDoPacote(readFileSync(caminho, 'utf8'), versaoMinima, falta) };
  } catch (e) {
    return { nome: 'copia-do-pacote', ok: false, detalhe: `Não consegui ler ${caminho}: ${(e as Error).message}` };
  }
}

async function chamar(url: URL, init: RequestInit): Promise<Resposta> {
  const res = await fetch(url, init);
  const texto = await res.text();
  let corpo: any = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = texto;
  }
  return { status: res.status, tipoConteudo: res.headers.get('content-type') ?? '', corpo, cabecalhos: res.headers };
}

const tipoDe = (r: Resposta): string => (typeof r.corpo?.type === 'string' ? r.corpo.type.replace(/^.*\//, '') : '');
const resumo = (r: Resposta): string => `${r.status} ${tipoDe(r) || r.tipoConteudo}`;

// "A mesma resposta" é a resposta INTEIRA (tirando o código de rastreio), não só o status: um campo `erro` de
// extensão diferente já conta a quem tem o código que ele existiu.
const semRastreio = (c: any): string => {
  if (!c || typeof c !== 'object') return JSON.stringify(c);
  const { request_id: _a, requestId: _b, ...resto } = c;
  return JSON.stringify(resto);
};

/** Toda resposta de erro vista no caminho em `application/problem+json` (RFC 9457, Padrão §7). */
function conferenciaDoFormato(nome: string, errosVistos: readonly ErroVisto[]): Resultado {
  const foraDoFormato = errosVistos.filter(({ r }) => {
    const c = r.corpo;
    return !(
      r.tipoConteudo.startsWith('application/problem+json') &&
      c && typeof c === 'object' &&
      typeof c.type === 'string' && typeof c.title === 'string' && typeof c.detail === 'string' && c.status === r.status
    );
  });
  return {
    nome,
    ok: errosVistos.length > 0 && foraDoFormato.length === 0,
    detalhe: foraDoFormato.length
      ? `Fora do formato RFC 9457: ${foraDoFormato.map((e) => `${e.onde} (${e.r.status} ${e.r.tipoConteudo})`).join('; ')}.`
      : `${errosVistos.length} respostas de erro, todas em application/problem+json.`,
  };
}

export async function rodarKit(config: ConfigKit, valores: Valores): Promise<Resultado[]> {
  const { ehProduto, gerarChave } = await carregarPacote(config.copiaDoPacote);
  if (!ehProduto(config.produto)) throw new Error(`Produto desconhecido na config: ${config.produto}`);
  const resultados: Resultado[] = [];
  const errosVistos: ErroVisto[] = [];
  const registrar = (nome: string, ok: boolean, detalhe: string) => resultados.push({ nome, ok, detalhe });
  const pular = (nome: string, detalhe: string) => resultados.push({ nome, ok: true, pulado: true, detalhe });

  async function pedir(
    caminho: string,
    o: { metodo?: string; chave?: string; corpo?: unknown; cabecalhos?: Record<string, string>; onde?: string } = {},
  ): Promise<Resposta> {
    const cabecalhos: Record<string, string> = { accept: 'application/json', ...(o.cabecalhos ?? {}) };
    if (o.chave !== undefined) cabecalhos.authorization = `Bearer ${o.chave}`;
    if (o.corpo !== undefined) cabecalhos['content-type'] = 'application/json';
    const r = await chamar(new URL(caminho, config.base), {
      method: o.metodo ?? 'GET',
      headers: cabecalhos,
      body: o.corpo === undefined ? undefined : JSON.stringify(o.corpo),
    });
    if (r.status >= 400) errosVistos.push({ onde: o.onde ?? caminho, r });
    return r;
  }

  const leitura = config.leitura.caminho;

  // 1. A cópia do pacote
  resultados.push(conferenciaDaCopia(config.copiaDoPacote));

  // 2. Credenciais recusadas
  const semCredencial = await pedir(leitura, { onde: 'sem credencial' });
  registrar(
    'sem-credencial',
    semCredencial.status === 401 && tipoDe(semCredencial) === 'token-invalido' && /^Bearer\b/.test(semCredencial.cabecalhos.get('www-authenticate') ?? ''),
    `Esperado 401 token-invalido com WWW-Authenticate; veio ${resumo(semCredencial)}.`,
  );

  const torta = await pedir(leitura, { chave: 'abc', onde: 'credencial torta' });
  registrar('credencial-torta', torta.status === 401, `Esperado 401; veio ${resumo(torta)}.`);

  const valida = valores.valida;
  const prefixo = /^dms_(?:ap|lg)_[a-z]+_/.exec(valida)?.[0] ?? '';
  const i = prefixo.length + 10;
  const trocada = valida.slice(0, i) + (valida[i] === 'A' ? 'B' : 'A') + valida.slice(i + 1);
  const conferenciaErrada = await pedir(leitura, { chave: trocada, onde: 'dígito de conferência errado' });
  registrar('conferencia-errada', conferenciaErrada.status === 401, `Chave com um caractere trocado: esperado 401; veio ${resumo(conferenciaErrada)}.`);

  const inexistente = await pedir(leitura, { chave: gerarChave('ap', config.produto).chave, onde: 'chave inexistente' });
  registrar('chave-inexistente', inexistente.status === 401 && tipoDe(inexistente) === 'token-invalido', `Esperado 401 token-invalido; veio ${resumo(inexistente)}.`);

  const revogada = await pedir(leitura, { chave: valores.revogada, onde: 'chave revogada' });
  registrar(
    'revogada-igual-inexistente',
    revogada.status === inexistente.status && revogada.tipoConteudo === inexistente.tipoConteudo && semRastreio(revogada.corpo) === semRastreio(inexistente.corpo),
    `Revogada tem de responder igual a inexistente: ${resumo(inexistente)} ${semRastreio(inexistente.corpo)}; veio ${resumo(revogada)} ${semRastreio(revogada.corpo)}.`,
  );

  // Vencida e suspensa são regras do Padrão (§2.4): sem chave para testar, a conferência FALHA (não conferido = não
  // conforme), em vez de ser pulada.
  if (valores.vencida) {
    const vencida = await pedir(leitura, { chave: valores.vencida, onde: 'chave vencida' });
    registrar('vencida', vencida.status === 401 && tipoDe(vencida) === 'chave-vencida', `Esperado 401 chave-vencida; veio ${resumo(vencida)}.`);
  } else {
    registrar('vencida', false, 'Sem chave vencida para testar. O Padrão pede validade de 12 meses na chave (§2.4).');
  }

  if (valores.suspensa) {
    const suspensa = await pedir(leitura, { chave: valores.suspensa, onde: 'chave suspensa' });
    registrar('suspensa', suspensa.status === 403 && tipoDe(suspensa) === 'chave-suspensa', `Esperado 403 chave-suspensa; veio ${resumo(suspensa)}.`);
  } else {
    registrar('suspensa', false, 'Sem chave suspensa para testar. O Padrão pede a suspensão depois de 90 dias sem uso (§2.4).');
  }

  if (valores.semPermissao && config.leitura.permissao) {
    const semPermissao = await pedir(leitura, { chave: valores.semPermissao, onde: 'chave sem a permissão' });
    const desafio = semPermissao.cabecalhos.get('www-authenticate') ?? '';
    registrar(
      'sem-permissao',
      semPermissao.status === 403 && tipoDe(semPermissao) === 'escopo-insuficiente' && desafio.includes(config.leitura.permissao),
      `Esperado 403 escopo-insuficiente com a permissão ${config.leitura.permissao} no WWW-Authenticate; veio ${resumo(semPermissao)} (${desafio || 'sem desafio'}).`,
    );
  } else {
    pular('sem-permissao', 'A chave desta porta tem um uso só, sem permissões separadas.');
  }

  // 3. Leitura e isolamento entre empresas
  const ehLista = config.leitura.lista !== false;
  const lista = await pedir(ehLista ? `${leitura}${leitura.includes('?') ? '&' : '?'}limite=1` : leitura, { chave: valida, onde: 'leitura válida' });
  registrar(
    'valida-le',
    lista.status === 200 && lista.corpo !== null && typeof lista.corpo === 'object' && (!ehLista || 'proximo_cursor' in lista.corpo),
    ehLista ? `Esperado 200 com proximo_cursor; veio ${resumo(lista)}.` : `Esperado 200 com um objeto JSON; veio ${resumo(lista)}.`,
  );

  if (config.recursoDaEmpresaA && valores.idRecursoA) {
    const recurso = config.recursoDaEmpresaA.replace('{id}', encodeURIComponent(valores.idRecursoA));
    const daMesma = await pedir(recurso, { chave: valida, onde: 'recurso da própria empresa' });
    registrar('mesma-empresa-ve', daMesma.status === 200, `A empresa A lê o próprio recurso: esperado 200; veio ${resumo(daMesma)}.`);

    const daOutra = await pedir(recurso, { chave: valores.outraEmpresa, onde: 'recurso de outra empresa' });
    registrar(
      'outra-empresa-nao-ve',
      daOutra.status === 403 || daOutra.status === 404,
      `A empresa B não pode ler o recurso da A: esperado 403 ou 404; veio ${resumo(daOutra)}.`,
    );
  } else {
    const motivo = 'A porta não recebe id de recurso: a loja ou a empresa vem só da chave.';
    pular('mesma-empresa-ve', motivo);
    pular('outra-empresa-nao-ve', motivo);
  }

  // 4. Cursor
  if (!ehLista) {
    pular('cursor-invalido', 'A leitura não é lista paginada.');
    pular('cursor-de-outra-empresa', 'A leitura não é lista paginada.');
  } else {
    const lixo = await pedir(`${leitura}${leitura.includes('?') ? '&' : '?'}cursor=nao-e-cursor`, { chave: valida, onde: 'cursor torto' });
    const deOutraRota = Buffer.from(JSON.stringify({ k: 'outra-rota', l: 'x', t: null, i: null })).toString('base64url');
    const outraRota = await pedir(`${leitura}${leitura.includes('?') ? '&' : '?'}cursor=${deOutraRota}`, { chave: valida, onde: 'cursor de outra rota' });
    registrar(
      'cursor-invalido',
      lixo.status === 400 && tipoDe(lixo) === 'cursor-invalido' && outraRota.status === 400 && tipoDe(outraRota) === 'cursor-invalido',
      `Cursor torto e cursor de outra rota: esperado 400 cursor-invalido; vieram ${resumo(lixo)} e ${resumo(outraRota)}.`,
    );

    const proximo = lista.corpo?.proximo_cursor;
    if (typeof proximo === 'string' && proximo) {
      const usadoPorOutra = await pedir(`${leitura}${leitura.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(proximo)}`, {
        chave: valores.outraEmpresa,
        onde: 'cursor de outra empresa',
      });
      registrar(
        'cursor-de-outra-empresa',
        usadoPorOutra.status === 400 && tipoDe(usadoPorOutra) === 'cursor-invalido',
        `O cursor da empresa A usado pela B: esperado 400 cursor-invalido; veio ${resumo(usadoPorOutra)}.`,
      );
    } else {
      pular('cursor-de-outra-empresa', 'A empresa A precisa de ao menos dois registros na leitura para haver próxima página.');
    }
  }

  // 5. Escrita e idempotência
  if (config.escrita) {
    const { caminho, corpo, corpoDiferente } = config.escrita;
    const modo = config.escrita.modo ?? 'chave';
    const metodo = config.escrita.metodo ?? (modo === 'substituicao' ? 'PUT' : 'POST');
    if (modo === 'substituicao') {
      const motivo = 'O envio troca o conjunto inteiro: é idempotente por natureza e dispensa a Idempotency-Key (Padrão §5).';
      pular('escrita-sem-idempotencia', motivo);
      pular('idempotencia-outro-corpo', motivo);
      const primeira = await pedir(caminho, { metodo, chave: valida, corpo, onde: 'substituição' });
      const segunda = await pedir(caminho, { metodo, chave: valida, corpo, onde: 'substituição repetida' });
      registrar(
        'idempotencia-repete',
        primeira.status >= 200 && primeira.status < 300 && segunda.status === primeira.status,
        `Repetir o mesmo envio dá o mesmo resultado: vieram ${resumo(primeira)} e ${resumo(segunda)}.`,
      );
    } else {
      const semChave = await pedir(caminho, { metodo, chave: valida, corpo, onde: 'escrita sem Idempotency-Key' });
      registrar('escrita-sem-idempotencia', semChave.status === 400, `Escrita sem Idempotency-Key: esperado 400; veio ${resumo(semChave)}.`);

      const chaveIdem = `kit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const primeira = await pedir(caminho, { metodo, chave: valida, corpo, cabecalhos: { 'idempotency-key': chaveIdem }, onde: 'escrita' });
      const segunda = await pedir(caminho, { metodo, chave: valida, corpo, cabecalhos: { 'idempotency-key': chaveIdem }, onde: 'escrita repetida' });
      registrar(
        'idempotencia-repete',
        primeira.status >= 200 && primeira.status < 300 && segunda.status === primeira.status && JSON.stringify(segunda.corpo) === JSON.stringify(primeira.corpo),
        `A mesma chave com o mesmo pedido devolve a mesma resposta: vieram ${resumo(primeira)} e ${resumo(segunda)}.`,
      );

      const outroCorpo = await pedir(caminho, { metodo, chave: valida, corpo: corpoDiferente ?? { kit: 'outro corpo' }, cabecalhos: { 'idempotency-key': chaveIdem }, onde: 'escrita com outro corpo' });
      registrar(
        'idempotencia-outro-corpo',
        outroCorpo.status === 422 && tipoDe(outroCorpo) === 'chave-reutilizada',
        `A mesma chave com outro pedido: esperado 422 chave-reutilizada; veio ${resumo(outroCorpo)}.`,
      );
    }

    // Só validar: responde 2xx E não muda nada. O kit lê a leitura antes e depois, com um corpo diferente, porque uma
    // porta que ignora o parâmetro também responde 2xx (e grava).
    const corpoDoTeste = corpoDiferente ?? corpo;
    if (modo === 'substituicao' && corpoDiferente === undefined) {
      registrar('somente-validar', false, 'Para provar que "só validar" não grava, a config precisa de escrita.corpoDiferente.');
    } else {
      const antes = await pedir(leitura, { chave: valida, onde: 'leitura antes de só validar' });
      const validar = await pedir(`${caminho}${caminho.includes('?') ? '&' : '?'}somente_validar=true`, { metodo, chave: valida, corpo: corpoDoTeste, onde: 'só validar' });
      const depois = await pedir(leitura, { chave: valida, onde: 'leitura depois de só validar' });
      const igual = JSON.stringify(antes.corpo) === JSON.stringify(depois.corpo);
      registrar(
        'somente-validar',
        validar.status >= 200 && validar.status < 300 && igual,
        igual
          ? `Só validar: esperado 2xx sem mudar nada; veio ${resumo(validar)}.`
          : `Só validar respondeu ${resumo(validar)}, mas a leitura mudou depois: a porta gravou.`,
      );
    }
  } else {
    pular('escrita', 'A config não tem escrita.');
  }

  // 6. Toda resposta de erro em problem+json
  resultados.push(conferenciaDoFormato('erros-em-problem-json', errosVistos));

  // 7. Limite (por último: esgota a cota da empresa A)
  if (config.limite) {
    let viu: Resposta | null = null;
    for (let n = 0; n < config.limite.chamadas && !viu; n += 1) {
      const r = await pedir(leitura, { chave: valida, onde: 'limite' });
      if (r.status === 429) viu = r;
    }
    const retry = Number(viu?.cabecalhos.get('retry-after'));
    registrar(
      'limite',
      !!viu && tipoDe(viu) === 'limite-de-chamadas' && retry >= 1,
      viu ? `429 com Retry-After ${viu.cabecalhos.get('retry-after') ?? 'ausente'}.` : `Nenhum 429 em ${config.limite.chamadas} chamadas.`,
    );
  } else {
    pular('limite', 'A config não diz o limite da porta.');
  }

  return resultados;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// O modo do DMS ID (Padrão §2.1 e §6; decisão F2-1 de 15/10/2026): o token do DMS ID diz o aplicativo, e o segredo
// da ligação, no cabeçalho `DMS-Ligacao`, diz a conta que autorizou. Vale para a porta REST e para a porta MCP entre
// produtos DMS. Só lê: a escrita, o cursor e o isolamento entre empresas seguem no modo do acesso próprio.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** O nome do cabeçalho é do Padrão, não da cópia do produto: o kit confere a porta contra o Padrão. */
export const CABECALHO_LIGACAO = 'DMS-Ligacao';

/** A primeira versão do pacote que confere o token do DMS ID (seção 8). */
export const VERSAO_MINIMA_DMS_ID = '0.2.0';

export const CREDENCIAIS_DMS_ID = [
  'token',
  'ligacao',
  'tokenOutroDestino',
  'tokenVencido',
  'tokenSemPermissao',
  'tokenOutroAplicativo',
  'ligacaoRevogada',
  'ligacaoSemPermissao',
] as const;
export type NomeCredencialDmsId = (typeof CREDENCIAIS_DMS_ID)[number];

/**
 * As da classe, da suspensão e da parada (F4, parte J, 22/10/2026): opcionais até o produto aceitar aplicativo de
 * parceiro (parte F da F4), quando viram obrigatórias. Sem elas, a conferência é PULADA, dizendo por quê.
 */
export const CREDENCIAIS_DMS_ID_OPCIONAIS = ['tokenParceiro', 'ligacaoParceiro', 'ligacaoParceiroSuspensa', 'ligacaoParada', 'ligacaoOutraConta', 'idRecursoA'] as const;
export type NomeCredencialDmsIdOpcional = (typeof CREDENCIAIS_DMS_ID_OPCIONAIS)[number];
export type ValoresDmsId = Partial<Record<NomeCredencialDmsId | NomeCredencialDmsIdOpcional, string>>;

export type ConfigKitDmsId = {
  modo: 'dms_id';
  produto: string;
  base: string;
  /** `rest` (padrão) ou `mcp`. Na MCP, a leitura é um `POST` com o pedido `tools/call` em `leitura.corpo`. */
  porta?: 'rest' | 'mcp';
  /**
   * A chamada que lê e a permissão que ela exige. REST: `GET` no caminho. MCP: `POST` no endereço da porta, com o
   * pedido `tools/call` de uma ferramenta de leitura. `cabecalhos`: o que mais a porta pede (na MCP, por exemplo,
   * `MCP-Protocol-Version`).
   */
  leitura: { caminho: string; permissao: string; corpo?: unknown; cabecalhos?: Record<string, string>; lista?: boolean };
  /** Caminho de um recurso da conta A, com `{id}` no lugar do id (o isolamento entre contas pela ligação). Opcional. */
  recursoDaContaA?: string;
  /** A escrita pela ligação, com `Idempotency-Key` (Padrão §5). Opcional: entra quando a porta abre escrita ao DMS ID. */
  escrita?: { caminho: string; metodo?: 'POST' | 'PUT'; corpo: unknown; corpoDiferente?: unknown };
  /** Quantas chamadas seguidas fazer para ver o 429 (o limite da ligação mais um). Sem isto, a conferência é pulada. */
  limite?: { chamadas: number };
  copiaDoPacote?: string;
  /**
   * NOMES das variáveis de ambiente, todas obrigatórias:
   * - `token` e `ligacao`: um token válido do aplicativo A e uma ligação dele com a permissão da leitura;
   * - `tokenOutroDestino`, `tokenVencido` e `tokenSemPermissao`: tokens do aplicativo A para outro produto, vencido e
   *   sem a permissão (o DMS ID emite token sem permissão nenhuma, com `scope` vazio);
   * - `tokenOutroAplicativo`: um token válido do aplicativo B, com a permissão;
   * - `ligacaoRevogada` e `ligacaoSemPermissao`: ligações do aplicativo A, uma revogada e outra em que a conta não deu
   *   a permissão da leitura.
   */
  credenciais: Record<NomeCredencialDmsId, string>;
  /**
   * A chamada que pede uma permissão ACIMA do teto da classe parceiro (Padrão §1): o produto tem de recusar mesmo que o
   * token e a ligação do aplicativo de parceiro a tenham. Escrita leva `Idempotency-Key` (o kit gera uma). Opcional
   * até a parte F da F4.
   */
  acimaDaClasse?: { caminho: string; metodo?: 'GET' | 'POST' | 'PUT'; permissao: string; corpo?: unknown };
  /**
   * NOMES das variáveis de ambiente, opcionais até a parte F da F4:
   * - `tokenParceiro` e `ligacaoParceiro`: token e ligação de um aplicativo de classe parceiro, com a permissão de
   *   `acimaDaClasse` gravada nos dois (o DMS ID e a conta deram; o teto do produto não deixa);
   * - `ligacaoParceiroSuspensa`: uma ligação do mesmo aplicativo de parceiro parada há mais de 90 dias (Padrão §3);
   * - `ligacaoParada`: uma ligação do aplicativo A que está na lista de parada (Padrão §10; a parada pelo prefixo);
   * - `ligacaoOutraConta` e `idRecursoA`: uma ligação do aplicativo A para OUTRA conta, e o id de um recurso da conta A
   *   (o isolamento e o cursor entre contas).
   */
  credenciaisOpcionais?: Partial<Record<NomeCredencialDmsIdOpcional, string>>;
};

/** O mesmo token com `"alg": "none"` e sem assinatura: a falha clássica de quem lê o token sem conferir. */
function semAssinatura(token: string): string {
  const [cabeca, corpo] = token.split('.');
  let h: Record<string, unknown> = {};
  try {
    h = JSON.parse(Buffer.from(cabeca ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    // token torto: vai assim mesmo, com o cabeçalho só com o alg
  }
  return `${Buffer.from(JSON.stringify({ ...h, alg: 'none' })).toString('base64url')}.${corpo ?? ''}.`;
}

/** Troca um caractere no MEIO da assinatura (o último pode ter bits que o base64url não usa). */
function adulterarAssinatura(token: string): string {
  const partes = token.split('.');
  const assinatura = partes[2] ?? '';
  if (partes.length !== 3 || assinatura.length < 4) return `${token}x`;
  const i = Math.floor(assinatura.length / 2);
  partes[2] = assinatura.slice(0, i) + (assinatura[i] === 'A' ? 'B' : 'A') + assinatura.slice(i + 1);
  return partes.join('.');
}

/** O JSON-RPC de uma resposta da porta MCP: JSON direto, ou a resposta (com `result` ou `error`) num fluxo SSE. */
function jsonRpcDaResposta(r: Resposta): any {
  if (r.tipoConteudo.startsWith('text/event-stream') && typeof r.corpo === 'string') {
    let ultima: any = null;
    for (const linha of r.corpo.split(/\r?\n/)) {
      if (!linha.startsWith('data:')) continue;
      try {
        const j = JSON.parse(linha.slice(5).trim());
        if (j && typeof j === 'object' && ('result' in j || 'error' in j)) ultima = j;
      } catch {
        // evento que não é JSON-RPC
      }
    }
    return ultima;
  }
  return r.corpo;
}

/** A porta MCP recusou dentro do JSON-RPC: erro do protocolo ou da ferramenta (a ferramenta "não encontrada"). */
function mcpRecusou(r: Resposta): boolean {
  if (r.status !== 200) return false;
  const j = jsonRpcDaResposta(r);
  return !!j && typeof j === 'object' && ('error' in j || j.result?.isError === true);
}

function leu(r: Resposta, mcp: boolean): boolean {
  if (r.status !== 200) return false;
  if (!mcp) return r.corpo !== null && typeof r.corpo === 'object';
  const j = jsonRpcDaResposta(r);
  return !!j && typeof j === 'object' && 'result' in j && !('error' in j) && j.result?.isError !== true;
}

function resumoDaLeitura(r: Resposta, mcp: boolean): string {
  if (!mcp || r.status !== 200) return resumo(r);
  const j = jsonRpcDaResposta(r);
  if (!j || typeof j !== 'object') return `200 sem JSON-RPC (${r.tipoConteudo})`;
  if ('error' in j) return `200 com erro JSON-RPC ${String(j.error?.code ?? '')} ${String(j.error?.message ?? '').slice(0, 80)}`.trim();
  if (j.result?.isError === true) return '200 com erro da ferramenta';
  return '200 com o resultado da ferramenta';
}

const corpoCurto = (c: any): string => semRastreio(c).slice(0, 200);

export async function rodarKitDmsId(config: ConfigKitDmsId, valores: ValoresDmsId): Promise<Resultado[]> {
  const { ehProduto, gerarChave } = await carregarPacote(config.copiaDoPacote);
  if (!ehProduto(config.produto)) throw new Error(`Produto desconhecido na config: ${config.produto}`);
  const mcp = config.porta === 'mcp';
  if (mcp && config.leitura.corpo === undefined) {
    throw new Error('Na porta MCP, a config precisa de leitura.corpo: o pedido tools/call de uma ferramenta de leitura.');
  }
  const resultados: Resultado[] = [conferenciaDaCopia(config.copiaDoPacote, VERSAO_MINIMA_DMS_ID)];
  const errosVistos: ErroVisto[] = [];
  const registrar = (nome: string, ok: boolean, detalhe: string) => resultados.push({ nome, ok, detalhe });
  const pular = (nome: string, detalhe: string) => resultados.push({ nome, ok: true, pulado: true, detalhe });
  const semValor = (nome: string, credencial: NomeCredencialDmsId) =>
    registrar(nome, false, `Sem a credencial "${credencial}" para testar. O que não se confere não está conforme.`);
  const { permissao } = config.leitura;

  async function pedir(onde: string, o: { token?: string; ligacao?: string }): Promise<Resposta> {
    const cabecalhos: Record<string, string> = {
      accept: mcp ? 'application/json, text/event-stream' : 'application/json',
      ...(config.leitura.cabecalhos ?? {}),
    };
    if (o.token !== undefined) cabecalhos.authorization = `Bearer ${o.token}`;
    if (o.ligacao !== undefined) cabecalhos[CABECALHO_LIGACAO] = o.ligacao;
    if (mcp) cabecalhos['content-type'] = 'application/json';
    const r = await chamar(new URL(config.leitura.caminho, config.base), {
      method: mcp ? 'POST' : 'GET',
      headers: cabecalhos,
      body: mcp ? JSON.stringify(config.leitura.corpo) : undefined,
    });
    if (r.status >= 400) errosVistos.push({ onde, r });
    return r;
  }

  const { token, ligacao } = valores;
  if (!token || !ligacao) {
    registrar('dmsid-valido-le', false, 'Sem o token e a ligação do aplicativo A, nada se confere.');
    return resultados;
  }

  // 1. O que vale lê
  const valida = await pedir('token e ligação válidos', { token, ligacao });
  registrar('dmsid-valido-le', leu(valida, mcp), `Token e ligação do aplicativo A: esperado 200${mcp ? ' com o resultado da ferramenta' : ''}; veio ${resumoDaLeitura(valida, mcp)}.`);

  // 2. O token: todo token que não vale recebe 401 token-invalido
  const semToken = await pedir('sem token', { ligacao });
  registrar(
    'dmsid-sem-token',
    semToken.status === 401 && tipoDe(semToken) === 'token-invalido' && /^Bearer\b/.test(semToken.cabecalhos.get('www-authenticate') ?? ''),
    `Sem token, com a ligação: esperado 401 token-invalido com WWW-Authenticate; veio ${resumo(semToken)}.`,
  );
  const tokenRecusado = (r: Resposta) => r.status === 401 && tipoDe(r) === 'token-invalido';
  const algNone = await pedir('token sem assinatura (alg none)', { token: semAssinatura(token), ligacao });
  registrar('dmsid-alg-none', tokenRecusado(algNone), `O mesmo token com "alg": "none" e sem assinatura: esperado 401 token-invalido; veio ${resumo(algNone)}.`);
  const adulterado = await pedir('assinatura adulterada', { token: adulterarAssinatura(token), ligacao });
  registrar('dmsid-assinatura-adulterada', tokenRecusado(adulterado), `O mesmo token com um caractere da assinatura trocado: esperado 401 token-invalido; veio ${resumo(adulterado)}.`);
  for (const [nome, credencial, descricao] of [
    ['dmsid-outro-destino', 'tokenOutroDestino', 'emitido para outro produto'],
    ['dmsid-vencido', 'tokenVencido', 'vencido'],
  ] as const) {
    const v = valores[credencial];
    if (!v) {
      semValor(nome, credencial);
      continue;
    }
    const r = await pedir(`token ${descricao}`, { token: v, ligacao });
    registrar(nome, tokenRecusado(r), `Token ${descricao}: esperado 401 token-invalido; veio ${resumo(r)}.`);
  }

  // 3. As permissões. Na MCP, a ferramenta que a credencial não pode usar também pode só sumir (Padrão §6).
  const recusouPermissao = (r: Resposta): boolean =>
    (r.status === 403 && tipoDe(r) === 'escopo-insuficiente' && (r.cabecalhos.get('www-authenticate') ?? '').includes(permissao)) || (mcp && mcpRecusou(r));
  const esperadoSemPermissao = `403 escopo-insuficiente com ${permissao} no WWW-Authenticate${mcp ? ', ou a ferramenta "não encontrada"' : ''}`;
  const vistoSemPermissao = (r: Resposta) => `${resumoDaLeitura(r, mcp)} (${r.cabecalhos.get('www-authenticate') || 'sem desafio'})`;
  if (valores.tokenSemPermissao) {
    const r = await pedir('token sem a permissão', { token: valores.tokenSemPermissao, ligacao });
    registrar('dmsid-sem-permissao', recusouPermissao(r), `Token do destino certo sem ${permissao} (o DMS ID emite esse token): esperado ${esperadoSemPermissao}; veio ${vistoSemPermissao(r)}.`);
  } else {
    semValor('dmsid-sem-permissao', 'tokenSemPermissao');
  }

  // 4. A ligação. Ausente, inexistente, revogada e de outro aplicativo respondem igual (Padrão §7): quem tem um
  // segredo não descobre se ele existiu nem de quem é.
  const semLigacao = await pedir('sem ligação', { token });
  registrar('dmsid-sem-ligacao', semLigacao.status === 401 && tipoDe(semLigacao) === 'ligacao-invalida', `Token válido sem o cabeçalho ${CABECALHO_LIGACAO}: esperado 401 ligacao-invalida; veio ${resumo(semLigacao)}.`);
  const inexistente = await pedir('ligação inexistente', { token, ligacao: gerarChave('lg', config.produto).chave });
  registrar('dmsid-ligacao-inexistente', inexistente.status === 401 && tipoDe(inexistente) === 'ligacao-invalida', `Ligação que nunca existiu: esperado 401 ligacao-invalida; veio ${resumo(inexistente)}.`);
  const igualInexistente = (r: Resposta) =>
    r.status === inexistente.status && r.tipoConteudo === inexistente.tipoConteudo && semRastreio(r.corpo) === semRastreio(inexistente.corpo);
  const comoInexistente = `${resumo(inexistente)} ${corpoCurto(inexistente.corpo)}`;
  if (valores.ligacaoRevogada) {
    const r = await pedir('ligação revogada', { token, ligacao: valores.ligacaoRevogada });
    registrar('dmsid-ligacao-revogada-igual-inexistente', igualInexistente(r), `Ligação revogada tem de responder igual à inexistente: ${comoInexistente}; veio ${resumo(r)} ${corpoCurto(r.corpo)}.`);
  } else {
    semValor('dmsid-ligacao-revogada-igual-inexistente', 'ligacaoRevogada');
  }
  if (valores.tokenOutroAplicativo) {
    const r = await pedir('ligação de outro aplicativo', { token: valores.tokenOutroAplicativo, ligacao });
    registrar(
      'dmsid-ligacao-de-outro-aplicativo',
      igualInexistente(r),
      `O token válido do aplicativo B com a ligação do A tem de responder igual à ligação inexistente: ${comoInexistente}; veio ${resumo(r)} ${corpoCurto(r.corpo)}.`,
    );
  } else {
    semValor('dmsid-ligacao-de-outro-aplicativo', 'tokenOutroAplicativo');
  }
  if (valores.ligacaoSemPermissao) {
    const r = await pedir('ligação sem a permissão', { token, ligacao: valores.ligacaoSemPermissao });
    registrar(
      'dmsid-ligacao-sem-permissao',
      recusouPermissao(r),
      `Token com ${permissao} e ligação em que a conta não deu essa permissão (vale a menor das duas): esperado ${esperadoSemPermissao}; veio ${vistoSemPermissao(r)}.`,
    );
  } else {
    semValor('dmsid-ligacao-sem-permissao', 'ligacaoSemPermissao');
  }

  // 4b. A classe, a suspensão e a parada (Padrão §1, §3 e §10; F4, parte J). Opcionais até o produto aceitar
  // aplicativo de parceiro (parte F da F4): sem a config, a conferência é pulada, dizendo por quê.
  const opcional = 'opcional até a parte F da F4, quando o produto aceitar aplicativo de parceiro';
  const { tokenParceiro, ligacaoParceiro, ligacaoParceiroSuspensa, ligacaoParada } = valores;
  if (!config.acimaDaClasse) {
    pular('dmsid-acima-da-classe', `A config não diz uma chamada que pede permissão acima da classe parceiro (${opcional}).`);
  } else if (!tokenParceiro || !ligacaoParceiro) {
    pular('dmsid-acima-da-classe', `Sem o token e a ligação de um aplicativo de parceiro (${opcional}).`);
  } else {
    const a = config.acimaDaClasse;
    const metodo = a.metodo ?? 'GET';
    const cabecalhos: Record<string, string> = {
      accept: mcp ? 'application/json, text/event-stream' : 'application/json',
      ...(config.leitura.cabecalhos ?? {}),
      authorization: `Bearer ${tokenParceiro}`,
      [CABECALHO_LIGACAO]: ligacaoParceiro,
    };
    if (a.corpo !== undefined) cabecalhos['content-type'] = 'application/json';
    if (metodo !== 'GET') cabecalhos['idempotency-key'] = `kit-${randomUUID()}`;
    const r = await chamar(new URL(a.caminho, config.base), { method: metodo, headers: cabecalhos, body: a.corpo === undefined ? undefined : JSON.stringify(a.corpo) });
    if (r.status >= 400) errosVistos.push({ onde: 'permissão acima da classe', r });
    registrar(
      'dmsid-acima-da-classe',
      (r.status === 403 && tipoDe(r) === 'escopo-insuficiente') || (mcp && mcpRecusou(r)),
      `Aplicativo de parceiro com ${a.permissao} no token e na ligação, acima do teto da classe: esperado 403 escopo-insuficiente (o teto mora no código do produto); veio ${resumo(r)}.`,
    );
  }
  if (!tokenParceiro || !ligacaoParceiroSuspensa) {
    pular('dmsid-ligacao-suspensa', `Sem o token de parceiro e uma ligação dele parada há mais de 90 dias (${opcional}).`);
  } else {
    const r = await pedir('ligação de parceiro parada há mais de 90 dias', { token: tokenParceiro, ligacao: ligacaoParceiroSuspensa });
    registrar('dmsid-ligacao-suspensa', r.status === 403 && tipoDe(r) === 'ligacao-suspensa', `Ligação de parceiro parada há mais de 90 dias: esperado 403 ligacao-suspensa (a conta autoriza de novo); veio ${resumo(r)}.`);
  }
  if (!ligacaoParada) {
    pular('dmsid-parada-ligada', `Sem uma ligação que esteja na lista de parada (${opcional}).`);
  } else {
    const r = await pedir('ligação parada', { token, ligacao: ligacaoParada });
    const retry = Number(r.cabecalhos.get('retry-after'));
    registrar(
      'dmsid-parada-ligada',
      r.status === 503 && tipoDe(r) === 'integracao-parada' && retry >= 1,
      `Ligação na lista de parada: esperado 503 integracao-parada com Retry-After (não é desconexão: o cliente espera e tenta de novo); veio ${resumo(r)}, Retry-After ${r.cabecalhos.get('retry-after') ?? 'ausente'}.`,
    );
  }

  // 4c. A conta, o cursor e a escrita pela ligação (Padrão §5 e §6; F4, parte J). Só na porta REST; opcionais: entram
  // quando a porta abre escrita ou recurso por id ao DMS ID (o cupom do Regem pela ligação, F3-5, é a primeira).
  const { ligacaoOutraConta, idRecursoA } = valores;
  const nomesDaConta = ['dmsid-mesma-conta-ve', 'dmsid-outra-conta-nao-ve', 'dmsid-cursor-invalido', 'dmsid-cursor-de-outra-conta', 'dmsid-escrita-sem-idempotencia', 'dmsid-idempotencia-repete', 'dmsid-idempotencia-outro-corpo'];
  if (mcp) {
    for (const nome of nomesDaConta) pular(nome, 'Porta MCP: estas conferências são da porta REST.');
  } else {
    const pedirRest = async (caminho: string, o: { ligacao: string; metodo?: string; corpo?: unknown; cabecalhos?: Record<string, string>; onde: string }): Promise<Resposta> => {
      const cab: Record<string, string> = { accept: 'application/json', ...(config.leitura.cabecalhos ?? {}), ...(o.cabecalhos ?? {}), authorization: `Bearer ${token}`, [CABECALHO_LIGACAO]: o.ligacao };
      if (o.corpo !== undefined) cab['content-type'] = 'application/json';
      const r = await chamar(new URL(caminho, config.base), { method: o.metodo ?? 'GET', headers: cab, body: o.corpo === undefined ? undefined : JSON.stringify(o.corpo) });
      if (r.status >= 400) errosVistos.push({ onde: o.onde, r });
      return r;
    };
    // O isolamento: a ligação da conta B, do mesmo aplicativo, não lê o recurso da conta A.
    if (!config.recursoDaContaA || !idRecursoA || !ligacaoOutraConta) {
      const motivo = `A config não diz um recurso da conta A por id, ou faltam o id e a ligação da outra conta (${opcional}).`;
      pular('dmsid-mesma-conta-ve', motivo);
      pular('dmsid-outra-conta-nao-ve', motivo);
    } else {
      const recurso = config.recursoDaContaA.replace('{id}', encodeURIComponent(idRecursoA));
      const daMesma = await pedirRest(recurso, { ligacao, onde: 'recurso da própria conta' });
      registrar('dmsid-mesma-conta-ve', daMesma.status === 200, `A ligação da conta A lê o próprio recurso: esperado 200; veio ${resumo(daMesma)}.`);
      const daOutra = await pedirRest(recurso, { ligacao: ligacaoOutraConta, onde: 'recurso de outra conta' });
      registrar('dmsid-outra-conta-nao-ve', daOutra.status === 403 || daOutra.status === 404, `A ligação da conta B, do mesmo aplicativo, não pode ler o recurso da A: esperado 403 ou 404; veio ${resumo(daOutra)}.`);
    }
    // O cursor: preso à rota e à conta.
    const caminhoLista = config.leitura.caminho;
    const comCursor = (c: string) => `${caminhoLista}${caminhoLista.includes('?') ? '&' : '?'}${c}`;
    if (!config.leitura.lista) {
      const motivo = `A leitura não é lista paginada (leitura.lista) (${opcional}).`;
      pular('dmsid-cursor-invalido', motivo);
      pular('dmsid-cursor-de-outra-conta', motivo);
    } else {
      const lixo = await pedirRest(comCursor('cursor=nao-e-cursor'), { ligacao, onde: 'cursor torto' });
      const deOutraRota = Buffer.from(JSON.stringify({ k: 'outra-rota', l: 'x', t: null, i: null })).toString('base64url');
      const outraRota = await pedirRest(comCursor(`cursor=${deOutraRota}`), { ligacao, onde: 'cursor de outra rota' });
      registrar(
        'dmsid-cursor-invalido',
        lixo.status === 400 && tipoDe(lixo) === 'cursor-invalido' && outraRota.status === 400 && tipoDe(outraRota) === 'cursor-invalido',
        `Cursor torto e cursor de outra rota: esperado 400 cursor-invalido; vieram ${resumo(lixo)} e ${resumo(outraRota)}.`,
      );
      const primeira = await pedirRest(comCursor('limite=1'), { ligacao, onde: 'lista de um em um' });
      const proximo = primeira.corpo?.proximo_cursor;
      if (!ligacaoOutraConta) {
        pular('dmsid-cursor-de-outra-conta', `Sem a ligação da outra conta (${opcional}).`);
      } else if (typeof proximo !== 'string' || !proximo) {
        pular('dmsid-cursor-de-outra-conta', 'A conta A precisa de ao menos dois registros na leitura para haver próxima página.');
      } else {
        const usado = await pedirRest(comCursor(`cursor=${encodeURIComponent(proximo)}`), { ligacao: ligacaoOutraConta, onde: 'cursor de outra conta' });
        registrar('dmsid-cursor-de-outra-conta', usado.status === 400 && tipoDe(usado) === 'cursor-invalido', `O cursor da conta A usado pela ligação da B: esperado 400 cursor-invalido; veio ${resumo(usado)}.`);
      }
    }
    // A escrita pela ligação: Idempotency-Key obrigatória; a mesma chave com o mesmo pedido devolve a mesma resposta.
    if (!config.escrita) {
      for (const nome of ['dmsid-escrita-sem-idempotencia', 'dmsid-idempotencia-repete', 'dmsid-idempotencia-outro-corpo']) pular(nome, `A config não tem escrita pela ligação (${opcional}).`);
    } else {
      const { caminho, corpo, corpoDiferente } = config.escrita;
      const metodo = config.escrita.metodo ?? 'POST';
      const semChave = await pedirRest(caminho, { ligacao, metodo, corpo, onde: 'escrita sem Idempotency-Key' });
      registrar('dmsid-escrita-sem-idempotencia', semChave.status === 400, `Escrita pela ligação sem Idempotency-Key: esperado 400; veio ${resumo(semChave)}.`);
      const chaveIdem = `kit-${randomUUID()}`;
      const um = await pedirRest(caminho, { ligacao, metodo, corpo, cabecalhos: { 'idempotency-key': chaveIdem }, onde: 'escrita' });
      const dois = await pedirRest(caminho, { ligacao, metodo, corpo, cabecalhos: { 'idempotency-key': chaveIdem }, onde: 'escrita repetida' });
      registrar(
        'dmsid-idempotencia-repete',
        um.status >= 200 && um.status < 300 && dois.status === um.status && JSON.stringify(dois.corpo) === JSON.stringify(um.corpo),
        `A mesma chave com o mesmo pedido devolve a mesma resposta: vieram ${resumo(um)} e ${resumo(dois)}.`,
      );
      const outro = await pedirRest(caminho, { ligacao, metodo, corpo: corpoDiferente ?? { kit: 'outro corpo' }, cabecalhos: { 'idempotency-key': chaveIdem }, onde: 'escrita com outro corpo' });
      registrar('dmsid-idempotencia-outro-corpo', outro.status === 422 && tipoDe(outro) === 'chave-reutilizada', `A mesma chave com outro pedido: esperado 422 chave-reutilizada; veio ${resumo(outro)}.`);
    }
  }

  // 5. Todo 401 traz o desafio (RFC 9110 §15.5.2); na MCP, com o endereço dos metadados do recurso
  const de401 = errosVistos.filter((e) => e.r.status === 401);
  const semDesafio = de401.filter(({ r }) => {
    const desafio = r.cabecalhos.get('www-authenticate') ?? '';
    return !/^Bearer\b/.test(desafio) || (mcp && !/resource_metadata="[^"]+"/.test(desafio));
  });
  registrar(
    'dmsid-401-com-desafio',
    de401.length > 0 && semDesafio.length === 0,
    de401.length === 0
      ? 'Nenhuma resposta 401 no caminho.'
      : semDesafio.length
        ? `401 sem WWW-Authenticate${mcp ? ' com resource_metadata' : ''}: ${semDesafio.map((e) => e.onde).join('; ')}.`
        : `${de401.length} respostas 401, todas com WWW-Authenticate${mcp ? ' e resource_metadata' : ''}.`,
  );

  // 6. Toda resposta de erro em problem+json
  resultados.push(conferenciaDoFormato('dmsid-erros-em-problem-json', errosVistos));

  // 7. Na MCP, os metadados do recurso (RFC 9728): é por eles que o cliente acha o DMS ID
  if (!mcp) {
    pular('dmsid-mcp-metadados', 'Porta REST: os metadados do recurso (RFC 9728) são da porta MCP.');
  } else {
    const endereco = /resource_metadata="([^"]+)"/.exec(semToken.cabecalhos.get('www-authenticate') ?? '')?.[1];
    if (!endereco) {
      registrar('dmsid-mcp-metadados', false, 'O 401 sem token não diz resource_metadata no WWW-Authenticate: o cliente MCP não acha o DMS ID.');
    } else {
      let ok = false;
      let detalhe: string;
      try {
        const u = new URL(endereco, config.base);
        const PREFIXO = '/.well-known/oauth-protected-resource';
        const resto = u.pathname.startsWith(PREFIXO) ? u.pathname.slice(PREFIXO.length) : null;
        // RFC 9728 §3.3: o `resource` é o endereço de onde os metadados saíram, sem o trecho do .well-known
        const esperado = resto !== null && (resto === '' || resto.startsWith('/')) ? `${u.origin}${resto}` : null;
        const m = await chamar(u, { headers: { accept: 'application/json' } });
        const recurso = typeof m.corpo?.resource === 'string' ? (m.corpo.resource as string) : null;
        const servidores: unknown[] = Array.isArray(m.corpo?.authorization_servers) ? m.corpo.authorization_servers : [];
        const validos = servidores.filter((s): s is string => typeof s === 'string' && s.length > 0);
        const semBarra = (s: string) => s.replace(/\/$/, '');
        ok = m.status === 200 && esperado !== null && recurso !== null && semBarra(recurso) === semBarra(esperado) && validos.length > 0;
        detalhe = ok
          ? `Metadados em ${u.pathname}: recurso ${recurso}, servidor de autorização ${validos.join(', ')}.`
          : `Esperado 200 com "resource" = ${esperado ?? '(endereço fora de /.well-known/oauth-protected-resource)'} e "authorization_servers"; veio ${m.status}, resource ${recurso ?? 'ausente'}, ${validos.length} servidor(es).`;
      } catch (e) {
        detalhe = `Não consegui ler os metadados em ${endereco}: ${(e as Error).message}`;
      }
      registrar('dmsid-mcp-metadados', ok, detalhe);
    }
  }

  // 8. Limite (por último: esgota a cota da ligação)
  if (config.limite) {
    let viu: Resposta | null = null;
    for (let n = 0; n < config.limite.chamadas && !viu; n += 1) {
      const r = await pedir('limite', { token, ligacao });
      if (r.status === 429) viu = r;
    }
    const retry = Number(viu?.cabecalhos.get('retry-after'));
    registrar(
      'dmsid-limite',
      !!viu && tipoDe(viu) === 'limite-de-chamadas' && retry >= 1,
      viu ? `429 com Retry-After ${viu.cabecalhos.get('retry-after') ?? 'ausente'}.` : `Nenhum 429 em ${config.limite.chamadas} chamadas com a mesma ligação.`,
    );
  } else {
    pular('dmsid-limite', 'A config não diz o limite da porta.');
  }

  return resultados;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// O modo dos avisos (Padrão §9): a bateria de ataque contra quem RECEBE aviso
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const CREDENCIAIS_AVISOS = ['segredo', 'segredoOutraLigacao'] as const;
export type NomeCredencialAvisos = (typeof CREDENCIAIS_AVISOS)[number];
export type ValoresAvisos = Partial<Record<NomeCredencialAvisos, string>>;

export type ConfigKitAvisos = {
  modo: 'avisos';
  produto: string;
  /** O endereço de quem recebe, no ambiente de teste: a base da lista aprovada mais o id da ligação. */
  destino: string;
  /** Um aviso que o destino aceita: só o gatilho (o tipo e os ids), nunca dado pessoal (Padrão §9). Um objeto JSON. */
  corpo: Record<string, unknown>;
  copiaDoPacote?: string;
  /**
   * NOMES das variáveis de ambiente, as duas obrigatórias:
   * - `segredo`: o `whsec_` da ligação do destino;
   * - `segredoOutraLigacao`: o `whsec_` de OUTRA ligação no mesmo produto (o aviso assinado com ele não pode valer no
   *   endereço da primeira).
   */
  credenciais: Record<NomeCredencialAvisos, string>;
};

/** Fora da janela de tolerância do Padrão (5 minutos), com folga para o relógio de quem recebe. */
const FORA_DA_JANELA_SEG = 10 * 60;

/** Aceito: 2xx. Recusado: 4xx que não seja "rota não encontrada" nem "método não permitido" (esses dizem que o destino está errado). */
const avisoAceito = (r: Resposta): boolean => r.status >= 200 && r.status < 300;
const avisoRecusado = (r: Resposta): boolean => r.status >= 400 && r.status < 500 && r.status !== 404 && r.status !== 405;

export async function rodarKitAvisos(config: ConfigKitAvisos, valores: ValoresAvisos): Promise<Resultado[]> {
  const { ehProduto, assinarAviso, chaveDoSegredoAviso, gerarSegredoAviso } = await carregarPacote(config.copiaDoPacote);
  if (!ehProduto(config.produto)) throw new Error(`Produto desconhecido na config: ${config.produto}`);
  if (!config.corpo || typeof config.corpo !== 'object' || Array.isArray(config.corpo)) throw new Error('A config precisa de "corpo": um aviso em objeto JSON que o destino aceita.');
  const resultados: Resultado[] = [conferenciaDaCopia(config.copiaDoPacote)];
  const errosVistos: ErroVisto[] = [];
  const registrar = (nome: string, ok: boolean, detalhe: string) => resultados.push({ nome, ok, detalhe });

  const chave = valores.segredo ? chaveDoSegredoAviso(valores.segredo) : null;
  if (!chave) {
    registrar('aviso-valido-aceito', false, valores.segredo ? 'O segredo da ligação está fora do formato whsec_.' : 'Sem o segredo da ligação, nada se confere.');
    return resultados;
  }
  const destino = new URL(config.destino);
  const corpo = JSON.stringify(config.corpo);
  const agoraSeg = () => Math.floor(Date.now() / 1000);
  const novoId = () => `msg_kit_${randomUUID().replace(/-/g, '')}`;
  const assinado = (k: Buffer, id: string, ts: number, texto = corpo) => assinarAviso(k, id, ts, texto);
  const cabecalhos = (id: string, ts: number, assinatura: string | null): Record<string, string> => ({
    'webhook-id': id,
    'webhook-timestamp': String(ts),
    ...(assinatura === null ? {} : { 'webhook-signature': assinatura }),
  });

  async function enviar(onde: string, cab: Record<string, string>, texto = corpo): Promise<Resposta> {
    // como quem manda aviso de verdade (Padrão §9): sem seguir redirecionamento; o 3xx é a resposta do destino
    const r = await chamar(destino, { method: 'POST', redirect: 'manual', headers: { accept: 'application/json', 'content-type': 'application/json', ...cab }, body: texto });
    if (r.status >= 400) errosVistos.push({ onde, r });
    return r;
  }

  // 1. O aviso certo é aceito. Sem isso, as recusas não provam nada (quem recusa tudo passaria nelas).
  const id = novoId();
  const ts = agoraSeg();
  const valido = await enviar('aviso válido', cabecalhos(id, ts, assinado(chave, id, ts)));
  registrar('aviso-valido-aceito', avisoAceito(valido), `O aviso assinado com o segredo da ligação: esperado 2xx; veio ${resumo(valido)}.`);
  if (!avisoAceito(valido)) return resultados;

  // 2. A mesma entrega de novo (o remetente repete quando não ouve a resposta): o aviso é só gatilho, e repetir não é erro.
  const repetido = await enviar('aviso repetido', cabecalhos(id, ts, assinado(chave, id, ts)));
  registrar('aviso-repetido-aceito', avisoAceito(repetido), `O mesmo aviso, com o mesmo webhook-id, de novo: esperado 2xx; veio ${resumo(repetido)}.`);

  // 3. Duas assinaturas separadas por espaço (a troca de segredo, Standard Webhooks): vale se uma confere.
  const outra = chaveDoSegredoAviso(gerarSegredoAviso());
  if (!outra) throw new Error('O pacote gerou um segredo de aviso fora do formato.');
  const idDuas = novoId();
  const tsDuas = agoraSeg();
  const duas = await enviar('duas assinaturas', cabecalhos(idDuas, tsDuas, `${assinado(outra, idDuas, tsDuas)} ${assinado(chave, idDuas, tsDuas)}`));
  registrar('aviso-duas-assinaturas', avisoAceito(duas), `Duas assinaturas, a primeira de outro segredo e a segunda certa: esperado 2xx; veio ${resumo(duas)}.`);

  // 4. As recusas: cada uma com um webhook-id novo, para não esbarrar na repetição.
  async function recusa(nome: string, descricao: string, montar: (id: string, ts: number) => { cab: Record<string, string>; texto?: string }): Promise<void> {
    const idNovo = novoId();
    const { cab, texto } = montar(idNovo, agoraSeg());
    const r = await enviar(nome, cab, texto);
    registrar(nome, avisoRecusado(r), `${descricao}: esperado 4xx; veio ${resumo(r)}.`);
  }
  await recusa('aviso-sem-assinatura', 'Sem o cabeçalho webhook-signature', (i, t) => ({ cab: cabecalhos(i, t, null) }));
  await recusa('aviso-outro-segredo', 'Assinado com um segredo que o destino não conhece', (i, t) => ({ cab: cabecalhos(i, t, assinado(outra, i, t)) }));
  const outraLigacao = valores.segredoOutraLigacao ? chaveDoSegredoAviso(valores.segredoOutraLigacao) : null;
  if (outraLigacao) {
    await recusa('aviso-segredo-de-outra-ligacao', 'Assinado com o segredo de outra ligação do mesmo produto', (i, t) => ({ cab: cabecalhos(i, t, assinado(outraLigacao, i, t)) }));
  } else {
    registrar(
      'aviso-segredo-de-outra-ligacao',
      false,
      valores.segredoOutraLigacao ? 'O segredo da outra ligação está fora do formato whsec_.' : 'Sem o segredo "segredoOutraLigacao" para testar. O que não se confere não está conforme.',
    );
  }
  const adulterado = JSON.stringify({ ...config.corpo, adulterado_pelo_kit: true });
  await recusa('aviso-corpo-adulterado', 'Assinatura do corpo original com outro corpo', (i, t) => ({ cab: cabecalhos(i, t, assinado(chave, i, t)), texto: adulterado }));
  await recusa('aviso-id-trocado', 'Assinatura feita para outro webhook-id', (i, t) => ({ cab: cabecalhos(i, t, assinado(chave, novoId(), t)) }));
  await recusa('aviso-velho', `Assinado certo, mas de ${FORA_DA_JANELA_SEG / 60} minutos atrás (fora da tolerância de 5)`, (i, t) => ({ cab: cabecalhos(i, t - FORA_DA_JANELA_SEG, assinado(chave, i, t - FORA_DA_JANELA_SEG)) }));
  await recusa('aviso-do-futuro', `Assinado certo, mas daqui a ${FORA_DA_JANELA_SEG / 60} minutos`, (i, t) => ({ cab: cabecalhos(i, t + FORA_DA_JANELA_SEG, assinado(chave, i, t + FORA_DA_JANELA_SEG)) }));

  // 5. As recusas no formato do Padrão (§7)
  resultados.push(conferenciaDoFormato('avisos-erros-em-problem-json', errosVistos));
  return resultados;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// O modo de quem ENVIA aviso (Padrão §9): o kit faz o papel de quem recebe
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//
// O kit escuta em 127.0.0.1, o produto de TESTE tem o endereço do kit cadastrado como destino da ligação de teste (o
// Regem aceita `http:` só na própria máquina), e o gatilho faz o produto mandar três avisos: o primeiro o kit aceita
// (2xx), o segundo recusa com 503 (o aviso da mesma mudança tem de voltar, com recuo) e o terceiro responde 307 (quem
// envia não segue). A repetição se reconhece pela mudança (o tipo, o id e a loja), não pelo `webhook-id`: no Regem,
// cada tentativa leva um id novo, e o Padrão não pede o mesmo. Com o endereço do hub do produto apontado para o kit, o
// registro de cada envio também se confere (opcional).

export const CREDENCIAIS_ENVIO = ['segredo'] as const;
export type NomeCredencialEnvio = (typeof CREDENCIAIS_ENVIO)[number];
/** `segredo`: o `whsec_` da ligação de teste; `gatilho`: os cabeçalhos do gatilho, já com os valores. */
export type ValoresEnvio = { segredo?: string; gatilho?: Record<string, string> };

/** O que faz o produto mandar um aviso: uma chamada ao ambiente de teste, ou `manual` (o kit pede a ação e espera). */
export type GatilhoEnvio =
  | 'manual'
  | {
      url: string;
      metodo?: 'POST' | 'PUT' | 'PATCH';
      corpo?: unknown;
      /** Cabeçalho → NOME da variável de ambiente com o valor (a credencial nunca fica na config). */
      cabecalhos?: Record<string, string>;
    };

export type ConfigKitEnvio = {
  modo: 'envio';
  produto: string;
  /** A porta em que o kit escuta, em 127.0.0.1. `0` = uma livre; `{porta}` na url e no corpo do gatilho vira o número. */
  porta: number;
  /** O caminho do endereço de aviso cadastrado no produto para a ligação de teste (`/avisos/lig-kit`). */
  caminho: string;
  gatilho: GatilhoEnvio;
  /** Espera pelo aviso depois de cada gatilho, em segundos. Padrão 120: o Regem manda no máximo um por minuto por loja. */
  esperaSeg?: number;
  /** Espera pela repetição depois da falha, em segundos. Padrão 300 (o recuo do Regem começa em 60 s). */
  esperaRepeticaoSeg?: number;
  /** O menor recuo aceito entre a falha e a repetição, em segundos. Padrão 1. */
  recuoMinimoSeg?: number;
  /** Quanto tempo olhar se o redirecionamento foi seguido, em segundos. Padrão 5. */
  observaSeg?: number;
  /**
   * O registro no hub, opcional: o produto de teste com o endereço do hub apontado para o kit
   * (`http://127.0.0.1:<porta>`). Sem isto, as três conferências do registro são puladas. Padrão da espera: 20 s.
   */
  registro?: { esperaSeg?: number };
  copiaDoPacote?: string;
  /** NOME da variável de ambiente com o `whsec_` da ligação de teste (o mesmo com que o produto assina). */
  credenciais: Record<NomeCredencialEnvio, string>;
};

/** Os campos do registro de aviso no hub (`AvisoRegistrado`, pacote 0.4.0). Campo além destes é conteúdo demais. */
const CAMPOS_DO_REGISTRO = new Set([
  'codigo', 'ocorrido_em', 'aplicativo', 'ligacao_prefixo', 'conta', 'conta_nome', 'tipo', 'destino', 'resultado', 'status_http', 'duracao_ms', 'tentativa',
]);
const TIPO_DE_AVISO = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const CAMPO_PESSOAL = /^(nome|name|e_?mail|telefone|fone|phone|celular|whatsapp|cpf|documento|endereco|address|nascimento)$/i;
/** E-mail, CPF com pontuação e telefone com +55. O detalhe diz só o campo, nunca o valor. */
const TEXTO_PESSOAL: readonly RegExp[] = [/[^\s@"]{1,64}@[^\s@"]{1,255}\.[A-Za-z]{2,24}/, /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, /\+55\s?\(?\d{2}\)?\s?\d{4,5}/];
const TETO_DO_AVISO = 4 * 1024;
const TETO_DO_RECEBIDO = 64 * 1024;
const TOLERANCIA_SEG = 300;

/** O que chegou ao kit fora do hub de mentira (os cabeçalhos guardados são só os do aviso). */
type Entrega = { quando: number; metodo: string; caminho: string; cabecalhos: Record<string, string | undefined>; texto: string; status: number };

const CABECALHOS_DO_AVISO = ['webhook-id', 'webhook-timestamp', 'webhook-signature', 'content-type'] as const;

function cabecalhosDoAviso(req: IncomingMessage): Record<string, string | undefined> {
  const lidos: Record<string, string | undefined> = {};
  for (const nome of CABECALHOS_DO_AVISO) {
    const v = req.headers[nome];
    lidos[nome] = Array.isArray(v) ? v.join(', ') : v;
  }
  return lidos;
}

/** O corpo recebido, até o teto (o resto se descarta, e o tamanho acima do teto já reprova o "só gatilho"). */
async function lerRecebido(req: IncomingMessage): Promise<string> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const pedaco of req) {
    const b = Buffer.isBuffer(pedaco) ? pedaco : Buffer.from(String(pedaco));
    if (total < TETO_DO_RECEBIDO) partes.push(b.subarray(0, TETO_DO_RECEBIDO - total));
    total += b.length;
  }
  return Buffer.concat(partes).toString('utf8');
}

function corpoDoAvisoRecebido(e: Entrega): Record<string, unknown> | null {
  try {
    const j: unknown = JSON.parse(e.texto);
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** De que mudança é o aviso: o tipo, o id e a loja (a `versao` pode crescer entre tentativas). Nulo sem corpo legível. */
function mudancaDoAviso(e: Entrega): string | null {
  const c = corpoDoAvisoRecebido(e);
  if (!c || typeof c.tipo !== 'string') return null;
  return JSON.stringify([c.tipo, c.id ?? null, c.loja_id ?? null]);
}

function problemasDosCabecalhos(e: Entrega): string[] {
  const problemas: string[] = [];
  if (e.metodo !== 'POST') problemas.push(`método ${e.metodo} em vez de POST`);
  if (!/^[\x21-\x7e]{1,255}$/.test(e.cabecalhos['webhook-id'] ?? '')) problemas.push('webhook-id ausente ou fora do formato');
  if (!/^\d{1,12}$/.test(e.cabecalhos['webhook-timestamp'] ?? '')) problemas.push('webhook-timestamp ausente ou fora do formato (segundos desde 1970)');
  const assinaturas = e.cabecalhos['webhook-signature'];
  if (!assinaturas || !assinaturas.split(' ').every((a) => /^v1,[A-Za-z0-9+/]{1,200}={0,2}$/.test(a))) {
    problemas.push('webhook-signature ausente ou fora do formato (v1,<base64>)');
  }
  return problemas;
}

/** O que há de errado no corpo para "só gatilho" (Padrão §9). Nunca repete um valor do corpo: só o nome do campo. */
function problemasDoCorpo(e: Entrega): string[] {
  const problemas: string[] = [];
  const tipoDeConteudo = e.cabecalhos['content-type'] ?? '';
  if (!/^application\/json\b/i.test(tipoDeConteudo)) problemas.push('o content-type não é application/json');
  const bytes = Buffer.byteLength(e.texto, 'utf8');
  if (bytes > TETO_DO_AVISO) problemas.push(`o corpo tem ${bytes} bytes, e o gatilho cabe em ${TETO_DO_AVISO}`);
  const c = corpoDoAvisoRecebido(e);
  if (!c) return [...problemas, 'o corpo não é um objeto JSON'];
  if (typeof c.tipo !== 'string' || !TIPO_DE_AVISO.test(c.tipo)) problemas.push('falta o "tipo" em minúsculas com ponto (pedido.alterado)');
  for (const [campo, valor] of Object.entries(c)) {
    if (CAMPO_PESSOAL.test(campo)) problemas.push(`o campo "${campo}" é dado pessoal`);
    else if (valor !== null && typeof valor === 'object') problemas.push(`o campo "${campo}" traz um objeto, e o aviso leva só o tipo e os ids`);
    else if (typeof valor === 'string' && TEXTO_PESSOAL.some((p) => p.test(valor))) problemas.push(`o campo "${campo}" parece dado pessoal (e-mail, CPF ou telefone)`);
  }
  return problemas;
}

/** O `webhook-timestamp` menos o relógio do kit na chegada, em segundos; nulo sem o cabeçalho. */
function desvioDoRelogio(e: Entrega): number | null {
  const ts = e.cabecalhos['webhook-timestamp'];
  return ts && /^\d{1,12}$/.test(ts) ? Number(ts) - Math.floor(e.quando / 1000) : null;
}

const segundos = (ms: number): string => (ms / 1000).toFixed(1);

export async function rodarKitEnvio(
  config: ConfigKitEnvio,
  valores: ValoresEnvio,
  opcoes: {
    /** Como pedir a ação no gatilho manual. Padrão: escrever no terminal. Recebe a porta em que o kit escuta. */
    avisar?: (texto: string, porta: number) => void;
  } = {},
): Promise<Resultado[]> {
  const { ehProduto, conferirAviso, chaveDoSegredoAviso, corpoProblema, TIPO_CONTEUDO_PROBLEMA } = await carregarPacote(config.copiaDoPacote);
  if (!ehProduto(config.produto)) throw new Error(`Produto desconhecido na config: ${config.produto}`);
  if (typeof config.caminho !== 'string' || !/^\/[A-Za-z0-9._~/-]{0,500}$/.test(config.caminho) || config.caminho.startsWith('/api/v1/')) {
    throw new Error('A config precisa de "caminho": o caminho do endereço de aviso no kit, começando por "/" e fora de /api/v1/ (que é do hub de mentira).');
  }
  if (!Number.isInteger(config.porta) || config.porta < 0 || config.porta > 65535) throw new Error('A config precisa de "porta": de 0 a 65535 (0 = uma livre).');
  const gatilho = config.gatilho;
  if (gatilho !== 'manual' && (!gatilho || typeof gatilho !== 'object' || typeof gatilho.url !== 'string')) {
    throw new Error('A config precisa de "gatilho": "manual" ou { "url": …, "corpo"?: …, "cabecalhos"?: … }.');
  }
  const avisar = opcoes.avisar ?? ((texto: string) => console.error(texto));
  const seg = (v: number | undefined, padrao: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : padrao);
  const esperaSeg = seg(config.esperaSeg, 120);
  const esperaRepeticaoSeg = seg(config.esperaRepeticaoSeg, 300);
  const recuoMinimoSeg = seg(config.recuoMinimoSeg, 1);
  const observaSeg = seg(config.observaSeg, 5);

  const resultados: Resultado[] = [conferenciaDaCopia(config.copiaDoPacote)];
  const registrar = (nome: string, ok: boolean, detalhe: string) => resultados.push({ nome, ok, detalhe });
  const segredo = valores.segredo;
  if (!segredo || !chaveDoSegredoAviso(segredo)) {
    registrar('envio-chega', false, segredo ? 'O segredo da ligação está fora do formato whsec_.' : 'Sem o segredo da ligação, nada se confere.');
    return resultados;
  }
  /** A assinatura confere com o segredo, sobre o id, o horário e o corpo que chegaram (o horário se confere à parte). */
  const assinaturaConfere = (e: Entrega): boolean => {
    const ts = e.cabecalhos['webhook-timestamp'];
    return !!ts && /^\d{1,12}$/.test(ts) && conferirAviso(segredo, e.cabecalhos, e.texto, new Date(Number(ts) * 1000));
  };

  const entregas: Entrega[] = [];
  const registros: Record<string, unknown>[] = [];
  let respostaDaProxima: { status: number; local?: string } | null = null;
  const desvio = `/kit-desvio/${randomUUID()}`;
  let desviado = false;
  const olhando = new Set<() => void>();
  const mudou = (): void => {
    for (const olhar of [...olhando]) olhar();
  };
  const avisos = (): Entrega[] => entregas.filter((e) => e.caminho === config.caminho);

  /** Espera a condição valer (conferida a cada chegada), até o prazo. */
  function esperar(condicao: () => boolean, ms: number): Promise<boolean> {
    if (condicao()) return Promise.resolve(true);
    return new Promise((ok) => {
      const olhar = (): void => {
        if (!condicao()) return;
        clearTimeout(relogio);
        olhando.delete(olhar);
        ok(true);
      };
      const relogio = setTimeout(() => {
        olhando.delete(olhar);
        ok(condicao());
      }, ms);
      olhando.add(olhar);
    });
  }

  /** O hub de mentira: o que o cliente do hub do pacote chama, com a lista de parada vazia; guarda os registros de aviso. */
  function hubDeMentira(req: IncomingMessage, caminho: string, texto: string, res: ServerResponse): void {
    const json = (status: number, corpo: unknown, extra: Record<string, string> = {}): void => {
      res.writeHead(status, { 'content-type': 'application/json', ...extra });
      res.end(JSON.stringify(corpo));
    };
    const problema = (status: number, detalhe: string): void => {
      res.writeHead(status, { 'content-type': TIPO_CONTEUDO_PROBLEMA });
      res.end(JSON.stringify(corpoProblema(status === 404 ? 'nao-encontrado' : 'parametro-invalido', detalhe)));
    };
    if (req.method === 'GET' && caminho === '/api/v1/parada') {
      if (req.headers['if-none-match'] === '"v1"') {
        res.writeHead(304, { etag: '"v1"' });
        res.end();
        return;
      }
      json(200, { versao: 1, itens: [] }, { etag: '"v1"' });
      return;
    }
    if (req.method === 'POST' && caminho === '/api/v1/batida') return json(200, { parada_versao: 1 });
    if (req.method === 'POST' && caminho === '/api/v1/avisos') {
      let lidos: unknown = null;
      try {
        lidos = (JSON.parse(texto) as { avisos?: unknown }).avisos;
      } catch {
        lidos = null;
      }
      if (!Array.isArray(lidos)) return problema(400, 'Mande { "avisos": [ … ] }.');
      for (const a of lidos) if (a && typeof a === 'object' && !Array.isArray(a)) registros.push(a as Record<string, unknown>);
      json(202, { recebidos: lidos.length });
      mudou();
      return;
    }
    if (req.method === 'POST' && (caminho === '/api/v1/registro' || caminho === '/api/v1/erros')) return json(202, {});
    problema(404, 'O hub de mentira do kit só tem a parada, a batida, o registro, os avisos e os erros.');
  }

  async function atender(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chegada = Date.now();
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const texto = await lerRecebido(req);
    if (url.pathname.startsWith('/api/v1/')) return hubDeMentira(req, url.pathname, texto, res);
    if (url.pathname === desvio) {
      desviado = true;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      mudou();
      return;
    }
    let status = url.pathname === config.caminho ? 200 : 404;
    const extra: Record<string, string> = {};
    if (status === 200 && req.method === 'POST' && respostaDaProxima) {
      status = respostaDaProxima.status;
      if (respostaDaProxima.local) extra.location = respostaDaProxima.local;
      respostaDaProxima = null;
    }
    entregas.push({ quando: chegada, metodo: req.method ?? '', caminho: url.pathname, cabecalhos: cabecalhosDoAviso(req), texto, status });
    res.writeHead(status, { 'content-type': 'application/json', ...extra });
    res.end('{}');
    mudou();
  }

  async function disparar(n: number, porta: number): Promise<string | null> {
    if (gatilho === 'manual') {
      avisar(`Faça no produto a ação que gera um aviso (${n} de 3). Espero até ${esperaSeg} s.`, porta);
      return null;
    }
    const trocar = (t: string): string => t.replaceAll('{porta}', String(porta));
    try {
      const r = await fetch(trocar(gatilho.url), {
        method: gatilho.metodo ?? 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', ...(valores.gatilho ?? {}) },
        body: gatilho.corpo === undefined ? undefined : trocar(JSON.stringify(gatilho.corpo)),
        signal: AbortSignal.timeout(15_000),
      });
      await r.body?.cancel().catch(() => undefined);
      return r.ok ? null : `O gatilho ${n} respondeu ${r.status}.`;
    } catch (e) {
      return `O gatilho ${n} não respondeu (${(e as Error).message}).`;
    }
  }

  /** Onde mais chegou aviso, para quem errou o caminho cadastrado. */
  function foraDoCaminho(): string {
    const outros = [...new Set(entregas.filter((e) => e.caminho !== config.caminho).map((e) => e.caminho))];
    return outros.length ? ` Chegou em ${outros.join(', ')} (o caminho da config é ${config.caminho}).` : '';
  }

  async function conferir(porta: number, origem: string): Promise<void> {
    // 1. O aviso aceito (2xx): chega, com os cabeçalhos, assinado, na hora e só com o gatilho
    const antes1 = avisos().length;
    const inicio1 = Date.now();
    const falha1 = await disparar(1, porta);
    const e1 = !falha1 && (await esperar(() => avisos().length > antes1, esperaSeg * 1000)) ? avisos()[antes1] : undefined;
    if (!e1) {
      registrar('envio-chega', false, falha1 ?? `Nenhum aviso em ${config.caminho} em ${esperaSeg} s depois do gatilho.${foraDoCaminho()}`);
      return;
    }
    registrar('envio-chega', true, `O aviso chegou em ${config.caminho}, ${segundos(e1.quando - inicio1)} s depois do gatilho.`);
    const cabecalhos1 = problemasDosCabecalhos(e1);
    registrar(
      'envio-cabecalhos',
      cabecalhos1.length === 0,
      cabecalhos1.length ? `O aviso veio com: ${cabecalhos1.join('; ')}.` : 'POST com webhook-id, webhook-timestamp e webhook-signature (v1).',
    );
    const assinado1 = assinaturaConfere(e1);
    registrar(
      'envio-assinatura',
      assinado1,
      assinado1
        ? 'A assinatura confere com o segredo da ligação, sobre o webhook-id, o webhook-timestamp e o corpo que chegaram.'
        : 'Nenhuma assinatura v1 confere com o segredo da ligação sobre o webhook-id, o webhook-timestamp e o corpo que chegaram.',
    );
    const desvio1 = desvioDoRelogio(e1);
    registrar(
      'envio-horario',
      desvio1 !== null && Math.abs(desvio1) <= TOLERANCIA_SEG,
      desvio1 === null
        ? 'Sem webhook-timestamp para conferir.'
        : `O webhook-timestamp está ${Math.abs(desvio1)} s ${desvio1 < 0 ? 'atrás' : 'à frente'} do relógio do kit (a tolerância de quem recebe é ${TOLERANCIA_SEG} s).`,
    );
    const corpo1 = problemasDoCorpo(e1);
    registrar('envio-so-gatilho', corpo1.length === 0, corpo1.length ? `No corpo: ${corpo1.join('; ')}.` : 'Só o tipo e os ids, em JSON, sem dado pessoal.');

    // 2. O destino falha (503): o aviso da mesma mudança volta, com recuo e assinado de novo
    respostaDaProxima = { status: 503 };
    const antes2 = avisos().length;
    const falha2 = await disparar(2, porta);
    const e2 = !falha2 && (await esperar(() => avisos().length > antes2, esperaSeg * 1000)) ? avisos()[antes2] : undefined;
    respostaDaProxima = null;
    if (!e2) {
      const motivo = falha2 ?? `O gatilho 2 não gerou aviso em ${esperaSeg} s: não deu para provocar a falha.`;
      registrar('envio-repete-depois-de-falha', false, motivo);
      registrar('envio-repeticao-com-recuo', false, motivo);
    } else {
      const mudanca = mudancaDoAviso(e2);
      const daMesma = (e: Entrega): boolean => mudanca === null || mudancaDoAviso(e) === mudanca;
      const repetiu = await esperar(() => avisos().slice(antes2 + 1).some(daMesma), esperaRepeticaoSeg * 1000);
      const e2b = repetiu ? avisos().slice(antes2 + 1).find(daMesma) : undefined;
      if (!e2b) {
        registrar('envio-repete-depois-de-falha', false, `Depois do 503, o aviso da mesma mudança não voltou em ${esperaRepeticaoSeg} s.`);
        registrar('envio-repeticao-com-recuo', false, 'Sem a repetição, não há recuo para medir.');
      } else {
        const problemas: string[] = [];
        if (!assinaturaConfere(e2b)) problemas.push('a assinatura não confere');
        const desvio2 = desvioDoRelogio(e2b);
        if (desvio2 === null || Math.abs(desvio2) > TOLERANCIA_SEG) problemas.push('o webhook-timestamp está fora da tolerância');
        const recuo = e2b.quando - e2.quando;
        registrar(
          'envio-repete-depois-de-falha',
          problemas.length === 0,
          problemas.length
            ? `A repetição chegou, mas: ${problemas.join('; ')}.`
            : `Depois do 503, o aviso da mesma mudança voltou, assinado de novo, ${segundos(recuo)} s depois.`,
        );
        registrar('envio-repeticao-com-recuo', recuo >= recuoMinimoSeg * 1000, `A repetição veio ${segundos(recuo)} s depois da falha (o mínimo é ${recuoMinimoSeg} s).`);
      }
    }

    // 3. O destino redireciona (307): quem envia não segue (o aviso e a assinatura não saem da lista aprovada)
    respostaDaProxima = { status: 307, local: `${origem}${desvio}` };
    const antes3 = avisos().length;
    const falha3 = await disparar(3, porta);
    const chegou3 = !falha3 && (await esperar(() => avisos().length > antes3, esperaSeg * 1000));
    respostaDaProxima = null;
    if (!chegou3) {
      registrar('envio-nao-segue-redirecionamento', false, falha3 ?? `O gatilho 3 não gerou aviso em ${esperaSeg} s: não deu para provocar o redirecionamento.`);
    } else {
      await esperar(() => desviado, observaSeg * 1000);
      registrar(
        'envio-nao-segue-redirecionamento',
        !desviado,
        desviado
          ? 'Depois do 307, o aviso foi mandado ao endereço do redirecionamento: ele, com a assinatura, saiu da lista aprovada.'
          : `Depois do 307, nada chegou ao endereço do redirecionamento em ${observaSeg} s.`,
      );
    }

    // 4. O registro no hub (opcional): cada envio, com o resultado, e nunca o conteúdo
    if (!config.registro) {
      for (const nome of ['envio-registro-entregue', 'envio-registro-falhou', 'envio-registro-sem-conteudo']) {
        resultados.push({ nome, ok: true, pulado: true, detalhe: 'Opcional: aponte o endereço do hub do produto de teste para o kit e ponha "registro" na config.' });
      }
      return;
    }
    const esperaRegistroSeg = seg(config.registro.esperaSeg, 20);
    const codigo1 = e1.cabecalhos['webhook-id'] ?? '';
    const codigo2 = e2?.cabecalhos['webhook-id'] ?? '';
    const doCodigo = (c: string): Record<string, unknown> | undefined => registros.find((r) => r.codigo === c);
    await esperar(() => !!doCodigo(codigo1) && (!e2 || !!doCodigo(codigo2)), esperaRegistroSeg * 1000);

    const r1 = doCodigo(codigo1);
    const tipo1 = corpoDoAvisoRecebido(e1)?.tipo;
    const erros1: string[] = [];
    if (!r1) erros1.push(`nenhum registro com o código do aviso (o webhook-id) em ${esperaRegistroSeg} s`);
    else {
      if (r1.resultado !== 'entregue') erros1.push(`o resultado é "${String(r1.resultado)}", e não "entregue"`);
      if (r1.tipo !== tipo1) erros1.push(`o tipo é "${String(r1.tipo)}", e não "${String(tipo1)}"`);
    }
    registrar(
      'envio-registro-entregue',
      erros1.length === 0,
      erros1.length ? `O registro do aviso aceito: ${erros1.join('; ')}.` : 'O hub recebeu o aviso aceito, com o código, o tipo e o resultado "entregue".',
    );

    if (!e2) registrar('envio-registro-falhou', false, 'Sem a falha provocada, não há o registro dela para conferir.');
    else {
      const r2 = doCodigo(codigo2);
      const erros2: string[] = [];
      if (!r2) erros2.push(`nenhum registro com o código do aviso recusado em ${esperaRegistroSeg} s`);
      else if (r2.resultado !== 'falhou') erros2.push(`o resultado é "${String(r2.resultado)}", e não "falhou"`);
      registrar(
        'envio-registro-falhou',
        erros2.length === 0,
        erros2.length ? `O registro do aviso recusado com 503: ${erros2.join('; ')}.` : 'O hub recebeu o aviso recusado com 503, com o resultado "falhou".',
      );
    }

    const demais = new Set<string>();
    for (const r of registros) {
      for (const campo of Object.keys(r)) if (!CAMPOS_DO_REGISTRO.has(campo)) demais.add(`o campo "${campo}"`);
      if (r.destino !== undefined && (typeof r.destino !== 'string' || !/^https?:\/\/[^/?#\s]+$/.test(r.destino))) demais.add('o destino com caminho (só a origem vai ao hub)');
    }
    registrar(
      'envio-registro-sem-conteudo',
      registros.length > 0 && demais.size === 0,
      registros.length === 0
        ? 'O hub não recebeu registro nenhum.'
        : demais.size
          ? `O registro levou ${[...demais].join('; ')}.`
          : `${registros.length} registro(s), só com os campos do registro do Padrão (nunca o conteúdo).`,
    );
  }

  const servidor = createServer((req, res) => {
    atender(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((ok, falha) => {
    servidor.once('error', falha);
    servidor.listen(config.porta, '127.0.0.1', () => {
      servidor.off('error', falha);
      ok();
    });
  });
  const porta = (servidor.address() as AddressInfo).port;
  try {
    await conferir(porta, `http://127.0.0.1:${porta}`);
  } finally {
    respostaDaProxima = null;
    olhando.clear();
    servidor.closeAllConnections();
    await new Promise<void>((ok) => servidor.close(() => ok()));
  }
  return resultados;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// O modo do manifesto (Padrão §13; decisão F4-1): o arquivo que descreve a porta
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//
// O kit lê o manifesto da porta (`base` + `/.well-known/dms-manifesto`, sem credencial: é a documentação pública da
// porta) ou do arquivo que o produto gera no CI (`arquivo`), e confere com o `conferirManifesto` da cópia do pacote do
// próprio produto, que precisa ser a 0.6.0 ou mais nova.

export const VERSAO_MINIMA_MANIFESTO = '0.6.0';

export type ConfigKitManifesto = {
  modo: 'manifesto';
  produto: string;
  /** O manifesto que o produto gera (no CI). Sem isto, o kit lê da porta, em `base` + `caminho`. */
  arquivo?: string;
  /** O endereço do produto (só o começo: o kit junta o caminho do manifesto). */
  base?: string;
  /** Padrão: `/.well-known/dms-manifesto`. */
  caminho?: string;
  copiaDoPacote?: string;
};

export async function rodarKitManifesto(config: ConfigKitManifesto): Promise<Resultado[]> {
  const pacote = await carregarPacote(config.copiaDoPacote);
  if (!pacote.ehProduto(config.produto)) throw new Error(`Produto desconhecido na config: ${config.produto}`);
  if (!config.arquivo && !config.base) throw new Error('A config precisa de "arquivo" (o manifesto gerado) ou de "base" (o endereço do produto).');
  const resultados: Resultado[] = [conferenciaDaCopia(config.copiaDoPacote, VERSAO_MINIMA_MANIFESTO, 'não tem o manifesto')];
  const registrar = (nome: string, ok: boolean, detalhe: string) => resultados.push({ nome, ok, detalhe });

  let doc: unknown;
  if (config.arquivo) {
    try {
      doc = JSON.parse(readFileSync(config.arquivo, 'utf8'));
    } catch (e) {
      registrar('manifesto-chega', false, `Não consegui ler ${config.arquivo} como JSON: ${(e as Error).message}`);
      return resultados;
    }
    registrar('manifesto-chega', true, `Lido de ${config.arquivo}.`);
  } else {
    const url = new URL(config.caminho ?? '/.well-known/dms-manifesto', config.base);
    let r: Resposta;
    try {
      r = await chamar(url, { headers: { accept: 'application/json' } });
    } catch (e) {
      registrar('manifesto-chega', false, `Sem resposta de ${url.href}: ${(e as Error).message}`);
      return resultados;
    }
    const emJson = r.status === 200 && /^application\/json\b/i.test(r.tipoConteudo) && !!r.corpo && typeof r.corpo === 'object';
    registrar(
      'manifesto-chega',
      emJson,
      emJson
        ? 'O manifesto chega sem credencial, em JSON.'
        : r.status === 401 || r.status === 403
          ? `Veio ${r.status}: o manifesto é a documentação pública da porta e chega sem credencial.`
          : `Esperado 200 em application/json; veio ${resumo(r)}.`,
    );
    if (!emJson) return resultados;
    doc = r.corpo;
  }

  // A cópia anterior à 0.6.0 não tem a conferência: o produto copia a nova do hub.
  const conferir = (pacote as Partial<Pacote>).conferirManifesto;
  if (typeof conferir !== 'function') {
    registrar('manifesto-formato', false, `A cópia do pacote não tem o conferirManifesto: copie a ${VERSAO_MINIMA_MANIFESTO} ou mais nova do hub.`);
    return resultados;
  }
  const problemas = conferir(doc);
  registrar(
    'manifesto-formato',
    problemas.length === 0,
    problemas.length
      ? `${problemas.length} problema(s): ${problemas.slice(0, 8).join('; ')}${problemas.length > 8 ? '; …' : ''}.`
      : 'OpenAPI 3.1 com os campos x-dms: as permissões com a frase, as classes e o sensível; as rotas, as ferramentas e os avisos com permissão declarada e exemplo.',
  );
  const info = doc && typeof doc === 'object' ? (doc as { info?: unknown }).info : undefined;
  const produto = info && typeof info === 'object' ? (info as Record<string, unknown>)['x-dms-produto'] : undefined;
  registrar(
    'manifesto-do-produto',
    produto === config.produto,
    produto === config.produto ? `O manifesto é do ${config.produto}.` : `O manifesto diz "${String(produto)}", e a config diz "${config.produto}".`,
  );
  return resultados;
}

// Linha de comando: node kit-conformidade.mts config.json
if (process.argv[1] && /kit-conformidade\.m?ts$/.test(process.argv[1])) {
  const caminhoConfig = process.argv[2];
  if (!caminhoConfig) {
    console.error('Uso: node kit-conformidade.mts caminho/da/config.json');
    process.exit(2);
  }
  const lida = JSON.parse(readFileSync(caminhoConfig, 'utf8')) as ConfigKit | ConfigKitDmsId | ConfigKitAvisos | ConfigKitEnvio | ConfigKitManifesto;
  const faltando: string[] = [];
  let rodar: () => Promise<Resultado[]>;
  if ('modo' in lida && lida.modo === 'manifesto') {
    const config = lida;
    rodar = () => rodarKitManifesto(config);
  } else if ('modo' in lida && lida.modo === 'envio') {
    const config = lida;
    const valores: ValoresEnvio = {};
    const variavel = config.credenciais?.segredo;
    const v = variavel ? process.env[variavel] : undefined;
    if (!variavel) faltando.push('(config sem credenciais.segredo)');
    else if (!v) faltando.push(variavel);
    else valores.segredo = v;
    // Os cabeçalhos do gatilho: cada valor é o NOME de uma variável de ambiente, como as credenciais.
    if (config.gatilho && config.gatilho !== 'manual' && config.gatilho.cabecalhos) {
      const doGatilho: Record<string, string> = {};
      for (const [cabecalho, nome] of Object.entries(config.gatilho.cabecalhos)) {
        const valor = process.env[nome];
        if (!valor) faltando.push(nome);
        else doGatilho[cabecalho] = valor;
      }
      valores.gatilho = doGatilho;
    }
    rodar = () => rodarKitEnvio(config, valores);
  } else if ('modo' in lida && lida.modo === 'avisos') {
    const config = lida;
    const valores: ValoresAvisos = {};
    for (const nome of CREDENCIAIS_AVISOS) {
      const variavel = config.credenciais?.[nome];
      const v = variavel ? process.env[variavel] : undefined;
      if (!variavel) faltando.push(`(config sem credenciais.${nome})`);
      else if (!v) faltando.push(variavel);
      else valores[nome] = v;
    }
    rodar = () => rodarKitAvisos(config, valores);
  } else if ('modo' in lida && lida.modo === 'dms_id') {
    const config = lida;
    const valores: ValoresDmsId = {};
    for (const nome of CREDENCIAIS_DMS_ID) {
      const variavel = config.credenciais?.[nome];
      const v = variavel ? process.env[variavel] : undefined;
      if (!variavel) faltando.push(`(config sem credenciais.${nome})`);
      else if (!v) faltando.push(variavel);
      else valores[nome] = v;
    }
    // As opcionais: a que a config nomeia tem de estar no ambiente; a que ela não nomeia é pulada no kit.
    for (const nome of CREDENCIAIS_DMS_ID_OPCIONAIS) {
      const variavel = config.credenciaisOpcionais?.[nome];
      if (!variavel) continue;
      const v = process.env[variavel];
      if (!v) faltando.push(variavel);
      else valores[nome] = v;
    }
    rodar = () => rodarKitDmsId(config, valores);
  } else {
    const config = lida as ConfigKit;
    const valores = {} as Valores;
    for (const [nome, variavel] of Object.entries(config.credenciais) as [NomeCredencial, string][]) {
      if (!variavel) continue;
      const v = process.env[variavel];
      if (!v) faltando.push(variavel);
      valores[nome] = v ?? '';
    }
    for (const obrigatoria of ['valida', 'outraEmpresa', 'revogada'] as const) {
      if (!config.credenciais[obrigatoria]) faltando.push(`(config sem credenciais.${obrigatoria})`);
    }
    rodar = () => rodarKit(config, valores);
  }
  if (faltando.length) {
    console.error(`Faltam as variáveis de ambiente: ${faltando.join(', ')}`);
    process.exit(2);
  }
  rodar().then(
    (resultados) => {
      for (const r of resultados) console.log(`${r.pulado ? '–' : r.ok ? '✔' : '✘'} ${r.nome}: ${r.detalhe}`);
      const falhas = resultados.filter((r) => !r.ok);
      console.log(falhas.length ? `\n${falhas.length} conferência(s) falharam. A porta não abre.` : '\nTudo certo.');
      process.exit(falhas.length ? 1 : 0);
    },
    (e) => {
      console.error(e);
      process.exit(2);
    },
  );
}
