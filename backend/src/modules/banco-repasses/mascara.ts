import { createHmac } from 'node:crypto';
import { cpfValido } from '../../common/validadores-br';

// A MÁSCARA DO EXTRATO (decisão V8-3): a descrição crua NUNCA é gravada. Sai daqui a versão com CPF, CNPJ, conta, telefone,
// e-mail e nome de pessoa trocados por iniciais ou `***`. Em TODA linha vale a lista do que PODE aparecer: palavra fora dela
// vira inicial, porque o nome de alguém pode vir em qualquer lançamento ("SAQUE FULANO"). Puro, linear, sem log.

const TETO_DA_DESCRICAO = 200;

/** Maiúsculas, sem acento, sem caractere de controle e com um espaço só. */
export function normalizarTexto(cru: string): string {
  const semAcento = (cru ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  let saida = '';
  let espaco = true;
  for (const c of semAcento.toUpperCase()) {
    const cod = c.codePointAt(0) ?? 0;
    if (cod < 32 || cod === 127 || c === ' ' || c === ' ') {
      if (!espaco) saida += ' ';
      espaco = true;
    } else {
      saida += c;
      espaco = false;
    }
  }
  return saida.trim();
}

/** NAME e MEMO viram uma descrição só: quando um contém o outro, fica o maior. */
export function descricaoCrua(nome: string, memo: string): string {
  const n = (nome ?? '').trim();
  const m = (memo ?? '').trim();
  if (!n) return m;
  if (!m) return n;
  const nn = normalizarTexto(n);
  const nm = normalizarTexto(m);
  if (nn === nm || nm.includes(nn)) return m;
  if (nn.includes(nm)) return n;
  return `${m} ${n}`;
}

// Os termos de transferência e pagamento.
const TERMOS_DE_PAGAMENTO = new Set([
  'PIX', 'TED', 'DOC', 'TEV', 'TEF', 'TRANSF', 'TRANSFER', 'TRANSFERENCIA', 'TRANSFERENCIAS', 'PAGTO', 'PGTO', 'PAG', 'PAGAMENTO',
  'PAGAMENTOS', 'DEP', 'DEPOSITO', 'BOLETO', 'SALARIO', 'SALARIOS', 'RECEBIMENTO', 'CRED', 'CREDITO', 'REMESSA',
]);

// O que pode aparecer: termos de banco, de operação e os nomes das plataformas. Fora daqui, vira inicial.
const VOCABULARIO = new Set([
  ...TERMOS_DE_PAGAMENTO,
  'COMPRA', 'COMPRAS', 'CESTA', 'MANUTENCAO', 'ENCARGOS', 'SEGURO', 'SEGUROS', 'EMPRESTIMO', 'PARCELA', 'PARCELAS', 'FINANCIAMENTO', 'CONSORCIO',
  'CAPITALIZACAO', 'COBRANCA', 'TITULO', 'TITULOS', 'CUSTODIA', 'LIMITE', 'CHEQUES', 'CONVENIO', 'ATM', 'TERMINAL', 'AUTOATENDIMENTO', 'MENSAL', 'ANUAL',
  'TRANSFERIDO', 'TRANSFERIDA', 'RECEBIMENTOS', 'ENVIO', 'CANCELAMENTO', 'ESTORNADO', 'ESTORNADA', 'PREVIDENCIA', 'LIQ', 'ANTECIP', 'DEVOL',
  'TRANSACAO', 'OPERACAO', 'BANCARIA', 'BANCARIO', 'ECONOMICA', 'FEDERAL',
  'REM', 'DES', 'PELO', 'PELA', 'BCO', 'RECEBIDO', 'RECEBIDA', 'RECEB', 'REC', 'ENVIADO', 'ENVIADA', 'ENV', 'EMITIDO', 'EMITIDA', 'DEVOLVIDO', 'DEVOLVIDA', 'DEVOLUCAO', 'ESTORNO',
  'QR', 'QRCODE', 'CODE', 'CHAVE', 'AGENDADO', 'AGENDADA', 'AGENDAMENTO', 'ELETRONICO', 'ELETRONICA', 'ONLINE', 'INTERNET', 'APP', 'MOBILE',
  'CELULAR', 'DINHEIRO', 'ESPECIE', 'CHEQUE', 'COMPENSADO', 'DEB', 'DEBITO', 'AUTOMATICO', 'AUTOM', 'SAQUE', 'REND', 'RENDIMENTO', 'RENDIMENTOS',
  'JUROS', 'IOF', 'APLICACAO', 'RESGATE', 'CDB', 'POUPANCA', 'LOTE', 'FOLHA', 'ADIANTAMENTO', 'ADTO', 'FERIAS', 'RESCISAO', 'DECIMO', 'TERCEIRO',
  'FORNECEDOR', 'FORNECEDORES', 'FATURA', 'CONTA', 'CONTAS', 'CORRENTE', 'LUZ', 'AGUA', 'ENERGIA', 'GAS', 'TELEFONE', 'ALUGUEL', 'CONDOMINIO',
  'IMPOSTO', 'IMPOSTOS', 'TRIBUTO', 'TRIBUTOS', 'TARIFA', 'TARIFAS', 'TAXA', 'TAXAS', 'PACOTE', 'SERVICO', 'SERVICOS', 'MENSALIDADE', 'ANUIDADE',
  'SIMPLES', 'NACIONAL', 'DAS', 'DARF', 'GPS', 'GARE', 'FGTS', 'INSS', 'ICMS', 'ISS', 'IPTU', 'IPVA', 'GRRF', 'DAE',
  'IFOOD', 'PAGO', 'ANOTA', 'AI', 'ANOTAAI', '99', '99FOOD', '99PAY', 'FOOD', 'TECNOLOGIA', 'TECNOL', 'STONE', 'CIELO', 'REDE', 'REDECARD', 'GETNET',
  'PAGSEGURO', 'PAGBANK', 'SUMUP', 'SAFRAPAY', 'MERCADO', 'MERCADOPAGO', 'MAQUININHA', 'MAQUINA', 'CARTAO', 'CARTOES', 'VISA', 'MASTER', 'MASTERCARD',
  'ELO', 'AMEX', 'HIPERCARD', 'VENDA', 'VENDAS', 'ANTECIPACAO', 'REPASSE', 'REPASSES', 'LIQUIDACAO', 'CARDAPIO', 'DIGITAL', 'DELIVERY', 'LOJA',
  'CAIXA', 'BANCO', 'BRASIL', 'BB', 'ITAU', 'UNIBANCO', 'BRADESCO', 'SANTANDER', 'NUBANK', 'INTER', 'C6', 'SICOOB', 'SICREDI', 'ORIGINAL', 'NEXT',
  'SAFRA', 'BTG', 'BANRISUL', 'PAN', 'AG', 'AGENCIA', 'CC', 'CP', 'NR', 'NUM', 'DOCUMENTO', 'VALOR', 'REF', 'REFERENTE', 'ENTRE', 'MESMA', 'TITULARIDADE',
  'TITULAR', 'MESMO', 'OUTRA', 'OUTRO', 'INSTITUICAO', 'FAVORECIDO', 'PAGADOR', 'REMETENTE', 'DESTINATARIO', 'DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'EM',
  'NA', 'NO', 'PARA', 'POR', 'COM', 'A', 'O', 'AO',
]);

// Termo de banco que também é nome ou sobrenome: logo depois de um nome, é parte dele ("MARIA DA LUZ" → M*** L***).
const TAMBEM_E_NOME = new Set(['LUZ', 'BRASIL', 'SAFRA', 'STONE', 'CIELO', 'PAN', 'ELO', 'REDE', 'MERCADO', 'MASTER', 'INTER', 'TERCEIRO', 'DECIMO', 'FOLHA']);
// Os sobrenomes comuns só ficam visíveis com a palavra que os explica antes ("CONTA DE LUZ", "BANCO DO BRASIL").
const SO_COM_CONTEXTO = new Map<string, Set<string>>([
  ['LUZ', new Set(['CONTA', 'CONTAS', 'ENERGIA', 'FATURA'])],
  ['BRASIL', new Set(['BANCO', 'BCO'])],
  ['SAFRA', new Set(['BANCO', 'BCO'])],
]);

// O CNPJ com letras, em vigor desde julho de 2026 (12.ABC.345/01DE-35). O só de números segue pela máscara comum.
const CNPJ_ALFANUMERICO = /\b[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}\/[0-9A-Z]{4}-[0-9]{2}\b/g;
const MARCA_CNPJ = 'CNPJMASCARADO';

const PARTICULAS = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E']);
// Empresa de verdade: fica a primeira palavra, para a pessoa reconhecer o fornecedor.
const SUFIXO_EMPRESA = new Set(['LTDA', 'EPP', 'CIA', 'S/A', 'S.A', 'S.A.']);
// Firma individual: o nome da empresa costuma ser o nome da pessoa. Fica só a inicial.
const SUFIXO_INDIVIDUAL = new Set(['ME', 'MEI', 'EIRELI']);
const ROTULO_DE_DOCUMENTO = new Set(['CPF', 'CNPJ', 'CPF/CNPJ', 'CNPJ/CPF']);
const ROTULO_DE_CONTA = new Set(['AG', 'AGENCIA', 'CC', 'C/C', 'CP', 'CONTA', 'CTA']);
const ROTULO_DE_NUMERO = new Set(['LOTE', 'REF', 'NR', 'NUM']);
const SEGUE_O_99 = new Set(['FOOD', 'PAY', 'TECNOLOGIA', 'TECNOL', 'APP']);

const ehDigito = (c: string) => c >= '0' && c <= '9';
const SEPARADORES = new Set(['-', '–', '—', '·', '|', ';', ':', ',', '(', ')', '[', ']', '{', '}', '*', '_', '=', '#', '~', '\\', '"', "'"]);

type Peca = { t: string; k: 'palavra' | 'numero' | 'doc' | 'sep' };

/** `DD/MM` ou `DD/MM/AA(AA)`: data não é documento. */
function pareceData(s: string): boolean {
  const p = s.split('/');
  if (p.length < 2 || p.length > 3) return false;
  if (p[0].length !== 2 || p[1].length !== 2 || !(p.length === 2 || p[2].length === 2 || p[2].length === 4)) return false;
  if (!p.every((x) => [...x].every(ehDigito))) return false;
  return Number(p[0]) >= 1 && Number(p[0]) <= 31 && Number(p[1]) >= 1 && Number(p[1]) <= 12;
}

/** O que fazer com um trecho de dígitos e pontuação. */
function mascararNumero(trecho: string): Peca {
  const limpo = trecho.replace(/[.\-/]+$/, '');
  const d = [...limpo].filter(ehDigito).join('');
  if (pareceData(limpo)) return { t: limpo, k: 'numero' };
  if (d.length === 14) return { t: `CNPJ **.***.${d.slice(5, 8)}/${d.slice(8, 12)}-**`, k: 'doc' };
  if (d.length === 11) {
    const formatado = limpo.length === 14 && limpo[3] === '.' && limpo[7] === '.' && limpo[11] === '-';
    if (formatado || cpfValido(d)) return { t: `CPF ***.${d.slice(3, 6)}.***-**`, k: 'doc' };
    return { t: '***', k: 'doc' };
  }
  if (d.length >= 5) return { t: '***', k: 'doc' };
  return { t: limpo, k: 'numero' };
}

/** Quebra o texto em palavras, números e separadores, num percurso só. */
function pecasDe(texto: string): Peca[] {
  const pecas: Peca[] = [];
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i];
    if (c === ' ') {
      i++;
      continue;
    }
    // Número: dígitos com . - / no meio (CPF, CNPJ, conta, telefone, data). O "+" e o "(" de telefone entram como separador.
    if (ehDigito(c)) {
      let j = i;
      while (j < n && (ehDigito(texto[j]) || ((texto[j] === '.' || texto[j] === '-' || texto[j] === '/') && j + 1 < n && ehDigito(texto[j + 1])))) j++;
      // Dígito colado em letra ("C6", "99FOOD", "AG1234") é palavra.
      if (j < n && texto[j] !== ' ' && !SEPARADORES.has(texto[j]) && texto[j] !== '.' && texto[j] !== '/' && texto[j] !== '+') {
        let k = j;
        while (k < n && texto[k] !== ' ' && !SEPARADORES.has(texto[k])) k++;
        pecas.push(palavra(texto.slice(i, k)));
        i = k;
        continue;
      }
      pecas.push(mascararNumero(texto.slice(i, j)));
      i = j;
      continue;
    }
    if (SEPARADORES.has(c) || c === '+' || c === '/' || c === '.') {
      if (c !== '+' && c !== '.') pecas.push({ t: '·', k: 'sep' });
      i++;
      continue;
    }
    let k = i;
    while (k < n && texto[k] !== ' ' && !(SEPARADORES.has(texto[k]) && texto[k] !== '_')) {
      // A barra separa palavras, menos em "S/A" e "C/C".
      if (texto[k] === '/' && !(texto.slice(i, k) === 'S' || texto.slice(i, k) === 'C' || texto.slice(i, k) === 'CPF' || texto.slice(i, k) === 'CNPJ')) break;
      k++;
    }
    if (k === i) k = i + 1;
    const bruta = texto.slice(i, k);
    // "CRED.TRANSF.PIX" são três palavras (senão o "PIX" não é visto e o nome passa). "S.A." e e-mail ficam inteiros.
    if (bruta.includes('.') && !bruta.includes('@') && !/^S\.A\.?$/.test(bruta)) {
      for (const parte of bruta.split('.')) if (parte) pecas.push(palavra(parte));
    } else pecas.push(palavra(bruta));
    i = k;
  }
  return pecas;
}

