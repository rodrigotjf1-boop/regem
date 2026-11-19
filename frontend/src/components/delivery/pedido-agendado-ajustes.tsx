'use client';

// O GRUPO "PEDIDO AGENDADO" de Delivery › Configurações › Cardápio digital › Encomenda (mig 455, D4 — protótipo
// `regem-atendente-alergenos-agendado.html`, parte 2, "Ajustes"; G10: 45 min, hoje e amanhã, 4 por janela, janela de 15 min).
// Nasce desligado. Os ajustes da encomenda, na mesma tela, continuam como estão (G1): uma loja pode usar os dois.

const ANTECEDENCIAS = [
  { v: 30, t: '30 min' },
  { v: 45, t: '45 min' },
  { v: 60, t: '1 hora' },
  { v: 90, t: '1 h 30' },
  { v: 120, t: '2 horas' },
];
const DIAS = [
  { v: 0, t: 'Só para hoje' },
  { v: 1, t: 'Hoje e amanhã' },
  { v: 2, t: 'Até 2 dias à frente' },
  { v: 3, t: 'Até 3 dias à frente' },
  { v: 7, t: 'Até 7 dias à frente' },
];
const LIMITES = [
  { v: '2', t: '2 pedidos' },
  { v: '3', t: '3 pedidos' },
  { v: '4', t: '4 pedidos' },
  { v: '6', t: '6 pedidos' },
  { v: '8', t: '8 pedidos' },
  { v: '', t: 'Sem limite' },
];

const sel = 'flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm';

export function PedidoAgendadoAjustes({ loja, up, pode }: { loja: any; up: (patch: any) => void; pode: boolean }) {
  const ligado = loja?.agendadoAtivo === true;
  const limite = loja?.agendadoLimiteJanela == null ? '' : String(loja.agendadoLimiteJanela);
  const entrega = Number(loja?.tempoEntregaMin) || 40;
  const retirada = Number(loja?.tempoRetiradaMin) || 20;
  return (
    <section className="mb-4 space-y-3 rounded-lg border border-border p-3" aria-labelledby="agendado-titulo">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="agendado-titulo" className="text-sm font-bold">Pedido agendado</h3>
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold">NOVO</span>
        <span className="text-xs text-muted-foreground">4 ajustes</span>
      </div>
      <label htmlFor="agendado-ativo" className="flex items-start gap-2 text-sm">
        <input id="agendado-ativo" type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" disabled={!pode} checked={ligado} onChange={(e) => up({ agendadoAtivo: e.target.checked })} />
        <span>
          <b>Aceitar pedido agendado</b>
          <span className="block text-xs text-muted-foreground">
            O cliente escolhe o dia e a janela de 15 min no cardápio online. Com a loja fechada, o cardápio já abre em
            &quot;Agendar&quot;. Com o Pix no cardápio, o agendado é pago no Pix na hora.
          </span>
        </span>
      </label>
      <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${ligado ? '' : 'opacity-60'}`}>
        <div className="space-y-1">
          <label htmlFor="agendado-antecedencia" className="text-sm font-medium">Antecedência mínima</label>
          <select id="agendado-antecedencia" className={sel} disabled={!pode || !ligado} value={String(loja?.agendadoAntecedenciaMin ?? 45)} onChange={(e) => up({ agendadoAntecedenciaMin: Number(e.target.value) })}>
            {ANTECEDENCIAS.map((o) => (
              <option key={o.v} value={o.v}>{o.t}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">Quanto tempo antes do horário o pedido precisa ser feito, com a loja aberta.</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="agendado-dias" className="text-sm font-medium">Até quantos dias à frente</label>
          <select id="agendado-dias" className={sel} disabled={!pode || !ligado} value={String(loja?.agendadoDias ?? 1)} onChange={(e) => up({ agendadoDias: Number(e.target.value) })}>
            {DIAS.map((o) => (
              <option key={o.v} value={o.v}>{o.t}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">Até que dia o cliente consegue marcar.</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="agendado-limite" className="text-sm font-medium">Limite de pedidos por janela</label>
          <select id="agendado-limite" className={sel} disabled={!pode || !ligado} value={limite} onChange={(e) => up({ agendadoLimiteJanela: e.target.value === '' ? null : Number(e.target.value) })}>
            {LIMITES.map((o) => (
              <option key={o.t} value={o.v}>{o.t}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">Quantos pedidos agendados cabem em cada janela de 15 min. A janela cheia aparece &quot;esgotada&quot;.</p>
        </div>
        <div className="space-y-1 text-sm">
          <p className="font-medium">Tamanho da janela</p>
          <p>15 min <span className="text-xs text-muted-foreground">(fixo nesta versão)</span></p>
          <p className="pt-1 font-medium">Quando o pedido entra em preparo</p>
          <p>
            {entrega} min antes (entrega) · {retirada} min antes (retirada)
          </p>
          <p className="text-xs text-muted-foreground">É o tempo de entrega e o de retirada da loja (Cardápio digital › Cardápio).</p>
        </div>
      </div>
    </section>
  );
}
