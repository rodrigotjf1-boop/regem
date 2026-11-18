'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';
import { Selo, texto2, type Tom } from '@/components/ui/lista';
import type { EstadoDaChave } from '@/components/mister/ia-e-uso';

// MISTER › RESUMO (versão 1 do protótipo `mockups/regem-mister.html`, aprovada em 13/11/2026; a tela de entrada do
// presidente). Três blocos, cada um com a sua leitura e o seu "Tentar de novo": "Para o Mister funcionar" (as três etapas:
// o módulo, a chave de IA e o WhatsApp da pessoa), "O que o Mister faz por esta empresa" e os últimos avisos. Só lê as
// rotas que as outras partes já usam; cada etapa leva à parte onde se resolve.

export type ParteDoMister = 'pessoas' | 'ia' | 'avisos' | 'documentos' | 'historico';
type Meu = { disponivel: boolean; ligado: boolean; final: string | null; ligadoEm: string | null };
type Lista = { total: number; pessoas: { ligado: boolean; voce: boolean }[] };
type Aviso = { id: string; titulo: string; detalhe: string | null; situacao: 'aberto' | 'resolvido'; abertoEm: string };
type Leitura<T> = { dado: T | null; erro: boolean };

const PROBLEMA_DA_CHAVE: Record<string, string> = {
  sem_credito: 'está sem crédito',
  teto_atingido: 'chegou ao teto de gasto',
  chave_recusada: 'foi recusada pelo provedor',
};
const nomeDoProvedor = (p: string) => (p === 'anthropic' ? 'Anthropic' : p === 'openai' ? 'OpenAI' : p);
const diaMes = (ts: string | null) => (ts ? new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }) : '');
const quando = (ts: string) => {
  const d = new Date(ts);
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const dia = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' });
  return `${dia === hoje ? 'hoje' : diaMes(ts)} ${hora}`;
};

/** O que o Mister faz por esta empresa: o estado de cada recurso, como o servidor o liga. */
/**
 * Os documentos por foto, como o servidor diz (`GET /mister/conversa`): `null` = não li (o recurso fica pelo estado da IA);
 * `disponivel` = a função ligada nesta instalação; `ligado` = a empresa deixou ligada em "Avisos e relatórios › Conversa".
 */
type Documentos = { disponivel: boolean; ligado: boolean } | null;

const RECURSOS: { nome: string; descricao: string; estado: (iaOk: boolean, documentos: Documentos) => { rotulo: string; tom: Tom } }[] = [
  { nome: 'Vigia do servidor da loja', descricao: 'Sem sinal, serviço parado, disco, cópia de segurança, impressora.', estado: () => ({ rotulo: 'ligado', tom: 'ok' }) },
  { nome: 'Avisos no WhatsApp e no Regem', descricao: 'O problema que a loja resolve chega para quem está ligado.', estado: () => ({ rotulo: 'ligado', tom: 'ok' }) },
  {
    nome: 'Perguntas sobre a loja',
    descricao: '"Como está a loja agora?", "por que o pedido atrasou?", "quantas carnes de 56 g vendemos hoje?"',
    estado: (ok) => (ok ? { rotulo: 'ligado', tom: 'ok' } : { rotulo: 'precisa da chave de IA', tom: 'aviso' }),
  },
  { nome: 'Resumo do dia e da semana', descricao: 'No horário que você escolher, em "Avisos e relatórios".', estado: (ok) => (ok ? { rotulo: 'ligado', tom: 'ok' } : { rotulo: 'precisa da chave de IA', tom: 'aviso' }) },
  { nome: 'Propostas para você autorizar', descricao: 'Ele propõe, você autoriza, o servidor executa e ele confere.', estado: () => ({ rotulo: 'ligado', tom: 'ok' }) },
  // Versão 3 do protótipo (M3a e M3b): o estado vem da função na instalação, do ajuste da empresa e da IA.
  {
    nome: 'Boletos e notas por foto',
    descricao: 'Mande a foto: ele lê, lança e avisa do vencimento.',
    estado: (ok, d) =>
      d && !d.disponivel
        ? { rotulo: 'em breve', tom: 'neutro' }
        : d && !d.ligado
          ? { rotulo: 'desligado', tom: 'neutro' }
          : ok
            ? { rotulo: 'ligado', tom: 'ok' }
            : { rotulo: 'precisa da chave de IA', tom: 'aviso' },
  },
  { nome: 'Relatórios com gráfico e por insumo', descricao: 'Em imagem na conversa, em PDF ou no link para ver no Regem.', estado: (ok) => (ok ? { rotulo: 'ligado', tom: 'ok' } : { rotulo: 'precisa da chave de IA', tom: 'aviso' }) },
  // O nome do protótipo ("Ponto e escala"), agora que o arquivo do ponto do mês também funciona (M3e parte 2).
  {
    nome: 'Ponto e escala',
    descricao: 'O ponto esquecido, pela escala, ao gerente da loja; e o arquivo do ponto do mês, com um toque à contabilidade.',
    estado: () => ({ rotulo: 'ligado', tom: 'ok' }),
  },
  { nome: 'Áudio', descricao: 'Fale com ele por áudio; ele responde em áudio, com o texto junto.', estado: () => ({ rotulo: 'em breve', tom: 'neutro' }) },
];

