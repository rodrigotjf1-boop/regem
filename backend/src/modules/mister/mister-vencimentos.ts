import { FUSO_OPERACAO } from '../../common/data';
import { situacaoDoCertificado } from './mister-agente.regras';

// O QUE VENCE OU ESTÁ DESATUALIZADO (F3, vigilância de dependências — parte 1, as da loja; a 17ª consulta do Mister).
// As regras puras de cada parte: o texto de cada situação e o que pede atenção. A consulta (`MisterFerramentasService`)
// lê os dados pelos serviços das telas e passa aqui. Nada de segredo: só datas e situação (nunca o certificado, a
// senha, o token do IBPT ou o acesso do Instagram).

/** Com quantos dias para vencer a licença do servidor da loja pede atenção (depois dela, o servidor para de gravar). */
export const DIAS_DE_AVISO_DA_LICENCA = 15;

const DIA_MS = 86_400_000;

/** AAAA-MM-DD → DD/MM/AAAA (as datas do IBPT são de calendário, sem hora). */
export function dataDeCalendario(iso: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/** Dias entre duas datas de calendário AAAA-MM-DD (b − a). */
export function diasEntreDatas(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA_MS);
}

export type ParteDoVencimento = { dados: Record<string, unknown>; atencao: string | null };

// ───────────────────────────── o certificado digital da nota ─────────────────────────────

export type CertificadoLido = { loja: string | null; validoAte: unknown; ligada: boolean | null; ambiente: unknown };

/**
 * Cada certificado digital cadastrado (o da loja e o da empresa toda), pela MESMA conta da tela (`situacaoDoCertificado`),
 * mesmo com a nota fiscal desligada — o aviso do Mister só olha onde ela está ligada; aqui a pessoa pergunta. Com a nota
 * desligada, o vencimento não pede atenção (só faz falta quando ela for ligada).
 */
export function certificadoParaOMister(c: CertificadoLido, agora = new Date()): ParteDoVencimento {
  const s = situacaoDoCertificado(c.validoAte, agora);
  const onde = c.loja ? ` da ${c.loja}` : '';
  const nota = c.ligada ? (String(c.ambiente) === '1' ? 'ligada, valendo' : 'ligada, em teste') : 'desligada';
  if (!s) return { dados: { loja: c.loja ?? 'a empresa toda', notaFiscal: nota, aviso: 'O certificado não tem a data de validade lida.' }, atencao: null };
  const dados: Record<string, unknown> = {
    loja: c.loja ?? 'a empresa toda',
    venceEm: s.venceEm,
    diasParaVencer: s.diasParaVencer,
    situacao: s.situacao,
    notaFiscal: nota,
    ondeTrocar: 'Financeiro › Configuração (só o presidente)',
  };
  if (!c.ligada && s.situacao !== 'em dia') dados.observacao = 'A nota fiscal está desligada: o certificado só faz falta quando ela for ligada.';
  const atencao =
    c.ligada && s.situacao !== 'em dia'
      ? s.situacao === 'vencido'
        ? `O certificado digital${onde} venceu em ${s.venceEm}: sem ele a nota fiscal não sai. Troque em Financeiro › Configuração.`
        : `O certificado digital${onde} vence em ${s.venceEm} (${s.diasParaVencer === 1 ? '1 dia' : `${s.diasParaVencer} dias`}). Troque em Financeiro › Configuração.`
      : null;
  return { dados, atencao };
}

// ───────────────────────────── a tabela do IBPT ─────────────────────────────

export type IbptLido = {
  uf: string | null;
  /** O que a Configuração fiscal mostra (`IbptService.situacaoDaLoja`): qual tabela vale hoje para a loja. */
  emUso: 'propria' | 'regem' | null;
  propriaAte: string | null;
  regemAte: string | null;
  /** A situação da tabela da DMS na UF, pela régua do verificador da distribuição (`statusIbpt`). */
  situacaoDaDms: 'ok' | 'vence_logo' | 'vencida' | 'sem_tabela' | null;
  diasParaVencerDaDms: number | null;
  /** A última vigência que existiu para a UF (da DMS ou a própria), para "venceu em…". */
  ultimaAte: string | null;
  notaLigada: boolean;
};

