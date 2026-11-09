/* eslint-disable @typescript-eslint/no-explicit-any */
import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import { ehServidorLocal } from '../../common/modo';
import { buscarUrlPublica } from '../../common/ssrf-guard';
import {
  AnaliseDaMarcacao,
  MAX_BYTES_DA_IMAGEM,
  TipoDaMarcacao,
  hostDaMeta,
  instrucoesDaAnalise,
  lerAnalise,
  textoDaAnalise,
  tipoDaImagem,
} from './marcacoes';

// A IA DAS MARCAÇÕES (mig 387): baixa a FOTO da marcação do CDN da Meta e pede ao modelo da DISTRIBUIÇÃO (a mesma chave
// do copiloto — `ANTHROPIC_API_KEY`; o modelo em `MARCACOES_MODELO`, padrão o rápido) o que ele viu, o clima e a resposta.
// A imagem vai só nesta chamada e é descartada (a Meta proíbe guardar a mídia do story); nada do que a pessoa postou vai
// para o registro. Vídeo não vai (a API não lê vídeo): quem chama manda a CAPA do reels quando a Meta dá.

const MODELO_PADRAO = 'claude-haiku-5-5';
const PRAZO_MS = 15_000;

export type ImagemDaMarcacao = { base64: string; tipo: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' };

export class IaDasMarcacoes {
  private readonly logger = new Logger('InstagramMarcacoesIA');
  private cliente?: Anthropic;

  /** A distribuição ligou a IA nesta nuvem (a chave existe e não foi desligada à mão)? */
  disponivel(): boolean {
    return !ehServidorLocal() && !!String(process.env.ANTHROPIC_API_KEY ?? '').trim() && process.env.MARCACOES_IA_DESLIGADA !== '1';
  }

  modelo(): string {
    return String(process.env.MARCACOES_MODELO ?? '').trim() || MODELO_PADRAO;
  }

  /**
   * A foto do endereço da Meta, em memória: só do CDN da Meta (HTTPS, cada salto conferido — V68), só imagem e até 5 MB.
   * Vídeo, outro host, erro ou grande demais → null (quem chama usa o agradecimento padrão). Nunca lança.
   * `INSTAGRAM_MIDIA_TESTE` (só nos testes) aponta para o CDN de mentira local — só aquele host passa sem a trava de rede.
   */
  async baixar(url: string | null | undefined): Promise<ImagemDaMarcacao | null> {
    if (!url) return null;
    try {
      const teste = String(process.env.INSTAGRAM_MIDIA_TESTE ?? '').trim();
      let res: Response | null = null;
      // Nos testes: o endereço HTTPS do aviso aponta para o host do CDN de mentira, que responde em HTTP local.
      if (teste && mesmoHost(url, teste)) res = await fetch(noTeste(url, teste), { redirect: 'manual', signal: AbortSignal.timeout(PRAZO_MS) });
      else if (hostDaMeta(url)) res = await buscarUrlPublica(url, { signal: AbortSignal.timeout(PRAZO_MS) });
      else return null;
      if (!res || !res.ok) {
        await res?.body?.cancel().catch(() => undefined);
        return null;
      }
      const tipo = tipoDaImagem(res.headers.get('content-type'));
      const tamanho = Number(res.headers.get('content-length'));
      if (!tipo || (Number.isFinite(tamanho) && tamanho > MAX_BYTES_DA_IMAGEM)) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > MAX_BYTES_DA_IMAGEM) return null;
      return { base64: buf.toString('base64'), tipo };
    } catch (e: any) {
      this.logger.warn(`a imagem da marcação não baixou: ${String(e?.name ?? e?.message ?? e).slice(0, 120)}`);
      return null;
    }
  }

  /**
   * O que a IA viu, o clima e a resposta — ou null (IA indisponível, recusou, não respondeu ou respondeu fora do formato).
   * Nunca lança: a marcação segue com o agradecimento padrão ou sem sugestão.
   */
  async analisar(o: {
    tipo: TipoDaMarcacao;
    loja: string | null;
    jeito: string;
    usuario: string | null;
    texto: string | null;
    imagem: ImagemDaMarcacao | null;
  }): Promise<AnaliseDaMarcacao | null> {
    if (!this.disponivel()) return null;
    const system = instrucoesDaAnalise({ loja: o.loja, tipo: o.tipo, jeito: o.jeito, temImagem: !!o.imagem });
    const conteudo: any[] = [];
    if (o.imagem) conteudo.push({ type: 'image', source: { type: 'base64', media_type: o.imagem.tipo, data: o.imagem.base64 } });
    conteudo.push({ type: 'text', text: textoDaAnalise({ usuario: o.usuario, texto: o.texto }) });
    try {
      return lerAnalise(await this.chamarModelo(system, conteudo));
    } catch (e: any) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
        this.logger.error(`a chave do modelo foi recusada (${e.status}): confira ANTHROPIC_API_KEY na nuvem`);
      else if (e instanceof Anthropic.APIError) this.logger.warn(`o modelo não analisou a marcação (${e.status ?? 'sem status'})`);
      else this.logger.warn(`o modelo não analisou a marcação: ${String(e?.message ?? e).slice(0, 160)}`);
      return null;
    }
  }

  /** A chamada ao modelo (à parte: o teste a troca). Recusa = texto vazio. */
  protected async chamarModelo(system: string, conteudo: any[]): Promise<string> {
    this.cliente ??= new Anthropic({ apiKey: String(process.env.ANTHROPIC_API_KEY ?? '').trim(), timeout: 20_000, maxRetries: 1 });
    const r = await this.cliente.messages.create({ model: this.modelo(), max_tokens: 400, system, messages: [{ role: 'user', content: conteudo }] });
    if (r.stop_reason === 'refusal') return '';
    const partes: string[] = [];
    for (const b of r.content) if (b.type === 'text') partes.push(b.text);
    return partes.join('\n').trim();
  }
}

function mesmoHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

/** O mesmo caminho no CDN de mentira (o protocolo dele). */
function noTeste(url: string, teste: string): string {
  const u = new URL(url);
  return new URL(`${u.pathname}${u.search}`, teste).toString();
}
