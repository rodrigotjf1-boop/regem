// Regem - icone "Regem neste PC" na bandeja do Windows (central de impressao, fase 1, PR 4b;
// conexao PC <-> servidor da loja, parte 2 - prototipo aprovado pelo dono em 20/10/2026, peca 4).
//
// Fica ao lado do relogio em todo PC da loja. A bolinha diz o estado da ligacao com o servidor e
// das impressoras do PC (verde, amarelo, vermelho; cinza = o servico nao responde). O menu faz as
// acoes DESTE PC: abrir o painel, testar a conexao com o servidor (procura sozinho se o IP mudou),
// trocar o endereco do servidor numa emergencia, parear com um codigo novo a qualquer momento,
// imprimir teste, reimprimir o ultimo cupom, pausar uma impressora. Quando algo para (sem papel,
// tampa aberta, o servidor sumiu) ou a fila antiga precisa de decisao, o aviso do Windows aparece.
// Mudar o que imprime onde e no Regem, nao aqui.
//
// Fala SO com o servico deste PC: http://127.0.0.1:<porta> com a chave de painel.key (a pasta de
// dados da estacao). Esconder o icone nao para a impressao: quem imprime e o servico.
//
// Compila com o compilador do proprio Windows (.NET Framework 4.8, C# 5), sem instalar nada:
//   csc /target:winexe /out:RegemEstacao.exe /r:System.Web.Extensions.dll RegemEstacao.cs
// O arquivo e ASCII (sem acento): o csc le o fonte na pagina de codigo do Windows.
// Uso: RegemEstacao.exe --raiz "C:\regem-edge\estacao" [--porta 17311] [--abrir painel|trocar|parear]
//      RegemEstacao.exe --raiz ... --diagnostico <arquivo>   (le o estado uma vez, grava o que o
//                                                            icone mostraria e sai - para teste)
using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Media;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Regem.Estacao
{
    // ===== conversa com o servico (127.0.0.1) =====
    public class Painel
    {
        public string Raiz;
        public int Porta = 17311;
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

        string Chave()
        {
            string arq = Path.Combine(Raiz, "painel.key");
            if (!File.Exists(arq)) throw new Exception("o servico deste PC ainda nao criou a chave do painel");
            return File.ReadAllText(arq).Trim();
        }

        public Dictionary<string, object> Chamar(string metodo, string caminho, object corpo)
        {
            return Chamar(metodo, caminho, corpo, 20000);
        }

        // A busca do servidor pode levar ate ~30 s (varre a rede): quem a pede passa um prazo maior.
        public Dictionary<string, object> Chamar(string metodo, string caminho, object corpo, int prazoMs)
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Porta + caminho);
            req.Method = metodo;
            req.Timeout = prazoMs;
            req.ReadWriteTimeout = prazoMs;
            req.Proxy = null;
            req.Headers["x-painel-chave"] = Chave();
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
                if (we.Response == null) throw new Exception("o servico do Regem neste PC nao responde");
                using (StreamReader rd = new StreamReader(we.Response.GetResponseStream(), Encoding.UTF8))
                {
                    Dictionary<string, object> d = null;
                    try { d = Json.DeserializeObject(rd.ReadToEnd()) as Dictionary<string, object>; } catch { }
                    throw new Exception(d != null && d.ContainsKey("erro") ? Convert.ToString(d["erro"]) : we.Message);
                }
            }
        }
    }

    // ===== leitura do estado (o JSON do servico) =====
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

        // O estado da impressora em portugues (o mesmo vocabulario da tela de Equipamentos).
        public static string Estado(Dictionary<string, object> imp)
        {
            if (Sim(imp, "pausada")) return "pausada";
            string e = Txt(imp, "estado");
            if (e == "sem_papel") return "sem papel";
            if (e == "papel_acabando") return "papel acabando";
            if (e == "tampa_aberta") return "tampa aberta";
            if (e == "erro") return "erro na impressora";
            if (e == "parada") return "parada";
            if (e == "sem_resposta") return "sem resposta";
            if (Sim(imp, "parada")) return "esperando a impressora";
            return "pronta";
        }
        public static bool Critico(Dictionary<string, object> imp)
        {
            string e = Txt(imp, "estado");
            return !Sim(imp, "pausada") && (e == "sem_papel" || e == "tampa_aberta" || e == "erro" || e == "parada" || e == "sem_resposta");
        }

        // 0 = verde, 1 = amarelo, 2 = vermelho, 3 = cinza (o servico nao responde)
        public static int Nivel(Dictionary<string, object> est)
        {
            if (est == null) return 3;
            if (!Sim(est, "pareada")) return 1;
            Dictionary<string, object> c = Obj(est, "contato");
            if (c != null && !Sim(c, "ok") && Txt(c, "erro") != "") return 2;
            int n = Sim(C.Conexao(est), "buscando") ? 1 : 0;
            foreach (Dictionary<string, object> i in Lista(est, "impressoras"))
            {
                if (Critico(i)) return 2;
                if (Sim(i, "pausada") || Txt(i, "estado") == "papel_acabando") n = 1;
            }
            if (Lista(est, "retidos").Count > 0) n = Math.Max(n, 1);
            return n;
        }

        public static int NaFila(Dictionary<string, object> est)
        {
            int n = 0;
            foreach (Dictionary<string, object> i in Lista(est, "impressoras")) n += Num(i, "naFila");
            return n;
        }

        public static string Hora(string iso)
        {
            DateTime t;
            if (DateTime.TryParse(iso, null, System.Globalization.DateTimeStyles.RoundtripKind, out t)) return t.ToLocalTime().ToString("HH:mm");
            return "";
        }

        public static string Situacao(string s)
        {
            if (s == "impresso") return "impresso";
            if (s == "interrompido") return "interrompido - sai de novo inteiro";
            if (s == "esperando") return "esperando a impressora";
            if (s == "falhou") return "nao saiu";
            if (s == "teste") return "pagina de teste";
            if (s == "reimpresso") return "reimpresso";
            return s;
        }
    }

    // ===== a conexao com o servidor da loja (parte 2): o bloco "conexao" do estado =====
    public static class C
    {
        public static Dictionary<string, object> Conexao(Dictionary<string, object> est) { return E.Obj(est, "conexao"); }

        // Segundos desde um horario ISO (-1 sem horario).
        public static int Segundos(string iso)
        {
            DateTime t;
            if (!DateTime.TryParse(iso, null, System.Globalization.DateTimeStyles.RoundtripKind, out t)) return -1;
            return (int)Math.Max(0, (DateTime.UtcNow - t.ToUniversalTime()).TotalSeconds);
        }
        public static string Ha(int s)
        {
            if (s < 0) return "";
            if (s < 2) return "agora";
            if (s < 60) return "ha " + s + " s";
            if (s < 3600) return "ha " + (s / 60) + " min";
            return "ha " + (s / 3600) + " h";
        }

        // "regem.local (192.168.0.10)", ou so o endereco quando ele ja e o IP.
        public static string Endereco(Dictionary<string, object> c)
        {
            string alvo = E.Txt(c, "alvo"), ip = E.Txt(c, "ip");
            if (alvo == "") return "(sem endereco)";
            return ip != "" && ip != alvo ? alvo + " (" + ip + ")" : alvo;
        }

        public static string Como(Dictionary<string, object> c)
        {
            string como = E.Txt(c, "como"), alvo = E.Txt(c, "alvo"), nome = E.Txt(c, "nome");
            if (como == "configurado") return alvo == nome ? "pelo nome, na rede da loja" : "pelo endereco configurado";
            if (como == "nome") return "pelo nome " + nome + ", na rede da loja";
            if (como == "ultimo-ip") return "pelo ultimo IP que funcionou";
            if (como == "nuvem") return "pelo endereco que a nuvem informou";
            if (como == "varredura") return "procurando na rede deste PC";
            if (como == "digitado") return "pelo endereco digitado";
            return "";
        }

        static string Passo(Dictionary<string, object> p, string nome)
        {
            string como = E.Txt(p, "como"), host = E.Txt(p, "host");
            bool ok = E.Sim(p, "ok");
            if (como == "configurado") return host + " (o endereco configurado) " + (ok ? "respondeu" : "nao respondeu");
            if (como == "nome") return ok ? nome + " respondeu" : nome + " nao respondeu (a rede deste PC nao resolve o nome)";
            if (como == "ultimo-ip") return host + ", o ultimo que funcionou, " + (ok ? "respondeu" : "nao respondeu");
            if (como == "nuvem")
            {
                if (host == "") return "A nuvem nao informou o endereco (sem internet, ou o servidor sem sinal)";
                return ok ? "A nuvem informou o endereco novo: " + host : "A nuvem informou " + host + ", mas ele nao respondeu";
            }
            if (como == "varredura")
                return ok ? "Achei o servidor na rede deste PC: " + host
                          : string.Format("Procurei em {0} enderecos da rede deste PC: nenhum servidor desta loja", E.Num(p, "procurados"));
            return host;
        }

        // Os passos de uma busca em texto, com o "conferido" e o "anotado" quando achou.
        public static List<string> Passos(Dictionary<string, object> busca, Dictionary<string, object> c)
        {
            List<string> r = new List<string>();
            if (busca == null) return r;
            string nome = E.Txt(c, "nome") != "" ? E.Txt(c, "nome") : "regem.local";
            foreach (Dictionary<string, object> p in E.Lista(busca, "passos")) r.Add((E.Sim(p, "ok") ? "[ok] " : "[x]  ") + Passo(p, nome));
            if (E.Txt(busca, "achou") != "")
            {
                r.Add("[ok] Conferido: e o servidor da sua loja (certificado da loja)");
                Dictionary<string, object> h = E.Obj(c, "hosts");
                if (h != null && E.Txt(h, "ip") != "" && E.Txt(h, "ip") == E.Txt(c, "ip"))
                    r.Add("[ok] Anotado neste PC: " + nome + " -> " + E.Txt(h, "ip") + ". O atalho do Regem continua igual.");
            }
            if (E.Txt(c, "hostsErro") != "") r.Add("[x]  Nao consegui anotar " + nome + " neste PC (" + E.Txt(c, "hostsErro") + "). Este PC segue pelo IP.");
            return r;
        }

        // A situacao em uma linha (menu, painel e dica do icone).
        public static string Linha(Dictionary<string, object> est)
        {
            Dictionary<string, object> c = Conexao(est), ct = E.Obj(est, "contato");
            if (c == null) return E.Sim(est, "pareada") ? "ligada a " + E.Txt(est, "servidor") : "ainda nao pareada";
            if (E.Sim(c, "buscando")) return "Procurando o servidor da loja...";
            if (!E.Sim(est, "pareada"))
                return "Ainda nao pareada - servidor: " + Endereco(c) + (E.Txt(c, "ultimaResposta") != "" ? " (respondeu " + Ha(Segundos(E.Txt(c, "ultimaResposta"))) + ")" : "");
            // Sem contato = a fila falhou (o mesmo criterio da bolinha vermelha). Antes da primeira
            // resposta da fila, a ultima resposta do teste da partida ja diz que o servidor esta la.
            bool falhou = ct != null && !E.Sim(ct, "ok") && E.Txt(ct, "erro") != "";
            // Recusada (o servidor respondeu e nao aceitou esta estacao): nao e "sem servidor" - pareie de novo com codigo.
            if (E.Sim(ct, "recusada")) return "O servidor recusou esta estacao - pareie de novo com codigo";
            if (!E.Sim(c, "local")) return falhou ? "Sem contato com a nuvem do Regem" : "Ligada a nuvem do Regem";
            if (!falhou && (E.Sim(ct, "ok") || E.Txt(c, "ultimaResposta") != ""))
                return "Ligado ao servidor - " + Endereco(c) + (E.Num(c, "latenciaMs") > 0 ? " - responde em " + E.Num(c, "latenciaMs") + " ms" : "");
            if (!falhou) return "Conectando ao servidor - " + Endereco(c);
            int s = Segundos(E.Txt(c, "ultimaResposta"));
            return s >= 0 ? "Sem servidor " + Ha(s) + " - procurando de novo sozinho" : "Sem servidor - procurando de novo sozinho";
        }
    }

    // ===== o icone =====
    public class Bandeja : ApplicationContext
    {
        readonly Painel painel;
        readonly NotifyIcon icone = new NotifyIcon();
        readonly ContextMenuStrip menu = new ContextMenuStrip();
        readonly Control ui = new Control(); // so para voltar para a thread da tela
        readonly System.Windows.Forms.Timer relogio = new System.Windows.Forms.Timer();
        readonly Icon[] icones = new Icon[4];
        Dictionary<string, object> estado;
        string erroLeitura = "";
        int lendo;
        PainelForm janela;
        HashSet<string> criticosAvisados = new HashSet<string>();
        int retidosAvisados;
        bool primeiraLeitura = true;
        string buscaAvisada = ""; // a busca (pelo horario dela) que ja virou aviso
        bool semServidorAvisado;
        string abrirAoLer; // --abrir painel|trocar|parear: abre a tela depois da primeira leitura
        // Parear sem reinstalar (22/10/2026): a recusa do servidor vira aviso do Windows UMA vez; clicar nele abre o
        // "Parear com codigo...". E o atalho "Regem - parear este PC", com o icone ja aberto, so acorda este pelo sinal.
        bool recusaAvisada;
        bool balaoDeRecusa;
        EventWaitHandle pedidoDeParear;
        public const string SinalDeParear = "Local\\RegemEstacaoParear";

        public Painel Servico { get { return painel; } }

        public Bandeja(Painel p, string abrir)
        {
            painel = p;
            abrirAoLer = abrir;
            ui.CreateControl();
            for (int i = 0; i < 4; i++) icones[i] = Desenhar(i);
            icone.Icon = icones[3];
            icone.Text = "Regem neste PC";
            icone.ContextMenuStrip = menu;
            icone.Visible = true;
            icone.DoubleClick += delegate { AbrirPainel(); };
            icone.BalloonTipClicked += delegate { if (balaoDeRecusa) { balaoDeRecusa = false; Parear(); } };
            icone.BalloonTipClosed += delegate { balaoDeRecusa = false; };
            try
            {
                pedidoDeParear = new EventWaitHandle(false, EventResetMode.AutoReset, SinalDeParear);
                ThreadPool.RegisterWaitForSingleObject(pedidoDeParear, delegate
                {
                    try { ui.BeginInvoke(new MethodInvoker(delegate { Parear(); })); } catch { }
                }, null, -1, false);
            }
            catch { /* sem o sinal: o atalho abre so quando o icone nao esta aberto */ }
            menu.Opening += delegate { MontarMenu(); };
            MontarMenu();
            relogio.Interval = 3000;
            relogio.Tick += delegate { Ler(); };
            relogio.Start();
            Ler();
        }

        // R branco num quadrado azul-escuro (o do Regem) + a bolinha do estado.
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
                    using (SolidBrush fundo = new SolidBrush(Color.FromArgb(15, 34, 48))) g.FillPath(fundo, gp);
                }
                using (Font f = new Font("Segoe UI", 15, FontStyle.Bold, GraphicsUnit.Pixel))
                using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                    g.DrawString("R", f, Brushes.White, new RectangleF(0, 0, 30, 30), sf);
                Color cor = nivel == 0 ? Color.FromArgb(47, 191, 127) : nivel == 1 ? Color.FromArgb(242, 182, 60) : nivel == 2 ? Color.FromArgb(229, 72, 77) : Color.FromArgb(150, 150, 150);
                using (SolidBrush b2 = new SolidBrush(cor)) g.FillEllipse(b2, 19, 19, 12, 12);
                using (Pen p = new Pen(Color.FromArgb(11, 15, 21), 2)) g.DrawEllipse(p, 19, 19, 12, 12);
            }
            return Icon.FromHandle(b.GetHicon());
        }

        // Le o estado sem travar a tela (a chamada roda fora da thread da tela).
        public void Ler()
        {
            if (Interlocked.Exchange(ref lendo, 1) == 1) return;
            ThreadPool.QueueUserWorkItem(delegate
            {
                Dictionary<string, object> novo = null;
                string erro = "";
                try { novo = painel.Chamar("GET", "/estado", null); } catch (Exception e) { erro = e.Message; }
                try { ui.BeginInvoke(new MethodInvoker(delegate { Aplicar(novo, erro); })); } catch { }
                Interlocked.Exchange(ref lendo, 0);
            });
        }

        void Aplicar(Dictionary<string, object> novo, string erro)
        {
            estado = novo;
            erroLeitura = erro;
            int nivel = E.Nivel(estado);
            icone.Icon = icones[nivel];
            string dica = estado == null ? "Regem: o servico deste PC nao responde" : "Regem neste PC - " + C.Linha(estado);
            icone.Text = dica.Length > 63 ? dica.Substring(0, 63) : dica;
            Avisar();
            if (janela != null && !janela.IsDisposed) janela.Mostrar(estado, erroLeitura);
            if (abrirAoLer != null && estado != null)
            {
                string tela = abrirAoLer;
                abrirAoLer = null;
                ui.BeginInvoke(new MethodInvoker(delegate
                {
                    if (tela == "trocar") TrocarEndereco();
                    else if (tela == "parear") Parear();
                    else AbrirPainel();
                }));
            }
        }

        public void Balao(string titulo, string texto, ToolTipIcon tipo)
        {
            icone.ShowBalloonTip(8000, titulo, texto, tipo);
        }

        // O aviso do Windows quando uma impressora para, quando a fila antiga pede decisao e quando o
        // servidor muda de endereco ou some (parte 2).
        void Avisar()
        {
            if (estado == null) return;
            // O servidor recusou esta estacao: um aviso por recusa; clicar abre o "Parear com codigo...".
            bool recusada = E.Sim(E.Obj(estado, "contato"), "recusada");
            if (recusada && !recusaAvisada)
            {
                recusaAvisada = true;
                balaoDeRecusa = true;
                icone.ShowBalloonTip(20000, "O servidor recusou esta estacao",
                    "Os cupons esperam aqui. Clique neste aviso para parear com um codigo novo (gere em Configuracoes > Equipamentos > a estacao > Gerar codigo).",
                    ToolTipIcon.Warning);
                SystemSounds.Exclamation.Play();
            }
            if (!recusada) recusaAvisada = false;
            HashSet<string> agora = new HashSet<string>();
            foreach (Dictionary<string, object> i in E.Lista(estado, "impressoras"))
            {
                if (!E.Critico(i)) continue;
                string id = E.Txt(i, "id");
                agora.Add(id);
                if (criticosAvisados.Contains(id)) continue;
                int fila = E.NaFila(estado);
                icone.ShowBalloonTip(10000, string.Format("{0}: {1}", Capitalizar(E.Estado(i)), E.Txt(i, "nome")),
                    fila > 0 ? string.Format("{0} cupom(ns) esperando. O cupom que parou no meio sai de novo inteiro, marcado como reimpressao.", fila)
                             : "Resolva na impressora: a fila volta sozinha em alguns segundos.", ToolTipIcon.Warning);
                SystemSounds.Exclamation.Play();
            }
            criticosAvisados = agora;
            int retidos = E.Lista(estado, "retidos").Count;
            if (retidos > 0 && retidosAvisados == 0)
            {
                icone.ShowBalloonTip(15000, string.Format("{0} cupom(ns) esperam ha mais de 10 minutos", retidos),
                    "Abra o painel para decidir: imprimir todos, escolher quais ou descartar.", ToolTipIcon.Info);
                SystemSounds.Asterisk.Play();
            }
            retidosAvisados = retidos;

            // A busca do servidor que terminou desde a ultima leitura (a pedida pelo icone ja mostra o
            // resultado na propria acao). A que ja tinha terminado antes do icone abrir nao vira aviso.
            Dictionary<string, object> cx = C.Conexao(estado);
            Dictionary<string, object> b = E.Obj(cx, "busca");
            string fim = b != null && E.Txt(b, "duracaoMs") != "" ? E.Txt(b, "em") : "";
            if (primeiraLeitura) { buscaAvisada = fim; primeiraLeitura = false; }
            else if (fim != "" && fim != buscaAvisada)
            {
                buscaAvisada = fim;
                if (!E.Sim(b, "peloIcone"))
                {
                    if (E.Txt(b, "achou") != "" && E.Txt(b, "como") != "configurado")
                        Balao("O servidor mudou de endereco", "Achei o servidor em " + (E.Txt(cx, "ip") != "" ? E.Txt(cx, "ip") : E.Txt(b, "achou")) +
                            " e liguei de novo. Nada a fazer: o atalho do Regem continua igual.", ToolTipIcon.Info);
                    else if (E.Txt(b, "achou") == "" && !semServidorAvisado)
                    {
                        semServidorAvisado = true;
                        icone.ShowBalloonTip(15000, "Nao acho o servidor da loja",
                            "Confira se o PC servidor esta ligado e na mesma rede. Os cupons esperam aqui e saem quando ele voltar.", ToolTipIcon.Warning);
                        SystemSounds.Exclamation.Play();
                    }
                }
            }
            if (E.Sim(E.Obj(estado, "contato"), "ok")) semServidorAvisado = false;
        }

        static string Capitalizar(string s) { return s.Length > 0 ? char.ToUpper(s[0]) + s.Substring(1) : s; }

        void MontarMenu()
        {
            menu.Items.Clear();
            if (estado == null)
            {
                Rotulo(string.IsNullOrEmpty(erroLeitura) ? "Lendo o servico deste PC..." : "Regem neste PC: " + erroLeitura);
            }
            else
            {
                Rotulo("Regem neste PC", true);
                Rotulo(string.Format("{0} - {1}", E.Txt(estado, "maquina"), E.Txt(estado, "nome") != "" ? E.Txt(estado, "nome") : "sem pareamento"));
                Rotulo(C.Linha(estado));
                foreach (Dictionary<string, object> i in E.Lista(estado, "impressoras"))
                    Rotulo(string.Format("{0}: {1}", E.Txt(i, "nome"), E.Estado(i)));
                int fila = E.NaFila(estado), retidos = E.Lista(estado, "retidos").Count;
                if (E.Sim(estado, "pareada"))
                    Rotulo(string.Format("Fila: {0} cupom(ns){1}", fila, retidos > 0 ? string.Format(" - {0} esperando decisao", retidos) : ""));
            }
            menu.Items.Add(new ToolStripSeparator());
            Item("Abrir o painel", delegate { AbrirPainel(); });
            Item("Testar conexao com o servidor", delegate { TestarConexao(); });
            menu.Items.Add(new ToolStripSeparator());
            List<Dictionary<string, object>> imps = E.Lista(estado, "impressoras");
            PorImpressora("Imprimir pagina de teste", imps, null, delegate(Dictionary<string, object> i) { Acao("/teste", i, "Pagina de teste enviada."); });
            PorImpressora("Reimprimir o ultimo cupom", imps, "temUltimo", delegate(Dictionary<string, object> i) { Acao("/reimprimir", i, "Ultimo cupom reimpresso (marcado como reimpressao)."); });
            ToolStripMenuItem pausar = new ToolStripMenuItem("Pausar esta impressora");
            foreach (Dictionary<string, object> i in imps)
            {
                Dictionary<string, object> imp = i;
                ToolStripMenuItem s = new ToolStripMenuItem(E.Txt(imp, "nome"));
                s.Checked = E.Sim(imp, "pausada");
                s.Click += delegate { Pausar(imp, !E.Sim(imp, "pausada")); };
                pausar.DropDownItems.Add(s);
            }
            pausar.Enabled = imps.Count > 0;
            menu.Items.Add(pausar);
            menu.Items.Add(new ToolStripSeparator());
            // Ligada a nuvem (loja sem servidor): nao ha endereco de servidor para trocar.
            bool naNuvem = E.Sim(estado, "pareada") && C.Conexao(estado) != null && !E.Sim(C.Conexao(estado), "local");
            if (!naNuvem) Item("Trocar endereco do servidor...", delegate { TrocarEndereco(); });
            Item("Parear com codigo...", delegate { Parear(); }); // sempre (parte 2): com aviso se ja pareada
            menu.Items.Add(new ToolStripSeparator());
            Item("Esconder o icone (a impressao continua)", delegate { icone.Visible = false; ExitThread(); });
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
        delegate void ComImpressora(Dictionary<string, object> imp);
        void PorImpressora(string texto, List<Dictionary<string, object>> imps, string precisa, ComImpressora acao)
        {
            ToolStripMenuItem pai = new ToolStripMenuItem(texto);
            foreach (Dictionary<string, object> i in imps)
            {
                Dictionary<string, object> imp = i;
                ToolStripMenuItem s = new ToolStripMenuItem(E.Txt(imp, "nome"));
                s.Enabled = precisa == null || E.Sim(imp, precisa);
                s.Click += delegate { acao(imp); };
                pai.DropDownItems.Add(s);
            }
            pai.Enabled = imps.Count > 0;
            menu.Items.Add(pai);
        }

        // Acoes: rodam fora da thread da tela; o resultado vem no aviso do Windows.
        public void Acao(string caminho, Dictionary<string, object> imp, string okTexto)
        {
            Executar(delegate { painel.Chamar("POST", caminho, new Dictionary<string, object> { { "equipamentoId", E.Txt(imp, "id") } }); }, okTexto);
        }
        public void Pausar(Dictionary<string, object> imp, bool pausar)
        {
            Executar(delegate { painel.Chamar("POST", "/pausar", new Dictionary<string, object> { { "equipamentoId", E.Txt(imp, "id") }, { "pausar", pausar } }); },
                pausar ? E.Txt(imp, "nome") + " pausada: os cupons dela esperam." : E.Txt(imp, "nome") + " retomada.");
        }
        public void Retidos(string acao, List<string> ids)
        {
            Dictionary<string, object> corpo = new Dictionary<string, object> { { "acao", acao } };
            if (ids != null) corpo["ids"] = ids.ToArray();
            Executar(delegate { painel.Chamar("POST", "/retidos", corpo); }, acao == "imprimir" ? "Liberado: os cupons saem agora." : "Descartados: esses cupons nao saem mais.");
        }
        public void Parear()
        {
            string codigo = PedirCodigo(estado);
            if (codigo == null) return;
            // D4 (24/10/2026): servidor NOVO (certificado novo) - o servico passa a confiar nele tambem no Windows; o
            // navegador deste PC so ve a confianca nova quando o Regem e aberto de novo.
            ThreadPool.QueueUserWorkItem(delegate
            {
                Dictionary<string, object> r = null;
                string erro = null;
                try { r = painel.Chamar("POST", "/parear", new Dictionary<string, object> { { "codigo", codigo } }, 30000); } catch (Exception e) { erro = e.Message; }
                try
                {
                    ui.BeginInvoke(new MethodInvoker(delegate
                    {
                        if (erro != null) MessageBox.Show(erro, "Regem neste PC", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                        else if (E.Sim(r, "caRenovada"))
                            icone.ShowBalloonTip(15000, "Pareado com o servidor novo",
                                "Este PC passou a confiar no certificado novo da loja. Feche e abra o Regem neste PC (o atalho da area de trabalho).", ToolTipIcon.Info);
                        else icone.ShowBalloonTip(5000, "Regem", "Pareado. Este PC ja fala com o servidor com o cadastro novo.", ToolTipIcon.Info);
                        Ler();
                    }));
                }
                catch { }
            });
        }
        public void Executar(ThreadStart chamada, string okTexto)
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                string erro = null;
                try { chamada(); } catch (Exception e) { erro = e.Message; }
                try
                {
                    ui.BeginInvoke(new MethodInvoker(delegate
                    {
                        if (erro == null) icone.ShowBalloonTip(5000, "Regem", okTexto, ToolTipIcon.Info);
                        else MessageBox.Show(erro, "Regem neste PC", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                        Ler();
                    }));
                }
                catch { }
            });
        }

        // "Testar conexao" (e "Procurar de novo"): sem resposta, o servico procura o servidor sozinho -
        // pode levar ate ~30 s. Achou: aviso. Nao achou: o que foi tentado e o que fazer.
        public void TestarConexao() { Conferir("/testar", "Testando a conexao com o servidor..."); }
        public void Procurar() { Conferir("/procurar", "Procurando o servidor da loja..."); }
        void Conferir(string caminho, string enquanto)
        {
            icone.ShowBalloonTip(3000, "Regem neste PC", enquanto, ToolTipIcon.Info);
            ThreadPool.QueueUserWorkItem(delegate
            {
                Dictionary<string, object> r = null;
                string erro = null;
                try { r = painel.Chamar("POST", caminho, new Dictionary<string, object>(), 90000); } catch (Exception e) { erro = e.Message; }
                try { ui.BeginInvoke(new MethodInvoker(delegate { ResultadoDaConferencia(r, erro); Ler(); })); } catch { }
            });
        }
        void ResultadoDaConferencia(Dictionary<string, object> r, string erro)
        {
            if (erro != null) { MessageBox.Show(erro, "Regem neste PC", MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            Dictionary<string, object> cx = C.Conexao(estado);
            if (E.Sim(r, "ok"))
            {
                if (E.Sim(r, "nuvem"))
                    Balao("Ligada a nuvem do Regem", string.Format("{0} respondeu em {1} ms.", E.Txt(r, "alvo"), E.Num(r, "ms")), ToolTipIcon.Info);
                else
                    Balao("Ligado ao servidor", string.Format("{0} respondeu em {1} ms{2}.", E.Txt(r, "alvo"), E.Num(r, "ms"),
                        E.Sim(r, "conferido") ? " - e o servidor da sua loja" : ""), ToolTipIcon.Info);
                return;
            }
            string achou = E.Txt(r, "achou");
            if (achou != "")
            {
                Balao("O servidor mudou de endereco", "Achei o servidor em " + achou + " e liguei de novo. Nada a fazer: o atalho do Regem continua igual.", ToolTipIcon.Info);
                return;
            }
            StringBuilder sb = new StringBuilder();
            if (E.Txt(r, "alvo") != "") sb.AppendLine(string.Format("{0} nao respondeu: {1}.", E.Txt(r, "alvo"), E.Txt(r, "motivo")));
            else if (E.Txt(r, "motivo") != "") sb.AppendLine(E.Txt(r, "motivo"));
            List<string> passos = C.Passos(E.Obj(r, "busca"), cx);
            if (passos.Count > 0)
            {
                sb.AppendLine();
                sb.AppendLine("Onde procurei:");
                foreach (string p in passos) sb.AppendLine(p);
            }
            sb.AppendLine();
            sb.AppendLine("O que fazer:");
            sb.AppendLine("1. Confira se o PC servidor esta ligado e no cabo de rede (ou no Wi-Fi da loja).");
            sb.AppendLine("2. Se voce sabe o IP do servidor (Configuracoes > Servidor local, tambem pelo celular), use \"Trocar endereco do servidor\".");
            sb.AppendLine("3. Para vender agora, abra o modo nuvem. Os cupons esperam aqui e saem quando o servidor voltar.");
            MessageBox.Show(sb.ToString(), "Regem neste PC - nao acho o servidor", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }

        public void TrocarEndereco()
        {
            Dictionary<string, object> cx = C.Conexao(estado);
            string atual = E.Txt(cx, "ip") != "" ? E.Txt(cx, "ip") : E.Txt(cx, "alvo");
            using (TrocarEnderecoForm f = new TrocarEnderecoForm(this, atual)) f.ShowDialog();
            Ler();
        }

        static string PedirCodigo(Dictionary<string, object> est)
        {
            bool pareada = E.Sim(est, "pareada");
            string nome = E.Txt(est, "nome");
            using (Form f = new Form())
            {
                Montar.Dialogo(f, "Parear com codigo - Regem neste PC");
                TableLayoutPanel col = Montar.Coluna();
                if (pareada)
                {
                    // Prototipo (peca 4, "Parear de novo"): o codigo novo troca o cadastro deste PC.
                    col.Controls.Add(Montar.Faixa(string.Format("Este PC ja esta pareado como a estacao \"{0}\". Um codigo novo troca o cadastro: \"{0}\" deixa de imprimir aqui.", nome), 1));
                }
                col.Controls.Add(Montar.Texto("Codigo (6 numeros):"));
                TextBox t = new TextBox { Width = 140, MaxLength = 6, Margin = new Padding(0, 0, 0, 8) };
                col.Controls.Add(t);
                Label ajuda = Montar.Texto("Gere em Configuracoes > Equipamentos > a estacao > Gerar codigo. O codigo do caixa (terminal de PDV) nao entra aqui: ele vai na tela do PDV.");
                ajuda.ForeColor = Color.FromArgb(85, 85, 85);
                col.Controls.Add(ajuda);
                Button ok = new Button { Text = "Parear", AutoSize = true, DialogResult = DialogResult.OK };
                Button cancelar = new Button { Text = "Cancelar", AutoSize = true, DialogResult = DialogResult.Cancel };
                col.Controls.Add(Montar.Botoes(ok, cancelar));
                f.Controls.Add(col);
                f.AcceptButton = ok; f.CancelButton = cancelar;
                if (f.ShowDialog() != DialogResult.OK) return null;
                string c = t.Text.Trim();
                if (c.Length != 6) { MessageBox.Show("O codigo tem 6 numeros.", "Regem neste PC"); return null; }
                return c;
            }
        }

        void AbrirPainel()
        {
            if (janela == null || janela.IsDisposed) janela = new PainelForm(this);
            janela.Mostrar(estado, erroLeitura);
            janela.Show();
            janela.WindowState = FormWindowState.Normal;
            janela.Activate();
            Ler();
        }

        protected override void ExitThreadCore()
        {
            relogio.Stop();
            icone.Visible = false;
            icone.Dispose();
            base.ExitThreadCore();
        }
    }

    // ===== janelas pequenas que crescem com o texto (nada cortado com zoom de tela de 125% ou 150%) =====
    static class Montar
    {
        public const int Largura = 420; // a largura do texto; a janela acompanha

        public static void Dialogo(Form f, string titulo)
        {
            f.Text = titulo;
            f.FormBorderStyle = FormBorderStyle.FixedDialog;
            f.StartPosition = FormStartPosition.CenterScreen;
            f.MaximizeBox = false; f.MinimizeBox = false;
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
        // 0 = neutra, 1 = amarela (atencao), 2 = vermelha, 3 = verde
        public static Label Faixa(string texto, int tipo)
        {
            Label l = Texto(texto);
            l.Padding = new Padding(8);
            l.MinimumSize = new Size(Largura, 0);
            Pintar(l, tipo);
            return l;
        }
        public static void Pintar(Label l, int tipo)
        {
            l.BackColor = tipo == 1 ? Color.FromArgb(255, 242, 217) : tipo == 2 ? Color.FromArgb(251, 233, 233) : tipo == 3 ? Color.FromArgb(228, 245, 236) : SystemColors.Control;
            l.ForeColor = tipo == 1 ? Color.FromArgb(138, 90, 0) : tipo == 2 ? Color.FromArgb(185, 50, 50) : tipo == 3 ? Color.FromArgb(14, 100, 80) : SystemColors.ControlText;
        }
        // Os botoes do rodape, a direita.
        public static FlowLayoutPanel Botoes(params Button[] botoes)
        {
            FlowLayoutPanel p = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, WrapContents = false, Dock = DockStyle.Fill, Margin = new Padding(0, 8, 0, 0) };
            for (int i = botoes.Length - 1; i >= 0; i--) p.Controls.Add(botoes[i]);
            return p;
        }
    }

    // ===== "Trocar endereco do servidor" (emergencia): testa e so deixa usar o que respondeu =====
    public class TrocarEnderecoForm : Form
    {
        readonly Bandeja dona;
        readonly TextBox campo = new TextBox();
        readonly Label resultado;
        readonly Button testar = new Button(), usar = new Button(), cancelar = new Button();
        string testado; // o texto que passou no teste: "Usar este endereco" vale so para ele

        public TrocarEnderecoForm(Bandeja b, string atual)
        {
            dona = b;
            Montar.Dialogo(this, "Trocar endereco do servidor - Regem neste PC");
            TableLayoutPanel col = Montar.Coluna();
            col.Controls.Add(Montar.Texto("Endereco do servidor (IP ou nome):"));
            FlowLayoutPanel linha = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = new Padding(0, 0, 0, 8) };
            campo.Width = 290;
            campo.Text = atual;
            campo.Margin = new Padding(0, 3, 8, 0);
            testar.Text = "Testar"; testar.AutoSize = true; testar.Margin = new Padding(0);
            linha.Controls.Add(campo); linha.Controls.Add(testar);
            col.Controls.Add(linha);
            Label ajuda = Montar.Texto("O IP aparece em Configuracoes > Servidor local (tambem na nuvem, pelo celular).");
            ajuda.ForeColor = Color.FromArgb(85, 85, 85);
            col.Controls.Add(ajuda);
            resultado = Montar.Faixa("", 0);
            resultado.Visible = false;
            col.Controls.Add(resultado);
            usar.Text = "Usar este endereco"; usar.AutoSize = true; usar.Enabled = false;
            cancelar.Text = "Cancelar"; cancelar.AutoSize = true; cancelar.DialogResult = DialogResult.Cancel;
            col.Controls.Add(Montar.Botoes(usar, cancelar));
            Controls.Add(col);
            AcceptButton = testar; CancelButton = cancelar;
            testar.Click += delegate { Chamar(false); };
            usar.Click += delegate { Chamar(true); };
            campo.TextChanged += delegate { usar.Enabled = testado != null && campo.Text.Trim() == testado; };
        }

        void Chamar(bool usarEste)
        {
            string endereco = campo.Text.Trim();
            if (endereco == "") return;
            testar.Enabled = false; usar.Enabled = false;
            Faixa(usarEste ? "Trocando o endereco..." : "Testando " + endereco + "...", 0);
            ThreadPool.QueueUserWorkItem(delegate
            {
                Dictionary<string, object> r = null;
                string erro = null;
                try
                {
                    r = dona.Servico.Chamar("POST", "/servidor", new Dictionary<string, object> { { "endereco", endereco }, { "usar", usarEste } }, 30000);
                }
                catch (Exception e) { erro = e.Message; }
                try { BeginInvoke(new MethodInvoker(delegate { Resultado(endereco, usarEste, r, erro); })); } catch { }
            });
        }

        void Resultado(string endereco, bool usou, Dictionary<string, object> r, string erro)
        {
            testar.Enabled = true;
            bool ok = erro == null && E.Sim(r, "ok");
            if (ok && usou)
            {
                string agora = E.Txt(r, "agora") != "" ? E.Txt(r, "agora") : E.Txt(r, "endereco");
                dona.Balao("Endereco do servidor trocado", "Este PC fala com o servidor em " + agora +
                    (E.Txt(r, "hostsErro") != "" ? ". Nao consegui anotar o nome regem.local neste PC: " + E.Txt(r, "hostsErro") : "."), ToolTipIcon.Info);
                DialogResult = DialogResult.OK;
                Close();
                return;
            }
            if (ok)
            {
                testado = endereco;
                usar.Enabled = campo.Text.Trim() == testado;
                Faixa(E.Sim(r, "conferido")
                    ? string.Format("E o servidor da sua loja - versao {0} - respondeu em {1} ms.", E.Txt(r, "versao"), E.Num(r, "ms"))
                    : string.Format("Um servidor Regem respondeu em {0} ms. O certificado da loja e conferido ao parear.", E.Num(r, "ms")), 1);
                return;
            }
            testado = null;
            Faixa(erro != null ? erro : string.Format("Nao deu certo em {0}: {1}. Confira o numero.", E.Txt(r, "endereco"), E.Txt(r, "motivo")), 2);
        }

        // 0 = neutro, 1 = verde, 2 = vermelho
        void Faixa(string texto, int tipo)
        {
            resultado.Text = texto;
            resultado.Visible = true;
            Montar.Pintar(resultado, tipo == 1 ? 3 : tipo == 2 ? 2 : 0);
        }
    }

    // ===== o painel (abre pelo icone) =====
    public class PainelForm : Form
    {
        readonly Bandeja dona;
        readonly Label cabecalho = new Label();
        readonly Label faixa = new Label();
        readonly GroupBox grupoConexao = new GroupBox();
        readonly Label conexao = new Label();
        readonly Button bTestar = new Button(), bProcurar = new Button(), bTrocar = new Button(), bParear = new Button();
        readonly ListView impressoras = new ListView();
        readonly GroupBox grupoRetidos = new GroupBox();
        readonly CheckedListBox retidos = new CheckedListBox();
        readonly ListView recentes = new ListView();
        readonly Button bTeste = new Button(), bReimprimir = new Button(), bPausar = new Button();
        List<Dictionary<string, object>> imps = new List<Dictionary<string, object>>();
        List<Dictionary<string, object>> listaRetidos = new List<Dictionary<string, object>>();
        string assinaturaRetidos = "";

        public PainelForm(Bandeja b)
        {
            dona = b;
            Text = "Regem neste PC";
            Font = new Font("Segoe UI", 10);
            ClientSize = new Size(780, 720);
            MinimumSize = new Size(580, 560);
            StartPosition = FormStartPosition.CenterScreen;
            FormClosing += delegate(object s, FormClosingEventArgs e) { if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); } };

            TableLayoutPanel t = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, Padding = new Padding(10) };
            t.RowStyles.Add(new RowStyle(SizeType.AutoSize));   // cabecalho
            t.RowStyles.Add(new RowStyle(SizeType.AutoSize));   // faixa
            t.RowStyles.Add(new RowStyle(SizeType.AutoSize));   // conexao com o servidor (parte 2)
            t.RowStyles.Add(new RowStyle(SizeType.Percent, 30)); // impressoras
            t.RowStyles.Add(new RowStyle(SizeType.AutoSize));   // acoes das impressoras
            t.RowStyles.Add(new RowStyle(SizeType.AutoSize));   // fila antiga
            t.RowStyles.Add(new RowStyle(SizeType.Percent, 35)); // ultimos cupons
            Controls.Add(t);

            cabecalho.AutoSize = true; cabecalho.Font = new Font("Segoe UI", 11, FontStyle.Bold);
            t.Controls.Add(cabecalho);
            faixa.AutoSize = true; faixa.MaximumSize = new Size(740, 0); faixa.Padding = new Padding(8); faixa.Visible = false;
            t.Controls.Add(faixa);

            // A conexao com o servidor: endereco, IP, ultima resposta, como achou e a ultima busca.
            grupoConexao.Text = "Conexao com o servidor";
            grupoConexao.Dock = DockStyle.Fill; grupoConexao.AutoSize = true;
            TableLayoutPanel gc = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, AutoSize = true };
            conexao.AutoSize = true; conexao.MaximumSize = new Size(720, 0); conexao.Padding = new Padding(2, 4, 2, 4);
            FlowLayoutPanel bc = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = true };
            Configurar(bTestar, "Testar conexao", delegate { dona.TestarConexao(); });
            Configurar(bProcurar, "Procurar de novo", delegate { dona.Procurar(); });
            Configurar(bTrocar, "Trocar endereco...", delegate { dona.TrocarEndereco(); });
            Configurar(bParear, "Parear com codigo...", delegate { dona.Parear(); });
            bc.Controls.AddRange(new Control[] { bTestar, bProcurar, bTrocar, bParear });
            gc.Controls.Add(conexao); gc.Controls.Add(bc);
            grupoConexao.Controls.Add(gc);
            t.Controls.Add(grupoConexao);

            impressoras.View = View.Details; impressoras.FullRowSelect = true; impressoras.MultiSelect = false; impressoras.Dock = DockStyle.Fill; impressoras.HideSelection = false;
            impressoras.Columns.Add("Impressora", 200); impressoras.Columns.Add("Ligacao", 200); impressoras.Columns.Add("Situacao", 180); impressoras.Columns.Add("Fila", 60);
            impressoras.SelectedIndexChanged += delegate { Botoes(); };
            t.Controls.Add(impressoras);

            FlowLayoutPanel acoes = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = true };
            Configurar(bTeste, "Imprimir teste", delegate { Sel(delegate(Dictionary<string, object> i) { dona.Acao("/teste", i, "Pagina de teste enviada."); }); });
            Configurar(bReimprimir, "Reimprimir o ultimo", delegate { Sel(delegate(Dictionary<string, object> i) { dona.Acao("/reimprimir", i, "Ultimo cupom reimpresso (marcado como reimpressao)."); }); });
            Configurar(bPausar, "Pausar", delegate { Sel(delegate(Dictionary<string, object> i) { dona.Pausar(i, !E.Sim(i, "pausada")); }); });
            acoes.Controls.AddRange(new Control[] { bTeste, bReimprimir, bPausar });
            t.Controls.Add(acoes);

            // A fila antiga (mais de 10 min): quem esta no PC decide - decisao do dono, 15/10/2026.
            grupoRetidos.Text = "Cupons que esperam ha mais de 10 minutos";
            grupoRetidos.Dock = DockStyle.Fill; grupoRetidos.AutoSize = true; grupoRetidos.Visible = false;
            TableLayoutPanel gr = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, AutoSize = true };
            Label aviso = new Label { AutoSize = true, MaximumSize = new Size(700, 0), Text = "Imprimir agora pode repetir um pedido que ja foi feito a mao. Marque os que devem sair, ou imprima / descarte todos." };
            retidos.CheckOnClick = true; retidos.Dock = DockStyle.Fill; retidos.Height = 110; retidos.IntegralHeight = false;
            FlowLayoutPanel br = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = true };
            Button todos = new Button(), marcados = new Button(), descartar = new Button(), descartarTodos = new Button();
            Configurar(todos, "Imprimir todos", delegate { dona.Retidos("imprimir", null); });
            Configurar(marcados, "Imprimir os marcados", delegate { List<string> ids = Marcados(); if (ids.Count > 0) dona.Retidos("imprimir", ids); });
            Configurar(descartar, "Descartar os marcados", delegate
            {
                List<string> ids = Marcados();
                if (ids.Count > 0 && Confirmar(ids.Count)) dona.Retidos("descartar", ids);
            });
            Configurar(descartarTodos, "Descartar todos", delegate { if (listaRetidos.Count > 0 && Confirmar(listaRetidos.Count)) dona.Retidos("descartar", null); });
            br.Controls.AddRange(new Control[] { todos, marcados, descartar, descartarTodos });
            gr.Controls.Add(aviso); gr.Controls.Add(retidos); gr.Controls.Add(br);
            grupoRetidos.Controls.Add(gr);
            t.Controls.Add(grupoRetidos);

            recentes.View = View.Details; recentes.FullRowSelect = true; recentes.Dock = DockStyle.Fill;
            recentes.Columns.Add("Hora", 60); recentes.Columns.Add("Pedido", 280); recentes.Columns.Add("Impressora", 160); recentes.Columns.Add("Situacao", 200);
            t.Controls.Add(recentes);
        }

        static void Configurar(Button b, string texto, EventHandler acao)
        {
            b.Text = texto; b.AutoSize = true; b.Padding = new Padding(6, 2, 6, 2); b.Click += acao;
        }
        delegate void ComImpressora(Dictionary<string, object> imp);
        void Sel(ComImpressora f)
        {
            if (impressoras.SelectedIndices.Count == 0) { MessageBox.Show("Escolha a impressora na lista.", "Regem neste PC"); return; }
            f(imps[impressoras.SelectedIndices[0]]);
        }
        List<string> Marcados()
        {
            List<string> ids = new List<string>();
            foreach (int i in retidos.CheckedIndices) ids.Add(E.Txt(listaRetidos[i], "id"));
            if (ids.Count == 0) MessageBox.Show("Marque os cupons na lista.", "Regem neste PC");
            return ids;
        }
        static bool Confirmar(int n)
        {
            return MessageBox.Show(string.Format("Descartar {0} cupom(ns)? Eles nao saem mais nesta impressora.", n), "Regem neste PC",
                MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
        }
        void Botoes()
        {
            bool tem = impressoras.SelectedIndices.Count > 0;
            Dictionary<string, object> i = tem ? imps[impressoras.SelectedIndices[0]] : null;
            bTeste.Enabled = tem;
            bReimprimir.Enabled = tem && E.Sim(i, "temUltimo");
            bPausar.Enabled = tem;
            bPausar.Text = tem && E.Sim(i, "pausada") ? "Retomar" : "Pausar";
        }

        // O bloco "Conexao com o servidor" (prototipo, peca 4).
        void MostrarConexao(Dictionary<string, object> est)
        {
            Dictionary<string, object> c = C.Conexao(est), ct = E.Obj(est, "contato");
            List<string> linhas = new List<string>();
            linhas.Add("Situacao: " + C.Linha(est));
            if (c != null)
            {
                linhas.Add("Endereco: " + (E.Txt(c, "alvo") != "" ? E.Txt(c, "alvo") : "(sem endereco)") +
                    (E.Txt(c, "configurado") != "" && E.Txt(c, "configurado") != E.Txt(c, "alvo") ? "   (configurado: " + E.Txt(c, "configurado") + ")" : ""));
                if (E.Txt(c, "ip") != "") linhas.Add("IP agora: " + E.Txt(c, "ip"));
                int s = C.Segundos(E.Txt(c, "ultimaResposta"));
                if (s >= 0) linhas.Add("Ultima resposta: " + C.Ha(s) + (E.Num(c, "latenciaMs") > 0 ? " - " + E.Num(c, "latenciaMs") + " ms" : ""));
                if (C.Como(c) != "") linhas.Add("Como achou: " + C.Como(c));
                Dictionary<string, object> h = E.Obj(c, "hosts");
                if (h != null && E.Txt(h, "ip") != "") linhas.Add("Anotado neste PC: " + E.Txt(c, "nome") + " -> " + E.Txt(h, "ip") + " (arquivo de nomes do Windows)");
                // A ultima busca: quando o servidor foi achado em outro lugar ou nao foi achado.
                Dictionary<string, object> b = E.Obj(c, "busca");
                if (b != null && (E.Sim(c, "buscando") || E.Txt(b, "achou") == "" || E.Txt(b, "como") != "configurado"))
                {
                    linhas.Add("");
                    linhas.Add(E.Sim(c, "buscando") ? "Procurando agora:" : "Ultima busca (" + E.Hora(E.Txt(b, "em")) + "):");
                    linhas.AddRange(C.Passos(b, c));
                }
            }
            conexao.Text = string.Join(Environment.NewLine, linhas.ToArray());
            bool local = c != null && E.Sim(c, "local");
            bool semServidor = E.Sim(est, "pareada") && ct != null && !E.Sim(ct, "ok") && E.Txt(ct, "erro") != "";
            // Recusada pelo servidor: procurar nao adianta (ele respondeu e recusou) - o caminho e parear de novo.
            bProcurar.Visible = local && !E.Sim(ct, "recusada") && (semServidor || !E.Sim(est, "pareada"));
            bProcurar.Enabled = c != null && !E.Sim(c, "buscando");
            bTestar.Enabled = c != null && !E.Sim(c, "buscando");
            bTrocar.Visible = c == null || local || !E.Sim(est, "pareada");
        }

        public void Mostrar(Dictionary<string, object> est, string erro)
        {
            if (est == null)
            {
                cabecalho.Text = "Regem neste PC";
                faixa.Text = "O servico do Regem neste PC nao responde" + (string.IsNullOrEmpty(erro) ? "." : ": " + erro + ".");
                faixa.BackColor = Color.FromArgb(251, 233, 233); faixa.ForeColor = Color.FromArgb(185, 50, 50); faixa.Visible = true;
                return;
            }
            Dictionary<string, object> c = E.Obj(est, "contato");
            cabecalho.Text = string.Format("{0} - {1} - versao {2}", E.Txt(est, "maquina"),
                E.Txt(est, "nome") != "" ? E.Txt(est, "nome") : "sem pareamento", E.Txt(est, "versao"));
            MostrarConexao(est);

            // A faixa: o que pede atencao agora.
            List<string> avisos = new List<string>();
            bool vermelho = false;
            if (!E.Sim(est, "pareada")) avisos.Add("Este PC ainda nao foi pareado: clique em \"Parear com codigo...\".");
            if (c != null && E.Sim(c, "recusada"))
            {
                // Parear sem reinstalar (22/10/2026): o servidor respondeu e RECUSOU esta estacao (revogada no Regem, ou
                // pareada de novo em outro PC). Nao e "sem servidor": o caminho e um codigo novo, sem reinstalar.
                avisos.Add("O servidor da loja recusou esta estacao (" + E.Txt(c, "erro") + "). Gere um codigo no Regem (Configuracoes > Equipamentos > " +
                    (E.Txt(est, "nome") != "" ? E.Txt(est, "nome") : "a estacao") + " > Gerar codigo) e clique em \"Parear com codigo...\". Os cupons esperam aqui.");
                vermelho = true;
            }
            else if (c != null && !E.Sim(c, "ok") && E.Txt(c, "erro") != "")
            {
                avisos.Add("Sem contato com o servidor: " + E.Txt(c, "erro") + ". O Regem procura o servidor sozinho; os cupons esperam aqui.");
                vermelho = true;
                // A ultima busca terminou sem achar: o que fazer (prototipo, peca 4, "Servidor desligado").
                Dictionary<string, object> cx = C.Conexao(est), bx = E.Obj(cx, "busca");
                if (bx != null && !E.Sim(cx, "buscando") && E.Txt(bx, "duracaoMs") != "" && E.Txt(bx, "achou") == "")
                    avisos.Add("O que fazer: ligue o PC servidor ou confira o cabo de rede dele. Se voce sabe o IP do servidor (Configuracoes > Servidor local, tambem pelo celular), use \"Trocar endereco...\".");
            }
            foreach (Dictionary<string, object> i in E.Lista(est, "impressoras"))
            {
                if (E.Critico(i)) { avisos.Add(string.Format("{0}: {1}. Resolva na impressora - a fila volta sozinha em alguns segundos; o cupom que parou no meio sai de novo inteiro, marcado.", E.Txt(i, "nome"), E.Estado(i))); vermelho = true; }
                else if (E.Txt(i, "estado") == "papel_acabando") avisos.Add(E.Txt(i, "nome") + ": papel acabando. Ela continua imprimindo; deixe uma bobina nova a mao.");
                else if (E.Sim(i, "pausada")) avisos.Add(E.Txt(i, "nome") + ": pausada neste PC - os cupons dela esperam.");
            }
            faixa.Text = string.Join(Environment.NewLine, avisos.ToArray());
            faixa.Visible = avisos.Count > 0;
            faixa.BackColor = vermelho ? Color.FromArgb(251, 233, 233) : Color.FromArgb(255, 242, 217);
            faixa.ForeColor = vermelho ? Color.FromArgb(185, 50, 50) : Color.FromArgb(138, 90, 0);

            // Impressoras (mantem a escolhida).
            string escolhida = impressoras.SelectedIndices.Count > 0 && impressoras.SelectedIndices[0] < imps.Count ? E.Txt(imps[impressoras.SelectedIndices[0]], "id") : "";
            imps = E.Lista(est, "impressoras");
            impressoras.BeginUpdate();
            impressoras.Items.Clear();
            foreach (Dictionary<string, object> i in imps)
            {
                ListViewItem li = new ListViewItem(new string[] { E.Txt(i, "nome"), E.Txt(i, "alvo"), E.Estado(i), E.Num(i, "naFila").ToString() });
                if (E.Critico(i)) li.ForeColor = Color.FromArgb(185, 50, 50);
                impressoras.Items.Add(li);
                if (E.Txt(i, "id") == escolhida) li.Selected = true;
            }
            if (impressoras.SelectedIndices.Count == 0 && impressoras.Items.Count > 0) impressoras.Items[0].Selected = true;
            impressoras.EndUpdate();
            Botoes();

            // Fila antiga: so redesenha quando muda (nao desmarca o que a pessoa esta marcando).
            listaRetidos = E.Lista(est, "retidos");
            StringBuilder sb = new StringBuilder();
            foreach (Dictionary<string, object> r in listaRetidos) sb.Append(E.Txt(r, "id")).Append(';');
            if (sb.ToString() != assinaturaRetidos)
            {
                assinaturaRetidos = sb.ToString();
                retidos.Items.Clear();
                foreach (Dictionary<string, object> r in listaRetidos)
                    retidos.Items.Add(string.Format("{0}   {1}   ({2})", E.Hora(E.Txt(r, "criadoEm")), E.Txt(r, "resumo"), E.Txt(r, "impressora")));
            }
            grupoRetidos.Visible = listaRetidos.Count > 0;

            recentes.BeginUpdate();
            recentes.Items.Clear();
            foreach (Dictionary<string, object> r in E.Lista(est, "recentes"))
                recentes.Items.Add(new ListViewItem(new string[] { E.Hora(E.Txt(r, "em")), E.Txt(r, "resumo"), E.Txt(r, "impressora"), E.Situacao(E.Txt(r, "situacao")) }));
            recentes.EndUpdate();
        }
    }

    static class Programa
    {
        [STAThread]
        static int Main(string[] args)
        {
            Painel p = new Painel();
            string diagnostico = null, abrir = null;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--raiz" && i + 1 < args.Length) p.Raiz = args[++i];
                else if (args[i] == "--porta" && i + 1 < args.Length) p.Porta = int.Parse(args[++i]);
                else if (args[i] == "--diagnostico" && i + 1 < args.Length) diagnostico = args[++i];
                else if (args[i] == "--abrir" && i + 1 < args.Length) abrir = args[++i]; // painel | trocar | parear
            }
            if (string.IsNullOrEmpty(p.Raiz))
                p.Raiz = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), @"..\..\..\estacao"));

            if (diagnostico != null) return Diagnosticar(p, diagnostico);

            // Um icone por sessao do Windows.
            bool novo;
            using (Mutex m = new Mutex(true, "Local\\RegemEstacaoBandeja", out novo))
            {
                if (!novo)
                {
                    // O icone ja esta aberto: o atalho "Regem - parear este PC" (--abrir parear) so o acorda.
                    if (abrir == "parear")
                    {
                        try { using (EventWaitHandle ev = EventWaitHandle.OpenExisting(Bandeja.SinalDeParear)) ev.Set(); } catch { }
                    }
                    return 0;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new Bandeja(p, abrir));
            }
            return 0;
        }

        // Le o estado UMA vez e grava o que o icone mostraria (teste automatico; nao abre tela).
        static int Diagnosticar(Painel p, string arquivo)
        {
            StringBuilder sb = new StringBuilder();
            try
            {
                Dictionary<string, object> est = p.Chamar("GET", "/estado", null);
                sb.AppendLine("nivel=" + E.Nivel(est));
                sb.AppendLine("nome=" + E.Txt(est, "nome"));
                sb.AppendLine("pareada=" + E.Sim(est, "pareada"));
                sb.AppendLine("conexao=" + C.Linha(est));
                Dictionary<string, object> c = C.Conexao(est);
                if (c != null)
                {
                    sb.AppendLine(string.Format("alvo={0}|ip={1}|como={2}|local={3}", E.Txt(c, "alvo"), E.Txt(c, "ip"), C.Como(c), E.Sim(c, "local")));
                    foreach (string passo in C.Passos(E.Obj(c, "busca"), c)) sb.AppendLine("busca=" + passo);
                }
                foreach (Dictionary<string, object> i in E.Lista(est, "impressoras"))
                    sb.AppendLine(string.Format("impressora={0}|{1}|{2}|fila={3}", E.Txt(i, "nome"), E.Txt(i, "alvo"), E.Estado(i), E.Num(i, "naFila")));
                sb.AppendLine("retidos=" + E.Lista(est, "retidos").Count);
                foreach (Dictionary<string, object> r in E.Lista(est, "recentes"))
                    sb.AppendLine(string.Format("recente={0}|{1}", E.Txt(r, "resumo"), E.Situacao(E.Txt(r, "situacao"))));
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
