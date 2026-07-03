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

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

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

    const ext = MIME_EXT[file.mimetype];
    if (!ext) {
      throw new BadRequestException(
        'Formato não suportado. Use JPG, PNG, WEBP ou GIF.',
      );
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException('Arquivo maior que o limite de 5 MB.');
    }

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
        'Content-Type': file.mimetype,
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
    return { url: publicUrl, path, mime: file.mimetype, tamanho: file.size };
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
