'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { api } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Peças da conversa do WhatsApp usadas pela caixa (Delivery › WhatsApp) e pelo caso da central (Atendimento).

/** Mesmo cliente? Tolera o 55 e o 9º dígito comparando o final do número. */
export const mesmoNumero = (a?: string, b?: string) => {
  const x = String(a ?? '').replace(/\D/g, '');
  const y = String(b ?? '').replace(/\D/g, '');
  if (!x || !y) return false;
  return x === y || x.endsWith(y) || y.endsWith(x) || x.slice(-8) === y.slice(-8);
};

// Miniatura de mídia no chat (igual ao WhatsApp): por padrão não baixa — mostra
// um cartão clicável; com "carregar fotos" ligado, baixa sozinha. Cache por id
// evita rebaixar ao rolar. `jid` = primeiro jid da conversa; a mídia é buscada
// sob demanda pelo backend (Evolution getBase64FromMediaMessage).
const midiaCache = new Map<string, string>();
export function MidiaMsg({ m, jid, auto }: { m: any; jid: string; auto: boolean }) {
  const [src, setSrc] = useState<string | null>(midiaCache.get(m.id) ?? null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(async () => {
    if (src || carregando) return;
    setCarregando(true);
    try {
      const r: any = await api.whatsappMidia(m.midiaKey?.id ?? m.id, jid, !!m.fromMe);
      if (r?.dataUrl) {
        midiaCache.set(m.id, r.dataUrl);
        setSrc(r.dataUrl);
      } else setErro(true);
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }, [src, carregando, m, jid]);

  useEffect(() => {
    if (auto && m.midia === 'imagem' && !src) carregar();
  }, [auto, m.midia, src, carregar]);

  // Vídeo/áudio/documento: não tem miniatura — mostra só o rótulo (texto já vem).
  if (m.midia !== 'imagem' && m.midia !== 'figurinha') {
    return <span className="whitespace-pre-wrap break-words">{m.texto || '[mídia]'}</span>;
  }
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="imagem" className="max-h-52 max-w-full rounded-md" />;
  }
  return (
    <button
      type="button"
      onClick={carregar}
      disabled={carregando}
      className="flex items-center gap-2 rounded-md border border-current/20 px-3 py-2 text-xs"
      title="Carregar imagem"
    >
      <FileText className="h-4 w-4" />
      {erro ? 'Não consegui carregar' : carregando ? 'Carregando…' : `📷 ${m.midia === 'figurinha' ? 'Figurinha' : 'Toque para ver a imagem'}`}
    </button>
  );
}
