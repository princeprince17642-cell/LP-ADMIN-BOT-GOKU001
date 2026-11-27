'use strict';
// Generates the complete high-converting community landing page for a project.
// The design follows the template the user selected (4 styles) + optional accent/background choices.
// The page runs the Meta Pixel for PageView + ViewContent ONLY. It never sends Subscribe.

const TEMPLATE_KEYS = ['premium-dark', 'modern-gradient', 'minimal-premium', 'neon-tech'];
const BG_KEYS = ['template', 'midnight', 'aurora', 'sunset', 'carbon', 'royal'];

function esc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function safeJson(v) {
    return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
const hexOk = (h) => /^#[0-9a-fA-F]{6}$/.test(String(h || ''));
function rgbOf(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lighten(hex, amt) {
    const c = rgbOf(hex).map(x => Math.round(x + (255 - x) * amt));
    return '#' + c.map(x => x.toString(16).padStart(2, '0')).join('');
}
function onColor(hex) {
    const [r, g, b] = rgbOf(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0a0a0c' : '#ffffff';
}
function safeUrl(u) {
    try {
        const x = new URL(String(u || ''));
        return x.protocol === 'https:' ? x.href : '';
    } catch (e) { return ''; }
}

const PALETTES = {
    'premium-dark': {
        bg: '#0a0a0c', bgimg: 'radial-gradient(700px 380px at 50% -80px,rgba(212,175,55,.20),transparent 70%),radial-gradient(520px 320px at 100% 100%,rgba(212,175,55,.08),transparent 70%)',
        text: '#f5f1e6', muted: '#b9b3a1', card: 'rgba(255,255,255,.04)', border: 'rgba(212,175,55,.28)',
        accent: '#d4af37', accent2: '#f6e08a'
    },
    'modern-gradient': {
        bg: '#2a1466', bgimg: 'linear-gradient(135deg,#4f46e5 0%,#9333ea 38%,#ec4899 74%,#f97316 100%)',
        text: '#ffffff', muted: 'rgba(255,255,255,.86)', card: 'rgba(255,255,255,.14)', border: 'rgba(255,255,255,.30)',
        accent: '#ec4899', accent2: '#f97316'
    },
    'minimal-premium': {
        bg: '#f7f5f0', bgimg: 'none',
        text: '#111111', muted: '#5a574f', card: '#ffffff', border: '#e4e0d6',
        accent: '#111111', accent2: '#444444'
    },
    'neon-tech': {
        bg: '#04050d', bgimg: 'radial-gradient(520px 320px at 90% 0%,rgba(255,43,214,.20),transparent 70%),radial-gradient(520px 320px at 5% 100%,rgba(0,229,255,.18),transparent 70%)',
        text: '#d7f6ff', muted: '#8fb8c6', card: 'rgba(0,229,255,.05)', border: 'rgba(0,229,255,.38)',
        accent: '#00e5ff', accent2: '#ff2bd6'
    }
};

const BG_STYLES = {
    midnight: { bg: '#05070f', bgimg: 'radial-gradient(900px 500px at 50% -120px,rgba(59,130,246,.30),transparent 70%),radial-gradient(600px 400px at 100% 100%,rgba(139,92,246,.18),transparent 70%)', text: '#eaf0ff', muted: '#9db0d6', card: 'rgba(255,255,255,.05)', border: 'rgba(120,150,255,.28)' },
    aurora:   { bg: '#04121a', bgimg: 'radial-gradient(700px 420px at 15% -40px,rgba(16,185,129,.30),transparent 70%),radial-gradient(700px 420px at 95% 20%,rgba(139,92,246,.30),transparent 70%)', text: '#e8fff8', muted: '#a3c9c0', card: 'rgba(255,255,255,.05)', border: 'rgba(110,231,183,.28)' },
    sunset:   { bg: '#1a0a14', bgimg: 'linear-gradient(160deg,#3b0d2e 0%,#7a1f3d 45%,#c2410c 100%)', text: '#fff4ee', muted: '#f1c9b8', card: 'rgba(255,255,255,.08)', border: 'rgba(255,180,140,.32)' },
    carbon:   { bg: '#0b0b0d', bgimg: 'linear-gradient(180deg,#141418,#0b0b0d 60%)', text: '#f2f2f4', muted: '#a1a1aa', card: 'rgba(255,255,255,.05)', border: 'rgba(255,255,255,.14)' },
    royal:    { bg: '#0d0620', bgimg: 'radial-gradient(800px 480px at 50% -100px,rgba(124,58,237,.42),transparent 70%)', text: '#f3eaff', muted: '#bba9e6', card: 'rgba(255,255,255,.06)', border: 'rgba(167,139,250,.32)' }
};

function resolvePalette(key, theme) {
    const base = Object.assign({}, PALETTES[key] || PALETTES['premium-dark']);
    const t = theme || {};
    if (t.bg && BG_STYLES[t.bg]) Object.assign(base, BG_STYLES[t.bg]);
    if (hexOk(t.accent)) { base.accent = t.accent; base.accent2 = lighten(t.accent, 0.35); }
    base.on = onColor(base.accent);
    base.ar = rgbOf(base.accent).join(',');
    base.a2r = rgbOf(hexOk(base.accent2) ? base.accent2 : base.accent).join(',');
    return base;
}

const ICONS = {
    shield: '<path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/>',
    bolt:   '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    book:   '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 19V5"/><path d="M9 8h6"/>',
    users:  '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 010 6.8"/><path d="M18 14.4c2 .8 3.5 2.6 3.5 5.6"/>',
    send:   '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
    door:   '<path d="M5 21V4a1 1 0 011-1h9a1 1 0 011 1v17"/><path d="M3 21h18"/><circle cx="12.5" cy="12" r=".6"/>',
    bell:   '<path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 004 0"/>',
    exit:   '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const CSS = `
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{background-color:var(--bg);background-image:var(--bgimg);background-attachment:fixed;background-size:cover;color:var(--text);font-family:var(--font);line-height:1.6;min-height:100vh;overflow-x:hidden}
a{color:inherit}
svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto}
.bgfx{position:fixed;inset:0;pointer-events:none;z-index:0}
.top,main,footer{position:relative;z-index:1}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;max-width:760px;margin:0 auto;padding:16px 20px}
.brand{display:flex;align-items:center;gap:10px;min-width:0;font-weight:800;letter-spacing:.04em}
.brand span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:56vw}
.mini{width:34px;height:34px;border-radius:50%;object-fit:cover;display:grid;place-items:center;background:var(--accent);color:var(--on);font-weight:800;font-size:15px;flex:0 0 auto}
.tag{padding:6px 12px;border-radius:999px;font-size:10px;font-weight:800;letter-spacing:.2em;border:1px solid var(--border);color:var(--accent);white-space:nowrap}
main{max-width:760px;margin:0 auto;padding:6px 20px 60px}
.hero{text-align:center;padding:26px 0 18px}
.emblem{width:112px;height:112px;margin:0 auto 22px;border-radius:50%;padding:3px;background:conic-gradient(from 160deg,var(--accent),var(--accent2),var(--accent));box-shadow:0 0 46px rgba(var(--ar),.38);position:relative}
.emblem img,.emblem b{width:100%;height:100%;border-radius:50%;object-fit:cover;display:grid;place-items:center;background:var(--bg);font-size:42px;font-weight:800;color:var(--accent)}
.eyebrow{display:inline-block;padding:7px 16px;border-radius:999px;border:1px solid var(--border);font-size:11px;font-weight:800;letter-spacing:.24em;color:var(--accent);background:rgba(var(--ar),.08)}
h1{margin:18px 0 14px;font-size:clamp(32px,9.4vw,52px);line-height:1.08;font-weight:900;letter-spacing:.01em;word-wrap:break-word}
.sub{max-width:520px;margin:0 auto 26px;font-size:clamp(15px,4.2vw,18px);color:var(--muted)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;width:100%;max-width:420px;padding:18px 28px;border:0;border-radius:var(--r-btn);background:var(--btn-bg);color:var(--btn-fg);font:800 15px var(--font);letter-spacing:.14em;text-transform:uppercase;cursor:pointer;text-decoration:none;box-shadow:var(--btn-shadow);transition:transform .18s,box-shadow .2s,filter .2s}
.btn:active{transform:scale(.98)}
.btn[disabled]{opacity:.65;cursor:progress}
.btn .spin{display:none;width:18px;height:18px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:rot .7s linear infinite}
.btn.busy .spin{display:inline-block}
.btn.busy .ic{display:none}
.btn .ic svg{width:19px;height:19px}
@keyframes rot{to{transform:rotate(360deg)}}
.micro{margin-top:14px;font-size:12.5px;color:var(--muted)}
.hint{margin-top:10px;font-size:12.5px;color:var(--muted);display:none}
.hint a{color:var(--accent);font-weight:700}
.ts{margin:16px auto 0;display:flex;justify-content:center}
.sec{padding:36px 0 6px}
.sec h2{font-size:clamp(20px,6vw,28px);line-height:1.2;font-weight:900;margin-bottom:10px;letter-spacing:.02em}
.sec .lead{color:var(--muted);margin-bottom:18px;font-size:15.5px}
.grid{display:grid;gap:12px;grid-template-columns:1fr}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--r-card);padding:18px}
.card .ico{width:44px;height:44px;border-radius:var(--r-ico);display:grid;place-items:center;margin-bottom:12px;background:rgba(var(--ar),.14);color:var(--accent);border:1px solid var(--border)}
.card h3{font-size:16px;margin-bottom:4px;font-weight:800}
.card p{font-size:14px;color:var(--muted)}
.steps{list-style:none;counter-reset:s;display:grid;gap:12px;margin-bottom:22px}
.steps li{counter-increment:s;display:flex;gap:14px;align-items:flex-start;background:var(--card);border:1px solid var(--border);border-radius:var(--r-card);padding:16px}
.steps li::before{content:counter(s);flex:0 0 34px;height:34px;border-radius:50%;display:grid;place-items:center;font-weight:900;background:var(--accent);color:var(--on)}
.steps li span{font-size:15px;padding-top:4px}
.center{text-align:center}
details{background:var(--card);border:1px solid var(--border);border-radius:var(--r-card);margin-bottom:10px;overflow:hidden}
summary{cursor:pointer;list-style:none;padding:16px 18px;font-weight:700;display:flex;justify-content:space-between;gap:12px;align-items:center}
summary::-webkit-details-marker{display:none}
summary::after{content:"+";font-size:22px;color:var(--accent);transition:transform .2s}
details[open] summary::after{transform:rotate(45deg)}
details p{padding:0 18px 16px;color:var(--muted);font-size:14.5px}
.final{text-align:center;padding:44px 0 10px}
footer{max-width:760px;margin:0 auto;padding:10px 20px 110px;text-align:center;font-size:11.5px;color:var(--muted);line-height:1.7}
.sticky{position:fixed;left:0;right:0;bottom:0;z-index:5;padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));background:linear-gradient(180deg,transparent,rgba(0,0,0,.55) 40%);transform:translateY(120%);transition:transform .3s}
.sticky.show{transform:none}
.sticky .btn{max-width:none}
.toast{position:fixed;left:50%;bottom:90px;z-index:9;max-width:90%;transform:translate(-50%,20px);opacity:0;pointer-events:none;padding:13px 18px;border-radius:14px;background:#1f2937;color:#fff;border:1px solid rgba(248,113,113,.6);font-size:14px;text-align:center;transition:.25s}
.toast.show{opacity:1;transform:translate(-50%,0)}
.reveal{opacity:0;transform:translateY(18px);transition:opacity .6s ease,transform .6s ease}
.reveal.in{opacity:1;transform:none}
@keyframes float{50%{transform:translateY(-6px)}}
.emblem{animation:float 5s ease-in-out infinite}
@media(min-width:640px){.grid.two{grid-template-columns:1fr 1fr}.grid.three{grid-template-columns:repeat(3,1fr)}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.reveal{opacity:1;transform:none}}
`;

const THEME_CSS = {
    'premium-dark': `
body.t-premium-dark{--font:Georgia,'Times New Roman',serif;--r-card:18px;--r-btn:999px;--r-ico:13px;--btn-bg:linear-gradient(135deg,var(--accent2),var(--accent) 60%);--btn-fg:var(--on);--btn-shadow:0 12px 32px rgba(var(--ar),.35)}
.t-premium-dark h1{background:linear-gradient(180deg,#fff7d1,var(--accent2) 30%,var(--accent) 75%);-webkit-background-clip:text;background-clip:text;color:transparent;letter-spacing:.05em;text-transform:uppercase}
.t-premium-dark .sec h2{text-transform:uppercase;letter-spacing:.12em;font-size:clamp(18px,5vw,24px)}
.t-premium-dark .eyebrow,.t-premium-dark .tag,.t-premium-dark .btn{font-family:system-ui,sans-serif}
.t-premium-dark .card,.t-premium-dark .steps li,.t-premium-dark details{background:linear-gradient(160deg,rgba(var(--ar),.09),rgba(255,255,255,.02))}
.t-premium-dark .sub,.t-premium-dark .card p,.t-premium-dark .lead,.t-premium-dark details p,.t-premium-dark .steps li span{font-family:system-ui,sans-serif}`,
    'modern-gradient': `
body.t-modern-gradient{--font:'Segoe UI',system-ui,-apple-system,Roboto,sans-serif;--r-card:24px;--r-btn:18px;--r-ico:16px;--btn-bg:#ffffff;--btn-fg:var(--accent);--btn-shadow:0 16px 36px rgba(0,0,0,.32)}
.t-modern-gradient h1{text-shadow:0 8px 32px rgba(0,0,0,.28)}
.t-modern-gradient .emblem{border-radius:32px;transform:rotate(-6deg)}
.t-modern-gradient .emblem img,.t-modern-gradient .emblem b{border-radius:30px}
.t-modern-gradient .card,.t-modern-gradient .steps li,.t-modern-gradient details{-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.t-modern-gradient .steps li::before{background:#fff;color:var(--accent)}
.t-modern-gradient .tag{color:#fff}
.t-modern-gradient .eyebrow{color:#fff;background:rgba(255,255,255,.2)}`,
    'minimal-premium': `
body.t-minimal-premium{--font:'Helvetica Neue',Helvetica,Arial,sans-serif;--r-card:4px;--r-btn:4px;--r-ico:50%;--btn-bg:var(--accent);--btn-fg:var(--on);--btn-shadow:none}
.t-minimal-premium .hero{text-align:left;padding-top:34px}
.t-minimal-premium .emblem{margin-left:0;width:84px;height:84px;box-shadow:none;animation:none;background:var(--accent)}
.t-minimal-premium .sub{margin-left:0}
.t-minimal-premium h1{font-weight:300;letter-spacing:-.02em;font-size:clamp(38px,12vw,66px);line-height:1}
.t-minimal-premium .eyebrow{background:none;border:0;border-bottom:1px solid var(--text);border-radius:0;padding:0 0 6px;color:var(--text)}
.t-minimal-premium .btn{max-width:none}
.t-minimal-premium .center{text-align:left}
.t-minimal-premium .final{text-align:left}
.t-minimal-premium .card,.t-minimal-premium .steps li,.t-minimal-premium details{box-shadow:none;background:var(--card)}
.t-minimal-premium .steps li::before{border-radius:0;background:none;color:var(--muted);font-weight:500;flex:0 0 28px;height:auto;display:block;padding-top:4px}
.t-minimal-premium .tag{color:var(--text)}
.t-minimal-premium .sticky{background:linear-gradient(180deg,transparent,rgba(247,245,240,.95) 40%)}`,
    'neon-tech': `
body.t-neon-tech{--font:'Courier New',ui-monospace,Menlo,Consolas,monospace;--r-card:2px;--r-btn:2px;--r-ico:2px;--btn-bg:rgba(var(--ar),.08);--btn-fg:var(--accent);--btn-shadow:0 0 22px rgba(var(--ar),.5),inset 0 0 18px rgba(var(--ar),.18)}
.t-neon-tech .bgfx{background:linear-gradient(rgba(var(--ar),.08) 1px,transparent 1px),linear-gradient(90deg,rgba(var(--ar),.08) 1px,transparent 1px);background-size:34px 34px;-webkit-mask-image:radial-gradient(circle at 50% 22%,#000,transparent 78%);mask-image:radial-gradient(circle at 50% 22%,#000,transparent 78%)}
.t-neon-tech h1{color:#fff;letter-spacing:.06em;text-transform:uppercase;text-shadow:0 0 8px var(--accent),0 0 28px rgba(var(--ar),.8),0 0 60px rgba(var(--ar),.4)}
.t-neon-tech .btn{border:2px solid var(--accent);text-shadow:0 0 10px var(--accent)}
.t-neon-tech .emblem{border-radius:24px;background:none;border:2px solid var(--accent);padding:0;box-shadow:0 0 26px rgba(var(--ar),.55),inset 0 0 22px rgba(var(--ar),.25)}
.t-neon-tech .emblem img,.t-neon-tech .emblem b{border-radius:20px}
.t-neon-tech .card,.t-neon-tech .steps li,.t-neon-tech details{border-left:3px solid var(--accent2);box-shadow:inset 0 0 24px rgba(var(--ar),.06)}
.t-neon-tech .steps li::before{border-radius:2px;box-shadow:0 0 14px rgba(var(--ar),.6)}
.t-neon-tech .eyebrow{border-color:var(--accent2);color:var(--accent2);background:none;box-shadow:0 0 14px rgba(var(--a2r),.45)}
.t-neon-tech .sec h2{text-transform:uppercase;letter-spacing:.08em;text-shadow:0 0 12px rgba(var(--ar),.5)}`
};

function defaultGuide(name) {
    return [
        'Tap the join button on this page. Telegram opens right away.',
        'Send your join request to ' + name + '.',
        'A channel admin reviews and approves your request.',
        'Open the channel and find the guide and updates shared there.'
    ];
}

function renderProjectPage(project, opts) {
    const o = opts || {};
    const key = TEMPLATE_KEYS.includes(project.template_key) ? project.template_key : 'premium-dark';
    const theme = project.theme || {};
    const content = project.content || {};
    const p = resolvePalette(key, theme);

    const name = project.channel_name || 'Our Community';
    const headline = project.headline || 'UNLOCK YOUR FULL GUIDE';
    const button = project.button_text || 'JOIN NOW';
    const img = safeUrl(project.image_url);
    const pixel = /^\d{8,20}$/.test(String(project.pixel_id || '')) ? String(project.pixel_id) : '';
    const initial = esc((Array.from(String(name).trim())[0] || 'G').toUpperCase());
    const subtitle = content.subtitle || ('Request access to ' + name + ' and get the complete guide inside the community.');
    const about = content.description || (name + ' is a Telegram community. Send a join request to follow the updates and open the guide shared inside the channel.');
    const guide = (Array.isArray(content.guidePoints) && content.guidePoints.length ? content.guidePoints : defaultGuide(name)).slice(0, 5);
    const apiBase = o.apiBase || '';
    const tsKey = project.turnstile_enabled && o.turnstileSiteKey ? o.turnstileSiteKey : '';

    const joinBtn = (label, cls) =>
        `<button type="button" class="btn ${cls || ''}" data-join><span class="spin"></span><span class="ic">${icon('send')}</span><span class="lbl">${esc(label)}</span></button>`;

    const vars = `:root{--bg:${p.bg};--bgimg:${p.bgimg};--text:${p.text};--muted:${p.muted};--card:${p.card};--border:${p.border};--accent:${p.accent};--accent2:${p.accent2};--on:${p.on};--ar:${p.ar};--a2r:${p.a2r}}`;

    const pixelSnippet = pixel ? `
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init',${safeJson(pixel)});fbq('track','PageView');fbq('track','ViewContent');` : '';

    const clientJs = `
(function(){
var PID=${safeJson(project.public_id)},API=${safeJson(apiBase)},TS=${safeJson(!!tsKey)},PREVIEW=${safeJson(!!o.preview)};
var KEY='gdx_a_'+PID,KEYS=['fbclid','campaign_id','campaign_name','adset_id','adset_name','ad_id','ad_name','utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
function rnd(){var a=new Uint8Array(16);(window.crypto||window.msCrypto).getRandomValues(a);return Array.prototype.map.call(a,function(x){return ('0'+x.toString(16)).slice(-2)}).join('')}
function ck(n){var m=document.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)'));return m?decodeURIComponent(m[1]):''}
function load(){try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){return null}}
function save(){try{localStorage.setItem(KEY,JSON.stringify(A))}catch(e){}}
var q=new URLSearchParams(location.search),cur={};
KEYS.forEach(function(k){var v=q.get(k);if(v)cur[k]=v});
var A=load();
if(!A||!A.sid||(cur.fbclid&&A.attrs&&A.attrs.fbclid!==cur.fbclid)){A={sid:rnd(),attrs:cur,url:location.href,ref:document.referrer||'',t:Date.now()}}
else{KEYS.forEach(function(k){if(!A.attrs[k]&&cur[k])A.attrs[k]=cur[k]})}
save();
function fbc(){var c=ck('_fbc');if(c)return c;return A.attrs.fbclid?('fb.1.'+A.t+'.'+A.attrs.fbclid):''}
function body(extra){var o={sid:A.sid,url:A.url,ref:A.ref,fbc:fbc(),fbp:ck('_fbp'),webdriver:!!navigator.webdriver,elapsed:Math.round(performance.now())};KEYS.forEach(function(k){o[k]=A.attrs[k]||''});for(var k in extra)o[k]=extra[k];return o}
function post(path,data){return fetch(API+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),keepalive:true})}
if(!PREVIEW)setTimeout(function(){post('/api/track/'+PID+'/view',body({})).catch(function(){})},900);
var toast=document.getElementById('toast'),hint=document.getElementById('hint'),btns=[].slice.call(document.querySelectorAll('[data-join]')),busy=false,tt;
function say(m){toast.textContent=m;toast.classList.add('show');clearTimeout(tt);tt=setTimeout(function(){toast.classList.remove('show')},4500)}
function setBusy(b){busy=b;btns.forEach(function(x){x.disabled=b;x.classList.toggle('busy',b)})}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}
function go(link){
 hint.innerHTML='If Telegram did not open, <a href="'+link.replace(/"/g,'&quot;')+'">tap here</a>.';hint.style.display='block';
 window.location.assign(link);
}
async function join(retried){
 if(PREVIEW){say('Preview mode: tracking is off and no Telegram link is created.');return}
 if(busy&&!retried)return;
 setBusy(true);
 try{
  if(TS&&!window.__ts){say('Please complete the verification first.');setBusy(false);return}
  var r=await post('/api/invite/'+PID,body({turnstile:window.__ts||''}));
  var d={};try{d=await r.json()}catch(e){}
  if(r.ok&&d.ok&&d.link){go(d.link);setTimeout(function(){setBusy(false)},2500);return}
  if(!retried&&d.code==='too_fast'){await sleep(1500);return join(true)}
  if(!retried&&d.code==='expired'){A.sid=rnd();save();await sleep(1200);return join(true)}
  say(d.error||'Something went wrong. Please try again.');
 }catch(e){say('Network problem. Please check your connection and try again.')}
 setBusy(false);
}
btns.forEach(function(b){b.addEventListener('click',function(){join(false)})});
window.__tsDone=function(t){window.__ts=t};
var st=document.getElementById('sticky'),hero=document.getElementById('heroBtn');
function onScroll(){var y=window.scrollY||0,hb=hero.getBoundingClientRect();st.classList.toggle('show',hb.bottom<0&&y>300)}
window.addEventListener('scroll',onScroll,{passive:true});onScroll();
if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.12});document.querySelectorAll('.reveal').forEach(function(n){io.observe(n)})}
else{document.querySelectorAll('.reveal').forEach(function(n){n.classList.add('in')})}
})();`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="${esc(p.bg)}">
<title>${esc(name)} - ${esc(headline)}</title>
<meta name="description" content="${esc(subtitle)}">
<meta name="robots" content="noindex">
<style>${vars}${CSS}${THEME_CSS[key]}</style>
<noscript><style>.reveal{opacity:1!important;transform:none!important}</style></noscript>
${pixel && !o.preview ? `<script>${pixelSnippet}</script>` : ''}
${tsKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
</head>
<body class="t-${key}">
<div class="bgfx" aria-hidden="true"></div>
<header class="top">
  <div class="brand">${img ? `<img class="mini" src="${esc(img)}" alt="" referrerpolicy="no-referrer">` : `<b class="mini">${initial}</b>`}<span>${esc(name)}</span></div>
  <div class="tag">FULL GUIDE</div>
</header>
<main>
  <section class="hero reveal">
    <div class="emblem">${img ? `<img src="${esc(img)}" alt="${esc(name)}" referrerpolicy="no-referrer">` : `<b>${initial}</b>`}</div>
    <div class="eyebrow">FULL GUIDE INSIDE</div>
    <h1>${esc(headline)}</h1>
    <p class="sub">${esc(subtitle)}</p>
    <button type="button" class="btn" id="heroBtn" data-join><span class="spin"></span><span class="ic">${icon('send')}</span><span class="lbl">${esc(button)}</span></button>
    ${tsKey ? `<div class="ts"><div class="cf-turnstile" data-sitekey="${esc(tsKey)}" data-callback="__tsDone" data-theme="auto"></div></div>` : ''}
    <p class="micro">Opens in Telegram &middot; Takes a few seconds</p>
    <p class="hint" id="hint"></p>
  </section>

  <section class="sec reveal" id="about">
    <h2>About this community</h2>
    <p class="lead">${esc(about)}</p>
    <div class="grid three">
      <div class="card"><div class="ico">${icon('bell')}</div><h3>Community updates</h3><p>Follow announcements and posts as soon as they are shared.</p></div>
      <div class="card"><div class="ico">${icon('book')}</div><h3>Shared resources</h3><p>Find the guide and useful material inside the channel.</p></div>
      <div class="card"><div class="ico">${icon('users')}</div><h3>All in Telegram</h3><p>Everything happens in the Telegram app you already use.</p></div>
    </div>
  </section>

  <section class="sec reveal">
    <h2>Why join</h2>
    <p class="lead">A simple way to get started.</p>
    <div class="grid two">
      <div class="card"><div class="ico">${icon('bolt')}</div><h3>One-tap request</h3><p>Send your join request straight from this page.</p></div>
      <div class="card"><div class="ico">${icon('send')}</div><h3>Opens in Telegram</h3><p>No sign-up form. The button takes you directly to Telegram.</p></div>
      <div class="card"><div class="ico">${icon('shield')}</div><h3>Approved by admins</h3><p>Join requests are reviewed by the channel admins.</p></div>
      <div class="card"><div class="ico">${icon('exit')}</div><h3>Leave any time</h3><p>You stay in control and can leave the channel whenever you like.</p></div>
    </div>
  </section>

  <section class="sec reveal" id="guide">
    <h2>Your full guide</h2>
    <p class="lead">Here is what happens after you tap the button.</p>
    <ol class="steps">${guide.map(g => `<li><span>${esc(g)}</span></li>`).join('')}</ol>
    <div class="center">${joinBtn('Access full guide')}</div>
  </section>

  <section class="sec reveal" id="faq">
    <h2>Good to know</h2>
    <details><summary>How do I join?</summary><p>Tap any join button on this page. Telegram opens and you send a join request to the channel.</p></details>
    <details><summary>Is access instant?</summary><p>You send a join request and a channel admin approves it, so the timing can vary.</p></details>
    <details><summary>Do I need a Telegram account?</summary><p>Yes. Telegram is free. If you do not have the app yet, Telegram will guide you to install it.</p></details>
    <details><summary>Can I leave later?</summary><p>Yes. You can leave the channel at any time from the Telegram app.</p></details>
    <details><summary>What data is used?</summary><p>To measure advertising results, this page uses the Meta Pixel and records technical visit data such as your IP address and browser. When you send a join request, the channel's bot receives your Telegram user ID and may share a hashed version of it with Meta for ad measurement.</p></details>
  </section>

  <section class="final reveal">
    <h2>Ready to join?</h2>
    <p class="lead">${esc(name)} is one tap away.</p>
    ${joinBtn('Join our community')}
  </section>
</main>
<footer>
  <p>This page is operated by the owner of ${esc(name)}. It is not affiliated with, endorsed by or sponsored by Telegram or Meta.</p>
</footer>
<div class="sticky" id="sticky">${joinBtn(button)}</div>
<div class="toast" id="toast" role="alert"></div>
<script>${clientJs}</script>
</body>
</html>`;
}

module.exports = { renderProjectPage, TEMPLATE_KEYS, BG_KEYS, resolvePalette }; 
