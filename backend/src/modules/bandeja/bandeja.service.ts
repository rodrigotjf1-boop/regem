import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { arquivoDaChave, chaveDaBandeja } from './bandeja-chave';
import { ondeDigitar } from '../../common/onde-digitar';
import { DIAS_PARA_REATIVAR, EquipamentoService, ViaDaAcao } from '../equipamento/equipamento.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ÍCONE DO SERVIDOR DA LOJA (fase 4 do pedido de 22–23/10/2026; protótipo `mockups/regem-bandeja-servidor.html`).
// Fica na bandeja do Windows do servidor e mostra TODOS os aparelhos ligados a ele: se cada um está conectado agora, a
// versão instalada em cada lugar e as ações (gerar código, revogar, reativar). O ícone é livre (decisão do dono, 23/10):
// a rota só atende o próprio computador (`BandejaGuard`), e cada ação vai para a auditoria com o computador e o usuário
// do Windows. Os TEXTOS saem daqui (um lugar só, testado); o ícone só desenha.

/** Visto há menos que isto: "conectado agora" (o mesmo número da tela Equipamentos, `CONECTADO_MIN`). */
export const CONECTADO_MS = 3 * 60_000;
/** Visto há menos que isto (e mais que o de cima): "parou de responder" — caiu durante o uso. Depois: "desligado". */
export const CAIU_MS = 60 * 60_000;
/** Quem pareia por código (o serviço gera para eles; o garçom e o caixa do GoGeM não — a tela também não oferece). */
const TIPOS_COM_CODIGO = ['pdv', 'salao', 'estacao_impressao', 'tela_senhas'];
/** D3 (23/10): o ícone avisa (e fica amarelo) quando um destes cai. */
const TIPOS_QUE_AVISAM = ['pdv', 'estacao_impressao', 'kds'];
/** Entram com login de pessoa, sem credencial do aparelho: o servidor não sabe se estão ligados. */
const TIPOS_SEM_SINAL = ['terminal_ponto', 'ponto_baixa'];
const FEMININOS = ['estacao_impressao', 'tela_senhas', 'impressora'];

export type Situacao = 'conectado' | 'caiu' | 'desligado' | 'nunca' | 'sem_sinal' | 'revogado';

/** "agora", "há 40 s", "há 4 min", "há 3 h", "há 2 dias". */
export function haQuanto(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 10) return 'agora';
  if (s < 60) return `há ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} dias`;
}

/** A data no fuso da loja (a nuvem roda em UTC — V46). */
function diaMes(ms: number): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(new Date(ms));
}

// Onde digitar o código, por tipo: um lugar só, também para a tela Equipamentos (`common/onde-digitar.ts`).
export { ondeDigitar };

const msDe = (iso: unknown): number | null => {
  const t = typeof iso === 'string' || iso instanceof Date ? Date.parse(String(iso instanceof Date ? iso.toISOString() : iso)) : NaN;
  return Number.isFinite(t) ? t : null;
};
const texto = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

