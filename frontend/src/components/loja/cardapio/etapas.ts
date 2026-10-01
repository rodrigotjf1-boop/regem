// ETAPAS DO CHECKOUT (docs/templates-cardapio/00-base-cardapio.md §5) — funções puras, sem React.
// O checkout deixou de ser uma tela só: Sacola → Entrega → (Dados) → Pagamento, ou Sacola → Revisar
// no pedido expresso do Regem Fluxo. `falta()` diz, na ordem em que os campos aparecem, o que
// impede de avançar. As regras são as MESMAS do checkout de uma tela (o que antes só desabilitava
// o botão sem dizer por quê); `submitPedido()` e o servidor continuam conferindo tudo de novo.

import { dadosNaEntrega, type TemplateChave } from './tipos-template';

export type Etapa = 'sacola' | 'entrega' | 'dados' | 'pagamento' | 'revisar';
export type Falta = { campo: string; mensagem: string } | null;

export type ContextoEtapas = {
  template: TemplateChave;
  /** QR de mesa de verdade (`modo === 'mesa'` e `?mesa=`): só a Sacola, envio direto. */
  mesaDireta: boolean;
  isServico: boolean;
  isIndustria: boolean;
  /** Regem Fluxo, cliente reconhecido com tudo preenchido e sem ter tocado em "Trocar". */
  expresso: boolean;
};

export function etapasAtivas(c: ContextoEtapas): Etapa[] {
  if (c.mesaDireta) return ['sacola'];
  if (c.expresso) return ['sacola', 'revisar'];
  const e: Etapa[] = dadosNaEntrega(c.template) ? ['sacola', 'entrega', 'pagamento'] : ['sacola', 'entrega', 'dados', 'pagamento'];
  // Indústria pede orçamento: não há pagamento.
  return c.isIndustria ? e.filter((x) => x !== 'pagamento') : e;
}

export function tituloEtapa(e: Etapa, c: { template: TemplateChave; isServico: boolean; tipo: string }): string {
  if (e === 'sacola') return 'Sua sacola';
  if (e === 'revisar') return 'Revisar e pedir';
  if (e === 'dados') return 'Seus dados';
  if (e === 'pagamento') return 'Pagamento';
  if (c.isServico) return 'Atendimento';
  if (dadosNaEntrega(c.template)) return c.tipo === 'retirada' ? 'Retirada e contato' : 'Entrega e contato';
  return c.tipo === 'retirada' ? 'Retirada' : 'Entrega';
}

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

export type EstadoFalta = {
  template: TemplateChave;
  qtdItens: number;
  chk: any;
  mesaDireta: boolean;
  isServico: boolean;
  isIndustria: boolean;
  /** Frete por distância (precisa de localização) em vez de bairro. */
  areaRaio: boolean;
  temBairros: boolean;
  /** Loja fechada e este pedido não pode ser agendado: nada sai. */
  fechadaSemAgenda: boolean;
  /** Texto do horário da loja ("Abre às 18:00"), para a mensagem. */
  horarioLabel?: string | null;
  /** O pedido exige data e hora (serviços, encomenda escolhida, loja fechada com encomenda). */
  precisaAgendar: boolean;
  /** O tipo escolhido está disponível agora (ou o pedido é agendado). */
  tipoDisponivel: boolean;
  pagamentos: string[];
  formasCartao: string[];
};

function faltaDados(s: EstadoFalta): Falta {
  if (s.mesaDireta) return null;
  if (!String(s.chk.nome ?? '').trim()) return { campo: 'nome', mensagem: 'Informe seu nome' };
  if (soDigitos(s.chk.telefone).length < 10) return { campo: 'telefone', mensagem: 'Informe seu WhatsApp com DDD' };
  return null;
}

function faltaEntrega(s: EstadoFalta): Falta {
  const c = s.chk;
  if (!s.isServico) {
    if (!s.tipoDisponivel) {
      return { campo: 'tipo', mensagem: c.tipo === 'entrega' ? 'Entrega indisponível agora' : 'Retirada indisponível agora' };
    }
    if (c.tipo === 'entrega') {
      if (!s.areaRaio && !c.bairroId) {
        return { campo: 'bairroId', mensagem: s.temBairros ? 'Escolha o bairro' : 'Esta loja ainda não tem área de entrega' };
      }
      if (!String(c.rua ?? '').trim()) return { campo: 'rua', mensagem: 'Informe a rua' };
      if (s.areaRaio && !(c.lat && c.lng)) return { campo: 'localizacao', mensagem: 'Use sua localização para calcular o frete' };
    }
  }
  if (s.precisaAgendar && !c.agendamento) {
    return { campo: 'agendamento', mensagem: s.isServico ? 'Escolha o dia e a hora' : 'Agende o horário do pedido' };
  }
  return null; // o CNPJ da indústria é opcional no servidor: a etapa não o exige
}

function faltaPagamento(s: EstadoFalta): Falta {
  const c = s.chk;
  if (!s.isIndustria && s.pagamentos.length > 0 && !c.forma) return { campo: 'forma', mensagem: 'Escolha como vai pagar' };
  if (c.forma === 'cartao' && s.formasCartao.length > 0 && !c.bandeira) return { campo: 'bandeira', mensagem: 'Escolha o cartão' };
  if (c.cupomFiscal && ![11, 14].includes(soDigitos(c.cpf).length)) return { campo: 'cpf', mensagem: 'Confira o CPF ou CNPJ' };
  return null;
}

/** O que falta para sair desta etapa, ou `null`. `campo` é o `data-campo` para rolar e focar. */
export function falta(etapa: Etapa, s: EstadoFalta): Falta {
  if (etapa === 'sacola') {
    if (!s.qtdItens) return { campo: '', mensagem: 'Sua sacola está vazia' };
    if (s.fechadaSemAgenda) return { campo: '', mensagem: s.horarioLabel ? `Loja fechada · ${s.horarioLabel}` : 'Loja fechada' };
    return null;
  }
  if (etapa === 'entrega') return faltaEntrega(s) ?? (dadosNaEntrega(s.template) ? faltaDados(s) : null);
  if (etapa === 'dados') return faltaDados(s);
  if (etapa === 'pagamento') return faltaPagamento(s);
  // Revisar (pedido expresso): tudo de uma vez.
  return faltaEntrega(s) ?? faltaDados(s) ?? faltaPagamento(s);
}

/** A primeira pendência de todo o caminho (para o botão final e para sair do expresso). */
export function faltaNoPedido(etapas: Etapa[], s: EstadoFalta): { etapa: Etapa; falta: NonNullable<Falta> } | null {
  for (const e of etapas) {
    const f = falta(e, s);
    if (f) return { etapa: e, falta: f };
  }
  return null;
}

/** O rótulo do botão do rodapé quando nada falta. */
export function rotuloAvancar(p: {
  etapa: Etapa;
  proxima: Etapa | null;
  mesaDireta: boolean;
  isServico: boolean;
  isIndustria: boolean;
  agendado: boolean;
  tipo: string;
  tituloProxima?: string;
}): string {
  if (p.proxima) {
    if (p.etapa === 'sacola') return p.proxima === 'revisar' ? 'Revisar e pedir' : 'Continuar';
    return `Ir para ${String(p.tituloProxima ?? '').toLowerCase()}`;
  }
  if (p.mesaDireta) return 'Enviar pedido';
  if (p.isIndustria) return 'Solicitar orçamento';
  if (p.isServico) return 'Confirmar agendamento';
  if (p.agendado) return 'Agendar pedido';
  return p.tipo === 'entrega' ? 'Fazer pedido' : 'Confirmar pedido';
}
