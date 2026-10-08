'use client';

import { useState } from 'react';
import { Download, Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { baixarCsv } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import { SkeletonList } from '@/components/ui/skeleton';
import { Gaveta } from '@/components/ui/sobreposto';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio, distintos, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';
import { ErroDeLeitura, Indicadores } from '@/components/relatorios/pecas';
import { useLeitura, type Leitura } from '@/components/relatorios/leitura';
import { AvisoSemValores } from '@/components/relatorios/bloco';
import { dataHora, rs } from '@/components/relatorios/formatos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ABA TURNOS / CAIXA — `/relatorios/turnos`: os turnos ABERTOS no período (PDV e delivery), ainda
// abertos ou já fechados. O cupom de fechamento (`/relatorios/turnos/:id`) abre numa gaveta.
// (O menu "Turnos" é outra tela: só os fechados, da loja em uso, com a reconciliação.)

const ID_TITULO = 'turnos-aba-titulo';
const aberto = (t: any) => !t.fechadaEm;
const quemAbriu = (t: any) => t.abertaPor ?? 'sem operador';

function DiferencaDoTurno({ turno }: { turno: any }) {
  if (aberto(turno)) return <Selo tom="info">aberto</Selo>;
  // Sem "Ver valores em R$" o servidor anula a diferença: a tela só sabe que fechou.
  if (turno.diferenca == null) return <Selo>fechado</Selo>;
  const d = Number(turno.diferenca);
  if (Math.abs(d) < 0.005) return <Selo tom="ok">bateu</Selo>;
  return <Selo tom={d < 0 ? 'critico' : 'aviso'}>{d > 0 ? '+' : '−'}{rs(Math.abs(d))}</Selo>;
}

function CupomDoTurno({ turno, aoFechar }: { turno: any; aoFechar: () => void }) {
  const cupom = useLeitura<any>(() => api.relatorioTurnoDetalhe(turno.id), String(turno.id));
  const d = cupom.dados;
  const formas: any[] = d?.porForma ?? [];
  const movimentos: any[] = d?.movimentos ?? [];
  return (
    <Gaveta
      titulo="Cupom de fechamento de turno"
      aoFechar={aoFechar}
      fecharNoFundo
      voltarPara={ID_TITULO}
      rodape={
        <>
          {formas.length > 0 && (
            <Button type="button" variant="outline" onClick={() => baixarCsv(`turno-${String(turno.id).slice(0, 6)}-formas`, formas.map((f) => ({ forma: f.forma, vendas: f.qtd, total: f.total ?? '' })))}>
              <Download className="h-4 w-4" aria-hidden="true" /> Exportar CSV
            </Button>
          )}
          <Button type="button" data-foco-inicial onClick={aoFechar}>Fechar</Button>
        </>
      }
    >
      <p className={`text-sm ${texto2}`}>
        {String(turno.origem ?? '').toUpperCase()} · abriu {quemAbriu(turno)} em {dataHora(turno.abertaEm)}
        {aberto(turno) ? <> · <b className="text-foreground">turno ainda aberto</b></> : ` · fechou ${turno.fechadaPor ?? 'sem operador'} em ${dataHora(turno.fechadaEm)}`}
      </p>
      {cupom.erro ? (
        <ErroDeLeitura oQue="o cupom deste turno" motivo={cupom.erro} aoTentar={cupom.recarregar} ocupado={cupom.carregando} />
      ) : !d ? (
        <SkeletonList rows={3} />
      ) : (
        <>
          <Indicadores
            itens={[
              { rotulo: 'Abertura', valor: rs(d.sessao.abertura) },
              { rotulo: 'Esperado', valor: rs(d.sessao.esperado) },
              { rotulo: 'Informado', valor: rs(d.sessao.informado) },
              { rotulo: 'Diferença', valor: <DiferencaDoTurno turno={{ ...turno, diferenca: d.sessao.diferenca }} /> },
            ]}
          />
          {/* A gaveta recebe o valor CHEIO (com a taxa de serviço) e é assim que o caixa fecha. */}
          {Number(d.composicao?.gorjeta ?? 0) > 0 && (
            <p className="rounded-md border-l-4 border-l-info bg-info/10 px-3 py-2 text-sm">
              Do que entrou no turno, <b>{rs(d.composicao.faturamento)}</b> é venda e <b>{rs(d.composicao.gorjeta)}</b> é taxa de serviço (repasse ao funcionário). O caixa fecha pelo valor cheio.
            </p>
          )}
          <section className="space-y-1" aria-label="Vendas por forma">
            <h3 className={`text-xs font-bold uppercase tracking-wide ${texto2}`}>Vendas por forma</h3>
            {formas.length === 0 ? (
              <p className={`text-sm ${texto2}`}>Sem vendas neste turno.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {formas.map((f) => (
                  <li key={f.forma} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2 text-sm">
                    <span className="min-w-0 break-words font-semibold capitalize">{f.forma}</span>
                    <span className="font-mono">{rs(f.total)} <span className={`font-sans text-xs ${texto2}`}>({f.qtd})</span></span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {movimentos.length > 0 && (
            <section className="space-y-1" aria-label="Sangrias e suprimentos">
              <h3 className={`text-xs font-bold uppercase tracking-wide ${texto2}`}>Sangrias e suprimentos</h3>
              <ul className="divide-y divide-border rounded-md border border-border">
                {movimentos.map((m, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <Selo tom={m.categoria === 'sangria' ? 'critico' : 'ok'}>{m.categoria}</Selo>
                      <span className="min-w-0 break-words">{m.descricao ?? 'sem descrição'}</span>
                    </span>
                    <span className="font-mono">{rs(m.valor)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </Gaveta>
  );
}

export function AbaTurnos({ leitura, verFin }: { leitura: Leitura<any>; verFin: boolean }) {
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [origem, setOrigem] = useState('');
  const [operador, setOperador] = useState('');
  const [vendo, setVendo] = useState<any | null>(null);

  if (leitura.erro) return <ErroDeLeitura oQue="os turnos" motivo={leitura.erro} aoTentar={leitura.recarregar} ocupado={leitura.carregando} />;
  if (!leitura.dados) return <SkeletonList rows={4} />;

  const todos: any[] = leitura.dados.turnos ?? [];
  const situacoes: Situacao<any>[] = [
    { rotulo: 'Abertos', filtro: aberto, tom: 'aviso' },
    { rotulo: 'Fechados', filtro: (t) => !aberto(t) },
    // A diferença vem anulada para quem não vê valores: sem ela não há o que filtrar.
    ...(verFin ? [{ rotulo: 'Com diferença', filtro: (t: any) => !aberto(t) && Math.abs(Number(t.diferenca ?? 0)) >= 0.005, tom: 'critico' as const }] : []),
  ];
  const b = semAcento(busca);
  const base = todos.filter((t) => (!b || semAcento(`${quemAbriu(t)} ${t.fechadaPor ?? ''} ${t.origem ?? ''}`).includes(b)) && (!origem || t.origem === origem) && (!operador || quemAbriu(t) === operador));
  const linhas = sit < 0 ? base : base.filter(situacoes[sit].filtro);
  const filtrando = !!(busca.trim() || origem || operador || sit >= 0);
  const limpar = () => { setBusca(''); setOrigem(''); setOperador(''); setSit(-1); };
  const totalVendas = linhas.reduce((s, t) => s + Number(t.vendas ?? 0), 0);
  const exportar = () =>
    baixarCsv('turnos-do-periodo', linhas.map((t) => ({
      origem: t.origem, 'abriu em': dataHora(t.abertaEm), 'quem abriu': t.abertaPor ?? '', 'fechou em': t.fechadaEm ? dataHora(t.fechadaEm) : 'aberto', 'quem fechou': t.fechadaPor ?? '',
      ...(verFin ? { abertura: t.abertura, vendas: t.vendas, sangrias: t.sangrias, suprimentos: t.suprimentos, esperado: t.esperado ?? '', informado: t.informado ?? '', diferença: t.diferenca ?? '' } : {}),
    })));
  const dinheiro = (titulo: string, campo: string, tracoNoZero = false) =>
    verFin ? [{ titulo, celula: (t: any) => (tracoNoZero && !Number(t[campo]) ? '—' : rs(t[campo])), classe: 'whitespace-nowrap font-mono' }] : [];

  return (
    <section className="space-y-3" aria-labelledby={ID_TITULO}>
      <TituloLista id={ID_TITULO} titulo="Turnos do período" total={todos.length} mostrando={linhas.length} um="turno" varios="turnos" extra={verFin && linhas.length ? `vendas ${rs(totalVendas)}` : undefined}>
        {linhas.length > 0 && <Button type="button" variant="outline" onClick={exportar}><Download className="h-4 w-4" aria-hidden="true" /> Exportar CSV</Button>}
      </TituloLista>
      {!verFin && <AvisoSemValores />}
      <Situacoes base={base} opcoes={situacoes} valor={sit} aoMudar={setSit} />
      <Filtros>
        <FiltroBusca id="turnos-aba-busca" valor={busca} aoMudar={setBusca} placeholder="Nome do operador" />
        <FiltroSelect id="turnos-aba-origem" rotulo="Origem" todos="PDV e delivery" opcoes={distintos(todos, (t) => t.origem)} valor={origem} aoMudar={setOrigem} />
        <FiltroSelect id="turnos-aba-operador" rotulo="Quem abriu" todos="Todos os operadores" opcoes={distintos(todos, quemAbriu)} valor={operador} aoMudar={setOperador} />
      </Filtros>

      {todos.length === 0 ? (
        <Vazio>Nenhum turno aberto neste período. Um turno aparece aqui quando o caixa é aberto no PDV ou no delivery.</Vazio>
      ) : linhas.length === 0 ? (
        <Vazio aoLimpar={limpar} />
      ) : (
        <ListaDados
          legenda="Turnos do período"
          linhas={linhas}
          chave={(t) => String(t.id)}
          nome={(t) => `turno de ${quemAbriu(t)}, ${dataHora(t.abertaEm)}`}
          colunas={[
            {
              titulo: 'Turno',
              celula: (t) => (
                <NomeComApoio nome={<span className="whitespace-nowrap font-mono">{dataHora(t.abertaEm)}</span>} apoio={aberto(t) ? 'ainda aberto' : `até ${dataHora(t.fechadaEm)}`}>
                  <Selo>{String(t.origem ?? '').toUpperCase()}</Selo>
                </NomeComApoio>
              ),
            },
            { titulo: 'Quem abriu', celula: (t) => quemAbriu(t) },
            ...dinheiro('Vendas', 'vendas'),
            ...dinheiro('Sangrias', 'sangrias', true),
            ...dinheiro('Suprimentos', 'suprimentos', true),
            { titulo: 'Diferença', celula: (t) => <DiferencaDoTurno turno={t} /> },
          ]}
          acoes={() => [{ rotulo: 'Ver cupom', icone: Receipt, aoClicar: setVendo }]}
        />
      )}
      {filtrando && linhas.length > 0 && (
        <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
      )}
      {vendo && <CupomDoTurno turno={vendo} aoFechar={() => setVendo(null)} />}
    </section>
  );
}
