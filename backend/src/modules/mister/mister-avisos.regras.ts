/* eslint-disable @typescript-eslint/no-explicit-any */

// OS AVISOS DO MISTER (mig 419) — as regras puras: os tipos, os destinos, o padrão aprovado pelo dono em 14/11/2026
// ("vamos de ok e com o tempo vamos atualizando os avisos"), a conferência do que a tela manda salvar e os textos. Nada
// aqui lê banco, rede ou relógio.
//
// Cada aviso vai para quem resolve: o que a equipe resolve aparece na tela da loja e no KDS; o que pede o gestor vai pelo
// WhatsApp do Mister; o técnico vai ao suporte da DMS. Tudo também fica na trilha do aviso.

import { FUSO_OPERACAO, horaNoFuso } from '../../common/data';
import { POLLER_ERRO_APOS_MS } from '../../common/falhas-do-poller';
import { diasParaVencer } from '../fiscal/certificado';
import { GUIA_DE_USO } from './mister-guia-de-uso';

export const DESTINOS = ['presidente', 'gerente', 'tela', 'kds', 'atendimento', 'dms'] as const;
export type Destino = (typeof DESTINOS)[number];

/** Como cada destino se chama na tela (a mesma ordem da gaveta do protótipo). */
export const NOME_DO_DESTINO: Record<Destino, string> = {
  presidente: 'WhatsApp do presidente',
  gerente: 'WhatsApp do gerente da loja',
  tela: 'Tela do Regem na loja',
  kds: 'KDS da cozinha',
  atendimento: 'Caso no Atendimento',
  dms: 'Suporte da DMS',
};

/** Para onde o "se ninguém resolver" pode ir (só o WhatsApp de uma pessoa). */
export const DESTINOS_DA_ESCALA = ['gerente', 'presidente'] as const;
export const TEMPOS_DA_ESCALA = [5, 15, 30, 120] as const;
export const TEMPOS_DO_PEDIDO_PARADO = [15, 20, 30] as const;

export type TipoDeAviso =
  | 'impressora'
  | 'pedido_parado'
  | 'caixa_24h'
  | 'canal_desconectado'
  | 'servidor_sem_sinal'
  | 'servidor_tecnico'
  | 'nota_sem_resposta'
  | 'certificado'
  | 'chave_ia';

export interface RegraDoAviso {
  ligado: boolean;
  destinos: Destino[];
  escalaMin: number | null;
  escalaPara: Destino[];
  /** Só no pedido parado: o tempo, em minutos. */
  parametro: number | null;
}

export interface TipoDoAviso {
  tipo: TipoDeAviso;
  grupo: 'Na loja' | 'Servidor da loja' | 'Fiscal' | 'O próprio Mister';
  titulo: string;
  descricao: string;
  /** O padrão aprovado em 14/11/2026. */
  padrao: RegraDoAviso;
  /** Esta entrega já sabe ver a situação? (Os outros tipos aparecem na tela como "chega na próxima entrega".) */
  jaFunciona: boolean;
}

const regra = (destinos: Destino[], o: Partial<RegraDoAviso> = {}): RegraDoAviso => ({
  ligado: true,
  destinos,
  escalaMin: null,
  escalaPara: [],
  parametro: null,
  ...o,
});

