'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Eye, Plus } from 'lucide-react';
import { api, getCategoria, podePerm } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo } from '@/components/ui/sobreposto';
import { RecebimentoForm } from '@/components/recebimento/recebimento-form';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, PERIODOS, PERIODO_PADRAO, Selo, Situacoes, TituloLista, Vazio,
  consultaDoPeriodo, dataBr, distintos, num, semAcento, texto2, type Situacao,
} from './lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
const conferido = (r: any) => r.status === 'conferido';
const SITUACOES: Situacao<any>[] = [
  { rotulo: 'A conferir', filtro: (r) => !conferido(r), tom: 'aviso' },
  { rotulo: 'Conferidos', filtro: conferido },
  { rotulo: 'Com divergência', filtro: (r) => Number(r.divergencias) > 0, tom: 'critico' },
];
const DIVERGENCIA: Record<string, string> = { ok: 'ok', parcial: 'parcial / faltou', nao_veio: 'não veio', danificado: 'danificado', excedente: 'excedente' };

// Aba Recebimento: as notas recebidas no período — as que faltam conferir, as conferidas e as
// que tiveram divergência. O recebimento novo abre na gaveta; confirmar pede a confirmação num
// diálogo (é o passo que entra no estoque e gera a conta a pagar).
export function RecebimentoSecao({ itens, fornecedores, aoMudarEstoque }: { itens: any[]; fornecedores: any[]; aoMudarEstoque: () => void }) {
  const [lista, setLista] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [periodo, setPeriodo] = useState<string>(PERIODO_PADRAO);
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [fornecedor, setFornecedor] = useState('');
  const [novo, setNovo] = useState(false);
  const [confirmar, setConfirmar] = useState<any>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [ver, setVer] = useState<any>(null);
  const pedido = useRef(0);

  const carregar = useCallback(async () => {
    const meu = ++pedido.current; // trocar o período depressa: só a última resposta vale
    setErro('');
    try {
      const r: any = await api.get(`/recebimentos${consultaDoPeriodo(periodo)}`);
      if (meu === pedido.current) setLista(Array.isArray(r) ? r : []);
    } catch (e) {
      if (meu !== pedido.current) return;
      setLista([]);
      setErro(e instanceof Error ? e.message : 'Erro ao carregar os recebimentos');
    }
  }, [periodo]);
  useEffect(() => { carregar(); }, [carregar]);

  // Trava de duplo clique: confirmar duas vezes dava entrada em dobro no estoque E criava
  // duas contas a pagar. O servidor recusa a segunda, mas o botão não pode nem deixar tentar.
  async function confirmarRecebimento() {
    if (!confirmar || confirmando) return;
    setConfirmando(true);
    try {
      await api.confirmarRecebimento(confirmar.id);
      toast.success('Recebimento confirmado — estoque atualizado.');
      setConfirmar(null);
      await carregar();
      // O botão "Confirmar" da linha deixou de existir: o foco vai para o título.
      document.getElementById('recebimento-titulo')?.focus();
      aoMudarEstoque();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao confirmar');
    } finally {
      setConfirmando(false);
    }
  }

  if (lista === null) return <SkeletonList rows={5} />;

  const nomeForn = (r: any) => r.fornecedorNome ?? 'Sem fornecedor';
  const b = semAcento(busca);
  const base = lista.filter((r) => (!b || semAcento(`${nomeForn(r)} ${r.notaRef ?? ''}`).includes(b)) && (!fornecedor || nomeForn(r) === fornecedor));
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || fornecedor || sit >= 0);
  const limpar = () => { setBusca(''); setFornecedor(''); setSit(-1); };
  const rotuloPeriodo = PERIODOS.find((p) => p.v === periodo)?.rotulo.toLowerCase() ?? '';
  const totalItens = linhas.reduce((s, r) => s + Number(r.itens || 0), 0);
  // O servidor é quem autoriza; aqui só não se oferece o que ele recusaria.
  const podeLancar = podePerm('estoque', 'criar');
  const podeConfirmar = ['presidente', 'gerente', 'suporte'].includes(getCategoria() ?? '') && podePerm('estoque', 'editar');

  return (
    <section className="space-y-3" aria-labelledby="recebimento-titulo">
      <TituloLista id="recebimento-titulo" titulo="Recebimento" total={lista.length} mostrando={linhas.length} um="recebimento" varios="recebimentos"
        extra={[rotuloPeriodo, `${totalItens} ${totalItens === 1 ? 'item' : 'itens'}`].filter(Boolean).join(' · ')}>
        {podeLancar && (
          <Button type="button" onClick={() => setNovo(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Novo recebimento</Button>
        )}
      </TituloLista>
      {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
      <Filtros>
        <FiltroBusca id="recebimento-busca" valor={busca} aoMudar={setBusca} placeholder="Fornecedor ou número da nota" />
        <FiltroSelect id="recebimento-periodo" rotulo="Período" opcoes={PERIODOS} valor={periodo} aoMudar={setPeriodo} />
        <FiltroSelect id="recebimento-fornecedor" rotulo="Fornecedor" todos="Todos os fornecedores" opcoes={distintos(lista, nomeForn)} valor={fornecedor} aoMudar={setFornecedor} />
      </Filtros>

      {lista.length === 0 ? (
        <Vazio>Nenhum recebimento {periodo ? `nos ${rotuloPeriodo}` : 'registrado'}.</Vazio>
      ) : linhas.length === 0 ? (
        <Vazio aoLimpar={limpar} />
      ) : (
        <ListaDados
          legenda="Recebimentos"
          linhas={linhas}
          chave={(r) => r.id}
          nome={(r) => `recebimento de ${nomeForn(r)} em ${dataBr(r.data)}`}
          colunas={[
            { titulo: 'Fornecedor', celula: (r) => <NomeComApoio nome={nomeForn(r)} apoio={r.notaRef ? `nota ${r.notaRef}` : 'sem nota informada'} /> },
            { titulo: 'Data', celula: (r) => <span className="font-mono">{dataBr(r.data)}</span> },
            { titulo: 'Itens', celula: (r) => <span className="font-mono">{r.itens}</span> },
            { titulo: 'Divergências', celula: (r) => (Number(r.divergencias) > 0 ? <Selo tom="critico">{r.divergencias} divergência(s)</Selo> : '—') },
            { titulo: 'Situação', celula: (r) => <Selo tom={conferido(r) ? 'ok' : 'aviso'}>{conferido(r) ? 'conferido' : 'a conferir'}</Selo> },
          ]}
          acoes={(r) => [
            ...(!conferido(r) && podeConfirmar ? [{ rotulo: 'Confirmar', icone: Check, aoClicar: setConfirmar, tom: 'primaria' as const }] : []),
            { rotulo: 'Ver', icone: Eye, aoClicar: setVer },
          ]}
        />
      )}
      {filtrando && linhas.length > 0 && (
        <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
      )}

      {novo && (
        <RecebimentoForm fornecedores={fornecedores} itens={itens} onCancel={() => setNovo(false)} onCreated={() => { setNovo(false); carregar(); }} />
      )}
      {confirmar && (
        <Dialogo alerta titulo="Confirmar o recebimento" aoFechar={() => setConfirmar(null)}
          rodape={
            <>
              <Button type="button" variant="outline" data-foco-inicial onClick={() => setConfirmar(null)} disabled={confirmando}>Cancelar</Button>
              <Button type="button" onClick={confirmarRecebimento} disabled={confirmando}>{confirmando ? 'Confirmando…' : 'Confirmar recebimento'}</Button>
            </>
          }>
          <div className="space-y-3 text-sm">
            <p>Confirmar o recebimento de <b>{nomeForn(confirmar)}</b> de {dataBr(confirmar.data)} ({confirmar.itens} {Number(confirmar.itens) === 1 ? 'item' : 'itens'})?</p>
            <p className="rounded-md border-l-4 border-info bg-info/10 px-3 py-2">
              A quantidade recebida entra no estoque, os lotes com validade são criados e a conta a pagar do fornecedor é gerada. Não dá para desfazer por aqui.
            </p>
          </div>
        </Dialogo>
      )}
      {ver && <VerRecebimento resumo={ver} aoFechar={() => setVer(null)} />}
    </section>
  );
}

function VerRecebimento({ resumo, aoFechar }: { resumo: any; aoFechar: () => void }) {
  const [det, setDet] = useState<any>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    let vivo = true;
    api.recebimento(resumo.id)
      .then((r: any) => { if (vivo) setDet(r); })
      .catch((e: unknown) => { if (vivo) setErro(e instanceof Error ? e.message : 'Não consegui abrir o recebimento.'); });
    return () => { vivo = false; };
  }, [resumo.id]);
  // O cabeçalho vem direto da tabela (nomes do banco): aceita os dois jeitos de escrever.
  const campo = (a: string, b: string) => det?.[a] ?? det?.[b];
  const foto = campo('notaFotoRef', 'nota_foto_ref');
  const itens: any[] = det?.itens ?? [];
  return (
    <Dialogo largura="lg" titulo={`${resumo.fornecedorNome ?? 'Sem fornecedor'} · ${dataBr(resumo.data)}`} aoFechar={aoFechar}
      rodape={<Button type="button" data-foco-inicial onClick={aoFechar}>Fechar</Button>}>
      <div className="space-y-3 text-sm">
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 font-medium">{erro}</p>}
        {!det && !erro && <p className={texto2}>Abrindo o recebimento…</p>}
        {det && (
          <>
            <p className={texto2}>
              {resumo.notaRef ? `Nota ${resumo.notaRef}` : 'Sem nota informada'} · {resumo.status === 'conferido' ? 'conferido' : 'a conferir'}
              {campo('obs', 'observacao') ? ` · ${campo('obs', 'observacao')}` : ''}
            </p>
            {foto && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={foto} alt="Foto da nota" className="max-h-64 rounded-lg object-contain" />
            )}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[520px] border-collapse">
                <caption className="sr-only">Itens do recebimento</caption>
                <thead>
                  <tr className={`border-b border-border bg-secondary text-left text-xs uppercase tracking-wide ${texto2}`}>
                    <th scope="col" className="px-3 py-2">Produto</th>
                    <th scope="col" className="px-3 py-2">Esperado</th>
                    <th scope="col" className="px-3 py-2">Recebido</th>
                    <th scope="col" className="px-3 py-2">Validade</th>
                    <th scope="col" className="px-3 py-2">Conferência</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((i) => (
                    <tr key={i.id} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2 font-semibold">{i.itemNome}</td>
                      <td className="px-3 py-2 font-mono">{num(i.qtdEsperada)} {i.unidade}</td>
                      <td className="px-3 py-2 font-mono">{num(i.qtdRecebida)} {i.unidade}</td>
                      <td className="px-3 py-2 font-mono">{i.validade ? dataBr(i.validade) : '—'}</td>
                      <td className="px-3 py-2">{i.divergencia && i.divergencia !== 'ok' ? <Selo tom="critico">{DIVERGENCIA[i.divergencia] ?? i.divergencia}</Selo> : <Selo tom="ok">ok</Selo>}</td>
                    </tr>
                  ))}
                  {itens.length === 0 && <tr><td colSpan={5} className={`px-3 py-6 text-center ${texto2}`}>Sem itens.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Dialogo>
  );
}
