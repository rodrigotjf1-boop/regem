// O que o totem precisa saber do fiscal da loja ANTES de cobrar.
//
// Acima do limite de identificação da UF (R$ 2.000 no RJ), a NFC-e sem CPF/CNPJ é recusada
// — e, no totem, a nota só é emitida DEPOIS de o pagamento aprovar. Descobrir o limite ali
// significaria cobrar o cliente e ter de estornar. Então o totem recebe o limite junto com o
// cardápio e exige o CPF na tela de identificação, antes da maquininha.
//
// O valor NÃO é constante: vem da mesma função que o fiscal usa para recusar a emissão
// (`limiteIdentificacao` — tabela por UF, ou o valor que a loja configurou). Um número
// copiado aqui ficaria diferente do fiscal na primeira mudança de norma.
import { limiteIdentificacao } from '../fiscal/destinatario';

export type FiscalDoTotem = {
  /** A loja emite NFC-e? Sem fiscal ativo, não há limite nenhum a respeitar. */
  ativo: boolean;
  /** Acima deste valor (em CENTAVOS, como todo valor do totem), o CPF é obrigatório. */
  limiteIdentificacaoCentavos: number | null;
};

export function fiscalParaTotem(
  cfg:
    | { ativo?: boolean | null; uf?: string | null; limiteIdentificacao?: unknown }
    | null
    | undefined,
): FiscalDoTotem {
  if (!cfg?.ativo) return { ativo: false, limiteIdentificacaoCentavos: null };
  const reais = limiteIdentificacao(String(cfg.uf ?? ''), cfg.limiteIdentificacao);
  return { ativo: true, limiteIdentificacaoCentavos: Math.round(reais * 100) };
}
