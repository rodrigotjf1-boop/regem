import { instrucoesDoRobo, VERSAO_INSTRUCOES } from './robo-instrucoes';

// AS INSTRUÇÕES DO ROBÔ (Fase 5, F1 — pedido do dono de 30/10/2026). O texto é a "mensagem do sistema" do agente no
// n8n; aqui se confere que cada pedido do dono está escrito nele, e que o texto só cita ferramentas que o fluxo tem.
describe('instruções do robô', () => {
  const { texto, versao, fluxo } = instrucoesDoRobo({ loja: 'Mister Burguer' }, '1');

  it('leva a versão e o nome da loja', () => {
    expect(versao).toBe(VERSAO_INSTRUCOES);
    expect(fluxo).toBe(1);
    expect(texto.startsWith('Você atende os clientes da Mister Burguer no WhatsApp.')).toBe(true);
    expect(instrucoesDoRobo({ loja: '  ' }).texto).toContain('clientes da loja no WhatsApp');
  });

  it('tom humano: curto, pelo nome, uma pergunta por vez, sem markdown', () => {
    expect(texto).toContain('nunca como um robô');
    expect(texto).toContain('pelo primeiro nome');
    expect(texto).toContain('Uma pergunta por vez');
    expect(texto).toContain('Sem markdown');
  });

  it('o cardápio online vem primeiro, com as versões do produto, e "x-bacon" = "xbacon"', () => {
    expect(texto).toContain('O CARDÁPIO ONLINE VEM PRIMEIRO');
    expect(texto).toContain('só o sanduíche ou o trio');
    expect(texto).toContain('"X-Bacon", "xbacon" e "x bacon" são o mesmo produto');
    expect(texto).toContain('se ele está com dificuldade e se quer ajuda de alguém da equipe para fazer o pedido');
  });

  // F2 (30/10): a busca nova — os que levam, onde dá para adicionar (com o preço), o combo uma vez e o link do produto.
  it('busca da F2: link DIRETO do produto, o combo uma vez, e "leva" × "pode adicionar" sem citar a receita', () => {
    expect(texto).toContain('mande o link DIRETO dele (o campo link da busca)');
    expect(texto).toContain('ofereça UMA vez, com o preço');
    expect(texto).toContain('diga os que levam (levam)');
    expect(texto).toContain('e os adicionais (podeAdicionar)');
    expect(texto).toContain('Nunca cite quantidades nem a receita');
    expect(texto).toContain('o link de produto que buscar_no_cardapio devolve');
    expect(texto).toContain('categoriasParaOferecer');
  });

  it('cliente chateado: acolhe, não promete, e chama a equipe com urgência', () => {
    expect(texto).toContain('CLIENTE CHATEADO OU IRRITADO');
    expect(texto).toContain('Não prometa prazo, desconto, reembolso nem solução');
    expect(texto).toContain('urgente = true');
  });

  it('não oferece "falar com atendente" de início', () => {
    expect(texto).toContain('Nunca ofereça "falar com atendente" no começo da conversa');
    expect(texto).toContain('Nunca ponha "atendente" nas opções');
  });

  // Dica do dono (30/10, depois do teste no celular): antes de passar para o atendimento, perguntar se o cliente está com
  // dificuldade e se quer ajuda; o chamado leva o resumo da dificuldade.
  it('pergunta ANTES de chamar a equipe — direto só quando o cliente pediu uma pessoa ou está chateado', () => {
    expect(texto).toContain('Chame direto, sem perguntar, só em dois casos: o cliente PEDIU para falar com uma pessoa; ou está chateado (urgente).');
    expect(texto).toContain('PERGUNTE ANTES');
    expect(texto).toContain('OPCOES: Sim, quero ajuda | Não, obrigado');
    expect(texto).toContain('Só chame depois que ele disser que sim');
    // nenhuma lista de opções sugerida traz "atendente" — o fluxo do n8n tira essa palavra das opções que o cliente
    // não pediu (a lista vai de "OPCOES:" até o ponto final)
    const listas = [...texto.matchAll(/OPCOES: ([^.\n]*)/g)].map((m) => m[1]);
    expect(listas).toContain('Sim, quero ajuda | Não, obrigado');
    for (const l of listas) expect(l).not.toMatch(/atendente/i);
  });

  it('o chamado leva um RESUMO da dificuldade para a equipe', () => {
    expect(texto).toContain('o campo mensagem é um RESUMO para a equipe');
    expect(texto).toContain('o que o cliente quer, qual a dificuldade e o que você já tentou');
  });

  it('"não entendi o áudio": repete por escrito, sem chamar atendente (teste do dono, 30/10)', () => {
    expect(texto).toContain('Se o cliente disser que não entendeu o áudio');
    expect(texto).toContain('repita por escrito, com clareza, o que você disse no último áudio');
    expect(texto).toContain('Isso NÃO é motivo para chamar atendente');
  });

  it('as regras que já existiam continuam (preço, links, loja fechada, distância, cupom, cartão)', () => {
    expect(texto).toContain('Nunca invente preço');
    expect(texto).toContain('Os ÚNICOS links que você pode escrever');
    expect(texto).toContain('fechaNoDiaSeguinte');
    expect(texto).toContain('taxaPor = distancia');
    expect(texto).toContain('Cupom, promoção ou desconto: nunca diga que não há');
    expect(texto).toContain('Nunca peça número de cartão');
    expect(texto).toContain('OPCOES: primeira | segunda | terceira');
  });

  it('só cita as ferramentas que o fluxo 1 tem', () => {
    const citadas = new Set(texto.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []);
    const doFluxo1 = ['consultar_loja', 'buscar_no_cardapio', 'taxa_de_entrega', 'pedidos_do_cliente', 'link_personalizado', 'chamar_atendente'];
    for (const nome of citadas) expect(doFluxo1).toContain(nome);
    for (const nome of doFluxo1) expect(citadas.has(nome)).toBe(true);
  });

  it('fluxo desconhecido recebe o texto do fluxo 1', () => {
    expect(instrucoesDoRobo({ loja: 'X' }, '99').fluxo).toBe(1);
    expect(instrucoesDoRobo({ loja: 'X' }).fluxo).toBe(1);
  });

  it('o fluxo 1 não fala de montar o pedido na conversa', () => {
    expect(texto).not.toContain('MONTAR O PEDIDO AQUI');
    expect(texto).not.toContain('registrar_pedido');
  });
});

