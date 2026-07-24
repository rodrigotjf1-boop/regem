'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  api,
  setToken,
  getToken,
  getCategoria,
  rotaInicial,
  getWorkspace,
  setWorkspace,
  type Workspace,
} from '@/lib/api';

// Login (split-screen). Porte fiel do mockup Fable "regem-login" — CSS escopado em .lg.
const CSS = `
.lg{font-family:var(--font-sans);background:#0D1A2B;color:#F2F5F9;min-height:100dvh}
.lg a{color:#E8A845;text-decoration:none;font-weight:600}
.lg button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
.lg :focus-visible{outline:2px solid #4AA8E0;outline-offset:2px;border-radius:4px}
@media (prefers-reduced-motion:reduce){.lg *{animation:none!important;transition:none!important}}
.lg .split{display:grid;grid-template-columns:1fr 1fr;min-height:100dvh}
@media(max-width:880px){.lg .split{grid-template-columns:1fr}.lg .brand-side{display:none}}
.lg .brand-side{position:relative;overflow:hidden;background:radial-gradient(1200px 800px at 20% 10%,#16294A 0%,#0D1A2B 60%);display:flex;flex-direction:column;padding:48px 52px}
.lg .brand-side::before{content:"";position:absolute;left:60%;top:55%;width:820px;height:820px;transform:translate(-50%,-50%);border:1px solid rgba(232,168,69,.1);border-radius:50%}
.lg .brand-side::after{content:"";position:absolute;left:60%;top:55%;width:1240px;height:1240px;transform:translate(-50%,-50%);border:1px solid rgba(159,178,200,.06);border-radius:50%}
.lg .logo{display:flex;align-items:center;gap:11px;font-family:var(--font-display);font-weight:800;font-size:20px;position:relative;z-index:1}
.lg .logo-mark{width:34px;height:34px;border-radius:50%;border:2.5px solid #E8A845;display:grid;place-items:center;color:#E8A845;font-size:15px;font-weight:800}
.lg .brand-center{flex:1;display:flex;flex-direction:column;justify-content:center;position:relative;z-index:1;max-width:460px}
.lg .eyebrow{font-family:var(--font-mono);font-size:11px;letter-spacing:.34em;color:#E8A845;text-transform:uppercase}
.lg .brand-h{font-family:var(--font-display);font-weight:800;font-size:clamp(26px,3vw,36px);line-height:1.15;letter-spacing:-.015em;margin:16px 0 26px;min-height:3.4em;transition:opacity .5s}
.lg .brand-h em{font-style:normal;color:#E8A845}
.lg .mini-tl{background:rgba(18,35,58,.75);border:1px solid #1A3050;border-radius:14px;padding:16px 18px;backdrop-filter:blur(4px)}
.lg .mtl-head{display:flex;align-items:center;font-family:var(--font-mono);font-size:9px;letter-spacing:.16em;color:#5F7590;margin-bottom:12px}
.lg .mtl-head .live{margin-left:auto;color:#2EBD85;display:flex;align-items:center;gap:5px}
.lg .mtl-head .live::before{content:"";width:6px;height:6px;border-radius:50%;background:#2EBD85;animation:lgPulse 1.8s infinite}
@keyframes lgPulse{50%{opacity:.3}}
.lg .mtl-row{display:grid;grid-template-columns:64px 1fr;align-items:center;margin-bottom:8px}
.lg .mtl-sector{font-family:var(--font-display);font-size:9px;font-weight:700;letter-spacing:.1em;color:#9FB2C8;text-transform:uppercase}
.lg .mtl-track{position:relative;height:22px;background:rgba(159,178,200,.07);border-radius:5px}
.lg .mtl-block{position:absolute;top:3px;bottom:3px;border-radius:4px}
.lg .b-ok{background:#2EBD85}.lg .b-info{background:#4AA8E0}.lg .b-brand{background:#E8A845}
.lg .mtl-now{position:absolute;top:-6px;bottom:2px;width:2px;background:#E05252;animation:lgNowMove 12s linear infinite;z-index:2}
@keyframes lgNowMove{from{left:18%}50%{left:74%}to{left:18%}}
.lg .brand-foot{position:relative;z-index:1;font-family:var(--font-mono);font-size:10px;letter-spacing:.26em;color:#5F7590}
.lg .form-side{display:flex;align-items:center;justify-content:center;padding:40px 24px;background:#0D1A2B}
.lg .form-card{width:100%;max-width:400px}
.lg .form-logo{display:none;justify-content:center;margin-bottom:22px}
@media(max-width:880px){.lg .form-logo{display:flex}}
.lg .form-title{font-family:var(--font-display);font-weight:800;font-size:24px;text-align:center}
.lg .form-sub{color:#9FB2C8;font-size:14px;text-align:center;margin:6px 0 26px}
.lg .seg{display:grid;grid-template-columns:1fr 1fr;background:#12233A;border:1px solid #1A3050;border-radius:12px;padding:4px;margin-bottom:24px}
.lg .seg button{padding:10px 8px;border-radius:9px;font-size:13.5px;font-weight:700;color:#5F7590;transition:background .18s,color .18s}
.lg .seg button.on{background:#E8A845;color:#2A1D06}
.lg .field{margin-bottom:16px}
.lg .field label{display:block;font-size:13px;font-weight:700;margin-bottom:7px}
.lg .in-wrap{position:relative}
.lg .field input{width:100%;padding:13px 44px 13px 15px;background:#12233A;border:1.5px solid #1A3050;border-radius:11px;color:#F2F5F9;font-family:var(--font-sans);font-size:14.5px;transition:border-color .15s}
.lg .field input::placeholder{color:#5F7590}
.lg .field input:focus{outline:none;border-color:#E8A845}
.lg .field.err input{border-color:#E05252}
.lg .eye{position:absolute;right:12px;top:50%;transform:translateY(-50%);font-size:16px;color:#5F7590;padding:4px}
.lg .field-msg{font-size:12px;margin-top:6px;display:none}
.lg .field-msg.show{display:block}
.lg .msg-err{color:#E05252}.lg .msg-warn{color:#E06A3C}
.lg .row-between{display:flex;justify-content:space-between;align-items:center;margin:-6px 0 20px}
.lg .remember{display:flex;align-items:center;gap:8px;font-size:13px;color:#9FB2C8;font-weight:400}
.lg .remember input{accent-color:#E8A845}
.lg .forgot{font-size:13px}
.lg .btn-submit{width:100%;padding:14px;border-radius:12px;background:#E8A845;color:#2A1D06;font-family:var(--font-display);font-weight:800;font-size:15px;letter-spacing:.02em;transition:filter .15s;display:flex;align-items:center;justify-content:center;gap:10px}
.lg .btn-submit:hover{filter:brightness(1.07)}
.lg .btn-submit:disabled{opacity:.7;cursor:wait}
.lg .spinner{width:16px;height:16px;border:2.5px solid rgba(42,29,6,.3);border-top-color:#2A1D06;border-radius:50%;animation:lgSpin .7s linear infinite;display:none}
.lg .btn-submit.loading .spinner{display:block}
@keyframes lgSpin{to{transform:rotate(360deg)}}
.lg .audit-note{display:flex;gap:8px;justify-content:center;align-items:center;font-size:11.5px;color:#5F7590;margin-top:18px;text-align:center}
.lg .signup{text-align:center;font-size:13.5px;color:#9FB2C8;margin-top:22px}
.lg .pin-hint{text-align:center;font-size:13px;color:#9FB2C8;margin-bottom:18px}
.lg .pin-dots{display:flex;gap:14px;justify-content:center;margin-bottom:22px}
.lg .pd{width:14px;height:14px;border-radius:50%;border:2px solid #5F7590}
.lg .pd.f{background:#E8A845;border-color:#E8A845}
.lg .pad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-width:280px;margin:0 auto}
.lg .key{height:60px;border-radius:13px;background:#12233A;border:1px solid #1A3050;font-family:var(--font-mono);font-size:21px;font-weight:700;transition:background .12s,transform .08s}
.lg .key:hover{background:#1A3050}
.lg .key:active{transform:scale(.95)}
.lg .key.fn{font-family:var(--font-display);font-size:11px;letter-spacing:.08em;color:#5F7590}
.lg .pin-terminal{display:flex;justify-content:center;gap:8px;margin-top:18px;font-family:var(--font-mono);font-size:10.5px;color:#5F7590}
.lg .pin-terminal b{color:#2EBD85}
`;

