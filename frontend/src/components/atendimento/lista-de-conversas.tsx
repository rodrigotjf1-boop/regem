'use client';

import { Button } from '@/components/ui/button';
import { ChipDoCanal } from '@/components/atendimento/chip-do-canal';
import { idDaConversa, resumoDaConversa, tempoDesde, tituloDaConversa, type ConversaAgora } from '@/lib/atendimento';

// "CONVERSAS AGORA" (ponte do chat — protótipo `mockups/regem-central-atendimento.html` v3): as conversas do chat do iFood
// e da 99 da última hora sem caso aberto — quem está nelas é o robô (ou só os avisos automáticos). Cada uma pelo nome do
// cliente e o número do pedido, com a última fala e quem respondeu. Abrir mostra a conversa e o "Assumir a conversa".

export function ListaDeConversas({
  conversas,
  erro,
  vazioPorFiltro,
  roboResponde,
  comWhatsapp = false,
  erroWhatsapp = false,
  selecionada,
  agora,
  aoAbrir,
  aoLimpar,
}: {
  /** `null` = ainda não houve leitura certa. */
  conversas: ConversaAgora[] | null;
  erro: boolean;
  vazioPorFiltro: boolean;
  roboResponde: boolean;
  /** As conversas do WhatsApp entram (quem atende a caixa do WhatsApp, com o robô dele ligado). */
  comWhatsapp?: boolean;
  /** A leitura do WhatsApp falhou (≠ nenhuma conversa). */
  erroWhatsapp?: boolean;
  selecionada: string | null;
  agora: number | null;
  aoAbrir: (id: string) => void;
  aoLimpar: () => void;
}) {
  if (conversas === null) {
    return erro ? (
      <div className="rounded-lg border border-dashed border-input bg-card px-4 py-8 text-center text-sm" role="status">
        <p className="font-semibold">Não consegui ler as conversas agora.</p>
        <p className="text-secondary-foreground">Tento de novo em instantes.</p>
      </div>
    ) : (
      <p className="px-1 py-6 text-center text-sm text-secondary-foreground">Carregando…</p>
    );
  }
  const avisoDoWhatsapp = erroWhatsapp && (
    <p className="text-xs text-destructive" role="status">
      Não consegui ler as conversas do WhatsApp agora: elas continuam em Delivery › WhatsApp.
    </p>
  );
  if (!conversas.length) {
    return vazioPorFiltro ? (
      <div className="rounded-lg border border-dashed border-input bg-card px-4 py-8 text-center text-sm" role="status">
        <p className="font-semibold">Nenhuma conversa com este filtro.</p>
        <Button type="button" variant="outline" className="mt-3" onClick={aoLimpar}>
          Limpar filtros
        </Button>
      </div>
    ) : (
      <div className="space-y-2">
        {avisoDoWhatsapp}
        <div className="rounded-lg border border-dashed border-input bg-card px-4 py-8 text-center text-sm" role="status">
          <p className="text-2xl" aria-hidden="true">💬</p>
          <p className="font-semibold">Nenhuma conversa sem caso na última hora.</p>
          <p className="text-secondary-foreground">
            {comWhatsapp
              ? 'Quando o robô atender alguém no WhatsApp (ou no chat do iFood e da 99), a conversa aparece aqui e dá para assumir.'
              : roboResponde
                ? 'Quando o robô atender alguém no chat do iFood ou da 99, a conversa aparece aqui e dá para assumir.'
                : 'O robô do chat está desligado: o que o cliente escreve vira caso na fila. Aqui ficam as conversas só com os avisos automáticos.'}
          </p>
        </div>
      </div>
    );
  }
  return (
    <ul className="space-y-2" aria-label="Conversas com o robô">
      {erro && <li className="text-xs text-destructive">Não consegui atualizar agora; mostrando a última leitura.</li>}
      {erroWhatsapp && <li>{avisoDoWhatsapp}</li>}
      {conversas.map((c) => {
        const id = idDaConversa(c);
        const atual = selecionada === id;
        const comRobo = c.comRobo ?? roboResponde;
        return (
          <li key={id}>
            <button
              type="button"
              aria-current={atual ? 'true' : undefined}
              onClick={() => aoAbrir(id)}
              className={`block w-full rounded-lg border border-border bg-card p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                atual ? 'shadow-[inset_4px_0_0_hsl(var(--primary))] ring-1 ring-primary' : 'hover:border-secondary-foreground'
              }`}
            >
              <span className="flex flex-wrap items-center gap-1.5">
                <ChipDoCanal canal={c.canal} />
                {comRobo && <span className="rounded-full bg-info/15 px-2 py-0.5 text-xs font-bold text-foreground">🤖 Com o robô</span>}
              </span>
              <span className="mt-1 block break-words font-bold">{tituloDaConversa(c)}</span>
              <span className="mt-0.5 line-clamp-2 block break-words text-sm text-secondary-foreground">{resumoDaConversa(c)}</span>
              <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-secondary-foreground">
                <span>{comRobo ? 'o robô está atendendo' : 'sem caso aberto'}</span>
                {agora && <span>última mensagem há {tempoDesde(c.ultima, agora)}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
