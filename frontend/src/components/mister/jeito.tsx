'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Ajustes, alterados, type GrupoDeAjustes, type Valor, type Valores } from '@/components/ui/ajustes';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { texto2 } from '@/components/ui/lista';
import { SkeletonList } from '@/components/ui/skeleton';

// MISTER › "JEITO E MEMÓRIA" (versão 4 do Mister; protótipo `mockups/regem-mister-jeito-memoria.html`, aprovado pelo dono em
// 18/11/2026). Fase M4a: o PERFIL (os mesmos do atendente virtual) e o "JEITO DA EMPRESA" — a mesma rota dos ajustes da
// conversa (`/mister/conversa`, mig 447), que grava só o que veio. Fase M4c: os AVISOS ESCRITOS pelo Mister, um ajuste por
// grupo (a mesma rota, a coluna `avisos_escritos` da 447). Fase M4d: a chave "Fica de olho" e lembretes (mig 452, nasce
// desligada). "O que o Mister sabe" (M4b) fica logo abaixo (`memoria.tsx`). Só o presidente (a rota barra).

/** Os perfis, na ordem e com os nomes do atendente virtual (as chaves são as do servidor — `perfis-do-atendente.ts`). */
export const PERFIS_DO_MISTER: { v: string; rotulo: string }[] = [
  { v: 'hoje', rotulo: 'Como hoje' },
  { v: 'profissional', rotulo: 'Profissional' },
  { v: 'cordial', rotulo: 'Cordial' },
  { v: 'gentil', rotulo: 'Gentil' },
  { v: 'descontraido', rotulo: 'Descontraído' },
  { v: 'objetivo', rotulo: 'Objetivo' },
  { v: 'acolhedor', rotulo: 'Acolhedor' },
];
/** O "Jeito da empresa" cabe nisto (a mesma conta do servidor e da mig 447). */
export const JEITO_MAX = 300;
/** M4c: os grupos de aviso que o Mister pode escrever (as chaves do servidor — `GRUPOS_DE_AVISO_ESCRITO`), na ordem da tela. */
export const GRUPOS_DE_AVISO_ESCRITO: { v: string; rotulo: string }[] = [
  { v: 'loja', rotulo: 'Na loja' },
  { v: 'servidor', rotulo: 'Servidor' },
  { v: 'fiscal', rotulo: 'Fiscal' },
  { v: 'mister', rotulo: 'O próprio Mister' },
];
/** Os grupos marcados viajam na tela como texto na ordem fixa ("loja,fiscal"): assim o "mudou?" dos ajustes compara certo. */
const comoTexto = (lista: unknown): string =>
  GRUPOS_DE_AVISO_ESCRITO.filter((g) => Array.isArray(lista) && lista.includes(g.v))
    .map((g) => g.v)
    .join(',');
const comoLista = (v: Valor | undefined): string[] => String(v ?? '').split(',').filter(Boolean);

type Conversa = { perfil?: string; jeito?: string | null; avisosEscritos?: string[]; ficaDeOlho?: boolean; respostasEscritas?: boolean };
const doServidor = (c: Conversa | undefined): Valores => ({
  perfil: c?.perfil ?? 'hoje',
  jeito: c?.jeito ?? '',
  avisosEscritos: comoTexto(c?.avisosEscritos),
  // M4d (mig 452): nasce desligado; o servidor antigo (sem o campo) também é "desligado".
  ficaDeOlho: c?.ficaDeOlho === true,
  // Versão 10, C9 (mig 506): nasce desligado; o servidor antigo (sem o campo) também é "desligado".
  respostasEscritas: c?.respostasEscritas === true,
});

/** As marcas dos grupos (decisão 7 do protótipo: um por grupo, nascendo desligado). */
function MarcasDosAvisos({ valor, aoMudar }: { valor: Valor; aoMudar: (v: Valor) => void }) {
  const marcados = comoLista(valor);
  return (
    <div className="flex flex-wrap gap-2">
      {GRUPOS_DE_AVISO_ESCRITO.map((g) => {
        const id = `aviso-escrito-${g.v}`;
        const ligado = marcados.includes(g.v);
        return (
          <label
            key={g.v}
            htmlFor={id}
            className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
          >
            <input
              id={id}
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={ligado}
              onChange={() => aoMudar(comoTexto(ligado ? marcados.filter((x) => x !== g.v) : [...marcados, g.v]))}
            />
            {g.rotulo}
          </label>
        );
      })}
    </div>
  );
}

