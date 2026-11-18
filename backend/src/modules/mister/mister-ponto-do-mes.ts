import { dataNoFuso, horaNoFuso } from '../../common/data';

// M3e parte 2 — O ARQUIVO DO PONTO DO MÊS pelo Mister (versão 3 do protótipo `mockups/regem-mister.html`, conversa 20, o
// aviso "Arquivo do ponto do mês" do grupo "Pessoas e ponto" e a decisão "Quando gerar o arquivo do ponto: dia 1, às
// 06:00 … Vai ao presidente; à contabilidade com um toque, para o responsável cadastrado"). As regras puras.
//
// O fechamento do mês já existe: a rotina do dia 1 às 06:00 (`JobsService.fecharPontoMensal`) grava o `ponto_fechamento`
// com os colaboradores e as pendências. O aviso só LÊ esse fechamento, manda o espelho em PDF (o MESMO da tela) e o toque
// em "Enviar ao contador" usa o MESMO envio da tela (`PontoService.enviarEspelhoContador`).

/** A partir de que hora do dia 1 (no relógio da loja) o aviso abre: a loja vende até perto das 02h. */
export const HORA_DO_PONTO_DO_MES = 6;
/** Até que dia do mês o aviso fica aberto, se ninguém mandar (a contabilidade fecha a folha nos primeiros dias). */
export const ULTIMO_DIA_DO_PONTO_DO_MES = 5;
/** O prefixo dos botões do aviso na conversa. */
export const PREFIXO_DO_PONTO_DO_MES = 'pmes:';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "2026-10-01" → "outubro". */
export const nomeDoMes = (competencia: string) => MESES[Number(competencia.slice(5, 7)) - 1] ?? competencia.slice(0, 7);

/** "2026-10-01" → "1 a 31/10". */
export function periodoDoMes(competencia: string): string {
  const ano = Number(competencia.slice(0, 4));
  const mes = Number(competencia.slice(5, 7));
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `1 a ${ultimo}/${String(mes).padStart(2, '0')}`;
}

/** A competência do aviso de hoje: o mês anterior ao de hoje, no relógio da loja ("2026-10-01"). */
export function competenciaDoAviso(agora: Date): string {
  const hoje = dataNoFuso(agora);
  const ano = Number(hoje.slice(0, 4));
  const mes = Number(hoje.slice(5, 7));
  const a = mes === 1 ? ano - 1 : ano;
  const m = mes === 1 ? 12 : mes - 1;
  return `${a}-${String(m).padStart(2, '0')}-01`;
}

/** O aviso está na janela? Do dia 1 às 06:00 até o fim do dia 5, no relógio da loja. */
export function naJanelaDoPontoDoMes(agora: Date): boolean {
  const dia = Number(dataNoFuso(agora).slice(8, 10));
  if (dia > ULTIMO_DIA_DO_PONTO_DO_MES) return false;
  return dia > 1 || Number(horaNoFuso(agora).slice(0, 2)) >= HORA_DO_PONTO_DO_MES;
}

