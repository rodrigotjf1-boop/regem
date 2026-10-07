'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Eye, Plus } from 'lucide-react';
import { api, podePerm, podeVerFinanceiro } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { ImageUpload } from '@/components/ui/image-upload';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, PERIODOS, PERIODO_PADRAO, Situacoes, TituloLista, Vazio,
  brl, consultaDoPeriodo, dataBr, distintos, hojeIso, num, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
const perdaDe = (d: any) => (d.custoUnitario != null && d.quantidade != null ? Number(d.custoUnitario) * Number(d.quantidade) : 0);
const horaDe = (iso: unknown) =>
  iso ? new Date(String(iso)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '';

const SITUACOES: Situacao<any>[] = [
  { rotulo: 'Com baixa de estoque', filtro: (d) => !!d.itemId },
  { rotulo: 'Só registro', filtro: (d) => !d.itemId, tom: 'aviso' },
];

// Aba Desperdício: o que se perdeu no período, com o total em R$ (para quem pode ver valores),
// filtros por motivo e por quem registrou. O registro novo abre na gaveta. Registro de
// desperdício não se edita nem se apaga — é a trilha do que saiu do estoque.
export function DesperdicioSecao({ itens, aoMudarEstoque }: { itens: any[]; aoMudarEstoque: () => void }) {
  const [lista, setLista] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [periodo, setPeriodo] = useState<string>(PERIODO_PADRAO);
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [motivo, setMotivo] = useState('');
  const [quem, setQuem] = useState('');
  const [novo, setNovo] = useState(false);
  const [ver, setVer] = useState<any>(null);
  const pedido = useRef(0);
  const verFin = podeVerFinanceiro();

  const carregar = useCallback(async () => {
    const meu = ++pedido.current; // trocar o período depressa: só a última resposta vale
    setErro('');
    try {
      const r: any = await api.get(`/desperdicios${consultaDoPeriodo(periodo)}`);
      if (meu === pedido.current) setLista(Array.isArray(r) ? r : []);
    } catch (e) {
      if (meu !== pedido.current) return;
      setLista([]);
      setErro(e instanceof Error ? e.message : 'Erro ao carregar os desperdícios');
    }
  }, [periodo]);
  useEffect(() => { carregar(); }, [carregar]);

  if (lista === null) return <SkeletonList rows={5} />;

  const b = semAcento(busca);
  const base = lista.filter(
    (d) =>
      (!b || semAcento(`${d.descricao} ${d.motivo ?? ''}`).includes(b)) &&
      (!motivo || (d.motivo ?? 'Sem motivo') === motivo) &&
      (!quem || (d.registradoPorNome ?? 'Não identificado') === quem),
  );
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || motivo || quem || sit >= 0);
  const limpar = () => { setBusca(''); setMotivo(''); setQuem(''); setSit(-1); };
  const rotuloPeriodo = PERIODOS.find((p) => p.v === periodo)?.rotulo.toLowerCase() ?? '';
  const perda = linhas.reduce((s, d) => s + perdaDe(d), 0);

  return (
    <section className="space-y-3" aria-labelledby="desperdicio-titulo">
      <TituloLista id="desperdicio-titulo" titulo="Desperdício" total={lista.length} mostrando={linhas.length} um="registro" varios="registros"
        extra={[rotuloPeriodo, verFin ? `perda de ${brl(perda)}` : ''].filter(Boolean).join(' · ')}>
        {podePerm('desperdicio') && (
          <Button type="button" onClick={() => setNovo(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Registrar desperdício</Button>
        )}
      </TituloLista>
      {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
      <Filtros>
        <FiltroBusca id="desperdicio-busca" valor={busca} aoMudar={setBusca} placeholder="Ex.: pão, queijo, queda" />
        <FiltroSelect id="desperdicio-periodo" rotulo="Período" opcoes={PERIODOS} valor={periodo} aoMudar={setPeriodo} />
        <FiltroSelect id="desperdicio-motivo" rotulo="Motivo" todos="Todos os motivos" opcoes={distintos(lista, (d) => d.motivo ?? 'Sem motivo')} valor={motivo} aoMudar={setMotivo} />
        <FiltroSelect id="desperdicio-quem" rotulo="Quem registrou" todos="Todas as pessoas" opcoes={distintos(lista, (d) => d.registradoPorNome ?? 'Não identificado')} valor={quem} aoMudar={setQuem} />
      </Filtros>

      {lista.length === 0 ? (
        <Vazio>Nenhum desperdício registrado {periodo ? `nos ${rotuloPeriodo}` : 'ainda'}.</Vazio>
      ) : linhas.length === 0 ? (
        <Vazio aoLimpar={limpar} />
      ) : (
        <ListaDados
          legenda="Desperdícios registrados"
          linhas={linhas}
          chave={(d) => d.id}
          nome={(d) => d.descricao}
          colunas={[
            { titulo: 'O que', celula: (d) => <NomeComApoio nome={d.descricao} apoio={d.itemId ? 'baixou do estoque' : 'sem vínculo com produto (só registro)'} /> },
            { titulo: 'Quando', celula: (d) => <span className="whitespace-nowrap font-mono">{dataBr(d.data)}{d.createdAt ? <span className={`block text-xs ${texto2}`}>{horaDe(d.createdAt)}</span> : null}</span> },
            { titulo: 'Quantidade', celula: (d) => (d.quantidade != null ? <span className="whitespace-nowrap"><span className="font-mono">{num(d.quantidade)}</span> {d.unidadeMedida ?? ''}</span> : '—') },
            { titulo: 'Motivo', celula: (d) => d.motivo ?? '—' },
            ...(verFin ? [{ titulo: 'Perda', celula: (d: any) => (perdaDe(d) ? <span className="whitespace-nowrap font-mono">{brl(perdaDe(d))}</span> : '—') }] : []),
            { titulo: 'Onde · quem', celula: (d) => <>{d.pontoNome ?? '—'}<span className={`block text-xs ${texto2}`}>{d.registradoPorNome ?? 'não identificado'}</span></> },
          ]}
          acoes={() => [{ rotulo: 'Ver', icone: Eye, aoClicar: setVer }]}
        />
      )}
      {filtrando && linhas.length > 0 && (
        <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
      )}

      {novo && (
        <DesperdicioForm itens={itens} aoFechar={() => setNovo(false)} aoSalvar={() => { setNovo(false); carregar(); aoMudarEstoque(); }} />
      )}
      {ver && (
        <Dialogo titulo={ver.descricao} aoFechar={() => setVer(null)} rodape={<Button type="button" data-foco-inicial onClick={() => setVer(null)}>Fechar</Button>}>
          <div className="space-y-3 text-sm">
            {ver.fotoRef && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ver.fotoRef} alt="Foto do desperdício" className="max-h-72 w-full rounded-lg object-contain" />
            )}
            <p>
              {dataBr(ver.data)}{ver.createdAt ? ` às ${horaDe(ver.createdAt)}` : ''}
              {ver.pontoNome ? ` · ${ver.pontoNome}` : ''} · registrado por {ver.registradoPorNome ?? 'não identificado'}
            </p>
            <p>
              <b>{ver.quantidade != null ? `${num(ver.quantidade)} ${ver.unidadeMedida ?? ''}` : 'Sem quantidade'}</b>
              {ver.motivo ? ` · motivo: ${ver.motivo}` : ''}
              {verFin && perdaDe(ver) ? ` · perda de ${brl(perdaDe(ver))}` : ''}
            </p>
            <p className="rounded-md border-l-4 border-info bg-info/10 px-3 py-2">
              Registro de desperdício não se edita nem se apaga: é a trilha do que saiu do estoque. Lançamento errado se corrige com um ajuste no produto.
            </p>
          </div>
        </Dialogo>
      )}
    </section>
  );
}

// Registrar um desperdício (gaveta). `inicial` = quando vem de outro lugar já preenchido — o
// lote vencido da aba Validades.
export function DesperdicioForm({
  itens,
  inicial,
  aoFechar,
  aoSalvar,
}: {
  itens: any[];
  inicial?: { descricao?: string; itemId?: string; quantidade?: string; motivo?: string };
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const formId = useId();
  const [descricao, setDescricao] = useState(inicial?.descricao ?? '');
  const [itemId, setItemId] = useState(inicial?.itemId ?? '');
  const [quantidade, setQuantidade] = useState(inicial?.quantidade ?? '');
  const [motivo, setMotivo] = useState(inicial?.motivo ?? '');
  const [fotoRef, setFotoRef] = useState('');
  const [data, setData] = useState(hojeIso);
  const [motivos, setMotivos] = useState<string[]>([]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    api.get('/desperdicios/motivos').then((r: any) => setMotivos(r?.motivos ?? [])).catch(() => {});
  }, []);
  const item = itens.find((i) => i.id === itemId);
  const un = item ? (item.unidadeLista ?? item.unidadeMedida) : '';
  const falta = descricao.trim().length < 2 || (!!itemId && !(Number(quantidade) > 0));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (falta || salvando) return;
    setErro('');
    setSalvando(true);
    try {
      await api.post('/desperdicios', {
        descricao: descricao.trim(),
        itemId: itemId || undefined,
        quantidade: quantidade ? Number(quantidade) : undefined,
        motivo: motivo || undefined,
        fotoRef: fotoRef || undefined,
        data: data || undefined,
      });
      toast.success(itemId ? 'Desperdício registrado e baixado do estoque.' : 'Desperdício registrado.');
      aoSalvar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao registrar');
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      titulo="Registrar desperdício"
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
          <Button type="submit" form={formId} disabled={falta || salvando}>{salvando ? 'Registrando…' : 'Registrar desperdício'}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={salvar} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="desp-descricao">Descrição</Label>
          <Input id="desp-descricao" data-foco-inicial value={descricao} onChange={(e) => setDescricao(e.target.value)} required minLength={2} placeholder="Ex.: Pão queimado" autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="desp-item">Produto do estoque (opcional)</Label>
          <Select id="desp-item" value={itemId} onChange={(e) => setItemId(e.target.value)} aria-describedby="desp-item-ajuda">
            <option value="">— sem vínculo (só registro) —</option>
            {itens.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
          </Select>
          <p id="desp-item-ajuda" className={`text-xs ${texto2}`}>Com o produto, o desperdício baixa o estoque e entra no CMV.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="desp-qtd">Quantidade{un ? `, em ${un}` : ''}</Label>
            <Input id="desp-qtd" type="number" min={0} step="any" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} placeholder="0" required={!!itemId} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desp-motivo">Motivo</Label>
            <Select id="desp-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
              <option value="">— sem motivo —</option>
              {motivos.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desp-data">Data</Label>
            <Input id="desp-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desp-foto">Foto (opcional)</Label>
            <ImageUpload id="desp-foto" value={fotoRef} onChange={setFotoRef} alt="Foto do desperdício" />
          </div>
        </div>
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      </form>
    </Gaveta>
  );
}
