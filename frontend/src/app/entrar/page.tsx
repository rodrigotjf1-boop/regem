'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, setToken } from '@/lib/api';

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
  const [modePin, setModePin] = useState(false);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [caps, setCaps] = useState(false);
  const [emailErr, setEmailErr] = useState(false);
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);
  const [pin, setPin] = useState('');
  const [pi, setPi] = useState(0);
  const [fade, setFade] = useState(false);

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

  const pinRef = useRef(pin);
  pinRef.current = pin;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const okEmail = /.+@.+\..+/.test(email);
    setEmailErr(!okEmail);
    if (!okEmail) return;
    setErro('');
    setLoading(true);
    try {
      const r = await api.login(email, senha);
      setToken(r.access_token);
      router.push('/painel');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'E-mail ou senha incorretos.');
    } finally {
      setLoading(false);
    }
  }

  function tecla(k: string) {
    if (k === 'clear') return setPin('');
    if (k === 'back') return setPin((p) => p.slice(0, -1));
    setPin((p) => {
      if (p.length >= 4) return p;
      const np = p + k;
      if (np.length === 4) {
        // Fluxo real de terminal (escolhe unidade + valida PIN) vive em /pin.
        setTimeout(() => router.push('/pin'), 200);
      }
      return np;
    });
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
            <h2 className="form-title">Entre para gerenciar o seu dia</h2>
            <p className="form-sub">Bem-vindo de volta 👋</p>

            <div className="seg" role="tablist">
              <button
                type="button"
                className={modePin ? '' : 'on'}
                role="tab"
                aria-selected={!modePin}
                onClick={() => setModePin(false)}
              >
                E-mail e senha
              </button>
              <button
                type="button"
                className={modePin ? 'on' : ''}
                role="tab"
                aria-selected={modePin}
                onClick={() => setModePin(true)}
              >
                PIN de terminal
              </button>
            </div>

            {!modePin ? (
              <form onSubmit={onSubmit} noValidate>
                <div className={`field${emailErr ? ' err' : ''}`}>
                  <label htmlFor="email">E-mail</label>
                  <div className="in-wrap">
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="voce@empresa.com.br"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className={`field-msg msg-err${emailErr ? ' show' : ''}`}>
                    Informe um e-mail válido.
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
                  <div className={`field-msg msg-err${erro ? ' show' : ''}`}>
                    {erro || 'E-mail ou senha incorretos. Tente novamente.'}
                  </div>
                </div>
                <div className="row-between">
                  <label className="remember">
                    <input type="checkbox" defaultChecked /> Manter conectado
                  </label>
                  <a className="forgot" href="#">
                    Esqueci minha senha
                  </a>
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
            ) : (
              <div>
                <p className="pin-hint">
                  Digite seu PIN de 4 dígitos para bater ponto ou entrar no modo
                  terminal.
                </p>
                <div className="pin-dots">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className={`pd${i < pin.length ? ' f' : ''}`} />
                  ))}
                </div>
                <div className="pad">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
                    <button key={n} type="button" className="key" onClick={() => tecla(n)}>
                      {n}
                    </button>
                  ))}
                  <button type="button" className="key fn" onClick={() => tecla('clear')}>
                    LIMPAR
                  </button>
                  <button type="button" className="key" onClick={() => tecla('0')}>
                    0
                  </button>
                  <button type="button" className="key fn" onClick={() => tecla('back')}>
                    ⌫
                  </button>
                </div>
                <div className="pin-terminal">
                  TERMINAL: PONTO-ENTRADA-01 · <b>ONLINE</b>
                </div>
                <div className="audit-note">
                  🔒 Marcações geram NSR e comprovante — conforme Portaria 671/2021.
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
