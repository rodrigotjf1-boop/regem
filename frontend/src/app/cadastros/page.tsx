'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { EmptyState } from '@/components/ui/empty-state';
import { useCadastrosData } from '@/components/cadastros/use-cadastros-data';
import { buildSecoes, type Opt } from '@/components/cadastros/build-secoes';
import { CadastrosSkeleton } from '@/components/cadastros/cadastros-skeleton';
import { CadastrosHub } from '@/components/cadastros/cadastros-hub';
import { SecaoDetalhe } from '@/components/cadastros/secao-detalhe';

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function CadastrosPage() {
  const router = useRouter();
  const { L, erro, ver, reload } = useCadastrosData();
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
  }, [reload, router]);

  if (!L) {
    return (
      <Shell eyebrow="Gestão" title="Cadastros">
        {erro ? (
          <EmptyState
            icon="⚠️"
            title="Não foi possível carregar"
            description={erro}
          />
        ) : (
          <CadastrosSkeleton />
        )}
      </Shell>
    );
  }

  const optU: Opt[] = L.unidades.map((u: any) => ({ value: u.id, label: u.nome }));
  const optS: Opt[] = L.setores.map((s: any) => ({ value: s.id, label: s.nome }));
  const optF: Opt[] = L.funcoes.map((f: any) => ({ value: f.id, label: f.nome }));
  const withNone = (arr: Opt[]) => [{ value: '', label: '— nenhum —' }, ...arr];
  const criarFuncao = async (nome: string): Promise<Opt> => {
    const f: any = await api.post('/funcoes', { nome, categoria: 'execucao' });
    return { value: f.id, label: f.nome };
  };

  const secoes = buildSecoes({ L, optU, optS, optF, withNone, criarFuncao });
  const secAtual = sel === null ? null : secoes.find((x) => x.key === sel) ?? null;

  return (
    <Shell eyebrow="Gestão" title="Cadastros">
      <div className="max-w-5xl space-y-5">
        {secAtual ? (
          <SecaoDetalhe
            sec={secAtual}
            ver={ver}
            onBack={() => setSel(null)}
            reload={reload}
          />
        ) : (
          <CadastrosHub
            secoes={secoes}
            onSelect={setSel}
            onNavigate={(path) => router.push(path)}
          />
        )}
      </div>
    </Shell>
  );
}
