// Checks the share links and the insights (explainer, category fit, map, overlap):  node tools/check_share.js
// Exits with 1 if a check fails.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = {
    localStorage: { getItem() { return null; }, setItem() {} },
    location: { href: 'https://example.org/app/results.html' },
    console,
    atob: text => Buffer.from(text, 'base64').toString('binary'),
    btoa: text => Buffer.from(text, 'binary').toString('base64')
};
vm.createContext(ctx);
['data.js', 'scoring.js', 'share.js', 'insights.js'].forEach(file => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8').replace(/^const /gm, 'var '), ctx, { filename: file });
});
const { HV, HVShare, HVInsights } = ctx;

let failures = 0;
function check(ok, message) { if (!ok) { failures++; console.log('FAIL  ' + message); } else console.log('ok    ' + message); }

let seed = 12345;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const valueIds = Object.keys(HV.categoryOf);
function randomAnswers(count) {
    const answers = {};
    const picked = new Set();
    while (picked.size < count) picked.add(valueIds[Math.floor(random() * valueIds.length)]);
    picked.forEach(value => {
        const category = HV.categoryOf[value];
        (answers[category] = answers[category] || []).push({ value, agree: Math.round((random() * 2 - 1) * 100) / 100 });
    });
    return answers;
}
const flat = answers => Object.keys(answers).flatMap(cat => answers[cat].map(item => item.value + '=' + item.agree)).sort().join(',');
const labels = HVInsights.labels;
function ownAnswers(label) {
    const answers = {};
    const byCategory = HV.stancesByCategory(label);
    Object.keys(byCategory).forEach(cat => { answers[cat] = byCategory[cat].map(item => ({ value: item.value, agree: item.stance })); });
    return answers;
}

// 1. Share codes
const hashes = {};
const collisions = [];
valueIds.forEach(id => {
    const h = HVShare.hashOf(id);
    if (hashes[h]) collisions.push(id + ' and ' + hashes[h]);
    hashes[h] = id;
});
check(collisions.length === 0, `no two of the ${valueIds.length} values share a code hash` + (collisions.length ? ': ' + collisions.join('; ') : ''));

let roundTripOk = true;
for (let i = 0; i < 200; i++) {
    const answers = randomAnswers(1 + Math.floor(random() * 60));
    const decoded = HVShare.decode(HVShare.encode(answers));
    if (!decoded || flat(decoded) !== flat(answers)) { roundTripOk = false; break; }
}
check(roundTripOk, 'encode then decode gives back the same answers (200 random sets, up to 60 values)');

const heavy = HVShare.encode(randomAnswers(60));
check(heavy.length < 400, `60 values make a code of ${heavy.length} characters (under 400)`);
check(/^[A-Za-z0-9_-]+$/.test(heavy), 'a code uses only characters that are safe in a URL hash');

const bad = ['', 'abc', '!!!', 'AA', HVShare.encode({}), 'Ag' + heavy.slice(2)];
check(bad.every(code => HVShare.decode(code) === null), 'empty, short, malformed and wrong-version codes are rejected');

const sample = randomAnswers(5);
const code = HVShare.encode(sample);
check(HVShare.codeFromText('https://example.org/app/shared.html#r=' + code) === code, 'the code is found inside a pasted shared link');
check(HVShare.codeFromText('see https://x.org/compare.html#a=' + code + '&b=' + code + '&an=Me') === code, 'the code is found inside a pasted compare link');
check(HVShare.codeFromText(code) === code, 'a bare code is accepted');
check(HVShare.codeFromText('not a code at all') === null, 'text that is not a code is rejected');
check(HVShare.link('shared.html', sample) === 'https://example.org/app/shared.html#r=' + code, 'link() builds an address next to the current page');

// unknown values (data changed since the link was made) are skipped, the rest still loads
const unknownByte = Buffer.from([1, 1, 2, 3, 150]).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
check(HVShare.decode(unknownByte) === null, 'a code of only unknown values is rejected instead of giving empty results');

// 2. Explainer
let explainOk = true, explainMessage = '';
labels.forEach(label => {
    const stanceCount = Object.values(HV.stancesByCategory(label)).reduce((n, list) => n + list.length, 0);
    const info = HVInsights.explain(ownAnswers(label), label);
    if (info.toward.length !== stanceCount || info.away.length || info.missing.length) { explainOk = false; explainMessage = label; }
});
check(explainOk, 'answering exactly like an ideology: all its values pull toward it, none away, none missing' + (explainMessage ? ' (fails for ' + explainMessage + ')' : ''));