function palavra(bruta: string): Peca {
  const t = bruta.replace(/^[.,]+|[.,]+$/g, '');
  if (t === MARCA_CNPJ) return { t: 'CNPJ **.***.***/****-**', k: 'doc' };
  if (t.includes('@')) return { t: '***', k: 'doc' };
  if ([...t].filter(ehDigito).length >= 5) return { t: '***', k: 'doc' };
  return { t: t || bruta, k: 'palavra' };
}

const inicial = (p: string) => `${p[0]}***`;

/**
 * A descrição que PODE ser gravada e mostrada. Ex.: `PIX RECEBIDO - FULANO DE TAL 123.456.789-00` →
 * `PIX RECEBIDO · F*** T*** · CPF ***.456.***-**`.
 */
export function mascararDescricao(cru: string): string {
  const texto = normalizarTexto(cru)
    .slice(0, TETO_DA_DESCRICAO)
    .replace(CNPJ_ALFANUMERICO, (m) => (/[A-Z]/.test(m) ? ` ${MARCA_CNPJ} ` : m));
  if (!texto.trim()) return 'SEM DESCRICAO';
  const pecas = pecasDe(texto);

  // 1. Número curto logo depois de "AG", "CC", "CONTA" (com ou sem ":") é conta; DDD e o "55" antes de um número mascarado
  //    fazem parte dele.
  for (let i = 0; i < pecas.length; i++) {
    const p = pecas[i];
    if (p.k !== 'numero' || pareceData(p.t)) continue;
    const antes = pecas[i - 1]?.k === 'sep' ? pecas[i - 2] : pecas[i - 1];
    if (antes?.k === 'palavra' && ROTULO_DE_CONTA.has(antes.t)) pecas[i] = { t: '***', k: 'doc' };
  }
  const semResto: Peca[] = [];
  for (const p of pecas) {
    if (p.k === 'doc' && p.t === '***') {
      // O DDD (e separadores entre ele e o número) somem junto com o número.
      while (semResto.length) {
        const u = semResto[semResto.length - 1];
        const curto = u.k === 'numero' && u.t.length <= 3;
        const sepEntreNumeros = u.k === 'sep' && semResto.length >= 2 && semResto[semResto.length - 2].k === 'numero' && semResto[semResto.length - 2].t.length <= 3;
        if (curto || sepEntreNumeros) semResto.pop();
        else break;
      }
      const ultimo = semResto[semResto.length - 1];
      if (ultimo?.k === 'doc' && ultimo.t === '***') continue;
    }
    // O final de um telefone ou conta em grupos ("99999 1234").
    if (p.k === 'numero' && p.t.length === 4 && [...p.t].every(ehDigito)) {
      const u = semResto[semResto.length - 1];
      if (u?.k === 'doc' && u.t === '***') continue;
    }
    // "CPF" escrito antes do documento: a máscara já traz o rótulo.
    if (p.k === 'doc' && p.t !== '***') {
      while (semResto.length && (semResto[semResto.length - 1].k === 'sep' || ROTULO_DE_DOCUMENTO.has(semResto[semResto.length - 1].t))) {
        const u = semResto[semResto.length - 1];
        if (u.k === 'sep' && !(semResto.length >= 2 && ROTULO_DE_DOCUMENTO.has(semResto[semResto.length - 2].t))) break;
        semResto.pop();
      }
    }
    semResto.push(p);
  }

  // 2. Nome de pessoa: em toda linha, porque ele pode vir em qualquer lançamento.
  const saida = mascararNomes(semResto);

  // 3. Junta, com "·" entre os blocos.
  const blocos: string[] = [];
  let bloco: string[] = [];
  const fechar = () => {
    if (bloco.length) blocos.push(bloco.join(' '));
    bloco = [];
  };
  for (const p of saida) {
    if (p.k === 'sep') fechar();
    else if (p.k === 'doc' && p.t !== '***') {
      fechar();
      blocos.push(p.t);
    } else bloco.push(p.t);
  }
  fechar();
  // Rede de segurança: nenhuma sequência de 5 dígitos ou mais sai daqui.
  const final = blocos.join(' · ').replace(/\d{5,}/g, '***');
  return final || 'SEM DESCRICAO';
}

