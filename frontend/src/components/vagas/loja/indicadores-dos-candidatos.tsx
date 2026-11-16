'use client';

import { Indicadores } from '@/components/relatorios/pecas';
import { Button } from '@/components/ui/button';
import { dataBr } from '@/components/ui/lista';
import { brl, type ConducaoDosAprovados } from '@/lib/vagas-ficha';
import { diaNoFuso, type Candidato } from './lista-candidatos';

// Os indicadores do topo de Pessoas › Candidatos (protótipo `mockups/regem-vagas-talentos.html`): quatro contagens da lista
// já carregada (o servidor já filtrou empresa e loja) e a condução dos aprovados (F5b), que vem de uma leitura à parte —
// "não li" mostra o motivo e "Tentar de novo", nunca R$ 0,00 (V37).

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export interface LeituraDaConducao {
  dados: ConducaoDosAprovados | null;
  erro: string;
}

export function IndicadoresDosCandidatos({
  lista,
  conducao,
  aoVerConducao,
  aoTentarConducao,
}: {
  lista: Candidato[];
  conducao: LeituraDaConducao;
  aoVerConducao: () => void;
  aoTentarConducao: () => void;
}) {
  const novas = lista.filter((c) => c.situacao === 'novo');
  const maisRecente = novas.reduce<string | null>((m, c) => (!m || c.recebidoEm > m ? c.recebidoEm : m), null);
  const agora = Date.now();
  const entrevistas = lista
    .filter((c) => c.situacao === 'entrevista' && c.entrevistaEm && new Date(c.entrevistaEm).getTime() >= agora)
    .map((c) => c.entrevistaEm as string)
    .sort();
  const aprovados = lista.filter((c) => c.situacao === 'aprovado').length;
  const banco = lista.filter((c) => c.situacao === 'banco');
  const autorizaram = banco.filter((c) => c.comunicacao).length;
  const { dados, erro } = conducao;

  return (
    <div data-candidatos-indicadores>
      <Indicadores
        itens={[
          { rotulo: 'Fichas novas', valor: novas.length, apoio: maisRecente ? `a mais recente em ${dataBr(diaNoFuso(maisRecente))}` : 'nenhuma esperando' },
          { rotulo: 'Entrevistas marcadas', valor: entrevistas.length, apoio: entrevistas.length ? `a próxima ${quando(entrevistas[0])}` : 'nenhuma à frente' },
          { rotulo: 'Aprovados para contratar', valor: aprovados, apoio: aprovados ? 'esperando o Contratar' : 'nenhum agora' },
          {
            rotulo: 'No banco de talentos',
            valor: banco.length,
            apoio: autorizaram === 0 ? 'ninguém autorizou mensagens' : autorizaram === 1 ? '1 autorizou mensagens' : `${autorizaram} autorizaram mensagens`,
          },
          {
            rotulo: 'Condução dos aprovados',
            largo: true,
            valor: dados ? brl(dados.porMes) : '—',
            apoio: dados
              ? `por mês · informado na ficha${dados.foraDaSoma ? ` · ${dados.foraDaSoma} fora da soma` : ''}`
              : erro
                ? `não deu para ler: ${erro}`
                : 'lendo…',
            acao: dados ? (
              <Button type="button" variant="outline" size="sm" onClick={aoVerConducao}>
                Ver por pessoa
              </Button>
            ) : erro ? (
              <Button type="button" variant="outline" size="sm" onClick={aoTentarConducao}>
                Tentar de novo
              </Button>
            ) : undefined,
          },
        ]}
      />
    </div>
  );
}
