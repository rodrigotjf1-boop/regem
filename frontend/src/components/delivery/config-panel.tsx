'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';

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
      { k: 'loja', label: 'Loja' },
      { k: 'endereco', label: 'Endereço' },
      { k: 'horarios', label: 'Horários' },
      { k: 'tipos', label: 'Tipos de pedido' },
      { k: 'area', label: 'Área de atendimento' },
    ],
  },
  {
    grupo: 'Operação',
    itens: [
      { k: 'banners', label: 'Banners', breve: true },
      { k: 'impressoras', label: 'Impressoras', breve: true },
      { k: 'integracoes', label: 'Integrações', breve: true },
      { k: 'robo', label: 'Robô de atendimento', breve: true },
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
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api.cardapioConfig().then((c: any) => setLoja(c ?? {})).catch(() => setLoja({}));
    api.cardapioBairros().then((b: any) => setBairros((b as any[]) ?? [])).catch(() => {});
  }, []);

  const up = (patch: any) => setLoja((l: any) => ({ ...(l ?? {}), ...patch }));

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
      <div className="flex h-[86vh] w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-card" onClick={(e) => e.stopPropagation()}>
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
                    <SalvarBar onSalvar={salvarLoja} salvando={salvando} pode={isGestor} />
                  </Secao>
                )}

                {/* ENDEREÇO */}
                {sec === 'endereco' && (
                  <Secao dica="Endereço físico da loja.">
                    <div className="grid grid-cols-2 gap-2">
                      <Campo label="CEP"><Input value={loja.endCep ?? ''} onChange={(e) => up({ endCep: e.target.value })} /></Campo>
                      <Campo label="Cidade"><Input value={loja.endCidade ?? ''} onChange={(e) => up({ endCidade: e.target.value })} /></Campo>
                      <Campo label="Rua"><Input value={loja.endRua ?? ''} onChange={(e) => up({ endRua: e.target.value })} /></Campo>
                      <Campo label="Número"><Input value={loja.endNumero ?? ''} onChange={(e) => up({ endNumero: e.target.value })} /></Campo>
                      <Campo label="Bairro"><Input value={loja.endBairro ?? ''} onChange={(e) => up({ endBairro: e.target.value })} /></Campo>
                      <Campo label="Estado (UF)"><Input value={loja.endEstado ?? ''} onChange={(e) => up({ endEstado: e.target.value })} maxLength={2} /></Campo>
                      <Campo label="Referência"><Input value={loja.endReferencia ?? ''} onChange={(e) => up({ endReferencia: e.target.value })} /></Campo>
                      <Campo label="Complemento"><Input value={loja.endComplemento ?? ''} onChange={(e) => up({ endComplemento: e.target.value })} /></Campo>
                    </div>
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
                  <AreaAtendimento bairros={bairros} onSalvar={salvarBairros} salvando={salvando} pode={isGestor} />
                )}

                {/* EM BREVE */}
                {['banners', 'impressoras', 'integracoes', 'robo'].includes(sec) && (
                  <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    <p className="font-semibold">{secLabel(sec)}</p>
                    <p className="mt-1">{breveTexto(sec)}</p>
                  </div>
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
function breveTexto(k: string) {
  return k === 'banners' ? 'Banners rotativos do cardápio digital — em breve.'
    : k === 'impressoras' ? 'Direcionamento de impressão (caixa/cozinha) + vias — em breve (detecção de impressoras via servidor local).'
    : k === 'integracoes' ? 'Credenciais dos apps de delivery externos — em breve.'
    : 'Mensagens do robô de auto atendimento — em breve.';
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

function AreaAtendimento({ bairros, onSalvar, salvando, pode }: { bairros: any[]; onSalvar: (l: any[]) => void; salvando: boolean; pode: boolean }) {
  const [lista, setLista] = useState<any[]>(bairros);
  useEffect(() => { setLista(bairros); }, [bairros]);
  const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  function add() { setLista((l) => [...l, { nome: '', taxa: 0, ativo: true }]); }
  function up(i: number, patch: any) { setLista((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x))); }
  function rem(i: number) { setLista((l) => l.filter((_, j) => j !== i)); }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Regiões de entrega por <strong>bairro</strong> (nome + taxa). Use o marcador para ativar/desativar cada bairro. <em>Por raio/distância vem em seguida.</em></p>
      <div className="space-y-1.5">
        {lista.length === 0 && <p className="text-sm text-muted-foreground">Nenhum bairro cadastrado.</p>}
        {lista.map((b, i) => (
          <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2">
            <input type="checkbox" className="h-4 w-4 accent-primary" disabled={!pode} checked={b.ativo !== false} onChange={(e) => up(i, { ativo: e.target.checked })} title="Ativar/desativar" />
            <Input value={b.nome} onChange={(e) => up(i, { nome: e.target.value })} placeholder="Bairro" className="h-8 flex-1" disabled={!pode} />
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">R$</span>
              <Input inputMode="decimal" value={b.taxa} onChange={(e) => up(i, { taxa: e.target.value })} className="h-8 w-20" disabled={!pode} />
            </div>
            {!b.ativo && <span className="text-[10px] font-bold text-muted-foreground">off</span>}
            {pode && <button type="button" className="text-xs text-destructive" onClick={() => rem(i)}>remover</button>}
          </div>
        ))}
      </div>
      {pode && (
        <div className="flex items-center justify-between">
          <Button type="button" size="sm" variant="outline" onClick={add}>＋ Bairro</Button>
          <Button type="button" onClick={() => onSalvar(lista)} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      )}
      {lista.some((b) => b.nome && Number(b.taxa) > 0) && (
        <p className="text-[11px] text-muted-foreground">Ex.: {lista.filter((b) => b.nome).slice(0, 3).map((b) => `${b.nome} ${brl(Number(b.taxa))}`).join(' · ')}</p>
      )}
    </div>
  );
}
