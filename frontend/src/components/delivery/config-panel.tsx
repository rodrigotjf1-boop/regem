'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, getUnidadeAtual } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';
import { FidelidadePanel } from '@/components/delivery/fidelidade-panel';
import { CashbackPanel } from '@/components/delivery/cashback-panel';
import { localizacaoAtual, geocodificar, mapaEmbedUrl } from '@/lib/geo';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];


const MENU: { grupo: string; itens: { k: string; label: string; breve?: boolean }[] }[] = [
  {
    grupo: 'Cardápio digital',
    itens: [
      { k: 'cardapio', label: 'Cardápio' },
      { k: 'horarios', label: 'Horários' },
      { k: 'tipos', label: 'Tipos de pedido' },
      { k: 'area', label: 'Área de atendimento' },
      { k: 'cupons', label: 'Cupons' },
      { k: 'fidelidade', label: 'Plano de fidelidade' },
      { k: 'cashback', label: 'Cashback' },
      { k: 'regras', label: 'Regras de desconto' },
    ],
  },
  {
    grupo: 'Operação',
    itens: [
      { k: 'banners', label: 'Banners' },
      { k: 'impressoras', label: 'Impressoras e cupons' },
      { k: 'integracoes', label: 'Integrações' },
      { k: 'robo', label: 'Robô de atendimento' },
    ],
  },
];

