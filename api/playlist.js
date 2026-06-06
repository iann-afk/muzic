// api/playlist.js — Vercel serverless 代理
// 用途：从粘贴的网易云歌单链接抠出 id，直连网易云 web 接口，返回干净的曲目数组。
// 2a 验证：部署后浏览器开 /api/playlist?url=<歌单链接>，看返回 JSON。

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 伪装成浏览器 + 带 referer/cookie，绕网易云 web 接口的基本校验
const NE_HEADERS = {
  'User-Agent': UA,
  'Referer': 'https://music.163.com/',
  'Origin': 'https://music.163.com',
  'Cookie': 'os=pc; appver=2.9.7',
  'Content-Type': 'application/x-www-form-urlencoded',
};

const MAX_SONGS = 100; // A 决策：≤100 截断

// 最宽松：从任意粘贴文本里抠歌单 id
// 兼容 playlist?id= / #/playlist?id= / /m/playlist?id= / 纯数字 / 带中文文案整段分享
function extractPlaylistId(raw) {
  if (!raw) return null;
  const text = String(raw);
  // 1) 任意 ...playlist...id=<数字>
  let m = text.match(/playlist[^\d]*?[?&#/]\s*id\s*=\s*(\d+)/i);
  if (m) return m[1];
  // 2) 退一步：链接里 id=<数字>
  m = text.match(/[?&#]id=(\d+)/);
  if (m) return m[1];
  // 3) 整段文本里第一串够长的数字（歌单 id 一般 ≥6 位）
  m = text.match(/(\d{6,})/);
  if (m) return m[1];
  return null;
}

async function neFetch(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: NE_HEADERS,
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  if (!res.ok) throw new Error(`NetEase ${res.status} for ${url}`);
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  try {
    const raw = (req.query && (req.query.url || req.query.id)) || '';
    const id = extractPlaylistId(raw);
    if (!id) {
      return res.status(400).json({
        ok: false,
        error: 'no_playlist_id',
        hint: '没从这段文本里抠到歌单 id。把网易云歌单链接整段粘进来即可。',
      });
    }

    // 第一次调用：拿歌单元信息 + trackIds 列表
    const detail = await neFetch(
      'https://music.163.com/api/v6/playlist/detail',
      { id, n: '1000', s: '0' }
    );
    const pl = detail && detail.playlist;
    if (!pl) {
      return res
        .status(502)
        .json({ ok: false, error: 'playlist_detail_failed', id, raw: detail });
    }

    const trackIds = (pl.trackIds || []).map((t) => t.id).slice(0, MAX_SONGS);
    if (trackIds.length === 0) {
      return res
        .status(404)
        .json({ ok: false, error: 'empty_playlist', id });
    }

    // 第二次调用：批量拿名/封面/时长/fee/歌手
    const c = JSON.stringify(trackIds.map((tid) => ({ id: tid })));
    const songData = await neFetch('https://music.163.com/api/v3/song/detail', {
      c,
    });
    const songs = (songData && songData.songs) || [];

    const tracks = songs.map((s) => ({
      id: s.id,
      name: s.name,
      ar: (s.ar || []).map((a) => a.name).join(' / '),
      alPicUrl: (s.al && s.al.picUrl) || '',
      dt: s.dt, // 毫秒时长 → 进度条真实时长
      fee: s.fee, // 0免费 / 1VIP / 4付费专辑 / 8低音质免费
    }));

    return res.status(200).json({
      ok: true,
      id,
      name: pl.name,
      coverImgUrl: pl.coverImgUrl,
      total: pl.trackCount,
      returned: tracks.length,
      truncated: (pl.trackCount || 0) > MAX_SONGS,
      tracks,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: 'proxy_failed', message: String(err.message || err) });
  }
}
