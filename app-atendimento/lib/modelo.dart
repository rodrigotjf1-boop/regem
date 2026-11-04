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

  /// O endereço novo do pedido que JÁ SAIU (PR 3b-2): o que o robô anotou no caso "Mudança no pedido".
  EnderecoDoCaso? get endereco => tipo == 'mudanca' ? EnderecoDoCaso.ler(detalhe) : null;

  /// Em que pé está a mudança de endereço feita pelo caso (a fila lê da alteração do pedido).
  EstadoDaMudanca? get mudancaDoEndereco => EstadoDaMudanca.de(bruto['mudancaDoEndereco']);

  /// O número do pedido na loja (o "#951" do título).
  String? get pedidoNumero => bruto['pedidoNumero']?.toString();

  /// A situação do pedido ligado (o "Em rota" é `despachado`).
  String? get pedidoStatus => bruto['pedidoStatus'] as String?;
}

// ===================== O endereço depois que o pedido saiu (PR 3b-2) =====================
// Os textos e as contas são os da tela do computador (`frontend/src/lib/endereco-do-caso.ts`); a regra mora no servidor
// (`backend/src/modules/atendimento/endereco-depois-que-saiu.ts`) — o app só lê e escreve para a tela.

/// Um endereço como o caso guarda: rua, número, bairro e o complemento ou ponto de referência.
class EnderecoCurto {
  final String? rua;
  final String? numero;
  final String? bairro;
  final String? referencia;
  const EnderecoCurto({this.rua, this.numero, this.bairro, this.referencia});

  static EnderecoCurto de(dynamic m) {
    String? t(dynamic v) => v == null || '$v'.trim().isEmpty ? null : '$v'.trim();
    if (m is! Map) return const EnderecoCurto();
    return EnderecoCurto(rua: t(m['rua']), numero: t(m['numero']), bairro: t(m['bairro']), referencia: t(m['referencia']));
  }

  /// "Rua das Flores, 120 · Centro".
  String get emUmaLinha {
    final rn = [rua, numero].whereType<String>().join(', ');
    return [rn, bairro ?? ''].where((s) => s.isNotEmpty).join(' · ');
  }

  /// "Rua Ipê, 45".
  String get ruaENumero {
    final r = [rua, numero].whereType<String>().join(', ');
    return r.isNotEmpty ? r : emUmaLinha;
  }
}

class EnderecoDoCaso {
  final String pedidoId;
  final String? numero;
  final EnderecoCurto de;
  final EnderecoCurto para;
  final double taxaAntes;
  /// null = o endereço novo fica fora da área de entrega.
  final double? taxaNova;
  final double total;
  /// O que o entregador recebe hoje (a conta do servidor).
  final double aReceber;
  /// A conta com a taxa nova (total e o que receber) — ou por que não dá; nenhum = fora da área.
  final ({double total, double aReceber})? contaDaNova;
  final String? recusaDaNova;
  final bool pagoAntes;
  final String? formaPagamento;
  final double? trocoPara;
  final String? entregadorNome;
  final String? entregadorTelefone;
  final DateTime? saiuEm;
  /// A chave `distancia` existe? (ausente = ainda medindo; nula = não deu para medir)
  final bool medida;
  final ({double km, int? min, bool peloCaminho})? distancia;
  final ({DateTime? em, String? porNome, double taxa, String alteracaoId})? mudado;

  const EnderecoDoCaso({
    required this.pedidoId,
    required this.numero,
    required this.de,
    required this.para,
    required this.taxaAntes,
    required this.taxaNova,
    required this.total,
    required this.aReceber,
    required this.contaDaNova,
    required this.recusaDaNova,
    required this.pagoAntes,
    required this.formaPagamento,
    required this.trocoPara,
    required this.entregadorNome,
    required this.entregadorTelefone,
    required this.saiuEm,
    required this.medida,
    required this.distancia,
    required this.mudado,
  });

