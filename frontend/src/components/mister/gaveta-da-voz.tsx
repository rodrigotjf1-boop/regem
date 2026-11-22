'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { texto2 } from '@/components/ui/lista';
import { Gaveta } from '@/components/ui/sobreposto';

// "VOZ COM EMOÇÃO" (versão 7, V7d, decisões V7-4 a V7-6; protótipo `mockups/regem-mister-v7.html`, gaveta do ajuste): o que faz, o
// que nunca faz e a conta do mês. O preço é o da tabela do Google para o Gemini 3.8 Flash-Lite TTS, conferida em 22/11/2026: US$ 6
// por milhão de tokens de áudio até 31/12/2026 e US$ 12 a partir de 01/01/2027, com 25 tokens por segundo. O protótipo dizia
// US$ 0,01 a cada 40 s e "na chave de IA da empresa": a voz passa pelo DMS Graph e conta na franquia de fotos e áudios.

const POR_SEGUNDO_ATE_2026 = (6 / 1_000_000) * 25;
const POR_SEGUNDO_EM_2027 = (12 / 1_000_000) * 25;
const SEGUNDOS_POR_AUDIO = 30;
const AUDIOS_POR_DIA = [5, 15, 30];

export const PRECO_DA_VOZ = 'Cerca de US$ 0,006 a cada 40 s de áudio (US$ 0,012 a partir de 01/01/2027)';
const usd = (n: number) => `US$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function GavetaDaVoz({ aoFechar, ligada }: { aoFechar: () => void; ligada: boolean }) {
  const idDaConta = useId();
  const [porDia, setPorDia] = useState(15);
  const segundosNoMes = porDia * 30 * SEGUNDOS_POR_AUDIO;
  return (
    <Gaveta
      titulo="Voz com emoção"
      aoFechar={aoFechar}
      rodape={
        <Button type="button" variant="outline" onClick={aoFechar}>
          Fechar
        </Button>
      }
    >
      <p className={`text-sm ${texto2}`}>{ligada ? 'Ligada' : 'Desligada'}</p>
      <h3 className="mt-3 text-sm font-bold">O que faz</h3>
      <p className={`mt-1 text-sm ${texto2}`}>Quando a pessoa manda áudio, o Mister percebe o tom e responde no mesmo clima. O texto continua indo junto, com os mesmos números.</p>
      <h3 className="mt-4 text-sm font-bold">O que ele nunca faz</h3>
      <ul className={`mt-1 list-disc space-y-1 pl-5 text-sm ${texto2}`}>
        <li>Rir de prejuízo, reclamação, cliente ou funcionário.</li>
        <li>Guardar o tom de quem falou.</li>
        <li>Falar um valor diferente do texto.</li>
      </ul>
      <div className="mt-4">
        <label htmlFor={idDaConta} className="text-sm font-bold">
          Quantos áudios por dia
        </label>
        <select
          id={idDaConta}
          className="mt-1 block min-h-10 w-full max-w-full rounded-md border border-input bg-background px-2 text-sm"
          value={porDia}
          onChange={(e) => setPorDia(Number(e.target.value))}
        >
          {AUDIOS_POR_DIA.map((n) => (
            <option key={n} value={n}>
              {n} áudios
            </option>
          ))}
        </select>
        <p className={`mt-1 text-xs ${texto2}`}>Conta feita com {SEGUNDOS_POR_AUDIO} segundos por áudio e 30 dias.</p>
      </div>
      <p role="status" className="mt-3 rounded-lg border border-border p-3 text-sm">
        Estimativa no preço do Google: cerca de <b className="whitespace-nowrap">{usd(segundosNoMes * POR_SEGUNDO_ATE_2026)}</b> por mês até 31/12/2026 e{' '}
        <b className="whitespace-nowrap">{usd(segundosNoMes * POR_SEGUNDO_EM_2027)}</b> a partir de 01/01/2027.
      </p>
      <p className={`mt-2 text-xs ${texto2}`}>Não gasta a chave de IA da empresa: a voz sai pelo DMS Graph, e cada resposta em áudio conta uma na franquia de fotos e áudios, como hoje.</p>
      <p className="mt-3 rounded-lg bg-warn/15 p-3 text-sm">A voz nova e a risada ainda não foram testadas em português. Se a voz nova falhar, a resposta sai na voz de hoje.</p>
      <p className={`mt-3 text-xs ${texto2}`}>Precisa de &quot;Responder em áudio&quot; ligado em Mister › Avisos e relatórios.</p>
    </Gaveta>
  );
}
