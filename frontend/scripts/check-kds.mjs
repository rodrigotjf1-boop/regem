// Confere as regras puras da fila do KDS (`src/lib/kds-fila.ts`): cor do tempo, etapas, soma por
// item e a decisão do teclado (forma de uso toque × teclado). O frontend não tem runner de testes:
// este script transpila os arquivos com o TypeScript do projeto e roda asserts do Node.
// Uso: npm run check:kds
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib');
const tmp = mkdtempSync(join(tmpdir(), 'check-kds-'));
for (const nome of ['senha', 'kds-fila', 'origem-api', 'kds-tema']) {
  const js = ts.transpileModule(readFileSync(join(raiz, `${nome}.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText.replace("'./senha'", "'./senha.mjs'");
  writeFileSync(join(tmp, `${nome}.mjs`), js);
}
// A regra dos complementos UM POR LINHA mora no servidor (via impressa); a tela tem a cópia em kds-fila — as duas se
// comparam nos mesmos exemplos (como o check:conversao faz com a conversão de unidade).
writeFileSync(
  join(tmp, 'adicionais-servidor.mjs'),
  ts.transpileModule(readFileSync(join(raiz, '..', '..', '..', 'backend', 'src', 'common', 'adicionais.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText,
);
const k = await import(pathToFileURL(join(tmp, 'kds-fila.mjs')).href);
const o = await import(pathToFileURL(join(tmp, 'origem-api.mjs')).href);
const tema = await import(pathToFileURL(join(tmp, 'kds-tema.mjs')).href);
const servidor = await import(pathToFileURL(join(tmp, 'adicionais-servidor.mjs')).href);
// Os avisos de cada KDS (mig 408): a regra do servidor e a cópia da tela, comparadas nos mesmos casos.
writeFileSync(
  join(tmp, 'avisos-servidor.mjs'),
  ts.transpileModule(readFileSync(join(raiz, '..', '..', '..', 'backend', 'src', 'common', 'avisos-do-kds.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText,
);
const avisosServidor = await import(pathToFileURL(join(tmp, 'avisos-servidor.mjs')).href);

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};
const AGORA = new Date('2026-10-02T12:00:00-03:00').getTime();
const ha = (min) => new Date(AGORA - min * 60000).toISOString();
const LIM = { verdeAteMin: 5, amareloAteMin: 10 };
const ped = (id, status, min, itens, extra = {}) => ({ id, status, criadoEm: ha(min), itens, ...extra });
const it = (quantidade, descricao, extra = {}) => ({ quantidade, descricao, ...extra });

// Luminância relativa e contraste (WCAG) — para garantir que o texto de cada cor se lê.
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contraste = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

try {
  caso('cor do tempo: verde até o 1º limite, amarelo até o 2º, vermelho depois', () => {
    assert.equal(k.faixaTempo(0, LIM), 'ok');
    assert.equal(k.faixaTempo(5, LIM), 'ok');
    assert.equal(k.faixaTempo(6, LIM), 'atencao');
    assert.equal(k.faixaTempo(10, LIM), 'atencao');
    assert.equal(k.faixaTempo(11, LIM), 'atrasado');
  });

  caso('só três cores de status (mais o cinza do cancelado), todas com texto legível', () => {
    assert.deepEqual(Object.keys(k.COR_STATUS).sort(), ['atencao', 'atrasado', 'cancelado', 'ok']);
    for (const [nome, c] of Object.entries(k.COR_STATUS)) {
      assert.match(c.fundo, /^#[0-9A-F]{6}$/, `${nome}: fundo`);
      assert.ok(contraste(c.fundo, c.texto) >= 4.5, `${nome}: contraste ${contraste(c.fundo, c.texto).toFixed(2)} abaixo de 4,5`);
    }
    assert.equal(k.corDoPedido({ status: 'cancelado' }, 30, LIM), k.COR_STATUS.cancelado, 'cancelado é cinza mesmo velho');
    assert.equal(k.corDoPedido({ status: 'preparo' }, 30, LIM), k.COR_STATUS.atrasado);
  });

  caso('atrasado: passou do preparo do pedido OU entrou no vermelho; cancelado nunca', () => {
    assert.equal(k.estaAtrasado({ status: 'preparo', tempoPreparoMin: 8 }, 9, LIM), true, 'passou do preparo, ainda no amarelo');
    assert.equal(k.estaAtrasado({ status: 'preparo', tempoPreparoMin: 20 }, 9, LIM), false);
    assert.equal(k.estaAtrasado({ status: 'preparo' }, 11, LIM), true, 'sem tempo de preparo: vale o vermelho');
    assert.equal(k.estaAtrasado({ status: 'cancelado', tempoPreparoMin: 1 }, 60, LIM), false);
  });

  caso('minutos nunca ficam negativos (relógio do aparelho atrasado)', () => {
    assert.equal(k.minutosDesde(new Date(AGORA + 90000).toISOString(), AGORA), 0);
    assert.equal(k.minutosDesde(ha(7), AGORA), 7);
  });

  const FILA = [
    ped('a', 'preparo', 12, [it(2, 'X-Burger', { complementosTexto: 'sem cebola' }), it(1, 'Batata')], { senha: 41 }),
    ped('b', 'preparo', 7, [it(3, 'X-Burger'), it(2, 'Batata')], { senha: 12, senhaPrefixo: 'D' }),
    ped('c', 'recebido', 2, [it(1, 'X-Burger'), it(1, 'X-Burger')], { mesa: '7' }),
    ped('d', 'pronto', 14, [it(5, 'X-Burger')], { numero: 99 }),
    ped('e', 'cancelado', 5, [it(9, 'Batata')]),
  ];

  caso('contadores das etapas batem com o filtro', () => {
    const n2 = k.contarEtapas(FILA, AGORA, LIM);
    assert.deepEqual(n2, { todos: 5, recebido: 1, preparo: 2, pronto: 1, atrasados: 2 });
    for (const f of k.FILTROS_ETAPA) assert.equal(k.filtrarEtapa(FILA, f.key, AGORA, LIM).length, n2[f.key], f.key);
    assert.ok(!k.filtrarEtapa(FILA, 'preparo', AGORA, LIM).some((p) => p.status === 'cancelado'));
  });

  caso('rótulos em português', () => {
    assert.equal(k.rotuloEtapa('recebido'), 'A iniciar');
    assert.equal(k.rotuloEtapa('preparo'), 'Em preparo');
    assert.equal(k.proximaAcao('recebido'), 'Iniciar');
    assert.equal(k.proximaAcao('preparo'), 'Pronto');
    assert.equal(k.proximaAcao('pronto'), 'Entregar');
    assert.equal(k.identPedido(FILA[0]), 'Senha 41');
    assert.equal(k.identPedido(FILA[1]), 'Senha D-12');
    assert.equal(k.identPedido(FILA[2]), 'Mesa 7');
    assert.equal(k.identPedido(FILA[3]), '#99');
    assert.equal(k.identPedido({}), 'Balcão');
  });

  caso('por item: soma o que falta produzir, fora cancelado e pronto', () => {
    const g = k.agruparPorItem(FILA, AGORA);
    assert.deepEqual(g.map((x) => [x.descricao, x.quantidade]), [['X-Burger', 7], ['Batata', 3]]);
    assert.equal(g[0].minMaisAntigo, 12, 'a cor do item é a do pedido mais antigo');
    assert.deepEqual(g[0].linhas.map((l) => [l.pedido.id, l.item.quantidade, l.min]), [['a', 2, 12], ['b', 3, 7], ['c', 2, 2]], 'pedidos do mais antigo para o mais novo; iguais dentro do pedido somam');
    assert.equal(g[0].linhas[0].item.complementosTexto, 'sem cebola', 'o complemento fica na linha do pedido');
  });

  caso('por item: o mais antigo vem primeiro; empate decide a quantidade', () => {
    const g = k.agruparPorItem([ped('n', 'recebido', 1, [it(9, 'Suco')]), ped('v', 'preparo', 20, [it(1, 'Pudim')]), ped('w', 'preparo', 20, [it(4, 'Filé')])], AGORA);
    assert.deepEqual(g.map((x) => x.descricao), ['Filé', 'Pudim', 'Suco']);
  });

  caso('resumo: mesma soma, da maior quantidade para a menor, contando pedidos', () => {
    assert.deepEqual(k.somarItens(FILA), [
      { descricao: 'X-Burger', quantidade: 7, pedidos: 3 },
      { descricao: 'Batata', quantidade: 3, pedidos: 2 },
    ]);
    assert.deepEqual(k.somarItens([]), []);
    assert.equal(k.pedidoTemItem(FILA[0], 'Batata'), true);
    assert.equal(k.pedidoTemItem(FILA[3], 'X-Burger'), false, 'pedido pronto não se destaca');
    assert.equal(k.pedidoTemItem(FILA[4], 'Batata'), false, 'cancelado não se destaca');
  });

  caso('agregar itens iguais dentro do pedido', () => {
    const r = k.agregarItens([it('1', 'A'), it(2, 'A'), it(1, 'A', { observacao: 'sem sal' })]);
    assert.deepEqual(r.map((x) => [x.descricao, x.quantidade, x.observacao ?? '']), [['A', 3, ''], ['A', 1, 'sem sal']]);
  });

  const fora = { tag: 'BODY', ehCampoSenha: false };
  const botao = { tag: 'BUTTON', ehCampoSenha: false };
  const select = { tag: 'SELECT', ehCampoSenha: false };
  const campo = { tag: 'INPUT', ehCampoSenha: true };
  const outroCampo = { tag: 'INPUT', ehCampoSenha: false };

  caso('teclado: número e Enter fora do campo são sempre da senha (e a tecla é tomada)', () => {
    for (const alvo of [fora, botao, select]) {
      assert.deepEqual(k.decidirTecla('teclado', '7', alvo), { acao: 'digito', tomar: true }, alvo.tag);
      assert.deepEqual(k.decidirTecla('teclado', 'Enter', alvo), { acao: 'enter', tomar: true }, `${alvo.tag}: Enter não aciona o botão`);
      assert.deepEqual(k.decidirTecla('teclado', 'Backspace', alvo), { acao: 'apagar', tomar: true }, alvo.tag);
    }
    assert.equal(k.decidirTecla('teclado', 'Tab', botao).acao, 'ignorar', 'Tab continua navegando');
    assert.equal(k.decidirTecla('teclado', ' ', botao).acao, 'ignorar', 'Espaço continua acionando o botão');
    assert.equal(k.decidirTecla('teclado', 'ArrowDown', select).acao, 'ignorar', 'setas do seletor continuam');
  });

  caso('toque: nada depende do foco — Enter num botão é do botão', () => {
    assert.equal(k.decidirTecla('toque', 'Enter', botao).acao, 'ignorar');
    assert.equal(k.decidirTecla('toque', '7', select).acao, 'ignorar');
    assert.deepEqual(k.decidirTecla('toque', '7', fora), { acao: 'digito', tomar: false }, 'número solto ainda cai na senha, como sempre foi');
    assert.deepEqual(k.decidirTecla('toque', 'Enter', fora), { acao: 'enter', tomar: false });
  });

  caso('nos dois modos: o campo da senha e os outros campos tratam a própria tecla', () => {
    for (const uso of ['toque', 'teclado']) {
      assert.equal(k.decidirTecla(uso, '7', campo).acao, 'ignorar');
      assert.equal(k.decidirTecla(uso, 'Enter', campo).acao, 'ignorar');
      assert.equal(k.decidirTecla(uso, '7', outroCampo).acao, 'ignorar');
    }
  });

  caso('forma de uso: a escolha vale; sem escolha, adivinha pelo aparelho', () => {
    assert.equal(k.formaDeUso('toque', false), 'toque');
    assert.equal(k.formaDeUso('teclado', true), 'teclado');
    assert.equal(k.formaDeUso('', true), 'toque');
    assert.equal(k.formaDeUso(null, false), 'teclado');
    assert.equal(k.formaDeUso('qualquer', false), 'teclado');
  });

  // Auditoria do KDS (20/10/2026): o evento de produção vem para a empresa inteira — só o cartão DESTA tela apita e alerta.
  caso('só o cartão desta tela apita e alerta (fila deste KDS + sub-filtro escolhido aqui)', () => {
    const lista = [
      { id: 'a', plataforma: 'iFood', origem: 'delivery' },
      { id: 'b', plataforma: 'Anota AI', origem: 'delivery' },
      { id: 'c', plataforma: null, origem: 'mesa' },
    ];
    assert.equal(k.cartaoNaTela(lista, 'x', 'todos', 'todos'), undefined); // outro KDS, outra loja: não é daqui
    assert.equal(k.cartaoNaTela(lista, 'a', 'todos', 'todos')?.id, 'a');
    assert.equal(k.cartaoNaTela(lista, 'a', 'delivery', 'todos')?.id, 'a');
    assert.equal(k.cartaoNaTela(lista, 'a', 'delivery', 'marketplace')?.id, 'a');
    assert.equal(k.cartaoNaTela(lista, 'b', 'delivery', 'marketplace'), undefined); // escondido pelo sub-filtro
    assert.equal(k.cartaoNaTela(lista, 'b', 'delivery', 'digital')?.id, 'b');
    assert.equal(k.cartaoNaTela(lista, 'c', 'balcao', 'mesa')?.id, 'c');
    assert.equal(k.cartaoNaTela(lista, 'c', 'balcao', 'pdv'), undefined);
    assert.equal(k.cartaoNaTela(null, 'a', 'todos', 'todos'), undefined); // a recarga falhou: sem som
  });

  caso('o sub-filtro de origem (o que a tela mostra) é a mesma regra do som', () => {
    assert.equal(k.grupoPedido({ plataforma: '99Food' }, 'delivery'), 'marketplace');
    assert.equal(k.grupoPedido({ plataforma: 'Cardápio Web' }, 'delivery'), 'digital');
    assert.equal(k.grupoPedido({ plataforma: 'Totem GoGeM' }, 'balcao'), 'totem');
    assert.equal(k.grupoPedido({ origem: 'comanda' }, 'balcao'), 'mesa');
    assert.equal(k.grupoPedido({ origem: 'garcom' }, 'balcao'), 'garcom');
    assert.equal(k.grupoPedido({}, 'balcao'), 'pdv');
  });

  // O KDS do servidor da loja nunca conectava ao tempo real: o socket tinha conta própria e, lá, ficava sem endereço.
  caso('tempo real e API pela mesma regra: no servidor da loja, o host da página na porta da API', () => {
    const pagina = { protocol: 'https:', hostname: '192.168.0.10' };
    const loja = o.baseDaApi({ edge: '1', apiUrl: '', portaApi: '' }, pagina);
    assert.equal(loja, 'https://192.168.0.10:3002/api/v1');
    assert.equal(o.origemDoTempoReal(loja), 'https://192.168.0.10:3002'); // nunca vazio (era a porta do app → 404)
    assert.equal(o.baseDaApi({ edge: '1', portaApi: '4002' }, { protocol: 'https:', hostname: 'regem.local' }), 'https://regem.local:4002/api/v1');
    assert.equal(o.baseDaApi({ edge: '1', apiUrl: '' }, null), 'https://api.dmsregem.com/api/v1'); // fora do navegador
    const nuvem = o.baseDaApi({ apiUrl: 'https://api.dmsregem.com/api/v1' }, pagina);
    assert.equal(o.origemDoTempoReal(nuvem), 'https://api.dmsregem.com');
    assert.equal(o.baseDaApi({ apiUrl: '' }, pagina), 'https://api.dmsregem.com/api/v1'); // vazio vale a nuvem
  });

  caso('o tempo real usa a regra da API (nada de endereço próprio no rt.ts)', () => {
    const rt = readFileSync(join(raiz, 'rt.ts'), 'utf8');
    assert.match(rt, /origemDoTempoReal\(apiBase\(\)\)/);
    assert.doesNotMatch(rt, /process\.env\.NEXT_PUBLIC_API_URL/);
  });

  // ERR-264: cor fixa escolhida num tema reprovava no outro ("Marcar todos" 3,3:1 no claro, "salvo" 2,4:1 no escuro).
  caso('tema do KDS: todo texto se lê nos DOIS temas (≥ 4,5:1), e a ação dourada também', () => {
    for (const [nomeTema, t] of Object.entries(tema.TEMAS_KDS)) {
      const pares = [
        ['texto', t.text, [t.bg, t.panel, t.panel2]],
        ['secundário', t.muted, [t.bg, t.panel, t.panel2]],
        ['erro', t.erro, [t.bg, t.panel, t.panel2]],
        ['feito', t.feito, [t.bg, t.panel, t.panel2]],
        ['link', t.link, [t.bg, t.panel, t.panel2]],
        // Versão 2 (onda 2, 11/11/2026): a cor da prioridade vai só no texto, sobre o claro do painel.
        ['urgente', t.urg, [t.bg, t.panel, t.panel2]],
        ['atenção', t.aten, [t.bg, t.panel, t.panel2]],
        ['aviso', t.info, [t.bg, t.panel, t.panel2]],
        ['positivo', t.ok, [t.bg, t.panel, t.panel2]],
        ['aviso do toque', t.invFg, [t.invBg]],
        ['erro do toque', t.urg, [t.panel]],
      ];
      for (const [quem, cor, fundos] of pares)
        for (const fundo of fundos)
          assert.ok(contraste(cor, fundo) >= 4.5, `${nomeTema}: ${quem} ${cor} sobre ${fundo} = ${contraste(cor, fundo).toFixed(2)}`);
    }
    assert.ok(contraste(tema.ACAO_KDS.texto, tema.ACAO_KDS.fundo) >= 4.5, 'ação dourada');
  });

  caso('estação com "vai para": o botão diz para onde o cartão vai', () => {
    assert.equal(k.proximaAcaoNaEstacao('preparo', 'Montagem'), 'Pronto → Montagem');
    assert.equal(k.proximaAcaoNaEstacao('preparo', null), 'Pronto');
    assert.equal(k.proximaAcaoNaEstacao('recebido', 'Montagem'), 'Iniciar');
  });

  // Auditoria do KDS (11/11/2026): prioridade desconhecida ('baixa', 'media') não passa na frente do cancelado.
  caso('rodapé: o urgente vence; prioridade desconhecida vale como alta (nunca na frente do CANCELADO)', () => {
    const cancelado = { id: 'c', prioridade: 'danger', em: '2026-11-11T10:00:00Z' };
    const compra = { id: 'b', prioridade: 'baixa', em: '2026-11-11T10:05:00Z' }; // mais nova, mas não urgente
    assert.equal(k.escolherAlertaDoRodape([cancelado, compra]).id, 'c');
    assert.equal(k.escolherAlertaDoRodape([compra, cancelado]).id, 'c');
    const info = { id: 'i', prioridade: 'info', em: '2026-11-11T10:06:00Z' };
    assert.equal(k.escolherAlertaDoRodape([info, compra]).id, 'b'); // desconhecida = alta > info
    const alta = { id: 'a', prioridade: 'alta', em: '2026-11-11T10:07:00Z' };
    assert.equal(k.escolherAlertaDoRodape([compra, alta]).id, 'a'); // empate: o mais recente
    assert.equal(k.escolherAlertaDoRodape([]), null);
  });

  caso('aviso: o texto é título — detalhe; a prioridade se lê pela palavra (desconhecida = atenção)', () => {
    assert.equal(k.textoDoAlerta({ titulo: 'Pedido alterado', detalhe: 'Senha D-12' }), 'Pedido alterado — Senha D-12');
    assert.equal(k.textoDoAlerta({ titulo: 'Lavar as mãos' }), 'Lavar as mãos');
    assert.equal(k.rotuloDaPrioridade('danger'), '⚠ Urgente');
    assert.equal(k.rotuloDaPrioridade('alta'), '▲ Atenção');
    assert.equal(k.rotuloDaPrioridade('info'), '● Aviso');
    assert.equal(k.rotuloDaPrioridade('ok'), '✓ Positivo');
    assert.equal(k.prioridadeDoRodape('baixa'), 'alta');
    assert.equal(k.rotuloDaPrioridade(undefined), '▲ Atenção');
  });

  // Onda 2 (aprovada em 11/11/2026, A7): o aviso fica PARADO; o que fica até o "Ciente" não conta nem sai sozinho, e
  // enquanto ele está na faixa os outros esperam; só o mostrado conta o tempo.
  caso('rodapé: só o mostrado conta o tempo; o que fica até o Ciente não sai sozinho e segura os outros', () => {
    const em = (min) => new Date(AGORA - min * 60000).toISOString();
    const loja = { id: 'l', prioridade: 'alta', em: em(2), restanteSeg: 2 };
    const info = { id: 'i', prioridade: 'info', em: em(1), restanteSeg: 5 };
    let as = k.passarUmSegundo([loja, info]);
    assert.deepEqual(as.map((a) => `${a.id}:${a.restanteSeg}`), ['l:1', 'i:5'], 'só o mostrado (alta) conta');
    as = k.passarUmSegundo(as);
    assert.deepEqual(as.map((a) => a.id), ['i'], 'zerou: sai, o próximo assume');
    const cancelado = { id: 'c', prioridade: 'danger', em: em(0), restanteSeg: 0, fica: true };
    as = k.passarUmSegundo([cancelado, info]);
    assert.deepEqual(as.map((a) => `${a.id}:${a.restanteSeg}`), ['c:0', 'i:5'], 'o cancelado fica e o outro espera');
    for (let s = 0; s < 120; s++) as = k.passarUmSegundo(as);
    assert.ok(as.some((a) => a.id === 'c'), 'dois minutos depois o cancelado continua até o Ciente');
    assert.deepEqual(k.ordenarAlertas([info, loja, cancelado]).map((a) => a.id), ['c', 'l', 'i']);
    assert.deepEqual(k.passarUmSegundo([]), []);
    // Um urgente do cadastro, mais NOVO, passa na frente do cancelado e conta o tempo dele — o cancelado (que fica até o
    // Ciente, com 0 s) não pode sair sozinho por isso.
    const urgenteDoCadastro = { id: 'u', prioridade: 'danger', em: new Date(AGORA).toISOString(), restanteSeg: 2 };
    const canceladoAntes = { ...cancelado, em: em(1) };
    as = k.passarUmSegundo([canceladoAntes, urgenteDoCadastro]);
    assert.deepEqual(as.map((a) => `${a.id}:${a.restanteSeg}`), ['c:0', 'u:1'], 'o cancelado espera atrás do urgente mais novo');
    as = k.passarUmSegundo(as);
    assert.deepEqual(as.map((a) => a.id), ['c'], 'o urgente do cadastro sai no tempo dele; o cancelado continua até o Ciente');
  });

  caso('aviso de cada toque: o que o servidor fez (etapa, outro KDS, entregue)', () => {
    const nome = (id) => ({ k2: 'Montagem' })[id];
    assert.equal(k.textoDoToque('Senha B-12', { ok: true, status: 'preparo' }, nome), 'Senha B-12 → Em preparo');
    assert.equal(k.textoDoToque('Senha B-12', { ok: true, status: 'pronto' }, nome), 'Senha B-12 → Pronto');
    assert.equal(k.textoDoToque('Senha B-12', { ok: true, status: 'recebido', passouPara: 'k2' }, nome), 'Senha B-12 → Montagem');
    assert.equal(k.textoDoToque('Senha B-12', { ok: true, status: 'recebido', passouPara: 'k9' }, nome), 'Senha B-12 → próximo KDS');
    assert.equal(k.textoDoToque('Mesa 7', { ok: true, status: 'entregue' }, nome), 'Mesa 7 entregue');
    assert.equal(k.textoDoToque('Mesa 7', null, nome), 'Mesa 7 avançou');
  });

  // Onda 2 (O10, decisão do dono: visível desde o aceite, contando 30 min antes).
  caso('encomenda: neutra e fora de "Atrasados" até 30 min antes; depois conta a partir dali', () => {
    const para = (min) => new Date(AGORA + min * 60000).toISOString();
    const enc = ped('e', 'recebido', 95, [it(20, 'Mini X-Burger')], { encomendaPara: para(73) }); // aceita há 95 min, para daqui a 73
    assert.equal(k.encomendaAguarda(enc, AGORA), true);
    assert.equal(k.atrasadoAgora(enc, AGORA, LIM), false, 'aceita há 95 min, mas não está atrasada');
    assert.equal(k.inicioDoTempo(enc), new Date(para(73)).getTime() - 30 * 60000, 'começa 30 min antes');
    assert.equal(k.contarEtapas([enc], AGORA, LIM).atrasados, 0);
    assert.equal(k.somarItens([enc], AGORA).length, 0, 'ainda não entra no que falta produzir');
    assert.equal(k.somarItens([enc]).length, 1, 'sem a hora, conta como antes');
    // 20 min depois do começo do preparo (= 10 min antes do horário): já conta, e está atrasada pelos limites.
    const depois = new Date(para(73)).getTime() - 10 * 60000;
    assert.equal(k.encomendaAguarda(enc, depois), false);
    assert.equal(k.minutosDoCartao(enc, depois), 20);
    assert.equal(k.atrasadoAgora(enc, depois, LIM), true);
    // Pedido em cima da hora (entrou 10 min antes do começo do preparo já ter passado): conta da entrada.
    const emCima = ped('c', 'recebido', 2, [it(1, 'X')], { encomendaPara: para(15) });
    assert.equal(k.encomendaAguarda(emCima, AGORA), false);
    assert.equal(k.minutosDoCartao(emCima, AGORA), 2);
    // Sem horário: igual a antes.
    const comum = ped('n', 'preparo', 12, [it(1, 'X')]);
    assert.equal(k.minutosDoCartao(comum, AGORA), 12);
    assert.equal(k.atrasadoAgora(comum, AGORA, LIM), true);
    // Cancelada nunca "aguarda".
    assert.equal(k.encomendaAguarda({ ...enc, status: 'cancelado' }, AGORA), false);
  });

  // Onda 2 (A13, mig 408; decisão do dono: gestão desligada no preparo, ligada no despacho).
  caso('avisos de cada tela: a MESMA regra do servidor (backend/src/common/avisos-do-kds.ts)', () => {
    assert.deepEqual([...k.TIPOS_DE_AVISO], [...avisosServidor.TIPOS_DE_AVISO]);
    for (const escopo of ['producao', 'despacho', 'entrega', 'avisos', null, undefined, ''])
      assert.deepEqual(k.avisosPadrao(escopo), avisosServidor.avisosPadrao(escopo), `padrão de ${escopo}`);
    const salvos = [{ gestao: true }, { chegou: true, estoque: false }, { gestao: 'sim', xyz: false }, [true], null, undefined, 'x'];
    for (const s of salvos)
      for (const escopo of ['producao', 'despacho', null])
        assert.deepEqual(k.avisosDoKds(escopo, s), avisosServidor.avisosDoKds(escopo, s), `${escopo} + ${JSON.stringify(s)}`);
    assert.equal(k.avisosPadrao('producao').gestao, false);
    assert.equal(k.avisosPadrao('despacho').gestao, true);
  });

  caso('avisos de cada tela: cancelado e alterado sempre; tipo desconhecido vale como alerta da loja', () => {
    const preparo = k.avisosPadrao('producao');
    assert.equal(k.recebeAviso(preparo, 'gestao'), false);
    assert.equal(k.recebeAviso(preparo, 'chegou'), false);
    assert.equal(k.recebeAviso(preparo, 'estoque'), true);
    assert.equal(k.recebeAviso({ ...preparo, loja: false }, 'cancelado'), true);
    assert.equal(k.recebeAviso({ ...preparo, loja: false }, 'alterado'), true);
    assert.equal(k.recebeAviso({ ...preparo, loja: false }, 'algo-novo'), false, 'desconhecido segue o "alertas da loja"');
    assert.equal(k.recebeAviso(preparo, undefined), true);
    // A aba "Avisos" mostra todos os tipos, e só cancelado/alterado travados.
    assert.deepEqual(k.AVISOS_DA_TELA.filter((t) => t.trava).map((t) => t.k), ['cancelado', 'alterado']);
    assert.deepEqual(k.AVISOS_DA_TELA.filter((t) => !t.trava).map((t) => t.k), [...k.TIPOS_DE_AVISO]);
  });

  caso('faixa da pausa: até quando e o contador; "reabre em" nos minutos do aviso; fim do dia sem contador; passou = reabriu', () => {
    const daqui = (s) => new Date(AGORA + s * 1000).toISOString();
    const ifood = { canal: 'ifood', nome: 'iFood', ate: daqui(754), motivo: 'Trocando o gás' };
    const f = k.faixaDaPausa(ifood, AGORA, 5);
    assert.match(f.texto, /^iFood pausado até \d{2}:\d{2}$/);
    assert.equal(f.detalhe, ' · Trocando o gás');
    assert.equal(f.contador, '12:34');
    assert.equal(f.logo, false);
    const logo = k.faixaDaPausa({ ...ifood, ate: daqui(299) }, AGORA, 5);
    assert.equal(logo.texto, 'iFood reabre em 5 min');
    assert.match(logo.detalhe, /^ · às \d{2}:\d{2} · Trocando o gás$/);
    assert.equal(logo.contador, '04:59');
    assert.equal(logo.logo, true);
    assert.equal(k.faixaDaPausa({ ...ifood, ate: daqui(299) }, AGORA, 0).logo, false, 'aviso desligado na loja: nunca âmbar');
    assert.equal(k.faixaDaPausa({ ...ifood, ate: daqui(2 * 3600 + 5) }, AGORA, 5).contador, '2:00:05');
    const da99 = k.faixaDaPausa({ canal: 'food99', nome: '99', ate: daqui(6 * 3600), fimDoDia: true, motivo: 'Sem entregador' }, AGORA, 5);
    assert.deepEqual(da99, { texto: '99 pausada até o fim do dia', detalhe: ' · Sem entregador', contador: null, logo: false });
    assert.equal(k.faixaDaPausa({ ...ifood, ate: daqui(0) }, AGORA, 5), null, 'a hora chegou: reabriu');
    assert.equal(k.faixaDaPausa({ ...ifood, ate: daqui(-30) }, AGORA, 5), null);
    assert.equal(k.faixaDaPausa({ ...ifood, ate: 'lixo' }, AGORA, 5), null);
    assert.equal(k.faixaDaPausa({ ...ifood, motivo: null }, AGORA, 5).detalhe, '');
  });

  caso('complementos um por linha: a MESMA regra da via impressa (backend/src/common/adicionais.ts)', () => {
    const exemplos = [
      '+ 2x Bacon · sem Cebola',
      'Batata média · 2x Coca-Cola',
      '- Picles · + Queijo extra',
      'sem cebola',
      'Molho barbecue, picante · Sem gelo',
      '',
      null,
      undefined,
    ];
    for (const t of exemplos) assert.deepEqual(k.linhasDasEscolhas(t), servidor.linhasDasEscolhas(t), `"${t}"`);
    assert.equal(k.SEPARADOR_ESCOLHAS, servidor.SEPARADOR_ESCOLHAS);
    assert.deepEqual(k.linhasDasEscolhas('Batata média · 2x Coca-Cola'), ['+ Batata média', '+ 2x Coca-Cola']);
  });

  // Auditoria do KDS (11/11/2026): o botão segue as etapas que a loja usa, como o servidor.
  caso('o botão segue as etapas da loja: sem "em preparo" diz Pronto; sem "entregue" o pronto não tem botão', () => {
    const semPreparo = { usaPreparo: false, usaEntregue: true };
    const semEntregue = { usaPreparo: true, usaEntregue: false };
    assert.equal(k.proximaAcaoNaEstacao('recebido', null, semPreparo), 'Pronto');
    assert.equal(k.proximaAcaoNaEstacao('recebido', 'Montagem', semPreparo), 'Pronto → Montagem');
    assert.equal(k.proximaAcaoNaEstacao('pronto', null, semEntregue), null);
    assert.equal(k.proximaAcaoNaEstacao('pronto', null, {}), 'Entregar');
    assert.equal(k.proximaAcaoNaEstacao('recebido', null, {}), 'Iniciar');
    assert.equal(k.proximaAcaoNaEstacao('preparo', null, semEntregue), 'Pronto');
  });

  caso('despacho: Despachar / chamar a senha só com as estações prontas; o gestor libera antes; depois, Entregue', () => {
    const delivery = { origem: 'delivery' };
    const balcao = { origem: 'balcao' };
    assert.deepEqual(k.acoesDoDespacho({ ...delivery, situacao: 'preparando' }), {
      principal: { acao: 'pronto', rotulo: 'Despachar', liberada: false },
      forcar: true,
    });
    assert.deepEqual(k.acoesDoDespacho({ ...balcao, situacao: 'pronto_para_despachar' }), {
      principal: { acao: 'pronto', rotulo: 'Pronto: chamar a senha', liberada: true },
      forcar: false,
    });
    assert.deepEqual(k.acoesDoDespacho({ ...balcao, situacao: 'pronto' }).principal, { acao: 'entregue', rotulo: 'Entregue (o cliente buscou)', liberada: true });
    assert.equal(k.acoesDoDespacho({ ...delivery, situacao: 'pronto' }).principal.rotulo, 'Entregue ao entregador');
    for (const s of ['cancelado', 'entregue', undefined]) assert.deepEqual(k.acoesDoDespacho({ ...delivery, situacao: s }), { principal: null, forcar: false });
  });

  caso('despacho: o andamento de cada estação, em palavras', () => {
    assert.equal(k.rotuloDaEstacao({ nome: 'Chapa', estado: 'feito' }, AGORA), 'Chapa ✓');
    assert.equal(k.rotuloDaEstacao({ nome: 'Chapa', estado: 'feito', forcado: true }, AGORA), 'Chapa ✓ (liberado pelo gestor)');
    assert.equal(k.rotuloDaEstacao({ nome: 'Chapa', estado: 'na_fila', desde: ha(7) }, AGORA), 'Chapa · na fila');
    assert.equal(k.rotuloDaEstacao({ nome: 'Montagem', estado: 'preparando', desde: ha(2) }, AGORA), 'Montagem · 2 min');
  });

  caso('despacho: o evento vem por cartão e acha o pedido inteiro (com o sub-filtro desta tela)', () => {
    const lista = [
      { comandaId: 'c1', origem: 'delivery', plataforma: 'iFood', cartoes: [{ id: 'k1' }, { id: 'k2' }] },
      { comandaId: 'c2', origem: 'delivery', plataforma: 'Anota Aí', cartoes: [{ id: 'k3' }] },
    ];
    assert.equal(k.pedidoDoDespachoNaTela(lista, 'k2', 'delivery', 'todos')?.comandaId, 'c1');
    assert.equal(k.pedidoDoDespachoNaTela(lista, 'k2', 'delivery', 'marketplace')?.comandaId, 'c1');
    assert.equal(k.pedidoDoDespachoNaTela(lista, 'k2', 'delivery', 'digital'), undefined);
    assert.equal(k.pedidoDoDespachoNaTela(lista, 'k9', 'todos', 'todos'), undefined);
  });

  // Pedido ALTERADO (mig 362): o item tirado fica no cartão (riscado, "Tirar") até o "Visto", mas não se produz.
  caso('pedido alterado: o tirado não soma nem se mistura com o igual que fica; o novo fica à parte', () => {
    const p = ped('a', 'preparo', 3, [
      it(1, 'Coca-Cola lata'),
      it(1, 'Coca-Cola lata', { status: 'removido' }),
      it(1, 'Batata', { status: 'novo' }),
      it(1, 'Batata'),
    ]);
    assert.deepEqual(
      k.agregarItens(p.itens).map((i) => `${i.quantidade} ${i.descricao} ${i.status ?? 'ok'}`),
      ['1 Coca-Cola lata ok', '1 Coca-Cola lata removido', '1 Batata novo', '1 Batata ok'],
    );
    const grupos = k.agruparPorItem([p], AGORA);
    assert.equal(grupos.find((g) => g.descricao === 'Coca-Cola lata').quantidade, 1); // o tirado aparece, não soma
    assert.equal(grupos.find((g) => g.descricao === 'Batata').quantidade, 2);
    // Só o tirado: nada a produzir — sai do resumo; e não acende o pedido como "leva o item".
    const soTirado = ped('b', 'preparo', 2, [it(1, 'Suco', { status: 'removido' })]);
    assert.equal(k.somarItens([soTirado]).length, 0);
    assert.equal(k.pedidoTemItem(soTirado, 'Suco'), false);
    assert.equal(k.somarItens([p, soTirado]).find((i) => i.descricao === 'Coca-Cola lata').pedidos, 1);
  });

  caso('pedido alterado: o rodapé diz a troca numa frase, ou o que entra e o que sai (só a última alteração)', () => {
    const em = '2026-11-04T19:51:00.000Z';
    const antes = '2026-11-04T19:40:00.000Z';
    const troca = { alteradoEm: em, itens: [it(1, 'Guaraná', { status: 'novo', mudouEm: em }), it(1, 'Coca-Cola lata', { status: 'removido', mudouEm: em })] };
    assert.equal(k.textoDaAlteracao(troca), 'troca de 1 Coca-Cola lata por 1 Guaraná');
    const por = { alteradoEm: em, itens: [it(2, 'Batata', { status: 'novo', mudouEm: em }), it(1, 'Suco', { status: 'novo', mudouEm: antes })] };
    assert.equal(k.textoDaAlteracao(por), '+ 2 Batata');
    assert.equal(k.textoDaAlteracao({ alteradoEm: em, itens: [] }), 'o pedido mudou');
  });

  console.log(`\ncheck:kds — ${n} casos, tudo certo`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
