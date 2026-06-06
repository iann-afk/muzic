// api/lyric.js — Vercel serverless 代理：按歌曲 id 取网易云歌词（lrc）
// 用途：前端聚焦某首歌时按需拉这首的歌词（懒加载，不在载歌单时批量拉）。
// 验证：部署后开 /api/lyric?id=2150491694，看返回 { ok, id, lrc }。

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const NE_HEADERS = {
  'User-Agent': UA,
  'Referer': 'https://music.163.com/',
  'Origin': 'https://music.163.com',
  'Cookie': 'os=pc; appver=2.9.7',
  'Content-Type': 'application/x-www-form-urlencoded',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // 歌词基本不变，缓存久一点
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');

  try {
    const id = (req.query && (req.query.id || req.query.url)) || '';
    const m = String(id).match(/(\d{3,})/); // 容错：纯 id 或带链接都抠数字
    if (!m) {
      return res.status(400).json({ ok: false, error: 'no_song_id' });
    }
    const songId = m[1];

    // lv=-1 原版歌词；tv=-1 翻译歌词
    const r = await fetch('https://music.163.com/api/song/lyric', {
      method: 'POST',
      headers: NE_HEADERS,
      body: new URLSearchParams({ id: songId, lv: '-1', tv: '-1' }).toString(),
    });
    if (!r.ok) throw new Error(`NetEase ${r.status}`);
    const data = await r.json();

    const lrc = (data && data.lrc && data.lrc.lyric) || '';
    const tlrc = (data && data.tlyric && data.tlyric.lyric) || '';

    return res.status(200).json({
      ok: true,
      id: songId,
      lrc,            // 原文 lrc（带时间戳）
      tlrc,           // 翻译 lrc（可能为空）
      nolyric: !lrc,  // 纯音乐/无词标记
    });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: 'lyric_failed', message: String(err.message || err) });
  }
}