export interface FechamentoDoMes {
  tenantId: string;
  empresa: string;
  competencia: string;
  totalColaboradores: number;
  pendencias: Array<{ nome: string; dias: Array<{ data: string }> }>;
  /** O responsável cadastrado (o contador ativo mais novo), ou null. */
  contador: { id: string; nome: string; whatsapp: string } | null;
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** "1 pendente (Bruno Dias, 28/10)" ou "3 pendentes (Bruno Dias, 28/10; Ana Lima, 2/10; Caio Reis, 9/10 e mais 1)". */
export function linhaDasPendencias(pendencias: FechamentoDoMes['pendencias']): string {
  const com = pendencias.filter((p) => p.dias?.length);
  if (!com.length) return 'nenhuma pendência';
  const nomes = com.slice(0, 3).map((p) => `${p.nome}, ${ddmm(p.dias[0].data)}${p.dias.length > 1 ? ` e mais ${p.dias.length - 1} dia${p.dias.length > 2 ? 's' : ''}` : ''}`);
  const resto = com.length > 3 ? ` e mais ${com.length - 3} pessoa${com.length > 4 ? 's' : ''}` : '';
  return `${com.length} ${com.length === 1 ? 'pendente' : 'pendentes'} (${nomes.join('; ')}${resto})`;
}

/** O final do WhatsApp do responsável (4 dígitos), nunca o número inteiro na conversa. */
export const finalDoWhatsapp = (w: string) => String(w ?? '').replace(/\D/g, '').slice(-4);

/**
 * O título e o detalhe do aviso (a mensagem é "📁 <título>.\n\n<detalhe>"). O PDF do espelho vai ao presidente logo
 * depois da mensagem (ele tem as horas de todos: só a quem pode mandar à contabilidade), por isso o texto não o anuncia.
 */
export function textoDoPontoDoMes(f: FechamentoDoMes): { titulo: string; detalhe: string } {
  const mes = nomeDoMes(f.competencia);
  const pessoas = `${f.totalColaboradores} ${f.totalColaboradores === 1 ? 'colaborador' : 'colaboradores'}`;
  const fim = f.contador
    ? `Envio à contabilidade? ${f.contador.nome} (WhatsApp final ${finalDoWhatsapp(f.contador.whatsapp)}).`
    : 'Para mandar à contabilidade com um toque, cadastre o responsável em Pessoas › Gerenciamento de ponto.';
  return {
    titulo: `Ponto de ${mes} · ${f.empresa} (${periodoDoMes(f.competencia)})`,
    detalhe: `${pessoas} · ${linhaDasPendencias(f.pendencias)}.\n\n${fim}`,
  };
}

export type AcaoDoPontoDoMes = 'enviar' | 'ver';

/** Os botões do aviso (só o presidente): "Enviar ao contador" (com o responsável cadastrado) e "Ver antes". O protótipo diz
 * "Enviar à contabilidade", mas a Meta aceita até 20 letras no título do botão (são 22): "Enviar ao contador" (18). */
export const botoesDoPontoDoMes = (avisoId: string, comContador: boolean) => [
  ...(comContador ? [{ id: `${PREFIXO_DO_PONTO_DO_MES}enviar:${avisoId}`, titulo: 'Enviar ao contador' }] : []),
  { id: `${PREFIXO_DO_PONTO_DO_MES}ver:${avisoId}`, titulo: 'Ver antes' },
];

export function lerBotaoDoPontoDoMes(botaoId: unknown): { acao: AcaoDoPontoDoMes; avisoId: string } | null {
  const m = /^pmes:(enviar|ver):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(String(botaoId ?? ''));
  return m ? { acao: m[1] as AcaoDoPontoDoMes, avisoId: m[2].toLowerCase() } : null;
}

/** O nome do PDF do espelho: "Espelho de ponto · outubro 2026 · Mister Burger.pdf" (sem barra nem aspas). */
export function nomeDoPdfDoPonto(competencia: string, empresa: string): string {
  const limpo = String(empresa ?? '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `Espelho de ponto · ${nomeDoMes(competencia)} ${competencia.slice(0, 4)}${limpo ? ` · ${limpo}` : ''}.pdf`;
}

export const TEXTOS_DO_PONTO_DO_MES = {
  enviado: (nome: string, hora: string, competencia: string) =>
    `Enviado às ${hora} para ${nome}. Fica no fechamento de ${nomeDoMes(competencia)}, em Pessoas › Gerenciamento de ponto.`,
  jaEnviado: (hora: string, competencia: string) => `O ponto de ${nomeDoMes(competencia)} já foi enviado à contabilidade, às ${hora}.`,
  enviando: 'O envio à contabilidade já está em andamento. Espere a confirmação.',
  semContador: 'Não há responsável da contabilidade cadastrado. Cadastre em Pessoas › Gerenciamento de ponto e mande de lá.',
  soPresidente: 'Só o presidente manda o ponto à contabilidade pelo Mister.',
  naoVale: 'Este aviso do ponto não está mais aberto. O envio fica em Pessoas › Gerenciamento de ponto.',
  falhou: 'Não consegui mandar à contabilidade agora. Toque em "Enviar ao contador" de novo daqui a pouco, ou mande em Pessoas › Gerenciamento de ponto.',
  verAntes: (competencia: string) =>
    `Confira o ponto de ${nomeDoMes(competencia)} em Pessoas › Gerenciamento de ponto: os ajustes e as pendências ficam lá. Quando estiver certo, toque em "Enviar ao contador" no aviso.`,
} as const;
