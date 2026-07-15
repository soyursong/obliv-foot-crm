/**
 * T-20260715-foot-RCPT-SPURIOUS-DELETE — probe4: chart_number 발번축 확인 (Q3 / DA C3·C5)
 * DA CONSULT-REPLY(DA-20260715): next_chart_number = durable seq 아님, live customers.chart_number MAX-rescan.
 *   삭제 대상 4행(F-4760~4763)이 (foot clinic, 2026) live MAX면 → top-of-sequence → 삭제 후 재발번 시 재사용.
 *   interior-gap(상위 번호 live 존재)면 → 재발급 원천 없음 → 완전 무해.
 * 판정=GO on 회수불요(재사용 tolerable). 본 probe는 interior vs top 을 evidence로 기록(C5).
 * READ-ONLY: SELECT만. 파괴적 실행 0. author: dev-foot / 2026-07-15
 */
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url),'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim();
const REF='rxlomoozakkjesdqjtvd';
if(!tok){console.error('no SUPABASE_ACCESS_TOKEN');process.exit(1);}
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST',
    headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})
  });
  const t = await r.text();
  if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const TGT = ['a939ec01-859e-462a-8a47-eb8db90b16bf','2db50bad-e200-4d13-ac2e-2356f8bb136a',
             'a22437a5-6602-4d43-a2f6-5e26b8aac727','7fe8dbdd-702d-4f48-abc2-3dfc0cf97fda'];
const inq = TGT.map(x=>`'${x}'`).join(',');

console.log('=== probe4: chart_number 발번축 (interior-gap vs top-of-sequence) ===\n');

// 1) 대상 4행의 chart_number·clinic_id·발번 연도
console.log('[1] 대상 4행 chart_number / clinic_id / created_at');
console.log(JSON.stringify((await q(
  `SELECT id, chart_number, clinic_id, created_at FROM customers WHERE id IN (${inq}) ORDER BY chart_number;`
)),null,1));

// 2) 대상과 같은 (clinic_id, 발번연도) live 최대 chart_number — 대상 제외
//    F-4763 초과 live 행 존재 여부 = interior-gap 판정 핵심
console.log('\n[2] 동일 (clinic_id, year) live MAX chart_number (대상 제외) + F-4763 초과 행 count');
console.log(JSON.stringify((await q(`
  WITH tgt AS (SELECT DISTINCT clinic_id FROM customers WHERE id IN (${inq})),
       live AS (
         SELECT c.chart_number,
                NULLIF(regexp_replace(c.chart_number, '\\D', '', 'g'), '')::bigint AS n
         FROM customers c JOIN tgt USING (clinic_id)
         WHERE c.chart_number ~ '^F' AND c.id NOT IN (${inq})
       )
  SELECT
    (SELECT max(n) FROM live)                              AS live_max_num,
    (SELECT chart_number FROM live ORDER BY n DESC NULLS LAST LIMIT 1) AS live_max_chartno,
    (SELECT count(*) FROM live WHERE n > 4763)             AS above_4763_count
`)),null,1));

// 3) 판정
const r2 = (await q(`
  WITH tgt AS (SELECT DISTINCT clinic_id FROM customers WHERE id IN (${inq})),
       live AS (SELECT NULLIF(regexp_replace(c.chart_number,'\\D','','g'),'')::bigint AS n
                FROM customers c JOIN tgt USING (clinic_id)
                WHERE c.chart_number ~ '^F' AND c.id NOT IN (${inq}))
  SELECT count(*) FILTER (WHERE n > 4763) AS above FROM live;`))[0];
const above = Number(r2.above);
console.log('\n[3] 판정:', above > 0
  ? `INTERIOR-GAP — 상위 번호 ${above}개 live 존재 → 재발급 원천 없음 → 완전 무해`
  : 'TOP-OF-SEQUENCE — 상위 번호 부재 → 삭제 후 재발번 시 F-4760~4763 재사용 가능(tolerable: live unique 위반 아님·archive가 원행 보존·timestamp disambiguate). blocker 아님.');