/** Os nove avisos do protótipo aprovado, na ordem da tela. */
export const TIPOS_DE_AVISO: TipoDoAviso[] = [
  {
    tipo: 'impressora',
    grupo: 'Na loja',
    titulo: 'Impressora parada',
    descricao: 'Uma impressora deixou de responder com via na fila.',
    padrao: regra(['tela'], { escalaMin: 5, escalaPara: ['gerente'] }),
    jaFunciona: true,
  },
  {
    tipo: 'pedido_parado',
    grupo: 'Na loja',
    titulo: 'Pedido parado',
    descricao: 'Um pedido sem andar além do tempo escolhido. O aviso cita o pedido como ele aparece no quadro do Delivery.',
    padrao: regra(['kds', 'tela', 'gerente'], { ligado: false, parametro: 20 }),
    jaFunciona: false,
  },
  {
    tipo: 'caixa_24h',
    grupo: 'Na loja',
    titulo: 'Caixa aberto há mais de 24 horas',
    descricao: 'O Regem já pede o fechamento na tela do caixa; aqui o gerente fica sabendo.',
    padrao: regra(['gerente']),
    jaFunciona: true,
  },
  {
    tipo: 'canal_desconectado',
    grupo: 'Na loja',
    titulo: 'iFood ou 99 desconectado',
    descricao: 'A loja parou de receber pedidos de um canal.',
    padrao: regra(['gerente', 'tela']),
    jaFunciona: true,
  },
  {
    tipo: 'servidor_sem_sinal',
    grupo: 'Servidor da loja',
    titulo: 'Servidor da loja sem sinal',
    descricao: 'Só quando há pedido esperando: fora do horário, o computador desligado não incomoda ninguém.',
    padrao: regra(['gerente', 'dms']),
    jaFunciona: true,
  },
  {
    tipo: 'servidor_tecnico',
    grupo: 'Servidor da loja',
    titulo: 'Serviço parado, disco cheio ou cópia de segurança atrasada',
    descricao: 'Problemas técnicos do servidor: o suporte da DMS resolve. O gestor só fica sabendo se passar do tempo escolhido.',
    padrao: regra(['dms'], { escalaMin: 120, escalaPara: ['gerente'] }),
    jaFunciona: true,
  },
  {
    tipo: 'nota_sem_resposta',
    grupo: 'Fiscal',
    titulo: 'Nota fiscal sem resposta',
    descricao: 'Nota que ficou pendente depois de todas as tentativas.',
    padrao: regra(['atendimento', 'presidente']),
    jaFunciona: true,
  },
  {
    tipo: 'certificado',
    grupo: 'Fiscal',
    titulo: 'Certificado digital perto de vencer',
    descricao: 'A 60, 30, 15, 7 e 1 dia do vencimento, e quando vence. Só nas lojas com a emissão da nota ligada.',
    padrao: regra(['presidente']),
    jaFunciona: true,
  },
  {
    tipo: 'chave_ia',
    grupo: 'O próprio Mister',
    titulo: 'A chave de IA parou',
    descricao: 'Sem crédito, no teto de gasto ou recusada: as perguntas e os relatórios param até a chave voltar.',
    padrao: regra(['presidente']),
    jaFunciona: true,
  },
];

export const ehTipoDeAviso = (t: unknown): t is TipoDeAviso => TIPOS_DE_AVISO.some((x) => x.tipo === t);
export const tipoDoAviso = (t: TipoDeAviso): TipoDoAviso => TIPOS_DE_AVISO.find((x) => x.tipo === t)!;

/** A regra que vale: a salva pela empresa, ou o padrão. Destino desconhecido (de uma versão futura) fica de fora. */
export function regraQueVale(tipo: TipoDeAviso, salva: Partial<RegraDoAviso> | null | undefined): RegraDoAviso {
  const p = tipoDoAviso(tipo).padrao;
  if (!salva) return { ...p, destinos: [...p.destinos], escalaPara: [...p.escalaPara] };
  const so = (l: unknown, aceitos: readonly string[]) => (Array.isArray(l) ? l.filter((d) => aceitos.includes(String(d))) : []) as Destino[];
  return {
    ligado: typeof salva.ligado === 'boolean' ? salva.ligado : p.ligado,
    destinos: so(salva.destinos, DESTINOS),
    escalaMin: salva.escalaMin ?? null,
    escalaPara: so(salva.escalaPara, DESTINOS_DA_ESCALA),
    parametro: tipo === 'pedido_parado' ? (salva.parametro ?? p.parametro) : null,
  };
}

/**
 * Confere o que a tela manda salvar — toda recusa ANTES da gravação (V86). Devolve a lista pronta para gravar ou a frase do
 * que está errado. `ligado` precisa ser booleano de verdade (V15); ausente mantém o que estava não se aplica aqui: a tela
 * manda a regra inteira de cada tipo que mudou.
 */
