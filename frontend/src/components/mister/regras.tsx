'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, Pause, Play, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import { SkeletonList } from '@/components/ui/skeleton';
import { Filtros, FiltroBusca, FiltroSelect, ListaDados, Selo, Situacoes, TituloLista, Vazio, semAcento, texto2 } from '@/components/ui/lista';

// MISTER › REGRAS (versão 6, M6f; protótipo `mockups/regem-mister-v6.html`, "Na loja" › Regras, aprovado em 20/11/2026).
// As regras de aviso que cada pessoa criou pela conversa (M6e, mig 472), no modelo de lista do Estoque: a contagem, as
// situações, a busca e (para o presidente) a pessoa. Cada pessoa vê as dela; o presidente vê as de todos (decisão V6-5) —
// quem decide é o servidor (`GET /mister/regras`). Pausar, retomar e apagar daqui; MUDAR é pela conversa (a regra é montada
// pelo Mister com os dados que ele lê — a gaveta mostra o que ela faz e como pedir a mudança).

type Regra = {
  id: string;
  titulo: string;
  resumo: string;
  situacao: 'ativa' | 'pausada';
  fonte: string;
  de: string;
  voce: boolean;
  ultimoAviso: string | null;
  criadaEm: string;
  deixaDeReceber: string[];
};
type Resposta = { souPresidente: boolean; regras: Regra[] };

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'ainda não avisou';
const mensagem = (e: unknown, padrao: string) => (e instanceof Error && e.message ? e.message : padrao);

