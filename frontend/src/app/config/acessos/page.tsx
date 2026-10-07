'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getCategoria, getToken, getUnidadeAtual } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Partes } from '@/components/ui/partes';
import { SkeletonList } from '@/components/ui/skeleton';
import { PerfisParte, type ItemCatalogo } from '@/components/acessos/perfis-parte';
import { PessoasParte } from '@/components/acessos/pessoas-parte';
import { SuporteParte } from '@/components/acessos/suporte-parte';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Parte = 'perfis' | 'pessoas' | 'suporte';
const motivo = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Não foi possível carregar.');

// Configurações → Acessos & perfis (mockup `mockups/regem-configuracoes.html`), só para o presidente.
// Três partes, cada uma com a sua leitura:
//  • Perfis — o que cada nível enxerga e faz; as permissões abrem na gaveta.
//  • Pessoas — o perfil, o app, o acesso pela internet e o bloqueio de cada colaborador.
//  • Suporte — o que o suporte da distribuição pode fazer nesta empresa, e as sessões dele.
export default function AcessosPage() {
  const router = useRouter();
  const [parte, setParte] = useState<Parte>('perfis');
  const [perfis, setPerfis] = useState<any[] | null>(null);
  const [catalogo, setCatalogo] = useState<ItemCatalogo[]>([]);
  const [erroPerfis, setErroPerfis] = useState('');
  // `null` = ainda não veio; o erro fica à parte (a lista de pessoas pede outra permissão).
  const [pessoas, setPessoas] = useState<any[] | null>(null);
  const [erroPessoas, setErroPessoas] = useState('');
  const [soDaLojaEmUso, setSoDaLojaEmUso] = useState(false);

  const lerPerfis = useCallback(async () => {
    setErroPerfis('');
    try {
      // Sem o catálogo não há o que mostrar nas permissões: os dois vêm juntos.
      const [ps, cat]: any = await Promise.all([api.get('/perfis'), api.get('/perfis/catalogo')]);
      setPerfis(Array.isArray(ps) ? ps : []);
      setCatalogo(Array.isArray(cat) ? cat : []);
    } catch (e) {
      setErroPerfis(motivo(e));
    }
  }, []);
  const lerPessoas = useCallback(async () => {
    setErroPessoas('');
    try {
      const cs: any = await api.colaboradores();
      setPessoas(Array.isArray(cs) ? cs : []);
    } catch (e) {
      setErroPessoas(motivo(e));
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    if (getCategoria() !== 'presidente') {
      router.replace('/painel');
      return;
    }
    // A lista de colaboradores segue a loja escolhida no topo: a contagem por perfil diz isso.
    setSoDaLojaEmUso(!!getUnidadeAtual());
    void lerPerfis();
    void lerPessoas();
  }, [lerPerfis, lerPessoas, router]);

  const falhou = (titulo: string, msg: string, tentar: () => void) => (
    <Card className="space-y-3 p-5 text-sm">
      <p className="font-display text-base font-bold">{titulo}</p>
      <p role="alert">{msg}</p>
      <Button type="button" variant="outline" size="sm" onClick={tentar}>Tentar de novo</Button>
    </Card>
  );
  const editaveis = (perfis ?? []).filter((p) => p.nivel !== 'presidente');

  return (
    <Shell eyebrow="Configurações" title="Acessos & perfis">
      <div className="space-y-4">
        <Partes<Parte>
          rotulo="Partes de Acessos & perfis"
          ativa={parte}
          aoEscolher={setParte}
          partes={[
            { key: 'perfis', label: 'Perfis', conta: perfis ? editaveis.length : null },
            { key: 'pessoas', label: 'Pessoas', conta: pessoas?.length ?? null },
            { key: 'suporte', label: 'Suporte' },
          ]}
        />

        {parte === 'perfis' &&
          (erroPerfis ? (
            falhou('Perfis de acesso', erroPerfis, () => void lerPerfis())
          ) : !perfis ? (
            <SkeletonList rows={4} />
          ) : (
            <PerfisParte perfis={editaveis} catalogo={catalogo} pessoas={erroPessoas ? null : pessoas} soDaLojaEmUso={soDaLojaEmUso}
              recarregar={async () => { await Promise.all([lerPerfis(), lerPessoas()]); }} />
          ))}

        {parte === 'pessoas' &&
          (erroPessoas ? (
            falhou('Colaboradores & acesso', erroPessoas, () => void lerPessoas())
          ) : erroPerfis ? (
            falhou('Colaboradores & acesso', `Sem a lista de perfis não dá para mostrar o acesso de cada pessoa: ${erroPerfis}`, () => void lerPerfis())
          ) : !pessoas || !perfis ? (
            <SkeletonList rows={6} />
          ) : (
            <PessoasParte pessoas={pessoas} perfis={perfis} soDaLojaEmUso={soDaLojaEmUso} recarregar={lerPessoas} />
          ))}

        {parte === 'suporte' && <SuporteParte />}
      </div>
    </Shell>
  );
}
