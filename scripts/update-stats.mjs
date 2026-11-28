import fs from 'node:fs';
import path from 'node:path';

const USERNAME = process.env.GITHUB_USERNAME;
const TOKEN = process.env.GITHUB_TOKEN;

if (!USERNAME || !TOKEN) {
  throw new Error('Mancano GITHUB_USERNAME o GITHUB_TOKEN');
}

const query = `
  query($login: String!) {
    user(login: $login) {
      repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
        totalCount
        nodes {
          stargazerCount
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges {
              size
              node {
                name
                color
              }
            }
          }
        }
      }
      contributionsCollection {
        totalCommitContributions
        restrictedContributionsCount
      }
      pullRequests {
        totalCount
      }
    }
  }
`;

const res = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: {
    Authorization: `bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query, variables: { login: USERNAME } }),
});

const json = await res.json();
if (json.errors) {
  throw new Error(JSON.stringify(json.errors));
}

const user = json.data.user;
const repos = user.repositories.nodes;

const totalRepos = user.repositories.totalCount;
const totalCommits =
  user.contributionsCollection.totalCommitContributions +
  user.contributionsCollection.restrictedContributionsCount;
const totalPRs = user.pullRequests.totalCount;
const totalStars = repos.reduce((sum, r) => sum + r.stargazerCount, 0);

// Aggrega i byte per linguaggio
const langMap = new Map();
for (const repo of repos) {
  for (const edge of repo.languages.edges) {
    const { name, color } = edge.node;
    const prev = langMap.get(name) || { name, color, size: 0 };
    prev.size += edge.size;
    langMap.set(name, prev);
  }
}

const fallbackColors = ['#f97316', '#a855f7', '#3b82f6', '#ec4899'];
const totalBytes = [...langMap.values()].reduce((s, l) => s + l.size, 0) || 1;

const topLangs = [...langMap.values()]
  .sort((a, b) => b.size - a.size)
  .slice(0, 4)
  .map((l, i) => ({
    name: l.name,
    color: l.color || fallbackColors[i],
    pct: (l.size / totalBytes) * 100,
  }));

// Garantisce sempre 4 voci per il radar anche se hai meno di 4 linguaggi
while (topLangs.length < 4) {
  topLangs.push({
    name: '—',
    color: fallbackColors[topLangs.length],
    pct: 0,
  });
}

const esc = (str) =>
  String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const formatPct = (pct) => (pct >= 10 || pct === 0 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`);
const today = new Date().toISOString().slice(0, 10);

// --- 1. RADAR SVG ---
const maxPct = Math.max(...topLangs.map((l) => l.pct), 1);
const radius = (pct) => (pct === 0 ? 10 : 15 + 70 * Math.sqrt(pct / maxPct));

const r0 = radius(topLangs[0].pct); // Top
const r1 = radius(topLangs[1].pct); // Right
const r2 = radius(topLangs[2].pct); // Bottom
const r3 = radius(topLangs[3].pct); // Left

const p0 = [210, +(160 - r0).toFixed(1)];
const p1 = [+(210 + r1).toFixed(1), 160];
const p2 = [210, +(160 + r2).toFixed(1)];
const p3 = [+(210 - r3).toFixed(1), 160];

const radarSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="320" viewBox="0 0 420 320" fill="none">
  <rect x="1" y="1" width="418" height="318" rx="8" fill="#09090b" stroke="#a1a1aa" stroke-width="1.2"/>
  <text x="20" y="34" fill="#2dd4bf" font-family="monospace" font-size="14" font-weight="600">Radar linguaggi</text>
  <g stroke="#27272a" stroke-width="1">
    <polygon points="210,75 295,160 210,245 125,160" fill="none"/>
    <polygon points="210,103 267,160 210,217 153,160" fill="none"/>
    <polygon points="210,131 239,160 210,189 181,160" fill="none"/>
    <line x1="210" y1="75" x2="210" y2="245"/>
    <line x1="125" y1="160" x2="295" y2="160"/>
  </g>
  <polygon points="${p0.join(',')} ${p1.join(',')} ${p2.join(',')} ${p3.join(',')}" fill="#2dd4bf" fill-opacity="0.28" stroke="#2dd4bf" stroke-width="2"/>
  <circle cx="${p0[0]}" cy="${p0[1]}" r="3" fill="#2dd4bf"/>
  <circle cx="${p1[0]}" cy="${p1[1]}" r="3" fill="#2dd4bf"/>
  <circle cx="${p2[0]}" cy="${p2[1]}" r="3" fill="#2dd4bf"/>
  <circle cx="${p3[0]}" cy="${p3[1]}" r="3" fill="#2dd4bf"/>
  <g fill="#e4e4e7" font-family="monospace" font-size="11">
    <text x="210" y="64" text-anchor="middle">${esc(topLangs[0].name)}</text>
    <text x="306" y="164" text-anchor="start">${esc(topLangs[1].name)}</text>
    <text x="210" y="264" text-anchor="middle">${esc(topLangs[2].name)}</text>
    <text x="114" y="164" text-anchor="end">${esc(topLangs[3].name)}</text>
  </g>
  <text x="20" y="300" fill="#a1a1aa" font-family="sans-serif" font-size="10">Proporzione di codice per linguaggio, scala radice quadrata</text>
