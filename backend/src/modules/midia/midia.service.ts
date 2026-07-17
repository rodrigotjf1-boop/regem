import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';

// Tipo mínimo do arquivo entregue pelo Multer (evita depender de @types/multer).
export interface UploadedFileLike {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB (alinhado ao limite do FileInterceptor)

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

// Segmento de URL das imagens servidas localmente (modo offline/edge).
const LOCAL_PREFIX = '/api/v1/publico/midia/';
// tenant = uuid; arquivo = uuid.ext — trava caminho (sem "..", sem barras extras).
const TENANT_RE = /^[0-9a-fA-F-]{36}$/;
const ARQUIVO_RE = /^[0-9a-fA-F-]{36}\.(jpg|png|webp|gif)$/;

// Detecta o tipo REAL da imagem pelos magic bytes (não confia no mimetype do
// cliente, que é forjável). Retorna o mime canônico ou null se não for imagem.
function detectarImagem(buf: Buffer): string | null {
  if (!buf || buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  )
    return 'image/png';
  // GIF: "GIF87a" / "GIF89a"
  if (buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  // WebP: "RIFF"....(tam)...."WEBP"
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  return null;
}

@Injectable()
export class MidiaService {
  private cfg() {
    const url = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_KEY ?? '';
    const bucket = process.env.SUPABASE_BUCKET ?? 'midia';
    return { url, key, bucket };
  }

  async upload(tenantId: string, file?: UploadedFileLike) {
    if (!file) throw new BadRequestException('Arquivo ausente.');

    if (file.size > MAX_BYTES) {
      throw new BadRequestException('Imagem maior que o limite de 8 MB.');
    }
    // Confia no CONTEÚDO (magic bytes), não no mimetype enviado pelo cliente.
    const tipoReal = detectarImagem(file.buffer);
    if (!tipoReal) {
      throw new BadRequestException(
        'Arquivo não é uma imagem válida. Use JPG, PNG, WEBP ou GIF.',
      );
    }
    const ext = MIME_EXT[tipoReal];

    const { url, key, bucket } = this.cfg();
    // Sem Supabase configurado (modo local/edge offline) → grava em disco local e
    // serve pela própria API. Na nuvem as chaves existem, então nunca cai aqui.
    if (!url || !key) {
      return this.uploadLocal(tenantId, file, ext, tipoReal);
    }

    // Caminho isolado por tenant, nome opaco para não vazar o original.
    const path = `${tenantId}/${randomUUID()}.${ext}`;
    const endpoint = `${url}/storage/v1/object/${bucket}/${path}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': tipoReal,
        'cache-control': '3600',
        'x-upsert': 'true',
      },
      // Uint8Array é um BodyInit válido (Buffer, apesar de ser um, não tipa).
      body: new Uint8Array(file.buffer),
    });

    if (!res.ok) {
      const detalhe = await res.text().catch(() => '');
      throw new ServiceUnavailableException(
        `Falha ao enviar mídia (${res.status}). ${detalhe}`.trim(),
      );
    }

    // Bucket público → URL direta e estável.
    const publicUrl = `${url}/storage/v1/object/public/${bucket}/${path}`;
    return { url: publicUrl, path, mime: tipoReal, tamanho: file.size };
  }

  // ---- Storage local em disco (modo offline/edge, sem Supabase) ----

  // Pasta raiz das mídias locais. Configurável (edge aponta p/ um caminho estável),
  // padrão = <cwd>/uploads (ex.: backend/uploads em dev). Fora do git (.gitignore).
  private localDir(): string {
    return resolve(process.env.MIDIA_DIR ?? join(process.cwd(), 'uploads'));
  }

  // Base pública das URLs locais. Padrão aponta p/ esta própria API (PORT do .env);
  // no edge, defina MIDIA_PUBLIC_URL com o host/porta acessível na LAN.
  private localBase(): string {
    const b = process.env.MIDIA_PUBLIC_URL?.replace(/\/$/, '');
    if (b) return b;
    return `http://localhost:${process.env.PORT ?? 3000}${LOCAL_PREFIX.slice(0, -1)}`;
  }

  private async uploadLocal(
    tenantId: string,
    file: UploadedFileLike,
    ext: string,
    mime: string,
  ) {
    const nome = `${randomUUID()}.${ext}`;
    const dir = join(this.localDir(), tenantId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, nome), file.buffer);
    const path = `${tenantId}/${nome}`;
    return { url: `${this.localBase()}/${path}`, path, mime, tamanho: file.size };
  }

  // Lê uma imagem local para a rota pública de servir. Valida tenant/arquivo contra
  // path traversal (só uuid + extensão de imagem). 404 se não existir.
  async lerLocal(
    tenant: string,
    arquivo: string,
  ): Promise<{ buffer: Buffer; mime: string }> {
    if (!TENANT_RE.test(tenant) || !ARQUIVO_RE.test(arquivo)) {
      throw new NotFoundException('Mídia não encontrada.');
    }
    const alvo = join(this.localDir(), tenant, arquivo);
    // Defesa extra: o caminho resolvido tem que ficar dentro da pasta raiz.
    if (!resolve(alvo).startsWith(this.localDir())) {
      throw new NotFoundException('Mídia não encontrada.');
    }
    const buffer = await fs.readFile(alvo).catch(() => {
      throw new NotFoundException('Mídia não encontrada.');
    });
    const ext = arquivo.split('.').pop() ?? '';
    return { buffer, mime: EXT_MIME[ext] ?? 'application/octet-stream' };
  }

  // Apaga um objeto do storage a partir da sua URL pública (rotina de expurgo LGPD).
  async remover(publicUrl: string): Promise<boolean> {
    if (!publicUrl) return false;

    // Mídia local: URL contém o prefixo de servir → apaga o arquivo do disco.
    const li = publicUrl.indexOf(LOCAL_PREFIX);
    if (li >= 0) {
      const rel = publicUrl.slice(li + LOCAL_PREFIX.length); // tenant/arquivo
      const [tenant, arquivo] = rel.split('/');
      if (!tenant || !arquivo || !TENANT_RE.test(tenant) || !ARQUIVO_RE.test(arquivo)) {
        return false;
      }
      return fs
        .unlink(join(this.localDir(), tenant, arquivo))
        .then(() => true)
        .catch(() => false);
    }

    const { url, key, bucket } = this.cfg();
    if (!url || !key) return false;
    const marcador = `/storage/v1/object/public/${bucket}/`;
    const idx = publicUrl.indexOf(marcador);
    if (idx < 0) return false;
    const path = publicUrl.slice(idx + marcador.length);
    const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${key}`, apikey: key },
    });
    return res.ok;
  }
}
