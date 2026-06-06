// api/lyric.js — Vercel serverless 代理：按歌曲 id 取网易云歌词
// 用途：前端聚焦某首歌时按需拉这首的歌词（懒加载）。
// 处理三种情况：
//   1) 有时间戳歌词 → synced:true，前端做时间轴高亮
//   2) 有词但无时间戳（纯文本）→ synced:false, hasLyric:true，前端静态显示全文
//   3) 纯音乐 / 真没词 → hasLyric:false，前端显示「暂无歌词」
// 验证：/api/lyric?id=<歌曲id>，看 { ok, hasLyric, synced, lrc }。

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

// 一段文本里是否含 [mm:ss] 时间戳
function hasTimestamp(s) {
  return !!s && /\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(s);
}

// 一段文本里是否有「真正的词」（去掉元信息/纯空行后还剩内容）
function hasRealText(s) {
  if (!s) return false;
  const cleaned = s
    .split('\n')
    .map(l => l.replace(/\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '')) // 去时间戳
    .map(l => l.replace(/^\[[a-z]+:.*\]$/i, ''))                      // 去 [ti:][ar:][by:] 等元信息整行
    .join('')
    .trim();
  return cleaned.length > 0;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');

  try {
    const id = (req.query && (req.query.id || req.query.url)) || '';
    const m = String(id).match(/(\d{3,})/);
    if (!m) return res.status(400).json({ ok: false, error: 'no_song_id' });
    const songId = m[1];

    // lv 原文 / tv 翻译 / kv 逐字(karaoke) / yv 新版逐字
    const r = await fetch('https://music.163.com/api/song/lyric?_nmclfl=1', {
      method: 'POST',
      headers: NE_HEADERS,
      body: new URLSearchParams({
        id: songId, lv: '-1', tv: '-1', kv: '-1', yv: '-1',
      }).toString(),
    });
    if (!r.ok) throw new Error(`NetEase ${r.status}`);
    const data = await r.json();

    const pureMusic = !!(data && data.pureMusic); // 网易云明确标记的纯音乐
    let lrc = (data && data.lrc && data.lrc.lyric) || '';
    const tlrc = (data && data.tlyric && data.tlyric.lyric) || '';
    const klrc = (data && data.klyric && data.klyric.lyric) || '';

    // 第三种情况兜底：lrc 空但 klyric 有内容 → 用 klyric
    if (!hasRealText(lrc) && hasRealText(klrc)) lrc = klrc;

    const hasLyric = !pureMusic && hasRealText(lrc);
    const synced = hasLyric && hasTimestamp(lrc);

    return res.status(200).json({
      ok: true,
      id: songId,
      hasLyric,        // 有没有真正的词（区分纯音乐/真没词）
      synced,          // 词带不带时间戳（决定能否做高亮）
      pureMusic,       // 网易云标记的纯音乐
      lrc,             // 原文（可能带/不带时间戳）
      tlrc,            // 翻译
    });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: 'lyric_failed', message: String(err.message || err) });
  }
}
