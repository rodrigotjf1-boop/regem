'use client';

import { useEffect, useId, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Gaveta } from '@/components/ui/sobreposto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "AO TOCAR NO BANNER, ABRE" (fase B3 do `docs/plano-clube-e-banner.md`; protótipo `mockups/regem-clube-banner.html`,
// gaveta `g-link`; mig 482 para o período). O destino mora no `link` do banner, como antes (`item:`, `category:`,
// `coupon:`, `https://`), com os novos: a página de vagas da loja, o Clube e as páginas do Regem. O servidor confere de novo.

export type Opcao = { id: string; nome: string };
type Grupo = 'item' | 'category' | 'coupon' | 'vagas' | 'clube' | 'regem' | 'url' | '';

const GRUPOS: { k: Grupo; rotulo: string }[] = [
  { k: 'item', rotulo: 'Um produto' },
  { k: 'category', rotulo: 'Uma categoria' },
  { k: 'coupon', rotulo: 'Um cupom' },
  { k: 'vagas', rotulo: 'Vagas da loja' },
  { k: 'clube', rotulo: 'O Clube' },
  { k: 'regem', rotulo: 'Página do Regem' },
  { k: 'url', rotulo: 'Link externo' },
  { k: '', rotulo: 'Nada' },
];
const DO_CLUBE = [
  { v: 'clube:premios', rotulo: 'Meus prêmios e o álbum' },
  { v: 'clube:regras', rotulo: 'Regras do clube' },
];
const DO_REGEM = [
  { v: 'regem:avaliar', rotulo: 'Avaliar o último pedido' },
  { v: 'regem:regras', rotulo: 'Regras do clube' },
];

