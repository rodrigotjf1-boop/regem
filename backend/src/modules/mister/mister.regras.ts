import { randomInt } from 'node:crypto';

// MISTER — o que a entrada do WhatsApp decide SEM tocar no banco (mig 417).
//
// O número do Mister é um só, da distribuição, para todas as empresas. Quem diz de qual empresa é a conversa é o
// telefone de quem escreve — e ele só representa alguém depois de ligado por dentro do Regem, pela própria pessoa, com
// um código de 10 minutos que vale uma vez. As cinco regras de separação estão em `docs/plano-mister.md`.

/** Quem pode falar com o Mister. O que cada gerente pode entra ao fim do projeto, como perfil por hierarquia. */
export const NIVEIS_DO_MISTER = ['presidente', 'gerente'] as const;

/** Validade do código de ligar. */
export const CODIGO_VALE_MIN = 10;
/** A palavra que vai na frente do código. É o que separa "ligar ao Mister" de "ligar ao número da loja" (REGEM 123456). */
export const PALAVRA_DO_CODIGO = 'MISTER';

/** A resposta fixa a quem não está ligado sai no máximo uma vez neste intervalo, por telefone. */
export const RESPOSTA_FIXA_A_CADA_H = 12;
/** Depois de tantos códigos errados na janela, o telefone deixa de ser atendido em códigos até a janela passar. */
export const CODIGOS_ERRADOS_MAX = 5;
export const CODIGOS_ERRADOS_JANELA_MIN = 60;
/** Enquanto as perguntas não estão no ar, a resposta "ainda não respondo" sai no máximo uma vez neste intervalo. */
export const AINDA_NAO_RESPONDO_A_CADA_MIN = 30;
/** Quanto tempo o Mister guarda a mensagem que esperava a escolha da empresa. */
export const PENDENTE_VALE_MIN = 10;
/** A janela de conversa da Meta: dentro dela a resposta é texto livre; fora, só modelo aprovado. */
export const JANELA_DA_META_H = 24;

/** Limites do WhatsApp para botões de resposta. */
export const BOTOES_MAX = 3;
export const TITULO_DO_BOTAO_MAX = 20;
const PREFIXO_DO_BOTAO = 'mister_emp:';

export type EmpresaDoTelefone = { tenantId: string; nome: string };

/** Seis dígitos, nunca começando por zero (o WhatsApp do celular às vezes come o zero à esquerda ao colar). */
export function novoCodigo(sorteio: (min: number, max: number) => number = randomInt): string {
  return String(sorteio(100000, 1000000));
}

export const mensagemDoCodigo = (codigo: string) => `${PALAVRA_DO_CODIGO} ${codigo}`;

/** O link que abre o WhatsApp do celular com a mensagem pronta. `numero` = só dígitos, com o país. */
export function linkDoCodigo(numero: string, codigo: string): string {
  return `https://wa.me/${soDigitos(numero)}?text=${encodeURIComponent(mensagemDoCodigo(codigo))}`;
}

export const soDigitos = (v: unknown) => String(v ?? '').replace(/\D+/g, '');

/** Tira acento e caixa, e aperta os espaços: para comparar o que a pessoa escreveu. */
export function normalizar(texto: unknown): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * O código que veio na mensagem, ou null. Aceita "MISTER 482913", "mister482913" e "Mister: 482 913" — a pessoa pode
 * ter digitado em vez de tocar no link. Só vale a mensagem que é SÓ isso: um número de seis dígitos no meio de uma
 * frase não é tentativa de ligar.
 */
export function codigoNaMensagem(texto: unknown): string | null {
  const m = /^mister\s*[:\-]?\s*(\d[\d\s]{4,10}\d)\s*[.!]?$/.exec(normalizar(texto));
  if (!m) return null;
  const codigo = soDigitos(m[1]);
  return codigo.length === 6 ? codigo : null;
}

/** A mensagem começa pela palavra do código, mas o código não tem o formato: é tentativa errada, não conversa. */
export function pareceCodigo(texto: unknown): boolean {
  return /^mister\s*[:\-]?\s*\d/.test(normalizar(texto));
}

