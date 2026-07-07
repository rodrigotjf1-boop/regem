'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */
const selectCls = 'flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm';
const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function CardapioConfigPage() {
  const router = useRouter();
  const isGestor = ['presidente', 'gerente'].includes(getCategoria() ?? '');
  const [cfg, setCfg] = useState<any>({ ativo: false, modo: 'mesa', token: null });
  const [mesaNum, setMesaNum] = useState('');
  const [qr, setQr] = useState('');
  const [qrMesa, setQrMesa] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [bairros, setBairros] = useState<{ nome: string; taxa: string }[]>([]);
  const [cupons, setCupons] = useState<any[]>([]);
  const [novoCupom, setNovoCupom] = useState({ codigo: '', tipo: 'percentual', valor: '', minimo: '' });
  const [novoCartao, setNovoCartao] = useState('');

  const reload = useCallback(async () => {
    try {
      const [c, bs, cs] = await Promise.all([
        api.cardapioConfig(),
        api.cardapioBairros().catch(() => []),
        api.cardapioCupons().catch(() => []),
      ]);
      setCfg(c);
      setBairros((bs as any[]).map((b) => ({ nome: b.nome, taxa: String(b.taxa) })));
      setCupons(cs as any[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  async function salvarBairros() {
    try {
      await api.setCardapioBairros(bairros.filter((b) => b.nome.trim()).map((b) => ({ nome: b.nome.trim(), taxa: Number(String(b.taxa).replace(',', '.')) || 0 })));
      toast.success('Bairros salvos.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro'); }
  }
  async function addCupom() {
    if (!novoCupom.codigo.trim()) return;
    try {
      await api.criarCupom({ codigo: novoCupom.codigo.trim(), tipo: novoCupom.tipo, valor: Number(String(novoCupom.valor).replace(',', '.')) || 0, minimo: novoCupom.minimo ? Number(String(novoCupom.minimo).replace(',', '.')) : undefined });
      setNovoCupom({ codigo: '', tipo: novoCupom.tipo, valor: '', minimo: '' });
      setCupons(await api.cardapioCupons());
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro'); }
  }
  async function delCupom(id: string) {
    try { await api.removerCupom(id); setCupons(await api.cardapioCupons()); } catch { /* */ }
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
  }, [reload, router]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // Link do DELIVERY/cardápio digital = link puro (sem mesa). O cliente fecha o
  // pedido no checkout (tipo, pagamento, endereço).
  const linkDelivery = cfg.token ? `${origin}/c/${cfg.token}` : '';
  // Link/QR de MESA = com ?mesa=N (o pedido vai direto para a comanda da mesa).
  const linkMesa = cfg.token && mesaNum.trim() ? `${linkDelivery}?mesa=${mesaNum.trim()}` : '';

  useEffect(() => {
    if (!linkDelivery) { setQr(''); return; }
    QRCode.toDataURL(linkDelivery, { width: 240, margin: 1 }).then(setQr).catch(() => setQr(''));
  }, [linkDelivery]);

  useEffect(() => {
    if (!linkMesa) { setQrMesa(''); return; }
    QRCode.toDataURL(linkMesa, { width: 240, margin: 1 }).then(setQrMesa).catch(() => setQrMesa(''));
  }, [linkMesa]);

  const set = (patch: any) => setCfg((s: any) => ({ ...s, ...patch }));
  function addCartao() {
    const v = novoCartao.trim();
    if (!v) return;
    const atuais: string[] = cfg.formasCartao ?? [];
    if (!atuais.includes(v)) set({ formasCartao: [...atuais, v] });
    setNovoCartao('');
  }

  async function salvar() {
    setSalvando(true);
    try {
      setCfg(await api.setCardapioConfig({
        ativo: cfg.ativo, modo: cfg.modo, nomePublico: cfg.nomePublico,
        ramo: cfg.ramo, logoEmoji: cfg.logoEmoji, subtitulo: cfg.subtitulo, aberto: cfg.aberto,
        tempoEntregaMin: cfg.tempoEntregaMin ? Number(cfg.tempoEntregaMin) : undefined,
        pedidoMinimo: cfg.pedidoMinimo ? Number(String(cfg.pedidoMinimo).replace(',', '.')) : undefined,
        avaliacao: cfg.avaliacao ? Number(String(cfg.avaliacao).replace(',', '.')) : undefined,
        freteGratisAcima: cfg.freteGratisAcima ? Number(String(cfg.freteGratisAcima).replace(',', '.')) : undefined,
        pagamentos: cfg.pagamentos ?? [],
        formasCartao: cfg.formasCartao ?? [],
        autoKds: cfg.autoKds !== false,
        fidelidadeAtiva: cfg.fidelidadeAtiva,
        whatsapp: cfg.whatsapp,
        parcelasMax: cfg.parcelasMax ? Number(cfg.parcelasMax) : undefined,
      }));
      toast.success('Cardápio salvo.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  if (!isGestor) {
    return (
      <Shell eyebrow="Cardápio" title="Cardápio digital">
        <p className="text-sm text-muted-foreground">Acesso restrito à gerência.</p>
      </Shell>
    );
  }

  return (
    <Shell eyebrow="Cardápio · QR" title="Cardápio digital">
      <div className="max-w-2xl space-y-4">
        <Card className="space-y-4 p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={!!cfg.ativo} onChange={(e) => set({ ativo: e.target.checked })} className="h-4 w-4 accent-primary" />
            Cardápio digital ativo
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Modo</Label>
              <select aria-label="Modo do cardápio" className={selectCls} value={cfg.modo} onChange={(e) => set({ modo: e.target.value })}>
                <option value="mesa">Mesa (QR na mesa → vai para a comanda)</option>
                <option value="retirada">Retirada (pedido cai no delivery p/ aceitar)</option>
                <option value="totem">Totem (autoatendimento)</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nome público</Label>
              <Input value={cfg.nomePublico ?? ''} onChange={(e) => set({ nomePublico: e.target.value })} placeholder="Ex.: Cardápio do Bar" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ramo (tema)</Label>
              <select aria-label="Ramo" className={selectCls} value={cfg.ramo ?? 'food'} onChange={(e) => set({ ramo: e.target.value })}>
                <option value="food">🍔 Food service</option>
                <option value="varejo">🛍 Varejo</option>
                <option value="industria">🏭 Indústria</option>
                <option value="servicos">📅 Serviços</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Logo (emoji)</Label>
              <Input value={cfg.logoEmoji ?? ''} onChange={(e) => set({ logoEmoji: e.target.value })} placeholder="🍔" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Subtítulo</Label>
              <Input value={cfg.subtitulo ?? ''} onChange={(e) => set({ subtitulo: e.target.value })} placeholder="Ex.: Hamburgueria artesanal · 1,2 km" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tempo de entrega (min)</Label>
              <Input type="number" value={cfg.tempoEntregaMin ?? ''} onChange={(e) => set({ tempoEntregaMin: e.target.value })} placeholder="40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Pedido mínimo (R$)</Label>
              <Input type="number" value={cfg.pedidoMinimo ?? ''} onChange={(e) => set({ pedidoMinimo: e.target.value })} placeholder="opcional" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Frete grátis acima de (R$)</Label>
              <Input type="number" value={cfg.freteGratisAcima ?? ''} onChange={(e) => set({ freteGratisAcima: e.target.value })} placeholder="opcional" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Avaliação (0–5)</Label>
              <Input type="number" value={cfg.avaliacao ?? ''} onChange={(e) => set({ avaliacao: e.target.value })} placeholder="4.8" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">WhatsApp</Label>
              <Input value={cfg.whatsapp ?? ''} onChange={(e) => set({ whatsapp: e.target.value })} placeholder="(21) 9…" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Parcelas máx. (cartão · varejo)</Label>
              <Input type="number" value={cfg.parcelasMax ?? ''} onChange={(e) => set({ parcelasMax: e.target.value })} placeholder="ex.: 12" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={cfg.aberto ?? true} onChange={(e) => set({ aberto: e.target.checked })} className="h-4 w-4 accent-primary" />
              Loja aberta (aceitando pedidos)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!cfg.fidelidadeAtiva} onChange={(e) => set({ fidelidadeAtiva: e.target.checked })} className="h-4 w-4 accent-primary" />
              Fidelidade ativa
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={cfg.autoKds !== false} onChange={(e) => set({ autoKds: e.target.checked })} className="h-4 w-4 accent-primary" />
              Enviar pedidos automaticamente para o KDS
            </label>
          </div>
          <div>
            <Label className="text-xs">Pagamentos aceitos</Label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {[
                { v: 'pix', l: '⚡ Pix online' },
                { v: 'cartao', l: '💳 Cartão online' },
                { v: 'entrega', l: '💵 Na entrega' },
                { v: 'vr', l: '🍽 Vale-refeição' },
              ].map((pg) => {
                const on = (cfg.pagamentos ?? []).includes(pg.v);
                return (
                  <button key={pg.v} type="button"
                    onClick={() => set({ pagamentos: on ? (cfg.pagamentos ?? []).filter((x: string) => x !== pg.v) : [...(cfg.pagamentos ?? []), pg.v] })}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'}`}>
                    {pg.l}
                  </button>
                );
              })}
            </div>
          </div>
          {(cfg.pagamentos ?? []).includes('cartao') && (
            <div>
              <Label className="text-xs">Formas de cartão (aparecem ao escolher “Cartão” no cardápio)</Label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {(cfg.formasCartao ?? []).map((f: string) => (
                  <span key={f} className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    {f}
                    <button type="button" aria-label={`Remover ${f}`} onClick={() => set({ formasCartao: (cfg.formasCartao ?? []).filter((x: string) => x !== f) })} className="text-primary/70 hover:text-primary">✕</button>
                  </span>
                ))}
                {(cfg.formasCartao ?? []).length === 0 && <span className="text-xs text-muted-foreground">Ex.: Crédito, Débito, Visa, Elo, VR Alelo…</span>}
              </div>
              <div className="mt-2 flex gap-2">
                <Input value={novoCartao} onChange={(e) => setNovoCartao(e.target.value)} placeholder="Ex.: Crédito Visa" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCartao(); } }} className="max-w-xs" />
                <Button type="button" variant="outline" size="sm" onClick={addCartao}>＋ adicionar</Button>
              </div>
            </div>
          )}
          <Button type="button" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : cfg.token ? 'Salvar' : 'Gerar cardápio'}
          </Button>
        </Card>

        {cfg.token && (
          <>
            {/* Link do DELIVERY / cardápio digital */}
            <Card className="space-y-3 p-4">
              <div>
                <h2 className="font-display text-sm font-bold">🛵 Link do delivery (cardápio digital)</h2>
                <p className="text-xs text-muted-foreground">Compartilhe no WhatsApp/Instagram. O cliente monta o pedido e <strong>fecha no checkout</strong> (tipo, pagamento e endereço).</p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                {qr && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt="QR do delivery" width={180} height={180} className="rounded-lg border border-border" />
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <code className="block break-all rounded-md bg-secondary px-3 py-2 text-xs">{linkDelivery}</code>
                  <Button type="button" variant="outline" size="sm" onClick={async () => { await navigator.clipboard.writeText(linkDelivery); toast.success('Link do delivery copiado.'); }}>
                    Copiar link do delivery
                  </Button>
                </div>
              </div>
            </Card>

            {/* QR por MESA (pedido direto na comanda da mesa) */}
            <Card className="space-y-3 p-4">
              <div>
                <h2 className="font-display text-sm font-bold">🍽 QR por mesa (pedido na mesa)</h2>
                <p className="text-xs text-muted-foreground">Para colar em cada mesa. O pedido vai <strong>direto para a comanda da mesa</strong> (sem checkout). Gere um QR por número.</p>
              </div>
              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Número da mesa</Label>
                  <Input value={mesaNum} onChange={(e) => setMesaNum(e.target.value)} placeholder="Ex.: 12" className="w-32" />
                </div>
              </div>
              {linkMesa ? (
                <div className="flex flex-wrap items-center gap-4">
                  {qrMesa && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrMesa} alt={`QR mesa ${mesaNum}`} width={180} height={180} className="rounded-lg border border-border" />
                  )}
                  <div className="min-w-0 flex-1 space-y-2">
                    <code className="block break-all rounded-md bg-secondary px-3 py-2 text-xs">{linkMesa}</code>
                    <Button type="button" variant="outline" size="sm" onClick={async () => { await navigator.clipboard.writeText(linkMesa); toast.success(`Link da mesa ${mesaNum} copiado.`); }}>
                      Copiar link da mesa {mesaNum}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Digite o número da mesa acima para gerar o QR dela.</p>
              )}
            </Card>
          </>
        )}

        {/* Frete por bairro */}
        <Card className="p-4">
          <h2 className="mb-2 font-display text-sm font-bold">Frete por bairro</h2>
          <div className="space-y-2">
            {bairros.map((b, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Input placeholder="Bairro" value={b.nome} onChange={(e) => { const a = [...bairros]; a[i] = { ...b, nome: e.target.value }; setBairros(a); }} />
                <Input type="number" placeholder="Taxa R$" value={b.taxa} onChange={(e) => { const a = [...bairros]; a[i] = { ...b, taxa: e.target.value }; setBairros(a); }} />
                <Button type="button" variant="ghost" size="sm" onClick={() => setBairros(bairros.filter((_, x) => x !== i))}>remover</Button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setBairros([...bairros, { nome: '', taxa: '' }])}>＋ bairro</Button>
            <Button type="button" size="sm" onClick={salvarBairros}>Salvar bairros</Button>
          </div>
        </Card>

        {/* Cupons */}
        <Card className="p-4">
          <h2 className="mb-2 font-display text-sm font-bold">Cupons</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Input className="w-32" placeholder="CÓDIGO" value={novoCupom.codigo} onChange={(e) => setNovoCupom((s) => ({ ...s, codigo: e.target.value.toUpperCase() }))} />
            <select aria-label="Tipo do cupom" className="flex h-11 w-28 rounded-md border border-input bg-card px-2 text-sm" value={novoCupom.tipo} onChange={(e) => setNovoCupom((s) => ({ ...s, tipo: e.target.value }))}>
              <option value="percentual">%</option>
              <option value="valor">R$</option>
            </select>
            <Input className="w-24" type="number" placeholder="Valor" value={novoCupom.valor} onChange={(e) => setNovoCupom((s) => ({ ...s, valor: e.target.value }))} />
            <Input className="w-28" type="number" placeholder="Mín. (opc)" value={novoCupom.minimo} onChange={(e) => setNovoCupom((s) => ({ ...s, minimo: e.target.value }))} />
            <Button type="button" onClick={addCupom}>Adicionar</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {cupons.map((c) => (
              <span key={c.id} className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs">
                {c.codigo} · {c.tipo === 'percentual' ? `${Number(c.valor)}%` : brl(Number(c.valor))}
                <button type="button" onClick={() => delCupom(c.id)} className="text-destructive">×</button>
              </span>
            ))}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
