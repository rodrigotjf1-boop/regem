'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PLANOS_DA_LANDING } from '@/lib/planos-da-landing';

// WhatsApp de suporte (só dígitos, ex.: 5521999999999). Configure em
// NEXT_PUBLIC_WHATSAPP_SUPORTE (build-time). Sem valor, o "Suporte" do rodapé não aparece.
// (Sem botão flutuante: decisão do dono para a landing, 12/11/2026.)
const WHATS = (process.env.NEXT_PUBLIC_WHATSAPP_SUPORTE || '').replace(/\D/g, '');

// O que esta página promete tem de existir no produto (decisões do dono de 12/11/2026 para a landing): nada de número de
// clientes ou resultado que não medimos, o que está no plano vai com "em breve", e os preços são os da tabela do app
// (`lib/planos-da-landing.ts`). O `npm run check:landing` confere.
const brl0 = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

// Landing pública (antes do login). Tema escuro navy + âmbar (marca).
// Porte fiel do mockup Fable "regem-landing" — CSS escopado em .lp.
const CSS = `
.lp{font-family:var(--font-sans);background:#0D1A2B;color:#F2F5F9;overflow-x:hidden;min-height:100dvh;position:relative}
.lp a{color:inherit;text-decoration:none}
.lp button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
.lp :focus-visible{outline:2px solid #4AA8E0;outline-offset:2px;border-radius:4px}
@media (prefers-reduced-motion:reduce){.lp *{animation:none!important;transition:none!important}}
.lp .eyebrow{font-family:var(--font-mono);font-size:12px;letter-spacing:.38em;color:#E8A845;text-transform:uppercase;font-weight:500}
.lp .orbits{position:absolute;inset:0;pointer-events:none;z-index:0}
.lp .orbits::before,.lp .orbits::after{content:"";position:absolute;left:50%;top:420px;transform:translateX(-50%);border:1px solid rgba(232,168,69,.07);border-radius:50%}
.lp .orbits::before{width:900px;height:900px}
.lp .orbits::after{width:1400px;height:1400px;border-color:rgba(159,178,200,.05)}
.lp .hdr{position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:34px;padding:18px 6vw;transition:background .25s,box-shadow .25s}
.lp .hdr.scrolled{background:rgba(13,26,43,.82);backdrop-filter:blur(12px);box-shadow:0 1px 0 rgba(159,178,200,.12)}
.lp .logo{display:flex;align-items:center;gap:11px;font-family:var(--font-display);font-weight:800;font-size:20px}
.lp .logo-mark{width:34px;height:34px;border-radius:50%;border:2.5px solid #E8A845;display:grid;place-items:center;color:#E8A845;font-size:15px;font-weight:800}
.lp .hdr nav{display:flex;gap:28px;margin-left:auto;font-size:14.5px;font-weight:500;color:#9FB2C8}
.lp .hdr nav a:hover{color:#F2F5F9}
.lp .hdr .entrar{font-weight:700;font-size:14.5px;margin-left:26px;white-space:nowrap}
.lp .hdr .cta{margin-left:10px;white-space:nowrap}
.lp .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:999px;font-weight:700;transition:transform .12s,filter .15s}
.lp .btn:hover{filter:brightness(1.07)}
.lp .btn:active{transform:scale(.98)}
.lp .btn-brand{background:#E8A845;color:#2A1D06;padding:12px 26px;font-size:15px}
.lp .btn-ghost{background:#12233A;border:1px solid #1A3050;color:#F2F5F9;padding:12px 26px;font-size:15px}
@media(max-width:1000px){.lp .hdr nav{display:none}.lp .hdr{gap:12px}.lp .hdr .entrar{margin-left:auto}.lp .hdr .cta{margin-left:0}}
@media(max-width:480px){.lp .hdr{padding:14px 4vw;gap:10px}.lp .hdr .cta{padding:12px 16px;font-size:14px}.lp .logo{font-size:18px;gap:8px}}
.lp .hero{position:relative;z-index:1;text-align:center;padding:88px 6vw 40px;max-width:1080px;margin:0 auto}
.lp .hero h1{font-family:var(--font-display);font-weight:800;font-size:clamp(38px,6.4vw,72px);line-height:1.06;letter-spacing:-.02em;margin:22px 0 24px}
.lp .hero h1 em{font-style:normal;color:#E8A845}
.lp .hero p{font-size:clamp(16px,2vw,20px);color:#9FB2C8;line-height:1.55;max-width:640px;margin:0 auto 34px}
.lp .hero-ctas{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
.lp .product{position:relative;z-index:1;max-width:1000px;margin:64px auto 0;padding:0 5vw}
.lp .frame{background:#12233A;border:1px solid #1A3050;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.5),0 0 0 1px rgba(232,168,69,.06);overflow:hidden;transform:perspective(1400px) rotateX(4deg);transform-origin:top}
.lp .frame-bar{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #1A3050}
.lp .frame-bar i{width:10px;height:10px;border-radius:50%;background:#1A3050}
.lp .frame-bar span{margin-left:8px;font-family:var(--font-mono);font-size:11px;color:#5F7590}
.lp .frame-body{padding:22px 24px 26px}
.lp .fb-title{display:flex;align-items:baseline;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.lp .fb-title b{font-family:var(--font-display);font-size:14px}
.lp .fb-title small{font-size:12px;color:#5F7590}
.lp .live{margin-left:auto;font-family:var(--font-mono);font-size:10px;color:#2EBD85;display:flex;align-items:center;gap:6px}
.lp .live::before{content:"";width:7px;height:7px;border-radius:50%;background:#2EBD85;animation:lpPulse 1.8s infinite}
@keyframes lpPulse{50%{opacity:.35}}
.lp .tl-hours{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:9.5px;color:#5F7590;padding-left:86px;margin-bottom:8px}
.lp .tl-row{display:grid;grid-template-columns:86px 1fr;align-items:center;margin-bottom:9px}
.lp .tl-sector{font-family:var(--font-display);font-size:10px;font-weight:700;letter-spacing:.12em;color:#9FB2C8;text-transform:uppercase}
.lp .tl-track{position:relative;height:30px;background:rgba(159,178,200,.06);border-radius:6px}
.lp .tl-block{position:absolute;top:4px;bottom:4px;border-radius:5px;font-size:10.5px;font-weight:600;display:flex;align-items:center;padding:0 9px;white-space:nowrap;overflow:hidden;color:#0D1A2B;opacity:0;animation:lpBlockIn .5s forwards}
.lp .tl-block small{font-family:var(--font-mono);font-size:8.5px;margin-left:6px;opacity:.75}
.lp .b-ok{background:#2EBD85}.lp .b-info{background:#4AA8E0}.lp .b-brand{background:#E8A845}.lp .b-muted{background:#4A5E78;color:#F2F5F9}
@keyframes lpBlockIn{from{opacity:0;transform:scaleX(.6);transform-origin:left}to{opacity:1;transform:none}}
.lp .tl-now{position:absolute;top:-20px;bottom:0;width:2px;background:#E05252;left:30%;animation:lpNowMove 14s linear infinite;z-index:2}
.lp .tl-now::before{content:"AGORA";position:absolute;top:-2px;left:50%;transform:translateX(-50%);font-family:var(--font-mono);font-size:8px;font-weight:700;background:#E05252;color:#fff;padding:1px 6px;border-radius:4px;letter-spacing:.08em}
@keyframes lpNowMove{from{left:22%}50%{left:66%}to{left:22%}}
.lp .frame-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:18px}
.lp .fk{background:rgba(159,178,200,.06);border-radius:9px;padding:10px 12px}
.lp .fk-l{font-family:var(--font-mono);font-size:8.5px;letter-spacing:.14em;color:#5F7590;text-transform:uppercase}
.lp .fk-v{font-family:var(--font-mono);font-size:17px;font-weight:700;margin-top:3px}
.lp .fk-v.ok{color:#2EBD85}.lp .fk-v.warn{color:#E06A3C}
@media(max-width:640px){.lp .frame-kpis{grid-template-columns:repeat(2,1fr)}.lp .frame{transform:none}}
.lp .proof{position:relative;z-index:1;display:flex;gap:clamp(24px,6vw,80px);justify-content:center;flex-wrap:wrap;padding:56px 6vw;text-align:center}
.lp .proof div b{display:block;font-family:var(--font-mono);font-size:clamp(24px,3.4vw,34px);font-weight:700;color:#E8A845}
.lp .proof div span{font-size:12.5px;color:#5F7590;letter-spacing:.04em}
.lp .breve{display:inline-block;margin-left:8px;padding:2px 9px;border-radius:999px;background:rgba(232,168,69,.15);color:#E8A845;font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;vertical-align:middle}
.lp section{position:relative;z-index:1;padding:72px 6vw;max-width:1120px;margin:0 auto}
.lp .sec-head{text-align:center;max-width:660px;margin:0 auto 46px}
.lp .sec-head h2{font-family:var(--font-display);font-weight:800;font-size:clamp(26px,4vw,40px);letter-spacing:-.015em;margin:16px 0 12px}
.lp .sec-head p{color:#9FB2C8;font-size:16px;line-height:1.55}
.lp .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:0;position:relative}
.lp .steps::before{content:"";position:absolute;top:34px;left:16%;right:16%;height:2px;background:linear-gradient(90deg,#E8A845,#2EBD85);opacity:.35}
.lp .step{text-align:center;padding:0 18px;position:relative}
.lp .step-n{width:68px;height:68px;border-radius:50%;background:#12233A;border:2px solid #E8A845;display:grid;place-items:center;font-size:26px;margin:0 auto 18px;position:relative;z-index:1}
.lp .step h3{font-family:var(--font-display);font-size:17px;font-weight:700;margin-bottom:8px}
.lp .step p{font-size:13.5px;color:#9FB2C8;line-height:1.55}
@media(max-width:760px){.lp .steps{grid-template-columns:1fr;gap:34px}.lp .steps::before{display:none}}
.lp .profiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}
.lp .pcard{background:#12233A;border:1px solid #1A3050;border-radius:16px;padding:24px 22px;transition:transform .15s,border-color .15s}
.lp .pcard:hover{transform:translateY(-4px);border-color:rgba(232,168,69,.45)}
.lp .pcard .pi{font-size:26px}
.lp .pcard h3{font-family:var(--font-display);font-size:16px;font-weight:800;margin:12px 0 4px}
.lp .pcard .pr{font-family:var(--font-mono);font-size:10px;letter-spacing:.18em;color:#E8A845;text-transform:uppercase}
.lp .pcard ul{list-style:none;margin-top:14px;display:flex;flex-direction:column;gap:7px;padding:0}
.lp .pcard li{font-size:13px;color:#9FB2C8;display:flex;gap:8px}
.lp .pcard li::before{content:"—";color:#E8A845}
.lp .mods{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
.lp .mod{background:#12233A;border:1px solid #1A3050;border-radius:16px;padding:20px 22px;display:flex;gap:14px;align-items:flex-start}
.lp .mod .mi{font-size:24px;margin-top:2px}
.lp .mod h3{font-family:var(--font-display);font-size:15px;font-weight:700}
.lp .mod p{font-size:12.5px;color:#9FB2C8;line-height:1.5;margin-top:4px}
.lp .sw{margin-left:auto;flex:none;width:38px;height:21px;border-radius:12px;background:#2EBD85;position:relative}
.lp .sw::after{content:"";position:absolute;top:3px;right:3px;width:15px;height:15px;border-radius:50%;background:#0D1A2B}
.lp .mod-note{text-align:center;font-size:13px;color:#5F7590;margin-top:22px}
.lp .plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;align-items:stretch}
.lp .plan{background:#12233A;border:1px solid #1A3050;border-radius:18px;padding:28px 26px;display:flex;flex-direction:column}
.lp .plan.hot{border-color:#E8A845;box-shadow:0 0 0 1px #E8A845,0 20px 50px rgba(232,168,69,.12);position:relative}
.lp .plan.hot::before{content:"RECOMENDADO";position:absolute;top:-11px;left:50%;transform:translateX(-50%);font-family:var(--font-mono);font-size:9px;letter-spacing:.2em;background:#E8A845;color:#2A1D06;font-weight:700;padding:4px 12px;border-radius:20px}
.lp .plan h3{font-family:var(--font-display);font-size:16px;font-weight:800}
.lp .plan .price{font-family:var(--font-mono);font-size:34px;font-weight:700;margin:14px 0 2px}
.lp .plan .price small{font-size:13px;color:#5F7590;font-weight:400}
.lp .plan .per{font-size:12px;color:#5F7590;margin-bottom:18px}
.lp .plan ul{list-style:none;display:flex;flex-direction:column;gap:9px;margin-bottom:24px;flex:1;padding:0}
.lp .plan li{font-size:13.5px;color:#9FB2C8;display:flex;gap:8px}
.lp .plan li::before{content:"✓";color:#2EBD85;font-weight:700}
.lp .plan .btn{width:100%}
.lp .cta-final{text-align:center;padding:88px 6vw;position:relative;z-index:1}
.lp .cta-final h2{font-family:var(--font-display);font-weight:800;font-size:clamp(28px,4.6vw,46px);letter-spacing:-.015em;margin:16px 0 26px}
.lp .cta-final h2 em{font-style:normal;color:#E8A845}
.lp footer{position:relative;z-index:1;border-top:1px solid #1A3050;padding:40px 6vw;display:flex;gap:24px;flex-wrap:wrap;align-items:center;font-size:13px;color:#5F7590}
.lp footer nav{display:flex;gap:22px;margin-left:auto;flex-wrap:wrap}
.lp footer a:hover{color:#9FB2C8}
.lp .foot-sign{width:100%;text-align:center;margin-top:26px;font-family:var(--font-mono);font-size:11px;letter-spacing:.3em;color:#5F7590}
.lp .free-badge{display:inline-flex;align-items:center;gap:9px;background:rgba(46,189,133,.12);border:1px solid rgba(46,189,133,.42);color:#2EBD85;font-family:var(--font-mono);font-size:12px;font-weight:600;letter-spacing:.05em;padding:8px 16px;border-radius:999px;margin:0 0 4px}
.lp .free-badge b{color:#F2F5F9;font-weight:700}
.lp .free-badge .fdot{width:7px;height:7px;border-radius:50%;background:#2EBD85;animation:lpPulse 1.8s infinite}
.lp .hero-reassure{margin-top:18px;font-size:13px;color:#5F7590;display:flex;gap:16px;justify-content:center;flex-wrap:wrap}
.lp .hero-reassure span{display:inline-flex;align-items:center;gap:7px}
.lp .hero-reassure span::before{content:"✓";color:#2EBD85;font-weight:700}
.lp .local{background:linear-gradient(180deg,rgba(74,168,224,.07),transparent 70%);border-top:1px solid #1A3050;border-bottom:1px solid #1A3050}
.lp .local-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}
.lp .lcard{background:#12233A;border:1px solid #1A3050;border-radius:16px;padding:22px 22px 24px}
.lp .lcard .li{font-size:24px}
.lp .lcard h3{font-family:var(--font-display);font-size:15px;font-weight:700;margin:12px 0 6px}
.lp .lcard p{font-size:13px;color:#9FB2C8;line-height:1.55}
.lp .local-modes{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:34px}
.lp .lmode{background:#12233A;border:1px solid #1A3050;border-radius:14px;padding:16px 20px;max-width:360px;text-align:left;flex:1;min-width:260px}
.lp .lmode .lmt{font-family:var(--font-display);font-size:14px;font-weight:800;display:flex;align-items:center;gap:9px}
.lp .lmode .tag{font-family:var(--font-mono);font-size:9px;letter-spacing:.14em;text-transform:uppercase;padding:3px 9px;border-radius:20px;margin-left:auto}
.lp .lmode p{font-size:12.5px;color:#9FB2C8;margin-top:8px;line-height:1.55}
.lp .pricing-free{text-align:center;font-size:13.5px;color:#2EBD85;font-weight:600;margin:-24px auto 34px;max-width:560px}
`;

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="lp">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="orbits" aria-hidden="true" />

      <header className={`hdr${scrolled ? ' scrolled' : ''}`}>
        <Link className="logo" href="/">
          <span className="logo-mark">R</span> Regem
        </Link>
        <nav>
          <a href="#topo">Home</a>
          <a href="#integracoes">Integrações</a>
          <a href="#perfis">Perfis</a>
          <a href="#precos">Preços</a>
          <Link href="/como-funciona">Como funciona</Link>
        </nav>
        {/* As margens moram no CSS (`.entrar`, `.cta`): no celular o conjunto passava de 320 px e o botão ficava cortado. */}
        <Link className="entrar" href="/entrar">
          Entrar
        </Link>
        <Link className="btn btn-brand cta" href="/criar-conta">
          Testar grátis
        </Link>
      </header>

      {/* HERO */}
      <div className="hero" id="topo">
        <div className="eyebrow">Bares · Restaurantes · e o que vier depois</div>
        <div className="free-badge">
          <span className="fdot" aria-hidden="true" />
          <b>3 meses grátis</b> do sistema completo · sem cartão de crédito
        </div>
        <h1>
          Controle <em>total</em> do seu negócio, de ponta a ponta.
        </h1>
        <p>
          Vendas, estoque, equipe e financeiro numa só plataforma. Simples no
          balcão, completa na diretoria — e funciona{' '}
          <strong style={{ color: '#F2F5F9' }}>mesmo quando a internet cai</strong>.
        </p>
        <div className="hero-ctas">
          <Link
            className="btn btn-brand"
            href="/criar-conta"
            style={{ padding: '15px 32px', fontSize: 16 }}
          >
            Começar grátis
          </Link>
          <a
            className="btn btn-ghost"
            href="#produto"
            style={{ padding: '15px 32px', fontSize: 16 }}
          >
            Ver demonstração
          </a>
        </div>
        <div className="hero-reassure">
          <span>Sem cartão de crédito</span>
          <span>Sem fidelidade</span>
          <span>Cancele quando quiser</span>
        </div>
      </div>

      {/* FRAME DO PRODUTO — timeline animada */}
      <div className="product" id="produto">
        <div className="frame">
          <div className="frame-bar">
            <i />
            <i />
            <i />
            <span>app.dmsregem.com · Dashboard · Loja 01</span>
          </div>
          <div className="frame-body">
            <div className="fb-title">
              <b>Linha do Tempo Operacional</b>
              <small>quem está escalado e o que deveria estar em execução agora</small>
              <span className="live">AO VIVO</span>
            </div>
            <div>
              <div className="tl-hours">
                <span>06</span>
                <span>09</span>
                <span>12</span>
                <span>15</span>
                <span>18</span>
                <span>21</span>
              </div>
              <div style={{ position: 'relative' }}>
                <div className="tl-now" />
                <div className="tl-row">
                  <div className="tl-sector">Cozinha</div>
                  <div className="tl-track">
                    <div className="tl-block b-ok" style={{ left: '2%', width: '26%', animationDelay: '.2s' }}>
                      Mise en place <small>C. Andrade</small>
                    </div>
                    <div className="tl-block b-info" style={{ left: '30%', width: '34%', animationDelay: '.45s' }}>
                      Linha do almoço <small>P. Lima</small>
                    </div>
                    <div className="tl-block b-ok" style={{ left: '66%', width: '30%', animationDelay: '.7s' }}>
                      Produção jantar
                    </div>
                  </div>
                </div>
                <div className="tl-row">
                  <div className="tl-sector">Salão</div>
                  <div className="tl-track">
                    <div className="tl-block b-muted" style={{ left: '8%', width: '16%', animationDelay: '.3s' }}>
                      Abertura
                    </div>
                    <div className="tl-block b-info" style={{ left: '26%', width: '38%', animationDelay: '.55s' }}>
                      Atendimento <small>4 garçons</small>
                    </div>
                    <div className="tl-block b-brand" style={{ left: '66%', width: '13%', animationDelay: '.8s' }}>
                      Limpeza
                    </div>
                  </div>
                </div>
                <div className="tl-row">
                  <div className="tl-sector">Bar</div>
                  <div className="tl-track">
                    <div className="tl-block b-ok" style={{ left: '20%', width: '22%', animationDelay: '.4s' }}>
                      Prep guarnições
                    </div>
                    <div className="tl-block b-info" style={{ left: '44%', width: '52%', animationDelay: '.65s' }}>
                      Serviço <small>M. Costa</small>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="frame-kpis">
              <div className="fk"><div className="fk-l">Checklists</div><div className="fk-v ok">87%</div></div>
              <div className="fk"><div className="fk-l">Escalados</div><div className="fk-v">14/16</div></div>
              <div className="fk"><div className="fk-l">Desperdício</div><div className="fk-v warn">R$ 142</div></div>
              <div className="fk"><div className="fk-l">CMV mês</div><div className="fk-v ok">31,4%</div></div>
            </div>
          </div>
        </div>
      </div>

      {/* O QUE O PRODUTO JÁ FAZ — só o que existe (antes: números de clientes e resultados que nunca medimos) */}
      <div className="proof">
        <div><b>5 canais</b><span>de delivery numa fila só</span></div>
        <div><b>Sem internet</b><span>o balcão continua vendendo</span></div>
        <div><b>4 perfis</b><span>cada um vê só o que precisa</span></div>
        <div><b>3 meses</b><span>grátis, do sistema completo</span></div>
      </div>

      {/* COMO FUNCIONA */}
      <section>
        <div className="sec-head">
          <div className="eyebrow">O loop que roda a sua operação</div>
          <h2>A escala manda. O resto acontece sozinho.</h2>
          <p>
            No Regem, montar a escala já resolve quem faz o quê, quando — e como
            você acompanha.
          </p>
        </div>
        <div className="steps">
          <div className="step">
            <div className="step-n">📅</div>
            <h3>1 · Monte a escala</h3>
            <p>6x1, 5x2, 12x36, diaristas, PJ — todos os modelos do Brasil, por setor e função.</p>
          </div>
          <div className="step">
            <div className="step-n">⚡</div>
            <h3>2 · As tarefas se delegam sozinhas</h3>
            <p>Toda tarefa puxa automaticamente o colaborador escalado no dia e horário. Com tutorial anexo.</p>
          </div>
          <div className="step">
            <div className="step-n">📊</div>
            <h3>3 · Acompanhe tudo em tempo real</h3>
            <p>Checklists, desperdício e vistorias com foto e o ranking da equipe — do balcão ao balanço.</p>
          </div>
        </div>
      </section>

      {/* NUVEM + LOCAL (offline-first) */}
      <div className="local">
        <section>
          <div className="sec-head">
            <div className="eyebrow">Nuvem + Local · offline-first</div>
            <h2>A loja não pode parar porque a internet caiu.</h2>
            <p>
              O Regem roda num servidor local dentro da sua loja. PDV, cozinha e
              impressão continuam funcionando sem internet — e tudo sobe para a
              nuvem sozinho quando a conexão volta.
            </p>
          </div>
          <div className="local-grid">
            <div className="lcard">
              <span className="li">📴</span>
              <h3>Vende offline</h3>
              <p>Balcão, comandas, mesas e caixa operam 100% na rede local. Zero tela travada esperando a internet.</p>
            </div>
            <div className="lcard">
              <span className="li">🔄</span>
              <h3>Sincroniza sozinho</h3>
              <p>Vendas, estoque e ponto sobem para a nuvem ao reconectar — com resolução de conflito e log de auditoria.</p>
            </div>
            <div className="lcard">
              <span className="li">🖨️</span>
              <h3>Impressão na loja</h3>
              <p>Cupons e vias de produção saem direto na impressora térmica (ESC/POS), roteados por setor, mesmo sem nuvem.</p>
            </div>
            <div className="lcard">
              <span className="li">🔒</span>
              <h3>Seus dados na sua loja</h3>
              <p>Banco local com atualização automática nas janelas de abertura — sem depender de uma conexão perfeita.</p>
            </div>
          </div>
          <div className="local-modes">
            <div className="lmode">
              <div className="lmt">
                ☁️ Modo Nuvem
                <span className="tag" style={{ background: 'rgba(74,168,224,.15)', color: '#4AA8E0' }}>Simples</span>
              </div>
              <p>Abriu o navegador, está operando. Ideal para quem tem internet estável e uma unidade só.</p>
            </div>
            <div className="lmode">
              <div className="lmt">
                🏪 Modo Nuvem + Local
                <span className="tag" style={{ background: 'rgba(46,189,133,.15)', color: '#2EBD85' }}>À prova de queda</span>
              </div>
              <p>Servidor na loja espelhado com a nuvem. Opera offline e continua vendendo mesmo com a internet fora.</p>
            </div>
          </div>
          <div className="mod-note">
            Você escolhe o modo — e o cabeçalho sempre mostra se está operando na nuvem ou no servidor local.
          </div>
        </section>
      </div>

      {/* PERFIS RBAC */}
      <section id="perfis">
        <div className="sec-head">
          <div className="eyebrow">Do balcão ao balanço</div>
          <h2>Cada nível vê exatamente o que precisa.</h2>
          <p>Hierarquia de verdade: o que a diretoria enxerga, o balcão não acessa — e vice-versa.</p>
        </div>
        <div className="profiles">
          <div className="pcard">
            <span className="pi">👑</span>
            <h3>Presidente / C&amp;O</h3>
            <div className="pr">Rede inteira</div>
            <ul>
              <li>Comparativo entre lojas</li>
              <li>Avisos e resumos do Mister no WhatsApp</li>
              <li>Liga/desliga módulos</li>
              <li>Log de auditoria completo</li>
            </ul>
          </div>
          <div className="pcard">
            <span className="pi">🧭</span>
            <h3>Gerente</h3>
            <div className="pr">A loja toda</div>
            <ul>
              <li>Escalas, estoque e fornecedores</li>
              <li>Aprova horas extras e ajustes</li>
              <li>Checklists e desperdício</li>
              <li>Sem acesso aos dados da diretoria</li>
            </ul>
          </div>
          <div className="pcard">
            <span className="pi">🎯</span>
            <h3>Supervisor</h3>
            <div className="pr">Seu setor</div>
            <ul>
              <li>Dados completos do setor</li>
              <li>Registra vistorias e desperdício</li>
              <li>POPs e treinamento da equipe</li>
            </ul>
          </div>
          <div className="pcard">
            <span className="pi">👤</span>
            <h3>Execução</h3>
            <div className="pr">Seu turno</div>
            <ul>
              <li>Minha escala e minhas tarefas</li>
              <li>Tutoriais de cada atividade</li>
              <li>Meu ponto, marcado na hora</li>
              <li>Zero burocracia, zero cadastro</li>
            </ul>
          </div>
        </div>
      </section>

      {/* MÓDULOS */}
      <section>
        <div className="sec-head">
          <div className="eyebrow">Ative só o que a sua operação usa</div>
          <h2>Módulos que crescem com você.</h2>
        </div>
        <div className="mods">
          <div className="mod">
            <span className="mi">🧾</span>
            <div><h3>PDV & Comandas</h3><p>Venda no balcão, mesas e garçom, caixa com sangria/reforço e senha central.</p></div>
            <span className="sw" aria-hidden="true" />
          </div>
          <div className="mod">
            <span className="mi">🛍️</span>
            <div><h3>Cardápio digital</h3><p>Loja online própria para food service — entrega, retirada e encomenda. Varejo, indústria e serviços em breve.</p></div>
            <span className="sw" aria-hidden="true" />
          </div>
          <div className="mod">
            <span className="mi">🖥️</span>
            <div><h3>KDS de Alertas</h3><p>Telas na cozinha com a fila de produção, senha e alertas de pico e atraso.</p></div>
            <span className="sw" aria-hidden="true" />
          </div>
          <div className="mod">
            <span className="mi">📄</span>
            <div><h3>Nota fiscal (NFC-e)</h3><p>Emissão fiscal ao vender, com NCM, tributação e QR Code — pronto pra SEFAZ.</p></div>
            <span className="sw" aria-hidden="true" />
          </div>
          <div className="mod">
            <span className="mi">💳</span>
            <div><h3>TEF / Maquininha <span className="breve">em breve</span></h3><p>Crédito e débito na maquininha integrada ao PDV, sem digitar o valor de novo. O Pix já sai integrado pelo Mercado Pago e pelo PagBank.</p></div>
            <span className="sw" aria-hidden="true" />
          </div>
          <div className="mod">
            <span className="mi">🛵</span>
            <div><h3>Delivery & iFood</h3><p>Pedidos dos canais entram na fila com aceite, status e baixa de estoque.</p></div>
            <span className="sw" aria-hidden="true" />
          </div>
          <div className="mod">
            <span className="mi">📊</span>
            <div><h3>Fichas Técnicas & CMV</h3><p>Custo real × teórico, desvio e “furo” — o KPI que separa lucro de prejuízo.</p></div>
            <span className="sw" aria-hidden="true" />
          </div>
          <div className="mod">
            <span className="mi">📦</span>
            <div><h3>Estoque, Validade & Compras</h3><p>Lotes com PVPS/FEFO, ponto de pedido automático e alertas de vencimento.</p></div>
            <span className="sw" aria-hidden="true" />
          </div>
          <div className="mod">
            <span className="mi">🚚</span>
            <div><h3>Fornecedores & Recebimento</h3><p>Recebe a nota, aponta divergências e monta o histórico de preços por fornecedor.</p></div>
            <span className="sw" aria-hidden="true" />
          </div>
          <div className="mod">
            <span className="mi">⏱️</span>
            <div><h3>Terminal de Ponto</h3><p>Marcação com NSR, foto e comprovante — lógica da Portaria 671, mesmo offline.</p></div>
            <span className="sw" aria-hidden="true" />
          </div>
          <div className="mod">
            <span className="mi">📣</span>
            <div><h3>Mural & Clima</h3><p>Comunicados com leitura rastreável e pesquisa de clima anônima da equipe.</p></div>
            <span className="sw" aria-hidden="true" />
          </div>
          <div className="mod">
            <span className="mi">🤖</span>
            <div><h3>Bot de Atendimento</h3><p>Respostas treinadas por você no salão e no delivery. Escala ao gerente quando precisa.</p></div>
            <span className="sw" aria-hidden="true" />
          </div>
          <div className="mod">
            <span className="mi">🎁</span>
            <div><h3>Cashback & Fidelidade</h3><p>Devolva parte da compra em saldo ou pontos, com desconto automático no resgate e estorno em cancelamento.</p></div>
            <span className="sw" aria-hidden="true" />
          </div>
          <div className="mod">
            <span className="mi">🔑</span>
            <div><h3>Perfis de acesso</h3><p>O dono cria e edita perfis, liga/desliga cada permissão e monta a hierarquia da rede — sem mexer no código.</p></div>
            <span className="sw" aria-hidden="true" />
          </div>
        </div>
        <div className="mod-note">
          O proprietário liga e desliga módulos por loja ou para a rede — com registro em auditoria.
        </div>
      </section>

      {/* INTEGRAÇÕES — projetos que conversam com o Regem */}
      <section id="integracoes">
        <div className="sec-head">
          <div className="eyebrow">Ecossistema Regem · conecta com mais</div>
          <h2>Integrações que ampliam a sua operação.</h2>
        </div>
        <div className="mods">
          <div className="mod">
            <span className="mi">📹</span>
            <div>
              <h3>Farol</h3>
              <p>
                Monitoramento da loja por <strong>DVR local + IA</strong>: analisa os setores
                conforme a sua configuração e <strong>alerta o gerente e o C&amp;O</strong> quando
                algo foge do padrão.
              </p>
            </div>
            <span className="sw" aria-hidden="true" />
          </div>
          <div className="mod">
            <span className="mi">🔌</span>
            <div>
              <h3>API aberta</h3>
              <p>
                Delivery (iFood, 99Food, Anota Aí, Cardápio Web), pagamentos e os novos
                endpoints do Regem — a base para conectar os seus próprios sistemas.
              </p>
            </div>
            <span className="sw" aria-hidden="true" />
          </div>
        </div>
        <div className="mod-note">
          Projetos parceiros do ecossistema Regem — ative conforme a sua necessidade.
        </div>
      </section>

      {/* PREÇOS */}
      <section id="precos">
        <div className="sec-head">
          <div className="eyebrow">Planos mensais · os preços do app</div>
          <h2>Comece pequeno. Escale quando quiser.</h2>
        </div>
        <p className="pricing-free">
          ✦ Todos os planos começam com <strong>3 meses grátis</strong> do sistema completo — sem cartão de crédito.
        </p>
        {/* Os planos da tabela do app (`lib/planos-da-landing.ts`, conferida com o catálogo do servidor). */}
        <div className="plans">
          {PLANOS_DA_LANDING.map((p) => (
            <div key={p.chave} className={p.destaque ? 'plan hot' : 'plan'}>
              <h3>{p.nome}</h3>
              <div className="price">{brl0(p.mensal)}<small>/mês</small></div>
              <div className="per">{p.desc}</div>
              <ul>
                {p.modulos.map((m) => <li key={m}>{m}</li>)}
              </ul>
              <Link className={p.destaque ? 'btn btn-brand' : 'btn btn-ghost'} href="/criar-conta">
                {p.destaque ? 'Começar agora' : 'Testar grátis'}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* CTA FINAL */}
      <div className="cta-final">
        <div className="eyebrow">3 meses grátis · sem cartão</div>
        <h2>
          Sua operação inteira, <em>no comando</em>.
        </h2>
        <Link
          className="btn btn-brand"
          href="/criar-conta"
          style={{ padding: '16px 40px', fontSize: 17 }}
        >
          Criar minha conta
        </Link>
      </div>

      <footer>
        <Link className="logo" href="/" style={{ fontSize: 16 }}>
          <span className="logo-mark" style={{ width: 28, height: 28, fontSize: 12 }}>
            R
          </span>{' '}
          Regem
        </Link>
        <nav>
          <Link href="/termos">Termos de uso</Link>
          <Link href="/privacidade">Privacidade &amp; LGPD</Link>
          {/* O suporte pelo WhatsApp (sem botão flutuante — decisão do dono para a landing, 12/11/2026). Os dois links
              daqui apontavam para "#": não levavam a lugar nenhum. */}
          {WHATS && (
            <a href={`https://wa.me/${WHATS}?text=${encodeURIComponent('Olá! Tenho uma dúvida sobre o Regem.')}`} target="_blank" rel="noopener noreferrer">
              Suporte pelo WhatsApp
            </a>
          )}
        </nav>
        <div className="foot-sign">
          REGEM · NO COMANDO DE TODO O NEGÓCIO · DO BALCÃO AO BALANÇO
        </div>
      </footer>

    </div>
  );
}
