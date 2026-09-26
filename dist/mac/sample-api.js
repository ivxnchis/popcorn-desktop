// A tiny stand-in for the movie and show API, with made-up titles and
// generated artwork, so CI screenshots always have content to show.
//
// Usage: node dist/mac/sample-api.js [port]   (then point the custom API
// servers at http://127.0.0.1:<port>/)
'use strict';

const http = require('http');

const port = Number(process.argv[2] || 8099);
const base = `http://127.0.0.1:${port}`;

const movieTitles = [
  'The Last Lighthouse', 'Neon Harbor', 'Paper Moons', 'Signal Lost', 'Salt & Iron',
  'The Quiet Orbit', 'Wildfire Season', 'Glass Canyon', 'Midnight Express Line', 'Northern Static',
  'Hollow Crown', 'Velvet Engine', 'A Map of Tides', 'Blue Hour', 'The Cartographer',
  'Echo Valley', 'Ember & Ash', 'Sundown Motel', 'Parallel Lines', 'Winter Garden',
  'Copper Sky', 'Low Tide', 'The Understudy', 'Night Swim'
];
const showTitles = [
  'Harbor Lights', 'The Outpost', 'Stillwater', 'Kingdom of Wires', 'Second Chances',
  'Deep Field', 'The Night Desk', 'Quarry Road', 'Afterglow', 'Satellite Hearts'
];
const genres = ['drama', 'thriller', 'science-fiction', 'adventure', 'comedy', 'mystery', 'romance', 'action'];
const synopsis = 'When a routine assignment goes sideways, an unlikely pair has one long night to ' +
  'untangle a secret that reaches far beyond their small town, and each other.';

const hue = (i) => (i * 47) % 360;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function poster(i, title) {
  const h = hue(i);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750" viewBox="0 0 500 750">
<defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
<stop offset="0" stop-color="hsl(${h},62%,52%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},55%,12%)"/></linearGradient>
<radialGradient id="s" cx="0.7" cy="0.3" r="0.6"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="500" height="750" fill="url(#g)"/><rect width="500" height="750" fill="url(#s)"/>
<circle cx="${160 + (i * 37) % 180}" cy="${220 + (i * 53) % 160}" r="${90 + (i * 29) % 70}" fill="hsl(${(h + 180) % 360},70%,60%)" opacity="0.28"/>
<text x="40" y="640" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="46" fill="#fff" letter-spacing="1">${esc(title.toUpperCase()).split(' ').slice(0, 2).join(' ')}</text>
<text x="40" y="690" font-family="Helvetica, Arial, sans-serif" font-weight="600" font-size="46" fill="#fff" opacity="0.85">${esc(title.toUpperCase()).split(' ').slice(2).join(' ')}</text>
</svg>`;
}

function fanart(i) {
  const h = hue(i);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${(h + 30) % 360},45%,14%)"/><stop offset="1" stop-color="hsl(${h},60%,38%)"/></linearGradient>
<radialGradient id="s" cx="0.72" cy="0.38" r="0.5"><stop offset="0" stop-color="hsl(${(h + 20) % 360},90%,75%)" stop-opacity="0.8"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
<rect width="1920" height="1080" fill="url(#g)"/><rect width="1920" height="1080" fill="url(#s)"/>
<path d="M0 820 Q480 700 960 790 T1920 760 V1080 H0 Z" fill="#000" opacity="0.35"/>
</svg>`;
}

const torrent = { url: 'magnet:?xt=urn:btih:0000000000000000000000000000000000000000', seed: 420, peer: 36, seeds: 420, peers: 36, size: 2147483648, filesize: '2.0 GB', provider: 'Sample' };

function movie(i) {
  const title = movieTitles[i];
  return {
    imdb_id: `tt90000${String(i).padStart(2, '0')}`,
    tmdb_id: 900000 + i,
    title,
    year: String(2026 - (i % 5)),
    genres: [genres[i % genres.length], genres[(i + 3) % genres.length]],
    rating: { percentage: 62 + (i * 7) % 33, votes: 1000, watching: 10 },
    runtime: String(94 + (i * 11) % 60),
    images: { poster: `${base}/img/poster/${i}.svg`, fanart: `${base}/img/fanart/${i}.svg`, banner: `${base}/img/fanart/${i}.svg` },
    synopsis,
    trailer: 'http://www.youtube.com/watch?v=aaaaaaaaaaa',
    certification: ['PG-13', 'R', 'PG'][i % 3],
    contextLocale: 'en',
    torrents: { en: { '1080p': torrent, '720p': torrent } }
  };
}

function show(i, withEpisodes) {
  const title = showTitles[i];
  const s = {
    imdb_id: `tt80000${String(i).padStart(2, '0')}`,
    tvdb_id: String(700000 + i),
    title,
    year: String(2026 - (i % 6)),
    slug: title.toLowerCase().replace(/[^a-z]+/g, '-'),
    num_seasons: 1 + (i % 4),
    genres: [genres[(i + 1) % genres.length]],
    runtime: '52',
    status: 'continuing',
    rating: { percentage: 70 + (i * 5) % 25, votes: 1000, watching: 10 },
    synopsis,
    images: { poster: `${base}/img/poster/${i + 40}.svg`, fanart: `${base}/img/fanart/${i + 40}.svg`, banner: `${base}/img/fanart/${i + 40}.svg` },
    contextLocale: 'en'
  };
  if (withEpisodes) {
    s.episodes = [];
    for (let season = 1; season <= s.num_seasons; season++) {
      for (let episode = 1; episode <= 8; episode++) {
        s.episodes.push({
          tvdb_id: Number(`${700000 + i}${season}${episode}`),
          season,
          episode,
          title: ['Pilot', 'The Long Way Round', 'Undertow', 'Open Water', 'Static', 'Homecoming', 'The Signal', 'First Light'][episode - 1],
          overview: 'Loyalties are tested as the crew follows a lead that points somewhere nobody wanted to look.',
          first_aired: 1700000000 + season * 3e7 + episode * 6e5,
          torrents: { '0': torrent, '720p': torrent, '1080p': torrent }
        });
      }
    }
  }
  return s;
}

http.createServer((req, res) => {
  const path = req.url.split('?')[0];
  const json = (data) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  let m;
  if ((m = path.match(/^\/img\/(poster|fanart)\/(\d+)\.svg$/))) {
    const i = Number(m[2]);
    const title = i >= 40 ? showTitles[i - 40] : movieTitles[i];
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    res.end(m[1] === 'poster' ? poster(i, title || 'Untitled') : fanart(i));
  } else if ((m = path.match(/^\/movies\/(\d+)$/))) {
    json(m[1] === '1' ? movieTitles.map((_, i) => movie(i)) : []);
  } else if ((m = path.match(/^\/shows\/(\d+)$/))) {
    json(m[1] === '1' ? showTitles.map((_, i) => show(i, false)) : []);
  } else if ((m = path.match(/^\/show\/tt80000(\d+)$/))) {
    json(show(Number(m[1]), true));
  } else if ((m = path.match(/^\/movie\/tt90000(\d+)\/torrents$/))) {
    json({ en: movie(Number(m[1])).torrents.en });
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(port, '127.0.0.1', () => console.log(`Sample API on ${base}`));