export function ConfigPanel({
  deliveryCfg,
  onDeliveryToggle,
  isGestor,
  onClose,
  pagina = false,
}: {
  deliveryCfg: any;
  onDeliveryToggle: (patch: any) => void;
  isGestor: boolean;
  onClose: () => void;
  pagina?: boolean;
}) {
  const [sec, setSec] = useState('cardapio');
  const [loja, setLoja] = useState<any>(null);
  const [bairros, setBairros] = useState<any[]>([]);
  const [banners, setBanners] = useState<any[]>([]);
  const [impressoras, setImpressoras] = useState<any[]>([]);
  const [setores, setSetores] = useState<any[]>([]);
  const [integracoes, setIntegracoes] = useState<any[]>([]);
  const [cupons, setCupons] = useState<any[]>([]);
  const [novoCupom, setNovoCupom] = useState({
    codigo: '',
    tipo: 'percentual',
    valor: '',
    tetoDesconto: '',
    minimo: '',
    condicao: 'nenhuma', // nenhuma | novos | dias | max
    minDiasSemCompra: '',
    maxPorCliente: '',
  });
  const [qr, setQr] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [editarTema, setEditarTema] = useState(false);

  useEffect(() => {
    api.cardapioConfig().then((c: any) => setLoja(c ?? {})).catch(() => setLoja({}));
    api.cardapioBairros().then((b: any) => setBairros((b as any[]) ?? [])).catch(() => {});
    api.cardapioBanners().then((b: any) => setBanners((b as any[]) ?? [])).catch(() => {});
    api.cardapioCupons().then((c: any) => setCupons((c as any[]) ?? [])).catch(() => {});
    if (isGestor) {
      api.impressoras().then((p: any) => setImpressoras((p as any[]) ?? [])).catch(() => {});
      api.setores().then((s: any) => setSetores((s as any[]) ?? [])).catch(() => {});
      api.integracoesDelivery().then((i: any) => setIntegracoes((i as any[]) ?? [])).catch(() => {});
    }
  }, [isGestor]);

  async function salvarIntegracao(dto: any) {
    try {
      await api.salvarIntegracao(dto);
      setIntegracoes(await api.integracoesDelivery() as any[]);
      toast.success('Integração salva.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  async function salvarImpressora(row: any) {
    try {
      const r = await api.salvarImpressora(row);
      setImpressoras(await api.impressoras() as any[]);
      toast.success('Impressora salva.');
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }
  async function removerImpressora(id: string) {
    try {
      await api.removerImpressora(id);
      setImpressoras((l) => l.filter((x) => x.id !== id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao remover');
    }
  }

  const up = (patch: any) => setLoja((l: any) => ({ ...(l ?? {}), ...patch }));

  // Persiste a config da loja com um patch explícito (usado ao trocar o modo da área).
  async function salvarLojaPatch(patch: any) {
    const novo = { ...(loja ?? {}), ...patch };
    setLoja(novo);
    try { setLoja(await api.setCardapioConfig(novo)); } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro'); }
  }

  async function salvarBanners(lista: any[], intervalo: number) {
    setSalvando(true);
    try {
      const b = await api.setCardapioBanners(lista.filter((x) => x.imagemRef));
      setBanners(b as any[]);
      // Intervalo do carrossel vive no tema_config da loja.
      const c = await api.setCardapioConfig({
        ...(loja ?? {}),
        temaConfig: { ...(loja?.temaConfig ?? {}), bannerIntervalo: intervalo },
      });
      setLoja(c);
      toast.success('Banners salvos.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  async function salvarLoja() {
    setSalvando(true);
    try {
      const c = await api.setCardapioConfig(loja);
      setLoja(c);
      toast.success('Configuração salva.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  // Link do cardápio digital próprio (gerado quando ativado).
  // O link/QR do cardápio é SEMPRE online (nuvem) — o cliente acessa pelo próprio
  // celular, fora da rede da loja. `cardapioBaseUrl` vem do backend (nuvem, mesmo no edge).
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const cardapioBase = loja?.cardapioBaseUrl || origin;
  const linkDelivery = loja?.token ? `${cardapioBase}/c/${loja.token}` : '';
  useEffect(() => {
    if (!linkDelivery) { setQr(''); return; }
    QRCode.toDataURL(linkDelivery, { width: 220, margin: 1 }).then(setQr).catch(() => setQr(''));
  }, [linkDelivery]);

  // Exporta o QR em alta resolução (512px) como PNG para arquivo.
  async function baixarQrPng() {
    if (!linkDelivery) return;
    try {
      const url = await QRCode.toDataURL(linkDelivery, { width: 512, margin: 2 });
      const a = document.createElement('a');
      a.href = url;
      a.download = `qrcode-cardapio-${loja?.token ?? 'loja'}.png`;
      a.click();
    } catch { toast.error('Não foi possível gerar o PNG.'); }
  }

  // Abre uma janela pronta para imprimir (o usuário escolhe "Salvar como PDF").
  async function imprimirQrPdf() {
    if (!linkDelivery) return;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    try {
      const url = await QRCode.toDataURL(linkDelivery, { width: 512, margin: 2 });
      const nome = esc(loja?.nomePublico || 'Cardápio digital');
      const w = window.open('', '_blank', 'width=480,height=680');
      if (!w) { toast.error('Permita pop-ups para imprimir.'); return; }
      w.document.write(
        `<!doctype html><html><head><meta charset="utf-8"><title>QR ${nome}</title>` +
        `<style>body{font-family:system-ui,Arial,sans-serif;text-align:center;color:#111;padding:28px}` +
        `h1{font-size:22px;margin:0 0 4px}p.sub{color:#555;font-size:14px;margin:0 0 12px}` +
        `img{width:340px;height:340px}code{display:block;margin-top:12px;font-size:12px;color:#555;word-break:break-all}` +
        `@media print{@page{margin:14mm}}</style></head><body>` +
        `<h1>${nome}</h1><p class="sub">Aponte a câmera do celular para ver o cardápio</p>` +
        `<img src="${url}" alt="QR do cardápio"/><code>${esc(linkDelivery)}</code>` +
        `<script>window.onload=function(){setTimeout(function(){window.print()},200)}<\/script>` +
        `</body></html>`,
      );
      w.document.close();
    } catch { toast.error('Não foi possível gerar o PDF.'); }
  }

  async function addCupom() {
    if (!novoCupom.codigo.trim()) return;
    const n = (v: string) => (v ? Number(String(v).replace(',', '.')) : undefined);
    try {
      await api.criarCupom({
        codigo: novoCupom.codigo.trim(),
        tipo: novoCupom.tipo,
        valor: novoCupom.tipo === 'fretegratis' ? 0 : n(novoCupom.valor) || 0,
        tetoDesconto: novoCupom.tipo === 'percentual' ? n(novoCupom.tetoDesconto) : undefined,
        minimo: n(novoCupom.minimo),
        somenteNovos: novoCupom.condicao === 'novos',
        minDiasSemCompra: novoCupom.condicao === 'dias' ? n(novoCupom.minDiasSemCompra) : undefined,
        maxPorCliente: novoCupom.condicao === 'max' ? n(novoCupom.maxPorCliente) : undefined,
      });
      setNovoCupom({ codigo: '', tipo: novoCupom.tipo, valor: '', tetoDesconto: '', minimo: '', condicao: 'nenhuma', minDiasSemCompra: '', maxPorCliente: '' });
      setCupons(await api.cardapioCupons());
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro'); }
  }
  async function delCupom(id: string) {
    try { await api.removerCupom(id); setCupons(await api.cardapioCupons()); } catch { /* */ }
  }

  async function salvarBairros(lista: any[]) {
    setSalvando(true);
    try {
      const b = await api.setCardapioBairros(lista.filter((x) => x.nome?.trim()));
      setBairros(b as any[]);
      toast.success('Área de atendimento salva.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  const somenteGestor = !isGestor;

  return (
    <div className={pagina ? 'w-full' : 'fixed inset-0 z-50 grid place-items-center bg-black/50 p-4'} onClick={pagina ? undefined : onClose}>
      <div className={pagina ? 'flex w-full flex-col' : 'flex h-[92vh] w-full max-w-6xl overflow-hidden rounded-xl border border-border bg-card'} onClick={(e) => e.stopPropagation()}>
        {/* Abas no topo (modo página) */}
        {pagina && (
          <div className="mb-3 flex gap-1 overflow-x-auto border-b border-border pb-1">
            {MENU.flatMap((g) => g.itens).map((it) => (
              <button
                key={it.k}
                type="button"
                onClick={() => setSec(it.k)}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${sec === it.k ? 'bg-primary/15 font-semibold text-primary' : 'text-muted-foreground hover:bg-secondary'}`}
              >
                {it.label}
                {it.breve && <span className="ml-1 rounded bg-warn/15 px-1 text-[9px] font-bold text-warn">em breve</span>}
              </button>
            ))}
          </div>
        )}
        {/* Menu lateral (modo modal) */}
        {!pagina && (
          <aside className="w-52 shrink-0 overflow-y-auto border-r border-border bg-secondary/40 p-3">
            <p className="mb-2 px-1 font-display text-sm font-bold">Configurações</p>
            {MENU.map((g) => (
              <div key={g.grupo} className="mb-3">
                <p className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{g.grupo}</p>
                {g.itens.map((it) => (
                  <button
                    key={it.k}
                    type="button"
                    onClick={() => setSec(it.k)}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${sec === it.k ? 'bg-primary/15 font-semibold text-primary' : 'hover:bg-secondary'}`}
                  >
                    {it.label}
                    {it.breve && <span className="rounded bg-warn/15 px-1 text-[9px] font-bold text-warn">em breve</span>}
                  </button>
                ))}
              </div>
            ))}
          </aside>
        )}

        {/* Conteúdo */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!pagina && (
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h3 className="font-display text-base font-bold">{secLabel(sec)}</h3>
              <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-secondary">Fechar ✕</button>
            </div>
          )}

          <div className={pagina ? 'min-h-0 flex-1' : 'min-h-0 flex-1 overflow-y-auto p-4'}>
            {loja === null ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : (
              <>
                {/* CARDÁPIO REGEM */}
                {sec === 'cardapio' && (
                  <Secao dica="Ative o cardápio digital PRÓPRIO — para quando você não tem um cardápio externo (iFood etc.) para integrar. Gera um link e um QR para compartilhar.">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" checked={!!loja.ativo} disabled={somenteGestor} onChange={(e) => up({ ativo: e.target.checked })} className="h-4 w-4 accent-primary" />
                      Cardápio digital próprio ativo
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Campo label="Modo">
                        <select aria-label="Modo do cardápio" disabled={somenteGestor} value={loja.modo ?? 'mesa'} onChange={(e) => up({ modo: e.target.value })} className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm">
                          <option value="mesa">Mesa (QR na mesa → comanda)</option>
                          <option value="retirada">Retirada (cai no delivery)</option>
                          <option value="totem">Totem (autoatendimento)</option>
                        </select>
                      </Campo>
                      <Campo label="Ramo (tema)">
                        <select aria-label="Ramo" disabled={somenteGestor} value={loja.ramo ?? 'food'} onChange={(e) => up({ ramo: e.target.value })} className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm">
                          <option value="food">🍔 Bares e Restaurantes</option>
                          <option value="varejo" disabled>🛍 Varejo (em breve)</option>
                          <option value="industria" disabled>🏭 Indústria (em breve)</option>
                          <option value="servicos" disabled>📅 Serviços (em breve)</option>
                        </select>
                      </Campo>
                      <Campo label="Tema do cardápio">
                        <select aria-label="Tema do cardápio" disabled={somenteGestor} value={loja.tema ?? 'claro'} onChange={(e) => up({ tema: e.target.value })} className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm">
                          <option value="claro">☀️ Claro</option>
                          <option value="escuro">🌙 Escuro</option>
                          <option value="auto">🌗 Automático (segue o aparelho do cliente)</option>
                        </select>
                      </Campo>
                      <Campo label="Estilo do cardápio (layout)">
                        <select aria-label="Estilo do cardápio" disabled={somenteGestor} value={loja.menuTheme ?? 'classic'} onChange={(e) => up({ menuTheme: e.target.value })} className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm">
                          <option value="classic">📋 Clássico (padrão)</option>
                          <option value="fastfood">🍔 Fast-food (destaques + carrossel)</option>
                          <option value="grid">🔲 Grade (cabeçalho curvo + grade 2 colunas)</option>
                        </select>
                      </Campo>
                      <Campo label="Logo (emoji)"><Input value={loja.logoEmoji ?? ''} onChange={(e) => up({ logoEmoji: e.target.value })} placeholder="🍔" /></Campo>
                      <Campo label="Tempo de entrega (min)"><Input type="number" value={loja.tempoEntregaMin ?? ''} onChange={(e) => up({ tempoEntregaMin: e.target.value })} placeholder="40" /></Campo>
                      <Campo label="Tempo de retirada (min)"><Input type="number" value={loja.tempoRetiradaMin ?? ''} onChange={(e) => up({ tempoRetiradaMin: e.target.value })} placeholder="20" /></Campo>
                      <Campo label="Frete grátis acima de (R$)"><Input type="number" value={loja.freteGratisAcima ?? ''} onChange={(e) => up({ freteGratisAcima: e.target.value })} placeholder="opcional" /></Campo>
                      <Campo label="Parcelas máx. (cartão · varejo)"><Input type="number" value={loja.parcelasMax ?? ''} onChange={(e) => up({ parcelasMax: e.target.value })} placeholder="ex.: 12" /></Campo>
                      <Campo label="Aparência do cardápio">
                        <Button type="button" variant="outline" disabled={somenteGestor} onClick={() => setEditarTema(true)} className="h-11 w-full justify-center gap-2">
                          🎨 Editar tema
                        </Button>
                      </Campo>
                    </div>
                    <Campo label="Subtítulo"><Input value={loja.subtitulo ?? ''} onChange={(e) => up({ subtitulo: e.target.value })} placeholder="Ex.: Hamburgueria artesanal · 1,2 km" /></Campo>
                    <div className="flex flex-wrap items-center gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={loja.autoKds !== false} disabled={somenteGestor} onChange={(e) => up({ autoKds: e.target.checked })} className="h-4 w-4 accent-primary" />
                        Enviar pedidos automaticamente para o KDS
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={!!loja.fidelidadeAtiva} disabled={somenteGestor} onChange={(e) => up({ fidelidadeAtiva: e.target.checked })} className="h-4 w-4 accent-primary" />
                        Fidelidade ativa
                      </label>
                    </div>
                    <SalvarBar onSalvar={salvarLoja} salvando={salvando} pode={isGestor} />

                    {loja.token && (
                      <div className="space-y-2 rounded-lg border border-border p-3">
                        <p className="text-sm font-bold">🛵 Link do delivery (cardápio digital)</p>
                        <p className="text-xs text-muted-foreground">Compartilhe no WhatsApp/Instagram. O cliente monta o pedido e fecha no checkout.</p>
                        <div className="flex flex-wrap items-center gap-4">
                          {qr && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={qr} alt="QR do cardápio" width={160} height={160} className="rounded-lg border border-border" />
                          )}
                          <div className="min-w-0 flex-1 space-y-2">
                            <code className="block break-all rounded-md bg-secondary px-3 py-2 text-xs">{linkDelivery}</code>
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={async () => { await navigator.clipboard.writeText(linkDelivery); toast.success('Link copiado.'); }}>Copiar link</Button>
                              <Button type="button" variant="outline" size="sm" onClick={baixarQrPng}>⬇ Exportar PNG</Button>
                              <Button type="button" variant="outline" size="sm" onClick={imprimirQrPdf}>🖨 Imprimir / PDF</Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {/* "Colunas do quadro de entregas" saiu daqui → botão ⚙️ no painel de delivery. */}
                  </Secao>
                )}

                {/* CUPONS */}
                {sec === 'cupons' && (
                  <Secao dica="Cupons de desconto para o cardápio digital. Todo cupom desconta no valor da compra: percentual (com teto opcional), valor fixo (com pedido mínimo) ou frete grátis. Condicionais opcionais limitam quem pode usar.">
                    <div className="max-w-xl space-y-3 rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">Código</label>
                          <Input className="w-32" placeholder="CÓDIGO" value={novoCupom.codigo} onChange={(e) => setNovoCupom((s) => ({ ...s, codigo: e.target.value.toUpperCase() }))} />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">Tipo de desconto</label>
                          <select aria-label="Tipo do cupom" className="flex h-11 w-40 rounded-md border border-input bg-card px-2 text-sm" value={novoCupom.tipo} onChange={(e) => setNovoCupom((s) => ({ ...s, tipo: e.target.value }))}>
                            <option value="percentual">Percentual (%)</option>
                            <option value="valor">Valor fixo (R$)</option>
                            <option value="fretegratis">Frete grátis</option>
                          </select>
                        </div>
                        {novoCupom.tipo !== 'fretegratis' && (
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">{novoCupom.tipo === 'percentual' ? '% de desconto' : 'Valor (R$)'}</label>
                            <Input className="w-24" type="number" placeholder="Valor" value={novoCupom.valor} onChange={(e) => setNovoCupom((s) => ({ ...s, valor: e.target.value }))} />
                          </div>
                        )}
                        {novoCupom.tipo === 'percentual' && (
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Teto do desconto (R$)</label>
                            <Input className="w-28" type="number" placeholder="opcional" value={novoCupom.tetoDesconto} onChange={(e) => setNovoCupom((s) => ({ ...s, tetoDesconto: e.target.value }))} />
                          </div>
                        )}
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">Pedido mínimo (R$)</label>
                          <Input className="w-28" type="number" placeholder="opcional" value={novoCupom.minimo} onChange={(e) => setNovoCupom((s) => ({ ...s, minimo: e.target.value }))} />
                        </div>
                      </div>

                      {/* Condicional de uso */}
                      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">Condição de uso</label>
                          <select aria-label="Condição do cupom" className="flex h-11 w-56 rounded-md border border-input bg-card px-2 text-sm" value={novoCupom.condicao} onChange={(e) => setNovoCupom((s) => ({ ...s, condicao: e.target.value }))}>
                            <option value="nenhuma">Sem condição (uso livre)</option>
                            <option value="novos">Só clientes novos (1º pedido)</option>
                            <option value="dias">Cliente há X dias sem comprar</option>
                            <option value="max">Máx. X usos por cliente</option>
                          </select>
                        </div>
                        {novoCupom.condicao === 'dias' && (
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Dias sem comprar</label>
                            <Input className="w-24" type="number" placeholder="ex: 30" value={novoCupom.minDiasSemCompra} onChange={(e) => setNovoCupom((s) => ({ ...s, minDiasSemCompra: e.target.value }))} />
                          </div>
                        )}
                        {novoCupom.condicao === 'max' && (
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Máx. usos/cliente</label>
                            <Input className="w-24" type="number" placeholder="ex: 1" value={novoCupom.maxPorCliente} onChange={(e) => setNovoCupom((s) => ({ ...s, maxPorCliente: e.target.value }))} />
                          </div>
                        )}
                        <Button type="button" onClick={addCupom} disabled={somenteGestor}>Adicionar cupom</Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {cupons.length === 0 && <span className="text-sm text-muted-foreground">Nenhum cupom.</span>}
                      {cupons.map((c) => (
                        <span key={c.id} className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs">
                          <strong>{c.codigo}</strong> ·{' '}
                          {c.tipo === 'fretegratis'
                            ? 'frete grátis'
                            : c.tipo === 'percentual'
                              ? `${Number(c.valor)}%${c.tetoDesconto ? ` (até ${Number(c.tetoDesconto).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})` : ''}`
                              : Number(c.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          {c.minimo ? ` · mín. ${Number(c.minimo).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''}
                          {c.somenteNovos ? ' · novos' : ''}
                          {c.minDiasSemCompra ? ` · ${c.minDiasSemCompra}d inativo` : ''}
                          {c.maxPorCliente ? ` · máx ${c.maxPorCliente}x` : ''}
                          <button type="button" onClick={() => delCupom(c.id)} className="text-destructive">×</button>
                        </span>
                      ))}
                    </div>
                  </Secao>
                )}

                {/* PLANO DE FIDELIDADE */}
                {sec === 'fidelidade' && (
                  <Secao dica="Programa de fidelidade do cardápio digital: o cliente ganha 1 ponto por pedido que atenda à regra e, ao bater a meta, conquista um prêmio para resgatar na aba Promos.">
                    <FidelidadePanel pode={isGestor} />
                  </Secao>
                )}

                {/* CASHBACK */}
                {sec === 'cashback' && (
                  <Secao dica="Cashback do cardápio: retorno em valor (% do pedido vira saldo) ou em pontos (troca por produtos). Creditado após a confirmação do pedido; estornado se o pedido for cancelado. Concorre com a fidelidade — a loja escolhe a estratégia.">
                    <CashbackPanel pode={isGestor} />
                  </Secao>
                )}

                {/* REGRAS DE DESCONTO & CANCELAMENTO */}
                {sec === 'regras' && (
                  <Secao dica="Como cupom, cashback e fidelidade se combinam e o que o cliente perde ao cancelar um pedido.">
                    <ToggleLinha
                      label="Devolver cashback ao cancelar"
                      desc="Ligado: o cashback usado volta ao cliente quando o pedido é cancelado. Desligado: o cliente perde (e é avisado antes de confirmar o cancelamento)."
                      checked={loja.cancelamentoEstornaCashback !== false}
                      onChange={(v) => up({ cancelamentoEstornaCashback: v })}
                      pode={isGestor}
                    />
                    <ToggleLinha
                      label="Cupom bloqueado com resgate de fidelidade"
                      desc="Não permite usar cupom em pedidos que já usam um resgate de fidelidade."
                      checked={!!loja.cupomBloqueiaComResgate}
                      onChange={(v) => up({ cupomBloqueiaComResgate: v })}
                      pode={isGestor}
                    />
                    <div className="space-y-1.5">
                      <Label>Cupom só até este cashback usado (R$)</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Sem limite"
                        disabled={!isGestor}
                        value={
                          loja.cupomMaxCashbackReais ??
                          (loja.cupomMaxCashbackCent != null ? loja.cupomMaxCashbackCent / 100 : '')
                        }
                        onChange={(e) => up({ cupomMaxCashbackReais: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        Vazio = sem limite. Ex.: R$ 8,00 nega o cupom se o cliente usar mais que isso de cashback no pedido.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Intervalo mínimo p/ pontuar fidelidade (horas)</Label>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        disabled={!isGestor}
                        value={loja.fidelidadeIntervaloHoras ?? 3}
                        onChange={(e) => up({ fidelidadeIntervaloHoras: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        Padrão 3h. Impede fatiar pedidos para acumular pontos rápido.
                      </p>
                    </div>
                    <SalvarBar onSalvar={salvarLoja} salvando={salvando} pode={isGestor} />
                  </Secao>
                )}

                {/* LOJA */}
                {/* Loja e Endereço migraram para Configurações → Loja. */}

                {/* HORÁRIOS */}
                {sec === 'horarios' && (
                  <Secao dica="Horário de funcionamento do delivery por dia da semana.">
                    <Horarios value={loja.horarios ?? []} onChange={(h) => up({ horarios: h })} pode={isGestor} />
                    <SalvarBar onSalvar={salvarLoja} salvando={salvando} pode={isGestor} />
                  </Secao>
                )}

                {/* TIPOS */}
                {sec === 'tipos' && (
                  <Secao dica="O que o cliente pode escolher no cardápio digital.">
                    <ToggleLinha label="Delivery (entrega)" desc="Cliente pede para receber em casa." checked={loja.tipoDelivery !== false} onChange={(v) => up({ tipoDelivery: v })} pode={isGestor} />
                    <ToggleLinha label="Retirar na loja" desc="Cliente busca o pedido no balcão." checked={!!loja.tipoRetirada} onChange={(v) => up({ tipoRetirada: v })} pode={isGestor} />
                    <ToggleLinha label="Consumir no local" desc="Para lojas com salão." checked={!!loja.tipoLocal} onChange={(v) => up({ tipoLocal: v })} pode={isGestor} />
                    <SalvarBar onSalvar={salvarLoja} salvando={salvando} pode={isGestor} />
                  </Secao>
                )}

                {/* ÁREA DE ATENDIMENTO */}
                {sec === 'area' && (
                  <AreaAtendimento
                    modo={loja.areaModo ?? 'bairro'}
                    onTrocarModo={(m) => salvarLojaPatch({ areaModo: m })}
                    raios={loja.raios ?? []}
                    onRaios={(r) => up({ raios: r })}
                    onSalvarRaios={salvarLoja}
                    bairros={bairros}
                    onSalvarBairros={salvarBairros}
                    salvando={salvando}
                    pode={isGestor}
                  />
                )}

                {/* BANNERS */}
                {sec === 'banners' && (
                  <Banners banners={banners} intervalo={loja?.temaConfig?.bannerIntervalo ?? 2} onSalvar={salvarBanners} salvando={salvando} pode={isGestor} />
                )}

                {/* IMPRESSORAS */}
                {sec === 'impressoras' && (
                  <div className="space-y-4">
                    <CupomLayoutEditor cfg={deliveryCfg} onSave={onDeliveryToggle} pode={isGestor} />
                    <Impressoras lista={impressoras} setores={setores} onSalvar={salvarImpressora} onRemover={removerImpressora} pode={isGestor} />
                  </div>
                )}

                {/* INTEGRAÇÕES */}
                {sec === 'integracoes' && (
                  <Integracoes lista={integracoes} onSalvar={salvarIntegracao} pode={isGestor} cardapioAtivo={!!loja?.ativo} />
                )}

                {/* ROBÔ DE ATENDIMENTO */}
                {sec === 'robo' && (
                  <Robo loja={loja} up={up} onSalvar={salvarLoja} salvando={salvando} pode={isGestor} />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {editarTema && (
        <EditarTemaModal
          ramo={loja?.ramo ?? 'food'}
          temaConfig={loja?.temaConfig ?? {}}
          onFechar={() => setEditarTema(false)}
          onSalvar={(tc) => { salvarLojaPatch({ temaConfig: tc }); setEditarTema(false); }}
        />
      )}
    </div>
  );
}

function secLabel(k: string) {
  const all = MENU.flatMap((g) => g.itens);
  return all.find((i) => i.k === k)?.label ?? 'Configurações';
}

// Paleta base do produto (cores usadas hoje no código) + cor por ramo.
const RAMO_COR: Record<string, string> = { food: '#E2A340', varejo: '#2563EB', industria: '#E05A2B', servicos: '#0E8E7E' };
const PALETA = ['#E2A340', '#0E7C66', '#0E8E7E', '#2563EB', '#E05A2B', '#DC2626', '#7C3AED', '#0F2230'];

// Linha de cor (fundo/texto do cabeçalho). Definida no escopo do módulo (NÃO dentro
// do modal) — se fosse recriada a cada render, o seletor de cor nativo fecharia sozinho.
function CorLinha({ label, valor, padrao, set }: { label: string; valor: string | null; padrao: string; set: (v: string | null) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 text-sm">{label}</span>
      <input type="color" aria-label={label} value={valor ?? padrao} onChange={(e) => set(e.target.value)} className="h-9 w-12 rounded border border-border bg-transparent" />
      <span className="w-16 font-mono text-xs text-muted-foreground">{valor ?? 'padrão'}</span>
      <button type="button" onClick={() => set(null)} className="text-xs text-muted-foreground underline">padrão</button>
    </div>
  );
}

function ToggleTema({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
      <span>{label}</span>
      <button type="button" aria-pressed={on ? 'true' : 'false'} aria-label={label} onClick={() => set(!on)}
        className={`relative h-6 w-11 flex-none rounded-full transition-colors ${on ? 'bg-primary' : 'bg-muted'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

// Modal "Editar tema": cor primária (amostras da paleta + custom) e toggles de
// Destaques / Banner / Últimos pedidos. Salva em cardapio_config.tema_config.
function EditarTemaModal({
  ramo,
  temaConfig,
  onFechar,
  onSalvar,
}: {
  ramo: string;
  temaConfig: any;
  onFechar: () => void;
  onSalvar: (tc: any) => void;
}) {
  const padraoRamo = RAMO_COR[ramo] ?? '#E2A340';
  const [cor, setCor] = useState<string>(temaConfig?.corPrimaria || padraoRamo);
  // Cores do cabeçalho — null = padrão do tema (fundo escuro/cor da loja; texto branco).
  const [corCab, setCorCab] = useState<string | null>(temaConfig?.corCabecalho ?? null);
  const [corTxt, setCorTxt] = useState<string | null>(temaConfig?.corTextoCabecalho ?? null);
  const [destaques, setDestaques] = useState<boolean>(temaConfig?.mostrarDestaques !== false);
  const [banner, setBanner] = useState<boolean>(temaConfig?.mostrarBanner !== false);
  const [ultimos, setUltimos] = useState<boolean>(temaConfig?.mostrarUltimos !== false);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" onClick={onFechar}>
      <Card className="max-h-[85vh] w-full max-w-md overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-display text-base font-bold">🎨 Editar tema</h3>
          <button type="button" onClick={onFechar} className="ml-auto text-sm text-muted-foreground hover:underline">Fechar ✕</button>
        </div>

        <p className="mb-1.5 text-sm font-semibold">Cor principal</p>
        <div className="mb-2 flex flex-wrap gap-2">
          {PALETA.map((c) => (
            <button key={c} type="button" aria-label={`Cor ${c}`} onClick={() => setCor(c)}
              className={`h-8 w-8 rounded-full border-2 ${cor.toLowerCase() === c.toLowerCase() ? 'border-foreground' : 'border-transparent'}`}
              style={{ background: c }} />
          ))}
        </div>
        <div className="mb-4 flex items-center gap-2">
          <input type="color" aria-label="Cor personalizada" value={cor} onChange={(e) => setCor(e.target.value)} className="h-9 w-12 rounded border border-border bg-transparent" />
          <span className="font-mono text-xs text-muted-foreground">{cor}</span>
          <button type="button" onClick={() => setCor(padraoRamo)} className="ml-auto text-xs text-muted-foreground underline">usar padrão do ramo</button>
        </div>

        <p className="mb-1.5 text-sm font-semibold">Cabeçalho</p>
        <div className="mb-4 space-y-2 rounded-lg border border-border p-3">
          <CorLinha label="Cor de fundo" valor={corCab} padrao={cor} set={setCorCab} />
          <CorLinha label="Cor do texto" valor={corTxt} padrao="#ffffff" set={setCorTxt} />
        </div>

        <p className="mb-1.5 text-sm font-semibold">Seções do cardápio</p>
        <div className="space-y-2">
          <ToggleTema label="Itens em destaque" on={destaques} set={setDestaques} />
          <ToggleTema label="Banner (carrossel)" on={banner} set={setBanner} />
          <ToggleTema label="Últimos pedidos" on={ultimos} set={setUltimos} />
        </div>

        <Button type="button" className="mt-5 w-full" onClick={() => onSalvar({ ...(temaConfig ?? {}), corPrimaria: cor, corCabecalho: corCab, corTextoCabecalho: corTxt, mostrarDestaques: destaques, mostrarBanner: banner, mostrarUltimos: ultimos })}>
          Salvar tema
        </Button>
      </Card>
    </div>
  );
}

// (Formas de pagamento migraram para Financeiro → Formas de pagamento; a marcação
// "aparece no cardápio" agora é o toggle por forma na tela nova.)

function Secao({ dica, children }: { dica: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{dica}</p>
      {children}
    </div>
  );
}
export function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
function SalvarBar({ onSalvar, salvando, pode }: { onSalvar: () => void; salvando: boolean; pode: boolean }) {
  return (
    <div className="flex justify-end pt-1">
      <Button type="button" onClick={onSalvar} disabled={salvando || !pode}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
    </div>
  );
}
function ToggleLinha({ label, desc, checked, onChange, pode }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void; pode: boolean }) {
  return (
    <label className={`flex items-center gap-3 rounded-lg border border-border p-3 ${pode ? '' : 'opacity-60'}`}>
      <input type="checkbox" className="h-4 w-4 accent-primary" disabled={!pode} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </label>
  );
}

// Duração da janela em minutos (trata a virada de meia-noite: fecha <= abre).
function duracaoMin(abre?: string, fecha?: string): number {
  const m = (t?: string) => {
    const [h, mi] = String(t ?? '').split(':').map(Number);
    return Number.isFinite(h) ? h * 60 + (mi || 0) : NaN;
  };
  const a = m(abre), f = m(fecha);
  if (Number.isNaN(a) || Number.isNaN(f)) return 0;
  return f > a ? f - a : 24 * 60 - a + f; // vira a meia-noite
}

function Horarios({ value, onChange, pode }: { value: any[]; onChange: (h: any[]) => void; pode: boolean }) {
  const byDia = (d: number) => value.find((h) => h.dia === d) ?? { dia: d, abre: '18:00', fecha: '23:00', ativo: false };
  function set(d: number, patch: any) {
    const outros = value.filter((h) => h.dia !== d);
    onChange([...outros, { ...byDia(d), ...patch }].sort((a, b) => a.dia - b.dia));
  }
  return (
    <div className="space-y-1.5">
      {DIAS.map((nome, d) => {
        const h = byDia(d);
        // Janela muito longa (>18h) quase sempre é erro de digitação (ex.: abre
        // 04:00 e fecha 03:00 = 23h). Avisa sem bloquear.
        const min = h.ativo ? duracaoMin(h.abre, h.fecha) : 0;
        const longa = min > 18 * 60;
        return (
          <div key={d} className="rounded-lg border border-border p-2 text-sm">
            <div className="flex items-center gap-2">
              <label className="flex w-24 items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-primary" disabled={!pode} checked={!!h.ativo} onChange={(e) => set(d, { ativo: e.target.checked })} />
                <span className="font-medium">{nome}</span>
              </label>
              <Input type="time" value={h.abre ?? ''} disabled={!pode || !h.ativo} onChange={(e) => set(d, { abre: e.target.value })} className="h-8 w-28" />
              <span className="text-muted-foreground">às</span>
              <Input type="time" value={h.fecha ?? ''} disabled={!pode || !h.ativo} onChange={(e) => set(d, { fecha: e.target.value })} className="h-8 w-28" />
            </div>
            {longa && (
              <p className="mt-1.5 text-xs text-amber-600" role="alert">
                ⚠ Janela de {(min / 60).toFixed(0)}h — confira se o horário está certo.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function AreaAtendimento({
  modo, onTrocarModo, raios, onRaios, onSalvarRaios, bairros, onSalvarBairros, salvando, pode,
}: {
  modo: string;
  onTrocarModo: (m: string) => void;
  raios: any[];
  onRaios: (r: any[]) => void;
  onSalvarRaios: () => void;
  bairros: any[];
  onSalvarBairros: (l: any[]) => void;
  salvando: boolean;
  pode: boolean;
}) {
  return (
    <div className="space-y-3">
      {/* Modo exclusivo: por bairro OU por raio */}
      <div className="inline-flex rounded-lg border border-border p-0.5 text-sm">
        {([['bairro', 'Por bairro'], ['raio', 'Por raio']] as const).map(([k, lb]) => (
          <button
            key={k}
            type="button"
            disabled={!pode}
            onClick={() => onTrocarModo(k)}
            className={`rounded-md px-3 py-1 ${modo === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          >
            {lb}
          </button>
        ))}
      </div>

      {modo === 'raio' ? (
        <FaixasRaio raios={raios} onRaios={onRaios} onSalvar={onSalvarRaios} salvando={salvando} pode={pode} />
      ) : (
        <ListaBairros bairros={bairros} onSalvar={onSalvarBairros} salvando={salvando} pode={pode} />
      )}
    </div>
  );
}

function ListaBairros({ bairros, onSalvar, salvando, pode }: { bairros: any[]; onSalvar: (l: any[]) => void; salvando: boolean; pode: boolean }) {
  const [lista, setLista] = useState<any[]>(bairros);
  useEffect(() => { setLista(bairros); }, [bairros]);
  function add() { setLista((l) => [...l, { nome: '', taxa: 0, ativo: true }]); }
  function up(i: number, patch: any) { setLista((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x))); }
  function rem(i: number) { setLista((l) => l.filter((_, j) => j !== i)); }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Bairro + taxa. O marcador liga/desliga cada bairro.</p>
      {lista.length === 0 && <p className="text-sm text-muted-foreground">Nenhum bairro cadastrado.</p>}
      {lista.map((b, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2">
          <input type="checkbox" className="h-4 w-4 accent-primary" disabled={!pode} checked={b.ativo !== false} onChange={(e) => up(i, { ativo: e.target.checked })} title="Ativar/desativar" />
          <Input value={b.nome} onChange={(e) => up(i, { nome: e.target.value })} placeholder="Bairro" className="h-8 flex-1" disabled={!pode} />
          <span className="text-xs text-muted-foreground">R$</span>
          <Input inputMode="decimal" value={b.taxa} onChange={(e) => up(i, { taxa: e.target.value })} className="h-8 w-20" disabled={!pode} />
          {pode && <button type="button" className="text-xs text-destructive" onClick={() => rem(i)}>remover</button>}
        </div>
      ))}
      {pode && (
        <div className="flex items-center justify-between pt-1">
          <Button type="button" size="sm" variant="outline" onClick={add}>＋ Bairro</Button>
          <Button type="button" onClick={() => onSalvar(lista)} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      )}
    </div>
  );
}

const RAIO_PRESETS: { km: number; label: string }[] = [
  { km: 0.5, label: '500m' }, { km: 1, label: '1km' }, { km: 1.5, label: '1,5km' },
  { km: 2, label: '2km' }, { km: 2.5, label: '2,5km' }, { km: 3, label: '3km' },
  { km: 3.5, label: '3,5km' }, { km: 4, label: '4km' }, { km: 5, label: '5km' },
  { km: 6, label: '6km' }, { km: 7, label: '7km' }, { km: 999, label: '7km+' },
];

function FaixasRaio({ raios, onRaios, onSalvar, salvando, pode }: { raios: any[]; onRaios: (r: any[]) => void; onSalvar: () => void; salvando: boolean; pode: boolean }) {
  const lista = raios ?? [];
  function add(ateKm: any = '') { onRaios([...lista, { ateKm, taxa: 0 }].sort((a, b) => (Number(a.ateKm) || 9999) - (Number(b.ateKm) || 9999))); }
  function up(i: number, patch: any) { onRaios(lista.map((x, j) => (j === i ? { ...x, ...patch } : x))); }
  function rem(i: number) { onRaios(lista.filter((_, j) => j !== i)); }
  const jaTem = (km: number) => lista.some((r) => Number(r.ateKm) === km);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Faixas de distância a partir do endereço da loja: “até X km custa R$Y”. Toque num preset para adicionar e depois preencha a taxa.</p>
      {/* Presets rápidos */}
      {pode && (
        <div className="flex flex-wrap gap-1.5">
          {RAIO_PRESETS.map((p) => (
            <button
              key={p.km}
              type="button"
              disabled={jaTem(p.km)}
              onClick={() => add(p.km)}
              className="rounded-full border border-border px-2.5 py-1 text-xs hover:border-primary hover:text-primary disabled:opacity-40"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      {lista.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma faixa. Ex.: até 3 km R$5, até 6 km R$9.</p>}
      {lista.map((r, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm">
          <span>até</span>
          <Input inputMode="decimal" value={r.ateKm} onChange={(e) => up(i, { ateKm: e.target.value })} className="h-8 w-20" disabled={!pode} />
          <span>km</span>
          <span className="ml-2 text-muted-foreground">R$</span>
          <Input inputMode="decimal" value={r.taxa} onChange={(e) => up(i, { taxa: e.target.value })} className="h-8 w-20" disabled={!pode} />
          {pode && <button type="button" className="ml-auto text-xs text-destructive" onClick={() => rem(i)}>remover</button>}
        </div>
      ))}
      <p className="rounded bg-ok/10 px-2 py-1 text-[11px] text-ok">O frete por distância usa a geolocalização do cliente (📍 no checkout) e o ponto da loja (aba Endereço). Defina o ponto da loja em Endereço.</p>
      {pode && (
        <div className="flex items-center justify-between pt-1">
          <Button type="button" size="sm" variant="outline" onClick={() => add()}>＋ Faixa manual</Button>
          <Button type="button" onClick={onSalvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      )}
    </div>
  );
}

// Ponto da loja no mapa (base do frete por raio).
export function PontoLojaMapa({ loja, up, pode }: { loja: any; up: (p: any) => void; pode: boolean }) {
  const [msg, setMsg] = useState('');
  const lat = Number(loja.endLat);
  const lng = Number(loja.endLng);
  const temPonto = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
  const embed = temPonto ? mapaEmbedUrl(lat, lng) : '';
  async function usarAtual() {
    setMsg('Obtendo localização…');
    try {
      const c = await localizacaoAtual();
      up({ endLat: c.lat, endLng: c.lng });
      setMsg('📍 Ponto definido pela sua localização.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Falha ao localizar.');
    }
  }
  async function geocodar() {
    const endereco = [loja.endRua, loja.endNumero, loja.endBairro, loja.endCidade, loja.endEstado]
      .filter(Boolean)
      .join(', ');
    setMsg('Geocodificando o endereço…');
    const c = await geocodificar(endereco || (loja.endCep ?? ''));
    if (c) {
      up({ endLat: c.lat, endLng: c.lng });
      setMsg('📍 Ponto definido pelo endereço.');
    } else {
      setMsg('Endereço não encontrado. Confira rua/número/cidade ou use "Usar minha localização".');
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-sm font-semibold">Ponto da loja no mapa</p>
      <p className="text-xs text-muted-foreground">Base para o frete por distância (raio). Defina pelo endereço, pela sua localização, ou ajuste as coordenadas.</p>
      {pode && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={geocodar}>Definir pelo endereço</Button>
          <Button type="button" size="sm" variant="outline" onClick={usarAtual}>Usar minha localização</Button>
        </div>
      )}
      <div className="flex gap-2">
        <Campo label="Latitude"><Input value={loja.endLat ?? ''} onChange={(e) => up({ endLat: e.target.value })} disabled={!pode} /></Campo>
        <Campo label="Longitude"><Input value={loja.endLng ?? ''} onChange={(e) => up({ endLng: e.target.value })} disabled={!pode} /></Campo>
      </div>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      {embed ? (
        <iframe title="Mapa da loja" src={embed} className="h-56 w-full rounded-lg border-0" loading="lazy" allowFullScreen />
      ) : (
        <p className="text-xs text-muted-foreground">Defina o ponto para ver o mapa.</p>
      )}
    </div>
  );
}

const areaTxt = 'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm';

// Conectar o WhatsApp da loja (Evolution): mostra o QR e faz polling do status.
function ConectarWhatsapp({ pode }: { pode: boolean }) {
  const [status, setStatus] = useState<any>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [inst, setInst] = useState('');
  const [avancado, setAvancado] = useState(false);
  const [diag, setDiag] = useState<any>(null);
  const [diagBusy, setDiagBusy] = useState(false);

  async function testar() {
    setDiagBusy(true); setErro('');
    try { setDiag(await api.whatsappDiagnostico()); } catch (e) { setErro(e instanceof Error ? e.message : 'Erro no diagnóstico'); }
    finally { setDiagBusy(false); }
  }

  async function vincular() {
    if (!inst.trim()) { setErro('Informe o nome exato da conexão existente.'); return; }
    setBusy(true); setErro('');
    try {
      const r: any = await api.whatsappVincular(inst.trim());
      setStatus({ conectado: r?.conectado, estado: r?.estado, instancia: r?.instancia });
      if (!r?.conectado) setErro(`Vinculado, mas a instância está "${r?.estado}". Confira se está Connected no Evolution.`);
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao vincular'); }
    finally { setBusy(false); }
  }

  async function carregarStatus() {
    try { setStatus(await api.whatsappStatus()); } catch { /* ignore */ }
  }
  useEffect(() => { carregarStatus(); }, []);
  // Enquanto o QR está na tela, verifica a cada 3s se pareou.
  useEffect(() => {
    if (!qr) return;
    const t = setInterval(async () => {
      try {
        const s: any = await api.whatsappStatus();
        setStatus(s);
        if (s?.conectado) { setQr(null); clearInterval(t); }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(t);
  }, [qr]);

  // O código do WhatsApp expira em menos de 1 minuto. Sem renovar, o gestor aponta
  // o celular para um QR morto e "não conecta". Renova sozinho enquanto está na tela.
  useEffect(() => {
    if (!qr || status?.conectado) return;
    const t = setInterval(async () => {
      try {
        const r: any = await api.whatsappConectar();
        if (r?.qr) setQr(r.qr);
      } catch { /* ignore */ }
    }, 30000);
    return () => clearInterval(t);
  }, [qr, status?.conectado]);

  async function conectar() {
    setBusy(true); setErro('');
    try {
      const r: any = await api.whatsappConectar();
      setQr(r?.qr ?? null);
      if (!r?.qr) setErro('Não foi possível gerar o QR agora. Tente novamente em instantes ou fale com o suporte.');
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao conectar'); }
    finally { setBusy(false); }
  }
  async function desconectar() {
    if (!confirm('Desconectar o WhatsApp desta loja?')) return;
    try { await api.whatsappDesconectar(); setQr(null); carregarStatus(); } catch { /* ignore */ }
  }

  const conectado = status?.conectado;
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">WhatsApp da loja</p>
          <p className="text-xs text-muted-foreground">
            {conectado
              ? `● Conectado${status?.instancia ? ` · ${status.instancia}` : ''}`
              : 'Conecte o número do WhatsApp que o robô vai atender.'}
          </p>
        </div>
        {pode && (
          conectado
            ? <Button type="button" size="sm" variant="outline" onClick={desconectar}>Desconectar</Button>
            : <Button type="button" size="sm" onClick={conectar} disabled={busy}>{busy ? 'Gerando…' : (qr ? 'Gerar novo QR' : 'Conectar WhatsApp')}</Button>
        )}
      </div>
      {pode && !conectado && (
        <div className="mt-2">
          <button type="button" className="text-[11px] text-muted-foreground underline" onClick={() => setAvancado((v) => !v)}>
            {avancado ? 'ocultar avançado' : 'avançado — já tenho uma instância'}
          </button>
          {avancado && (
            <div className="mt-1 space-y-2 rounded-lg border border-dashed border-border p-2">
              <div>
                <Button type="button" size="sm" variant="outline" disabled={diagBusy} onClick={testar}>
                  {diagBusy ? 'Testando…' : 'Testar conexão'}
                </Button>
              </div>
              {diag && (
                <div className="rounded-md bg-secondary/60 p-2 text-[11px]">
                  <p>{diag.urlSet ? '✅' : '❌'} URL configurada {diag.url ? <span className="text-muted-foreground">({diag.url})</span> : ''}</p>
                  <p>{diag.keySet ? '✅' : '❌'} Chave configurada</p>
                  <p>{diag.evolutionOk ? '✅ Evolution respondeu' : '❌ Evolution não respondeu'}</p>
                  {diag.erro && <p className="mt-1 text-destructive">{diag.erro}</p>}
                  {diag.instanciaVinculada && <p className="mt-1">Instância vinculada: <strong>{diag.instanciaVinculada}</strong></p>}
                  <p>
                    {diag.webhookConfigurado ? '✅' : '❌'} Atendimento automático configurado no servidor
                    {diag.webhookAtivo === false && <span className="text-destructive"> · esta conexão está sem o robô</span>}
                  </p>
                  {diag.instancias?.length > 0 && (
                    <div className="mt-1">
                      <p className="font-semibold">Esta loja no Evolution (clique p/ usar):</p>
                      {diag.instancias.map((x: any) => (
                        <button key={x.nome} type="button" onClick={() => setInst(x.nome)} className="mr-1 mt-1 rounded bg-card px-1.5 py-0.5 hover:bg-primary/10">
                          {x.nome} <span className="text-muted-foreground">· {x.estado}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">Migração/suporte: cole o <strong>nome exato</strong> de uma instância existente para reaproveitar os chats, sem escanear de novo.</p>
              <div className="flex gap-2">
                <Input value={inst} onChange={(e) => setInst(e.target.value)} placeholder="nome exato da conexão" className="h-8" disabled={busy} />
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={vincular}>Vincular</Button>
              </div>
            </div>
          )}
        </div>
      )}
      {qr && !conectado && (
        <div className="mt-3 flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR do WhatsApp" className="h-56 w-56 rounded-lg border border-border" />
          <p className="text-xs text-muted-foreground">No celular da loja: WhatsApp → Aparelhos conectados → <strong>Conectar aparelho</strong> → aponte para o QR.</p>
          <p className="text-[11px] text-muted-foreground">O código se renova sozinho a cada 30 segundos — deixe esta tela aberta.</p>
        </div>
      )}
      {erro && <p className="mt-2 text-xs text-destructive">{erro}</p>}
    </div>
  );
}

function Robo({ loja, up, onSalvar, salvando, pode }: { loja: any; up: (p: any) => void; onSalvar: () => void; salvando: boolean; pode: boolean }) {
  const msgs: any[] = loja.roboMensagens ?? [];
  const setMsgs = (m: any[]) => up({ roboMensagens: m });
  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
        ℹ️ Este robô é do <strong>cardápio digital do Regem</strong>. Se a sua loja usa um cardápio externo (Cardápio Web, Anota Aí, Delivery Web…), o robô de atendimento é o <strong>desse cardápio</strong> — aqui o Regem apenas centraliza e administra os pedidos.
      </p>
      <ConectarWhatsapp pode={pode} />
      <p className="text-xs text-muted-foreground">Robô de auto atendimento do cardápio/WhatsApp. Aqui você configura as <strong>mensagens</strong>. O “cérebro” com IA (respostas livres) entra numa etapa dedicada.</p>
      <ToggleLinha label="Robô ativo" desc="Responde os clientes automaticamente." checked={!!loja.roboAtivo} onChange={(v) => up({ roboAtivo: v })} pode={pode} />

      <Campo label="Saudação (primeira mensagem)">
        <textarea rows={2} className={areaTxt} disabled={!pode} value={loja.roboSaudacao ?? ''} onChange={(e) => up({ roboSaudacao: e.target.value })} placeholder="Olá! 👋 Bem-vindo. Como posso ajudar?" />
      </Campo>
      <Campo label="Mensagem de ausência (loja fechada/pausada)">
        <textarea rows={2} className={areaTxt} disabled={!pode} value={loja.roboAusencia ?? ''} onChange={(e) => up({ roboAusencia: e.target.value })} placeholder="No momento estamos fechados. Nosso horário é…" />
      </Campo>

      {/* Mensagens pré-definidas */}
      <div className="space-y-2">
        <Label className="text-xs">Respostas prontas (gatilho → resposta)</Label>
        {msgs.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma. Ex.: “horário” → “Funcionamos das 18h às 23h”.</p>}
        {msgs.map((m, i) => (
          <div key={i} className="flex items-start gap-2 rounded-lg border border-border p-2">
            <Input value={m.gatilho} onChange={(e) => setMsgs(msgs.map((x, j) => (j === i ? { ...x, gatilho: e.target.value } : x)))} placeholder="gatilho (ex.: horário)" className="h-8 w-40" disabled={!pode} />
            <textarea rows={2} className={`${areaTxt} flex-1`} disabled={!pode} value={m.resposta} onChange={(e) => setMsgs(msgs.map((x, j) => (j === i ? { ...x, resposta: e.target.value } : x)))} placeholder="resposta" />
            {pode && <button type="button" className="mt-1 text-xs text-destructive" onClick={() => setMsgs(msgs.filter((_, j) => j !== i))}>x</button>}
          </div>
        ))}
        {pode && <Button type="button" size="sm" variant="outline" onClick={() => setMsgs([...msgs, { gatilho: '', resposta: '' }])}>＋ Resposta</Button>}
      </div>

      <Campo label="Base de conhecimento (para a IA — futuro)">
        <textarea rows={4} className={areaTxt} disabled={!pode} value={loja.roboPrompt ?? ''} onChange={(e) => up({ roboPrompt: e.target.value })} placeholder="Descreva o negócio, produtos, políticas de entrega, troca, etc. Será usado pelo robô com IA quando ativarmos o cérebro." />
      </Campo>
      <p className="rounded bg-warn/10 px-2 py-1 text-[11px] text-warn">As respostas livres por IA (usando a base de conhecimento) entram numa etapa dedicada — precisa de um provedor de IA (custo por uso). As mensagens acima já funcionam sem IA.</p>

      <SalvarBar onSalvar={onSalvar} salvando={salvando} pode={pode} />
    </div>
  );
}

const CANAL_NOME: Record<string, string> = { ifood: 'iFood', rappi: 'Rappi', '99food': '99Food', anotaai: 'Anota Aí', keeta: 'Keeta', delivery_direto: 'Delivery Direto', open_delivery: 'Open Delivery (Abrasel)', cardapio_web: 'Cardápio Web', n8n: 'WhatsApp / n8n', mercadopago: 'Mercado Pago', iugu: 'Iugu' };

// Mercado Pago, Iugu e WhatsApp/n8n são recursos do CARDÁPIO DIGITAL do Regem —
// só aparecem quando ele está ativo (senão a loja usa cardápio externo e o Regem
// é só centralizador de pedidos).
const CANAIS_DO_CARDAPIO = ['mercadopago', 'iugu', 'n8n'];

// Metadados por plataforma: cor da marca (fundo do card, editável) + caminho do logo.
// As imagens ficam em /public/integracoes/<arquivo> — se o arquivo não existir, o card
// cai num fallback bonito (quadrado na cor da marca com as iniciais). Uso legítimo das
// marcas numa tela de integração (igual todo PDV mostra as plataformas parceiras).
const PLAT_META: Record<string, { cor: string; logo?: string }> = {
  ifood: { cor: '#EA1D2C', logo: '/integracoes/ifood.png' },
  '99food': { cor: '#FFC800', logo: '/integracoes/99food.png' },
  delivery_direto: { cor: '#FF5A1F', logo: '/integracoes/delivery-direto.png' },
  cardapio_web: { cor: '#00A868', logo: '/integracoes/cardapio-web.png' },
  rappi: { cor: '#FF441F', logo: '/integracoes/rappi.png' },
  anotaai: { cor: '#6C2BD9', logo: '/integracoes/anotaai.png' },
  keeta: { cor: '#FFC800', logo: '/integracoes/keeta.png' },
  n8n: { cor: '#EA4B71', logo: '/integracoes/n8n.png' },
  mercadopago: { cor: '#009EE3', logo: '/integracoes/mercado-pago.png' },
  iugu: { cor: '#00A5A5', logo: '/integracoes/iugu.png' },
};

// Texto legível sobre a cor da marca (tinta escura em cores claras, branco em escuras).
function textoContraste(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return '#0F2230';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#0F2230' : '#ffffff';
}

function LogoPlataforma({ canal, nome, cor, tam = 'md' }: { canal: string; nome: string; cor: string; tam?: 'sm' | 'md' }) {
  const [erro, setErro] = useState(false);
  const meta = PLAT_META[canal];
  const box = tam === 'sm' ? 'h-9 w-9' : 'h-12 w-12';
  if (meta?.logo && !erro) {
    return <img src={meta.logo} alt={nome} onError={() => setErro(true)} className={`${box} rounded-lg object-contain`} />;
  }
  return (
    <span className={`flex ${box} items-center justify-center rounded-lg font-display text-sm font-bold`} style={{ background: cor, color: textoContraste(cor) }}>
      {nome.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()}
    </span>
  );
}

function PlataformaCard({ it, onClick }: { it: any; onClick: () => void }) {
  const nome = CANAL_NOME[it.canal] ?? it.canal;
  const cor = it.cor || PLAT_META[it.canal]?.cor || '#64748b';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Configurar ${nome}`}
      className="group flex w-[104px] flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-2 py-2.5 text-center transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${it.ativo ? 'bg-ok/15 text-ok' : 'bg-secondary text-muted-foreground'}`}>
        <span className={`h-2 w-2 rounded-full ${it.ativo ? 'bg-ok' : 'bg-muted-foreground/40'}`} />
        {it.ativo ? 'ativo' : 'off'}
      </span>
      <LogoPlataforma canal={it.canal} nome={nome} cor={cor} tam="sm" />
      <span className="text-center text-[13px] font-semibold leading-tight">{nome}</span>
    </button>
  );
}

function ModalIntegracao({ it, onClose, children }: { it: any; onClose: () => void; children: any }) {
  const nome = CANAL_NOME[it.canal] ?? it.canal;
  const cor = it.cor || PLAT_META[it.canal]?.cor || '#64748b';
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Configurar ${nome}`}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:rounded-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3" style={{ boxShadow: `inset 0 3px 0 ${cor}` }}>
          <LogoPlataforma canal={it.canal} nome={nome} cor={cor} tam="sm" />
          <div className="font-display text-base font-bold">{nome}</div>
          <button type="button" onClick={onClose} className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Fechar">✕</button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function Integracoes({ lista, onSalvar, pode, cardapioAtivo }: { lista: any[]; onSalvar: (dto: any) => void; pode: boolean; cardapioAtivo: boolean }) {
  // n8n é webhook puro (sem UI de card) — não precisa aparecer na lista de integrações.
  const visiveis = lista.filter(
    (it) => it.canal !== 'n8n' && (cardapioAtivo || !CANAIS_DO_CARDAPIO.includes(it.canal)),
  );
  const [aberto, setAberto] = useState<string | null>(null);
  const itemAberto = visiveis.find((it) => it.canal === aberto);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Escolha uma plataforma para conectar. As chaves ficam guardadas com segurança e <strong>não são exibidas de volta</strong> — deixe o campo em branco para manter a atual.</p>
      {!cardapioAtivo && (
        <p className="rounded bg-secondary px-2 py-1 text-[11px] text-muted-foreground">Mercado Pago, Iugu e WhatsApp/n8n aparecem quando o <strong>cardápio digital do Regem</strong> está ativo — são recursos dele.</p>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        {visiveis.map((it) => (
          <PlataformaCard key={it.canal} it={it} onClick={() => setAberto(it.canal)} />
        ))}
      </div>
      {itemAberto && (
        <ModalIntegracao it={itemAberto} onClose={() => setAberto(null)}>
          <IntegracaoCard it={itemAberto} onSalvar={onSalvar} pode={pode} />
        </ModalIntegracao>
      )}
    </div>
  );
}

function IntegracaoCard({ it, onSalvar, pode }: { it: any; onSalvar: (dto: any) => void; pode: boolean }) {
  const [ativo, setAtivo] = useState(!!it.ativo);
  const [merchantId, setMerchantId] = useState(it.merchantId ?? '');
  const [clientId, setClientId] = useState(it.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [tokenV, setTokenV] = useState('');
  const [cor, setCor] = useState(it.cor ?? '');
  // Delivery Direto tem URL base fixa — pré-preenche quando ainda não há merchantId.
  useEffect(() => {
    setAtivo(!!it.ativo);
    setMerchantId(it.merchantId ?? (it.canal === 'delivery_direto' ? 'https://deliverydireto.com.br/open-delivery-api/v1' : ''));
    setClientId(it.clientId ?? '');
    setCor(it.cor ?? '');
  }, [it]);
  // Cor de identificação no kanban — só cardápios/marketplaces (não pagamento/robô).
  const temCor = !['n8n', 'iugu', 'mercadopago'].includes(it.canal);
  const ehN8n = it.canal === 'n8n';
  const ehIugu = it.canal === 'iugu';
  const ehMp = it.canal === 'mercadopago';
  const ehGatewayPix = ehIugu || ehMp;
  const ehCw = it.canal === 'cardapio_web';
  const ehFood99 = it.canal === '99food';
  const ehDD = it.canal === 'delivery_direto';
  const ehOD = it.canal === 'open_delivery' || ehDD;
  const ehAnota = it.canal === 'anotaai';
  const ehIfood = it.canal === 'ifood';
  const DD_BASE = 'https://deliverydireto.com.br/open-delivery-api/v1';
  const [ifoodMsg, setIfoodMsg] = useState('');
  const [ifoodBusy, setIfoodBusy] = useState(false);
  // Estado do pedido de integração do iFood (vem do listarIntegracoes.pedidoStatus).
  const ifoodStatus: string | null = it.pedidoStatus ?? null;
  const ifoodPendente = ifoodStatus === 'pendente';
  const ifoodConectado = !!it.ativo && ifoodStatus === 'conectado';
  async function solicitarIfood() {
    setIfoodBusy(true);
    setIfoodMsg('');
    try {
      await api.ifoodSolicitar();
      onSalvar({ canal: it.canal, cor: cor || '' }); // persiste só a cor (não mexe em credencial)
      setIfoodMsg('Solicitação enviada. A equipe Regem vai pedir a autorização da sua loja no iFood — autorize no seu Portal do Parceiro (Integrações) e ativamos.');
    } catch (e: any) {
      setIfoodMsg('Erro ao solicitar: ' + (e?.message ?? ''));
    } finally {
      setIfoodBusy(false);
    }
  }
  async function desativarIfood() {
    if (!confirm('Desativar a integração com o iFood? A equipe Regem será avisada para remover a sua loja do aplicativo no portal.')) return;
    setIfoodBusy(true);
    setIfoodMsg('');
    try {
      await api.ifoodDesativar();
      setIfoodMsg('Desativação solicitada. Avisamos a distribuição para remover a loja do app no portal.');
    } catch (e: any) {
      setIfoodMsg('Erro ao desativar: ' + (e?.message ?? ''));
    } finally {
      setIfoodBusy(false);
    }
  }
  const [ambiente, setAmbiente] = useState('producao');
  const [cwMsg, setCwMsg] = useState('');
  const [cwBusy, setCwBusy] = useState(false);
  const [f99Order, setF99Order] = useState('');
  const [f99Msg, setF99Msg] = useState('');
  const [f99Busy, setF99Busy] = useState(false);
  const [anotaMsg, setAnotaMsg] = useState('');
  const [anotaBusy, setAnotaBusy] = useState(false);
  async function salvarAnota() {
    setAnotaBusy(true);
    setAnotaMsg('');
    try {
      await api.anotaaiSalvarCredenciais({ token: tokenV });
      // Persiste a cor do card (config.cor), sem tocar no token.
      onSalvar({ canal: it.canal, cor: cor || '' });
      setAnotaMsg('Token salvo. Enviamos o pedido de integração para a equipe Regem finalizar a conexão — avisamos quando ativar.');
      setTokenV('');
    } catch (e: any) {
      setAnotaMsg('Erro ao salvar: ' + (e?.message ?? ''));
    } finally {
      setAnotaBusy(false);
    }
  }
  async function importarCatalogoAnota() {
    setAnotaBusy(true);
    setAnotaMsg('Importando catálogo…');
    try {
      const r: any = await api.anotaaiImportarCatalogo();
      setAnotaMsg(`Catálogo importado: +${r?.produtos ?? 0} produtos, +${r?.categorias ?? 0} categorias, +${r?.complementos ?? 0} opções de complemento, ${r?.atualizados ?? 0} atualizados.`);
    } catch (e: any) {
      setAnotaMsg('Erro ao importar: ' + (e?.message ?? ''));
    } finally {
      setAnotaBusy(false);
    }
  }
  const [f99Token, setF99Token] = useState('');
  async function cardapioTesteF99() {
    setF99Busy(true);
    setF99Msg('Subindo cardápio de teste (1 item)…');
    try {
      const r: any = await api.food99CardapioTeste();
      if (r?.ok) setF99Msg(`Cardápio de teste subido. Use o APPitemID "${r.appItemId}" no Sandbox (Crie pedido). Aguarde ~1 min o 99Food processar.`);
      else setF99Msg(`Falha ao subir cardápio (errno ${r?.errno ?? '?'}). Vou ver o log.`);
    } catch (e: any) {
      setF99Msg('Erro ao subir cardápio: ' + (e?.message ?? ''));
    } finally {
      setF99Busy(false);
    }
  }
  async function exportarCatalogoF99() {
    setF99Busy(true);
    setF99Msg('Exportando cardápio do Regem pro 99Food…');
    try {
      const r: any = await api.food99ExportarCatalogo();
      setF99Msg(`Cardápio exportado: ${r?.produtos ?? 0} itens em ${r?.categorias ?? 0} categorias.`);
    } catch (e: any) {
      setF99Msg('Erro ao exportar: ' + (e?.message ?? ''));
    } finally {
      setF99Busy(false);
    }
  }
  async function buscarTokenF99() {
    setF99Busy(true);
    setF99Msg('Gerando token da loja…');
    setF99Token('');
    try {
      const r: any = await api.food99Token();
      if (r?.ok && r?.token) {
        setF99Token(r.token);
        setF99Msg(`Token gerado (auth OK). Expira em ${r.expiraEm ? new Date(r.expiraEm).toLocaleString('pt-BR') : '—'}. Cole na Ferramenta de Sandbox do 99Food.`);
      } else {
        setF99Msg('Não consegui gerar token — confira App ID / App Secret / App Shop ID e salve de novo.');
      }
    } catch (e: any) {
      setF99Msg('Erro ao gerar token: ' + (e?.message ?? ''));
    } finally {
      setF99Busy(false);
    }
  }
  async function salvarF99() {
    setF99Busy(true);
    setF99Msg('');
    try {
      await api.food99SalvarCredenciais({ appId: clientId, appSecret: clientSecret, appShopId: merchantId });
      setF99Msg('Credenciais salvas. Registre o webhook no portal do 99Food e dispare um pedido no Sandbox.');
      setClientSecret('');
    } catch (e: any) {
      setF99Msg('Erro ao salvar: ' + (e?.message ?? ''));
    } finally {
      setF99Busy(false);
    }
  }
  async function puxarF99() {
    if (!f99Order.trim()) { setF99Msg('Informe o order_id do pedido de teste.'); return; }
    setF99Busy(true);
    setF99Msg('Puxando pedido…');
    try {
      const r: any = await api.food99Puxar(f99Order.trim());
      setF99Msg(r?.ok ? 'Pedido importado do 99Food.' : 'Pedido não encontrado (confira order_id e credenciais).');
    } catch (e: any) {
      setF99Msg('Erro ao puxar: ' + (e?.message ?? ''));
    } finally {
      setF99Busy(false);
    }
  }
  const [unidadeSel, setUnidadeSel] = useState('');
  useEffect(() => {
    if (!ehCw) return;
    api
      .unidades()
      .then((u: any) => {
        const lista = (u as any[]) ?? [];
        setUnidadeSel(
          (prev) =>
            prev ||
            it.unidadeId ||
            getUnidadeAtual() ||
            lista.find((x: any) => x.tipo === 'matriz')?.id ||
            lista[0]?.id ||
            '',
        );
      })
      .catch(() => {});
  }, [ehCw, it.unidadeId]);
  async function salvarCw() {
    setCwBusy(true);
    setCwMsg('');
    try {
      await api.cardapioWebSalvarChave({
        apiKey: tokenV,
        codigoLoja: merchantId,
        ambiente,
        unidadeId: unidadeSel || undefined,
      });
      // Persiste a cor do card (config.cor), sem tocar na chave/env.
      onSalvar({ canal: it.canal, cor: cor || '' });
      setCwMsg('Salvo. O Regem já puxa os pedidos do Cardápio Web.');
      setTokenV('');
    } catch (e: any) {
      setCwMsg('Erro ao salvar: ' + (e?.message ?? ''));
    } finally {
      setCwBusy(false);
    }
  }
  async function importarCatalogoCw() {
    setCwBusy(true);
    setCwMsg('Importando catálogo…');
    try {
      const r: any = await api.cardapioWebImportarCatalogo();
      setCwMsg(`Catálogo importado: +${r?.produtos ?? 0} produtos, +${r?.categorias ?? 0} categorias, +${r?.complementos ?? 0} opções de complemento, ${r?.atualizados ?? 0} atualizados.`);
    } catch (e: any) {
      setCwMsg('Erro ao importar: ' + (e?.message ?? ''));
    } finally {
      setCwBusy(false);
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        {/* iFood ativa pelo fluxo de solicitação (abaixo), não pelo checkbox. */}
        {!ehIfood && (
          <label className="ml-auto flex items-center gap-1 text-xs">
            <input type="checkbox" className="h-4 w-4 accent-primary" disabled={!pode} checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> ativo
          </label>
        )}
      </div>
      {ehIfood ? (
        <>
          <p className="text-[11px] text-muted-foreground">Integração oficial do <strong>iFood</strong>. Você <strong>não precisa preencher nada</strong> — a Regem é parceira técnica do iFood. Ao solicitar, nossa equipe pede a <strong>autorização da sua loja</strong> no iFood; você recebe o pedido no seu <strong>Portal do Parceiro → Integrações</strong>. Assim que autorizar, a integração é ativada automaticamente.</p>
          {ifoodConectado ? (
            <p className="rounded bg-ok/10 px-2 py-1 text-[11px] font-semibold text-ok">✓ Conectado ao iFood — pedidos entram automaticamente.</p>
          ) : ifoodPendente ? (
            <p className="rounded bg-warn/10 px-2 py-1 text-[11px] font-semibold text-warn">⏳ Solicitação enviada — aguardando a equipe Regem finalizar a conexão (após você autorizar no Portal do Parceiro).</p>
          ) : ifoodStatus === 'pendente_remocao' ? (
            <p className="rounded bg-warn/10 px-2 py-1 text-[11px] font-semibold text-warn">Remoção solicitada — aguardando a distribuição tirar a loja do app.</p>
          ) : null}
          {ifoodMsg && <p className="text-[11px] text-muted-foreground">{ifoodMsg}</p>}
          {pode && (
            <div className="flex flex-wrap justify-end gap-2">
              {ifoodConectado || ifoodPendente ? (
                <Button type="button" size="sm" variant="outline" disabled={ifoodBusy} onClick={desativarIfood}>Desativar</Button>
              ) : (
                <Button type="button" size="sm" disabled={ifoodBusy} onClick={solicitarIfood}>Solicitar integração</Button>
              )}
            </div>
          )}
        </>
      ) : ehN8n ? (
        <>
          <p className="text-[11px] text-muted-foreground">O Regem avisa esta URL quando o pedido muda de status <strong>e para enviar o código OTP</strong> do cliente (o robô notifica no WhatsApp). O campo <code>evento</code> do corpo diz o que é: <code>status</code> ou <code>otp</code> — trate os dois no seu fluxo. O segredo assina a chamada (cabeçalho <code>X-Regem-Signature</code>).</p>
          <div className="grid gap-2">
            <Campo label="URL do webhook (do seu n8n)"><Input value={merchantId} onChange={(e) => setMerchantId(e.target.value)} placeholder="https://seu-n8n/webhook/regem-status" className="h-8" disabled={!pode} /></Campo>
            <Campo label={`Segredo${it.temSecret ? ' (salvo)' : ''}`}>
              <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={it.temSecret ? '•••••• (mantém)' : 'uma frase secreta qualquer'} className="h-8" disabled={!pode} />
            </Campo>
          </div>
        </>
      ) : ehGatewayPix ? (
        <>
          {ehIugu ? (
            <>
              <p className="text-[11px] text-muted-foreground">PIX online direto na <strong>sua conta Iugu</strong> — o dinheiro cai em você, o Regem não toca no valor. Cole a <strong>Live API Token</strong> (Iugu → Configurações → Contas → API Tokens → copiar a <em>Live</em>). Quando ativa, tem prioridade sobre o Mercado Pago no cardápio.</p>
              <p className="rounded bg-warn/10 px-2 py-1 text-[11px] text-warn">Cadastre o webhook na sua Iugu (Configurações → Gatilhos), evento <strong>invoice.status_changed</strong>, URL: <code>https://api.dmsregem.com/api/v1/publico/cardapio/pagamento/iugu/webhook</code></p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-muted-foreground">PIX online direto na <strong>sua conta Mercado Pago</strong> — o dinheiro cai em você. Cole o <strong>Access Token</strong> de produção (Mercado Pago → Seus negócios → Configurações → Credenciais de produção → <em>Access Token</em>). A Iugu, se ativa, tem prioridade sobre este.</p>
              <p className="rounded bg-warn/10 px-2 py-1 text-[11px] text-warn">O webhook do Mercado Pago é automático (o Regem informa a URL na cobrança). Nada a cadastrar no painel do MP.</p>
            </>
          )}
          <Campo label={`${ehIugu ? 'Live API Token' : 'Access Token'}${it.temToken ? ' (salvo)' : ''}`}>
            <Input type="password" value={tokenV} onChange={(e) => setTokenV(e.target.value)} placeholder={it.temToken ? '•••••• (mantém)' : ehIugu ? 'cole a Live API Token da Iugu' : 'cole o Access Token de produção do Mercado Pago'} className="h-8" disabled={!pode} />
          </Campo>
        </>
      ) : ehCw ? (
        <>
          <p className="text-[11px] text-muted-foreground">API Aberta do Cardápio Web (modo chave). No painel do Cardápio Web em <strong>Configurações → Integrações → API de integração</strong>: copie o <strong>código da loja</strong> e clique <strong>gerar novo token</strong>. O Regem puxa os pedidos, joga no KDS e os <strong>aceita de volta</strong> automaticamente.</p>
          <div className="grid gap-2">
            <Campo label="Código da loja"><Input value={merchantId} onChange={(e) => setMerchantId(e.target.value)} placeholder="ex.: 59412" className="h-8" disabled={!pode} /></Campo>
            <Campo label={`Token (API Key)${it.temToken ? ' (salvo)' : ''}`}>
              <Input type="password" value={tokenV} onChange={(e) => setTokenV(e.target.value)} placeholder={it.temToken ? '•••••• (deixe em branco p/ manter)' : 'cole o token gerado no painel'} className="h-8" disabled={!pode} />
            </Campo>
          </div>
          {cwMsg && <p className="text-[11px] text-muted-foreground">{cwMsg}</p>}
          {pode && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" disabled={cwBusy} onClick={importarCatalogoCw} title="Cria os produtos no Regem a partir do cardápio do Cardápio Web">Importar catálogo</Button>
              <Button type="button" size="sm" disabled={cwBusy} onClick={salvarCw}>Salvar</Button>
            </div>
          )}
        </>
      ) : ehFood99 ? (
        <>
          <p className="text-[11px] text-muted-foreground">API do <strong>99Food (DiDi Food)</strong>. No portal do desenvolvedor (<strong>developer-food.99app.com</strong> → Gerenciamento de aplicativo → detalhes do app) copie o <strong>APP ID</strong> e o <strong>Secret</strong>; o <strong>App Shop ID</strong> é o que você definiu ao criar a loja de teste (ex.: <code>regemteste01</code>). O 99Food <strong>empurra os pedidos</strong> para o webhook abaixo — cadastre-o no app.</p>
          <p className="rounded bg-warn/10 px-2 py-1 text-[11px] text-warn">Webhook a registrar no 99Food (campo "Endereço do webhook"): <code>https://api.dmsregem.com/api/v1/integracoes/99food/webhook</code></p>
          <div className="grid gap-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Campo label="App ID"><Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="ex.: 5764607716243277863" className="h-8" disabled={!pode} /></Campo>
              <Campo label="App Shop ID"><Input value={merchantId} onChange={(e) => setMerchantId(e.target.value)} placeholder="ex.: regemteste01" className="h-8" disabled={!pode} /></Campo>
            </div>
            <Campo label={`App Secret${it.temSecret ? ' (salvo)' : ''}`}>
              <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={it.temSecret ? '•••••• (deixe em branco p/ manter)' : 'cole o Secret do app'} className="h-8" disabled={!pode} />
            </Campo>
          </div>
          {f99Msg && <p className="text-[11px] text-muted-foreground">{f99Msg}</p>}
          {f99Token && (
            <Campo label="Token da loja (cole na Ferramenta de Sandbox do 99Food)">
              <Input value={f99Token} readOnly onFocus={(e) => e.currentTarget.select()} className="h-8 font-mono text-[11px]" />
            </Campo>
          )}
          {pode && (
            <>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" disabled={f99Busy} onClick={exportarCatalogoF99} title="Cria as categorias/itens do Regem no 99Food">Exportar catálogo</Button>
                <Button type="button" size="sm" variant="ghost" disabled={f99Busy} onClick={cardapioTesteF99} title="Sobe 1 item de teste no cardápio da loja (pré-requisito do Sandbox)">Subir cardápio de teste</Button>
                <Button type="button" size="sm" variant="outline" disabled={f99Busy} onClick={buscarTokenF99} title="Gera um auth_token fresco da loja para colar no Sandbox do portal">Buscar token da loja</Button>
                <Button type="button" size="sm" disabled={f99Busy} onClick={salvarF99}>Salvar credenciais</Button>
              </div>
              <div className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
                <div className="flex-1 min-w-[10rem]">
                  <Campo label="Testar por order_id (sem webhook)"><Input value={f99Order} onChange={(e) => setF99Order(e.target.value)} placeholder="cole o order_id de um pedido de teste" className="h-8" disabled={!pode} /></Campo>
                </div>
                <Button type="button" size="sm" variant="outline" disabled={f99Busy} onClick={puxarF99}>Puxar pedido</Button>
              </div>
            </>
          )}
        </>
      ) : ehAnota ? (
        <>
          <p className="text-[11px] text-muted-foreground">Integração oficial da <strong>Anota Aí</strong>. ⚠️ Use o token do <strong>Portal de Integração</strong> (integracao.anota.ai → sua loja → “Token da sua loja”) — <strong>não</strong> o do app/painel da loja, que dá erro de autenticação. Cole aqui e salve; a distribuição finaliza a conexão e você recebe o aviso quando estiver ativa.</p>
          <div className="grid gap-2">
            <Campo label={`Token da loja${it.temToken ? ' (salvo)' : ''}`}>
              <Input type="password" value={tokenV} onChange={(e) => setTokenV(e.target.value)} placeholder={it.temToken ? '•••••• (deixe em branco p/ manter)' : 'cole o Token da loja (Authorization)'} className="h-8" disabled={!pode} />
            </Campo>
          </div>
          {anotaMsg && <p className="text-[11px] text-muted-foreground">{anotaMsg}</p>}
          {pode && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" disabled={anotaBusy} onClick={importarCatalogoAnota} title="Cria os produtos no Regem a partir do cardápio da Anota Aí">Importar catálogo</Button>
              <Button type="button" size="sm" disabled={anotaBusy} onClick={salvarAnota}>Salvar token</Button>
            </div>
          )}
        </>
      ) : ehOD ? (
        <>
          {ehDD ? (
            <p className="text-[11px] text-muted-foreground">Integração oficial do <strong>Delivery Direto</strong> (padrão Open Delivery). No painel do Delivery Direto, gere as <strong>credenciais de API</strong> (Client ID e Secret) e cole aqui. O Regem puxa os pedidos e devolve o status automaticamente.</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">Padrão aberto da Abrasel. Cole a <strong>URL base da API Open Delivery</strong> do marketplace e as credenciais OAuth. O Regem faz o polling dos pedidos e devolve o status automaticamente.</p>
          )}
          <div className="grid gap-2">
            {ehDD ? (
              <p className="rounded bg-secondary px-2 py-1 text-[11px] text-muted-foreground">Servidor: <code>{DD_BASE}</code> (padrão do Delivery Direto)</p>
            ) : (
              <Campo label="URL base da API Open Delivery"><Input value={merchantId} onChange={(e) => setMerchantId(e.target.value)} placeholder="https://.../open-delivery-api/v1" className="h-8" disabled={!pode} /></Campo>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Campo label="Client ID"><Input value={clientId} onChange={(e) => setClientId(e.target.value)} className="h-8" disabled={!pode} /></Campo>
              <Campo label={`Client Secret${it.temSecret ? ' (salvo)' : ''}`}>
                <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={it.temSecret ? '•••••• (mantém)' : ''} className="h-8" disabled={!pode} />
              </Campo>
            </div>
          </div>
        </>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Campo label="Merchant ID"><Input value={merchantId} onChange={(e) => setMerchantId(e.target.value)} className="h-8" disabled={!pode} /></Campo>
        <Campo label="Client ID"><Input value={clientId} onChange={(e) => setClientId(e.target.value)} className="h-8" disabled={!pode} /></Campo>
        <Campo label={`Client Secret${it.temSecret ? ' (salvo)' : ''}`}>
          <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={it.temSecret ? '•••••• (mantém)' : ''} className="h-8" disabled={!pode} />
        </Campo>
        <Campo label={`Token${it.temToken ? ' (salvo)' : ''}`}>
          <Input type="password" value={tokenV} onChange={(e) => setTokenV(e.target.value)} placeholder={it.temToken ? '•••••• (mantém)' : ''} className="h-8" disabled={!pode} />
        </Campo>
      </div>
      )}
      {pode && temCor && !ehFood99 && (
        <div className="flex items-center gap-2 border-t border-border pt-2">
          <span className="text-[11px] text-muted-foreground">Cor no quadro</span>
          <input type="color" aria-label="Cor de identificação no kanban" value={cor || '#888888'} onChange={(e) => setCor(e.target.value)} disabled={!pode} className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5" />
          {cor && <button type="button" className="text-[11px] text-muted-foreground underline" onClick={() => setCor('')}>usar padrão</button>}
          <span className="ml-auto rounded px-1.5 py-0.5 text-[11px] font-bold" style={{ background: cor || '#e5e7eb', color: cor ? '#fff' : '#666' }}>{CANAL_NOME[it.canal] ?? it.canal}</span>
        </div>
      )}
      {pode && !ehCw && !ehFood99 && !ehAnota && !ehIfood && (
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={() => onSalvar({ canal: it.canal, ativo, merchantId, clientId, clientSecret, token: tokenV, cor: cor || '' })}>Salvar</Button>
        </div>
      )}
    </div>
  );
}

// Prévia do cupom conforme os toggles (espelha renderViaCliente do backend).
function previewCupom(L: any): string {
  const on = (k: string) => L[k] !== false;
  const lines: string[] = [L.cabecalho?.trim() || 'REGEM', 'Cupom - via do cliente'];
  if (on('mostrarSenha')) lines.push('>>> SENHA 12 <<<');
  lines.push('--------------------------------');
  if (on('mostrarItens')) {
    lines.push('1x X-Burger');
    if (on('mostrarComplementos')) lines.push('   sem cebola · bacon extra');
    if (on('mostrarValoresItem')) lines.push('   R$ 28,00');
    lines.push('--------------------------------');
  }
  if (on('mostrarTotal')) lines.push('TOTAL: R$ 28,00');
  if (on('mostrarPagamento')) lines.push('Pagamento: dinheiro');
  if (on('mostrarAtendente')) lines.push('Atendente: Ana');
  if (on('mostrarData')) lines.push('21/07/2026 20:00');
  if (L.rodape?.trim()) { lines.push('--------------------------------'); lines.push(L.rodape.trim()); }
  return lines.join('\n');
}

const CUPOM_TOGGLES = [
  { k: 'mostrarSenha', label: 'Senha' },
  { k: 'mostrarItens', label: 'Itens' },
  { k: 'mostrarComplementos', label: 'Complementos / observação' },
  { k: 'mostrarValoresItem', label: 'Valor por item' },
  { k: 'mostrarTotal', label: 'Total' },
  { k: 'mostrarPagamento', label: 'Forma de pagamento' },
  { k: 'mostrarAtendente', label: 'Atendente' },
  { k: 'mostrarData', label: 'Data e hora' },
];

// Editor de layout do cupom (via do cliente) — o que sai na térmica. Ajuda
// produções sem KDS. Salva em delivery_config.cupomLayout (mig 131).
function CupomLayoutEditor({ cfg, onSave, pode }: { cfg: any; onSave: (p: any) => void; pode: boolean }) {
  const [local, setLocal] = useState<any>(cfg?.cupomLayout ?? {});
  useEffect(() => { setLocal(cfg?.cupomLayout ?? {}); }, [cfg?.cupomLayout]);
  const on = (k: string) => local[k] !== false;
  const set = (patch: any) => setLocal((s: any) => ({ ...s, ...patch }));
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="font-display text-sm font-bold">Layout do cupom (via do cliente)</p>
      <p className="mb-3 text-[11px] text-muted-foreground">Como o cupom sai nas impressoras térmicas — útil para produções sem KDS.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Campo label="Cabeçalho"><Input value={local.cabecalho ?? ''} onChange={(e) => set({ cabecalho: e.target.value })} placeholder="REGEM" className="h-8" disabled={!pode} /></Campo>
        <Campo label="Rodapé (mensagem final)"><Input value={local.rodape ?? ''} onChange={(e) => set({ rodape: e.target.value })} placeholder="Obrigado pela preferência!" className="h-8" disabled={!pode} /></Campo>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {CUPOM_TOGGLES.map((t) => (
          <label key={t.k} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={on(t.k)} onChange={(e) => set({ [t.k]: e.target.checked })} disabled={!pode} />
            {t.label}
          </label>
        ))}
      </div>
      <div className="mt-3">
        <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Prévia</p>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-secondary/40 p-2 font-mono text-[11px] leading-tight">{previewCupom(local)}</pre>
      </div>
      {pode && (
        <div className="mt-3 flex justify-end">
          <Button type="button" size="sm" onClick={() => onSave({ cupomLayout: local })}>Salvar layout</Button>
        </div>
      )}
    </div>
  );
}

function Impressoras({ lista, setores, onSalvar, onRemover, pode }: { lista: any[]; setores: any[]; onSalvar: (r: any) => Promise<any>; onRemover: (id: string) => void; pode: boolean }) {
  const [rows, setRows] = useState<any[]>(lista);
  useEffect(() => { setRows(lista); }, [lista]);
  function up(i: number, patch: any) { setRows((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x))); }
  function add() { setRows((l) => [...l, { nome: '', papel: 'cupom', setorId: '', conexao: 'rede', host: '', porta: 9100, dispositivo: '', vias: 1, ativo: true, _novo: true }]); }
  async function salvar(i: number) {
    const r = rows[i];
    const local = r.conexao === 'local';
    await onSalvar({
      id: r.id, nome: r.nome, papel: r.papel,
      setorId: r.papel === 'producao' ? r.setorId || null : null,
      conexao: r.conexao ?? 'rede',
      host: local ? null : r.host, porta: local ? null : r.porta,
      dispositivo: local ? r.dispositivo || null : null,
      vias: r.vias, ativo: r.ativo,
    });
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Direcione a impressão: <strong>Caixa</strong> (cupom do cliente) ou <strong>Cozinha</strong> (produção, por setor). A conexão pode ser <strong>Rede</strong> (impressora com IP) ou <strong>Local</strong> (USB/instalada no Windows do PDV).</p>
      <p className="rounded bg-warn/10 px-2 py-1 text-[11px] text-warn"><strong>Local (USB/Windows)</strong>: informe o <strong>nome exato</strong> da impressora como aparece no Windows (Painel de Controle → Dispositivos e Impressoras). A impressão local roda no <strong>servidor local (edge)</strong> — sem edge instalado, use uma impressora de rede.</p>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma impressora cadastrada.</p>}
      {rows.map((r, i) => (
        <div key={r.id ?? `n${i}`} className="space-y-2 rounded-lg border border-border p-2.5">
          <div className="flex items-center gap-2">
            <Input value={r.nome} onChange={(e) => up(i, { nome: e.target.value })} placeholder="Nome da impressora" className="h-8 flex-1" disabled={!pode} />
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="h-4 w-4 accent-primary" disabled={!pode} checked={r.ativo !== false} onChange={(e) => up(i, { ativo: e.target.checked })} /> ativa</label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <Label className="text-[11px]">Direcionamento</Label>
              <select value={r.papel} onChange={(e) => up(i, { papel: e.target.value })} aria-label="Direcionamento" className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm" disabled={!pode}>
                <option value="cupom">Caixa (cupom)</option>
                <option value="producao">Cozinha (produção)</option>
              </select>
            </div>
            {r.papel === 'producao' && (
              <div>
                <Label className="text-[11px]">Setor</Label>
                <select value={r.setorId ?? ''} onChange={(e) => up(i, { setorId: e.target.value })} aria-label="Setor" className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm" disabled={!pode}>
                  <option value="">Todos / geral</option>
                  {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </div>
            )}
            <div>
              <Label className="text-[11px]">Conexão</Label>
              <select value={r.conexao ?? 'rede'} onChange={(e) => up(i, { conexao: e.target.value })} aria-label="Conexão" className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm" disabled={!pode}>
                <option value="rede">Rede (IP)</option>
                <option value="local">Local (USB/Windows)</option>
              </select>
            </div>
            {r.conexao === 'local' ? (
              <div>
                <Label className="text-[11px]">Nome no Windows</Label>
                <Input value={r.dispositivo ?? ''} onChange={(e) => up(i, { dispositivo: e.target.value })} placeholder="Ex.: EPSON TM-T20" className="h-8 w-full" disabled={!pode} />
              </div>
            ) : (
              <div>
                <Label className="text-[11px]">IP : porta</Label>
                <div className="flex items-center gap-1">
                  <Input value={r.host ?? ''} onChange={(e) => up(i, { host: e.target.value })} placeholder="192.168.0.50" className="h-8 flex-1" disabled={!pode} />
                  <Input inputMode="numeric" value={r.porta ?? ''} onChange={(e) => up(i, { porta: e.target.value })} placeholder="9100" className="h-8 w-16" disabled={!pode} />
                </div>
              </div>
            )}
            <div>
              <Label className="text-[11px]">Vias</Label>
              <Input inputMode="numeric" value={r.vias ?? 1} onChange={(e) => up(i, { vias: e.target.value })} className="h-8 w-20" disabled={!pode} />
            </div>
          </div>
          {pode && (
            <div className="flex items-center justify-end gap-2">
              {r.id && <button type="button" className="text-xs text-destructive" onClick={() => onRemover(r.id)}>remover</button>}
              <Button type="button" size="sm" onClick={() => salvar(i)}>Salvar</Button>
            </div>
          )}
        </div>
      ))}
      {pode && <Button type="button" size="sm" variant="outline" onClick={add}>＋ Impressora</Button>}
    </div>
  );
}

// Decodifica o campo `link` do banner em {tipo, valor} para editar.
function parseAcao(link: string): { tipo: string; valor: string } {
  const s = link ?? '';
  if (s.startsWith('item:')) return { tipo: 'item', valor: s.slice(5) };
  if (s.startsWith('category:')) return { tipo: 'category', valor: s.slice(9) };
  if (s.startsWith('coupon:')) return { tipo: 'coupon', valor: s.slice(7) };
  if (/^https?:\/\//.test(s)) return { tipo: 'url', valor: s };
  return { tipo: '', valor: '' };
}
function montarAcao(tipo: string, valor: string): string {
  if (!tipo || !valor) return '';
  if (tipo === 'url') return valor;
  return `${tipo}:${valor}`;
}

function Banners({ banners, intervalo, onSalvar, salvando, pode }: { banners: any[]; intervalo: number; onSalvar: (l: any[], intervalo: number) => void; salvando: boolean; pode: boolean }) {
  const [lista, setLista] = useState<any[]>(banners);
  const [seg, setSeg] = useState<number>(intervalo);
  const [prods, setProds] = useState<any[]>([]);
  useEffect(() => { setLista(banners); }, [banners]);
  useEffect(() => { setSeg(intervalo); }, [intervalo]);
  useEffect(() => {
    api.produtos().then((p: any) => setProds(Array.isArray(p) ? p : [])).catch(() => {});
  }, []);
  // Categorias derivadas dos produtos (id → nome), sem endpoint extra.
  const cats = Array.from(
    new Map(prods.filter((p) => p.categoriaId).map((p) => [p.categoriaId, p.categoriaNome ?? p.categoriaId])).entries(),
  ).map(([id, nome]) => ({ id, nome }));

  function up(i: number, patch: any) { setLista((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x))); }
  function rem(i: number) { setLista((l) => l.filter((_, j) => j !== i)); }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= lista.length) return;
    const cp = [...lista];
    [cp[i], cp[j]] = [cp[j], cp[i]];
    setLista(cp);
  }
  // Atualiza o campo `link` do banner conforme a ação escolhida.
  function setAcao(i: number, tipo: string, valor: string) {
    up(i, { link: montarAcao(tipo, valor), _tipo: tipo });
  }
  const selCls = 'flex h-8 w-full rounded-md border border-input bg-card px-2 text-xs';

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Imagens que passam no topo do cardápio digital (máximo 3). Defina para onde cada banner leva ao tocar.</p>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Trocar de banner a cada</span>
        <Input type="number" min={1} value={seg} onChange={(e) => setSeg(Math.max(1, Number(e.target.value) || 2))} className="h-8 w-20" disabled={!pode} />
        <span className="text-muted-foreground">segundos {lista.length < 2 && '(vale com 2+ banners)'}</span>
      </label>
      {lista.map((b, i) => {
        const acao = parseAcao(b.link ?? '');
        const tipo = b._tipo ?? acao.tipo;
        return (
          <div key={i} className="flex items-start gap-3 rounded-lg border border-border p-2.5">
            <ImageUpload value={b.imagemRef} onChange={(url) => up(i, { imagemRef: url })} id={`banner-${i}`} alt="Banner" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Input value={b.titulo ?? ''} onChange={(e) => up(i, { titulo: e.target.value })} placeholder="Título / texto do botão (opcional)" className="h-8" disabled={!pode} />
              {/* Ação ao tocar (deep-link) */}
              <div className="flex gap-1.5">
                <select aria-label="Ação do banner" disabled={!pode} value={tipo} onChange={(e) => setAcao(i, e.target.value, '')} className={`${selCls} w-32 flex-none`}>
                  <option value="">Sem ação</option>
                  <option value="item">Abrir produto</option>
                  <option value="category">Ir p/ categoria</option>
                  <option value="coupon">Aplicar cupom</option>
                  <option value="url">Link externo</option>
                </select>
                {tipo === 'item' && (
                  <select aria-label="Produto do banner" disabled={!pode} value={acao.valor} onChange={(e) => setAcao(i, 'item', e.target.value)} className={selCls}>
                    <option value="">Escolha o produto…</option>
                    {prods.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                )}
                {tipo === 'category' && (
                  <select aria-label="Categoria do banner" disabled={!pode} value={acao.valor} onChange={(e) => setAcao(i, 'category', e.target.value)} className={selCls}>
                    <option value="">Escolha a categoria…</option>
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                )}
                {tipo === 'coupon' && (
                  <Input value={acao.valor} onChange={(e) => setAcao(i, 'coupon', e.target.value.toUpperCase())} placeholder="CÓDIGO" className="h-8" disabled={!pode} />
                )}
                {tipo === 'url' && (
                  <Input value={acao.valor} onChange={(e) => setAcao(i, 'url', e.target.value)} placeholder="https://…" className="h-8" disabled={!pode} />
                )}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <label className="flex items-center gap-1"><input type="checkbox" className="h-4 w-4 accent-primary" disabled={!pode} checked={b.ativo !== false} onChange={(e) => up(i, { ativo: e.target.checked })} /> ativo</label>
                <button type="button" className="ml-auto rounded border border-border px-1.5" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                <button type="button" className="rounded border border-border px-1.5" onClick={() => move(i, 1)} disabled={i === lista.length - 1}>↓</button>
                {pode && <button type="button" className="text-destructive" onClick={() => rem(i)}>remover</button>}
              </div>
            </div>
          </div>
        );
      })}
      {lista.length === 0 && <p className="text-sm text-muted-foreground">Nenhum banner ainda.</p>}
      {pode && (
        <div className="flex items-center justify-between">
          {lista.length < 3 ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setLista((l) => [...l, { imagemRef: '', titulo: '', link: '', ativo: true }])}>＋ Banner</Button>
          ) : (
            <span className="text-xs text-muted-foreground">Máximo de 3 banners.</span>
          )}
          <Button type="button" onClick={() => onSalvar(lista, seg)} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      )}
    </div>
  );
}
