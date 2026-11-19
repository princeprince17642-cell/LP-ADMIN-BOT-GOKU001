// landing-templates.js
// Four "JOIN OUR COMMUNITY" landing page designs. Pure HTML + CSS (no scripts).

const LANDING_TEMPLATES = [
    { key: 'premium-dark',    name: 'Premium Dark',    tagline: 'Elegant black and gold luxury look' },
    { key: 'modern-gradient', name: 'Modern Gradient', tagline: 'Vibrant colors with glass cards' },
    { key: 'minimal-premium', name: 'Minimal Premium', tagline: 'Clean, light and refined' },
    { key: 'neon-tech',       name: 'Neon Tech',       tagline: 'Futuristic glowing neon style' }
];

const SAMPLE = {
    name: 'Your Community',
    badge: 'OPEN COMMUNITY',
    headline: 'JOIN OUR COMMUNITY',
    sub: 'Get exclusive updates, tips and special offers straight on Telegram. Join in just one tap.',
    button: 'JOIN NOW',
    link: '#',
    features: [
        { title: 'Instant Updates', text: 'Get news and announcements the moment they happen.' },
        { title: 'Exclusive Content', text: 'Members-only posts, offers and early access.' },
        { title: 'Friendly Community', text: 'Learn, share and grow together with others.' }
    ]
};

const ICONS = [
    '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 004 0"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
    '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 010 6.8"/><path d="M18 14.4c2 .8 3.5 2.6 3.5 5.6"/></svg>'
];
const PLANE = '<svg viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>';

function esc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Only https:// and tg:// links are allowed in a landing page button.
function safeLink(url) {
    const u = String(url || '').trim();
    return /^(https:\/\/|tg:\/\/)\S+$/i.test(u) ? u : '#';
}

function findTemplate(key) {
    return LANDING_TEMPLATES.find(t => t.key === key) || null;
}

