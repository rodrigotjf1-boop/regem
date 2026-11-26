import type { ResultadoDaFerramenta } from './mister-ferramentas.service';

// QUANDO NÃO DÁ: O MOTIVO E OS CAMINHOS (Mister, versão 10, fase C6 — decisão V10-6; protótipo `mockups/regem-mister-v10.html`,
// "Quando não dá: o motivo e os caminhos"; `docs/plano-mister.md` § "C6"). Em vez de "ainda não tenho acesso", a recusa volta
// à IA com o MOTIVO (um de seis, fixo) e os CAMINHOS que o Regem conhece. A IA diz o porquê em uma frase e oferece só os
// caminhos que vieram — nunca inventa um.

export const MOTIVOS_DA_RECUSA = ['perfil', 'seguranca', 'so_na_tela', 'falta_dado', 'nao_tem', 'de_fora'] as const;
export type MotivoDaRecusa = (typeof MOTIVOS_DA_RECUSA)[number];

/** O porquê, como a IA diz (a frase dela é livre; esta é a referência). */
export const PORQUE_DA_RECUSA: Record<MotivoDaRecusa, string> = {
  perfil: 'o perfil desta pessoa no Regem não faz isso',
  seguranca: 'por segurança, isso não sai pela conversa agora',
  so_na_tela: 'isso só se faz na tela do Regem',
  falta_dado: 'falta um dado no Regem para isso',
  nao_tem: 'o Regem ainda não tem isso',
  de_fora: 'depende de fora do Regem (o WhatsApp, o canal, o banco ou a SEFAZ)',
};

export interface MotivoDaFerramenta {
  motivo: MotivoDaRecusa;
  /** Os caminhos, na ordem em que a IA deve oferecer (até 4). */
  caminhos: readonly string[];
  /** Quem pode fazer, quando o motivo é o perfil. */
  quemPode?: string;
}

/** O caminho do menu de quem muda o perfil (conferido no `shell.tsx`, V65: Configurações › Acessos & perfis). */
export const CAMINHO_DO_PERFIL = 'o presidente muda o perfil em Configurações › Acessos & perfis';

/** O perfil não faz: quem pode e onde se muda o perfil. */
export const motivoDoPerfil = (quemPode: string): MotivoDaFerramenta => ({
  motivo: 'perfil',
  quemPode,
  caminhos: [`quem pode fazer: ${quemPode}`, CAMINHO_DO_PERFIL],
});

/** A sessão com o PIN vencida: o link do PIN vai depois da resposta, e então se pede de novo. */
export const MOTIVO_DO_PIN: MotivoDaFerramenta = {
  motivo: 'seguranca',
  caminhos: ['confirmar o PIN pelo link que vai logo depois desta resposta', 'depois do PIN, pedir de novo'],
};

/** A tela com dado de pessoa (cliente, conversa, candidato): o dado fica só no Regem. */
export const MOTIVO_DO_DADO_DE_PESSOA: MotivoDaFerramenta = {
  motivo: 'seguranca',
  caminhos: ['abrir a tela no Regem: dado de cliente, de conversa ou de contato não sai pela conversa'],
};

/** O que só se faz na tela. */
export const MOTIVO_SO_NA_TELA: MotivoDaFerramenta = {
  motivo: 'so_na_tela',
  caminhos: ['fazer pela tela do Regem (o link vai com abrir_no_regem, quando ele estiver entre as ferramentas)'],
};

/** A conexão por QR Code (Evolution) não tem botão: a ação de botão fica para a tela. */
export const MOTIVO_DO_QR: MotivoDaFerramenta = {
  motivo: 'de_fora',
  caminhos: ['fazer pela tela do Regem: pela conexão por QR Code o WhatsApp não tem o botão de autorizar'],
};

/** O Regem não tem: o mais parecido e o pedido anotado para a DMS. */
export const MOTIVO_NAO_TEM: MotivoDaFerramenta = {
  motivo: 'nao_tem',
  caminhos: ['o mais parecido que o Regem tem hoje, se houver', 'o pedido anotado para a DMS (chame anotar_o_que_falta)'],
};

/** O que a anotação do que falta manda a IA dizer (a avaliação usa o MESMO texto). */
export const SIGA_DO_QUE_FALTA =
  'Responda agora: diga POR QUE não dá em uma frase — o Regem ainda não tem esse dado ou essa função —, ofereça o mais parecido que você consegue hoje, se houver (nunca invente), e diga que anotou o pedido para a DMS.';

/** A recusa com o motivo e os caminhos, no formato que volta à IA. */
export function comMotivo(erro: string, m: MotivoDaFerramenta): ResultadoDaFerramenta {
  return {
    ok: false,
    dados: {
      erro,
      motivo: m.motivo,
      porQue: PORQUE_DA_RECUSA[m.motivo],
      caminhos: m.caminhos.slice(0, 4),
      ...(m.quemPode ? { quemPode: m.quemPode } : {}),
    },
  };
}
