// O AJUSTE DE PONTO PELA CONVERSA (versão 9, etapa 5 do pedido do dono de 24/11: "ajuste de ponto, proposta com motivo e PIN").
// Incluir a marcação esquecida e desconsiderar a marcação errada pelo MESMO serviço de Gerenciamento de ponto
// (`PontoService.incluirMarcacao` e `criarAjuste`), com o motivo e o PIN. Portaria 671/2021: nada se apaga nem se altera — a
// inclusão entra como uma marcação NOVA de origem "ajuste" (com o seu NSR) e a desconsideração é um ajuste AO LADO da marcação
// original, que continua no registro (AFD). Abono e atestado ficam na tela. Aqui só a conferência e os textos; sem banco.
import { hojeISO, horaAgora, somarDias } from '../../common/data';

export type TipoDeMarcacao = 'entrada' | 'saida' | 'intervalo_inicio' | 'intervalo_fim';
export type ParametrosDoPonto =
  | { acao: 'incluir_marcacao'; pessoa: string; tipo: TipoDeMarcacao; dia: string; hora: string; motivo: string }
  | { acao: 'desconsiderar_marcacao'; pessoa: string; tipo: TipoDeMarcacao | null; dia: string; hora: string; motivo: string };

export const NOME_DA_MARCACAO: Record<TipoDeMarcacao, string> = {
  entrada: 'entrada',
  saida: 'saída',
  intervalo_inicio: 'saída para o intervalo',
  intervalo_fim: 'volta do intervalo',
};
/** Até quantos dias para trás o ajuste sai pela conversa (o resto, e o mês já fechado com o contador, fica na tela). */
export const DIAS_PARA_TRAS = 31;
export const MOTIVO_MINIMO_DO_PONTO = 5;

const texto = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const diaCurto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** "entrada", "chegada" → entrada; "saída para o almoço" → intervalo_inicio; "volta do intervalo" → intervalo_fim; "saída" → saida. */
export function lerTipoDeMarcacao(v: unknown): TipoDeMarcacao | null {
  const t = semAcento(texto(v)).replace(/_/g, ' ');
  if (!t) return null;
  const pausa = /interval|almoc|janta|pausa/.test(t);
  if (pausa && /volt|retorn|fim|fim do/.test(t)) return 'intervalo_fim';
  if (pausa) return 'intervalo_inicio';
  if (/entrad|cheg/.test(t)) return 'entrada';
  if (/said|sai\b|^sai/.test(t)) return 'saida';
  return null;
}

