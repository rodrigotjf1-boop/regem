// OS MODELOS DO WHATSAPP OFICIAL E A CONTA DE CADA UM (ERR-458, 13/11/2026). Um modelo só vale na conta da Meta (WABA)
// do número que o ENVIA — a Meta recusa com #132001 ("o modelo não existe") o que não está aprovado lá. Com o principal e
// o marketing em contas diferentes:
//   • o AVISO ao cliente (utilidade/autenticação, ou com `evento`) sai pelo PRINCIPAL e é pedido na conta dele
//     (`submeterTemplate`);
//   • a CAMPANHA (marketing) sai pelo MARKETING e é pedida na conta dele.
// O "Sincronizar" lia o status só da conta do marketing: os avisos novos ficavam "em análise" para sempre e os antigos
// seguiam "aprovado" mesmo quando o principal mudou de conta (30/10) — e o envio voltava #132001.

export type PapelDoNumero = 'principal' | 'marketing';

/**
 * As AUTOMÁTICAS de Delivery › Marketing saem pelo número do papel delas (`relacionamento.service.ts#PAPEL` — o teste
 * confere que as duas listas batem): o cashback pelo principal, mesmo que a Meta o reclassifique como marketing.
 */
export const PAPEL_DAS_AUTOMATICAS: Readonly<Record<string, PapelDoNumero>> = {
  cashback_vencendo: 'principal',
  aniversario_presente: 'marketing',
  aniversario_parabens: 'marketing',
  volta_cupom: 'marketing',
  volta_lembrete: 'marketing',
};

/** O número que envia o modelo — e, portanto, a conta onde ele tem de estar aprovado. */
export function papelDoModelo(m: { nome?: string | null; categoria?: string | null; evento?: string | null }): PapelDoNumero {
  const automatica = m.nome ? PAPEL_DAS_AUTOMATICAS[m.nome] : undefined;
  if (automatica) return automatica;
  if (m.evento) return 'principal';
  return m.categoria === 'UTILITY' || m.categoria === 'AUTHENTICATION' ? 'principal' : 'marketing';
}

export const STATUS_DA_META: Record<string, string> = { APPROVED: 'aprovado', PENDING: 'pendente', REJECTED: 'rejeitado', PAUSED: 'pausado' };

const CATEGORIAS = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];

export type ModeloLocal = {
  id: string;
  nome: string;
  idioma: string;
  categoria: string | null;
  status: string;
  evento?: string | null;
};
export type ModeloRemoto = { nome?: unknown; idioma?: unknown; status?: unknown; categoria?: unknown };
export type MudancaDeModelo = { id: string; status?: string; categoria?: string };

/**
 * O que gravar depois de ler as contas. Cada modelo se confere SÓ na conta do seu papel:
 *   • lá, com status conhecido: o status e a categoria que a Meta deu (ela reclassifica);
 *   • não está lá (e não é rascunho): volta a RASCUNHO — no envio, a Meta o recusaria; a tela mostra "enviar p/ aprovação"
 *     e o pedido sai para a conta certa;
 *   • a lista daquela conta não veio (falha, sem conta): nada muda — melhor velho que errado.
 */
export function decidirSincronizacao(
  locais: readonly ModeloLocal[],
  remotosPorPapel: Partial<Record<PapelDoNumero, readonly ModeloRemoto[] | null>>,
): MudancaDeModelo[] {
  const mapas = new Map<PapelDoNumero, Map<string, ModeloRemoto>>();
  for (const papel of ['principal', 'marketing'] as const) {
    const lista = remotosPorPapel[papel];
    if (!lista) continue;
    mapas.set(papel, new Map(lista.map((r) => [`${String(r.nome ?? '')}|${String(r.idioma ?? '')}`, r])));
  }
  const mudancas: MudancaDeModelo[] = [];
  for (const l of locais) {
    const mapa = mapas.get(papelDoModelo(l));
    if (!mapa) continue;
    const remoto = mapa.get(`${l.nome}|${l.idioma}`);
    if (!remoto) {
      if (l.status !== 'rascunho') mudancas.push({ id: l.id, status: 'rascunho' });
      continue;
    }
    const status = STATUS_DA_META[String(remoto.status ?? '')];
    const categoria = CATEGORIAS.includes(String(remoto.categoria ?? '')) ? String(remoto.categoria) : null;
    const m: MudancaDeModelo = { id: l.id };
    if (status && status !== l.status) m.status = status;
    if (categoria && categoria !== l.categoria) m.categoria = categoria;
    if (m.status || m.categoria) mudancas.push(m);
  }
  return mudancas;
}