export function conferirRegras(dto: unknown): { tipo: TipoDeAviso; regra: RegraDoAviso }[] | { erro: string } {
  const lista = (dto as any)?.regras;
  if (!Array.isArray(lista) || !lista.length) return { erro: 'Nada para salvar.' };
  if (lista.length > TIPOS_DE_AVISO.length) return { erro: 'Avisos demais num pedido.' };
  const vistos = new Set<string>();
  const saida: { tipo: TipoDeAviso; regra: RegraDoAviso }[] = [];
  for (const r of lista) {
    const tipo = r?.tipo;
    if (!ehTipoDeAviso(tipo)) return { erro: 'Aviso desconhecido.' };
    if (vistos.has(tipo)) return { erro: 'O mesmo aviso veio duas vezes.' };
    vistos.add(tipo);
    if (typeof r.ligado !== 'boolean') return { erro: `Diga se o aviso "${tipoDoAviso(tipo).titulo}" fica ligado ou desligado.` };
    const destinos: string[] | null = Array.isArray(r.destinos) ? [...new Set<string>(r.destinos.map(String))] : null;
    if (!destinos || destinos.some((d) => !(DESTINOS as readonly string[]).includes(d))) return { erro: 'Destino desconhecido.' };
    if (r.ligado && !destinos.length) return { erro: `Escolha pelo menos um destino para "${tipoDoAviso(tipo).titulo}", ou desligue o aviso.` };
    const escalaMin = r.escalaMin === null || r.escalaMin === undefined || r.escalaMin === '' ? null : Number(r.escalaMin);
    if (escalaMin !== null && !(TEMPOS_DA_ESCALA as readonly number[]).includes(escalaMin)) return { erro: 'Tempo de "se ninguém resolver" inválido.' };
    const escalaPara: string[] = Array.isArray(r.escalaPara) ? [...new Set<string>(r.escalaPara.map(String))] : [];
    if (escalaPara.some((d) => !(DESTINOS_DA_ESCALA as readonly string[]).includes(d))) return { erro: 'No "se ninguém resolver" só cabe o WhatsApp do gerente ou do presidente.' };
    if (escalaMin !== null && !escalaPara.length) return { erro: 'Escolha quem fica sabendo se ninguém resolver.' };
    let parametro: number | null = null;
    if (tipo === 'pedido_parado') {
      parametro = Number(r.parametro);
      if (!(TEMPOS_DO_PEDIDO_PARADO as readonly number[]).includes(parametro)) return { erro: 'O tempo do pedido parado é 15, 20 ou 30 minutos.' };
    }
    saida.push({ tipo, regra: { ligado: r.ligado, destinos: destinos as Destino[], escalaMin, escalaPara: escalaMin === null ? [] : (escalaPara as Destino[]), parametro } });
  }
  return saida;
}

// ───────────────────────────── de onde vem a situação ─────────────────────────────

/** As regras do vigia (mig 414) que viram aviso, e de que tipo. As que não estão aqui não avisam ninguém. */
export const TIPO_DA_REGRA_DO_VIGIA: Record<string, TipoDeAviso> = {
  impressora_parada: 'impressora',
  servidor_sem_sinal: 'servidor_sem_sinal',
  servico_parado: 'servidor_tecnico',
  disco_baixo: 'servidor_tecnico',
  backup_atrasado: 'servidor_tecnico',
  banco_em_risco: 'servidor_tecnico',
  relogio_desviado: 'servidor_tecnico',
  sync_falhando: 'servidor_tecnico',
};

const PROBLEMA_TECNICO: Record<string, string> = {
  servico_parado: 'um serviço do servidor parou',
  disco_baixo: 'o disco do servidor está quase cheio',
  backup_atrasado: 'a cópia de segurança está atrasada',
  banco_em_risco: 'o banco de dados do servidor pede manutenção',
  relogio_desviado: 'o relógio do servidor está errado',
  sync_falhando: 'a sincronização com a nuvem está falhando',
};

/** Uma situação vista agora: vira episódio aberto (ou continua o que já estava). */
export interface Situacao {
  tenantId: string;
  unidadeId: string | null;
  tipo: TipoDeAviso;
  chave: string;
  titulo: string;
  detalhe: string;
  dados?: Record<string, unknown>;
}

