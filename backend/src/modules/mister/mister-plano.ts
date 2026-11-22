import { ACOES, type AcaoDoMister, ehAcaoDoMister } from './mister-acoes';
import { botoesDaProposta } from './mister-procedimentos';

// VÁRIAS TAREFAS NUM PEDIDO (versão 7, V7c; decisões V7-1, V7-2 e V7-3; protótipo `mockups/regem-mister-v7.html`, "Várias
// tarefas num pedido"). Regras puras: a leitura dos passos, o texto do plano, o que fazer a seguir e o texto do fim.
//
// O plano é uma linha de `mister_proposta` (procedimento `plano`), e cada passo vira a proposta FILHA da ação dele, pela
// MESMA conferência, permissão, execução, auditoria e conferência do efeito de `propor_acao`. Um botão para o plano inteiro;
// o passo de PIN continua pedindo o PIN pelo link. Um passo que falha não desfaz os outros.

export const PROCEDIMENTO_DO_PLANO = 'plano' as const;
export const PREFIXO_DO_PLANO = 'plano:';
export const LIMITES_DO_PLANO = {
  minimo: 2,
  maximo: 5,
  /** Quanto vale a pergunta do plano. */
  prazoMin: 15,
  /** Até quando o "Tentar de novo" vale, depois do fim. */
  tentarDeNovoMin: 30,
  /** O passo que ficou "executando" além disto (o processo caiu no meio) não se repete: vira "não consegui confirmar". */
  passoParadoMin: 5,
  /** A mensagem com botões cabe até aqui (a Meta corta em 1.024). */
  cabeComBotao: 1000,
} as const;
/** O texto gravado no plano que um pedido mais novo trocou: o botão antigo diz isso. */
export const RESULTADO_DO_PLANO_TROCADO = 'trocado por um plano mais novo';

export interface PassoDoPlano {
  n: number;
  acao: AcaoDoMister;
  nivel: 'botao' | 'pin';
  resumo: string;
  /** O que a IA mandou para este passo: a conferência roda de novo sobre isto, na hora de fazer. */
  entrada: Record<string, unknown>;
  /** O alvo que a pessoa viu na pergunta. Se o mesmo nome passar a apontar para outro item, o passo não acontece. */
  alvo: string;
}

export interface ParametrosDoPlano {
  colaboradorId: string;
  nivel: 'presidente' | 'gerente';
  loja: { atual: string | null; nome: string };
  tentativa: number;
  passos: PassoDoPlano[];
  deixado?: boolean;
}

/** Confere a forma da lista: de 2 a 5 passos, cada um com uma ação do catálogo. A conferência de cada ação vem depois. */
export function lerPassos(bruto: unknown): { passos: Record<string, unknown>[] } | { erro: string } {
  if (!Array.isArray(bruto)) return { erro: 'Mande os passos do plano numa lista.' };
  if (bruto.length < LIMITES_DO_PLANO.minimo) return { erro: 'Plano é para duas ou mais ações. Para uma só, use propor_acao.' };
  if (bruto.length > LIMITES_DO_PLANO.maximo) return { erro: `No máximo ${LIMITES_DO_PLANO.maximo} passos por plano. Diga à pessoa quais vão primeiro.` };
  const passos: Record<string, unknown>[] = [];
  for (const [i, p] of bruto.entries()) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { erro: `Passo ${i + 1}: mande a ação com os campos dela.` };
    const passo = p as Record<string, unknown>;
    if (!ehAcaoDoMister(passo.acao)) return { erro: `Passo ${i + 1}: essa ação não existe.` };
    // A imagem tem pergunta e franquia próprias ("Gerar"): não entra no botão do plano.
    if (passo.acao === 'criar_imagem') return { erro: `Passo ${i + 1}: a imagem vai num pedido à parte, com o botão "Gerar". Proponha os outros passos sem ela.` };
    // A loja é uma só para o plano inteiro: um passo não escolhe outra.
    if (passo.loja !== undefined && passo.loja !== null && passo.loja !== '') return { erro: `Passo ${i + 1}: a loja vai no plano, não em cada passo.` };
    passos.push(passo);
  }
  return { passos };
}

const POR_EXTENSO: Record<number, string> = { 1: 'um', 2: 'dois', 3: 'três', 4: 'quatro', 5: 'cinco' };
const extenso = (n: number) => POR_EXTENSO[n] ?? String(n);
const comMaiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** A primeira frase do resumo, para a linha do resultado. */
const frase = (t: string) => {
  const m = /^.*?[.!?](?=\s|$)/.exec(t.trim());
  return (m ? m[0] : t.trim()).replace(/[.!?]$/, '').slice(0, 120);
};

