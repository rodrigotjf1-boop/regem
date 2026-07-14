import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

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
    if (!url || !key) {
      throw new ServiceUnavailableException(
        'Upload de mídia não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_KEY no serviço da API.',
      );
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

  // Apaga um objeto do storage a partir da sua URL pública (rotina de expurgo LGPD).
  async remover(publicUrl: string): Promise<boolean> {
    const { url, key, bucket } = this.cfg();
    if (!url || !key || !publicUrl) return false;
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