function ler(link: string): { grupo: Grupo; valor: string } {
  const s = link ?? '';
  if (s.startsWith('item:')) return { grupo: 'item', valor: s.slice(5) };
  if (s.startsWith('category:')) return { grupo: 'category', valor: s.slice(9) };
  if (s.startsWith('coupon:')) return { grupo: 'coupon', valor: s.slice(7) };
  if (s === 'vagas') return { grupo: 'vagas', valor: '' };
  if (s.startsWith('clube:')) return { grupo: 'clube', valor: s };
  if (s.startsWith('regem:')) return { grupo: 'regem', valor: s };
  if (/^https?:\/\//.test(s)) return { grupo: 'url', valor: s };
  return { grupo: '', valor: '' };
}

/** O resumo da linha do banner: "Ao tocar, abre: X-Bacon duplo · até 30/11". */
export function resumoDoDestino(b: { link?: string | null; apareceDe?: string | null; apareceAte?: string | null }, prods: Opcao[], cats: Opcao[]) {
  const { grupo, valor } = ler(b.link ?? '');
  const nome =
    grupo === 'item'
      ? prods.find((p) => p.id === valor)?.nome ?? 'um produto'
      : grupo === 'category'
        ? cats.find((c) => c.id === valor)?.nome ?? 'uma categoria'
        : grupo === 'coupon'
          ? `o cupom ${valor}`
          : grupo === 'vagas'
            ? 'Vagas da loja'
            : grupo === 'clube'
              ? DO_CLUBE.find((x) => x.v === valor)?.rotulo ?? 'o Clube'
              : grupo === 'regem'
                ? DO_REGEM.find((x) => x.v === valor)?.rotulo ?? 'uma página do Regem'
                : grupo === 'url'
                  ? valor.replace(/^https?:\/\//, '')
                  : 'nada';
  const dia = (s?: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
  const de = dia(b.apareceDe);
  const ate = dia(b.apareceAte);
  const periodo = de && ate ? ` · de ${de} até ${ate}` : de ? ` · a partir de ${de}` : ate ? ` · até ${ate}` : '';
  return { nome, periodo };
}

export function GavetaDestinoDoBanner({
  banner,
  numero,
  prods,
  cats,
  salvando,
  aoFechar,
  aoSalvar,
}: {
  banner: { link?: string | null; apareceDe?: string | null; apareceAte?: string | null };
  numero: number;
  prods: Opcao[];
  cats: Opcao[];
  salvando: boolean;
  aoFechar: () => void;
  aoSalvar: (patch: { link: string; apareceDe: string | null; apareceAte: string | null }) => void;
}) {
  const id = useId();
  const inicio = ler(banner.link ?? '');
  const [grupo, setGrupo] = useState<Grupo>(inicio.grupo);
  const [valor, setValor] = useState(inicio.valor);
  const [de, setDe] = useState(String(banner.apareceDe ?? '').slice(0, 10));
  const [ate, setAte] = useState(String(banner.apareceAte ?? '').slice(0, 10));
  const [erro, setErro] = useState('');
  const [cupons, setCupons] = useState<string[] | null>(null);
  useEffect(() => {
    api
      .cardapioCupons()
      .then((r: any) => setCupons((Array.isArray(r) ? r : []).filter((c: any) => c?.ativo !== false && c?.codigo).map((c: any) => String(c.codigo))))
      .catch(() => setCupons([]));
  }, []);

  function escolher(g: Grupo) {
    setGrupo(g);
    setErro('');
    setValor(g === 'clube' ? DO_CLUBE[0].v : g === 'regem' ? DO_REGEM[0].v : g === inicio.grupo ? inicio.valor : '');
  }

  function salvar() {
    const v = valor.trim();
    let link = '';
    if (grupo === 'item' || grupo === 'category' || grupo === 'coupon') {
      if (!v) return setErro(grupo === 'item' ? 'Escolha o produto.' : grupo === 'category' ? 'Escolha a categoria.' : 'Escolha o cupom.');
      link = `${grupo}:${v}`;
    } else if (grupo === 'vagas') link = 'vagas';
    else if (grupo === 'clube' || grupo === 'regem') link = v;
    else if (grupo === 'url') {
      if (!/^https:\/\/\S+\.\S+/.test(v)) return setErro('O link externo precisa começar com https:// (ex.: https://sualoja.com.br).');
      link = v;
    }
    if (de && ate && ate < de) return setErro('"Até" vem antes de "aparece de".');
    aoSalvar({ link, apareceDe: de || null, apareceAte: ate || null });
  }

  const sel = 'flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm';
  return (
    <Gaveta
      titulo={`Ao tocar no banner ${numero}, abre`}
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <span id={`${id}-destino`} className="text-sm font-semibold">Destino</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`${id}-destino`}>
            {GRUPOS.map((g) => (
              <Button key={g.k || 'nada'} type="button" size="sm" variant={grupo === g.k ? 'default' : 'outline'} aria-pressed={grupo === g.k} onClick={() => escolher(g.k)}>
                {g.rotulo}
              </Button>
            ))}
          </div>
        </div>

        {grupo === 'item' && (
          <div className="space-y-1">
            <label htmlFor={`${id}-prod`} className="text-sm font-semibold">Produto</label>
            <select id={`${id}-prod`} className={sel} value={valor} onChange={(e) => setValor(e.target.value)}>
              <option value="">Escolha o produto…</option>
              {prods.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
        )}
        {grupo === 'category' && (
          <div className="space-y-1">
            <label htmlFor={`${id}-cat`} className="text-sm font-semibold">Categoria</label>
            <select id={`${id}-cat`} className={sel} value={valor} onChange={(e) => setValor(e.target.value)}>
              <option value="">Escolha a categoria…</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
        )}
        {grupo === 'coupon' && (
          <div className="space-y-1">
            <label htmlFor={`${id}-cup`} className="text-sm font-semibold">Cupom</label>
            <select id={`${id}-cup`} className={sel} value={valor} onChange={(e) => setValor(e.target.value)} disabled={cupons === null}>
              <option value="">{cupons === null ? 'Carregando os cupons…' : 'Escolha o cupom…'}</option>
              {valor && cupons && !cupons.includes(valor) && <option value={valor}>{valor}</option>}
              {(cupons ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <a href="/cupons" className="inline-block text-xs font-semibold underline underline-offset-2">＋ cadastrar novo cupom</a>
          </div>
        )}
        {grupo === 'vagas' && (
          <p className="text-sm text-secondary-foreground">Abre a página de vagas da loja (a mesma do QR), com as vagas abertas. Sem a página ligada, o banner não abre nada.</p>
        )}
        {grupo === 'clube' && (
          <div className="space-y-1">
            <label htmlFor={`${id}-clu`} className="text-sm font-semibold">Parte do Clube</label>
            <select id={`${id}-clu`} className={sel} value={valor} onChange={(e) => setValor(e.target.value)}>
              {DO_CLUBE.map((x) => <option key={x.v} value={x.v}>{x.rotulo}</option>)}
            </select>
          </div>
        )}
        {grupo === 'regem' && (
          <div className="space-y-1">
            <label htmlFor={`${id}-reg`} className="text-sm font-semibold">Página</label>
            <select id={`${id}-reg`} className={sel} value={valor} onChange={(e) => setValor(e.target.value)}>
              {DO_REGEM.map((x) => <option key={x.v} value={x.v}>{x.rotulo}</option>)}
            </select>
            <p className="text-xs text-secondary-foreground">"Avaliar o último pedido" abre Sua conta › Pedidos, onde o cliente acompanha e avalia.</p>
          </div>
        )}
        {grupo === 'url' && (
          <div className="space-y-1">
            <label htmlFor={`${id}-url`} className="text-sm font-semibold">Endereço</label>
            <Input id={`${id}-url`} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="https://" inputMode="url" />
            <p className="text-xs text-secondary-foreground">Só endereços com https. Abre em outra aba.</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor={`${id}-de`} className="text-sm font-semibold">Aparece de</label>
            <input id={`${id}-de`} type="date" className={sel} value={de} onChange={(e) => setDe(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-ate`} className="text-sm font-semibold">até</label>
            <input id={`${id}-ate`} type="date" className={sel} value={ate} onChange={(e) => setAte(e.target.value)} />
            <p className="text-xs text-secondary-foreground">Vazio: fica até alguém tirar.</p>
          </div>
        </div>
        {erro && <p role="alert" className="text-sm font-semibold text-destructive">{erro}</p>}
      </div>
    </Gaveta>
  );
}
