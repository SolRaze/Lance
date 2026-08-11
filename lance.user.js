// ==UserScript==
// @name         lance
// @namespace    https://github.com/SolRaze/lance
// @version      0.4.1
// @description  Chat exporter — Markdown/JSON/CSV/TXT/HTML, Enter-as-newline, Caveman + Ponytail prompt modes, first-prompt injection, Claude usage tracker
// @author       SolRaze
// @homepageURL  https://github.com/SolRaze/lance
// @supportURL   https://github.com/SolRaze/lance/issues
// @downloadURL  https://github.com/SolRaze/lance/releases/latest/download/lance.user.js
// @updateURL    https://github.com/SolRaze/lance/releases/latest/download/lance.user.js
// @license      MIT
// @include      *://claude.ai/*
// @include      *://chat.deepseek.com/*
// @include      *://deepseek.com/*
// @include      *://search.brave.com/ask*
// @noframes
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    // ─── Platform ────────────────────────────────────────────────────────────────
    const host = window.location.hostname;
    const P =
        host.includes("claude.ai")           ? "claude"   :
        host.includes("deepseek.com")        ? "deepseek" :
        host.includes("search.brave.com")    ? "brave"    : "unknown";

    // Pictogrammers "lance" (Memory icon set, MIT) — https://pictogrammers.com/library/memory/icon/lance/
    const LANCE_ICON = `<svg class="lance-pill-icon" viewBox="0 0 22 22" fill="currentColor" aria-hidden="true"><path d="M5 19H3V17H4V16H5V15H6V14H5V13H6V12H7V11H9V10H10V9H11V8H13V7H14V6H15V5H16V4H18V3H19V4H18V6H17V7H16V8H15V9H14V11H13V12H12V13H11V15H10V16H9V17H8V16H7V17H6V18H5Z"/></svg>`;

    const qs  = (sel, root = document) => root.querySelector(sel);
    const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];
    function mkEl(tag, opts = {}) {
        const el = document.createElement(tag);
        if (opts.html)      el.innerHTML   = opts.html;
        if (opts.text)      el.textContent = opts.text;
        if (opts.className) el.className   = opts.className;
        if (opts.style)     Object.assign(el.style, opts.style);
        return el;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SETTINGS  — deep-merge on load so new keys survive script updates
    // ═══════════════════════════════════════════════════════════════════════════
    const DEFAULTS = {
        sites:         { claude: true, deepseek: true, brave: true },
        shortcuts:     { ctrl: true, meta: true, alt: false },
        dockTopRight:  false,  // park the pills top-right instead of free-floating
        pills:         { export: true, caveman: true, ponytail: true, injection: true },
        caveman:       { enabled: false, level: 'ultra' },
        ponytail:      { enabled: false, level: 'full' },
        // First-prompt injection: fires once per chat tab, per enabled site.
        injection:     { enabled: false, sites: { claude: true, deepseek: true } },
        usageTracker:  true,   // Claude inline usage tracker
    };

    function deepMerge(defaults, saved) {
        const out = Object.assign({}, defaults);
        for (const k of Object.keys(defaults)) {
            if (saved[k] !== undefined) {
                if (typeof defaults[k] === 'object' && !Array.isArray(defaults[k]) && defaults[k] !== null)
                    out[k] = Object.assign({}, defaults[k], saved[k]);
                else
                    out[k] = saved[k];
            }
        }
        return out;
    }

    function loadCfg() {
        try {
            const s = GM_getValue("lance_cfg");
            if (s) return deepMerge(DEFAULTS, JSON.parse(s));
        } catch(_) {}
        return JSON.parse(JSON.stringify(DEFAULTS));
    }
    function saveCfg(c) { GM_setValue("lance_cfg", JSON.stringify(c)); }
    let CFG = loadCfg();

    // ═══════════════════════════════════════════════════════════════════════════
    //  CAVEMAN MODE
    // ═══════════════════════════════════════════════════════════════════════════
    // Each level has `full` (self-contained instructions) and `short` (trigger only).
    // Claude already has caveman rules via system / Project Knowledge, so it uses
    // `short` (~20 tokens vs ~80). Other sites have no persistent context → `full`.
    // Synced from skills/caveman/SKILL.md. That revision reversed two older rules that
    // sound like compression but measure as zero saving under the tokenizer: invented
    // abbreviations (cfg/impl/req/res) and causal arrows. Both are now banned — do not
    // "optimise" them back in. DeepSeek carries no persistent rules, so it gets the full
    // text inline; the exception cases are the first thing a model drops without it.
    const CAVEMAN_SHARED =
        `Never drop not/never/no/only/except — flipping meaning is worse than any token saved; ` +
        `numbers and units exact. Standard acronyms (DB/API/HTTP) fine; never invent new ones ` +
        `(cfg/impl/req/res/fn) and no causal arrows — both cost a token and save nothing. ` +
        `Reply in the language I write in; compress the style, not the language. Never name or ` +
        `announce the style, and never append a normal-prose recap. Drop the mode entirely for ` +
        `security warnings, irreversible-action confirmations, multi-step sequences where ` +
        `fragment order risks misreading, and anywhere compression itself creates ambiguity — ` +
        `resume after. Code, commits and PRs: write normal.`;
    const CAVEMAN_PROMPTS = {
        lite:  {
            full:  `[Caveman lite] Respond without filler, pleasantries or hedging. Keep articles and full sentences. Professional but tight. ${CAVEMAN_SHARED}\n\n---\n\n`,
            short: `[Caveman lite]\n\n---\n\n`,
        },
        full:  {
            full:  `[Caveman full] Respond terse like smart caveman. All technical substance stays, only fluff dies. Drop articles, filler and pleasantries. Fragments OK. Short synonyms (big not extensive). No decorative tables or emoji, no dumping long raw error logs — quote the shortest decisive line. Technical terms exact, code blocks unchanged, errors quoted exact. Pattern: [thing] [action] [reason]. [next step]. ${CAVEMAN_SHARED}\n\n---\n\n`,
            short: `[Caveman full]\n\n---\n\n`,
        },
        ultra: {
            full:  `[Caveman ultra] Maximum compression. Strip conjunctions where cause-then-effect stays unambiguous. One word where one word is enough. State each fact once. No intro, no outro, no repetition. Never touch code symbols, function names, API names or error strings. ${CAVEMAN_SHARED}\n\n---\n\n`,
            short: `[Caveman ultra]\n\n---\n\n`,
        },
    };

    // Ponytail — laziest-solution-that-works mode. Code answers only; it says nothing
    // about prose, so it stacks with caveman rather than competing with it.
    // Synced from skills/ponytail/SKILL.md
    const PONYTAIL_LADDER =
        `Before writing code, stop at the first rung that holds: 1. does this need to exist at all ` +
        `(YAGNI), 2. does it already exist in this codebase, 3. does the standard library do it, ` +
        `4. does a native platform feature cover it, 5. does an installed dependency solve it, ` +
        `6. can it be one line, 7. only then the minimum code that works. `;
    const PONYTAIL_PROMPTS = {
        lite:  `[Ponytail lite] Build what I asked for, but name the lazier alternative in one line and let me pick. ${PONYTAIL_LADDER}Never add a dependency for what a few lines do.\n\n---\n\n`,
        full:  `[Ponytail full] You are a lazy senior developer — lazy means efficient, not careless. The best code is the code never written. ${PONYTAIL_LADDER}The ladder runs after you understand the problem, not instead of it. Bug fix = root cause in the shared function, not a guard per caller. No unrequested abstractions, no boilerplate for later. Deletion over addition, boring over clever, shortest working diff wins. Never lazy about: input validation at trust boundaries, error handling that prevents data loss, security, accessibility, anything explicitly asked for.\n\n---\n\n`,
        ultra: `[Ponytail ultra] YAGNI extremist. Deletion before addition. ${PONYTAIL_LADDER}Ship the one-liner and question the rest of the requirement in the same breath. Mark deliberate shortcuts with a ponytail: comment naming the ceiling. Non-trivial logic leaves ONE runnable check behind — no frameworks, no fixtures. Never lazy about understanding the problem, input validation, data-loss handling, or security.\n\n---\n\n`,
    };

    // First-prompt injection — fires once per chat tab, before anything else.
    // Paste the text you want prepended, per site. Keys must match the platform ids
    // above; a site with no entry never shows the toggle.
    // ponytail: a const beats a build step for a couple of short strings.
    const INJECTION_PROMPTS = {
        // claude:   `...`,
        // deepseek: `...`,
    };

    function getChatInput() {
        if (P === "claude")   return qs('div.ProseMirror') || qs('[contenteditable="true"][data-placeholder]');
        if (P === "deepseek") return qs('textarea#chat-input') || qs('textarea');
        if (P === "brave")    return qs('textarea') || qs('[contenteditable="true"]');
        return qs('textarea') || qs('div[contenteditable="true"]');
    }

    function getInputText(el) {
        return (el.tagName === 'TEXTAREA' ? el.value : (el.innerText || el.textContent || '')).trim();
    }

    function prependToInput(el, prefix) {
        el.focus();
        if (el.tagName === 'TEXTAREA') {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
            const cur = el.value;
            if (nativeSetter) nativeSetter.call(el, prefix + cur);
            else el.value = prefix + cur;
            el.selectionStart = el.selectionEnd = prefix.length;
            el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
        } else {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            const firstText = walker.nextNode();
            const sel = window.getSelection();
            if (!sel) return;
            const range = document.createRange();
            if (firstText) range.setStart(firstText, 0);
            else range.setStart(el, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            const ok = document.execCommand('insertText', false, prefix);
            if (!ok) {
                try {
                    const dt = new DataTransfer();
                    dt.setData('text/plain', prefix);
                    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
                } catch(_) {
                    el.textContent = prefix + (el.textContent || '');
                    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
                }
            }
        }
    }

    // Injection fires once per chat tab. sessionStorage, not GM_setValue: a reload of the
    // same chat must not re-inject, but a new tab is a new session and should.
    const INJECTED_KEY = 'lance_injected';
    function injectionDue() {
        if (!CFG.injection?.enabled) return false;
        if (!CFG.injection.sites?.[P]) return false;
        if (!INJECTION_PROMPTS[P]) return false;
        try { return sessionStorage.getItem(INJECTED_KEY) !== '1'; } catch(_) { return false; }
    }
    function markInjected() { try { sessionStorage.setItem(INJECTED_KEY, '1'); } catch(_) {} }

    let _lastPrefix = '';

    // Builds one prefix out of every active mode, in order: first-prompt injection,
    // then ponytail (code rules), then caveman (prose rules).
    function buildPrefix() {
        let out = '';
        if (injectionDue()) out += INJECTION_PROMPTS[P];
        if (CFG.ponytail?.enabled) out += PONYTAIL_PROMPTS[CFG.ponytail.level] || PONYTAIL_PROMPTS.full;
        if (CFG.caveman?.enabled) {
            const variant = CAVEMAN_PROMPTS[CFG.caveman.level] || CAVEMAN_PROMPTS.ultra;
            out += (P === 'claude' ? variant.short : variant.full);   // Claude knows the rules already
        }
        return out;
    }

    function applyPrefixesIfActive() {
        if (P === "brave") return false;   // Brave: keyboard + export only
        const el = getChatInput();
        if (!el) return false;
        const cur = getInputText(el);
        if (!cur) return false;
        if (/^\[(Caveman|Ponytail|Session context)/.test(cur)) return false;
        const prefix = buildPrefix();
        if (!prefix) return false;
        if (injectionDue()) markInjected();
        _lastPrefix = prefix;
        prependToInput(el, prefix);
        return true;
    }

    // BUG-01 / BUG-02 fix — inject caveman prefix, then click send only AFTER the
    // prefix has flushed into the input. ProseMirror (Claude) execCommand insert is
    // async vs React state, and DeepSeek re-renders the send button on input (stale
    // node), so we (a) wait via rAF until getInputText() shows the prefix, then
    // (b) RE-FIND the submit button at click time. Falls back after ~30 frames.
    function clickSendWithCaveman() {
        const injected = applyPrefixesIfActive();
        if (!injected) {
            const sb = findSubmit();
            if (sb && !sb.disabled) sb.click();
            return;
        }
        const el0 = getChatInput();
        const head = _lastPrefix.slice(0, 12);
        let tries = 0;
        const fire = () => {
            const el  = getChatInput() || el0;
            const cur = el ? getInputText(el) : '';
            if (cur.startsWith(head) || ++tries > 30) {
                const sb = findSubmit();          // re-find: React may have replaced node
                if (sb && !sb.disabled) sb.click();
            } else {
                requestAnimationFrame(fire);
            }
        };
        requestAnimationFrame(fire);
    }

    // ── Pills ─────────────────────────────────────────────────────────────────
    // Four independent buttons — export, caveman, ponytail, injection — sharing one
    // shell. Each carries its own mark, menu, saved position and visibility toggle.
    const PILL_ORDER = ['export', 'caveman', 'ponytail', 'injection'];
    const PILL_POS   = { export:['x','y'], caveman:['cx','cy'], ponytail:['px','py'], injection:['ix','iy'] };
    const pills = {};

    // Available = this site supports it at all. Visible = available and not hidden.
    function pillAvailable(key) {
        if (key === 'export')    return CFG.sites[P] !== false;
        if (P === 'brave')       return false;                  // prompt modes are chat-only
        if (key === 'injection') return !!INJECTION_PROMPTS[P];
        return true;
    }
    function pillVisible(key) { return pillAvailable(key) && (CFG.pills?.[key] ?? true); }

    function injArmed() { return !!(CFG.injection?.enabled && CFG.injection.sites?.[P]); }
    function injSpent() { try { return sessionStorage.getItem(INJECTED_KEY) === '1'; } catch(_) { return false; } }
    function anyModeArmed() { return !!CFG.caveman?.enabled || !!CFG.ponytail?.enabled || (injArmed() && !injSpent()); }

    const PILL_STATE = {
        export:    () => ({ mark:'',  label:'Export', armed:false }),
        caveman:   () => { const on=!!CFG.caveman?.enabled,  l=(CFG.caveman?.level ||'ultra').toUpperCase();
                           return { mark:on?l[0]:'C', label:on?l:'CAVE', armed:on }; },
        ponytail:  () => { const on=!!CFG.ponytail?.enabled, l=(CFG.ponytail?.level||'full').toUpperCase();
                           return { mark:on?l[0]:'P', label:on?l:'PONY', armed:on }; },
        injection: () => ({ mark:'I', label: injArmed() ? (injSpent()?'SPENT':'READY') : 'INJECT',
                            armed: injArmed() && !injSpent() }),
    };

    function refreshPills() {
        PILL_ORDER.forEach(key => {
            const p = pills[key];
            if (!p) return;
            p.box.style.display = pillVisible(key) ? '' : 'none';
            const s = PILL_STATE[key]();
            const mark = p.box.querySelector('.lance-pill-mark');
            const text = p.box.querySelector('.lance-pill-text');
            if (mark) mark.textContent = s.mark;
            if (text) text.textContent = s.label;
            p.box.style.background = s.armed ? 'rgba(255,255,255,0.92)' : 'rgba(24,24,27,0.9)';
            p.box.style.color      = s.armed ? '#111' : 'rgba(255,255,255,0.85)';
            p.box.style.boxShadow  = s.armed
                ? '0 4px 20px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.2)'
                : '0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.07)';
            p.sync?.();
        });
    }

    // Docked, every pill sits in one fixed row at top-right, square like the site's own
    // header buttons. Free, each returns to body at its own saved coordinates.
    function applyDock() {
        const boxes = PILL_ORDER.map(k => pills[k]?.box).filter(Boolean);
        if (!boxes.length) return;
        let dock = qs('#lance-dock');
        if (CFG.dockTopRight) {
            if (!dock) { dock = mkEl('div'); dock.id = 'lance-dock'; document.body.appendChild(dock); }
            boxes.forEach(b => {
                if (b.parentNode !== dock) dock.appendChild(b);
                b.style.left = ''; b.style.top = '';
            });
        } else {
            boxes.forEach((b, i) => {
                if (dock && b.parentNode === dock) document.body.appendChild(b);
                const [kx, ky] = PILL_POS[PILL_ORDER[i]];
                const x = GM_getValue(kx, window.innerWidth  - 160);
                const y = GM_getValue(ky, window.innerHeight - 100 + i * 46);
                b.style.left = Math.max(0, Math.min(x, window.innerWidth  - 120)) + 'px';
                b.style.top  = Math.max(0, Math.min(y, window.innerHeight -  60)) + 'px';
            });
            dock?.remove();
        }
    }

    // Enable row plus a level list. Caveman and ponytail differ only in config key and
    // copy, so they share this; the returned closure re-renders the menu from config.
    function modeMenu(cfgKey, title, levels) {
        return (menu, box) => {
            menu.appendChild(mkEl('div', { className:'ai-export-section-label', text:title }));
            const onBtn = mkEl('button', { className:'ai-export-menu-item' });
            onBtn.onclick = e => {
                e.stopPropagation();
                CFG[cfgKey] = { ...(CFG[cfgKey] || DEFAULTS[cfgKey]), enabled: !CFG[cfgKey]?.enabled };
                saveCfg(CFG); refreshPills();
            };
            menu.appendChild(onBtn);
            menu.appendChild(mkEl('div', { className:'ai-export-menu-divider' }));
            menu.appendChild(mkEl('div', { className:'ai-export-section-label', text:'Level' }));
            const btns = levels.map(([val, name, desc]) => {
                const b = mkEl('button', { className:'ai-export-menu-item' });
                b._val = val; b._name = name; b._desc = desc;
                b.onclick = e => {
                    e.stopPropagation();
                    CFG[cfgKey] = { ...(CFG[cfgKey] || DEFAULTS[cfgKey]), level: val };
                    saveCfg(CFG); refreshPills(); box.classList.remove('open');
                };
                menu.appendChild(b);
                return b;
            });
            return () => {
                const on = !!CFG[cfgKey]?.enabled, lvl = CFG[cfgKey]?.level || DEFAULTS[cfgKey].level;
                onBtn.innerHTML = `<span style="flex:1">${on?'Enabled':'Disabled'}</span><span class="ai-export-badge">${on?'ON':'OFF'}</span>`;
                btns.forEach(b => {
                    const active = b._val === lvl;
                    b.innerHTML = `<span style="flex:1">${b._name}<span style="display:block;font-size:10px;opacity:0.45;font-weight:400">${b._desc}</span></span><span class="ai-export-badge">${active?'●':''}</span>`;
                    b.style.color = active ? '#fff' : '';
                });
            };
        };
    }

    function injectionMenu(menu) {
        menu.appendChild(mkEl('div', { className:'ai-export-section-label', text:'First-prompt injection' }));
        const armBtn = mkEl('button', { className:'ai-export-menu-item' });
        armBtn.onclick = e => {
            e.stopPropagation();
            const on = !injArmed();
            CFG.injection = { ...(CFG.injection || DEFAULTS.injection), enabled:on, sites:{ ...(CFG.injection?.sites || {}), [P]:on } };
            saveCfg(CFG); refreshPills();
        };
        menu.appendChild(armBtn);
        const rearm = mkEl('button', { className:'ai-export-menu-item' });
        rearm.innerHTML = `<span style="flex:1">Re-arm for this tab</span>`;
        rearm.onclick = e => { e.stopPropagation(); try { sessionStorage.removeItem(INJECTED_KEY); } catch(_) {} refreshPills(); };
        menu.appendChild(rearm);
        return () => {
            armBtn.innerHTML = `<span style="flex:1">${injArmed()?'Armed':'Disabled'}</span><span class="ai-export-badge">${injArmed()?(injSpent()?'SPENT':'READY'):'OFF'}</span>`;
        };
    }

    function exportMenu(menu, box) {
        const label = t => menu.appendChild(mkEl('div', { className:'ai-export-section-label', text:t }));
        const btn = (name, badge, fn) => {
            const b = mkEl('button', { className:'ai-export-menu-item' });
            b.innerHTML = `<span>${name}</span><span class="ai-export-badge">${badge}</span>`;
            b.onclick = e => { e.stopPropagation(); b.classList.add('clicked'); setTimeout(() => { b.classList.remove('clicked'); box.classList.remove('open'); fn(); }, 160); };
            menu.appendChild(b);
        };
        label('Download');
        btn('Markdown','.MD',()=>fileExport('md'));
        btn('JSON','.JSON',()=>fileExport('json'));
        btn('CSV','.CSV',()=>fileExport('csv'));
        btn('Plain text','.TXT',()=>fileExport('txt'));
        btn('HTML','.HTML',()=>fileExport('html'));
        menu.appendChild(mkEl('div', { className:'ai-export-menu-divider' }));
        btn('Settings','',()=>openDashboard());
        return null;
    }

    const PILL_MENUS = {
        export:    exportMenu,
        caveman:   modeMenu('caveman','Caveman (prose)',[['lite','Lite','Tight prose, no filler'],['full','Full','Terse, fragments OK'],['ultra','Ultra','Max compression']]),
        ponytail:  modeMenu('ponytail','Ponytail (code)',[['lite','Lite','Simplest thing that works'],['full','Full','Lazy senior dev'],['ultra','Ultra','YAGNI extremist']]),
        injection: injectionMenu,
    };

    function makePill(key) {
        const box = mkEl('div', { className:'ai-export-drag-box' });
        box.id = `lance-pill-${key}`;
        const s = PILL_STATE[key]();
        const mark = key === 'export'
            ? LANCE_ICON
            : `<span class="lance-pill-icon lance-pill-mark" style="font-size:13px;font-weight:700">${s.mark}</span>`;
        box.innerHTML = `<div class="lance-pill-inner">${mark}<span class="lance-pill-text" style="font-size:13px;font-weight:700;letter-spacing:0.05em">${s.label}</span></div>`;

        const menu = mkEl('div', { className:'ai-export-menu-panel' });
        const sync = PILL_MENUS[key](menu, box);
        box.appendChild(menu);
        document.body.appendChild(box);
        pills[key] = { box, menu, sync };

        let drag=false, moved=false, x0, y0, l0, t0;
        box.onmousedown = e => {
            if (CFG.dockTopRight) return;
            drag=true; moved=false; x0=e.clientX; y0=e.clientY; l0=box.offsetLeft; t0=box.offsetTop; e.preventDefault();
        };
        document.addEventListener('mousemove', e => {
            if (!drag) return;
            const dx=e.clientX-x0, dy=e.clientY-y0;
            if (Math.abs(dx)>3 || Math.abs(dy)>3) moved=true;
            box.style.left=(l0+dx)+'px'; box.style.top=(t0+dy)+'px';
        });
        document.addEventListener('mouseup', () => {
            if (drag && moved) { const [kx,ky]=PILL_POS[key]; GM_setValue(kx, box.offsetLeft); GM_setValue(ky, box.offsetTop); }
            drag=false;
        });
        box.onclick = () => {
            if (moved) return;
            if (box.classList.contains('open')) { box.classList.remove('open'); return; }
            Object.values(pills).forEach(p => p.box.classList.remove('open'));   // one menu at a time
            const r=box.getBoundingClientRect(), isB=r.top>window.innerHeight/2, isR=r.left>window.innerWidth/2;
            menu.className='ai-export-menu-panel';
            menu.classList.add(isB ? (isR?'pos-bottom-right':'pos-bottom-left') : (isR?'pos-top-right':'pos-top-left'));
            sync?.();
            box.classList.add('open');
        };
        document.addEventListener('click', e => { if (!box.contains(e.target)) box.classList.remove('open'); });
        return box;
    }

    // Mouse-click send intercept — capture phase, preventDefault, re-fire after inject.
    let sendInterceptOn = false;
    function installSendIntercept() {
        if (sendInterceptOn || P === 'brave') return;
        sendInterceptOn = true;
        document.addEventListener('click', e => {
            if (!anyModeArmed()) return;
            const sb = findSubmit();
            if (!sb || !(e.target===sb || sb.contains(e.target))) return;
            const el = getChatInput();
            if (!el) return;
            const cur = getInputText(el);
            if (!cur || /^\[(Caveman|Ponytail|Session context)/.test(cur)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            clickSendWithCaveman();   // waits for flush + re-finds button (BUG-01)
        }, true);
    }

    function initPills() {
        PILL_ORDER.forEach(key => {
            if (!pillAvailable(key)) { pills[key]?.box.remove(); delete pills[key]; return; }
            if (pills[key] && document.body.contains(pills[key].box)) return;
            makePill(key);
        });
        applyDock();
        refreshPills();
        installSendIntercept();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  DEEPSEEK SCRAPER
    //  ds-virtual-list renders ~4 items at a time (172176px total / ~1400px each
    //  ≈ 121 messages). Unmounts items scrolled past. Must collect-while-scrolling.
    //  settle() observes document.body (not vl) — virtual list mutations happen
    //  on ds-virtual-list-items which may not be a direct child of vl.
    //  STEP sized to show 1 new virtual item per step (~1400px item height).
    //  stall limit high enough for 172k/1400px = ~123 steps needed.
    // ═══════════════════════════════════════════════════════════════════════════
    async function getDeepSeekContents() {
        const vl = qs('div.ds-virtual-list') ||
            (() => { let b=null,bH=0; qsa('div').forEach(el=>{if(el.scrollHeight>el.clientHeight+100&&el.scrollHeight>bH){bH=el.scrollHeight;b=el;}}); return b; })();
        if (!vl) { console.warn('[lance] DeepSeek: container not found'); return []; }
        console.log('[lance] DeepSeek: container scrollH=' + vl.scrollHeight + ', clientH=' + vl.clientHeight);

        // Observe document.body for virtual list re-renders (ds-virtual-list-items
        // is nested — body-level observation catches all mutations reliably)
        function settle(ms) {
            return new Promise(resolve => {
                const cap = ms || 500;
                let t = setTimeout(resolve, cap);
                const obs = new MutationObserver(() => {
                    clearTimeout(t);
                    t = setTimeout(() => { obs.disconnect(); resolve(); }, 150);
                });
                obs.observe(document.body, { childList: true, subtree: true });
                setTimeout(() => { obs.disconnect(); resolve(); }, cap);
            });
        }

        const seen = new WeakSet();
        const aMsgs = [], uMsgs = [];
        const seenUser = new Set();
        const BTN_SEL = 'div.ds-flex > div.ds-icon-button:nth-child(1)';
        const USR_SEL = 'div[class*="fbb737a4"]';

        async function collectVisible() {
            qsa(USR_SEL).forEach(el => {
                const t = el.textContent.trim();
                if (t && !seenUser.has(t)) { seenUser.add(t); uMsgs.push(t); }
            });
            for (const btn of qsa(BTN_SEL)) {
                if (seen.has(btn)) continue;
                seen.add(btn);
                btn.click();
                await new Promise(r => setTimeout(r, 350));
                try { const t = await navigator.clipboard.readText(); if (t) aMsgs.push(t); } catch(_) {}
            }
        }

        // Scroll to top, wait for top items to render
        vl.scrollTop = 0;
        await settle(700);
        await collectVisible();
        console.log('[lance] DeepSeek step 0: u=' + uMsgs.length + ' a=' + aMsgs.length);

        // Each virtual item ~1400px tall. Step = 1200px to ensure overlap (no gaps).
        // atBottom uses 200px tolerance — the _871cbca sentinel div at bottom
        // prevents scrollTop from ever reaching scrollHeight-clientHeight exactly.
        const STEP = 1200;
        let prev = -1, stalls = 0, step = 0;

        while (true) {
            const maxScroll = vl.scrollHeight - vl.clientHeight;
            const atBottom  = vl.scrollTop >= maxScroll - 200;
            if (atBottom) break;

            vl.scrollTop += STEP;
            step++;
            await settle(step < 5 ? 600 : 500);
            await collectVisible();

            const total = uMsgs.length + aMsgs.length;
            console.log('[lance] DeepSeek step ' + step + ' scrollTop=' + Math.round(vl.scrollTop)
                + '/' + vl.scrollHeight + ' u=' + uMsgs.length + ' a=' + aMsgs.length);

            if (total === prev) {
                stalls++;
                // If stalled but not at bottom yet, jump forward aggressively
                if (stalls >= 15) {
                    const remaining = maxScroll - vl.scrollTop;
                    if (remaining > 500) {
                        console.log('[lance] DeepSeek: stall — jumping +' + Math.round(remaining/2) + 'px');
                        vl.scrollTop += remaining / 2;
                        stalls = 0;
                        await settle(800);
                        await collectVisible();
                    } else {
                        console.warn('[lance] DeepSeek: stall limit near bottom');
                        break;
                    }
                }
            } else {
                stalls = 0; prev = total;
            }
        }

        // Final collect at bottom
        vl.scrollTop = vl.scrollHeight;
        await settle(600);
        await collectVisible();
        console.log('[lance] DeepSeek: final u=' + uMsgs.length + ' a=' + aMsgs.length);

        const result = [];
        const pairs = Math.min(uMsgs.length, aMsgs.length);
        for (let i = 0; i < pairs; i++) {
            result.push({ role: 'user',      text: uMsgs[i] });
            result.push({ role: 'assistant', text: aMsgs[i] });
        }
        for (let i = pairs; i < aMsgs.length; i++) result.push({ role: 'assistant', text: aMsgs[i] });
        console.log('[lance] DeepSeek: done — ' + result.length + ' messages (' + pairs + ' pairs)');
        return result;
    }

    // ─── DeepSeek pair grouping ──────────────────────────────────────────────────
    // DeepSeek can emit multiple assistant turns per user turn (thinking + answer).
    // Group by user: each user message + ALL following assistant messages = one pair.
    // Returns [{q, a}] where a = all assistant texts joined with \n\n
    function groupDeepSeekPairs(items) {
        const pairs = [];
        let currentQ = null, currentA = [];
        for (const item of items) {
            if (item.role === 'user') {
                if (currentQ !== null) pairs.push({ q: currentQ, a: currentA.join('\n\n') });
                currentQ = item.text; currentA = [];
            } else if (item.role === 'assistant') {
                if (currentQ === null) currentQ = ''; // assistant-first edge case
                currentA.push(item.text);
            }
        }
        if (currentQ !== null && currentA.length) pairs.push({ q: currentQ, a: currentA.join('\n\n') });
        return pairs;
    }

    // ─── Filename ────────────────────────────────────────────────────────────────
    function makeFilename(title, turnCount) {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}${String(turnCount).padStart(4,'0')}_${title}`;
    }
    function sanitize(t) { return (t||document.title||"Export").trim().replace(/[\/\\\?\%\*\:\|"<>\.]/g,"_"); }
    function getTitle() {
        if (P==="deepseek") {
            const byZ=qsa('[style*="z-index"],div').find(el=>getComputedStyle(el).zIndex==="12");
            return sanitize(byZ?.textContent||qs('div[class*="chat-item--active"] span,li[class*="active"] .title,a[class*="active"] span')?.textContent);
        }
        if (P==="brave")   return sanitize(document.title.replace(/ - Ask Brave$/,'').trim().slice(0,50));
        return sanitize(document.title);
    }

    // ─── HTML → Markdown ─────────────────────────────────────────────────────────
    function toMd(html) {
        const doc=new DOMParser().parseFromString(html,"text/html");
        const isClaude=P==="claude",isDS=P==="deepseek";
        qsa("span.katex-html",doc).forEach(e=>e.remove());
        qsa("mrow",doc).forEach(e=>e.remove());
        qsa('annotation[encoding="application/x-tex"]',doc).forEach(e=>e.replaceWith(e.closest(".katex-display")?`\n$$\n${e.textContent.trim()}\n$$\n`:`$${e.textContent.trim()}$`));
        const rp=(el,txt)=>el.parentNode.replaceChild(document.createTextNode(txt),el);
        qsa("strong,b",doc).forEach(e=>rp(e,`**${e.textContent}**`));
        qsa("em,i",doc).forEach(e=>rp(e,`*${e.textContent}*`));
        qsa("p code",doc).forEach(e=>rp(e,`\`${e.textContent}\``));
        qsa("a",doc).forEach(e=>rp(e,`[${e.textContent}](${e.href})`));
        qsa("img",doc).forEach(e=>rp(e,`![${e.alt}](${e.src})`));
        if(isClaude){qsa("pre",doc).forEach(pre=>{const code=qs("code",pre);const type=code?Array.from(code.classList).find(c=>c.startsWith("language-"))?.replace("language-","")||"":"";pre.innerHTML=`\n\`\`\`${type}\n${code?code.textContent:pre.textContent}\n\`\`\`\n`;});}
        else if(isDS){qsa("pre",doc).forEach(pre=>{const code=qs("code",pre);let type=code?Array.from(code.classList).find(c=>c.startsWith("language-"))?.replace("language-","")||"":"";if(!type)type=qs('span.code-lang,span[class*="lang"],div[class*="code-header"] span',pre.closest("div"))?.textContent.trim()||"";pre.innerHTML=`\n\`\`\`${type}\n${code?code.textContent:pre.textContent}\n\`\`\`\n`;});qsa('div[class*="think"],details.think,div.ds-think',doc).forEach(e=>rp(e,`\n> **[Thinking]**\n${e.textContent.trim().split("\n").map(l=>`> ${l}`).join("\n")}\n`));}
        qsa("ul",doc).forEach(ul=>rp(ul,"\n"+qsa(":scope>li",ul).map(li=>`- ${li.textContent.trim()}`).join("\n")));
        qsa("ol",doc).forEach(ol=>rp(ol,"\n"+qsa(":scope>li",ol).map((li,i)=>`${i+1}. ${li.textContent.trim()}`).join("\n")));
        for(let i=1;i<=6;i++) qsa(`h${i}`,doc).forEach(h=>rp(h,`\n${"#".repeat(i)} ${h.textContent}\n`));
        qsa("p",doc).forEach(p=>rp(p,`\n${p.textContent}\n`));
        return doc.body.innerHTML.replace(/<[^>]*>/g,"").replace(/&amp;/g,"&").trim();
    }

    // ─── Attachments ─────────────────────────────────────────────────────────────
    function extractAttachments(msgEl){const seen=new Set(),out=[];qsa("img[src]",msgEl).forEach(img=>{const src=img.src||"";if(src&&!seen.has(src)&&!src.includes("avatar")&&!src.includes("icon")&&src!==window.location.href){seen.add(src);out.push({name:img.alt||"image",type:"image",src});}});qsa('[data-testid*="file-thumbnail"],[class*="FileAttachment"],[class*="file-name"],[class*="attachment-name"]',msgEl).forEach(el=>{const name=(el.querySelector('[class*="name"],span,p')||el).textContent.trim();if(name&&name.length<200&&!seen.has(name)){seen.add(name);out.push({name,type:"file",src:null});}});return out;}
    function renderAttachmentsMd(a){if(!a.length)return "";return "\n**Attachments:**\n"+a.map(x=>x.type==="image"?`![${x.name}](${x.src})`:`- \`${x.name}\``).join("\n")+"\n";}

    // ─── getElements ─────────────────────────────────────────────────────────────
    function getElements(){
        const res=[];
        if(P==="claude")res.push(...qsa('[data-testid="user-message"],.font-claude-response'));
        else if(P==="brave"){
            // Brave /ask: messages in document order — div.message.user then 1-3
            // div.message.assistant.llm-output (selector skips div.message.augment = web results,
            // and div.message.response-header). Boundary = the user div (NOT response-header,
            // which was unconfirmed). Group user + its following assistants into ONE synthetic
            // wrapper so the downstream i%2 Q/A pairing holds (see groupDeepSeekPairs rationale).
            const nodes=qsa('div.message.user,div.message.assistant.llm-output');
            let u=null,ais=[];
            const flush=()=>{if(!u)return;res.push(u);const w=document.createElement('div');ais.forEach(a=>w.appendChild(a.cloneNode(true)));res.push(w);u=null;ais=[];};
            nodes.forEach(n=>{if(n.classList.contains('user')){flush();u=n;}else if(u)ais.push(n);});
            flush();
        }
        return res;
    }

    // ─── File export ─────────────────────────────────────────────────────────────
    async function fileExport(fmt){
        let c="",m="text/plain",title,fname;
        if(P==="deepseek"){
            const items=await getDeepSeekContents();if(!items.length)return;
            title=getTitle();const pl=groupDeepSeekPairs(items);
            fname=makeFilename(title,pl.length);
            if(fmt==="json"){c=JSON.stringify(pl,null,2);m="application/json";}
            else if(fmt==="csv"){c="Q,A\n"+pl.map(p=>`"${p.q.replace(/"/g,'""')}","${p.a.replace(/"/g,'""')}"`).join("\n");m="text/csv";}
            else if(fmt==="html"){c=`<html><body style="font-family:sans-serif;max-width:800px;margin:auto;padding:30px;line-height:1.7;">${pl.map(p=>`<div style="background:#f4f4f5;padding:15px;border-radius:12px;margin:20px 0;"><b>Q:</b> ${p.q}</div><div><b>A:</b> ${p.a}</div><hr/>`).join("")}</body></html>`;m="text/html";}
            else if(fmt==="md"){c=mdDoc(title,pl);m="text/markdown";}
            else{c=pl.map(p=>`\nQ:\n${p.q}\n\nA:\n${p.a}\n\n---\n`).join("");}
        } else {
            const res=getElements();if(!res.length)return;
            title=getTitle();fname=makeFilename(title,Math.floor(res.length/2));
            const md=el=>toMd(el.innerHTML),txt=el=>el.textContent.trim();
            if(fmt==="json"){c=JSON.stringify(res.reduce((a,x,i)=>{if(i%2===0&&res[i+1])a.push({q:md(x),a:md(res[i+1])});return a;},[]),null,2);m="application/json";}
            else if(fmt==="csv"){c="Q,A\n"+res.reduce((a,x,i)=>{if(i%2===0&&res[i+1])a+=`"${md(x).replace(/"/g,'""')}","${md(res[i+1]).replace(/"/g,'""')}"\n`;return a;},"");m="text/csv";}
            else if(fmt==="html"){c=`<html><body style="font-family:sans-serif;max-width:800px;margin:auto;padding:30px;line-height:1.7;">${res.reduce((a,x,i)=>{if(i%2===0&&res[i+1])a+=`<div style="background:#f4f4f5;padding:15px;border-radius:12px;margin:20px 0;"><b>Q:</b> ${x.innerHTML}</div><div><b>A:</b> ${res[i+1].innerHTML}</div><hr/>`;return a;},"")}</body></html>`;m="text/html";}
            else if(fmt==="md"){
                const pairs=[];
                for(let i=0;i<res.length-1;i+=2){
                    if(!res[i+1])break;
                    const att=extractAttachments(res[i]);
                    pairs.push({q:md(res[i])+(att.length?renderAttachmentsMd(att):''),a:md(res[i+1])});
                }
                c=mdDoc(title,pairs);m="text/markdown";
            }
            else{c=res.reduce((a,x,i)=>{if(i%2===0&&res[i+1])a+=`\nQ:\n${txt(x)}\n\nA:\n${txt(res[i+1])}\n\n---\n`;return a;},"");}
        }
        anchorSave(c.replace(/&amp;/g,"&"),m,`${fname}.${fmt}`);
    }

    // Plain download — lands flat in the browser's download folder.
    function anchorSave(text,mime,filename){
        const u=URL.createObjectURL(new Blob([text],{type:mime}));
        const a=Object.assign(document.createElement("a"),{href:u,download:filename});
        document.body.appendChild(a);a.click();
        setTimeout(()=>{document.body.removeChild(a);URL.revokeObjectURL(u);},0);
    }

    // Markdown export: frontmatter + one ## User / ## Assistant block per turn.
    // Drops straight into a note-taking vault; where the file goes is the browser's
    // business, and the browser already remembers the last folder you chose.
    function mdDoc(title,pairs){
        const yaml=["---",
            `title: "${title}"`,
            `date: "${new Date().toISOString()}"`,
            `source: ${P}`,
            `url: "${document.URL}"`,
            `turns: ${pairs.length}`,
            "---","",""].join("\n");
        return yaml+pairs.map(p=>`## User\n\n${p.q.trim()}\n\n## Assistant\n\n${p.a.trim()}\n\n---\n\n`).join("");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  ENTER-AS-NEWLINE
    // ═══════════════════════════════════════════════════════════════════════════
    function getEventTarget(e){return e.composedPath?e.composedPath()[0]||e.target:e.target;}
    function isComposing(e){return e.isComposing||e.keyCode===229;}
    function isEditableTarget(t){return /INPUT|TEXTAREA|SELECT/.test(t.tagName)||(t.getAttribute&&t.getAttribute("contenteditable")==="true");}
    function isSendShortcut(e){if(e.key!=="Enter")return false;const sc=CFG.shortcuts;return(sc.ctrl&&e.ctrlKey&&!e.altKey&&!e.metaKey)||(sc.alt&&e.altKey&&!e.ctrlKey&&!e.metaKey)||(sc.meta&&e.metaKey&&!e.ctrlKey&&!e.altKey);}
    function isPotentialSend(e){if(e.key!=="Enter")return false;return(e.ctrlKey&&!e.altKey&&!e.metaKey&&!e.shiftKey)||(e.altKey&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey)||(e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.shiftKey);}
    function findSubmit(){
        if(P==="deepseek"){const bc=qs(".bf38813a");if(!bc)return null;const btns=qsa('div[role="button"].ds-button',bc);for(let i=btns.length-1;i>=0;i--){const b=btns[i];if(!b.classList.contains('ds-button--disabled'))return b;}return null;}
        if(P==="claude") return qs('button[aria-label*="Send"]');
        if(P==="brave"){const scope=qs('form')||document;return qs('button[type="submit"]:not([disabled])',scope)||qs('button[aria-label*="Ask" i]',scope)||qs('button[aria-label*="Send" i]',scope)||qs('button[type="submit"]',scope);}
        return null;
    }
    window.addEventListener("keydown",e=>{
        if(isComposing(e))return;const t=getEventTarget(e);
        if(e.key==="Enter"&&!e.ctrlKey&&!e.shiftKey&&!e.metaKey&&!e.altKey&&isEditableTarget(t)){
            e.preventDefault();e.stopPropagation();
            if(t.tagName==="TEXTAREA"){const s=t.selectionStart,v=t.value;t.value=v.substring(0,s)+"\n"+v.substring(t.selectionEnd);t.selectionStart=t.selectionEnd=s+1;t.dispatchEvent(new Event("input",{bubbles:true}));}
            else{const ev=new KeyboardEvent("keydown",{key:"Enter",code:"Enter",shiftKey:true,bubbles:true,cancelable:true});t.dispatchEvent(ev);if(!ev.defaultPrevented)document.execCommand("insertParagraph");}
            return;
        }
        if(isSendShortcut(e)&&isEditableTarget(t)){const sb=findSubmit();if(sb&&!sb.disabled){e.preventDefault();e.stopPropagation();clickSendWithCaveman();}return;}
        if(isPotentialSend(e)&&isEditableTarget(t)){e.stopPropagation();}
    },true);
    window.addEventListener("keypress",e=>{
        if(isComposing(e))return;
        if(e.key==="Enter"&&!e.ctrlKey&&!e.shiftKey&&!e.metaKey&&!e.altKey){const t=getEventTarget(e);if(isEditableTarget(t))e.stopPropagation();}
        if(isPotentialSend(e)){const t=getEventTarget(e);if(isEditableTarget(t))e.stopPropagation();}
    },true);

    // ═══════════════════════════════════════════════════════════════════════════
    //  CLAUDE USAGE TRACKER  (ported from Claude Inline Usage Tracker v2.7)
    //  Only active on claude.ai. Toggle via CFG.usageTracker.
    //  Original: https://greasyfork.org/scripts/567949
    // ═══════════════════════════════════════════════════════════════════════════
    const UT = (() => {
        if (P !== 'claude') return { init(){} };

        const ID='lance-cut',SID='lance-cut-style',API='/api/organizations';
        const POLL=60_000,HOVER_REFRESH=30_000,MIN_GAP=15_000,WARN=60,DANGER=80;
        const A='lance-cut-anchor',H='lance-cut-hover';
        const ROWS=[['five_hour','Current Session'],['seven_day','Weekly Limit (All)'],['seven_day_opus','Weekly Limit (Opus)']];
        const S={org:null,inflight:null,last:null,lastAt:0,anchor:null,ui:null,poll:0,sched:0,mo:null};
        const clamp=v=>(v=+v||0)<0?0:v>100?100:v;
        const fmt=iso=>{if(!iso)return'N/A';const m=Math.round((new Date(iso).getTime()-Date.now())/60000);if(m<1)return'Resetting soon';if(m<60)return`In ${m} min`;const h=(m/60)|0;return h<24?`In ${h} hr`:`In ${(h/24)|0} days`;};
        const jget=u=>fetch(u,{credentials:'include'}).then(r=>{if(!r.ok)throw new Error(r.status);return r.json();});

        async function orgId(){if(S.org)return S.org;const orgs=await jget(API);return(S.org=orgs?.[0]?.uuid??null);}
        function getUsage(force){
            const now=Date.now();
            if(!force&&now-S.lastAt<MIN_GAP)return Promise.resolve(S.last);
            if(S.inflight)return S.inflight;
            return(S.inflight=(async()=>{try{const id=await orgId();if(!id)return S.last;const d=await jget(`${API}/${id}/usage`);if(d){S.last=d;S.lastAt=Date.now();}return S.last;}catch(e){S.org=null;return S.last;}finally{S.inflight=null;}})());
        }

        function injectStyle(){
            if(document.getElementById(SID))return;
            const s=document.createElement('style');s.id=SID;
            s.textContent=`
#${ID}{position:absolute;inset:auto 16px -15px;z-index:30;font-family:var(--font-ui,system-ui,-apple-system,sans-serif);color:hsl(var(--text-100))}
#${ID} .t{height:12px;display:flex;align-items:center;cursor:pointer}
#${ID} .b{width:100%;height:3px;background:hsla(var(--border-300)/.12);border-radius:999px;overflow:hidden;transition:height .16s}
#${ID} .t:hover .b{height:4px}
#${ID} .f{height:100%;width:0%;background:hsl(var(--brand-000));transition:width .25s}
#${ID} .fw{background:hsl(var(--warning-100))}
#${ID} .fd{background:hsl(var(--danger-100))}
#${ID} .p{position:absolute;bottom:14px;left:0;right:0;background:hsl(var(--bg-000));border-radius:16px;display:flex;flex-direction:column;gap:10px;padding:12px 14px 10px;box-shadow:0 .25rem 1.25rem hsl(var(--always-black)/3.5%),0 0 0 .5px hsla(var(--border-300)/.15);opacity:0;visibility:hidden;pointer-events:none;transform:translateY(8px);transition:opacity .16s,transform .16s,visibility 0s linear .16s}
#${ID} .t:hover + .p{opacity:1;visibility:visible;transform:translateY(0);transition:opacity .16s,transform .16s}
#${ID} .hh{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:6px;font-size:13px}
#${ID} .l{font-weight:550;color:hsl(var(--text-100))}
#${ID} .m{font-size:12px;font-weight:430;color:hsl(var(--text-500));white-space:nowrap}
#${ID} .k{width:100%;height:6px;background:hsla(var(--border-300)/.12);border-radius:999px;overflow:hidden}
.${A}{transition:background-color .2s,box-shadow .2s,border-color .2s}
.${A}.${H}{background-color:transparent!important;box-shadow:none!important;border-color:transparent!important}
.${A}>:not(#${ID}){transition:opacity .2s}
.${A}.${H}>:not(#${ID}){opacity:0!important;pointer-events:none!important}`;
            document.head.appendChild(s);
        }

        function clsFor(p){return p>DANGER?'f fd':p>WARN?'f fw':'f';}
        function setFill(el,p){const sp=''+p;if(el.dataset.p!==sp){el.dataset.p=sp;el.style.width=sp+'%';const c=clsFor(p);if(el.className!==c)el.className=c;}}

        function buildUI(){
            const root=document.createElement('div');root.id=ID;
            root.innerHTML=`<div class="t"><div class="b"><div class="f" data-role="tf"></div></div></div><div class="p">${ROWS.map(([,label],i)=>`<div class="r" data-i="${i}"><div class="hh"><span class="l">${label}</span><span class="m" data-role="m"></span></div><div class="k"><div class="f" data-role="f"></div></div></div>`).join('')}</div>`;
            const tf=root.querySelector('[data-role="tf"]');
            const rEls=[...root.querySelectorAll('.r')];
            const metas=rEls.map(r=>r.querySelector('[data-role="m"]'));
            const fills=rEls.map(r=>r.querySelector('[data-role="f"]'));
            root.addEventListener('pointerenter',()=>{S.anchor&&S.anchor.classList.add(H);if(Date.now()-S.lastAt>HOVER_REFRESH)doRefresh(1);},{passive:true});
            root.addEventListener('pointerleave',()=>{S.anchor&&S.anchor.classList.remove(H);},{passive:true});
            return{root,tf,rEls,metas,fills};
        }

        function render(d){
            if(!S.ui||!d)return;
            setFill(S.ui.tf,clamp(d?.five_hour?.utilization));
            for(let i=0;i<ROWS.length;i++){const key=ROWS[i][0];const b=d?.[key];const row=S.ui.rEls[i];if(!b){row.hidden=true;continue;}row.hidden=false;const p=clamp(b.utilization);setFill(S.ui.fills[i],p);const t=`${p}% · ${fmt(b.resets_at)}`;const m=S.ui.metas[i];if(m.dataset.t!==t){m.dataset.t=t;m.textContent=t;}}
        }

        async function doRefresh(force){if(!S.ui||(!force&&document.hidden))return;render(await getUsage(!!force));}

        function findAnchor(){
            const ed=document.querySelector('[contenteditable="true"].tiptap');if(!ed)return null;
            const fs=ed.closest('fieldset');if(!fs)return null;
            return fs.querySelector('div[class*="bg-bg-000"][class*="rounded-[20px]"]')||fs;
        }

        function attach(){
            if(!CFG.usageTracker){document.getElementById(ID)?.remove();return;}
            const a=findAnchor();if(!a)return;
            const existing=document.getElementById(ID);
            if(a===S.anchor&&existing&&a.contains(existing))return;
            existing?.remove();
            a.classList.add(A);
            if(getComputedStyle(a).position==='static')a.style.position='relative';
            S.anchor=a;S.ui=buildUI();
            a.insertBefore(S.ui.root,a.firstChild);
            doRefresh(1);
        }

        function schedAttach(){if(S.sched)return;const cb=()=>{S.sched=0;attach();};S.sched=window.requestIdleCallback?requestIdleCallback(cb,{timeout:800}):requestAnimationFrame(cb);}
        function startPoll(){stopPoll();const tick=()=>{if(document.hidden){S.poll=0;return;}doRefresh(0);S.poll=setTimeout(tick,POLL);};S.poll=setTimeout(tick,POLL);}
        function stopPoll(){S.poll&&clearTimeout(S.poll);S.poll=0;}

        return {
            init(){
                injectStyle();
                const patch=m=>{const o=history[m];history[m]=function(){const r=o.apply(this,arguments);schedAttach();return r;};};
                patch('pushState');patch('replaceState');
                addEventListener('popstate',schedAttach,{passive:true});
                addEventListener('hashchange',schedAttach,{passive:true});
                let t=0;
                S.mo=new MutationObserver(()=>{if(t)return;t=setTimeout(()=>{t=0;schedAttach();},200);});
                S.mo.observe(document.body,{childList:true,subtree:true});
                document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPoll();else{schedAttach();doRefresh(1);startPoll();}},{passive:true});
                addEventListener('focus',()=>!document.hidden&&doRefresh(1),{passive:true});
                schedAttach();startPoll();
            },
            refresh(){ schedAttach(); },
        };
    })();

    // ═══════════════════════════════════════════════════════════════════════════
    //  SETTINGS DASHBOARD
    // ═══════════════════════════════════════════════════════════════════════════
    function openDashboard(){
        const existing=qs('#lance-dashboard');
        if(existing){existing.remove();qs('#lance-overlay')?.remove();return;}

        const bg="#18181b",bg3="#27272c",fg="#e4e4e8",fg2="rgba(228,228,232,0.5)",bd="rgba(255,255,255,0.07)",wht="#ffffff";

        const ov=document.createElement('div');ov.id='lance-overlay';
        Object.assign(ov.style,{position:'fixed',inset:'0',background:'rgba(0,0,0,0.6)',zIndex:'2147483645',backdropFilter:'blur(2px)'});
        ov.onclick=()=>{ov.remove();dlg.remove();};
        document.body.appendChild(ov);

        const dlg=document.createElement('div');dlg.id='lance-dashboard';
        Object.assign(dlg.style,{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:bg,color:fg,border:`1px solid ${bd}`,borderRadius:'14px',padding:'20px 24px 24px',width:'360px',maxWidth:'94vw',maxHeight:'88vh',overflowY:'auto',zIndex:'2147483646',fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',fontSize:'13px',lineHeight:'1.5',boxShadow:'0 24px 64px rgba(0,0,0,0.6),0 0 0 1px rgba(255,255,255,0.05)',scrollbarWidth:'thin',scrollbarColor:`${bg3} transparent`});

        const rowEl=(label,control)=>{const d=document.createElement('div');Object.assign(d.style,{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:`1px solid ${bd}`});const la=document.createElement('span');la.textContent=label;la.style.color=fg;d.appendChild(la);if(control)d.appendChild(control);return d;};

        const toggle=(val,onChange)=>{
            const lbl=document.createElement('label');Object.assign(lbl.style,{position:'relative',display:'inline-block',width:'34px',height:'18px',flexShrink:'0'});
            const inp=document.createElement('input');inp.type='checkbox';inp.checked=val;Object.assign(inp.style,{opacity:'0',width:'0',height:'0',position:'absolute'});
            const sl=document.createElement('span');Object.assign(sl.style,{position:'absolute',inset:'0',borderRadius:'18px',cursor:'pointer',background:val?wht:'rgba(255,255,255,0.12)',transition:'background 0.18s',border:'1px solid rgba(255,255,255,0.1)'});
            const dot=document.createElement('span');Object.assign(dot.style,{position:'absolute',height:'12px',width:'12px',left:val?'18px':'3px',bottom:'2px',background:val?'#111':'rgba(255,255,255,0.4)',borderRadius:'50%',transition:'left 0.18s,background 0.18s'});
            sl.appendChild(dot);
            inp.onchange=()=>{const v=inp.checked;sl.style.background=v?wht:'rgba(255,255,255,0.12)';dot.style.left=v?'18px':'3px';dot.style.background=v?'#111':'rgba(255,255,255,0.4)';onChange(v);};
            lbl.appendChild(inp);lbl.appendChild(sl);return lbl;
        };

        const section=t=>{const d=document.createElement('div');Object.assign(d.style,{fontSize:'10px',fontWeight:'700',letterSpacing:'0.1em',textTransform:'uppercase',color:fg2,padding:'18px 0 6px'});d.textContent=t;return d;};

        const levelSel=(val,onChange)=>{
            const sel=document.createElement('select');
            Object.assign(sel.style,{background:bg3,border:'1px solid rgba(255,255,255,0.1)',borderRadius:'6px',color:fg,padding:'4px 8px',fontSize:'12px',outline:'none'});
            ['lite','full','ultra'].forEach(l=>{const o=document.createElement('option');o.value=l;o.textContent=l.charAt(0).toUpperCase()+l.slice(1);if(val===l)o.selected=true;sel.appendChild(o);});
            sel.onchange=()=>onChange(sel.value);
            return sel;
        };

        // Header
        const hdr=document.createElement('div');Object.assign(hdr.style,{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'2px'});
        const htitle=document.createElement('div');Object.assign(htitle.style,{display:'flex',alignItems:'baseline',gap:'8px'});
        const hname=document.createElement('span');hname.textContent='lance';Object.assign(hname.style,{fontSize:'17px',fontWeight:'700',color:wht});
        const hver=document.createElement('span');hver.textContent='v'+(typeof GM_info!=='undefined'?GM_info.script.version:'?');Object.assign(hver.style,{fontSize:'10px',color:fg2});
        htitle.appendChild(hname);htitle.appendChild(hver);
        const closeBtn=document.createElement('button');closeBtn.textContent='✕';Object.assign(closeBtn.style,{background:'none',border:'none',color:fg2,cursor:'pointer',fontSize:'16px',padding:'0',lineHeight:'1',transition:'color 0.1s'});
        closeBtn.addEventListener('mouseenter',()=>{closeBtn.style.color=wht;});closeBtn.addEventListener('mouseleave',()=>{closeBtn.style.color=fg2;});
        closeBtn.onclick=()=>{dlg.remove();ov.remove();};
        hdr.appendChild(htitle);hdr.appendChild(closeBtn);dlg.appendChild(hdr);
        const sub=document.createElement('div');sub.textContent='All changes save instantly.';Object.assign(sub.style,{fontSize:'11px',color:fg2,marginBottom:'4px'});dlg.appendChild(sub);

        // ── Sites — collapsible dropdown ──
        dlg.appendChild(section('Export button — sites'));
        const SITE_LABELS={claude:'Claude',deepseek:'DeepSeek',brave:'Brave'};

        // Dropdown toggle button
        const sitesDropBtn=document.createElement('button');
        Object.assign(sitesDropBtn.style,{display:'flex',justifyContent:'space-between',alignItems:'center',width:'100%',padding:'9px 0',background:'none',border:'none',borderBottom:`1px solid ${bd}`,color:fg,fontSize:'13px',cursor:'pointer',outline:'none'});
        const sitesDropLabel=document.createElement('span');
        const countOn=()=>Object.values(CFG.sites).filter(Boolean).length;
        sitesDropLabel.textContent=`${countOn()} / ${Object.keys(SITE_LABELS).length} sites enabled`;
        const sitesArrow=document.createElement('span');sitesArrow.textContent='▾';Object.assign(sitesArrow.style,{fontSize:'11px',color:fg2,transition:'transform 0.15s'});
        sitesDropBtn.appendChild(sitesDropLabel);sitesDropBtn.appendChild(sitesArrow);
        dlg.appendChild(sitesDropBtn);

        // Collapsible sites list
        const sitesPanel=document.createElement('div');
        Object.assign(sitesPanel.style,{overflow:'hidden',maxHeight:'0',transition:'max-height 0.2s ease'});
        let sitesOpen=false;
        sitesDropBtn.onclick=()=>{
            sitesOpen=!sitesOpen;
            sitesPanel.style.maxHeight=sitesOpen?'300px':'0';
            sitesArrow.style.transform=sitesOpen?'rotate(180deg)':'rotate(0deg)';
        };
        Object.entries(SITE_LABELS).forEach(([key,label])=>{
            const t=toggle(CFG.sites[key]??true,v=>{CFG.sites[key]=v;saveCfg(CFG);sitesDropLabel.textContent=`${countOn()} / ${Object.keys(SITE_LABELS).length} sites enabled`;});
            sitesPanel.appendChild(rowEl(label,t));
        });
        dlg.appendChild(sitesPanel);

        // ── Placement ──
        dlg.appendChild(section('Buttons'));
        dlg.appendChild(rowEl('Dock to top-right',toggle(CFG.dockTopRight??false,v=>{CFG.dockTopRight=v;saveCfg(CFG);applyDock();})));
        [['export','Export'],['caveman','Caveman'],['ponytail','Ponytail'],['injection','Injection']].forEach(([key,name])=>{
            dlg.appendChild(rowEl(`Show ${name} button`,toggle(CFG.pills?.[key]??true,v=>{CFG.pills={...(CFG.pills||DEFAULTS.pills),[key]:v};saveCfg(CFG);refreshPills();})));
        });
        const dockNote=document.createElement('div');dockNote.textContent='Docked, the buttons sit square at the top-right and drag is off. Off, each floats where you last dragged it.';
        Object.assign(dockNote.style,{fontSize:'10px',color:fg2,padding:'6px 0 0'});dlg.appendChild(dockNote);

        // ── Keyboard ──
        dlg.appendChild(section('Send shortcut (+ Enter)'));
        [['ctrl','Ctrl + Enter'],['meta','Cmd / Win + Enter'],['alt','Alt / Option + Enter']].forEach(([key,label])=>{
            dlg.appendChild(rowEl(label,toggle(CFG.shortcuts[key]??DEFAULTS.shortcuts[key],v=>{CFG.shortcuts[key]=v;saveCfg(CFG);})));
        });

        // ── Caveman ──
        dlg.appendChild(section('Caveman mode'));
        dlg.appendChild(rowEl('Enable',toggle(CFG.caveman?.enabled??false,v=>{if(!CFG.caveman)CFG.caveman={enabled:false,level:'ultra'};CFG.caveman.enabled=v;saveCfg(CFG);refreshPills();})));
        dlg.appendChild(rowEl('Level',levelSel(CFG.caveman?.level||'ultra',v=>{CFG.caveman={...(CFG.caveman||DEFAULTS.caveman),level:v};saveCfg(CFG);refreshPills();})));

        // ── Ponytail ──
        dlg.appendChild(section('Ponytail mode — code answers'));
        dlg.appendChild(rowEl('Enable',toggle(CFG.ponytail?.enabled??false,v=>{CFG.ponytail={...(CFG.ponytail||DEFAULTS.ponytail),enabled:v};saveCfg(CFG);refreshPills();})));
        dlg.appendChild(rowEl('Level',levelSel(CFG.ponytail?.level||'full',v=>{CFG.ponytail={...(CFG.ponytail||DEFAULTS.ponytail),level:v};saveCfg(CFG);})));

        // ── First-prompt injection ──
        dlg.appendChild(section('First-prompt injection'));
        dlg.appendChild(rowEl('Enable',toggle(CFG.injection?.enabled??false,v=>{CFG.injection={...(CFG.injection||DEFAULTS.injection),enabled:v};saveCfg(CFG);refreshPills();})));
        Object.keys(INJECTION_PROMPTS).forEach(site=>{
            dlg.appendChild(rowEl(SITE_LABELS[site]||site,toggle(CFG.injection?.sites?.[site]??false,v=>{
                CFG.injection={...(CFG.injection||DEFAULTS.injection),sites:{...(CFG.injection?.sites||{}),[site]:v}};saveCfg(CFG);
            })));
        });
        const injNote=document.createElement('div');injNote.textContent='Fires once per tab, on the first message you send. Text lives in injection/<site>.md.';
        Object.assign(injNote.style,{fontSize:'10px',color:fg2,padding:'6px 0 0'});dlg.appendChild(injNote);

        // ── Claude Usage Tracker (only shown on claude.ai) ──
        if (P === 'claude') {
            dlg.appendChild(section('Claude usage tracker'));
            dlg.appendChild(rowEl('Show inline usage bar',toggle(CFG.usageTracker??true,v=>{CFG.usageTracker=v;saveCfg(CFG);UT.refresh();})));
        }

        const note=document.createElement('p');note.textContent='Cave button: click → menu → toggle or select level.';Object.assign(note.style,{margin:'12px 0 0',fontSize:'10px',color:fg2,textAlign:'center'});dlg.appendChild(note);
        document.body.appendChild(dlg);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  STYLES
    // ═══════════════════════════════════════════════════════════════════════════
    GM_addStyle(`
        /* Collapsed = 42px circle. Opening reveals the label, which widens it into a pill. */
        .ai-export-drag-box{position:fixed;z-index:2147483646;display:flex;align-items:center;justify-content:center;height:42px;min-width:42px;padding:0;background:rgba(24,24,27,0.9);backdrop-filter:blur(14px);color:rgba(255,255,255,0.85);border-radius:100px;box-shadow:0 4px 24px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.07);cursor:move;user-select:none;font-family:system-ui;font-size:13px;font-weight:600;transition:transform 0.15s,box-shadow 0.15s;white-space:nowrap;}
        .ai-export-drag-box:hover{transform:scale(1.04);color:#fff;box-shadow:0 6px 30px rgba(0,0,0,0.5),0 0 0 1px rgba(255,255,255,0.12);}
        .lance-pill-inner{display:flex;align-items:center;justify-content:center;pointer-events:none;padding:0 14px;}
        .lance-pill-icon{width:14px;height:14px;flex-shrink:0;text-align:center;line-height:14px;}
        .lance-pill-text{box-sizing:border-box;max-width:0;padding-left:0;opacity:0;overflow:hidden;transition:max-width .22s cubic-bezier(.16,1,.3,1),padding-left .22s cubic-bezier(.16,1,.3,1),opacity .15s;}
        .ai-export-drag-box.open .lance-pill-text{max-width:140px;padding-left:7px;opacity:1;}
        /* Docked: one fixed row at top-right, square like a site's own header buttons.
           Flex so an opening button pushes its neighbour instead of overlapping it, and
           the label stays hidden — docked, these are icon buttons. */
        #lance-dock{position:fixed;top:10px;right:10px;z-index:2147483646;display:flex;gap:6px;align-items:center;}
        #lance-dock .ai-export-drag-box{position:relative;top:auto;left:auto;height:34px;min-width:34px;border-radius:10px;cursor:pointer;}
        #lance-dock .lance-pill-inner{padding:0 10px;}
        #lance-dock .lance-pill-text{display:none;}
        .ai-export-menu-panel{position:absolute;width:max-content;min-width:185px;background:#18181b;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:4px;display:none;flex-direction:column;gap:1px;box-shadow:0 12px 40px rgba(0,0,0,0.6);}
        .ai-export-drag-box.open>.ai-export-menu-panel{display:flex;}
        .pos-bottom-right{bottom:calc(100% + 12px);right:0;transform-origin:bottom right;animation:aiPopUp .2s cubic-bezier(.16,1,.3,1);}
        .pos-bottom-left{bottom:calc(100% + 12px);left:0;transform-origin:bottom left;animation:aiPopUp .2s cubic-bezier(.16,1,.3,1);}
        .pos-top-right{top:calc(100% + 12px);right:0;transform-origin:top right;animation:aiPopDown .2s cubic-bezier(.16,1,.3,1);}
        .pos-top-left{top:calc(100% + 12px);left:0;transform-origin:top left;animation:aiPopDown .2s cubic-bezier(.16,1,.3,1);}
        @keyframes aiPopUp{0%{opacity:0;transform:scale(.94) translateY(6px)}100%{opacity:1;transform:scale(1) translateY(0)}}
        @keyframes aiPopDown{0%{opacity:0;transform:scale(.94) translateY(-6px)}100%{opacity:1;transform:scale(1) translateY(0)}}
        .ai-export-menu-item{display:flex;align-items:center;padding:9px 12px;background:transparent;border:none;border-radius:8px;text-align:left;cursor:pointer;color:rgba(228,228,232,0.75);font-size:12px;font-weight:500;transition:background .1s,color .1s,transform .08s;width:100%;white-space:nowrap;letter-spacing:0.01em;}
        .ai-export-menu-item:hover{background:rgba(255,255,255,0.07);color:#fff;}
        .ai-export-menu-item:active,.ai-export-menu-item.clicked{transform:scale(.95);opacity:.6;}
        .ai-export-menu-divider{height:1px;background:rgba(255,255,255,0.06);margin:2px 6px;}
        .ai-export-section-label{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,0.25);padding:7px 12px 2px;}
        .ai-export-badge{margin-left:auto;font-size:9px;font-weight:700;letter-spacing:.04em;font-family:monospace;color:rgba(255,255,255,0.2);}
    `);

    GM_registerMenuCommand("Settings",openDashboard);

    if(typeof trustedTypes!=="undefined"&&trustedTypes.defaultPolicy===null)
        trustedTypes.createPolicy("default",{createHTML:s=>s,createScriptURL:s=>s,createScript:s=>s});

    setTimeout(()=>{initPills();UT.init();},1000);
    setInterval(()=>{initPills();refreshPills();},3000);
})();