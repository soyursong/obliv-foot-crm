// T-20260616-foot-CHART2-TAB-BTN-DECOLOR #1 펜차트 탭 — 장식 보라(purple) → 모노톤 neutral sweep.
// filled action 버튼=charcoal(neutral-800/900, ACTIONBTN 정합), 헤더/테두리/도트=neutral 그레이.
// 의미색 carve-out 무관(펜차트 purple은 순수 테마 장식). 순서 지정(prefixed 우선) 치환.
import fs from 'node:fs';
const f = 'src/components/PenChartTab.tsx';
let s = fs.readFileSync(f, 'utf8');
const pairs = [
  ['hover:bg-purple-700', 'hover:bg-neutral-900'],
  ['bg-purple-600', 'bg-neutral-800'],
  ['bg-purple-500', 'bg-neutral-500'],
  ['bg-purple-200', 'bg-neutral-200'],
  ['hover:bg-purple-100', 'hover:bg-neutral-200'],
  ['bg-purple-100', 'bg-neutral-200'],
  ['bg-purple-50', 'bg-neutral-100'],
  ['text-purple-800', 'text-neutral-800'],
  ['text-purple-700', 'text-neutral-700'],
  ['text-purple-600', 'text-neutral-500'],
  ['hover:border-purple-400', 'hover:border-neutral-400'],
  ['hover:border-purple-300', 'hover:border-neutral-300'],
  ['focus:border-purple-400', 'focus:border-neutral-400'],
  ['border-purple-400', 'border-neutral-400'],
  ['border-purple-300', 'border-neutral-300'],
  ['border-purple-200', 'border-neutral-200'],
  ['border-purple-100', 'border-neutral-200'],
  ['ring-purple-300', 'ring-neutral-300'],
];
let n = 0;
for (const [a, b] of pairs) {
  const before = s;
  s = s.split(a).join(b);
  if (s !== before) n++;
}
fs.writeFileSync(f, s);
const left = (s.match(/purple/g) || []).length;
console.log(`applied ${n} rules; remaining 'purple' occurrences: ${left}`);
