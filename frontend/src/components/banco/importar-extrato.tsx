'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { texto2 } from '@/components/ui/lista';
import { Gaveta } from '@/components/ui/sobreposto';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { brlDeCentavos, comSinal, diaCurto, periodoCurto, type ConferenciaDoArquivo } from '@/lib/banco-repasses';

// Importar o extrato em 3 passos (protótipo, aba "Na loja"): escolher, conferir e confirmar. O passo 2 só lê: nada é gravado
// antes do "Importar". O arquivo fica só no navegador entre os passos e vai ao servidor de novo na hora de gravar.
const LIMITE_DE_BYTES = 5 * 1024 * 1024;
const ETAPAS = ['Escolher o arquivo', 'Conferir', 'Confirmar'];

type Faixa = 'ok' | 'info' | 'aviso' | 'critico';
const COR: Record<Faixa, string> = {
  ok: 'border-ok bg-ok/10',
  info: 'border-info bg-info/10',
  aviso: 'border-warn bg-warn/10',
  critico: 'border-destructive bg-destructive/10',
};
const FaixaTexto = ({ tom, children }: { tom: Faixa; children: React.ReactNode }) => (
  <div className={`rounded-md border-l-4 px-3 py-2 ${COR[tom]}`}>{children}</div>
);

