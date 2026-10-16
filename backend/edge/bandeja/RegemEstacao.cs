// Regem - icone da ESTACAO DE IMPRESSAO na bandeja do Windows (central de impressao, fase 1, PR 4b).
//
// Fica ao lado do relogio em todo PC com estacao. A bolinha diz o estado de todas as impressoras
// do PC (verde, amarelo, vermelho; cinza = o servico nao responde). O menu faz as acoes DESTE PC:
// abrir o painel, imprimir teste, reimprimir o ultimo cupom, pausar uma impressora, parear com um
// codigo novo. Quando algo para (sem papel, tampa aberta) ou a fila antiga precisa de decisao, o
// aviso do Windows aparece, com som. Mudar o que imprime onde e no Regem, nao aqui.
//
// Fala SO com o servico da estacao neste PC: http://127.0.0.1:<porta> com a chave de painel.key
// (a pasta de dados da estacao). Esconder o icone nao para a impressao: quem imprime e o servico.
//
// Compila com o compilador do proprio Windows (.NET Framework 4.8, C# 5), sem instalar nada:
//   csc /target:winexe /out:RegemEstacao.exe /r:System.Web.Extensions.dll RegemEstacao.cs
// Uso: RegemEstacao.exe --raiz "C:\regem-edge\estacao" [--porta 17311]
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
            if (!File.Exists(arq)) throw new Exception("o servico da estacao ainda nao criou a chave do painel");
            return File.ReadAllText(arq).Trim();
        }

        public Dictionary<string, object> Chamar(string metodo, string caminho, object corpo)
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Porta + caminho);
            req.Method = metodo;
            req.Timeout = 20000;
            req.ReadWriteTimeout = 20000;
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
                if (we.Response == null) throw new Exception("o servico da estacao nao responde neste PC");
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
            int n = 0;
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

        public Bandeja(Painel p)
        {
            painel = p;
            ui.CreateControl();
            for (int i = 0; i < 4; i++) icones[i] = Desenhar(i);
            icone.Icon = icones[3];
            icone.Text = "Regem - estacao de impressao";
            icone.ContextMenuStrip = menu;
            icone.Visible = true;
            icone.DoubleClick += delegate { AbrirPainel(); };
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
        void Ler()
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
            string dica = estado == null
                ? "Regem: o servico da estacao nao responde"
                : string.Format("Regem - {0}: {1}", E.Txt(estado, "nome") != "" ? E.Txt(estado, "nome") : "estacao", nivel == 0 ? "tudo pronto" : nivel == 1 ? "atencao" : "parada");
            icone.Text = dica.Length > 63 ? dica.Substring(0, 63) : dica;
            Avisar();
            if (janela != null && !janela.IsDisposed) janela.Mostrar(estado, erroLeitura);
        }

        // O aviso do Windows quando uma impressora para, e quando a fila antiga pede decisao.
        void Avisar()
        {
            if (estado == null) return;
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
                    "Abra o painel da estacao para decidir: imprimir todos, escolher quais ou descartar.", ToolTipIcon.Info);
                SystemSounds.Asterisk.Play();
            }
            retidosAvisados = retidos;
        }

        static string Capitalizar(string s) { return s.Length > 0 ? char.ToUpper(s[0]) + s.Substring(1) : s; }

        void MontarMenu()
        {
            menu.Items.Clear();
            if (estado == null)
            {
                Rotulo(string.IsNullOrEmpty(erroLeitura) ? "Lendo a estacao..." : "Estacao: " + erroLeitura);
            }
            else
            {
                Rotulo(string.Format("Estacao {0}", E.Txt(estado, "nome") != "" ? E.Txt(estado, "nome") : "(sem pareamento)"), true);
                Rotulo(string.Format("{0} - {1}", E.Txt(estado, "maquina"),
                    E.Sim(estado, "pareada") ? "ligada a " + E.Txt(estado, "servidor") : "ainda nao pareada"));
                foreach (Dictionary<string, object> i in E.Lista(estado, "impressoras"))
                    Rotulo(string.Format("{0}: {1}", E.Txt(i, "nome"), E.Estado(i)));
                int fila = E.NaFila(estado), retidos = E.Lista(estado, "retidos").Count;
                Rotulo(string.Format("Fila: {0} cupom(ns){1}", fila, retidos > 0 ? string.Format(" - {0} esperando decisao", retidos) : ""));
            }
            menu.Items.Add(new ToolStripSeparator());
            Item("Abrir o painel da estacao", delegate { AbrirPainel(); });
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
            if (estado != null && !E.Sim(estado, "pareada")) Item("Parear com codigo...", delegate { Parear(); });
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
            string codigo = PedirCodigo();
            if (codigo == null) return;
            Executar(delegate { painel.Chamar("POST", "/parear", new Dictionary<string, object> { { "codigo", codigo } }); }, "Estacao pareada.");
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
                        else MessageBox.Show(erro, "Estacao de impressao", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                        Ler();
                    }));
                }
                catch { }
            });
        }

        static string PedirCodigo()
        {
            using (Form f = new Form())
            {
                f.Text = "Parear a estacao de impressao";
                f.FormBorderStyle = FormBorderStyle.FixedDialog;
                f.StartPosition = FormStartPosition.CenterScreen;
                f.MaximizeBox = false; f.MinimizeBox = false;
                f.ClientSize = new Size(380, 150);
                f.Font = new Font("Segoe UI", 10);
                Label l = new Label { Text = "Gere o codigo no Regem (Configuracoes > Equipamentos > Gerar codigo da estacao) e digite os 6 numeros:", Left = 14, Top = 12, Width = 350, Height = 44 };
                TextBox t = new TextBox { Left = 14, Top = 62, Width = 140, MaxLength = 6 };
                Button ok = new Button { Text = "Parear", Left = 190, Top = 104, Width = 80, DialogResult = DialogResult.OK };
                Button cancelar = new Button { Text = "Cancelar", Left = 280, Top = 104, Width = 86, DialogResult = DialogResult.Cancel };
                f.Controls.AddRange(new Control[] { l, t, ok, cancelar });
                f.AcceptButton = ok; f.CancelButton = cancelar;
                if (f.ShowDialog() != DialogResult.OK) return null;
                string c = t.Text.Trim();
                if (c.Length != 6) { MessageBox.Show("O codigo tem 6 numeros.", "Estacao de impressao"); return null; }
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

    // ===== o painel da estacao (abre pelo icone) =====
    public class PainelForm : Form
    {
        readonly Bandeja dona;
        readonly Label cabecalho = new Label();
        readonly Label faixa = new Label();
        readonly ListView impressoras = new ListView();
        readonly GroupBox grupoRetidos = new GroupBox();
        readonly CheckedListBox retidos = new CheckedListBox();
        readonly ListView recentes = new ListView();
        readonly Button bTeste = new Button(), bReimprimir = new Button(), bPausar = new Button(), bParear = new Button();
        List<Dictionary<string, object>> imps = new List<Dictionary<string, object>>();
        List<Dictionary<string, object>> listaRetidos = new List<Dictionary<string, object>>();
        string assinaturaRetidos = "";

        public PainelForm(Bandeja b)
        {
            dona = b;
            Text = "Estacao de impressao - Regem";
            Font = new Font("Segoe UI", 10);
            ClientSize = new Size(760, 600);
            MinimumSize = new Size(560, 480);
            StartPosition = FormStartPosition.CenterScreen;
            FormClosing += delegate(object s, FormClosingEventArgs e) { if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); } };

            TableLayoutPanel t = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, Padding = new Padding(10) };
            t.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            t.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            t.RowStyles.Add(new RowStyle(SizeType.Percent, 30));
            t.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            t.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            t.RowStyles.Add(new RowStyle(SizeType.Percent, 35));
            Controls.Add(t);

            cabecalho.AutoSize = true; cabecalho.Font = new Font("Segoe UI", 11, FontStyle.Bold);
            t.Controls.Add(cabecalho);
            faixa.AutoSize = true; faixa.MaximumSize = new Size(720, 0); faixa.Padding = new Padding(8); faixa.Visible = false;
            t.Controls.Add(faixa);

            impressoras.View = View.Details; impressoras.FullRowSelect = true; impressoras.MultiSelect = false; impressoras.Dock = DockStyle.Fill; impressoras.HideSelection = false;
            impressoras.Columns.Add("Impressora", 200); impressoras.Columns.Add("Ligacao", 200); impressoras.Columns.Add("Situacao", 180); impressoras.Columns.Add("Fila", 60);
            impressoras.SelectedIndexChanged += delegate { Botoes(); };
            t.Controls.Add(impressoras);

            FlowLayoutPanel acoes = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = true };
            Configurar(bTeste, "Imprimir teste", delegate { Sel(delegate(Dictionary<string, object> i) { dona.Acao("/teste", i, "Pagina de teste enviada."); }); });
            Configurar(bReimprimir, "Reimprimir o ultimo", delegate { Sel(delegate(Dictionary<string, object> i) { dona.Acao("/reimprimir", i, "Ultimo cupom reimpresso (marcado como reimpressao)."); }); });
            Configurar(bPausar, "Pausar", delegate { Sel(delegate(Dictionary<string, object> i) { dona.Pausar(i, !E.Sim(i, "pausada")); }); });
            Configurar(bParear, "Parear com codigo...", delegate { dona.Parear(); });
            acoes.Controls.AddRange(new Control[] { bTeste, bReimprimir, bPausar, bParear });
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
            if (impressoras.SelectedIndices.Count == 0) { MessageBox.Show("Escolha a impressora na lista.", "Estacao de impressao"); return; }
            f(imps[impressoras.SelectedIndices[0]]);
        }
        List<string> Marcados()
        {
            List<string> ids = new List<string>();
            foreach (int i in retidos.CheckedIndices) ids.Add(E.Txt(listaRetidos[i], "id"));
            if (ids.Count == 0) MessageBox.Show("Marque os cupons na lista.", "Estacao de impressao");
            return ids;
        }
        static bool Confirmar(int n)
        {
            return MessageBox.Show(string.Format("Descartar {0} cupom(ns)? Eles nao saem mais nesta impressora.", n), "Estacao de impressao",
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

        public void Mostrar(Dictionary<string, object> est, string erro)
        {
            if (est == null)
            {
                cabecalho.Text = "Estacao de impressao";
                faixa.Text = "O servico da estacao nao responde neste PC" + (string.IsNullOrEmpty(erro) ? "." : ": " + erro + ".");
                faixa.BackColor = Color.FromArgb(251, 233, 233); faixa.ForeColor = Color.FromArgb(185, 50, 50); faixa.Visible = true;
                return;
            }
            Dictionary<string, object> c = E.Obj(est, "contato");
            cabecalho.Text = string.Format("Estacao {0}   {1} - versao {2} - {3}",
                E.Txt(est, "nome"), E.Txt(est, "maquina"), E.Txt(est, "versao"),
                !E.Sim(est, "pareada") ? "ainda nao pareada" : c != null && E.Sim(c, "ok") ? "ligada a " + E.Txt(est, "servidor") : "sem contato com " + E.Txt(est, "servidor"));
            bParear.Visible = !E.Sim(est, "pareada");

            // A faixa: o que pede atencao agora.
            List<string> avisos = new List<string>();
            bool vermelho = false;
            if (!E.Sim(est, "pareada")) avisos.Add("Esta estacao ainda nao foi pareada: clique em \"Parear com codigo...\".");
            if (c != null && !E.Sim(c, "ok") && E.Txt(c, "erro") != "") { avisos.Add("Sem contato com o servidor: " + E.Txt(c, "erro")); vermelho = true; }
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
            string diagnostico = null;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--raiz" && i + 1 < args.Length) p.Raiz = args[++i];
                else if (args[i] == "--porta" && i + 1 < args.Length) p.Porta = int.Parse(args[++i]);
                else if (args[i] == "--diagnostico" && i + 1 < args.Length) diagnostico = args[++i];
            }
            if (string.IsNullOrEmpty(p.Raiz))
                p.Raiz = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), @"..\..\..\estacao"));

            if (diagnostico != null) return Diagnosticar(p, diagnostico);

            // Um icone por sessao do Windows.
            bool novo;
            using (Mutex m = new Mutex(true, "Local\\RegemEstacaoBandeja", out novo))
            {
                if (!novo) return 0;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new Bandeja(p));
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
