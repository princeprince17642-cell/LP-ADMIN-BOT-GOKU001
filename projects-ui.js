/* projects-ui.js - "BUY NOW" project form, project list and project details (Landing Page + Tracking Generator).
   Self-contained: injects its own styles and a full-screen overlay. Opened from the BUY NOW button. */
(function () {
  'use strict';

  var tg = window.Telegram && window.Telegram.WebApp;
  var TEMPLATES = [
    { key: 'premium-dark', name: 'Premium Dark', tagline: 'Elegant black and gold luxury look' },
    { key: 'modern-gradient', name: 'Modern Gradient', tagline: 'Vibrant colors with glass cards' },
    { key: 'minimal-premium', name: 'Minimal Premium', tagline: 'Clean, light and refined' },
    { key: 'neon-tech', name: 'Neon Tech', tagline: 'Futuristic glowing neon style' }
  ];
  var SWATCHES = ['#d4af37', '#ec4899', '#00e5ff', '#22c55e', '#3b82f6', '#f97316', '#a78bfa', '#ef4444'];
  var BGS = [['template', 'Template default'], ['midnight', 'Midnight'], ['aurora', 'Aurora'], ['sunset', 'Sunset'], ['carbon', 'Carbon'], ['royal', 'Royal']];
  var FIELD_IDS = { templateKey: 'gp-tpl', pixelId: 'gp-pixel', capiToken: 'gp-capi', testEventCode: 'gp-test', botToken: 'gp-bot', channelId: 'gp-channel',
    channelName: 'gp-name', headline: 'gp-headline', subtitle: 'gp-sub', buttonText: 'gp-button', imageUrl: 'gp-image', description: 'gp-desc', guidePoints: 'gp-guide', theme: 'gp-theme' };

  var AD_PARAMS = 'campaign_id={{campaign.id}}&campaign_name={{campaign.name}}&adset_id={{adset.id}}&adset_name={{adset.name}}&ad_id={{ad.id}}&ad_name={{ad.name}}&utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}';
  var root, body, titleEl, stack = [], cfg = null, lastKey = 'premium-dark', accent = '', bgStyle = 'template', verified = null;

  // ---------- helpers ----------
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(id) { return document.getElementById(id); }
  function tplName(k) { for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].key === k) return TEMPLATES[i].name; return k; }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'X-Telegram-Init-Data': tg ? tg.initData : '' };
    var init = { method: opts.method || 'GET', headers: headers };
    if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(path, init).then(function (res) {
      return res.json().then(function (d) {
        if (!res.ok || d.ok === false) { var e = new Error(d.error || 'Request failed'); e.field = d.field; e.status = res.status; throw e; }
        return d;
      }, function () { var e = new Error('Unexpected server response'); e.status = res.status; throw e; });
    });
  }
  function errText(e) { return (e && e.name === 'TypeError') ? 'Network problem. Please try again.' : (e && e.message) || 'Something went wrong.'; }

  var toastTimer;
  function toast(msg, kind) {
    var t = $('toast');
    if (!t) { alert(msg); return; }
    t.textContent = msg; t.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = 'toast'; }, 3200);
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast('Copied', 'ok'); }, function () { toast(text, ''); });
    else toast(text, '');
  }
  function openLink(url) { if (tg && tg.openLink) tg.openLink(url); else window.open(url, '_blank'); }
  function confirmBox(msg, yes) {
    if (tg && tg.showConfirm) tg.showConfirm(msg, function (ok) { if (ok) yes(); });
    else if (window.confirm(msg)) yes();
  }
  function fmtDate(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }

  // ---------- styles ----------
  var CSS = '' +
  '.gp{position:fixed;inset:0;z-index:92;display:flex;flex-direction:column;background:#070913;color:#e8eefc;font-family:"Segoe UI",system-ui,-apple-system,Roboto,sans-serif;padding-top:env(safe-area-inset-top,0px)}' +
  '.gp[hidden]{display:none}' +
  '.gp *{box-sizing:border-box}' +
  '.gp-top{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid rgba(59,130,246,.22);background:rgba(11,17,32,.96)}' +
  '.gp-back{display:flex;align-items:center;gap:8px;padding:6px 14px 6px 6px;border-radius:999px;border:1px solid rgba(59,130,246,.3);background:rgba(11,17,32,.9);color:#fff;font:700 12px inherit;cursor:pointer}' +
  '.gp-back i{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#3b82f6,#8b5cf6);font-style:normal;font-size:15px}' +
  '.gp-title{font-size:16px;font-weight:800;letter-spacing:.04em;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
  '.gp-body{flex:1;overflow-y:auto;padding:16px 16px 40px;max-width:640px;width:100%;margin:0 auto;-webkit-overflow-scrolling:touch}' +
  '.gp-card{margin-bottom:14px;padding:16px;border-radius:20px;background:linear-gradient(160deg,rgba(255,255,255,.045),rgba(11,17,32,.97) 60%);border:1px solid rgba(59,130,246,.22)}' +
  '.gp-h{display:flex;align-items:center;gap:8px;margin:0 0 4px;font-size:12px;font-weight:800;letter-spacing:.18em;color:#7f8cab}' +
  '.gp-sub{margin:0 0 12px;font-size:12.5px;color:#7f8cab;line-height:1.5}' +
  '.gp label{display:block;margin:12px 0 6px;font-size:12.5px;font-weight:700;color:#cbd5f0}' +
  '.gp label small{font-weight:500;color:#7f8cab}' +
  '.gp input[type=text],.gp input[type=password],.gp input[type=url],.gp textarea{width:100%;padding:13px 14px;border-radius:13px;border:1px solid rgba(59,130,246,.25);background:rgba(7,9,19,.75);color:#fff;font:inherit;font-size:14px;outline:none}' +
  '.gp textarea{min-height:88px;resize:vertical}' +
  '.gp input:focus,.gp textarea:focus{border-color:rgba(139,92,246,.75);box-shadow:0 0 0 3px rgba(139,92,246,.18)}' +
  '.gp input.bad,.gp textarea.bad{border-color:#f87171}' +
  '.gp-err{margin-top:6px;font-size:12.5px;color:#fca5a5;line-height:1.4}' +
  '.gp-err:empty{display:none}' +
  '.gp-row{display:flex;gap:10px;align-items:stretch}' +
  '.gp-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 18px;border-radius:14px;border:0;font:800 12.5px inherit;letter-spacing:.12em;color:#fff;cursor:pointer;background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 8px 22px rgba(99,102,241,.4);transition:transform .15s,opacity .2s}' +
  '.gp-btn:active{transform:scale(.97)}.gp-btn:disabled{opacity:.55;cursor:default}' +
  '.gp-btn.wide{width:100%;margin-top:6px;padding:16px;font-size:14px}' +
  '.gp-btn.gold{color:#1a1400;background:linear-gradient(135deg,#fde047,#facc15 55%,#eab308);box-shadow:0 8px 24px rgba(250,204,21,.3)}' +
  '.gp-btn.green{background:linear-gradient(135deg,#22c55e,#06b6d4);box-shadow:0 8px 22px rgba(34,197,94,.3)}' +
  '.gp-btn.red{background:linear-gradient(135deg,#f87171,#ef4444);box-shadow:0 8px 22px rgba(239,68,68,.3)}' +
  '.gp-btn.ghost{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.2);box-shadow:none}' +
  '.gp-btn.sm{padding:10px 14px;font-size:11px;letter-spacing:.1em}' +
  '.gp-spin{width:15px;height:15px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:gprot .7s linear infinite}' +
  '@keyframes gprot{to{transform:rotate(360deg)}}' +
  '.gp-tpls{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
  '.gp-tpl{position:relative;padding:12px;border-radius:14px;border:1px solid rgba(59,130,246,.25);background:rgba(7,9,19,.6);cursor:pointer;text-align:left;color:#fff;font:inherit}' +
  '.gp-tpl b{display:block;font-size:13px}.gp-tpl span{display:block;margin-top:2px;font-size:11px;color:#7f8cab;line-height:1.35}' +
  '.gp-tpl.on{border-color:#facc15;box-shadow:0 0 18px rgba(250,204,21,.25);background:rgba(250,204,21,.06)}' +
  '.gp-tpl.on::after{content:"\\2713";position:absolute;top:8px;right:10px;color:#facc15;font-weight:900}' +
  '.gp-chips{display:flex;flex-wrap:wrap;gap:8px}' +
  '.gp-chip{padding:8px 13px;border-radius:999px;border:1px solid rgba(59,130,246,.28);background:rgba(11,17,32,.9);color:#9db0d6;font:700 12px inherit;cursor:pointer}' +
  '.gp-chip.on{color:#fff;background:linear-gradient(135deg,#3b82f6,#8b5cf6);border-color:transparent}' +
  '.gp-sw{width:30px;height:30px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}' +
  '.gp-sw.on{border-color:#fff;box-shadow:0 0 0 2px rgba(255,255,255,.25)}' +
  '.gp-auto{display:inline-grid;place-items:center;font:800 9px inherit;color:#cbd5f0;background:#1f2937}' +
  '.gp-ok{padding:10px 12px;margin-top:10px;border-radius:12px;font-size:12.5px;line-height:1.5;border:1px solid}' +
  '.gp-ok.good{color:#86efac;background:rgba(34,197,94,.1);border-color:rgba(34,197,94,.3)}' +
  '.gp-ok.warn{color:#fcd34d;background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.3)}' +
  '.gp-ok.bad{color:#fca5a5;background:rgba(248,113,113,.08);border-color:rgba(248,113,113,.3)}' +
  '.gp-check{display:flex;align-items:flex-start;gap:10px;margin-top:12px;font-size:13px;color:#cbd5f0;line-height:1.45}' +
  '.gp-check input{margin-top:3px;width:18px;height:18px;accent-color:#8b5cf6;flex:0 0 auto}' +
  '.gp-note{padding:12px 14px;border-radius:14px;font-size:12.5px;line-height:1.55;color:#b6c0dc;background:rgba(59,130,246,.07);border:1px solid rgba(59,130,246,.25);margin-bottom:14px}' +
  '.gp-list{display:flex;flex-direction:column;gap:10px}' +
  '.gp-item{display:flex;align-items:center;gap:12px;padding:14px;border-radius:18px;border:1px solid rgba(59,130,246,.22);background:linear-gradient(160deg,rgba(255,255,255,.045),rgba(11,17,32,.97) 60%);cursor:pointer;text-align:left;color:#fff;font:inherit;width:100%}' +
  '.gp-item b{display:block;font-size:14.5px}.gp-item span{display:block;font-size:11.5px;color:#7f8cab;margin-top:2px}' +
  '.gp-chip2{padding:3px 9px;border-radius:6px;font-size:9px;font-weight:800;letter-spacing:.1em}' +
  '.gp-chip2.active{color:#4ade80;background:rgba(34,197,94,.14)}.gp-chip2.paused{color:#fbbf24;background:rgba(245,158,11,.14)}' +
  '.gp-url{display:flex;gap:8px;align-items:center;padding:10px 12px;border-radius:12px;background:rgba(7,9,19,.75);border:1px solid rgba(59,130,246,.25);font:12.5px ui-monospace,Menlo,Consolas,monospace;color:#93c5fd;word-break:break-all}' +
  '.gp-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
  '.gp-stat{padding:12px;border-radius:14px;border:1px solid rgba(59,130,246,.2);background:rgba(7,9,19,.55)}' +
  '.gp-stat small{display:block;font-size:10px;font-weight:700;letter-spacing:.1em;color:#7f8cab}' +
  '.gp-stat b{display:block;margin-top:4px;font-size:20px}' +
  '.gp-tbl{width:100%;border-collapse:collapse;font-size:12px}' +
  '.gp-tbl th{padding:6px 4px;text-align:left;font-size:10px;letter-spacing:.1em;color:#7f8cab}' +
  '.gp-tbl td{padding:8px 4px;border-top:1px solid rgba(255,255,255,.06);word-break:break-all}' +
  '.gp-code{margin-top:8px;padding:10px 12px;border-radius:12px;background:rgba(7,9,19,.75);border:1px solid rgba(59,130,246,.25);font:11.5px ui-monospace,Menlo,Consolas,monospace;color:#cbd5f0;word-break:break-all}' +
  '.gp-empty{padding:34px 16px;text-align:center;color:#7f8cab;font-size:13.5px}' +
  '.gp-hero-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:12px;padding:12px;border-radius:14px;border:1px solid rgba(139,92,246,.45);background:rgba(139,92,246,.1);color:#c4b5fd;font:800 12px inherit;letter-spacing:.12em;cursor:pointer}';

  function ensureDom() {
    if (root) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    root = document.createElement('div'); root.id = 'gdxp'; root.className = 'gp'; root.hidden = true;
    root.innerHTML = '<div class="gp-top"><button type="button" class="gp-back" id="gpBack"><i>&#8249;</i>BACK</button><div class="gp-title" id="gpTitle"></div></div><div class="gp-body" id="gpBody"></div>';
    document.body.appendChild(root);
    body = $('gpBody'); titleEl = $('gpTitle');
    $('gpBack').addEventListener('click', back);
  }

  // ---------- navigation ----------
  function onTgBack() { back(); }
  function show() {
    ensureDom();
    if (root.hidden) {
      root.hidden = false; document.body.style.overflow = 'hidden';
      if (tg && tg.BackButton) { tg.BackButton.show(); tg.BackButton.onClick(onTgBack); }
    }
  }
  function close() {
    if (!root || root.hidden) return;
    root.hidden = true; document.body.style.overflow = ''; stack = [];
    if (tg && tg.BackButton) { tg.BackButton.offClick(onTgBack); tg.BackButton.hide(); }
  }
  function push(screen, args, replace) {
    if (replace) stack.pop();
    stack.push({ screen: screen, args: args || {} });
    render();
  }
  function back() {
    if (stack.length <= 1) { close(); return; }
    stack.pop(); render();
  }
  function render() {
    var cur = stack[stack.length - 1];
    body.scrollTop = 0;
    if (cur.screen === 'form') renderForm(cur.args);
    else if (cur.screen === 'list') renderList();
    else if (cur.screen === 'detail') renderDetail(cur.args.id);
  }

  function loadCfg() {
    if (cfg) return Promise.resolve(cfg);
    return api('/api/projects/config').then(function (c) { cfg = c; return c; }, function () { cfg = { turnstileAvailable: false }; return cfg; });
  }
  function loadTemplates() {
    return fetch('/api/landing/templates').then(function (r) { return r.json(); }).then(function (d) { if (d && d.templates && d.templates.length) TEMPLATES = d.templates; }).catch(function () {});
  }

  // ---------- FORM (create + edit) ----------
  function renderForm(args) {
    var edit = !!args.project, p = args.project || {};
    var tpl = edit ? p.templateKey : (args.templateKey || lastKey);
    accent = edit ? ((p.theme && p.theme.accent) || '') : '';
    bgStyle = edit ? ((p.theme && p.theme.bg) || 'template') : 'template';
    verified = null;
    titleEl.textContent = edit ? 'EDIT PROJECT' : 'BUY NOW: CREATE YOUR PAGE';
    var c = p.content || {};
    var guide = (c.guidePoints || []).join('\n');

    var tplHtml = TEMPLATES.map(function (t) {
      return '<button type="button" class="gp-tpl' + (t.key === tpl ? ' on' : '') + '" data-tpl="' + esc(t.key) + '"><b>' + esc(t.name) + '</b><span>' + esc(t.tagline) + '</span></button>';
    }).join('');
    var swHtml = '<button type="button" class="gp-sw gp-auto' + (accent ? '' : ' on') + '" data-sw="">AUTO</button>' + SWATCHES.map(function (s) {
      return '<button type="button" class="gp-sw' + (accent === s ? ' on' : '') + '" data-sw="' + s + '" style="background:' + s + '" aria-label="' + s + '"></button>';
    }).join('');
    var bgHtml = BGS.map(function (b) { return '<button type="button" class="gp-chip' + (bgStyle === b[0] ? ' on' : '') + '" data-bg="' + b[0] + '">' + esc(b[1]) + '</button>'; }).join('');

    var h = '';
    if (!edit) h += '<div class="gp-note">Fill this short form and we create your landing page and the Meta tracking. A <b>Subscribe</b> event is sent to Meta <b>only</b> when a visitor sends a Telegram <b>Join Request</b> through the unique link made by your page. Tokens are encrypted and are never shown again.</div>';

    h += '<div class="gp-card"><div class="gp-h">1. DESIGN</div><div class="gp-sub">' + (edit ? 'You can switch the design.' : 'Your selected design is already chosen. You can change it here.') + '</div><div class="gp-tpls" id="gp-tpl">' + tplHtml + '</div><div class="gp-err" data-err="templateKey"></div></div>';

    if (!edit) {
      h += '<div class="gp-card"><div class="gp-h">2. META PIXEL</div><div class="gp-sub">From Meta Events Manager &gt; your Pixel &gt; Settings.</div>' +
        '<label for="gp-pixel">Pixel ID</label><input type="text" id="gp-pixel" inputmode="numeric" autocomplete="off" placeholder="e.g. 1234567890123456"><div class="gp-err" data-err="pixelId"></div>' +
        '<label for="gp-capi">CAPI Access Token</label><input type="password" id="gp-capi" autocomplete="new-password" placeholder="Paste the Conversions API token"><div class="gp-err" data-err="capiToken"></div>' +
        '<label for="gp-test">Test Event Code <small>(optional)</small></label><input type="text" id="gp-test" autocomplete="off" placeholder="e.g. TEST12345"><div class="gp-err" data-err="testEventCode"></div>' +
        '<label>Campaign tracking parameters</label><div class="gp-sub" style="margin:0 0 6px">Add this in your Meta ad &gt; Tracking &gt; URL parameters. Then every join is linked to its campaign, ad set and ad.</div><div class="gp-code" id="gp-params">' + esc(AD_PARAMS) + '</div><button type="button" class="gp-btn sm ghost" id="gp-copyparams" style="margin-top:8px">COPY PARAMETERS</button></div>';

      h += '<div class="gp-card"><div class="gp-h">3. TELEGRAM BOT &amp; CHANNEL</div><div class="gp-sub">Use <b>your own</b> bot (create it in @BotFather). One bot can be used in one project only. Add the bot to your channel as an admin with the <b>Invite users via link</b> permission.</div>' +
        '<label for="gp-bot">Bot Token</label><input type="password" id="gp-bot" autocomplete="new-password" placeholder="123456789:ABC..."><div class="gp-err" data-err="botToken"></div>' +
        '<label for="gp-channel">Channel ID</label><div class="gp-row"><input type="text" id="gp-channel" inputmode="numeric" autocomplete="off" placeholder="-1001234567890"><button type="button" class="gp-btn sm" id="gp-verify">VERIFY</button></div><div class="gp-err" data-err="channelId"></div><div id="gp-vres"></div>' +
        '<div class="gp-ok warn" style="margin-top:10px">Heads up: connecting replaces any webhook this bot already has.</div></div>';
    } else {
      h += '<div class="gp-card"><div class="gp-h">CONNECTED ACCOUNTS</div><div class="gp-sub">Pixel <b>' + esc(p.pixelId) + '</b> &middot; Bot <b>@' + esc(p.botUsername) + '</b> &middot; Channel <b>' + esc(p.channelTitle) + '</b><br>Tokens are saved encrypted and are not shown again.</div>' +
        '<label for="gp-test">Test Event Code <small>(optional, enables the test button)</small></label><input type="text" id="gp-test" autocomplete="off" value="' + esc(p.testEventCode) + '" placeholder="e.g. TEST12345"><div class="gp-err" data-err="testEventCode"></div></div>';
    }

    h += '<div class="gp-card"><div class="gp-h">' + (edit ? 'PAGE CONTENT' : '4. PAGE CONTENT') + '</div>' +
      '<label for="gp-name">Channel / community name</label><input type="text" id="gp-name" maxlength="60" autocomplete="off" value="' + esc(edit ? p.channelName : '') + '" placeholder="e.g. My Community"><div class="gp-err" data-err="channelName"></div>' +
      '<label for="gp-headline">Headline <small>(one-line offer)</small></label><input type="text" id="gp-headline" maxlength="120" autocomplete="off" value="' + esc(edit ? p.headline : 'UNLOCK YOUR FULL GUIDE') + '"><div class="gp-err" data-err="headline"></div>' +
      '<label for="gp-sub">Subtitle <small>(optional)</small></label><input type="text" id="gp-sub" maxlength="200" autocomplete="off" value="' + esc(c.subtitle || '') + '" placeholder="A short line under the headline"><div class="gp-err" data-err="subtitle"></div>' +
      '<label for="gp-button">Button text</label><input type="text" id="gp-button" maxlength="30" autocomplete="off" value="' + esc(edit ? p.buttonText : 'JOIN NOW') + '"><div class="gp-err" data-err="buttonText"></div>' +
      '<label for="gp-image">Channel image URL <small>(https, optional)</small></label><input type="url" id="gp-image" autocomplete="off" value="' + esc(edit ? p.imageUrl : '') + '" placeholder="https://..."><div class="gp-err" data-err="imageUrl"></div>' +
      '<label for="gp-desc">About the community <small>(optional, max 400)</small></label><textarea id="gp-desc" maxlength="400" placeholder="Tell visitors what your community is about">' + esc(c.description || '') + '</textarea><div class="gp-err" data-err="description"></div>' +
      '<label for="gp-guide">What members get <small>(one per line, max 5, optional)</small></label><textarea id="gp-guide" placeholder="Leave empty to use a simple default guide">' + esc(guide) + '</textarea><div class="gp-err" data-err="guidePoints"></div></div>';

    h += '<div class="gp-card"><div class="gp-h">' + (edit ? 'THEME' : '5. THEME') + '</div><div class="gp-sub">Accent color</div><div class="gp-chips" id="gp-sws">' + swHtml + '</div>' +
      '<div class="gp-sub" style="margin-top:14px">Background style</div><div class="gp-chips" id="gp-bgs">' + bgHtml + '</div><div class="gp-err" data-err="theme"></div></div>';

    h += '<div class="gp-card"><div class="gp-h">PROTECTION</div>' +
      '<label class="gp-check"><input type="checkbox" id="gp-fbclid"' + ((!edit || p.requireFbclid) ? ' checked' : '') + '><span>Only allow Meta ad traffic (visitors must arrive with a Meta ad click id). Recommended. It blocks fake and bot clicks.</span></label>';
    if (cfg && cfg.turnstileAvailable) h += '<label class="gp-check"><input type="checkbox" id="gp-ts"' + (edit && p.turnstileEnabled ? ' checked' : '') + '><span>Show a Cloudflare Turnstile check on the Join button.</span></label>';
    h += '</div>';

    h += '<div class="gp-err" id="gp-top-err" style="margin:0 0 10px;font-size:13.5px"></div>';
    h += '<button type="button" class="gp-btn gold wide" id="gp-submit">' + (edit ? 'SAVE CHANGES' : 'CREATE LANDING PAGE') + '</button>';
    body.innerHTML = h;

    body.querySelectorAll('[data-tpl]').forEach(function (b) {
      b.addEventListener('click', function () {
        body.querySelectorAll('[data-tpl]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); lastKey = b.getAttribute('data-tpl');
      });
    });
    body.querySelectorAll('[data-sw]').forEach(function (b) {
      b.addEventListener('click', function () {
        body.querySelectorAll('[data-sw]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); accent = b.getAttribute('data-sw');
      });
    });
    body.querySelectorAll('[data-bg]').forEach(function (b) {
      b.addEventListener('click', function () {
        body.querySelectorAll('[data-bg]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); bgStyle = b.getAttribute('data-bg');
      });
    });
    if (!edit) { $('gp-verify').addEventListener('click', doVerify); $('gp-copyparams').addEventListener('click', function () { copy(AD_PARAMS); }); }
    $('gp-submit').addEventListener('click', function () { submitForm(edit, p); });
  }

  function val(id) { var n = $(id); return n ? n.value.trim() : ''; }
  function setErr(field, msg) {
    var n = body.querySelector('[data-err="' + field + '"]');
    var input = $(FIELD_IDS[field] || '');
    if (n) n.textContent = msg || '';
    if (input && input.classList) input.classList.toggle('bad', !!msg);
    if (!n) $('gp-top-err').textContent = msg || '';
  }
  function clearErrors() {
    body.querySelectorAll('[data-err]').forEach(function (n) { n.textContent = ''; });
    body.querySelectorAll('.bad').forEach(function (n) { n.classList.remove('bad'); });
    $('gp-top-err').textContent = '';
  }

  function doVerify() {
    clearErrors();
    var btn = $('gp-verify'), res = $('gp-vres');
    var bot = val('gp-bot'), ch = val('gp-channel');
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,50}$/.test(bot)) { setErr('botToken', 'Enter the full bot token first (123456789:ABC...).'); return; }
    if (!/^-100\d{6,14}$/.test(ch)) { setErr('channelId', 'Channel ID must start with -100 followed by digits.'); return; }
    btn.disabled = true; btn.innerHTML = '<span class="gp-spin"></span>';
    api('/api/projects/verify-channel', { method: 'POST', body: { botToken: bot, channelId: ch } }).then(function (d) {
      verified = d;
      var nm = $('gp-name'); if (nm && !nm.value.trim() && d.channelTitle) nm.value = d.channelTitle.slice(0, 60);
      res.innerHTML = '<div class="gp-ok ' + (d.ready ? 'good' : 'warn') + '">Bot <b>@' + esc(d.botUsername) + '</b> &middot; Channel <b>' + esc(d.channelTitle) + '</b><br>' +
        (d.isAdmin ? '&#10003; Bot is admin' : '&#10007; Bot is NOT admin') + ' &middot; ' + (d.canInvite ? '&#10003; Can invite users' : '&#10007; Missing "Invite users via link" permission') + '</div>';
    }).catch(function (e) {
      verified = null; res.innerHTML = '';
      setErr(e.field === 'botToken' ? 'botToken' : 'channelId', errText(e));
    }).then(function () { btn.disabled = false; btn.textContent = 'VERIFY'; });
  }

  function collect(edit) {
    var theme = { bg: bgStyle }; if (accent) theme.accent = accent;
    var tplOn = body.querySelector('.gp-tpl.on');
    var o = {
      templateKey: tplOn ? tplOn.getAttribute('data-tpl') : lastKey,
      channelName: val('gp-name'), headline: val('gp-headline'), subtitle: val('gp-sub'), buttonText: val('gp-button'),
      imageUrl: val('gp-image'), description: val('gp-desc'), guidePoints: val('gp-guide').split('\n').map(function (x) { return x.trim(); }).filter(Boolean),
      testEventCode: val('gp-test'), theme: theme, requireFbclid: !!$('gp-fbclid').checked, turnstileEnabled: !!($('gp-ts') && $('gp-ts').checked)
    };
    if (!edit) { o.pixelId = val('gp-pixel'); o.capiToken = val('gp-capi'); o.botToken = val('gp-bot'); o.channelId = val('gp-channel'); }
    return o;
  }

  function clientValidate(o, edit) {
    var errs = [];
    if (!edit) {
      if (!/^\d{8,20}$/.test(o.pixelId)) errs.push(['pixelId', 'Pixel ID must be 8 to 20 digits.']);
      if (!/^[A-Za-z0-9_-]{20,600}$/.test(o.capiToken)) errs.push(['capiToken', 'Paste the full CAPI access token.']);
      if (!/^\d{6,12}:[A-Za-z0-9_-]{30,50}$/.test(o.botToken)) errs.push(['botToken', 'The bot token looks wrong (123456789:ABC...).']);
      if (!/^-100\d{6,14}$/.test(o.channelId)) errs.push(['channelId', 'Channel ID must start with -100 followed by digits.']);
    }
    if (o.testEventCode && !/^[A-Za-z0-9_-]{3,40}$/.test(o.testEventCode)) errs.push(['testEventCode', 'Test Event Code looks wrong (example: TEST12345).']);
    if (o.channelName.length < 2 || o.channelName.length > 60) errs.push(['channelName', 'Name must be 2 to 60 characters.']);
    if (o.headline.length < 3 || o.headline.length > 120) errs.push(['headline', 'Headline must be 3 to 120 characters.']);
    if (o.buttonText.length < 2 || o.buttonText.length > 30) errs.push(['buttonText', 'Button text must be 2 to 30 characters.']);
    if (o.imageUrl && !/^https:\/\/\S+$/i.test(o.imageUrl)) errs.push(['imageUrl', 'Image URL must start with https://']);
    if (o.guidePoints.length > 5) errs.push(['guidePoints', 'Use at most 5 guide points.']);
    return errs;
  }

  function submitForm(edit, p) {
    clearErrors();
    var o = collect(edit);
    var errs = clientValidate(o, edit);
    if (errs.length) {
      errs.forEach(function (e) { setErr(e[0], e[1]); });
      var first = body.querySelector('.bad'); if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    var btn = $('gp-submit'), label = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="gp-spin"></span> ' + (edit ? 'SAVING...' : 'CHECKING BOT, CHANNEL &amp; PIXEL...');
    var req = edit ? api('/api/projects/' + p.id, { method: 'PATCH', body: o }) : api('/api/projects', { method: 'POST', body: o });
    req.then(function (d) {
      toast(edit ? 'Changes saved' : 'Your landing page is ready!', 'ok');
      push('detail', { id: d.project.id }, true);
      if (!edit) stack = [{ screen: 'detail', args: { id: d.project.id } }];
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = label;
      if (e.field && body.querySelector('[data-err="' + e.field + '"]')) {
        setErr(e.field, errText(e));
        var n = $(FIELD_IDS[e.field] || ''); if (n && n.scrollIntoView) n.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else { $('gp-top-err').textContent = errText(e); }
    });
  }

  // ---------- LIST ----------
  function renderList() {
    titleEl.textContent = 'MY LANDING PAGES';
    body.innerHTML = '<div class="gp-empty">Loading...</div>';
    api('/api/projects').then(function (d) {
      var h = '<button type="button" class="gp-btn gold wide" id="gp-new" style="margin:0 0 14px">+ NEW PROJECT</button>';
      if (!d.projects.length) h += '<div class="gp-empty">No projects yet.<br>Select a design in Landing Pages and tap BUY NOW.</div>';
      else h += '<div class="gp-list">' + d.projects.map(function (p) {
        return '<button type="button" class="gp-item" data-open="' + esc(p.id) + '"><div style="flex:1;min-width:0"><b>' + esc(p.channelName) + '</b><span>' + esc(tplName(p.templateKey)) + ' &middot; ' + (p.joinRequests || 0) + ' join requests</span></div><span class="gp-chip2 ' + esc(p.status) + '">' + esc(p.status.toUpperCase()) + '</span></button>';
      }).join('') + '</div>';
      body.innerHTML = h;
      $('gp-new').addEventListener('click', function () { push('form', { templateKey: lastKey }); });
      body.querySelectorAll('[data-open]').forEach(function (b) { b.addEventListener('click', function () { push('detail', { id: b.getAttribute('data-open') }); }); });
    }).catch(function (e) { body.innerHTML = '<div class="gp-empty">' + esc(errText(e)) + '</div>'; });
  }

  // ---------- DETAIL ----------
  var STAT_LABELS = [['page_views', 'Page views'], ['join_clicks', 'Join clicks'], ['link_requests', 'Link requests'], ['links_issued', 'Links issued'],
    ['join_requests', 'Join requests'], ['capi_success', 'CAPI sent'], ['capi_failed', 'CAPI failed'], ['blocked', 'Blocked clicks']];

  function renderDetail(id) {
    titleEl.textContent = 'PROJECT';
    body.innerHTML = '<div class="gp-empty">Loading...</div>';
    api('/api/projects/' + id).then(function (d) {
      var p = d.project, s = d.stats, t = s.totals;
      titleEl.textContent = p.channelName.toUpperCase();
      var h = '<div class="gp-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div><b style="font-size:16px">' + esc(p.channelName) + '</b><div class="gp-sub" style="margin:2px 0 0">' + esc(tplName(p.templateKey)) + ' &middot; bot @' + esc(p.botUsername) + '</div></div><span class="gp-chip2 ' + esc(p.status) + '">' + esc(p.status.toUpperCase()) + '</span></div></div>';

      h += '<div class="gp-card"><div class="gp-h">BOT &amp; CHANNEL CONNECTION</div><div class="gp-sub" style="margin:0 0 8px">Bot <b>@' + esc(p.botUsername) + '</b> &middot; Channel <b>' + esc(p.channelTitle) + '</b> &middot; Webhook: <b>' + (p.webhookConnected ? 'connected' : 'not connected') + '</b></div><div id="d-conn"></div><button type="button" class="gp-btn sm ghost" id="d-check">CHECK CONNECTION</button></div>';

      h += '<div class="gp-card"><div class="gp-h">YOUR LANDING PAGE</div><div class="gp-sub">Use this link as the destination URL in your Meta ad.</div><div class="gp-url"><span style="flex:1">' + esc(p.pageUrl) + '</span></div>' +
        '<div class="gp-row" style="margin-top:10px"><button type="button" class="gp-btn sm" id="d-copy" style="flex:1">COPY LINK</button><button type="button" class="gp-btn sm green" id="d-open" style="flex:1">OPEN PAGE</button></div>' +
        '<div class="gp-row" style="margin-top:8px"><button type="button" class="gp-btn sm ghost" id="d-dl" style="flex:1">DOWNLOAD HTML</button><button type="button" class="gp-btn sm ghost" id="d-test" style="flex:1">SEND TEST EVENT</button></div>' +
        (p.testEventCode ? '' : '<div class="gp-ok warn">Test events need a Test Event Code (Edit project). This keeps test data out of your real conversions.</div>') + '<div id="d-msg"></div></div>';

      h += '<div class="gp-card"><div class="gp-h">STATS (LAST 30 DAYS)</div><div class="gp-grid">' + STAT_LABELS.map(function (l) {
        return '<div class="gp-stat"><small>' + l[1].toUpperCase() + '</small><b>' + (t[l[0]] || 0) + '</b></div>';
      }).join('') + '</div><div class="gp-sub" style="margin:10px 0 0">Other join requests (not through your page, never sent to Meta): <b>' + (t.unattributed_join_requests || 0) + '</b>' +
        (s.blocked.length ? '<br>Blocked: ' + s.blocked.map(function (b) { return esc(b.reason) + ' (' + b.count + ')'; }).join(', ') : '') + '</div></div>';

      h += '<div class="gp-card"><div class="gp-h">WHICH AD BROUGHT THE JOINS</div>';
      if (!s.attribution.length) h += '<div class="gp-sub" style="margin:0">No join requests yet.</div>';
      else h += '<table class="gp-tbl"><tr><th>CAMPAIGN</th><th>AD SET</th><th>AD</th><th>JOINS</th></tr>' + s.attribution.map(function (a) {
        function cell(n, i) { return esc(n || i) + (n ? '<br><small style="color:#7f8cab">' + esc(i) + '</small>' : ''); }
        return '<tr><td>' + cell(a.campaignName, a.campaignId) + '</td><td>' + cell(a.adsetName, a.adsetId) + '</td><td>' + cell(a.adName, a.adId) + '</td><td>' + a.joins + '</td></tr>';
      }).join('') + '</table>';
      h += '</div>';

      h += '<div class="gp-card"><div class="gp-h">RECENT META (CAPI) RESULTS</div>';
      if (!s.recentCapi.length) h += '<div class="gp-sub" style="margin:0">Nothing sent yet.</div>';
      else h += s.recentCapi.map(function (c) {
        return '<div class="gp-code">' + (c.ok ? '&#10003;' : '&#10007;') + ' ' + esc(c.kind) + ' &middot; HTTP ' + esc(c.httpStatus) + ' &middot; received ' + esc(c.eventsReceived) + ' &middot; ' + esc(fmtDate(c.createdAt)) + (c.error ? '<br>' + esc(c.error) : '') + (c.fbtraceId ? '<br>trace ' + esc(c.fbtraceId) : '') + '</div>';
      }).join('');
      h += '</div>';

      h += '<div class="gp-card"><div class="gp-h">META AD URL PARAMETERS</div><div class="gp-sub">Paste this in your ad &gt; Tracking &gt; URL parameters so every join is linked to its campaign, ad set and ad.</div><div class="gp-code" id="d-params">' + esc(d.adParams) + '</div><button type="button" class="gp-btn sm ghost" id="d-copyp" style="margin-top:8px">COPY PARAMETERS</button></div>';

      h += '<div class="gp-row"><button type="button" class="gp-btn ghost" id="d-edit" style="flex:1">EDIT</button><button type="button" class="gp-btn ghost" id="d-pause" style="flex:1">' + (p.status === 'active' ? 'PAUSE' : 'RESUME') + '</button><button type="button" class="gp-btn red" id="d-del" style="flex:1">DELETE</button></div>';
      body.innerHTML = h;

      $('d-check').addEventListener('click', function () { checkConn(p); });
      $('d-copy').addEventListener('click', function () { copy(p.pageUrl); });
      $('d-open').addEventListener('click', function () { openLink(p.pageUrl); });
      $('d-copyp').addEventListener('click', function () { copy(d.adParams); });
      $('d-edit').addEventListener('click', function () { push('form', { project: p }); });
      $('d-dl').addEventListener('click', function () { download(p); });
      $('d-test').addEventListener('click', function () { testEvent(p); });
      $('d-pause').addEventListener('click', function () {
        api('/api/projects/' + p.id, { method: 'PATCH', body: { status: p.status === 'active' ? 'paused' : 'active' } }).then(function () { toast('Updated', 'ok'); renderDetail(p.id); }).catch(function (e) { toast(errText(e), 'err'); });
      });
      $('d-del').addEventListener('click', function () {
        confirmBox('Delete this project and its page? This cannot be undone.', function () {
          api('/api/projects/' + p.id, { method: 'DELETE' }).then(function () { toast('Project deleted', 'ok'); stack = [{ screen: 'list', args: {} }]; render(); }).catch(function (e) { toast(errText(e), 'err'); });
        });
      });
    }).catch(function (e) { body.innerHTML = '<div class="gp-empty">' + esc(errText(e)) + '</div>'; });
  }

  function checkConn(p) {
    var btn = $('d-check'), box = $('d-conn');
    btn.disabled = true; box.innerHTML = '<div class="gp-sub">Checking...</div>';
    api('/api/projects/' + p.id + '/check', { method: 'POST' }).then(function (d) {
      var good = d.botOk && d.isAdmin && d.canInvite && d.webhookOk;
      box.innerHTML = '<div class="gp-ok ' + (good ? 'good' : 'warn') + '">' +
        (d.botOk ? '&#10003; Bot works' : '&#10007; Bot cannot reach the channel') + '<br>' +
        (d.isAdmin ? '&#10003; Bot is admin' : '&#10007; Bot is not admin') + '<br>' +
        (d.canInvite ? '&#10003; Can create invite links' : '&#10007; Missing "Invite users via link" permission') + '<br>' +
        (d.webhookOk ? '&#10003; Webhook points to this project' : '&#10007; Webhook is not set to this project') +
        (d.webhookError ? '<br>Telegram: ' + esc(d.webhookError) : '') + (d.error ? '<br>' + esc(d.error) : '') + '</div>';
    }).catch(function (e) { box.innerHTML = '<div class="gp-ok bad">' + esc(errText(e)) + '</div>'; })
      .then(function () { btn.disabled = false; });
  }

  function testEvent(p) {
    var btn = $('d-test'), msg = $('d-msg');
    btn.disabled = true;
    api('/api/projects/' + p.id + '/test-event', { method: 'POST' }).then(function (d) {
      msg.innerHTML = '<div class="gp-ok good">Test event accepted by Meta (received ' + esc(d.eventsReceived) + '). Check Events Manager &gt; Test Events.</div>';
    }).catch(function (e) {
      msg.innerHTML = '<div class="gp-ok bad">' + esc(errText(e)) + '</div>';
    }).then(function () { btn.disabled = false; });
  }

  function download(p) {
    fetch('/api/projects/' + p.id + '/html', { headers: { 'X-Telegram-Init-Data': tg ? tg.initData : '' } }).then(function (r) {
      if (!r.ok) throw new Error('Download failed'); return r.blob();
    }).then(function (b) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'gdx-landing-' + p.id + '.html';
      document.body.appendChild(a); a.click(); a.remove(); toast('Download started', 'ok');
    }).catch(function () { toast('Download did not work here. Use the page link instead.', 'err'); });
  }

  // ---------- public API ----------
  function open(templateKey) {
    if (!tg || !tg.initData) { toast('Please open GDX STORE inside Telegram.', 'err'); return; }
    if (templateKey) lastKey = templateKey;
    ensureDom();
    stack = [];
    show();
    body.innerHTML = '<div class="gp-empty">Loading...</div>';
    Promise.all([loadCfg(), loadTemplates()]).then(function () {
      if (cfg && cfg.encryptionReady === false) {
        titleEl.textContent = 'NOT READY';
        body.innerHTML = '<div class="gp-card"><div class="gp-h">SETUP NEEDED</div><div class="gp-sub">Project tokens cannot be stored yet. The server owner must add <b>TOKEN_ENCRYPTION_KEY</b> in Railway &gt; Variables.</div></div>';
        stack = [{ screen: 'none', args: {} }];
        return;
      }
      push('form', { templateKey: templateKey || lastKey });
    });
  }
  function openList() {
    if (!tg || !tg.initData) { toast('Please open GDX STORE inside Telegram.', 'err'); return; }
    ensureDom(); stack = []; show(); push('list', {});
  }

  function injectEntry() {
    var head = document.querySelector('#landing .lp-head');
    if (!head || head.querySelector('.gp-hero-btn')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'gp-hero-btn'; b.textContent = 'MY LANDING PAGES & TRACKING';
    b.addEventListener('click', openList);
    head.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectEntry); else injectEntry();

  window.GDXProjects = { open: open, openList: openList };
})();
