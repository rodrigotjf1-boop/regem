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
// conversa (`/mister/conversa`, mig 447), que grava só o que veio. Os avisos escritos pelo Mister (M4c), o "fica de olho"
// (M4d) e "O que o Mister sabe" (M4b) entram nesta mesma parte, cada um na sua fase. Só o presidente (a rota barra).

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

type Conversa = { perfil?: string; jeito?: string | null };
const doServidor = (c: Conversa | undefined): Valores => ({ perfil: c?.perfil ?? 'hoje', jeito: c?.jeito ?? '' });

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