export const TEXTOS_DO_PLANO = {
  autorizado: 'Certo, fazendo na ordem. Aviso aqui quando terminar.',
  mudar: 'Certo, não fiz nada. Me diga o que mudar.',
  trocado: 'Esse plano foi trocado pelo mais novo, que está logo abaixo na conversa. Use os botões dele.',
  semBotao: 'Pela conexão por QR Code não tenho o botão do plano: me peça uma coisa de cada vez.',
  tentando: 'Tentando de novo o que não entrou…',
  deixado: 'Certo, ficou assim. O que entrou continua valendo.',
  tentativaNaoVale: 'Essa tentativa já foi feita ou passou do prazo. Se ainda precisar, me peça de novo.',
  repetido: 'Dois passos fazem a mesma coisa. Junte os dois em um.',
  semAcesso: 'o seu WhatsApp não está mais ligado ao Mister, ou o seu perfil mudou. Nada foi feito neste passo.',
  outraLoja: 'você não tem mais acesso a essa loja. Nada foi feito neste passo.',
  alvoMudou: 'o que este passo apontava mudou depois da pergunta. Nada foi feito: me peça de novo.',
  naoConfirmou: 'não consegui confirmar se entrou. Confira no Regem antes de pedir de novo.',
  pergunta: 'Posso seguir?',
  perguntaDeNovo: 'Tento de novo o que não entrou?',
  perguntaDeNovoEmParte: 'Tento de novo o que é seguro refazer? O que pode já ter entrado eu não repito: confira no Regem.',
  naoRepito: 'O que pode já ter entrado eu não refaço sozinho, para não lançar em dobro. Confira no Regem e, se faltou, me peça de novo.',
} as const;

export const botoesDoPlano = (id: string, passos: number) => botoesDaProposta(id, { autorizar: `Fazer os ${extenso(passos)}`, naoAgora: 'Mudar' });

/** O plano numerado, com o aviso do PIN em cada passo que pede. */
export function textoDoPlano(passos: Pick<PassoDoPlano, 'nivel' | 'resumo'>[]): string {
  const linhas = passos.map((p, i) => `${i + 1}. ${p.resumo}${p.nivel === 'pin' ? ' (pede o seu PIN)' : ''}`);
  return `Vou fazer em ${extenso(passos.length)} passos:\n\n${linhas.join('\n')}`;
}

/** A pergunta com o botão; o plano longo vai em duas mensagens (a de botões tem limite). */
export function mensagensDoPlano(id: string, passos: Pick<PassoDoPlano, 'nivel' | 'resumo'>[]): { texto: string; botoes?: { id: string; titulo: string }[] }[] {
  const plano = textoDoPlano(passos);
  const pergunta = `${TEXTOS_DO_PLANO.pergunta} A pergunta vale por ${LIMITES_DO_PLANO.prazoMin} minutos.`;
  const botoes = botoesDoPlano(id, passos.length);
  const junto = `${plano}\n\n${pergunta}`;
  return junto.length <= LIMITES_DO_PLANO.cabeComBotao ? [{ texto: junto, botoes }] : [{ texto: plano }, { texto: pergunta, botoes }];
}

export const botaoDeTentar = (id: string, tentativa: number) => `${PREFIXO_DO_PLANO}tentar:${id}:${tentativa}`;
export const botaoDeDeixar = (id: string, tentativa: number) => `${PREFIXO_DO_PLANO}deixar:${id}:${tentativa}`;
export function lerBotaoDoPlano(id: unknown): { acao: 'tentar' | 'deixar'; planoId: string; tentativa: number } | null {
  const m = /^plano:(tentar|deixar):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([1-9]\d{0,2})$/i.exec(String(id ?? ''));
  return m ? { acao: m[1].toLowerCase() as 'tentar' | 'deixar', planoId: m[2].toLowerCase(), tentativa: Number(m[3]) } : null;
}

/** Um passo já começado: a proposta filha, na tentativa dela. */
export interface FilhoDoPlano {
  id: string;
  n: number;
  tentativa: number;
  situacao: string;
  resultado: string | null;
  /** Em milissegundos. */
  executadaEm: number | null;
}

export type ProximoDoPlano = { tipo: 'iniciar'; n: number } | { tipo: 'executar'; filhoId: string } | { tipo: 'parado'; filhoId: string } | { tipo: 'esperar' } | { tipo: 'fechar' };

/** Cada execução destas soma um registro novo, e o serviço não tem chave que impeça o segundo. */
const ACOES_QUE_SOMAM: readonly AcaoDoMister[] = ['movimentar_estoque', 'criar_tarefa'];

