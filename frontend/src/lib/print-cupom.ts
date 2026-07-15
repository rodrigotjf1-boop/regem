/* eslint-disable @typescript-eslint/no-explicit-any */
// Impressão de cupom pelo NAVEGADOR (escape hatch do modo nuvem / quando o worker
// do edge não está disponível). Renderiza o cupom em HTML com CSS de bobina
// térmica e chama window.print() — funciona com qualquer impressora instalada no
// Windows (inclusive térmica com driver). Não é ESC/POS cru: sai pelo diálogo do
// sistema, sem corte/gaveta automáticos, mas resolve a operação online.
const brl = (n: any) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const esc = (s: any) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export function imprimirCupomNavegador(
  venda: any,
  opts: { largura?: 58 | 80; loja?: string } = {},
) {
  const larguraMm = opts.largura === 58 ? 58 : 80;
  const itens = venda?.itens ?? [];
  const linhas = itens
    .map((it: any) => {
      const sub = Number(it.precoUnitario ?? it.preco ?? 0) * Number(it.quantidade || 1);
      const comps = (it.complementos ?? [])
        .map((cp: any) => (cp.tipo === 'remover' ? `sem ${cp.nome}` : `+ ${cp.nome}`))
        .join(' · ');
      return `
        <div class="it">
          <span>${Number(it.quantidade || 1)}x ${esc(it.descricao ?? it.nome)}</span>
          <span>${brl(sub)}</span>
        </div>
        ${comps ? `<div class="comp">${esc(comps)}</div>` : ''}`;
    })
    .join('');

  const cab = venda?.mesa ? `Mesa ${esc(venda.mesa)}` : 'Balcão';
  const quando = venda?.fechadaEm ? new Date(venda.fechadaEm) : new Date();

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
  <title>Cupom</title>
  <style>
    @page { size: ${larguraMm}mm auto; margin: 0; }
    * { box-sizing: border-box; }
    body { width: ${larguraMm}mm; margin: 0; padding: 4mm 3mm; font-family: 'Courier New', monospace; font-size: 12px; color: #000; }
    h1 { font-size: 15px; text-align: center; margin: 0 0 2px; }
    .sub { text-align: center; font-size: 11px; margin-bottom: 6px; }
    .hr { border-top: 1px dashed #000; margin: 6px 0; }
    .it { display: flex; justify-content: space-between; gap: 6px; }
    .comp { padding-left: 10px; font-size: 11px; }
    .tot { display: flex; justify-content: space-between; font-weight: bold; font-size: 13px; }
    .foot { text-align: center; font-size: 10px; margin-top: 8px; }
  </style></head>
  <body onload="window.print(); setTimeout(function(){ window.close(); }, 300);">
    <h1>${esc(opts.loja || 'REGEM')}</h1>
    <div class="sub">${cab} · ${quando.toLocaleString('pt-BR')}</div>
    <div class="hr"></div>
    ${linhas}
    <div class="hr"></div>
    <div class="tot"><span>TOTAL</span><span>${brl(venda?.total)}</span></div>
    ${venda?.forma ? `<div class="sub" style="margin-top:4px">Pagamento: ${esc(venda.forma)}</div>` : ''}
    <div class="foot">Impresso pelo navegador (modo nuvem)</div>
  </body></html>`;

  const w = window.open('', '_blank', 'width=380,height=640');
  if (!w) {
    alert('O navegador bloqueou a janela de impressão. Libere pop-ups para este site e tente de novo.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
