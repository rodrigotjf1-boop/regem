'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Situacoes, TituloLista, Vazio, distintos, semAcento, type Situacao,
} from '@/components/ui/lista';
import { ACOES_EQUIPAMENTO, resumoEquipamento } from '@/lib/auditoria-equipamentos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// HISTÓRICO DO CADASTRO DE EQUIPAMENTOS — quem cadastrou, pareou, trocou, revogou ou alterou cada
// equipamento. Vem da auditoria (registro imutável): o servidor manda os 100 mais recentes; a
// trilha completa fica em Auditoria. A parte só consulta o servidor quando é aberta.

const PERFIL: Record<string, string> = { presidente: 'Presidente', gerente: 'Gerente', supervisao: 'Supervisão', execucao: 'Execução', suporte: 'Suporte Regem', servico: 'Automático' };
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const quemDe = (r: any): string => r.atorNome ?? (r.origem === 'terminal' ? 'O próprio terminal' : 'Sistema');
const acaoDe = (r: any): string => ACOES_EQUIPAMENTO[r.acao] ?? String(r.acao).replace(/_/g, ' ');
const SITUACOES: Situacao<any>[] = [
  { rotulo: 'Cadastros', filtro: (r) => String(r.acao).startsWith('cadastrou') },
  { rotulo: 'Edições', filtro: (r) => /^(editou|alterou|marcou)/.test(String(r.acao)) },
  { rotulo: 'Pareamentos', filtro: (r) => String(r.acao).startsWith('terminal_') },
  { rotulo: 'Revogações e exclusões', filtro: (r) => /^(revogou|excluiu)/.test(String(r.acao)) },
];
const ID_TITULO = 'historico-titulo';

export function HistoricoEquipamentos() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [quem, setQuem] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const r: any = await api.equipamentosHistorico();
      setRows(Array.isArray(r) ? r : []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o histórico.');
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro)
    return (
      <Card className="space-y-3 p-5 text-sm">
        <p className="font-display text-base font-bold">Histórico de alterações</p>
        <p role="alert">{erro}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void carregar()}>Tentar de novo</Button>
      </Card>
    );
  if (!rows) return <SkeletonList rows={5} />;

  const b = semAcento(busca);
  const base = rows.filter((r) => (!b || semAcento(`${resumoEquipamento(r.acao, r.detalhe)} ${quemDe(r)}`).includes(b)) && (!quem || quemDe(r) === quem));
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || quem || sit >= 0);
  const limpar = () => { setBusca(''); setQuem(''); setSit(-1); };

  return (
    <section className="space-y-3" aria-labelledby={ID_TITULO}>
      <TituloLista id={ID_TITULO} titulo="Histórico de alterações" total={rows.length} mostrando={linhas.length} um="registro" varios="registros"
        extra="os mais recentes; o registro é imutável e a trilha completa fica em Auditoria">
        <Button type="button" variant="outline" onClick={() => void carregar()} disabled={carregando}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> {carregando ? 'Atualizando…' : 'Atualizar'}
        </Button>
      </TituloLista>
      <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
      <Filtros>
        <FiltroBusca id="historico-busca" valor={busca} aoMudar={setBusca} placeholder="Equipamento ou pessoa" />
        <FiltroSelect id="historico-quem" rotulo="Quem" todos="Todas as pessoas" opcoes={distintos(rows, quemDe)} valor={quem} aoMudar={setQuem} />
      </Filtros>
      {rows.length === 0 ? (
        <Vazio>Nenhuma alteração registrada ainda. Cadastrar, parear, revogar ou editar um equipamento passa a aparecer aqui.</Vazio>
      ) : linhas.length === 0 ? (
        <Vazio aoLimpar={limpar} />
      ) : (
        <ListaDados
          legenda="Histórico de alterações no cadastro de equipamentos"
          linhas={linhas}
          chave={(r) => r.id}
          nome={(r) => resumoEquipamento(r.acao, r.detalhe)}
          colunas={[
            { titulo: 'Equipamento', celula: (r) => <span className="break-words font-bold">{resumoEquipamento(r.acao, r.detalhe)}</span> },
            { titulo: 'O que fez', celula: acaoDe },
            { titulo: 'Quem', celula: (r) => <NomeComApoio nome={<span className="font-normal">{quemDe(r)}</span>} apoio={r.atorPerfil ? PERFIL[r.atorPerfil] ?? r.atorPerfil : undefined} /> },
            { titulo: 'Quando', celula: (r) => <span className="whitespace-nowrap font-mono">{quando(r.criadoEm)}</span> },
          ]}
        />
      )}
      {filtrando && linhas.length > 0 && (
        <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
      )}
    </section>
  );
}
