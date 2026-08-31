#!/usr/bin/env node
// Generates assets for the STATISTICS section as a themed SVG panel (ICA style).
// Usage: GITHUB_TOKEN=<token> node scripts/generate-stats.mjs [--out dist/stats.svg]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const LOGIN = process.env.GH_USER || "AbdullahM07";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : "dist/stats.svg";

if (!TOKEN) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": LOGIN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const baseData = await gql(
  `query($login: String!) {
    user(login: $login) {
      createdAt
      followers { totalCount }
      pullRequests { totalCount }
      issues { totalCount }
      repositoriesContributedTo(contributionTypes: [COMMIT, PULL_REQUEST, ISSUE, REPOSITORY]) { totalCount }
      repositories(first: 100, ownerAffiliations: OWNER, orderBy: { field: STARGAZERS, direction: DESC }) {
        nodes {
          isFork
          stargazerCount
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name } }
          }
        }
      }
    }
  }`,
  { login: LOGIN }
);

const user = baseData.user;
const createdYear = new Date(user.createdAt).getUTCFullYear();
const now = new Date();
const nowYear = now.getUTCFullYear();
const today = now.toISOString().slice(0, 10);

let totalCommits = 0;
const dayCounts = new Map();
for (let year = createdYear; year <= nowYear; year++) {
  const from = `${year}-01-01T00:00:00Z`;
  const to = `${year}-12-31T23:59:59Z`;
  const d = await gql(
    `query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions
          restrictedContributionsCount
          contributionCalendar { weeks { contributionDays { date contributionCount } } }
        }
      }
    }`,
    { login: LOGIN, from, to }
  );
  const cc = d.user.contributionsCollection;
  totalCommits += cc.totalCommitContributions + cc.restrictedContributionsCount;
  for (const w of cc.contributionCalendar.weeks)
    for (const day of w.contributionDays)
      if (day.date <= today) dayCounts.set(day.date, day.contributionCount);
}