export const ehPararAvisos = (texto: unknown) => /^parar( de receber)?( os)? avisos?[.!]?$/.test(normalizar(texto));
export const ehVoltarAvisos = (texto: unknown) => /^(voltar|religar|ligar)( os)? avisos?[.!]?$/.test(normalizar(texto));
export const ehTrocarDeEmpresa = (texto: unknown) => /^(trocar|mudar)( de)? (empresa|loja)[.!]?$/.test(normalizar(texto));

export const primeiroNome = (nome: unknown) => String(nome ?? '').trim().split(/\s+/)[0] || '';

function tituloDoBotao(nome: string): string {
  const limpo = nome.replace(/\s+/g, ' ').trim();
  return limpo.length <= TITULO_DO_BOTAO_MAX ? limpo : `${limpo.slice(0, TITULO_DO_BOTAO_MAX - 1).trimEnd()}…`;
}

export const idDoBotaoDaEmpresa = (tenantId: string) => `${PREFIXO_DO_BOTAO}${tenantId}`;

export type Resposta = { texto: string; botoes?: { id: string; titulo: string }[] };

/**
 * A pergunta "de qual empresa?". Até três empresas, com botões; mais que isso, lista numerada (o WhatsApp só aceita
 * três botões de resposta). As empresas chegam em ordem estável (nome, depois id) para o número valer na resposta.
 */
export function perguntaDaEmpresa(empresas: EmpresaDoTelefone[]): Resposta {
  const quantas = empresas.length === 2 ? 'duas' : String(empresas.length);
  if (empresas.length <= BOTOES_MAX) {
    return {
      texto: `Este WhatsApp está ligado a ${quantas} empresas. De qual você quer falar?`,
      botoes: empresas.map((e) => ({ id: idDoBotaoDaEmpresa(e.tenantId), titulo: tituloDoBotao(e.nome) })),
    };
  }
  const lista = empresas.map((e, i) => `${i + 1}. ${e.nome}`).join('\n');
  return { texto: `Este WhatsApp está ligado a ${quantas} empresas. De qual você quer falar?\n\n${lista}\n\nResponda com o número.` };
}

/**
 * Qual empresa a pessoa escolheu: pelo botão, pelo número da lista ou pelo nome (inteiro, ou um começo que só uma tem).
 * Devolve null quando não dá para saber — o Mister pergunta de novo, nunca chuta.
 */
export function empresaEscolhida(resposta: { botaoId?: string | null; texto?: string | null }, empresas: EmpresaDoTelefone[]): string | null {
  const botao = String(resposta.botaoId ?? '');
  if (botao.startsWith(PREFIXO_DO_BOTAO)) {
    const id = botao.slice(PREFIXO_DO_BOTAO.length);
    return empresas.some((e) => e.tenantId === id) ? id : null;
  }
  const dito = normalizar(resposta.texto);
  if (!dito) return null;
  if (/^\d{1,2}$/.test(dito)) {
    const e = empresas[Number(dito) - 1];
    return e ? e.tenantId : null;
  }
  const iguais = empresas.filter((e) => normalizar(e.nome) === dito || normalizar(tituloDoBotao(e.nome)) === dito);
  if (iguais.length === 1) return iguais[0].tenantId;
  if (dito.length < 3) return null;
  const comecam = empresas.filter((e) => normalizar(e.nome).startsWith(dito));
  return comecam.length === 1 ? comecam[0].tenantId : null;
}

/** O telefone ainda está na janela em que o Mister pode responder com texto livre? */
export function dentroDaJanela(ultimaEntrada: Date | null, agora: Date): boolean {
  return !!ultimaEntrada && agora.getTime() - ultimaEntrada.getTime() < JANELA_DA_META_H * 3_600_000;
}

/** Passou o intervalo desde a última vez? (`null` = nunca aconteceu.) */
export function passou(ultima: Date | null, agora: Date, minutos: number): boolean {
  return !ultima || agora.getTime() - ultima.getTime() >= minutos * 60_000;
}

// ───────────────────────────── o console da distribuição ─────────────────────────────

