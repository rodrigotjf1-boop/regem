'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Copy, PauseCircle, PlayCircle, HelpCircle, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';
import { KebabMenu } from '@/components/ui/kebab-menu';
import { selectCls } from '@/components/produtos/types';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';

/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */

const TIPO_LABEL: Record<string, string> = {
  simples: 'Produto simples',
  ficha: 'Preparado (ficha técnica)',
  insumo: 'Insumo comprado pronto',
};
const brl = (v: any) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Opções reutilizáveis do catálogo (Fase 2): produto simples / preparado c/ ficha /
// insumo. Reaproveitadas pelos complementos (ligação vem na Fase 3).
export function OpcoesCard() {
  const [opcoes, setOpcoes] = useState<any[]>([]);
  const [fichas, setFichas] = useState<any[]>([]);
  const [itens, setItens] = useState<any[]>([]);
  const [complementos, setComplementos] = useState<any[]>([]); // p/ "onde é usado"
  const [editar, setEditar] = useState<any>(null); // objeto opção ou {} para novo
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('todas'); // todas | em_uso | sem_uso | valor(ordena)
  const [sel, setSel] = useState<Set<string>>(new Set()); // seleção em massa
  const [bulkValor, setBulkValor] = useState(''); // novo preço de custo em massa
  const [aplicando, setAplicando] = useState(false);

  const carregar = useCallback(async () => {
    const [o, f, i, c] = await Promise.all([
      api.opcoesCatalogo().catch(() => []),
      api.fichasLista().catch(() => []),
      api.estoqueItens().catch(() => []),
      api.complementosCatalogo().catch(() => []),
    ]);
    setOpcoes(o as any[]);
    setFichas(f as any[]);
    setItens(i as any[]);
    setComplementos(c as any[]);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  // Complementos que usam esta opção (ligação por opcaoId nos itens do complemento).
  const usosDe = (o: any) =>
    complementos.filter((c) => (c.itens ?? []).some((i: any) => i.opcaoId === o.id)).map((c) => c.nome);

  const filtradas = opcoes
    .filter((o) => o.nome.toLowerCase().includes(busca.trim().toLowerCase()))
    .filter((o) => (filtro === 'em_uso' ? usosDe(o).length > 0 : filtro === 'sem_uso' ? usosDe(o).length === 0 : true))
    .sort((a, b) => (filtro === 'valor' ? Number(b.precoCusto ?? 0) - Number(a.precoCusto ?? 0) : 0));

  // Seleção em massa (opera sobre as filtradas).
  const idsFiltrados = filtradas.map((o) => o.id);
  const todasSel = idsFiltrados.length > 0 && idsFiltrados.every((id) => sel.has(id));
  const toggleSel = (id: string) =>
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleTodas = () =>
    setSel((s) => { const n = new Set(s); if (todasSel) idsFiltrados.forEach((id) => n.delete(id)); else idsFiltrados.forEach((id) => n.add(id)); return n; });
  const limparSel = () => setSel(new Set());

  async function toggleEsgotado(o: any) {
    try {
      await api.atualizarOpcaoCatalogo(o.id, { ...o, esgotado: !o.esgotado });
      await carregar();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro'); }
  }
  async function duplicar(o: any) {
    try {
      await api.criarOpcaoCatalogo({
        nome: `${o.nome} (cópia)`,
        tipo: o.tipo,
        precoCusto: o.precoCusto != null ? Number(o.precoCusto) : undefined,
        imagemRef: o.imagemRef || undefined,
        fichaId: o.fichaId || undefined,
        itemId: o.itemId || undefined,
      });
      toast.success('Opção duplicada.');
      await carregar();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro ao duplicar'); }
  }
  function ondeUsado(o: any) {
    const nomes = usosDe(o);
    if (!nomes.length) { toast.info?.(`"${o.nome}" ainda não é usada em nenhum complemento.`); return; }
    toast.info?.(`"${o.nome}" usada em: ${nomes.join(', ')}`);
  }
  async function excluir(o: any) {
    if (!confirm(`Excluir a opção "${o.nome}"?`)) return;
    try { await api.excluirOpcaoCatalogo(o.id); toast.success('Opção excluída.'); await carregar(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Erro'); }
  }
  const idsSelecionados = () => opcoes.filter((o) => sel.has(o.id)).map((o) => o.id);
  // Massa: UMA requisição (o backend faz um único UPDATE + rematerializa 1× cada
  // complemento afetado). Nada de excluir 1-a-1.
  async function excluirSel() {
    const ids = idsSelecionados();
    if (!ids.length) return;
    if (!confirm(`Excluir ${ids.length} opção(ões) selecionada(s)? Não dá pra desfazer.`)) return;
    setAplicando(true);
    try {
      const r: any = await api.excluirOpcoesMassa(ids);
      toast.success(`${r?.excluidas ?? ids.length} opção(ões) excluída(s).`);
      limparSel(); await carregar();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro ao excluir'); }
    finally { setAplicando(false); }
  }
  async function aplicarValorSel() {
    const ids = idsSelecionados();
    if (!ids.length) return;
    const v = Number(String(bulkValor).replace(',', '.'));
    if (!Number.isFinite(v) || v < 0) { toast.error('Informe um preço de custo válido.'); return; }
    setAplicando(true);
    try {
      const r: any = await api.precoCustoOpcoesMassa(ids, v);
      toast.success(`Preço de custo aplicado a ${r?.atualizadas ?? ids.length} opção(ões).`);
      setBulkValor(''); limparSel(); await carregar();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro ao aplicar'); }
    finally { setAplicando(false); }
  }

  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-sm font-bold">Opções</h2>
        <span className="font-mono text-xs text-muted-foreground">{opcoes.length}</span>
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar opção…" className="h-8 w-40" />
        <select aria-label="Filtro" value={filtro} onChange={(e) => setFiltro(e.target.value)}
          className="h-8 rounded-md border border-input bg-card px-2 text-xs">
          <option value="todas">Todas</option>
          <option value="em_uso">Em uso (algum complemento)</option>
          <option value="sem_uso">Sem uso</option>
          <option value="valor">Ordenar por valor</option>
        </select>
        <Button type="button" size="sm" className="ml-auto" onClick={() => setEditar({})}>＋ Nova opção</Button>
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">Item reutilizável (bebida, adicional, acompanhamento…). Depois é usado nos complementos/etapas dos produtos.</p>

      {/* Barra de ações em massa (aparece com seleção) */}
      {sel.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2 text-xs">
          <span className="font-semibold">{sel.size} selecionada(s)</span>
          <button type="button" onClick={limparSel} className="text-muted-foreground underline">limpar</button>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Input type="number" inputMode="decimal" value={bulkValor} onChange={(e) => setBulkValor(e.target.value)} placeholder="preço de custo" className="h-8 w-28" />
            <Button type="button" size="sm" variant="outline" disabled={aplicando} onClick={aplicarValorSel}>Aplicar preço</Button>
            <button type="button" disabled={aplicando} onClick={excluirSel} className="rounded-md border border-destructive/50 px-2.5 py-1.5 font-semibold text-destructive disabled:opacity-40">Excluir</button>
          </div>
        </div>
      )}

      {filtradas.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{opcoes.length === 0 ? 'Nenhuma opção ainda.' : 'Nada encontrado.'}</p>
      ) : (
        <>
        <label className="mb-1.5 flex w-fit items-center gap-1.5 text-[11px] text-muted-foreground">
          <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={todasSel} onChange={toggleTodas} />
          Selecionar todas ({filtradas.length})
        </label>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {filtradas.map((o) => {
            const usos = usosDe(o);
            return (
              <li key={o.id} className={`flex items-center gap-2.5 rounded-lg border bg-card p-2 ${o.ativo === false ? 'opacity-50' : ''} ${sel.has(o.id) ? 'border-primary bg-primary/5' : 'border-border'}`}>
                <input type="checkbox" className="h-4 w-4 flex-none accent-primary" checked={sel.has(o.id)} onChange={() => toggleSel(o.id)} aria-label={`Selecionar ${o.nome}`} />
                {o.imagemRef ? (
                  <img src={o.imagemRef} alt={o.nome} className="h-9 w-9 flex-none rounded-md object-cover" />
                ) : (
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-md bg-secondary text-sm text-muted-foreground">🍽</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{o.nome} {o.esgotado && <span className="rounded bg-destructive/10 px-1 text-[10px] font-bold text-destructive">esgotado</span>}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{TIPO_LABEL[o.tipo] ?? o.tipo}{o.fichaNome ? ` · ${o.fichaNome}` : o.itemNome ? ` · ${o.itemNome}` : ''} · custo {brl(o.precoCusto)}</p>
                  {usos.length > 0 && (
                    <p className="truncate text-[10px] text-muted-foreground">Usado {usos.length}×: {usos.join(', ')}</p>
                  )}
                </div>
                <KebabMenu
                  label={`Ações de ${o.nome}`}
                  items={[
                    { label: 'Editar', icon: <Pencil className="h-4 w-4" />, onClick: () => setEditar(o) },
                    o.esgotado
                      ? { label: 'Repor (voltar)', icon: <PlayCircle className="h-4 w-4" />, onClick: () => toggleEsgotado(o) }
                      : { label: 'Em falta', icon: <PauseCircle className="h-4 w-4" />, onClick: () => toggleEsgotado(o) },
                    { label: 'Duplicar', icon: <Copy className="h-4 w-4" />, onClick: () => duplicar(o) },
                    { label: 'Onde é usado?', icon: <HelpCircle className="h-4 w-4" />, onClick: () => ondeUsado(o) },
                    { label: 'Excluir', icon: <Trash2 className="h-4 w-4" />, onClick: () => excluir(o), destructive: true },
                  ]}
                />
              </li>
            );
          })}
        </ul>
        </>
      )}

      {editar && (
        <OpcaoModal opcao={editar} fichas={fichas} itens={itens} onFechar={() => setEditar(null)} onSalvo={async () => { setEditar(null); await carregar(); }} />
      )}
    </Card>
  );
}

function OpcaoModal({ opcao, fichas, itens, onFechar, onSalvo }: { opcao: any; fichas: any[]; itens: any[]; onFechar: () => void; onSalvo: () => void }) {
  const novo = !opcao?.id;
  const [f, setF] = useState<any>({
    nome: opcao.nome ?? '',
    codigoPdv: opcao.codigoPdv ?? '',
    precoCusto: opcao.precoCusto ?? '',
    descricao: opcao.descricao ?? '',
    imagemRef: opcao.imagemRef ?? '',
    tipo: opcao.tipo ?? 'simples',
    fichaId: opcao.fichaId ?? '',
    itemId: opcao.itemId ?? '',
    controlaEstoque: opcao.controlaEstoque ?? false,
    padraoMarcada: opcao.padraoMarcada ?? false,
    ativo: opcao.ativo ?? true,
    esgotado: opcao.esgotado ?? false,
  });
  const up = (patch: any) => setF((s: any) => ({ ...s, ...patch }));
  const [busy, setBusy] = useState(false);
  // Destino de produção próprio (mig 127). Vazio = herda do produto.
  const [equipamentos, setEquipamentos] = useState<any[]>([]);
  const [destinos, setDestinos] = useState<string[]>([]);
  useEffect(() => {
    api.equipamentos().then((e: any) => setEquipamentos(Array.isArray(e) ? e : [])).catch(() => setEquipamentos([]));
    if (!novo) api.opcaoDestinos(opcao.id).then((d: any) => setDestinos(Array.isArray(d) ? d : [])).catch(() => {});
  }, [novo, opcao.id]);

  async function salvar() {
    if (!f.nome.trim()) { toast.error('Informe o nome.'); return; }
    setBusy(true);
    try {
      const salva: any = novo ? await api.criarOpcaoCatalogo(f) : await api.atualizarOpcaoCatalogo(opcao.id, f);
      const id = novo ? salva?.id : opcao.id;
      if (id) await api.setOpcaoDestinos(id, destinos).catch(() => {});
      toast.success('Opção salva.');
      onSalvo();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro ao salvar'); }
    finally { setBusy(false); }
  }

  const Toggle = ({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) => (
    <label className="flex items-center justify-between rounded-lg border border-border p-2.5 text-sm">
      <span>{label}</span>
      <button type="button" onClick={() => set(!on)} className={`relative h-6 w-11 flex-none rounded-full transition-colors ${on ? 'bg-primary' : 'bg-muted'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  );

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" onClick={onFechar}>
      <Card className="max-h-[88vh] w-full max-w-md overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-display text-base font-bold">{novo ? 'Nova opção' : 'Editar opção'}</h3>
          <button type="button" onClick={onFechar} className="ml-auto text-sm text-muted-foreground hover:underline">Fechar ✕</button>
        </div>

        <div className="flex gap-3">
          <ImageUpload value={f.imagemRef} onChange={(url) => up({ imagemRef: url })} id={`opcao-${opcao.id ?? 'novo'}`} alt="Opção" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="space-y-1"><Label className="text-xs">Nome</Label><Input value={f.nome} onChange={(e) => up({ nome: e.target.value })} placeholder="Ex.: Coca-Cola Lata" /></div>
            <div className="flex gap-2">
              <div className="flex-1 space-y-1"><Label className="text-xs">Código PDV</Label><Input value={f.codigoPdv} onChange={(e) => up({ codigoPdv: e.target.value })} placeholder="opcional" /></div>
              <div className="flex-1 space-y-1"><Label className="text-xs">Preço de custo</Label><Input type="number" value={f.precoCusto} onChange={(e) => up({ precoCusto: e.target.value })} placeholder="0,00" /></div>
            </div>
          </div>
        </div>

        <div className="mt-3 space-y-1">
          <Label className="text-xs">Descrição</Label>
          <textarea value={f.descricao} onChange={(e) => up({ descricao: e.target.value })} placeholder="Opcional" className="min-h-[48px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm" />
        </div>

        <div className="mt-3 space-y-1">
          <Label className="text-xs">Tipo</Label>
          <select className={selectCls} aria-label="Tipo da opção" value={f.tipo} onChange={(e) => up({ tipo: e.target.value })}>
            <option value="simples">Produto simples</option>
            <option value="ficha">Preparado na loja (ficha técnica)</option>
            <option value="insumo">Insumo comprado pronto</option>
          </select>
        </div>

        {f.tipo === 'ficha' && (
          <div className="mt-2 space-y-1">
            <Label className="text-xs">Ficha técnica</Label>
            <select className={selectCls} aria-label="Ficha técnica" value={f.fichaId} onChange={(e) => up({ fichaId: e.target.value })}>
              <option value="">Escolha a ficha…</option>
              {fichas.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          </div>
        )}
        {f.tipo === 'insumo' && (
          <div className="mt-2 space-y-1">
            <Label className="text-xs">Insumo (estoque)</Label>
            <select className={selectCls} aria-label="Insumo" value={f.itemId} onChange={(e) => up({ itemId: e.target.value })}>
              <option value="">Escolha o insumo…</option>
              {itens.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          </div>
        )}

        {/* Sem código PDV a opção vira INFORMATIVA (observação de preparo). */}
        <div className={`mt-3 rounded-lg border p-2.5 text-xs ${(f.codigoPdv ?? '').trim() ? 'border-border text-muted-foreground' : 'border-primary/40 bg-primary/5 text-foreground'}`}>
          {(f.codigoPdv ?? '').trim() ? (
            <>Com <strong>código PDV</strong>: opção real — soma preço e pode baixar estoque.</>
          ) : (
            <>Sem <strong>código PDV</strong>: opção <strong>informativa</strong> (observação tipo &quot;ponto de carne&quot; ou &quot;talheres&quot;) — não soma preço nem baixa estoque; vai como nota para o preparo.</>
          )}
        </div>

        <div className="mt-3 space-y-2">
          <Toggle label="Controlar estoque desta opção" on={f.controlaEstoque} set={(v) => up({ controlaEstoque: v })} />
          <Toggle label="Já vem marcada por padrão" on={f.padraoMarcada} set={(v) => up({ padraoMarcada: v })} />
          <Toggle label="Visível no catálogo" on={f.ativo} set={(v) => up({ ativo: v })} />
          <Toggle label="Esgotado (pausar)" on={f.esgotado} set={(v) => up({ esgotado: v })} />
        </div>

        {/* Destino de produção próprio — vazio herda o do produto (mig 127). */}
        {equipamentos.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Destino de produção desta opção</Label>
            <p className="text-[11px] text-muted-foreground">
              Sem seleção, herda o destino do produto. Marque para mandar esta opção a um KDS/impressora específico.
            </p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {equipamentos.map((e: any) => (
                <label key={e.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-xs ${destinos.includes(e.id) ? 'border-primary bg-primary/10' : 'border-border'}`}>
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-primary"
                    checked={destinos.includes(e.id)}
                    onChange={() => setDestinos((s) => (s.includes(e.id) ? s.filter((x) => x !== e.id) : [...s, e.id]))}
                  />
                  <span className="flex-1">{e.nome}</span>
                  <span className="rounded bg-secondary px-1 py-0.5 text-[10px] text-muted-foreground">
                    {e.tipo === 'impressora' ? 'impressora' : 'KDS'}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <Button type="button" className="mt-5 w-full" disabled={busy} onClick={salvar}>{busy ? 'Salvando…' : 'Salvar opção'}</Button>
      </Card>
    </div>
  );
}
