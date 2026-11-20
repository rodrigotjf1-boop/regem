import { BadRequestException } from '@nestjs/common';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS ESCOLHAS DO CLIENTE SOBRE OS PRÓPRIOS DADOS E O QUE ELE CONTA (F1c do docs/plano-perfil-cliente.md, §3.6, D11, D14,
// D15). Regras puras (testáveis sem banco):
//  • cada escolha é um "sim" CLICADO — o servidor nunca grava um valor que não veio (caixa desmarcada = nada a gravar);
//  • EXCEÇÃO (D16, decisão do dono em 20/11/2026): "Recomendações do meu jeito" não é consentimento — é LEGÍTIMO INTERESSE
//    (LGPD art. 7º, IX e art. 10): a loja usa o que o próprio cliente vê no cardápio dela para sugerir produtos dela. Vale
//    LIGADA para quem nunca mexeu (`PADRAO_DA_ESCOLHA`), com o aviso na entrada e a chave no Perfil para desligar (oposição,
//    art. 18 §2º); desligar devolve os cliques ao anônimo na hora. As outras escolhas continuam "sim" clicado;
//  • o texto mostrado ao cliente é o DESTE arquivo, versionado — é ele que vai para o histórico (LGPD art. 8º §2º);
//  • alergia é dado de saúde (art. 11): só se guarda com `guardarAlergia: true` na mesma chamada;
//  • "gostaria de encontrar": as opções de DIETA (sem lactose, sem glúten, vegano) não vão para o perfil da pessoa (D14 —
//    podem revelar saúde); a contagem somada da loja vem numa fase seguinte.

export const VERSAO_DOS_TEXTOS = '2026-11-20';

export const TEXTO_DA_ESCOLHA: Record<string, string> = {
  recomendacoes: 'Recomendações do meu jeito — a loja usa o que eu vejo no cardápio dela para sugerir o que combina comigo. Vem ligada; desligo quando quiser.',
  atendimento_personalizado: 'Lembrar como prefiro ser atendido, aprendendo pelas nossas conversas (respostas curtas, áudio ou emoji).',
  nao_analisar: 'Não quero ser analisado: apagar o meu perfil e usar só o pedido em curso.',
  maior_de_18: 'Tenho 18 anos ou mais.',
};

export const ESCOLHAS = Object.keys(TEXTO_DA_ESCOLHA);

/** O valor de quem nunca mexeu na escolha. Só "recomendacoes" vale ligada (legítimo interesse — D16); o resto, desligado. */
export const PADRAO_DA_ESCOLHA: Record<string, boolean> = { recomendacoes: true };

/** O aviso mostrado na entrada do cardápio (não é caixa: a base é o legítimo interesse — D16). */
export const AVISO_DAS_RECOMENDACOES =
  'Recomendações do seu jeito: a loja usa o que você vê no cardápio dela para sugerir o que combina com você. Você desliga quando quiser no Perfil ou mandando PRIVACIDADE no WhatsApp.';
export const ORIGENS = ['cardapio_entrada', 'cardapio_perfil', 'cardapio_pedido'] as const;
const DIETA = /\b(sem lactose|sem gl[uú]ten|vegan[oa]?|vegetarian[oa]?|zero a[cç][uú]car|diet)\b/i;

const texto = (v: any, max: number, campo: string): string | null => {
  if (v === null) return null;
  if (typeof v !== 'string') throw new BadRequestException(`${campo} inválido.`);
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length > max) throw new BadRequestException(`${campo}: até ${max} letras.`);
  return t;
};
const booleano = (v: any, campo: string): boolean | null => {
  if (v === null) return null;
  if (typeof v !== 'boolean') throw new BadRequestException(`${campo} precisa ser verdadeiro ou falso.`);
  return v;
};

export type Pedido = {
  origem: (typeof ORIGENS)[number];
  escolhas: { escolha: string; valor: boolean }[];
  /** chave → valor (jsonb) a gravar; `null` = apagar a chave. */
  declarado: { chave: string; valor: any }[];
};

/** Lê e confere o corpo da chamada. Só entra o que veio; nada vira "sim" por omissão (D15). */
export function lerPedidoDePrivacidade(dto: any): Pedido {
  const origem = dto?.origem ?? 'cardapio_perfil';
  if (!(ORIGENS as readonly string[]).includes(origem)) throw new BadRequestException('Origem inválida.');
  const escolhas: Pedido['escolhas'] = [];
  for (const [k, v] of Object.entries(dto?.escolhas ?? {})) {
    if (!ESCOLHAS.includes(k)) throw new BadRequestException(`Escolha desconhecida: ${k}.`);
    if (typeof v !== 'boolean') throw new BadRequestException(`A escolha ${k} precisa ser verdadeiro ou falso.`);
    escolhas.push({ escolha: k, valor: v });
  }
  const d = dto?.declarado ?? {};
  const declarado: Pedido['declarado'] = [];
  const por = (chave: string, valor: any) => {
    if (valor !== undefined) declarado.push({ chave, valor });
  };
  if ('time' in d) por('time', texto(d.time, 40, 'Time'));
  if ('apelido' in d) por('apelido', texto(d.apelido, 30, 'Como gosta de ser chamado'));
  if ('nao_gosta' in d) por('nao_gosta', texto(d.nao_gosta, 80, 'Não gosta de'));
  if ('respostas_curtas' in d) por('respostas_curtas', booleano(d.respostas_curtas, 'Respostas curtas'));
  if ('prefere_audio' in d) por('prefere_audio', booleano(d.prefere_audio, 'Prefere áudio'));
  if ('gostaria' in d) {
    if (d.gostaria === null) por('gostaria', null);
    else {
      if (!Array.isArray(d.gostaria) || d.gostaria.length > 8) throw new BadRequestException('"Gostaria de encontrar": até 8 opções.');
      const itens = d.gostaria
        .map((x: any, i: number) => texto(x, 40, `Opção ${i + 1}`))
        .filter((x: string | null): x is string => !!x && !DIETA.test(x));
      por('gostaria', itens.length ? Array.from(new Set(itens)) : null);
    }
  }
  if ('alergia' in d) {
    const a = texto(d.alergia, 80, 'Alergia');
    if (a !== null && dto?.guardarAlergia !== true)
      throw new BadRequestException('Para guardar a alergia, o cliente precisa pedir (guardarAlergia).');
    por('alergia', a);
  }
  if (!escolhas.length && !declarado.length) throw new BadRequestException('Nada para salvar.');
  return { origem, escolhas, declarado };
}