/** A palavra pode ficar visível nesta posição? */
function palavraLivre(pecas: Peca[], i: number): boolean {
  const t = pecas[i].t;
  if (!VOCABULARIO.has(t) && !SUFIXO_EMPRESA.has(t) && !SUFIXO_INDIVIDUAL.has(t)) return false;
  const contexto = SO_COM_CONTEXTO.get(t);
  if (!contexto) return true;
  let j = i - 1;
  while (j >= 0 && pecas[j].k === 'palavra' && PARTICULAS.has(pecas[j].t)) j--;
  return j >= 0 && pecas[j].k === 'palavra' && contexto.has(pecas[j].t);
}

/** Já dentro de um nome, a palavra continua o nome? */
const continuaNome = (pecas: Peca[], i: number) => TAMBEM_E_NOME.has(pecas[i].t) || !palavraLivre(pecas, i);

function mascararNomes(pecas: Peca[]): Peca[] {
  const saida: Peca[] = [];
  let i = 0;
  while (i < pecas.length) {
    const p = pecas[i];
    // Número curto em linha de transferência costuma ser banco e agência de quem pagou. Fica só o que identifica o
    // lançamento: a data, o número depois de "LOTE" e o "99" da plataforma.
    if (p.k === 'numero' && !pareceData(p.t)) {
      const antes = pecas[i - 1];
      const depois = pecas[i + 1];
      const doLote = antes?.k === 'palavra' && ROTULO_DE_NUMERO.has(antes.t);
      const daPlataforma = p.t === '99' && depois?.k === 'palavra' && SEGUE_O_99.has(depois.t);
      if (!doLote && !daPlataforma) {
        const u = saida[saida.length - 1];
        if (!(u?.k === 'doc' && u.t === '***')) saida.push({ t: '***', k: 'doc' });
        i++;
        continue;
      }
    }
    if (p.k !== 'palavra' || palavraLivre(pecas, i)) {
      saida.push(p);
      i++;
      continue;
    }
    // Um nome: palavras fora da lista, com as partículas (DE, DA…) entre elas.
    const nomes: string[] = [];
    let j = i;
    while (j < pecas.length && pecas[j].k === 'palavra') {
      const t = pecas[j].t;
      if (PARTICULAS.has(t)) {
        const prox = pecas[j + 1];
        if (prox?.k === 'palavra' && continuaNome(pecas, j + 1)) {
          j++;
          continue;
        }
        break;
      }
      if (!continuaNome(pecas, j)) break;
      nomes.push(t);
      j++;
    }
    const sufixo = pecas[j]?.k === 'palavra' ? pecas[j].t : '';
    // O nome começa um bloco novo: "PIX RECEBIDO · F*** T***".
    const anterior = saida[saida.length - 1];
    if (anterior && anterior.k !== 'sep' && !PARTICULAS.has(anterior.t)) saida.push({ t: '·', k: 'sep' });
    if (SUFIXO_EMPRESA.has(sufixo)) {
      saida.push({ t: nomes.length > 1 ? `${nomes[0]} ***` : `${inicial(nomes[0])}`, k: 'palavra' });
    } else {
      saida.push({ t: nomes.map(inicial).join(' '), k: 'palavra' });
    }
    i = j;
  }
  return saida;
}