export function JeitoDoMister() {
  const [salvos, setSalvos] = useState<Valores | null>(null);
  const [valores, setValores] = useState<Valores>({});
  const [falhou, setFalhou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | undefined>();

  const ler = useCallback(async () => {
    setFalhou(false);
    try {
      const r = (await api.get('/mister/conversa')) as { conversa?: Conversa };
      const v = doServidor(r?.conversa);
      setSalvos(v);
      setValores(v);
    } catch {
      setFalhou(true);
    }
  }, []);
  useEffect(() => {
    void ler();
  }, [ler]);

  const grupos: GrupoDeAjustes[] = useMemo(
    () => [
      {
        titulo: 'Conversa',
        nota: <span className={`text-sm ${texto2}`}>Como ele fala com você e com os gerentes.</span>,
        itens: [
          {
            id: 'perfil',
            rotulo: 'Perfil',
            tipo: 'selecao',
            opcoes: PERFIS_DO_MISTER,
            palavras: 'tom jeito de falar perfil profissional cordial gentil descontraído objetivo acolhedor',
            ajuda: 'O tom das respostas — os mesmos perfis do atendente virtual. "Como hoje" não muda nada.',
          },
          {
            id: 'jeito',
            rotulo: 'Jeito da empresa',
            tipo: 'area',
            maximo: JEITO_MAX,
            opcional: true,
            largo: true,
            placeholder: 'Ex.: Fale como sócio, sem formalidade. No fim da noite, comece pelo que deu errado.',
            palavras: 'jeito frase como falar empresa',
            ajuda: 'Uma frase sobre como o Mister deve falar com vocês. Ele segue quando não contrariar as regras.',
          },
        ],
      },
      {
        titulo: 'Avisos',
        nota: <span className={`text-sm ${texto2}`}>O texto dos avisos que chegam pelo WhatsApp.</span>,
        itens: [
          {
            id: 'avisosEscritos',
            rotulo: 'Avisos escritos pelo Mister',
            tipo: 'livre',
            largo: true,
            palavras: 'avisos escritos texto ia loja servidor fiscal',
            ajuda:
              'Em vez do texto fixo, o Mister escreve o aviso com o que importa: há quanto tempo, se é o único, o que fazer. Quem descobre o problema continua sendo a regra, sem IA. Sem IA, sem crédito ou fora das 24 horas, vai o texto de hoje. Gasta cerca de US$ 0,001 por aviso, na chave da empresa.',
            desenhar: (v, aoMudar) => <MarcasDosAvisos valor={v} aoMudar={aoMudar} />,
          },
          {
            id: 'ficaDeOlho',
            rotulo: '"Fica de olho" e lembretes',
            tipo: 'chave',
            palavras: 'fica de olho lembrete lembrar avisar pedido',
            ajuda: 'Pela conversa: "me avisa quando o #284 sair", "me lembra amanhã às 10h de pagar o gás". Até 3 "fica de olho" e 10 lembretes por pessoa.',
          },
          {
            // Versão 10, C9 (mig 506; protótipo `mockups/regem-mister-v10.html`, "Na loja" › "A IA escreve as respostas").
            id: 'respostasEscritas',
            rotulo: 'A IA escreve as respostas',
            tipo: 'chave',
            palavras: 'ia escreve respostas feito nao deu variar palavras robo frase fixa',
            ajuda:
              'O "feito" e o "não deu" depois de cada botão saem escritos pela IA, no jeito da empresa, variando as palavras. Os números são os que o Regem gravou: se ela passar de 5 segundos ou mudar um número, vai a frase de hoje. O que você confirma ("Vou fazer") continua montado pelo Regem. Cerca de R$ 0,002 por resposta; com 600 no mês, uns R$ 1, na chave da empresa.',
          },
        ],
      },
    ],
    [],
  );

  const mudar = useCallback((chave: string, v: Valor) => {
    setErro(undefined);
    setValores((atual) => ({ ...atual, [chave]: v }));
  }, []);

  const salvar = useCallback(async () => {
    if (!salvos) return;
    const mudou = alterados(grupos, valores, salvos);
    if (!mudou.length) return;
    // Só o que mudou vai ao servidor (ele grava só o que veio — outro ajuste salvo ao mesmo tempo não se perde).
    const corpo: Record<string, unknown> = {};
    if (mudou.includes('perfil')) corpo.perfil = String(valores.perfil);
    if (mudou.includes('jeito')) corpo.jeito = String(valores.jeito ?? '').trim() || null;
    if (mudou.includes('avisosEscritos')) corpo.avisosEscritos = comoLista(valores.avisosEscritos);
    if (mudou.includes('ficaDeOlho')) corpo.ficaDeOlho = valores.ficaDeOlho === true;
    if (mudou.includes('respostasEscritas')) corpo.respostasEscritas = valores.respostasEscritas === true;
    setSalvando(true);
    setErro(undefined);
    try {
      const r = (await api.patch('/mister/conversa', corpo)) as { conversa?: Conversa };
      const v = doServidor(r?.conversa);
      setSalvos(v);
      setValores(v);
      toast.success('Salvo. Vale da próxima pergunta em diante.');
    } catch (e: unknown) {
      setErro(e instanceof Error && e.message ? e.message : 'Não deu para salvar agora. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  }, [grupos, valores, salvos]);

  if (falhou)
    return (
      <Card className="p-6 text-center" role="alert">
        <p className="font-semibold">Não deu para ler o jeito do Mister agora.</p>
        <Button className="mt-3" variant="outline" onClick={() => void ler()}>
          Tentar de novo
        </Button>
      </Card>
    );
  if (!salvos) return <SkeletonList rows={3} />;

  return (
    <Ajustes
      id="mister-jeito"
      titulo="O jeito do Mister"
      grupos={grupos}
      valores={valores}
      salvos={salvos}
      aoMudar={mudar}
      aoSalvar={() => void salvar()}
      aoDescartar={() => {
        setErro(undefined);
        setValores(salvos);
      }}
      salvando={salvando}
      erro={erro}
      antes={
        <p className={`mb-2 max-w-[72ch] text-sm ${texto2}`}>
          As regras não mudam com o perfil: número só de consulta, só o que cada perfil de acesso pode ver, e nada é feito sem a sua autorização.
        </p>
      }
    />
  );
}