let sumsOk = true;
for (let i = 0; i < 30; i++) {
    const answers = randomAnswers(20);
    const label = labels[Math.floor(random() * labels.length)];
    const info = HVInsights.explain(answers, label);
    const listed = Object.values(HV.stancesByCategory(label)).reduce((n, list) => n + list.length, 0);
    const answered = Object.values(answers).reduce((n, list) => n + list.length, 0);
    if (info.toward.length + info.away.length + info.flat.length + info.missing.length !== listed) sumsOk = false;
    if (info.toward.length + info.away.length + info.flat.length + info.unlisted.length !== answered) sumsOk = false;
    if (info.toward.some(r => r.score <= 0) || info.away.some(r => r.score >= 0)) sumsOk = false;
}
check(sumsOk, 'explain() accounts for every listed stance and every answer exactly once, with the right signs (30 random cases)');

const opposite = ownAnswers(labels[0]);
Object.keys(opposite).forEach(cat => opposite[cat].forEach(item => { item.agree = -item.agree; }));
const flipped = HVInsights.explain(opposite, labels[0]);
check(flipped.toward.length === 0 && flipped.away.length > 0, 'answering the opposite of an ideology: every value pulls away');

const diff = HVInsights.differences(randomAnswers(25), labels[3], labels[7]);
check(diff.aBetter.every(r => r.gap > 0) && diff.bBetter.every(r => r.gap < 0), 'differences() lists each value on the side that fits better');

// 3. Category fit
const fit = HVInsights.categoryFit(ownAnswers(labels[5]), labels[5]);
check(Object.values(fit).every(v => v === null || (v > 0 && v <= 1)), 'category fit of an ideology against its own stances is positive in every category it lists');
check(Object.keys(HVInsights.categoryFit({}, labels[5])).every(cat => HVInsights.categoryFit({}, labels[5])[cat] === null), 'category fit with no answers is null everywhere');

// 4. Map
const mapA = HVInsights.map();
check(mapA.points.length === labels.length && mapA.points.every(p => p.every(Number.isFinite)), `the map has a finite position for each of the ${labels.length} ideologies`);
check(JSON.stringify(mapA.points.slice(0, 5)) === JSON.stringify(HVInsights.map().points.slice(0, 5)), 'the map is the same every time (cached and deterministic)');
const xs = mapA.points.map(p => p[0]), ys = mapA.points.map(p => p[1]);
const spread = list => { const mean = list.reduce((a, b) => a + b, 0) / list.length; return Math.sqrt(list.reduce((s, v) => s + (v - mean) ** 2, 0) / list.length); };
check(spread(xs) > 0.05 && spread(ys) > 0.05 && spread(xs) >= spread(ys), 'both axes carry spread and the first axis carries the most');
check(mapA.ends.every(e => e.high.length === 3 && e.low.length === 3), 'each axis has three values at each end to name it');

let near = 0;
labels.forEach(label => {
    const you = HVInsights.place(ownAnswers(label));
    const own = mapA.points[labels.indexOf(label)];
    const distances = mapA.points.map(p => Math.hypot(p[0] - you[0], p[1] - you[1])).sort((a, b) => a - b);
    const ownDistance = Math.hypot(own[0] - you[0], own[1] - you[1]);
    if (ownDistance <= distances[Math.ceil(labels.length * 0.1)]) near++;
});
const nearShare = near / labels.length;
check(nearShare >= 0.85, `answering like an ideology places you among its nearest 10% on the map for ${(nearShare * 100).toFixed(1)}% of ideologies (at least 85%)`);

// 5. Overlap
const own = ownAnswers(labels[10]);
const same = HVInsights.overlap(own, own);
check(Math.abs(same.ideology - 1) < 1e-9 && Math.abs(same.values - 1) < 1e-9, 'two identical answer sets overlap 100% in ideologies and values');
const opp = JSON.parse(JSON.stringify(own));
Object.keys(opp).forEach(cat => opp[cat].forEach(item => { item.agree = -item.agree; }));
const against = HVInsights.overlap(own, opp);
check(against.values < 0.001 || against.values < same.values, 'opposite answers on the same values have a value agreement near 0');
check(against.ideology < same.ideology, 'opposite answers overlap less in ideologies than identical ones');
const disjoint = HVInsights.overlap({ economics: [{ value: Object.keys(HV.categoryOf).find(v => HV.categoryOf[v] === 'economics'), agree: 1 }] }, { culture: [{ value: Object.keys(HV.categoryOf).find(v => HV.categoryOf[v] === 'culture'), agree: 1 }] });
check(disjoint.values === null && disjoint.ideology >= 0 && disjoint.ideology <= 1, 'answers with no value in common give no value agreement and an overlap between 0 and 1');

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
