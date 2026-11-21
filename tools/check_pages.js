// Checks that every page points at files that exist (scripts, styles, icons, links to other pages):  node tools/check_pages.js
// Exits with 1 if something is missing.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pages = fs.readdirSync(root).filter(name => name.endsWith('.html'));
let failures = 0;
let checked = 0;

pages.forEach(page => {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const refs = new Set();
    const patterns = [/<script[^>]+src="([^"]+)"/g, /<link[^>]+href="([^"]+)"/g, /<img[^>]+src="([^"]+)"/g, /location\.href='([^']+)'/g, /<a[^>]+href="([^"]+)"/g];
    patterns.forEach(pattern => { let m; while ((m = pattern.exec(html))) refs.add(m[1]); });
    refs.forEach(ref => {
        if (/^(https?:|mailto:|#|data:|javascript:)/.test(ref) || ref.includes('${') || ref === '') return;
        const file = ref.split('#')[0].split('?')[0];
        if (!file) return;
        checked++;
        if (!fs.existsSync(path.join(root, file))) { failures++; console.log(`FAIL  ${page} refers to ${file}, which does not exist`); }
    });
});

console.log(failures ? `\n${failures} missing file(s)` : `ok    ${checked} references in ${pages.length} pages all point at existing files\n\nall checks passed`);
process.exit(failures ? 1 : 0);
