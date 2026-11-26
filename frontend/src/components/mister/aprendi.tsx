'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import { SkeletonList } from '@/components/ui/skeleton';
import { FiltroBusca, FiltroSelect, Filtros, ListaDados, Selo, Situacoes, TituloLista, Vazio, distintos, semAcento, texto2 } from '@/components/ui/lista';

// MISTER › O QUE APRENDI (versão 10, fase C7, mig 508; protótipo `mockups/regem-mister-v10.html`, "Na loja" › "O que aprendi"; só o
// presidente). Cada tarefa que alguém confirmou pelo Mister e deu certo vira exemplo para a próxima parecida (com "Aprender pela
// tarefa feita" ligado em Mister › Avisos e relatórios › Conversa). Aqui o presidente vê o pedido como a pessoa disse e o que foi
// feito, e "Esquecer" apaga o exemplo — o que já foi feito fica. O servidor confere tudo (só o presidente, só da empresa dele).

type Aprendido = {
  id: string;
  pedido: string;
  feito: string;
  quem: string | null;
  souEu: boolean;
  criadoEm: string;
  usadoVezes: number;
  usadoEm: string | null;
  diasSemUso: number;
  parada: boolean;
};
type Resposta = { ligado: boolean; total: number; usadas: number; paradas: number; aprendidos: Aprendido[] };

const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }) : '—');
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const erroDe = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao);
const quemEnsinou = (a: Aprendido) => (a.souEu ? 'você' : (a.quem ?? 'alguém que saiu da equipe'));
/** O título da linha: o pedido numa frase (o protótipo mostra a tarefa, não o texto inteiro). */
const titulo = (a: Aprendido) => (a.pedido.length > 110 ? `${a.pedido.slice(0, 107).trimEnd()}…` : a.pedido);
const QUEM_VOCE = 'Você';

/** "Aprendido em 30/11 com você · usado 2 vezes · última 07/12" ou "· parado há 35 dias" (a mesma régua do servidor). */
function linhaDeApoio(a: Aprendido): string {
  const partes = [`Aprendido em ${dia(a.criadoEm)} com ${quemEnsinou(a)}`];
  if (a.parada) partes.push(`parado há ${plural(a.diasSemUso, 'dia', 'dias')}`);
  else if (a.usadoVezes > 0) partes.push(`usado ${plural(a.usadoVezes, 'vez', 'vezes')}${a.usadoEm ? ` · última ${dia(a.usadoEm)}` : ''}`);
  else partes.push('ainda não usado');
  return partes.join(' · ');
}

