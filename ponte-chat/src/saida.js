'use strict';

// O ENVIO AUTOMÁTICO PELA FILA DA NUVEM (v0.4). A nuvem enfileira o que tem de sair pelo chat do iFood (os avisos "saiu" e
// "chegando"; depois, o robô e a equipe); a ponte que RESPONDE pelo canal pega a vez (`saida/pegar` — até 10, cada uma por
// 90 s e com uma tentativa gasta) e devolve o resultado (`saida/<id>/resultado`). Este trabalhador:
//  1. só pede a fila com a ponte pareada, LIGADA, respondendo pelo iFood, logada — e com a TELA DO GESTOR LIVRE (ninguém
//     mexendo, no quadro "Pedidos", sem rascunho no campo): pedir com a tela ocupada gastaria tentativa à toa;
//  2. para cada mensagem: a regra do texto (a mesma da nuvem) e o número do pedido; depois, "JÁ ESTÁ NO CHAT?" — a mesma
//     mensagem da loja, com o mesmo texto, na conversa do pedido depois de o aviso nascer (a memória do leitor) ou o eco
//     anotado no diário: dá por enviada sem digitar de novo. Diário com "apertei" e sem prova: abre a conversa (o Gestor
//     carrega o histórico) e confere; sem prova ainda, NÃO digita de novo — devolve "incerto" (definitivo);
//  3. envia pelo caminho da v0.3 (as três conferências, o eco escutado antes — ERR-375), sem o teclado (não rouba o foco
//     de quem usa outro programa no PC), anotando "apertei" no diário ANTES do clique; se a pessoa voltar a mexer, desiste;
//  4. devolve à nuvem: enviada (com o id do eco) ou o motivo — "fora do quadro", texto proibido e "incerto" são
//     definitivos (não adianta tentar de novo); tela ocupada, conferência que falhou e afins voltam para a fila.

const { motivoParaNaoEnviar } = require('./regras');

const NUMERO = /^\d{3,6}$/;
const NUMERO_99 = /^\d{4,8}$/; // o número do pedido na 99 (6 dígitos hoje)
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

class Saida {
  /**
   * @param {object} o
   * @param {() => ({ ok: boolean, motivo?: string })} o.podeTrabalhar  pareada, ligada, responde, logada, sem "só observar"
   * @param {() => Promise<{ ok: boolean, motivo?: string }>} o.telaLivre
   * @param {(desde: number) => Promise<boolean>} o.pessoaMexeuDesde
   * @param {(item: object, opcoes: object) => Promise<object>} o.enviarItem  abre a conversa, envia e volta a tela
   * @param {(item: object) => Promise<object>} o.abrirSemEnviar  abre a conversa (o Gestor carrega o histórico) e volta
   * @param {(pedidoExterno: string, desde: number) => Promise<void>} [o.esperarHistorico]  espera o histórico da conversa chegar
   * @param {(q: object) => ({ id: string } | null)} o.jaEnviada  a memória do leitor
   * @param {import('./jornal').Jornal} o.jornal
   * @param {{ pegar: Function, resultado: Function, classificar: Function }} o.nuvem
   * @param {() => object} o.credencial
   * @param {(c: string) => void} [o.tratarClassificacao]  revogado e afins (o mesmo tratamento do sinal de vida)
   * @param {(ev: object) => void} [o.anotar]  o diagnóstico (só marcas)
   * @param {(v: string) => string} [o.marca]
   */
  constructor(o) {
    Object.assign(this, { esperaTelaMs: 45000, passoTelaMs: 2000, canal: 'ifood', anotar: () => {}, marca: () => null, tratarClassificacao: () => {}, esperarHistorico: async () => {} }, o);
    // os textos por canal (a 99 desde a 4b): "pelo iFood" × "pela 99", "do Gestor" × "da 99"
    const n99 = this.canal === '99food';
    this.txt = { pelo: n99 ? 'pela 99' : 'pelo iFood', no: n99 ? 'na 99' : 'no iFood', tela: n99 ? 'da 99' : 'do Gestor', onde: n99 ? 'no portal da 99' : 'no Gestor', numero: n99 ? NUMERO_99 : NUMERO };
    this.rodando = false;
    this.situacao = 'aguardando';
    this.enviadas = 0;
  }

  /**
   * A situação da volta. Quando MUDA, vai ao diagnóstico (`saida_situacao`): em 08/11, das 19:15 às 20:45, a fila do iFood
   * ficou parada (nada pegou, 11 avisos venceram) e o motivo só existia na memória — os motivos são textos fixos do
   * programa (sem nome de cliente, sem texto de mensagem).
   */
  parar(situacao) {
    if (situacao !== this.situacao) this.anotar({ ev: 'saida_situacao', de: String(this.situacao).slice(0, 160), para: String(situacao).slice(0, 160) });
    this.situacao = situacao;
    return { situacao };
  }

