/**
 * Até quando vale a licença do SERVIDOR DA LOJA (ERR-466).
 *
 * A ativação do servidor copia o fim do teste da CONTA (`empresa.trial_ate`) no dia em que o servidor é instalado
 * (`ativacao.validade_ate`). Depois disso, quem muda a validade é a CONTA: o "Liberar / estender" do console da
 * distribuição (`liberarLicenca`) e a assinatura (`aplicarAssinatura`) gravam só `empresa.trial_ate`. A renovação do
 * servidor conferia a data antiga da ativação — a conta estendida até fevereiro e o servidor travando na data da
 * instalação (o servidor grava `lic_ativa = 0` e recusa toda gravação: a loja para de vender pelo servidor).
 *
 * A regra: vale a MAIOR das duas datas. A conta estende o servidor, nunca encurta — o cancelamento da assinatura (que
 * põe `trial_ate = agora`) e o teste vencido da conta continuam como eram, sem travar o servidor antes da data dele.
 * Conta sem limite (`trial_ate` nulo = legado, a mesma leitura do `statusConta`) = servidor sem prazo. Ativação sem
 * prazo = sem prazo.
 */
export function validadeDoServidor(
  ativacaoAte: Date | string | null | undefined,
  contaAte: Date | string | null | undefined,
): Date | null {
  if (ativacaoAte == null) return null;
  const daAtivacao = new Date(ativacaoAte);
  if (Number.isNaN(daAtivacao.getTime())) return null;
  if (contaAte == null) return null;
  const daConta = new Date(contaAte);
  if (Number.isNaN(daConta.getTime())) return daAtivacao;
  return daConta.getTime() > daAtivacao.getTime() ? daConta : daAtivacao;
}

/** A licença do servidor venceu? (sem prazo nunca vence). */
export function servidorVencido(validade: Date | null, agora = new Date()): boolean {
  return !!validade && validade.getTime() < agora.getTime();
}