export function RegrasDoMister() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState(false);
  const [busca, setBusca] = useState('');
  const [pessoa, setPessoa] = useState('');
  const [situacao, setSituacao] = useState(-1);
  const [aberta, setAberta] = useState<Regra | null>(null);
  const [apagando, setApagando] = useState<Regra | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setErro(false);
    try {
      setDados((await api.get('/mister/regras')) as Resposta);
    } catch {
      setErro(true);
    }
  }, []);
  useEffect(() => void carregar(), [carregar]);

  const pessoas = useMemo(() => [...new Set((dados?.regras ?? []).map((r) => r.de))].sort(), [dados]);
  const base = useMemo(() => {
    const t = semAcento(busca.trim());
    return (dados?.regras ?? []).filter((r) => (!pessoa || r.de === pessoa) && (!t || semAcento(`${r.titulo} ${r.resumo}`).includes(t)));
  }, [dados, busca, pessoa]);
  const situacoes = [
    { rotulo: 'Ativas', filtro: (r: Regra) => r.situacao === 'ativa' },
    { rotulo: 'Pausadas', filtro: (r: Regra) => r.situacao === 'pausada', tom: 'aviso' as const },
  ];
  const linhas = situacao < 0 ? base : base.filter(situacoes[situacao].filtro);
  const limpar = () => {
    setBusca('');
    setPessoa('');
    setSituacao(-1);
  };

  async function mexer(r: Regra, acao: 'pausar' | 'retomar' | 'apagar') {
    setOcupado(true);
    try {
      if (acao === 'apagar') await api.del(`/mister/regras/${r.id}`);
      else await api.post(`/mister/regras/${r.id}/${acao}`, {});
      toast.success(acao === 'apagar' ? 'Regra apagada.' : acao === 'pausar' ? 'Regra pausada: ela não avisa até você retomar.' : 'Regra retomada.');
      setApagando(null);
      setAberta(null);
      await carregar();
    } catch (e) {
      toast.error(mensagem(e, 'Não deu para mudar a regra agora.'));
    } finally {
      setOcupado(false);
    }
  }

  if (erro)
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        Não consegui carregar as regras agora.{' '}
        <Button variant="outline" className="ml-2" onClick={() => void carregar()}>
          Tentar de novo
        </Button>
      </div>
    );

  return (
    <section className="space-y-4" aria-labelledby="regras-mister">
      <TituloLista
        id="regras-mister"
        titulo="Regras"
        total={dados?.regras.length ?? 0}
        mostrando={linhas.length}
        um="regra"
        varios="regras"
        extra="cada pessoa cria as dela pela conversa com o Mister"
      />
      {!dados ? (
        <SkeletonList rows={3} />
      ) : (
        <>
          <Situacoes base={base} opcoes={situacoes} valor={situacao} aoMudar={setSituacao} />
          <Filtros emLinha>
            <FiltroBusca id="regras-busca" valor={busca} aoMudar={setBusca} placeholder="Buscar regra" />
            {dados.souPresidente && pessoas.length > 1 && (
              <FiltroSelect
                id="regras-pessoa"
                rotulo="Pessoa"
                opcoes={[{ v: '', rotulo: 'Todas as pessoas' }, ...pessoas.map((p) => ({ v: p, rotulo: p }))]}
                valor={pessoa}
                aoMudar={setPessoa}
              />
            )}
          </Filtros>
          {dados.regras.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground">
              <span className="mb-1 block text-2xl" aria-hidden>
                ⏱
              </span>
              Nenhuma regra ainda. Diga ao Mister no WhatsApp como quer ser avisado — por exemplo, &quot;só me avise quando tiver 3 pedidos com mais de 20 minutos&quot;.
            </p>
          ) : linhas.length === 0 ? (
            <Vazio aoLimpar={limpar}>Nenhuma regra com esse filtro.</Vazio>
          ) : (
            <ListaDados
              legenda="As regras de aviso de cada pessoa, com o que fazem, a situação, de quem são e o último aviso"
              linhas={linhas}
              chave={(r) => r.id}
              nome={(r) => r.titulo}
              colunas={[
                {
                  titulo: 'Regra',
                  celula: (r) => (
                    <span className="block">
                      <span className="font-semibold">{r.titulo}</span>
                      <span className={`block text-xs ${texto2}`}>{r.resumo}</span>
                    </span>
                  ),
                },
                {
                  titulo: 'Situação',
                  celula: (r) => <Selo tom={r.situacao === 'ativa' ? 'ok' : 'neutro'}>{r.situacao === 'ativa' ? 'ativa' : 'pausada'}</Selo>,
                },
                { titulo: 'O que olha', celula: (r) => <Selo tom="info">{r.fonte}</Selo> },
                { titulo: 'De quem', celula: (r) => (r.voce ? 'você' : r.de) },
                { titulo: 'Último aviso', celula: (r) => <span className="whitespace-nowrap font-mono">{quando(r.ultimoAviso)}</span> },
              ]}
              acoes={(r) => [
                { rotulo: 'Ver', icone: Eye, aoClicar: (x: Regra) => setAberta(x) },
                r.situacao === 'ativa'
                  ? { rotulo: 'Pausar', icone: Pause, aoClicar: (x: Regra) => void mexer(x, 'pausar') }
                  : { rotulo: 'Retomar', icone: Play, aoClicar: (x: Regra) => void mexer(x, 'retomar') },
                { rotulo: 'Apagar', icone: Trash2, aoClicar: (x: Regra) => setApagando(x) },
              ]}
            />
          )}
          <p className="text-sm text-muted-foreground">
            Para criar ou mudar uma regra, fale com o Mister no WhatsApp: ele monta a regra com os dados que lê e só liga depois do seu &quot;Confirmar&quot;. Os avisos
            críticos (servidor sem sinal, certificado, chave de IA) continuam chegando, com ou sem regra.
          </p>
          {dados.souPresidente && <SegurancaDoMister />}
        </>
      )}

      {aberta && (
        <Gaveta
          titulo={aberta.titulo}
          aoFechar={() => setAberta(null)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setApagando(aberta)} disabled={ocupado}>
                Apagar
              </Button>
              <Button type="button" onClick={() => void mexer(aberta, aberta.situacao === 'ativa' ? 'pausar' : 'retomar')} disabled={ocupado}>
                {aberta.situacao === 'ativa' ? 'Pausar' : 'Retomar'}
              </Button>
            </>
          }
        >
          <dl className="text-sm">
            <Linha rotulo="O que faz" valor={aberta.resumo} />
            <Linha rotulo="O que olha" valor={aberta.fonte} />
            <Linha rotulo="De quem" valor={aberta.voce ? 'você' : aberta.de} />
            <Linha rotulo="Situação" valor={aberta.situacao === 'ativa' ? 'ativa' : 'pausada'} />
            <Linha rotulo="Último aviso" valor={quando(aberta.ultimoAviso)} />
            {aberta.deixaDeReceber.length > 0 && <Linha rotulo="No lugar de" valor={aberta.deixaDeReceber.join(', ')} />}
          </dl>
          <p className={`mt-4 text-sm ${texto2}`}>
            Para mudar esta regra, diga ao Mister no WhatsApp o que quer diferente (por exemplo, &quot;muda para 25 minutos&quot;). Ele mostra como fica e só troca depois do
            &quot;Confirmar&quot;.
          </p>
        </Gaveta>
      )}

      {apagando && (
        <Dialogo
          titulo="Apagar a regra?"
          alerta
          aoFechar={() => setApagando(null)}
          rodape={
            <>
              <Button type="button" variant="outline" data-foco-inicial onClick={() => setApagando(null)} disabled={ocupado}>
                Cancelar
              </Button>
              <Button type="button" variant="destructive" onClick={() => void mexer(apagando, 'apagar')} disabled={ocupado}>
                {ocupado ? 'Apagando…' : 'Apagar'}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            &quot;{apagando.titulo}&quot; para de avisar{apagando.voce ? '' : ` ${apagando.de}`} na hora.
            {apagando.deixaDeReceber.length ? ' Os avisos da empresa que ela substituía voltam a chegar pelo WhatsApp.' : ''}
          </p>
        </Dialogo>
      )}
    </section>
  );
}

