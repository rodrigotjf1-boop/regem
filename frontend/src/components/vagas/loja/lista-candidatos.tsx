'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileText, MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio, dataBr, semAcento, texto2, type Situacao } from '@/components/ui/lista';
import { SkeletonList } from '@/components/ui/skeleton';
import { brl, COMECA_ROTULO, DIA_ROTULO, MEIO_ROTULO, nomeDaFuncao, nomeDaOrigem, SITUACAO_ROTULO, TURNO_ESTUDO_ROTULO } from '@/lib/vagas-ficha';
import { FichaCandidato } from './ficha-candidato';

// Pessoas › Candidatos › aba Candidatos: as fichas da página de vagas da loja em uso (presidente na rede: todas), no
// modelo das listas do Regem — contagem, situações que filtram, busca e filtros, cartões no celular, a ficha numa gaveta.
// Sexo e idade NÃO são filtro (Lei 9.029/1995): a lista ordena e filtra pelo que importa para a vaga.
export interface Candidato {
  id: string; protocolo: string; situacao: string; nome: string; idade: number; telefone: string; bairro: string; cidade: string;
  funcoes: string[]; setores: string[]; tipoVaga: string; escala: string | null; dias: string[]; meios: string[];
  conducoes: number | null; valorIda: number | null; valorVolta: number | null; experiencia: string; estuda: boolean;
  turnoEstudo: string | null; trabalhando: boolean; comeca: string; origem: string | null; origemNome: string | null; entrevistaEm: string | null;
  recebidoEm: string; loja: string; comunicacao: boolean; experiencias: number; temCarteira: boolean; jaLiderou: boolean;
}

const TOM_DA_SITUACAO: Record<string, 'ok' | 'aviso' | 'critico' | 'info' | 'neutro'> = {
  novo: 'info', analise: 'neutro', entrevista: 'aviso', aprovado: 'ok', contratado: 'ok', banco: 'neutro', reprovado: 'critico',
};
const SITUACOES: Situacao<Candidato>[] = ['novo', 'analise', 'entrevista', 'aprovado', 'contratado', 'banco', 'reprovado'].map((s) => ({
  rotulo: SITUACAO_ROTULO[s],
  filtro: (c: Candidato) => c.situacao === s,
}));

/** O dia (YYYY-MM-DD) de um instante no fuso da operação — nunca o dia em UTC (a ficha das 22h é do mesmo dia). */
export const diaNoFuso = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** A vaga numa linha: tipo, escala e dias do horista. */
export function vagaDoCandidato(c: Pick<Candidato, 'tipoVaga' | 'escala' | 'dias'>): string {
  const esc = c.escala === 'tanto' ? '12x36 ou 5x2' : c.escala;
  if (c.tipoVaga === 'horista') return `Horista · ${c.dias.map((d) => DIA_ROTULO[d]).join(', ')}`;
  return [c.tipoVaga === 'tanto' ? 'Fixa ou horista' : 'Fixa', esc, c.tipoVaga === 'tanto' && c.dias.length ? c.dias.map((d) => DIA_ROTULO[d]).join(', ') : '']
    .filter(Boolean)
    .join(' · ');
}
/** "1 condução + Uber · R$ 22,70/dia (informou)" */
export function comoChega(c: Pick<Candidato, 'meios' | 'conducoes' | 'valorIda' | 'valorVolta'>): string {
  const outros = c.meios.filter((m) => m !== 'publico').map((m) => (m === 'uber' ? 'Uber' : MEIO_ROTULO[m]));
  const cond = c.meios.includes('publico') && c.conducoes ? `${c.conducoes}${c.conducoes >= 4 ? '+' : ''} ${c.conducoes === 1 ? 'condução' : 'conduções'}` : '';
  const valor = c.valorIda !== null && c.valorVolta !== null ? `${brl(c.valorIda + c.valorVolta)}/dia` : '';
  return [[cond, ...outros].filter(Boolean).join(' + '), valor].filter(Boolean).join(' · ');
}

