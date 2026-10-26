import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync, realpathSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { PKG_DIR } from './paths.js';

const LABEL = 'com.daymark.autonewrrow';
const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOG_DIR = join(homedir(), 'Library', 'Logs');

function assertMac() {
  if (process.platform !== 'darwin') throw new Error('자동 실행 등록은 현재 macOS만 지원해요 (다른 OS는 cron/작업 스케줄러에서 `newrrow --auto`를 매일 실행하면 돼요)');
}

// brew 업그레이드로 바뀌는 버전 경로(Cellar/...) 대신 PATH 상의 안정적인 node 경로를 사용
function nodePath() {
  try {
    const p = execFileSync('which', ['node'], { encoding: 'utf-8' }).trim();
    if (p && realpathSync(p) === realpathSync(process.execPath)) return p;
  } catch {}
  return process.execPath;
}

function unload() {
  try { execFileSync('launchctl', ['unload', PLIST], { stdio: 'ignore' }); } catch {}
}

export function installDaily(time = '08:30') {
  assertMac();
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`시간 형식이 올바르지 않아요: "${time}" (예: 08:30)`);
  const cli = realpathSync(join(PKG_DIR, 'cli.js'));
  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>${LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${nodePath()}</string>
		<string>${cli}</string>
		<string>--auto</string>
	</array>
	<key>WorkingDirectory</key><string>${PKG_DIR}</string>
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

export function uninstallDaily() {
  assertMac();
  if (!existsSync(PLIST)) return '등록된 자동 실행이 없어요';
  unload();
  unlinkSync(PLIST);
  return '자동 실행 해제 완료';
}