/**
 * "Segurança · só o presidente muda" (versão 6, M6d, mig 476; o protótipo, abaixo da lista): a sessão com PIN — com ela
 * ligada, os valores em reais, os dados de pessoas e as ações de botão pedem o PIN pelo link, que vale pelo tempo escolhido.
 * Nasce desligada. Lê e salva pelos ajustes da conversa (`GET`/`PATCH /mister/conversa`, só o presidente).
 */
function SegurancaDoMister() {
  const OPCOES = [
    { v: '', rotulo: 'Desligado' },
    { v: '6', rotulo: 'a cada 6 horas' },
    { v: '12', rotulo: 'a cada 12 horas' },
    { v: '24', rotulo: 'a cada 24 horas' },
  ];
  const [salvo, setSalvo] = useState<string | null>(null);
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const ler = useCallback(async () => {
    setErro(false);
    try {
      const r = (await api.get('/mister/conversa')) as { conversa?: { pinACadaH?: number | null } };
      const v = r?.conversa?.pinACadaH ? String(r.conversa.pinACadaH) : '';
      setSalvo(v);
      setValor(v);
    } catch {
      setErro(true);
    }
  }, []);
  useEffect(() => void ler(), [ler]);
  async function salvar() {
    setSalvando(true);
    try {
      await api.patch('/mister/conversa', { pinACadaH: valor ? Number(valor) : null });
      setSalvo(valor);
      toast.success(valor ? `Pronto: o Mister pede o PIN a cada ${valor} horas para valores, dados de pessoas e botões.` : 'Pronto: o Mister não pede mais o PIN da sessão.');
    } catch (e) {
      toast.error(mensagem(e, 'Não deu para salvar agora.'));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4" aria-labelledby="seguranca-mister">
      <h3 id="seguranca-mister" className="font-display text-base font-bold">
        Segurança · só o presidente muda
      </h3>
      {erro ? (
        <p role="alert" className="text-sm">
          Não consegui ler o ajuste agora.{' '}
          <Button variant="outline" className="ml-2" onClick={() => void ler()}>
            Tentar de novo
          </Button>
        </p>
      ) : salvo === null ? (
        <SkeletonList rows={1} />
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Pedir o PIN para valores e dados de pessoas</p>
          <p className={`text-sm ${texto2}`}>
            Valores em reais, dados de pessoas e ações de botão pedem o PIN pelo link. Depois do PIN, vale pelo tempo escolhido. Recomendado se o WhatsApp fica aberto
            em algum computador da loja.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <FiltroSelect id="seguranca-pin" rotulo="De quanto em quanto tempo" opcoes={OPCOES} valor={valor} aoMudar={setValor} />
            <Button type="button" onClick={() => void salvar()} disabled={salvando || valor === salvo}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
          <p className={`border-t border-border pt-2 text-sm ${texto2}`}>
            <span className="font-semibold text-foreground">Desligar quem fica 60 dias sem conversa</span> · sempre ligado. O WhatsApp de quem não fala com o Mister
            há 60 dias é desligado, com aviso na tela; para voltar, a pessoa gera o código de novo.
          </p>
        </div>
      )}
    </section>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0">
      <dt className={texto2}>{rotulo}</dt>
      <dd className="min-w-0 break-words text-right">{valor}</dd>
    </div>
  );
}
