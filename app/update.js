import { createWriteStream, accessSync, constants, mkdtempSync, writeFileSync, chmodSync } from 'fs';
import { execFileSync, spawn } from 'child_process';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const REPO = 'dowan2010/auto-newrrow';

const parse = (v) => String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
export function isNewer(latest, current) {
  const a = parse(latest), b = parse(current);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

// GitHub 최신 릴리스를 확인 (실패해도 앱 사용엔 영향 없게 null 반환)
export async function checkForUpdate(current, arch = process.arch, platform = process.platform) {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'auto-newrrow' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const rel = await res.json();
    const latest = String(rel.tag_name).replace(/^v/, '');
    const suffix = platform === 'win32' ? `win-${arch === 'arm64' ? 'arm64' : 'x64'}.exe` : (arch === 'arm64' ? 'arm64.dmg' : 'x64.dmg');
    const asset = (rel.assets ?? []).find((a) => a.name.endsWith(suffix));
    // 맥은 zip이 있으면 앱이 직접 교체(끌어다 놓기 없음), 없으면 dmg로 대체
    const zip = platform === 'darwin' ? (rel.assets ?? []).find((a) => a.name.endsWith(arch === 'arm64' ? 'arm64.zip' : 'x64.zip')) : null;
    return { current, latest, hasUpdate: isNewer(latest, current), pageUrl: rel.html_url, assetUrl: asset?.browser_download_url ?? null, assetName: asset?.name ?? null, zipUrl: zip?.browser_download_url ?? null, zipName: zip?.name ?? null, notes: rel.body ?? '' };
  } catch {
    return null;
  }
}

// 설치 파일(dmg/exe)을 내려받아 경로를 반환. 앱이 직접 받은 파일은 격리(맥)/웹표시(윈도우) 없이 열려 보안 경고가 안 뜸
export async function downloadAsset(url, name, dir, onProgress = () => {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'auto-newrrow' }, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`다운로드 실패 (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0;
  const file = join(dir, name);
  const body = Readable.fromWeb(res.body);
  body.on('data', (c) => { got += c.length; if (total) onProgress(Math.round((got / total) * 100)); });
  await pipeline(body, createWriteStream(file));
  return file;
}

// 현재 실행 중인 .app 번들 경로 (패키징된 맥 앱일 때만)
export function currentBundlePath(execPath = process.execPath) {
  const m = execPath.match(/^(.*?\.app)\/Contents\/MacOS\//);
  return m ? m[1] : null;
}

// 교체 스크립트: 앱이 종료되길 기다렸다가 번들을 바꾸고 다시 실행. 실패하면 원래 앱으로 되돌림
export const REPLACE_SCRIPT = `#!/bin/bash
PID="$1"; SRC="$2"; DEST="$3"; OPEN="\${OPEN_CMD:-open}"
for i in $(seq 1 100); do kill -0 "$PID" 2>/dev/null || break; sleep 0.3; done
BACKUP="$DEST.old"
rm -rf "$BACKUP"
if mv "$DEST" "$BACKUP" && ditto "$SRC" "$DEST"; then
  xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
  rm -rf "$BACKUP" "$(dirname "$SRC")"
else
  rm -rf "$DEST"; mv "$BACKUP" "$DEST"
fi
$OPEN "$DEST"
`;

export function canReplaceInPlace(bundle) {
  if (!bundle) return false;
  try { accessSync(dirname(bundle), constants.W_OK); accessSync(bundle, constants.W_OK); return true; } catch { return false; }
}

// zip을 받아 풀고, 검증한 뒤 교체 스크립트를 분리 실행. 호출한 쪽에서 앱을 종료해야 교체가 진행됨
export async function stageInPlaceUpdate(zipUrl, zipName, bundle, onProgress = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'newrrow-update-'));
  const zip = await downloadAsset(zipUrl, zipName, dir, onProgress);
  const out = join(dir, 'x');
  execFileSync('ditto', ['-x', '-k', zip, out]);
  const newApp = join(out, 'Auto Newrrow.app');
  execFileSync('codesign', ['--verify', '--deep', '--strict', newApp]); // 깨진 파일이면 여기서 중단
  const script = join(dir, 'replace.sh');
  writeFileSync(script, REPLACE_SCRIPT);
  chmodSync(script, 0o755);
  spawn('/bin/bash', [script, String(process.pid), newApp, bundle], { detached: true, stdio: 'ignore' }).unref();
}