const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
a{text-decoration:none;color:inherit}
svg{fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.9}
.btn svg{width:18px;height:18px;stroke:currentColor}
.feat i svg{width:20px;height:20px}
.feat i{font-style:normal}
`;

const RESP_CSS = `
@media(min-width:760px){
  .wrap{max-width:880px}
  .sub{max-width:560px}
  body:not(.t-minimal-premium) .feats{grid-template-columns:repeat(3,1fr)}
  body:not(.t-minimal-premium) .feat{flex-direction:column}
}
@media(min-width:760px){body.t-minimal-premium .wrap{max-width:640px}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

const THEMES = {

'premium-dark': `
body{background:#0a0a0c;color:#f5f1e6;font-family:Georgia,'Times New Roman',serif;min-height:100vh}
.bg{position:fixed;inset:0;pointer-events:none;background:radial-gradient(700px 380px at 50% -80px,rgba(212,175,55,.2),transparent 70%),radial-gradient(500px 300px at 100% 100%,rgba(212,175,55,.08),transparent 70%)}
.wrap{position:relative;max-width:520px;margin:0 auto;padding:52px 22px 44px;text-align:center}
.emblem{width:96px;height:96px;margin:0 auto 18px;border-radius:50%;padding:3px;background:conic-gradient(from 180deg,#8a6d1d,#f6e08a,#b8902a,#f6e08a,#8a6d1d);box-shadow:0 0 44px rgba(212,175,55,.35)}
.emblem span{display:grid;place-items:center;width:100%;height:100%;border-radius:50%;background:#0a0a0c;color:#f0d77a;font-size:36px;font-weight:700}
.cname{font:600 12px system-ui,sans-serif;letter-spacing:.3em;text-transform:uppercase;color:#b9b3a1}
.badge{display:inline-block;margin-top:14px;padding:7px 18px;border:1px solid rgba(212,175,55,.5);border-radius:999px;font:700 11px/1 system-ui,sans-serif;letter-spacing:.28em;color:#e6c963}
h1{margin:20px 0 14px;font-size:clamp(30px,9vw,46px);line-height:1.1;letter-spacing:.06em;background:linear-gradient(180deg,#fff4c2,#d4af37 60%,#9c7a1a);-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{color:#b9b3a1;font:400 15px/1.75 system-ui,sans-serif;max-width:400px;margin:0 auto 28px}
.btn{display:inline-flex;align-items:center;gap:10px;padding:17px 36px;border-radius:999px;background:linear-gradient(135deg,#f6e08a,#d4af37 55%,#a5822a);color:#1a1400;font:800 14px system-ui,sans-serif;letter-spacing:.2em;box-shadow:0 12px 32px rgba(212,175,55,.35)}
.divider{height:1px;margin:40px auto 26px;width:70%;background:linear-gradient(90deg,transparent,rgba(212,175,55,.65),transparent)}
.feats{display:grid;gap:12px;text-align:left}
.feat{display:flex;gap:14px;align-items:flex-start;padding:16px;border-radius:18px;background:linear-gradient(160deg,rgba(212,175,55,.09),rgba(255,255,255,.02));border:1px solid rgba(212,175,55,.25)}
.feat i{flex:0 0 42px;height:42px;border-radius:13px;display:grid;place-items:center;background:rgba(212,175,55,.12);border:1px solid rgba(212,175,55,.38)}
.feat i svg{stroke:#e6c963}
.feat b{display:block;font:700 15px system-ui,sans-serif;color:#fff;margin-bottom:4px}
.feat span{font:400 13px/1.55 system-ui,sans-serif;color:#a9a392}
.foot{margin-top:32px;font:600 11px system-ui,sans-serif;letter-spacing:.2em;color:#6f6a5a;text-align:center}
`,

'modern-gradient': `
body{font-family:'Segoe UI',system-ui,-apple-system,Roboto,sans-serif;color:#fff;min-height:100vh;background:linear-gradient(135deg,#4f46e5 0%,#9333ea 38%,#ec4899 74%,#f97316 100%);background-attachment:fixed}
.bg{position:fixed;inset:0;pointer-events:none;background:radial-gradient(520px 320px at 15% 8%,rgba(255,255,255,.28),transparent 70%),radial-gradient(480px 360px at 92% 92%,rgba(0,0,0,.28),transparent 70%)}
.wrap{position:relative;max-width:520px;margin:0 auto;padding:48px 20px 38px;text-align:center}
.emblem{width:90px;height:90px;margin:0 auto 20px;border-radius:30px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.45);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);display:grid;place-items:center;box-shadow:0 16px 44px rgba(0,0,0,.28);transform:rotate(-6deg)}
.emblem span{font-size:38px;font-weight:800;transform:rotate(6deg)}
.cname{font-size:12px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;opacity:.9}
.badge{display:inline-block;margin-top:14px;padding:7px 16px;border-radius:999px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.38);font-size:11px;font-weight:700;letter-spacing:.2em}
h1{margin:18px 0 12px;font-size:clamp(32px,10vw,52px);line-height:1.05;font-weight:900;text-shadow:0 8px 32px rgba(0,0,0,.28)}
.sub{opacity:.94;font-size:16px;line-height:1.65;max-width:400px;margin:0 auto 28px}
.btn{display:inline-flex;gap:10px;align-items:center;padding:17px 38px;border-radius:18px;background:#fff;color:#7c3aed;font-weight:800;font-size:15px;letter-spacing:.12em;box-shadow:0 16px 36px rgba(0,0,0,.32)}
.divider{display:none}
.feats{margin-top:36px;display:grid;gap:12px;text-align:left}
.feat{display:flex;gap:14px;padding:16px;border-radius:22px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.feat i{flex:0 0 44px;height:44px;border-radius:15px;background:rgba(255,255,255,.24);display:grid;place-items:center}
.feat i svg{stroke:#fff}
.feat b{display:block;font-size:15px;margin-bottom:3px}
.feat span{font-size:13px;line-height:1.55;opacity:.9}
.foot{margin-top:30px;font-size:11px;letter-spacing:.18em;opacity:.75;text-align:center}
`,

'minimal-premium': `
body{background:#f7f5f0;color:#111;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;min-height:100vh}
.bg{display:none}
.wrap{max-width:520px;margin:0 auto;padding:64px 28px 44px;text-align:left}
.emblem{width:58px;height:58px;border-radius:50%;background:#111;color:#f7f5f0;display:grid;place-items:center;margin-bottom:18px}
.emblem span{font-size:22px;font-weight:700}
.cname{font-size:12px;letter-spacing:.26em;text-transform:uppercase;color:#7a766b}
.badge{display:inline-block;margin:34px 0 16px;font-size:11px;letter-spacing:.28em;color:#111;border-bottom:1px solid #111;padding-bottom:7px}
h1{font-size:clamp(38px,12vw,64px);line-height:1;font-weight:300;letter-spacing:-.02em;margin:0 0 20px}
.sub{color:#5a574f;font-size:16px;line-height:1.75;max-width:430px;margin:0 0 32px}
.btn{display:inline-flex;align-items:center;gap:12px;padding:17px 32px;background:#111;color:#fff;border-radius:4px;font-size:13px;font-weight:600;letter-spacing:.22em}
.divider{height:1px;background:#d9d5ca;margin:48px 0 4px}
.feats{counter-reset:f}
.feat{counter-increment:f;display:flex;gap:18px;padding:22px 0;border-bottom:1px solid #e4e0d6}
.feat i{display:none}
.feat::before{content:counter(f,decimal-leading-zero);flex:0 0 32px;font-size:12px;letter-spacing:.14em;color:#9a968b;padding-top:4px}
.feat b{display:block;font-size:17px;font-weight:600;margin-bottom:5px}
.feat span{font-size:14px;line-height:1.65;color:#6a675e}
.foot{margin-top:36px;font-size:11px;letter-spacing:.2em;color:#9a968b}
`,

'neon-tech': `
body{background:#04050d;color:#d7f6ff;font-family:'Courier New',ui-monospace,Menlo,monospace;min-height:100vh}
.bg{position:fixed;inset:0;pointer-events:none;background:linear-gradient(rgba(0,229,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,.07) 1px,transparent 1px);background-size:34px 34px;-webkit-mask-image:radial-gradient(circle at 50% 28%,#000,transparent 78%);mask-image:radial-gradient(circle at 50% 28%,#000,transparent 78%)}
.bg::after{content:"";position:absolute;inset:0;background:radial-gradient(420px 260px at 85% 8%,rgba(255,43,214,.2),transparent 70%),radial-gradient(420px 280px at 10% 95%,rgba(0,229,255,.18),transparent 70%)}
.wrap{position:relative;max-width:520px;margin:0 auto;padding:50px 20px 40px;text-align:center}
.emblem{width:88px;height:88px;margin:0 auto 20px;display:grid;place-items:center;border:2px solid #00e5ff;border-radius:24px;color:#00e5ff;box-shadow:0 0 26px rgba(0,229,255,.55),inset 0 0 22px rgba(0,229,255,.25);animation:pulse 3s ease-in-out infinite}
.emblem span{font-size:36px;font-weight:700;text-shadow:0 0 14px #00e5ff}
.cname{font-size:12px;letter-spacing:.32em;color:#ff2bd6;text-transform:uppercase;text-shadow:0 0 10px rgba(255,43,214,.7)}
.badge{display:inline-block;margin-top:14px;padding:6px 14px;border:1px solid #ff2bd6;color:#ff2bd6;font-size:11px;letter-spacing:.22em;box-shadow:0 0 14px rgba(255,43,214,.45)}
h1{margin:20px 0 12px;font-size:clamp(28px,9vw,46px);font-weight:700;letter-spacing:.08em;color:#fff;text-shadow:0 0 8px #00e5ff,0 0 28px rgba(0,229,255,.8),0 0 60px rgba(0,229,255,.4)}
.sub{color:#9fc8d6;font-size:14px;line-height:1.8;max-width:420px;margin:0 auto 28px}
.btn{display:inline-flex;gap:10px;align-items:center;padding:15px 34px;background:rgba(0,229,255,.08);border:2px solid #00e5ff;color:#00e5ff;font-weight:700;letter-spacing:.22em;text-shadow:0 0 10px #00e5ff;box-shadow:0 0 22px rgba(0,229,255,.5),inset 0 0 18px rgba(0,229,255,.18)}
.divider{height:1px;margin:38px auto 24px;background:linear-gradient(90deg,transparent,#00e5ff,transparent);box-shadow:0 0 12px #00e5ff}
.feats{display:grid;gap:12px;text-align:left}
.feat{display:flex;gap:14px;padding:16px;border:1px solid rgba(0,229,255,.35);border-left:3px solid #ff2bd6;background:rgba(0,229,255,.04);box-shadow:inset 0 0 24px rgba(0,229,255,.06)}
.feat i{flex:0 0 40px;height:40px;display:grid;place-items:center;border:1px solid rgba(0,229,255,.5);box-shadow:0 0 12px rgba(0,229,255,.3)}
.feat i svg{stroke:#00e5ff}
.feat b{display:block;font-size:14px;color:#fff;letter-spacing:.06em;margin-bottom:4px}
.feat span{font-size:12.5px;line-height:1.65;color:#8fb8c6}
.foot{margin-top:32px;font-size:11px;letter-spacing:.22em;color:#4f7a89;text-align:center}
@keyframes pulse{50%{box-shadow:0 0 40px rgba(0,229,255,.85),inset 0 0 30px rgba(0,229,255,.35)}}
`
};

function renderLandingTemplate(key, input) {
    const tpl = findTemplate(key);
    if (!tpl) return null;

    const d = Object.assign({}, SAMPLE, input || {});
    const initial = esc((Array.from(String(d.name).trim())[0] || 'G').toUpperCase());

    const feats = (d.features || []).slice(0, 3).map((f, i) =>
        `<div class="feat"><i>${ICONS[i % ICONS.length]}</i><div><b>${esc(f.title)}</b><span>${esc(f.text)}</span></div></div>`
    ).join('');

    const body = `
<div class="bg"></div>
<main class="wrap">
  <div class="emblem"><span>${initial}</span></div>
  <div class="cname">${esc(d.name)}</div>
  <div class="badge">${esc(d.badge)}</div>
  <h1>${esc(d.headline)}</h1>
  <p class="sub">${esc(d.sub)}</p>
  <a class="btn" href="${esc(safeLink(d.link))}" target="_blank" rel="noopener">${PLANE}<span>${esc(d.button)}</span></a>
  <div class="divider"></div>
  <div class="feats">${feats}</div>
  <div class="foot">${esc(d.name)} &middot; POWERED BY GDX STORE</div>
</main>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.headline)} - ${esc(tpl.name)}</title>
<style>${BASE_CSS}${THEMES[key]}${RESP_CSS}</style>
</head>
<body class="t-${esc(key)}">${body}</body>
</html>`;
}

module.exports = { LANDING_TEMPLATES, findTemplate, renderLandingTemplate };
const { initProjectSchema } = require('./project-schema');
