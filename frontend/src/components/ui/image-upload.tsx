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
  compact = false,
}: {
  value?: string;
  onChange: (url: string) => void;
  id?: string;
  alt?: string;
  // capture: abre a CÂMERA direto (sem galeria) — para comprovação tirada na hora.
  // No Android/iOS o navegador pede permissão e não oferece a galeria.
  capture?: boolean;
  // compact: só a miniatura clicável (sem botão/texto) — para listas/linhas.
  compact?: boolean;
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

  const inputFile = (
    <input
      ref={inputRef}
      id={id}
      type="file"
      aria-label={capture ? 'Tirar foto com a câmera' : 'Enviar imagem'}
      accept={capture ? 'image/*' : 'image/png,image/jpeg,image/webp,image/gif'}
      capture={capture ? 'environment' : undefined}
      className="hidden"
      onChange={selecionar}
    />
  );

  // Modo compacto: só a miniatura clicável (para listas). Sem botão nem texto.
  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={enviando}
          aria-label="Trocar imagem"
          title="Trocar imagem"
          className="group relative h-14 w-14 flex-none overflow-hidden rounded-lg border border-border"
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={alt} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center bg-muted/40 text-muted-foreground">
              <ImagePlus className="h-5 w-5" />
            </div>
          )}
          <div className="absolute inset-0 grid place-items-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          </div>
        </button>
        {inputFile}
      </>
    );
  }

  // Padrão do projeto: só o quadrado clicável com "+" — sem botão de texto.
  // Clicar (vazio ou preenchido) abre o seletor; o "×" no canto remove.
  return (
    <div className="space-y-1.5">
      <div className="relative h-28 w-28">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={enviando}
          aria-label={value ? 'Trocar imagem' : capture ? 'Tirar foto' : 'Adicionar imagem'}
          title={value ? 'Trocar imagem' : 'Adicionar imagem'}
          className={cn(
            'group relative grid h-full w-full place-items-center overflow-hidden rounded-xl border bg-muted/40 text-muted-foreground transition-colors hover:border-primary hover:text-primary',
            value ? 'border-border' : 'border-dashed border-border',
            enviando && 'opacity-70',
          )}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={alt} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-1">
              <ImagePlus className="h-6 w-6" />
              <span className="text-[11px] font-medium">{capture ? 'Tirar foto' : 'Adicionar'}</span>
            </span>
          )}
          {/* Overlay: spinner enviando; ou "trocar" ao passar o mouse numa imagem já enviada. */}
          <span
            className={cn(
              'absolute inset-0 grid place-items-center bg-black/45 text-white transition-opacity',
              enviando ? 'opacity-100' : value ? 'opacity-0 group-hover:opacity-100' : 'hidden',
            )}
          >
            {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
          </span>
        </button>

        {value && !enviando && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Remover imagem"
            title="Remover imagem"
            className="absolute -right-2 -top-2 z-10 grid h-6 w-6 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow transition-colors hover:border-destructive hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {inputFile}

      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <p className="text-xs text-muted-foreground">
        {capture ? 'Foto tirada na hora, pela câmera.' : 'JPG, PNG, WEBP ou GIF · até 5 MB.'}
      </p>
    </div>
  );
}