/**
 * O texto que identifica "a mesma descrição" para o "Lembrar para os próximos": sem números (o lote e a data mudam a cada
 * lançamento), sem pontuação e com o sentido do dinheiro. Só serve de entrada do resumo: nunca é gravado.
 */
export function textoDaRegra(cru: string, valorCentavos: number): string {
  const n = normalizarTexto(cru);
  let semNumero = '';
  for (const c of n) semNumero += (c >= 'A' && c <= 'Z') || c === ' ' ? c : ' ';
  const palavras = semNumero.split(' ').filter(Boolean).join(' ');
  const base = palavras || [...n].filter(ehDigito).join('') || 'SEM DESCRICAO';
  return `${valorCentavos >= 0 ? 'E' : 'S'}|${base}`;
}

/** O resumo com o sal da empresa (HMAC-SHA256, em hexa). */
export function resumoComSal(sal: string, texto: string | Buffer): string {
  return createHmac('sha256', sal).update(texto).digest('hex');
}

export type Fonte = 'banco' | 'ifood' | 'ifood_pago' | '99' | 'maquininha';

const OPERADORAS = new Set(['STONE', 'CIELO', 'GETNET', 'REDECARD', 'PAGSEGURO', 'SUMUP', 'SAFRAPAY', 'MERCADOPAGO', 'MAQUININHA']);

