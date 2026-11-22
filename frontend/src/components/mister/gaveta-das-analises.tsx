'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { texto2 } from '@/components/ui/lista';
import { Gaveta } from '@/components/ui/sobreposto';

// "ANÁLISES MAIS PROFUNDAS" (versão 7, V7e, decisão V7-7; protótipo `mockups/regem-mister-v7.html`, gaveta do ajuste): o que o
// ajuste faz, o que não muda e a conta do mês. Os preços são os da tabela do servidor (`PRECOS_POR_MILHAO`) sobre o tamanho real
// das instruções: o modelo maior custa bem mais na primeira análise, quando grava o cache (US$ 0,06 a 0,08), e cerca de US$ 0,01
// nas seguintes, dentro de 5 minutos. O teto da conta é o caso caro: uma análise de cada vez, sempre com o cache frio.

export const PRECO_DAS_ANALISES = 'De cerca de US$ 0,001 para cerca de US$ 0,01 a US$ 0,08 por análise';
const POR_PERGUNTA_HOJE = 0.001;
const POR_PERGUNTA_ATE = 0.08;
const PERGUNTAS_POR_DIA = [3, 10, 30];
const usd = (n: number) => `US$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function GavetaDasAnalises({ aoFechar }: { aoFechar: () => void }) {
  const idDaConta = useId();
  const [porDia, setPorDia] = useState(10);
  return (
    <Gaveta
      titulo="Análises mais profundas"
      aoFechar={aoFechar}
      rodape={
        <Button type="button" variant="outline" onClick={aoFechar}>
          Fechar
        </Button>
      }
    >
      <h3 className="text-sm font-bold">O que faz</h3>
      <p className={`mt-1 text-sm ${texto2}`}>
        Nas perguntas de análise (semana, pico, fases do mês, perdas e indicadores financeiros), o Mister busca os números como sempre e usa um modelo maior só para escrever a resposta.
        Pergunta simples continua no modelo de hoje.
      </p>
      <h3 className="mt-4 text-sm font-bold">O que não muda</h3>
      <ul className={`mt-1 list-disc space-y-1 pl-5 text-sm ${texto2}`}>
        <li>Os números continuam vindo das consultas.</li>
        <li>A sugestão continua separada do fato.</li>
        <li>Nada é aplicado sem o seu toque.</li>
      </ul>
      <div className="mt-4">
        <label htmlFor={idDaConta} className="text-sm font-bold">
          Quantas perguntas de análise por dia
        </label>
        <select
          id={idDaConta}
          className="mt-1 block min-h-10 w-full max-w-full rounded-md border border-input bg-background px-2 text-sm"
          value={porDia}
          onChange={(e) => setPorDia(Number(e.target.value))}
        >
          {PERGUNTAS_POR_DIA.map((n) => (
            <option key={n} value={n}>
              {n} perguntas
            </option>
          ))}
        </select>
        <p className={`mt-1 text-xs ${texto2}`}>Conta de 30 dias. O teto supõe que cada análise chega sozinha, com mais de 5 minutos entre uma e outra.</p>
      </div>
      <p role="status" className="mt-3 rounded-lg border border-border p-3 text-sm">
        Estimativa: de cerca de <b>{usd(porDia * 30 * POR_PERGUNTA_HOJE)}</b> para até <b>{usd(porDia * 30 * POR_PERGUNTA_ATE)}</b> por mês, na chave de IA da empresa.
      </p>
    </Gaveta>
  );
}
