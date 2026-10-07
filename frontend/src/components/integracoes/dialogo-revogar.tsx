'use client';

import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';

// Confirmação de revogar um aplicativo (numa loja ou em todas). O foco abre no "Manter" (a ação
// segura), o Tab fica preso no diálogo, o Esc fecha e o foco volta ao botão que abriu — ou ao
// elemento `voltarPara`, quando a linha (e o botão) saiu da lista.
export function DialogoRevogar({
  app,
  leitura = 'os dados',
  loja,
  revogando,
  aoManter,
  aoRevogar,
  voltarPara,
}: {
  app: string;
  /** O que o aplicativo lê, como a frase diz ("os pedidos", "os dados"). */
  leitura?: string;
  /** Nome da loja; `null` = todas as lojas (ou a empresa inteira). */
  loja: string | null;
  revogando: boolean;
  aoManter: () => void;
  aoRevogar: () => void;
  voltarPara?: string;
}) {
  return (
    <Dialogo
      alerta
      titulo={loja ? `Revogar o ${app} na ${loja}?` : `Revogar o ${app} em todas as lojas?`}
      aoFechar={aoManter}
      voltarPara={voltarPara}
      rodape={
        <>
          <Button type="button" variant="outline" data-foco-inicial onClick={aoManter} disabled={revogando}>
            Manter
          </Button>
          <Button type="button" variant="destructive" onClick={aoRevogar} disabled={revogando}>
            {revogando ? 'Revogando…' : 'Revogar'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-secondary-foreground">
        O {app} para de ler {leitura} {loja ? 'desta loja' : 'de todas as lojas'} agora. O que ele já leu segue o prazo de
        guarda de lá. Para voltar, é preciso autorizar de novo pelo {app}.
      </p>
    </Dialogo>
  );
}
