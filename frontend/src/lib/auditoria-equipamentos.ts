/* eslint-disable @typescript-eslint/no-explicit-any */

// Ações de auditoria do cadastro de equipamentos (entidade = equipamento): o rótulo e o resumo
// legível de cada uma. Usado no histórico da tela Equipamentos e na tela de Auditoria.

export const ACOES_EQUIPAMENTO: Record<string, string> = {
  cadastrou_equipamento: 'Cadastrou equipamento',
  revogou_equipamento: 'Revogou equipamento',
  terminal_codigo_gerado: 'Gerou código de pareamento',
  terminal_pareado: 'Pareou o terminal',
  terminal_trocado: 'Trocou a máquina do terminal',
  alterou_impressora_do_terminal: 'Trocou a impressora do terminal',
  alterou_impressao_por_etapa: 'Alterou a impressão por etapa do KDS',
  alterou_proximo_kds: 'Alterou o próximo KDS',
  alterou_papeis_impressora: 'Alterou o uso da impressora',
  cadastrou_impressora: 'Cadastrou impressora',
  editou_impressora: 'Editou impressora',
  excluiu_impressora: 'Excluiu impressora',
  marcou_credencial_integracao: 'Marcou credencial de integração',
};

const TIPO: Record<string, string> = {
  pdv: 'Terminal de PDV',
  salao: 'Sub-PDV Salão',
  terminal_ponto: 'Terminal de Ponto',
  kds: 'KDS',
  impressora: 'Impressora',
  servidor_local: 'Servidor local',
};
const ETAPA: Record<string, string> = { recebido: 'Recebido', preparo: 'Em preparo', pronto: 'Pronto', entregue: 'Entregue' };
const ligado = (v: unknown) => (v ? 'ligado' : 'desligado');

/** Resumo de uma linha do que mudou, a partir do `detalhe` gravado na auditoria. */
export function resumoEquipamento(acao: string, d: any): string {
  if (!d || typeof d !== 'object') return '—';
  const nome = d.nome ? String(d.nome) : 'Equipamento';
  switch (acao) {
    case 'cadastrou_equipamento':
      return d.tipo ? `${nome} · ${TIPO[d.tipo] ?? d.tipo}` : nome;
    case 'revogou_equipamento':
      return d.motivo ? `${nome} · ${d.motivo}` : nome;
    case 'terminal_pareado':
      return d.por === 'token' ? `${nome} · pelo token` : `${nome} · pelo código`;
    case 'alterou_impressora_do_terminal':
      return `${nome}: ${d.impressoraAntes ?? 'nenhuma'} → ${d.impressoraDepois ?? 'nenhuma'}`;
    case 'alterou_impressao_por_etapa':
      return d.imprimeAoAvancar
        ? `${nome}: imprime ao chegar em “${ETAPA[d.imprimeNoStatus] ?? d.imprimeNoStatus}”${d.impressoraDestino ? ` na ${d.impressoraDestino}` : ''}`
        : `${nome}: não imprime ao avançar`;
    case 'alterou_proximo_kds':
      return d.proximoKds ? `${nome} → ${d.proximoKds}` : `${nome}: fim da cadeia`;
    case 'alterou_papeis_impressora':
      return [nome, d.fazCupom != null ? `cupom ${ligado(d.fazCupom)}` : '', d.fazProducao != null ? `produção ${ligado(d.fazProducao)}` : '']
        .filter(Boolean)
        .join(' · ');
    case 'cadastrou_impressora':
    case 'editou_impressora':
    case 'excluiu_impressora':
      return [nome, d.destino ?? 'sem destino', d.largura ? `${d.largura} mm` : '', d.ativo === false ? 'inativa' : ''].filter(Boolean).join(' · ');
    case 'marcou_credencial_integracao':
      return d.integrador ? `${nome} · ${d.integrador}` : nome;
    default:
      return nome;
  }
}
