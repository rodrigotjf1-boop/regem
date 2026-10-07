'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, getUnidadeAtual } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InputMoeda } from '@/components/ui/input-moeda';
import { MapaAreaEntrega } from '@/components/delivery/mapa-area';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';
import { FidelidadePanel } from '@/components/delivery/fidelidade-panel';
import { CashbackPanel } from '@/components/delivery/cashback-panel';
import { EventosPanel } from '@/components/delivery/eventos-panel';
import { NumerosWhatsapp } from '@/components/delivery/numeros-whatsapp';
import { localizacaoAtual, geocodificar, mapaEmbedUrl } from '@/lib/geo';
import { INDICADO_PARA, ROTULO_TEMPLATE, TEMPLATES, templateDe } from '@/components/loja/cardapio/tipos-template';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const mesmo = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/**
 * As chaves de `atual` que diferem do que está `gravado` — é só isso que vai no salvar (o servidor
 * mantém o que não vem). O tema (`temaConfig`) o servidor mescla por chave: dele vão só as chaves
 * do tema que mudaram.
 */
export function alteracoesDaLoja(atual: any, gravado: any): Record<string, any> {
  const fora: Record<string, any> = {};
  for (const k of Object.keys(atual ?? {})) {
    if (mesmo(atual[k], gravado?.[k])) continue;
    if (k === 'temaConfig' && atual[k] && typeof atual[k] === 'object') {
      const tema = Object.fromEntries(Object.entries(atual[k]).filter(([c, v]) => !mesmo(v, gravado?.temaConfig?.[c])));
      if (Object.keys(tema).length) fora[k] = tema;
      continue;
    }
    fora[k] = atual[k];
  }
  return fora;
}


const MENU: { grupo: string; itens: { k: string; label: string; breve?: boolean }[] }[] = [
  {
    grupo: 'Cardápio digital',
    itens: [
      { k: 'cardapio', label: 'Cardápio' },
      { k: 'eventos', label: 'Eventos' },
      { k: 'horarios', label: 'Horários' },
      { k: 'encomenda', label: 'Encomenda' },
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
      { k: 'integracoes', label: 'Integrações' },
      { k: 'robo', label: 'Robô de atendimento' },
    ],
  },
];

