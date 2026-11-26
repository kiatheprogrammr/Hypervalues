(function () {
    let saved = null;
    try { saved = localStorage.getItem('nv_theme'); } catch (e) { /* storage is not available */ }
    // no saved choice: follow the system setting (dark if it cannot be read)
    const preferred = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', saved === 'light' || saved === 'dark' ? saved : preferred);
})();

// The label and state of every theme button say what it does now
function syncThemeButtons() {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    document.querySelectorAll('.theme-toggle-corner').forEach(button => {
        button.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
        button.setAttribute('aria-pressed', light ? 'true' : 'false');
        button.title = light ? 'Switch to dark mode' : 'Switch to light mode';
    });
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    try { localStorage.setItem('nv_theme', newTheme); } catch (e) { /* storage is not available */ }
    syncThemeButtons();
}

// Readable text colors for an ideology's color. Text in the ideology's own color on the page background (outlined
// pills) is mixed toward white or black until it reaches a 4.5:1 contrast, one color for each theme; text on a
// filled bubble is white or near-black, whichever contrasts more.
const hvInk = (function () {
    const DARK_BG = '#18181b', LIGHT_BG = '#f6f6f8';
    const parse = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const luminance = rgb => {
        const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a, b) => {
        const x = luminance(a), y = luminance(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    const css = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
    function toward(hex, target, background) {
        if (!/^#[0-9a-f]{6}/i.test(hex || '')) return hex;
        const color = parse(hex.slice(0, 7)), end = parse(target), bg = parse(background);
        for (let t = 0; t <= 1.0001; t += 0.05) {
            const candidate = mix(color, end, t);
            if (contrast(candidate, bg) >= 4.5) return css(candidate);
        }
        return target;
    }
    return {
        forDark: hex => toward(hex, '#ffffff', DARK_BG),
        forLight: hex => toward(hex, '#000000', LIGHT_BG),
        onFill: hex => {
            if (!/^#[0-9a-f]{6}/i.test(hex || '')) return '#ffffff';
            const color = parse(hex.slice(0, 7));
            return contrast(color, [255, 255, 255]) >= contrast(color, [24, 24, 27]) ? '#ffffff' : '#18181b';
        },
        contrast, parse
    };
})();

// The top bar on every page: brand, main pages and the light/dark switch (the .theme-toggle-corner button)
function buildTopbar() {
    document.querySelectorAll('.theme-toggle-corner').forEach(button => button.remove());
    if (document.querySelector('.hv-topbar')) return;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = (inner, size) => {
        const el = document.createElementNS(ns, 'svg');
        el.setAttribute('viewBox', '0 0 24 24'); el.setAttribute('aria-hidden', 'true');
        if (size) { el.setAttribute('width', size); el.setAttribute('height', size); }
        el.innerHTML = inner; return el;
    };
    const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const header = document.createElement('header');
    header.className = 'hv-topbar';

    const brand = document.createElement('a');
    brand.className = 'hv-brand'; brand.href = 'index.html'; brand.setAttribute('aria-label', 'Hypervalues, home');
    const logo = document.createElement('img'); logo.src = 'icon.svg'; logo.alt = '';
    const name = document.createElement('span'); name.textContent = 'Hypervalues';
    const ver = document.createElement('span'); ver.className = 'hv-ver'; ver.textContent = 'v4.0';
    brand.append(logo, name, ver);

    const nav = document.createElement('nav');
    nav.className = 'hv-nav'; nav.id = 'hv-nav'; nav.setAttribute('aria-label', 'Main');
    [['Start', 'Instruction.html'], ['Values', 'values.html'], ['Ideologies', 'ideologies.html'], ['Compare', 'compare.html#m=i'],
     ['Tensions', 'tensions.html'], ['Axes', 'axes.html'], ['Changelog', 'changelog.html']].forEach(([label, href]) => {
        const a = document.createElement('a');
        a.href = href; a.textContent = label;
        if (href.split('#')[0].toLowerCase() === page) a.setAttribute('aria-current', 'page');
        if (label === 'Start') a.addEventListener('click', () => { try { localStorage.removeItem('hvResultMode'); } catch (e) { /* storage is not available */ } });
        nav.append(a);
    });

    const pill = document.createElement('span');
    pill.className = 'hv-nav-pill'; pill.setAttribute('aria-hidden', 'true'); nav.prepend(pill);
    const navLinks = [...nav.querySelectorAll('a')];
    const currentLink = () => nav.querySelector('a[aria-current="page"]');
    const placePill = (link, animate) => {   // the highlight slides to the hovered link and back to the current page
        if (!link) { pill.style.opacity = '0'; return; }
        if (!animate) pill.style.transition = 'none';
        pill.style.width = link.offsetWidth + 'px'; pill.style.left = link.offsetLeft + 'px'; pill.style.opacity = '1';
        if (!animate) { void pill.offsetWidth; pill.style.transition = ''; }
    };
    navLinks.forEach(a => { a.addEventListener('pointerenter', () => placePill(a, true)); a.addEventListener('focus', () => placePill(a, true)); });
    nav.addEventListener('pointerleave', () => placePill(currentLink(), true));
    nav.addEventListener('focusout', e => { if (!nav.contains(e.relatedTarget)) placePill(currentLink(), true); });
    requestAnimationFrame(() => placePill(currentLink(), false));
    window.addEventListener('resize', () => placePill(currentLink(), false));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => placePill(currentLink(), false));

    const search = document.createElement('button');
    search.type = 'button'; search.className = 'hv-search'; search.setAttribute('aria-label', 'Quick jump (press /)');
    search.append(svg('<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>'));
    const searchText = document.createElement('span'); searchText.className = 'hv-search-text'; searchText.textContent = 'Jump to…';
    const searchKey = document.createElement('kbd'); searchKey.textContent = '/';
    search.append(searchText, searchKey);
    search.addEventListener('click', () => openPalette(search));

    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'theme-toggle-corner';
    toggle.setAttribute('onclick', 'toggleTheme()'); toggle.setAttribute('aria-label', 'Toggle light/dark mode');
    toggle.append(svg('<g class="icon-sun"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></g><g class="icon-moon"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></g>'));

    const burger = document.createElement('button');
    burger.type = 'button'; burger.className = 'hv-burger';
    burger.setAttribute('aria-label', 'Menu'); burger.setAttribute('aria-expanded', 'false'); burger.setAttribute('aria-controls', 'hv-nav');
    burger.append(svg('<path d="M4 7h16M4 12h16M4 17h16"></path>'));
    burger.addEventListener('click', () => {
        const open = header.classList.toggle('open');
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && header.classList.contains('open')) { header.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); burger.focus(); } });

    header.append(brand, nav, search, toggle, burger);
    document.body.prepend(header);
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
}

// Quick jump: press / or Ctrl+K (Cmd+K) to search pages and ideologies
function paletteItems() {
    const pages = [['Take the test', 'Instruction.html'], ['Values', 'values.html'], ['Ideologies', 'ideologies.html'], ['Compare ideologies', 'compare.html#m=i'],
        ['Your tensions', 'tensions.html'], ['Custom axes', 'axes.html'], ['Custom results', 'Instruction.html?mode=custom'], ['Changelog', 'changelog.html'], ['License', 'licpage.html']];
    const items = pages.map(([label, href]) => ({ label, href, kind: 'Page' }));
    items.push({ label: 'Switch light / dark mode', action: () => toggleTheme(), kind: 'Action' });
    if (typeof ideologyScores !== 'undefined') {
        const hidden = typeof secretIdeologies !== 'undefined' ? secretIdeologies : [];
        Object.keys(ideologyScores).filter(name => !hidden.includes(name)).forEach(name =>
            items.push({ label: name, href: 'description.html?id=' + encodeURIComponent(name) + '&type=ideology', kind: 'Ideology' }));
    }
    return items;
}
function openPalette(opener) {
    if (document.querySelector('.hv-palette')) return;
    const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
    const all = paletteItems();
    const overlay = mk('div', 'hv-palette');
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', 'Quick jump');
    const panel = mk('div', 'hv-palette-panel');
    const input = mk('input', 'hv-palette-input');
    input.type = 'text'; input.placeholder = 'Jump to a page or an ideology…'; input.autocomplete = 'off'; input.spellcheck = false;
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-label', 'Jump to a page or an ideology');
    input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-controls', 'hv-palette-list'); input.setAttribute('aria-autocomplete', 'list');
    const list = mk('ul', 'hv-palette-list'); list.id = 'hv-palette-list'; list.setAttribute('role', 'listbox');
    const hint = mk('div', 'hv-palette-hint', 'Up and down to move, Enter to open, Esc to close');
    panel.append(input, list, hint); overlay.append(panel);
    let shown = [], active = 0;
    const close = () => { overlay.remove(); document.body.style.overflow = ''; if (opener && opener.focus) opener.focus(); };
    const run = item => { close(); if (item.action) item.action(); else location.href = item.href; };
    const render = () => {
        const q = input.value.trim().toLowerCase();
        shown = q ? all.filter(i => i.label.toLowerCase().includes(q)).sort((a, b) => (b.label.toLowerCase().startsWith(q)) - (a.label.toLowerCase().startsWith(q))).slice(0, 9)
                  : all.filter(i => i.kind !== 'Ideology');
        active = Math.min(active, Math.max(shown.length - 1, 0));
        list.innerHTML = '';
        if (!shown.length) list.append(mk('li', 'hv-palette-empty', 'No matches'));
        shown.forEach((item, i) => {
            const li = mk('li', 'hv-palette-item' + (i === active ? ' active' : ''));
            li.id = 'hv-pal-' + i; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', i === active ? 'true' : 'false');
            li.append(mk('span', 'hv-palette-label', item.label), mk('span', 'hv-palette-kind', item.kind));
            li.addEventListener('pointermove', () => { if (active !== i) { active = i; render(); } });
            li.addEventListener('click', () => run(item));
            list.append(li);
        });
        if (shown.length) input.setAttribute('aria-activedescendant', 'hv-pal-' + active); else input.removeAttribute('aria-activedescendant');
        const on = list.querySelector('.active'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    };
    input.addEventListener('input', () => { active = 0; render(); });
    input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % Math.max(shown.length, 1); render(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + Math.max(shown.length, 1)) % Math.max(shown.length, 1); render(); }
        else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) run(shown[active]); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'Tab') e.preventDefault();
    });
    overlay.addEventListener('pointerdown', e => { if (e.target === overlay) close(); });
    document.body.append(overlay); document.body.style.overflow = 'hidden';
    render(); input.focus();
}
document.addEventListener('keydown', e => {
    const t = e.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
    const slash = e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey;
    const combo = (e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey;
    if (slash || combo) { e.preventDefault(); openPalette(document.querySelector('.hv-search')); }
});

// Cursor glow (and a slight tilt on answer cards) that follows the mouse over cards
(function cardGlow() {
    let last = null;
    const reset = el => { if (el) ['--mx', '--my', '--rx', '--ry'].forEach(p => el.style.removeProperty(p)); };
    document.addEventListener('pointermove', e => {
        if (e.pointerType === 'touch') return;
        const el = e.target.closest ? e.target.closest('.answer-card, .hv-card') : null;
        if (el !== last) { reset(last); last = el; }
        if (!el) return;
        const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        el.style.setProperty('--mx', x + 'px'); el.style.setProperty('--my', y + 'px');
        if (el.classList.contains('answer-card')) {
            el.style.setProperty('--ry', ((x / r.width - 0.5) * 9).toFixed(2) + 'deg');
            el.style.setProperty('--rx', (-(y / r.height - 0.5) * 7).toFixed(2) + 'deg');
        }
    }, { passive: true });
    document.addEventListener('pointerleave', () => { reset(last); last = null; }, true);
})();

window.addEventListener('DOMContentLoaded', () => {
    buildTopbar();
    syncThemeButtons();

    // landmark and a way past the repeated controls for keyboard and screen reader users
    const main = document.querySelector('.main-container');
    if (main) {
        if (!main.id) main.id = 'main-content';
        main.setAttribute('role', 'main');
        main.tabIndex = -1;
        if (!document.querySelector('.skip-link')) {
            const skip = document.createElement('a');
            skip.className = 'skip-link';
            skip.href = '#' + main.id;
            skip.textContent = 'Skip to content';
            skip.addEventListener('click', event => { event.preventDefault(); main.focus(); });
            document.body.prepend(skip);
        }
    }
});
