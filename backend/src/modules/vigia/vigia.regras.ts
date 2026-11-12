/* eslint-disable @typescript-eslint/no-explicit-any */

// O VIGIA DO SERVIDOR DA LOJA — as regras PURAS (F1.1 do plano do Mister, `docs/plano-mister.md`; mig 414).
//
// A nuvem recebe a saúde completa de cada servidor de loja a cada minuto (`edge_status`, gravado pela batida do
// `sync-daemon.mjs`: os 5 serviços, disco, backup, banco, relógio, sync, impressoras). Aqui mora só a conta: dada a linha
// de UM servidor e a hora, quais problemas ele tem agora. Sem banco, sem relógio próprio, sem IA — a rotina
// (`vigia.service.ts`) lê, chama esta função e grava os episódios.
//
// • Os limites são os MESMOS dos selos do console da distribuição (`frontend/src/app/distribuicao/page.tsx`: disco abaixo
//   de 2 GB, backup com mais de 48 h, relógio a mais de 120 s, transações acima de 50%/80%) e do "morto" do resgate de
//   pedidos (`cloud-fallback.processor.ts`). Mudou um lado, muda o outro (V74).
// • Servidor SEM SINAL: só essa regra vale. A saúde guardada é a da última batida — afirmar "serviço parado" ou dar o
//   problema por resolvido com dado velho seria inventar (a rotina também não fecha os outros incidentes dele).
// • A evidência leva números e nomes de equipamento; nenhum dado de cliente ou de colaborador passa pela saúde.

export const REGRAS_DO_VIGIA = [
  'servidor_sem_sinal',
  'servico_parado',
  'disco_baixo',
  'backup_atrasado',
  'banco_em_risco',
  'relogio_desviado',
  'sync_falhando',
  'impressora_parada',
] as const;
export type RegraDoVigia = (typeof REGRAS_DO_VIGIA)[number];
export type Gravidade = 'critico' | 'atencao';
/** De quem é o problema: a infraestrutura é da distribuição; o que a loja resolve é da loja. */
export type Publico = 'distribuicao' | 'loja' | 'ambos';

export const LIMITES_DO_VIGIA = {
  /** Sem batida há mais que isto = sem sinal (a batida vem a cada minuto; o recuo do daemon vai até 5 min). */
  semSinalMin: 10,
  /** Abaixo disto o Postgres e o backup começam a falhar (o selo "disco" do console). */
  discoMinimoMb: 2048,
  /** O backup é diário (03:00): mais que isto, perdeu um dia (o selo "bkp" do console). */
  backupMaximoHoras: 48,
  /** Do limite de transações do Postgres: acima do primeiro, acompanhar; do segundo, o banco pode parar de gravar. */
  transacoesAtencaoPct: 50,
  transacoesCriticoPct: 80,
  /** O sync usa "a mais nova vence": relógio fora descarta edição (o selo "relógio" do console). */
  relogioMaximoS: 120,
  /** Sync falhando sem parar há mais que isto. */
  syncFalhandoMin: 15,
} as const;
export type LimitesDoVigia = { [K in keyof typeof LIMITES_DO_VIGIA]: number };

/** Os serviços do Windows do servidor da loja (`RegemEdge…`), como chegam em `saude.servicos`. */
const SERVICOS = ['pg', 'api', 'web', 'sync', 'impressao'] as const;
/** Sem banco ou sem API a loja não vende; os outros degradam. */
const SERVICO_CRITICO = new Set<string>(['pg', 'api']);

export type ServidorVigiado = {
  equipamentoId: string;
  tenantId: string;
  unidadeId: string | null;
  /** A última batida (qualquer uma). */
  recebidoEm: Date | string | null;
  discoLivreMb: number | string | null;
  /** O `saude` da última batida rica; NULL = o servidor ainda não mandou nenhuma. */
  saude: any | null;
};

