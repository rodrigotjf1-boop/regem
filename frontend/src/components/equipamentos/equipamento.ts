import type { Tom } from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O que as partes da tela de Equipamentos têm em comum: os tipos, a situação de cada equipamento
// e como ele se apresenta numa linha.

export const TIPOS = [
  { value: 'pdv', label: 'Terminal de PDV (caixa)' },
  { value: 'salao', label: 'Sub-PDV Salão (garçom)' },
  { value: 'terminal_ponto', label: 'Terminal de Ponto' },
  { value: 'kds', label: 'KDS (cozinha)' },
  { value: 'tela_senhas', label: 'Tela de senhas (TV)' },
  { value: 'impressora', label: 'Impressora térmica' },
  { value: 'estacao_impressao', label: 'Estação de impressão (PC com impressora)' },
  { value: 'servidor_local', label: 'Servidor local (edge)' },
];
const TIPO_LABEL: Record<string, string> = {
  pdv: 'Terminal de PDV',
  salao: 'Sub-PDV Salão',
  terminal_ponto: 'Terminal de Ponto',
  kds: 'KDS',
  tela_senhas: 'Tela de senhas',
  impressora: 'Impressora',
  estacao_impressao: 'Estação de impressão',
  servidor_local: 'Servidor local',
  ponto_baixa: 'Ponto de baixa',
  totem: 'Totem', // vem da distribuição (GoGeM); a tela mostrava o texto cru
};
export const tipoDe = (e: any): string => TIPO_LABEL[e.tipo] ?? String(e.tipo);
export const ESCOPOS = [
  { v: 'producao', rotulo: 'Produção (pedidos)' },
  { v: 'entrega', rotulo: 'Entrega (retirada por senha)' },
  { v: 'avisos', rotulo: 'Só avisos (tarefas/picos)' },
  { v: 'despacho', rotulo: 'Despacho (vê o pedido inteiro)' },
];
export const ETAPAS = [
  { v: 'preparo', rotulo: 'ao iniciar preparo' },
  { v: 'pronto', rotulo: 'ao ficar pronto' },
  { v: 'entregue', rotulo: 'ao despachar/entregar' },
];
export const ehGogem = (e: any) => e.integrador === 'gogem';
/** Uma impressora só tem para onde imprimir se: rede → tem IP; local → tem nome no Windows. */
export const alvoValido = (e: any) => (e.conexao === 'local' ? !!e.dispositivo : !!e.host);
/**
 * Os KDS e impressoras para escolher como DESTINO DE PRODUÇÃO (setor, produto, opção,
 * direcionamento): só os em uso. Um destino já marcado que saiu de uso continua na lista para ser
 * desmarcado — o servidor recusa salvar com ele (`common/destino-producao.ts`).
 */
export const destinosParaEscolher = (todos: any[], marcados: string[] = []) =>
  todos.filter((e) => (e.tipo === 'kds' || e.tipo === 'impressora') && (e.ativo !== false || marcados.includes(e.id)));
/** Fora de uso = revogado (Equipamentos) ou desligado (Impressoras e cupons): os dois gravam `ativo = false`. */
export const foraDeUso = (e: any) => e?.ativo === false;
/** Só as impressoras desta loja (ou sem loja) — o servidor recusa a de outra loja. */
export const daLoja = (unidadeId: string | null | undefined) => (e: any) => !unidadeId || !e.unidadeId || e.unidadeId === unidadeId;

export type SituacaoEq = 'ativo' | 'atencao' | 'nunca' | 'mudo' | 'revogado';
export const SITUACAO: Record<SituacaoEq, { tom: Tom; rotulo: string }> = {
  ativo: { tom: 'ok', rotulo: 'ativo' },
  atencao: { tom: 'aviso', rotulo: 'precisa de atenção' },
  nunca: { tom: 'aviso', rotulo: 'nunca conectou' },
  mudo: { tom: 'critico', rotulo: 'sem responder' },
  revogado: { tom: 'neutro', rotulo: 'revogado' },
};

