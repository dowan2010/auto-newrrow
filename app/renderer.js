const $ = (id) => document.getElementById(id);
const log = $('log');

const ICONS = { '📌': '주제', '📝': '본문', '📋': '계획', '📅': '계획' };
const LABEL = { '📌': '주제', '📝': '본문', '📋': '계획', '📅': '일정' };
let current = null;

function row(cls, time, icon, text) {
  const el = document.createElement('div');
  el.className = `ln ${cls}`;
  for (const [c, v] of [['t', time], ['i', icon], ['x', text]]) {
    const s = document.createElement('span');
    s.className = c;
    s.textContent = v;
    el.appendChild(s);
  }
  return el;
}

function finishCurrent() {
  if (!current) return;
  current.classList.remove('now');
  current.classList.add('done');
  current.querySelector('.i').textContent = '✓';
  current = null;
}

function addLog({ time, text }) {
  const empty = log.querySelector('.empty');
  if (empty) empty.remove();
  let el;
  if (text.startsWith('▸')) {
    finishCurrent();
    el = row('step now', time, '', text.replace(/^▸\s*/, ''));
    const sp = document.createElement('span');
    sp.className = 'spin';
    el.querySelector('.i').appendChild(sp);
    current = el;
  } else if (text.startsWith('✅')) {
    finishCurrent();
    el = row('ok', time, '✓', text.replace(/^✅\s*/, ''));
  } else if (text.startsWith('❌')) {
    finishCurrent();
    el = row('err', time, '!', '실패 — ' + text.replace(/^❌\s*/, ''));
  } else if (text.startsWith('⚠')) {
    el = row('warn', time, '!', text.replace(/^⚠\s*/, ''));
  } else {
    const icon = [...text][0];
    el = row('info', time, '•', ICONS[icon] ? `${LABEL[icon]}  ${text.slice(icon.length).trim()}` : text);
  }
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function clearLog() {
  current = null;
  log.textContent = '';
}

const todayStr = () => new Date().toLocaleDateString('sv');
let dailyOn = false;

function setChip(state, text) {
  $('chip').className = `chip ${state}`;
  $('chipText').textContent = text;
}

function showLast(lr) {
  if (!lr) { setChip('', '오늘 미실행'); $('lastRun').textContent = ''; return; }
  const when = new Date(lr.at);
  const label = `${when.getMonth() + 1}월 ${when.getDate()}일 ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  const ok = lr.result !== 'error';
  $('lastRun').textContent = `마지막 실행 · ${label} · ${ok ? (lr.result === 'already_done' ? '이미 완료돼 있었어요' : '완료') : '실패'}`;
  if (lr.date === todayStr()) setChip(ok ? 'done' : 'err', ok ? '오늘 완료' : '오늘 실패');
  else setChip('', '오늘 미실행');
}

function setSeg(on) {
  dailyOn = on;
  for (const b of $('seg').children) b.classList.toggle('on', (b.dataset.on === '1') === on);
}

async function init() {
  const s = await window.api.getSettings();
  $('email').value = s.email;
  $('password').placeholder = s.hasPassword ? '••••••••  (저장됨)' : '비밀번호';
  $('geminiKey').placeholder = s.hasGeminiKey ? '••••••••  (저장됨)' : 'API 키';
  showLast(s.lastRun);
  const d = await window.api.getDaily();
  setSeg(d.on);
  $('dailyTime').value = d.time || '08:30';
}

$('save').addEventListener('click', async () => {
  await window.api.saveSettings({ email: $('email').value, password: $('password').value, geminiKey: $('geminiKey').value });
  $('password').value = ''; $('geminiKey').value = '';
  $('saveMsg').textContent = '저장했어요';
  setTimeout(() => ($('saveMsg').textContent = ''), 2500);
  init();
});

$('run').addEventListener('click', async () => {
  clearLog();
  const res = await window.api.run();
  const s = await window.api.getSettings();
  showLast(s.lastRun);
  if (!res.ok) setChip('err', '실패');
});

async function applyDaily(on) {
  const r = await window.api.setDaily(on, $('dailyTime').value || '08:30');
  $('dailyMsg').textContent = r.message;
  if (r.ok) setSeg(on);
}
$('seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) applyDaily(b.dataset.on === '1'); });
$('dailyTime').addEventListener('change', () => { if (dailyOn) applyDaily(true); });

window.api.onLog(addLog);
window.api.onStatus((s) => {
  $('run').disabled = s.running;
  $('run').classList.toggle('busy', s.running);
  $('runLabel').textContent = s.running ? '실행 중' : '지금 실행';
  if (s.running) setChip('run', '실행 중');
});
init();