@Injectable()
export class BandejaService implements OnModuleInit {
  private readonly log = new Logger('Bandeja');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly equipamentos: EquipamentoService,
    private readonly producao: ProducaoPedidoService,
  ) {}

  /**
   * A chave nasce quando o sistema LIGA no servidor da loja: o ícone precisa dela já na primeira chamada (se ela só
   * nascesse na primeira chamada, o ícone nunca chamaria). Na nuvem, nada.
   */
  onModuleInit(): void {
    if (!ehServidorLocal()) return;
    try {
      chaveDaBandeja();
    } catch (e: any) {
      this.log.warn(`a chave do ícone do servidor não foi criada em ${arquivoDaChave()}: ${e?.message ?? e} — o ícone fica sem dados até a próxima vez que o sistema ligar`);
    }
  }

  /**
   * De qual loja é este servidor: a do instalador (`EDGE_UNIDADE_ID`). Sem ela, a única empresa do banco; com mais de
   * uma, não adivinha (V33).
   */
  async daLoja(): Promise<{ tenantId: string; unidadeId: string | null; nome: string | null }> {
    const unidadeId = texto(process.env.EDGE_UNIDADE_ID, 64);
    if (unidadeId && /^[0-9a-f-]{36}$/i.test(unidadeId)) {
      const r: any = await this.db.execute(sql`select tenant_id as "tenantId", nome from unidade where id = ${unidadeId}::uuid`);
      const u = (r.rows ?? r)[0];
      if (u) return { tenantId: String(u.tenantId), unidadeId, nome: u.nome ?? null };
    }
    const r: any = await this.db.execute(sql`select id, nome from empresa order by id limit 2`);
    const empresas = r.rows ?? r;
    if (empresas.length === 1) return { tenantId: String(empresas[0].id), unidadeId: null, nome: empresas[0].nome ?? null };
    throw new ConflictException('Este servidor ainda não sabe de qual loja é: reinstale-o pelo instalador, no modo "Servidor".');
  }

  /** O que o ícone mostra: o servidor (versão, nuvem) e cada aparelho desta loja (ou sem loja — V4). */
  async estado(agoraMs: number = Date.now()) {
    const loja = await this.daLoja();
    const versaoServidor = texto(process.env.APP_VERSION, 40);
    const todos: any[] = await this.equipamentos.listar(loja.tenantId);
    const daLoja = (e: any) => !loja.unidadeId || !e.unidadeId || e.unidadeId === loja.unidadeId;
    const lista = todos.filter((e) => e.tipo !== 'servidor_local' && daLoja(e) && (e.ativo || this.podeReativar(e, agoraMs)));
    let impressoras = new Map<string, any>();
    if (lista.some((e) => e.tipo === 'impressora')) {
      impressoras = new Map((await this.producao.estadoImpressoras(loja.tenantId, loja.unidadeId)).map((x: any) => [String(x.id), x]));
    }
    const nomes = new Map(todos.map((e) => [String(e.id), String(e.nome ?? '')]));
    const aparelhos = lista.map((e) => this.aparelho(e, { agoraMs, versaoServidor, impressoras, nomes }));
    const ativos = aparelhos.filter((a) => a.situacao !== 'revogado');
    return {
      agora: new Date(agoraMs).toISOString(),
      servidor: { versao: versaoServidor, loja: loja.nome, nuvem: await this.nuvem(agoraMs) },
      resumo: {
        total: ativos.length,
        conectados: ativos.filter((a) => a.situacao === 'conectado').length,
        caidos: ativos.filter((a) => a.situacao === 'caiu').length,
        versaoAntiga: ativos.filter((a) => a.versaoAntiga).length,
        alerta: ativos.some((a) => a.alerta),
      },
      aparelhos,
    };
  }

  private podeReativar(e: any, agoraMs: number): boolean {
    const rev = msDe(e.revogadoEm);
    return !e.ativo && (rev == null || agoraMs - rev <= DIAS_PARA_REATIVAR * 86_400_000);
  }

  /** O que dá para fazer pelo ícone — as mesmas regras da tela Equipamentos no servidor da loja e do serviço. */
  acoesDe(e: any, agoraMs: number = Date.now()) {
    const gogem = e.integrador === 'gogem' && (e.tipo === 'pdv' || e.tipo === 'salao');
    return {
      codigo: !!e.ativo && TIPOS_COM_CODIGO.includes(e.tipo) && !gogem,
      revogar: !!e.ativo && !e.padrao,
      reativar: this.podeReativar(e, agoraMs),
    };
  }

  private aparelho(e: any, ctx: { agoraMs: number; versaoServidor: string | null; impressoras: Map<string, any>; nomes: Map<string, string> }) {
    const { agoraMs } = ctx;
    const fem = FEMININOS.includes(e.tipo);
    const conectadoTxt = fem ? 'conectada agora' : 'conectado agora';
    const ip = texto(e.presenca?.ip, 64);
    let situacao: Situacao;
    let linha: string;
    let vistoMs: number | null = null;

    if (!e.ativo) {
      situacao = 'revogado';
      const rev = msDe(e.revogadoEm);
      linha = rev == null ? 'revogado' : `revogado ${haQuanto(agoraMs - rev)} · dá para reativar até ${diaMes(rev + DIAS_PARA_REATIVAR * 86_400_000)}`;
    } else if (TIPOS_SEM_SINAL.includes(e.tipo)) {
      situacao = 'sem_sinal';
      linha = 'não informa · entra com login de pessoa';
    } else if (e.tipo === 'impressora') {
      // A impressora não "conecta": vale o que ela respondeu na última impressão (impressora_status) e a fila.
      const s = ctx.impressoras.get(String(e.id));
      situacao = s?.semResponder ? 'caiu' : 'conectado';
      const partes = [s?.semResponder ? 'sem responder' : rotuloDaImpressora(s?.estado)];
      if (Number(s?.pendentes) > 0) partes.push(`${s.pendentes} ${Number(s.pendentes) === 1 ? 'ticket esperando' : 'tickets esperando'}`);
      linha = partes.join(' · ');
    } else {
      const sinais =
        e.tipo === 'estacao_impressao' ? [e.estacao?.vistoEm, e.presenca?.vistoEm]
        : e.tipo === 'pdv' || e.tipo === 'salao' ? [e.presenca?.vistoEm, e.ultimoUsoEm]
        : e.tipo === 'kds' ? [e.presenca?.vistoEm, e.ultimoPing]
        : [e.presenca?.vistoEm];
      const vistos = sinais.map(msDe).filter((x): x is number => x != null);
      vistoMs = vistos.length ? Math.max(...vistos) : null;
      const idade = vistoMs == null ? null : agoraMs - vistoMs;
      if (idade == null) {
        situacao = e.tipo === 'tela_senhas' && e.pareado ? 'desligado' : 'nunca';
        linha = situacao === 'desligado' ? 'pareada · sem conexão agora' : e.tipo === 'tela_senhas' || e.tipo === 'estacao_impressao' ? 'falta parear' : 'nunca conectou';
      } else if (idade < CONECTADO_MS) {
        situacao = 'conectado';
        linha = e.tipo === 'totem' ? `em uso · última chamada ${haQuanto(idade)}` : conectadoTxt;
      } else if (idade < CAIU_MS && e.tipo !== 'totem') {
        situacao = 'caiu';
        linha = `parou de responder ${haQuanto(idade)}`;
      } else {
        situacao = 'desligado';
        linha = e.tipo === 'totem' ? `última chamada ${haQuanto(idade)}` : `visto pela última vez ${haQuanto(idade)}`;
      }
      if (ip) linha += situacao === 'conectado' ? ` · ${ip}` : ` · último IP ${ip}`;
      if (e.tipo === 'salao' && e.pdvMainId && ctx.nomes.get(String(e.pdvMainId))) linha += ` · ligado ao ${ctx.nomes.get(String(e.pdvMainId))}`;
    }

    // A versão instalada em cada lugar: a da tela aberta (caixa, garçom, KDS, TV) ou a instalada no PC (estação).
    const versaoDe: 'tela' | 'pc' | null =
      e.tipo === 'estacao_impressao' ? 'pc' : ['pdv', 'salao', 'kds', 'tela_senhas'].includes(e.tipo) ? 'tela' : null;
    const versao = versaoDe === 'pc' ? texto(e.estacao?.versao, 40) : versaoDe === 'tela' ? texto(e.presenca?.versao, 40) : null;
    const versaoAntiga = situacao !== 'revogado' && !!versao && !!ctx.versaoServidor && versao !== ctx.versaoServidor;
    const linhaVersao = !versaoAntiga
      ? null
      : versaoDe === 'pc'
        ? `versão antiga ${versao} — reinstale este PC com o instalador ${ctx.versaoServidor}`
        : `versão antiga ${versao} — feche e abra o Regem neste aparelho`;

    return {
      id: String(e.id),
      tipo: String(e.tipo),
      nome: String(e.nome ?? ''),
      situacao,
      linha,
      vistoEm: vistoMs == null ? null : new Date(vistoMs).toISOString(),
      ip,
      versao,
      versaoDe,
      versaoAntiga,
      linhaVersao,
      alerta: situacao === 'caiu' && TIPOS_QUE_AVISAM.includes(e.tipo),
      // A impressora de uma estação aparece dentro dela no ícone.
      estacaoId: e.tipo === 'impressora' ? (e.estacaoId ?? null) : null,
      acoes: this.acoesDe(e, agoraMs),
    };
  }

  /** O último contato do sync com a nuvem, que o sync-daemon anota a cada batida (`sync_state.nuvem_contato`). */
  private async nuvem(agoraMs: number): Promise<{ situacao: 'ok' | 'falhando' | 'sem_informacao'; linha: string }> {
    try {
      const r: any = await this.db.execute(sql`select valor from sync_state where chave = 'nuvem_contato'`);
      const v = JSON.parse(String((r.rows ?? r)[0]?.valor ?? 'null'));
      const em = msDe(v?.okEm);
      const falhando = msDe(v?.falhandoDesde);
      if (falhando != null && (em == null || falhando > em)) return { situacao: 'falhando', linha: `sem sincronizar com a nuvem ${haQuanto(agoraMs - falhando)}` };
      if (em != null) {
        const idade = agoraMs - em;
        return idade < 5 * 60_000
          ? { situacao: 'ok', linha: `nuvem sincronizada ${haQuanto(idade)}` }
          : { situacao: 'falhando', linha: `sem notícia da nuvem ${haQuanto(idade)}` };
      }
    } catch {
      /* sem a tabela ou valor ilegível: sem informação */
    }
    return { situacao: 'sem_informacao', linha: 'nuvem: ainda sem informação' };
  }

  /** Gerar código, revogar ou reativar pelo ícone. `quem` = o computador e o usuário do Windows (para a auditoria). */
  async agir(acao: 'codigo' | 'revogar' | 'reativar', id: string, quem: { maquina?: unknown; usuario?: unknown } = {}) {
    const loja = await this.daLoja();
    const todos: any[] = await this.equipamentos.listar(loja.tenantId);
    const e = todos.find((x) => String(x.id) === id && x.tipo !== 'servidor_local' && (!loja.unidadeId || !x.unidadeId || x.unidadeId === loja.unidadeId));
    if (!e) throw new NotFoundException('Aparelho não encontrado neste servidor. Atualize o painel.');
    const pode = this.acoesDe(e);
    const via: ViaDaAcao = {
      atorTipo: 'sistema',
      origem: 'bandeja_servidor',
      detalhe: { pelo: 'ícone do servidor', maquina: texto(quem.maquina, 120), usuarioWindows: texto(quem.usuario, 120) },
    };
    if (acao === 'codigo') {
      if (!pode.codigo) throw new BadRequestException(e.ativo ? `"${e.nome}" não pareia por código.` : `"${e.nome}" está revogado: reative-o primeiro.`);
      const r = await this.equipamentos.gerarCodigo(loja.tenantId, e.id, null, null, via);
      return { ...r, onde: ondeDigitar(e.tipo) };
    }
    if (acao === 'revogar') {
      if (!pode.revogar) throw new BadRequestException(e.padrao ? `"${e.nome}" é o aparelho padrão e não se revoga.` : `"${e.nome}" já está revogado.`);
      await this.equipamentos.revogar(loja.tenantId, e.id, null, null, via);
      return { ok: true, nome: e.nome };
    }
    if (!pode.reativar) throw new BadRequestException(e.ativo ? `"${e.nome}" já está em uso.` : `"${e.nome}" foi revogado há mais de ${DIAS_PARA_REATIVAR} dias: cadastre de novo.`);
    const r: any = await this.equipamentos.reativar(loja.tenantId, e.id, null, null, via);
    return { ok: true, nome: e.nome, codigo: r?.codigo ?? null, expiraEm: r?.expiraEm ?? null, onde: r?.codigo ? ondeDigitar(e.tipo) : null };
  }
}

/** O que a impressora respondeu, como a tela Equipamentos escreve (`ESTADO_IMPRESSORA`). "pronta" quando nada. */
function rotuloDaImpressora(estado: unknown): string {
  const r: Record<string, string> = {
    papel_acabando: 'papel acabando',
    sem_papel: 'sem papel',
    tampa_aberta: 'tampa aberta',
    erro: 'erro na impressora',
    parada: 'parada',
    sem_resposta: 'sem resposta',
  };
  return (typeof estado === 'string' && r[estado]) || 'pronta';
}