/** O texto de um incidente do vigia, com o nome da loja. */
export function situacaoDoVigia(i: { tenantId: string; unidadeId: string | null; regra: string; chave: string; evidencia?: any }, loja: string): Situacao | null {
  const tipo = TIPO_DA_REGRA_DO_VIGIA[i.regra];
  if (!tipo) return null;
  const base = { tenantId: i.tenantId, unidadeId: i.unidadeId ?? null, tipo, chave: `vigia:${i.regra}:${i.chave}` };
  if (tipo === 'impressora') {
    const nome = String(i.evidencia?.impressora ?? i.evidencia?.nome ?? '').trim();
    return { ...base, titulo: `${loja} · impressora${nome ? ` ${nome}` : ''} parada`, detalhe: 'Confira se ela está ligada, com papel e no cabo ou na rede.' };
  }
  if (tipo === 'servidor_sem_sinal')
    return { ...base, titulo: `${loja} · servidor sem sinal`, detalhe: 'Confira se o computador do servidor está ligado e com internet.', dados: { pedidosEsperando: i.evidencia?.pedidosEsperando ?? null } };
  return { ...base, titulo: `${loja} · ${PROBLEMA_TECNICO[i.regra] ?? 'problema no servidor'}`, detalhe: 'O suporte da DMS já foi avisado e cuida disso.' };
}

/** O caixa aberto há mais de 24 horas. */
export function situacaoDoCaixa(c: { tenantId: string; unidadeId: string | null; id: string; horas: number; abertoPor: string | null; origem: string }, loja: string): Situacao {
  const dias = Math.floor(c.horas / 24);
  const ha = dias >= 2 ? `há ${dias} dias` : `há ${c.horas} horas`;
  return {
    tenantId: c.tenantId,
    unidadeId: c.unidadeId,
    tipo: 'caixa_24h',
    chave: `caixa:${c.id}`,
    titulo: `${loja} · caixa ${c.origem === 'delivery' ? 'do delivery' : 'do balcão'} aberto ${ha}${c.abertoPor ? ` (aberto por ${c.abertoPor})` : ''}`,
    detalhe: 'Feche o caixa no Regem para conferir o dinheiro e começar um turno novo.',
    dados: { horas: c.horas },
  };
}

const MOTIVO_DA_CHAVE: Record<string, string> = {
  sem_credito: 'a chave de IA está sem crédito',
  teto_atingido: 'a conta de IA chegou ao limite de gasto',
  chave_recusada: 'a chave de IA foi recusada',
};
/** A chave de IA da empresa parou. */
export function situacaoDaChave(t: { tenantId: string; situacao: string }): Situacao | null {
  const motivo = MOTIVO_DA_CHAVE[t.situacao];
  if (!motivo) return null;
  return {
    tenantId: t.tenantId,
    unidadeId: null,
    tipo: 'chave_ia',
    chave: 'chave_ia',
    titulo: `A IA do Mister parou: ${motivo}`,
    detalhe: 'As perguntas e os relatórios esperam a chave voltar. Veja no Regem, no menu Mister, em "IA e uso".',
    dados: { situacao: t.situacao },
  };
}

/** Onde a pessoa resolve, pelo guia de uso (o caminho e o botão do guia são conferidos contra o menu e as telas — V65). */
function noGuia(id: string, botao?: string): string {
  const s = GUIA_DE_USO.find((x) => x.id === id);
  if (!s) return 'no Regem';
  const b = botao && s.botoes.includes(botao) ? `, em "${botao}"` : '';
  return `em ${s.caminho.join(' › ')}${b}`;
}

/** Os marcos do certificado: um lembrete a 60, 30, 15, 7 e 1 dia, e outro quando vence. */
export const MARCOS_DO_CERTIFICADO = [60, 30, 15, 7, 1] as const;

/** O marco de agora, pela MESMA conta da tela (`diasParaVencer`: abaixo de zero, vencido). Fora dos 60 dias, nenhum. */
export function marcoDoCertificado(dias: number): string | null {
  if (!Number.isFinite(dias)) return null;
  if (dias < 0) return 'vencido';
  const m = [...MARCOS_DO_CERTIFICADO].reverse().find((x) => dias <= x);
  return m === undefined ? null : String(m);
}

const diaMesNoFuso = (d: Date): string => d.toLocaleDateString('pt-BR', { timeZone: FUSO_OPERACAO, day: '2-digit', month: '2-digit' });

