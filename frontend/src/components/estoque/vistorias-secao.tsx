'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Image as Foto, Plus } from 'lucide-react';
import { api, podePerm } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { ImageUpload } from '@/components/ui/image-upload';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, PERIODOS, PERIODO_PADRAO, Selo, Situacoes, TituloLista, Vazio,
  consultaDoPeriodo, dataBr, distintos, hojeIso, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TIPOS = [
  { v: 'abertura', rotulo: 'Abertura' },
  { v: 'fechamento', rotulo: 'Fechamento' },
  { v: 'padrao', rotulo: 'Padrão' },
] as const;
const tipoDe = (v: any) => TIPOS.find((t) => t.v === v.tipo)?.rotulo ?? v.tipo;
const SITUACOES: Situacao<any>[] = [
  ...TIPOS.map((t) => ({ rotulo: t.rotulo, filtro: (v: any) => v.tipo === t.v })),
  { rotulo: 'Com foto', filtro: (v) => !!v.fotoRef },
];

// Aba Vistorias: as vistorias de abertura, fechamento e padrão do período, com quem registrou
// e a foto. O registro novo abre na gaveta.
export function VistoriasSecao() {
  const [lista, setLista] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [periodo, setPeriodo] = useState<string>(PERIODO_PADRAO);
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [quem, setQuem] = useState('');
  const [novo, setNovo] = useState(false);
  const [ver, setVer] = useState<any>(null);
  const pedido = useRef(0);

  const carregar = useCallback(async () => {
    const meu = ++pedido.current; // trocar o período depressa: só a última resposta vale
    setErro('');
    try {
      const r: any = await api.get(`/vistorias${consultaDoPeriodo(periodo)}`);
      if (meu === pedido.current) setLista(Array.isArray(r) ? r : []);
    } catch (e) {
      if (meu !== pedido.current) return;
      setLista([]);
      setErro(e instanceof Error ? e.message : 'Erro ao carregar as vistorias');
    }
  }, [periodo]);
  useEffect(() => { carregar(); }, [carregar]);

  if (lista === null) return <SkeletonList rows={5} />;

  const b = semAcento(busca);
  const base = lista.filter(
    (v) => (!b || semAcento(`${v.observacao ?? ''} ${tipoDe(v)}`).includes(b)) && (!quem || (v.registradoPorNome ?? 'Não identificado') === quem),
  );
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || quem || sit >= 0);
  const limpar = () => { setBusca(''); setQuem(''); setSit(-1); };
  const rotuloPeriodo = PERIODOS.find((p) => p.v === periodo)?.rotulo.toLowerCase() ?? '';
  const comFoto = linhas.filter((v) => v.fotoRef).length;

  return (
    <section className="space-y-3" aria-labelledby="vistorias-titulo">
      <TituloLista id="vistorias-titulo" titulo="Vistorias" total={lista.length} mostrando={linhas.length} um="vistoria" varios="vistorias"
        extra={[rotuloPeriodo, `${comFoto} com foto`].filter(Boolean).join(' · ')}>
        {podePerm('vistoria') && (
          <Button type="button" onClick={() => setNovo(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Registrar vistoria</Button>
        )}
      </TituloLista>
      {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
      <Filtros>
        <FiltroBusca id="vistorias-busca" valor={busca} aoMudar={setBusca} placeholder="Procure na observação" />
        <FiltroSelect id="vistorias-periodo" rotulo="Período" opcoes={PERIODOS} valor={periodo} aoMudar={setPeriodo} />
        <FiltroSelect id="vistorias-quem" rotulo="Quem registrou" todos="Todas as pessoas" opcoes={distintos(lista, (v) => v.registradoPorNome ?? 'Não identificado')} valor={quem} aoMudar={setQuem} />
      </Filtros>

      {lista.length === 0 ? (
        <Vazio>Nenhuma vistoria registrada {periodo ? `nos ${rotuloPeriodo}` : 'ainda'}.</Vazio>
      ) : linhas.length === 0 ? (
        <Vazio aoLimpar={limpar} />
      ) : (
        <ListaDados
          legenda="Vistorias registradas"
          linhas={linhas}
          chave={(v) => v.id}
          nome={(v) => `vistoria de ${tipoDe(v).toLowerCase()} de ${dataBr(v.data)}`}
          colunas={[
            { titulo: 'Vistoria', celula: (v) => <NomeComApoio nome={`${tipoDe(v)} · ${dataBr(v.data)}`} apoio={v.status === 'concluida' ? 'concluída' : v.status} /> },
            { titulo: 'Observação', celula: (v) => (v.observacao ? v.observacao : <span className={texto2}>sem observação</span>) },
            { titulo: 'Foto', celula: (v) => (v.fotoRef ? <Selo>com foto</Selo> : '—') },
            { titulo: 'Quem registrou', celula: (v) => v.registradoPorNome ?? <span className={texto2}>não identificado</span> },
          ]}
          acoes={(v) => (v.fotoRef ? [{ rotulo: 'Ver foto', icone: Foto, aoClicar: setVer }] : [])}
        />
      )}
      {filtrando && linhas.length > 0 && (
        <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
      )}

      {novo && <VistoriaForm aoFechar={() => setNovo(false)} aoSalvar={() => { setNovo(false); carregar(); }} />}
      {ver && (
        <Dialogo titulo={`Vistoria de ${tipoDe(ver).toLowerCase()} · ${dataBr(ver.data)}`} aoFechar={() => setVer(null)}
          rodape={<Button type="button" data-foco-inicial onClick={() => setVer(null)}>Fechar</Button>}>
          <div className="space-y-3 text-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ver.fotoRef} alt="Foto da vistoria" className="max-h-[60vh] w-full rounded-lg object-contain" />
            <p>{ver.observacao || 'Sem observação.'} · {ver.registradoPorNome ?? 'não identificado'}</p>
          </div>
        </Dialogo>
      )}
    </section>
  );
}

function VistoriaForm({ aoFechar, aoSalvar }: { aoFechar: () => void; aoSalvar: () => void }) {
  const formId = useId();
  const [tipo, setTipo] = useState<string>('abertura');
  const [observacao, setObservacao] = useState('');
  const [fotoRef, setFotoRef] = useState('');
  const [data, setData] = useState(hojeIso);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (salvando) return;
    setErro('');
    setSalvando(true);
    try {
      await api.post('/vistorias', { tipo, observacao: observacao.trim() || undefined, fotoRef: fotoRef || undefined, data: data || undefined });
      toast.success('Vistoria registrada.');
      aoSalvar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao registrar');
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      titulo="Registrar vistoria"
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
          <Button type="submit" form={formId} disabled={salvando}>{salvando ? 'Registrando…' : 'Registrar vistoria'}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={salvar} className="space-y-4">
        <div>
          <span className="mb-1 block text-sm font-medium">Tipo</span>
          <div className="grid grid-cols-3 overflow-hidden rounded-md border border-input" role="group" aria-label="Tipo de vistoria">
            {TIPOS.map((t, i) => (
              <button key={t.v} type="button" aria-pressed={tipo === t.v} onClick={() => setTipo(t.v)} {...(i === 0 ? { 'data-foco-inicial': true } : {})}
                className={`min-h-11 border-r border-input text-sm font-semibold last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                  tipo === t.v ? 'bg-foreground text-background' : 'bg-card text-foreground hover:bg-secondary'
                }`}>
                {t.rotulo}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vist-obs">Observação</Label>
          <textarea id="vist-obs" value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3} placeholder="Ex.: Tudo em ordem"
            className="w-full rounded-md border border-input bg-card px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="vist-data">Data</Label>
            <Input id="vist-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vist-foto">Foto (opcional)</Label>
            <ImageUpload id="vist-foto" value={fotoRef} onChange={setFotoRef} alt="Foto da vistoria" />
          </div>
        </div>
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      </form>
    </Gaveta>
  );
}