// O que a impressora RESPONDEU (mig 324; `ESTADOS_IMPRESSORA` do servidor). "pronta" não vira selo.
export const ESTADO_IMPRESSORA: Record<string, { tom: Tom; rotulo: string }> = {
  papel_acabando: { tom: 'aviso', rotulo: 'papel acabando' },
  sem_papel: { tom: 'critico', rotulo: 'sem papel' },
  tampa_aberta: { tom: 'critico', rotulo: 'tampa aberta' },
  erro: { tom: 'critico', rotulo: 'erro na impressora' },
  parada: { tom: 'critico', rotulo: 'parada' },
  sem_resposta: { tom: 'critico', rotulo: 'sem resposta' },
};

/** A estação bate a cada minuto (`ESTACAO_BATIDA_MS`); sem batida por 3 min, está fora. */
export const ESTACAO_FORA_MIN = 3;
const estacaoDe = (id: string | null | undefined, todos: any[]) => (id ? todos.find((x) => x.id === id) : undefined);
const estacaoNoAr = (s: any) => !!s?.ativo && !!s.estacao?.vistoEm && minutosDesde(s.estacao.vistoEm) < ESTACAO_FORA_MIN;

/**
 * Presença (conexão PC ↔ servidor, mig nenhuma — `e.presenca` vem da lista): o app aberto avisa o servidor
 * da loja a cada 30 s e a estação, na batida de cada minuto. Visto há menos de 3 min = "conectado agora".
 * O "último uso" só marcava operação: o PC ligado e parado parecia "nunca usado" e foi revogado (ERR-248).
 */
export const CONECTADO_MIN = 3;
export const conectadoAgora = (e: any) => !!e?.presenca?.vistoEm && minutosDesde(e.presenca.vistoEm) < CONECTADO_MIN;
const TEM_PRESENCA = ['pdv', 'salao', 'estacao_impressao'];

/**
 * A situação do equipamento. A impressora não "conecta" (quem fala com ela é o servidor ou a
 * estação): vale o estado da última impressão e o que ela respondeu — `estado` vem de
 * `/impressao/impressoras/estado`, por id. A estação, pela última batida (`e.estacao`).
 */
export function situacaoDe(e: any, estado: Record<string, any>, todos: any[] = []): SituacaoEq {
  if (!e.ativo) return 'revogado';
  // Tela de senhas (mig 337): não grava presença (ERR-235) — vale se já trocou o código pelo segredo.
  if (e.tipo === 'tela_senhas') return e.pareado ? 'ativo' : 'nunca';
  if (e.tipo === 'estacao_impressao') {
    if (estacaoNoAr(e) || conectadoAgora(e)) return 'ativo';
    return e.estacao?.vistoEm || e.pareado ? 'mudo' : 'nunca';
  }
  if (e.tipo === 'impressora') {
    const s = estado[e.id];
    if (s?.semResponder) return 'mudo';
    if (s?.estado && ESTADO_IMPRESSORA[s.estado]) return 'atencao';
    if (e.estacaoId && !estacaoNoAr(estacaoDe(e.estacaoId, todos))) return 'atencao';
    return 'ativo';
  }
  // Servidor da loja: pela saúde que ele manda (`e.servidor`, só na nuvem). Antes ele saía sempre
  // "nunca conectou" — e o dono revogou um servidor em uso achando que estava parado (ERR-236).
  if (e.tipo === 'servidor_local' && !ehGogem(e) && e.servidor?.vistoEm) return minutosDesde(e.servidor.vistoEm) < SERVIDOR_FORA_MIN ? 'ativo' : 'mudo';
  return ultimoSinal(e) ? 'ativo' : 'nunca';
}

/**
 * O sinal mais recente do equipamento, venha de onde vier: a conexão do app (`ultimoPing`), o uso
 * da credencial do PC (`ultimoUsoEm` — o PDV que só usa o modo local grava no servidor da loja, e
 * sobe), o GoGeM, a saúde do servidor da loja, a batida da estação. ERR-236: só o `ultimoPing`
 * contava e o PDV em uso aparecia "nunca conectou".
 */