/**
 * O certificado digital da nota perto de vencer (ou vencido), numa loja com a emissão ligada. A chave é a do certificado —
 * a troca de marco não abre outro episódio: vira um lembrete (`dados.marco`). O título leva a DATA, não os dias, para não
 * mudar todo dia (o desfecho repete o título).
 */
export function situacaoDoCertificadoDaLoja(
  c: { tenantId: string; unidadeId: string | null; credencialId: string; validoAte: Date },
  loja: string,
  agora: Date,
): Situacao | null {
  const dias = diasParaVencer(c.validoAte, agora);
  const marco = marcoDoCertificado(dias);
  if (!marco) return null;
  const data = diaMesNoFuso(c.validoAte);
  const falta = dias === 0 ? 'Vence hoje.' : dias === 1 ? 'Vence amanhã.' : `Faltam ${dias} dias.`;
  return {
    tenantId: c.tenantId,
    unidadeId: c.unidadeId,
    tipo: 'certificado',
    chave: `certificado:${c.credencialId}`,
    titulo: marco === 'vencido' ? `${loja} · certificado digital da nota venceu em ${data}` : `${loja} · certificado digital da nota vence em ${data}`,
    detalhe:
      (marco === 'vencido' ? 'Nenhuma nota fiscal sai, nem em contingência, até o certificado novo. ' : `${falta} Sem certificado válido, nenhuma nota fiscal sai, nem em contingência. `) +
      `Renove com a certificadora e envie o novo ${noGuia('configurar-nota', 'Certificado A1 (.pfx)')}.`,
    dados: { marco, dias, venceEm: data },
  };
}

/** A nota fiscal que gastou todas as reconsultas e segue sem resposta da SEFAZ. */
export function situacaoDaNotaSemResposta(
  n: { tenantId: string; unidadeId: string | null; id: string; numero: number; serie: number; tentativas: number; emitidaEm: Date | null },
  loja: string,
): Situacao {
  const quando = n.emitidaEm ? `Emitida em ${diaMesNoFuso(n.emitidaEm)} às ${horaNoFuso(n.emitidaEm)}; o` : 'O';
  return {
    tenantId: n.tenantId,
    unidadeId: n.unidadeId,
    tipo: 'nota_sem_resposta',
    chave: `nota:${n.id}`,
    titulo: `${loja} · nota fiscal nº ${n.numero} (série ${n.serie}) sem resposta da SEFAZ`,
    detalhe: `${quando} Regem consultou ${n.tentativas} vezes e parou. Consulte de novo ${noGuia('nota-fiscal', 'Consultar na SEFAZ')}; se continuar sem resposta, fale com o suporte.`,
    dados: { numero: n.numero, serie: n.serie, tentativas: n.tentativas },
  };
}

/** O nome de um botão do guia, entre aspas — só se o guia o confere naquela seção (senão, nada). */
function botaoDoGuia(id: string, botao: string): string {
  return GUIA_DE_USO.find((x) => x.id === id)?.botoes.includes(botao) ? `"${botao}"` : '';
}

