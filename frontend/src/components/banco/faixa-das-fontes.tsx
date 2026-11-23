'use client';

import { Selo, texto2 } from '@/components/ui/lista';
import { FONTES_NAO_LIGADAS, diaCurto, type RespostaDoBanco } from '@/lib/banco-repasses';

// A faixa das fontes: o Banco com a situação real e a data do último extrato. As outras dizem que ainda não estão ligadas,
// sem botão: enquanto não existem (R3 e R4), não há o que tocar.
const CARTAO = 'flex min-w-0 flex-col items-start gap-1 rounded-lg border border-border bg-card px-3 py-2.5';

function CartaoDaFonte({ nome, como, children }: { nome: string; como: string; children: React.ReactNode }) {
  return (
    <div className={CARTAO}>
      <span className="font-display text-sm font-bold">{nome}</span>
      <span className={`text-xs ${texto2}`}>{como}</span>
      {children}
    </div>
  );
}

export function FaixaDasFontes({ banco }: { banco: RespostaDoBanco['fontes']['banco'] }) {
  return (
    <div role="group" aria-label="Fontes dos dados" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,178px),1fr))] gap-2">
      <CartaoDaFonte nome="Banco" como="Arquivo do extrato">
        {banco.situacao === 'em_dia' && <Selo tom="ok">Em dia</Selo>}
        {banco.situacao === 'antigo' && <Selo tom="aviso">Extrato antigo</Selo>}
        {banco.situacao === 'nunca' && <Selo tom="aviso">Falta o arquivo</Selo>}
        <span className={`text-xs ${texto2}`}>{banco.lidoAte ? `Lido até ${diaCurto(banco.lidoAte)}` : 'Nunca enviado'}</span>
      </CartaoDaFonte>
      {FONTES_NAO_LIGADAS.map((f) => (
        <CartaoDaFonte key={f.id} nome={f.nome} como={f.como}>
          <Selo tom="neutro">Ainda não ligado</Selo>
          <span className={`text-xs ${texto2}`}>Entra em uma próxima etapa</span>
        </CartaoDaFonte>
      ))}
    </div>
  );
}
