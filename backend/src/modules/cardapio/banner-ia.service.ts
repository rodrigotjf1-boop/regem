import { BadRequestException, ConflictException, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { AuthUser } from '../../auth/auth-user';
import { ehServidorLocal } from '../../common/modo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { GraphImagemService } from '../graph/graph-imagem.service';
import { fraseDaImagem, type MotivoDaImagem } from '../graph/graph.regras';
import { IaEmpresaService } from '../ia/ia-empresa.service';
import { MidiaService, detectarImagem } from '../midia/midia.service';
import {
  FOTO_DO_BANNER_MAX_BYTES,
  INSTRUCAO_DE_MELHORAR,
  PROPORCAO_DO_BANNER,
  type SituacaoDoBanner,
  conferirPedidoDoBanner,
  lerPedidoDoBanner,
  pedidoMelhorado,
  situacaoDoBanner,
  textoParaAImagem,
} from './banner-ia.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

const RECURSO_DE_MELHORAR = 'banner-melhorar-pedido';
const MODELO_DE_MELHORAR = 'claude-haiku-5-5';
const PRAZO_DE_MELHORAR_MS = 15_000;
const TIPOS_DA_FOTO = ['image/jpeg', 'image/png', 'image/webp'];

export type BannerCriado =
  | { ok: true; imagemRef: string; franquia: { usados: number; total: number } | null }
  | { ok: false; motivo: MotivoDaImagem; mensagem: string };

export type BannerAnimado = { ok: true; imagemAnimadaRef: string } | { ok: false; motivo: MotivoDaImagem; mensagem: string };

/**
 * O "CRIAR COM IA" DOS BANNERS (fase B2 do `docs/plano-clube-e-banner.md`; mig 485). A imagem sai do DMS Graph, pela franquia
 * de imagem da empresa (zero até a DMS liberar), e é guardada na mídia da empresa; o banner só muda quando a pessoa clica em
 * "Usar este banner" (o `PUT /cardapio/banners` de sempre). Só NUVEM. A foto e o pedido não vão para o registro nem para a
 * auditoria: só que um banner foi criado.
 */
@Injectable()
export class BannerIaService {
  private readonly log = new Logger('BannerIa');

  constructor(
    private readonly ia: IaEmpresaService,
    private readonly midia: MidiaService,
    @Optional() private readonly auditoria?: AuditoriaService,
    @Optional() private readonly graph?: GraphImagemService,
  ) {}

  /** O que a tela mostra antes do pedido: pode criar? A franquia? Pode "Melhorar o pedido"? */
  async situacao(tenantId: string): Promise<SituacaoDoBanner> {
    if (ehServidorLocal() || !this.graph) return situacaoDoBanner({ ok: false, motivo: 'desligado', mensagem: fraseDaImagem('desligado') }, false);
    const [s, podeMelhorar] = await Promise.all([this.graph.situacaoDaImagem(tenantId), this.ia.temAcesso(tenantId).catch(() => false)]);
    return situacaoDoBanner(s, podeMelhorar);
  }

  /** "Melhorar o pedido": reescreve com o modelo de texto, pela IA da empresa. Não gasta a franquia de imagem. */
  async melhorar(tenantId: string, corpo: any): Promise<{ pedido: string }> {
    const pedido = lerPedidoDoBanner(corpo?.pedido);
    if (!(await this.ia.temAcesso(tenantId).catch(() => false))) {
      throw new ConflictException('Para melhorar o pedido, a empresa precisa da chave de IA em Mister › IA e uso. Você ainda pode criar o banner com o seu texto.');
    }
    let resposta: any;
    try {
      resposta = await this.ia.pedir(tenantId, {
        recurso: RECURSO_DE_MELHORAR,
        modelo: MODELO_DE_MELHORAR,
        maxTokens: 1500,
        system: INSTRUCAO_DE_MELHORAR,
        messages: [{ role: 'user', content: `<pedido>${pedido}</pedido>` }],
        prazoMs: PRAZO_DE_MELHORAR_MS,
      });
    } catch (e: any) {
      this.log.warn(`melhorar o pedido falhou (${String(e?.status ?? e?.code ?? e?.name ?? 'erro').slice(0, 40)})`);
      throw new ServiceUnavailableException('Não deu para melhorar o pedido agora. Você pode criar o banner com o seu texto.');
    }
    const novo = resposta?.recusou || resposta?.parou === 'max_tokens' ? null : pedidoMelhorado(resposta?.texto);
    if (!novo) throw new ServiceUnavailableException('Não deu para melhorar o pedido agora. Você pode criar o banner com o seu texto.');
    return { pedido: novo };
  }

  /**
   * Cria a imagem e a guarda na mídia da empresa. Sem foto, `criar_imagem`; com foto, `editar_imagem` (ela é a referência).
   * Se guardar falhar depois de a imagem pronta, a repetição com a mesma `chave` volta do Graph sem pagar de novo.
   */
  async criar(user: AuthUser, corpo: any, foto?: { buffer?: Buffer; size?: number } | null): Promise<BannerCriado> {
    const p = conferirPedidoDoBanner(corpo);
    if (ehServidorLocal() || !this.graph) return { ok: false, motivo: 'desligado', mensagem: fraseDaImagem('desligado') };
    let tipoDaFoto: string | null = null;
    if (foto?.buffer?.length) {
      if (foto.buffer.length > FOTO_DO_BANNER_MAX_BYTES) throw new BadRequestException('A foto passa de 5 MB.');
      tipoDaFoto = detectarImagem(foto.buffer);
      if (!tipoDaFoto || !TIPOS_DA_FOTO.includes(tipoDaFoto)) throw new BadRequestException('A foto precisa ser JPG, PNG ou WebP.');
    }
    const texto = textoParaAImagem(p, !!tipoDaFoto);
    const r = tipoDaFoto
      ? await this.graph.editarImagem(user.tenantId, {
          fotos: [{ buffer: foto!.buffer!, mime: tipoDaFoto }],
          instrucao: texto,
          proporcao: PROPORCAO_DO_BANNER,
          chave: `banner:${p.chave}`,
        })
      : await this.graph.criarImagem(user.tenantId, { descricao: texto, proporcao: PROPORCAO_DO_BANNER, chave: `banner:${p.chave}` });
    if (!r.ok) return r;
    let imagemRef: string;
    try {
      imagemRef = (await this.midia.uploadBuffer(user.tenantId, r.bytes)).url;
    } catch (e: any) {
      this.log.error(`a imagem do banner foi criada e não foi guardada (${String(e?.status ?? e?.message ?? 'erro').slice(0, 60)})`);
      throw new ServiceUnavailableException('A imagem ficou pronta, mas não deu para guardar. Clique em "Criar banner" de novo: não gasta outra imagem.');
    }
    await this.auditoria
      ?.registrar({
        tenantId: user.tenantId,
        atorId: user.colaboradorId,
        atorPerfil: user.categoria,
        atorTipo: 'colaborador',
        tipo: 'cardapio',
        acao: 'criou_imagem_de_banner_com_ia',
        entidadeTipo: 'banner',
        entidadeId: p.chave,
        origem: 'painel',
        detalhe: { comFoto: !!tipoDaFoto, textoPelaIa: p.textoPelaIa },
      })
      .catch((e: any) => this.log.warn(`a auditoria do banner não foi gravada: ${String(e?.code ?? e?.message ?? e).slice(0, 80)}`));
    return { ok: true, imagemRef, franquia: r.franquia ? { usados: r.franquia.usados, total: r.franquia.total } : null };
  }

  /**
   * "Animar (GIF)": faz o GIF da imagem que já está na mídia DA EMPRESA e o guarda ao lado dela (D8, mig 487). Não usa IA nem
   * franquia. O banner só muda quando a pessoa clica em "Usar este banner"; a imagem parada continua valendo para quem pediu
   * menos movimento.
   */
  async animar(user: AuthUser, corpo: any): Promise<BannerAnimado> {
    if (ehServidorLocal() || !this.graph) return { ok: false, motivo: 'desligado', mensagem: fraseDaImagem('desligado') };
    const foto = await this.midia.lerDaEmpresa(user.tenantId, corpo?.imagemRef, FOTO_DO_BANNER_MAX_BYTES);
    if (!foto) throw new BadRequestException('Esta imagem não está na mídia da empresa.');
    const r = await this.graph.animarImagem(user.tenantId, foto);
    if (!r.ok) return r;
    let imagemAnimadaRef: string;
    try {
      imagemAnimadaRef = (await this.midia.uploadBuffer(user.tenantId, r.bytes)).url;
    } catch (e: any) {
      this.log.error(`o GIF do banner foi feito e não foi guardado (${String(e?.status ?? e?.message ?? 'erro').slice(0, 60)})`);
      throw new ServiceUnavailableException('O GIF ficou pronto, mas não deu para guardar. Clique em "Animar (GIF)" de novo.');
    }
    await this.auditoria
      ?.registrar({
        tenantId: user.tenantId,
        atorId: user.colaboradorId,
        atorPerfil: user.categoria,
        atorTipo: 'colaborador',
        tipo: 'cardapio',
        acao: 'animou_imagem_de_banner',
        entidadeTipo: 'banner',
        origem: 'painel',
        detalhe: { bytes: r.bytes.length },
      })
      .catch((e: any) => this.log.warn(`a auditoria do GIF não foi gravada: ${String(e?.code ?? e?.message ?? e).slice(0, 80)}`));
    return { ok: true, imagemAnimadaRef };
  }
}
