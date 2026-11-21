// Shared scoring helpers for results.html, quiz.html and description.html. Load data.js first.
//
// Your answers (see loadAnswers) map a category to the values you added in it, each with how much it matches you,
// from -1 (opposite) through 0 (neutral) to +1 (match). A category you did not touch is missing.
//
// The ideologies are ranked by a Bayesian model of how a person holding an ideology would answer. Its stances
// (ideologyScores in data.js, from -1 for "opposes the value" to +1 for "matches it") are the expected answers.
// Every value you added counts as an answer, including one you left at 0 (neutral); a value you did not add is not an answer.
// For an ideology j:
//   - a value j has a stance on: your answer is that stance plus noise (normal, width tau);
//   - a value j has no stance on: you added something it never mentions, which is less likely (probability
//     epsilon_eff = epsilon ^ (m0 / max(m, m0)), where m is how many values you answered and m0 = 10, so up to
//     10 answers it is plain epsilon and with more answers each such value costs less; otherwise a detailed
//     answer set would be punished again for every value, by a factor that compounds with m, and an ideology
//     with few listed stances would lose to one with many). The stances in data.js are not complete, so for every value j does not list the page works out how
//     likely j is to support or oppose it, and how strongly (see "Guesses" below); an answer close to a likely guess
//     costs less. A neutral answer on such a value costs nothing: an ideology that never mentions a value is not
//     contradicted by someone who is neutral about it;
//   - which of j's stances you chose to answer: an ideology that lists few values and matches all of them
//     explains your answers better than one that lists many (the log of the number of possible choices).
// How wide your noise is, and how often you add values, are not known, so the model averages over several
// tau and epsilon (BAYES below) instead of picking one. The ideologies are ranked by that average likelihood,
// from the best to the worst. Adding an ideology or a value to data.js is enough: the guesses are worked out from
// the definitions and the table every time the page loads, so there is nothing to train.
// The number shown is each ideology's probability: its likelihood divided by the sum over all ideologies, with equal chances
// to start with. It is relative to the other ideologies: answers that fit none of them still give the best one a share.
// Ties go to the ideology with more values you picked that it holds, then with more values listed, then to the
// order in data.js. closestIdeologies keeps only ideologies that hold at least one value you picked.

