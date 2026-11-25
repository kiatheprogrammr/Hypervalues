#!/usr/bin/env node
// Adds Cybersyndicalism, Rembowskism and two secret ideologies to data.js and ideology_scores.json.
// Secret ideologies are listed in secretIdeologies: they are scored like all others but never shown in the
// public lists or the 3D map until one is a person's result.   node tools/add_ideologies_3_2.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const fail = m => { console.error('STOPPED, nothing was changed: ' + m); process.exit(1); };

const NEW = [
 { label: 'Cybersyndicalism', group: 'Left-Libertarian', after: 'Cybersyn Socialism', color: '#1fb5a3',
   combo: 'syndicalism|cybernetic_socialism|councilism|digital_democracy',
   definition: 'Workers\' syndicates and councils that coordinate production through open digital and cybernetic networks instead of a state or a market: syndicalism and cybernetic socialism, councilism, digital and productive democracy, confederalism, post-industrialism and prometheanism, with civil libertarianism and internationalism. It rejects laissez-faire, state socialism, autocracy and centralism.',
   stances: { syndicalism: 1, cybernetic_socialism: .8, councilism: .7, digital_democracy: .7, productive_democracy: .6, confederalism: .6, prometheanism: .5, post_industrialism: .5, futurism: .4, Internationalism: .6, civil_libertarianism: .5, social_progressivism: .4, laissez_faire: -1, state_socialism: -.6, autocracy: -.8, centralism: -.5, hierarchical_communism: -.6, corporatism: -.5, materialism: .5, rationalism: .5, empiricism: .4, positivism: .3, historical_materialism: .3 } },
 { label: 'Rembowskism', group: 'Centrist', after: 'Third Way', color: '#c9a227',
   combo: 'pragmatism|third_way|Realpolitik|meritocracy',
   definition: 'A results-first centrism that judges every policy by whether it works: pragmatism and the third way, a social market economy, representative democracy and meritocracy, civic nationalism and federalism, a cautious realist foreign policy with some Keynesian support in downturns. It rejects ideological purity, laissez-faire dogma, communization and autocracy.',
   stances: { pragmatism: 1, third_way: .6, social_market: .5, representative_democracy: .6, meritocracy: .5, civic_nationalism: .4, federalism: .4, Realpolitik: .6, keynesianism: .3, civil_liberalism: .3, individualism: .3, rationalism: .4, empiricism: .5, communization: -.8, autocracy: -.7, laissez_faire: -.4, absolute: -.7 } },
 { label: 'Triple T Falangist Neolibertarianism', secret: true, after: 'Anarcho-Fascism', color: '#8a5a2b',
   combo: 'corporatism|laissez_faire|romantic_nationalism|nihilism',
   definition: 'A secret joke doctrine that fuses Falangist corporatism and romantic nationalism with neolibertarian free markets and a minimal state, announced by three knocks before dawn: corporatism and laissez-faire, minarchism, flat taxation, religious traditionalism, imperialism, regimentalism and a nihilist shrug. It rejects communization, state socialism and globalism.',
   stances: { corporatism: .6, laissez_faire: .8, minarchism: .7, flat_taxation: .6, romantic_nationalism: .6, religious_traditionalism: .6, Imperialism: .6, ethical_statism: .4, regimentalism: .4, civil_libertarianism: .4, industrialism: .5, individualism: .5, thomism: .4, nihilism: .5, Globalism: -.5, communization: -1, state_socialism: -.9 } },
 { label: 'Tung Tung Tung Sahur Ecofascist Accelerationism', secret: true, after: 'Anarcho-Fascism', color: '#3f7d3a',
   combo: 'conservationism|romantic_nationalism|techno_fatalism|nihilism',
   definition: 'A secret joke doctrine named after the Tung Tung Tung Sahur internet meme: speed up the collapse of industrial society so that nature can return, led by a strong state at an early-morning pace: conservationism and environmentalism, romantic nationalism, ethical statism, technogaianism, techno-fatalism and nihilism with a taste for futurism and isolationism. It rejects cosmopolitanism, globalism and civil liberalism.',
   stances: { conservationism: .8, environmentalism: .7, romantic_nationalism: .6, ethical_statism: .6, regimentalism: .6, technogaianism: .5, Isolationism: .5, nihilism: .7, techno_fatalism: .6, futurism: .5, prometheanism: .4, patchwork: .3, Cosmopolitanism: -.8, Globalism: -.8, civil_liberalism: -.7, industrialism: -.5 } }
];

const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let data = read('data.js'), json = read('ideology_scores.json');
const crlf = data.includes('\r\n'); if (crlf) data = data.replace(/\r\n/g, '\n');
const jcrlf = json.includes('\r\n'); if (jcrlf) json = json.replace(/\r\n/g, '\n');
const fmt = x => (x < 0 ? '-' : '') + (Math.abs(x) === 1 ? '1' : String(Math.abs(x)).replace(/^0/, ''));
const q = JSON.stringify;