export function ultimoSinal(e: any): string | null {
  const t = [e.ultimoPing, e.ultimoUsoEm, e.integradorVistoEm, e.servidor?.vistoEm, e.estacao?.vistoEm, e.presenca?.vistoEm]
    .filter(Boolean)
    .map((x: string) => new Date(x).getTime())
    .filter((n: number) => !Number.isNaN(n));
  return t.length ? new Date(Math.max(...t)).toISOString() : null;
}
/** O servidor da loja manda a saúde a cada ciclo; sem ela há 3 min, está sem responder (a janela da nuvem, `EDGE_JANELA_MIN`). */
export const SERVIDOR_FORA_MIN = 3;
/** "Reativar" vale até 30 dias depois da revogação — o mesmo número do servidor (`DIAS_PARA_REATIVAR`). */
export const DIAS_PARA_REATIVAR = 30;
export const podeReativar = (e: any) => !e.ativo && (!e.revogadoEm || minutosDesde(e.revogadoEm) <= DIAS_PARA_REATIVAR * 1440);

/** O selo da coluna "Situação": o estado que a impressora respondeu, ou a estação no ar / fora. */
export function seloDe(e: any, estado: Record<string, any>, todos: any[] = []): { tom: Tom; rotulo: string } {
  const sit = situacaoDe(e, estado, todos);
  if (sit !== 'revogado' && TEM_PRESENCA.includes(e.tipo) && conectadoAgora(e)) return { tom: 'ok', rotulo: 'conectado agora' };
  if (e.tipo === 'tela_senhas' && sit !== 'revogado') return sit === 'ativo' ? { tom: 'ok', rotulo: 'pareada' } : { tom: 'aviso', rotulo: 'falta parear' };
  if (e.tipo === 'estacao_impressao') {
    if (sit === 'ativo') return { tom: 'ok', rotulo: 'no ar' };
    if (sit === 'mudo') return { tom: 'critico', rotulo: e.estacao?.vistoEm ? `fora · há ${tempoDesde(e.estacao.vistoEm)}` : 'fora' };
  }
  if (e.tipo === 'servidor_local' && sit === 'mudo' && e.servidor?.vistoEm) return { tom: 'critico', rotulo: `sem responder · há ${tempoDesde(e.servidor.vistoEm)}` };
  if (e.tipo === 'impressora' && sit === 'atencao') {
    const s = estado[e.id];
    if (s?.estado && ESTADO_IMPRESSORA[s.estado]) return ESTADO_IMPRESSORA[s.estado];
    return { tom: 'aviso', rotulo: 'esperando a estação' };
  }
  return SITUACAO[sit];
}

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export const minutosDesde = (iso?: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000)) : 0);
const tempoDesde = (iso: string) => {
  const m = minutosDesde(iso);
  return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} dias`;
};

/** A coluna "Último acesso": para a impressora, a última impressão ou a fila parada. */
export function vistoDe(e: any, estado: Record<string, any>): string {
  if (e.tipo === 'estacao_impressao') return e.estacao?.vistoEm ? dataHora(e.estacao.vistoEm) : '—';
  if (e.tipo === 'impressora') {
    const s = estado[e.id];
    if (!s) return '—';
    if (s.pendentes > 0) return `${s.pendentes} ${s.pendentes === 1 ? 'ticket esperando' : 'tickets esperando'}${s.maisAntigoEm ? ` há ${minutosDesde(s.maisAntigoEm)} min` : ''}`;
    if (s.semResponder && s.ultimaFalhaEm) return `sem responder desde ${dataHora(s.ultimaFalhaEm)}`;
    return s.ultimoOkEm ? `última impressão ${dataHora(s.ultimoOkEm)}` : '—';
  }
  const visto = ultimoSinal(e);
  return visto ? dataHora(visto) : '—';
}

/**
 * A coluna "Conexão": para terminal e estação com presença, "agora" (ou "visto há N min"), o IP do PC e
 * por onde ele chega ao servidor (regem.local ou um IP); o resto, o último acesso de sempre.
 */
export function conexaoDe(e: any, estado: Record<string, any>): string {
  const p = e?.ativo !== false && TEM_PRESENCA.includes(e.tipo) ? e.presenca : null;
  if (!p?.vistoEm) return vistoDe(e, estado);
  const quando = conectadoAgora(e) ? 'agora' : `visto ${haQuanto(p.vistoEm)}`;
  return [quando, p.ip, p.endereco ? `por ${p.endereco}` : ''].filter(Boolean).join(' · ');
}

/** Um PC da loja na visão "Por PC" de Equipamentos (protótipo de 20/10/2026, peça 3). */
export type GrupoPc = {
  chave: string;
  titulo: string;
  apoio: string;
  selo: { tom: Tom; rotulo: string } | null;
  itens: any[];
};

/**
 * Junta o que é do mesmo PC: o terminal (app aberto) e a estação falam com o servidor do mesmo IP; a
 * impressora vai junto da estação dela; impressora sem estação imprime pelo servidor da loja. Sem
 * presença agora (ou nunca), o terminal e a estação vão para "Sem sinal agora". KDS, ponto e o resto
 * ficam em "Outros aparelhos"; os revogados, num grupo à parte.
 */
export function agruparPorPc(linhas: any[], todos: any[], servidor?: { ip?: string | null; maquina?: string | null } | null): GrupoPc[] {
  const porId = new Map(todos.map((x) => [x.id, x]));
  const grupos = new Map<string, any[]>();
  const pc = (e: any) => (e?.ativo !== false && TEM_PRESENCA.includes(e?.tipo) && e.presenca?.ip ? `pc:${e.presenca.ip}` : null);
  for (const e of linhas) {
    let chave: string;
    if (e.ativo === false) chave = 'revogados';
    else if (e.tipo === 'servidor_local' && !ehGogem(e)) chave = 'servidor';
    else if (e.tipo === 'impressora') chave = e.estacaoId ? (pc(porId.get(e.estacaoId)) ?? 'sem-sinal') : 'servidor';
    else if (TEM_PRESENCA.includes(e.tipo) && !ehGogem(e)) chave = pc(e) ?? 'sem-sinal';
    else chave = 'outros';
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave)!.push(e);
  }
  const mais = (itens: any[]) =>
    itens.map((x) => x.presenca?.vistoEm).filter(Boolean).sort().pop() as string | undefined;
  const out: GrupoPc[] = [];
  const srv = grupos.get('servidor');
  if (srv) {
    out.push({
      chave: 'servidor',
      titulo: 'Servidor da loja',
      apoio: [servidor?.maquina, servidor?.ip].filter(Boolean).join(' · ') || 'o servidor local e o que imprime por ele',
      selo: null,
      itens: srv,
    });
  }
  const pcs = [...grupos.entries()].filter(([k]) => k.startsWith('pc:'));
  pcs.sort((a, b) => String(mais(b[1]) ?? '').localeCompare(String(mais(a[1]) ?? '')));
  for (const [chave, itens] of pcs) {
    const ip = chave.slice(3);
    const comPresenca = itens.filter((x) => x.presenca?.vistoEm);
    const maquina = comPresenca.map((x) => x.presenca.maquina).find(Boolean);
    const endereco = comPresenca.map((x) => x.presenca.endereco).find(Boolean);
    const terminais = itens.filter((x) => x.tipo === 'pdv' || x.tipo === 'salao').map((x) => x.nome);
    const visto = mais(itens);
    const agora = !!visto && minutosDesde(visto) < CONECTADO_MIN;
    out.push({
      chave,
      titulo: maquina || terminais[0] || `PC ${ip}`,
      apoio: [ip, endereco ? `por ${endereco}` : ''].filter(Boolean).join(' · '),
      selo: visto ? { tom: agora ? 'ok' : 'aviso', rotulo: agora ? 'conectado agora' : `visto ${haQuanto(visto)}` } : null,
      itens,
    });
  }
  const resto: Array<[string, string, string]> = [
    ['sem-sinal', 'Sem sinal agora', 'terminais e estações que não falaram com o servidor nos últimos 10 min (ou nunca)'],
    ['outros', 'Outros aparelhos', 'KDS, ponto e o que não abre o app num PC'],
    ['revogados', 'Revogados', 'dá para reativar em até 30 dias'],
  ];
  for (const [chave, titulo, apoio] of resto) {
    const itens = grupos.get(chave);
    if (!itens) continue;
    out.push({
      chave,
      titulo,
      apoio,
      selo: chave === 'sem-sinal' ? { tom: 'aviso', rotulo: `${itens.length} para revisar` } : null,
      itens,
    });
  }
  return out;
}

/** "há 6 min", "há 3 h", "há 2 dias" — para a frase do diálogo de revogar. */
export const haQuanto = (iso: string) => `há ${tempoDesde(iso)}`;

/** A coluna "Ligação": a que o equipamento está preso (impressora do caixa, PDV principal, IP…). */
export function ligacaoDe(e: any, todos: any[]): string {
  const nome = (id?: string | null) => todos.find((x) => x.id === id)?.nome;
  switch (e.tipo) {
    case 'pdv':
      if (ehGogem(e)) return 'credencial do totem';
      return e.impressoraPadraoId ? `cupom: ${nome(e.impressoraPadraoId) ?? 'impressora fora da lista'}` : 'sem impressora de cupom';
    case 'salao':
      return e.pdvMainId ? `principal: ${nome(e.pdvMainId) ?? 'PDV fora da lista'}` : 'sem PDV principal';
    case 'terminal_ponto':
      return e.padrao ? 'REP-Software' : '—';
    case 'kds':
      return [
        e.escopo === 'avisos'
          ? 'só avisos'
          : e.escopo === 'entrega'
            ? 'entrega (retirada por senha)'
            : e.escopo === 'despacho'
              ? 'despacho (pedido inteiro)'
              : 'produção',
        e.imprimeAoAvancar ? `imprime ${ETAPAS.find((x) => x.v === (e.imprimeNoStatus ?? 'pronto'))?.rotulo ?? 'ao avançar'}` : '',
        e.proximoKdsId ? `pronto vai para: ${nome(e.proximoKdsId) ?? 'KDS fora da lista'}` : '',
      ].filter(Boolean).join(' · ');
    case 'estacao_impressao': {
      const ligadas = todos.filter((x) => x.tipo === 'impressora' && x.ativo && x.estacaoId === e.id).length;
      return [
        e.estacao?.maquina ? `PC: ${e.estacao.maquina}` : e.pareado ? '' : 'falta parear',
        ligadas ? `${ligadas} ${ligadas === 1 ? 'impressora ligada' : 'impressoras ligadas'}` : 'nenhuma impressora ligada',
        e.estacao?.versao ? `versão ${e.estacao.versao}` : '',
      ].filter(Boolean).join(' · ');
    }
    case 'impressora':
      return [
        e.estacaoId ? `ligada em ${estacaoDe(e.estacaoId, todos)?.nome ?? 'estação fora da lista'}` : '',
        e.conexao === 'local' ? `USB: ${e.dispositivo || '(sem nome)'}` : e.host ? `${e.host}:${e.porta ?? 9100}` : 'sem destino',
        `${e.largura ?? 80} mm`,
        e.fazEtiqueta ? 'etiqueta' : [e.fazCupom ? 'cupom' : '', e.fazProducao ? 'produção' : ''].filter(Boolean).join(' + ') || 'não imprime nada',
        (e.setoresAtendidos?.length ?? 0) > 0 ? `${e.setoresAtendidos.length} ${e.setoresAtendidos.length === 1 ? 'setor' : 'setores'}` : '',
        e.fazProducao && !e.fazEtiqueta && e.formaProducao === 'completo' ? 'pedido completo' : '', // mig 335
      ].filter(Boolean).join(' · ');
    case 'servidor_local':
      return ehGogem(e) ? 'credencial do totem' : 'servidor da loja';
    case 'tela_senhas': {
      // Onde abrir e, se mexeram, os tamanhos desta TV (mig 337).
      const t = e.telaTamanhos ?? {};
      const fora = [['pronto', 'Pronto'], ['preparando', 'Preparando'], ['titulos', 'títulos']]
        .filter(([k]) => t[k] != null && t[k] !== 100)
        .map(([k, rotulo]) => `${rotulo} ${t[k]}%`);
      return [e.pareado ? 'abre em /senhas' : 'falta parear em /senhas', ...fora].join(' · ');
    }
    default:
      return '—';
  }
}