const HV = (function () {
    const categoryOf = {};
    Object.keys(resultsMapping).forEach(cat => {
        Object.keys(resultsMapping[cat]).forEach(id => {
            if (!(id in categoryOf)) categoryOf[id] = cat;
        });
    });

    // Order of the ideologies in data.js
    const labelOrder = {};
    Object.keys(labelMapping).forEach(key => {
        const label = labelMapping[key];
        if (!(label in labelOrder)) labelOrder[label] = Object.keys(labelOrder).length;
    });

    // Stances of every ideology: { label: { value: stance } }, parsed from "value:score|value:score"
    // An ideology without scores falls back to the first of its old value sets, every value at +1.
    const stancesOf = {};
    Object.keys(labelOrder).forEach(label => {
        const stances = {};
        const text = (typeof ideologyScores !== 'undefined' && ideologyScores[label]) || '';
        text.split('|').forEach(part => {
            const at = part.lastIndexOf(':');
            if (at < 1) return;
            const value = part.slice(0, at);
            const stance = Number(part.slice(at + 1));
            if (categoryOf[value] && stance >= -1 && stance <= 1 && stance !== 0) stances[value] = stance;
        });
        if (!Object.keys(stances).length) {
            const firstKey = Object.keys(labelMapping).find(key => labelMapping[key] === label);
            if (firstKey) firstKey.split('|').forEach(value => { if (categoryOf[value]) stances[value] = 1; });
        }
        stancesOf[label] = stances;
    });

    // What the user answered: { category: [{ value, agree }] }. Answers saved by an older version
    // (one value per category) count as agreement 1.
    function loadAnswers() {
        let answers = null;
        try { answers = JSON.parse(localStorage.getItem('quizAnswers') || 'null'); } catch (e) { answers = null; }
        if (answers && typeof answers === 'object') {
            Object.keys(answers).forEach(cat => {          // a category without values counts as not touched
                if (!Array.isArray(answers[cat]) || !answers[cat].length) delete answers[cat];
            });
            return answers;
        }
        let old = {};
        try { old = JSON.parse(localStorage.getItem('quizResults') || '{}') || {}; } catch (e) { old = {}; }
        answers = {};
        Object.keys(old).forEach(cat => {
            if (old[cat]) answers[cat] = [{ value: old[cat], agree: 1 }];
        });
        return answers;
    }

    // Saves your answers, and the value you agree with most in each category, in the browser
    function saveAnswers(answers) {
        const primary = {};
        Object.keys(answers).forEach(category => {
            const value = primaryOf(answers[category]);
            if (value) primary[category] = value;
        });
        try {
            localStorage.setItem('quizAnswers', JSON.stringify(answers));
            localStorage.setItem('quizResults', JSON.stringify(primary));
        } catch (e) { /* storage is not available: nothing to save */ }
    }

    // The value you agreed with most in a category (the first one if tied), or null if you agreed with none
    function primaryOf(list) {
        let best = null;
        (list || []).forEach(item => {
            if (item.agree > 0 && (!best || item.agree > best.agree)) best = item;
        });
        return best ? best.value : null;
    }

    // An agreement or a score as text: +0.60, 0.00, \u22120.40
    function signed(number) {
        const rounded = Math.round(number * 100) / 100;
        return (rounded > 0 ? '+' : (rounded < 0 ? '\u2212' : '')) + Math.abs(rounded).toFixed(2);
    }

    // Score of one value of an ideology against your answer for it, from -1 to +1 (0 if you did not add it):
    // your agreement times the ideology's stance, so matching a value it matches or opposing one it opposes is
    // positive and the other two cases are negative
    // A probability (0 to 1) as text with one decimal, never 0% or 100% unless it is exactly so
    function percent(probability) {
        const value = Math.max(0, Math.min(1, Number(probability) || 0)) * 100;
        if (value < 0.1) return '<0.1%';
        if (value > 99.9) return '>99.9%';
        return value.toFixed(1) + '%';
    }
    function valueScore(reqVal, answers, stance) {
        const list = answers[categoryOf[reqVal]];
        const entry = list && list.find(item => item.value === reqVal);
        if (!entry) return 0;
        const given = stance === undefined ? 1 : stance;
        return Math.max(-1, Math.min(1, (Number(entry.agree) || 0) * given));
    }

    // Ring color for a score: dark red at -1, gray at 0, dark green at +1
    const RING_RED = [168, 29, 29];
    const RING_GRAY = [139, 148, 158];
    const RING_GREEN = [26, 127, 55];
    function ringColor(score) {
        const t = Math.min(1, Math.abs(score));
        const end = score < 0 ? RING_RED : RING_GREEN;
        const rgb = RING_GRAY.map((from, i) => Math.round(from + (end[i] - from) * t));
        return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    }

    // The values an ideology mentions, by category: { category: [{ value, stance }] }, strongest stance first
    // How many of the next closest ideologies the results page and the downloaded pictures show
    const CLOSEST_COUNT = 3;

    // The display name of a value (its title, or its id with spaces if it has no title)
    function nameOf(category, value) {
        return (resultsMapping[category] && resultsMapping[category][value])
            ? resultsMapping[category][value]
            : value.replace(/_/g, ' ');
    }

    // Every value of each category for the ideology page. First the values the definition lists, from the one the
    // ideology matches most (+1) to the one it opposes most (-1); then the values it does not list, from the one it
    // most likely matches to the one it most likely opposes (the guesses of the model), so that no unlisted value
    // stands between two listed ones.
    function valueOrder(label) {
        const stances = stancesOf[label] || {};
        const net = {};
        guessedValues(label, Infinity).forEach(guess => { net[guess.value] = guess.net; });
        const byScore = (a, b) => b.stance - a.stance || (a.value < b.value ? -1 : 1);
        const order = {};
        Object.keys(resultsMapping).forEach(cat => {
            const ids = Object.keys(resultsMapping[cat]);
            const listed = ids.filter(v => stances[v] !== undefined).map(v => ({ value: v, stance: stances[v], listed: true })).sort(byScore);
            const unlisted = ids.filter(v => stances[v] === undefined).map(v => ({ value: v, stance: net[v] || 0, listed: false })).sort(byScore);
            order[cat] = listed.concat(unlisted);
        });
        return order;
    }
    function stancesByCategory(label) {
        const byCategory = {};
        const stances = stancesOf[label] || {};
        Object.keys(stances).forEach(value => {
            const cat = categoryOf[value];
            if (cat) (byCategory[cat] = byCategory[cat] || []).push({ value, stance: stances[value] });
        });
        Object.keys(byCategory).forEach(cat => {
            byCategory[cat].sort((a, b) => Math.abs(b.stance) - Math.abs(a.stance));
        });
        return byCategory;
    }

    // How your answers meet the definition of an ideology: values you picked that it holds, other values of its
    // that you answered, and how many values it lists
    function countsOf(answers, label) {
        const stances = stancesOf[label] || {};
        let identicalCount = 0;
        let mismatchCount = 0;
        Object.keys(stances).forEach(value => {
            const list = answers[categoryOf[value]];
            const entry = list && list.find(item => item.value === value);
            if (!entry) return;
            if (stances[value] > 0 && Number(entry.agree) > 0) identicalCount++;
            else mismatchCount++;
        });
        return { identicalCount, mismatchCount, totalRequired: Object.keys(stances).length };
    }

    const rounded = score => Math.round(score * 1e9);

    // Higher likelihood first; then more values you picked that it holds; then more values listed.
    // Equal in all: the order in data.js decides.
    function compareItems(a, b) {
        return (rounded(b.rankScore) - rounded(a.rankScore)) ||
            (b.identicalCount - a.identicalCount) ||
            (b.totalRequired - a.totalRequired) ||
            (labelOrder[a.label] - labelOrder[b.label]);
    }

    // ---------------------------------------------------------------------------------------------
    // The Bayesian ranking (built from the stances in data.js when the page loads)
    // ---------------------------------------------------------------------------------------------

    // tau: width of the noise around a stance; epsilon: chance of adding a value an ideology never mentions
    // (softened once you answer more than M0 values: epsilon ^ (M0 / max(m, M0)), see rankIdeologies)
    // (more when the guesses say the ideology would support or oppose it); guessScale: how much of the guessed
    // chance is believed; guessWidth: how far an answer may be from the guessed stance. The model averages over all
    // combinations of tau and epsilon. The numbers come from simulated answers, not from real people.
    const BAYES = { taus: [0.15, 0.3, 0.6, 0.9], epsilons: [0.01, 0.05], guessScale: 0.25, guessWidth: 0.6, epsilonBase: 10 };


    // ---------------------------------------------------------------------------------------------
    // Guesses for the stances an ideology does not list (worked out from data.js when the page loads)
    // ---------------------------------------------------------------------------------------------
    // For an ideology j and a value v it does not list, two sources of evidence are pooled into one weighted average:
    //   - the ideologies whose names and definitions are most similar to j's (the POOL.neighbors closest, by the
    //     cosine of their TF-IDF vectors of words and word pairs): the share of them that support / oppose v;
    //   - the values j does list that go together with v in the table (the shrunk cosine of the two columns): a value
    //     that goes together with a value j supports points to support, one that goes against it points to opposition,
    //     and the other way round for a value j opposes.
    // Both are divided by their total weight plus a prior (kappa, beta) and scaled by POOL.scale, so little evidence
    // gives a small chance. The numbers come from simulated answers, not from real people.
    const POOL = { neighbors: 15, kappa: 3, beta: 3, scale: 4, shrink: 1 };
    const STOP_WORDS = new Set('a about above across after afterwards again against all almost alone along already also although always am among amongst amoungst amount an and another any anyhow anyone anything anyway anywhere are around as at back be became because become becomes becoming been before beforehand behind being below beside besides between beyond bill both bottom but by call can cannot cant co con could couldnt cry de describe detail do done down due during each eg eight either eleven else elsewhere empty enough etc even ever every everyone everything everywhere except few fifteen fifty fill find fire first five for former formerly forty found four from front full further get give go had has hasnt have he hence her here hereafter hereby herein hereupon hers herself him himself his how however hundred i ie if in inc indeed interest into is it its itself keep last latter latterly least less ltd made many may me meanwhile might mill mine more moreover most mostly move much must my myself name namely neither never nevertheless next nine no nobody none noone nor not nothing now nowhere of off often on once one only onto or other others otherwise our ours ourselves out over own part per perhaps please put rather re same see seem seemed seeming seems serious several she should show side since sincere six sixty so some somehow someone something sometime sometimes somewhere still such system take ten than that the their them themselves then thence there thereafter thereby therefore therein thereupon these they thick thin third this those though three through throughout thru thus to together too top toward towards twelve twenty two un under until up upon us very via was we well were what whatever when whence whenever where whereafter whereas whereby wherein whereupon wherever whether which while whither who whoever whole whom whose why will with within without would yet you your yours yourself yourselves'.split(' '));

    // The words of a text: lower case, without stop words, then single words and pairs of neighbouring words
    function termsOf(text) {
        const words = (text.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) || []).filter(word => !STOP_WORDS.has(word));
        const terms = words.slice();
        for (let i = 0; i + 1 < words.length; i++) terms.push(words[i] + ' ' + words[i + 1]);
        return terms;
    }

    // Cosine similarity between texts (TF-IDF: 1 + ln count, ln((1 + n) / (1 + df)) + 1, length 1): an n by n array
    function textSimilarity(texts) {
        const n = texts.length;
        const counts = texts.map(text => { const m = new Map(); termsOf(text).forEach(t => m.set(t, (m.get(t) || 0) + 1)); return m; });
        const df = new Map();
        counts.forEach(m => m.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
        const id = new Map();
        df.forEach((_, t) => id.set(t, id.size));
        const vectors = counts.map(m => {
            const entries = [];
            let norm = 0;
            m.forEach((count, t) => {
                const w = (1 + Math.log(count)) * (Math.log((1 + n) / (1 + df.get(t))) + 1);
                entries.push([id.get(t), w]);
                norm += w * w;
            });
            entries.sort((x, y) => x[0] - y[0]);
            norm = Math.sqrt(norm) || 1;
            return { idx: Int32Array.from(entries, e => e[0]), val: Float64Array.from(entries, e => e[1] / norm) };
        });
        const sim = Array.from({ length: n }, () => new Float64Array(n));
        for (let a = 0; a < n; a++) {
            for (let b = a + 1; b < n; b++) {
                const x = vectors[a], y = vectors[b];
                let i = 0, j = 0, dot = 0;
                while (i < x.idx.length && j < y.idx.length) {
                    if (x.idx[i] === y.idx[j]) { dot += x.val[i] * y.val[j]; i++; j++; }
                    else if (x.idx[i] < y.idx[j]) i++;
                    else j++;
                }
                sim[a][b] = dot;
                sim[b][a] = dot;
            }
        }
        return sim;
    }

    // plus[j][i] / minus[j][i]: the chance that ideology j supports / opposes value i, for the values it does not list
    function pooledGuesses(labels, V, stance) {
        const N = labels.length;
        const text = labels.map(label => label.replace(/-/g, ' ') + ' . ' + ((typeof descriptions !== 'undefined' && descriptions[label]) || ''));
        const sim = textSimilarity(text);
        const neighbours = labels.map((_, j) => {
            const order = [];
            for (let l = 0; l < N; l++) if (l !== j) order.push(l);
            order.sort((x, y) => (sim[j][y] - sim[j][x]) || (x - y));
            const top = order.slice(0, POOL.neighbors).map(l => [l, Math.max(0, sim[j][l])]);
            const total = top.reduce((sum, pair) => sum + pair[1], 0) + 1e-9;
            return top.map(pair => [pair[0], pair[1] / total]);
        });

        // How the values go together: the shrunk cosine of their columns, split into together (up) and against (down)
        const norm = new Float64Array(V);
        const gram = new Float64Array(V * V);
        stance.forEach(row => {
            const own = [];
            for (let i = 0; i < V; i++) if (row[i] !== 0) { own.push(i); norm[i] += row[i] * row[i]; }
            own.forEach(u => own.forEach(v => { gram[u * V + v] += row[u] * row[v]; }));
        });
        const up = new Float64Array(V * V);
        const down = new Float64Array(V * V);
        for (let u = 0; u < V; u++) {
            for (let v = 0; v < V; v++) {
                if (u === v) continue;
                const a = gram[u * V + v] / (Math.sqrt(norm[u]) * Math.sqrt(norm[v]) + POOL.shrink);
                if (a > 0) up[u * V + v] = a; else if (a < 0) down[u * V + v] = -a;
            }
        }

        const plus = [], minus = [];
        for (let j = 0; j < N; j++) {
            const row = stance[j];
            const own = [];
            for (let i = 0; i < V; i++) if (row[i] !== 0) own.push(i);
            const p = new Float64Array(V), q = new Float64Array(V);
            for (let v = 0; v < V; v++) {
                if (row[v] !== 0) continue;
                let numPlus = 0, numMinus = 0;
                neighbours[j].forEach(pair => {
                    const s = stance[pair[0]][v];
                    if (s > 0) numPlus += POOL.kappa * pair[1]; else if (s < 0) numMinus += POOL.kappa * pair[1];
                });
                let mass = 0;
                own.forEach(u => {
                    const s = row[u];
                    const upward = up[u * V + v], downward = down[u * V + v];
                    if (s > 0) { numPlus += s * upward; numMinus += s * downward; } else { numPlus += -s * downward; numMinus += -s * upward; }
                    mass += upward + downward;
                });
                const den = POOL.kappa + mass + POOL.beta;
                let a = Math.min(1, Math.max(0, POOL.scale * numPlus / den));
                let b = Math.min(1, Math.max(0, POOL.scale * numMinus / den));
                if (a + b > 1) { const total = a + b; a /= total; b /= total; }
                p[v] = a;
                q[v] = b;
            }
            plus.push(p);
            minus.push(q);
        }
        return { plus, minus };
    }

    const model = (function () {
        const labels = Object.keys(labelOrder);
        const values = Object.keys(categoryOf);
        const valueIndex = {};
        values.forEach((value, i) => { valueIndex[value] = i; });
        const N = labels.length;
        const V = values.length;
        const stance = labels.map(label => {
            const row = new Float64Array(V);
            const own = stancesOf[label] || {};
            Object.keys(own).forEach(value => { if (value in valueIndex) row[valueIndex[value]] = own[value]; });
            return row;
        });
        const listed = stance.map(row => row.reduce((count, s) => count + (s !== 0 ? 1 : 0), 0));

        // Typical size of a stance that supports / opposes
        let plusSum = 0, plusCount = 0, minusSum = 0, minusCount = 0;
        stance.forEach(row => row.forEach(s => {
            if (s > 0) { plusSum += s; plusCount++; } else if (s < 0) { minusSum -= s; minusCount++; }
        }));
        const typicalPlus = plusCount ? plusSum / plusCount : 0.6;
        const typicalMinus = minusCount ? minusSum / minusCount : 0.8;

        // The guesses (see above), for every value an ideology does not list: the chance that it supports / opposes it
        const { plus, minus } = pooledGuesses(labels, V, stance);
        const guessing = true;

        const logFactorial = [0];
        for (let k = 1; k <= V; k++) logFactorial[k] = logFactorial[k - 1] + Math.log(k);

        return { labels, values, valueIndex, N, V, stance, listed, plus, minus, typicalPlus, typicalMinus, guessing, logFactorial };
    })();

    // Every ideology, best first. rankScore: ln of the average likelihood; probability: its share among all
    // ideologies (equal chances to start with), 0 to 1
    function rankIdeologies(answers) {
        const given = [];
        Object.keys(answers).forEach(cat => (answers[cat] || []).forEach(item => {
            const i = model.valueIndex[item.value];
            const level = Number(item.agree);
            if (i === undefined || item.agree === null || item.agree === undefined || !Number.isFinite(level)) return;
            given.push([i, Math.max(-1, Math.min(1, level))]);
        }));
        const { labels, N, stance, listed, plus, minus, typicalPlus, typicalMinus, logFactorial } = model;
        const taus = BAYES.taus;
        // epsilon_eff = epsilon ^ (m0 / max(m, m0)): unchanged for up to m0 answers, softer for more
        const exponent = BAYES.epsilonBase / Math.max(given.length, BAYES.epsilonBase);
        const epsilons = BAYES.epsilons.map(epsilon => Math.pow(epsilon, exponent));
        const widths = taus.map(tau => tau * tau + BAYES.guessWidth * BAYES.guessWidth);
        const rank = new Array(N);
        const silent = new Float64Array(taus.length * epsilons.length);

        for (let j = 0; j < N; j++) {
            let matched = 0;
            let squares = 0;
            silent.fill(0);
            for (let g = 0; g < given.length; g++) {
                const i = given[g][0];
                const x = given[g][1];
                const s = stance[j][i];
                if (s !== 0) {
                    matched++;
                    squares += (x - s) * (x - s);
                } else if (x !== 0) {
                    const p = plus[j][i];
                    const q = minus[j][i];
                    for (let t = 0; t < taus.length; t++) {
                        let guess = 0;
                        if (p > 0 || q > 0) {
                            guess = BAYES.guessScale * 2 / Math.sqrt(2 * Math.PI * widths[t]) *
                                (p * Math.exp(-(x - typicalPlus) * (x - typicalPlus) / (2 * widths[t])) +
                                 q * Math.exp(-(x + typicalMinus) * (x + typicalMinus) / (2 * widths[t])));
                        }
                        for (let e = 0; e < epsilons.length; e++) silent[t * epsilons.length + e] += Math.log(Math.min(50, epsilons[e] + guess));
                    }
                }
            }
            let likelihood = 0;
            if (given.length) {
                const choice = -(logFactorial[listed[j]] - logFactorial[matched] - logFactorial[listed[j] - matched]);
                const terms = [];
                taus.forEach((tau, t) => {
                    const perMatch = -Math.log(tau) - 0.5 * Math.log(2 * Math.PI) + Math.log(2);
                    for (let e = 0; e < epsilons.length; e++) {
                        terms.push(-squares / (2 * tau * tau) + matched * perMatch + silent[t * epsilons.length + e] + choice);
                    }
                });
                const top = Math.max.apply(null, terms);
                likelihood = top + Math.log(terms.reduce((sum, t) => sum + Math.exp(t - top), 0)) - Math.log(terms.length);
            }
            rank[j] = { label: labels[j], rankScore: likelihood };
        }

        const best = Math.max.apply(null, rank.map(item => item.rankScore));
        const total = rank.reduce((sum, item) => sum + Math.exp(item.rankScore - best), 0);
        return rank
            .map(item => Object.assign(countsOf(answers, item.label), {
                key: item.label,
                label: item.label,
                rankScore: item.rankScore,
                probability: Math.exp(item.rankScore - best) / total
            }))
            .sort(compareItems);
    }

    // The values an ideology does not list that it is most likely to hold, from the guesses:
    // [{ value, probability, direction (+1 supports, -1 opposes) }]
    function guessedValues(label, count) {
        const j = model.labels.indexOf(label);
        if (j < 0) return [];
        const result = [];
        for (let i = 0; i < model.V; i++) {
            const p = model.plus[j][i] + model.minus[j][i];
            if (p > 0) result.push({ value: model.values[i], probability: p, net: model.plus[j][i] - model.minus[j][i], direction: model.plus[j][i] >= model.minus[j][i] ? 1 : -1 });
        }
        return result.sort((x, y) => y.probability - x.probability).slice(0, count || 10);
    }

    // The best ideologies other than excludeLabel; each must have at least one of your values
    function closestIdeologies(answers, excludeLabel, count) {
        return rankIdeologies(answers)
            .filter(item => item.label !== excludeLabel && item.identicalCount > 0)
            .slice(0, count);
    }

    return {
        categoryOf, loadAnswers, saveAnswers, primaryOf, signed, percent, stancesByCategory, valueOrder, nameOf, CLOSEST_COUNT, rankIdeologies, closestIdeologies,
        guessedValues, valueScore, ringColor
    };
})();
