/* eslint-disable @typescript-eslint/no-explicit-any */

// Ações de auditoria do KDS: o rótulo e o resumo legível de cada uma. Usado no "Histórico" da
// tela do KDS e na tela de Auditoria.

export const ACOES_KDS: Record<string, string> = {
  limpou_fila_kds: 'Finalizou todos os pedidos da tela',
  cancelou_pedido_producao: 'Cancelou pedido em produção',
  alterou_etapas_kds: 'Alterou etapas e cores do KDS',
  alterou_periodo_senha: 'Alterou o período da senha',
  alterou_destinos_producao: 'Alterou os destinos de produção',
  criou_alerta_kds: 'Criou alerta do KDS',
  editou_alerta_kds: 'Editou alerta do KDS',
  excluiu_alerta_kds: 'Excluiu alerta do KDS',
  disparou_alerta_kds: 'Disparou alerta no KDS',
  configurou_produtos_kds: 'Escolheu os produtos do KDS',
  configurou_fluxo_kds: 'Mudou o lugar do KDS no fluxo',
  forcou_despacho_kds: 'Liberou pedido no despacho sem todas as estações',
  mostrou_mapa_nos_kds: 'Mandou o mapa dos entregadores para os KDS',
  // Onda 2 da auditoria do KDS: os avisos de cada tela (mig 408) e a Rota da cozinha (mig 410).
  configurou_avisos_kds: 'Mudou os avisos que o KDS recebe',
  configurou_rota_kds: 'Mudou a Rota da cozinha',
};
const AVISO: Record<string, string> = {
  loja: 'alertas da loja',
  farol: 'Farol',
  pausa: 'pausa dos canais',
  estoque: 'estoque',
  chegou: 'cliente chegou',
  gestao: 'avisos de gestão',
};
// O lugar no fluxo, em palavras: "despacho", "estação que termina ali" ou "estação que manda para Montagem".
const lugar = (l: any) =>
  !l ? '?' : l.papel === 'despacho' ? 'despacho' : l.vaiPara ? `estação que manda para ${l.vaiPara}` : 'estação que termina ali';

const CANAL: Record<string, string> = { balcao: 'balcão / salão', delivery: 'delivery', todos: 'tudo' };
const PERIODO: Record<string, string> = { diario: 'todo dia', semanal: 'toda semana', nunca: 'nunca zera' };
const CAMPO: Record<string, string> = {
  verdeAteMin: 'verde até',
  amareloAteMin: 'amarelo até',
  usaPreparo: 'etapa “Em preparo”',
  usaEntregue: 'etapa “Entregue”',
  titulo: 'título',
  detalhe: 'texto',
  prioridade: 'prioridade',
  tipo: 'tipo',
  horarios: 'horários',
  diasSemana: 'dias da semana',
  condicao: 'condição',
  duracaoSeg: 'duração',
  ativo: 'ligado/desligado',
};
const valor = (k: string, v: unknown) => (typeof v === 'boolean' ? (v ? 'ligada' : 'desligada') : k.endsWith('Min') ? `${v} min` : String(v));
const lista = (v: unknown) => (Array.isArray(v) && v.length ? v.join(', ') : 'nenhum');

/** Resumo de uma linha do que aconteceu, a partir do `detalhe` gravado na auditoria. */
export function resumoKds(acao: string, d: any): string {
  if (!d || typeof d !== 'object') return '';
  switch (acao) {
    case 'limpou_fila_kds': {
      const senhas: string[] = Array.isArray(d.senhas) ? d.senhas : [];
      const onde = [d.kds, d.setor, CANAL[d.canal] ?? d.canal].filter(Boolean).join(' · ');
      const quais = senhas.length ? `: ${senhas.slice(0, 12).join(', ')}${senhas.length > 12 ? ` e mais ${senhas.length - 12}` : ''}` : '';
      return `${d.cards} pedido(s)${onde ? ` (${onde})` : ''}${quais}`;
    }
    case 'cancelou_pedido_producao':
      return [d.senha ? `senha ${d.senha}` : d.mesa ? `mesa ${d.mesa}` : '', d.motivo].filter(Boolean).join(' · ');
    case 'alterou_etapas_kds':
      return (Array.isArray(d.mudou) ? d.mudou : [])
        .map((k: string) => `${CAMPO[k] ?? k}: ${valor(k, d.antes?.[k])} → ${valor(k, d.depois?.[k])}`)
        .join(' · ');
    case 'alterou_periodo_senha':
      return `${PERIODO[d.antes] ?? d.antes} → ${PERIODO[d.depois] ?? d.depois}`;
    case 'alterou_destinos_producao':
      return `${d.alvo === 'setor' ? 'Setor' : 'Produto'} ${d.nome ?? ''}: ${lista(d.antes)} → ${lista(d.depois)}`;
    case 'criou_alerta_kds':
    case 'excluiu_alerta_kds':
      return d.titulo ? `“${d.titulo}”` : '';
    case 'editou_alerta_kds':
      return [d.titulo ? `“${d.titulo}”` : '', Array.isArray(d.campos) && d.campos.length ? d.campos.map((c: string) => CAMPO[c] ?? c).join(', ') : ''].filter(Boolean).join(' · ');
    case 'disparou_alerta_kds':
      return [d.titulo ? `“${d.titulo}”` : '', d.duracaoSeg ? `${d.duracaoSeg} s` : ''].filter(Boolean).join(' · ');
    case 'configurou_produtos_kds':
      return `${d.kds ?? 'KDS'}: ${d.produtos ?? 0} produto(s)${d.entraram ? ` · +${d.entraram}` : ''}${d.sairam ? ` · −${d.sairam}` : ''}`;
    case 'configurou_fluxo_kds':
      return `${d.kds ?? 'KDS'}: era ${lugar(d.antes)}; agora ${lugar(d.depois)}`;
    case 'forcou_despacho_kds':
      return [
        d.pedido,
        Array.isArray(d.faltavam) && d.faltavam.length ? `faltava ${d.faltavam.join(', ')}` : '',
        d.autorizadoPor ? `liberado por ${d.autorizadoPor}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'configurou_avisos_kds':
      return [
        d.kds ?? 'KDS',
        Array.isArray(d.ligou) && d.ligou.length ? `passou a receber: ${d.ligou.map((t: string) => AVISO[t] ?? t).join(', ')}` : '',
        Array.isArray(d.desligou) && d.desligou.length ? `deixou de receber: ${d.desligou.map((t: string) => AVISO[t] ?? t).join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'configurou_rota_kds':
      return [
        Array.isArray(d.etapas) ? `${d.etapas.length} etapa(s): ${d.etapas.map((e: any) => (e?.kds ?? []).join(' + ')).join(' → ')}` : '',
        Array.isArray(d.mudou) && d.mudou.length
          ? d.mudou.map((m: any) => `${m.kds}: ${m.antes ? `vai para ${m.antes}` : 'termina ali'} → ${m.depois ? `vai para ${m.depois}` : 'termina ali'}`).join('; ')
          : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'mostrou_mapa_nos_kds':
      return [
        Array.isArray(d.entraram) && d.entraram.length ? `passou a mostrar o mapa: ${d.entraram.join(', ')}` : '',
        Array.isArray(d.sairam) && d.sairam.length ? `voltou aos pedidos: ${d.sairam.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    default:
      return '';
  }
}