// O FLUXO 2 (F3/F4 — pedido do dono de 30/10/2026): o robô monta e registra o pedido na conversa quando o cliente não
// quer ou não consegue usar o link. Cada passo do pedido do dono tem de estar no texto.
describe('instruções do robô — fluxo 2 (o pedido na conversa)', () => {
  const { texto, fluxo } = instrucoesDoRobo({ loja: 'Mister Burguer' }, '2');

  it('é o fluxo 2 e mantém o que vale nos dois (tom, cardápio primeiro, chateado, regras)', () => {
    expect(fluxo).toBe(2);
    for (const t of ['nunca como um robô', 'O CARDÁPIO ONLINE VEM PRIMEIRO', 'CLIENTE CHATEADO OU IRRITADO', 'Nunca invente preço', 'Nunca peça número de cartão'])
      expect(texto).toContain(t);
  });

  it('sem o link: oferece montar o pedido aqui (e não passa direto ao atendente)', () => {
    expect(texto).toContain('pergunte com gentileza se ele quer que você monte o pedido aqui pela conversa');
    expect(texto).toContain('OPCOES: Sim, monta pra mim | Vou pelo link');
    expect(texto).not.toContain('chame o atendente (chamar_atendente, tipo humano) com o resumo do que ele quer');
    expect(texto).toContain('tentou montar o pedido aqui e não deu certo');
  });

  it('F5: os passos do dono, na ordem — o sistema conduz (proximo): item, escolha, extras, "só isso", último endereço, complemento, pagamento, resumo do sistema, registrar', () => {
    const passos = [
      'MONTAR O PEDIDO AQUI',
      'o SISTEMA CONDUZ',
      'proximo.comoResponder',
      'pergunte antes se é só o sanduíche ou o trio',
      'acao = escolher com a opção',
      '"Não, obrigado" → acao = concluir',
      '"Não, só isso" → acao = fechar',
      'o último endereço que o cliente usou',
      'Infelizmente nosso delivery não cobre a região',
      'Complemento e ponto de referência: sempre peça',
      'Pagamento: as opções do proximo',
      'o SISTEMA MANDA SOZINHO o resumo para conferir',
      '"Pode registrar" (ou 1): registrar_pedido (não precisa de versão)',
    ];
    let ultimo = -1;
    for (const p of passos) {
      const i = texto.indexOf(p);
      expect(i).toBeGreaterThan(ultimo);
      ultimo = i;
    }
  });

  it('F5 (teste do dono): não insiste em montar pelo chat; escolha não vira item novo; troco; endereço; foto; lista inteira', () => {
    expect(texto).toContain('NÃO ofereça montar o pedido aqui pela conversa nas respostas sobre produto, preço ou cardápio');
    expect(texto).toContain('Se o próprio cliente pedir para pedir por aqui');
    expect(texto).toContain('NUNCA adicione o produto de novo para responder uma escolha');
    expect(texto).toContain('nunca marque "sem troco" por conta própria');
    expect(texto).toContain('Nunca escolha o endereço pelo cliente');
    expect(texto).toContain('"Cadastrar novo endereço"');
    expect(texto).toContain('Nunca diga que não consegue mandar foto');
    expect(texto).toContain('Nunca corte a lista em dois ou três produtos');
    expect(texto).toContain('com TODAS as opções, até 10');
    expect(texto).not.toContain('(até 3, poucas palavras cada)');
    expect(texto).toContain('comece com ver_pedido');
  });

  it('o resumo para conferir e o final saem pelo sistema: o robô não escreve outro nem põe botões; a observação do pedido', () => {
    expect(texto).toContain('NÃO escreva outro resumo e NÃO ponha OPCOES nessa resposta');
    expect(texto).toContain('O sistema manda o resumo final por escrito');
    expect(texto).toContain('sem repetir');
    expect(texto).toContain('acao = observacao_do_pedido');
    expect(texto).toContain('Nunca registre sem o cliente confirmar o resumo');
  });

  it('a regra da distância vira "quem diz se entrega é definir_entrega"', () => {
    expect(texto).toContain('quem diz é definir_entrega (fora_da_area)');
    expect(texto).not.toContain('taxaPor = distancia): não existe lista de bairros. Nunca diga que não entrega num bairro');
  });

  it('só cita as ferramentas que o fluxo 2 tem — e todas elas', () => {
    const citadas = new Set(texto.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []);
    const doFluxo2 = [
      'consultar_loja', 'buscar_no_cardapio', 'taxa_de_entrega', 'pedidos_do_cliente', 'link_personalizado', 'chamar_atendente',
      'ver_pedido', 'mexer_no_pedido', 'definir_entrega', 'definir_nome', 'definir_pagamento', 'registrar_pedido', 'cancelar_pedido',
    ];
    // O motivo da recusa que o robô lê na resposta e a ação de mexer_no_pedido — não são ferramentas.
    const motivos = ['fora_da_area', 'observacao_do_pedido'];
    for (const nome of citadas) if (!motivos.includes(nome)) expect(doFluxo2).toContain(nome);
    for (const nome of doFluxo2) expect(citadas.has(nome)).toBe(true);
    const listas = [...texto.matchAll(/OPCOES: ([^.\n]*)/g)].map((m) => m[1]);
    for (const l of listas) expect(l).not.toMatch(/atendente/i);
  });
});
