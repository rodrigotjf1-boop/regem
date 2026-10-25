// Regem - icone "Regem - servidor da loja" na bandeja do Windows do SERVIDOR DA LOJA (fase 4 do pedido do dono de
// 22-23/10/2026; prototipo mockups/regem-bandeja-servidor.html, aprovado em 23/10 com "o icone e livre" e "as versoes
// instaladas em cada local").
//
// Fica ao lado do relogio, so no computador que e o servidor da loja. A bolinha: verde (tudo bem), amarela (um caixa,
// uma estacao de impressao ou um KDS parou de responder) ou cinza (o sistema deste computador nao responde). O clique
// abre o painel com TODOS os aparelhos ligados ao servidor (caixas, garcom, estacoes e impressoras, KDS, TV de senhas,
// totens, ponto, pontos de baixa): se cada um esta conectado agora, a versao instalada em cada lugar e as acoes -
// gerar o codigo para parear (sem reinstalar), revogar e reativar. O botao direito abre o menu curto.
//
// Fala SO com o sistema deste computador: https://localhost:<porta>/api/v1/edge/bandeja/... com a chave de
// bandeja.key (a pasta do sistema, C:\regem-edge\backend). O certificado e conferido normalmente: o do servidor cobre
// "localhost" e o instalador confia nele neste computador. Os textos de cada aparelho vem prontos do sistema (um lugar
// so, testado em bandeja.spec.ts); aqui so se desenha. Esconder o icone nao para nada: o servidor continua.
//
// Compila com o compilador do proprio Windows (.NET Framework 4.8, C# 5), sem instalar nada:
//   csc /target:winexe /out:RegemServidor.exe /r:System.Web.Extensions.dll /r:System.ServiceProcess.dll RegemServidor.cs
// O arquivo e ASCII: o csc le o fonte na pagina de codigo do Windows. Os acentos da tela vao como \u00e7 etc.
// Uso: RegemServidor.exe [--raiz "C:\regem-edge\backend"] [--api https://localhost:3002] [--web https://localhost:3001]
//      RegemServidor.exe ... --abrir painel
//      RegemServidor.exe ... --diagnostico <arquivo>   (le o estado uma vez, grava o que o icone mostraria e sai)
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Media;
using System.Net;
using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Regem.Servidor
{
    // ===== conversa com o sistema deste computador =====
    public class Api
    {
        public string Raiz;
        public string Base = "https://localhost:3002";
        public string Web = "https://localhost:3001";
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

        public const string NaoResponde = "o sistema deste servidor n\u00e3o responde";

        // TLS 1.2 (ERR-303): compilado pelo csc sem a marca de versao do .NET, o HttpWebRequest oferece so SSL3/TLS 1.0
        // - o sistema (Node) recusa ("unsupported protocol") e o icone dizia "o certificado nao e o da loja" com o
        // servidor de pe. O instalador (PowerShell 5.1) ja fazia o mesmo nas chamadas dele.
        static Api()
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        }

        string Chave()
        {
            string arq = Path.Combine(Raiz, "bandeja.key");
            if (!File.Exists(arq)) throw new Exception("o sistema deste servidor ainda n\u00e3o criou a chave do \u00edcone (ele cria ao ligar)");
            return File.ReadAllText(arq).Trim();
        }

        public Dictionary<string, object> Chamar(string metodo, string caminho, object corpo)
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(Base.TrimEnd('/') + "/api/v1/edge/bandeja" + caminho);
            req.Method = metodo;
            req.Timeout = 15000;
            req.ReadWriteTimeout = 15000;
            req.Proxy = null;
            req.Headers["x-bandeja-chave"] = Chave();
            if (corpo != null)
            {
                byte[] dados = Encoding.UTF8.GetBytes(Json.Serialize(corpo));
                req.ContentType = "application/json";
                req.ContentLength = dados.Length;
                using (Stream s = req.GetRequestStream()) s.Write(dados, 0, dados.Length);
            }
            try
            {
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                using (StreamReader rd = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    return Json.DeserializeObject(rd.ReadToEnd()) as Dictionary<string, object>;
            }
            catch (WebException we)
            {
                if (we.Response == null)
                {
                    // O certificado nao confere (TrustFailure) e a conexao segura que nao abre (SecureChannelFailure) sao
                    // coisas diferentes: so a primeira pede reinstalar o servidor.
                    if (we.Status == WebExceptionStatus.TrustFailure)
                        throw new Exception("o certificado do sistema deste servidor n\u00e3o \u00e9 o da loja (reinstale o servidor)");
                    if (we.Status == WebExceptionStatus.SecureChannelFailure)
                        throw new Exception("o \u00edcone n\u00e3o conseguiu abrir a conex\u00e3o segura com o sistema deste servidor (" + we.Message + ")");
                    throw new Exception(NaoResponde);
                }
                using (StreamReader rd = new StreamReader(we.Response.GetResponseStream(), Encoding.UTF8))
                {
                    Dictionary<string, object> d = null;
                    try { d = Json.DeserializeObject(rd.ReadToEnd()) as Dictionary<string, object>; } catch { }
                    throw new Exception(Mensagem(d, we.Message));
                }
            }
        }

        // O erro do sistema: "message" (texto ou lista) ou "erro".
        static string Mensagem(Dictionary<string, object> d, string padrao)
        {
            if (d == null) return padrao;
            object m;
            if (d.TryGetValue("message", out m) && m != null)
            {
                if (m is string) return (string)m;
                IEnumerable lista = m as IEnumerable;
                if (lista != null) { List<string> r = new List<string>(); foreach (object x in lista) r.Add(Convert.ToString(x)); return string.Join(" ", r.ToArray()); }
            }
            if (d.TryGetValue("erro", out m) && m != null) return Convert.ToString(m);
            return padrao;
        }

        public void AbrirNoNavegador(string caminho)
        {
            try { Process.Start(Web.TrimEnd('/') + caminho); }
            catch (Exception e) { MessageBox.Show("N\u00e3o consegui abrir o navegador: " + e.Message, T.Titulo); }
        }
    }

    // ===== leitura do JSON =====
    public static class E
    {
        public static string Txt(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : "";
        }
        public static bool Sim(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) && v is bool && (bool)v;
        }
        public static int Num(Dictionary<string, object> d, string k)
        {
            object v;
            if (d == null || !d.TryGetValue(k, out v) || v == null) return 0;
            try { return Convert.ToInt32(v); } catch { return 0; }
        }
        public static List<Dictionary<string, object>> Lista(Dictionary<string, object> d, string k)
        {
            List<Dictionary<string, object>> r = new List<Dictionary<string, object>>();
            object v;
            if (d == null || !d.TryGetValue(k, out v) || !(v is IEnumerable) || v is string) return r;
            foreach (object x in (IEnumerable)v)
            {
                Dictionary<string, object> i = x as Dictionary<string, object>;
                if (i != null) r.Add(i);
            }
            return r;
        }
        public static Dictionary<string, object> Obj(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) ? v as Dictionary<string, object> : null;
        }
        public static List<string> Textos(Dictionary<string, object> d, string k)
        {
            List<string> r = new List<string>();
            object v;
            if (d == null || !d.TryGetValue(k, out v) || !(v is IEnumerable) || v is string) return r;
            foreach (object x in (IEnumerable)v) r.Add(Convert.ToString(x));
            return r;
        }
        public static int Segundos(string iso)
        {
            DateTime t;
            if (!DateTime.TryParse(iso, null, System.Globalization.DateTimeStyles.RoundtripKind, out t)) return -1;
            return (int)Math.Max(0, (DateTime.UtcNow - t.ToUniversalTime()).TotalSeconds);
        }
    }

    // ===== os textos fixos da tela (os de cada aparelho vem do sistema) =====
    public static class T
    {
        public const string Titulo = "Regem \u2014 servidor da loja";
        public static string Plural(int n, string um, string varios) { return n + " " + (n == 1 ? um : varios); }
    }

    // ===== os servicos do Windows deste servidor (lidos sem precisar de administrador) =====
    public static class Servicos
    {
        public static readonly string[][] Lista = new string[][]
        {
            new string[] { "RegemEdgeApi", "Sistema" },
            new string[] { "RegemEdgePg", "Banco de dados" },
            new string[] { "RegemEdgeSync", "Sincroniza\u00e7\u00e3o" },
            new string[] { "RegemEdgeImpressao", "Impress\u00e3o" },
            new string[] { "RegemEdgeWeb", "Telas" },
        };
        public static bool[] Ler()
        {
            bool[] r = new bool[Lista.Length];
            for (int i = 0; i < Lista.Length; i++)
            {
                try { using (ServiceController sc = new ServiceController(Lista[i][0])) r[i] = sc.Status == ServiceControllerStatus.Running; }
                catch { r[i] = false; }
            }
            return r;
        }
        public static int Rodando(bool[] s) { int n = 0; if (s != null) foreach (bool b in s) if (b) n++; return n; }
    }

    // ===== cores (o tema claro/escuro do Windows) =====
    public class Cores
    {
        public Color Fundo, Cartao, Tinta, Tinta2, Linha, Hover, Ok, OkFundo, Aviso, AvisoFundo, Crit, CritFundo, Cinza, Info;
        public static readonly Color Navy = Color.FromArgb(15, 34, 48), Dourado = Color.FromArgb(232, 168, 69), SobreDourado = Color.FromArgb(40, 27, 6);
        public static Cores Atuais() { return Atuais(null); }
        // tema: "claro" | "escuro" | null (o do Windows)
        public static Cores Atuais(string tema)
        {
            bool escuro = false;
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                {
                    object v = k == null ? null : k.GetValue("AppsUseLightTheme");
                    escuro = v is int && (int)v == 0;
                }
            }
            catch { }
            if (tema == "claro") escuro = false;
            else if (tema == "escuro") escuro = true;
            Cores c = new Cores();
            if (escuro)
            {
                c.Fundo = Color.FromArgb(22, 34, 45); c.Cartao = Color.FromArgb(29, 44, 57); c.Tinta = Color.FromArgb(238, 243, 247);
                c.Tinta2 = Color.FromArgb(169, 186, 202); c.Linha = Color.FromArgb(44, 63, 80); c.Hover = Color.FromArgb(36, 55, 71);
                c.Ok = Color.FromArgb(79, 209, 161); c.OkFundo = Color.FromArgb(27, 58, 52); c.Aviso = Color.FromArgb(245, 184, 103);
                c.AvisoFundo = Color.FromArgb(58, 47, 33); c.Crit = Color.FromArgb(255, 143, 143); c.CritFundo = Color.FromArgb(60, 36, 40);
                c.Cinza = Color.FromArgb(154, 171, 186); c.Info = Color.FromArgb(140, 196, 242);
            }
            else
            {
                c.Fundo = Color.FromArgb(247, 249, 251); c.Cartao = Color.White; c.Tinta = Color.FromArgb(19, 37, 54);
                c.Tinta2 = Color.FromArgb(74, 95, 115); c.Linha = Color.FromArgb(220, 227, 234); c.Hover = Color.FromArgb(238, 242, 246);
                c.Ok = Color.FromArgb(15, 102, 71); c.OkFundo = Color.FromArgb(227, 244, 236); c.Aviso = Color.FromArgb(138, 67, 24);
                c.AvisoFundo = Color.FromArgb(252, 237, 228); c.Crit = Color.FromArgb(185, 50, 50); c.CritFundo = Color.FromArgb(251, 233, 233);
                c.Cinza = Color.FromArgb(93, 110, 126); c.Info = Color.FromArgb(44, 102, 153);
            }
            return c;
        }
    }

    // ===== os grupos do painel (a ordem e os nomes do prototipo) =====
    public static class Grupos
    {
        public static readonly string[][] Ordem = new string[][]
        {
            new string[] { "pdv", "Caixas (PDV)" },
            new string[] { "salao", "App do gar\u00e7om" },
            new string[] { "estacao_impressao", "Esta\u00e7\u00f5es de impress\u00e3o" },
            new string[] { "impressora", "Impressoras" },
            new string[] { "kds", "KDS (telas da cozinha)" },
            new string[] { "tela_senhas", "TV de senhas" },
            new string[] { "totem", "Totens" },
            new string[] { "terminal_ponto", "Terminal de ponto" },
            new string[] { "ponto_baixa", "Pontos de baixa" },
            new string[] { "outros", "Outros aparelhos" },
            new string[] { "revogados", "Revogados (at\u00e9 30 dias)" },
        };
        public static string De(Dictionary<string, object> a)
        {
            if (E.Txt(a, "situacao") == "revogado") return "revogados";
            string t = E.Txt(a, "tipo");
            foreach (string[] g in Ordem) if (g[0] == t) return t;
            return "outros";
        }
        public static bool Feminino(string grupo) { return grupo == "estacao_impressao" || grupo == "tela_senhas" || grupo == "impressora"; }
        public static bool TemCodigoNoTipo(string tipo) { return tipo == "pdv" || tipo == "salao" || tipo == "estacao_impressao" || tipo == "tela_senhas"; }
        // Por que nao ha "Gerar codigo" para este aparelho.
        public static string SemCodigo(Dictionary<string, object> a)
        {
            string t = E.Txt(a, "tipo");
            if (t == "kds") return "O KDS entra pelo endere\u00e7o com a chave dele, sem c\u00f3digo.";
            if (t == "totem") return "O totem \u00e9 ligado pela distribui\u00e7\u00e3o Regem, sem c\u00f3digo.";
            if (t == "impressora") return "A impressora n\u00e3o pareia: ela imprime pela esta\u00e7\u00e3o ou pelo servidor.";
            if (t == "terminal_ponto" || t == "ponto_baixa") return "Entra com o login de quem usa, sem c\u00f3digo.";
            return "Este aparelho n\u00e3o pareia por c\u00f3digo.";
        }
    }

    // ===== o icone =====
    // ===== o icone trocado pela atualizacao (.zip) =====
    // A atualizacao renomeia o .exe em uso para "<nome>.antigo-..." e poe o novo no lugar (atualizacao-comum.ps1,
    // Trocar-Icones - plano do dono de 25/10/2026: menos reinstalacao por .exe). Este processo segue rodando a copia
    // antiga: ele confere o arquivo do caminho em que abriu e, trocado, abre o novo (que espera esta trava sair,
    // --substituir) e se fecha. Sem isto o icone novo so valeria no proximo login do Windows.
    public static class Troca
    {
        static string caminho;
        static DateTime marca;
        static string argumentos = "";

        // Chamado no comeco do Main, antes de qualquer troca: o caminho e a data do arquivo de agora.
        public static void Iniciar(string exe, string[] args)
        {
            caminho = exe;
            try { marca = File.GetLastWriteTimeUtc(exe); } catch { marca = DateTime.MinValue; }
            // So o que diz ONDE (raiz, sistema, tela) segue para o novo; abrir painel, testes e o --substituir, nao.
            List<string> manter = new List<string>();
            for (int i = 0; i + 1 < args.Length; i++)
                if (args[i] == "--raiz" || args[i] == "--api" || args[i] == "--web") { manter.Add(Aspas(args[i])); manter.Add(Aspas(args[++i])); }
            argumentos = string.Join(" ", manter.ToArray());
        }

        static string Aspas(string s) { return "\"" + s.Replace("\"", "\\\"") + "\""; }

        public static bool Trocado()
        {
            if (string.IsNullOrEmpty(caminho)) return false;
            try { FileInfo f = new FileInfo(caminho); return f.Exists && f.Length > 0 && f.LastWriteTimeUtc != marca; } catch { return false; }
        }

        public static void AbrirONovo(string extra)
        {
            ProcessStartInfo p = new ProcessStartInfo(caminho, (argumentos + " --substituir " + extra).Trim());
            p.UseShellExecute = false;
            Process.Start(p);
        }
    }

    public class Bandeja : ApplicationContext
    {
        readonly Api api;
        readonly NotifyIcon icone = new NotifyIcon();
        readonly ContextMenuStrip menu = new ContextMenuStrip();
        readonly Control ui = new Control();
        readonly System.Windows.Forms.Timer relogio = new System.Windows.Forms.Timer();
        readonly System.Windows.Forms.Timer vigiaDaTroca = new System.Windows.Forms.Timer();
        readonly Icon[] icones = new Icon[3];
        public Dictionary<string, object> Estado;
        public string ErroLeitura = "";
        public bool[] EstadoServicos;
        public DateTime LidoEm = DateTime.MinValue;
        int lendo;
        PainelForm painel;
        readonly Dictionary<string, string> anterior = new Dictionary<string, string>();
        readonly HashSet<string> avisados = new HashSet<string>();
        string abrirAoLer;

        public Api Servico { get { return api; } }

        // So para o teste (--captura): le uma vez, sem icone e sem relogio.
        public Bandeja(Api a)
        {
            api = a;
            ui.CreateControl();
        }
        public void LerAgora()
        {
            try { Estado = api.Chamar("GET", "/estado", null); LidoEm = DateTime.UtcNow; } catch (Exception e) { Estado = null; ErroLeitura = e.Message; }
            EstadoServicos = Servicos.Ler();
        }

        public Bandeja(Api a, string abrir)
        {
            api = a;
            abrirAoLer = abrir;
            ui.CreateControl();
            for (int i = 0; i < 3; i++) icones[i] = Desenhar(i);
            icone.Icon = icones[2];
            icone.Text = T.Titulo;
            icone.ContextMenuStrip = menu;
            icone.Visible = true;
            icone.MouseClick += delegate(object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) AlternarPainel(); };
            menu.Opening += delegate { MontarMenu(); };
            MontarMenu();
            relogio.Interval = 5000;
            relogio.Tick += delegate { Ler(); };
            relogio.Start();
            // A atualizacao trocou este .exe: abre o novo e sai (ver Troca).
            vigiaDaTroca.Interval = 30000;
            vigiaDaTroca.Tick += delegate { if (Troca.Trocado()) Reabrir(); };
            vigiaDaTroca.Start();
            Ler();
        }

        void Reabrir()
        {
            vigiaDaTroca.Stop();
            try { Troca.AbrirONovo(""); }
            catch { vigiaDaTroca.Start(); return; } // nao abriu: segue este e tenta de novo depois
            relogio.Stop();
            icone.Visible = false;
            ExitThread();
        }

        // O R dourado num quadrado azul-escuro (o do servidor; o da estacao tem o R branco) + a bolinha.
        static Icon Desenhar(int nivel)
        {
            Bitmap b = new Bitmap(32, 32);
            using (Graphics g = Graphics.FromImage(b))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                using (GraphicsPath gp = new GraphicsPath())
                {
                    gp.AddArc(1, 1, 10, 10, 180, 90); gp.AddArc(19, 1, 10, 10, 270, 90);
                    gp.AddArc(19, 19, 10, 10, 0, 90); gp.AddArc(1, 19, 10, 10, 90, 90);
                    gp.CloseFigure();
                    using (SolidBrush fundo = new SolidBrush(Cores.Navy)) g.FillPath(fundo, gp);
                    using (Pen borda = new Pen(Cores.Dourado, 1.5f)) g.DrawPath(borda, gp);
                }
                using (Font f = new Font("Segoe UI", 15, FontStyle.Bold, GraphicsUnit.Pixel))
                using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                using (SolidBrush r = new SolidBrush(Cores.Dourado))
                    g.DrawString("R", f, r, new RectangleF(0, 0, 30, 30), sf);
                Color cor = nivel == 0 ? Color.FromArgb(45, 190, 132) : nivel == 1 ? Color.FromArgb(242, 169, 59) : Color.FromArgb(138, 150, 163);
                using (SolidBrush b2 = new SolidBrush(cor)) g.FillEllipse(b2, 19, 19, 12, 12);
                using (Pen p = new Pen(Color.FromArgb(11, 15, 21), 2)) g.DrawEllipse(p, 19, 19, 12, 12);
            }
            return Icon.FromHandle(b.GetHicon());
        }

        // 0 = verde, 1 = amarelo (um caixa, estacao ou KDS caiu), 2 = cinza (o sistema nao responde)
        public static int Nivel(Dictionary<string, object> est)
        {
            if (est == null) return 2;
            return E.Sim(E.Obj(est, "resumo"), "alerta") ? 1 : 0;
        }

        public static string Situacao(Dictionary<string, object> est)
        {
            if (est == null) return "O sistema deste servidor n\u00e3o responde";
            List<string> caidos = new List<string>();
            foreach (Dictionary<string, object> a in E.Lista(est, "aparelhos")) if (E.Sim(a, "alerta")) caidos.Add(E.Txt(a, "nome"));
            if (caidos.Count == 0) return "Tudo funcionando";
            return caidos.Count == 1 ? "1 aparelho parou de responder" : caidos.Count + " aparelhos pararam de responder";
        }

        // Le o estado e os servicos sem travar a tela.
        public void Ler()
        {
            if (Interlocked.Exchange(ref lendo, 1) == 1) return;
            ThreadPool.QueueUserWorkItem(delegate
            {
                Dictionary<string, object> novo = null;
                string erro = "";
                try { novo = api.Chamar("GET", "/estado", null); } catch (Exception e) { erro = e.Message; }
                bool[] sv = Servicos.Ler();
                try { ui.BeginInvoke(new MethodInvoker(delegate { Aplicar(novo, erro, sv); })); } catch { }
                Interlocked.Exchange(ref lendo, 0);
            });
        }

        void Aplicar(Dictionary<string, object> novo, string erro, bool[] sv)
        {
            Estado = novo;
            ErroLeitura = erro;
            EstadoServicos = sv;
            if (novo != null) LidoEm = DateTime.UtcNow;
            icone.Icon = icones[Nivel(Estado)];
            string dica = "Regem servidor: " + Situacao(Estado);
            icone.Text = dica.Length > 63 ? dica.Substring(0, 63) : dica;
            Avisar();
            if (painel != null && !painel.IsDisposed && painel.Visible) painel.Mostrar();
            if (abrirAoLer != null)
            {
                abrirAoLer = null;
                AlternarPainel();
            }
        }

        // D3 (23/10): o aviso do Windows quando um caixa, uma estacao de impressao ou um KDS que estava conectado
        // para de responder - uma vez por queda. Quem ja estava caido quando o icone abriu nao vira aviso (depois de
        // reiniciar o servidor, os caixas levam ate 30 s para dar sinal).
        void Avisar()
        {
            if (Estado == null) return;
            foreach (Dictionary<string, object> a in E.Lista(Estado, "aparelhos"))
            {
                string id = E.Txt(a, "id"), sit = E.Txt(a, "situacao");
                string antes;
                anterior.TryGetValue(id, out antes);
                if (E.Sim(a, "alerta") && antes == "conectado" && !avisados.Contains(id))
                {
                    avisados.Add(id);
                    icone.ShowBalloonTip(15000, "\"" + E.Txt(a, "nome") + "\" parou de responder", E.Txt(a, "linha"), ToolTipIcon.Warning);
                    SystemSounds.Exclamation.Play();
                }
                if (sit == "conectado") avisados.Remove(id);
                anterior[id] = sit;
            }
        }

        public void Balao(string titulo, string texto, ToolTipIcon tipo) { icone.ShowBalloonTip(6000, titulo, texto, tipo); }

        public void AlternarPainel()
        {
            if (painel == null || painel.IsDisposed) painel = new PainelForm(this);
            if (painel.Visible && (DateTime.UtcNow - painel.EscondidoEm).TotalMilliseconds > 300) { painel.Hide(); return; }
            // O clique no icone tira o foco do painel (ele se esconde) e depois chega aqui: sem esta janela de
            // 300 ms, o clique para FECHAR reabria.
            if ((DateTime.UtcNow - painel.EscondidoEm).TotalMilliseconds < 300) return;
            painel.Abrir();
            Ler();
        }

        void MontarMenu()
        {
            menu.Items.Clear();
            Rotulo(T.Titulo, true);
            Rotulo(Estado == null ? (ErroLeitura != "" ? "N\u00e3o responde: " + ErroLeitura : "Lendo o sistema deste servidor...") : Situacao(Estado));
            menu.Items.Add(new ToolStripSeparator());
            Item("Abrir o painel", delegate { AlternarPainel(); });
            ToolStripMenuItem codigo = new ToolStripMenuItem("Gerar c\u00f3digo para parear");
            foreach (Dictionary<string, object> a in E.Lista(Estado, "aparelhos"))
            {
                if (!E.Sim(E.Obj(a, "acoes"), "codigo")) continue;
                Dictionary<string, object> ap = a;
                ToolStripMenuItem s = new ToolStripMenuItem(E.Txt(ap, "nome"));
                s.Click += delegate { GerarCodigo(ap); };
                codigo.DropDownItems.Add(s);
            }
            codigo.Enabled = codigo.DropDownItems.Count > 0;
            menu.Items.Add(codigo);
            Item("Abrir Equipamentos no navegador", delegate { api.AbrirNoNavegador("/equipamentos"); });
            Item("Abrir o Regem", delegate { api.AbrirNoNavegador("/entrar"); });
            menu.Items.Add(new ToolStripSeparator());
            Item("Esconder o \u00edcone (o servidor continua)", delegate { icone.Visible = false; ExitThread(); });
        }
        void Rotulo(string texto) { Rotulo(texto, false); }
        void Rotulo(string texto, bool negrito)
        {
            ToolStripMenuItem t = new ToolStripMenuItem(texto);
            t.Enabled = false;
            if (negrito) t.Font = new Font(t.Font, FontStyle.Bold);
            menu.Items.Add(t);
        }
        void Item(string texto, EventHandler acao)
        {
            ToolStripMenuItem t = new ToolStripMenuItem(texto);
            t.Click += acao;
            menu.Items.Add(t);
        }

        // ----- as acoes (o mesmo servico da tela Equipamentos; a auditoria leva este computador) -----
        Dictionary<string, object> Quem()
        {
            return new Dictionary<string, object> { { "maquina", Environment.MachineName }, { "usuario", Environment.UserName } };
        }

        public void GerarCodigo(Dictionary<string, object> a)
        {
            string id = E.Txt(a, "id"), nome = E.Txt(a, "nome");
            Executar(delegate { return api.Chamar("POST", "/equipamento/" + id + "/codigo", Quem()); },
                delegate(Dictionary<string, object> r) { MostrarCodigo(nome, r); });
        }

        public void Revogar(Dictionary<string, object> a)
        {
            string id = E.Txt(a, "id"), nome = E.Txt(a, "nome"), tipo = E.Txt(a, "tipo");
            string consequencia = "Ele para na hora: o pareamento \u00e9 apagado e o aparelho n\u00e3o entra mais. D\u00e1 para desfazer em at\u00e9 30 dias por \"Reativar\"" +
                (Grupos.TemCodigoNoTipo(tipo) ? ", com um c\u00f3digo novo para parear de novo." : ".");
            if (!Confirmar("Revogar \"" + nome + "\"?", consequencia, "Revogar", true)) return;
            Executar(delegate { return api.Chamar("POST", "/equipamento/" + id + "/revogar", Quem()); },
                delegate(Dictionary<string, object> r) { Balao(T.Titulo, "\"" + nome + "\" foi revogado. Ficou na auditoria.", ToolTipIcon.Info); });
        }

        public void Reativar(Dictionary<string, object> a)
        {
            string id = E.Txt(a, "id"), nome = E.Txt(a, "nome"), tipo = E.Txt(a, "tipo");
            string texto = Grupos.TemCodigoNoTipo(tipo) ? "Ele volta com um c\u00f3digo novo (15 minutos) para parear de novo." : "Ele volta a funcionar na hora.";
            if (!Confirmar("Reativar \"" + nome + "\"?", texto, "Reativar", false)) return;
            Executar(delegate { return api.Chamar("POST", "/equipamento/" + id + "/reativar", Quem()); },
                delegate(Dictionary<string, object> r)
                {
                    if (E.Txt(r, "codigo") != "") MostrarCodigo(nome, r);
                    else Balao(T.Titulo, "\"" + nome + "\" voltou a funcionar.", ToolTipIcon.Info);
                });
        }

        delegate Dictionary<string, object> Chamada();
        delegate void Depois(Dictionary<string, object> r);
        void Executar(Chamada chamada, Depois depois)
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                Dictionary<string, object> r = null;
                string erro = null;
                try { r = chamada(); } catch (Exception e) { erro = e.Message; }
                try
                {
                    ui.BeginInvoke(new MethodInvoker(delegate
                    {
                        if (erro == null) depois(r);
                        else MessageBox.Show(erro, T.Titulo, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                        Ler();
                    }));
                }
                catch { }
            });
        }

        static bool Confirmar(string titulo, string consequencia, string botao, bool perigo)
        {
            using (Form f = new Form())
            {
                Montar.Dialogo(f, T.Titulo);
                TableLayoutPanel col = Montar.Coluna();
                Label h = Montar.Texto(titulo);
                h.Font = new Font("Segoe UI", 12, FontStyle.Bold);
                col.Controls.Add(h);
                col.Controls.Add(Montar.Faixa(consequencia, perigo ? 1 : 0));
                Label aud = Montar.Texto("Fica na auditoria como feito pelo \u00edcone do servidor, com este computador e o usu\u00e1rio do Windows.");
                aud.ForeColor = Color.FromArgb(85, 85, 85);
                col.Controls.Add(aud);
                Button ok = new Button { Text = botao, AutoSize = true, DialogResult = DialogResult.OK };
                Button cancelar = new Button { Text = "Cancelar", AutoSize = true, DialogResult = DialogResult.Cancel };
                col.Controls.Add(Montar.Botoes(ok, cancelar));
                f.Controls.Add(col);
                f.AcceptButton = cancelar; f.CancelButton = cancelar; // Enter nao revoga sem querer
                f.TopMost = true;
                return f.ShowDialog() == DialogResult.OK;
            }
        }

        void MostrarCodigo(string nome, Dictionary<string, object> r)
        {
            using (CodigoForm f = new CodigoForm(nome, r)) f.ShowDialog();
        }

        protected override void ExitThreadCore()
        {
            relogio.Stop();
            icone.Visible = false;
            icone.Dispose();
            base.ExitThreadCore();
        }
    }

    // ===== o painel (o clique no icone): o desenho do prototipo =====
    public class PainelForm : Form
    {
        readonly Bandeja dona;
        Cores c;
        public DateTime EscondidoEm = DateTime.MinValue;
        readonly TableLayoutPanel topo = new TableLayoutPanel();
        readonly Panel cabecalho = new Panel(), caixaBusca = new Panel(), rodape = new Panel();
        readonly FlowLayoutPanel faixa = new FlowLayoutPanel(), servidor = new FlowLayoutPanel(), filtros = new FlowLayoutPanel();
        readonly TextBox busca = new TextBox();
        readonly Panel lista = new Panel();
        readonly FlowLayoutPanel corpo = new FlowLayoutPanel();
        string filtro = "todos";
        bool servicosAbertos;
        readonly HashSet<string> fechados = new HashSet<string>();
        string desenhado = "";
        const int Largura = 400;

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, string l);

        public PainelForm(Bandeja b)
        {
            dona = b;
            Text = T.Titulo;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            KeyPreview = true;
            Font = new Font("Segoe UI", 9.75f);
            Width = Largura;
            KeyDown += delegate(object s, KeyEventArgs e) { if (e.KeyCode == Keys.Escape) Esconder(); };
            Deactivate += delegate { Esconder(); };

            lista.Dock = DockStyle.Fill;
            lista.AutoScroll = true;
            corpo.FlowDirection = FlowDirection.TopDown;
            corpo.WrapContents = false;
            corpo.AutoSize = true;
            corpo.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            corpo.Location = new Point(0, 0);
            corpo.Padding = new Padding(10, 4, 10, 10);
            lista.Controls.Add(corpo);

            rodape.Dock = DockStyle.Bottom; rodape.Height = 54;
            // A parte de cima: uma grade de uma coluna com linhas do tamanho do conteudo (cabecalho, situacao, este
            // computador, filtros, busca). Painel de tamanho automatico com filho encaixado encolhe a zero no WinForms.
            topo.Dock = DockStyle.Top;
            topo.AutoSize = true;
            topo.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            topo.ColumnCount = 1;
            topo.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            topo.Margin = new Padding(0); topo.Padding = new Padding(0);
            cabecalho.Height = 58; cabecalho.Width = Largura; cabecalho.Margin = new Padding(0); cabecalho.Dock = DockStyle.Fill;
            foreach (FlowLayoutPanel f in new FlowLayoutPanel[] { faixa, servidor })
            {
                f.FlowDirection = FlowDirection.TopDown; f.WrapContents = false; f.AutoSize = true; f.AutoSizeMode = AutoSizeMode.GrowAndShrink;
                f.Margin = new Padding(0); f.Dock = DockStyle.Fill;
            }
            faixa.Padding = new Padding(16, 9, 16, 9);
            servidor.Padding = new Padding(10, 8, 10, 0);
            filtros.AutoSize = true; filtros.AutoSizeMode = AutoSizeMode.GrowAndShrink; filtros.WrapContents = true;
            filtros.Margin = new Padding(0); filtros.Padding = new Padding(10, 8, 10, 0); filtros.Dock = DockStyle.Fill;
            filtros.MaximumSize = new Size(Largura, 0);
            caixaBusca.Height = 40; caixaBusca.Margin = new Padding(0); caixaBusca.Padding = new Padding(10, 6, 10, 4); caixaBusca.Dock = DockStyle.Fill;
            busca.Dock = DockStyle.Fill;
            busca.BorderStyle = BorderStyle.FixedSingle;
            busca.TextChanged += delegate { Mostrar(); };
            caixaBusca.Controls.Add(busca);
            foreach (Control x in new Control[] { cabecalho, faixa, servidor, filtros, caixaBusca })
            {
                topo.RowStyles.Add(new RowStyle(SizeType.AutoSize));
                topo.Controls.Add(x);
            }
            topo.RowCount = 5;
            // Docagem: o ultimo adicionado fica mais perto da borda (a grade no alto, o rodape embaixo, a lista no meio).
            Controls.Add(lista);
            Controls.Add(rodape);
            Controls.Add(topo);
            HandleCreated += delegate { SendMessage(busca.Handle, 0x1501, (IntPtr)1, "Buscar aparelho"); }; // EM_SETCUEBANNER
        }

        void Esconder()
        {
            if (!Visible || captura) return;
            EscondidoEm = DateTime.UtcNow;
            Hide();
        }

        // O teste (--captura): desenha fora da tela, sem tomar o foco, num tema escolhido, com um filtro.
        bool captura;
        protected override bool ShowWithoutActivation { get { return captura; } }
        public Bitmap Capturar(string tema, string filtroInicial, int altura)
        {
            captura = true;
            c = Cores.Atuais(tema);
            filtro = string.IsNullOrEmpty(filtroInicial) ? "todos" : filtroInicial;
            Height = altura;
            Location = new Point(-5000, -5000);
            Show();
            Mostrar();
            Application.DoEvents();
            Bitmap b = new Bitmap(Width, Height);
            DrawToBitmap(b, new Rectangle(0, 0, Width, Height));
            return b;
        }

        public void Abrir()
        {
            c = Cores.Atuais();
            desenhado = "";
            Rectangle area = Screen.PrimaryScreen.WorkingArea;
            Height = Math.Min(660, area.Height - 24);
            Location = new Point(area.Right - Width - 12, area.Bottom - Height - 12);
            Mostrar();
            Show();
            Activate();
        }

        // Redesenha so quando algo mudou (o icone le a cada 5 s): sem piscar e sem perder a rolagem.
        public void Mostrar()
        {
            if (c == null) c = Cores.Atuais();
            Dictionary<string, object> est = dona.Estado;
            string assinatura = (est == null ? "null:" + dona.ErroLeitura : new JavaScriptSerializer().Serialize(est)) + "|" + filtro + "|" + busca.Text + "|" +
                servicosAbertos + "|" + string.Join(",", new List<string>(fechados).ToArray()) + "|" + Servicos.Rodando(dona.EstadoServicos) + "|" + (int)((DateTime.UtcNow - dona.LidoEm).TotalSeconds / 10);
            if (assinatura == desenhado) return;
            desenhado = assinatura;
            Point rolagem = lista.AutoScrollPosition;
            SuspendLayout();
            BackColor = c.Fundo;
            ForeColor = c.Tinta;
            MontarCabecalho(est);
            MontarFaixa(est);
            MontarServidor(est);
            MontarFiltros(est);
            busca.BackColor = c.Cartao; busca.ForeColor = c.Tinta;
            caixaBusca.BackColor = c.Fundo;
            topo.BackColor = c.Fundo;
            caixaBusca.Visible = est != null && E.Lista(est, "aparelhos").Count > 0;
            MontarLista(est);
            MontarRodape(est);
            ResumeLayout(true);
            lista.AutoScrollPosition = new Point(-rolagem.X, -rolagem.Y);
        }

        Label Rot(string texto, Color cor, float tam, FontStyle estilo, int largura)
        {
            Label l = new Label { Text = texto, AutoSize = true, ForeColor = cor, BackColor = Color.Transparent, Font = new Font("Segoe UI", tam, estilo) };
            if (largura > 0) l.MaximumSize = new Size(largura, 0);
            l.Margin = new Padding(0);
            return l;
        }

        void MontarCabecalho(Dictionary<string, object> est)
        {
            cabecalho.Controls.Clear();
            cabecalho.BackColor = Cores.Navy;
            Label marca = new Label { Text = "R", Font = new Font("Segoe UI", 14, FontStyle.Bold), ForeColor = Cores.Dourado, BackColor = Color.FromArgb(10, 25, 36), TextAlign = ContentAlignment.MiddleCenter, Size = new Size(36, 36), Location = new Point(14, 11) };
            cabecalho.Controls.Add(marca);
            Label tit = Rot(T.Titulo, Color.White, 11, FontStyle.Bold, 290);
            tit.Location = new Point(60, 9);
            cabecalho.Controls.Add(tit);
            string loja = est == null ? "" : E.Txt(E.Obj(est, "servidor"), "loja");
            int s = dona.LidoEm == DateTime.MinValue ? -1 : (int)(DateTime.UtcNow - dona.LidoEm).TotalSeconds;
            string lido = est == null ? "tentando de novo a cada 5 s" : s < 10 ? "lido agora" : "lido h\u00e1 " + s + " s";
            Label sub = Rot((loja != "" ? loja + " \u00b7 " : "") + lido, Color.FromArgb(185, 200, 214), 8.75f, FontStyle.Regular, 290);
            sub.Location = new Point(60, 32);
            cabecalho.Controls.Add(sub);
            Button x = new Button { Text = "\u2715", FlatStyle = FlatStyle.Flat, ForeColor = Color.FromArgb(201, 214, 226), BackColor = Cores.Navy, Size = new Size(32, 32), Location = new Point(Largura - 44, 13), TabStop = true };
            x.FlatAppearance.BorderSize = 0;
            x.AccessibleName = "Fechar o painel";
            x.Click += delegate { Esconder(); };
            cabecalho.Controls.Add(x);
        }

        void MontarFaixa(Dictionary<string, object> est)
        {
            faixa.Controls.Clear();
            int nivel = Bandeja.Nivel(est);
            faixa.BackColor = nivel == 0 ? c.OkFundo : nivel == 1 ? c.AvisoFundo : c.CritFundo;
            FlowLayoutPanel col = faixa;
            col.Controls.Add(Rot(Bandeja.Situacao(est), c.Tinta, 9.75f, FontStyle.Bold, Largura - 40));
            string detalhe;
            if (est == null) detalhe = "Os caixas e os aparelhos da loja tamb\u00e9m ficam sem ele." + (dona.ErroLeitura != "" && dona.ErroLeitura != Api.NaoResponde ? " (" + dona.ErroLeitura + ")" : "");
            else
            {
                List<string> caidos = new List<string>();
                foreach (Dictionary<string, object> a in E.Lista(est, "aparelhos")) if (E.Sim(a, "alerta")) caidos.Add(E.Txt(a, "nome"));
                detalhe = caidos.Count > 0 ? string.Join(" \u00b7 ", caidos.ToArray()) : "Os aparelhos que avisam presen\u00e7a est\u00e3o respondendo.";
            }
            col.Controls.Add(Rot(detalhe, c.Tinta, 9, FontStyle.Regular, Largura - 40));
        }

        void MontarServidor(Dictionary<string, object> est)
        {
            servidor.Controls.Clear();
            servidor.BackColor = c.Fundo;
            bool[] sv = dona.EstadoServicos;
            int rodando = Servicos.Rodando(sv);
            FlowLayoutPanel col = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, WrapContents = false,
                BackColor = c.Cartao, Padding = new Padding(10, 7, 10, 7), Margin = new Padding(0), MinimumSize = new Size(Largura - 20, 0), Cursor = Cursors.Hand };
            Control cartao = col;
            col.Controls.Add(Rot("Este computador \u00b7 " + rodando + " de " + Servicos.Lista.Length + " servi\u00e7os rodando  " + (servicosAbertos || est == null ? "\u25be" : "\u25b8"), c.Tinta, 9.25f, FontStyle.Bold, Largura - 48));
            if (est != null)
            {
                Dictionary<string, object> s = E.Obj(est, "servidor"), nuvem = E.Obj(s, "nuvem");
                int antigos = E.Num(E.Obj(est, "resumo"), "versaoAntiga");
                Label l = Rot("vers\u00e3o " + E.Txt(s, "versao") + " \u00b7 " + E.Txt(nuvem, "linha") + (antigos > 0 ? " \u00b7 " + T.Plural(antigos, "aparelho com vers\u00e3o antiga", "aparelhos com vers\u00e3o antiga") : ""),
                    E.Txt(nuvem, "situacao") == "falhando" ? c.Aviso : antigos > 0 ? c.Info : c.Tinta2, 8.75f, antigos > 0 || E.Txt(nuvem, "situacao") == "falhando" ? FontStyle.Bold : FontStyle.Regular, Largura - 48);
                col.Controls.Add(l);
            }
            if (servicosAbertos || est == null)
            {
                for (int i = 0; i < Servicos.Lista.Length; i++)
                {
                    bool ok = sv != null && sv[i];
                    col.Controls.Add(Rot((ok ? "\u25cf " : "\u25cb ") + Servicos.Lista[i][1] + (ok ? " \u00b7 rodando" : " \u00b7 parado"), ok ? c.Ok : c.Crit, 8.75f, FontStyle.Regular, Largura - 48));
                }
            }
            EventHandler alternar = delegate { servicosAbertos = !servicosAbertos; Mostrar(); };
            foreach (Control x in col.Controls) x.Click += alternar;
            cartao.Click += alternar;
            cartao.AccessibleName = "Servi\u00e7os deste computador";
            servidor.Controls.Add(cartao);
        }

        void MontarFiltros(Dictionary<string, object> est)
        {
            filtros.Controls.Clear();
            filtros.BackColor = c.Fundo;
            filtros.Visible = est != null && E.Lista(est, "aparelhos").Count > 0;
            if (!filtros.Visible) return;
            Dictionary<string, object> r = E.Obj(est, "resumo");
            Filtro("todos", "Todos " + E.Num(r, "total"));
            Filtro("atencao", "Aten\u00e7\u00e3o " + E.Num(r, "caidos"));
            Filtro("conectados", "Conectados " + E.Num(r, "conectados"));
            Filtro("velha", "Vers\u00e3o antiga " + E.Num(r, "versaoAntiga"));
        }
        void Filtro(string id, string texto)
        {
            bool ativo = filtro == id;
            Button b = new Button { Text = texto, AutoSize = true, FlatStyle = FlatStyle.Flat, Margin = new Padding(0, 0, 6, 6), Padding = new Padding(4, 0, 4, 0),
                BackColor = ativo ? c.Tinta : c.Cartao, ForeColor = ativo ? c.Fundo : c.Tinta, Font = new Font("Segoe UI", 8.75f, FontStyle.Bold) };
            b.FlatAppearance.BorderColor = c.Linha;
            b.AccessibleName = texto + (ativo ? " (filtro ligado)" : "");
            b.Click += delegate { filtro = id; Mostrar(); };
            filtros.Controls.Add(b);
        }

        bool Passa(Dictionary<string, object> a)
        {
            string q = busca.Text.Trim();
            if (q != "" && E.Txt(a, "nome").IndexOf(q, StringComparison.CurrentCultureIgnoreCase) < 0) return false;
            string sit = E.Txt(a, "situacao");
            if (filtro == "atencao") return sit == "caiu";
            if (filtro == "conectados") return sit == "conectado";
            if (filtro == "velha") return E.Sim(a, "versaoAntiga");
            return true;
        }

        void MontarLista(Dictionary<string, object> est)
        {
            corpo.Controls.Clear();
            lista.BackColor = c.Fundo;
            corpo.BackColor = c.Fundo;
            int largura = Largura - 20 - SystemInformation.VerticalScrollBarWidth;
            if (est == null)
            {
                corpo.Controls.Add(Vazio("Sem o sistema, n\u00e3o d\u00e1 para ver os aparelhos.",
                    "1. Espere 1 minuto: o Windows tenta religar sozinho.\n2. Se continuar, reinicie este computador.\n3. Se voltar a parar, fale com o suporte do Regem.", largura));
                return;
            }
            List<Dictionary<string, object>> todos = E.Lista(est, "aparelhos");
            if (todos.Count == 0)
            {
                corpo.Controls.Add(Vazio("Nenhum aparelho ligado a este servidor ainda", "Cadastre o primeiro em Configura\u00e7\u00f5es \u203a Equipamentos. Depois \u00e9 s\u00f3 gerar o c\u00f3digo por aqui.", largura));
                return;
            }
            // A impressora de uma estacao aparece dentro dela (quando a estacao esta na lista); a sem estacao, no grupo dela.
            Dictionary<string, List<Dictionary<string, object>>> daEstacao = new Dictionary<string, List<Dictionary<string, object>>>();
            HashSet<string> estacoesVisiveis = new HashSet<string>();
            foreach (Dictionary<string, object> a in todos) if (E.Txt(a, "tipo") == "estacao_impressao" && Passa(a) && E.Txt(a, "situacao") != "revogado") estacoesVisiveis.Add(E.Txt(a, "id"));
            foreach (Dictionary<string, object> a in todos)
            {
                string est2 = E.Txt(a, "estacaoId");
                if (E.Txt(a, "tipo") != "impressora" || est2 == "" || !estacoesVisiveis.Contains(est2) || E.Txt(a, "situacao") == "revogado") continue;
                if (!daEstacao.ContainsKey(est2)) daEstacao[est2] = new List<Dictionary<string, object>>();
                daEstacao[est2].Add(a);
            }
            bool algum = false;
            foreach (string[] g in Grupos.Ordem)
            {
                List<Dictionary<string, object>> doGrupo = new List<Dictionary<string, object>>();
                foreach (Dictionary<string, object> a in todos)
                {
                    if (Grupos.De(a) != g[0]) continue;
                    if (E.Txt(a, "tipo") == "impressora" && daEstacao.ContainsKey(E.Txt(a, "estacaoId")) && daEstacao[E.Txt(a, "estacaoId")].Contains(a)) continue;
                    doGrupo.Add(a);
                }
                if (doGrupo.Count == 0) continue;
                List<Dictionary<string, object>> visiveis = doGrupo.FindAll(Passa);
                if (visiveis.Count == 0) continue;
                algum = true;
                corpo.Controls.Add(CabecalhoDoGrupo(g[0], g[1], doGrupo, largura));
                if (fechados.Contains(g[0])) continue;
                foreach (Dictionary<string, object> a in visiveis)
                {
                    corpo.Controls.Add(Linha(a, largura, 0));
                    List<Dictionary<string, object>> imps;
                    if (daEstacao.TryGetValue(E.Txt(a, "id"), out imps))
                        foreach (Dictionary<string, object> i in imps) corpo.Controls.Add(Linha(i, largura, 18));
                }
            }
            if (!algum)
                corpo.Controls.Add(Vazio("Nenhum aparelho neste filtro",
                    filtro == "atencao" ? "Tudo o que avisa presen\u00e7a est\u00e1 respondendo."
                    : filtro == "velha" ? "Tudo o que informa a vers\u00e3o est\u00e1 na mesma do servidor."
                    : "Mude o filtro ou a busca.", largura));
        }

        Control Vazio(string titulo, string texto, int largura)
        {
            FlowLayoutPanel p = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, WrapContents = false, Margin = new Padding(0, 14, 0, 0), BackColor = Color.Transparent };
            p.Controls.Add(Rot(titulo, c.Tinta, 10, FontStyle.Bold, largura));
            Label t = Rot(texto, c.Tinta2, 9, FontStyle.Regular, largura);
            t.Margin = new Padding(0, 4, 0, 0);
            p.Controls.Add(t);
            return p;
        }

        Control CabecalhoDoGrupo(string id, string nome, List<Dictionary<string, object>> itens, int largura)
        {
            int ok = 0, semSinal = 0;
            foreach (Dictionary<string, object> a in itens)
            {
                if (E.Txt(a, "situacao") == "conectado") ok++;
                if (E.Txt(a, "situacao") == "sem_sinal") semSinal++;
            }
            string conta;
            if (id == "revogados") conta = itens.Count.ToString();
            else if (id == "totem") conta = T.Plural(itens.Count, "totem", "totens") + " \u00b7 " + ok + " em uso";
            else if (id == "impressora") conta = ok + " de " + itens.Count + " respondendo";
            else if (semSinal == itens.Count) conta = itens.Count + " \u00b7 n\u00e3o informa";
            else conta = ok + " de " + itens.Count + (Grupos.Feminino(id) ? " conectadas" : " conectados");
            bool aberto = !fechados.Contains(id);
            // O nome (botao, a esquerda) e a contagem (a direita), lado a lado numa faixa.
            Panel faixaDoGrupo = new Panel { Width = largura, Height = 32, Margin = new Padding(0, 6, 0, 0), BackColor = c.Fundo };
            Button b = new Button { FlatStyle = FlatStyle.Flat, Dock = DockStyle.Fill, BackColor = c.Fundo, ForeColor = c.Tinta, TextAlign = ContentAlignment.MiddleLeft,
                Text = (aberto ? "\u25be  " : "\u25b8  ") + nome, Font = new Font("Segoe UI", 9.5f, FontStyle.Bold) };
            b.FlatAppearance.BorderSize = 0;
            b.FlatAppearance.MouseOverBackColor = c.Hover;
            b.AccessibleName = nome + ", " + conta + (aberto ? ", aberto" : ", fechado");
            Font fc = new Font("Segoe UI", 8.5f);
            Label l = new Label { Text = conta, Font = fc, AutoSize = false, Dock = DockStyle.Right, TextAlign = ContentAlignment.MiddleRight,
                Width = TextRenderer.MeasureText(conta, fc).Width + 8, ForeColor = c.Tinta2, BackColor = c.Fundo };
            l.Click += delegate { b.PerformClick(); };
            b.Click += delegate { if (fechados.Contains(id)) fechados.Remove(id); else fechados.Add(id); Mostrar(); };
            // Docagem: o ultimo adicionado vai primeiro para a borda (a contagem a direita; o botao fica com o resto).
            faixaDoGrupo.Controls.Add(b);
            faixaDoGrupo.Controls.Add(l);
            return faixaDoGrupo;
        }

        Control Linha(Dictionary<string, object> a, int largura, int recuo)
        {
            string sit = E.Txt(a, "situacao");
            TableLayoutPanel t = new TableLayoutPanel { ColumnCount = 3, RowCount = 1, Width = largura, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Margin = new Padding(0), Padding = new Padding(4 + recuo, 5, 0, 5), BackColor = c.Fundo,
                MinimumSize = new Size(largura, 0), MaximumSize = new Size(largura, 0) };
            t.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 18));
            t.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            t.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 36));
            Color cor = sit == "conectado" ? c.Ok : sit == "caiu" ? c.Aviso : c.Cinza;
            bool cheia = sit == "conectado" || sit == "caiu" || sit == "desligado" || sit == "revogado";
            Panel bol = new Panel { Size = new Size(10, 10), Margin = new Padding(0, 5, 0, 0), BackColor = Color.Transparent };
            bol.Paint += delegate(object s, PaintEventArgs e)
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                if (cheia) { using (SolidBrush br = new SolidBrush(cor)) e.Graphics.FillEllipse(br, 0, 0, 9, 9); }
                else { using (Pen p = new Pen(cor, 2)) e.Graphics.DrawEllipse(p, 1, 1, 7, 7); }
            };
            t.Controls.Add(bol, 0, 0);
            int larguraTexto = largura - 18 - 36 - 8 - recuo;
            FlowLayoutPanel txt = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, WrapContents = false, Margin = new Padding(0), BackColor = Color.Transparent };
            Label nome = Rot(E.Txt(a, "nome"), sit == "revogado" ? c.Tinta2 : c.Tinta, 9.5f, sit == "revogado" ? FontStyle.Strikeout | FontStyle.Bold : FontStyle.Bold, larguraTexto);
            txt.Controls.Add(nome);
            string linha = E.Txt(a, "linha");
            if (E.Txt(a, "versao") != "" && !E.Sim(a, "versaoAntiga")) linha += " \u00b7 " + E.Txt(a, "versao");
            txt.Controls.Add(Rot(linha, sit == "caiu" ? c.Aviso : c.Tinta2, 8.75f, sit == "caiu" ? FontStyle.Bold : FontStyle.Regular, larguraTexto));
            if (E.Txt(a, "linhaVersao") != "") txt.Controls.Add(Rot(E.Txt(a, "linhaVersao"), c.Info, 8.75f, FontStyle.Bold, larguraTexto));
            t.Controls.Add(txt, 1, 0);
            Button mais = new Button { Text = "\u22ef", FlatStyle = FlatStyle.Flat, Size = new Size(32, 28), ForeColor = c.Tinta2, BackColor = c.Fundo, Margin = new Padding(0), Font = new Font("Segoe UI", 11, FontStyle.Bold) };
            mais.FlatAppearance.BorderSize = 0;
            mais.FlatAppearance.MouseOverBackColor = c.Hover;
            mais.AccessibleName = "A\u00e7\u00f5es de " + E.Txt(a, "nome");
            mais.Click += delegate { MenuDaLinha(a).Show(mais, new Point(mais.Width - 4, mais.Height)); };
            t.Controls.Add(mais, 2, 0);
            return t;
        }

        ContextMenuStrip MenuDaLinha(Dictionary<string, object> a)
        {
            ContextMenuStrip m = new ContextMenuStrip();
            Dictionary<string, object> acoes = E.Obj(a, "acoes");
            if (E.Txt(a, "situacao") == "revogado")
            {
                if (E.Sim(acoes, "reativar")) Item(m, "Reativar...", delegate { Esconder(); dona.Reativar(a); });
                Nota(m, Grupos.TemCodigoNoTipo(E.Txt(a, "tipo")) ? "Volta com um c\u00f3digo novo para parear de novo." : "Volta a funcionar sem c\u00f3digo.");
                return m;
            }
            if (E.Sim(acoes, "codigo")) Item(m, "Gerar c\u00f3digo para parear...", delegate { Esconder(); dona.GerarCodigo(a); });
            else Nota(m, Grupos.SemCodigo(a));
            Item(m, "Abrir em Equipamentos", delegate { Esconder(); dona.Servico.AbrirNoNavegador("/equipamentos"); });
            if (E.Sim(acoes, "revogar"))
            {
                m.Items.Add(new ToolStripSeparator());
                ToolStripMenuItem r = Item(m, "Revogar...", delegate { Esconder(); dona.Revogar(a); });
                r.ForeColor = Color.FromArgb(185, 50, 50);
            }
            return m;
        }
        static ToolStripMenuItem Item(ContextMenuStrip m, string texto, EventHandler acao)
        {
            ToolStripMenuItem t = new ToolStripMenuItem(texto);
            t.Click += acao;
            m.Items.Add(t);
            return t;
        }
        static void Nota(ContextMenuStrip m, string texto)
        {
            ToolStripMenuItem t = new ToolStripMenuItem(texto) { Enabled = false };
            m.Items.Add(t);
        }

        void MontarRodape(Dictionary<string, object> est)
        {
            rodape.Controls.Clear();
            rodape.BackColor = c.Cartao;
            FlowLayoutPanel p = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, Dock = DockStyle.Fill, Padding = new Padding(10, 10, 10, 10), BackColor = Color.Transparent, WrapContents = false };
            if (est == null)
            {
                p.Controls.Add(Botao("Tentar agora", true, delegate { dona.Ler(); }));
            }
            else
            {
                p.Controls.Add(Botao("Abrir o Regem", true, delegate { Esconder(); dona.Servico.AbrirNoNavegador("/entrar"); }));
                p.Controls.Add(Botao("Abrir Equipamentos", false, delegate { Esconder(); dona.Servico.AbrirNoNavegador("/equipamentos"); }));
            }
            rodape.Controls.Add(p);
        }
        Button Botao(string texto, bool principal, EventHandler acao)
        {
            Button b = new Button { Text = texto, AutoSize = true, FlatStyle = FlatStyle.Flat, Height = 32, Margin = new Padding(6, 0, 0, 0), Padding = new Padding(6, 0, 6, 0),
                BackColor = principal ? Cores.Dourado : c.Cartao, ForeColor = principal ? Cores.SobreDourado : c.Tinta, Font = new Font("Segoe UI", 9, FontStyle.Bold) };
            b.FlatAppearance.BorderColor = principal ? Cores.Dourado : c.Linha;
            b.Click += acao;
            return b;
        }
    }

    // ===== o codigo gerado: grande, quanto falta e onde digitar =====
    public class CodigoForm : Form
    {
        readonly DateTime expira;
        readonly Label validade;
        readonly System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();

        public CodigoForm(string nome, Dictionary<string, object> r)
        {
            Montar.Dialogo(this, T.Titulo);
            TopMost = true;
            TableLayoutPanel col = Montar.Coluna();
            Label h = Montar.Texto("C\u00f3digo para parear \"" + nome + "\"");
            h.Font = new Font("Segoe UI", 12, FontStyle.Bold);
            col.Controls.Add(h);
            string codigo = E.Txt(r, "codigo");
            Label cod = new Label { Text = codigo.Length == 6 ? codigo.Substring(0, 3) + " " + codigo.Substring(3) : codigo, Font = new Font("Consolas", 32, FontStyle.Bold), AutoSize = true, Margin = new Padding(0, 4, 0, 0) };
            cod.AccessibleName = "C\u00f3digo " + string.Join(" ", Array.ConvertAll<char, string>(codigo.ToCharArray(), delegate(char x) { return x.ToString(); }));
            col.Controls.Add(cod);
            DateTime e;
            expira = DateTime.TryParse(E.Txt(r, "expiraEm"), null, System.Globalization.DateTimeStyles.RoundtripKind, out e) ? e.ToUniversalTime() : DateTime.UtcNow.AddMinutes(15);
            validade = Montar.Texto("");
            col.Controls.Add(validade);
            Dictionary<string, object> onde = E.Obj(r, "onde");
            if (onde != null)
            {
                StringBuilder sb = new StringBuilder();
                List<string> passos = E.Textos(onde, "passos");
                for (int i = 0; i < passos.Count; i++) sb.AppendLine((i + 1) + ". " + passos[i]);
                Label tit = Montar.Texto(E.Txt(onde, "titulo"));
                tit.Font = new Font("Segoe UI", 10, FontStyle.Bold);
                tit.Margin = new Padding(0, 6, 0, 2);
                col.Controls.Add(tit);
                col.Controls.Add(Montar.Faixa(sb.ToString().TrimEnd(), 0));
            }
            Button ok = new Button { Text = "Pronto", AutoSize = true, DialogResult = DialogResult.OK };
            col.Controls.Add(Montar.Botoes(ok));
            Controls.Add(col);
            AcceptButton = ok; CancelButton = ok;
            Atualizar();
            t.Interval = 1000;
            t.Tick += delegate { Atualizar(); };
            t.Start();
            FormClosed += delegate { t.Stop(); };
        }

        void Atualizar()
        {
            int resta = (int)Math.Max(0, (expira - DateTime.UtcNow).TotalSeconds);
            validade.Text = resta == 0 ? "Expirou. Gere outro." : string.Format("Vale at\u00e9 {0} \u00b7 faltam {1}:{2:00}", expira.ToLocalTime().ToString("HH:mm"), resta / 60, resta % 60);
        }
    }

    // ===== janelas pequenas que crescem com o texto (como no icone da estacao) =====
    static class Montar
    {
        public const int Largura = 420;
        public static void Dialogo(Form f, string titulo)
        {
            f.Text = titulo;
            f.FormBorderStyle = FormBorderStyle.FixedDialog;
            f.StartPosition = FormStartPosition.CenterScreen;
            f.MaximizeBox = false; f.MinimizeBox = false;
            f.ShowInTaskbar = true;
            f.Font = new Font("Segoe UI", 10);
            f.AutoSize = true;
            f.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            f.Padding = new Padding(0, 0, 14, 14);
        }
        public static TableLayoutPanel Coluna()
        {
            return new TableLayoutPanel { ColumnCount = 1, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Location = new Point(14, 14) };
        }
        public static Label Texto(string texto)
        {
            return new Label { Text = texto, AutoSize = true, MaximumSize = new Size(Largura, 0), Margin = new Padding(0, 0, 0, 8) };
        }
        // 0 = neutra, 1 = amarela (atencao)
        public static Label Faixa(string texto, int tipo)
        {
            Label l = Texto(texto);
            l.Padding = new Padding(8);
            l.MinimumSize = new Size(Largura, 0);
            l.BackColor = tipo == 1 ? Color.FromArgb(255, 242, 217) : Color.FromArgb(238, 242, 246);
            l.ForeColor = tipo == 1 ? Color.FromArgb(138, 90, 0) : Color.FromArgb(19, 37, 54);
            return l;
        }
        public static FlowLayoutPanel Botoes(params Button[] botoes)
        {
            FlowLayoutPanel p = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, WrapContents = false, Dock = DockStyle.Fill, Margin = new Padding(0, 8, 0, 0) };
            for (int i = botoes.Length - 1; i >= 0; i--) p.Controls.Add(botoes[i]);
            return p;
        }
    }

    static class Programa
    {
        [STAThread]
        static int Main(string[] args)
        {
            // Antes de tudo: o caminho e a data deste .exe (a atualizacao pode troca-lo enquanto ele roda - ver Troca).
            Troca.Iniciar(Application.ExecutablePath, args);
            Api api = new Api();
            string diagnostico = null, abrir = null, captura = null, tema = null, filtro = null, testeTroca = null, trocaOk = null;
            bool substituir = false;
            int altura = 660;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--substituir") substituir = true;
                else if (args[i] == "--teste-troca" && i + 1 < args.Length) testeTroca = args[++i];
                else if (args[i] == "--troca-ok" && i + 1 < args.Length) trocaOk = args[++i];
                else if (args[i] == "--raiz" && i + 1 < args.Length) api.Raiz = args[++i];
                else if (args[i] == "--api" && i + 1 < args.Length) api.Base = args[++i];
                else if (args[i] == "--web" && i + 1 < args.Length) api.Web = args[++i];
                else if (args[i] == "--diagnostico" && i + 1 < args.Length) diagnostico = args[++i];
                else if (args[i] == "--abrir" && i + 1 < args.Length) abrir = args[++i];
                else if (args[i] == "--captura" && i + 1 < args.Length) captura = args[++i];
                else if (args[i] == "--tema" && i + 1 < args.Length) tema = args[++i];
                else if (args[i] == "--filtro" && i + 1 < args.Length) filtro = args[++i];
                else if (args[i] == "--altura" && i + 1 < args.Length) altura = int.Parse(args[++i]);
            }
            // O exe fica em <raiz>\edge\bandeja\RegemServidor.exe: a raiz (onde o sistema grava bandeja.key) e dois acima.
            if (string.IsNullOrEmpty(api.Raiz))
                api.Raiz = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), @"..\.."));

            if (diagnostico != null) return Diagnosticar(api, diagnostico);
            // Teste da troca (sem janela): o novo, aberto pelo antigo, so marca que abriu; o antigo confere o arquivo a cada
            // 200 ms por ate 60 s e, trocado, abre o novo como o icone de verdade faz (Troca.AbrirONovo).
            if (trocaOk != null) { File.WriteAllText(trocaOk, "ok"); return 0; }
            if (testeTroca != null)
            {
                DateTime fim = DateTime.UtcNow.AddSeconds(60);
                while (DateTime.UtcNow < fim)
                {
                    if (Troca.Trocado()) { Troca.AbrirONovo("--troca-ok \"" + testeTroca + "\""); return 0; }
                    Thread.Sleep(200);
                }
                return 3;
            }
            if (captura != null)
            {
                // Teste: o painel desenhado numa imagem, sem abrir janela na tela de ninguem.
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Bandeja b = new Bandeja(api);
                b.LerAgora();
                using (PainelForm p = new PainelForm(b))
                using (Bitmap img = p.Capturar(tema, filtro, altura))
                    img.Save(captura, System.Drawing.Imaging.ImageFormat.Png);
                return b.Estado == null ? 2 : 0;
            }

            bool novo;
            using (Mutex m = new Mutex(true, "Local\\RegemServidorBandeja", out novo))
            {
                if (!novo)
                {
                    // Aberto pelo icone antigo que a atualizacao trocou: espera ele sair (a trava fica abandonada ao sair).
                    if (!substituir) return 0;
                    try { if (!m.WaitOne(30000)) return 0; } catch (AbandonedMutexException) { }
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new Bandeja(api, abrir));
            }
            return 0;
        }

        // Le o estado UMA vez e grava o que o icone mostraria (teste automatico; nao abre tela).
        static int Diagnosticar(Api api, string arquivo)
        {
            StringBuilder sb = new StringBuilder();
            try
            {
                Dictionary<string, object> est = api.Chamar("GET", "/estado", null);
                Dictionary<string, object> s = E.Obj(est, "servidor");
                sb.AppendLine("nivel=" + Bandeja.Nivel(est));
                sb.AppendLine("situacao=" + Bandeja.Situacao(est));
                sb.AppendLine("servidor=" + E.Txt(s, "versao") + "|" + E.Txt(s, "loja") + "|" + E.Txt(E.Obj(s, "nuvem"), "linha"));
                foreach (Dictionary<string, object> a in E.Lista(est, "aparelhos"))
                {
                    Dictionary<string, object> ac = E.Obj(a, "acoes");
                    sb.AppendLine(string.Format("aparelho={0}|{1}|{2}|{3}|{4}|codigo={5}|revogar={6}|reativar={7}", Grupos.De(a), E.Txt(a, "nome"), E.Txt(a, "situacao"),
                        E.Txt(a, "linha"), E.Txt(a, "linhaVersao"), E.Sim(ac, "codigo"), E.Sim(ac, "revogar"), E.Sim(ac, "reativar")));
                }
                File.WriteAllText(arquivo, sb.ToString(), Encoding.UTF8);
                return 0;
            }
            catch (Exception e)
            {
                File.WriteAllText(arquivo, "erro=" + e.Message, Encoding.UTF8);
                return 2;
            }
        }
    }
}