export function AprendiDoMister() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState(false);
  const [busca, setBusca] = useState('');
  const [quem, setQuem] = useState('');
  const [situacao, setSituacao] = useState(-1);
  const [aberto, setAberto] = useState<Aprendido | null>(null);
  const [esquecer, setEsquecer] = useState<Aprendido | null>(null);

  const carregar = useCallback(async () => {
    setErro(false);
    try {
      setDados((await api.get('/mister/aprendizados')) as Resposta);
    } catch {
      setErro(true);
    }
  }, []);
  useEffect(() => void carregar(), [carregar]);

  const lista = useMemo(() => dados?.aprendidos ?? [], [dados]);
  const pessoas = useMemo(() => {
    const nomes = distintos(
      lista.filter((a) => !a.souEu),
      (a) => a.quem,
    );
    return [...(lista.some((a) => a.souEu) ? [QUEM_VOCE] : []), ...nomes];
  }, [lista]);
  const base = useMemo(() => {
    const t = semAcento(busca.trim());
    return lista.filter((a) => (!t || semAcento(`${a.pedido} ${a.feito}`).includes(t)) && (!quem || (quem === QUEM_VOCE ? a.souEu : !a.souEu && a.quem === quem)));
  }, [lista, busca, quem]);
  const situacoes = [
    { rotulo: 'Usadas nos últimos 30 dias', filtro: (a: Aprendido) => !a.parada },
    { rotulo: 'Paradas', filtro: (a: Aprendido) => a.parada },
  ];
  const linhas = situacao < 0 ? base : base.filter(situacoes[situacao].filtro);
  const limpar = () => {
    setBusca('');
    setQuem('');
    setSituacao(-1);
  };

  if (erro)
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        Não consegui carregar o que o Mister aprendeu agora.{' '}
        <Button variant="outline" className="ml-2" onClick={() => void carregar()}>
          Tentar de novo
        </Button>
      </div>
    );

  return (
    <section className="space-y-4" aria-labelledby="aprendi-mister">
      <TituloLista
        id="aprendi-mister"
        titulo="O que aprendi"
        total={lista.length}
        mostrando={linhas.length}
        um="tarefa"
        varios="tarefas"
        extra="cada tarefa que alguém confirmou vira exemplo para a próxima parecida · sem dado de cliente"
      />
      {!dados ? (
        <SkeletonList rows={3} />
      ) : (
        <>
          {!dados.ligado && (
            <p role="status" className="rounded-md border-l-4 border-primary bg-primary/10 px-3 py-2 text-sm">
              &quot;Aprender pela tarefa feita&quot; está desligado: nada novo é aprendido e os exemplos abaixo não vão à conversa. Ligue em Mister › Avisos e relatórios ›
              Conversa.
            </p>
          )}
          <Situacoes base={base} opcoes={situacoes} valor={situacao} aoMudar={setSituacao} />
          <Filtros emLinha>
            <FiltroBusca id="aprendi-busca" valor={busca} aoMudar={setBusca} placeholder="Buscar tarefa" />
            {pessoas.length > 1 && <FiltroSelect id="aprendi-quem" rotulo="Quem ensinou" todos="Todas as pessoas" opcoes={pessoas} valor={quem} aoMudar={setQuem} />}
          </Filtros>
          {lista.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground">
              <span className="mb-1 block text-2xl" aria-hidden>
                🧠
              </span>
              {dados.ligado
                ? 'Nada aprendido ainda. Quando alguém pedir uma tarefa pelo Mister e ela der certo, o jeito vira exemplo aqui.'
                : 'Nada aprendido ainda. Ligue "Aprender pela tarefa feita" e, quando alguém pedir uma tarefa pelo Mister e ela der certo, o jeito vira exemplo aqui.'}
            </p>
          ) : linhas.length === 0 ? (
            <Vazio aoLimpar={limpar}>Nenhuma tarefa com esses filtros.</Vazio>
          ) : (
            <ListaDados
              legenda="Tarefas que o Mister aprendeu, com quem ensinou e o uso"
              linhas={linhas}
              chave={(a) => a.id}
              nome={(a) => titulo(a)}
              colunas={[
                {
                  titulo: 'Tarefa',
                  celula: (a) => (
                    <span className="block">
                      <span className="block break-words font-semibold">{titulo(a)}</span>
                      <span className={`block text-xs ${texto2}`}>{linhaDeApoio(a)}</span>
                    </span>
                  ),
                },
                {
                  titulo: 'Situação',
                  celula: (a) => (a.parada ? <Selo tom="neutro">parada</Selo> : <Selo tom="ok">em uso</Selo>),
                },
              ]}
              acoes={() => [{ rotulo: 'Ver', icone: Eye, aoClicar: (a: Aprendido) => setAberto(a) }]}
            />
          )}
          <p className="text-sm text-muted-foreground">
            O Mister usa um exemplo quando alguém pede algo parecido e continua pedindo a confirmação a cada vez. &quot;Esquecer&quot; apaga o exemplo; o que já foi feito
            fica.
          </p>
        </>
      )}
      {aberto && (
        <Gaveta
          titulo={titulo(aberto)}
          aoFechar={() => setAberto(null)}
          rodape={
            <>
              <Button type="button" variant="outline" className="text-destructive" onClick={() => setEsquecer(aberto)}>
                Esquecer
              </Button>
              <Button type="button" onClick={() => setAberto(null)}>
                Fechar
              </Button>
            </>
          }
        >
          <p className={`text-sm ${texto2}`}>{linhaDeApoio(aberto)}</p>
          <div className="mt-4 space-y-4 text-sm">
            <div>
              <h3 className="font-display font-semibold">O pedido, como {aberto.souEu ? 'você disse' : 'foi dito'}</h3>
              <p className="mt-1 whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2">{aberto.pedido}</p>
            </div>
            <div>
              <h3 className="font-display font-semibold">O que foi feito</h3>
              <p className="mt-1 whitespace-pre-wrap break-words">{aberto.feito}</p>
            </div>
            <p className={texto2}>Ele usa este exemplo quando alguém pedir algo parecido. Cada vez continua pedindo a confirmação. &quot;Esquecer&quot; apaga o exemplo; o que já foi feito fica.</p>
          </div>
        </Gaveta>
      )}
      {esquecer && (
        <DialogoEsquecer
          aprendido={esquecer}
          aoFechar={() => setEsquecer(null)}
          aoEsquecer={() => {
            setEsquecer(null);
            setAberto(null);
            void carregar();
          }}
        />
      )}
    </section>
  );
}

function DialogoEsquecer({ aprendido, aoFechar, aoEsquecer }: { aprendido: Aprendido; aoFechar: () => void; aoEsquecer: () => void }) {
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState('');
  async function confirmar() {
    setGravando(true);
    setErro('');
    try {
      const r = (await api.del(`/mister/aprendizados/${encodeURIComponent(aprendido.id)}`)) as { esquecido?: boolean };
      toast.success(r?.esquecido === false ? 'Este exemplo já tinha sido esquecido.' : 'Exemplo esquecido.');
      aoEsquecer();
    } catch (e) {
      setErro(erroDe(e, 'Não deu para esquecer.'));
      setGravando(false);
    }
  }
  return (
    <Dialogo
      alerta
      titulo="Esquecer este exemplo?"
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" data-foco-inicial onClick={aoFechar} disabled={gravando}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" onClick={() => void confirmar()} disabled={gravando}>
            {gravando ? 'Esquecendo…' : 'Esquecer'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2">
          &quot;{titulo(aprendido)}&quot; deixa de ir como exemplo à conversa. O que já foi feito fica; se a tarefa der certo de novo, ela volta a ser aprendida.
        </p>
        {erro && (
          <p role="alert" className="font-medium">
            {erro}
          </p>
        )}
      </div>
    </Dialogo>
  );
}
