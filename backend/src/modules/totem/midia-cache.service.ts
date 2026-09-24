import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { fetchExterno } from '../../common/fetch-externo';
import { detectarImagem } from '../midia/midia.service';
import { EXTENSOES, ehLocal, extDoMime, nomeCache } from './midia-cache';

// R5 — as fotos do cardápio no SERVIDOR local.
//
// Sem isto, o cardápio do totem vem do edge mas as imagens continuam vindo do Supabase:
// cada totem precisaria de internet própria, que é exatamente o que o desenho evita. Pior,
// o cache do app é preguiçoso (só baixa o que entra na tela) — não serve de offline.
//
// Estratégia: o snapshot aponta para a cópia local QUANDO ELA JÁ EXISTE; enquanto não
// existe, mantém a URL remota e baixa em segundo plano. Assim nunca há foto quebrada —
// o cardápio migra para a LAN sozinho, ciclo a ciclo.
const TAMANHO_MAX = 8 * 1024 * 1024; // 8 MB por imagem
const BAIXANDO_MAX = 4; // downloads simultâneos (não afogar o link da loja)

@Injectable()
export class TotemMidiaCache {
  private readonly logger = new Logger('TotemMidia');
  /** url remota → nome do arquivo local já confirmado em disco. */
  private readonly conhecidos = new Map<string, string>();
  /** urls já na fila ou baixando (evita baixar a mesma foto duas vezes). */
  private readonly emCurso = new Set<string>();
  /** fila de cópias pendentes — drena sozinha até acabar. */
  private readonly fila: { tenantId: string; url: string }[] = [];
  private baixando = 0;

  private dir(tenantId: string): string {
    const raiz = resolve(process.env.MIDIA_DIR ?? join(process.cwd(), 'uploads'));
    return join(raiz, tenantId);
  }

  /**
   * URL que vai no snapshot. Local se a cópia existe; senão a remota (e agenda a cópia).
   * NUNCA lança: foto é enfeite, não pode derrubar o cardápio.
   */
  async resolver(tenantId: string, url: string | null, base: string): Promise<string | null> {
    if (!url || ehLocal(url)) return url ?? null;
    try {
      const nome = await this.nomeSeExiste(tenantId, url);
      if (nome) return `${base}/${tenantId}/${nome}`;
      this.agendar(tenantId, url);
      return url;
    } catch (e: any) {
      this.logger.warn(`mídia ${url}: ${e?.message ?? e}`);
      return url;
    }
  }

  /** Já está em disco? Procura pelas extensões possíveis (o nome vem do hash da URL). */
  private async nomeSeExiste(tenantId: string, url: string): Promise<string | null> {
    const memo = this.conhecidos.get(url);
    if (memo) return memo;
    for (const ext of EXTENSOES) {
      const nome = nomeCache(url, ext);
      const ok = await fs
        .stat(join(this.dir(tenantId), nome))
        .then((s) => s.isFile())
        .catch(() => false);
      if (ok) {
        this.conhecidos.set(url, nome);
        return nome;
      }
    }
    return null;
  }

  /**
   * Põe na fila e deixa drenar. FILA, não "descarta se ocupado": o snapshot só é
   * remontado quando o cardápio muda, e o totem em dia recebe `{atualizado:false}` —
   * se as fotos excedentes fossem descartadas aqui, elas nunca mais seriam agendadas e
   * o cardápio ficaria para sempre metade local, metade remoto.
   */
  private agendar(tenantId: string, url: string): void {
    if (this.emCurso.has(url)) return;
    this.emCurso.add(url);
    this.fila.push({ tenantId, url });
    void this.drenar();
  }

  /** Consome a fila respeitando o teto de simultâneas. Erro vira log, nunca exceção. */
  private async drenar(): Promise<void> {
    while (this.baixando < BAIXANDO_MAX && this.fila.length) {
      const item = this.fila.shift()!;
      this.baixando++;
      void this.baixar(item.tenantId, item.url)
        .catch((e: any) =>
          this.logger.warn(`não consegui copiar ${item.url}: ${e?.message ?? e}`),
        )
        .finally(() => {
          this.emCurso.delete(item.url);
          this.baixando--;
          void this.drenar();
        });
    }
  }

  private async baixar(tenantId: string, url: string): Promise<void> {
    const res = await fetchExterno(url);
    if (!res.ok) throw new Error(`origem respondeu ${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > TAMANHO_MAX) {
      throw new Error(`imagem grande demais (${Math.round(buf.byteLength / 1024)} KB)`);
    }
    // Tipo REAL pelos magic bytes — a mesma checagem do upload. Content-Type e extensão
    // da URL são palpite de quem serviu; aqui o que vale é o conteúdo.
    const ext = extDoMime(detectarImagem(buf));
    if (!ext) throw new Error('conteúdo não é imagem reconhecida');
    const nome = nomeCache(url, ext);
    const dir = this.dir(tenantId);
    await fs.mkdir(dir, { recursive: true });
    // Grava ao lado e renomeia: um corte de energia no meio nunca deixa foto pela metade.
    const tmp = join(dir, `${nome}.parcial`);
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, join(dir, nome));
    this.conhecidos.set(url, nome);
    this.logger.log(`mídia copiada para o servidor: ${nome} (${Math.round(buf.byteLength / 1024)} KB)`);
  }
}