function Pares({ linhas }: { linhas: [string, string][] }) {
  return (
    <dl className="divide-y divide-border rounded-lg border border-border">
      {linhas.map(([a, b]) => (
        <div key={a} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 px-3 py-2">
          <dt className={texto2}>{a}</dt>
          <dd className="text-right font-mono text-[13px] font-bold [overflow-wrap:anywhere]">{b}</dd>
        </div>
      ))}
    </dl>
  );
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function ImportarExtrato({ aoFechar, aoImportar }: { aoFechar: () => void; aoImportar: () => void }) {
  const idArquivo = useId();
  const [passo, setPasso] = useState(1);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [conf, setConf] = useState<ConferenciaDoArquivo | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [arrastando, setArrastando] = useState(false);
  // Ao trocar de passo o foco vai para o topo: no botão do rodapé, o Enter de "Continuar" cairia em "Importar".
  const topo = useRef<HTMLOListElement>(null);
  const anterior = useRef(passo);
  useEffect(() => {
    if (anterior.current === passo) return;
    anterior.current = passo;
    topo.current?.focus();
  }, [passo]);

  function escolher(f: File | null | undefined) {
    setErro('');
    setConf(null);
    if (!f) return setArquivo(null);
    if (f.size > LIMITE_DE_BYTES) {
      setArquivo(null);
      setErro('Esse arquivo passa de 5 MB. Baixe um período menor.');
      return;
    }
    setArquivo(f);
  }

  async function conferir() {
    if (!arquivo || ocupado) return;
    setErro('');
    setOcupado(true);
    try {
      setConf((await api.bancoConferirExtrato(arquivo)) as ConferenciaDoArquivo);
      setPasso(2);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui ler o arquivo. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }

  async function importar() {
    if (!arquivo || ocupado) return;
    setErro('');
    setOcupado(true);
    try {
      const r = await api.bancoImportarExtrato(arquivo);
      toast.success(r.novos ? `Importado: ${plural(r.novos, 'lançamento novo', 'lançamentos novos')}.` : 'Nada novo: esses lançamentos já estavam aqui.');
      aoImportar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui importar. Nada foi gravado.');
      setOcupado(false);
    }
  }

  const voltarAoInicio = () => {
    setConf(null);
    setArquivo(null);
    setErro('');
    setPasso(1);
  };

  const c = conf;
  const dados = c && (c.caso === 'ok' || c.caso === 'repetido' || c.caso === 'buraco') ? c : null;
  const contaTxt = c && 'conta' in c ? `final ${c.conta.final}` : '';
  const saldoTxt = dados?.saldoFinal != null ? brlDeCentavos(dados.saldoFinal) : 'Não veio no arquivo';

  let rodape: React.ReactNode;
  if (passo === 1)
    rodape = (
      <>
        <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
        <Button type="button" onClick={conferir} disabled={!arquivo || ocupado}>{ocupado ? 'Lendo…' : 'Continuar'}</Button>
      </>
    );
  else if (passo === 2 && c?.caso === 'repetido')
    rodape = (
      <>
        <Button type="button" variant="outline" onClick={voltarAoInicio}>Escolher outro</Button>
        <Button type="button" onClick={aoFechar}>Fechar</Button>
      </>
    );
  else if (passo === 2 && (c?.caso === 'outra_conta' || c?.caso === 'nao_abre'))
    rodape = (
      <>
        <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
        <Button type="button" onClick={voltarAoInicio}>Escolher outro</Button>
      </>
    );
  else if (passo === 2 && c?.caso === 'buraco')
    rodape = (
      <>
        <Button type="button" variant="outline" onClick={voltarAoInicio}>Escolher outro</Button>
        <Button type="button" onClick={() => setPasso(3)}>Importar o que veio</Button>
      </>
    );
  else if (passo === 2)
    rodape = (
      <>
        <Button type="button" variant="outline" onClick={voltarAoInicio}>Voltar</Button>
        <Button type="button" onClick={() => setPasso(3)}>Continuar</Button>
      </>
    );
  else
    rodape = (
      <>
        <Button type="button" variant="outline" onClick={() => setPasso(2)} disabled={ocupado}>Voltar</Button>
        <Button type="button" onClick={importar} disabled={ocupado}>{ocupado ? 'Importando…' : 'Importar'}</Button>
      </>
    );

  return (
    <Gaveta titulo="Importar extrato" aoFechar={aoFechar} rodape={rodape}>
      <div className="space-y-3 text-sm">
        <p className={`text-xs ${texto2}`}>Passo {passo} de 3</p>
        <ol ref={topo} tabIndex={-1} aria-label="Passos da importação" className="flex flex-wrap gap-1.5 outline-none">
          {ETAPAS.map((t, i) => {
            const n = i + 1;
            const atual = n === passo;
            return (
              <li key={t} aria-current={atual ? 'step' : undefined}
                className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 py-0.5 text-[13px] font-semibold ${atual ? 'border-foreground bg-foreground text-background' : `border-input bg-card ${texto2}`}`}>
                <b className={`rounded-full px-1.5 font-mono text-xs ${atual ? 'bg-background/20 text-background' : n < passo ? 'bg-ok/15 text-foreground' : 'bg-secondary text-foreground'}`}>{n < passo ? '✓' : n}</b>
                {t}
              </li>
            );
          })}
        </ol>

        {passo === 1 && (
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setArrastando(true);
              }}
              onDragLeave={() => setArrastando(false)}
              onDrop={(e) => {
                e.preventDefault();
                setArrastando(false);
                escolher(e.dataTransfer.files?.[0]);
              }}
              className={`space-y-2 rounded-lg border-[1.5px] border-dashed p-3.5 text-center ${arrastando ? 'border-foreground bg-secondary' : 'border-input bg-secondary/40'}`}
            >
              <p className="font-display font-bold">Solte o arquivo aqui</p>
              <p className={`text-[13px] ${texto2}`}>Extrato em OFX, que você baixa no site ou no app do banco.</p>
              <div className="space-y-1 text-left">
                <Label htmlFor={idArquivo}>Ou escolha o arquivo</Label>
                <input
                  id={idArquivo}
                  data-foco-inicial
                  type="file"
                  accept=".ofx,.qfx,.xml,.txt,.pdf"
                  disabled={ocupado}
                  onChange={(e) => escolher(e.target.files?.[0])}
                  className="block min-h-11 w-full min-w-0 max-w-full rounded-md border border-input bg-card px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:font-semibold"
                />
              </div>
            </div>
            {arquivo && <p className="[overflow-wrap:anywhere]">Arquivo escolhido: <b>{arquivo.name}</b></p>}
            {ocupado && <p className={texto2} role="status">Lendo o arquivo…</p>}
            <FaixaTexto tom="info">O Regem mostra tudo antes de gravar. Nada entra até você confirmar no passo 3.</FaixaTexto>
          </>
        )}

        {passo === 2 && c?.caso === 'nao_abre' && (
          <>
            <div role="alert"><FaixaTexto tom="critico"><b>Não consegui abrir esse arquivo.</b> {c.motivo} Nada foi gravado.</FaixaTexto></div>
            <div>
              <h3 className="mb-1 font-display text-sm font-bold">Como baixar em OFX</h3>
              <ol className="list-decimal space-y-0.5 pl-5">
                <li>Abra o extrato no site ou no app do banco.</li>
                <li>Procure &quot;Exportar&quot; ou &quot;Salvar como&quot;.</li>
                <li>Escolha o formato OFX e envie aqui.</li>
              </ol>
            </div>
          </>
        )}

        {passo === 2 && c?.caso === 'outra_conta' && (
          <>
            <div role="alert">
              <FaixaTexto tom="aviso">
                <b>Esse arquivo é de outra conta.</b> Ele é da conta final <b>{c.conta.final}</b>, e a loja usa a conta final <b>{c.contaDaLoja.final}</b>. Nada foi gravado.
              </FaixaTexto>
            </div>
            <p className={texto2}>Confira no banco se você baixou o extrato da conta da loja.</p>
          </>
        )}

        {passo === 2 && c?.caso === 'repetido' && (
          <>
            <FaixaTexto tom="info">
              {c.jaEntrouEm ? <b>Esse arquivo já entrou em {new Date(c.jaEntrouEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })}.</b> : <b>Esses lançamentos já entraram.</b>}{' '}
              {plural(c.jaEstavam, 'lançamento dele já está aqui', 'lançamentos dele já estão aqui')}, e nada vai duplicar.
            </FaixaTexto>
            <Pares linhas={[['Conta', contaTxt], ['Período', periodoCurto(c.periodo.de, c.periodo.ate)], ['Lançamentos no arquivo', String(c.total)], ['Novos', '0'], ['Saldo final', saldoTxt]]} />
          </>
        )}

        {passo === 2 && dados && dados.caso !== 'repetido' && (
          <>
            {dados.caso === 'buraco' && dados.buraco && (
              <FaixaTexto tom="aviso">
                <b>Falta um pedaço neste extrato.</b> Não tem nenhum lançamento de <b>{diaCurto(dados.buraco.de)} a {diaCurto(dados.buraco.ate)}</b>, e a loja vendeu nesses dias. O banco pode ter cortado o arquivo.
              </FaixaTexto>
            )}
            <Pares
              linhas={[
                ['Conta', contaTxt],
                ['Período', periodoCurto(dados.periodo.de, dados.periodo.ate)],
                ['Lançamentos no arquivo', String(dados.total)],
                ['Já estavam aqui', String(dados.jaEstavam)],
                ['Novos', String(dados.novos)],
                ...(dados.buraco ? ([['Dias sem lançamento', `${diaCurto(dados.buraco.de)} a ${diaCurto(dados.buraco.ate)}`]] as [string, string][]) : []),
                ['Saldo final', saldoTxt],
              ]}
            />
            {dados.recusados > 0 && (
              <FaixaTexto tom="aviso">
                {plural(dados.recusados, 'linha ficou', 'linhas ficaram')} de fora: o valor ou a data não dá para ler.
              </FaixaTexto>
            )}
            {dados.caso === 'buraco' ? (
              <p className={texto2}>Você pode importar o que veio. O Regem marca o buraco e não usa esse período na conta do caixa até o arquivo completo chegar.</p>
            ) : (
              <div>
                <h3 className="mb-1 font-display text-sm font-bold">{dados.novos === 1 ? 'O novo' : `Os ${dados.novos} novos`}</h3>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {dados.novosLista.map((n, i) => (
                    <li key={`${n.data}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 px-3 py-2">
                      <span className={`min-w-0 [overflow-wrap:anywhere] ${texto2}`}>{diaCurto(n.data)} · {n.descricao}</span>
                      <b className="whitespace-nowrap font-mono text-[13px]">{comSinal(n.valor)}</b>
                    </li>
                  ))}
                </ul>
                {dados.novos > dados.novosLista.length && <p className={`mt-1 text-xs ${texto2}`}>Mostrando {dados.novosLista.length} de {dados.novos}.</p>}
              </div>
            )}
            {dados.fecha === true && dados.saldoAnterior !== null && dados.saldoFinal !== null && (
              <FaixaTexto tom="ok">
                A conta fecha: {brlDeCentavos(dados.saldoAnterior)} {comSinal(dados.entradasNovas)} {comSinal(-dados.saidasNovas)} = {brlDeCentavos(dados.saldoFinal)}.
              </FaixaTexto>
            )}
            {dados.fecha === false && (
              <FaixaTexto tom="aviso">O saldo do arquivo não fecha com o saldo anterior e os novos lançamentos. Confira se o extrato está completo.</FaixaTexto>
            )}
          </>
        )}

        {passo === 3 && dados && (
          <>
            <Pares
              linhas={[
                ['Conta', contaTxt],
                ['Vai entrar', plural(dados.novos, 'lançamento novo', 'lançamentos novos')],
                ['Vai ficar de fora', plural(dados.jaEstavam, 'repetido', 'repetidos')],
                ['Saldo final', saldoTxt],
              ]}
            />
            {dados.buraco && <FaixaTexto tom="aviso">O período de {diaCurto(dados.buraco.de)} a {diaCurto(dados.buraco.ate)} fica marcado como incompleto.</FaixaTexto>}
            <p className={texto2}>Depois de importar, cada lançamento aparece como &quot;Só no banco&quot; ou, se a descrição indicar iFood, 99 ou maquininha, &quot;A conferir&quot;.</p>
          </>
        )}

        {erro && <p role="alert" className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2">{erro}</p>}
      </div>
    </Gaveta>
  );
}
