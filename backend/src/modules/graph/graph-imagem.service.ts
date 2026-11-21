import { Injectable, Logger } from '@nestjs/common';
import { ErroMcp, montarChaveIdempotencia } from '../../dms/integracao-dms';
import { ehServidorLocal } from '../../common/modo';
import { GraphFotoService } from './graph-foto.service';
import {
  FERRAMENTA_CRIAR_IMAGEM,
  FERRAMENTA_EDITAR_IMAGEM,
  type Franquia,
  type MotivoDaImagem,
  franquiaDe,
  fraseDaImagem,
  graphLigadoParaEmpresa,
  lerConfigGraph,
  mimeDoGraph,
  motivoDaImagem,
} from './graph.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Tamanho = '1K' | '2K';
type Formato = 'jpeg' | 'png';

export type PedidoDeCriarImagem = {
  descricao: string;
  proporcao?: '1:1' | '16:9' | '9:16';
  tamanho?: Tamanho;
  formato?: Formato;
  /** O que identifica ESTE pedido para quem chama (ex.: `banner:<id>`): repetir com o mesmo não paga de novo. */
  chave: string;
};

export type PedidoDeEditarImagem = {
  fotos: Array<{ buffer: Buffer; mime: string }>;
  instrucao: string;
  proporcao?: 'original' | '1:1' | '16:9' | '9:16';
  tamanho?: Tamanho;
  formato?: Formato;
  chave: string;
};

export type ResultadoDaImagem =
  | { ok: true; bytes: Buffer; mimeType: 'image/jpeg' | 'image/png'; franquia: Franquia | null }
  | { ok: false; motivo: MotivoDaImagem; mensagem: string };

export type SituacaoDaImagem =
  | { ok: true; podeCriar: boolean; podeEditar: boolean; franquia: { usados: number; total: number } }
  | { ok: false; motivo: MotivoDaImagem; mensagem: string };

/** O Graph tem 60 s para a imagem; aqui, a ida e a volta a mais. */
const PRAZO_MS = 70_000;
const PRAZO_DA_SITUACAO_MS = 8_000;
const MIMES_DA_RESPOSTA = ['image/jpeg', 'image/png'] as const;

const falha = (motivo: MotivoDaImagem): ResultadoDaImagem => ({ ok: false, motivo, mensagem: fraseDaImagem(motivo) });

/**
 * CRIAR E EDITAR IMAGEM PELO DMS GRAPH (contrato 1.4.0; plano "recursos por produto", F4 do Regem). É a porta única para
 * quem precisa de imagem no Regem (o banner do Clube, o Mister): usa a ligação da EMPRESA e a franquia de imagem dela, zero
 * até a DMS liberar. Só NUVEM. Nunca lança: devolve a imagem ou o motivo com a frase para a pessoa. A foto e o texto não vão
 * para o registro.
 */
@Injectable()
export class GraphImagemService {
  private readonly log = new Logger('GraphImagem');

  constructor(private readonly graph: GraphFotoService) {}

  criarImagem(tenantId: string, p: PedidoDeCriarImagem): Promise<ResultadoDaImagem> {
    return this.chamar(tenantId, FERRAMENTA_CRIAR_IMAGEM, p.chave, {
      descricao: p.descricao,
      ...(p.proporcao ? { proporcao: p.proporcao } : {}),
      ...(p.tamanho ? { tamanho: p.tamanho } : {}),
      ...(p.formato ? { formato: p.formato } : {}),
    });
  }

  editarImagem(tenantId: string, p: PedidoDeEditarImagem): Promise<ResultadoDaImagem> {
    const fotos: Array<{ mimeType: string; arquivoBase64: string }> = [];
    for (const f of p.fotos) {
      const mimeType = mimeDoGraph(f.mime);
      if (!mimeType) return Promise.resolve(falha('pedido-invalido'));
      fotos.push({ mimeType, arquivoBase64: f.buffer.toString('base64') });
    }
    return this.chamar(tenantId, FERRAMENTA_EDITAR_IMAGEM, p.chave, {
      fotos,
      instrucao: p.instrucao,
      ...(p.proporcao ? { proporcao: p.proporcao } : {}),
      ...(p.tamanho ? { tamanho: p.tamanho } : {}),
      ...(p.formato ? { formato: p.formato } : {}),
    });
  }

