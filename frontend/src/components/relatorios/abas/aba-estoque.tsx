'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { baixarCsv } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio, num, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';
import { Indicadores } from '@/components/relatorios/pecas';
import { useLeitura } from '@/components/relatorios/leitura';
import { AvisoSemValores, Parte } from '@/components/relatorios/bloco';
import { rs, type PropsDaAba } from '@/components/relatorios/formatos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ABA ESTOQUE — `/estoque/inteligencia`: saldo, valor, consumo por dia e cobertura de cada insumo.
// Como as outras abas, é da LOJA EM USO; no total, o servidor soma loja a loja.

const ID_TITULO = 'estoque-aba-titulo';
const SITUACOES: Situacao<any>[] = [
  { rotulo: 'Abaixo do mínimo', filtro: (i) => !!i.abaixoMinimo, tom: 'critico' },
  { rotulo: 'Sem saída no período', filtro: (i) => !Number(i.consumoDiario), tom: 'aviso' },
];
const ORDENS = [
  { v: 'mais', rotulo: 'Mais giram primeiro' },
  { v: 'menos', rotulo: 'Menos giram primeiro' },
] as const;

function ListaDoEstoque({ dados, verFin, aoContar }: { dados: any; verFin: boolean; aoContar: (n: number) => void }) {
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [classe, setClasse] = useState('');
  const [ordem, setOrdem] = useState<string>('mais');
  const todos: any[] = dados.itens ?? [];
  useEffect(() => aoContar(todos.length), [todos.length, aoContar]);

  const b = semAcento(busca);
  const base = todos.filter((i) => (!b || semAcento(i.nome).includes(b)) && (!classe || i.classeAbc === classe));
  const linhas = (sit < 0 ? base : base.filter(SITUACOES[sit].filtro)).sort((x, y) => (ordem === 'mais' ? Number(y.consumoDiario) - Number(x.consumoDiario) : Number(x.consumoDiario) - Number(y.consumoDiario)));
  const filtrando = !!(busca.trim() || classe || sit >= 0);
  const limpar = () => { setBusca(''); setClasse(''); setSit(-1); };
  const exportar = () =>
    baixarCsv('estoque-giro', linhas.map((i) => ({
      insumo: i.nome, saldo: i.saldo, unidade: i.unidadeMedida,
      ...(verFin ? { 'valor em estoque': Number(Number(i.valorEstoque ?? 0).toFixed(2)) } : {}),
      'consumo por dia': i.consumoDiario,
      ...(verFin ? { 'valor consumido': Number(Number(i.valorConsumido ?? 0).toFixed(2)) } : {}),
      'dias de cobertura': i.diasCobertura ?? '', abc: i.classeAbc ?? '',
    })));

  return (
    <div className="space-y-4">
      <Indicadores
        itens={[
          verFin && { rotulo: 'Valor em estoque', valor: rs(dados.resumo?.valorEstoque ?? 0) },
          verFin && { rotulo: 'Consumido no período', valor: rs(dados.resumo?.valorConsumido ?? 0) },
          { rotulo: 'Abaixo do mínimo', valor: dados.resumo?.itensAbaixoMinimo ?? 0 },
          { rotulo: 'A repor', valor: dados.resumo?.itensRepor ?? 0 },
        ]}
      />
      <section className="space-y-3" aria-labelledby={ID_TITULO}>
        <TituloLista id={ID_TITULO} titulo="Posição e giro por produto" total={todos.length} mostrando={linhas.length} um="insumo" varios="insumos">
          {linhas.length > 0 && <Button type="button" variant="outline" onClick={exportar}><Download className="h-4 w-4" aria-hidden="true" /> Exportar CSV</Button>}
        </TituloLista>
        <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
        <Filtros>
          <FiltroBusca id="estoque-aba-busca" valor={busca} aoMudar={setBusca} placeholder="Nome do insumo" />
          <FiltroSelect id="estoque-aba-classe" rotulo="Curva ABC" todos="A, B e C" opcoes={['A', 'B', 'C'].map((c) => ({ v: c, rotulo: `Classe ${c}` }))} valor={classe} aoMudar={setClasse} />
          <FiltroSelect id="estoque-aba-ordem" rotulo="Ordenar por" opcoes={ORDENS} valor={ordem} aoMudar={setOrdem} />
        </Filtros>
        {todos.length === 0 ? (
          <Vazio>Nenhum insumo cadastrado. O cadastro fica em Estoque, na aba Produtos.</Vazio>
        ) : linhas.length === 0 ? (
          <Vazio aoLimpar={limpar} />
        ) : (
          <ListaDados
            legenda="Posição e giro do estoque por produto"
            linhas={linhas}
            chave={(i) => String(i.id)}
            nome={(i) => String(i.nome)}
            colunas={[
              {
                titulo: 'Insumo',
                celula: (i) => (
                  <NomeComApoio nome={i.nome} apoio={i.classeAbc ? `classe ${i.classeAbc}` : undefined}>
                    {i.abaixoMinimo && <Selo tom="critico">abaixo do mínimo</Selo>}
                  </NomeComApoio>
                ),
              },
              { titulo: 'Saldo', celula: (i) => `${num(i.saldo)} ${i.unidadeMedida ?? ''}`, classe: 'whitespace-nowrap font-mono' },
              ...(verFin ? [{ titulo: 'Valor em estoque', celula: (i: any) => rs(i.valorEstoque), classe: 'whitespace-nowrap font-mono' }] : []),
              { titulo: 'Consumo por dia', celula: (i) => `${num(i.consumoDiario)} ${i.unidadeMedida ?? ''}`, classe: 'whitespace-nowrap font-mono' },
              {
                titulo: 'Cobertura',
                celula: (i) => (i.diasCobertura == null ? <span className={`text-xs ${texto2}`}>sem saída</span> : <span className="whitespace-nowrap font-mono">{num(i.diasCobertura)} {Number(i.diasCobertura) === 1 ? 'dia' : 'dias'}</span>),
              },
            ]}
          />
        )}
        {filtrando && linhas.length > 0 && (
          <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
        )}
      </section>
    </div>
  );
}

export function AbaEstoque({ inicio, fim, todas, chave, versao, verFin, acompanhar, aoContar }: PropsDaAba & { aoContar: (n: number) => void }) {
  const estoque = useLeitura<any>(() => api.estoqueInteligencia(inicio, fim, todas), chave, true, versao, acompanhar);
  return (
    <div className="space-y-4">
      {!verFin && <AvisoSemValores />}
      <Parte leitura={estoque} oQue="a posição do estoque">{(d) => <ListaDoEstoque dados={d} verFin={verFin} aoContar={aoContar} />}</Parte>
    </div>
  );
}
