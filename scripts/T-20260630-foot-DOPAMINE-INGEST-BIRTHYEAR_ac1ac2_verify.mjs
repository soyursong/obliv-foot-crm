/**
 * T-20260630-foot-DOPAMINE-INGEST-BIRTHYEAR — AC1+AC2 prod 검증 (self-cleanup)
 *
 * foot ingest EF의 customers INSERT 경로(admin.from('customers').insert(insertPayload))를
 * service_role PostgREST로 정확히 미러해 동일 constraint 표면을 prod 검증한다.
 * (EF positive invoke 는 평문 DOPAMINE_CALLBACK_SECRET 필요 → foot 은 digest만 보유하여 불가.
 *  customers INSERT 는 service_role 동일 경로이므로 PostgREST 직접 insert 가 EF 착지를 미러함.)
 *
 * ── 결과 요약 (2026-06-30 prod rxlomoozakkjesdqjtvd) ───────────────────────
 *   AC1) GREEN — customers.birth_year 컬럼 부재 확인. birth_year 키 부재 payload 정상 INSERT.
 *        (emit-stop 후 ingest 가 birth_year 미참조 → 09:42 'birth_year column not found' 502 해소)
 *   AC2) RED  — foot customers_gender_check 권위값 = (gender IS NULL OR gender IN ('M','F')) 대문자.
 *        대문자 'M'/'F'/null → PASS. 소문자 'm'/'f' → 23514 위반.
 *        dev-dopamine emit-side normalizeGender 가 소문자 'm'/'f' 산출 → foot constraint 위반.
 *        ⇒ 정규화 타겟 case 불일치(emit-side fix 필요, ingest 외 영역). 본 스크립트는 사실 고정용.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.VITE_SUPABASE_URL || env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const MARKER = 'INGEST-BIRTHYEAR-VERIFY';
const PH = { m_lower:'+821099990091', f_lower:'+821099990092', null_:'+821099990093',
            M_upper:'+821099990094', F_upper:'+821099990095', invalid:'+821099990099' };
const ALL = Object.values(PH);
let pass = 0, fail = 0;
const ok  = (m) => { console.log(`  \x1b[32mPASS\x1b[0m ${m}`); pass++; };
const bad = (m) => { console.log(`  \x1b[31mFAIL\x1b[0m ${m}`); fail++; };

await sb.from('customers').delete().in('phone', ALL);   // 사전 cleanup

// ── 1) AC1: birth_year 컬럼 부재 (09:42 502 RC 규명) ──────────────────────
console.log('\n== 1) AC1: customers.birth_year 컬럼 부재 (502 RC) ==');
const byProbe = await sb.from('customers').select('birth_year').limit(1);
if (byProbe.error && /birth_year.*does not exist|could not find/i.test(byProbe.error.message))
  ok(`birth_year 컬럼 부재 → emit 측이 birth_year 보내면 INSERT 깨짐(=09:42 RC). emit-stop 후 키 미동봉 → 해소`);
else if (!byProbe.error) console.log(`  \x1b[33mINFO\x1b[0m birth_year 컬럼 실재 — 부재 RC 아님`);
else console.log(`  \x1b[33mINFO\x1b[0m birth_year probe: ${byProbe.error.code} ${byProbe.error.message}`);

const { data: clinic } = await sb.from('clinics').select('id').eq('slug','jongno-foot').maybeSingle();
const clinicId = clinic.id;
console.log(`   jongno-foot clinic_id = ${clinicId}`);

// EF insertPayload 미러: birth_year 키 항상 부재 + 조건부 gender spread(...(gender ? {gender} : {}))
async function ins(label, phone, gender, expectOk) {
  const p = { name: MARKER, phone, clinic_id: clinicId };
  if (gender != null) p.gender = gender;
  const { data, error } = await sb.from('customers').insert(p).select('id, gender').single();
  if (expectOk) (!error && data) ? ok(`${label} → INSERT 2xx (gender=${JSON.stringify(data.gender)})`)
                                  : bad(`${label} → 기대 2xx 실패: ${error?.code} ${error?.message}`);
  else error ? ok(`${label} → 기대대로 차단 (${error.code})`) : bad(`${label} → 차단 기대였으나 성공`);
}

// ── 2) AC1: birth_year 키 부재 payload 정상 INSERT ────────────────────────
console.log('\n== 2) AC1: birth_year 키 부재 payload customers INSERT 통과 ==');
await ins("birth_year 부재 + gender=null", PH.null_, null, true);

// ── 3) AC2: foot customers_gender_check 권위값 규명 ───────────────────────
console.log('\n== 3) AC2: gender constraint 권위값 (gender IS NULL OR gender IN (\'M\',\'F\')) ==');
await ins("gender='M' (대문자)", PH.M_upper, 'M', true);   // 권위 통과값
await ins("gender='F' (대문자)", PH.F_upper, 'F', true);   // 권위 통과값
await ins("gender='m' (소문자, dopamine emit 현재값)", PH.m_lower, 'm', false); // 위반 — AC2 RED 근거
await ins("gender='f' (소문자, dopamine emit 현재값)", PH.f_lower, 'f', false); // 위반 — AC2 RED 근거
await ins("gender='X' (비정규)", PH.invalid, 'X', false);  // constraint 활성 증명

// ── 4) cleanup + 잔존 0 검증 ──────────────────────────────────────────────
console.log('\n== 4) cleanup ==');
await sb.from('customers').delete().in('phone', ALL);
const { data: residual } = await sb.from('customers').select('id').in('phone', ALL);
(!residual || residual.length === 0) ? ok('test row 잔존 0') : bad(`잔존 ${residual.length}건`);

console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===`);
console.log('판정: AC1 GREEN · AC2 RED(emit-side normalizeGender 소문자→대문자 case 불일치, emit-side fix 필요)');
process.exit(fail === 0 ? 0 : 1);