  /** Uma volta: pede a fila (se der) e trata cada mensagem, uma de cada vez. */
  async volta() {
    if (this.rodando) return { situacao: this.situacao, pulou: true };
    this.rodando = true;
    try {
      const p = this.podeTrabalhar();
      if (!p.ok) return this.parar(p.motivo);
      const t = await this.telaLivre();
      if (!t.ok) return this.parar(`esperando a tela ${this.txt.tela} (${t.motivo})`);
      const cred = this.credencial();
      const r = await this.nuvem.pegar(cred, this.canal);
      const c = this.nuvem.classificar(r);
      if (c !== 'ok') {
        this.tratarClassificacao(c);
        return this.parar(`a nuvem não entregou a fila (${c})`);
      }
      const { papel, itens } = r.dados || {};
      if (papel !== 'responde') return this.parar(papel === 'desligada' ? 'ponte desligada nos ajustes' : `este PC não responde ${this.txt.pelo} (${papel || 'fora'})`);
      if (!Array.isArray(itens) || !itens.length) return this.parar('em dia');
      this.anotar({ ev: 'saida_pegou', n: itens.length });
      for (const item of itens) await this.tratar(cred, item);
      return this.parar('em dia');
    } finally {
      this.rodando = false;
    }
  }

  async devolver(cred, item, corpo, etapa) {
    const r = await this.nuvem.resultado(cred, item.id, corpo);
    // 409 = a mensagem não está mais com esta ponte (já saiu, venceu o prazo, foi cancelada): nada mais a fazer com ela
    if (r.ok || r.status === 409) this.jornal.fim(item.id);
    this.anotar({ ev: 'saida_item', item: this.marca(item.id), etapa, ok: corpo.ok === true, definitivo: corpo.definitivo === true, nuvem: r.ok ? 'ok' : r.status || 'rede' });
    return { etapa, nuvem: r };
  }

  /** Uma mensagem da fila. */
  async tratar(cred, item) {
    const texto = String((item && item.texto) || '');
    const motivo = motivoParaNaoEnviar(texto);
    if (motivo) return this.devolver(cred, item, { ok: false, erro: `o texto não pode sair pelo chat: ${motivo}`, definitivo: true }, 'texto_proibido');
    const numero = String(item.pedidoNumero || '');
    if (!this.txt.numero.test(numero)) return this.devolver(cred, item, { ok: false, erro: `a mensagem veio sem o número do pedido ${this.txt.no}`, definitivo: true }, 'sem_numero');
    const q = { pedidoExterno: item.pedidoExterno, texto, desde: Date.parse(item.criadoEm) || 0 };

    // 1) JÁ ESTÁ NO CHAT? — a ponte mandou e caiu antes de avisar a nuvem, ou alguém da loja mandou o mesmo texto
    const j = this.jornal.de(item.id);
    let ja = this.jaEnviada(q) || (j && j.ecoId ? { id: j.ecoId } : null);
    if (!ja && j && j.apertouEm) {
      await this.abrirSemEnviar(item).catch(() => null);
      ja = this.jaEnviada(q);
      if (!ja)
        return this.devolver(cred, item, { ok: false, erro: `envio incerto: o programa já tinha apertado "Enviar" e a mensagem não apareceu no chat — confira ${this.txt.onde}`, definitivo: true }, 'incerto_antes');
    }
    if (ja) {
      this.jornal.eco(item.id, ja.id);
      return this.devolver(cred, item, { ok: true, id: ja.id }, 'ja_estava');
    }

    // 2) a tela livre de novo (pode ter mudado desde o pegar): espera um pouco, dentro do prazo da mensagem
    const fim = Date.now() + this.esperaTelaMs;
    let livre = await this.telaLivre();
    while (!livre.ok && Date.now() < fim) {
      await esperar(this.passoTelaMs);
      livre = await this.telaLivre();
    }
    if (!livre.ok) return this.devolver(cred, item, { ok: false, erro: `esperando a tela ${this.txt.tela}: ${livre.motivo}` }, 'tela_ocupada');

    // 3) envia
    const inicio = Date.now();
    const r = await this.enviarItem(item, {
      aoApertar: async () => this.jornal.apertou(item.id),
      podeApertar: async () => !(await this.pessoaMexeuDesde(inicio)),
      // com a conversa aberta o Gestor carrega o histórico: confere de novo antes de digitar (vale sem o diário também)
      jaEstaNoChat: async () => {
        await this.esperarHistorico(item.pedidoExterno, inicio);
        return this.jaEnviada(q);
      },
    });
    if (r && r.ok) {
      this.jornal.eco(item.id, r.id);
      if (!r.jaEstava) this.enviadas += 1;
      return this.devolver(cred, item, { ok: true, id: r.id }, r.jaEstava ? 'ja_estava_no_historico' : 'enviada');
    }
    if (r && (r.incerto || r.apertou)) {
      // apertou e o eco não voltou no prazo: ele pode ter chegado depois — confere a memória mais uma vez
      const tarde = this.jaEnviada(q);
      if (tarde) {
        this.jornal.eco(item.id, tarde.id);
        this.enviadas += 1;
        return this.devolver(cred, item, { ok: true, id: tarde.id }, 'eco_tarde');
      }
      return this.devolver(cred, item, { ok: false, erro: `envio incerto: o programa apertou "Enviar" e a mensagem não voltou pelo chat — confira ${this.txt.onde}`, definitivo: true }, 'incerto');
    }
    const ultima = ((r && r.etapas) || []).slice(-1)[0] || '';
    const erro = ultima.replace(/^✗\s*/, '') || 'não deu para enviar';
    if (r && (r.codigo === 'fora_do_quadro' || r.definitivo === true)) return this.devolver(cred, item, { ok: false, erro, definitivo: true }, r.codigo || 'definitivo');
    return this.devolver(cred, item, { ok: false, erro }, (r && r.codigo) || 'falhou');
  }
}

module.exports = { Saida };
