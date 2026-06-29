/**
 * T-20260517-foot-STAFF-BULK — user_profiles 보정
 * Auth trigger가 name=email, role=coordinator, approved=false, clinic_id=null로 선삽입한 것을
 * 올바른 값(name, role=staff, approved=true, clinic_id)으로 UPDATE.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DRY_RUN = process.env.DRY_RUN !== 'false';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const STAFF_LIST = [
  { email: 'marissong@naver.com',    name: '송지현' },
  { email: 'joo4442@naver.com',      name: '정연주' },
  { email: 'a1208789@naver.com',     name: '엄경은' },
  { email: 'ksl5777@naver.com',      name: '김수린' },
  { email: 'jhy314631@naver.com',    name: '정혜인' },
  { email: 'jungs5322@naver.com',    name: '박민석' },
  { email: 'alsrud102938@naver.com', name: '김민경' },
  { email: 'angelgrgr12@gmail.com',  name: '김규리' },
  { email: 'baekmy1004@naver.com',   name: '백민영' },
  { email: 'byulim12@gmail.com',     name: '임별'   },
  { email: 'gkdlt609@gmail.com',     name: '조선미' },
  { email: 'say093092@naver.com',    name: '김성우' },
  { email: 'kanghyein1477@naver.com',name: '강혜인' },
  { email: 'chxmrrmqxn@naver.com',  name: '최다혜' },
  { email: 'minji9336@naver.com',    name: '최민지' },
  { email: 'miso3295@naver.com',     name: '윤시하' },
  { email: '0195958397@hanmail.net', name: '김유리' },
  { email: 'bonny_31@naver.com',     name: '서은정' },
];

function ok(msg)   { console.log(`✅ ${msg}`); }
function fail(msg) { console.error(`❌ ${msg}`); }
function log(msg)  { console.log(msg); }

async function main() {
  log('='.repeat(60));
  log(`user_profiles 보정 스크립트`);
  log(`모드: ${DRY_RUN ? '🔍 DRY-RUN' : '🚀 실제 UPDATE'}`);
  log('='.repeat(60));

  let successCount = 0;
  let failCount = 0;

  for (const s of STAFF_LIST) {
    if (DRY_RUN) {
      log(`  [DRY] UPDATE user_profiles SET name='${s.name}', role='staff', approved=true, clinic_id=... WHERE email='${s.email}'`);
      successCount++;
      continue;
    }

    const { error } = await supabase
      .from('user_profiles')
      .update({
        name: s.name,
        role: 'staff',
        approved: true,
        active: true,
        clinic_id: CLINIC_ID,
      })
      .eq('email', s.email.toLowerCase());

    if (error) {
      fail(`${s.name} (${s.email}) UPDATE 실패: ${error.message}`);
      failCount++;
    } else {
      ok(`${s.name} (${s.email}) → name/role/approved/clinic_id 갱신`);
      successCount++;
    }
  }

  log('\n' + '='.repeat(60));
  log(`결과: 성공 ${successCount}건 / 실패 ${failCount}건`);
  log('='.repeat(60));
  return failCount === 0;
}

main().catch(err => { console.error('치명 오류:', err.message); process.exit(1); });
