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
});
