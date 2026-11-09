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

function addLog({ time, text, detail }) {
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
    const body = ICONS[icon] ? text.slice(icon.length).trim() : text;
    const label = ICONS[icon] && !body.startsWith(LABEL[icon]) ? `${LABEL[icon]}  ` : '';
    el = row('info', time, '•', ICONS[icon] ? `${label}${body}` : text);
    if (detail) {
      el.classList.add('click');
      el.title = '클릭해서 전체 보기';
      const more = document.createElement('span');
      more.className = 'more';
      more.textContent = '전체 보기 ›';
      el.querySelector('.x').appendChild(more);
      el.addEventListener('click', () => openModal(LABEL[icon] ?? '상세', detail));
    }
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
let school = 'dgsm';
let saved = { gemini: false, openai: false, claude: false };

function setChip(state, text) {
  $('chip').className = `chip ${state}`;
  $('chipText').textContent = text;
}

function showLast(lr) {
  if (!lr) { setChip('', '오늘 미실행'); $('lastRun').textContent = ''; return; }
  const when = new Date(lr.at);
  const label = `${when.getMonth() + 1}월 ${when.getDate()}일 ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  const ok = lr.result !== 'error';
  $('lastRun').textContent = `마지막 실행 · ${label} · ${ok ? (lr.result === 'already_done' ? '이미 완료돼 있었어요' : '완료') : `실패${lr.message ? ` — ${lr.message}` : ''}`}`;
  if (lr.date === todayStr()) setChip(ok ? 'done' : 'err', ok ? '오늘 완료' : '오늘 실패');
  else setChip('', '오늘 미실행');
}

function setProvider(p) {
  provider = p;
  for (const b of $('provSeg').children) b.classList.toggle('on', b.dataset.p === p);
  $('aiKeyLabel').textContent = { gemini: 'Gemini API 키', openai: 'OpenAI API 키', claude: 'Claude 토큰' }[p];
  $('aiKey').placeholder = saved[p] ? '••••••••  (저장됨)' : (p === 'claude' ? 'sk-ant-oat…' : 'API 키');
  $('aiKey').value = '';
}
$('provSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setProvider(b.dataset.p); });

function setSchool(sc) {
  school = sc;
  for (const b of $('schoolSeg').children) b.classList.toggle('on', b.dataset.sc === sc);
  $('schoolUrl').style.display = sc === 'custom' ? '' : 'none';
}
$('schoolSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setSchool(b.dataset.sc); });

function setShow(on) {
  for (const b of $('showSeg').children) b.classList.toggle('on', (b.dataset.s === '1') === on);
}
$('showSeg').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const on = b.dataset.s === '1';
  await window.api.saveSettings({ showBrowser: on });
  setShow(on);
});

function setSeg(on) {
  dailyOn = on;
  for (const b of $('seg').children) b.classList.toggle('on', (b.dataset.on === '1') === on);
}

async function init() {
  const s = await window.api.getSettings();
  $('email').value = s.email;
  $('password').placeholder = s.hasPassword ? '••••••••  (저장됨)' : '비밀번호';
  saved = { gemini: s.hasGeminiKey, openai: s.hasOpenaiKey, claude: s.hasClaudeKey };
  setProvider(s.aiProvider || 'gemini');
  setSchool(s.school || 'dgsm');
  if (!$('runDate').value) $('runDate').value = todayStr();
  $('schoolUrl').value = s.schoolUrl || '';
  setShow(!!s.showBrowser);
  showLast(s.lastRun);
  const d = await window.api.getDaily();
  setSeg(d.on);
  $('dailyTime').value = d.time || '08:30';
}

$('save').addEventListener('click', async () => {
  try {
    await window.api.saveSettings({ email: $('email').value, password: $('password').value, aiProvider: provider, school, schoolUrl: $('schoolUrl').value, [`${provider}Key`]: $('aiKey').value });
  } catch (err) {
    $('saveMsg').textContent = String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    return;
  }
  $('password').value = ''; $('aiKey').value = '';
  $('saveMsg').textContent = '저장했어요';
  setTimeout(() => ($('saveMsg').textContent = ''), 2500);
  init();
});

$('run').addEventListener('click', async () => {
  clearLog();
  const date = $('runDate').value || todayStr();
  const res = await window.api.run(date);
  const s = await window.api.getSettings();
  showLast(s.lastRun);
  if (!res.ok && date === todayStr()) setChip('err', '실패');
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

// 릴리스 노트에서 해당 버전 변경 내용만 추려냄 (받을 파일 안내·표는 제외)
function releaseNotes(body, version) {
  let t = String(body ?? '');
  const i = t.indexOf(`## ${version}`);
  if (i >= 0) t = t.slice(i).replace(/^## .*\n/, '');
  else t = t.split('\n').filter((l) => !l.trim().startsWith('|')).join('\n');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

// 업데이트 직후 첫 실행이면 이번 버전 변경 내용을 보여줌
(async () => {
  const w = await window.api.getWhatsNew();
  if (!w) return;
  const notes = releaseNotes(w.notes, w.version);
  if (notes) openModal(`${w.version} 업데이트 내용`, notes);
})();

// 업데이트 확인 — 새 버전이 있으면 알림 띄우고, 버튼으로 dmg를 받아 열어 줌
(async () => {
  const info = await window.api.checkUpdate();
  $('ver').textContent = `버전 ${info.version}`;
  if (!info.update) return;
  $('updateText').textContent = `새 버전 ${info.update.latest}이 있어요`;
  $('update').classList.add('show');
  const notes = releaseNotes(info.update.notes, info.update.latest);
  if (notes) {
    $('updateNotes').style.display = '';
    $('updateNotes').addEventListener('click', () => openModal(`${info.update.latest} 변경 내용`, notes));
  }
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

// 도움말
const help = $('help');
const setHelp = (on) => { help.classList.toggle('show', on); document.body.style.overflow = on ? 'hidden' : ''; if (on) help.scrollTop = 0; };
$('helpBtn').addEventListener('click', () => setHelp(true));
$('helpClose').addEventListener('click', () => setHelp(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setHelp(false); });
help.addEventListener('click', (e) => { const a = e.target.closest('a[data-url]'); if (a) window.api.openExternal(a.dataset.url); });

// 실행 기록 (자동/수동 실행 결과와 로그)
$('historyBtn').addEventListener('click', async () => {
  const list = await window.api.getHistory();
  if (!list.length) return openModal('실행 기록', '아직 기록이 없어요. 이 버전부터 실행할 때마다 쌓여요.');
  const label = { done: '완료', already_done: '이미 완료', error: '실패' };
  const body = list.map((h) => {
    const d = new Date(h.at);
    const head = `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${h.trigger === 'auto' ? '자동' : '수동'} · ${h.date ? `${h.date}분 · ` : ''}${label[h.result] ?? h.result}${h.message ? ` — ${h.message}` : ''}`;
    return `■ ${head}\n${h.log.split('\n').map((l) => `   ${l}`).join('\n')}`;
  }).join('\n\n');
  openModal('실행 기록', body);
});

// 로그 상세 보기 (본문 전체 등)
const modal = $('modal');
function openModal(title, body) {
  $('modalTitle').textContent = title;
  $('modalBody').textContent = body;
  $('modalCopy').textContent = '복사';
  modal.classList.add('show');
}
const closeModal = () => modal.classList.remove('show');
$('modalClose').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
$('modalCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('modalBody').textContent); $('modalCopy').textContent = '복사됨'; }
  catch { const s = window.getSelection(); const rg = document.createRange(); rg.selectNodeContents($('modalBody')); s.removeAllRanges(); s.addRange(rg); $('modalCopy').textContent = '선택됨 (Cmd+C)'; }
});

// dmg 안에서 실행 중이면 안내 (이 상태에선 업데이트·자동 실행이 안 됨)
(async () => {
  const env = await window.api.envInfo();
  if (!env.fromDmg) return;
  $('dmgWarn').classList.add('show');
  $('dmgWarnBtn').addEventListener('click', () => window.api.openApplications());
})();
