'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O RESULTADO DE VERDADE DA CAMPANHA (F7 parte 3 do docs/plano-perfil-cliente.md, §6.3; mig 465): quem recebeu × o grupo de
// controle (os ~10% fixos que não recebem), na taxa de quem pediu em até 7 dias. A diferença em pontos é o efeito da
// campanha — o "pediu depois da mensagem" de sempre dá crédito também a quem pediria de qualquer jeito.

const pct = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

export function ResultadoDoControle({ controle }: { controle: any }) {
  if (!controle) return null;
  const r = controle.recebeu;
  const c = controle.controle;
  const dif = r?.taxa != null && c?.taxa != null ? Math.round((r.taxa - c.taxa) * 10) / 10 : null;
  return (
    <div className="rounded-lg border border-border p-2 text-xs">
      <p className="mb-1 font-semibold text-foreground">Grupo de controle · pediram em até 7 dias</p>
      <div className="grid grid-cols-1 gap-1 text-foreground/70 sm:grid-cols-3">
        <span>
          Quem recebeu: <strong className="text-foreground">{pct(r?.taxa)}</strong> ({r?.pediram} de {r?.base})
        </span>
        <span>
          Controle: <strong className="text-foreground">{pct(c?.taxa)}</strong> ({c?.pediram} de {c?.base})
        </span>
        <span>
          Efeito da campanha:{' '}
          <strong className="text-foreground">{dif == null ? '—' : `${dif > 0 ? '+' : ''}${dif.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} pontos`}</strong>
        </span>
      </div>
      {controle.pouco && (
        <p className="mt-1 text-foreground/60">
          Controle pequeno (menos de 100 clientes): o número ainda varia muito — olhe várias campanhas juntas.
        </p>
      )}
    </div>
  );
}