const PHRASES = [
  <>
    Sua operação inteira,
    <br />
    <em>numa linha do tempo.</em>
  </>,
  <>
    A escala manda.
    <br />
    <em>O resto acontece sozinho.</em>
  </>,
  <>
    Do balcão
    <br />
    <em>ao balanço.</em>
  </>,
  <>
    Cada nível vê
    <br />
    <em>exatamente o que precisa.</em>
  </>,
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [caps, setCaps] = useState(false);
  const [emailErr, setEmailErr] = useState(false);
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);
  const [pi, setPi] = useState(0);
  const [fade, setFade] = useState(false);
  const [expirada, setExpirada] = useState(false);
  const [lembrar, setLembrar] = useState(true);
  // Workspace da loja (Fase 2): quando este PC já sabe qual empresa atende, a
  // tela vira "a entrada daquela loja" e o apelido passa a ser aceito no login.
  const [ws, setWs] = useState<Workspace | null>(null);
  const [emailEmpresa, setEmailEmpresa] = useState('');
  const [buscandoWs, setBuscandoWs] = useState(false);
  // Uma etapa por vez na tela: identificar a loja → escolher a unidade → entrar.
  // Sem isso os três formulários apareciam empilhados e a tela ficava confusa.
  const [passo, setPasso] = useState<'loja' | 'unidade' | 'login'>('login');

  useEffect(() => {
    // Já autenticado? Vai direto pro app (não mostra o login de novo).
    if (getToken()) {
      router.replace(rotaInicial(getCategoria()));
      return;
    }
    setWs(getWorkspace());
    setExpirada(new URLSearchParams(window.location.search).get('expirada') === '1');
  }, [router]);

  // Identifica a empresa pelo e-mail e guarda neste PC (uma vez só).
  async function abrirWorkspace(e: React.FormEvent) {
    e.preventDefault();
    const v = emailEmpresa.trim();
    if (!/.+@.+\..+/.test(v)) {
      setErro('Informe o e-mail da empresa.');
      return;
    }
    setErro('');
    setBuscandoWs(true);
    try {
      const r: any = await api.workspace(v);
      // Com uma unidade só não há o que escolher — já entra resolvido.
      const uni = (r.unidades ?? []).length === 1 ? r.unidades[0] : null;
      const novo: Workspace = {
        tenantId: r.tenantId,
        nome: r.nome,
        unidadeId: uni?.id ?? null,
        unidadeNome: uni?.nome ?? null,
        modulos: r.modulos ?? [],
      };
      setWorkspace(novo);
      setWs(novo);
      setUnidades(r.unidades ?? []);
      // Mais de uma loja: pergunta qual. Uma só: já vai para o login.
      setPasso((r.unidades ?? []).length > 1 ? 'unidade' : 'login');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não encontrei esse workspace.');
    } finally {
      setBuscandoWs(false);
    }
  }

  const [unidades, setUnidades] = useState<any[]>([]);
  function escolherUnidade(u: any) {
    const novo = { ...(ws as Workspace), unidadeId: u.id, unidadeNome: u.nome };
    setWorkspace(novo);
    setWs(novo);
    setUnidades([]);
    setPasso('login');
  }
  function trocarWorkspace() {
    setWorkspace(null);
    setWs(null);
    setUnidades([]);
    setEmailEmpresa('');
    setErro('');
    setPasso('loja');
  }

  useEffect(() => {
    const t = setInterval(() => {
      setFade(true);
      setTimeout(() => {
        setPi((p) => (p + 1) % PHRASES.length);
        setFade(false);
      }, 400);
    }, 5000);
    return () => clearInterval(t);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Aceita e-mail (gestão) OU usuário/apelido (atendente, estoquista…): se tem
    // "@" cobramos formato de e-mail; senão basta um apelido válido.
    const v = email.trim();
    const ok = v.includes('@') ? /.+@.+\..+/.test(v) : /^[A-Za-z0-9._-]{3,32}$/.test(v);
    setEmailErr(!ok);
    if (!ok) return;
    setErro('');
    setLoading(true);
    try {
      // Com workspace aberto, o apelido é procurado só nesta empresa — é o que
      // permite um "joao" em cada loja sem colidir.
      const r = await api.login(email, senha, ws?.tenantId);
      setToken(r.access_token, lembrar);
      // Landing por perfil (só gestor tem dashboard). replace: não volta ao login.
      router.replace(rotaInicial(getCategoria()));
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Usuário ou senha incorretos.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lg">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="split">
        {/* ESQUERDA: MARCA */}
        <aside className="brand-side">
          <Link className="logo" href="/">
            <span className="logo-mark">R</span> Regem
          </Link>
          <div className="brand-center">
            <div className="eyebrow">No comando de todo o negócio</div>
            <h1 className="brand-h" style={{ opacity: fade ? 0 : 1 }}>
              {PHRASES[pi]}
            </h1>
            <div className="mini-tl" aria-hidden="true">
              <div className="mtl-head">
                LOJA 01 · HOJE <span className="live">AO VIVO</span>
              </div>
              <div style={{ position: 'relative' }}>
                <div className="mtl-now" />
                <div className="mtl-row">
                  <div className="mtl-sector">Cozinha</div>
                  <div className="mtl-track">
                    <div className="mtl-block b-ok" style={{ left: '3%', width: '26%' }} />
                    <div className="mtl-block b-info" style={{ left: '32%', width: '34%' }} />
                    <div className="mtl-block b-ok" style={{ left: '69%', width: '26%' }} />
                  </div>
                </div>
                <div className="mtl-row">
                  <div className="mtl-sector">Salão</div>
                  <div className="mtl-track">
                    <div className="mtl-block b-info" style={{ left: '24%', width: '40%' }} />
                    <div className="mtl-block b-brand" style={{ left: '67%', width: '12%' }} />
                  </div>
                </div>
                <div className="mtl-row">
                  <div className="mtl-sector">Bar</div>
                  <div className="mtl-track">
                    <div className="mtl-block b-ok" style={{ left: '18%', width: '22%' }} />
                    <div className="mtl-block b-info" style={{ left: '43%', width: '50%' }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="brand-foot">DO BALCÃO AO BALANÇO</div>
        </aside>

        {/* DIREITA: FORMULÁRIO */}
        <main className="form-side">
          <div className="form-card">
            <div className="form-logo">
              <span className="logo-mark" style={{ width: 44, height: 44, fontSize: 19 }}>
                R
              </span>
            </div>
            {passo === 'loja' ? (
              <>
                <h2 className="form-title">Qual é a sua loja?</h2>
                <p className="form-sub">Identifique a empresa neste computador</p>
              </>
            ) : passo === 'unidade' ? (
              <>
                <h2 className="form-title">{ws?.nome}</h2>
                <p className="form-sub">Em qual unidade este computador está?</p>
              </>
            ) : ws ? (
              <>
                <h2 className="form-title">{ws.nome}</h2>
                <p className="form-sub">
                  {ws.unidadeNome ? `${ws.unidadeNome} · ` : ''}entre com o seu acesso
                  <br />
                  <button
                    type="button"
                    onClick={trocarWorkspace}
                    style={{ fontSize: 12, color: '#9FB2C8', textDecoration: 'underline' }}
                  >
                    não é esta loja?
                  </button>
                </p>
              </>
            ) : (
              <>
                <h2 className="form-title">Entre para gerenciar o seu dia</h2>
                <p className="form-sub">
                  Bem-vindo de volta 👋
                  <br />
                  <button
                    type="button"
                    onClick={() => setPasso('loja')}
                    style={{ fontSize: 12, color: '#9FB2C8', textDecoration: 'underline' }}
                  >
                    é o computador da loja? identifique a empresa
                  </button>
                </p>
              </>
            )}

            {expirada && (
              <div
                role="status"
                style={{
                  background: 'rgba(224,106,60,.12)',
                  border: '1px solid rgba(224,106,60,.4)',
                  color: '#E06A3C',
                  borderRadius: 11,
                  padding: '10px 14px',
                  fontSize: 13,
                  marginBottom: 18,
                  textAlign: 'center',
                }}
              >
                Sua sessão expirou. Entre novamente para continuar.
              </div>
            )}

            {/* UM passo por vez. Identificar a loja é opcional: serve para o PC do
                balcão, onde o atendente entra por apelido. O gestor com e-mail
                pode ir direto ao login pelo atalho abaixo. */}
            {passo === 'loja' && (
              <form onSubmit={abrirWorkspace} noValidate>
                <div className="field">
                  <label htmlFor="emailEmpresa">E-mail da empresa</label>
                  <div className="in-wrap">
                    <input
                      id="emailEmpresa"
                      type="text"
                      inputMode="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="e-mail cadastrado da loja"
                      value={emailEmpresa}
                      onChange={(e) => setEmailEmpresa(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="field-msg" style={{ display: 'block', color: '#5F7590' }}>
                    Só na primeira vez — este computador guarda a loja.
                  </div>
                </div>
                {erro && <p className="field-msg msg-err show" style={{ marginBottom: 12 }}>{erro}</p>}
                <button type="submit" className="btn-submit" disabled={buscandoWs}>
                  {buscandoWs ? 'Abrindo…' : 'Continuar'}
                </button>
                <p className="signup">
                  <button type="button" onClick={() => setPasso('login')} style={{ color: '#E8A845', fontWeight: 600 }}>
                    Entrar direto com meu e-mail
                  </button>
                </p>
              </form>
            )}

            {/* Escolha da unidade — só quando a rede tem mais de uma loja. */}
            {passo === 'unidade' && (
              <div>
                {unidades.map((u: any) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => escolherUnidade(u)}
                    className="btn-submit"
                    style={{ marginBottom: 10, background: '#12233A', color: '#F2F5F9' }}
                  >
                    {u.nome}
                    {u.tipo === 'matriz' ? ' · matriz' : ''}
                  </button>
                ))}
              </div>
            )}

            {passo === 'login' && (
            <form onSubmit={onSubmit} noValidate>
                <div className={`field${emailErr ? ' err' : ''}`}>
                  <label htmlFor="email">E-mail ou usuário</label>
                  <div className="in-wrap">
                    <input
                      id="email"
                      type="text"
                      inputMode="email"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="voce@empresa.com.br ou maria.balcao"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className={`field-msg msg-err${emailErr ? ' show' : ''}`}>
                    Informe um e-mail válido ou seu usuário de acesso.
                  </div>
                </div>
                <div className={`field${erro ? ' err' : ''}`}>
                  <label htmlFor="pass">Senha</label>
                  <div className="in-wrap">
                    <input
                      id="pass"
                      type={showPass ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      onKeyUp={(e) =>
                        setCaps(
                          e.getModifierState && e.getModifierState('CapsLock'),
                        )
                      }
                      required
                    />
                    <button
                      type="button"
                      className="eye"
                      aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}
                      onClick={() => setShowPass((s) => !s)}
                    >
                      {showPass ? '🙈' : '👁'}
                    </button>
                  </div>
                  <div className={`field-msg msg-warn${caps ? ' show' : ''}`}>
                    ⬆ Caps Lock está ativado.
                  </div>
                  <div className={`field-msg msg-err${erro ? ' show' : ''}`} role="alert" aria-live="assertive">
                    {erro || 'Usuário ou senha incorretos. Tente novamente.'}
                  </div>
                </div>
                <div className="row-between">
                  <label className="remember">
                    <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} /> Manter conectado
                  </label>
                  <Link className="forgot" href="/recuperar-senha">
                    Esqueci minha senha
                  </Link>
                </div>
                <button
                  type="submit"
                  className={`btn-submit${loading ? ' loading' : ''}`}
                  disabled={loading}
                >
                  <span className="spinner" />
                  <span>{loading ? 'Entrando…' : 'Entrar'}</span>
                </button>
                <div className="audit-note">
                  🔒 Todos os acessos ficam registrados no log de auditoria.
                </div>
                <div className="signup">
                  Não tem conta? <Link href="/criar-conta">Criar conta</Link>
                </div>
              </form>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
