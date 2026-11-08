// 최신 GitHub 릴리스의 파일로 넘겨주는 다운로드 주소: /api/download?os=mac|win (info=1이면 버전 정보)
const REPO = 'dowan2010/auto-newrrow';
const SUFFIX = { mac: 'arm64.dmg', win: 'win-x64.exe' };

export default async function handler(req, res) {
  const { os, info } = req.query;
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'auto-newrrow-site' },
  });
  if (!r.ok) return res.status(502).send('릴리스 정보를 가져오지 못했어요. 잠시 후 다시 시도해 주세요');
  const rel = await r.json();
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (info) return res.json({ version: String(rel.tag_name).replace(/^v/, '') });
  const asset = SUFFIX[os] && (rel.assets ?? []).find((a) => a.name.endsWith(SUFFIX[os]));
  if (!asset) return res.status(404).send('해당 파일이 아직 없어요 (Windows는 릴리스 후 몇 분 걸려요)');
  res.redirect(302, asset.browser_download_url);
}