/**
 * De onde a descrição diz que o dinheiro veio. Só ENTRADA: é o repasse que a outra fonte vai confirmar (R3/R4). Saída fica no
 * banco, mesmo citando a plataforma (uma tarifa da maquininha não é repasse).
 */
export function origemDaDescricao(cru: string, valorCentavos: number): Fonte {
  if (valorCentavos <= 0) return 'banco';
  const n = normalizarTexto(cru);
  let limpo = '';
  for (const c of n) limpo += (c >= 'A' && c <= 'Z') || ehDigito(c) ? c : ' ';
  const p = limpo.split(' ').filter(Boolean);
  const tem = (x: string) => p.includes(x);
  const emSeguida = (a: string, b: string) => p.some((x, i) => x === a && p[i + 1] === b);
  if (tem('ANOTAAI') || emSeguida('ANOTA', 'AI') || emSeguida('IFOOD', 'PAGO')) return 'ifood_pago';
  if (tem('IFOOD')) return 'ifood';
  if (tem('99FOOD') || tem('99PAY') || ['FOOD', 'PAY', 'TECNOLOGIA', 'TECNOL', 'APP'].some((x) => emSeguida('99', x))) return '99';
  if (p.some((x) => OPERADORAS.has(x)) || emSeguida('MERCADO', 'PAGO')) return 'maquininha';
  return 'banco';
}

/** Linha que só informa o saldo (alguns bancos mandam como lançamento): não é dinheiro que entrou ou saiu. */
export function ehLinhaDeSaldo(cru: string): boolean {
  const n = normalizarTexto(cru).replace(/[^A-Z ]/g, ' ').replace(/ +/g, ' ').trim();
  if (n === 'S A L D O') return true;
  return ['SALDO', 'SALDO DO DIA', 'SALDO ANTERIOR', 'SALDO FINAL', 'SALDO ATUAL', 'SALDO TOTAL', 'SALDO EM C C', 'SALDO EM CONTA'].includes(n);
}
