'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  api,
  estabelecerSessao,
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
/* ===== 2º passo: modal de login sobre o Regem desfocado ===== */
.lg .lock{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:20px}
.lg .lock-bg{position:absolute;inset:0;background:#EDF0F4;overflow:hidden}
/* Réplica do painel do Regem ao fundo (blur bem leve) — o app "atrás do vidro". */
.lg .lock-mock{position:absolute;inset:0;display:flex;filter:blur(2.5px);transform:scale(1.02);font-family:var(--font-sans)}
.lg .lm-side{width:196px;flex:none;background:#0F2230;padding:16px 12px;display:flex;flex-direction:column;color:#B9CBD7}
.lg .lm-brand{display:flex;align-items:center;gap:8px;margin-bottom:16px}
.lg .lm-brand i{width:30px;height:30px;border-radius:50%;border:2px solid #E8A845;color:#E8A845;font-style:normal;font-weight:800;display:grid;place-items:center;font-size:13px}
.lg .lm-brand b{color:#fff;font-family:var(--font-display);font-weight:800;font-size:15px}
.lg .lm-mi{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;font-size:12.5px;margin-bottom:2px}
.lg .lm-mi::before{content:"";width:14px;height:14px;border-radius:4px;background:currentColor;opacity:.55}
.lg .lm-mi.on{background:rgba(232,168,69,.9);color:#2A1D06;font-weight:700}
.lg .lm-acc{margin-top:auto;display:flex;align-items:center;gap:9px;background:rgba(255,255,255,.06);border-radius:10px;padding:9px}
.lg .lm-acc i{width:30px;height:30px;border-radius:50%;background:#E8A845;flex:none}
.lg .lm-acc b{color:#fff;font-size:12px;font-weight:700;display:block}
.lg .lm-acc span{font-size:9px;color:#7A99AC;letter-spacing:.1em}
.lg .lm-body{flex:1;display:flex;flex-direction:column}
.lg .lm-banner{background:#F6EFDD;color:#9A7B2E;font-size:12px;font-weight:600;padding:9px 22px}
.lg .lm-inner{padding:16px 22px;display:flex;flex-direction:column;gap:14px}
.lg .lm-h{display:flex;align-items:center;justify-content:space-between}
.lg .lm-h b{font-family:var(--font-display);font-weight:800;font-size:20px;color:#0F2230}
.lg .lm-pill{display:flex;gap:8px}
.lg .lm-pill span{background:#fff;border:1px solid #E1E7ED;border-radius:20px;padding:4px 12px;font-size:11px;color:#5F7590}
.lg .lm-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
.lg .lm-k{background:#fff;border-radius:14px;padding:12px 14px;box-shadow:0 2px 8px rgba(15,34,48,.06);border-left:3px solid #0E7C66}
.lg .lm-k:nth-child(2){border-left-color:#4AA8E0}.lg .lm-k:nth-child(3){border-left-color:#E8A845}
.lg .lm-k:nth-child(4){border-left-color:#0E7C66}.lg .lm-k:nth-child(5){border-left-color:#E06A3C}
.lg .lm-k small{display:block;font-size:9px;letter-spacing:.08em;color:#8194A3;text-transform:uppercase}
.lg .lm-k b{display:block;font-family:var(--font-mono);font-size:22px;color:#0F2230;margin-top:4px}
.lg .lm-k u{font-size:9px;color:#9FB0BD;text-decoration:none}
/* Linha do tempo populada */
.lg .lm-tl{background:#fff;border-radius:16px;box-shadow:0 2px 8px rgba(15,34,48,.06);padding:16px 18px}
.lg .lm-tl-h{font-family:var(--font-display);font-weight:800;font-size:14px;color:#0F2230;margin-bottom:2px}
.lg .lm-tl-sub{font-size:11px;color:#8194A3;margin-bottom:12px}
.lg .lm-leg{display:flex;gap:14px;margin-bottom:12px;font-size:10px;color:#5F7590}
.lg .lm-leg span{display:flex;align-items:center;gap:5px}
.lg .lm-leg i{width:9px;height:9px;border-radius:50%}
.lg .lm-trow{display:grid;grid-template-columns:72px 1fr;align-items:center;gap:10px;margin-bottom:7px}
.lg .lm-sec{font-family:var(--font-display);font-size:10px;font-weight:700;color:#5F7590;letter-spacing:.06em}
.lg .lm-track{position:relative;height:24px;background:#F1F4F7;border-radius:6px;overflow:hidden}
.lg .lm-peak{position:absolute;top:0;bottom:0;background:rgba(232,168,69,.14);border-left:1px dashed rgba(232,168,69,.5);border-right:1px dashed rgba(232,168,69,.5)}
.lg .lm-blk{position:absolute;top:4px;bottom:4px;border-radius:5px;display:flex;align-items:center;padding-left:7px;font-size:9px;color:#fff;font-weight:600;white-space:nowrap;overflow:hidden}
.lg .lm-now{position:absolute;top:-3px;bottom:-3px;width:2px;background:#E05252;z-index:3}
.lg .b-ok{background:#2EBD85}.lg .b-run{background:#4AA8E0}.lg .b-done{background:#9FB0BD}.lg .b-warn{background:#E06A3C}
.lg .lock-glass{position:absolute;inset:0;background:linear-gradient(120deg,rgba(9,18,31,.34),rgba(13,26,43,.46))}
.lg .lock-card{position:relative;z-index:2;width:100%;max-width:430px;background:rgba(18,35,58,.94);border:1px solid #26456A;border-radius:22px;padding:34px 30px 30px;box-shadow:0 34px 90px rgba(0,0,0,.55);animation:lockIn .5s cubic-bezier(.16,.84,.28,1) both}
@keyframes lockIn{from{opacity:0;transform:translateY(16px) scale(.96)}to{opacity:1;transform:none}}
.lg .lock-logo{display:flex;justify-content:center;margin-bottom:14px}
.lg .lock-logo .logo-mark{width:56px;height:56px;font-size:24px;box-shadow:0 0 0 6px rgba(232,168,69,.10)}
.lg .lock-logo-img{width:72px;height:72px;object-fit:contain;border-radius:14px;background:#fff;padding:6px;box-shadow:0 0 0 6px rgba(232,168,69,.10)}
.lg .lock-empresa{font-family:var(--font-display);font-weight:800;font-size:clamp(22px,4vw,30px);line-height:1.1;letter-spacing:-.02em;text-align:center;color:#F2F5F9}
.lg .lock-uni{display:block;text-align:center;font-family:var(--font-mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#E8A845;margin-top:6px}
.lg .lock-welcome{text-align:center;color:#9FB2C8;font-size:14px;margin:8px 0 22px}
.lg .lock-unidades{margin-bottom:20px}
.lg .lock-uni-lab{display:block;font-size:12px;color:#9FB2C8;margin-bottom:8px;text-align:center}
.lg .lock-uni-select{position:relative}
.lg .lock-uni-trigger{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 15px;border-radius:12px;background:#12233A;border:1.5px solid #1A3050;color:#DCE7EE;font-size:14px;font-weight:600;text-align:left;transition:border-color .15s}
.lg .lock-uni-trigger:hover,.lg .lock-uni-trigger[aria-expanded="true"]{border-color:#E8A845}
.lg .lock-uni-trigger .ph{color:#7A94AB;font-weight:500}
.lg .lock-uni-caret{color:#7A94AB;font-size:11px;transition:transform .18s}
.lg .lock-uni-trigger[aria-expanded="true"] .lock-uni-caret{transform:rotate(180deg)}
.lg .lock-uni-list{list-style:none;margin:6px 0 0;padding:5px;position:absolute;left:0;right:0;z-index:5;background:#12233A;border:1.5px solid #26456A;border-radius:12px;box-shadow:0 18px 44px rgba(0,0,0,.5);max-height:224px;overflow-y:auto;animation:lockIn .18s ease both}
.lg .lock-uni-opt{width:100%;display:block;padding:11px 12px;border-radius:9px;color:#DCE7EE;font-size:14px;font-weight:600;text-align:left;transition:background .12s}
.lg .lock-uni-opt:hover{background:rgba(232,168,69,.10)}
.lg .lock-uni-opt.on{background:rgba(232,168,69,.16);color:#F2F5F9}
.lg .lock-uni-opt .tag{font-family:var(--font-mono);font-size:9px;letter-spacing:.12em;color:#E8A845;margin-left:6px;text-transform:uppercase}
.lg .lock-troca{display:block;margin:16px auto 0;font-size:12.5px;color:#7A94AB;text-decoration:underline}
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
  // Dois estágios: 'empresa' identifica a loja pelo e-mail; 'entrar' é o modal de
  // login (usuário+senha) sobre o Regem desfocado. A unidade, se houver mais de
  // uma, é escolhida dentro do próprio modal.
  const [passo, setPasso] = useState<'empresa' | 'entrar'>('empresa');

  useEffect(() => {
    // Já autenticado? Vai direto pro app (não mostra o login de novo).
    if (getToken()) {
      router.replace(rotaInicial(getCategoria()));
      return;
    }
    setExpirada(new URLSearchParams(window.location.search).get('expirada') === '1');
    // No EDGE a empresa/unidade já são fixas (instalação): não pergunta e-mail —
    // abre direto no login com nome/logo da loja, resolvidos pela unidade local.
    if (process.env.NEXT_PUBLIC_EDGE === '1') {
      api
        .workspaceLocal()
        .then((r: any) => {
          const uni = (r.unidades ?? [])[0] ?? null;
          setWs({
            tenantId: r.tenantId, nome: r.nome, logo: r.logo ?? null,
            unidadeId: uni?.id ?? null, unidadeNome: uni?.nome ?? null, modulos: r.modulos ?? [],
          });
          setUnidades([]); // edge não escolhe unidade
          setPasso('entrar');
        })
        .catch(() => setPasso('empresa')); // sem unidade local: cai no fluxo normal
      return;
    }
    // Nuvem: este PC já sabe qual empresa atende? Vai direto ao modal de login.
    const w = getWorkspace();
    if (w) {
      setWs(w);
      setPasso('entrar');
    }
  }, [router]);
  const ehEdge = process.env.NEXT_PUBLIC_EDGE === '1';

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
      setPasso('entrar'); // a unidade (se >1) é escolhida dentro do modal
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não encontrei esse workspace.');
    } finally {
      setBuscandoWs(false);
    }
  }

  const [unidades, setUnidades] = useState<any[]>([]);
  const [uniAberta, setUniAberta] = useState(false);
  function escolherUnidade(u: any) {
    const novo = { ...(ws as Workspace), unidadeId: u.id, unidadeNome: u.nome };
    setWorkspace(novo);
    setWs(novo);
  }
  function trocarWorkspace() {
    setWorkspace(null);
    setWs(null);
    setUnidades([]);
    setEmailEmpresa('');
    setEmail('');
    setSenha('');
    setErro('');
    setPasso('empresa');
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
      await estabelecerSessao(r.access_token, lembrar);
      // Landing por perfil (só gestor tem dashboard). replace: não volta ao login.
      router.replace(rotaInicial(getCategoria()));
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Usuário ou senha incorretos.');
    } finally {
      setLoading(false);
    }
  }

  // Com mais de uma unidade, escolher é obrigatório antes de entrar.
  const precisaUnidade = unidades.length > 1 && !ws?.unidadeId;

  // ===== 2º passo: modal de login sobre o Regem desfocado =====
  if (passo === 'entrar') {
    return (
      <div className="lg">
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="lock">
          {/* Fundo: réplica do painel do Regem (blur bem leve), com a linha do tempo
              já POPULADA (setores, funcionários, tarefas, pico). O app "atrás do
              vidro". Decorativo — sem dados reais (não há sessão antes do login). */}
          <div className="lock-bg" aria-hidden="true">
            <div className="lock-mock">
              <div className="lm-side">
                <div className="lm-brand"><i>R</i><b>Regem</b></div>
                {['Dashboard', 'PDV · Balcão', 'Delivery', 'Tarefas', 'Escalas', 'Estoque', 'Checklist', 'Mural & clima', 'Financeiro', 'Cadastros', 'Ponto'].map((m, i) => (
                  <div key={m} className={`lm-mi${i === 0 ? ' on' : ''}`}>{m}</div>
                ))}
                <div className="lm-acc"><i /><span><b>Luciana gerente</b><span>GERENTE</span></span></div>
              </div>
              <div className="lm-body">
                <div className="lm-banner">✨ Teste grátis — sistema completo</div>
                <div className="lm-inner">
                  <div className="lm-h"><b>Dashboard</b><div className="lm-pill"><span>Modo nuvem</span><span>16:19 · sáb</span></div></div>
                  <div className="lm-kpis">
                    {[['Conclusão', '72%'], ['Escalados hoje', '8/10'], ['Vendas hoje', '34'], ['Produção hoje', '12'], ['Delivery aberto', '5']].map(([l, v]) => (
                      <div key={l} className="lm-k"><small>{l}</small><b>{v}</b><u>hoje</u></div>
                    ))}
                  </div>
                  <div className="lm-tl">
                    <div className="lm-tl-h">Linha do tempo operacional</div>
                    <div className="lm-tl-sub">Quem está escalado e o que deveria estar em execução agora, por setor</div>
                    <div className="lm-leg">
                      <span><i style={{ background: '#2EBD85' }} />em dia</span>
                      <span><i style={{ background: '#4AA8E0' }} />em execução</span>
                      <span><i style={{ background: '#9FB0BD' }} />concluído</span>
                      <span><i style={{ background: '#E06A3C' }} />atenção</span>
                      <span><i style={{ background: '#E05252' }} />agora · pico ⬛</span>
                    </div>
                    {[
                      { sec: 'Cozinha', blocos: [['b-done', 6, 20, 'João'], ['b-run', 30, 26, 'Maria'], ['b-ok', 60, 32, 'Bruno']] },
                      { sec: 'Salão', blocos: [['b-ok', 12, 22, 'Ana'], ['b-run', 40, 30, 'Pedro'], ['b-ok', 74, 20, 'Lia']] },
                      { sec: 'Bar', blocos: [['b-done', 8, 16, 'Rita'], ['b-ok', 34, 40, 'Caio']] },
                      { sec: 'Delivery', blocos: [['b-run', 20, 28, 'Rafa'], ['b-warn', 56, 34, 'sem resp.']] },
                    ].map((r) => (
                      <div key={r.sec} className="lm-trow">
                        <span className="lm-sec">{r.sec}</span>
                        <div className="lm-track">
                          <div className="lm-peak" style={{ left: '70%', right: '2%' }} />
                          {r.blocos.map(([cls, left, w, nome], i) => (
                            <div key={i} className={`lm-blk ${cls}`} style={{ left: `${left}%`, width: `${w}%` }}>{nome}</div>
                          ))}
                          <div className="lm-now" style={{ left: '66%' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="lock-glass" />
          </div>
          <div className="lock-card" role="dialog" aria-modal="true" aria-label="Entrar no Regem">
            <div className="lock-logo">
              {ws?.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ws.logo} alt={ws.nome} className="lock-logo-img" />
              ) : (
                <span className="logo-mark">R</span>
              )}
            </div>
            <h1 className="lock-empresa">{ws?.nome || 'Regem'}</h1>
            {/* Com uma única unidade, mostra o nome fixo aqui. Com mais de uma, o nome
                não aparece — a escolha é feita no seletor abaixo (evita redundância). */}
            {unidades.length <= 1 && ws?.unidadeNome && <span className="lock-uni">{ws.unidadeNome}</span>}
            <p className="lock-welcome">Seja bem-vindo 👋 entre com o seu acesso</p>

            {expirada && (
              <div
                role="status"
                style={{ background: 'rgba(224,106,60,.12)', border: '1px solid rgba(224,106,60,.4)', color: '#E06A3C', borderRadius: 11, padding: '10px 14px', fontSize: 13, marginBottom: 18, textAlign: 'center' }}
              >
                Sua sessão expirou. Entre novamente para continuar.
              </div>
            )}

            {/* Escolha da unidade — listview que só aparece quando a rede tem mais de
                uma. Fechado por padrão: clica pra abrir a lista das unidades. */}
            {unidades.length > 1 && (
              <div className="lock-unidades">
                <span className="lock-uni-lab">Em qual unidade este computador está?</span>
                <div className="lock-uni-select">
                  <button
                    type="button"
                    className="lock-uni-trigger"
                    aria-haspopup="listbox"
                    aria-expanded={uniAberta}
                    onClick={() => setUniAberta((o) => !o)}
                  >
                    <span className={ws?.unidadeNome ? '' : 'ph'}>
                      {ws?.unidadeNome || 'Selecione a unidade'}
                    </span>
                    <span className="lock-uni-caret" aria-hidden="true">▾</span>
                  </button>
                  {uniAberta && (
                    <ul className="lock-uni-list" role="listbox" aria-label="Unidades cadastradas">
                      {unidades.map((u: any) => (
                        <li key={u.id} role="option" aria-selected={ws?.unidadeId === u.id}>
                          <button
                            type="button"
                            className={`lock-uni-opt${ws?.unidadeId === u.id ? ' on' : ''}`}
                            onClick={() => {
                              escolherUnidade(u);
                              setUniAberta(false);
                            }}
                          >
                            {u.nome}
                            {u.tipo === 'matriz' && <span className="tag">matriz</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            <form onSubmit={onSubmit} noValidate>
              <div className={`field${emailErr ? ' err' : ''}`}>
                <label htmlFor="email">Usuário</label>
                <div className="in-wrap">
                  <input
                    id="email"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="seu usuário (ou e-mail)"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={precisaUnidade}
                    required
                    autoFocus
                  />
                </div>
                <div className={`field-msg msg-err${emailErr ? ' show' : ''}`}>Informe o seu usuário ou e-mail.</div>
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
                    onKeyUp={(e) => setCaps(e.getModifierState && e.getModifierState('CapsLock'))}
                    disabled={precisaUnidade}
                    required
                  />
                  <button type="button" className="eye" aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShowPass((s) => !s)}>
                    {showPass ? '🙈' : '👁'}
                  </button>
                </div>
                <div className={`field-msg msg-warn${caps ? ' show' : ''}`}>⬆ Caps Lock está ativado.</div>
                <div className={`field-msg msg-err${erro ? ' show' : ''}`} role="alert" aria-live="assertive">
                  {erro || 'Usuário ou senha incorretos. Tente novamente.'}
                </div>
              </div>
              <div className="row-between">
                <label className="remember">
                  <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} /> Manter conectado
                </label>
                <Link className="forgot" href="/recuperar-senha">Esqueci minha senha</Link>
              </div>
              <button type="submit" className={`btn-submit${loading ? ' loading' : ''}`} disabled={loading || precisaUnidade}>
                <span className="spinner" />
                <span>{precisaUnidade ? 'Escolha a unidade' : loading ? 'Entrando…' : 'Entrar'}</span>
              </button>
              <div className="audit-note">🔒 Todos os acessos ficam registrados no log de auditoria.</div>
              {/* No edge a empresa é fixa (instalação) — não há o que trocar. */}
              {!ehEdge && (
                <button type="button" className="lock-troca" onClick={trocarWorkspace}>
                  não é esta empresa? trocar
                </button>
              )}
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ===== 1º passo: identificar a empresa =====
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

        {/* DIREITA: IDENTIFICAR A EMPRESA */}
        <main className="form-side">
          <div className="form-card">
            <div className="form-logo">
              <span className="logo-mark" style={{ width: 44, height: 44, fontSize: 19 }}>R</span>
            </div>
            <h2 className="form-title">Qual é a sua empresa?</h2>
            <p className="form-sub">Informe o e-mail da empresa para começar</p>

            {expirada && (
              <div
                role="status"
                style={{ background: 'rgba(224,106,60,.12)', border: '1px solid rgba(224,106,60,.4)', color: '#E06A3C', borderRadius: 11, padding: '10px 14px', fontSize: 13, marginBottom: 18, textAlign: 'center' }}
              >
                Sua sessão expirou. Entre novamente para continuar.
              </div>
            )}

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
                    placeholder="e-mail cadastrado da empresa"
                    value={emailEmpresa}
                    onChange={(e) => setEmailEmpresa(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="field-msg" style={{ display: 'block', color: '#5F7590' }}>
                  Só na primeira vez — este computador guarda a empresa.
                </div>
              </div>
              {erro && <p className="field-msg msg-err show" style={{ marginBottom: 12 }}>{erro}</p>}
              <button type="submit" className="btn-submit" disabled={buscandoWs}>
                {buscandoWs ? 'Abrindo…' : 'Continuar'}
              </button>
              <div className="signup">
                Não tem conta? <Link href="/criar-conta">Criar conta</Link>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