// insert `line` after the unique block line starting with `start`, inside the block that begins with `block`
function insertAfterLine(text, block, startsWith, line, what) {
    const a = text.indexOf(block), b = text.indexOf('\n};', a);
    if (a < 0 || b < 0) fail(what + ': block not found');
    const lines = text.slice(a, b).split('\n');
    const i = lines.findIndex(l => l.startsWith(startsWith));
    if (i < 0) fail(what + ': anchor "' + startsWith + '" not found');
    if (!lines[i].trimEnd().endsWith(',')) { lines[i] = lines[i].trimEnd() + ','; line = line.replace(/,$/, ''); }
    lines.splice(i + 1, 0, line);
    return text.slice(0, a) + lines.join('\n') + text.slice(b);
}
for (const n of NEW) {
    if (data.includes(q(n.label) + ':')) fail(n.label + ' already exists');
    const scoreText = Object.keys(n.stances).map(v => v + ':' + fmt(n.stances[v])).join('|');
    if (!n.secret) {   // group list: add after the anchor entry (handles the last entry of an array)
        const a = data.indexOf('const ideologyGroups'), b = data.indexOf('\n};', a);
        const lines = data.slice(a, b).split('\n');
        const i = lines.findIndex(l => l.trim().replace(/,$/, '') === q(n.after));
        if (i < 0) fail('group anchor ' + n.after);
        const hasComma = lines[i].trim().endsWith(',');
        if (!hasComma) lines[i] += ',';
        lines.splice(i + 1, 0, '        ' + q(n.label) + (hasComma ? ',' : ''));
        data = data.slice(0, a) + lines.join('\n') + data.slice(b);
    }
    // labelMapping: after the first line that maps to the anchor label
    { const a = data.indexOf('const labelMapping'), b = data.indexOf('\n};', a);
      const lines = data.slice(a, b).split('\n');
      const i = lines.findIndex(l => l.trim().endsWith(': ' + q(n.after) + ','));
      if (i < 0) fail('labelMapping anchor ' + n.after);
      if (data.includes(q(n.combo) + ':')) fail('value set already used: ' + n.combo);
      lines.splice(i + 1, 0, '    ' + q(n.combo) + ': ' + q(n.label) + ',');
      data = data.slice(0, a) + lines.join('\n') + data.slice(b); }
    data = insertAfterLine(data, 'const labelColors', '    ' + q(n.after) + ': "', '    ' + q(n.label) + ': ' + q(n.color) + ',', 'labelColors');
    data = insertAfterLine(data, 'const descriptions', '    ' + q(n.after) + ': "', '    ' + q(n.label) + ': ' + q(n.definition) + ',', 'descriptions');
    data = insertAfterLine(data, 'const ideologyScores', '    ' + q(n.after) + ': "', '    ' + q(n.label) + ': ' + q(scoreText) + ',', 'ideologyScores');
    const jl = json.split('\n'), ji = jl.findIndex(l => l.startsWith('    ' + q(n.after) + ': {'));
    if (ji < 0) fail('ideology_scores.json anchor ' + n.after);
    let je = ji; while (!/^    \},?$/.test(jl[je])) je++;
    const wasLast = jl[je] === '    }';
    if (wasLast) jl[je] = '    },';
    jl.splice(je + 1, 0, '    ' + q(n.label) + ': {', '        "d": ' + q(n.definition) + ',', '        "s": ' + q(scoreText), wasLast ? '    }' : '    },');
    json = jl.join('\n');
}
// the list of secret ideologies, placed before iconSources
const secrets = NEW.filter(n => n.secret).map(n => n.label);
if (data.includes('const secretIdeologies')) fail('secretIdeologies already exists');
data = data.replace('const iconSources', () => '// Secret ideologies: scored like all others, but not listed or plotted until one is a result.\nconst secretIdeologies = ' + q(secrets) + ';\n\nconst iconSources');

try { JSON.parse(json); } catch (e) { fail('ideology_scores.json invalid: ' + e.message); }
const ctx = {}; vm.createContext(ctx);
try { vm.runInContext(data.replace(/^const /gm, 'var '), ctx); } catch (e) { fail('data.js would not run: ' + e.message); }
const known = {}; Object.values(ctx.resultsMapping).forEach(c => Object.keys(c).forEach(id => known[id] = 1));
for (const n of NEW) {
    const bad = Object.keys(n.stances).concat(n.combo.split('|')).filter(v => !known[v]);
    if (bad.length) fail(n.label + ': unknown values ' + bad.join(', '));
    if (ctx.labelMapping[n.combo] !== n.label || !ctx.labelColors[n.label] || !ctx.descriptions[n.label] || !ctx.ideologyScores[n.label]) fail(n.label + ' did not register');
    if (!n.secret && ctx.ideologyGroups[n.group].indexOf(n.label) < 0) fail(n.label + ' is not in ' + n.group);
}
fs.writeFileSync(path.join(root, 'data.js'), crlf ? data.replace(/\n/g, '\r\n') : data);
fs.writeFileSync(path.join(root, 'ideology_scores.json'), jcrlf ? json.replace(/\n/g, '\r\n') : json);
console.log('Added ' + NEW.length + ' ideologies (' + secrets.length + ' secret). Next: node tools/build_matrix.js');
