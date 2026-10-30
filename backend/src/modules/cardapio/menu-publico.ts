/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * O que o cardápio PÚBLICO (quem tem o link ou o QR) recebe do `menu`: tudo, menos a BASE DE CONHECIMENTO e as RESPOSTAS
 * PRONTAS do robô. Elas são da loja para o robô — o robô lê por `publico/bot/loja`, com a senha dele — e podem trazer o
 * que a loja não mostraria ao cliente (combinados internos, regras da casa). A tela do cardápio não usa nenhuma das duas.
 * Não mexe no objeto recebido (o `menu` pode vir de cache).
 */
export function menuParaOPublico<T extends { robo?: any }>(menu: T): T {
  if (!menu || typeof menu !== 'object' || !menu.robo || typeof menu.robo !== 'object') return menu;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { prompt, mensagens, ...publico } = menu.robo;
  return { ...menu, robo: publico };
}
