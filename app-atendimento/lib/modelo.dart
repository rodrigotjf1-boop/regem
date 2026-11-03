// O CASO DA CENTRAL DE ATENDIMENTO, como a rota `GET atendimento/fila` devolve (a mesma da tela do computador). Os
// rótulos e as contas são os de `frontend/src/lib/atendimento.ts` — o app fala igual à tela.

const rotuloDoTipo = <String, String>{
  'mudanca': 'Mudança no pedido',
  'erro': 'Problema no pedido',
  'humano': 'Quer falar com alguém',
  'cancelamento': 'Pedido de cancelamento',
  'outro': 'Atendimento',
  'disputa': 'Disputa',
  'cancelamento_99': 'Cancelamento pedido à 99',
  'reembolso_99': 'Reembolso pedido à 99',
};

/// Casos que se resolvem pela resposta à plataforma (ou pelo prazo dela): "aguardar" e "resolver" à mão os esconderiam.
const casoDaPlataforma = {'disputa', 'cancelamento_99', 'reembolso_99'};

const rotuloDoCanal = <String, String>{
  'whatsapp': 'WhatsApp',
  'ifood': 'iFood',
  '99food': '99Food',
  'cardapio': 'Cardápio',
  'balcao': 'Balcão',
};

class Caso {
  final Map<String, dynamic> bruto;
  Caso(this.bruto);

  String get id => '${bruto['id']}';
  String get tipo => '${bruto['tipo'] ?? 'outro'}';
  String? get canal => bruto['canal'] as String?;
  String? get cliente => bruto['cliente'] as String?;
  String? get telefone => bruto['telefone'] as String?;
  String? get mensagem => bruto['mensagem'] as String?;
  bool get urgente => bruto['prioridade'] == 'urgente';
  String get situacao => '${bruto['situacao'] ?? 'fila'}';
  String? get responsavelId => bruto['responsavelId'] as String?;
  String? get responsavelNome => bruto['responsavelNome'] as String?;
  DateTime? get prazoEm => _data(bruto['prazoEm']);
  DateTime? get criadoEm => _data(bruto['criadoEm']);
  DateTime? get pegoEm => _data(bruto['pegoEm']);
  DateTime? get resolvidoEm => _data(bruto['resolvidoEm']);
  String? get resolvidoPorNome => bruto['resolvidoPorNome'] as String?;
  int? get posicao => (bruto['posicao'] as num?)?.toInt();
  Map<String, dynamic> get detalhe => (bruto['detalhe'] is Map) ? Map<String, dynamic>.from(bruto['detalhe'] as Map) : const {};

  bool get daPlataforma => casoDaPlataforma.contains(tipo);
  bool get aberto => situacao != 'resolvido';
  String get rotulo => rotuloDoTipo[tipo] ?? 'Atendimento';
  String get rotuloCanal => rotuloDoCanal[canal ?? ''] ?? (canal ?? 'Atendimento');

  /// "Ana P. · pedido iFood 4521": cliente + plataforma + número (o da plataforma quando há; senão o da loja).
  String get titulo {
    final quem = (cliente?.isNotEmpty ?? false) ? cliente! : ((bruto['pedidoCliente'] as String?) ?? 'Cliente');
    final plataforma = canal == 'ifood' ? 'iFood' : canal == '99food' ? '99Food' : '';
    final daPlat = bruto['pedidoNaPlataforma'] as String?;
    final numero = (daPlat != null && plataforma.isNotEmpty) ? daPlat : bruto['pedidoNumero']?.toString();
    if (numero == null || numero.isEmpty) return quem;
    return '$quem · pedido ${plataforma.isNotEmpty ? '$plataforma ' : '#'}$numero';
  }

  /// O que o robô anotou (resumo em linhas: motivo, o que quer, o que já fez).
  Map<String, dynamic>? get robo => detalhe['robo'] is Map ? Map<String, dynamic>.from(detalhe['robo'] as Map) : null;

  /// A linha curta da fila: o motivo do robô, ou a mensagem.
  String? get linhaCurta {
    final r = robo;
    final partes = [r?['motivo'], r?['quer']].whereType<String>().where((s) => s.trim().isNotEmpty).toList();
    if (partes.isNotEmpty) return partes.join(' · ');
    final m = mensagem?.replaceAll(RegExp(r'\s+'), ' ').trim();
    return (m == null || m.isEmpty) ? null : m;
  }

  /// O aviso ao gerente (mig 353): ninguém pegou no tempo do ajuste. Só vale enquanto o caso está na fila.
  ({DateTime em, int minutos})? get escalado {
    final e = detalhe['escalado'];
    if (situacao != 'fila' || e is! Map) return null;
    final em = _data(e['em']);
    if (em == null) return null;
    return (em: em, minutos: (e['minutos'] as num?)?.toInt() ?? 0);
  }
}