/** "9:05", "09h05", "21:30" → "HH:MM"; o resto, null. */
export function lerHora(v: unknown): string | null {
  const m = /^(\d{1,2})\s*[:h]\s*(\d{2})$/.exec(texto(v).toLowerCase());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function conferirPonto(
  acao: ParametrosDoPonto['acao'],
  en: Record<string, unknown>,
  agora: { hoje: string; hora: string } = { hoje: hojeISO(), hora: horaAgora() },
): { parametros: ParametrosDoPonto; resumo: string } | { erro: string } {
  const pessoa = texto(en.pessoaDoPonto).slice(0, 80);
  if (pessoa.length < 2) return { erro: 'Diga de quem é o ponto (o nome da pessoa).' };
  const tipo = en.tipoDaMarcacao === undefined || en.tipoDaMarcacao === null || en.tipoDaMarcacao === '' ? null : lerTipoDeMarcacao(en.tipoDaMarcacao);
  if (en.tipoDaMarcacao && !tipo) return { erro: 'Diga qual marcação: entrada, saída, saída para o intervalo ou volta do intervalo.' };
  if (acao === 'incluir_marcacao' && !tipo) return { erro: 'Diga qual marcação incluir: entrada, saída, saída para o intervalo ou volta do intervalo.' };
  const dia = en.diaDaMarcacao === undefined || en.diaDaMarcacao === null || en.diaDaMarcacao === '' ? agora.hoje : texto(en.diaDaMarcacao);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return { erro: 'O dia vai no formato AAAA-MM-DD.' };
  if (dia > agora.hoje) return { erro: 'O ponto não se ajusta para um dia que ainda não chegou.' };
  if (dia < somarDias(agora.hoje, -DIAS_PARA_TRAS)) return { erro: `Ajuste de mais de ${DIAS_PARA_TRAS} dias atrás fica na tela (Pessoas › Gerenciamento de ponto).` };
  const hora = lerHora(en.horaDaMarcacao);
  if (!hora) return { erro: 'Diga a hora da marcação (ex.: 18:05).' };
  if (dia === agora.hoje && hora > agora.hora) return { erro: 'A hora ainda não chegou: o ponto não se ajusta para depois de agora.' };
  const motivo = texto(en.motivoDoPonto).slice(0, 200);
  if (motivo.length < MOTIVO_MINIMO_DO_PONTO) return { erro: 'Diga o motivo do ajuste (ele vai para o registro do ponto e para a auditoria).' };
  const nome = tipo ? NOME_DA_MARCACAO[tipo] : 'marcação';
  if (acao === 'incluir_marcacao')
    return { parametros: { acao, pessoa, tipo: tipo as TipoDeMarcacao, dia, hora, motivo }, resumo: `Incluir a ${nome} de ${pessoa} em ${diaCurto(dia)} às ${hora} (motivo: ${motivo}).` };
  return { parametros: { acao, pessoa, tipo, dia, hora, motivo }, resumo: `Desconsiderar a ${nome} de ${pessoa} de ${diaCurto(dia)} às ${hora} (motivo: ${motivo}).` };
}

/** As marcações do dia como a pessoa lê: "entrada 18:02, saída 23:40 (desconsiderada)". */
export function marcacoesDoDia(ms: Array<{ tipo: string; hora: string; origem?: string | null; desconsiderada?: boolean }>): string {
  if (!ms.length) return 'nenhuma marcação';
  return ms
    .map((m) => `${NOME_DA_MARCACAO[m.tipo as TipoDeMarcacao] ?? m.tipo} ${m.hora}${m.origem === 'ajuste' ? ' (ajuste)' : ''}${m.desconsiderada ? ' (desconsiderada)' : ''}`)
    .join(', ');
}

export function resumoDoPonto(x: ParametrosDoPonto, nome: string, doDia: string): string {
  if (x.acao === 'incluir_marcacao')
    return (
      `Incluir a ${NOME_DA_MARCACAO[x.tipo]} de ${nome} em ${diaCurto(x.dia)} às ${x.hora} (motivo: ${x.motivo}). ` +
      `No dia já tem: ${doDia}. Entra como marcação de ajuste, com o seu NSR; as que já existem ficam como estão.`
    );
  return (
    `Desconsiderar a ${x.tipo ? NOME_DA_MARCACAO[x.tipo] : 'marcação'} de ${nome} de ${diaCurto(x.dia)} às ${x.hora} (motivo: ${x.motivo}). ` +
    `No dia: ${doDia}. A marcação continua no registro do ponto (AFD); só deixa de contar no espelho.`
  );
}

/** A página do PIN. */
export function apresentacaoDoPonto(p: Record<string, any>): { titulo: string; itens: string[]; detalhe: string | null; valor: number | null; botao: string } {
  const incluir = p.acao === 'incluir_marcacao';
  const nome = p.tipo ? NOME_DA_MARCACAO[p.tipo as TipoDeMarcacao] ?? p.tipo : 'marcação';
  return {
    titulo: incluir ? 'Incluir a marcação de ponto' : 'Desconsiderar a marcação de ponto',
    itens: [`Pessoa: ${p.nomeDaPessoa}`, `Marcação: ${nome}`, `Dia e hora: ${diaCurto(String(p.dia))} às ${p.hora}`, `Motivo: ${p.motivo}`, `No dia: ${p.doDia}`],
    detalhe: incluir
      ? 'Portaria 671: entra como marcação nova de ajuste, com NSR; nenhuma marcação é apagada.'
      : 'Portaria 671: a marcação original continua no registro; só deixa de contar no espelho.',
    valor: null,
    botao: incluir ? 'Incluir' : 'Desconsiderar',
  };
}
