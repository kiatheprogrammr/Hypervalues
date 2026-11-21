/*
 * Insights built on the ranking in scoring.js: why a result came out as it did, how well each ideology fits you
 * per category, and a 2D map of all ideologies. Load data.js and scoring.js first (linebreak.js for names).
 *
 * Data functions (no page needed, also used by tools/check_share.js):
 *   HVInsights.explain(answers, label)         values pulling you toward / away from an ideology
 *   HVInsights.differences(answers, a, b)      values that separate two ideologies for you
 *   HVInsights.categoryFit(answers, label)     { category: -1..+1 or null }
 *   HVInsights.map()                           positions of all ideologies on two axes
 *   HVInsights.place(answers)                  where your answers sit on that map
 *   HVInsights.overlap(answersA, answersB)     how alike two sets of answers are
 * Renderers (DOM): renderExplainer, renderRadar, renderMap, renderTiles, renderHeadline.
 */
const HVInsights = (function () {
    const NS = 'http://www.w3.org/2000/svg';

    const labels = [];
    Object.keys(labelMapping).forEach(key => { if (!labels.includes(labelMapping[key])) labels.push(labelMapping[key]); });
    const valueIds = Object.keys(HV.categoryOf);
    const valueIndex = {};
    valueIds.forEach((id, i) => { valueIndex[id] = i; });

    const colorOf = label => (labelColors[label] || '#7a7a7a').slice(0, 7);

    function entryOf(answers, value) {
        const list = answers[HV.categoryOf[value]];
        return list && list.find(item => item.value === value);
    }

    // ---------------------------------------------------------------------------------------------
    // Why this result
    // ---------------------------------------------------------------------------------------------
    // ---------------------------------------------------------------------------------------------
    // The matrix: a score from -1 to +1 for every ideology and every value (ideology_matrix.js)
    // ---------------------------------------------------------------------------------------------
    const BAND = 0.1;                    // a fit within this distance of 0 is neutral
    const MATRIX = typeof IDEOLOGY_MATRIX !== 'undefined' ? IDEOLOGY_MATRIX : null;
    const matrixIndex = {};
    if (MATRIX) MATRIX.values.forEach((id, i) => { matrixIndex[id] = i; });

    // { score, basis }: S stated in the ideology's definition, E estimated from similar ideologies, N none (0), M set by hand
    function score(label, value) {
        const row = MATRIX && MATRIX.ideologies[label];
        const i = matrixIndex[value];
        if (!row || i === undefined) return { score: 0, basis: 'N' };
        return { score: row.s[i], basis: row.b[i] };
    }

    // Your answer against an ideology's score. fit = answer x score, from -1 to +1: above +BAND the value aligns,
    // below -BAND it conflicts (answer +1 against score -1 is a fit of -1, a strong conflict), otherwise neutral.
    function alignment(agree, scoreValue) {
        const fit = Math.max(-1, Math.min(1, (Number(agree) || 0) * (Number(scoreValue) || 0)));
        const size = Math.abs(fit);
        return { fit, kind: fit > BAND ? 'align' : fit < -BAND ? 'conflict' : 'neutral', strength: size >= 0.6 ? 'strong' : size >= 0.3 ? 'moderate' : 'slight' };
    }

    // An ideology written as answers: its score for every value (basis says where each score comes from)
    function ideologyAnswers(label) {
        const answers = {};
        valueIds.forEach(value => {
            const s = score(label, value);
            const cat = HV.categoryOf[value];
            (answers[cat] = answers[cat] || []).push({ value, agree: s.score, basis: s.basis });
        });
        return answers;
    }

    // ---------------------------------------------------------------------------------------------
    // Why this result: every value you answered against the ideology's score for it
    // ---------------------------------------------------------------------------------------------
    function explain(answers, label) {
        const toward = [], away = [], flat = [], missing = [];
        const answered = new Set();
        Object.keys(answers).forEach(cat => (answers[cat] || []).forEach(item => {
            if (!(item.value in HV.categoryOf)) return;
            answered.add(item.value);
            const s = score(label, item.value);
            const agree = Number(item.agree) || 0;
            const a = alignment(agree, s.score);
            const row = { category: HV.categoryOf[item.value], value: item.value, agree, stance: s.score, score: a.fit, basis: s.basis, kind: a.kind, strength: a.strength };
            (a.kind === 'align' ? toward : a.kind === 'conflict' ? away : flat).push(row);
        }));
        // values the ideology states a position on that you have not answered: kept apart, never counted as conflicts
        const stated = HV.stancesByCategory(label);
        Object.keys(stated).forEach(cat => stated[cat].forEach(item => {
            if (!answered.has(item.value)) missing.push({ category: cat, value: item.value, stance: item.stance });
        }));
        toward.sort((x, y) => y.score - x.score);
        away.sort((x, y) => x.score - y.score);
        flat.sort((x, y) => Math.abs(y.stance) - Math.abs(x.stance));
        missing.sort((x, y) => Math.abs(y.stance) - Math.abs(x.stance));
        return { toward, away, flat, missing };
    }

    // For your answers, what separates two ideologies: values where `a` fits better than `b`, and the other way round
    function differences(answers, a, b) {
        const aBetter = [], bBetter = [];
        Object.keys(answers).forEach(cat => (answers[cat] || []).forEach(item => {
            if (!(item.value in HV.categoryOf)) return;
            const agree = Number(item.agree) || 0;
            const fa = alignment(agree, score(a, item.value).score).fit;
            const fb = alignment(agree, score(b, item.value).score).fit;
            const gap = fa - fb;
            const row = { category: cat, value: item.value, agree, gap, fitA: fa, fitB: fb };
            if (gap > BAND) aBetter.push(row); else if (gap < -BAND) bBetter.push(row);
        }));
        aBetter.sort((x, y) => y.gap - x.gap);
        bBetter.sort((x, y) => x.gap - y.gap);
        return { aBetter, bBetter };
    }

    // Average fit over the values you answered in a category that the ideology lists; null if there are none
    function categoryFit(answers, label) {
        const byCategory = HV.stancesByCategory(label);
        const result = {};
        categories.forEach(cat => {
            let sum = 0, count = 0;
            (byCategory[cat] || []).forEach(item => {
                if (!entryOf(answers, item.value)) return;
                sum += HV.valueScore(item.value, answers, item.stance);
                count++;
            });
            result[cat] = count ? sum / count : null;
        });
        return result;
    }

    // ---------------------------------------------------------------------------------------------
    // The map: a principal component analysis of the stance table, two axes
    // ---------------------------------------------------------------------------------------------
    let mapCache = null;
    function map() {
        if (mapCache) return mapCache;
        const N = labels.length, V = valueIds.length;
        const rows = labels.map(label => {
            const row = new Float64Array(V);
            const byCategory = HV.stancesByCategory(label);
            Object.keys(byCategory).forEach(cat => byCategory[cat].forEach(item => { row[valueIndex[item.value]] = item.stance; }));
            return row;
        });
        const mean = new Float64Array(V);
        rows.forEach(row => { for (let i = 0; i < V; i++) mean[i] += row[i] / N; });
        const centered = rows.map(row => Float64Array.from(row, (x, i) => x - mean[i]));

        // covariance, then the two strongest directions by power iteration (a fixed start, so the map never changes)
        const cov = Array.from({ length: V }, () => new Float64Array(V));
        centered.forEach(row => {
            for (let i = 0; i < V; i++) {
                if (row[i] === 0) continue;
                for (let j = 0; j < V; j++) cov[i][j] += row[i] * row[j] / N;
            }
        });
        const axes = [];
        for (let k = 0; k < 2; k++) {
            let v = Float64Array.from({ length: V }, (_, i) => 1 + ((i * 7919) % 13) / 13);
            for (let step = 0; step < 300; step++) {
                const next = new Float64Array(V);
                for (let i = 0; i < V; i++) { let sum = 0; for (let j = 0; j < V; j++) sum += cov[i][j] * v[j]; next[i] = sum; }
                axes.forEach(a => {                                          // stay orthogonal to the first axis
                    let dot = 0;
                    for (let i = 0; i < V; i++) dot += next[i] * a[i];
                    for (let i = 0; i < V; i++) next[i] -= dot * a[i];
                });
                let norm = 0;
                for (let i = 0; i < V; i++) norm += next[i] * next[i];
                norm = Math.sqrt(norm) || 1;
                for (let i = 0; i < V; i++) v[i] = next[i] / norm;
            }
            let big = 0;                                                     // the sign: the largest loading is positive
            for (let i = 0; i < V; i++) if (Math.abs(v[i]) > Math.abs(v[big])) big = i;
            if (v[big] < 0) v = v.map(x => -x);
            axes.push(v);
        }
        const project = row => axes.map(a => { let s = 0; for (let i = 0; i < V; i++) s += (row[i] - mean[i]) * a[i]; return s; });
        const points = centered.map((_, j) => project(rows[j]));
        const ends = axes.map(a => {                                         // the values that define each end of an axis
            const order = valueIds.map((id, i) => ({ id, loading: a[i] })).sort((x, y) => y.loading - x.loading);
            return { high: order.slice(0, 3).map(o => o.id), low: order.slice(-3).reverse().map(o => o.id) };
        });
        mapCache = { points, ends, project, mean, V, axes };
        return mapCache;
    }

    // You: the centre of your closest ideologies, weighted by their probability
    function place(answers, count) {
        const m = map();
        const ranked = HV.rankIdeologies(answers).slice(0, count || 5);
        const total = ranked.reduce((sum, item) => sum + item.probability, 0) || 1;
        const xy = [0, 0];
        ranked.forEach(item => {
            const p = m.points[labels.indexOf(item.label)];
            xy[0] += p[0] * item.probability / total;
            xy[1] += p[1] * item.probability / total;
        });
        return xy;
    }

    // How alike two sets of answers are: the overlap of their ideology probabilities (0 to 1) and, on the values both
    // answered, the average closeness (1 = same answer, 0 = opposite answers)
    function overlap(a, b) {
        const ra = HV.rankIdeologies(a), rb = HV.rankIdeologies(b);
        const pb = {};
        rb.forEach(item => { pb[item.label] = item.probability; });
        let ideology = 0;
        ra.forEach(item => { ideology += Math.sqrt(item.probability * (pb[item.label] || 0)); });
        const closeness = [];
        Object.keys(a).forEach(cat => (a[cat] || []).forEach(item => {
            const other = entryOf(b, item.value);
            if (other) closeness.push(1 - Math.abs((Number(item.agree) || 0) - (Number(other.agree) || 0)) / 2);
        }));
        return {
            ideology,
            values: closeness.length ? closeness.reduce((x, y) => x + y, 0) / closeness.length : null,
            sharedValues: closeness.length,
            rankedA: ra, rankedB: rb
        };
    }

    return { labels, valueIds, colorOf, entryOf, score, alignment, ideologyAnswers, explain, differences, categoryFit, map, place, overlap, NS, BAND };
})();

