// "Mostrar num KDS" do Mapa ao vivo (cozinha em estações, entrega 5; mockup `mockups/regem-kds-estacoes.html`, aba 6):
// as telas de KDS que o painel mandou trocar os pedidos pelo mapa dos entregadores. Os textos ficam aqui, num lugar só.

/** Uma tela de KDS da loja, como `GET /delivery/entregadores-ao-vivo/telas-kds` devolve. */
export type TelaKdsDoMapa = { id: string; nome: string; escopo: string; setor: string | null; mapa: boolean };
/** `ligado` = a chave da loja (Delivery › ⚙): desligada, o KDS marcado mostra os pedidos até o gestor ligar. */
export type MapaNosKds = { ligado: boolean; telas: TelaKdsDoMapa[] };

/** Onde se liga o mapa no KDS — a mesma frase no aviso da faixa e do diálogo. */
export const ONDE_LIGA = 'Delivery › ⚙ Configurações do delivery › “Mostrar o mapa dos entregadores no KDS”';

/** "A", "A e B", "A, B e C". */
export function juntarNomes(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? '';
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

/** O papel da tela na cozinha, para a lista do diálogo. */
export function papelDaTela(t: Pick<TelaKdsDoMapa, 'escopo' | 'setor'>): string {
  const papel =
    t.escopo === 'despacho' ? 'Despacho' : t.escopo === 'entrega' ? 'Entrega (só senhas)' : t.escopo === 'avisos' ? 'Avisos' : 'Estação';
  return t.setor ? `${papel} · ${t.setor}` : papel;
}

/** "do KDS Expedição", mas "do KDS Cozinha" para a tela que já se chama "KDS Cozinha" (sem "do KDS KDS Cozinha"). */
export function doKds(nome: string): string {
  return /^kds\b/i.test(nome.trim()) ? `do ${nome}` : `do KDS ${nome}`;
}

/** A faixa do Mapa ao vivo: em quais KDS o mapa está. Vazio = nenhum. */
export function textoDaFaixa(nomes: string[]): string {
  if (!nomes.length) return '';
  return nomes.length === 1 ? `O mapa está na tela ${doKds(nomes[0])}.` : `O mapa está em ${nomes.length} KDS: ${juntarNomes(nomes)}.`;
}

/** O aviso depois de gravar: quem passou a mostrar o mapa e quem voltou aos pedidos. */
export function textoDoAviso(entraram: string[], sairam: string[], ligado: boolean): string {
  const partes: string[] = [];
  if (entraram.length) partes.push(`${juntarNomes(entraram)} ${entraram.length > 1 ? 'passaram' : 'passou'} a mostrar o mapa`);
  if (sairam.length) partes.push(`${juntarNomes(sairam)} ${sairam.length > 1 ? 'voltaram' : 'voltou'} aos pedidos`);
  if (!partes.length) return 'Nada mudou.';
  const espera = entraram.length && !ligado ? ' (aparece quando o mapa no KDS for ligado)' : '';
  return `${partes.join('; ')}${espera}.`;
}
