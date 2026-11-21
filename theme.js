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
    const DARK_BG = '#18181b', LIGHT_BG = '#f4f4f6';
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

window.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('.theme-toggle-corner')) {
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'theme-toggle-corner';
        toggleBtn.setAttribute('onclick', 'toggleTheme()');
        toggleBtn.setAttribute('aria-label', 'Toggle light/dark mode');
        toggleBtn.innerHTML = `
            <svg width="80" height="80" viewBox="0 0 250 250" aria-hidden="true">
                <path d="M0,0 L250,250 L250,0 Z"></path>
                <!-- Sun Icon (visible in dark mode) -->
                <g class="icon-sun" transform="translate(142, 52) scale(2.2)">
                    <circle cx="12" cy="12" r="4"></circle>
                    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>
                </g>
                <!-- Moon Icon (visible in light mode) -->
                <g class="icon-moon" transform="translate(142, 52) scale(2.2)">
                    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>
                </g>
            </svg>
        `;
        document.body.prepend(toggleBtn);
    }
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