const duracaoCurta = (minutos: number): string =>
  minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, '0')} min`;

const MOTIVO_DO_IFOOD = (m: string | null): string => {
  if (m === 'sem_resposta') return 'o iFood não responde';
  if (m === 'sem_token') return 'o iFood não liberou o acesso do Regem';
  if (m === 'http_401' || m === 'http_403') return 'o iFood recusou o acesso do Regem';
  return 'o iFood respondeu com erro';
};

/**
 * O iFood sem responder ao Regem (a busca de pedidos falhando) há pelo menos `POLLER_ERRO_APOS_MS` — o mesmo tempo em que a
 * telemetria passa a tratar como erro. Antes disso é falha passageira: a próxima volta (30 s) tenta de novo. O título leva
 * desde quando (não muda enquanto dura); quanto tempo vai no detalhe.
 */
export function situacaoDoIfoodSemResposta(
  i: { tenantId: string; unidadeId: string | null; integracaoId: string; desde: Date; motivo: string | null },
  loja: string,
  agora: Date,
): Situacao | null {
  const ms = agora.getTime() - i.desde.getTime();
  if (!Number.isFinite(ms) || ms < POLLER_ERRO_APOS_MS) return null;
  const minutos = Math.floor(ms / 60_000);
  return {
    tenantId: i.tenantId,
    unidadeId: i.unidadeId,
    tipo: 'canal_desconectado',
    chave: `canal:ifood:${i.integracaoId}`,
    titulo: `${loja} · pedidos do iFood sem chegar ao Regem desde ${diaMesNoFuso(i.desde)} às ${horaNoFuso(i.desde)}`,
    detalhe:
      `Há ${duracaoCurta(minutos)} ${MOTIVO_DO_IFOOD(i.motivo)}. Enquanto isso, aceite os pedidos pelo Gestor de Pedidos do iFood. ` +
      `Se continuar, confira a ligação ${noGuia('ligar-ifood-99', 'Integrações')} ou fale com o suporte.`,
    dados: { canal: 'ifood', minutos, motivo: i.motivo },
  };
}

/** A 99 recusou o login do Regem (o último pedido de acesso voltou com código de recusa; -1 é rede, não recusa). */
export function situacaoDa99SemLogin(
  i: { tenantId: string; unidadeId: string | null; integracaoId: string; errno: number },
  loja: string,
): Situacao | null {
  if (!(Number.isFinite(i.errno) && i.errno > 0)) return null;
  const botao = botaoDoGuia('ligar-ifood-99', 'Conectar com 99Food');
  return {
    tenantId: i.tenantId,
    unidadeId: i.unidadeId,
    tipo: 'canal_desconectado',
    chave: `canal:99:${i.integracaoId}`,
    titulo: `${loja} · a 99 recusou o login do Regem`,
    detalhe:
      `Sem o login, o Regem não confirma os pedidos da 99 nem avisa a saída para entrega (código ${i.errno}). ` +
      `Conecte de novo ${noGuia('ligar-ifood-99', 'Integrações')}${botao ? `, no botão ${botao}` : ''}.`,
    dados: { canal: '99', errno: i.errno },
  };
}

// ───────────────────────────── as mensagens ─────────────────────────────

/** A mensagem do aviso que abriu (WhatsApp e tela). */
export const textoDoAviso = (s: { titulo: string; detalhe?: string | null }): string => `⚠️ ${s.titulo}.${s.detalhe ? `\n\n${s.detalhe}` : ''}`;

/** A mensagem do lembrete (o aviso continua aberto e chegou a outro marco, como o certificado a 7 dias). */
export const textoDoLembrete = (s: { titulo: string; detalhe?: string | null }): string => `🔔 Lembrete: ${s.titulo}.${s.detalhe ? `\n\n${s.detalhe}` : ''}`;

/** O aviso aberto chegou a outro marco? (A volta grava o marco anterior em `dados.marcoAnterior`.) */
export function mudouDeMarco(dados: unknown): boolean {
  const d = (dados ?? {}) as Record<string, unknown>;
  if (d.marco === undefined || d.marco === null) return false;
  return String(d.marco) !== String(d.marcoAnterior ?? '');
}

/** A mensagem do desfecho, para quem recebeu o aviso pelo WhatsApp. */
export function textoDoDesfecho(s: { titulo: string }, minutos: number): string {
  const durou = minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, '0')} min`;
  return `✅ Resolvido: ${s.titulo}. Durou ${durou}.`;
}

/** O "se ninguém resolver" já deve sair? */
export function deveEscalar(a: { abertoEm: Date; escaladoEm: Date | null }, r: RegraDoAviso, agoraMs: number): boolean {
  if (a.escaladoEm || r.escalaMin === null || !r.escalaPara.length) return false;
  return agoraMs - a.abertoEm.getTime() >= r.escalaMin * 60_000;
}

/** A janela de 24 horas da Meta: dentro dela o Mister responde com texto livre; fora, só com modelo aprovado. */
export const JANELA_DO_WHATSAPP_H = 24;
export const dentroDaJanelaDoWhatsapp = (ultimaEntrada: Date | null, agoraMs: number): boolean =>
  !!ultimaEntrada && agoraMs - ultimaEntrada.getTime() < JANELA_DO_WHATSAPP_H * 3_600_000;
