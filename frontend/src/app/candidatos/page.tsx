'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Shell } from '@/components/app-shell/shell';
import { Partes } from '@/components/ui/partes';
import { Vazio } from '@/components/ui/lista';
import { SkeletonList } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { ListaCandidatos } from '@/components/vagas/loja/lista-candidatos';
import { AjustesDaPagina, type AjustesDaLoja } from '@/components/vagas/loja/ajustes-da-pagina';
import { QrCodes } from '@/components/vagas/loja/qr-codes';

// Pessoas › Candidatos (mig 389): as fichas da página de vagas, os ajustes da página e os QR codes. Só na nuvem (o
// servidor da loja não tem estas tabelas — o menu não mostra a tela lá). A API confere a permissão `candidatos` e o
// módulo "Vagas e candidatos"; a tela só esconde.
type Parte = 'lista' | 'pagina' | 'qr';

export default function CandidatosPage() {
  const [parte, setParte] = useState<Parte>('lista');
  const [dados, setDados] = useState<AjustesDaLoja | null>(null);
  const [semLoja, setSemLoja] = useState('');
  const [pendentes, setPendentes] = useState(0);

  const carregar = useCallback(async () => {
    try {
      setDados(await api.vagasAjustes());
      setSemLoja('');
    } catch (e) {
      // presidente na visão da rede: a lista mostra todas as lojas; os ajustes pedem uma loja
      setSemLoja(e instanceof Error ? e.message : 'Não deu para carregar a página de vagas.');
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const nomesDasFuncoes = useMemo(
    () => Object.fromEntries(((dados?.pagina?.funcoes ?? []) as { codigo: string; nome: string }[]).map((f) => [f.codigo, f.nome])),
    [dados],
  );
  const aoPendentes = useCallback((n: number) => setPendentes(n), []);

  return (
    <Shell eyebrow="Pessoas" title="Candidatos">
      <div className="space-y-4">
        <Partes
          rotulo="Partes de Candidatos"
          ativa={parte}
          aoEscolher={(p) => {
            // trocar de parte com ajuste pendente perderia a barra de salvar de vista: avisa e fica
            if (parte === 'pagina' && p !== 'pagina' && pendentes > 0) return toast.error('Salve ou descarte as alterações antes de trocar de parte.');
            setParte(p);
          }}
          partes={[
            { key: 'lista', label: 'Candidatos' },
            { key: 'pagina', label: 'Página de vagas' },
            { key: 'qr', label: 'QR codes e links' },
          ]}
        />
        {parte === 'lista' && <ListaCandidatos nomesDasFuncoes={nomesDasFuncoes} />}
        {parte !== 'lista' && semLoja && <Vazio>{semLoja}</Vazio>}
        {parte !== 'lista' && !semLoja && !dados && <SkeletonList />}
        {parte === 'pagina' && dados && (
          <AjustesDaPagina
            dados={dados}
            aoPendentes={aoPendentes}
            aoSalvo={(d) => {
              setDados(d);
              setPendentes(0);
            }}
          />
        )}
        {parte === 'qr' && dados && <QrCodes dados={dados} />}
      </div>
    </Shell>
  );
}