export type SituacaoDaEmpresa = 'modulo_desligado' | 'falta_chave_e_whatsapp' | 'falta_chave' | 'ia_parada' | 'falta_whatsapp' | 'funcionando';

/** As situações da chave de IA que param a IA da empresa (as de `ia.regras.ts` que não são "ok"). */
const CHAVE_PARADA = new Set(['chave_recusada', 'sem_credito', 'teto_atingido']);

/**
 * Em que pé o Mister está numa empresa, para a lista do console. Uma situação só, a que impede primeiro: módulo, IA,
 * WhatsApp. `temIa` = chave própria OU a IA que a distribuição inclui; `chaveSituacao` = a da chave própria (null sem ela).
 */
export function situacaoDaEmpresa(e: { modulo: boolean; temIa: boolean; chaveSituacao: string | null; pessoas: number }): {
  situacao: SituacaoDaEmpresa;
  motivo: string | null;
} {
  if (!e.modulo) return { situacao: 'modulo_desligado', motivo: null };
  if (!e.temIa) return { situacao: e.pessoas > 0 ? 'falta_chave' : 'falta_chave_e_whatsapp', motivo: null };
  if (e.chaveSituacao && CHAVE_PARADA.has(e.chaveSituacao)) return { situacao: 'ia_parada', motivo: e.chaveSituacao };
  if (e.pessoas <= 0) return { situacao: 'falta_whatsapp', motivo: null };
  return { situacao: 'funcionando', motivo: null };
}

// ───────────────────────────── as mensagens ─────────────────────────────
// Texto fixo, sem IA e sem dado de ninguém onde a pessoa não está ligada. Cada frase só promete o que já existe: as
// perguntas, os relatórios e as autorizações entram nas próximas fases e o texto muda junto.

export const TEXTOS = {
  desconhecido:
    'Olá! Este é o Mister, o assistente de gestão do Regem.\n\nAinda não sei quem você é. Para falar comigo, ligue o seu WhatsApp dentro do Regem, no menu Mister, em "Pessoas".',
  ligado: (nome: string, empresa: string) =>
    `Pronto, ${nome}! Este WhatsApp está ligado a você no Regem da ${empresa}.\n\nÉ por aqui que os avisos da empresa vão chegar.\n\nPara parar os avisos, responda PARAR AVISOS.`,
  codigoNaoVale: 'Esse código não vale mais. Gere outro dentro do Regem, no menu Mister, em "Pessoas", e mande de novo. O código vale 10 minutos e uma vez só.',
  codigosDemais: 'Foram muitos códigos errados deste WhatsApp. Espere uma hora, gere um código novo dentro do Regem e mande de novo.',
  numeroDeOutraPessoa: (empresa: string) =>
    `Este WhatsApp já está ligado a outra pessoa na ${empresa}. Um número liga uma pessoa só: peça para ela desligar dentro do Regem, no menu Mister, em "Pessoas", e mande o código de novo.`,
  semAcesso: 'Não consegui ligar: o código é de alguém que não é mais gerente nem presidente, ou a empresa está com o Mister desligado.',
  parou: (nome: string) => `Certo, ${nome}: este WhatsApp não recebe mais os avisos do Mister.\n\nPara voltar, responda VOLTAR AVISOS.`,
  voltou: (nome: string) => `Pronto, ${nome}: os avisos do Mister voltaram para este WhatsApp.\n\nPara parar, responda PARAR AVISOS.`,
  seguindo: (empresa: string) => `Certo. Sigo falando da ${empresa}. Para trocar, escreva "trocar de empresa".`,
  umaEmpresaSo: (empresa: string) => `Este WhatsApp está ligado só à ${empresa}.`,
  naoEntendiAEmpresa: 'Não entendi de qual empresa.',
  aindaNaoRespondo: (nome: string, empresa: string) =>
    `Oi, ${nome}. Por aqui chegam os avisos da ${empresa}. Ainda não respondo a perguntas: isso entra numa próxima versão.\n\nPara parar os avisos, responda PARAR AVISOS.`,
} as const;
