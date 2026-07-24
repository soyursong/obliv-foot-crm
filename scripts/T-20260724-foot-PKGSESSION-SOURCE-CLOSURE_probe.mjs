// T-20260724-foot-PKGSESSION-BACKFILL-AND-EFFICACY (G-C-1) — 소스닫힘 READ-ONLY 포렌식 probe
// ══════════════════════════════════════════════════════════════════════════
// 목적: 'is_package_session=true 세팅하되 package_session_id 미세팅' 라이브 생성 경로 pin.
//   FOLLOWUP 판정 재현: matched-but-FK-null(flag=true 2/flag=false 1) + 라이브 드리프트.
//   → guard#4('두 컬럼 함께 SET') 위반 행을 실측하고, 소비(package_sessions used)와 대조해
//     "소비됐는데 flag=false"(handleClose clobber) vs "flag=true인데 FK-null"(deduct 조기마킹)를 분리.
// 스코프: mutation 0. SELECT only. write/DDL 없음.
// 인증컨텍스트: service_role (RLS bypass) — cross-CRM 진단 인증컨텍스트 표준 준수(0-row≠wipe).
// PHI 위생: 산출물엔 count/시각/session_type만. 개별 환자 식별정보 제외.
// tz: KST(UTC+9) 인지 — created_at 구간 산정 시 UTC 저장값 그대로 사용, 표기만 참고.
// ══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('missing env'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function q(path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: { ...H, Prefer: 'count=exact' } });
  const cr = r.headers.get('content-range');
  const total = cr ? cr.split('/')[1] : '?';
  const body = await r.json();
  return { total, body };
}

const out = {};

// (0) 전체 그레인
out.cis_total = (await q('check_in_services?select=id')).total;

// (1) flag=true & FK NULL  ← deduct 조기마킹 leak (line 1791)
out.flag_true_fk_null = (await q('check_in_services?select=id&is_package_session=eq.true&package_session_id=is.null')).total;

// (2) flag=true & FK NOT NULL ← 정상(RPC atomic SET or C3 보존)
out.flag_true_fk_set = (await q('check_in_services?select=id&is_package_session=eq.true&package_session_id=not.is.null')).total;

// (3) flag=false & FK NULL (총량 — 대부분 비패키지 정상행)
out.flag_false_fk_null = (await q('check_in_services?select=id&is_package_session=eq.false&package_session_id=is.null')).total;

// (4) flag=false & FK NOT NULL ← 절대 있으면 안 됨(clobber 흔적: FK 남고 flag만 false)
out.flag_false_fk_set = (await q('check_in_services?select=id&is_package_session=eq.false&package_session_id=not.is.null')).total;

// (5) 소비된 회차(used, check_in 有) — 마킹돼야 할 상한
out.used_sessions_with_checkin = (await q("package_sessions?select=id,check_in_id,session_type&status=eq.used&check_in_id=not.is.null")).total;

// (6) FK-set 행 최근 created_at 상위(드리프트 관찰; PHI 없이 시각/타입만)
const recent = await q('check_in_services?select=id,check_in_id,is_package_session,package_session_id,created_at,service_name&is_package_session=eq.true&package_session_id=is.null&order=created_at.desc&limit=10');
out.flag_true_fk_null_recent = (recent.body ?? []).map(r => ({
  created_at: r.created_at, service_name: r.service_name, ci: r.check_in_id?.slice(0, 8),
}));

// (7) 소비됐는데 flag=false 인 check_in — handleClose clobber 후보.
//   used 세션이 걸린 check_in 중, 그 check_in 의 check_in_services 가 전부 flag=false 인 건.
const used = await q("package_sessions?select=check_in_id,session_type&status=eq.used&check_in_id=not.is.null&limit=1000");
const usedCIs = [...new Set((used.body ?? []).map(r => r.check_in_id))];
let consumedButNoFlag = 0;
const sample = [];
for (const ci of usedCIs) {
  const r = await q(`check_in_services?select=id&check_in_id=eq.${ci}&is_package_session=eq.true`);
  if (Number(r.total) === 0) { consumedButNoFlag++; if (sample.length < 8) sample.push(ci.slice(0,8)); }
}
out.consumed_checkins_total = usedCIs.length;
out.consumed_but_no_flag_row = consumedButNoFlag;   // false-when-consumed 의 check_in 그레인
out.consumed_but_no_flag_sample = sample;

console.log(JSON.stringify(out, null, 2));
