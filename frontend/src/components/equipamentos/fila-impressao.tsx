'use client';

import { useId, useState } from 'react';
import { RefreshCw, RotateCw } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Dialogo } from '@/components/ui/sobreposto';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio, distintos, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';
import { alvoValido, daLoja } from './equipamento';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ID_TITULO = 'fila-titulo';
const naFila = (j: any) => j.status !== 'impresso' && j.status !== 'erro';
const SITUACOES: Situacao<any>[] = [
  { rotulo: 'Na fila', filtro: naFila, tom: 'aviso' },
  { rotulo: 'Falharam', filtro: (j) => j.status === 'erro', tom: 'critico' },
  { rotulo: 'Impressas', filtro: (j) => j.status === 'impresso' },
];
const impressoraDe = (j: any) => j.impressora ?? 'Sem impressora';
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Equipamentos → Fila de impressão: o que está esperando, o que falhou (com "Reimprimir", na mesma
// impressora ou em outra da loja) e as impressas mais recentes. O servidor manda TODAS as que
// esperam e as que falharam; das impressas, só as últimas.
export function FilaDeImpressao({
  fila, erro, impressoras, podeReimprimir, recarregar,
}: {
  /** `null` = carregando. */
  fila: any[] | null;
  /** Motivo de a fila não ter vindo (leitura que falha não vira "nenhuma impressão"). */
  erro: string;
  impressoras: any[];
  podeReimprimir: boolean;
  recarregar: () => Promise<void>;
}) {
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [filtroImp, setFiltroImp] = useState('');
  const [reimprimindo, setReimprimindo] = useState<any | null>(null);
  const [atualizando, setAtualizando] = useState(false);

  async function atualizar() {
    setAtualizando(true);
    await recarregar();
    setAtualizando(false);
  }
  if (erro)
    return (
      <Card className="space-y-3 p-5 text-sm">
        <p className="font-display text-base font-bold">Fila de impressão</p>
        <p role="alert">{erro}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void atualizar()}>Tentar de novo</Button>
      </Card>
    );
  const lista = fila ?? [];
  const b = semAcento(busca);
  const base = lista.filter((j) => (!b || semAcento(`${impressoraDe(j)} ${j.via}`).includes(b)) && (!filtroImp || impressoraDe(j) === filtroImp));
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || filtroImp || sit >= 0);
  const limpar = () => { setBusca(''); setFiltroImp(''); setSit(-1); };
  const falharam = lista.filter((j) => j.status === 'erro').length;

  return (
    <section className="space-y-3" aria-labelledby={ID_TITULO}>
      <TituloLista id={ID_TITULO} titulo="Fila de impressão" total={lista.length} mostrando={linhas.length} um="impressão" varios="impressões"
        extra={`${falharam ? `${falharam} ${falharam === 1 ? 'falhou' : 'falharam'}` : 'nenhuma falha'} · das impressas, só as mais recentes`}>
        <Button type="button" variant="outline" onClick={() => void atualizar()} disabled={atualizando}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> {atualizando ? 'Atualizando…' : 'Atualizar'}
        </Button>
      </TituloLista>
      <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
      <Filtros>
        <FiltroBusca id="fila-busca" valor={busca} aoMudar={setBusca} placeholder="Impressora ou via" />
        <FiltroSelect id="fila-impressora" rotulo="Impressora" todos="Todas as impressoras" opcoes={distintos(lista, impressoraDe)} valor={filtroImp} aoMudar={setFiltroImp} />
      </Filtros>
      {fila === null ? (
        <p className={`text-sm ${texto2}`} role="status">Carregando…</p>
      ) : lista.length === 0 ? (
        <Vazio>Nenhuma impressão ainda. Confirme um pedido ou use “Imprimir teste”.</Vazio>
      ) : linhas.length === 0 ? (
        <Vazio aoLimpar={limpar} />
      ) : (
        <ListaDados
          legenda="Fila de impressão"
          linhas={linhas}
          chave={(j) => j.id}
          nome={(j) => `${impressoraDe(j)}, ${j.via}, ${quando(j.criadoEm)}`}
          colunas={[
            { titulo: 'Impressora', celula: (j) => <NomeComApoio nome={impressoraDe(j)} apoio={j.status === 'erro' ? `falhou (${j.tentativas}×)${j.erro ? `: ${j.erro}` : ''}` : undefined} /> },
            { titulo: 'Via', celula: (j) => j.via },
            { titulo: 'Quando', celula: (j) => <span className="whitespace-nowrap font-mono">{quando(j.criadoEm)}</span> },
            { titulo: 'Situação', celula: (j) => <Selo tom={j.status === 'erro' ? 'critico' : j.status === 'impresso' ? 'ok' : 'aviso'}>{j.status === 'erro' ? 'falhou' : j.status === 'impresso' ? 'impresso' : 'na fila'}</Selo> },
          ]}
          acoes={(j) => (podeReimprimir && j.status === 'erro' ? [{ rotulo: 'Reimprimir', icone: RotateCw, aoClicar: setReimprimindo, tom: 'primaria' as const }] : [])}
        />
      )}
      {filtrando && linhas.length > 0 && (
        <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
      )}
      {reimprimindo && (
        <Reimprimir job={reimprimindo} impressoras={impressoras} aoFechar={() => setReimprimindo(null)} aoEnviar={async () => { setReimprimindo(null); await recarregar(); }} />
      )}
    </section>
  );
}

function Reimprimir({ job, impressoras, aoFechar, aoEnviar }: { job: any; impressoras: any[]; aoFechar: () => void; aoEnviar: () => void }) {
  const idSel = useId();
  const [destino, setDestino] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  // Só impressoras ativas, com para onde imprimir e da loja do job (o servidor recusa a de outra loja).
  const opcoes = impressoras.filter((e) => e.ativo && alvoValido(e) && daLoja(job.unidadeId)(e));
  async function confirmar() {
    if (enviando) return;
    setErro('');
    setEnviando(true);
    try {
      const r: any = await api.reimprimir(job.id, destino || null);
      // Com servidor local, quem reimprime é ele — e a resposta diz isso.
      if (r?.edge) toast.info(r.aviso || 'Reimpressão feita no servidor local.');
      else toast.success('Reenviado para a impressora.');
      aoEnviar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao reimprimir');
      setEnviando(false);
    }
  }
  return (
    <Dialogo titulo="Reimprimir" aoFechar={aoFechar} voltarPara={ID_TITULO}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={enviando}>Cancelar</Button>
          <Button type="button" onClick={confirmar} disabled={enviando}>{enviando ? 'Enviando…' : 'Reimprimir'}</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        <p>Via de <b>{job.via}</b>, de {quando(job.criadoEm)}, que falhou na <b>{impressoraDe(job)}</b>.</p>
        <div className="space-y-1.5">
          <Label htmlFor={idSel}>Enviar para</Label>
          <Select id={idSel} data-foco-inicial value={destino} onChange={(e) => setDestino(e.target.value)}>
            <option value="">A mesma impressora</option>
            {opcoes.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </Select>
        </div>
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 font-medium">{erro}</p>}
      </div>
    </Dialogo>
  );
}
