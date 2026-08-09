/**
 * T-20260718-foot-ATTENDANCE-READ-SWAP — step0 배포前 freshness 재검증 (READ-ONLY probe)
 * planner GATE-RELEASE(MSG-20260810-075119-cdtt) step0:
 *   - last_sync age (<15min)
 *   - unmatched=0 / errors=0 (직전 cron 틱 정합)
 *   - 시트 '오늘 출근자'수 == staff_attendance present 카운트 정합
 * clean → step1(main merge) 진행 / stale·broken → main merge STOP + FOLLOWUP.
 * 본 단계는 READ-ONLY (staff_attendance write 0). EF 라이브 reconcile 는 phase B 에서 별도.
 */
import { query, PROJ_REF } from './lib/foot_migration_ledger.mjs';

const FOOT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 오리진(종로)점 = 시트 sync 소스
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
console.log(`── STEP0 FRESHNESS PROBE (READ-ONLY) — ${nowKst()} — proj=${PROJ_REF} ──\n`);

const out = {};

// 1. freshness: max(synced_at) age (분)
out.freshness = await query(`
  SELECT max(synced_at) AS max_synced_at,
         EXTRACT(EPOCH FROM (now() - max(synced_at)))/60.0 AS age_min
  FROM public.staff_attendance
  WHERE clinic_id = '${FOOT_CLINIC_ID}';
`);

// 2. cron 상태 재확인
out.cron = await query(`
  SELECT jobname, schedule, active FROM cron.job WHERE jobname='foot-attendance-sync';
`);

// 3. 오늘(KST) present 카운트 (배정화면 '출근 N명' 의 DB read 소스)
out.today_present = await query(`
  SELECT count(*) AS present_cnt
  FROM public.staff_attendance
  WHERE clinic_id = '${FOOT_CLINIC_ID}'
    AND date = (now() AT TIME ZONE 'Asia/Seoul')::date
    AND status = 'present';
`);

// 4. 오늘 present staff 명단 (참고)
out.today_names = await query(`
  SELECT s.name
  FROM public.staff_attendance a
  JOIN public.staff s ON s.id = a.staff_id
  WHERE a.clinic_id = '${FOOT_CLINIC_ID}'
    AND a.date = (now() AT TIME ZONE 'Asia/Seoul')::date
    AND a.status = 'present'
  ORDER BY s.name;
`);

// 5. 최근 cron 틱 결과 (net._http_response) — unmatched/errors 는 EF 응답 body 로 확인
out.recent_http = await query(`
  SELECT id, status_code,
         (content::jsonb ->> 'ok') AS ok,
         (content::jsonb ->> 'inserted') AS inserted,
         (content::jsonb ->> 'updated') AS updated,
         (content::jsonb ->> 'deleted') AS deleted,
         (content::jsonb ->> 'unmatched') AS unmatched,
         (content::jsonb ->> 'errors') AS errors,
         created
  FROM net._http_response
  WHERE content::text LIKE '%staff_active%'
  ORDER BY created DESC
  LIMIT 5;
`);

console.log(JSON.stringify(out, null, 2));

// 판정
const fr = out.freshness?.[0] ?? out.freshness?.result?.[0];
const age = fr ? Number(fr.age_min) : null;
console.log('\n── VERDICT INPUTS ──');
console.log('age_min =', age);
console.log('cron =', JSON.stringify(out.cron));
console.log('today_present =', JSON.stringify(out.today_present));
