'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Check, PackageOpen, Plus, Recycle } from 'lucide-react';
import { api, getCategoria, podePerm } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import {
  FiltroBusca, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio,
  dataBr, hojeIso, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
const selectCls = 'flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm';
const CAMPO_LABEL: Record<string, string> = {
  loja: 'Nome da loja', produto: 'Produto', unidade: 'Unidade', fabricacao: 'Fabricação',
  compra: 'Data da compra', status: 'Status (fechado/uso)', validade: 'Validade', responsavel: 'Responsável',
};
type Fontes = { produtos: any[]; fichas: any[]; itens: any[]; lotes: any[] };
const SEM_FONTES: Fontes = { produtos: [], fichas: [], itens: [], lotes: [] };

// Só a etiqueta VIVA (fechada ou em uso) entra na lista e oferece "usei"/"perda". As já
// baixadas e as que viraram perda saem — antes a vencida aparecia de novo e o botão estava lá
// para gerar a segunda perda. O servidor já manda só as vivas, na ordem da validade; o filtro
// e a ordem daqui valem para o servidor de loja de versão anterior, que ignora o pedido.
const viva = (e: any) => e.status === 'fechado' || e.status === 'em_uso';
const SITUACOES: Situacao<any>[] = [
  { rotulo: 'Vencidas', filtro: (e) => !!e.vencida, tom: 'critico' },
  { rotulo: 'Vencem até amanhã', filtro: (e) => !e.vencida && Number(e.diasRestantes) <= 1, tom: 'aviso' },
  { rotulo: 'Em uso', filtro: (e) => e.status === 'em_uso' },
  { rotulo: 'Fechadas', filtro: (e) => e.status === 'fechado' },
];
const ID_TITULO = 'etiquetas-titulo';
function prazo(e: any): string {
  const d = Number(e.diasRestantes);
  if (e.vencida || d < 0) return d < 0 ? `venceu há ${-d} dia(s)` : 'vencida';
  return d === 0 ? 'vence hoje' : `${d} dia(s)`;
}

// Aba Etiquetas de validade: as etiquetas vivas numa lista só (vencidas, as que vencem até
// amanhã, em uso e fechadas), o campo do leitor, e as ações na linha — abrir, baixar e perda.
// Gerar etiqueta abre na gaveta. O desenho da etiqueta fica em "Modelo".
// `gerarPara` = fonte já escolhida por outra aba ("lote:<id>", vinda de Validades).
export function EtiquetasSecao({
  gerarPara,
  aoAbrirGerar,
  aoMudarEstoque,
}: {
  gerarPara?: string | null;
  /** Avisa que a fonte pedida já foi usada (a aba que pediu pode esquecer). */
  aoAbrirGerar?: () => void;
  aoMudarEstoque?: () => void;
}) {
  const [aba, setAba] = useState<'lista' | 'modelo'>('lista');
  const [fontes, setFontes] = useState<Fontes>(SEM_FONTES);
  const [lista, setLista] = useState<any[] | null>(null);
  const [template, setTemplate] = useState<any>(null);
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [codigo, setCodigo] = useState('');
  const [gerar, setGerar] = useState<{ fonte: string } | null>(null);
  const [perda, setPerda] = useState<any>(null);

  const reload = useCallback(async () => {
    const [f, l, t] = await Promise.all([
      api.etiquetaFontes().catch(() => SEM_FONTES),
      api.etiquetasValidade(true).catch(() => []),
      api.etiquetaTemplate().catch(() => null),
    ]);
    setFontes(f as any);
    setLista(Array.isArray(l) ? l : []);
    setTemplate(t);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  // Outra aba pediu "gerar etiqueta deste lote": abre a gaveta já com ele escolhido.
  useEffect(() => {
    if (!gerarPara || lista === null) return;
    setAba('lista');
    setGerar({ fonte: gerarPara });
    aoAbrirGerar?.();
  }, [gerarPara, lista, aoAbrirGerar]);

  async function ler(e: React.FormEvent) {
    e.preventDefault();
    if (!codigo.trim()) return;
    try {
      const r: any = await api.lerEtiqueta(codigo.trim());
      toast.success(r?.acao === 'aberto' ? 'Etiqueta aberta (em uso).' : 'Etiqueta baixada.');
      setCodigo('');
      reload();
    } catch (err: any) {
      toast.error(err?.message || 'Código não encontrado.');
    }
  }
  async function abrir(e: any) {
    try {
      const r: any = await api.abrirEtiqueta(e.id);
      toast.success(r?.reimpresso ? 'Aberta — nova via impressa (validade encurtou).' : 'Aberta (em uso).');
      reload();
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao abrir.');
    }
  }
  async function baixar(e: any) {
    try {
      await api.finalizarEtiqueta(e.id);
      toast.success('Baixada (usada).');
      await reload();
      document.getElementById(ID_TITULO)?.focus(); // a linha (e o botão clicado) saiu da lista
    } catch (err: any) {
      toast.error(err?.message || 'Falha na operação.');
    }
  }

  const vivas = (lista ?? []).filter(viva).sort((a, b) => String(a.validade).localeCompare(String(b.validade)));
  const b = semAcento(busca);
  const base = vivas.filter((e) => !b || semAcento(`${e.descricao} ${e.codigo}`).includes(b));
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || sit >= 0);
  const limpar = () => { setBusca(''); setSit(-1); };
  // O servidor é quem autoriza; aqui só não se oferece o que ele recusaria. Gerar é da gestão
  // com "editar estoque"; ler, abrir, baixar e perda são do ponto de baixa (permissão "desperdício").
  const podeGerar = ['presidente', 'gerente', 'supervisao', 'suporte'].includes(getCategoria() ?? '') && podePerm('estoque', 'editar');
  const podeBaixar = podePerm('desperdicio');
  const ficha = (ligada: boolean) =>
    `min-h-10 whitespace-nowrap rounded-md border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      ligada ? 'border-foreground bg-foreground text-background' : `border-input bg-card ${texto2} hover:text-foreground`
    }`;

  return (
    <section className="space-y-3" aria-labelledby={ID_TITULO}>
      <TituloLista id={ID_TITULO} titulo="Etiquetas de validade" total={vivas.length} mostrando={aba === 'lista' ? linhas.length : vivas.length}
        um="etiqueta viva" varios="etiquetas vivas" extra="as baixadas saem da lista">
        <div className="flex gap-1" role="group" aria-label="O que ver">
          <button type="button" aria-pressed={aba === 'lista'} className={ficha(aba === 'lista')} onClick={() => setAba('lista')}>Etiquetas</button>
          <button type="button" aria-pressed={aba === 'modelo'} className={ficha(aba === 'modelo')} onClick={() => setAba('modelo')}>Modelo</button>
        </div>
        {aba === 'lista' && podeGerar && (
          <Button type="button" onClick={() => setGerar({ fonte: '' })}><Plus className="h-4 w-4" aria-hidden="true" /> Gerar etiqueta</Button>
        )}
      </TituloLista>

      {aba === 'modelo' && (template ? <TemplateEditor template={template} onSaved={reload} /> : <SkeletonList rows={3} />)}

      {aba === 'lista' && lista === null && <SkeletonList rows={4} />}
      {aba === 'lista' && lista !== null && (
        <>
          {podeBaixar && (
            <Card className="p-3">
              <form onSubmit={ler} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="etiquetas-leitor">Ler o código da etiqueta (abre ou baixa)</Label>
                  <Input id="etiquetas-leitor" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Aponte o leitor ou digite o código" inputMode="numeric" autoComplete="off" />
                </div>
                <Button type="submit" variant="outline">Ler</Button>
              </form>
            </Card>
          )}
          <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
          <Filtros>
            <FiltroBusca id="etiquetas-busca" valor={busca} aoMudar={setBusca} placeholder="Produto ou código da etiqueta" />
          </Filtros>

          {vivas.length === 0 ? (
            <Vazio>Nenhuma etiqueta viva. Gere a etiqueta de um produto, de uma ficha ou de um lote recebido.</Vazio>
          ) : linhas.length === 0 ? (
            <Vazio aoLimpar={limpar} />
          ) : (
            <ListaDados
              legenda="Etiquetas de validade vivas"
              linhas={linhas}
              chave={(e) => e.id}
              nome={(e) => e.descricao}
              colunas={[
                { titulo: 'Produto', celula: (e) => <NomeComApoio nome={e.descricao} apoio={<span className="font-mono">#{e.codigo}</span>} /> },
                { titulo: 'Validade', celula: (e) => <><span className="font-mono">{dataBr(e.validade)}</span><span className={`block text-xs ${texto2}`}>{prazo(e)}</span></> },
                { titulo: 'Situação', celula: (e) => (e.vencida ? <Selo tom="critico">vencida</Selo> : e.status === 'em_uso' ? <Selo tom="aviso">em uso</Selo> : <Selo tom="info">fechada</Selo>) },
              ]}
              acoes={(e) =>
                !podeBaixar
                  ? []
                  : [
                      // E2 — escolher: Abrir (depois baixar) ou Baixar direto (usou já).
                      ...(e.status === 'fechado' ? [{ rotulo: 'Abrir', icone: PackageOpen, aoClicar: abrir }] : []),
                      { rotulo: 'Baixar (usei)', icone: Check, aoClicar: baixar },
                      ...(e.vencida ? [{ rotulo: 'Perda', icone: Recycle, aoClicar: setPerda, tom: 'perigo' as const }] : []),
                    ]
              }
            />
          )}
          {filtrando && linhas.length > 0 && (
            <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
          )}
        </>
      )}

      {gerar && (
        <GerarEtiqueta fontes={fontes} fonteInicial={gerar.fonte} aoFechar={() => setGerar(null)} aoGerar={() => { setGerar(null); reload(); }} />
      )}
      {perda && (
        <PerdaDialogo etiqueta={perda} aoFechar={() => setPerda(null)}
          aoRegistrar={async () => {
            setPerda(null);
            await reload();
            document.getElementById(ID_TITULO)?.focus(); // a etiqueta vencida saiu da lista
            aoMudarEstoque?.();
          }} />
      )}
    </section>
  );
}

// ── gerar etiqueta (gaveta) ─────────────────────────────────────────────────────────────────
function GerarEtiqueta({ fontes, fonteInicial, aoFechar, aoGerar }: { fontes: Fontes; fonteInicial: string; aoFechar: () => void; aoGerar: () => void }) {
  const formId = useId();
  const chaves = useMemo(
    () => [
      ...(fontes.produtos ?? []).map((x: any) => `produto:${x.id}`),
      ...(fontes.fichas ?? []).map((x: any) => `ficha:${x.id}`),
      ...(fontes.itens ?? []).map((x: any) => `item:${x.id}`),
      ...(fontes.lotes ?? []).map((x: any) => `lote:${x.id}`),
    ],
    [fontes],
  );
  // A fonte pedida por outra aba só vale se existir aqui (lote sem validade não é fonte).
  const [fonteKey, setFonteKey] = useState(() => (chaves.includes(fonteInicial) ? fonteInicial : ''));
  const [tipoUso, setTipoUso] = useState<'novo' | 'usado'>('novo');
  const [quantidade, setQuantidade] = useState('1');
  const [fabricacao, setFabricacao] = useState(hojeIso);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');

  async function gerar(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!fonteKey) { setErro('Escolha o produto, a ficha, o insumo ou o lote.'); return; }
    const [tipo, id] = fonteKey.split(':');
    setErro('');
    setBusy(true);
    try {
      const r: any = await api.criarEtiqueta({
        produtoId: tipo === 'produto' ? id : undefined,
        fichaId: tipo === 'ficha' ? id : undefined,
        itemId: tipo === 'item' ? id : undefined,
        loteId: tipo === 'lote' ? id : undefined,
        tipoUso,
        quantidade: Number(quantidade) || 1,
        fabricacao,
      });
      toast.success(`${r?.criadas ?? 1} etiqueta(s) gerada(s) e enviada(s) à impressão.`);
      aoGerar();
    } catch (err: any) {
      setErro(err?.message || 'Falha ao gerar etiqueta.');
      setBusy(false);
    }
  }
  const semFontes = chaves.length === 0;
  const opcao = (ligada: boolean) =>
    `min-h-11 border-r border-input text-sm font-semibold last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
      ligada ? 'bg-foreground text-background' : 'bg-card text-foreground hover:bg-secondary'
    }`;

  return (
    <Gaveta
      titulo="Gerar etiqueta de validade"
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>{semFontes ? 'Fechar' : 'Cancelar'}</Button>
          {!semFontes && <Button type="submit" form={formId} disabled={busy}>{busy ? 'Gerando…' : 'Gerar e imprimir'}</Button>}
        </>
      }
    >
      {semFontes ? (
        <p className={`text-sm ${texto2}`}>
          Nenhuma fonte com validade. Ative “Controla validade” num produto, informe a validade numa ficha, cadastre a validade num insumo — ou confira uma compra, que cada lote recebido vira uma fonte aqui.
        </p>
      ) : (
        <form id={formId} onSubmit={gerar} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="etq-fonte">Produto / ficha / lote</Label>
            <select id="etq-fonte" data-foco-inicial className={selectCls} value={fonteKey} onChange={(e) => setFonteKey(e.target.value)} required>
              <option value="">— escolha —</option>
              <optgroup label="Produtos">
                {(fontes.produtos ?? []).map((p: any) => <option key={p.id} value={`produto:${p.id}`}>{p.nome}</option>)}
              </optgroup>
              <optgroup label="Fichas técnicas">
                {(fontes.fichas ?? []).map((f: any) => <option key={f.id} value={`ficha:${f.id}`}>{f.nome}</option>)}
              </optgroup>
              <optgroup label="Insumos">
                {(fontes.itens ?? []).map((i: any) => <option key={i.id} value={`item:${i.id}`}>{i.nome}</option>)}
              </optgroup>
              {/* Lote da compra conferida: a validade é a DAQUELA entrega, não uma data fixa do
                  cadastro — e a etiqueta guarda o vínculo, então um recall alcança até o que já
                  foi aberto. */}
              <optgroup label="Lotes recebidos">
                {(fontes.lotes ?? []).map((l: any) => (
                  <option key={l.id} value={`lote:${l.id}`}>
                    {l.nome}{l.codigo ? ` · lote ${l.codigo}` : ''} · vence {String(l.validade).slice(0, 10).split('-').reverse().join('/')}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium">Produto novo ou usado?</span>
            <div className="grid grid-cols-2 overflow-hidden rounded-md border border-input" role="group" aria-label="Produto novo ou usado">
              <button type="button" aria-pressed={tipoUso === 'novo'} className={opcao(tipoUso === 'novo')} onClick={() => setTipoUso('novo')}>Novo (fechado)</button>
              <button type="button" aria-pressed={tipoUso === 'usado'} className={opcao(tipoUso === 'usado')} onClick={() => setTipoUso('usado')}>Usado (aberto)</button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="etq-qtd">Quantidade de etiquetas</Label>
              <Input id="etq-qtd" type="number" min={1} max={50} inputMode="numeric" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
            </div>
            {tipoUso === 'novo' && (
              <div className="space-y-1.5">
                <Label htmlFor="etq-fab">Data de fabricação</Label>
                <Input id="etq-fab" type="date" value={fabricacao} onChange={(e) => setFabricacao(e.target.value)} />
              </div>
            )}
          </div>
          <p className={`text-xs ${texto2}`}>A validade sai da fonte escolhida e o desenho, do modelo salvo em “Modelo”.</p>
          {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
        </form>
      )}
    </Gaveta>
  );
}

// ── perda da etiqueta vencida (diálogo) ─────────────────────────────────────────────────────
// A etiqueta não sabe quanto representa (um pote de 500 g ou de 2 kg): quem registra a perda
// informa. Com quantidade, a perda baixa o estoque pelo mesmo caminho do desperdício manual;
// sem ela, fica só o registro — e a pessoa é avisada disso.
function PerdaDialogo({ etiqueta: e, aoFechar, aoRegistrar }: { etiqueta: any; aoFechar: () => void; aoRegistrar: () => void }) {
  const [qtd, setQtd] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function confirmar() {
    if (salvando) return;
    const q = qtd.trim() ? Number(qtd.replace(',', '.')) : undefined;
    if (q !== undefined && !(q > 0)) { setErro('Informe uma quantidade maior que zero, ou deixe em branco.'); return; }
    setErro('');
    setSalvando(true);
    try {
      const r: any = await api.perdaEtiqueta(e.id, q);
      toast.success(
        r?.baixouEstoque
          ? `Perda registrada e ${q} ${e.unidadeMedida ?? ''} baixado(s) do estoque.`
          : 'Perda registrada sem baixa de estoque (sem quantidade informada).',
      );
      aoRegistrar();
    } catch (err: any) {
      setErro(err?.message || 'Falha ao registrar a perda.');
      setSalvando(false);
    }
  }

  return (
    <Dialogo alerta titulo={`Perda: ${e.descricao}`} aoFechar={aoFechar} fecharNoFundo={false}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>Cancelar</Button>
          <Button type="button" variant="destructive" onClick={confirmar} disabled={salvando}>{salvando ? 'Registrando…' : 'Registrar perda'}</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        <p>A etiqueta <span className="font-mono">#{e.codigo}</span> venceu em {dataBr(e.validade)}.</p>
        {e.itemId ? (
          <div className="space-y-1.5">
            <Label htmlFor="perda-qtd">Quanto foi perdido{e.unidadeMedida ? `, em ${e.unidadeMedida}` : ''}? (opcional)</Label>
            <Input id="perda-qtd" data-foco-inicial type="number" min={0} step="any" inputMode="decimal" value={qtd} onChange={(ev) => setQtd(ev.target.value)} placeholder="ex.: 0,5" aria-describedby="perda-qtd-ajuda" />
            <p id="perda-qtd-ajuda" className={`text-xs ${texto2}`}>Com a quantidade, a perda baixa o estoque. Sem ela, fica só o registro.</p>
          </div>
        ) : (
          <p className="rounded-md border-l-4 border-info bg-info/10 px-3 py-2">Etiqueta sem insumo vinculado: a perda fica registrada, sem baixa de estoque.</p>
        )}
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 font-medium">{erro}</p>}
      </div>
    </Dialogo>
  );
}

// Tamanhos comuns de etiqueta térmica (mm) — desktop Argox/Elgin/Zebra, food/RDC 216.
const TAMANHOS = ['33x22', '40x25', '50x30', '60x30', '60x40', '40x40', '80x40', '100x50'];
// Valores de exemplo p/ a prévia (espelham renderEtiqueta do backend).
const CAMPO_EXEMPLO: Record<string, string> = {
  loja: 'Minha Loja', produto: 'Tomate', unidade: 'Unid.: kg',
  fabricacao: 'Fabricacao: 11/08/2026', compra: 'Compra: 09/08/2026',
  status: 'Status: FECHADO', validade: 'VALIDADE: 13/08/2026', responsavel: 'Resp.: Rodrigo',
};

// Modelo MODERNO (mig 306): o desenho é fixo — produto, manipulação e validade sempre saem;
// a data da compra não tem lugar nele; os demais campos só ligam e desligam (sem negrito).
const MODERNO_SEMPRE = ['produto', 'fabricacao', 'validade'];
const MODERNO_FORA = ['compra'];
// Menor que isso o QR não cabe ao lado do texto: o servidor da loja imprime o clássico.
const MODERNO_MIN = { largura: 40, altura: 25 };

function TemplateEditor({ template, onSaved }: { template: any; onSaved: () => void }) {
  const [campos, setCampos] = useState<any[]>(template.campos ?? []);
  const [tamanho, setTamanho] = useState<string>(template.tamanho ?? '40x40');
  const [codigoTipo, setCodigoTipo] = useState(template.codigoTipo ?? 'code128');
  const [modelo, setModelo] = useState<'classico' | 'moderno'>(template.modelo === 'moderno' ? 'moderno' : 'classico');
  const [busy, setBusy] = useState(false);
  const moderno = modelo === 'moderno';

  function trocarModelo(novo: 'classico' | 'moderno') {
    setModelo(novo);
    // O moderno foi desenhado com o responsável: ao escolher o modelo ele já vem ligado
    // (dá para desligar em seguida).
    if (novo === 'moderno') {
      setCampos((prev) =>
        prev.some((c) => c.campo === 'responsavel')
          ? prev.map((c) => (c.campo === 'responsavel' ? { ...c, visivel: true } : c))
          : [...prev, { campo: 'responsavel', visivel: true, negrito: false }],
      );
    }
  }

  const isCustom = !TAMANHOS.includes(tamanho);
  const [cw, ch] = (/^\d+x\d+$/.test(tamanho) ? tamanho.split('x') : ['40', '40']).map(Number);
  const setDim = (l: number, a: number) => {
    const L = Math.max(10, Math.min(200, Math.round(l) || 40));
    const A = Math.max(10, Math.min(200, Math.round(a) || 40));
    setTamanho(`${L}x${A}`);
  };

  function toggle(i: number, key: 'visivel' | 'negrito') {
    setCampos((prev) => prev.map((c, idx) => (idx === i ? { ...c, [key]: !c[key] } : c)));
  }

  async function salvar() {
    setBusy(true);
    try {
      await api.salvarEtiquetaTemplate({ campos, tamanho, codigoTipo, modelo });
      toast.success('Modelo salvo.');
      onSaved();
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao salvar.');
    } finally {
      setBusy(false);
    }
  }

  // Prévia: caixa proporcional ao tamanho (mm). s = px por mm (limita p/ caber).
  // O moderno tem letra miúda nos rótulos: a prévia dele pode ser um pouco maior (ainda cabe em 375 px).
  const s = moderno ? Math.min(4.4, 260 / Math.max(cw, ch)) : Math.min(3.4, 250 / Math.max(cw, ch));
  const visiveis = campos.filter((c) => c.visivel !== false);
  const pequenaDemais = cw < MODERNO_MIN.largura || ch < MODERNO_MIN.altura;
  const ligado = (campo: string) => campos.find((c) => c.campo === campo)?.visivel !== false && campos.some((c) => c.campo === campo);

  return (
    <Card className="p-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Editor */}
        <div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="etq-modelo">Modelo</Label>
              <select
                id="etq-modelo"
                className={selectCls}
                value={modelo}
                onChange={(e) => trocarModelo(e.target.value === 'moderno' ? 'moderno' : 'classico')}
              >
                <option value="classico">Clássico — uma linha por campo</option>
                <option value="moderno">Moderno — faixa do produto e dia da validade</option>
              </select>
              {moderno && (
                <p className="text-xs text-muted-foreground" role="status">
                  {pequenaDemais
                    ? `Papel menor que ${MODERNO_MIN.largura} × ${MODERNO_MIN.altura} mm não comporta o Moderno: a etiqueta sai no Clássico.`
                    : 'O Moderno sai em etiquetadora ZPL e em bobina. Etiquetadora EPL imprime o Clássico.'}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Tamanho (mm)</Label>
              <select
                className={selectCls}
                value={isCustom ? 'custom' : tamanho}
                onChange={(e) => { if (e.target.value !== 'custom') setTamanho(e.target.value); else if (!isCustom) setTamanho(`${cw}x${ch}`); }}
              >
                {TAMANHOS.map((t) => (<option key={t} value={t}>{t.replace('x', ' × ')}</option>))}
                <option value="custom">Personalizado…</option>
              </select>
              {isCustom && (
                <div className="flex items-center gap-1.5 pt-1">
                  <Input type="number" min={10} max={200} value={cw} onChange={(e) => setDim(Number(e.target.value), ch)} className="h-9 w-20" aria-label="Largura em mm" />
                  <span className="text-sm text-muted-foreground">×</span>
                  <Input type="number" min={10} max={200} value={ch} onChange={(e) => setDim(cw, Number(e.target.value))} className="h-9 w-20" aria-label="Altura em mm" />
                  <span className="text-xs text-muted-foreground">mm</span>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="etq-codigo">Código</Label>
              {moderno ? (
                // No moderno as barras não cabem ao lado do texto: é QR ou nada. O tipo de
                // barras escolhido antes fica guardado para quando voltar ao clássico.
                <select
                  id="etq-codigo"
                  className={selectCls}
                  value={codigoTipo === 'nenhum' ? 'nenhum' : 'qr'}
                  onChange={(e) => setCodigoTipo(e.target.value)}
                >
                  <option value="qr">QR</option>
                  <option value="nenhum">Sem código</option>
                </select>
              ) : (
                <select id="etq-codigo" className={selectCls} value={codigoTipo} onChange={(e) => setCodigoTipo(e.target.value)}>
                  <option value="code128">Barras (Code128)</option>
                  <option value="ean13">Barras (EAN-13)</option>
                  <option value="qr">Mini-QR</option>
                  <option value="nenhum">Sem código</option>
                </select>
              )}
              {moderno && <p className="text-xs text-muted-foreground">Leitor só de barras? Use o Clássico.</p>}
            </div>
          </div>
          <p className="mt-4 mb-2 text-sm font-medium">Campos da etiqueta</p>
          <div className="space-y-1.5">
            {campos.map((c, i) => (
              <div key={c.campo} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2 text-sm">
                <span>{CAMPO_LABEL[c.campo] ?? c.campo}</span>
                {moderno && MODERNO_SEMPRE.includes(c.campo) ? (
                  <span className="text-xs text-muted-foreground">sempre sai</span>
                ) : moderno && MODERNO_FORA.includes(c.campo) ? (
                  <span className="text-xs text-muted-foreground">não sai neste modelo</span>
                ) : (
                  <span className="flex gap-3 text-xs">
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={c.visivel !== false} onChange={() => toggle(i, 'visivel')} className="h-4 w-4 accent-primary" />
                      visível
                    </label>
                    {!moderno && (
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" checked={!!c.negrito} onChange={() => toggle(i, 'negrito')} className="h-4 w-4 accent-primary" />
                        negrito
                      </label>
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>
          <Button className="mt-4" onClick={salvar} disabled={busy}>{busy ? 'Salvando…' : 'Salvar modelo'}</Button>
        </div>

        {/* Prévia (E5) */}
        <div className="space-y-1.5">
          <Label>Prévia — {cw} × {ch} mm</Label>
          <div className="flex justify-center rounded-lg border border-dashed border-border bg-secondary/30 p-4">
            {moderno && !pequenaDemais ? (
              <PreviaModerna
                largura={cw}
                altura={ch}
                s={s}
                comCodigo={codigoTipo !== 'nenhum'}
                loja={ligado('loja')}
                unidade={ligado('unidade')}
                status={ligado('status')}
                responsavel={ligado('responsavel')}
              />
            ) : (
            <div
              className="flex flex-col overflow-hidden bg-white text-black shadow-sm"
              style={{ width: cw * s, height: ch * s, padding: Math.max(3, 4 * (s / 3)), fontSize: Math.max(7, 3.2 * s), lineHeight: 1.15 }}
            >
              {visiveis.length === 0 && <span className="text-[10px] text-gray-400">nenhum campo visível</span>}
              {visiveis.map((c, i) => (
                <div key={i} style={{ fontWeight: c.negrito ? 700 : 400, fontSize: c.campo === 'validade' ? '1.2em' : undefined }}>
                  {CAMPO_EXEMPLO[c.campo] ?? c.campo}
                </div>
              ))}
              {codigoTipo !== 'nenhum' && (
                <div className="mt-auto pt-1">
                  {codigoTipo === 'qr' ? (
                    <div style={{ width: 13 * s, height: 13 * s, background: 'conic-gradient(#000 25%, #fff 0 50%, #000 0 75%, #fff 0)', backgroundSize: '3px 3px' }} aria-label="QR (exemplo)" />
                  ) : (
                    <div style={{ height: 8 * s, width: '75%', background: 'repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 5px)' }} aria-label="código de barras (exemplo)" />
                  )}
                </div>
              )}
            </div>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Prévia aproximada. O <b>nome da loja</b> real vem de Configurações → Loja (“Nome do estabelecimento”).</p>
        </div>
      </div>
    </Card>
  );
}

// Prévia do modelo MODERNO: mesma ordem e mesmas regras de altura do servidor da loja
// (`backend/edge/escpos.mjs` → `zplModerno`): rodapé só na etiqueta alta (≥ 37,5 mm), rótulo
// VALIDADE só a partir de 29 mm. Valores fixos de exemplo (13/08/2026 é uma quinta) — nada
// de relógio no desenho, a página é pré-renderizada.
function PreviaModerna(p: {
  largura: number; altura: number; s: number; comCodigo: boolean;
  loja: boolean; unidade: boolean; status: boolean; responsavel: boolean;
}) {
  const alta = p.altura >= 37.5;
  const media = p.altura >= 29;
  // A etiqueta maior que 60 × 40 é o mesmo desenho ampliado: a letra acompanha.
  const fonte = Math.max(5, p.s * 2.6 * Math.min(2, Math.max(1, Math.min(p.largura / 60, p.altura / 40))));
  const preto = { background: '#000', color: '#fff' } as const;
  const pad = `${0.25}em ${0.55}em`;
  return (
    <div
      className="flex flex-col overflow-hidden bg-white text-black shadow-sm"
      style={{ width: p.largura * p.s, height: p.altura * p.s, padding: p.s, fontSize: fonte, lineHeight: 1.12, fontWeight: 700 }}
      role="img"
      aria-label="Prévia do modelo moderno: produto numa faixa preta, manipulação e responsável à esquerda, QR à direita e a validade com o dia da semana"
    >
      <div style={{ ...preto, padding: pad, fontSize: alta ? '1.75em' : media ? '1.4em' : '1.15em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>TOMATE</div>
      <div className="flex min-h-0 flex-1 justify-between gap-1" style={{ padding: '0.35em 0.2em 0' }}>
        <div className="min-w-0">
          {alta && <div style={{ fontSize: '0.72em' }}>MANIPULADO</div>}
          <div style={{ fontSize: alta ? '1.12em' : '0.9em', whiteSpace: 'nowrap' }}>11/08/2026 09:30</div>
          {p.responsavel && <div style={{ fontSize: alta ? '1.02em' : '0.9em', whiteSpace: 'nowrap' }}><span style={{ fontSize: '0.72em' }}>RESP.</span> Rodrigo O.</div>}
          {!media && p.status && <div style={{ fontSize: '0.9em' }}>FECHADO</div>}
          {p.unidade && <div style={{ fontSize: '0.88em', whiteSpace: 'nowrap' }}>UNID. kg</div>}
        </div>
        {p.comCodigo && (
          <div className="shrink-0 text-center">
            <div style={{ width: (alta ? 10.5 : 8) * p.s, height: (alta ? 10.5 : 8) * p.s, background: 'conic-gradient(#000 25%, #fff 0 50%, #000 0 75%, #fff 0)', backgroundSize: '3px 3px' }} />
            {alta && <div style={{ fontSize: '0.6em' }}>123456789012</div>}
          </div>
        )}
      </div>
      <div style={{ borderTop: '1px solid #000', margin: '0 0.2em', paddingTop: '0.15em' }}>
        {media && (
          <div className="flex justify-between" style={{ fontSize: '0.72em' }}>
            <span>VALIDADE</span>
            {!alta && p.status && <span>FECHADO</span>}
          </div>
        )}
        <div className="flex items-center" style={{ gap: '0.45em' }}>
          <span style={{ ...preto, padding: '0.05em 0.4em', fontSize: alta ? '1.85em' : '1.5em' }}>QUI</span>
          <span style={{ fontSize: alta ? '2.5em' : '2em', whiteSpace: 'nowrap' }}>13/08/2026</span>
        </div>
      </div>
      {alta && (p.status || p.loja) && (
        <div className="flex items-center" style={{ gap: '0.45em', margin: '0.2em 0.2em 0', fontSize: '0.8em' }}>
          {p.status && <span style={{ ...preto, padding: '0.1em 0.55em' }}>FECHADO</span>}
          {p.loja && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Minha Loja</span>}
        </div>
      )}
    </div>
  );
}