// Streaks over the full contribution history.
const dates = [...dayCounts.keys()].sort();
let longest = 0;
let run = 0;
for (const date of dates) {
  run = dayCounts.get(date) > 0 ? run + 1 : 0;
  if (run > longest) longest = run;
}
let current = 0;
{
  const cursor = new Date(`${today}T00:00:00Z`);
  // A streak is still alive if today has no contributions yet.
  if (!(dayCounts.get(today) > 0)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (dayCounts.get(cursor.toISOString().slice(0, 10)) > 0) {
    current++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
}

const ownRepos = user.repositories.nodes.filter((r) => !r.isFork);
const totalStars = ownRepos.reduce((s, r) => s + r.stargazerCount, 0);

const langBytes = new Map();
for (const repo of ownRepos)
  for (const e of repo.languages.edges)
    langBytes.set(e.node.name, (langBytes.get(e.node.name) || 0) + e.size);
const ranked = [...langBytes.entries()].sort((a, b) => b[1] - a[1]);
const totalBytes = ranked.reduce((s, [, b]) => s + b, 0) || 1;
const topLangs = ranked.slice(0, 5).map(([name, bytes]) => ({ name, pct: (bytes / totalBytes) * 100 }));
const restPct = ranked.slice(5).reduce((s, [, b]) => s + (b / totalBytes) * 100, 0);
if (restPct > 0.05) topLangs.push({ name: "Other", pct: restPct });

const fmt = (n) => n.toLocaleString("en-US");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const cells = [
  { label: "COMMITS", value: fmt(totalCommits) },
  { label: "STARS EARNED", value: fmt(totalStars) },
  { label: "PULL REQUESTS", value: fmt(user.pullRequests.totalCount) },
  { label: "ISSUES FILED", value: fmt(user.issues.totalCount) },
  { label: "FOLLOWERS", value: fmt(user.followers.totalCount) },
  { label: "CONTRIBUTED TO", value: fmt(user.repositoriesContributedTo.totalCount) },
];

const RAMP = ["#ff525a", "#e31b23", "#c00d13", "#8f070e", "#67060b", "#45050a"];

let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 300" width="1000" height="300" role="img" aria-label="Field record — GitHub statistics">
  <defs><style>.s{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif}</style></defs>
  <rect width="1000" height="300" fill="#08080a"/>
  <rect x="40" y="16" width="920" height="268" fill="none" stroke="#3c3c44"/>
  <rect x="40" y="16" width="4" height="268" fill="#d10a11"/>
`;

// Stat cells: 3 columns x 2 rows.
cells.forEach((c, i) => {
  const x = 72 + (i % 3) * 172;
  const y = 40 + Math.floor(i / 3) * 70;
  svg += `  <rect x="${x}" y="${y}" width="160" height="58" fill="#101016" stroke="#3c3c44"/>
  <rect x="${x}" y="${y}" width="3" height="58" fill="#d10a11" opacity=".55"/>
  <text class="s" x="${x + 16}" y="${y + 32}" font-size="20" font-weight="bold" letter-spacing="1" fill="#f2f2f2">${c.value}</text>
  <text class="s" x="${x + 16}" y="${y + 48}" font-size="8" letter-spacing="2.2" fill="#8a8a90">${c.label}</text>
`;
});

// Streak block with crosshair corners.
svg += `  <rect x="620" y="40" width="308" height="128" fill="#101016" stroke="#3c3c44"/>
  <g stroke="#d10a11" stroke-width="1.2" fill="none" opacity=".85">
    <path d="M620 52 v-12 h12"/><path d="M916 40 h12 v12"/>
    <path d="M620 156 v12 h12"/><path d="M916 168 h12 v12"/>
  </g>
  <text class="s" x="774" y="68" text-anchor="middle" font-size="9.5" letter-spacing="2.8" fill="#8a8a90">CURRENT STREAK</text>
  <text class="s" x="774" y="118" text-anchor="middle" font-size="42" font-weight="bold" letter-spacing="2" fill="#d10a11">${current}</text>
  <text class="s" x="774" y="136" text-anchor="middle" font-size="9" letter-spacing="3" fill="#8a8a90">DAYS</text>
  <text class="s" x="774" y="158" text-anchor="middle" font-size="9.5" letter-spacing="2" fill="#8a8a90">LONGEST &#8212; ${longest} DAYS</text>
`;

// Language bar + legend.
svg += `  <rect x="72" y="192" width="3" height="16" fill="#d10a11"/>
  <text class="s" x="86" y="205" font-size="9.5" letter-spacing="2.8" fill="#8a8a90">TOP LANGUAGES</text>
  <text class="s" x="928" y="205" text-anchor="end" font-size="9" letter-spacing="2.6" fill="#3c3c44">// BY CODE VOLUME</text>
  <rect x="72" y="216" width="856" height="10" fill="#101016" stroke="#3c3c44"/>
`;
let bx = 72;
topLangs.forEach((l, i) => {
  const w = (l.pct / 100) * 856;
  svg += `  <rect x="${bx.toFixed(1)}" y="216" width="${Math.max(w, 1).toFixed(1)}" height="10" fill="${RAMP[i]}"/>\n`;
  bx += w;
});
let lx = 72;
topLangs.forEach((l, i) => {
  const label = esc(l.name);
  const pct = `${l.pct.toFixed(1)}%`;
  svg += `  <rect x="${lx}" y="244" width="8" height="8" fill="${RAMP[i]}"/>
  <text class="s" x="${lx + 14}" y="252" font-size="10" fill="#8a8a90">${label}</text>
  <text class="s" x="${lx + 14 + label.length * 5.6 + 6}" y="252" font-size="10" font-weight="bold" fill="#f2f2f2">${pct}</text>
`;
  lx += 14 + label.length * 5.6 + 6 + pct.length * 5.8 + 26;
});

const stamp = now.toISOString().slice(0, 16).replace("T", " ");
svg += `  <text class="s" x="928" y="274" text-anchor="end" font-size="8" letter-spacing="2" fill="#3c3c44">LAST SYNC &#8212; ${stamp} UTC</text>
</svg>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg);
console.log(`wrote ${OUT} (commits=${totalCommits} stars=${totalStars} streak=${current}/${longest} langs=${topLangs.map((l) => l.name).join(",")})`);
