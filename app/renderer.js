document.documentElement.dataset.platform = window.api.platform;
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
let provider = 'gemini';
let saved = { gemini: false, openai: false };

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

function setProvider(p) {
  provider = p;
  for (const b of $('provSeg').children) b.classList.toggle('on', b.dataset.p === p);
  $('aiKeyLabel').textContent = p === 'openai' ? 'OpenAI API 키' : 'Gemini API 키';
  $('aiKey').placeholder = saved[p] ? '••••••••  (저장됨)' : 'API 키';
  $('aiKey').value = '';
}
$('provSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setProvider(b.dataset.p); });

function setSeg(on) {
  dailyOn = on;
  for (const b of $('seg').children) b.classList.toggle('on', (b.dataset.on === '1') === on);
}

async function init() {
  const s = await window.api.getSettings();
  $('email').value = s.email;
  $('password').placeholder = s.hasPassword ? '••••••••  (저장됨)' : '비밀번호';
  saved = { gemini: s.hasGeminiKey, openai: s.hasOpenaiKey };
  setProvider(s.aiProvider || 'gemini');
  showLast(s.lastRun);
  const d = await window.api.getDaily();
  setSeg(d.on);
  $('dailyTime').value = d.time || '08:30';
}

$('save').addEventListener('click', async () => {
  await window.api.saveSettings({ email: $('email').value, password: $('password').value, aiProvider: provider, [provider === 'openai' ? 'openaiKey' : 'geminiKey']: $('aiKey').value });
  $('password').value = ''; $('aiKey').value = '';
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

// 업데이트 확인 — 새 버전이 있으면 알림 띄우고, 버튼으로 dmg를 받아 열어 줌
(async () => {
  const info = await window.api.checkUpdate();
  $('ver').textContent = `버전 ${info.version}`;
  if (!info.update) return;
  $('updateText').textContent = `새 버전 ${info.update.latest}이 있어요`;
  $('update').classList.add('show');
  window.api.onUpdateProgress((p) => {
    if (p === 'installing') { $('updateText').textContent = '설치 중이에요. 앱이 잠시 꺼졌다 다시 켜져요'; $('updateBtn').style.display = 'none'; }
    else $('updateBtn').textContent = `받는 중 ${p}%`;
  });
  $('updateBtn').addEventListener('click', async () => {
    $('updateBtn').disabled = true;
    $('updateBtn').textContent = '받는 중…';
    const r = await window.api.installUpdate();
    if (!r.ok) { $('updateBtn').disabled = false; $('updateBtn').textContent = '다시 시도'; $('updateText').textContent = r.error; return; }
    if (r.opened === 'replace') return;
    $('updateText').textContent = r.opened === 'dmg' ? '열린 창에서 Applications로 끌어다 덮어쓰세요' : '릴리스 페이지를 열었어요';
    $('updateBtn').style.display = 'none';
  });
})();
