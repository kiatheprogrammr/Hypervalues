// Checks the data and the ranking after a change to data.js, questions_tree.json or scoring.js:  node tools/check_scoring.js
// Exits with 1 if a check fails. Warnings are listed but do not fail.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = { localStorage: { getItem() { return null; }, setItem() {} }, console, atob: text => Buffer.from(text, 'base64').toString('binary') };
vm.createContext(ctx);
const loadMs = {};
['data.js', 'scoring.js'].forEach(file => {
    // top-level const is not visible outside the script, so make it var
    const startedLoad = Date.now();
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8').replace(/^const /gm, 'var '), ctx, { filename: file });
    loadMs[file] = Date.now() - startedLoad;
});

const HV = ctx.HV;
const categoryOf = HV.categoryOf;
const labels = [];
Object.keys(ctx.labelMapping).forEach(key => { if (!labels.includes(ctx.labelMapping[key])) labels.push(ctx.labelMapping[key]); });
let failures = 0;
const warnings = [];
function check(ok, message) { if (!ok) { failures++; console.log('FAIL  ' + message); } else console.log('ok    ' + message); }

// 1. The stances in data.js
const stances = {};
const badStances = [];
labels.forEach(label => {
    stances[label] = {};
    const text = ctx.ideologyScores[label] || '';
    if (!text) warnings.push(label + ' has no scores in ideologyScores');
    text.split('|').forEach(part => {
        const at = part.lastIndexOf(':');
        if (at < 1) return;
        const value = part.slice(0, at);
        const stance = Number(part.slice(at + 1));
        if (!categoryOf[value] || !(stance >= -1 && stance <= 1) || stance === 0) badStances.push(label + ': ' + part);
        else stances[label][value] = stance;
    });
});
check(badStances.length === 0, 'every stance is a known value with a score from -1 to +1, not 0' + (badStances.length ? ': ' + badStances.slice(0, 5).join(', ') : ''));

// ideology_scores.json repeats the stances of data.js
let jsonDiffers = [];
try {
    const copy = JSON.parse(fs.readFileSync(path.join(root, 'ideology_scores.json'), 'utf8'));
    jsonDiffers = labels.filter(label => !copy[label] || copy[label].s !== ctx.ideologyScores[label]);
} catch (error) { jsonDiffers = ['(ideology_scores.json cannot be read)']; }
check(jsonDiffers.length === 0, 'ideology_scores.json has the same stances as data.js' + (jsonDiffers.length ? ': ' + jsonDiffers.slice(0, 5).join(', ') : ''));

// 2. The quiz: every value it can end on must be held by at least one ideology
const used = {};
labels.forEach(label => Object.keys(stances[label]).forEach(value => { used[value] = true; }));
const tree = JSON.parse(fs.readFileSync(path.join(root, 'questions_tree.json'), 'utf8'));
const inQuiz = {};
Object.keys(tree).forEach(cat => tree[cat].forEach(node => { if (!node.options) inQuiz[node.id] = true; }));
const quizDead = Object.keys(inQuiz).filter(value => !used[value]);
check(quizDead.length === 0, 'every value the quiz can end on is held by an ideology' + (quizDead.length ? ': ' + quizDead.join(', ') : ''));
const unusedElsewhere = Object.keys(categoryOf).filter(value => !used[value] && !inQuiz[value]);
if (unusedElsewhere.length) warnings.push(unusedElsewhere.length + ' values are held by no ideology and are not in the quiz: ' + unusedElsewhere.join(', '));
const few = labels.filter(label => Object.keys(stances[label]).length <= 2);
if (few.length) warnings.push(few.length + ' ideologies list 2 values or fewer: ' + few.join(', '));

// 2b. The guesses for stances an ideology does not list (worked out in scoring.js from the definitions and the table)
let badGuess = 0, guessed = 0;
labels.forEach(label => HV.guessedValues(label, 1000).forEach(guess => {
    guessed++;
    if (stances[label][guess.value] !== undefined || !(guess.probability > 0 && guess.probability <= 1 + 1e-9)) badGuess++;
}));
check(guessed > 0 && badGuess === 0, 'the guesses cover only values an ideology does not list, with chances from 0 to 1 (' + guessed + ' guesses)');
const noText = labels.filter(label => !ctx.descriptions[label]);
check(noText.length === 0, 'every ideology has a definition, which the guesses read' + (noText.length ? ': ' + noText.join(', ') : ''));
check(loadMs['scoring.js'] < 2000, 'scoring.js builds its model in ' + loadMs['scoring.js'] + ' ms (under 2000 ms)');

// 3. No answers; probabilities add up to 1; the text of a probability
const empty = HV.rankIdeologies({});
check(empty.length === labels.length && empty.every(item => Math.abs(item.probability - 1 / labels.length) < 1e-9 && Number.isFinite(item.rankScore)), 'no answers: every ideology has the same probability');
function answersFrom(entries) {
    const answers = {};
    entries.forEach(([value, agree]) => { (answers[categoryOf[value]] = answers[categoryOf[value]] || []).push({ value, agree }); });
    return answers;
}
const strongest = count => label => Object.keys(stances[label])
    .sort((a, b) => Math.abs(stances[label][b]) - Math.abs(stances[label][a]) || (a < b ? -1 : 1))
    .slice(0, count).map(value => [value, stances[label][value]]);
