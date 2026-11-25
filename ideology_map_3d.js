/* Interactive ideology map: values in the scoring matrix determine each ideology's coordinates. */
const HV3DMap = (() => {
  const axes = [
    { label:'Economic', negative:'Socialism', positive:'Capitalism', positiveValues:['laissez_faire','countereconomics','basic_income_capitalism','state_capitalism','corporatocracy','free_market_distributism','Voluntaryism','technocapitalism'], negativeValues:['state_socialism','market_socialism','free_socialism','communization','utopian_socialism','agrarian_socialism','cybernetic_socialism','parecon','collective_distribution'] },
    { label:'Authority', negative:'Libertarianism', positive:'Authoritarianism', positiveValues:['theocracy','absolute','ethical_statism','religious_authoritarianism','autocracy','partocracy','oligarchy','centralism','hypercentralism','securitism','disciplinarianism','regimentalism','totalism'], negativeValues:['anarchism','civil_libertarianism','minarchism','communalism','councilism','polycentrism','confederalism','subsidiarity','anti_organizationalism','patchwork'] },
    { label:'Social', negative:'Progressivism', positive:'Conservatism', positiveValues:['conservatism','traditionalist_conservatism','reactionaryism','paleoconservatism','religious_traditionalism','perennial_traditionalism','cultural_nationalism'], negativeValues:['progressivism','social_progressivism','postmodernism','civil_liberalism','secular_humanism','multiculturalism','permissivism'] }
  ];
  const indexes = new Map(IDEOLOGY_MATRIX.values.map((id,i)=>[id,i]));
  function axisValue(axis, scores) {
    const avg = ids => { const found=ids.filter(id=>indexes.has(id)).map(id=>scores[indexes.get(id)]); return found.length?found.reduce((a,b)=>a+b,0)/found.length:0; };
    return Math.max(-1,Math.min(1,(avg(axis.positiveValues)-avg(axis.negativeValues))/2));
  }
  const MIN_ZOOM = 0.6, MAX_ZOOM = 6;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const secret = typeof secretIdeologies !== 'undefined' ? secretIdeologies : [];
  function familyOf(name) {
    for (const [group, list] of Object.entries(ideologyGroups)) if (list.includes(name)) return group;
    return '';
  }
  function shortDescription(name) {
    const text = (descriptions[name] || '').trim();
    if (text.length <= 230) return text;
    const cut = text.slice(0, 230), space = cut.lastIndexOf(' ');
    return cut.slice(0, space > 120 ? space : 230).replace(/[,;:]$/, '') + '…';
  }
  function historyOf(name) {
    if (typeof ideologyHistory !== 'undefined' && ideologyHistory[name]) return ideologyHistory[name];
    const family = familyOf(name);
    return family ? 'No separate history entry yet. It belongs to the ' + family + ' family of ideologies.' : 'No history entry yet.';
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function render(host, options = {}) {
    host.innerHTML = ''; host.classList.add('ideology-map-wrap');
    const title = el('h2', 'ins-heading', '3D ideology map');
    const intro = el('p', 'ins-intro', 'Drag to rotate. Scroll, pinch or use the + and − buttons to zoom. Hover over an ideology (or tap it) to see its description and history, and click it to open its page. The axes run from socialism to capitalism, libertarianism to authoritarianism, and progressivism to conservatism.');
    const stage = el('div', 'ideology-map-stage');
    const canvas = el('canvas', 'ideology-map-canvas');
    canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Interactive three-dimensional map of ideologies. Use the arrow keys to rotate and plus and minus to zoom.');
    const info = el('div', 'ideology-map-info'); info.hidden = true;
    stage.append(canvas, info);
    const tools = el('div', 'ideology-map-tools');
    const zoomIn = el('button', 'ideology-map-zoom', '+'); zoomIn.type = 'button'; zoomIn.setAttribute('aria-label', 'Zoom in');
    const zoomOut = el('button', 'ideology-map-zoom', '−'); zoomOut.type = 'button'; zoomOut.setAttribute('aria-label', 'Zoom out');
    const reset = el('button', '', 'Reset view'); reset.type = 'button';
    const save = el('button', '', 'Download map image'); save.type = 'button';
    const tip = el('p', 'ideology-map-tooltip'); tip.setAttribute('aria-live', 'polite');
    const ctx = canvas.getContext('2d');

    const points = Object.keys(IDEOLOGY_MATRIX.ideologies)
      .filter(name => !secret.includes(name) || name === options.selected)
      .map(name => ({
        name, xyz: axes.map(a => axisValue(a, IDEOLOGY_MATRIX.ideologies[name].s)),
        color: (labelColors[name] || '#7a7a7a').slice(0, 7),
        href: 'description.html?id=' + encodeURIComponent(name) + '&type=ideology',
        highlight: name === options.selected
      }));
    const hint = el('p', 'ideology-map-hint', points.length + ' ideologies plotted.');
    tools.append(zoomOut, zoomIn, reset, save, hint);
    host.append(title, intro, stage, tools, tip);
    const defaultTip = () => options.selected ? 'Highlighted: ' + options.selected : '';
    tip.textContent = defaultTip();

    const userVals = new Map();
    if (options.answers) Object.values(options.answers).forEach(list => (list || []).forEach(item => userVals.set(item.value, Number(item.agree) || 0)));
    let you = null;
    if (userVals.size) you = { name: 'You', color: '#27c4e8', href: 'results.html', xyz: axes.map(axis => {
      const avg = ids => { const a = ids.filter(id => userVals.has(id)).map(id => userVals.get(id)); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };
      const p = avg(axis.positiveValues), n = avg(axis.negativeValues);
      return clamp(((p || 0) - (n || 0)) / ((p === null || n === null) ? 1 : 2), -1, 1);
    }) };

    let yaw = -.62, pitch = .42, zoom = 1, projected = [], hover = null, pinned = null, drag = null, pinch = null;
    const pointers = new Map();

    function paint() {
      const dpr = Math.min(devicePixelRatio || 1, 2), rect = canvas.getBoundingClientRect();
      const bw = Math.round(rect.width * dpr), bh = Math.round(rect.height * dpr);
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = rect.width, h = rect.height, cx = w * .52, cy = h * .51, scale = Math.min(w, h) * .35 * zoom;
      const css = getComputedStyle(document.body);
      const bg = css.getPropertyValue('--bg-color').trim() || '#111', text = css.getPropertyValue('--text-primary').trim() || '#fff';
      const dim = css.getPropertyValue('--text-dim').trim() || '#999', edge = css.getPropertyValue('--card-border').trim() || '#777';
      ctx.clearRect(0, 0, w, h); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      const rot = ([x, y, z]) => {
        const xx = x * Math.cos(yaw) - y * Math.sin(yaw), yy = x * Math.sin(yaw) + y * Math.cos(yaw);
        return [xx, yy * Math.cos(pitch) - z * Math.sin(pitch), yy * Math.sin(pitch) + z * Math.cos(pitch)];
      };
      const proj = xyz => { const [x, y, z] = rot(xyz); return { x: cx + x * scale, y: cy - z * scale, depth: y }; };
      ctx.strokeStyle = edge; ctx.lineWidth = 1;
      for (const [a, b] of [[[-1, 0, 0], [1, 0, 0]], [[0, -1, 0], [0, 1, 0]], [[0, 0, -1], [0, 0, 1]]]) {
        const A = proj(a), B = proj(b); ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      }
      ctx.fillStyle = dim; ctx.font = '12px system-ui';
      [[[-1, 0, 0], axes[0].negative], [[1, 0, 0], axes[0].positive], [[0, -1, 0], axes[1].negative], [[0, 1, 0], axes[1].positive], [[0, 0, -1], axes[2].negative], [[0, 0, 1], axes[2].positive]]
        .forEach(([p, label]) => { const q = proj(p); ctx.fillText(label, q.x + 4, q.y - 4); });
      const all = points.map(point => ({ point, ...proj(point.xyz) }));
      if (you) all.push({ point: you, ...proj(you.xyz) });
      all.sort((a, b) => a.depth - b.depth); projected = all;
      const active = hover || pinned, size = .8 + Math.min(zoom, 3) * .2;
      const draw = ({ point, x, y, depth }, focus) => {
        const base = point.name === 'You' ? 6 : point.highlight ? 7 : Math.max(2, 3 + depth);
        const r = base * size + (focus ? 3 : 0);
        ctx.globalAlpha = focus || point.name === 'You' || point.highlight ? 1 : (active ? .5 : .72);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = point.color; ctx.fill();
        if (focus) {            // white outline with a thin dark halo so it also shows on a light theme
          ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke();
          ctx.lineWidth = 3; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        } else if (point.highlight || point.name === 'You') { ctx.lineWidth = 2; ctx.strokeStyle = text; ctx.stroke(); }
        ctx.globalAlpha = 1;
        if (focus || point.name === 'You' || point.highlight) {
          ctx.font = 'bold 12px system-ui'; ctx.lineWidth = 3; ctx.strokeStyle = bg; ctx.strokeText(point.name, x + r + 4, y - r - 2);
          ctx.fillStyle = text; ctx.fillText(point.name, x + r + 4, y - r - 2);
        }
      };
      all.forEach(item => { if (!active || item.point !== active) draw(item, false); });
      if (active) { const item = all.find(a => a.point === active); if (item) draw(item, true); }
    }

    function hit(e) {
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const limit = e.pointerType === 'touch' ? 24 : 14 + Math.min(zoom, 3) * 2;
      let best = null, distance = Infinity;
      projected.forEach(p => {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < distance || (d === distance && best && p.depth > best.depth)) { best = p; distance = d; }
      });
      return distance < limit ? best : null;
    }

    function showInfo(point, e) {
      info.hidden = false; info.innerHTML = '';
      info.classList.toggle('pinned', point === pinned);
      const head = el('div', 'ideology-map-info-head');
      const dot = el('span', 'ideology-map-info-dot'); dot.style.background = point.color;
      head.append(dot, el('strong', '', point.name)); info.append(head);
      if (point.name === 'You') {
        info.append(el('p', 'ideology-map-info-text', 'Your position, based on your answers.'));
      } else {
        const family = familyOf(point.name);
        if (family) info.append(el('div', 'ideology-map-info-family', family));
        info.append(el('p', 'ideology-map-info-text', shortDescription(point.name)));
        info.append(el('h4', 'ideology-map-info-label', 'History'), el('p', 'ideology-map-info-text', historyOf(point.name)));
      }
      if (point.href) {
        const open = el('a', 'ideology-map-info-link', point.name === 'You' ? 'Open your results' : 'Open full page');
        open.href = point.href; info.append(open);
      }
      const s = stage.getBoundingClientRect();
      if (s.width < 600) { info.classList.add('docked'); info.style.left = info.style.top = ''; return; }
      info.classList.remove('docked');
      const px = e.clientX - s.left, py = e.clientY - s.top;
      const bw = info.offsetWidth, bh = info.offsetHeight;
      info.style.left = clamp(px + 18 + bw > s.width ? px - bw - 18 : px + 18, 6, Math.max(6, s.width - bw - 6)) + 'px';
      info.style.top = clamp(py - bh / 2, 6, Math.max(6, s.height - bh - 6)) + 'px';
    }
    function hideInfo() { if (!pinned) { info.hidden = true; } tip.textContent = defaultTip(); }
    function setHover(p, e) {
      const point = p ? p.point : null;
      if (point === hover && (point === null || !e)) return;
      const changed = point !== hover; hover = point;
      if (point) { showInfo(point, e); tip.textContent = point.name + (point.name === 'You' ? ' — your answers' : ''); }
      else hideInfo();
      if (changed) paint();
      canvas.style.cursor = point ? 'pointer' : '';
    }
    function setZoom(value) { zoom = clamp(value, MIN_ZOOM, MAX_ZOOM); paint(); }
    function clearPinned() { pinned = null; hover = null; info.hidden = true; tip.textContent = defaultTip(); paint(); }

    canvas.addEventListener('pointerdown', e => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]; pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom }; drag = null;
      } else { drag = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false }; }
    });
    canvas.addEventListener('pointermove', e => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.dist > 0) setZoom(pinch.zoom * d / pinch.dist);
        return;
      }
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 5) { drag.moved = true; if (!pinned) { hover = null; info.hidden = true; } }
        if (drag.moved) { yaw += dx * .008; pitch = clamp(pitch + dy * .008, -1.5, 1.5); drag.x = e.clientX; drag.y = e.clientY; paint(); }
        return;
      }
      if (e.pointerType === 'mouse') setHover(hit(e), e);
    });
    function endPointer(e) {
      const wasPinch = !!pinch;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (wasPinch) { drag = null; return; }
      if (drag && !drag.moved && e.type === 'pointerup') {
        const p = hit(e);
        if (e.pointerType === 'mouse') { if (p && p.point.href) location.href = p.point.href; }
        else if (p) {
          if (pinned === p.point && p.point.href) location.href = p.point.href;
          else { pinned = p.point; hover = null; showInfo(pinned, e); tip.textContent = pinned.name; paint(); }
        } else clearPinned();
      }
      drag = null;
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !drag) setHover(null); });
    canvas.addEventListener('wheel', e => { e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * (e.deltaMode ? .05 : .0016))); }, { passive: false });
    canvas.addEventListener('keydown', e => {
      const k = e.key; let used = true;
      if (k === '+' || k === '=') setZoom(zoom * 1.2); else if (k === '-' || k === '_') setZoom(zoom / 1.2); else if (k === '0') { zoom = 1; paint(); }
      else if (k === 'ArrowLeft') { yaw -= .1; paint(); } else if (k === 'ArrowRight') { yaw += .1; paint(); }
      else if (k === 'ArrowUp') { pitch = clamp(pitch - .1, -1.5, 1.5); paint(); } else if (k === 'ArrowDown') { pitch = clamp(pitch + .1, -1.5, 1.5); paint(); }
      else if (k === 'Escape') clearPinned(); else used = false;
      if (used) e.preventDefault();
    });
    zoomIn.onclick = () => setZoom(zoom * 1.25);
    zoomOut.onclick = () => setZoom(zoom / 1.25);
    reset.onclick = () => { yaw = -.62; pitch = .42; zoom = 1; clearPinned(); };
    save.onclick = () => { const a = document.createElement('a'); a.download = 'hypervalues-ideology-map.png'; a.href = canvas.toDataURL('image/png'); a.click(); };
    paint();
    if ('ResizeObserver' in window) new ResizeObserver(paint).observe(canvas); else addEventListener('resize', paint);
  }
  return { render };
})();
