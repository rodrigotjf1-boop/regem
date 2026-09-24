// R5 — nome do arquivo em cache no servidor local.
//
// A rota que serve mídia local já existe e valida o nome contra path traversal com
// `ARQUIVO_RE = /^[0-9a-fA-F-]{36}\.(jpg|png|webp|gif)$/` — ou seja, o nome PRECISA ter
// formato de UUID. Por isso o hash da URL de origem é formatado como UUID: o mesmo
// endereço remoto sempre vira o mesmo arquivo local (cache estável, sem tabela, sem
// índice) e o nome passa na validação que já protege a rota.
import { createHash } from 'node:crypto';

export type ExtImagem = 'jpg' | 'png' | 'webp' | 'gif';

const MIME_EXT: Record<string, ExtImagem> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const EXTENSOES: ExtImagem[] = ['jpg', 'png', 'webp', 'gif'];

/** Extensão canônica a partir do mime detectado pelos magic bytes. */
export function extDoMime(mime: string | null): ExtImagem | null {
  return mime ? MIME_EXT[mime] ?? null : null;
}

/** `<uuid do hash da url>.<ext>` — determinístico e aceito pela rota de servir. */
export function nomeCache(url: string, ext: ExtImagem): string {
  const h = createHash('sha256').update(url).digest('hex').slice(0, 32);
  const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  return `${uuid}.${ext}`;
}

/** Já é uma URL servida por este servidor? Então não há o que baixar. */
export function ehLocal(url: string): boolean {
  return url.includes('/publico/midia/');
}