export function ConfigPanel({
  isGestor,
  onClose,
  pagina = false,
}: {
  isGestor: boolean;
  onClose: () => void;
  pagina?: boolean;
}) {
  const [sec, setSec] = useState('cardapio');
  const [loja, setLoja] = useState<any>(null);
  const [regrasSinal, setRegrasSinal] = useState<any[]>([]); // faixas de sinal da encomenda (mig 187)
  const [bairros, setBairros] = useState<any[]>([]);
  const [banners, setBanners] = useState<any[]>([]);
  const [integracoes, setIntegracoes] = useState<any[]>([]);
  const [cupons, setCupons] = useState<any[]>([]);
  const [novoCupom, setNovoCupom] = useState({
    nome: '',
    codigo: '',
    tipo: 'percentual',
    valor: '',
    tetoDesconto: '',
    minimo: '',
    condicao: 'nenhuma', // nenhuma | novos | dias | max
    minDiasSemCompra: '',
    maxPorCliente: '',
    validoDe: '',
    validade: '',
    maxUsos: '',
  });
  const [qr, setQr] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [editarTema, setEditarTema] = useState(false);

  // A configuração GRAVADA (a última resposta do servidor). Salvar manda só a diferença entre ela
  // e a tela: a mesma configuração é editada em Configurações → Loja e na tela de pedidos, e
  // devolver o objeto inteiro regravava, com os valores de quando este painel abriu, o que as
  // outras tinham salvo depois.
  const lojaGravada = useRef<any>({});
  const [erroLoja, setErroLoja] = useState('');
  // Cópia à parte: listas da tela (horários, raios, mensagens) são alteradas no lugar em alguns
  // pontos; se o retrato gravado dividisse os mesmos objetos, a diferença sumiria.
  const guardarGravada = (c: any) => {
    lojaGravada.current = JSON.parse(JSON.stringify(c ?? {}));
  };
  const receberLoja = (c: any) => {
    guardarGravada(c);
    setLoja(c ?? {});
  };
  // Leitura que falha NÃO vira formulário em branco (parecia que a configuração tinha sumido).
  const lerLoja = () => {
    setErroLoja('');
    api.cardapioConfig().then(receberLoja).catch((e) => setErroLoja(e instanceof Error && e.message ? e.message : 'Não foi possível carregar a configuração.'));
  };

  useEffect(() => {
    lerLoja();
    api.cardapioBairros().then((b: any) => setBairros((b as any[]) ?? [])).catch(() => {});
    api.cardapioBanners().then((b: any) => setBanners((b as any[]) ?? [])).catch(() => {});
    api.cardapioCupons().then((c: any) => setCupons((c as any[]) ?? [])).catch(() => {});
    api.regrasSinalEncomenda()
      .then((r: any) =>
        setRegrasSinal(
          ((r as any[]) ?? []).map((x) => ({
            minItens: String(x.minItens ?? ''),
            maxItens: x.maxItens != null ? String(x.maxItens) : '',
            exigeSinal: x.exigeSinal !== false,
            sinalPct: x.sinalPct != null ? String(x.sinalPct) : '',
            cancelHoras: x.cancelHoras != null ? String(x.cancelHoras) : '',
          })),
        ),
      )
      .catch(() => {});
    if (isGestor) {
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

  const up = (patch: any) => setLoja((l: any) => ({ ...(l ?? {}), ...patch }));

  async function salvarRegrasSinal() {
    try {
      const r = await api.setRegrasSinalEncomenda(
        regrasSinal
          .filter((x) => x.minItens !== '' && x.minItens != null)
          .map((x) => ({
            minItens: Number(x.minItens),
            maxItens: x.maxItens === '' || x.maxItens == null ? null : Number(x.maxItens),
            exigeSinal: x.exigeSinal !== false,
            sinalPct: Number(String(x.sinalPct).replace(',', '.')) || 0,
            cancelHoras: x.cancelHoras === '' || x.cancelHoras == null ? null : Number(x.cancelHoras),
          })),
      );
      setRegrasSinal(
        ((r as any[]) ?? []).map((x) => ({
          minItens: String(x.minItens ?? ''),
          maxItens: x.maxItens != null ? String(x.maxItens) : '',
          exigeSinal: x.exigeSinal !== false,
          sinalPct: x.sinalPct != null ? String(x.sinalPct) : '',
          cancelHoras: x.cancelHoras != null ? String(x.cancelHoras) : '',
        })),
      );
      toast.success('Regras de sinal salvas.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar regras');
    }
  }

  // Grava `patch` — só o que nele difere do que está gravado — e atualiza a tela SEM perder o que
  // está digitado em outros campos e ainda não foi salvo. Devolve se houve o que gravar.
  async function gravarNaLoja(patch: any): Promise<boolean> {
    const corpo = alteracoesDaLoja(patch, lojaGravada.current);
    if (!Object.keys(corpo).length) return false;
    const pendentes = alteracoesDaLoja(loja, lojaGravada.current);
    for (const k of Object.keys(patch)) {
      if (k === 'temaConfig' && pendentes.temaConfig && patch.temaConfig) for (const c of Object.keys(patch.temaConfig)) delete pendentes.temaConfig[c];
      else delete pendentes[k];
    }
    const c: any = await api.setCardapioConfig(corpo);
    guardarGravada(c);
    setLoja({ ...(c ?? {}), ...pendentes, ...(pendentes.temaConfig ? { temaConfig: { ...(c?.temaConfig ?? {}), ...pendentes.temaConfig } } : {}) });
    return true;
  }

  // Persiste a config da loja com um patch explícito (usado ao trocar o modo da área e ao salvar o tema).
  async function salvarLojaPatch(patch: any) {
    const antes = loja;
    setLoja({ ...(loja ?? {}), ...patch });
    try {
      await gravarNaLoja(patch);
    } catch (e) {
      setLoja(antes); // não gravou: a tela volta ao que era
      toast.error(e instanceof Error ? e.message : 'Erro');
    }
  }

  async function salvarBanners(lista: any[], intervalo: number) {
    setSalvando(true);
    try {
      const b = await api.setCardapioBanners(lista.filter((x) => x.imagemRef));
      setBanners(b as any[]);
      // Intervalo do carrossel vive no tema_config da loja (o servidor mescla o tema por chave).
      await gravarNaLoja({ temaConfig: { bannerIntervalo: intervalo } });
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
      const gravou = await gravarNaLoja(loja);
      if (gravou) toast.success('Configuração salva.');
      else toast.info('Nenhuma alteração para salvar.');
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
        nome: novoCupom.nome.trim() || undefined,
        codigo: novoCupom.codigo.trim(),
        tipo: novoCupom.tipo,
        valor: novoCupom.tipo === 'fretegratis' ? 0 : n(novoCupom.valor) || 0,
        tetoDesconto: novoCupom.tipo === 'percentual' ? n(novoCupom.tetoDesconto) : undefined,
        minimo: n(novoCupom.minimo),
        somenteNovos: novoCupom.condicao === 'novos',
        minDiasSemCompra: novoCupom.condicao === 'dias' ? n(novoCupom.minDiasSemCompra) : undefined,
        maxPorCliente: novoCupom.condicao === 'max' ? n(novoCupom.maxPorCliente) : undefined,
        validoDe: novoCupom.validoDe || undefined,
        validade: novoCupom.validade || undefined,
        maxUsos: novoCupom.maxUsos ? Number(novoCupom.maxUsos) : undefined,
      });
      setNovoCupom({ nome: '', codigo: '', tipo: novoCupom.tipo, valor: '', tetoDesconto: '', minimo: '', condicao: 'nenhuma', minDiasSemCompra: '', maxPorCliente: '', validoDe: '', validade: '', maxUsos: '' });
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
            {erroLoja ? (
              <div className="space-y-3 text-sm">
                <p role="alert">Não deu para carregar a configuração: {erroLoja}</p>
                <Button type="button" variant="outline" size="sm" onClick={lerLoja}>Tentar de novo</Button>
              </div>
            ) : loja === null ? (
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
                      <Campo label="Modelo do cardápio">
                        {/* Loja com layout antigo gravado aparece no padrão (Regem Fluxo): é o que o cardápio mostra. */}
                        <select aria-label="Modelo do cardápio" disabled={somenteGestor} value={templateDe(loja.menuTheme)} onChange={(e) => up({ menuTheme: e.target.value })} className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm">
                          {TEMPLATES.map((t) => (
                            <option key={t} value={t}>{ROTULO_TEMPLATE[t]}</option>
                          ))}
                        </select>
                        <p className="text-xs text-muted-foreground">
                          {INDICADO_PARA[templateDe(loja.menuTheme)]}
                          {linkDelivery && (
                            <>
                              {' '}
                              <a href={`${linkDelivery}?tema=${templateDe(loja.menuTheme)}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-foreground underline underline-offset-2">
                                Ver prévia
                              </a>
                            </>
                          )}
                        </p>
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
                          <label className="mb-1 block text-xs text-muted-foreground">Nome (opcional)</label>
                          <Input className="w-40" placeholder="ex.: Boas-vindas" value={novoCupom.nome} onChange={(e) => setNovoCupom((s) => ({ ...s, nome: e.target.value }))} />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">Nome / Código</label>
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
                        {novoCupom.tipo === 'valor' && (
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Valor</label>
                            <InputMoeda className="w-32" value={novoCupom.valor} onChange={(v) => setNovoCupom((s) => ({ ...s, valor: v }))} ariaLabel="Valor do cupom" />
                          </div>
                        )}
                        {novoCupom.tipo === 'percentual' && (
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">% de desconto</label>
                            <div className="relative w-24">
                              <Input type="number" className="pr-6" placeholder="0" value={novoCupom.valor} onChange={(e) => setNovoCupom((s) => ({ ...s, valor: e.target.value }))} />
                              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                            </div>
                          </div>
                        )}
                        {novoCupom.tipo === 'percentual' && (
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Teto do desconto</label>
                            <InputMoeda className="w-32" value={novoCupom.tetoDesconto} onChange={(v) => setNovoCupom((s) => ({ ...s, tetoDesconto: v }))} placeholder="opcional" ariaLabel="Teto do desconto" />
                          </div>
                        )}
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">Pedido mínimo</label>
                          <InputMoeda className="w-32" value={novoCupom.minimo} onChange={(v) => setNovoCupom((s) => ({ ...s, minimo: v }))} placeholder="opcional" ariaLabel="Pedido mínimo" />
                        </div>
                      </div>

                      {/* Período de atividade + limite total de usos */}
                      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">Válido de</label>
                          <Input type="date" className="w-40" value={novoCupom.validoDe} onChange={(e) => setNovoCupom((s) => ({ ...s, validoDe: e.target.value }))} />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">Válido até</label>
                          <Input type="date" className="w-40" value={novoCupom.validade} onChange={(e) => setNovoCupom((s) => ({ ...s, validade: e.target.value }))} />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">Limite total de usos</label>
                          <Input type="number" className="w-32" placeholder="ilimitado" value={novoCupom.maxUsos} onChange={(e) => setNovoCupom((s) => ({ ...s, maxUsos: e.target.value }))} />
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
                          <strong>{c.nome ? `${c.nome} · ${c.codigo}` : c.codigo}</strong> ·{' '}
                          {c.tipo === 'fretegratis'
                            ? 'frete grátis'
                            : c.tipo === 'percentual'
                              ? `${Number(c.valor)}%${c.tetoDesconto ? ` (até ${Number(c.tetoDesconto).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})` : ''}`
                              : Number(c.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          {c.minimo ? ` · mín. ${Number(c.minimo).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''}
                          {c.somenteNovos ? ' · novos' : ''}
                          {c.minDiasSemCompra ? ` · ${c.minDiasSemCompra}d inativo` : ''}
                          {c.maxPorCliente ? ` · máx ${c.maxPorCliente}x/cliente` : ''}
                          {c.maxUsos ? ` · ${c.maxUsos} no total` : ''}
                          {c.validoDe ? ` · de ${String(c.validoDe).slice(8, 10)}/${String(c.validoDe).slice(5, 7)}` : ''}
                          {c.validade ? ` · até ${String(c.validade).slice(8, 10)}/${String(c.validade).slice(5, 7)}` : ''}
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
                  <Secao dica="Horário de funcionamento por dia da semana. Delivery e retirada/consumo no local podem ter horários diferentes.">
                    <label className="mb-3 flex items-center gap-2 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-primary" disabled={!isGestor}
                        checked={loja.horarioUnico !== false}
                        onChange={(e) => up({ horarioUnico: e.target.checked })} />
                      Mesmo horário para delivery e retirada/consumo no local
                    </label>
                    {loja.horarioUnico !== false ? (
                      <Horarios value={loja.horarios ?? []} onChange={(h) => up({ horarios: h })} pode={isGestor} />
                    ) : (
                      <div className="space-y-4">
                        <div>
                          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">🛵 Delivery</p>
                          <Horarios value={loja.horarios ?? []} onChange={(h) => up({ horarios: h })} pode={isGestor} />
                        </div>
                        <div>
                          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">🏪 Retirada / consumo no local</p>
                          <Horarios value={loja.horariosRetirada ?? []} onChange={(h) => up({ horariosRetirada: h })} pode={isGestor} />
                        </div>
                      </div>
                    )}
                    <SalvarBar onSalvar={salvarLoja} salvando={salvando} pode={isGestor} />
                  </Secao>
                )}

                {/* ENCOMENDA (mig 186) — opt-in por loja */}
                {sec === 'encomenda' && (
                  <Secao dica="Encomenda = pedido no cardápio para dia e hora à frente — pode ser outro dia OU o mesmo dia mais tarde (marmitaria, bolos, kits). Fica DESLIGADO por padrão; ligue só se a loja trabalha assim.">
                    <label className="mb-3 flex items-center gap-2 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-primary" disabled={!isGestor}
                        checked={!!loja.encomendaAtiva}
                        onChange={(e) => up({ encomendaAtiva: e.target.checked })} />
                      Aceitar encomendas (pedido para dia e hora à frente)
                    </label>
                    {loja.encomendaAtiva && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Campo label="Antecedência mínima (horas)">
                          <Input type="number" value={loja.encomendaAntecedenciaHoras ?? ''} onChange={(e) => up({ encomendaAntecedenciaHoras: e.target.value })} placeholder="24" disabled={!isGestor} />
                        </Campo>
                        <Campo label="Até quantos dias à frente">
                          <Input type="number" value={loja.encomendaHorizonteDias ?? ''} onChange={(e) => up({ encomendaHorizonteDias: e.target.value })} placeholder="30" disabled={!isGestor} />
                        </Campo>
                        <Campo label="Janela de corte p/ hoje (opcional)">
                          <div className="flex items-center gap-2">
                            <Input type="time" value={(loja.encomendaCorteInicio ?? '').slice(0, 5)} onChange={(e) => up({ encomendaCorteInicio: e.target.value })} disabled={!isGestor} aria-label="Início do corte" />
                            <span className="text-xs text-muted-foreground">até</span>
                            <Input type="time" value={(loja.encomendaCorte ?? '').slice(0, 5)} onChange={(e) => up({ encomendaCorte: e.target.value })} disabled={!isGestor} aria-label="Fim do corte" />
                          </div>
                        </Campo>
                        <Campo label="Máx. de encomendas por dia (opcional)">
                          <Input type="number" value={loja.encomendaCapacidadeDia ?? ''} onChange={(e) => up({ encomendaCapacidadeDia: e.target.value })} placeholder="sem limite" disabled={!isGestor} />
                        </Campo>
                      </div>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      A antecedência é em horas: com poucas horas, o cliente pode encomendar para o mesmo dia mais tarde; com 24h+, só a partir do dia seguinte. Os pedidos aparecem em Delivery → Encomendas · agenda, agrupados por data.
                    </p>

                    {loja.encomendaAtiva && (
                      <div className="mt-4 border-t border-border pt-3">
                        <p className="text-sm font-bold">💰 Sinal (entrada) e cancelamento</p>
                        <p className="mb-2 text-xs text-muted-foreground">
                          Cobra uma parte no ato do pedido. O cliente pode cancelar com reembolso até o prazo; depois, perde o sinal e não cancela.
                        </p>
                        <label className="mb-2 flex items-center gap-2 text-sm">
                          <input type="checkbox" className="h-4 w-4 accent-primary" disabled={!isGestor}
                            checked={!!loja.encomendaExigeSinal}
                            onChange={(e) => up({ encomendaExigeSinal: e.target.checked })} />
                          Exigir sinal em toda encomenda (regra base)
                        </label>
                        {loja.encomendaExigeSinal && (
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Campo label="Sinal (% do total)">
                              <Input type="number" value={loja.encomendaSinalPct ?? ''} onChange={(e) => up({ encomendaSinalPct: e.target.value })} placeholder="50" disabled={!isGestor} />
                            </Campo>
                            <Campo label="Cancelar com reembolso até (horas antes)">
                              <Input type="number" value={loja.encomendaCancelHoras ?? ''} onChange={(e) => up({ encomendaCancelHoras: e.target.value })} placeholder="24" disabled={!isGestor} />
                            </Campo>
                          </div>
                        )}

                        <p className="mt-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">Regras por quantidade (opcional)</p>
                        <p className="mb-2 text-xs text-muted-foreground">
                          Sobrepõem a base quando o pedido tem essa quantidade de itens. Ex.: 10–20 itens → sinal 50%, cancela até 48h.
                        </p>
                        <div className="space-y-2">
                          {regrasSinal.map((r, i) => (
                            <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-6">
                              <Campo label="De (itens)">
                                <Input type="number" value={r.minItens} disabled={!isGestor}
                                  onChange={(e) => { const a = [...regrasSinal]; a[i] = { ...r, minItens: e.target.value }; setRegrasSinal(a); }} />
                              </Campo>
                              <Campo label="Até (itens)">
                                <Input type="number" placeholder="∞" value={r.maxItens} disabled={!isGestor}
                                  onChange={(e) => { const a = [...regrasSinal]; a[i] = { ...r, maxItens: e.target.value }; setRegrasSinal(a); }} />
                              </Campo>
                              <label className="flex items-center gap-1 text-xs">
                                <input type="checkbox" className="h-4 w-4 accent-primary" disabled={!isGestor}
                                  checked={r.exigeSinal !== false}
                                  onChange={(e) => { const a = [...regrasSinal]; a[i] = { ...r, exigeSinal: e.target.checked }; setRegrasSinal(a); }} />
                                Sinal
                              </label>
                              <Campo label="Sinal %">
                                <Input type="number" value={r.sinalPct} disabled={!isGestor || r.exigeSinal === false}
                                  onChange={(e) => { const a = [...regrasSinal]; a[i] = { ...r, sinalPct: e.target.value }; setRegrasSinal(a); }} />
                              </Campo>
                              <Campo label="Cancel. (h)">
                                <Input type="number" value={r.cancelHoras} disabled={!isGestor || r.exigeSinal === false}
                                  onChange={(e) => { const a = [...regrasSinal]; a[i] = { ...r, cancelHoras: e.target.value }; setRegrasSinal(a); }} />
                              </Campo>
                              <Button type="button" variant="ghost" size="sm" disabled={!isGestor}
                                onClick={() => setRegrasSinal(regrasSinal.filter((_, x) => x !== i))}>remover</Button>
                            </div>
                          ))}
                        </div>
                        {isGestor && (
                          <div className="mt-2 flex gap-2">
                            <Button type="button" variant="outline" size="sm"
                              onClick={() => setRegrasSinal([...regrasSinal, { minItens: '', maxItens: '', exigeSinal: true, sinalPct: '', cancelHoras: '' }])}>
                              ＋ regra
                            </Button>
                            <Button type="button" size="sm" onClick={salvarRegrasSinal}>Salvar regras</Button>
                          </div>
                        )}
                      </div>
                    )}

                    <SalvarBar onSalvar={salvarLoja} salvando={salvando} pode={isGestor} />
                  </Secao>
                )}

                {/* Tipos de pedido: movido para o modal do ⚙️ no Painel de delivery
                    (menu Delivery → Painel → ⚙️), como "Tipos de delivery". */}

                {/* ÁREA DE ATENDIMENTO */}
                {sec === 'area' && (
                  <AreaAtendimento
                    modo={loja.areaModo ?? 'bairro'}
                    onTrocarModo={(m) => salvarLojaPatch({ areaModo: m })}
                    lat={loja.endLat}
                    lng={loja.endLng}
                    raios={loja.raios ?? []}
                    onRaios={(r) => up({ raios: r })}
                    onSalvarRaios={salvarLoja}
                    bairros={bairros}
                    onSalvarBairros={salvarBairros}
                    salvando={salvando}
                    pode={isGestor}
                  />
                )}

                {/* EVENTOS SAZONAIS (só o presidente edita; o painel mesmo trata quem só vê) */}
                {sec === 'eventos' && <EventosPanel linkCardapio={linkDelivery} />}

                {/* BANNERS */}
                {sec === 'banners' && (
                  <Banners banners={banners} intervalo={loja?.temaConfig?.bannerIntervalo ?? 2} onSalvar={salvarBanners} salvando={salvando} pode={isGestor} />
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
  modo, onTrocarModo, lat, lng, raios, onRaios, onSalvarRaios, bairros, onSalvarBairros, salvando, pode,
}: {
  modo: string;
  onTrocarModo: (m: string) => void;
  lat?: any;
  lng?: any;
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
        <FaixasRaio raios={raios} onRaios={onRaios} onSalvar={onSalvarRaios} salvando={salvando} pode={pode} lat={lat} lng={lng} />
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

function FaixasRaio({ raios, onRaios, onSalvar, salvando, pode, lat, lng }: { raios: any[]; onRaios: (r: any[]) => void; onSalvar: () => void; salvando: boolean; pode: boolean; lat?: any; lng?: any }) {
  const lista = raios ?? [];
  function add(ateKm: any = '') { onRaios([...lista, { ateKm, taxa: 0 }].sort((a, b) => (Number(a.ateKm) || 9999) - (Number(b.ateKm) || 9999))); }
  function up(i: number, patch: any) { onRaios(lista.map((x, j) => (j === i ? { ...x, ...patch } : x))); }
  function rem(i: number) { onRaios(lista.filter((_, j) => j !== i)); }
  const jaTem = (km: number) => lista.some((r) => Number(r.ateKm) === km);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Faixas de distância a partir do endereço da loja: “até X km custa R$Y”. Toque num preset para adicionar e depois preencha a taxa.</p>
      <MapaAreaEntrega lat={lat} lng={lng} raios={lista} />
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

function Robo({ loja, up, onSalvar, salvando, pode }: { loja: any; up: (p: any) => void; onSalvar: () => void; salvando: boolean; pode: boolean }) {
  const msgs: any[] = loja.roboMensagens ?? [];
  const setMsgs = (m: any[]) => up({ roboMensagens: m });
  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
        ℹ️ Este robô é do <strong>cardápio digital do Regem</strong>. Se a sua loja usa um cardápio externo (Cardápio Web, Anota Aí, Delivery Web…), o robô de atendimento é o <strong>desse cardápio</strong> — aqui o Regem apenas centraliza e administra os pedidos.
      </p>
      {/* Configuração completa dos números (Principal + Marketing) — inclui o QR e o
          cadastro oficial da Meta. Substitui o antigo bloco separado "WhatsApp da loja". */}
      <NumerosWhatsapp pode={pode} />
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

const CANAL_NOME: Record<string, string> = { ifood: 'iFood', rappi: 'Rappi', '99food': '99Food', anotaai: 'Anota Aí', keeta: 'Keeta', delivery_direto: 'Delivery Direto', open_delivery: 'Open Delivery (Abrasel)', cardapio_web: 'Cardápio Web', n8n: 'WhatsApp / n8n', mercadopago: 'Mercado Pago', pagseguro: 'PagBank / PagSeguro' };

// Gateways de PIX (Mercado Pago, PagBank) e WhatsApp/n8n são recursos do CARDÁPIO
// DIGITAL do Regem — só aparecem quando ele está ativo (senão a loja usa cardápio
// externo e o Regem é só centralizador de pedidos).
const CANAIS_DO_CARDAPIO = ['mercadopago', 'pagseguro', 'n8n'];

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
  pagseguro: { cor: '#F9C846', logo: '/integracoes/pagbank.png' },
};

// Texto legível sobre a cor da marca (tinta escura em cores claras, branco em escuras).
function textoContraste(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return '#0F2230';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#0F2230' : '#ffffff';
}

function LogoPlataforma({ canal, nome, cor, tam = 'md' }: { canal: string; nome: string; cor: string; tam?: 'sm' | 'md' | 'lg' }) {
  const [erro, setErro] = useState(false);
  const meta = PLAT_META[canal];
  const box = tam === 'sm' ? 'h-9 w-9' : tam === 'lg' ? 'h-20 w-20' : 'h-12 w-12';
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
      className="group flex w-[200px] flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card px-4 py-5 text-center transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${it.ativo ? 'bg-ok/15 text-ok' : 'bg-secondary text-muted-foreground'}`}>
        <span className={`h-2 w-2 rounded-full ${it.ativo ? 'bg-ok' : 'bg-muted-foreground/40'}`} />
        {it.ativo ? 'ativo' : 'off'}
      </span>
      <LogoPlataforma canal={it.canal} nome={nome} cor={cor} tam="lg" />
      <span className="text-center text-base font-semibold leading-tight">{nome}</span>
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
  // Gateway de PIX primário (só relevante quando os DOIS estão configurados).
  const [pixPrio, setPixPrio] = useState<string>('mercadopago');
  useEffect(() => {
    if (cardapioAtivo) api.getPixPrioritario().then((r: any) => setPixPrio(r?.gateway || 'mercadopago')).catch(() => {});
  }, [cardapioAtivo]);
  const gatewaysComToken = visiveis.filter((it) => (it.canal === 'mercadopago' || it.canal === 'pagseguro') && it.temToken);
  async function mudarPrio(g: string) {
    setPixPrio(g);
    try { await api.setPixPrioritario(g); } catch { /* ignore */ }
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Escolha uma plataforma para conectar. As chaves ficam guardadas com segurança e <strong>não são exibidas de volta</strong> — deixe o campo em branco para manter a atual.</p>
      {!cardapioAtivo && (
        <p className="rounded bg-secondary px-2 py-1 text-[11px] text-muted-foreground">Mercado Pago e WhatsApp/n8n aparecem quando o <strong>cardápio digital do Regem</strong> está ativo — são recursos dele.</p>
      )}
      {gatewaysComToken.length === 2 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2 text-[11px]">
          <span className="font-semibold">Gateway de PIX primário:</span>
          <select value={pixPrio} onChange={(e) => mudarPrio(e.target.value)} disabled={!pode}
            className="h-7 rounded border border-input bg-card px-2">
            <option value="mercadopago">Mercado Pago</option>
            <option value="pagseguro">PagBank / PagSeguro</option>
          </select>
          <span className="text-muted-foreground">o outro entra como <strong>fallback</strong> se o primário falhar ao gerar o QR.</span>
        </div>
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
  const temCor = !['n8n', 'mercadopago', 'pagseguro'].includes(it.canal);
  const ehN8n = it.canal === 'n8n';
  const ehMp = it.canal === 'mercadopago';
  const ehPs = it.canal === 'pagseguro';
  const ehGatewayPix = ehMp || ehPs;
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
  const [pixTestBusy, setPixTestBusy] = useState(false);
  const [pixTestMsg, setPixTestMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  async function testarPix() {
    setPixTestBusy(true);
    setPixTestMsg(null);
    try {
      const r: any = await api.testarGatewayPix(it.canal, tokenV || undefined);
      setPixTestMsg({ ok: true, txt: r?.conta ? `Conectado ✓ — ${r.conta}` : 'Conexão OK ✓' });
    } catch (e: any) {
      setPixTestMsg({ ok: false, txt: 'Falhou: ' + (e?.message ?? 'token inválido') });
    } finally {
      setPixTestBusy(false);
    }
  }
  const [ambiente, setAmbiente] = useState('producao');
  const [cwMsg, setCwMsg] = useState('');
  const [cwBusy, setCwBusy] = useState(false);
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
  // PRODUÇÃO — onboarding self-service (sem credenciais digitadas pelo lojista).
  const [f99Status, setF99Status] = useState<any>(null);
  const [f99Lojas, setF99Lojas] = useState<any[]>([]);
  async function carregarStatusF99() {
    try { setF99Status(await api.food99Status()); } catch { /* ignore */ }
  }
  useEffect(() => {
    if (ehFood99) carregarStatusF99();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ehFood99]);
  // "Já autorizei": puxa as lojas autorizadas do 99Food (getAuthorizedShops) —
  // funciona mesmo se o webhook shopBindStatus não tiver chegado.
  async function jaAutorizeiF99() {
    setF99Busy(true); setF99Msg('Buscando lojas autorizadas no 99Food…');
    try {
      await carregarStatusF99();
      const r: any = await api.food99LojasAutorizadas();
      const lojas = r?.lojas ?? [];
      setF99Lojas(lojas);
      if (!lojas.length) setF99Msg('Ainda não vejo nenhuma loja autorizada. Confirme que autorizou no 99Food (conta da loja) e tente de novo em ~30s.');
      else setF99Msg(`${lojas.length} loja(s) autorizada(s) encontrada(s). Selecione a sua.`);
    } catch (e: any) {
      setF99Msg('Erro ao buscar lojas: ' + (e?.message ?? ''));
    } finally {
      setF99Busy(false);
    }
  }
  // Gera o link de autorização (getUrl) e abre em outra aba — o lojista autoriza a
  // loja 99food dele; o vínculo volta por webhook (shopBindStatus).
  async function conectarF99() {
    setF99Busy(true); setF99Msg('Gerando link de autorização…');
    try {
      const r: any = await api.food99Conectar();
      if (r?.url) {
        window.open(r.url, '_blank', 'noopener');
        setF99Msg('Abrimos a página do 99Food em outra aba. Faça login na sua conta 99Food e autorize a loja; depois volte e clique em "Já autorizei".');
      } else {
        setF99Msg('Não consegui gerar o link — tente de novo em instantes.');
      }
    } catch (e: any) {
      setF99Msg('Erro ao conectar: ' + (e?.message ?? ''));
    } finally {
      setF99Busy(false);
    }
  }
  async function vincularF99(appShopId?: string) {
    setF99Busy(true); setF99Msg('Confirmando a loja…');
    try {
      await api.food99Vincular(appShopId ?? f99Status?.pendingBind?.appShopId);
      setF99Msg('Loja conectada! Os pedidos do 99Food vão cair no painel automaticamente.');
      setF99Lojas([]);
      await carregarStatusF99();
    } catch (e: any) {
      setF99Msg('Erro ao confirmar: ' + (e?.message ?? ''));
    } finally {
      setF99Busy(false);
    }
  }
  async function recusarF99() {
    setF99Busy(true); setF99Msg('');
    try {
      await api.food99RecusarBind();
      setF99Msg('Ok, descartei essa loja. Clique em "Conectar" de novo se precisar.');
      await carregarStatusF99();
    } catch { /* ignore */ } finally {
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
          {ehPs ? (
            <>
              <p className="text-[11px] text-muted-foreground">PIX online direto na <strong>sua conta PagBank</strong> — o dinheiro cai em você. Precisa de uma <strong>chave PIX ativa</strong> na conta. Cole o <strong>token</strong> de produção (PagBank → Perfis de integração → Vendedor → Credenciais / Gerar Token).</p>
              <p className="rounded bg-warn/10 px-2 py-1 text-[11px] text-warn">O webhook do PagBank é automático (o Regem informa a URL na cobrança). Requer conta de produção (homologada).</p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-muted-foreground">PIX online direto na <strong>sua conta Mercado Pago</strong> — o dinheiro cai em você. Cole o <strong>Access Token</strong> de produção (Mercado Pago → Seus negócios → Configurações → Credenciais de produção → <em>Access Token</em>).</p>
              <p className="rounded bg-warn/10 px-2 py-1 text-[11px] text-warn">O webhook do Mercado Pago é automático (o Regem informa a URL na cobrança). A <strong>assinatura secreta</strong> abaixo é opcional — reforça a segurança do webhook.</p>
            </>
          )}
          <Campo label={`${ehPs ? 'Token PagBank' : 'Access Token'}${it.temToken ? ' (salvo)' : ''}`}>
            <Input type="password" value={tokenV} onChange={(e) => setTokenV(e.target.value)} placeholder={it.temToken ? '•••••• (mantém)' : ehPs ? 'cole o token de produção do PagBank' : 'cole o Access Token de produção do Mercado Pago'} className="h-8" disabled={!pode} />
          </Campo>
          {ehMp && (
            <Campo label={`Assinatura secreta do webhook — opcional${it.temSecret ? ' (salva)' : ''}`}>
              <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={it.temSecret ? '•••••• (mantém)' : 'Mercado Pago → Webhooks → Assinatura secreta'} className="h-8" disabled={!pode} />
            </Campo>
          )}
          {pode && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              {pixTestMsg ? (
                <p className={`min-w-0 flex-1 truncate text-[11px] ${pixTestMsg.ok ? 'text-ok' : 'text-destructive'}`}>{pixTestMsg.txt}</p>
              ) : (
                <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">Valida o token na API do provedor (usa o do campo, ou o salvo se vazio).</span>
              )}
              <Button type="button" size="sm" variant="outline" disabled={pixTestBusy} onClick={testarPix}>
                {pixTestBusy ? 'Testando…' : 'Testar conexão'}
              </Button>
            </div>
          )}
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
          <p className="text-[11px] text-muted-foreground">Integração oficial do <strong>99Food (DiDi Food)</strong>. Você <strong>não precisa digitar nenhuma credencial</strong>: clique em <strong>Conectar com 99Food</strong>, faça login na sua conta 99Food e autorize a loja. Os pedidos passam a cair no painel automaticamente.</p>
          {f99Status?.configurado === false && (
            <p className="rounded bg-warn/10 px-2 py-1 text-[11px] text-warn">A integração ainda não foi habilitada no servidor. Fale com o suporte Regem.</p>
          )}
          {f99Status?.conectado ? (
            <div className="rounded border border-ok/40 bg-ok/10 px-3 py-2 text-[12px]">
              <p className="font-medium text-ok">Conectado{f99Status?.shopName ? `: ${f99Status.shopName}` : ''}</p>
              <p className="text-[11px] text-muted-foreground">Loja vinculada. Os pedidos do 99Food chegam automaticamente por webhook.</p>
            </div>
          ) : f99Status?.pendingBind ? (
            <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-[12px]">
              <p className="font-medium">Uma loja foi vinculada: <strong>{f99Status.pendingBind.nome ?? f99Status.pendingBind.appShopId}</strong></p>
              {f99Status.pendingBind.addr && <p className="text-[11px] text-muted-foreground">{f99Status.pendingBind.addr}</p>}
              <p className="mt-1 text-[11px] text-muted-foreground">É a sua loja?</p>
              {pode && (
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={f99Busy} onClick={() => vincularF99()}>Sim, é a minha</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={f99Busy} onClick={recusarF99}>Não é minha</Button>
                </div>
              )}
            </div>
          ) : (
            pode && (
              <div className="grid gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={f99Busy} onClick={conectarF99}>Conectar com 99Food</Button>
                  <Button type="button" size="sm" variant="outline" disabled={f99Busy} onClick={jaAutorizeiF99}>Já autorizei</Button>
                </div>
                {f99Lojas.length > 0 && (
                  <div className="rounded border border-border bg-secondary/40 p-2 text-[12px]">
                    <p className="mb-1 font-medium">Lojas autorizadas — selecione a sua:</p>
                    <div className="grid gap-1">
                      {f99Lojas.map((l: any) => (
                        <div key={l.appShopId} className="flex items-center justify-between gap-2 rounded bg-background px-2 py-1">
                          <span className="truncate">{l.nome ?? l.appShopId}</span>
                          <Button type="button" size="sm" disabled={f99Busy} onClick={() => vincularF99(l.appShopId)}>Vincular</Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          )}
          {f99Status?.conectado && pode && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-2">
              <Button type="button" size="sm" variant="ghost" disabled={f99Busy} onClick={exportarCatalogoF99} title="Cria as categorias/itens do Regem no 99Food">Exportar catálogo</Button>
            </div>
          )}
          {f99Msg && <p className="text-[11px] text-muted-foreground">{f99Msg}</p>}
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

      {/* Desativar — vale para QUALQUER integração ativa (o iFood tem o próprio fluxo
          de solicitar remoção à distribuição, logo acima). */}
      {pode && it.ativo && !ehIfood && (
        <div className="mt-3 flex justify-end border-t border-border pt-3">
          <button
            type="button"
            className="text-xs font-semibold text-destructive hover:underline"
            onClick={() => {
              if (!confirm(`Desativar a integração ${CANAL_NOME[it.canal] ?? it.canal}? Você pode reativar depois.`)) return;
              onSalvar({ canal: it.canal, ativo: false });
            }}
          >
            Desativar integração
          </button>
        </div>
      )}
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
      <p className="rounded-md bg-secondary/60 px-2.5 py-1.5 text-[11px] text-muted-foreground">
        📐 Tamanho ideal: <strong>1200 × 480 px</strong> (proporção 5:2, otimizado para celular). Fotos de
        outros tamanhos são <strong>centralizadas e enquadradas</strong> automaticamente no espaço do banner.
      </p>
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