export type Achado = {
  regra: RegraDoVigia;
  /** O alvo dentro da empresa (com o servidor): é a chave do episódio. */
  chave: string;
  gravidade: Gravidade;
  publico: Publico;
  evidencia: Record<string, unknown>;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const quando = (v: unknown): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
const minutosDesde = (de: Date, agora: Date) => Math.floor((agora.getTime() - de.getTime()) / 60_000);
const curto = (v: unknown, n = 120): string | null => (v === null || v === undefined || v === '' ? null : String(v).slice(0, n));

/** A chave do servidor (e de algo dentro dele) na empresa. */
export const chaveDoServidor = (equipamentoId: string, ...resto: string[]) => ['srv', equipamentoId, ...resto].join(':');

/** O servidor está sem sinal? (sem batida nenhuma registrada não é "sem sinal": nunca houve sinal para perder) */
export function semSinal(s: Pick<ServidorVigiado, 'recebidoEm'>, agora: Date, limites: LimitesDoVigia = LIMITES_DO_VIGIA): boolean {
  const ultima = quando(s.recebidoEm);
  return !!ultima && minutosDesde(ultima, agora) > limites.semSinalMin;
}

/**
 * Os problemas de UM servidor agora. Sem sinal: só `servidor_sem_sinal`. Nunca lança por dado torto: campo ausente ou
 * de outro formato é "não sei", e "não sei" não vira achado.
 */
export function acharProblemas(s: ServidorVigiado, agora: Date, limites: LimitesDoVigia = LIMITES_DO_VIGIA): Achado[] {
  const achados: Achado[] = [];
  const ultima = quando(s.recebidoEm);
  if (semSinal(s, agora, limites)) {
    return [
      {
        regra: 'servidor_sem_sinal',
        chave: chaveDoServidor(s.equipamentoId),
        gravidade: 'critico',
        publico: 'ambos',
        evidencia: { ultimoSinalEm: ultima!.toISOString(), minutosSemSinal: minutosDesde(ultima!, agora) },
      },
    ];
  }
  const saude = s.saude && typeof s.saude === 'object' && !Array.isArray(s.saude) ? s.saude : null;

  // Disco: vem na raiz da batida (não depende da saúde rica).
  const disco = num(s.discoLivreMb);
  if (disco !== null && disco < limites.discoMinimoMb)
    achados.push({
      regra: 'disco_baixo',
      chave: chaveDoServidor(s.equipamentoId),
      gravidade: 'critico',
      publico: 'distribuicao',
      evidencia: { livreMb: Math.round(disco), minimoMb: limites.discoMinimoMb },
    });

  if (!saude) return achados;

  // Serviços do Windows: só "Running" está de pé ("Stopped", "ausente"…). Sem a leitura (`servicos` nulo), não sei.
  const servicos = saude.servicos && typeof saude.servicos === 'object' ? saude.servicos : null;
  if (servicos)
    for (const nome of SERVICOS) {
      const estado = servicos[nome];
      if (typeof estado !== 'string' || estado === 'Running') continue;
      achados.push({
        regra: 'servico_parado',
        chave: chaveDoServidor(s.equipamentoId, 'servico', nome),
        gravidade: SERVICO_CRITICO.has(nome) ? 'critico' : 'atencao',
        publico: 'distribuicao',
        evidencia: { servico: nome, estado: curto(estado, 40), restaurando: saude.restaurando === true },
      });
    }

  // Backup: falhou, passou do prazo ou a loja nunca reportou (o servidor manda o campo em toda batida rica).
  const b = saude.backup && typeof saude.backup === 'object' ? saude.backup : null;
  const horas = num(b?.horas);
  const falhou = !!b && (b.ok === false || !!b.erro);
  const velho = horas !== null && horas > limites.backupMaximoHoras;
  if (!b || falhou || velho)
    achados.push({
      regra: 'backup_atrasado',
      chave: chaveDoServidor(s.equipamentoId),
      gravidade: 'atencao',
      publico: 'distribuicao',
      evidencia: { nuncaReportou: !b, falhou, horas, maximoHoras: limites.backupMaximoHoras, erro: curto(b?.erro) },
    });

  // Banco local: página corrompida (qualquer valor acima de zero) ou perto de parar de aceitar escrita.
  const checksum = num(saude.bancoFalhasChecksum) ?? 0;
  const pct = num(saude.bancoPctTransacoes) ?? 0;
  if (checksum > 0 || pct > limites.transacoesAtencaoPct)
    achados.push({
      regra: 'banco_em_risco',
      chave: chaveDoServidor(s.equipamentoId),
      gravidade: checksum > 0 || pct > limites.transacoesCriticoPct ? 'critico' : 'atencao',
      publico: 'distribuicao',
      evidencia: { falhasDeChecksum: checksum, pctTransacoes: pct },
    });

  // Relógio do PC da loja em relação à nuvem (+ adiantado, − atrasado).
  const desvio = num(saude.relogioDesvioS);
  if (desvio !== null && Math.abs(desvio) > limites.relogioMaximoS)
    achados.push({
      regra: 'relogio_desviado',
      chave: chaveDoServidor(s.equipamentoId),
      gravidade: 'atencao',
      publico: 'distribuicao',
      evidencia: { desvioS: Math.round(desvio), maximoS: limites.relogioMaximoS },
    });

  // Sync falhando sem parar (o servidor bate, mas não sincroniza).
  const falhandoDesde = quando(saude.syncFalhandoDesde);
  if (falhandoDesde && minutosDesde(falhandoDesde, agora) > limites.syncFalhandoMin)
    achados.push({
      regra: 'sync_falhando',
      chave: chaveDoServidor(s.equipamentoId),
      gravidade: 'critico',
      publico: 'distribuicao',
      evidencia: { desde: falhandoDesde.toISOString(), minutos: minutosDesde(falhandoDesde, agora) },
    });

  // Impressoras: a que parou de responder e a que respondeu com aviso (sem papel, tampa). Uma por impressora.
  const impressoras = new Map<string, Achado>();
  const lista = (v: unknown): any[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && x.id) : []);
  for (const i of lista(saude.impressorasSemResponder))
    impressoras.set(String(i.id), {
      regra: 'impressora_parada',
      chave: chaveDoServidor(s.equipamentoId, 'impressora', String(i.id)),
      gravidade: 'atencao',
      publico: 'loja',
      evidencia: { impressoraId: String(i.id), nome: curto(i.nome, 80), motivo: 'sem_responder', desde: curto(i.desde, 40), falhas: num(i.falhas), erro: curto(i.erro) },
    });
  for (const i of lista(saude.impressorasComAviso)) {
    if (impressoras.has(String(i.id))) continue; // a que não responde já está na lista: um episódio por impressora
    impressoras.set(String(i.id), {
      regra: 'impressora_parada',
      chave: chaveDoServidor(s.equipamentoId, 'impressora', String(i.id)),
      gravidade: 'atencao',
      publico: 'loja',
      evidencia: { impressoraId: String(i.id), nome: curto(i.nome, 80), motivo: 'aviso', estado: curto(i.estado, 40), detalhe: curto(i.detalhe), desde: curto(i.desde, 40) },
    });
  }
  achados.push(...impressoras.values());

  return achados;
}