/**
 * Os passos que o "Tentar de novo" não refaz, porque o efeito pode já ter acontecido: qualquer ação que ficou sem confirmação
 * e as que somam registro, depois de chegarem a executar. O passo recusado na conferência (sem `executadaEm`) não fez nada e
 * pode tentar de novo. As outras ações conferem o estado antes de agir, e repetir não muda o resultado.
 */
export function passosQueNaoSeRefazem(passos: Pick<PassoDoPlano, 'n' | 'acao'>[], filhos: FilhoDoPlano[]): Set<number> {
  const fora = new Set<number>();
  for (const p of passos) {
    const tentou = filhos.filter((f) => f.n === p.n && f.situacao === 'nao_deu' && f.executadaEm !== null);
    if (tentou.length && (ACOES_QUE_SOMAM.includes(p.acao) || tentou.some((f) => f.resultado === TEXTOS_DO_PLANO.naoConfirmou))) fora.add(p.n);
  }
  return fora;
}

/**
 * O que fazer agora, sempre na ordem. Passo feito (em qualquer tentativa) não roda de novo, nem o que pode já ter entrado
 * (`naoRefazer`). O que falhou ao executar não segura os seguintes (V7-3). O PIN que não veio (recusado, vencido ou bloqueado)
 * para o plano ali: a pessoa saiu da conversa ou disse não, e o resto não acontece sozinho minutos depois.
 */
export function proximoDoPlano(total: number, tentativa: number, filhos: FilhoDoPlano[], agora: number, naoRefazer: ReadonlySet<number> = new Set()): ProximoDoPlano {
  for (let n = 1; n <= total; n++) {
    if (filhos.some((f) => f.n === n && f.situacao === 'feita')) continue;
    const f = filhos.find((x) => x.n === n && x.tentativa === tentativa);
    if (!f && naoRefazer.has(n)) continue;
    if (!f) return { tipo: 'iniciar', n };
    if (f.situacao === 'nao_deu') continue;
    if (f.situacao === 'vencida' || f.situacao === 'recusada') return { tipo: 'fechar' };
    if (f.situacao === 'autorizada') return { tipo: 'executar', filhoId: f.id };
    if (f.situacao === 'executando' && f.executadaEm !== null && agora - f.executadaEm > LIMITES_DO_PLANO.passoParadoMin * 60_000) return { tipo: 'parado', filhoId: f.id };
    return { tipo: 'esperar' };
  }
  return { tipo: 'fechar' };
}

export interface DesfechoDoPasso {
  n: number;
  feito: boolean;
  texto: string;
}

/** Como cada passo terminou, somando as tentativas: o feito fica feito. */
export function desfechosDoPlano(passos: Pick<PassoDoPlano, 'n' | 'resumo'>[], filhos: FilhoDoPlano[]): DesfechoDoPasso[] {
  return passos.map((p) => {
    const dele = filhos.filter((f) => f.n === p.n).sort((a, b) => b.tentativa - a.tentativa);
    const feita = dele.find((f) => f.situacao === 'feita');
    if (feita) return { n: p.n, feito: true, texto: comMaiuscula(feita.resultado || frase(p.resumo)) };
    const ultima = dele[0];
    const porque = !ultima
      ? 'não fiz, porque o passo de antes ficou esperando o PIN.'
      : ultima.situacao === 'vencida'
        ? 'o PIN não foi confirmado a tempo. Nada foi feito.'
        : ultima.situacao === 'recusada'
          ? 'não foi autorizado no PIN. Nada foi feito.'
          : ultima.resultado || 'não consegui fazer. Nada foi feito.';
    return { n: p.n, feito: false, texto: `${frase(p.resumo)}: ${porque}` };
  });
}

/** A mensagem do fim: o que entrou, o que não entrou e, se faltou algo, a pergunta de tentar de novo. */
export function textoDoFimDoPlano(d: DesfechoDoPasso[]): { texto: string; faltou: boolean } {
  const feitos = d.filter((x) => x.feito).length;
  const faltam = d.length - feitos;
  const linhas = d.map((x) => `${x.feito ? '✓' : '!'} ${x.texto}`).join('\n');
  if (!faltam) return { texto: `Pronto, fiz os ${extenso(d.length)} e conferi:\n\n${linhas}`, faltou: false };
  const abre = feitos ? `Fiz ${extenso(feitos)}, e ${extenso(faltam)} não ${faltam === 1 ? 'entrou' : 'entraram'}:` : `Nenhum dos ${extenso(d.length)} entrou:`;
  return { texto: `${abre}\n\n${linhas}`, faltou: true };
}

/** Confere no catálogo o nível de cada passo (o que foi gravado no plano não decide sozinho). */
export const nivelDaAcao = (acao: AcaoDoMister): 'botao' | 'pin' => ACOES[acao].nivel;