  /**
   * O que a empresa pode fazer de imagem agora (a ferramenta `capacidades`, que só lê e não gasta franquia): a tela mostra
   * a franquia e o motivo antes de a pessoa escrever o pedido. Nunca lança.
   */
  async situacaoDaImagem(tenantId: string): Promise<SituacaoDaImagem> {
    const cfg = lerConfigGraph();
    if (ehServidorLocal() || !cfg.ligado || !graphLigadoParaEmpresa(tenantId)) return falha('desligado') as SituacaoDaImagem;
    const lig = await this.graph.ligacaoParaFoto(tenantId);
    if (!lig) return falha('sem-ligacao') as SituacaoDaImagem;
    try {
      const r: any = await this.graph.cliente(cfg, lig.segredo, PRAZO_DA_SITUACAO_MS).chamar('capacidades', {}, { leitura: true });
      const permissoes: any[] = Array.isArray(r?.permissoes) ? r.permissoes : [];
      const concedida = (id: string) => permissoes.some((p) => p?.id === id && p?.concedida === true);
      const f = r?.franquias?.imagem;
      const inteiro = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
      if (!inteiro(f?.usados) || !inteiro(f?.total)) return falha('fora-do-formato') as SituacaoDaImagem;
      return { ok: true, podeCriar: concedida('imagens.criar'), podeEditar: concedida('imagens.editar'), franquia: { usados: f.usados, total: f.total } };
    } catch (e: any) {
      const motivo = motivoDaImagem(e);
      if (motivo === 'ligacao-desfeita') {
        await this.graph.marcarDesligadaPeloGraph(tenantId, lig.id).catch((falhou: any) => this.log.warn(`não marquei a ligação desfeita: ${String(falhou?.code ?? falhou?.message).slice(0, 80)}`));
      }
      this.log.warn(`capacidades não respondeu (${motivo})`);
      return falha(motivo) as SituacaoDaImagem;
    }
  }

  private async chamar(tenantId: string, ferramenta: string, chave: string, argumentos: Record<string, unknown>): Promise<ResultadoDaImagem> {
    const cfg = lerConfigGraph();
    if (ehServidorLocal() || !cfg.ligado || !graphLigadoParaEmpresa(tenantId)) return falha('desligado');
    const lig = await this.graph.ligacaoParaFoto(tenantId);
    if (!lig) return falha('sem-ligacao');
    try {
      const r: any = await this.graph.cliente(cfg, lig.segredo, PRAZO_MS).chamar(ferramenta, {
        ...argumentos,
        chaveIdempotencia: montarChaveIdempotencia('regem-graph-imagem', tenantId, ferramenta, chave),
      });
      const mimeType = MIMES_DA_RESPOSTA.find((m) => m === r?.mimeType);
      const bytes = mimeType && typeof r?.imagemBase64 === 'string' ? Buffer.from(r.imagemBase64, 'base64') : null;
      if (!mimeType || !bytes?.length) {
        this.log.warn(`o DMS Graph respondeu fora do formato em ${ferramenta}`);
        return falha('fora-do-formato');
      }
      return { ok: true, bytes, mimeType, franquia: franquiaDe(r?.franquia) };
    } catch (e: any) {
      const motivo = motivoDaImagem(e);
      if (motivo === 'ligacao-desfeita') {
        await this.graph.marcarDesligadaPeloGraph(tenantId, lig.id).catch((falhou: any) => this.log.warn(`não marquei a ligação desfeita: ${String(falhou?.code ?? falhou?.message).slice(0, 80)}`));
      }
      this.log.warn(`${ferramenta} não fez a imagem (${motivo}${e instanceof ErroMcp ? `, ${e.tipo}` : ''})`);
      return falha(motivo);
    }
  }
}