</svg>
`;

// --- 2. LANGS SVG ---
const topTotalPct = topLangs.reduce((s, l) => s + l.pct, 0) || 1;
let stackedX = 20;
const stackedBars = topLangs
  .map((l) => {
    const w = +((l.pct / topTotalPct) * 380).toFixed(1);
    const bar = `<rect x="${stackedX.toFixed(1)}" y="52" width="${w}" height="6" fill="${l.color}"/>`;
    stackedX += w;
    return bar;
  })
  .join('\n  ');

const langRows = topLangs
  .map((l, i) => {
    const y = 96 + i * 48;
    const fillW = +((l.pct / 100) * 380).toFixed(1);
    return `<circle cx="26" cy="${y}" r="4" fill="${l.color}"/>
  <text x="38" y="${y + 4}" fill="#e4e4e7" font-family="sans-serif" font-size="13">${esc(l.name)}</text>
  <text x="400" y="${y + 4}" fill="#2dd4bf" font-family="monospace" font-size="12" text-anchor="end">${formatPct(l.pct)}</text>
  <rect x="20" y="${y + 14}" width="380" height="4" rx="2" fill="#27272a"/>
  <rect x="20" y="${y + 14}" width="${fillW}" height="4" rx="2" fill="${l.color}"/>`;
  })
  .join('\n  ');

const langsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="320" viewBox="0 0 420 320" fill="none">
  <rect x="1" y="1" width="418" height="318" rx="8" fill="#09090b" stroke="#a1a1aa" stroke-width="1.2"/>
  <text x="20" y="34" fill="#2dd4bf" font-family="monospace" font-size="14" font-weight="600">Linguaggi principali</text>
  ${stackedBars}
  ${langRows}
  <text x="20" y="300" fill="#a1a1aa" font-family="sans-serif" font-size="10">aggiornato il ${today}</text>
</svg>
`;

// --- 3. STATS SVG ---
const statsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="850" height="90" viewBox="0 0 850 90" fill="none">
  <rect x="1" y="1" width="848" height="88" rx="8" fill="#09090b" stroke="#a1a1aa" stroke-width="1.2"/>
  <line x1="212" y1="18" x2="212" y2="72" stroke="#27272a" stroke-width="1"/>
  <line x1="425" y1="18" x2="425" y2="72" stroke="#27272a" stroke-width="1"/>
  <line x1="637" y1="18" x2="637" y2="72" stroke="#27272a" stroke-width="1"/>
  <text x="24" y="34" fill="#a1a1aa" font-family="sans-serif" font-size="12">Repository</text>
  <text x="24" y="66" fill="#2dd4bf" font-family="monospace" font-size="22" font-weight="600">${totalRepos}</text>
  <text x="236" y="34" fill="#a1a1aa" font-family="sans-serif" font-size="12">Commit ultimo anno</text>
  <text x="236" y="66" fill="#2dd4bf" font-family="monospace" font-size="22" font-weight="600">${totalCommits}</text>
  <text x="449" y="34" fill="#a1a1aa" font-family="sans-serif" font-size="12">Pull request</text>
  <text x="449" y="66" fill="#2dd4bf" font-family="monospace" font-size="22" font-weight="600">${totalPRs}</text>
  <text x="661" y="34" fill="#a1a1aa" font-family="sans-serif" font-size="12">Stelle ricevute</text>
  <text x="661" y="66" fill="#2dd4bf" font-family="monospace" font-size="22" font-weight="600">${totalStars}</text>
</svg>
`;

fs.mkdirSync('assets', { recursive: true });
fs.writeFileSync(path.join('assets', 'radar.svg'), radarSvg);
fs.writeFileSync(path.join('assets', 'langs.svg'), langsSvg);
fs.writeFileSync(path.join('assets', 'stats.svg'), statsSvg);
console.log('SVG aggiornati correttamente.');