const SEM_TRIBUTOS = 'a nota fiscal sai sem o valor aproximado dos tributos (Lei 12.741)';

/**
 * A tabela do IBPT do estado da loja: a da própria loja (pelo token do IBPT, atualizada sozinha todo dia) ou a da DMS.
 * Quem atualiza a da DMS é a DMS. Sem tabela vigente, a nota sai sem o valor aproximado dos tributos — pede atenção só
 * com a nota ligada.
 */
export function ibptParaOMister(t: IbptLido): ParteDoVencimento {
  if (!t.uf) return { dados: { observacao: 'A nota fiscal não tem o estado (UF) configurado: a tabela do IBPT só vale para a nota fiscal.' }, atencao: null };
  const base: Record<string, unknown> = { estado: t.uf };
  const desligada = t.notaLigada ? {} : { observacao: 'A nota fiscal está desligada: a tabela só faz falta quando ela for ligada.' };
  if (t.emUso === 'propria') {
    return {
      dados: { ...base, emUso: 'a da própria loja (pelo token do IBPT, atualizada todo dia)', valeAte: dataDeCalendario(t.propriaAte), ...desligada },
      atencao: null,
    };
  }
  if (t.emUso === 'regem') {
    const venceLogo = t.situacaoDaDms === 'vence_logo';
    return {
      dados: {
        ...base,
        emUso: 'a da DMS (quem atualiza é a DMS)',
        valeAte: dataDeCalendario(t.regemAte),
        ...(t.diasParaVencerDaDms !== null ? { diasParaVencer: t.diasParaVencerDaDms } : {}),
        ...(venceLogo ? { observacao: 'A tabela vence logo e a próxima ainda não chegou à DMS.' } : desligada),
      },
      atencao:
        venceLogo && t.notaLigada
          ? `A tabela do IBPT de ${t.uf} vence em ${dataDeCalendario(t.regemAte)} e a próxima ainda não chegou: quem atualiza é a DMS. Sem ela, ${SEM_TRIBUTOS}.`
          : null,
    };
  }
  const ultima = dataDeCalendario(t.ultimaAte);
  return {
    dados: {
      ...base,
      emUso: null,
      situacao: ultima ? `vencida desde ${ultima}` : 'sem tabela',
      consequencia: `Sem a tabela vigente, ${SEM_TRIBUTOS}.`,
      quemResolve: 'A DMS atualiza a tabela; a loja também pode informar o token do IBPT em Financeiro › Configuração, e a tabela da própria loja passa a valer.',
      ...desligada,
    },
    atencao: t.notaLigada
      ? `A tabela do IBPT de ${t.uf} ${ultima ? `venceu em ${ultima}` : 'não foi enviada'}: ${SEM_TRIBUTOS}. Quem atualiza é a DMS (ou o token do IBPT da loja, em Financeiro › Configuração).`
      : null,
  };
}

// ───────────────────────────── o servidor da loja: a licença e a versão ─────────────────────────────

export type ServidorLido =
  | { instalado: false }
  | { instalado: true; validaAte: Date | null; versao: string | null; versaoDisponivel: string | null; soPeloInstalador: boolean; versaoRecolhida: boolean };

/**
 * A licença do servidor da loja (a mesma regra da renovação: a da ativação estendida pela da conta — ERR-466) e a versão
 * instalada × a que ESTA loja já poderia ter (a mesma resposta que o servidor recebe). Licença vencida = o servidor para
 * de gravar vendas; pede atenção a partir de 15 dias.
 */
