// Checks ideology_matrix.js: a score for every ideology and every value, each from -1 to +1:  node tools/check_matrix.js
// Exits with 1 if a pair is missing, a score is out of range, or a score contradicts its stated source.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = { localStorage: { getItem() { return null; }, setItem() {} }, console };
vm.createContext(ctx);
['data.js', 'scoring.js', 'ideology_matrix.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8').replace(/^const /gm, 'var '), ctx, { filename: f }));
const { HV, IDEOLOGY_MATRIX: M } = ctx;

let failures = 0;
const problems = [];
function check(ok, message, detail) {
    if (!ok) failures++;
    console.log((ok ? 'ok    ' : 'FAIL  ') + message);
    if (!ok && detail) detail.slice(0, 8).forEach(d => console.log('        ' + d));
}

const labels = [...new Set(Object.values(ctx.labelMapping))];
const values = [];
Object.keys(ctx.resultsMapping).forEach(cat => Object.keys(ctx.resultsMapping[cat]).forEach(v => values.push(v)));

check(JSON.stringify(M.values) === JSON.stringify(values), `the matrix lists the ${values.length} values of data.js in order`);
const missing = labels.filter(l => !M.ideologies[l]);
const extra = Object.keys(M.ideologies).filter(l => !labels.includes(l));
check(missing.length === 0, `every one of the ${labels.length} ideologies has a row` + (missing.length ? '' : ''), missing.map(l => 'missing: ' + l));
check(extra.length === 0, 'no row belongs to an ideology that no longer exists', extra.map(l => 'extra: ' + l));

const shape = [], range = [], basisBad = [], stated = [], estimated = [], none = [];
let pairs = 0;
labels.forEach(label => {
    const row = M.ideologies[label];
    if (!row) return;
    if (!Array.isArray(row.s) || row.s.length !== values.length || typeof row.b !== 'string' || row.b.length !== values.length) { shape.push(label); return; }
    const byValue = {};
    const order = HV.valueOrder(label);
    Object.keys(order).forEach(cat => order[cat].forEach(item => { byValue[item.value] = item; }));
    values.forEach((v, i) => {
        pairs++;
        const s = row.s[i], b = row.b[i];
        if (typeof s !== 'number' || !Number.isFinite(s) || s < -1 || s > 1) range.push(`${label} / ${v}: ${s}`);
        if (!'SENM'.includes(b)) basisBad.push(`${label} / ${v}: basis "${b}"`);
        if (b === 'S' && !(byValue[v] && byValue[v].listed && Math.abs(byValue[v].stance - s) < 0.005)) stated.push(`${label} / ${v}: ${s} is not the stance in data.js`);
        if (b !== 'S' && byValue[v] && byValue[v].listed) stated.push(`${label} / ${v}: data.js states ${byValue[v].stance} but the matrix says ${b}`);
        if (b === 'E' && Math.abs(s) > 0.5 + 1e-9) estimated.push(`${label} / ${v}: estimate ${s} is larger than 0.5`);
        if (b === 'N' && s !== 0) none.push(`${label} / ${v}: basis N must be 0, found ${s}`);
    });
});
check(shape.length === 0, 'every row has one score and one basis letter for each value, none blank', shape.map(l => 'wrong length: ' + l));
check(range.length === 0, `all ${pairs} scores are numbers from -1 to +1`, range);
check(basisBad.length === 0, 'every basis letter is S, E, N or M', basisBad);
check(stated.length === 0, 'stated scores (S) are exactly the stances in data.js, and every stance in data.js is there', stated);
check(estimated.length === 0, 'estimated scores (E) stay within +-0.5, so a guess is never as strong as a stated position', estimated);
check(none.length === 0, 'no-information scores (N) are exactly 0', none);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
