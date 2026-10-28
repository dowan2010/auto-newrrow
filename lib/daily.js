import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync, realpathSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { PKG_DIR } from './paths.js';

const LABEL = 'com.daymark.autonewrrow';
const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOG_DIR = join(homedir(), 'Library', 'Logs');

const IS_WIN = process.platform === 'win32';
const TASK = 'AutoNewrrow';

function assertSupported() {
  if (process.platform !== 'darwin' && !IS_WIN) throw new Error('자동 실행 등록은 macOS/Windows만 지원해요 (Linux는 cron에서 `newrrow --auto`를 매일 실행하면 돼요)');
}

const quote = (s) => `"${s}"`;

// brew 업그레이드로 바뀌는 버전 경로(Cellar/...) 대신 PATH 상의 안정적인 node 경로를 사용
function nodePath() {
  try {
    const p = execFileSync(IS_WIN ? 'where' : 'which', ['node'], { encoding: 'utf-8' }).trim().split(/\r?\n/)[0];
    if (p && realpathSync(p) === realpathSync(process.execPath)) return p;
  } catch {}
  return process.execPath;
}

function unload() {
  try { execFileSync('launchctl', ['unload', PLIST], { stdio: 'ignore' }); } catch {}
}

// launch: { args: [실행파일, ...인자], cwd } — 생략하면 이 CLI(cli.js --auto)를 등록
export function installDaily(time = '08:30', launch) {
  assertSupported();
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`시간 형식이 올바르지 않아요: "${time}" (예: 08:30)`);
  const args = launch?.args ?? [nodePath(), realpathSync(join(PKG_DIR, 'cli.js')), '--auto'];
  const cwd = launch?.cwd ?? PKG_DIR;
  if (IS_WIN) {
    const hhmm = `${String(+m[1]).padStart(2, '0')}:${m[2]}`;
    // 작업 스케줄러: 로그인해 있을 때 매일 해당 시각에 실행 (/F: 기존 등록 덮어쓰기)
    execFileSync('schtasks', ['/Create', '/TN', TASK, '/SC', 'DAILY', '/ST', hhmm, '/TR', args.map(quote).join(' '), '/F'], { stdio: 'ignore' });
    return `매일 ${hhmm}에 자동 실행 등록 완료 (PC가 켜져 있고 로그인된 상태여야 해요)`;
  }
  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>${LABEL}</string>
	<key>ProgramArguments</key>
	<array>
${args.map((a) => `\t\t<string>${a.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`).join('\n')}
	</array>
	<key>WorkingDirectory</key><string>${cwd}</string>
	<key>StartCalendarInterval</key>
	<dict>
		<key>Hour</key><integer>${+m[1]}</integer>
		<key>Minute</key><integer>${+m[2]}</integer>
	</dict>
	<key>StandardOutPath</key><string>${join(LOG_DIR, 'daymark-auto.log')}</string>
	<key>StandardErrorPath</key><string>${join(LOG_DIR, 'daymark-auto.err.log')}</string>
	<key>RunAtLoad</key><false/>
</dict>
</plist>
`;
  unload();
  writeFileSync(PLIST, plist);
  execFileSync('launchctl', ['load', PLIST]);
  return `매일 ${String(+m[1]).padStart(2, '0')}:${m[2]}에 자동 실행 등록 완료 (로그: ~/Library/Logs/daymark-auto.log)`;
}

export function isDailyInstalled() {
  if (IS_WIN) {
    try { execFileSync('schtasks', ['/Query', '/TN', TASK], { stdio: 'ignore' }); return true; } catch { return false; }
  }
  return existsSync(PLIST);
}

export function uninstallDaily() {
  assertSupported();
  if (IS_WIN) {
    if (!isDailyInstalled()) return '등록된 자동 실행이 없어요';
    execFileSync('schtasks', ['/Delete', '/TN', TASK, '/F'], { stdio: 'ignore' });
    return '자동 실행 해제 완료';
  }
  if (!existsSync(PLIST)) return '등록된 자동 실행이 없어요';
  unload();
  unlinkSync(PLIST);
  return '자동 실행 해제 완료';
}