  static double? _n(dynamic v) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) : null);

  /// O endereço do caso (null = o caso não tem — o que não tem a forma certa conta como nenhum).
  static EnderecoDoCaso? ler(Map<String, dynamic> detalhe) {
    final e = detalhe['endereco'];
    if (e is! Map || e['pedidoId'] is! String || e['para'] is! Map) return null;
    final nova = e['comANova'];
    final d = e['distancia'];
    final m = e['mudado'];
    final ent = e['entregador'];
    return EnderecoDoCaso(
      pedidoId: e['pedidoId'] as String,
      numero: e['numero']?.toString(),
      de: EnderecoCurto.de(e['de']),
      para: EnderecoCurto.de(e['para']),
      taxaAntes: _n(e['taxaAntes']) ?? 0,
      taxaNova: _n(e['taxaNova']),
      total: _n(e['total']) ?? 0,
      aReceber: _n(e['aReceber']) ?? _n(e['total']) ?? 0,
      contaDaNova: nova is Map && nova['total'] != null ? (total: _n(nova['total']) ?? 0, aReceber: _n(nova['aReceber']) ?? 0) : null,
      recusaDaNova: nova is Map && nova['recusa'] is String ? nova['recusa'] as String : null,
      pagoAntes: e['pagoAntes'] == true,
      formaPagamento: e['formaPagamento'] as String?,
      trocoPara: (_n(e['trocoPara']) ?? 0) > 0 ? _n(e['trocoPara']) : null,
      entregadorNome: ent is Map ? ent['nome'] as String? : null,
      entregadorTelefone: ent is Map ? ent['telefone'] as String? : null,
      saiuEm: ent is Map ? _data(ent['saiuEm']) : null,
      medida: e.containsKey('distancia'),
      distancia: d is Map && _n(d['km']) != null ? (km: _n(d['km'])!, min: (d['min'] as num?)?.toInt(), peloCaminho: d['pelo'] == 'caminho') : null,
      mudado: m is Map && m['alteracaoId'] is String
          ? (em: _data(m['em']), porNome: m['porNome'] as String?, taxa: _n(m['taxa']) ?? 0, alteracaoId: m['alteracaoId'] as String)
          : null,
    );
  }

  /// "2,4 km pelo caminho (≈ 7 min de moto)" · "2,4 km em linha reta" · "medindo…" · "não deu para medir".
  String get textoDaDistancia {
    if (!medida) return 'medindo…';
    final d = distancia;
    if (d == null) return 'não deu para medir (confira no mapa)';
    final km = '${d.km.toStringAsFixed(1).replaceAll('.', ',')} km';
    if (!d.peloCaminho) return '$km em linha reta';
    return '$km pelo caminho${d.min != null ? ' (≈ ${d.min} min de moto)' : ''}';
  }

  /// Por que "cobrar a nova" não dá (null = dá) — a mesma regra da tela do computador (a conta é do servidor — V74).
  String? get porQueNaoCobraANova {
    if (taxaNova == null) return 'o endereço novo fica fora da área de entrega';
    if (pagoAntes) return 'o pedido foi pago pelo link';
    if ((taxaNova! * 100).round() == (taxaAntes * 100).round()) return 'a taxa da área nova é a mesma';
    if (recusaDaNova != null) return recusaDaNova!.replaceAll(RegExp(r'[.:]\s*$'), '');
    if (contaDaNova == null) return 'a conta com a taxa nova não veio';
    return null;
  }

  /// "nova" só quando dá; senão a do pedido.
  String escolhaQueVale(String escolha) => escolha == 'nova' && porQueNaoCobraANova == null ? 'nova' : 'manter';

  double taxaDaEscolha(String escolha) => escolhaQueVale(escolha) == 'nova' ? (taxaNova ?? taxaAntes) : taxaAntes;

  /// O total e o que o entregador recebe com a taxa escolhida (as contas do servidor).
  ({double total, double aReceber}) valoresDaEscolha(String escolha) =>
      escolhaQueVale(escolha) == 'nova' && contaDaNova != null ? contaDaNova! : (total: total, aReceber: aReceber);

  /// "Dinheiro · troco para R$ 50,00" (ou "pago pelo link").
  String get textoDoPagamento {
    if (pagoAntes) return 'pago pelo link';
    final f = (formaPagamento ?? 'na entrega').trim();
    final forma = f.isEmpty ? 'Na entrega' : '${f[0].toUpperCase()}${f.substring(1)}';
    return '$forma${trocoPara != null ? ' · troco para ${brlR(trocoPara!)}' : ''}';
  }

  /// A mensagem pronta para o entregador: o endereço novo e, no pago na entrega, quanto receber.
  String mensagemAoEntregador(String escolha) {
    final nome = (entregadorNome ?? '').trim().isEmpty ? '' : ', ${entregadorNome!.trim().split(' ').first}';
    final n = numero != null ? 'do pedido nº $numero' : 'do pedido';
    final ref = para.referencia != null ? ' (${para.referencia})' : '';
    final receber = valoresDaEscolha(escolha).aReceber;
    final quanto = pagoAntes || receber <= 0
        ? ' O pedido já está pago.'
        : ' Receber ${brlR(receber)}${trocoPara != null ? ' (troco para ${brlR(trocoPara!)})' : ''}.';
    return 'Oi$nome! O endereço $n mudou: agora é ${para.emUmaLinha}$ref.$quanto';
  }

  /// O link do WhatsApp do entregador com a mensagem pronta (null = sem telefone do entregador).
  Uri? linkDoEntregador(String escolha) {
    final numero = numeroDoWhatsapp(entregadorTelefone);
    if (numero.isEmpty) return null;
    return Uri.parse('https://wa.me/$numero?text=${Uri.encodeComponent(mensagemAoEntregador(escolha))}');
  }

  /// O rascunho do "Não dá: responder ao cliente" (vai para o campo da conversa — nunca sai sozinho).
  String get rascunhoNaoDa {
    final n = numero != null ? 'do pedido nº $numero' : 'do pedido';
    return 'Não conseguimos mudar o endereço $n: o entregador já está a caminho da ${de.ruaENumero}. Você consegue receber lá?';
  }

  /// O que o cliente recebe quando a mudança vale (o texto do servidor).
  String get textoAoCliente => 'Endereço atualizado! O entregador já está indo para a ${para.ruaENumero} 👍';
}

