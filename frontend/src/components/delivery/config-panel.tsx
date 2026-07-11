'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';
import { FidelidadePanel } from '@/components/delivery/fidelidade-panel';
import { CashbackPanel } from '@/components/delivery/cashback-panel';
import { buscarCep, localizacaoAtual, geocodificar, mapaEmbedUrl } from '@/lib/geo';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const COLUNAS_DEF = [
  { key: 'chegada', label: 'Em análise' },
  { key: 'producao', label: 'Em produção' },
  { key: 'rota', label: 'Em rota' },
  { key: 'finalizado', label: 'Finalizado' },
];

const MENU: { grupo: string; itens: { k: string; label: string; breve?: boolean }[] }[] = [
  { grupo: 'Quadro', itens: [{ k: 'quadro', label: 'Colunas do quadro' }] },
  {
    grupo: 'Cardápio digital',
    itens: [
      { k: 'cardapio', label: 'Cardápio digital · QR' },
      { k: 'loja', label: 'Loja' },
      { k: 'endereco', label: 'Endereço' },
      { k: 'horarios', label: 'Horários' },
      { k: 'tipos', label: 'Tipos de pedido' },
      { k: 'area', label: 'Área de atendimento' },
      { k: 'cupons', label: 'Cupons' },
      { k: 'fidelidade', label: 'Plano de fidelidade' },
      { k: 'cashback', label: 'Cashback' },
    ],
  },
  {
    grupo: 'Operação',
    itens: [
      { k: 'banners', label: 'Banners' },
      { k: 'impressoras', label: 'Impressoras' },
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
}: {
  deliveryCfg: any;
  onDeliveryToggle: (patch: any) => void;
  isGestor: boolean;
  onClose: () => void;
}) {
  const [sec, setSec] = useState('quadro');
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

  async function salvarBanners(lista: any[]) {
    setSalvando(true);
    try {
      const b = await api.setCardapioBanners(lista.filter((x) => x.imagemRef));
      setBanners(b as any[]);
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
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const linkDelivery = loja?.token ? `${origin}/c/${loja.token}` : '';
  useEffect(() => {
    if (!linkDelivery) { setQr(''); return; }
    QRCode.toDataURL(linkDelivery, { width: 220, margin: 1 }).then(setQr).catch(() => setQr(''));
  }, [linkDelivery]);

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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex h-[92vh] w-full max-w-6xl overflow-hidden rounded-xl border border-border bg-card" onClick={(e) => e.stopPropagation()}>
        {/* Menu lateral */}
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

        {/* Conteúdo */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h3 className="font-display text-base font-bold">{secLabel(sec)}</h3>
            <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-secondary">Fechar ✕</button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {loja === null ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : (
              <>
                {/* QUADRO */}
                {sec === 'quadro' && (
                  <Secao dica="Escolha quais colunas ficam visíveis no quadro de entregas.">
                    {COLUNAS_DEF.map((c) => (
                      <label key={c.key} className={`flex items-center gap-2 rounded-lg border border-border p-2.5 text-sm ${isGestor ? '' : 'opacity-60'}`}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          disabled={somenteGestor}
                          checked={deliveryCfg.colunas ? deliveryCfg.colunas[c.key] !== false : true}
                          onChange={(e) => onDeliveryToggle({ colunas: { ...(deliveryCfg.colunas ?? {}), [c.key]: e.target.checked } })}
                        />
                        {c.label}
                      </label>
                    ))}
                  </Secao>
                )}

                {/* CARDÁPIO DIGITAL · QR */}
                {sec === 'cardapio' && (
                  <Secao dica="Ative o cardápio digital PRÓPRIO — para quando você não tem um cardápio externo (iFood etc.) para integrar. Gera um link e um QR para compartilhar.">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" checked={!!loja.ativo} disabled={somenteGestor} onChange={(e) => up({ ativo: e.target.checked })} className="h-4 w-4 accent-primary" />
                      Cardápio digital próprio ativo
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <Campo label="Modo">
                        <select aria-label="Modo do cardápio" disabled={somenteGestor} value={loja.modo ?? 'mesa'} onChange={(e) => up({ modo: e.target.value })} className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm">
                          <option value="mesa">Mesa (QR na mesa → comanda)</option>
                          <option value="retirada">Retirada (cai no delivery)</option>
                          <option value="totem">Totem (autoatendimento)</option>
                        </select>
                      </Campo>
                      <Campo label="Ramo (tema)">
                        <select aria-label="Ramo" disabled={somenteGestor} value={loja.ramo ?? 'food'} onChange={(e) => up({ ramo: e.target.value })} className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm">
                          <option value="food">🍔 Food service</option>
                          <option value="varejo">🛍 Varejo</option>
                          <option value="industria">🏭 Indústria</option>
                          <option value="servicos">📅 Serviços</option>
                        </select>
                      </Campo>
                      <Campo label="Logo (emoji)"><Input value={loja.logoEmoji ?? ''} onChange={(e) => up({ logoEmoji: e.target.value })} placeholder="🍔" /></Campo>
                      <Campo label="Tempo de entrega (min)"><Input type="number" value={loja.tempoEntregaMin ?? ''} onChange={(e) => up({ tempoEntregaMin: e.target.value })} placeholder="40" /></Campo>
                      <Campo label="Frete grátis acima de (R$)"><Input type="number" value={loja.freteGratisAcima ?? ''} onChange={(e) => up({ freteGratisAcima: e.target.value })} placeholder="opcional" /></Campo>
                      <Campo label="Parcelas máx. (cartão · varejo)"><Input type="number" value={loja.parcelasMax ?? ''} onChange={(e) => up({ parcelasMax: e.target.value })} placeholder="ex.: 12" /></Campo>
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
                            <Button type="button" variant="outline" size="sm" onClick={async () => { await navigator.clipboard.writeText(linkDelivery); toast.success('Link copiado.'); }}>Copiar link</Button>
                          </div>
                        </div>
                      </div>
                    )}
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

                {/* LOJA */}
                {sec === 'loja' && (
                  <Secao dica="Identidade e contatos que aparecem no cardápio digital.">
                    <div className="flex items-center gap-3">
                      <ImageUpload value={loja.logoRef} onChange={(url) => up({ logoRef: url })} id="logo-loja" alt="Logo da loja" />
                      <div className="text-xs text-muted-foreground">Logo da loja (imagem)</div>
                    </div>
                    <Campo label="Nome da loja"><Input value={loja.nomePublico ?? ''} onChange={(e) => up({ nomePublico: e.target.value })} /></Campo>
                    <div className="grid grid-cols-2 gap-2">
                      <Campo label="CPF / CNPJ"><Input value={loja.documento ?? ''} onChange={(e) => up({ documento: e.target.value })} /></Campo>
                      <Campo label="Pedido mínimo (R$)"><Input inputMode="decimal" value={loja.pedidoMinimo ?? ''} onChange={(e) => up({ pedidoMinimo: e.target.value })} /></Campo>
                      <Campo label="Responsável"><Input value={loja.responsavelNome ?? ''} onChange={(e) => up({ responsavelNome: e.target.value })} /></Campo>
                      <Campo label="Contato do responsável"><Input value={loja.responsavelContato ?? ''} onChange={(e) => up({ responsavelContato: e.target.value })} /></Campo>
                      <Campo label="Contato da loja"><Input value={loja.contatoLoja ?? ''} onChange={(e) => up({ contatoLoja: e.target.value })} /></Campo>
                      <Campo label="WhatsApp"><Input value={loja.whatsapp ?? ''} onChange={(e) => up({ whatsapp: e.target.value })} /></Campo>
                      <Campo label="Instagram"><Input value={loja.instagram ?? ''} onChange={(e) => up({ instagram: e.target.value })} placeholder="@sualoja" /></Campo>
                      <Campo label="Site"><Input value={loja.site ?? ''} onChange={(e) => up({ site: e.target.value })} placeholder="https://" /></Campo>
                    </div>
                    <FormasPagamentoCardapio pagamentos={loja.pagamentos ?? []} onChange={(p) => up({ pagamentos: p })} pode={isGestor} />
                    <SalvarBar onSalvar={salvarLoja} salvando={salvando} pode={isGestor} />
                  </Secao>
                )}

                {/* ENDEREÇO */}
                {sec === 'endereco' && (
                  <Secao dica="Endereço físico da loja.">
                    <div className="grid grid-cols-2 gap-2">
                      <Campo label="CEP"><Input value={loja.endCep ?? ''} onChange={(e) => up({ endCep: e.target.value })} onBlur={async (e) => { const d = await buscarCep(e.target.value); if (d) up({ endRua: d.logradouro || loja.endRua, endBairro: d.bairro || loja.endBairro, endCidade: d.cidade || loja.endCidade, endEstado: d.uf || loja.endEstado }); }} placeholder="00000-000" /></Campo>
                      <Campo label="Cidade"><Input value={loja.endCidade ?? ''} onChange={(e) => up({ endCidade: e.target.value })} /></Campo>
                      <Campo label="Rua"><Input value={loja.endRua ?? ''} onChange={(e) => up({ endRua: e.target.value })} /></Campo>
                      <Campo label="Número"><Input value={loja.endNumero ?? ''} onChange={(e) => up({ endNumero: e.target.value })} /></Campo>
                      <Campo label="Bairro"><Input value={loja.endBairro ?? ''} onChange={(e) => up({ endBairro: e.target.value })} /></Campo>
                      <Campo label="Estado (UF)"><Input value={loja.endEstado ?? ''} onChange={(e) => up({ endEstado: e.target.value })} maxLength={2} /></Campo>
                      <Campo label="Referência"><Input value={loja.endReferencia ?? ''} onChange={(e) => up({ endReferencia: e.target.value })} /></Campo>
                      <Campo label="Complemento"><Input value={loja.endComplemento ?? ''} onChange={(e) => up({ endComplemento: e.target.value })} /></Campo>
                    </div>
                    <PontoLojaMapa loja={loja} up={up} pode={isGestor} />
                    <SalvarBar onSalvar={salvarLoja} salvando={salvando} pode={isGestor} />
                  </Secao>
                )}

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
                  <Banners banners={banners} onSalvar={salvarBanners} salvando={salvando} pode={isGestor} />
                )}

                {/* IMPRESSORAS */}
                {sec === 'impressoras' && (
                  <Impressoras lista={impressoras} setores={setores} onSalvar={salvarImpressora} onRemover={removerImpressora} pode={isGestor} />
                )}

                {/* INTEGRAÇÕES */}
                {sec === 'integracoes' && (
                  <Integracoes lista={integracoes} onSalvar={salvarIntegracao} pode={isGestor} />
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
    </div>
  );
}

function secLabel(k: string) {
  const all = MENU.flatMap((g) => g.itens);
  return all.find((i) => i.k === k)?.label ?? 'Configurações';
}

// Formas de pagamento que aparecem no checkout do cardápio digital.
const FORMAS_CARDAPIO: [string, string][] = [
  ['pix', '⚡ Pix (online)'],
  ['cartao', '💳 Cartão (online)'],
  ['entrega', '💵 Dinheiro / cartão na entrega'],
];
function FormasPagamentoCardapio({ pagamentos, onChange, pode }: { pagamentos: string[]; onChange: (p: string[]) => void; pode: boolean }) {
  const set = new Set(pagamentos ?? []);
  function toggle(k: string, v: boolean) {
    const n = new Set(set);
    v ? n.add(k) : n.delete(k);
    onChange([...n]);
  }
  return (
    <div className="space-y-1.5 rounded-lg border border-border p-2.5">
      <p className="text-xs font-semibold">Formas de pagamento no cardápio</p>
      <p className="text-[11px] text-muted-foreground">Marque o que o cliente pode escolher ao fechar o pedido. Sem nenhuma marcada, o checkout não mostra pagamento.</p>
      {FORMAS_CARDAPIO.map(([k, lb]) => (
        <label key={k} className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" disabled={!pode} checked={set.has(k)} onChange={(e) => toggle(k, e.target.checked)} />
          {lb}
        </label>
      ))}
    </div>
  );
}

function Secao({ dica, children }: { dica: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{dica}</p>
      {children}
    </div>
  );
}
function Campo({ label, children }: { label: string; children: React.ReactNode }) {
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
        return (
          <div key={d} className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm">
            <label className="flex w-24 items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-primary" disabled={!pode} checked={!!h.ativo} onChange={(e) => set(d, { ativo: e.target.checked })} />
              <span className="font-medium">{nome}</span>
            </label>
            <Input type="time" value={h.abre ?? ''} disabled={!pode || !h.ativo} onChange={(e) => set(d, { abre: e.target.value })} className="h-8 w-28" />
            <span className="text-muted-foreground">às</span>
            <Input type="time" value={h.fecha ?? ''} disabled={!pode || !h.ativo} onChange={(e) => set(d, { fecha: e.target.value })} className="h-8 w-28" />
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
function PontoLojaMapa({ loja, up, pode }: { loja: any; up: (p: any) => void; pode: boolean }) {
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

  async function conectar() {
    setBusy(true); setErro('');
    try {
      const r: any = await api.whatsappConectar();
      setQr(r?.qr ?? null);
      if (!r?.qr) setErro('Não veio QR. Verifique a configuração do Evolution no servidor.');
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
      {qr && !conectado && (
        <div className="mt-3 flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR do WhatsApp" className="h-56 w-56 rounded-lg border border-border" />
          <p className="text-xs text-muted-foreground">No celular da loja: WhatsApp → Aparelhos conectados → <strong>Conectar aparelho</strong> → aponte para o QR.</p>
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

const CANAL_NOME: Record<string, string> = { ifood: 'iFood', ubereats: 'Uber Eats', rappi: 'Rappi', '99food': '99Food', n8n: 'WhatsApp / n8n' };

function Integracoes({ lista, onSalvar, pode }: { lista: any[]; onSalvar: (dto: any) => void; pode: boolean }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Credenciais dos apps de delivery externos. As chaves ficam guardadas com segurança e <strong>não são exibidas de volta</strong> — deixe o campo em branco para manter a atual.</p>
      <p className="rounded bg-warn/10 px-2 py-1 text-[11px] text-warn">A ativação real (receber pedidos do app) roda no <strong>servidor local (edge)</strong> com essas credenciais. Aqui você só as cadastra.</p>
      {lista.map((it) => (
        <IntegracaoCard key={it.canal} it={it} onSalvar={onSalvar} pode={pode} />
      ))}
    </div>
  );
}

function IntegracaoCard({ it, onSalvar, pode }: { it: any; onSalvar: (dto: any) => void; pode: boolean }) {
  const [ativo, setAtivo] = useState(!!it.ativo);
  const [merchantId, setMerchantId] = useState(it.merchantId ?? '');
  const [clientId, setClientId] = useState(it.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [tokenV, setTokenV] = useState('');
  useEffect(() => { setAtivo(!!it.ativo); setMerchantId(it.merchantId ?? ''); setClientId(it.clientId ?? ''); }, [it]);
  const ehN8n = it.canal === 'n8n';
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <span className="font-display text-sm font-bold">{CANAL_NOME[it.canal] ?? it.canal}</span>
        <label className="ml-auto flex items-center gap-1 text-xs">
          <input type="checkbox" className="h-4 w-4 accent-primary" disabled={!pode} checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> ativo
        </label>
      </div>
      {ehN8n ? (
        <>
          <p className="text-[11px] text-muted-foreground">O Regem avisa esta URL quando o pedido muda de status <strong>e para enviar o código OTP</strong> do cliente (o robô notifica no WhatsApp). O campo <code>evento</code> do corpo diz o que é: <code>status</code> ou <code>otp</code> — trate os dois no seu fluxo. O segredo assina a chamada (cabeçalho <code>X-Regem-Signature</code>).</p>
          <div className="grid gap-2">
            <Campo label="URL do webhook (do seu n8n)"><Input value={merchantId} onChange={(e) => setMerchantId(e.target.value)} placeholder="https://seu-n8n/webhook/regem-status" className="h-8" disabled={!pode} /></Campo>
            <Campo label={`Segredo${it.temSecret ? ' (salvo)' : ''}`}>
              <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={it.temSecret ? '•••••• (mantém)' : 'uma frase secreta qualquer'} className="h-8" disabled={!pode} />
            </Campo>
          </div>
        </>
      ) : (
      <div className="grid grid-cols-2 gap-2">
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
      {pode && (
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={() => onSalvar({ canal: it.canal, ativo, merchantId, clientId, clientSecret, token: tokenV })}>Salvar</Button>
        </div>
      )}
    </div>
  );
}

function Impressoras({ lista, setores, onSalvar, onRemover, pode }: { lista: any[]; setores: any[]; onSalvar: (r: any) => Promise<any>; onRemover: (id: string) => void; pode: boolean }) {
  const [rows, setRows] = useState<any[]>(lista);
  useEffect(() => { setRows(lista); }, [lista]);
  function up(i: number, patch: any) { setRows((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x))); }
  function add() { setRows((l) => [...l, { nome: '', papel: 'cupom', setorId: '', host: '', porta: 9100, vias: 1, ativo: true, _novo: true }]); }
  async function salvar(i: number) {
    const r = rows[i];
    await onSalvar({ id: r.id, nome: r.nome, papel: r.papel, setorId: r.papel === 'producao' ? r.setorId || null : null, host: r.host, porta: r.porta, vias: r.vias, ativo: r.ativo });
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Direcione a impressão: <strong>Caixa</strong> (cupom do cliente) ou <strong>Cozinha</strong> (produção, por setor). Informe o IP da impressora de rede e o nº de vias.</p>
      <p className="rounded bg-warn/10 px-2 py-1 text-[11px] text-warn">A <strong>detecção automática</strong> das impressoras instaladas no Windows depende do servidor local (edge). Por enquanto o cadastro é manual (nome + IP).</p>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma impressora cadastrada.</p>}
      {rows.map((r, i) => (
        <div key={r.id ?? `n${i}`} className="space-y-2 rounded-lg border border-border p-2.5">
          <div className="flex items-center gap-2">
            <Input value={r.nome} onChange={(e) => up(i, { nome: e.target.value })} placeholder="Nome da impressora" className="h-8 flex-1" disabled={!pode} />
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="h-4 w-4 accent-primary" disabled={!pode} checked={r.ativo !== false} onChange={(e) => up(i, { ativo: e.target.checked })} /> ativa</label>
          </div>
          <div className="grid grid-cols-2 gap-2">
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
              <Label className="text-[11px]">IP : porta</Label>
              <div className="flex items-center gap-1">
                <Input value={r.host ?? ''} onChange={(e) => up(i, { host: e.target.value })} placeholder="192.168.0.50" className="h-8 flex-1" disabled={!pode} />
                <Input inputMode="numeric" value={r.porta ?? ''} onChange={(e) => up(i, { porta: e.target.value })} placeholder="9100" className="h-8 w-16" disabled={!pode} />
              </div>
            </div>
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

function Banners({ banners, onSalvar, salvando, pode }: { banners: any[]; onSalvar: (l: any[]) => void; salvando: boolean; pode: boolean }) {
  const [lista, setLista] = useState<any[]>(banners);
  useEffect(() => { setLista(banners); }, [banners]);
  function up(i: number, patch: any) { setLista((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x))); }
  function rem(i: number) { setLista((l) => l.filter((_, j) => j !== i)); }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= lista.length) return;
    const cp = [...lista];
    [cp[i], cp[j]] = [cp[j], cp[i]];
    setLista(cp);
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Imagens que passam no topo do cardápio digital. Ordene e ative/desative cada uma.</p>
      {lista.map((b, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg border border-border p-2.5">
          <ImageUpload value={b.imagemRef} onChange={(url) => up(i, { imagemRef: url })} id={`banner-${i}`} alt="Banner" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Input value={b.titulo ?? ''} onChange={(e) => up(i, { titulo: e.target.value })} placeholder="Título (opcional)" className="h-8" disabled={!pode} />
            <Input value={b.link ?? ''} onChange={(e) => up(i, { link: e.target.value })} placeholder="Link ao clicar (opcional)" className="h-8" disabled={!pode} />
            <div className="flex items-center gap-2 text-xs">
              <label className="flex items-center gap-1"><input type="checkbox" className="h-4 w-4 accent-primary" disabled={!pode} checked={b.ativo !== false} onChange={(e) => up(i, { ativo: e.target.checked })} /> ativo</label>
              <button type="button" className="ml-auto rounded border border-border px-1.5" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button type="button" className="rounded border border-border px-1.5" onClick={() => move(i, 1)} disabled={i === lista.length - 1}>↓</button>
              {pode && <button type="button" className="text-destructive" onClick={() => rem(i)}>remover</button>}
            </div>
          </div>
        </div>
      ))}
      {lista.length === 0 && <p className="text-sm text-muted-foreground">Nenhum banner ainda.</p>}
      {pode && (
        <div className="flex items-center justify-between">
          <Button type="button" size="sm" variant="outline" onClick={() => setLista((l) => [...l, { imagemRef: '', titulo: '', link: '', ativo: true }])}>＋ Banner</Button>
          <Button type="button" onClick={() => onSalvar(lista)} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      )}
    </div>
  );
}
