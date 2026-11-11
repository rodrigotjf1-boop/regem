'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { brl } from '@/components/ui/lista';
import { precoDigitado, precoDoComplementoDigitado, precoNoCampo } from '@/lib/catalogo-gestao';

// O PREÇO NO LUGAR (Gestão do catálogo › Produtos e preços; protótipo `regem-conciliacao-ifood.html`): o lápis abre o
// campo ali mesmo — Enter salva, Esc cancela, o erro aparece no campo e o foco volta ao lápis. Sem a permissão de
// mudar o preço, só o valor. `permiteVazio` = o preço do iFood (vazio: "o Regem não mexe no preço de lá").
export function PrecoNoLugar({
  valor,
  qual,
  nome,
  permiteVazio = false,
  zeroVale = false,
  podeEditar,
  aoSalvar,
}: {
  valor: unknown;
  /** "de venda" / "no iFood": entra no rótulo do leitor de tela. */
  qual: string;
  nome: string;
  permiteVazio?: boolean;
  /** O preço do complemento: zero vale (grátis). */
  zeroVale?: boolean;
  podeEditar: boolean;
  /** Grava; erro = `throw` com a mensagem (fica no campo). */
  aoSalvar: (valor: string | null) => Promise<void>;
}) {
  const id = useId();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const lapis = useRef<HTMLButtonElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const voltarFoco = useRef(false);
  const tem = valor !== null && valor !== undefined && String(valor).trim() !== '';

  useEffect(() => {
    if (editando) campo.current?.select();
    else if (voltarFoco.current) {
      voltarFoco.current = false;
      lapis.current?.focus();
    }
  }, [editando]);

  if (!podeEditar)
    return <span className="font-mono text-sm font-semibold">{tem ? brl(valor) : <span className="font-sans text-xs font-normal text-secondary-foreground">sem preço</span>}</span>;

  const fechar = () => {
    voltarFoco.current = true;
    setErro('');
    setEditando(false);
  };
  async function salvar() {
    const r = zeroVale ? precoDoComplementoDigitado(texto, permiteVazio) : precoDigitado(texto, permiteVazio);
    if ('erro' in r) {
      setErro(r.erro);
      campo.current?.focus();
      return;
    }
    setSalvando(true);
    try {
      await aoSalvar(r.valor);
      fechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar o preço.');
      campo.current?.focus();
    } finally {
      setSalvando(false);
    }
  }

  if (!editando)
    return (
      <button
        ref={lapis}
        type="button"
        onClick={() => {
          setTexto(precoNoCampo(valor));
          setErro('');
          setEditando(true);
        }}
        aria-label={`Mudar o preço ${qual} de ${nome} (${tem ? brl(valor) : 'sem preço'})`}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-transparent px-2 font-mono text-sm font-semibold hover:border-input hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {tem ? brl(valor) : <span className="font-sans text-xs font-semibold underline decoration-primary decoration-2 underline-offset-2">＋ pôr o preço</span>}
        <Pencil className="h-3.5 w-3.5 text-secondary-foreground" aria-hidden="true" />
      </button>
    );

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
      <label htmlFor={id} className="sr-only">
        Preço {qual}: {nome}
      </label>
      <Input
        ref={campo}
        id={id}
        inputMode="decimal"
        autoComplete="off"
        placeholder="Ex.: 39,90"
        value={texto}
        disabled={salvando}
        onChange={(e) => {
          setTexto(e.target.value);
          if (erro) setErro('');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void salvar();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            fechar();
          }
        }}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${id}-erro` : undefined}
        className="h-10 w-28 font-mono"
      />
      <Button type="button" size="sm" disabled={salvando} onClick={() => void salvar()}>
        {salvando ? 'Salvando…' : 'Salvar'}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={salvando} onClick={fechar}>
        Cancelar
      </Button>
      {erro && (
        <span id={`${id}-erro`} role="alert" className="w-full text-xs font-semibold text-destructive">
          {erro}
        </span>
      )}
    </span>
  );
}
