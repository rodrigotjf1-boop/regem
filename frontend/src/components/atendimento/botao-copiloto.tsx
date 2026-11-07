'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { texto2 } from '@/components/ui/lista';

// O COPILOTO DO ATENDIMENTO (mig 376; protótipo `mockups/regem-central-atendimento.html`, versão 5): o botão "✨ Sugerir
// resposta" do caso. Pede ao servidor uma sugestão feita com a conversa que a tela mostra, o pedido e as respostas
// prontas, e a põe na caixa de escrever — NUNCA envia: quem envia é a pessoa, pelo botão de sempre. Só aparece com o
// copiloto ligado na empresa E disponível na distribuição (a chave do modelo fica com a Regem).

export type MensagemParaSugestao = { de: 'cliente' | 'loja' | 'robo' | 'sistema'; texto: string };
type Estado = { ligado: boolean; disponivel: boolean };

// O estado é lido uma vez por tela aberta (todos os casos usam o mesmo); de novo a cada 5 min.
let lido: { em: number; estado: Promise<Estado> } | null = null;
function estadoDoCopiloto(): Promise<Estado> {
  if (!lido || Date.now() - lido.em > 5 * 60_000) {
    lido = { em: Date.now(), estado: api.atendimentoCopiloto().catch(() => ({ ligado: false, disponivel: false })) as Promise<Estado> };
  }
  return lido.estado;
}

export function BotaoCopiloto({
  casoId,
  mensagens,
  prontas,
  aoSugerir,
}: {
  casoId: string;
  mensagens: MensagemParaSugestao[];
  prontas: string[];
  /** Põe a sugestão na caixa de escrever (a pessoa confere, muda e envia). */
  aoSugerir: (texto: string) => void;
}) {
  const [ativo, setAtivo] = useState(false);
  const [pedindo, setPedindo] = useState(false);
  const [jaSugeriu, setJaSugeriu] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    void estadoDoCopiloto().then((e) => vivo && setAtivo(e.ligado && e.disponivel));
    return () => {
      vivo = false;
    };
  }, []);

  // Trocou de caso: a nota e o erro do caso anterior saem.
  useEffect(() => {
    setJaSugeriu(false);
    setErro('');
  }, [casoId]);

  if (!ativo) return null;
  const temDoCliente = mensagens.some((m) => m.de === 'cliente' && m.texto.trim());

  async function pedir() {
    if (pedindo) return;
    setPedindo(true);
    setErro('');
    try {
      const r: { texto: string } = await api.atendimentoSugerir(casoId, { mensagens: mensagens.slice(-30), prontas });
      aoSugerir(r.texto);
      setJaSugeriu(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'O copiloto não respondeu agora. Tente de novo.');
    } finally {
      setPedindo(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button type="button" size="sm" variant="outline" disabled={pedindo || !temDoCliente} onClick={() => void pedir()}>
        {pedindo ? 'Escrevendo a sugestão…' : jaSugeriu ? '✨ Outra sugestão' : '✨ Sugerir resposta'}
      </Button>
      {jaSugeriu && !erro && <span className={`text-xs ${texto2}`}>Sugestão do copiloto: confira e mude o que quiser antes de enviar.</span>}
      {!temDoCliente && <span className={`text-xs ${texto2}`}>O copiloto sugere quando houver mensagem do cliente.</span>}
      {erro && (
        <span role="alert" className="text-xs font-semibold text-destructive">
          {erro}
        </span>
      )}
    </div>
  );
}