export function servidorParaOMister(s: ServidorLido, agora = new Date()): ParteDoVencimento[] {
  if (!s.instalado) return [{ dados: { instalado: false, observacao: 'A empresa não tem servidor instalado na loja: o Regem roda só na nuvem.' }, atencao: null }];
  const partes: ParteDoVencimento[] = [];
  if (!s.validaAte) {
    partes.push({ dados: { licenca: { semPrazo: true } }, atencao: null });
  } else {
    const dias = Math.floor((s.validaAte.getTime() - agora.getTime()) / DIA_MS);
    const valeAte = s.validaAte.toLocaleDateString('pt-BR', { timeZone: FUSO_OPERACAO });
    const vencida = s.validaAte.getTime() < agora.getTime();
    const situacao = vencida ? 'vencida' : dias <= DIAS_DE_AVISO_DA_LICENCA ? 'vence em breve' : 'em dia';
    partes.push({
      dados: { licenca: { valeAte, diasParaVencer: vencida ? 0 : dias, situacao, acompanha: 'a assinatura do Regem (Configurações › Planos & assinatura)' } },
      atencao:
        situacao === 'em dia'
          ? null
          : vencida
            ? `A licença do servidor da loja venceu em ${valeAte}: o servidor para de gravar vendas. Veja Configurações › Planos & assinatura ou fale com a DMS.`
            : `A licença do servidor da loja vence em ${valeAte}: depois disso o servidor para de gravar vendas. Veja Configurações › Planos & assinatura ou fale com a DMS.`,
    });
  }
  const versao: Record<string, unknown> = { instalada: s.versao, disponivel: s.versaoDisponivel, emDia: !s.versaoDisponivel && !s.versaoRecolhida };
  if (s.soPeloInstalador) versao.observacao = 'Esta versão só se atualiza pelo instalador novo: fale com a DMS.';
  if (s.versaoRecolhida) versao.recolhida = 'A DMS recolheu a versão instalada por um problema: atualize assim que puder.';
  partes.push({
    dados: { versao },
    atencao: s.versaoRecolhida
      ? `A versão do servidor da loja (${s.versao}) foi recolhida pela DMS: atualize em Configurações › Servidor local.`
      : s.versaoDisponivel
        ? `Há versão nova do servidor da loja (${s.versaoDisponivel}; instalada ${s.versao}): a atualização se faz em Configurações › Servidor local.`
        : s.soPeloInstalador
          ? `O servidor da loja (${s.versao}) só se atualiza pelo instalador novo: fale com a DMS.`
          : null,
  });
  return partes;
}

// ───────────────────────────── o Instagram da loja ─────────────────────────────

export type InstagramLido = { usuario: string | null; venceEm: unknown; erro: string | null } | null;

/** O acesso do Instagram (renovado sozinho pela Regem a cada 20 dias; vale 60): só pede atenção com erro ou vencido. */
export function instagramParaOMister(c: InstagramLido, agora = new Date()): ParteDoVencimento | null {
  if (!c) return null;
  const conta = c.usuario ? `@${c.usuario}` : 'a conta da loja';
  const vence = c.venceEm ? new Date(String(c.venceEm instanceof Date ? c.venceEm.toISOString() : c.venceEm)) : null;
  const vencido = !!vence && !Number.isNaN(vence.getTime()) && vence.getTime() < agora.getTime();
  const reconectar = !!c.erro || vencido;
  return {
    dados: {
      conta,
      acesso: reconectar ? 'precisa reconectar' : 'em dia (a Regem renova sozinha)',
      ...(reconectar ? { ondeReconectar: 'Delivery › Configurações › Atendimento › Instagram · Direct e comentários › Reconectar' } : {}),
    },
    atencao: reconectar
      ? `O acesso ao Instagram da loja (${conta}) precisa ser refeito: Delivery › Configurações › Atendimento › Instagram · Direct e comentários › Reconectar.`
      : null,
  };
}
