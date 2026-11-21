// Checks the custom axes: the position calculation, presets and saved settings:  node tools/check_axes.js
// Exits with 1 if a check fails.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const store = {};
const ctx = { localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } }, console };
vm.createContext(ctx);
['data.js', 'ideology_matrix.js', 'scoring.js', 'insights.js', 'axes.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8').replace(/^const /gm, 'var '), ctx, { filename: f }));
const { HV, HVInsights, HVAxes } = ctx;

let failures = 0;
function check(ok, message) { if (!ok) failures++; console.log((ok ? 'ok    ' : 'FAIL  ') + message); }
const near = (a, b) => Math.abs(a - b) < 1e-9;
const ids = HVInsights.valueIds;

// the formula on a small example
const axis = { label: 'x', low: 'L', high: 'H', weights: { [ids[0]]: 1, [ids[1]]: -0.5, [ids[2]]: 0.5 } };
const scores = { [ids[0]]: 0.8, [ids[1]]: 0.4, [ids[2]]: -1 };
const r = HVAxes.position(axis, id => scores[id]);
check(near(r.num, 0.8 - 0.2 - 0.5) && near(r.den, 2) && near(r.position, 0.05), 'position = sum(weight x score) / sum(|weight|): (0.8 - 0.2 - 0.5) / 2 = 0.05');
check(near(HVAxes.position({ weights: { [ids[0]]: 1 } }, () => 1).position, 1) && near(HVAxes.position({ weights: { [ids[0]]: -1 } }, () => 1).position, -1), 'a full score on a full weight reaches +1, or -1 for a negative weight');
check(near(HVAxes.position({ weights: { [ids[0]]: 0.3 } }, () => 1).position, 1), 'scaling every weight by the same amount does not change the position');
const flipped = HVAxes.position({ weights: { [ids[0]]: -1, [ids[1]]: 0.5, [ids[2]]: -0.5 } }, id => scores[id]);
check(near(flipped.position, -r.position), 'flipping every weight flips the position');

// answers left out
const partial = HVAxes.position(axis, id => (id === ids[1] ? null : scores[id]));
check(near(partial.den, 1.5) && near(partial.num, 0.3) && near(partial.position, 0.2), 'a value that was not answered leaves the sum and the divisor alike');
check(HVAxes.position(axis, () => null).position === null, 'with no answered value there is no position');
check(HVAxes.position({ weights: {} }, () => 1).position === null && !HVAxes.isActive({ weights: { [ids[0]]: 0 } }), 'an axis without weights has no position and is not active');

// all positions stay inside -1 to +1 for every ideology
let inside = true;
const random = (() => { let s = 99; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
for (let t = 0; t < 20 && inside; t++) {
    const weights = {};
    for (let k = 0; k < 1 + Math.floor(random() * 8); k++) weights[ids[Math.floor(random() * ids.length)]] = Math.round((random() * 2 - 1) * 10) / 10 || 0.1;
    HVInsights.labels.forEach(label => {
        const p = HVAxes.position({ weights }, HVAxes.ideologyScore(label)).position;
        if (p !== null && (p < -1 - 1e-9 || p > 1 + 1e-9)) inside = false;
    });
}
check(inside, 'every ideology gets a position between -1 and +1 on 20 random axes');

// the user's score is the answer, and uses the same function as an ideology would
const answers = { [HV.categoryOf[ids[3]]]: [{ value: ids[3], agree: -0.6 }] };
check(HVAxes.userScore(answers)(ids[3]) === -0.6 && HVAxes.userScore(answers)(ids[4]) === null, 'your score for a value is your answer, and null if you did not answer it');
const lab = HVInsights.labels[0];
check(HVAxes.ideologyScore(lab)(ids[7]) === HVInsights.score(lab, ids[7]).score, "an ideology's score for a value is its matrix entry");

// an ideology that states the same stance as the axis weight lands on that end
const labelHigh = HVInsights.labels.find(l => HVInsights.score(l, ids[5]).basis === 'S' && HVInsights.score(l, ids[5]).score === 1);
const labelLow = HVInsights.labels.find(l => HVInsights.score(l, ids[5]).basis === 'S' && HVInsights.score(l, ids[5]).score === -1);
if (labelHigh && labelLow) {
    const one = { weights: { [ids[5]]: 1 } };
    check(HVAxes.position(one, HVAxes.ideologyScore(labelHigh)).position === 1 && HVAxes.position(one, HVAxes.ideologyScore(labelLow)).position === -1, 'an ideology that fully supports the only chosen value sits at +1, one that fully opposes it at -1');
}

// presets
[0, 1].forEach(k => {
    const p = HVAxes.preset(k);
    const w = Object.keys(p.weights);
    check(w.length === 6 && w.every(id => id in HV.categoryOf && p.weights[id] >= -1 && p.weights[id] <= 1 && p.weights[id] !== 0) && Math.max.apply(null, w.map(id => Math.abs(p.weights[id]))) === 1 && p.low && p.high, `the preset from map axis ${k + 1} has 6 valid values, a full-size strongest weight and named ends`);
});

// saving and loading, including junk
HVAxes.save([HVAxes.preset(0)]);
check(HVAxes.load().length === 1 && Object.keys(HVAxes.load()[0].weights).length === 6, 'saved axes load back');
store.hv_custom_axes = JSON.stringify([{ label: 'x'.repeat(500), low: 5, high: null, weights: { nonsense: 1, [ids[0]]: 7, [ids[1]]: 'a' } }, {}, {}]);
const junk = HVAxes.load();
check(junk.length === 2 && junk[0].label.length === 80 && Object.keys(junk[0].weights).join() === ids[0] && junk[0].weights[ids[0]] === 1, 'loading junk keeps at most two axes, cuts long text and keeps only known values with weights inside -1..+1');
store.hv_custom_axes = '{not json';
check(HVAxes.load().length === 1 && !HVAxes.isActive(HVAxes.load()[0]), 'unreadable saved data gives one empty axis');

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