// -------------------------------------------------------------------------------------------------
// Renderers
// -------------------------------------------------------------------------------------------------
(function () {
    const NS = HVInsights.NS;
    const colorOf = HVInsights.colorOf;

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }
    function svgEl(tag, attrs) {
        const node = document.createElementNS(NS, tag);
        Object.keys(attrs || {}).forEach(key => node.setAttribute(key, attrs[key]));
        return node;
    }
    function putName(node, text) { if (typeof setName === 'function') setName(node, text); else node.textContent = text; }
    const pct = p => HV.percent(p);

    // ---- a value as a small pill: icon (ringed by fit), name, numbers ---------------------------------
    function chip(row, extra) {
        const link = el('a', 'ins-chip');
        link.href = `description.html?id=${encodeURIComponent(row.value)}&cat=${encodeURIComponent(row.category)}`;
        const img = el('img', 'ins-chip-icon');
        img.src = `icons/${row.category}/${row.value}.svg`;
        img.alt = '';
        if (row.score !== undefined) img.style.boxShadow = `0 0 0 2px var(--card-bg), 0 0 0 4px ${HV.ringColor(row.score)}`;
        img.onerror = () => { img.style.display = 'none'; };
        const text = el('span', 'ins-chip-text');
        text.append(el('span', 'ins-chip-name', HV.nameOf(row.category, row.value)));
        if (extra) text.append(el('span', 'ins-chip-note', extra));
        link.append(img, text);
        return link;
    }

    function chipGroup(title, rows, noteOf, emptyText, limit) {
        const group = el('section', 'ins-group');
        group.append(el('h3', 'ins-group-title', `${title} (${rows.length})`));
        if (!rows.length) { group.append(el('p', 'ins-empty', emptyText)); return group; }
        const list = el('div', 'ins-chips');
        const draw = all => {
            list.innerHTML = '';
            (all ? rows : rows.slice(0, limit)).forEach(row => list.append(chip(row, noteOf(row))));
            if (!all && rows.length > limit) {
                const more = el('button', 'ins-more', `Show all ${rows.length}`);
                more.type = 'button';
                more.onclick = () => draw(true);
                list.append(more);
            }
        };
        draw(false);
        group.append(list);
        return group;
    }

    // who: 'you' (default) for your own results, 'they' for a result somebody shared with you
    function words(options) {
        return options && options.who === 'they'
            ? { subj: 'they', obj: 'them', poss: 'their', of: 'of theirs' }
            : { subj: 'you', obj: 'you', poss: 'your', of: 'of yours' };
    }

    // ---- why this result -------------------------------------------------------------------------
    // ranked: the ideologies to explain, best first (each { label, probability })
    function renderExplainer(container, answers, ranked, options) {
        container.innerHTML = '';
        if (!ranked.length) return;
        const W = words(options);
        const best = ranked[0];
        const heading = el('h2', 'ins-heading', 'Why this result?');
        const intro = el('p', 'ins-intro', `Each value ${W.subj} added is compared with what an ideology stands for. A value pulls ${W.obj} toward an ideology when ${W.subj} and the ideology lean the same way, and away from it when ${W.subj} lean opposite ways.`);
        const formula = el('p', 'ins-intro ins-formula');
        formula.append(el('strong', '', 'How the score works: '),
            `fit = ${W.poss} answer × the ideology's score for that value, both from −1 to +1. A fit of +1.00 is a strong alignment, −1.00 a strong conflict (for example an answer of +1 against a score of −1), and anything within ±${HVInsights.BAND.toFixed(2)} counts as neutral. A score marked "estimated" is not stated in the ideology's definition but guessed from similar ideologies. The ranking itself uses a fuller probability model; this is a value-by-value reading of the same answers.`);
        const tabs = el('div', 'ins-tabs');
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', 'Ideology to explain');
        const panel = el('div', 'ins-panel');
        panel.setAttribute('role', 'tabpanel');
        container.append(heading, intro, formula, tabs, panel);

        const buttons = [];
        function show(index) {
            const item = ranked[index];
            buttons.forEach((b, i) => {
                b.setAttribute('aria-selected', i === index ? 'true' : 'false');
                b.tabIndex = i === index ? 0 : -1;
            });
            panel.setAttribute('aria-labelledby', buttons[index].id);
            panel.innerHTML = '';
            const info = HVInsights.explain(answers, item.label);

            const summary = el('p', 'ins-summary');
            summary.append(el('strong', '', item.label), ` fits ${W.obj} at ${pct(item.probability)}. `,
                `${info.toward.length} of ${W.poss} values pull ${W.obj} toward it`,
                info.away.length ? ` and ${info.away.length} pull ${W.obj} away from it.` : `, and none pull ${W.obj} away.`);
            panel.append(summary);

            const noteFor = r => `${W.subj} ${HV.signed(r.agree)}, it ${HV.signed(r.stance)}${r.basis === 'E' ? ' (estimated)' : ''}, ${r.strength} ${r.kind === 'align' ? 'alignment' : 'conflict'}`;
            const columns = el('div', 'ins-columns');
            columns.append(
                chipGroup(`Pulling ${W.obj} toward it`, info.toward, noteFor, `None of ${W.poss} values lean the same way as this ideology.`, 8),
                chipGroup(`Pulling ${W.obj} away`, info.away, noteFor, `Nothing ${W.subj} added works against this ideology.`, 8)
            );
            panel.append(columns);

            if (index > 0) {
                const diff = HVInsights.differences(answers, item.label, best.label);
                const versus = el('div', 'ins-columns');
                versus.append(
                    chipGroup(`Fits you better than ${best.label}`, diff.aBetter.slice(0, 5), r => `fit ${HV.signed(r.fitA)} against ${HV.signed(r.fitB)}`, `No value ${W.of} favors ${item.label} over ${best.label}.`, 5),
                    chipGroup(`${best.label} fits you better`, diff.bBetter.slice(0, 5), r => `fit ${HV.signed(r.fitB)} against ${HV.signed(r.fitA)}`, `No value ${W.of} favors ${best.label} over ${item.label}.`, 5)
                );
                panel.append(el('h3', 'ins-subheading', `What separates it from ${best.label}`), versus);
            }

            if (info.missing.length) {
                const rows = info.missing.slice(0, 8).map(r => Object.assign({}, r, { score: undefined }));
                panel.append(chipGroup(`Values it holds that ${W.subj} have not added`, rows, r => `it ${HV.signed(r.stance)}`, '', 8));
            }
            if (info.flat.length) {
                panel.append(el('p', 'ins-note', `${info.flat.length} of ${W.poss} answered values ${info.flat.length === 1 ? 'is' : 'are'} neutral for this ideology (fit within ±${HVInsights.BAND.toFixed(2)}).`));
            }
            if (!options || options.compare !== false) {
                const open = el('a', 'ins-linkbtn', `Compare ${W.obj} with ${item.label} value by value`);
                open.href = `compare.html#i=${encodeURIComponent(item.label)}`;
                panel.append(open);
            }
        }

        ranked.forEach((item, index) => {
            const button = el('button', 'ins-tab');
            button.type = 'button';
            button.id = `ins-tab-${index}`;
            button.setAttribute('role', 'tab');
            button.style.setProperty('--tab-color', colorOf(item.label));
            button.append(el('span', 'ins-tab-rank', `${index + 1}.`), ' ', el('span', '', item.label));
            button.onclick = () => show(index);
            button.onkeydown = event => {
                const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                if (!step) return;
                event.preventDefault();
                const next = (index + step + ranked.length) % ranked.length;
                show(next);
                buttons[next].focus();
            };
            buttons.push(button);
            tabs.append(button);
        });
        show(0);
    }

    // ---- fit per category (radar) ----------------------------------------------------------------
    function renderRadar(container, answers, matches, options) {
        container.innerHTML = '';
        if (!matches.length) return;
        const P = words(options);
        container.append(el('h2', 'ins-heading', 'Fit by category'));
        container.append(el('p', 'ins-intro', `How well each of ${P.poss} closest ideologies matches the values ${P.subj} added in each category. The outer ring is a full match, the middle ring is neutral, and the center is a full clash. A hollow dot means ${P.subj} have no value in that category that the ideology lists.`));

        const W = 520, H = 440, cx = W / 2, cy = 215, R = 140;
        const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ins-svg', role: 'img' });
        const angleOf = k => -Math.PI / 2 + k * 2 * Math.PI / categories.length;
        const at = (k, r) => [cx + r * Math.cos(angleOf(k)), cy + r * Math.sin(angleOf(k))];

        [0.5, 1].forEach(f => {
            const ring = svgEl('polygon', { points: categories.map((_, k) => at(k, R * f).join(',')).join(' '), class: f === 0.5 ? 'ins-ring ins-ring-mid' : 'ins-ring' });
            svg.append(ring);
        });
        categories.forEach((cat, k) => {
            const [x, y] = at(k, R);
            svg.append(svgEl('line', { x1: cx, y1: cy, x2: x, y2: y, class: 'ins-spoke' }));
            const [lx, ly] = at(k, R + 18);
            const cos = Math.cos(angleOf(k));
            const anchor = Math.abs(cos) < 0.2 ? 'middle' : (cos > 0 ? 'start' : 'end');
            const words = (categoryTitles[cat] || cat).split(' ');
            const text = svgEl('text', { x: lx, y: ly, 'text-anchor': anchor, class: 'ins-axis-label', 'dominant-baseline': 'middle' });
            const lines = words.length > 1 ? [words[0], words.slice(1).join(' ')] : words;
            lines.forEach((line, i) => {
                const span = svgEl('tspan', { x: lx, dy: i === 0 ? (lines.length > 1 ? '-0.55em' : '0') : '1.1em' });
                span.textContent = line;
                text.append(span);
            });
            svg.append(text);
        });
        const dashes = ['', '7 4', '2 4'];
        const table = el('table', 'sr-only');
        const head = el('tr');
        head.append(el('th', '', 'Category'));
        matches.forEach(m => head.append(el('th', '', m.label)));
        table.append(head);
        const fits = matches.map(m => HVInsights.categoryFit(answers, m.label));
        matches.forEach((m, i) => {
            const pts = categories.map((cat, k) => at(k, R * ((fits[i][cat] === null ? 0 : fits[i][cat]) + 1) / 2));
            const color = colorOf(m.label);
            svg.append(svgEl('polygon', { points: pts.map(p => p.join(',')).join(' '), fill: color, 'fill-opacity': '0.14', stroke: color, 'stroke-width': '2.5', 'stroke-dasharray': dashes[i % dashes.length], 'stroke-linejoin': 'round' }));
            pts.forEach((p, k) => {
                const none = fits[i][categories[k]] === null;
                svg.append(svgEl('circle', { cx: p[0], cy: p[1], r: 4, fill: none ? '' : color, stroke: color, 'stroke-width': 2, class: none ? 'ins-hollow' : '' }));
            });
        });
        categories.forEach(cat => {
            const row = el('tr');
            row.append(el('th', '', categoryTitles[cat] || cat));
            fits.forEach(f => row.append(el('td', '', f[cat] === null ? 'no data' : HV.signed(f[cat]))));
            table.append(row);
        });
        svg.setAttribute('aria-label', `Radar chart of how well ${P.poss} closest ideologies fit ${P.obj} in each category. The same numbers are in the table below the chart.`);
        const wrap = el('div', 'ins-chart');
        wrap.append(svg);
        container.append(wrap);

        const legend = el('ul', 'ins-legend');
        matches.forEach((m, i) => {
            const item = el('li');
            const key = svgEl('svg', { width: 34, height: 10, 'aria-hidden': 'true' });
            key.append(svgEl('line', { x1: 0, y1: 5, x2: 34, y2: 5, stroke: colorOf(m.label), 'stroke-width': 3, 'stroke-dasharray': dashes[i % dashes.length] }));
            item.append(key, ' ', `${i + 1}. ${m.label}`);
            legend.append(item);
        });
        container.append(legend, table);
    }

    // ---- the map of all ideologies ---------------------------------------------------------------
    // people: [{ name, answers }]; one person is "You", two are the two sides of a comparison
    function renderMap(container, people, options) {
        container.innerHTML = '';
        const settings = options || {};
        container.append(el('h2', 'ins-heading', settings.title || 'Map of ideologies'));
        container.append(el('p', 'ins-intro', settings.intro || 'Every ideology placed by how similar its stances are: ideologies that hold alike values sit close together. Tap or hover a dot to see its name.'));

        const m = HVInsights.map();
        const W = 640, H = 440, pad = 34;
        const marks = people.map(p => ({ name: p.name, xy: p.point || HVInsights.place(p.answers), top: p.point ? (p.label ? [p.label] : []) : HV.rankIdeologies(p.answers).slice(0, 3).map(r => r.label) }));
        const xs = m.points.map(p => p[0]).concat(marks.map(k => k.xy[0]));
        const ys = m.points.map(p => p[1]).concat(marks.map(k => k.xy[1]));
        const lo = [Math.min.apply(null, xs), Math.min.apply(null, ys)];
        const hi = [Math.max.apply(null, xs), Math.max.apply(null, ys)];
        const sx = v => pad + (v - lo[0]) / ((hi[0] - lo[0]) || 1) * (W - 2 * pad);
        const sy = v => H - pad - (v - lo[1]) / ((hi[1] - lo[1]) || 1) * (H - 2 * pad);

        const wrap = el('div', 'ins-chart ins-map-wrap');
        const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ins-svg ins-map', role: 'img' });
        svg.setAttribute('aria-label', `Map of ${HVInsights.labels.length} ideologies. ${marks.map(k => `${k.name} sits near ${k.top.join(', ')}.`).join(' ')}`);
        svg.append(svgEl('rect', { x: 0.5, y: 0.5, width: W - 1, height: H - 1, rx: 14, class: 'ins-map-frame' }));

        const highlighted = new Set();
        marks.forEach(k => k.top.forEach(label => highlighted.add(label)));
        HVInsights.labels.forEach((label, j) => {
            if (highlighted.has(label)) return;
            svg.append(svgEl('circle', { cx: sx(m.points[j][0]), cy: sy(m.points[j][1]), r: 4, fill: colorOf(label), 'fill-opacity': '0.8', class: 'ins-dot' }));
        });
        HVInsights.labels.forEach((label, j) => {
            if (!highlighted.has(label)) return;
            const x = sx(m.points[j][0]), y = sy(m.points[j][1]);
            svg.append(svgEl('circle', { cx: x, cy: y, r: 6.5, fill: colorOf(label), class: 'ins-dot ins-dot-hot' }));
            const text = svgEl('text', { x: x + 9, y: y - 8, class: 'ins-map-label' });
            text.textContent = label;
            svg.append(text);
        });
        if (marks.length === 2) {
            svg.append(svgEl('line', { x1: sx(marks[0].xy[0]), y1: sy(marks[0].xy[1]), x2: sx(marks[1].xy[0]), y2: sy(marks[1].xy[1]), class: 'ins-link' }));
        }
        marks.forEach((k, i) => {
            const x = sx(k.xy[0]), y = sy(k.xy[1]);
            const shape = i === 0
                ? svgEl('path', { d: `M${x},${y - 11} L${x + 11},${y} L${x},${y + 11} L${x - 11},${y} Z`, class: 'ins-you' })
                : svgEl('rect', { x: x - 8.5, y: y - 8.5, width: 17, height: 17, class: 'ins-you ins-you-b' });
            svg.append(shape);
            const text = svgEl('text', { x: x + 15, y: y + 18, class: 'ins-you-label' });
            text.textContent = k.name;
            svg.append(text);
        });

        // the nearest dot under the pointer
        const tip = el('div', 'ins-tip');
        tip.hidden = true;
        const tipLink = el('a', 'ins-tip-link');
        tip.append(tipLink);
        wrap.append(svg, tip);
        function nearest(event) {
            const box = svg.getBoundingClientRect();
            const px = (event.clientX - box.left) / box.width * W;
            const py = (event.clientY - box.top) / box.height * H;
            let best = -1, bestDistance = 14 * 14;
            m.points.forEach((p, j) => {
                const d = (sx(p[0]) - px) ** 2 + (sy(p[1]) - py) ** 2;
                if (d < bestDistance) { bestDistance = d; best = j; }
            });
            if (best < 0) { tip.hidden = true; return; }
            const label = HVInsights.labels[best];
            tipLink.textContent = label;
            tipLink.href = `description.html?id=${encodeURIComponent(label)}&type=ideology`;
            tip.style.borderColor = colorOf(label);
            tip.hidden = false;
            const left = sx(m.points[best][0]) / W * box.width;
            const top = sy(m.points[best][1]) / H * box.height;
            tip.style.left = Math.min(Math.max(left, 60), box.width - 60) + 'px';
            tip.style.top = (top - 14) + 'px';
        }
        svg.addEventListener('pointermove', event => { if (event.pointerType === 'mouse') nearest(event); });
        svg.addEventListener('pointerdown', nearest);
        svg.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') setTimeout(() => { if (!tip.matches(':hover')) tip.hidden = true; }, 200); });
        container.append(wrap);

        const name = id => HV.nameOf(HV.categoryOf[id], id);
        const axisText = (i, axis) => `${axis}: ${m.ends[i].low.map(name).join(', ')} on one end and ${m.ends[i].high.map(name).join(', ')} on the other.`;
        const caption = el('p', 'ins-caption');
        caption.append(settings.youNote || (marks.length === 1
            ? 'You are placed at the center of your five closest ideologies, weighted by how well each fits. '
            : 'Each person is placed at the center of their five closest ideologies, weighted by how well each fits. '));
        caption.append(`${axisText(0, 'Left to right')} ${axisText(1, 'Bottom to top')}`);
        container.append(caption);
    }

    // ---- read-only views of somebody's answers (shared and compare pages) -------------------------
    function renderTiles(container, answers) {
        container.innerHTML = '';
        categories.forEach(category => {
            const list = answers[category];
            if (!list || !list.length) return;
            const section = el('div', 'category-section');
            section.append(el('h2', 'category-title', categoryTitles[category] || category));
            const flex = el('div', 'values-flex-container');
            list.slice().sort((a, b) => b.agree - a.agree).forEach(item => {
                const tile = el('a', 'result-item');
                tile.href = `description.html?id=${encodeURIComponent(item.value)}&cat=${encodeURIComponent(category)}`;
                tile.style.textDecoration = 'none';
                tile.style.color = 'inherit';
                tile.title = `${HV.nameOf(category, item.value)}: ${HV.signed(item.agree)}`;
                const img = el('img', 'result-icon');
                img.src = `icons/${category}/${item.value}.svg`;
                img.alt = '';
                img.style.borderRadius = '50%';
                img.style.boxShadow = `0 0 0 3px var(--bg-color), 0 0 0 6px ${HV.ringColor(item.agree)}`;
                img.onerror = () => { img.style.display = 'none'; };
                const name = el('p', 'result-text');
                putName(name, HV.nameOf(category, item.value));
                tile.append(img, name, el('p', 'result-agree', HV.signed(item.agree)));
                flex.append(tile);
            });
            section.append(flex);
            container.append(section);
        });
    }

    // the best match as a colored bubble, then the closest matches as outlined pills
    function renderHeadline(container, answers) {
        container.innerHTML = '';
        const ranked = HV.closestIdeologies(answers, null, 1 + HV.CLOSEST_COUNT);
        const best = ranked[0];
        const bubble = el('div', 'label-bubble');
        bubble.style.backgroundColor = best ? (labelColors[best.label] || '#7a7a7a') : '#7a7a7a';
        if (typeof hvInk !== 'undefined' && best) bubble.style.color = hvInk.onFill(colorOf(best.label));
        if (best) {
            const link = el('a');
            link.href = `description.html?id=${encodeURIComponent(best.label)}&type=ideology`;
            link.style.cssText = 'color: inherit; text-decoration: none; display: block;';
            const name = el('span');
            putName(name, best.label);
            link.append(name, ' ', el('span', 'label-score', `(${pct(best.probability)})`));
            bubble.append(link);
        } else {
            putName(bubble, 'No match');
        }
        container.append(bubble);
        if (ranked.length > 1) {
            const list = el('div');
            list.id = 'closest-list';
            ranked.slice(1).forEach((match, index) => {
                const pill = el('a', 'closest-pill');
                pill.href = `description.html?id=${encodeURIComponent(match.label)}&type=ideology`;
                pill.style.setProperty('--pill-color', colorOf(match.label));
                if (typeof hvInk !== 'undefined') {
                    pill.style.setProperty('--pill-ink-dark', hvInk.forDark(colorOf(match.label)));
                    pill.style.setProperty('--pill-ink-light', hvInk.forLight(colorOf(match.label)));
                }
                const name = el('span', 'cp-name');
                putName(name, match.label);
                pill.append(el('span', 'cp-rank', `${index + 1}.`), ' ', name, ' ', el('span', 'cp-score', `(${pct(match.probability)})`));
                list.append(pill);
            });
            const section = el('div');
            section.id = 'closest-section';
            section.style.display = 'flex';
            section.append(list);
            container.append(section);
        }
        return ranked;
    }

    Object.assign(HVInsights, { renderExplainer, renderRadar, renderMap, renderTiles, renderHeadline, chip, chipGroup, el, svgEl });
})();
