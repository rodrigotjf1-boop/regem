import { Injectable, Logger } from '@nestjs/common';
import { ErroMcp, montarChaveIdempotencia } from '../../dms/integracao-dms';
import { ehServidorLocal } from '../../common/modo';
import { GraphFotoService } from './graph-foto.service';
import {
  FERRAMENTA_ANIMAR_IMAGEM,
  FERRAMENTA_CRIAR_IMAGEM,
  FERRAMENTA_EDITAR_IMAGEM,
  type Franquia,
  type MotivoDaImagem,
  franquiaDe,
  fraseDaImagem,
  fraseDoGif,
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
  | { ok: true; podeCriar: boolean; podeEditar: boolean; podeAnimar: boolean; franquia: { usados: number; total: number } }
  | { ok: false; motivo: MotivoDaImagem; mensagem: string };

export type ResultadoDoGif = { ok: true; bytes: Buffer } | { ok: false; motivo: MotivoDaImagem; mensagem: string };

/** O Graph tem 60 s para a imagem; aqui, a ida e a volta a mais. */
const PRAZO_MS = 70_000;
/** O Graph tem 30 s para o GIF; aqui, a ida e a volta a mais. */
const PRAZO_DO_GIF_MS = 40_000;
const GIF_MAX_BYTES = 1024 * 1024;
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
   * O GIF de uma imagem pronta (`animar_imagem`, contrato 1.5.0): sem IA e sem franquia, e o mesmo arquivo dá sempre o mesmo
   * GIF, por isso não leva chave e pode repetir como uma leitura. Nunca lança.
   */
  async animarImagem(tenantId: string, foto: { buffer: Buffer; mime: string }): Promise<ResultadoDoGif> {
    const falhou = (motivo: MotivoDaImagem): ResultadoDoGif => ({ ok: false, motivo, mensagem: fraseDoGif(motivo) });
    const mimeType = mimeDoGraph(foto.mime);
    if (!mimeType) return falhou('pedido-invalido');
    const cfg = lerConfigGraph();
    if (ehServidorLocal() || !cfg.ligado || !graphLigadoParaEmpresa(tenantId)) return falhou('desligado');
    const lig = await this.graph.ligacaoParaFoto(tenantId);
    if (!lig) return falhou('sem-ligacao');
    try {
      const r: any = await this.graph
        .cliente(cfg, lig.segredo, PRAZO_DO_GIF_MS)
        .chamar(FERRAMENTA_ANIMAR_IMAGEM, { foto: { mimeType, arquivoBase64: foto.buffer.toString('base64') } }, { leitura: true });
      const bytes = r?.mimeType === 'image/gif' && typeof r?.imagemBase64 === 'string' ? Buffer.from(r.imagemBase64, 'base64') : null;
      if (!bytes?.length || bytes.length > GIF_MAX_BYTES || bytes.toString('ascii', 0, 3) !== 'GIF') {
        this.log.warn(`o DMS Graph respondeu fora do formato em ${FERRAMENTA_ANIMAR_IMAGEM}`);
        return falhou('fora-do-formato');
      }
      return { ok: true, bytes };
    } catch (e: any) {
      const motivo = motivoDaImagem(e);
      if (motivo === 'ligacao-desfeita') {
        await this.graph.marcarDesligadaPeloGraph(tenantId, lig.id).catch((erro: any) => this.log.warn(`não marquei a ligação desfeita: ${String(erro?.code ?? erro?.message).slice(0, 80)}`));
      }
      this.log.warn(`${FERRAMENTA_ANIMAR_IMAGEM} não fez o GIF (${motivo}${e instanceof ErroMcp ? `, ${e.tipo}` : ''})`);
      return falhou(motivo);
    }
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
      // Só com o Graph 0.10.0 ou mais novo a ferramenta aparece: antes do deploy dele, a tela simplesmente não oferece o GIF.
      const ferramentas: any[] = Array.isArray(r?.ferramentas) ? r.ferramentas : [];
      const podeAnimar = ferramentas.some((x) => x?.nome === FERRAMENTA_ANIMAR_IMAGEM && x?.pode === true);
      return { ok: true, podeCriar: concedida('imagens.criar'), podeEditar: concedida('imagens.editar'), podeAnimar, franquia: { usados: f.usados, total: f.total } };
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
