'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export function ImageUpload({
  value,
  onChange,
  id,
  alt = 'Imagem enviada',
  capture = false,
}: {
  value?: string;
  onChange: (url: string) => void;
  id?: string;
  alt?: string;
  // capture: abre a CÂMERA direto (sem galeria) — para comprovação tirada na hora.
  // No Android/iOS o navegador pede permissão e não oferece a galeria.
  capture?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  async function selecionar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reenviar o mesmo arquivo
    if (!file) return;
    setErro('');
    setEnviando(true);
    try {
      const res = await api.upload(file);
      onChange(res.url);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha no upload');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt={alt}
            className="h-16 w-16 rounded-lg border border-border object-cover"
          />
        ) : (
          <div className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-border bg-muted/40 text-muted-foreground">
            <ImagePlus className="h-5 w-5" />
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={enviando}
            className={cn(
              'inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:border-primary hover:text-primary',
              enviando && 'opacity-60',
            )}
          >
            {enviando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
            {enviando
              ? 'Enviando…'
              : capture
                ? value
                  ? 'Tirar outra foto'
                  : 'Tirar foto'
                : value
                  ? 'Trocar imagem'
                  : 'Enviar imagem'}
          </button>

          {value && !enviando && (
            <button
              type="button"
              onClick={() => onChange('')}
              aria-label="Remover imagem"
              className="inline-flex min-h-[40px] items-center rounded-lg border border-border bg-card px-2.5 text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        id={id}
        type="file"
        aria-label={capture ? 'Tirar foto com a câmera' : 'Enviar imagem'}
        // capture="environment" abre a câmera traseira direto (Android/iOS) e não
        // oferece galeria — comprovação tirada na hora. accept precisa ser amplo.
        accept={capture ? 'image/*' : 'image/png,image/jpeg,image/webp,image/gif'}
        capture={capture ? 'environment' : undefined}
        className="hidden"
        onChange={selecionar}
      />

      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <p className="text-xs text-muted-foreground">
        {capture ? 'Foto tirada na hora, pela câmera.' : 'JPG, PNG, WEBP ou GIF · até 5 MB.'}
      </p>
    </div>
  );
}
