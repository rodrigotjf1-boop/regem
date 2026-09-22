// RESPONSÁVEL TÉCNICO PELO SISTEMA EMISSOR (grupo <infRespTec>, NT 2018.005).
//
// É quem desenvolve o software que emite a nota — a DISTRIBUIÇÃO (Regem), não a loja. Por isso
// vem da configuração do SERVIDOR, e o lojista nunca vê nem edita (regra de distribuição).
// Variáveis: RESP_TEC_CNPJ, RESP_TEC_CONTATO, RESP_TEC_EMAIL, RESP_TEC_FONE.
//
// Sem elas o grupo simplesmente não sai. Se a UF exigir, a SEFAZ rejeita com 972 ("Obrigatória
// as informações do responsável técnico") — e aí as variáveis passam a ser obrigatórias.

export function responsavelTecnico(): { cnpj: string; contato: string; email: string; fone: string } | null {
  const cnpj = String(process.env.RESP_TEC_CNPJ ?? '').replace(/\D/g, '');
  const contato = String(process.env.RESP_TEC_CONTATO ?? '').trim();
  const email = String(process.env.RESP_TEC_EMAIL ?? '').trim();
  const fone = String(process.env.RESP_TEC_FONE ?? '').replace(/\D/g, '');
  if (cnpj.length !== 14 || !contato || !email || fone.length < 6) return null;
  return { cnpj, contato, email, fone };
}
