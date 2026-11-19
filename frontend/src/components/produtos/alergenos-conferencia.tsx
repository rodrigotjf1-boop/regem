'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio, semAcento, type Situacao } from '@/components/ui/lista';
import { listaParaLer, rotuloDoAlergeno } from '@/lib/alergenos';
import { AlergenosProdutoGaveta, type AlergenosDoProdutoLinha } from './alergenos-produto-gaveta';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CADASTROS › CARDÁPIO › ALÉRGENOS (mig 454, D2 — decisão A8; protótipo `regem-atendente-alergenos-agendado.html`): a
// conferência do que o cardápio diz ao cliente — cada produto com a situação (informado × não informado), o que contém e de
// onde vem; situações que filtram, busca, alérgeno e origem; vazio, carregando e erro; a gaveta do produto ao editar.

type P = AlergenosDoProdutoLinha;

const FILTRO_ALERGENO = ['Trigo', 'Leite', 'Ovos', 'Soja', 'Amendoim', 'Castanhas', 'Crustáceos', 'Peixes'] as const;
const CASTANHAS = ['Amêndoa', 'Avelã', 'Castanha-de-caju', 'Castanha-do-pará', 'Macadâmia', 'Nozes', 'Pecã', 'Pistache', 'Pinoli', 'Castanhas (outras)'];
const casaAlergeno = (p: P, a: string) => {
  const lista = [...p.contem, ...p.podeConter];
  return a === 'Castanhas' ? lista.some((x) => CASTANHAS.includes(x)) : lista.includes(a);
};

const SITUACOES: Situacao<P>[] = [
  { rotulo: 'Informados', filtro: (p) => p.situacao === 'informado' },
  { rotulo: 'Não informados', filtro: (p) => p.situacao !== 'informado', tom: 'aviso' },
];

function Resumo({ p }: { p: P }) {
  if (p.situacao === 'nao_informado' && !p.contem.length && !p.podeConter.length) return <span className="text-sm text-secondary-foreground">—</span>;
  const partes = [
    p.contem.length ? `Contém ${listaParaLer(p.contem)}` : null,
    p.podeConter.length ? `pode conter ${listaParaLer(p.podeConter)}` : null,
  ].filter(Boolean);
  return <span className="text-sm">{partes.length ? partes.join(' · ') : 'Nenhum alérgeno da lista'}</span>;
}

