// 릴리스 변경 기록: /api/releases → { releases: [{ version, date, items: [문자열] }] }
const REPO = 'dowan2010/auto-newrrow';

export default async function handler(req, res) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=12`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'auto-newrrow-site' },
  });
  if (!r.ok) return res.status(502).json({ releases: [] });
  const list = await r.json();
  const releases = list.filter((x) => !x.draft && !x.prerelease).map((x) => {
    const version = String(x.tag_name).replace(/^v/, '');
    const body = String(x.body ?? '');
    const i = body.indexOf(`## ${version}`);
    const section = i >= 0 ? body.slice(i).replace(/^## .*\n/, '') : '';
    const items = section.split('\n').filter((l) => /^\s*-\s+/.test(l)).map((l) => l.replace(/^\s*-\s+/, '').trim());
    return { version, date: x.published_at, items };
  }).filter((x) => x.items.length);
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.json({ releases });
}