DateTime? _data(dynamic v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;

/// "agora", "4 min", "1 h 20 min" desde o instante.
String tempoDesde(DateTime? t, DateTime agora) {
  if (t == null) return '';
  final min = agora.difference(t).inMinutes;
  if (min < 1) return 'agora';
  if (min < 60) return '$min min';
  final h = min ~/ 60;
  return '$h h${min % 60 > 0 ? ' ${min % 60} min' : ''}';
}

/// "06:12" (ou "1:02:03") até o prazo; "venceu" depois.
String tempoAte(DateTime? t, DateTime agora) {
  if (t == null) return '';
  final s = t.difference(agora).inSeconds;
  if (s <= 0) return 'venceu';
  String dd(int n) => n.toString().padLeft(2, '0');
  return s >= 3600 ? '${s ~/ 3600}:${dd((s % 3600) ~/ 60)}:${dd(s % 60)}' : '${dd(s ~/ 60)}:${dd(s % 60)}';
}

String hora(DateTime? t) => t == null ? '' : '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

/// O número no formato do WhatsApp (55 + DDD + número).
String numeroDoWhatsapp(String? t) {
  final d = (t ?? '').replaceAll(RegExp(r'\D'), '');
  return d.length == 10 || d.length == 11 ? '55$d' : d;
}

/// O mesmo número com ou sem 55 e com ou sem o 9 (a mesma regra da caixa de conversas).
bool mesmoNumero(String? a, String? b) {
  final x = (a ?? '').replaceAll(RegExp(r'\D'), '');
  final y = (b ?? '').replaceAll(RegExp(r'\D'), '');
  if (x.isEmpty || y.isEmpty) return false;
  final cx = x.length >= 8 ? x.substring(x.length - 8) : x;
  final cy = y.length >= 8 ? y.substring(y.length - 8) : y;
  return x == y || x.endsWith(y) || y.endsWith(x) || cx == cy;
}

/// Respostas prontas por motivo do caso — vão para o campo, nunca saem sozinhas (as mesmas da tela).
const prontasDoTipo = <String, List<String>>{
  'geral': ['Oi! Aqui é da equipe da loja, vou te ajudar por aqui.', 'Já estou verificando e te respondo em instantes.', 'Pode me mandar uma foto, por favor?', 'Prontinho, resolvido! Obrigado pela paciência.'],
  'erro': ['Sinto muito pelo problema. Vou resolver agora com você.', 'Pode me mandar uma foto do pedido, por favor?', 'Já estou verificando com a cozinha e te respondo em instantes.'],
  'mudanca': ['Consigo ver a mudança, sim. Me confirma o que você quer trocar?', 'Já estou verificando se ainda dá para mudar e te respondo em instantes.'],
  'humano': ['Oi! Aqui é da equipe da loja. Em que posso ajudar?', 'Já estou verificando e te respondo em instantes.'],
  'outro': ['Recebi, obrigado! Já estou verificando e te respondo em instantes.', 'O entregador já foi avisado.'],
};

/// Os motivos do iFood (`negotiationReasons` e os de aceite), como a equipe fala (os mesmos da tela).
const motivoIfood = <String, String>{
  'HIGH_STORE_DEMAND': 'Loja em capacidade máxima',
  'UNKNOWN_ISSUE': 'Problema não especificado',
  'CUSTOMER_SATISFACTION': 'Satisfação do cliente',
  'INVENTORY_CHECK': 'Verificação de disponibilidade',
  'SYSTEM_ISSUE': 'Problema técnico',
  'WRONG_ORDER': 'Pedido incorreto',
  'PRODUCT_QUALITY': 'Qualidade do produto',
  'LATE_DELIVERY': 'Entrega atrasada',
  'CUSTOMER_REQUEST': 'Solicitação do cliente',
};

/// O que o iFood faz sozinho se ninguém responder (`timeoutAction`).
const sozinhoIfood = <String, String>{
  'ACCEPT_CANCELLATION': 'o iFood aceita sozinho: cancela e o cliente recebe o valor de volta.',
  'REJECT_CANCELLATION': 'o iFood recusa sozinho o pedido do cliente.',
  'VOID': 'nada acontece sozinho, mas a loja perde a chance de responder.',
};

const nomeDaProposta = <String, String>{
  'REFUND': 'Devolver parte do valor',
  'BENEFIT': 'Crédito para o cliente no iFood',
  'ADDITIONAL_TIME': 'Pedir mais tempo',
};

/// Os motivos de recusa do CANCELAMENTO da 99 (`reason_list`), como a equipe fala.
const motivoCancelamento99 = <String, String>{
  'preparing': 'O pedido já está em preparo',
  'prepared': 'O pedido já está pronto',
  'courier arrived': 'O entregador já chegou à loja',
  'courier taken': 'O entregador já levou o pedido',
};

String traduzir(Map<String, String> mapa, String? s) {
  if (s == null || s.isEmpty) return '';
  for (final k in mapa.keys) {
    if (k.toLowerCase() == s.trim().toLowerCase()) return mapa[k]!;
  }
  return s;
}

String brl(int centavos) {
  final reais = (centavos / 100).toStringAsFixed(2).replaceAll('.', ',');
  return 'R\$ $reais';
}
