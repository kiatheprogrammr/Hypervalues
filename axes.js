/*
 * Custom map axes: up to two axes you define yourself. Each axis has a label (a sentence or a few words), a name for
 * each end, and a list of values with a weight from -1 to +1:
 *   position = sum(weight x score) / sum(|weight|)        from -1 (low end) to +1 (high end)
 * A positive weight means that agreeing with the value moves a position toward the high end, a negative weight
 * toward the low end. Your score for a value is your answer; an ideology's score is its entry in the matrix
 * (ideology_matrix.js). Values you did not answer are left out of your position (they count neither in the sum nor
 * in the divisor), so a position always says how many of the chosen values it rests on.
 *
 * Load data.js, ideology_matrix.js, scoring.js and insights.js first.
 *   HVAxes.position(axis, scoreOf)   { position, num, den, parts } for one axis; scoreOf(valueId) gives a score or null
 *   HVAxes.preset(k)                 a ready axis built from the k-th axis of the existing map
 *   HVAxes.load() / HVAxes.save(axes)
 *   HVAxes.render({ editor, chart, answers })   draws the editor and the map
 */
const HVAxes = (function () {
    const STORE = 'hv_custom_axes';
    const MAX_AXES = 2;
    const LIMITS = { label: 80, end: 30 };
    const el = HVInsights.el, svgEl = HVInsights.svgEl;
    const valueName = id => HV.nameOf(HV.categoryOf[id], id);
    const round1 = x => Math.round(x * 10) / 10;
    const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
    const emptyAxis = () => ({ label: '', low: '', high: '', weights: {} });

    function clean(axis) {
        const out = emptyAxis();
        if (!axis || typeof axis !== 'object') return out;
        out.label = String(axis.label || '').slice(0, LIMITS.label);
        out.low = String(axis.low || '').slice(0, LIMITS.end);
        out.high = String(axis.high || '').slice(0, LIMITS.end);
        Object.keys(axis.weights || {}).forEach(id => {
            const w = Number(axis.weights[id]);
            if (id in HV.categoryOf && Number.isFinite(w)) out.weights[id] = round1(clamp(w, -1, 1));
        });
        return out;
    }

    function load() {
        try {
            const data = JSON.parse(localStorage.getItem(STORE));
            if (Array.isArray(data) && data.length) return data.slice(0, MAX_AXES).map(clean);
        } catch (e) { /* nothing saved, or storage is not available */ }
        return [emptyAxis()];
    }
    function save(axes) { try { localStorage.setItem(STORE, JSON.stringify(axes)); } catch (e) { /* storage is not available */ } }

    // ---- the calculation --------------------------------------------------------------------------
    function position(axis, scoreOf) {
        let num = 0, den = 0;
        const parts = Object.keys(axis.weights).map(value => {
            const weight = axis.weights[value];
            const score = scoreOf(value);
            if (score === null || score === undefined || weight === 0) return { value, weight, score: null, contribution: null };
            num += weight * score;
            den += Math.abs(weight);
            return { value, weight, score, contribution: weight * score };
        });
        return { position: den ? num / den : null, num, den, parts };
    }
    const userScore = answers => id => { const e = HVInsights.entryOf(answers, id); return e ? Number(e.agree) || 0 : null; };
    const ideologyScore = label => id => HVInsights.score(label, id).score;
    const isActive = axis => Object.keys(axis.weights).some(id => axis.weights[id] !== 0);

    // an axis from the k-th axis of the map: its six strongest values, weights in proportion to their loadings
    function preset(k) {
        const m = HVInsights.map();
        const loadings = HVInsights.valueIds.map((id, i) => ({ id, loading: m.axes[k][i] }));
        const top = loadings.slice().sort((a, b) => Math.abs(b.loading) - Math.abs(a.loading)).slice(0, 6);
        const biggest = Math.abs(top[0].loading) || 1;
        const axis = emptyAxis();
        top.forEach(t => { axis.weights[t.id] = round1(clamp(t.loading / biggest, -1, 1)) || (t.loading < 0 ? -0.1 : 0.1); });
        const sorted = loadings.slice().sort((a, b) => a.loading - b.loading);
        axis.label = `Map axis ${k + 1}`;
        axis.low = valueName(sorted[0].id).slice(0, LIMITS.end);
        axis.high = valueName(sorted[sorted.length - 1].id).slice(0, LIMITS.end);
        return axis;
    }

    const signed = HV.signed;
    const endOf = (axis, p) => p === null ? '' : (Math.abs(p) < 0.05 ? 'in the middle' : `toward ${(p > 0 ? axis.high : axis.low) || (p > 0 ? 'the high end' : 'the low end')}`);

    // ---- drawing ----------------------------------------------------------------------------------
    function render(parts) {
        const state = { axes: load(), selected: null };
        const answers = parts.answers || {};
        const hasAnswers = Object.keys(answers).some(c => (answers[c] || []).length);
        const ranked = hasAnswers ? HV.rankIdeologies(answers) : [];
        state.selected = ranked.length ? ranked[0].label : HVInsights.labels[0];

        function changed(structural) {
            save(state.axes);
            if (structural) drawEditor();
            drawChart();
        }

        // ---------------- editor
        function drawEditor() {
            const host = parts.editor;
            host.innerHTML = '';
            state.axes.forEach((axis, index) => host.append(axisCard(axis, index)));
            const row = el('div', 'axes-actions');
            if (state.axes.length < MAX_AXES) {
                const add = el('button', '', 'Add a second axis');
                add.type = 'button';
                add.onclick = () => { state.axes.push(emptyAxis()); changed(true); };
                row.append(add);
            }
            const reset = el('button', '', 'Clear all axes');
            reset.type = 'button';
            reset.onclick = () => { if (confirm('Remove both axes and all their values?')) { state.axes = [emptyAxis()]; changed(true); } };
            row.append(reset);
            host.append(row);
        }

        function axisCard(axis, index) {
            const n = index + 1;
            const card = el('fieldset', 'axes-card');
            card.append(el('legend', 'axes-legend', index === 0 ? 'Axis 1 (horizontal)' : 'Axis 2 (vertical)'));

            const field = (labelText, key, max, placeholder) => {
                const wrap = el('div', 'axes-field');
                const id = `axis-${n}-${key}`;
                const label = el('label', '', labelText);
                label.htmlFor = id;
                const input = el('input');
                input.type = 'text'; input.id = id; input.maxLength = max; input.value = axis[key]; input.placeholder = placeholder; input.autocomplete = 'off';
                input.oninput = () => { axis[key] = input.value; changed(false); };
                wrap.append(label, input);
                return wrap;
            };
            card.append(field('Label or sentence for this axis', 'label', LIMITS.label, 'for example: How much should the state decide?'));
            const ends = el('div', 'axes-ends');
            ends.append(field('Low end (−1)', 'low', LIMITS.end, 'for example: Individual'), field('High end (+1)', 'high', LIMITS.end, 'for example: Collective'));
            card.append(ends);

            // chosen values with their weights
            const list = el('div', 'axes-values');
            const ids = Object.keys(axis.weights);
            if (!ids.length) list.append(el('p', 'compare-hint', 'No values yet. Add values below, or start from one of the map axes.'));
            ids.forEach(id => {
                const row = el('div', 'axes-value');
                const info = el('div', 'axes-value-name');
                info.append(el('strong', '', valueName(id)), el('span', 'compare-hint', ` ${categoryTitles[HV.categoryOf[id]] || HV.categoryOf[id]}`));
                const slider = el('input');
                slider.type = 'range'; slider.min = '-1'; slider.max = '1'; slider.step = '0.1'; slider.value = String(axis.weights[id]);
                slider.id = `axis-${n}-w-${id}`;
                slider.setAttribute('aria-label', `Weight of ${valueName(id)} on axis ${n}`);
                const readout = el('output', 'axes-weight');
                const describe = w => `${signed(w)}: ${w === 0 ? 'no effect' : 'agreeing moves you ' + endOf({ low: axis.low, high: axis.high }, w)}`;
                const show = () => { const w = Number(slider.value); readout.textContent = describe(w); slider.setAttribute('aria-valuetext', describe(w)); };
                show();
                slider.oninput = () => { axis.weights[id] = round1(Number(slider.value)); show(); changed(false); };
                const remove = el('button', 'ins-more', 'Remove');
                remove.type = 'button';
                remove.setAttribute('aria-label', `Remove ${valueName(id)} from axis ${n}`);
                remove.onclick = () => { delete axis.weights[id]; changed(true); };
                row.append(info, slider, readout, remove);
                list.append(row);
            });
            card.append(list);

            // picker: every value not yet on this axis
            const pick = el('div', 'axes-pick');
            const filterId = `axis-${n}-filter`, selectId = `axis-${n}-select`;
            const fl = el('label', '', 'Find a value to add'); fl.htmlFor = filterId;
            const filter = el('input'); filter.type = 'search'; filter.id = filterId; filter.autocomplete = 'off';
            const sl = el('label', '', 'Values'); sl.htmlFor = selectId;
            const select = el('select'); select.id = selectId; select.size = 6;
            const fill = () => {
                const q = filter.value.trim().toLowerCase();
                select.innerHTML = '';
                categories.forEach(cat => {
                    const group = el('optgroup'); group.label = categoryTitles[cat] || cat;
                    Object.keys(resultsMapping[cat] || {}).filter(id => !(id in axis.weights) && valueName(id).toLowerCase().includes(q)).forEach(id => {
                        const o = el('option', '', valueName(id)); o.value = id; group.append(o);
                    });
                    if (group.children.length) select.append(group);
                });
            };
            fill();
            filter.oninput = fill;
            const add = el('button', '', 'Add value');
            add.type = 'button';
            const doAdd = () => { if (select.value && !(select.value in axis.weights)) { axis.weights[select.value] = 0.5; changed(true); document.getElementById(filterId).focus(); } };
            add.onclick = doAdd;
            select.ondblclick = doAdd;
            pick.append(fl, filter, sl, select, add);
            card.append(pick);

            // presets and removing the axis
            const tools = el('div', 'axes-actions');
            [0, 1].forEach(k => {
                const b = el('button', 'ins-more', `Start from map axis ${k + 1}`);
                b.type = 'button';
                b.onclick = () => {
                    if (Object.keys(axis.weights).length && !confirm('Replace this axis with the map axis?')) return;
                    Object.assign(axis, preset(k));
                    changed(true);
                };
                tools.append(b);
            });
            if (state.axes.length > 1) {
                const drop = el('button', 'ins-more', `Remove axis ${n}`);
                drop.type = 'button';
                drop.onclick = () => { state.axes.splice(index, 1); changed(true); };
                tools.append(drop);
            }
            card.append(tools);
            return card;
        }

        // ---------------- map, positions and the calculation
        function drawChart() {
            const host = parts.chart;
            host.innerHTML = '';
            const active = state.axes.filter(isActive);
            if (!active.length) {
                host.append(el('p', 'ins-intro', 'Add at least one value to an axis to draw the map.'));
                return;
            }
            const labels = HVInsights.labels;
            const pos = {};
            labels.forEach(label => { pos[label] = active.map(axis => position(axis, ideologyScore(label)).position); });
            const mine = active.map(axis => position(axis, userScore(answers)));
            const youComplete = hasAnswers && mine.every(m => m.position !== null);

            host.append(drawMap(active, pos, mine, youComplete));
            host.append(drawPositions(active, mine));
            host.append(drawBreakdown(active, mine, pos));
        }

        function nameOfAxis(axis, i) { return axis.label.trim() || `Axis ${i + 1}`; }

        function drawMap(active, pos, mine, youComplete) {
            const box = el('section', 'ins-section');
            box.append(el('h2', 'ins-heading', 'Your map'));
            box.append(el('p', 'ins-intro', 'Every ideology placed by your own axes, using the same scores as the calculation below. Tap or hover a dot to see its name, tap it to see how its position is made up.'));
            const W = 640, H = 440, pad = 52;
            const two = active.length > 1;
            const sx = p => pad + (p + 1) / 2 * (W - 2 * pad);
            const sy = p => H - pad - (p + 1) / 2 * (H - 2 * pad);
            const jitter = label => { let h = 0; for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0; return ((h % 2001) / 1000 - 1) * (H / 2 - pad - 50); };
            const at = label => [sx(pos[label][0]), two ? sy(pos[label][1]) : H / 2 + jitter(label)];

            const wrap = el('div', 'ins-chart ins-map-wrap');
            const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ins-svg ins-map', role: 'img' });
            svg.setAttribute('aria-label', `Map of ${labels().length} ideologies on ${active.length} custom axis${two ? 'es' : ''}: ${active.map((a, i) => `${nameOfAxis(a, i)}, from ${a.low || 'low'} to ${a.high || 'high'}`).join(' and ')}.`);
            svg.append(svgEl('rect', { x: 0.5, y: 0.5, width: W - 1, height: H - 1, rx: 14, class: 'ins-map-frame' }));
            svg.append(svgEl('line', { x1: sx(0), y1: pad / 2, x2: sx(0), y2: H - pad / 2, class: 'ins-spoke' }));
            svg.append(svgEl('line', { x1: pad / 2, y1: two ? sy(0) : H / 2, x2: W - pad / 2, y2: two ? sy(0) : H / 2, class: 'ins-spoke' }));
            const text = (x, y, str, anchor, rotate, cls) => {
                const t = svgEl('text', { x, y, 'text-anchor': anchor, class: cls || 'ins-axis-label' });
                if (rotate) t.setAttribute('transform', `rotate(-90 ${x} ${y})`);
                t.textContent = str;
                svg.append(t);
            };
            text(pad, H - 12, active[0].low || 'low', 'start');
            text(W - pad, H - 12, active[0].high || 'high', 'end');
            text(W / 2, H - 28, nameOfAxis(active[0], 0), 'middle', false, 'ins-axis-label ins-axis-title');
            if (two) {
                text(16, H - pad, active[1].low || 'low', 'start', true);
                text(16, pad, active[1].high || 'high', 'end', true);
                text(34, H / 2, nameOfAxis(active[1], 1), 'middle', true, 'ins-axis-label ins-axis-title');
            }

            const top = new Set(ranked.slice(0, 3).map(r => r.label));
            labels().forEach(label => {
                if (top.has(label) || label === state.selected) return;
                const [x, y] = at(label);
                svg.append(svgEl('circle', { cx: x, cy: y, r: 4, fill: HVInsights.colorOf(label), 'fill-opacity': '0.8', class: 'ins-dot' }));
            });
            const marked = labels().filter(l => top.has(l) || l === state.selected);
            marked.forEach(label => {
                const [x, y] = at(label);
                svg.append(svgEl('circle', { cx: x, cy: y, r: 6.5, fill: HVInsights.colorOf(label), class: 'ins-dot ins-dot-hot' }));
                const t = svgEl('text', { x: x + 9, y: y - 8, class: 'ins-map-label' });
                t.textContent = label;
                svg.append(t);
            });
            if (youComplete) {
                const x = sx(mine[0].position), y = two ? sy(mine[1].position) : H / 2;
                svg.append(svgEl('path', { d: `M${x},${y - 11} L${x + 11},${y} L${x},${y + 11} L${x - 11},${y} Z`, class: 'ins-you' }));
                const t = svgEl('text', { x: x + 15, y: y + 18, class: 'ins-you-label' });
                t.textContent = 'You';
                svg.append(t);
            }

            const tip = el('div', 'ins-tip');
            tip.hidden = true;
            const tipText = el('span', 'ins-tip-link');
            tip.append(tipText);
            wrap.append(svg, tip);
            const nearest = event => {
                const r = svg.getBoundingClientRect();
                const px = (event.clientX - r.left) / r.width * W, py = (event.clientY - r.top) / r.height * H;
                let best = null, bd = 14 * 14;
                labels().forEach(label => { const [x, y] = at(label); const d = (x - px) ** 2 + (y - py) ** 2; if (d < bd) { bd = d; best = label; } });
                return { best, r };
            };
            svg.addEventListener('pointermove', event => {
                if (event.pointerType !== 'mouse') return;
                const { best, r } = nearest(event);
                if (!best) { tip.hidden = true; return; }
                tipText.textContent = `${best} (${pos[best].map(p => signed(p)).join(', ')})`;
                tip.style.borderColor = HVInsights.colorOf(best);
                tip.hidden = false;
                const [x, y] = at(best);
                tip.style.left = Math.min(Math.max(x / W * r.width, 90), r.width - 90) + 'px';
                tip.style.top = (y / H * r.height - 14) + 'px';
            });
            svg.addEventListener('pointerleave', () => { tip.hidden = true; });
            svg.addEventListener('click', event => {
                const { best } = nearest(event);
                if (best) { state.selected = best; drawChart(); }
            });
            box.append(wrap);

            const note = !hasAnswers ? 'You have no saved answers yet, so only the ideologies are shown. Take the quiz to see where you land.'
                : youComplete ? 'The diamond is you.'
                : 'You are not shown because none of the values on one of your axes has been answered yet.';
            box.append(el('p', 'ins-caption', `${note} The line in the middle of each axis is position 0.`));

            const pick = el('div', 'axes-inspect');
            const label = el('label', '', 'Ideology to inspect'); label.htmlFor = 'axes-inspect';
            const select = el('select'); select.id = 'axes-inspect';
            labels().slice().sort((a, b) => a.localeCompare(b)).forEach(l => { const o = el('option', '', l); o.value = l; select.append(o); });
            select.value = state.selected;
            select.onchange = () => { state.selected = select.value; drawChart(); };
            pick.append(label, select);
            box.append(pick);
            return box;
        }

        function labels() { return HVInsights.labels; }

        // where you are on each axis, in words
        function drawPositions(active, mine) {
            const box = el('section', 'ins-section');
            box.append(el('h2', 'ins-heading', 'Your position'));
            if (!hasAnswers) { box.append(el('p', 'ins-intro', 'Take the quiz first: your position comes from the values you answered.')); return box; }
            active.forEach((axis, i) => {
                const m = mine[i];
                const chosen = m.parts.filter(p => p.weight !== 0).length;
                const used = m.parts.filter(p => p.contribution !== null).length;
                const line = el('p', 'ins-summary');
                line.append(el('strong', '', nameOfAxis(axis, i)), m.position === null
                    ? `: no position yet, none of its ${chosen} value${chosen === 1 ? '' : 's'} has been answered.`
                    : `: ${signed(m.position)}, ${endOf(axis, m.position)}, based on ${used} of ${chosen} chosen value${chosen === 1 ? '' : 's'} you answered.`);
                box.append(line);
            });
            if (mine.every(m => m.position !== null)) {
                const mineAt = mine.map(m => m.position);
                const near = HVInsights.labels.map(label => ({ label, d: Math.sqrt(active.reduce((s, axis, i) => s + (position(axis, ideologyScore(label)).position - mineAt[i]) ** 2, 0)) }))
                    .sort((a, b) => a.d - b.d).slice(0, 5);
                box.append(el('h3', 'ins-group-title', 'Closest to you on these axes'));
                const list = el('div', 'ins-chips');
                near.forEach(item => {
                    const b = el('button', 'axes-near');
                    b.type = 'button';
                    b.append(el('span', 'compare-dot'), el('span', '', item.label), el('span', 'compare-rank-note', `distance ${item.d.toFixed(2)}`));
                    b.firstChild.style.backgroundColor = HVInsights.colorOf(item.label);
                    b.onclick = () => { state.selected = item.label; drawChart(); };
                    list.append(b);
                });
                box.append(list);
            }
            return box;
        }

        // the calculation, value by value, for you and for the selected ideology
        function drawBreakdown(active, mine, pos) {
            const box = el('section', 'ins-section');
            box.id = 'axes-breakdown';
            box.append(el('h2', 'ins-heading', 'How the positions are calculated'));
            box.append(el('p', 'ins-intro', `position = Σ(weight × score) ÷ Σ|weight|, from −1.00 to +1.00. Your score for a value is your answer; ${state.selected}'s score is its entry in the ideology matrix (a "~" marks a score that is estimated from similar ideologies, not stated). Values you did not answer are left out of your sum and your divisor.`));
            active.forEach((axis, i) => {
                const you = mine[i];
                const ide = position(axis, ideologyScore(state.selected));
                box.append(el('h3', 'ins-subheading', `${nameOfAxis(axis, i)}: ${axis.low || 'low'} (−1) to ${axis.high || 'high'} (+1)`));
                box.append(el('p', 'ins-note', `A positive weight moves a position toward ${axis.high || 'the high end'} when the score is positive; a negative weight toward ${axis.low || 'the low end'}.`));
                const scroller = el('div', 'axes-table-wrap');
                const table = el('table', 'axes-table');
                table.append(el('caption', 'sr-only', `Calculation of ${nameOfAxis(axis, i)}`));
                const head = el('tr');
                ['Value', 'Weight', 'Your answer', 'Your part', `${state.selected} score`, 'Its part'].forEach(h => head.append(el('th', '', h)));
                table.append(head);
                Object.keys(axis.weights).forEach(id => {
                    const w = axis.weights[id];
                    const y = you.parts.find(p => p.value === id), s = ide.parts.find(p => p.value === id);
                    const basis = HVInsights.score(state.selected, id).basis;
                    const row = el('tr');
                    row.append(el('td', '', valueName(id)), el('td', '', signed(w)),
                        el('td', '', !hasAnswers || y.score === null ? 'not answered' : signed(y.score)),
                        el('td', '', y.contribution === null ? '–' : signed(y.contribution)),
                        el('td', '', (basis === 'E' ? '~' : '') + signed(s.score === null ? 0 : s.score)),
                        el('td', '', s.contribution === null ? '–' : signed(s.contribution)));
                    table.append(row);
                });
                const foot = (label, a, b) => { const r = el('tr', 'axes-foot'); r.append(el('th', '', label), el('td'), el('td'), el('td', '', a), el('td'), el('td', '', b)); table.append(r); };
                foot('Sum of parts', hasAnswers ? signed(you.num) : '–', signed(ide.num));
                foot('Divide by Σ|weight|', you.den ? you.den.toFixed(1) : '–', ide.den.toFixed(1));
                foot('Position', you.position === null ? 'no position' : `${signed(you.position)} (${endOf(axis, you.position)})`, ide.position === null ? 'no position' : `${signed(ide.position)} (${endOf(axis, ide.position)})`);
                scroller.append(table);
                box.append(scroller);
            });
            return box;
        }

        drawEditor();
        drawChart();
    }

    return { position, preset, load, save, clean, render, userScore, ideologyScore, isActive, MAX_AXES };
})();
