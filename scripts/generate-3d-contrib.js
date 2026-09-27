#!/usr/bin/env node
/**
 * generate-3d-contrib.js
 *
 * Fetches your GitHub contribution calendar via the GraphQL API and renders
 * a standalone isometric 3D SVG, with a height formula tuned so that low
 * contribution counts (1-10/day) are clearly distinguishable from each other.
 *
 * Requirements: Node.js 18+ (uses built-in fetch). No npm install needed.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx USERNAME=jainharsh1047 node generate-3d-contrib.js
 *
 * Optional env vars:
 *   OUTPUT       - output file path (default: profile-3d.svg)
 *   DIVISOR      - height formula divisor, smaller = more separation of low values (default: 3)
 *   MULTIPLIER   - height formula multiplier, bigger = taller overall (default: 220)
 *   BASE_COLOR   - hex color for the tallest/most-active cubes (default: #39d353)
 */

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = process.env.USERNAME;
const OUTPUT = process.env.OUTPUT || 'profile-3d.svg';
const DIVISOR = parseFloat(process.env.DIVISOR || '3');
const MULTIPLIER = parseFloat(process.env.MULTIPLIER || '220');
const BASE_COLOR = process.env.BASE_COLOR || '#39d353';

if (!GITHUB_TOKEN || !USERNAME) {
  console.error('Missing GITHUB_TOKEN or USERNAME environment variables.');
  process.exit(1);
}

const QUERY = `
query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
  }
}`;

// --- height formula: tuned for small counts ---
// count=1 -> ~33, count=3 -> ~71, count=5 -> ~99, count=9 -> ~137
function calcHeight(count) {
  if (count === 0) return 3; // flat baseline cube
  return Math.log10(count / DIVISOR + 1) * MULTIPLIER + 5;
}

// --- color shading based on relative activity ---
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}
function shade(hex, factor) {
  // factor 0..1, 0 = near-white, 1 = full base color
  const [r, g, b] = hexToRgb(hex);
  const mix = (c) => Math.round(255 - (255 - c) * factor);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
function darken(rgbStr, amount) {
  const nums = rgbStr.match(/\d+/g).map(Number);
  return `rgb(${nums.map((n) => Math.max(0, Math.round(n * (1 - amount)))).join(',')})`;
}

async function main() {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: QUERY, variables: { login: USERNAME } }),
  });

  const json = await res.json();
  if (json.errors) {
    console.error('GitHub API error:', JSON.stringify(json.errors, null, 2));
    process.exit(1);
  }

  const calendar = json.data.user.contributionsCollection.contributionCalendar;
  const weeks = calendar.weeks;
  const maxCount = Math.max(
    1,
    ...weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount)),
  );

  // isometric grid constants
  const dx = 7; // horizontal step per week
  const dy = 4; // vertical step per day-of-week
  const cubeW = dx; // top-face half-width
  const weekCount = weeks.length;

  const svgWidth = (weekCount + 8) * dx * 2 + 100;
  const svgHeight = (weekCount + 8) * dy * 2 + 260;
  const offsetX = svgWidth / 2;
  const offsetY = svgHeight - (weekCount + 7) * dy - 60;

  let cubes = '';
  weeks.forEach((week, weekIdx) => {
    week.contributionDays.forEach((day) => {
      const date = new Date(day.date);
      const dayOfWeek = date.getUTCDay(); // Sun=0
      const count = day.contributionCount;
      const h = calcHeight(count);

      const baseX = offsetX + (weekIdx - dayOfWeek) * dx;
      const baseY = offsetY + (weekIdx + dayOfWeek) * dy;

      const intensity = count === 0 ? 0 : Math.min(1, 0.35 + 0.65 * (count / maxCount));
      const topColor = count === 0 ? '#ebedf0' : shade(BASE_COLOR, intensity);
      const leftColor = count === 0 ? '#e1e4e8' : darken(topColor, 0.25);
      const rightColor = count === 0 ? '#d7dade' : darken(topColor, 0.4);

      const topY = baseY - h;

      // top face (rhombus)
      const topPts = [
        [baseX, topY - dy],
        [baseX + dx, topY],
        [baseX, topY + dy],
        [baseX - dx, topY],
      ]
        .map((p) => p.join(','))
        .join(' ');

      // left face (parallelogram) - from bottom-left vertex down to baseY
      const leftPts = [
        [baseX - dx, topY],
        [baseX, topY + dy],
        [baseX, baseY + dy],
        [baseX - dx, baseY],
      ]
        .map((p) => p.join(','))
        .join(' ');

      // right face
      const rightPts = [
        [baseX, topY + dy],
        [baseX + dx, topY],
        [baseX + dx, baseY],
        [baseX, baseY + dy],
      ]
        .map((p) => p.join(','))
        .join(' ');

      cubes += `
      <g>
        <polygon points="${leftPts}" fill="${leftColor}" stroke="#ffffff" stroke-width="0.5" />
        <polygon points="${rightPts}" fill="${rightColor}" stroke="#ffffff" stroke-width="0.5" />
        <polygon points="${topPts}" fill="${topColor}" stroke="#ffffff" stroke-width="0.5" />
      </g>`;
    });
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
  <rect width="100%" height="100%" fill="#ffffff" />
  <text x="20" y="30" font-family="sans-serif" font-size="14" fill="#57606a">${USERNAME}'s contributions (${calendar.totalContributions} total)</text>
  ${cubes}
</svg>`;

  require('fs').writeFileSync(OUTPUT, svg);
  console.log(`Wrote ${OUTPUT} (${calendar.totalContributions} contributions, max/day = ${maxCount})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