function Etapa({ feita, problema, numero, titulo, texto, acao }: { feita: boolean; problema?: boolean; numero: number; titulo: string; texto: string; acao: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-start gap-3 border-b border-border py-3 last:border-b-0">
      {/* O círculo e o texto andam juntos, com largura mínima: no estreito, só o botão desce para a linha de baixo. */}
      <span className="flex min-w-[13rem] flex-1 items-start gap-3">
        <span
          aria-hidden
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold ${
            problema ? 'bg-destructive/15 text-foreground' : feita ? 'bg-ok/15 text-foreground' : 'bg-secondary text-foreground'
          }`}
        >
          {problema ? '!' : feita ? '✓' : numero}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">
            {titulo}
            <span className="sr-only">{problema ? ' — pede atenção' : feita ? ' — feito' : ' — falta'}</span>
          </span>
          <span className={`block text-sm ${texto2}`}>{texto}</span>
        </span>
      </span>
      <span className="shrink-0">{acao}</span>
    </li>
  );
}

function Falhou({ titulo, aoTentar }: { titulo: string; aoTentar: () => void }) {
  return (
    <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
      {titulo}{' '}
      <button type="button" className="inline-flex min-h-10 items-center font-semibold underline" onClick={aoTentar}>
        Tentar de novo
      </button>
    </p>
  );
}

export function ResumoDoMister({ aoAbrir }: { aoAbrir: (p: ParteDoMister) => void }) {
  const [chave, setChave] = useState<Leitura<EstadoDaChave> | null>(null);
  const [meu, setMeu] = useState<Leitura<Meu> | null>(null);
  const [lista, setLista] = useState<Leitura<Lista> | null>(null);
  const [avisos, setAvisos] = useState<Leitura<Aviso[]> | null>(null);
  // Os documentos por foto (só o estado de uma linha): a leitura que falha não vira erro na tela — a linha fica pela IA.
  const [documentos, setDocumentos] = useState<Documentos>(null);

  const ler = useCallback(<T,>(rota: string, por: (r: unknown) => T, guardar: (l: Leitura<T> | null) => void) => {
    guardar(null);
    api
      .get(rota)
      .then((r) => guardar({ dado: por(r), erro: false }))
      .catch(() => guardar({ dado: null, erro: true }));
  }, []);
  const lerEtapas = useCallback(() => {
    ler('/ia/chave', (r) => r as EstadoDaChave, setChave);
    ler('/mister/whatsapp', (r) => r as Meu, setMeu);
    ler('/mister/pessoas', (r) => r as Lista, setLista);
  }, [ler]);
  const lerAvisos = useCallback(() => ler('/mister/avisos/historico?dias=7', (r) => (((r as { avisos?: Aviso[] })?.avisos ?? []) as Aviso[]).slice(0, 3), setAvisos), [ler]);
  useEffect(() => {
    lerEtapas();
    lerAvisos();
    api
      .get('/mister/conversa')
      .then((r) => {
        const d = r as { conversa?: { documentosLigado?: boolean }; disponivel?: { documentos?: boolean } };
        setDocumentos({ disponivel: d?.disponivel?.documentos !== false, ligado: d?.conversa?.documentosLigado !== false });
      })
      .catch(() => setDocumentos(null));
  }, [lerEtapas, lerAvisos]);

  const c = chave?.dado;
  const problema = c?.chave && c.chave.situacao !== 'ok' ? PROBLEMA_DA_CHAVE[c.chave.situacao] ?? 'parou' : null;
  const iaOk = !!c && (c.origem === 'incluida' || (!!c.chave && c.chave.situacao === 'ok'));
  const outrosLigados = (lista?.dado?.pessoas ?? []).filter((p) => p.ligado && !p.voce).length;
  const carregandoEtapas = !chave || !meu || !lista;
  const erroNasEtapas = !!(chave?.erro || meu?.erro || lista?.erro);
  const feitas = carregandoEtapas || erroNasEtapas ? 0 : 1 + (iaOk ? 1 : 0) + (meu?.dado?.ligado ? 1 : 0);

  return (
    <div className="space-y-5">
      {problema && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <p className="min-w-0 text-sm">
            <strong>IA parada.</strong> A chave de IA da empresa {problema}. O vigia continua avisando, mas perguntas e relatórios esperam.
          </p>
          <Button type="button" variant="outline" onClick={() => aoAbrir('ia')}>
            Abrir IA e uso
          </Button>
        </div>
      )}

      <Card className="p-4" aria-labelledby="mister-etapas">
        <h2 id="mister-etapas" className="font-display text-lg font-semibold">
          Para o Mister funcionar
        </h2>
        {carregandoEtapas ? (
          <SkeletonList rows={3} />
        ) : erroNasEtapas ? (
          <Falhou titulo="Não consegui ler as etapas agora." aoTentar={lerEtapas} />
        ) : (
          <>
            <p className={`text-sm ${texto2}`} role="status">
              {feitas} de 3 etapas concluídas.
            </p>
            <ol className="mt-2">
              <Etapa
                feita
                numero={1}
                titulo="Módulo ligado"
                texto="Ligado em Visão C&O › Módulos do produto."
                acao={<Selo tom="ok">feito</Selo>}
              />
              <Etapa
                feita={iaOk}
                problema={!!problema}
                numero={2}
                titulo="A IA do Mister"
                texto={
                  c?.origem === 'incluida' && !c?.chave
                    ? 'A IA incluída no seu plano: funcionando.'
                    : c?.chave
                      ? `Sua chave da ${nomeDoProvedor(c.chave.provedor)} · final ${c.chave.final} · ${problema ?? 'funcionando'}.`
                      : 'Cadastre a chave da sua conta de IA. Sem ela, o Mister só avisa; não responde nem faz relatório.'
                }
                acao={
                  <Button type="button" variant={iaOk && !problema ? 'outline' : 'default'} onClick={() => aoAbrir('ia')}>
                    {problema ? 'Resolver' : iaOk ? 'Abrir' : 'Cadastrar a chave'}
                  </Button>
                }
              />
              <Etapa
                feita={!!meu?.dado?.ligado}
                numero={3}
                titulo="O seu WhatsApp ligado ao Mister"
                texto={
                  meu?.dado?.ligado
                    ? `Ligado · final ${meu.dado.final ?? '—'} · desde ${diaMes(meu.dado.ligadoEm)}.${outrosLigados ? ` Mais ${outrosLigados} ${outrosLigados === 1 ? 'pessoa ligada' : 'pessoas ligadas'}.` : ''}`
                    : 'Ligue pelo seu celular. É por ele que o Mister sabe que é você.'
                }
                acao={
                  <Button type="button" variant={meu?.dado?.ligado ? 'outline' : 'default'} onClick={() => aoAbrir('pessoas')}>
                    {meu?.dado?.ligado ? 'Abrir' : 'Ligar o meu WhatsApp'}
                  </Button>
                }
              />
            </ol>
          </>
        )}
      </Card>

      <Card className="p-4" aria-labelledby="mister-faz">
        <h2 id="mister-faz" className="font-display text-lg font-semibold">
          O que o Mister faz por esta empresa
        </h2>
        <ul className="mt-2">
          {RECURSOS.map((r) => {
            const e = r.estado(iaOk || carregandoEtapas, documentos);
            return (
              <li key={r.nome} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-b border-border py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{r.nome}</span>
                  <span className={`block text-sm ${texto2}`}>{r.descricao}</span>
                </span>
                <Selo tom={e.tom}>{e.rotulo}</Selo>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="p-4" aria-labelledby="mister-ultimos">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="mister-ultimos" className="font-display text-lg font-semibold">
            Últimos avisos
          </h2>
          <Button type="button" variant="outline" onClick={() => aoAbrir('historico')}>
            Ver o histórico
          </Button>
        </div>
        {!avisos ? (
          <SkeletonList rows={2} />
        ) : avisos.erro ? (
          <Falhou titulo="Não consegui ler os avisos agora." aoTentar={lerAvisos} />
        ) : !avisos.dado?.length ? (
          <p className="mt-2 rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
            <span aria-hidden className="mb-1 block text-2xl">
              📭
            </span>
            Nenhum aviso nos últimos 7 dias. Quando o Mister avisar de algo, aparece aqui e no seu WhatsApp.
          </p>
        ) : (
          <ul className="mt-2">
            {avisos.dado.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-b border-border py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-semibold">{a.titulo}</span>
                  {a.detalhe && <span className={`block break-words text-sm ${texto2}`}>{a.detalhe.split('\n')[0]}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {a.situacao === 'aberto' && <Selo tom="aviso">aberto</Selo>}
                  <span className="whitespace-nowrap font-mono text-sm">{quando(a.abertoEm)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