const sample = HV.rankIdeologies(answersFrom(strongest(4)(labels[0])));
check(Math.abs(sample.reduce((sum, item) => sum + item.probability, 0) - 1) < 1e-9, 'probabilities add up to 1');
check(HV.percent(0.8432) === '84.3%' && HV.percent(0.00004) === '<0.1%' && HV.percent(1) === '>99.9%', 'probabilities are written with one decimal');

// 4. An ideology's own definition as answers should find that ideology
function rate(entriesOf) {
    let top1 = 0, top3 = 0, n = 0;
    labels.forEach(label => {
        const entries = entriesOf(label);
        if (!entries.length) return;
        const position = HV.rankIdeologies(answersFrom(entries)).findIndex(item => item.label === label);
        n++; if (position === 0) top1++; if (position < 3) top3++;
    });
    return { top1: top1 / n, top3: top3 / n, n };
}
const full = rate(strongest(1000));
const three = rate(strongest(3));
const pct = x => (100 * x).toFixed(1) + '%';
check(full.top1 >= 0.97, 'all stances as answers: its own ideology is first for ' + pct(full.top1) + ' (at least 97%)');
check(three.top3 >= 0.9, 'its 3 strongest stances as answers: its own ideology is in the first 3 for ' + pct(three.top3) + ' (at least 90%); first for ' + pct(three.top1));

// 5. A value left at 0 is a neutral answer. An ideology that never mentions the value is not affected by it;
//    one that holds the value strongly is pushed down
let silentChecked = 0, silentMoved = 0, strongChecked = 0, strongDropped = 0;
labels.slice(0, 60).forEach((label, index) => {
    const base = strongest(4)(labels[(index + 7) % labels.length]);
    const baseSet = new Set(base.map(pair => pair[0]));
    const free = Object.keys(categoryOf).filter(v => !baseSet.has(v) && used[v]);
    const without = {};
    HV.rankIdeologies(answersFrom(base)).forEach(item => { without[item.label] = item.rankScore; });
    // a value the ideology under test holds at 0.9 or more, and a value it never mentions
    const strongValue = free.find(v => Math.abs(stances[label][v] || 0) >= 0.9);
    const silentValue = free.find(v => stances[label][v] === undefined);
    [strongValue, silentValue].forEach(value => {
        if (!value) return;
        const withNeutral = {};
        HV.rankIdeologies(answersFrom(base.concat([[value, 0]]))).forEach(item => { withNeutral[item.label] = item.rankScore; });
        if (value === strongValue) { strongChecked++; if (withNeutral[label] < without[label]) strongDropped++; }
        labels.forEach(other => {
            if (stances[other][value] === undefined) { silentChecked++; if (Math.abs(withNeutral[other] - without[other]) > 1e-9) silentMoved++; }
        });
    });
});
check(silentChecked > 0 && silentMoved === 0, 'a neutral answer leaves every ideology that never mentions the value unchanged (' + silentChecked + ' cases)');
check(strongChecked > 0 && strongDropped === strongChecked, 'a neutral answer lowers an ideology that holds the value at 0.9 or more (' + strongDropped + ' of ' + strongChecked + ' cases)');

// 5b. Detailed users: the penalty for answering values an ideology does not list must not compound with the
// number of answers (epsilon is softened above 10 answers). Ideologies with few listed stances, answered in full and
// then with 30 more related values, must still come out first for most of them. (Before the fix: 37% with 30 extra
// answers; after: 57%.)
{
    let hits = 0, total = 0;
    labels.forEach(label => {
        const byCategory = HV.stancesByCategory(label);
        const count = Object.values(byCategory).reduce((n, list) => n + list.length, 0);
        if (count === 0 || count > 16) return;
        const answers = {};
        Object.keys(byCategory).forEach(cat => { answers[cat] = byCategory[cat].map(item => ({ value: item.value, agree: item.stance })); });
        HV.guessedValues(label, 30).forEach(g => {
            const cat = categoryOf[g.value];
            (answers[cat] = answers[cat] || []).push({ value: g.value, agree: 0.7 * g.direction });
        });
        total++;
        if (HV.rankIdeologies(answers)[0].label === label) hits++;
    });
    const share = total ? hits / total : 0;
    check(total > 100 && share >= 0.5, 'ideologies with at most 16 listed stances, answered in full plus 30 related values: own ideology first for ' + (share * 100).toFixed(1) + '% of ' + total + ' (at least 50%)');
}

// 6. Speed
const started = Date.now();
for (let i = 0; i < 50; i++) HV.rankIdeologies(answersFrom(strongest(8)(labels[i % labels.length])));
const each = (Date.now() - started) / 50;
check(each < 25, 'ranking takes ' + each.toFixed(2) + ' ms per answer set (under 25 ms)');

warnings.forEach(w => console.log('WARN  ' + w));
console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
process.exit(failures ? 1 : 0);
