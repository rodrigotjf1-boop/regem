'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { selectCls } from '@/components/produtos/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Direcionamento do catálogo: escolhe produtos (com filtros) de um lado, os
// KDS/impressoras do outro, confirma — e a lista de baixo mostra o que já está
// direcionado. Sem destino, o produto herda o padrão do setor (ou a impressora
// única da loja).
type Tipo = 'todos' | 'preparado' | 'pronto';

export default function DirecionamentoPage() {
  const [produtos, setProdutos] = useState<any[]>([]);
  const [equipamentos, setEquipamentos] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // filtros
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [setor, setSetor] = useState('');
  const [tipo, setTipo] = useState<Tipo>('todos');
  const [somenteSemDestino, setSomenteSemDestino] = useState(false);

  // seleção
  const [selProdutos, setSelProdutos] = useState<string[]>([]);
  const [selDestinos, setSelDestinos] = useState<string[]>([]);
  const [modo, setModo] = useState<'substituir' | 'adicionar'>('substituir');

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [p, e]: any = await Promise.all([api.direcionamento(), api.equipamentos()]);
      setProdutos(Array.isArray(p) ? p : []);
      setEquipamentos(
        (Array.isArray(e) ? e : []).filter((x: any) => x.tipo === 'kds' || x.tipo === 'impressora'),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao carregar');
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const categorias = useMemo(
    () =>
      [...new Map(produtos.filter((p) => p.categoriaId).map((p) => [p.categoriaId, p.categoriaNome])).entries()]
        .map(([id, nome]) => ({ id, nome }))
        .sort((a, b) => String(a.nome).localeCompare(String(b.nome))),
    [produtos],
  );
  const setores = useMemo(
    () =>
      [...new Map(produtos.filter((p) => p.setorProducaoId).map((p) => [p.setorProducaoId, p.setorNome])).entries()]
        .map(([id, nome]) => ({ id, nome }))
        .sort((a, b) => String(a.nome).localeCompare(String(b.nome))),
    [produtos],
  );

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return produtos.filter((p) => {
      if (q && !String(p.nome).toLowerCase().includes(q)) return false;
      if (categoria && p.categoriaId !== categoria) return false;
      if (setor && p.setorProducaoId !== setor) return false;
      if (tipo === 'preparado' && !p.preparado) return false;
      if (tipo === 'pronto' && p.preparado) return false;
      if (somenteSemDestino && (p.destinos ?? []).length > 0) return false;
      return true;
    });
  }, [produtos, busca, categoria, setor, tipo, somenteSemDestino]);

  const direcionados = useMemo(
    () => produtos.filter((p) => (p.destinos ?? []).length > 0),
    [produtos],
  );
  const nomeEquip = useCallback(
    (id: string) => equipamentos.find((e) => e.id === id)?.nome ?? '—',
    [equipamentos],
  );
  const tipoEquip = useCallback(
    (id: string) => equipamentos.find((e) => e.id === id)?.tipo ?? 'kds',
    [equipamentos],
  );

  const toggle = (lista: string[], set: (v: string[]) => void, id: string) =>
    set(lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);

  // Impressoras de cupom (via do cliente). Uma impressora só tem "alvo" imprimível
  // se: rede → tem IP; local → tem nome no Windows.
  const impressoras = useMemo(
    () => equipamentos.filter((e) => e.tipo === 'impressora'),
    [equipamentos],
  );
  const alvoValido = (e: any) => (e.conexao === 'local' ? !!e.dispositivo : !!e.host);

  async function toggleCupom(imp: any) {
    try {
      const novo: any = await api.setPapeisImpressora(imp.id, { fazCupom: !imp.fazCupom });
      setEquipamentos((prev) => prev.map((e) => (e.id === imp.id ? { ...e, ...novo } : e)));
      toast.success(
        novo.fazCupom
          ? `${imp.nome} passa a imprimir o cupom do cliente.`
          : `${imp.nome} não imprime mais o cupom.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar');
    }
  }

  async function confirmar() {
    if (!selProdutos.length) return toast.error('Selecione ao menos um produto.');
    setSalvando(true);
    try {
      await api.setDirecionamento(selProdutos, selDestinos, modo);
      toast.success(
        selDestinos.length
          ? `${selProdutos.length} produto(s) direcionado(s).`
          : `${selProdutos.length} produto(s) sem destino (voltam a herdar o padrão).`,
      );
      setSelProdutos([]);
      setSelDestinos([]);
      await carregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Shell eyebrow="Produção" title="Direcionamento do catálogo">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Define para onde cada produto vai ao ser vendido: um ou mais <strong>KDS</strong> e/ou{' '}
          <strong>impressoras</strong>. Produto sem destino herda o padrão do setor — e se a loja tiver
          só uma impressora, ela é usada automaticamente.
        </p>

        {/* Cupom do cliente — via com valores (reimprimir/aceitar pedido) */}
        <Card className="p-3">
          <h2 className="font-display font-semibold">Cupom do cliente</h2>
          <p className="mb-2 mt-0.5 text-sm text-muted-foreground">
            Marque quais impressoras imprimem o <strong>cupom do cliente</strong> (via com valores). É o que sai
            ao aceitar/reimprimir um pedido. A produção da cozinha usa o direcionamento por produto abaixo.
          </p>
          {impressoras.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma impressora cadastrada. Cadastre em Cadastros → Equipamentos.
            </p>
          ) : (
            <div className="space-y-1">
              {impressoras.map((e) => {
                const ok = alvoValido(e);
                return (
                  <label
                    key={e.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm ${e.fazCupom ? 'border-primary bg-primary/10' : 'border-border'}`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={!!e.fazCupom}
                      onChange={() => toggleCupom(e)}
                    />
                    <span className="flex-1">
                      {e.nome}
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {e.conexao === 'local' ? `USB: ${e.dispositivo || '(sem nome)'}` : `rede: ${e.host || '(sem IP)'}`}
                      </span>
                    </span>
                    {e.fazCupom && !ok && (
                      <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">
                        sem alvo — configure em Equipamentos
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </Card>

        {/* Filtros */}
        <Card className="p-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1">
              <Label className="text-xs">Buscar</Label>
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="nome do produto…" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Categoria</Label>
              <select className={selectCls} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                <option value="">todas</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Setor</Label>
              <select className={selectCls} value={setor} onChange={(e) => setSetor(e.target.value)}>
                <option value="">todos</option>
                {setores.map((s) => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <select className={selectCls} value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
                <option value="todos">todos</option>
                <option value="preparado">produzidos (com ficha)</option>
                <option value="pronto">prontos (sem ficha)</option>
              </select>
            </div>
            <label className="flex items-end gap-2 pb-1 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={somenteSemDestino}
                onChange={(e) => setSomenteSemDestino(e.target.checked)}
              />
              <span>só sem destino</span>
            </label>
          </div>
        </Card>

        {/* Dois lados: produtos × destinos */}
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-display font-semibold">Produtos ({filtrados.length})</h2>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setSelProdutos(filtrados.map((p) => p.id))}
                >
                  selecionar todos
                </button>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:underline"
                  onClick={() => setSelProdutos([])}
                >
                  limpar
                </button>
              </div>
            </div>
            <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
              {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}
              {!carregando && !filtrados.length && (
                <p className="text-sm text-muted-foreground">Nenhum produto com esses filtros.</p>
              )}
              {filtrados.map((p) => (
                <label
                  key={p.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm ${selProdutos.includes(p.id) ? 'border-primary bg-primary/10' : 'border-border'}`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={selProdutos.includes(p.id)}
                    onChange={() => toggle(selProdutos, setSelProdutos, p.id)}
                  />
                  <span className="flex-1">
                    {p.nome}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {p.categoriaNome ?? 'sem categoria'}
                      {p.setorNome ? ` · ${p.setorNome}` : ''}
                    </span>
                  </span>
                  {p.preparado && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">ficha</span>
                  )}
                  {(p.destinos ?? []).length > 0 && (
                    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                      {p.destinos.length} destino(s)
                    </span>
                  )}
                </label>
              ))}
            </div>
          </Card>

          <Card className="p-3">
            <h2 className="mb-2 font-display font-semibold">Destinos ({equipamentos.length})</h2>
            {!equipamentos.length ? (
              <p className="text-sm text-muted-foreground">
                Nenhum KDS/impressora cadastrado. Cadastre em Cadastros → Equipamentos.
              </p>
            ) : (
              <div className="max-h-[300px] space-y-1 overflow-y-auto pr-1">
                {equipamentos.map((e) => (
                  <label
                    key={e.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm ${selDestinos.includes(e.id) ? 'border-primary bg-primary/10' : 'border-border'}`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={selDestinos.includes(e.id)}
                      onChange={() => toggle(selDestinos, setSelDestinos, e.id)}
                    />
                    <span className="flex-1">{e.nome}</span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {e.tipo === 'impressora' ? 'impressora' : 'KDS'}
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <div className="flex gap-1.5">
                {(['substituir', 'adicionar'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={modo === m}
                    onClick={() => setModo(m)}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium ${modo === m ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'}`}
                  >
                    {m === 'substituir' ? 'Substituir destinos' : 'Adicionar aos atuais'}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {selProdutos.length} produto(s) · {selDestinos.length} destino(s).
                {!selDestinos.length && ' Sem destino marcado, os produtos voltam a herdar o padrão.'}
              </p>
              <Button type="button" className="w-full" onClick={confirmar} disabled={salvando || !selProdutos.length}>
                {salvando ? 'Salvando…' : 'Confirmar direcionamento'}
              </Button>
            </div>
          </Card>
        </div>

        {/* Já direcionados */}
        <Card className="p-3">
          <h2 className="mb-2 font-display font-semibold">Já direcionados ({direcionados.length})</h2>
          {!direcionados.length ? (
            <p className="text-sm text-muted-foreground">
              Nenhum produto com destino próprio — todos herdam o padrão do setor.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <caption className="sr-only">Produtos e seus destinos de produção</caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-1.5 pr-2 font-medium">Produto</th>
                    <th className="py-1.5 pr-2 font-medium">Categoria</th>
                    <th className="py-1.5 font-medium">Destinos</th>
                  </tr>
                </thead>
                <tbody>
                  {direcionados.map((p) => (
                    <tr key={p.id} className="border-b border-border/60">
                      <td className="py-1.5 pr-2">{p.nome}</td>
                      <td className="py-1.5 pr-2 text-muted-foreground">{p.categoriaNome ?? '—'}</td>
                      <td className="py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {(p.destinos ?? []).map((d: string) => (
                            <span
                              key={d}
                              className="rounded bg-secondary px-1.5 py-0.5 text-[11px]"
                            >
                              {nomeEquip(d)}
                              <span className="ml-1 text-muted-foreground">
                                {tipoEquip(d) === 'impressora' ? '🖨️' : '🖥️'}
                              </span>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </Shell>
  );
}
