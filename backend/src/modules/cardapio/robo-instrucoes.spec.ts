import { instrucoesDoDirect, instrucoesDoRobo, VERSAO_DO_DIRECT, VERSAO_INSTRUCOES } from './robo-instrucoes';
import { ACOES_DA_MUDANCA } from './robo-mudanca';
import { jeitoDoAtendente, perfisPadrao } from './perfis-do-atendente';
import { assuntosPadrao, blocoDasInstrucoes, resumoDoRecado } from './assuntos-do-atendente';
import { lerResumoDaMensagem } from '../atendimento/resumo-do-robo';

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

  it('o chamado leva um RESUMO da dificuldade para a equipe — nas três linhas que a central lê (Onda 1, PR 4)', () => {
    expect(texto).toContain('o campo mensagem é um RESUMO para a equipe');
    expect(texto).toContain('o que o cliente quer, qual a dificuldade e o que você já tentou');
    expect(texto).toContain('  Motivo: ');
    expect(texto).toContain('  Quer: ');
    expect(texto).toContain('  Já fiz: ');
  });

  it('depois de chamar: o lugar na fila (posicao) ou "já tem alguém" (comAlguem), sem prometer tempo', () => {
    expect(texto).toContain('Se a resposta de chamar_atendente trouxer posicao');
    expect(texto).toContain('se trouxer comAlguem = true');
    expect(texto).toContain('Nunca prometa tempo.');
  });

  // .f16 (mig 379): o horário da equipe — fora dele, o chamado vira recado e a resposta traz a frase para o cliente.
  it('fora do horário da equipe: manda paraOCliente como veio, sem "em instantes" nem a posição, e segue a conversa', () => {
    expect(VERSAO_INSTRUCOES >= '2026-11-07.f16').toBe(true);
    expect(texto).toContain('Se a resposta de chamar_atendente trouxer foraDoHorario = true');
    expect(texto).toContain('mande ao cliente o texto de paraOCliente exatamente como veio');
    expect(texto).toContain('NÃO diga "em instantes", não diga a posição na fila');
    expect(texto).toContain('continue a conversa normalmente');
    expect(texto).toContain('fora do horário da equipe, traz foraDoHorario = true e paraOCliente');
  });

  it('o exemplo do resumo, lido como a central lê, dá as três partes (instrução e leitor andam juntos)', () => {
    const exemplo = (texto.match(/Ex\.: "(Motivo: [^"]+)"/) || [])[1] ?? '';
    expect(lerResumoDaMensagem(exemplo.replace(/ \/ /g, '\n'))).toEqual({
      motivo: 'não consegue abrir o link do cardápio no celular',
      quer: '1 X-Bacon e 1 Coca',
      jaFez: 'mandei o link 2 vezes',
    });
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

  it('o fluxo 1 não muda o pedido já feito: mudar continua sendo com a equipe, perguntando antes', () => {
    expect(texto).not.toContain('MUDAR UM PEDIDO JÁ FEITO');
    expect(texto).toContain('quer mudar ou cancelar um pedido; ');
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

  // .f13 (PR 3 do pedido alterado, 04/11): o robô muda o pedido já feito — cada ação que ele chama existe no Regem.
  it('muda o pedido já feito: pelo pedidoFeito, o sistema manda a conferência, o "Pode alterar" aplica; o resto vai para a equipe', () => {
    expect(texto).toContain('MUDAR UM PEDIDO JÁ FEITO');
    expect(texto).toContain('olhe pedidoFeito');
    for (const t of ['acao = pedido_por', 'acao = pedido_tirar com a linha', 'acao = pedido_trocar com a linha', 'acao = confirmar_mudanca', 'acao = troco_da_mudanca', 'acao = desistir_da_mudanca'])
      expect(texto).toContain(t);
    expect(texto).toContain('O SISTEMA MANDA SOZINHO ao cliente a conferência da mudança');
    expect(texto).toContain('"Pedi a mudança à loja ⏳"');
    expect(texto).toContain('Se vier chamaEquipe = true, pergunte se ele quer ajuda da equipe, terminando com OPCOES: Sim, quero ajuda | Não, obrigado');
    expect(texto).toContain('chamar_atendente com tipo mudanca');
    expect(texto).toContain('quer mudar um pedido e você não pode mudar (veja MUDAR UM PEDIDO JÁ FEITO)');
    expect(texto).not.toContain('quer mudar ou cancelar um pedido; ');
  });

  // .f14 (PR 3b-1): o endereço do pedido em produção — abre pelo mexer_no_pedido, o endereço vai pelo definir_entrega.
  it('muda o ENDEREÇO do pedido em produção: pedido_endereco abre, o endereço novo vai pelo definir_entrega; fora da área e retirada, a equipe', () => {
    expect(texto).toContain('Mudar o ENDEREÇO (podeMudarEndereco = true');
    expect(texto).toContain('acao = pedido_endereco; depois mande o endereço novo em definir_entrega');
    expect(texto).toContain('o complemento ou ponto de referência (ou "sem referência")');
    expect(texto).toContain('Fora da área de entrega, pedido de retirada ou podeMudarEndereco = false: a equipe');
    expect(texto).toContain('Depois de pedido_endereco, é o endereço novo do pedido já feito.');
    // O endereço saiu da lista do que é "com a equipe"; trocar entre entrega e retirada entrou.
    expect(texto).not.toContain('Mudar o endereço, a forma de pagamento');
    expect(texto).toContain('trocar entre entrega e retirada');
  });

  // .f15 (PR 3b-2): o pedido que JÁ SAIU — o mesmo caminho, e o Regem chama a equipe como urgente e manda o "já chamei".
  it('o endereço do pedido que JÁ SAIU: o mesmo pedido_endereco + definir_entrega; o sistema chama a equipe e avisa o cliente', () => {
    expect(VERSAO_INSTRUCOES >= '2026-11-04.f15').toBe(true);
    expect(texto).toContain('O pedido JÁ SAIU para a entrega e o cliente quer outro endereço (enderecoPelaEquipe = true)');
    expect(texto).toContain('acao = pedido_endereco e o endereço novo em definir_entrega, como acima (sem a referência, se ele não disse)');
    expect(texto).toContain('O sistema chama a equipe como URGENTE (ela avisa o entregador e confere a distância)');
    // O robô não pergunta "quer ajuda?" aqui (o caso já foi aberto) e não promete a mudança.
    expect(texto).toContain('não repita, não prometa a mudança e não pergunte se ele quer ajuda');
  });

  it('as ações da mudança citadas nas instruções são as que o Regem entende (ACOES_DA_MUDANCA)', () => {
    const conhecidas = new Set(Object.values(ACOES_DA_MUDANCA).flat());
    for (const a of ['pedido_por', 'pedido_tirar', 'pedido_trocar', 'pedido_endereco', 'troco_da_mudanca', 'confirmar_mudanca', 'desistir_da_mudanca'])
      expect(conhecidas.has(a)).toBe(true);
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
    const motivos = [
      'fora_da_area', 'observacao_do_pedido', 'trocar_pelo_trio',
      'usar_cashback', 'guardar_cashback', 'usar_premio', 'guardar_premio', 'usar_cupom', 'tirar_cupom',
      // As ações da mudança do pedido já feito (PR 3 e 3b), também do mexer_no_pedido.
      'pedido_por', 'pedido_tirar', 'pedido_trocar', 'pedido_endereco', 'troco_da_mudanca', 'confirmar_mudanca', 'desistir_da_mudanca',
    ];
    for (const nome of citadas) if (!motivos.includes(nome)) expect(doFluxo2).toContain(nome);
    for (const nome of doFluxo2) expect(citadas.has(nome)).toBe(true);
    const listas = [...texto.matchAll(/OPCOES: ([^.\n]*)/g)].map((m) => m[1]);
    for (const l of listas) expect(l).not.toMatch(/atendente/i);
  });
});

// .f17 / .d3 (mig 380 — o perfil do atendente virtual por canal, protótipo v11): o bloco do perfil e do jeito da loja
// entra LOGO DEPOIS da abertura nos dois fluxos do WhatsApp e no Direct; com perfil, a abertura não impõe o tom; "Como
// hoje" sem jeito = o texto de antes, letra por letra.
describe('instruções do robô — o perfil do atendente virtual (mig 380)', () => {
  const LOJA = 'Mister Burguer';
  const ABERTURA_DE_HOJE = {
    whatsapp: `Você atende os clientes da ${LOJA} no WhatsApp. Converse como uma pessoa da equipe: simpática, acolhedora e objetiva.`,
    direct: `Você atende os clientes da ${LOJA} no Direct do Instagram. Converse como uma pessoa da equipe: simpática, acolhedora e objetiva.`,
  };
  const ABERTURA_COM_PERFIL = {
    whatsapp: `Você atende os clientes da ${LOJA} no WhatsApp. Converse como uma pessoa da equipe.`,
    direct: `Você atende os clientes da ${LOJA} no Direct do Instagram. Converse como uma pessoa da equipe.`,
  };
  // Os três textos: WhatsApp fluxo 1, WhatsApp fluxo 2 e Direct.
  const gerar = (jeito?: string | null) => ({
    f1: instrucoesDoRobo({ loja: LOJA, jeito }, '1').texto,
    f2: instrucoesDoRobo({ loja: LOJA, jeito }, '2').texto,
    direct: instrucoesDoDirect({ loja: LOJA, jeito }, '2').texto,
  });
  const canalDe = (k: 'f1' | 'f2' | 'direct') => (k === 'direct' ? 'direct' : 'whatsapp');
  const semJeito = gerar();

  it('as versões subiram (.f17 e .d3, ou depois)', () => {
    expect(VERSAO_INSTRUCOES >= '2026-11-07.f17').toBe(true);
    expect(VERSAO_DO_DIRECT >= '2026-11-07.d3').toBe(true);
  });

  it('"Como hoje" sem jeito: o texto é IDÊNTICO ao de antes — a abertura de sempre e nada a mais', () => {
    const comoHoje = jeitoDoAtendente(perfisPadrao(), 'whatsapp', true);
    expect(comoHoje).toBe('');
    for (const jeito of [undefined, null, '', '   ', comoHoje, jeitoDoAtendente(perfisPadrao(), 'direct', false)])
      expect(gerar(jeito)).toEqual(semJeito);
    for (const k of ['f1', 'f2', 'direct'] as const) {
      expect(semJeito[k].startsWith(`${ABERTURA_DE_HOJE[canalDe(k)]}\n\n`)).toBe(true);
      expect(semJeito[k]).not.toContain('PERFIL DE ATENDIMENTO');
      expect(semJeito[k]).not.toContain('JEITO DA LOJA');
    }
  });

  it('com perfil e jeito: o bloco entra logo depois da abertura (sem o tom fixo); o resto do texto não muda', () => {
    for (const k of ['f1', 'f2', 'direct'] as const) {
      const canal = canalDe(k);
      const jeito = jeitoDoAtendente({ [canal]: { perfil: 'profissional', foraDoHorario: 'mesmo', jeito: 'assine como Burger da Praça' } }, canal, true);
      expect(jeito).toContain('PROFISSIONAL');
      expect(jeito).toContain('JEITO DA LOJA');
      const com = gerar(jeito)[k];
      const resto = semJeito[k].slice(ABERTURA_DE_HOJE[canal].length + 2);
      expect(com).toBe([ABERTURA_COM_PERFIL[canal], jeito, resto].join('\n\n'));
      expect(com.split('\n\n')[1]).toBe(jeito.split('\n\n')[0]);
      // as regras continuam lá (o perfil não tira nada)
      expect(com).toContain('CLIENTE CHATEADO OU IRRITADO');
      expect(com).toContain('REGRAS QUE NUNCA MUDAM');
    }
  });

  it('fora do horário: entra o perfil de fora do horário; "O mesmo" mantém o do canal', () => {
    const perfis = {
      whatsapp: { perfil: 'cordial', foraDoHorario: 'objetivo', jeito: null },
      direct: { perfil: 'gentil', foraDoHorario: 'mesmo', jeito: null },
    };
    const f1Noite = instrucoesDoRobo({ loja: LOJA, jeito: jeitoDoAtendente(perfis, 'whatsapp', false) }, '1').texto;
    expect(f1Noite).toContain('(escolhido pela loja): OBJETIVO.');
    expect(f1Noite).not.toContain('CORDIAL');
    const f1Dia = instrucoesDoRobo({ loja: LOJA, jeito: jeitoDoAtendente(perfis, 'whatsapp', true) }, '1').texto;
    expect(f1Dia).toContain('(escolhido pela loja): CORDIAL.');
    const directNoite = instrucoesDoDirect({ loja: LOJA, jeito: jeitoDoAtendente(perfis, 'direct', false) }, '1').texto;
    expect(directNoite).toContain('(escolhido pela loja): GENTIL.');
  });

  it('só o jeito da loja ("Como hoje"): a abertura de sempre e, logo depois, a linha do jeito', () => {
    for (const k of ['f1', 'f2', 'direct'] as const) {
      const canal = canalDe(k);
      const jeito = jeitoDoAtendente({ [canal]: { perfil: 'hoje', jeito: 'nunca prometa brinde' } }, canal, true);
      const com = gerar(jeito)[k];
      const resto = semJeito[k].slice(ABERTURA_DE_HOJE[canal].length + 2);
      expect(com).toBe([ABERTURA_DE_HOJE[canal], jeito, resto].join('\n\n'));
      expect(jeito).toBe('JEITO DA LOJA (escrito pela loja, siga quando não contrariar as regras abaixo): nunca prometa brinde');
    }
  });
});

describe('instruções do robô — os assuntos que não são pedido (mig 381)', () => {
  const LOJA = 'Mister Burguer';
  const gerar = (assuntos: unknown, jeito?: string | null) => ({
    f1: instrucoesDoRobo({ loja: LOJA, jeito, assuntos: blocoDasInstrucoes(assuntos, 'whatsapp') }, '1').texto,
    f2: instrucoesDoRobo({ loja: LOJA, jeito, assuntos: blocoDasInstrucoes(assuntos, 'whatsapp') }, '2').texto,
    direct: instrucoesDoDirect({ loja: LOJA, jeito, assuntos: blocoDasInstrucoes(assuntos, 'direct') }, '2').texto,
  });
  // O texto de antes: sem o campo `assuntos` (como a F2 gerava).
  const antes = {
    f1: instrucoesDoRobo({ loja: LOJA }, '1').texto,
    f2: instrucoesDoRobo({ loja: LOJA }, '2').texto,
    direct: instrucoesDoDirect({ loja: LOJA }, '2').texto,
  };
  const ANTES_DA_SECAO = { f1: 'QUANDO CHAMAR UMA PESSOA', f2: 'QUANDO CHAMAR UMA PESSOA', direct: 'QUANDO CHAMAR UMA PESSOA' };

  it('as versões subiram (.f18 e .d4)', () => {
    expect(VERSAO_INSTRUCOES).toBe('2026-11-07.f18');
    expect(VERSAO_DO_DIRECT).toBe('2026-11-07.d4');
  });

  it('tudo em "Como hoje": o texto é IDÊNTICO ao de antes, nos três lugares (com e sem perfil)', () => {
    expect(gerar(assuntosPadrao())).toEqual(antes);
    expect(gerar(null)).toEqual(antes);
    for (const vazio of [undefined, null, '', '   '])
      expect(instrucoesDoRobo({ loja: LOJA, assuntos: vazio }, '1').texto).toBe(antes.f1);
    for (const k of ['f1', 'f2', 'direct'] as const) expect(antes[k]).not.toContain('ASSUNTOS QUE NÃO SÃO PEDIDO');
    // com um perfil escolhido, os assuntos em "Como hoje" também não mexem em nada
    const jeito = jeitoDoAtendente({ whatsapp: { perfil: 'cordial' }, direct: { perfil: 'cordial' } }, 'whatsapp', true);
    expect(gerar(assuntosPadrao(), jeito).f1).toBe(instrucoesDoRobo({ loja: LOJA, jeito }, '1').texto);
  });

  it('com recado ou "não é por aqui": a seção entra logo depois de QUANDO CHAMAR UMA PESSOA, nos três lugares; o resto não muda', () => {
    const escolhas = { fornecedor: { modo: 'recado' }, vaga: { modo: 'nao', texto: 'Currículos: rh@loja.com' } };
    const com = gerar(escolhas);
    for (const k of ['f1', 'f2', 'direct'] as const) {
      const secao = blocoDasInstrucoes(escolhas, k === 'direct' ? 'direct' : 'whatsapp');
      const partes = com[k].split('\n\n');
      const i = partes.findIndex((p) => p.startsWith('ASSUNTOS QUE NÃO SÃO PEDIDO'));
      expect(i).toBeGreaterThan(0);
      expect(partes[i - 1].startsWith(ANTES_DA_SECAO[k])).toBe(true);
      expect(partes[i]).toBe(secao);
      // tirando a seção, é o texto de antes, letra por letra
      expect([...partes.slice(0, i), ...partes.slice(i + 1)].join('\n\n')).toBe(antes[k]);
      expect(com[k]).toContain('tipo = fornecedor');
      expect(com[k]).toContain('"Currículos: rh@loja.com"');
    }
    // no WhatsApp não pede o telefone; no Direct pergunta o contato
    expect(com.f1).toContain('não peça telefone: o contato é este número do WhatsApp');
    expect(com.direct).toContain('e o melhor contato para o responsável falar com ela');
    expect(com.direct).not.toContain('não peça telefone: o contato é este número');
  });

  it('o exemplo do recado nas instruções, lido como o Regem lê, dá as quatro partes (instrução e leitor andam juntos)', () => {
    const t = blocoDasInstrucoes({ vaga: { modo: 'recado' } }, 'whatsapp');
    const linhasDoResumo = t
      .split('\n')
      .filter((l) => /^\s{5}(Assunto|Quem|Contato|Já fiz):/.test(l))
      .map((l) => l.trim().replace(/: .*/, ': x'));
    expect(linhasDoResumo).toEqual(['Assunto: x', 'Quem: x', 'Contato: x', 'Já fiz: x']);
    expect(Object.keys(resumoDoRecado(linhasDoResumo.join('\n'))).sort()).toEqual(['assunto', 'contato', 'jaFez', 'quem']);
  });
});
