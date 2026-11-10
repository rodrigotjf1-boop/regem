import 'package:flutter/material.dart';
import '../theme.dart';
import 'regem_mark.dart';

// DE ONDE VEIO O PEDIDO, COMO NO PAINEL (pedido do dono, 09/11/2026): a logo pequena do canal na lista do entregador. As
// logos são os mesmos arquivos do painel (frontend/public/integracoes → assets/canais). Pedido do cardápio do Regem: a logo
// da loja (o servidor manda `logoDaLoja`); sem logo cadastrada, a marca do Regem.

const _arquivos = {
  'ifood': 'assets/canais/ifood.png',
  '99food': 'assets/canais/99food.png',
  'anotaai': 'assets/canais/anotaai.png',
  'cardapio_web': 'assets/canais/cardapio-web.png',
  'delivery_direto': 'assets/canais/delivery-direto.png',
  'keeta': 'assets/canais/keeta.png',
  'rappi': 'assets/canais/rappi.jpg',
};

// Os mesmos nomes do painel (Delivery › Painel, coluna Origem).
const _rotulos = {
  'ifood': 'iFood',
  'cardapio': 'Cardápio',
  'cardapio_web': 'Cardápio Web',
  'anotaai': 'Anota Aí',
  'keeta': 'Keeta',
  'rappi': 'Rappi',
  '99food': '99Food',
  'delivery_direto': 'Delivery Direto',
  'totem': 'Totem',
  'whatsapp': 'WhatsApp',
  'manual': 'Manual',
};

String rotuloDoCanal(dynamic canal) => _rotulos[canal?.toString()] ?? 'Cardápio';

/// "iFood · 0432" — o canal e o código do pedido NO CANAL (o "Cód. ext." do painel); sem ele, o número do Regem.
String tituloDoPedido(Map pedido) {
  final cod = pedido['displayId']?.toString().trim() ?? '';
  final numero = pedido['numero']?.toString() ?? '';
  return '${rotuloDoCanal(pedido['canal'])} · ${cod.isNotEmpty ? cod : '#$numero'}';
}

class LogoDoCanal extends StatelessWidget {
  final dynamic canal;
  final String? logoDaLoja;
  final double tamanho;
  const LogoDoCanal({super.key, required this.canal, this.logoDaLoja, this.tamanho = 36});

  Widget _regem() => RegemMark(size: tamanho, cor: kOuro, fundo: kNavy);

  @override
  Widget build(BuildContext context) {
    final arquivo = _arquivos[canal?.toString()];
    final raio = BorderRadius.circular(tamanho * 0.22);
    Widget img;
    if (arquivo != null) {
      img = Image.asset(arquivo, width: tamanho, height: tamanho, fit: BoxFit.cover);
    } else if (logoDaLoja != null && logoDaLoja!.startsWith('https://')) {
      img = Image.network(
        logoDaLoja!,
        width: tamanho,
        height: tamanho,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => _regem(),
      );
    } else {
      return Semantics(label: rotuloDoCanal(canal), child: _regem());
    }
    return Semantics(
      label: rotuloDoCanal(canal),
      child: ClipRRect(borderRadius: raio, child: img),
    );
  }
}
