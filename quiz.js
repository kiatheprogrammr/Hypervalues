// The questions of one category (quiz.html?cat=economics). Getting a value saves it and goes back to
// the list of categories (results.html).
const params = new URLSearchParams(window.location.search);
const category = params.get('cat');
const answers = HV.loadAnswers();
let currentQuestions = {};
let currentNodeId = null;
let nodeStack = [];        // questions already answered, for the back button

function backToList() {
  window.location.href = `results.html#cat-${category}`;
}

function showError(message) {
  document.getElementById('question').innerText = message;
  const buttonsDiv = document.getElementById('buttons');
  buttonsDiv.innerHTML = '';
  buttonsDiv.classList.remove('cards', 'locked', 'multi-column');
  buttonsDiv.appendChild(makeButton('Back', backToList));
}

fetch('questions_tree.json')
  .then(res => {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  })
  .then(tree => {
    // hasOwnProperty: keys such as "constructor" or "__proto__" must not count as categories
    if (!category || !Object.prototype.hasOwnProperty.call(tree, category)) {
      window.location.replace('results.html');
      return;
    }
    tree[category].forEach(q => currentQuestions[q.id] = q);
    renderNode(currentQuestions[tree[category][0].id]);
  })
  .catch(() => {
    showError('Could not load the questions. Check your connection and try again.');
  });

function makeButton(text, onClick) {
  const btn = document.createElement('button');
  btn.innerText = text;
  btn.onclick = onClick;
  return btn;
}

// an answer is a card: hover or focus lifts it forward in white, a click confirms it and the others fade
function makeCard(text, index, color, onChoose) {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'answer-card'; btn.style.setProperty('--i', index);
  if (color) btn.style.setProperty('--card-accent', color);
  const key = document.createElement('span'); key.className = 'card-key'; key.textContent = String(index + 1); key.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span'); label.className = 'card-text'; label.textContent = text;
  btn.append(key, label);
  btn.onclick = () => {
    const wrap = btn.parentElement;
    if (wrap.classList.contains('locked')) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onChoose(); return; }
    wrap.classList.add('locked'); btn.classList.add('chosen');
    wrap.querySelectorAll('.answer-card').forEach(other => { if (other !== btn) other.classList.add('faded'); });
    setTimeout(onChoose, 420);
  };
  return btn;
}

function renderNode(node) {
  currentNodeId = node.id;
  const buttonsDiv = document.getElementById('buttons');
  buttonsDiv.innerHTML = '';
  const questionEl = document.getElementById('question');
  questionEl.innerText = node.text || "";
  questionEl.tabIndex = -1;
  ensureKeyboardHint(buttonsDiv);

  buttonsDiv.classList.add('cards');
  buttonsDiv.classList.remove('locked', 'multi-column');

  node.options.forEach((opt, index) => {
    const btn = makeCard(opt.text, index, opt.color, () => selectOption(opt.next));
    if (index < 9) btn.setAttribute('aria-keyshortcuts', String(index + 1));
    buttonsDiv.appendChild(btn);
  });

  const back = makeButton(nodeStack.length ? 'Previous Question' : 'Back', previousQuestion);
  back.setAttribute('aria-keyshortcuts', 'ArrowLeft Backspace');
  buttonsDiv.appendChild(back);
  questionEl.focus({ preventScroll: true });   // the new question is read out
}

// a line under the answers that tells keyboard users about the shortcuts (hidden on touch screens)
function ensureKeyboardHint(buttonsDiv) {
  if (document.getElementById('keyboard-hint')) return;
  const hint = document.createElement('p');
  hint.id = 'keyboard-hint';
  hint.className = 'kb-hint';
  hint.textContent = 'Keyboard: press 1 to 9 to choose an answer, Left arrow or Backspace to go back.';
  buttonsDiv.insertAdjacentElement('afterend', hint);
}

document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || !currentQuestions[currentNodeId]) return;
  const buttons = document.querySelectorAll('#buttons button');
  const options = (currentQuestions[currentNodeId].options || []).length;
  if (/^[1-9]$/.test(event.key)) {
    const number = Number(event.key);
    if (number <= options && buttons[number - 1]) { event.preventDefault(); buttons[number - 1].click(); }
  } else if (event.key === 'ArrowLeft' || event.key === 'Backspace') {
    if (buttons.length) { event.preventDefault(); buttons[buttons.length - 1].click(); }
  }
});

function selectOption(nextId) {
  nodeStack.push(currentNodeId);
  const node = currentQuestions[nextId];
  if (!node) {
    nodeStack.pop();
    showError('This question is missing. Please go back.');
    return;
  }
  if (!node.options) {
    addValue(node.id);
  } else {
    renderNode(node);
  }
}

function addValue(valueId) {
  const list = answers[category] || (answers[category] = []);
  const existing = list.find(item => item.value === valueId);
  if (!existing) {
    list.push({ value: valueId, agree: 1 });
  } else if (!(existing.agree > 0)) {
    // picked again after being marked neutral or opposite: it now matches
    existing.agree = 1;
  }
  HV.saveAnswers(answers);
  backToList();
}

function previousQuestion() {
  if (nodeStack.length) {
    renderNode(currentQuestions[nodeStack.pop()]);
  } else {
    backToList();
  }
}