/// Em que pé está a mudança feita pelo caso: aplicada, pedida (ao servidor da loja), recusada ou sem resposta (vencida);
/// e o aviso ao cliente (o "Endereço atualizado!").
class EstadoDaMudanca {
  final String situacao;
  final String? motivo;
  final bool avisoSaiu;
  final String? avisoFalhou;
  final bool avisoExpirou;
  final bool semTelefone;
  final bool temAviso;
  const EstadoDaMudanca({
    required this.situacao,
    this.motivo,
    this.avisoSaiu = false,
    this.avisoFalhou,
    this.avisoExpirou = false,
    this.semTelefone = false,
    this.temAviso = false,
  });

  static EstadoDaMudanca? de(dynamic m) {
    if (m is! Map || m['situacao'] is! String) return null;
    final a = m['aviso'];
    return EstadoDaMudanca(
      situacao: m['situacao'] as String,
      motivo: m['motivo'] as String?,
      temAviso: a is Map,
      avisoFalhou: a is Map && a['falhou'] is String ? a['falhou'] as String : null,
      avisoExpirou: a is Map && a['expirou'] == true,
      semTelefone: a is Map && a['semTelefone'] == true,
      avisoSaiu: a is Map && a['falhou'] == null && a['expirou'] != true && a['semTelefone'] != true,
    );
  }
}

/// Reais como a tela mostra ("R$ 8,00").
String brlR(num reais) => brl((reais * 100).round());

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
