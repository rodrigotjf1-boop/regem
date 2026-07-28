'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, podeVerFinanceiro } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SkeletonList } from '@/components/ui/skeleton';
import { ImageUpload } from '@/components/ui/image-upload';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Um produto está "pausado" quando não aparece em nenhum canal de venda.
const pausado = (p: any) => !p.disponivelBalcao && !p.disponivelCardapio;

// Gestão rápida do catálogo (Delivery → Gestão do catálogo): pausar, editar o
// preço (só com ver_financeiro) e trocar a foto. O cadastro COMPLETO fica em
// Cadastros → Cardápio (/produtos).
export default function CatalogoPage() {
  const router = useRouter();
  const [produtos, setProdutos] = useState<any[] | null>(null);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [busca, setBusca] = useState('');
  const [catSel, setCatSel] = useState('');
  const [verFin, setVerFin] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [ps, cs] = await Promise.all([api.produtos(), api.produtoCategorias()]);
      setProdutos(ps as any[]);
      setCategorias(cs as any[]);
    } catch {
      setProdutos([]);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    setVerFin(podeVerFinanceiro());
    carregar();
  }, [carregar, router]);

  // Aplica a mudança no servidor e no estado local (otimista).
  async function patch(id: string, body: Record<string, unknown>) {
    setProdutos((l) => (l ?? []).map((p) => (p.id === id ? { ...p, ...body } : p)));
    try {
      await api.atualizarProduto(id, body);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
      carregar(); // reverte para o estado real
    }
  }

  async function alternarPausa(p: any) {
    const ativar = pausado(p);
    await patch(p.id, { disponivelBalcao: ativar, disponivelCardapio: ativar });
    toast.success(ativar ? 'Produto retomado.' : 'Produto pausado.');
  }

  const filtrados = (produtos ?? []).filter((p) => {
    const okCat = !catSel || p.categoriaId === catSel;
    const okBusca = !busca.trim() || (p.nome ?? '').toLowerCase().includes(busca.trim().toLowerCase());
    return okCat && okBusca;
  });

  return (
    <Shell eyebrow="Delivery" title="Gestão do catálogo">
      <p className="mb-4 text-sm text-muted-foreground">
        Gestão rápida: pause, ajuste o preço e troque a foto. O cadastro completo fica em{' '}
        <button type="button" className="font-semibold text-primary underline" onClick={() => router.push('/produtos')}>
          Cadastros → Cardápio
        </button>
        .
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar produto…"
          className="h-10 max-w-xs"
        />
        <select
          aria-label="Filtrar por categoria"
          value={catSel}
          onChange={(e) => setCatSel(e.target.value)}
          className="h-10 rounded-md border border-input bg-card px-3 text-sm"
        >
          <option value="">Todas as categorias</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </select>
      </div>

      {produtos === null ? (
        <SkeletonList rows={4} />
      ) : filtrados.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum produto no filtro.</p>
      ) : (
        <Card className="divide-y divide-border p-0">
          {filtrados.map((p) => (
            <ProdutoRow key={p.id} p={p} verFin={verFin} onPatch={patch} onPausa={alternarPausa} />
          ))}
        </Card>
      )}
    </Shell>
  );
}

function ProdutoRow({
  p,
  verFin,
  onPatch,
  onPausa,
}: {
  p: any;
  verFin: boolean;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  onPausa: (p: any) => void;
}) {
  const [preco, setPreco] = useState(p.precoVenda != null ? String(p.precoVenda) : '');
  const off = pausado(p);

  // Salva o preço só quando muda de fato (evita PATCH à toa a cada blur).
  function salvarPreco() {
    const novo = Number(String(preco).replace(',', '.'));
    if (!Number.isFinite(novo) || novo < 0) return;
    if (novo === Number(p.precoVenda)) return;
    onPatch(p.id, { precoVenda: novo });
    toast.success('Preço atualizado.');
  }

  return (
    <div className={`flex flex-wrap items-center gap-3 px-4 py-3 ${off ? 'opacity-60' : ''}`}>
      <ImageUpload compact value={p.imagemRef || undefined} onChange={(url) => onPatch(p.id, { imagemRef: url })} alt={p.nome || 'produto'} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {p.nome}
          {off && <span className="ml-2 rounded-md bg-warn/15 px-2 py-0.5 text-[11px] font-bold text-warn">pausado</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">{p.categoriaNome ?? 'sem categoria'}</p>
      </div>
      {verFin ? (
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">R$</span>
          <Input
            type="number"
            inputMode="decimal"
            value={preco}
            onChange={(e) => setPreco(e.target.value)}
            onBlur={salvarPreco}
            className="h-9 w-24"
            aria-label={`Preço de ${p.nome}`}
          />
        </div>
      ) : (
        <span className="font-mono text-sm font-semibold">{brl(Number(p.precoVenda))}</span>
      )}
      <Button
        type="button"
        size="sm"
        variant={off ? 'default' : 'outline'}
        onClick={() => onPausa(p)}
      >
        {off ? 'Retomar' : 'Pausar'}
      </Button>
    </div>
  );
}
