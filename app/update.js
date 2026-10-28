import { createWriteStream } from 'fs';
import { join } from 'path';
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
    return { current, latest, hasUpdate: isNewer(latest, current), pageUrl: rel.html_url, assetUrl: asset?.browser_download_url ?? null, assetName: asset?.name ?? null, notes: rel.body ?? '' };
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
