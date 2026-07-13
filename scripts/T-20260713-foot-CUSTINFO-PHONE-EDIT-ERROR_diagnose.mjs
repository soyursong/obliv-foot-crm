/**
 * T-20260713-foot-CUSTINFO-PHONE-EDIT-ERROR — diagnose-first (READ-ONLY 재현)
 * 고객정보(2번차트) 휴대폰 인라인 수정 저장 시 오류 재현 → root 로그 증거 확보.
 * ⚠ 데이터 무변경: UNIQUE 충돌 UPDATE 는 원자적 reject → 실제 mutation 0.
 *   CHECK 위반 UPDATE 도 reject → mutation 0. (성공 UPDATE 는 실행하지 않음)
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();
const sb = createClient(url, key, { auth: { persistSession: false } });

const line = (s) => console.log(s);

// 1) 같은 clinic 안에서 서로 다른 phone 을 가진 실고객 2명 확보
const { data: custs, error: e1 } = await sb
  .from('customers')
  .select('id, clinic_id, name, phone, phone_dummy')
  .not('phone', 'is', null)
  .limit(2000);
if (e1) { line('❌ 고객 조회 실패: ' + e1.message); process.exit(1); }

line(`총 phone 보유 고객 표본: ${custs.length}`);
// clinic 별 그룹
const byClinic = {};
for (const c of custs) (byClinic[c.clinic_id] ??= []).push(c);
const clinicId = Object.keys(byClinic).sort((a,b)=>byClinic[b].length-byClinic[a].length)[0];
const group = byClinic[clinicId];
line(`대상 clinic=${clinicId} (고객 ${group.length}명)`);

// 서로 다른 phone 2명
let A = null, B = null;
for (const c of group) {
  if (!A) { A = c; continue; }
  if (c.phone !== A.phone) { B = c; break; }
}
if (!A || !B) { line('❌ 서로 다른 phone 2명 확보 실패'); process.exit(1); }
line(`A id=${A.id} phone=${A.phone}`);
line(`B id=${B.id} phone=${B.phone}`);

// 2) [재현 #1] A.phone := B.phone  → UNIQUE(clinic_id, phone) 충돌 기대
line('\n── 재현 #1: A 의 번호를 B 의 번호로 수정(중복) ──');
const { error: eDup } = await sb.from('customers').update({ phone: B.phone }).eq('id', A.id);
if (eDup) {
  line(`❗ ERROR code=${eDup.code}`);
  line(`   message=${eDup.message}`);
  line(`   details=${eDup.details ?? ''}`);
  line(`   hint=${eDup.hint ?? ''}`);
} else {
  line('⚠ 오류 없이 성공(예상과 다름) — 즉시 원복');
  await sb.from('customers').update({ phone: A.phone }).eq('id', A.id);
}

// 3) [재현 #2] CHECK 위반 포맷(비정규 010-…) 직접 저장 시도 (FE 는 E.164 로 저장하지만, 방어 확인)
line('\n── 재현 #2: 비-E.164(010-1234-5678 display) 직접 저장 시도 → CHECK 기대 ──');
const { error: eChk } = await sb.from('customers').update({ phone: '010-1234-5678' }).eq('id', A.id);
if (eChk) {
  line(`❗ ERROR code=${eChk.code}`);
  line(`   message=${eChk.message}`);
} else {
  line('⚠ 비-E.164 저장 성공(CHECK 없음?) — 즉시 원복');
  await sb.from('customers').update({ phone: A.phone }).eq('id', A.id);
}

// 4) 재검증: A.phone 원값 유지 확인 (mutation 0 증명)
const { data: after } = await sb.from('customers').select('phone').eq('id', A.id).single();
line(`\n원값 유지 확인 A.phone = ${after.phone} (기대 ${A.phone}) → ${after.phone===A.phone?'OK 무변경':'⚠ 변경됨!'}`);
