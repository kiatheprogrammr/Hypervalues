// Draws the results page as two pictures, one for phones (1080 x 1920) and one for computers (1920 x 1080), so that
// the whole result fits in one image that stays sharp when posted. The pictures can be made 2 or 3 times bigger with
// the same proportions. Uses the font of the page. Needs data.js, scoring.js and a canvas.
const HVImage = (function () {
    const SIZES = {
        phone: { w: 1080, h: 1920 },
        computer: { w: 1920, h: 1080 }
    };
    const FALLBACK_FAMILY = '"Quicksand", sans-serif';
    const REGULAR = 500;
    const BOLD = 700;

    // sizes at scale 1: icon, space between icon and text, font of the names
    const ICON = 72, GAP_TEXT = 14, NAME_SIZE = 24;
    const BLOCK_GAP = 26;

    let family = FALLBACK_FAMILY;

    function theme() {
        const style = getComputedStyle(document.body);
        const read = (name, fallback) => (style.getPropertyValue(name) || '').trim() || fallback;
        family = (style.fontFamily || '').trim() || FALLBACK_FAMILY;
        return {
            bg: read('--bg-color', '#16181d'),
            text: read('--text-primary', '#f2f2f2'),
            dim: read('--text-dim', '#9aa0a6'),
            card: read('--card-bg', '#23262d'),
            border: read('--card-border', '#3a3e47'),
            green: read('--hv-green', '#a9d1b8'),
            red: read('--hv-red', '#f07b86'),
            onBrand: read('--on-brand', '#101b17'),
            soft: read('--accent-soft', '#263c32')
        };
    }

    function font(weight, size) {
        return `${weight} ${Math.round(size * 100) / 100}px ${family}`;
    }

    // Largest font up to `size` that fits `text` into `maxWidth` (not below 60% of size)
    function fit(ctx, text, maxWidth, size, weight) {
        let px = size;
        ctx.font = font(weight, px);
        while (ctx.measureText(text).width > maxWidth && px > size * 0.6) {
            px -= 1;
            ctx.font = font(weight, px);
        }
        return px;
    }

    // "Mutual-Distributism" -> "Mutual-", "Distributism" (glued to the previous piece); words break after hyphens
    function tokensOf(text) {
        const tokens = [];
        text.split(' ').forEach(word => {
            (word.match(/[^-]+-?|-/g) || [word]).forEach((part, i) => tokens.push({ text: part, glue: i > 0 }));
        });
        return tokens;
    }

    // Lines of text for a fixed font size; a piece wider than maxWidth stays on its own line
    function wrapFixed(ctx, text, maxWidth, px, weight) {
        ctx.font = font(weight, px);
        const lines = [];
        let current = '';
        tokensOf(text).forEach(token => {
            const test = current ? current + (token.glue ? '' : ' ') + token.text : token.text;
            if (current && ctx.measureText(test).width > maxWidth) {
                lines.push(current);
                current = token.text;
            } else {
                current = test;
            }
        });
        if (current) lines.push(current);
        return lines;
    }

    // Lines of text for a font that may shrink to 62% to fit; used for the best match box
    function wrapShrink(ctx, text, maxWidth, maxLines, size, weight) {
        let px = size;
        for (;;) {
            const lines = wrapFixed(ctx, text, maxWidth, px, weight);
            const widest = Math.max.apply(null, lines.map(line => ctx.measureText(line).width));
            if ((lines.length <= maxLines && widest <= maxWidth) || px <= size * 0.62 + 0.01) return { lines, px };
            px = Math.max(size * 0.62, px * 0.93);
        }
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function readableOn(color) {
        const hex = String(color).replace('#', '').slice(0, 6);
        if (!/^[0-9a-f]{6}$/i.test(hex)) return '#ffffff';
        const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
        return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#111111' : '#ffffff';
    }


    function loadIcon(category, value) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = `icons/${category}/${value}.svg`;
        });
    }

    // The values to draw, by category, strongest agreement first
    function valueBlocks(answers) {
        return categories
            .filter(category => (answers[category] || []).length > 0)
            .map(category => ({
                category,
                title: categoryTitles[category] || category,
                items: answers[category].slice().sort((a, b) => b.agree - a.agree).map(item => ({
                    value: item.value,
                    agree: item.agree,
                    name: HV.nameOf(category, item.value)
                }))
            }));
    }

    // Width of the widest piece of any value name, per pixel of bold font
    function widestPiece(ctx, blocks) {
        ctx.font = font(BOLD, 100);
        let widest = 1;
        blocks.forEach(block => block.items.forEach(item => tokensOf(item.name).forEach(token => {
            widest = Math.max(widest, ctx.measureText(token.text).width / 100);
        })));
        return widest;
    }

    // Biggest scale (up to 1.35) at which all blocks fit the region in `columns` columns. A value is its icon with the
    // name and the number beside it. Every name gets the same font size, and so does every number: the size is cut
    // down only so that the widest piece of any name fits.
    function layout(ctx, blocks, region, columns, gap, ratio) {
        const colW = (region.w - (columns - 1) * gap) / columns;
        const side = (ICON + 14 + GAP_TEXT) ;                       // icon, its ring and the space to the text, at scale 1
        let result = null;
        for (let s = 1.35; s >= 0.3; s -= 0.025) {
            const needed = s * (side + NAME_SIZE * ratio + 6);
            const perRow = Math.max(1, Math.floor(colW / needed));
            const cell = colW / perRow;
            const textW = cell - side * s - 4 * s;
            const fName = Math.max(6, Math.min(NAME_SIZE * s, textW / ratio));
            let maxLines = 1;
            blocks.forEach(block => block.items.forEach(item => {
                maxLines = Math.max(maxLines, wrapFixed(ctx, item.name, textW, fName, BOLD).length);
            }));
            const fTitle = fName * 1.3;
            const titleH = fTitle + 22 * s;
            const textH = maxLines * fName * 1.15 + fName * 1.25;
            const rowH = Math.max((ICON + 14) * s, textH) + 12 * s;
            const heights = new Array(columns).fill(0);
            const placed = blocks.map(block => {
                let col = 0;
                heights.forEach((h, i) => { if (h < heights[col]) col = i; });
                const rows = Math.ceil(block.items.length / perRow);
                const y = heights[col];
                heights[col] += titleH + rows * rowH + BLOCK_GAP * s;
                return { block, col, y };
            });
            result = { s, columns, perRow, colW, cell, side, textW, fName, fTitle, titleH, maxLines, rowH, placed,
                height: Math.max.apply(null, heights) - BLOCK_GAP * s };
            if (result.height <= region.h) break;
        }
        return result;
    }

    function drawTile(ctx, th, icons, category, item, x, y, plan) {
        const s = plan.s;
        const r = ICON * s / 2;
        const cx = x + 7 * s + r;
        const cy = y + (plan.rowH - 12 * s) / 2;
        const icon = icons[`${category}/${item.value}`];
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fillStyle = th.card;
        ctx.fill();
        if (icon) {
            ctx.clip();
            ctx.drawImage(icon, cx - r, cy - r, r * 2, r * 2);
        }
        ctx.restore();
        ctx.beginPath();                                          // the ring shows how well the value matches
        ctx.arc(cx, cy, r + 4.5 * s, 0, Math.PI * 2);
        ctx.lineWidth = 3 * s;
        ctx.strokeStyle = HV.ringColor(item.agree);
        ctx.stroke();

        const lines = wrapFixed(ctx, item.name, plan.textW, plan.fName, BOLD);
        const blockH = lines.length * plan.fName * 1.15 + plan.fName * 1.25;
        let ty = cy - blockH / 2 + plan.fName * 0.95;
        const tx = x + plan.side * s;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = th.text;
        ctx.font = font(BOLD, plan.fName);
        lines.forEach(line => { ctx.fillText(line, tx, ty); ty += plan.fName * 1.15; });
        ctx.fillStyle = th.dim;
        ctx.font = font(REGULAR, plan.fName);
        ctx.fillText(HV.signed(item.agree), tx, ty + plan.fName * 0.1);
    }

    // Tries each number of columns and keeps the one that lets the text be biggest
    function drawBlocks(ctx, th, icons, blocks, region, columnOptions, gap) {
        if (!blocks.length) return;
        const ratio = widestPiece(ctx, blocks);
        let plan = null;
        columnOptions.forEach(columns => {
            const candidate = layout(ctx, blocks, region, columns, gap, ratio);
            if (!plan || candidate.fName > plan.fName + 0.01 ||
                (Math.abs(candidate.fName - plan.fName) <= 0.01 && candidate.s > plan.s)) plan = candidate;
        });
        plan.placed.forEach(p => {
            const x0 = region.x + p.col * (plan.colW + gap);
            const y0 = region.y + p.y;
            ctx.fillStyle = th.green;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.font = font(BOLD, plan.fTitle);
            ctx.fillText(p.block.title, x0, y0 + plan.fTitle);
            ctx.fillStyle = th.border;
            ctx.fillRect(x0, y0 + plan.fTitle + 8 * plan.s, plan.colW, Math.max(1, 2 * plan.s));
            p.block.items.forEach((item, i) => {
                const col = i % plan.perRow;
                const row = Math.floor(i / plan.perRow);
                drawTile(ctx, th, icons, p.block.category, item, x0 + col * plan.cell, y0 + plan.titleH + row * plan.rowH, plan);
            });
        });
    }

    // Title, the best match and the next closest ones, in a box of the given width starting at (x, y).
    function drawSummary(ctx, th, ranked, x, y, w, kind) {
        const compact = kind === 'computer';
        const version = (document.querySelector('.version-text') || {}).textContent || '';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        const markR = compact ? 30 : 33, mid = y + markR + 4;
        ctx.beginPath(); ctx.arc(x + markR, mid, markR, 0, Math.PI * 2); ctx.fillStyle = th.green; ctx.fill();
        ctx.fillStyle = th.onBrand; ctx.font = font(BOLD, markR * 1.05); ctx.textAlign = 'center';
        ctx.fillText('H', x + markR, mid + markR * 0.36); ctx.textAlign = 'left';
        const nameX = x + markR * 2 + 18;
        ctx.fillStyle = th.text; ctx.font = font(BOLD, compact ? 52 : 58);
        ctx.fillText('Hypervalues', nameX, mid + (compact ? 18 : 20));
        const titleW = ctx.measureText('Hypervalues').width;
        let after = nameX + titleW + 16;
        if (version) {
            ctx.font = font(BOLD, 21);
            const pillW = ctx.measureText(version).width + 28;
            roundRect(ctx, after, mid - 18, pillW, 36, 18);
            ctx.lineWidth = 2; ctx.strokeStyle = th.border; ctx.stroke();
            ctx.fillStyle = th.dim; ctx.textAlign = 'center'; ctx.fillText(version, after + pillW / 2, mid + 7); ctx.textAlign = 'left';
            after += pillW + 14;
        }
        if (localStorage.getItem('hvResultMode') === 'custom') {
            const badgeX = after;
            const badgeY = mid - 17;
            roundRect(ctx, badgeX, badgeY, 112, 34, 17);
            ctx.fillStyle = th.card;
            ctx.fill();
            ctx.strokeStyle = th.border;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = th.text;
            ctx.font = font(BOLD, 18);
            ctx.textAlign = 'center';
            ctx.fillText('CUSTOM', badgeX + 56, badgeY + 23);
            ctx.textAlign = 'left';
        }
        y += compact ? 96 : 100;

        ctx.fillStyle = th.red; ctx.font = font(BOLD, 22); ctx.textAlign = 'left';
        ctx.fillText('YOUR CLOSEST IDEOLOGY', x + 4, y + 22);
        y += 42;
        const best = ranked[0];
        const color = best ? ((labelColors[best.label] || '#7a7a7a').slice(0, 7)) : '#7a7a7a';
        const name = best ? wrapShrink(ctx, best.label, w - 80, 2, compact ? 48 : 64, BOLD) : null;
        const lineH = name ? name.px * 1.15 : 0;
        const scoreSize = 34;
        const blockH = name ? (name.lines.length - 1) * lineH + name.px * 0.8 + 16 + scoreSize : 40;
        const bubbleH = Math.max(compact ? 130 : 150, Math.round(blockH + (compact ? 64 : 80)));
        roundRect(ctx, x, y, w, bubbleH, 36);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.fillStyle = readableOn(color);
        ctx.textAlign = 'center';
        if (best) {
            ctx.font = font(BOLD, name.px);
            let baseline = y + (bubbleH - blockH) / 2 + name.px * 0.8;
            name.lines.forEach(line => { ctx.fillText(line, x + w / 2, baseline); baseline += lineH; });
            ctx.font = font(REGULAR, scoreSize);
            ctx.fillText(`(${HV.percent(best.probability)})`, x + w / 2, baseline - lineH + 16 + scoreSize);
        } else {
            ctx.font = font(BOLD, 56);
            ctx.fillText('No match', x + w / 2, y + bubbleH / 2 + 20);
        }
        y += bubbleH + 34;

        const closest = ranked.slice(1);
        if (closest.length) {
            closest.forEach((match, index) => {
                const pill = (labelColors[match.label] || '#7a7a7a').slice(0, 7);
                const h = compact ? 58 : 66;
                roundRect(ctx, x + 2, y + 2, w - 4, h - 4, (h - 4) / 2);
                ctx.lineWidth = 4;
                ctx.strokeStyle = pill;
                ctx.stroke();
                ctx.fillStyle = th.text;
                const label = `${index + 1}.  ${match.label}`;
                const score = `(${HV.percent(match.probability)})`;
                ctx.font = font(REGULAR, 28);
                const scoreW = ctx.measureText(score).width;
                const px = fit(ctx, label, w - 70 - scoreW - 20, 32, BOLD);
                ctx.font = font(BOLD, px);
                ctx.textAlign = 'left';
                ctx.fillText(label, x + 30, y + h / 2 + px * 0.34);
                ctx.fillStyle = th.dim;
                ctx.font = font(REGULAR, 28);
                ctx.textAlign = 'right';
                ctx.fillText(score, x + w - 30, y + h / 2 + 10);
                y += h + (compact ? 10 : 14);
            });
        }
        return y;
    }

    // The 2D political map: every ideology placed by how similar its stances are (the same map as on the results
    // page), with the best matches and the person marked. Needs insights.js; returns false when it is not there.
    function drawMap(ctx, th, x, y, w, h, ranked, answers) {
        if (typeof HVInsights === 'undefined') return false;
        let m, you;
        try { m = HVInsights.map(); you = HVInsights.place(answers); } catch (e) { return false; }
        const hidden = typeof secretIdeologies !== 'undefined' ? secretIdeologies : [];
        const top = ranked.slice(0, 3).map(r => r.label);
        roundRect(ctx, x, y, w, h, 30);
        ctx.fillStyle = th.card; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = th.border; ctx.stroke();
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = th.red; ctx.beginPath(); ctx.arc(x + 36, y + 44, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = th.text; ctx.font = font(BOLD, 30); ctx.fillText('Political map', x + 54, y + 55);
        ctx.fillStyle = th.dim; ctx.font = font(REGULAR, 21);
        const note = 'Ideologies that hold alike values sit close together';
        ctx.fillText(fit(ctx, note, w - 60, 21, REGULAR) < 21 ? 'Alike ideologies sit close together' : note, x + 30, y + 92);
        const pad = 30, px = x + pad, py = y + 112, pw = w - 2 * pad, ph = h - 112 - pad;
        const xs = m.points.map(p => p[0]).concat([you[0]]), ys = m.points.map(p => p[1]).concat([you[1]]);
        const lo = [Math.min.apply(null, xs), Math.min.apply(null, ys)], hi = [Math.max.apply(null, xs), Math.max.apply(null, ys)];
        const sx = v => px + (v - lo[0]) / ((hi[0] - lo[0]) || 1) * pw;
        const sy = v => py + ph - (v - lo[1]) / ((hi[1] - lo[1]) || 1) * ph;
        ctx.save();
        roundRect(ctx, px, py, pw, ph, 20); ctx.clip();
        ctx.fillStyle = th.bg; ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = th.border; ctx.lineWidth = 1.5; ctx.setLineDash([6, 8]);
        [[sx(0), py, sx(0), py + ph], [px, sy(0), px + pw, sy(0)]].forEach(([x1, y1, x2, y2]) => {
            if (x1 >= px && x1 <= px + pw && y1 >= py && y1 <= py + ph) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
        });
        ctx.setLineDash([]);
        const dot = Math.max(3.5, Math.min(w, h) / 120);
        HVInsights.labels.forEach((label, j) => {
            if (top.indexOf(label) >= 0 || hidden.indexOf(label) >= 0) return;
            ctx.globalAlpha = 0.78; ctx.fillStyle = (labelColors[label] || '#7a7a7a').slice(0, 7);
            ctx.beginPath(); ctx.arc(sx(m.points[j][0]), sy(m.points[j][1]), dot, 0, Math.PI * 2); ctx.fill();
        });
        ctx.globalAlpha = 1;
        const tags = [];
        top.forEach((label, rank) => {
            const j = HVInsights.labels.indexOf(label);
            if (j < 0) return;
            const cx = sx(m.points[j][0]), cy = sy(m.points[j][1]), r = dot * (rank === 0 ? 2.5 : 2);
            ctx.beginPath(); ctx.arc(cx, cy, r + 3, 0, Math.PI * 2); ctx.fillStyle = th.bg; ctx.fill();
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = (labelColors[label] || '#7a7a7a').slice(0, 7); ctx.fill();
            if (rank === 0) tags.push({ text: label, cx, cy, color: th.text });
        });
        const ux = sx(you[0]), uy = sy(you[1]), d = dot * 3.4;
        ctx.beginPath(); ctx.moveTo(ux, uy - d); ctx.lineTo(ux + d, uy); ctx.lineTo(ux, uy + d); ctx.lineTo(ux - d, uy); ctx.closePath();
        ctx.fillStyle = th.red; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = th.bg; ctx.stroke();
        tags.push({ text: 'You', cx: ux, cy: uy, color: th.red, bold: true });
        const placed = [];
        const overlaps = (a, b) => a.x < b.x + b.w + 6 && b.x < a.x + a.w + 6 && a.y < b.y + b.h + 6 && b.y < a.y + a.h + 6;
        tags.forEach(tag => {
            ctx.font = font(BOLD, 22);
            const tw = ctx.measureText(tag.text).width + 24, th2 = 36;
            const spots = [[16, -th2 - 8], [16, 12], [-16 - tw, -th2 - 8], [-16 - tw, 12]];     // above right, below right, above left, below left
            let box = null;
            for (const [dx, dy] of spots) {
                const c = { x: tag.cx + dx, y: tag.cy + dy, w: tw, h: th2 };
                if (c.x < px + 6 || c.x + tw > px + pw - 6 || c.y < py + 6 || c.y + th2 > py + ph - 6) continue;
                if (!placed.some(o => overlaps(c, o))) { box = c; break; }
            }
            if (!box) box = { x: Math.max(px + 6, Math.min(tag.cx + 16, px + pw - tw - 6)), y: Math.max(py + 6, Math.min(tag.cy + 12, py + ph - th2 - 6)), w: tw, h: th2 };
            placed.push(box);
            roundRect(ctx, box.x, box.y, tw, th2, 18); ctx.fillStyle = th.card; ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = tag.bold ? th.red : th.border; ctx.stroke();
            ctx.fillStyle = tag.color; ctx.textAlign = 'center'; ctx.fillText(tag.text, box.x + tw / 2, box.y + 25);
        });
        ctx.restore();
        ctx.textAlign = 'left';
        return true;
    }

    // The address of the page, with a capital letter at the start of its folder: host.github.io/Hypervalues/
    function drawFooter(ctx, th, x, y) {
        if (!/^https?:$/.test(location.protocol)) return;
        const folder = location.pathname.replace(/[^/]*$/, '').replace(/^\/([^/])/, (all, first) => '/' + first.toUpperCase());
        ctx.fillStyle = th.dim;
        ctx.font = font(REGULAR, 24);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(location.host + folder, x, y);
    }

    // The picture of one kind, `factor` times bigger than 1080 x 1920 or 1920 x 1080 (same proportions)
    function draw(kind, answers, ranked, icons, makeCanvas, factor) {
        const { w, h } = SIZES[kind];
        const k = factor || 1;
        const canvas = makeCanvas(w * k, h * k);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(k, 0, 0, k, 0, 0);
        const th = theme();
        ctx.fillStyle = th.bg;
        ctx.fillRect(0, 0, w, h);
        // a soft ring in the corner, like the home page
        ctx.save(); ctx.strokeStyle = th.border; ctx.lineWidth = 2; ctx.globalAlpha = 0.55;
        [260, 340, 420].forEach(r => { ctx.beginPath(); ctx.arc(w - 40, 40, r, 0, Math.PI * 2); ctx.stroke(); });
        ctx.restore();
        const blocks = valueBlocks(answers);
        const pad = 60;
        if (kind === 'phone') {
            const y = drawSummary(ctx, th, ranked, pad, pad, w - 2 * pad, kind);
            const mapH = 470;
            const mapped = drawMap(ctx, th, pad, y + 6, w - 2 * pad, mapH, ranked, answers);
            const top = mapped ? y + 6 + mapH + 26 : y + 16;
            const region = { x: pad, y: top, w: w - 2 * pad, h: h - top - pad - 30 };
            drawBlocks(ctx, th, icons, blocks, region, [1, 2, 3], 30);
            drawFooter(ctx, th, pad, h - pad + 4);
        } else {
            const left = 600;
            const y = drawSummary(ctx, th, ranked, pad, pad, left, kind);
            const mapH = Math.min(440, h - pad - 40 - (y + 4));
            if (mapH > 260) drawMap(ctx, th, pad, h - pad - 40 - mapH, left, mapH, ranked, answers);
            drawFooter(ctx, th, pad, h - pad + 4);
            const x = pad + left + 56;
            drawBlocks(ctx, th, icons, blocks, { x, y: pad, w: w - x - pad, h: h - 2 * pad }, [2, 3, 4], 40);
        }
        return canvas;
    }

    function toBlob(canvas) {
        return new Promise((resolve, reject) => {
            try {
                canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('empty image'))), 'image/png');
            } catch (e) {
                reject(e);
            }
        });
    }

    function save(blob, file) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = file;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 15000);
    }

    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

    const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // iPhones and iPads, the browsers inside apps (TikTok, Reddit, Instagram, ...) and browsers without the download
    // attribute do not save a file that a script creates, and several files in a row are blocked. There the pictures are
    // shown in a window: press and hold to save, or the share sheet.
    function needsViewer() {
        const ua = navigator.userAgent || '';
        const inApp = /FBAN|FBAV|Instagram|Line\/|TikTok|musical_ly|BytedanceWebview|Snapchat|Reddit|; wv\)/i.test(ua);
        return isIOS() || inApp || !('download' in document.createElement('a'));
    }

    // iOS refuses canvases bigger than about 16.7 million pixels (it gives a blank or empty picture)
    const IOS_MAX_PIXELS = 16000000;
    function factorLimit(kind, factor) {
        if (!isIOS()) return factor;
        const size = SIZES[kind];
        while (factor > 1 && size.w * size.h * factor * factor > IOS_MAX_PIXELS) factor -= 1;
        return factor;
    }

    function present(items) {
        const old = document.getElementById('hv-image-viewer');
        if (old) old.remove();
        const urls = items.map(item => URL.createObjectURL(item.blob));
        let files = [];
        try { files = items.map(item => new File([item.blob], item.name, { type: 'image/png' })); } catch (e) { files = []; }

        const box = document.createElement('div');
        box.id = 'hv-image-viewer';
        Object.assign(box.style, {
            position: 'fixed', top: '0', right: '0', bottom: '0', left: '0', zIndex: '10000', overflowY: 'auto',
            background: 'rgba(0, 0, 0, 0.88)', padding: '16px', boxSizing: 'border-box', color: '#fff',
            textAlign: 'center', WebkitOverflowScrolling: 'touch', fontFamily: 'inherit'
        });
        const close = () => { box.remove(); urls.forEach(url => URL.revokeObjectURL(url)); };

        const hint = document.createElement('p');
        hint.textContent = 'Press and hold a picture, then choose Save Image or Add to Photos.';
        hint.style.margin = '4px 0 12px';
        box.appendChild(hint);

        const bar = document.createElement('div');
        bar.style.cssText = 'display: flex; gap: 10px; justify-content: center; margin-bottom: 8px;';
        const button = (text, onclick) => {
            const element = document.createElement('button');
            element.type = 'button';
            element.textContent = text;
            element.onclick = onclick;
            element.style.cssText = 'padding: 10px 18px; font: inherit; border-radius: 8px; border: 0; cursor: pointer;';
            return element;
        };
        if (files.length && navigator.canShare && navigator.share && navigator.canShare({ files })) {
            bar.appendChild(button('Save / Share', async () => {
                try { await navigator.share({ files }); } catch (e) { /* closed by the person, or not allowed */ }
            }));
        }
        bar.appendChild(button('Close', close));
        box.appendChild(bar);

        items.forEach((item, i) => {
            const img = document.createElement('img');
            img.src = urls[i];
            img.alt = 'Your Hypervalues result';
            img.style.cssText = 'display: block; max-width: 100%; margin: 12px auto; border-radius: 10px; -webkit-touch-callout: default; -webkit-user-select: auto; user-select: auto;';
            box.appendChild(img);
        });
        document.body.appendChild(box);
    }

    // Creates the picture of one kind; icons that taint the canvas (opened from a file) are left out
    async function render(kind, answers, ranked, icons, makeCanvas, factor) {
        try {
            return await toBlob(draw(kind, answers, ranked, icons, makeCanvas, factor));
        } catch (e) {
            return await toBlob(draw(kind, answers, ranked, {}, makeCanvas, factor));
        }
    }

    async function loadIcons(answers) {
        const icons = {};
        const jobs = [];
        Object.keys(answers).forEach(category => (answers[category] || []).forEach(item => {
            jobs.push(loadIcon(category, item.value).then(img => { if (img) icons[`${category}/${item.value}`] = img; }));
        }));
        await Promise.all(jobs);
        return icons;
    }

    // Downloads both pictures (phone, then computer). If the browser cannot make a picture as big as asked
    // (phones limit the size of a canvas), a smaller one is made. Returns the factor used for each kind.
    async function download(answers, factor) {
        const wanted = Math.max(1, Math.floor(factor || 1));
        try {
            const probe = getComputedStyle(document.body).fontFamily || FALLBACK_FAMILY;
            await document.fonts.load(`${BOLD} 30px ${probe}`);
            await document.fonts.load(`${REGULAR} 30px ${probe}`);
        } catch (e) { /* the page font is only nice to have */ }
        const ranked = HV.closestIdeologies(answers, null, 1 + HV.CLOSEST_COUNT);
        const icons = await loadIcons(answers);
        const makeCanvas = (w, h) => {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            return canvas;
        };
        const kinds = Object.keys(SIZES);
        const used = {};
        const items = [];
        for (let i = 0; i < kinds.length; i++) {
            let k = factorLimit(kinds[i], wanted);
            let blob = null;
            while (!blob) {
                try {
                    blob = await render(kinds[i], answers, ranked, icons, makeCanvas, k);
                } catch (e) {
                    if (k <= 1) throw e;
                    k -= 1;
                }
            }
            used[kinds[i]] = k;
            items.push({ blob, name: `hypervalues-${kinds[i]}-${SIZES[kinds[i]].w * k}x${SIZES[kinds[i]].h * k}.png` });
        }
        if (needsViewer()) {
            present(items);
        } else {
            for (let i = 0; i < items.length; i++) {
                save(items[i].blob, items[i].name);
                if (i < items.length - 1) await wait(700);
            }
        }
        return used;
    }

    return { download, draw, SIZES };
})();