export function AlergenosConferencia() {
  const [dados, setDados] = useState<{ produtos: P[] } | null>(null);
  const [erro, setErro] = useState(false);
  const [busca, setBusca] = useState('');
  const [alergeno, setAlergeno] = useState('');
  const [origem, setOrigem] = useState('');
  const [situacao, setSituacao] = useState(-1);
  const [editando, setEditando] = useState<P | null>(null);
  const leitura = useRef(0);

  // Só a resposta da leitura mais nova vale (V64).
  const carregar = useCallback(async () => {
    const minha = ++leitura.current;
    setErro(false);
    try {
      const r: any = await api.get('/produtos/alergenos');
      if (minha === leitura.current) setDados({ produtos: Array.isArray(r?.produtos) ? r.produtos : [] });
    } catch {
      if (minha === leitura.current) setErro(true);
    }
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const produtos = useMemo(() => dados?.produtos ?? [], [dados]);
  const base = useMemo(() => {
    const q = semAcento(busca.trim());
    return produtos.filter(
      (p) =>
        (!q || semAcento(p.nome).includes(q) || semAcento(p.categoria ?? '').includes(q)) &&
        (!alergeno || casaAlergeno(p, alergeno)) &&
        (!origem || p.origem === origem),
    );
  }, [produtos, busca, alergeno, origem]);
  const linhas = situacao < 0 ? base : base.filter(SITUACOES[situacao].filtro);
  const informados = produtos.filter((p) => p.situacao === 'informado').length;
  const limpar = () => {
    setBusca('');
    setAlergeno('');
    setOrigem('');
    setSituacao(-1);
  };

  return (
    <div className="space-y-4">
      <TituloLista
        id="alergenos-titulo"
        titulo="Alérgenos do cardápio"
        total={produtos.length}
        mostrando={linhas.length}
        um="produto"
        varios="produtos"
        extra={dados ? `${informados} informados · ${produtos.length - informados} não informados` : undefined}
      />
      <p className="text-xs text-secondary-foreground">
        &quot;Informado&quot; = todos os alérgenos da lista têm resposta. &quot;Não informado&quot; mostra o que falta (um insumo sem
        conferir, um produto sem ficha) e o que já se sabe. Os insumos são marcados em Estoque › Produtos; o produto herda pela
        ficha técnica.
      </p>

      {erro ? (
        <Card className="flex flex-wrap items-center justify-center gap-3 p-8 text-center text-sm">
          <span>
            <b>Não deu para ler os produtos.</b> A conexão com o Regem falhou. Nada foi alterado.
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void carregar()}>Tentar de novo</Button>
        </Card>
      ) : !dados ? (
        <Card className="p-8 text-center text-sm text-secondary-foreground" role="status">Carregando os produtos…</Card>
      ) : !produtos.length ? (
        <Vazio>
          <span>
            <b>Nenhum produto no cardápio.</b> Cadastre os produtos em Cadastros › Cardápio. Cada um começa como &quot;não informado&quot;.
          </span>
        </Vazio>
      ) : (
        <>
          <Situacoes base={base} opcoes={SITUACOES} valor={situacao} aoMudar={setSituacao} />
          <Filtros>
            <FiltroBusca id="alergenos-busca" valor={busca} aoMudar={setBusca} placeholder="Buscar produto" />
            <FiltroSelect
              id="alergenos-alergeno"
              rotulo="Alérgeno"
              todos="Todos"
              opcoes={FILTRO_ALERGENO.map((a) => ({ v: a, rotulo: rotuloDoAlergeno(a) }))}
              valor={alergeno}
              aoMudar={setAlergeno}
            />
            <FiltroSelect
              id="alergenos-origem"
              rotulo="De onde vem"
              todos="Todas as origens"
              opcoes={[
                { v: 'ficha', rotulo: 'Pela ficha técnica' },
                { v: 'mao', rotulo: 'À mão (no produto)' },
              ]}
              valor={origem}
              aoMudar={setOrigem}
            />
          </Filtros>
          {!linhas.length ? (
            <Vazio aoLimpar={limpar} />
          ) : (
            <ListaDados<P>
              legenda="Alérgenos de cada produto do cardápio"
              linhas={linhas}
              chave={(p) => `alergenos-${p.id}`}
              nome={(p) => p.nome}
              grupoDe={(p) => p.categoria ?? 'Sem categoria'}
              colunas={[
                {
                  titulo: 'Produto',
                  celula: (p) => (
                    <NomeComApoio
                      nome={p.nome}
                      apoio={p.situacao !== 'informado' && p.faltaConferir.length ? `Falta conferir: ${p.faltaConferir.slice(0, 3).join(', ')}${p.faltaConferir.length > 3 ? '…' : ''}` : undefined}
                    />
                  ),
                },
                {
                  titulo: 'Situação',
                  celula: (p) =>
                    p.situacao === 'informado' ? <Selo tom="ok">Informado</Selo> : <Selo tom="aviso">Não informado</Selo>,
                },
                { titulo: 'Alérgenos', celula: (p) => <Resumo p={p} /> },
                {
                  titulo: 'De onde vem',
                  celula: (p) => (
                    <span className="text-sm text-secondary-foreground">
                      {p.origem === 'ficha' ? 'Pela ficha técnica' : p.origem === 'mao' ? 'À mão' : '—'}
                    </span>
                  ),
                },
              ]}
              acoes={(p) => [{ rotulo: 'Marcar alérgenos', icone: Pencil, aoClicar: () => setEditando(p) }]}
            />
          )}
        </>
      )}

      {editando && (
        <AlergenosProdutoGaveta
          p={editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => {
            setEditando(null);
            void carregar();
          }}
        />
      )}
    </div>
  );
}
