import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Cliente da API do Regem. O app reusa o login de colaborador (JWT) e manda
/// `Authorization: Bearer <access_token>` — o guard do backend prioriza o Bearer.
class Api {
  // Produção. (Para testar contra o dev local, troque pela URL da sua máquina.)
  static const String base = 'https://api.dmsregem.com/api/v1';

  static String? _token;

  static Future<void> carregarToken() async {
    final p = await SharedPreferences.getInstance();
    _token = p.getString('token');
  }

  static bool get logado => _token != null;

  static Future<void> _salvarToken(String t) async {
    _token = t;
    final p = await SharedPreferences.getInstance();
    await p.setString('token', t);
  }

  static Future<void> sair() async {
    _token = null;
    final p = await SharedPreferences.getInstance();
    await p.remove('token');
  }

  static Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      };

  /// Login por identificador (usuário/apelido) + senha. Guarda o access_token.
  static Future<Map<String, dynamic>> login(String identificador, String senha) async {
    final r = await http.post(
      Uri.parse('$base/auth/login'),
      headers: const {'Content-Type': 'application/json'},
      body: jsonEncode({'identificador': identificador, 'senha': senha}),
    );
    if (r.statusCode >= 200 && r.statusCode < 300) {
      final j = jsonDecode(r.body) as Map<String, dynamic>;
      final token = j['access_token'] as String?;
      if (token == null) throw Exception('Login sem token.');
      await _salvarToken(token);
      return j;
    }
    throw Exception(_erro(r));
  }

  /// Perfil do entregador (nome, função, ehEntregador, permissões).
  static Future<Map<String, dynamic>> perfil() async {
    final r = await http.get(Uri.parse('$base/entregador/perfil'), headers: _headers);
    if (r.statusCode >= 200 && r.statusCode < 300) {
      return jsonDecode(r.body) as Map<String, dynamic>;
    }
    throw Exception(_erro(r));
  }

  /// Registra o token de push (FCM) do aparelho. Best-effort.
  static Future<void> registrarDispositivo(String fcmToken) async {
    try {
      await http.post(
        Uri.parse('$base/entregador/dispositivo'),
        headers: _headers,
        body: jsonEncode({'fcmToken': fcmToken, 'plataforma': 'android'}),
      );
    } catch (_) {
      // silencioso
    }
  }

  /// E1 — assume o pedido pelo código do cupom (URL do QR ou token).
  static Future<Map<String, dynamic>> scan(String codigo) async {
    final r = await http.post(Uri.parse('$base/entregador/scan'),
        headers: _headers, body: jsonEncode({'codigo': codigo}));
    if (r.statusCode >= 200 && r.statusCode < 300) {
      return jsonDecode(r.body) as Map<String, dynamic>;
    }
    throw Exception(_erro(r));
  }

  /// E1 — meus pedidos em rota.
  static Future<List<dynamic>> pedidos() async {
    final r = await http.get(Uri.parse('$base/entregador/pedidos'), headers: _headers);
    if (r.statusCode >= 200 && r.statusCode < 300) {
      final j = jsonDecode(r.body);
      return j is List ? j : <dynamic>[];
    }
    throw Exception(_erro(r));
  }

  /// E1 — finaliza a entrega (código opcional p/ marketplace de entrega própria).
  static Future<Map<String, dynamic>> finalizar(String id, {String? codigo}) async {
    final r = await http.post(
      Uri.parse('$base/entregador/pedido/$id/finalizar'),
      headers: _headers,
      body: jsonEncode({if (codigo != null) 'codigo': codigo}),
    );
    if (r.statusCode >= 200 && r.statusCode < 300) {
      return jsonDecode(r.body) as Map<String, dynamic>;
    }
    throw Exception(_erro(r));
  }

  /// E4 — avisa o cliente que o entregador está chegando (WhatsApp via n8n).
  static Future<Map<String, dynamic>> chegando(String id) async {
    final r = await http.post(
      Uri.parse('$base/entregador/pedido/$id/chegando'),
      headers: _headers,
    );
    if (r.statusCode >= 200 && r.statusCode < 300) {
      return jsonDecode(r.body) as Map<String, dynamic>;
    }
    throw Exception(_erro(r));
  }

  /// E2 — manda a localização atual (durante a entrega ativa). Best-effort.
  static Future<void> enviarLocalizacao(double lat, double lng, {double? precisao}) async {
    try {
      await http.post(
        Uri.parse('$base/entregador/localizacao'),
        headers: _headers,
        body: jsonEncode({'lat': lat, 'lng': lng, if (precisao != null) 'precisao': precisao}),
      );
    } catch (_) {
      // silencioso
    }
  }

  /// E5 — meus ganhos do período (entregas + valores em centavos, pelo modelo da loja).
  static Future<Map<String, dynamic>> ganhos() async {
    final r = await http.get(Uri.parse('$base/entregador/ganhos'), headers: _headers);
    if (r.statusCode >= 200 && r.statusCode < 300) {
      return jsonDecode(r.body) as Map<String, dynamic>;
    }
    throw Exception(_erro(r));
  }

  /// Fase 4 — minha preferência (compartilhar contato no aviso ao cliente).
  static Future<bool> preferencia() async {
    final r = await http.get(Uri.parse('$base/entregador/preferencia'), headers: _headers);
    if (r.statusCode >= 200 && r.statusCode < 300) {
      final j = jsonDecode(r.body) as Map<String, dynamic>;
      return j['compartilhaContato'] == true;
    }
    throw Exception(_erro(r));
  }

  static Future<bool> salvarPreferencia(bool compartilhaContato) async {
    final r = await http.post(
      Uri.parse('$base/entregador/preferencia'),
      headers: _headers,
      body: jsonEncode({'compartilhaContato': compartilhaContato}),
    );
    if (r.statusCode >= 200 && r.statusCode < 300) {
      final j = jsonDecode(r.body) as Map<String, dynamic>;
      return j['compartilhaContato'] == true;
    }
    throw Exception(_erro(r));
  }

  /// M3 — minha saída (roteiro) ativa: { saida, paradas: [...] }.
  static Future<Map<String, dynamic>> saida() async {
    final r = await http.get(Uri.parse('$base/entregador/saida'), headers: _headers);
    if (r.statusCode >= 200 && r.statusCode < 300) {
      return jsonDecode(r.body) as Map<String, dynamic>;
    }
    throw Exception(_erro(r));
  }

  /// M3 — pega a próxima saída (forma o roteiro com os pedidos prontos e atrela a mim).
  static Future<Map<String, dynamic>> proximaSaida() async {
    final r = await http.post(Uri.parse('$base/entregador/saida/proxima'), headers: _headers);
    if (r.statusCode >= 200 && r.statusCode < 300) {
      return jsonDecode(r.body) as Map<String, dynamic>;
    }
    throw Exception(_erro(r));
  }

  static String _erro(http.Response r) {
    try {
      final j = jsonDecode(r.body);
      if (j is Map && j['message'] != null) return j['message'].toString();
    } catch (_) {}
    if (r.statusCode == 401) return 'Usuário ou senha inválidos.';
    return 'Erro ${r.statusCode}';
  }
}
