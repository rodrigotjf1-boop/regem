// O ACERTO DOS ENTREGADORES PELA CONVERSA (versão 9, etapa 2 do pedido do dono de 24/11: "entregadores: ver o acerto e pagar").
// Ver é a consulta `acerto_dos_entregadores`; pagar é o MESMO serviço da tela (Delivery › Entregadores › Pagamento:
// `EntregadorService.pagarEntregador`) — o fechamento do período, a sangria no caixa de entregas e as entregas marcadas como
// acertadas —, com o PIN (é dinheiro). Aqui só a conferência, a escolha do entregador e os textos; sem banco.

export type ParametrosDoEntregador = { acao: 'pagar_entregador'; entregador: string };

/** Uma linha de `EntregadorService.fechamentoEntregadores` (os valores em centavos). */
export type LinhaDoAcerto = {
  colaboradorId: string;
  nome: string;
  modelo: string;
  periodicidade?: string;
  periodo: { inicio: string; fim: string };
  entregas: number;
  diaria: number;
  taxas: number;
  total: number;
  turnoAberto: boolean;
  pagoNoTurno: boolean;
  pagoCentavos: number;
};

const texto = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const reais = (centavos: number) => `R$ ${(centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dia = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso);

/** Os modelos de pagamento como a tela os escreve. */
export const MODELO_DO_ENTREGADOR: Record<string, string> = {
  diaria_taxas: 'diária + taxas',
  so_diaria: 'só diária',
  so_taxas: 'só taxas',
  so_taxa_fixa: 'só taxa fixa',
  diaria_taxas_fixas: 'diária + taxa fixa por entrega',
};

export const periodoDoAcerto = (l: Pick<LinhaDoAcerto, 'periodo'>) =>
  l.periodo.inicio === l.periodo.fim ? `de ${dia(l.periodo.fim)}` : `de ${dia(l.periodo.inicio)} a ${dia(l.periodo.fim)}`;

export function conferirEntregador(en: Record<string, unknown>): { parametros: ParametrosDoEntregador; resumo: string } | { erro: string } {
  const entregador = texto(en.entregadorDoAcerto).slice(0, 80);
  if (entregador.length < 2) return { erro: 'Diga o nome do entregador que vai receber.' };
  return { parametros: { acao: 'pagar_entregador', entregador }, resumo: `Pagar o acerto de ${entregador}.` };
}

/** O entregador pelo nome dito: o nome igual primeiro; senão, o que contém o dito. Dois ou nenhum: a pergunta com os nomes. */
export function acharEntregador(linhas: LinhaDoAcerto[], dito: string): { linha: LinhaDoAcerto } | { erro: string } {
  const d = semAcento(texto(dito));
  const iguais = linhas.filter((l) => semAcento(l.nome) === d);
  const achados = iguais.length ? iguais : linhas.filter((l) => semAcento(l.nome).includes(d));
  const nomes = (ls: LinhaDoAcerto[]) => ls.slice(0, 12).map((l) => l.nome).join(', ');
  if (!linhas.length) return { erro: 'Não há entregador cadastrado nesta empresa (Delivery › Entregadores).' };
  if (!achados.length) return { erro: `Não achei o entregador "${texto(dito)}". Os cadastrados: ${nomes(linhas)}.` };
  if (achados.length > 1) return { erro: `Há mais de um entregador com "${texto(dito)}": ${nomes(achados)}. Diga o nome inteiro.` };
  return { linha: achados[0] };
}

/** Por que o pagamento não sai agora (as mesmas travas da tela), ou `null`. */
export function recusaDoAcerto(l: LinhaDoAcerto): string | null {
  if (!l.turnoAberto) return 'O caixa de entregas está fechado: abra o turno para pagar (o pagamento sai como sangria dele).';
  if (l.pagoNoTurno) return `${l.nome} já foi pago neste turno do caixa de entregas (${reais(l.pagoCentavos)}). Um novo pagamento só no próximo turno.`;
  if (!(l.total > 0)) return `Nada a pagar para ${l.nome} ${periodoDoAcerto(l)}: não há entrega concluída sem acerto.`;
  return null;
}

export function resumoDoPagamento(l: LinhaDoAcerto): string {
  const partes = [l.diaria > 0 ? `diária ${reais(l.diaria)}` : '', l.taxas > 0 ? `taxas ${reais(l.taxas)}` : ''].filter(Boolean).join(' + ');
  return (
    `Pagar ${reais(l.total)} a ${l.nome} (${MODELO_DO_ENTREGADOR[l.modelo] ?? l.modelo}: ${l.entregas === 1 ? '1 entrega' : `${l.entregas} entregas`} ${periodoDoAcerto(l)}` +
    `${partes ? `; ${partes}` : ''}). Sai como sangria do caixa de entregas, e essas entregas ficam acertadas.`
  );
}

/** A página do PIN: o entregador, o período e o valor em destaque. */
export function apresentacaoDoEntregador(p: Record<string, any>): { titulo: string; itens: string[]; detalhe: string | null; valor: number | null; botao: string } {
  return {
    titulo: 'Pagar o entregador',
    itens: [
      `Entregador: ${p.nomeDoEntregador}`,
      `${Number(p.entregas) === 1 ? '1 entrega' : `${p.entregas} entregas`} ${periodoDoAcerto({ periodo: p.periodo })}`,
      ...(Number(p.diaria) > 0 ? [`Diária: ${reais(Number(p.diaria))}`] : []),
      ...(Number(p.taxas) > 0 ? [`Taxas: ${reais(Number(p.taxas))}`] : []),
    ],
    detalhe: 'Sai como sangria do caixa de entregas; as entregas ficam acertadas.',
    valor: Number(p.total) / 100,
    botao: 'Pagar',
  };
}
