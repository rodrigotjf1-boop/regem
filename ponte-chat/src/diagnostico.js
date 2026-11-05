'use strict';

// O DIAGNÓSTICO DA LIGAÇÃO "conversa do chat × pedido" — o que falta para a ponte dizer de QUAL pedido é cada mensagem
// (a conversa do iFood é um canal do Sendbird, `sendbird_gc_cm_<id>_<id>`; o Gestor abre o chat pelo pedido, em
// `orderManager/v1.0/chat/orders/<id do pedido>`). Fica só neste PC, em `diagnostico.jsonl` na pasta de dados do programa:
// nenhum texto, nome ou telefone — cada id vira uma MARCA de 12 letras (sha-256 com um sal deste PC), que só serve para
// comparar: o mesmo id dá a mesma marca, nos dois lados. Arquivo com teto (5 MB, guarda o anterior como `.1`).

const crypto = require('crypto');
const fs = require('fs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANAL = /^sendbird_[a-z_]*?_?[0-9a-f-]{8,}/i;
const CHAVE_DE_ID = /(^id$|_id$|Id$|^uuid$|url$|Url$|^channel$|^displayId$|^shortReference$|^code$)/;

class Diagnostico {
  constructor(arquivo, sal, { maxBytes = 5 * 1024 * 1024, gravar = true } = {}) {
    this.arquivo = arquivo;
    this.sal = String(sal || '');
    this.maxBytes = maxBytes;
    this.gravar = gravar;
    this.ultimos = []; // os últimos registros (o teste lê daqui)
  }

  marca(v) {
    if (v === undefined || v === null || v === '') return null;
    return crypto.createHash('sha256').update(`${this.sal}|${String(v)}`).digest('hex').slice(0, 12);
  }

  /** "sendbird_gc_cm_<a>_<b>" → ["sendbird","gc","cm","<marca a>","<marca b>"]: as palavras ficam, os ids viram marca. */
  canal(url) {
    if (typeof url !== 'string' || !url) return null;
    return url.split('_').map((p) => (/^[a-z]{1,12}$/i.test(p) ? p : this.marca(p)));
  }

  /** O endereço com cada id trocado pela marca (a forma do caminho fica; o id não). */
  endereco(url) {
    try {
      const u = new URL(url);
      const caminho = u.pathname
        .split('/')
        .map((p) => (UUID.test(p) || CANAL.test(p) || /^\d{4,}$/.test(p) ? `<${this.marca(p)}>` : p))
        .join('/');
      return `${u.host}${caminho}`;
    } catch {
      return null;
    }
  }

  /** Todos os ids e endereços de canal dentro de um JSON (até 6 níveis, 400 valores), como marca e com o caminho. */
  varrer(json) {
    const achados = [];
    let n = 0;
    const andar = (v, caminho, nivel) => {
      if (n > 400 || nivel > 6 || v === null || v === undefined) return;
      if (Array.isArray(v)) {
        v.slice(0, 20).forEach((x, i) => andar(x, `${caminho}[${i}]`, nivel + 1));
        return;
      }
      if (typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) andar(x, caminho ? `${caminho}.${k}` : k, nivel + 1);
        return;
      }
      const chave = caminho.split('.').pop().replace(/\[\d+\]$/, '');
      const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
      if (s === null) return;
      if (CANAL.test(s)) {
        n++;
        achados.push({ caminho, canal: this.canal(s) });
      } else if (UUID.test(s) || (CHAVE_DE_ID.test(chave) && s.length <= 120)) {
        n++;
        achados.push({ caminho, marca: this.marca(s) });
      }
    };
    andar(json, '', 0);
    return achados;
  }

  /** A forma do campo `data` da mensagem: JSON (as chaves), texto (o tamanho) ou vazio. */
  formaDoData(d) {
    if (typeof d !== 'string' || !d) return '';
    try {
      const j = JSON.parse(d);
      return j && typeof j === 'object' ? { json: Object.keys(j).slice(0, 20), ids: this.varrer(j) } : `<texto ${d.length}>`;
    } catch {
      return `<texto ${d.length}>`;
    }
  }

  /** Uma mensagem do chat (MESG) que chegou. */
  mesg(corpo) {
    if (!corpo || typeof corpo !== 'object') return;
    const u = corpo.user && typeof corpo.user === 'object' ? corpo.user : {};
    this.anotar({
      ev: 'mesg',
      tipo: u.metadata && u.metadata.type ? String(u.metadata.type) : null,
      msg: this.marca(corpo.msg_id),
      canal: this.canal(corpo.channel_url),
      usuario: this.marca(u.id),
      convidado: this.marca(u.guest_id),
      custom: typeof corpo.custom_type === 'string' ? corpo.custom_type : null,
      data: this.formaDoData(corpo.data),
    });
  }

  /** A resposta de uma chamada do Gestor (o chat do pedido, o pedido, o canal): onde aparecem os ids, como marca. */
  resposta(url, json) {
    this.anotar({ ev: 'resposta', url: this.endereco(url), chaves: json && typeof json === 'object' ? Object.keys(json).slice(0, 30) : null, ids: this.varrer(json) });
  }

  anotar(obj) {
    const linha = { t: new Date().toISOString(), ...obj };
    this.ultimos.push(linha);
    if (this.ultimos.length > 50) this.ultimos.shift();
    if (!this.gravar || !this.arquivo) return;
    try {
      const st = fs.existsSync(this.arquivo) ? fs.statSync(this.arquivo) : null;
      if (st && st.size > this.maxBytes) fs.renameSync(this.arquivo, `${this.arquivo}.1`);
      fs.appendFileSync(this.arquivo, `${JSON.stringify(linha)}\n`);
    } catch {
      /* disco cheio ou sem permissão: o diagnóstico não atrapalha a ponte */
    }
  }
}

/** Os endereços do Gestor cujo corpo interessa ao diagnóstico (o chat do pedido, o pedido, o canal do chat). */
function interessa(url) {
  return /order-manager-api\.ifood\.com\.br\/orderManager\/v1\.0\/chat\//i.test(url)
    || /(merchant-api|order-manager-api)\.ifood\.com\.br\/.*\/orders?\//i.test(url)
    || /sendbird\.com\/v3\/(sdk\/)?group_channels\//i.test(url);
}

module.exports = { Diagnostico, interessa };