export function ListaCandidatos({ nomesDasFuncoes }: { nomesDasFuncoes: Record<string, string> }) {
  const [lista, setLista] = useState<Candidato[] | null>(null);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [funcao, setFuncao] = useState('');
  const [tipo, setTipo] = useState('');
  const [dia, setDia] = useState('');
  const [conducoes, setConducoes] = useState('');
  const [comeca, setComeca] = useState('');
  const [exp, setExp] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setLista(await api.vagasCandidatos());
      setErro('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para carregar as fichas.');
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const nomeFuncao = (c: string) => nomeDaFuncao(c, nomesDasFuncoes);
  const b = semAcento(busca);
  const base = (lista ?? []).filter((c) => {
    if (b && !semAcento(`${c.nome} ${c.bairro} ${c.cidade} ${c.telefone} ${c.protocolo}`).includes(b)) return false;
    if (funcao && !c.funcoes.includes(funcao)) return false;
    if (tipo && !(c.tipoVaga === tipo || c.tipoVaga === 'tanto')) return false;
    if (dia && !(c.tipoVaga === 'fixa' || c.dias.includes(dia))) return false;
    if (conducoes) {
      const n = c.meios.includes('publico') ? c.conducoes ?? 0 : 0;
      if (conducoes === '0' ? n !== 0 : n > Number(conducoes)) return false;
    }
    if (comeca && c.comeca !== comeca) return false;
    if (exp === 'area' && c.experiencia !== 'sim') return false;
    if (exp === 'carteira' && !c.temCarteira) return false;
    if (exp === 'primeiro' && c.experiencia !== 'primeiro') return false;
    return true;
  });
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const limpar = () => {
    setBusca('');
    setSit(-1);
    setFuncao('');
    setTipo('');
    setDia('');
    setConducoes('');
    setComeca('');
    setExp('');
  };
  const funcoesDaLista = [...new Set((lista ?? []).flatMap((c) => c.funcoes))];

  if (erro && !lista)
    return (
      <Vazio>
        {erro}
        <button type="button" className="underline" onClick={carregar}>
          Tentar de novo
        </button>
      </Vazio>
    );
  if (!lista) return <SkeletonList />;

  return (
    <section className="space-y-3" aria-labelledby="candidatos-titulo">
      <TituloLista id="candidatos-titulo" titulo="Fichas recebidas" total={lista.length} mostrando={linhas.length} um="ficha" varios="fichas" />
      <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
      <Filtros>
        <FiltroBusca id="candidatos-busca" valor={busca} aoMudar={setBusca} placeholder="Nome, bairro, telefone ou protocolo" />
        <FiltroSelect id="candidatos-funcao" rotulo="Função" todos="Todas" opcoes={funcoesDaLista.map((v) => ({ v, rotulo: nomeFuncao(v) }))} valor={funcao} aoMudar={setFuncao} />
        <FiltroSelect id="candidatos-tipo" rotulo="Tipo de vaga" todos="Todos" opcoes={[{ v: 'fixa', rotulo: 'Vaga fixa' }, { v: 'horista', rotulo: 'Horista' }]} valor={tipo} aoMudar={setTipo} />
        <FiltroSelect id="candidatos-dia" rotulo="Disponível no dia" todos="Qualquer" opcoes={['sex', 'sab', 'dom', 'seg', 'ter', 'qua', 'qui'].map((v) => ({ v, rotulo: DIA_ROTULO[v] }))} valor={dia} aoMudar={setDia} />
        <FiltroSelect
          id="candidatos-conducoes"
          rotulo="Conduções até a loja"
          todos="Qualquer"
          opcoes={[{ v: '0', rotulo: 'Não precisa' }, { v: '1', rotulo: 'Até 1' }, { v: '2', rotulo: 'Até 2' }]}
          valor={conducoes}
          aoMudar={setConducoes}
        />
        <FiltroSelect id="candidatos-comeca" rotulo="Começa" todos="Qualquer" opcoes={[{ v: 'imediato', rotulo: 'Imediatamente' }]} valor={comeca} aoMudar={setComeca} />
        <FiltroSelect
          id="candidatos-exp"
          rotulo="Experiência"
          todos="Qualquer"
          opcoes={[{ v: 'area', rotulo: 'Na área (food service)' }, { v: 'carteira', rotulo: 'Com carteira assinada' }, { v: 'primeiro', rotulo: 'Primeiro emprego' }]}
          valor={exp}
          aoMudar={setExp}
        />
      </Filtros>
      {lista.length === 0 ? (
        <Vazio>Nenhuma ficha ainda. Ligue a página na aba &quot;Página de vagas&quot; e espalhe os QR codes pela loja.</Vazio>
      ) : linhas.length === 0 ? (
        <Vazio aoLimpar={limpar} />
      ) : (
        <ListaDados
          legenda="Fichas de candidatos"
          linhas={linhas}
          chave={(c) => c.id}
          nome={(c) => c.nome}
          colunas={[
            {
              titulo: 'Candidato',
              celula: (c) => (
                <NomeComApoio nome={c.nome} apoio={`${c.idade} anos · ${c.bairro}${c.loja && lista.some((x) => x.loja !== c.loja) ? ` · ${c.loja}` : ''}`}>
                  <span className={`block text-xs ${texto2}`}>
                    Recebida {dataBr(diaNoFuso(c.recebidoEm))}
                    {c.origem ? ` · ${nomeDaOrigem(c.origem, c.origemNome)}` : ''}
                  </span>
                </NomeComApoio>
              ),
            },
            {
              titulo: 'Vaga',
              celula: (c) => (
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap gap-1">
                    {c.funcoes.map((fn) => (
                      <Selo key={fn} tom="neutro">
                        {nomeFuncao(fn)}
                      </Selo>
                    ))}
                  </div>
                  <span className={`block text-xs ${texto2}`}>
                    {vagaDoCandidato(c)}
                    {c.estuda && c.turnoEstudo ? ` · estuda (${TURNO_ESTUDO_ROTULO[c.turnoEstudo]?.replace(/^\S+\s/, '')})` : ''}
                  </span>
                </div>
              ),
            },
            { titulo: 'Como chega', celula: (c) => <span className="text-sm">{comoChega(c) || '—'}</span> },
            {
              titulo: 'Experiência',
              celula: (c) => (
                <div className="space-y-1">
                  <span className="text-sm">
                    {c.experiencia === 'primeiro' ? 'Primeiro emprego' : `${c.experiencias} ${c.experiencias === 1 ? 'experiência' : 'experiências'}${c.experiencia === 'sim' ? ' na área' : ''}`}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {c.temCarteira && <Selo tom="ok">Carteira</Selo>}
                    {c.jaLiderou && <Selo tom="info">Liderou</Selo>}
                  </div>
                  <span className={`block text-xs ${texto2}`}>Começa: {COMECA_ROTULO[c.comeca]}</span>
                </div>
              ),
            },
            { titulo: 'Situação', celula: (c) => <Selo tom={TOM_DA_SITUACAO[c.situacao]}>{SITUACAO_ROTULO[c.situacao]}</Selo> },
          ]}
          acoes={() => [
            { rotulo: 'Abrir ficha', icone: FileText, aoClicar: (c) => setAberta(c.id), tom: 'primaria' as const },
            {
              rotulo: 'WhatsApp',
              icone: MessageCircle,
              aoClicar: (c) => {
                const janela = window.open(`https://wa.me/55${c.telefone}`, '_blank', 'noopener,noreferrer');
                if (!janela) toast.error('Permita pop-ups para abrir o WhatsApp.');
              },
            },
          ]}
        />
      )}
      {aberta && (
        <FichaCandidato
          id={aberta}
          nomesDasFuncoes={nomesDasFuncoes}
          aoFechar={() => setAberta(null)}
          aoMudar={carregar}
          aoApagar={() => {
            setAberta(null);
            carregar();
          }}
        />
      )}
    </section>
  );
}
