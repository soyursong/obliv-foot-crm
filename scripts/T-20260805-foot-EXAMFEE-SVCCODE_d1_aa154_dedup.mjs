/**
 * T-20260805-foot-EXAMFEE-BILLING-SVCCODE-EXPLICIT-LIST — D-1 AA154 중복행 정리
 *
 * 목표: service_code='AA154' 를 공유하는 두 행 중 inactive 중복행(ed424017 '초진진찰료')의
 *   service_code 를 NULL 로 중화 → 신규 service_code 명시목록(coveredBaseUnit/surcharge)에서
 *   이중참여(같은 코드 2행 매칭) 원천 차단. active 정상행(de611ed5 '초진진찰료-의원')은 무접촉.
 *
 * 안전 규율 (Orphan Archive-First SOP 준용):
 *   - archive-first: 변경 前 대상행 full-row 스냅샷을 stdout 로그로 남긴다(근거 스냅샷).
 *   - per-row: WHERE id=<대상> AND service_code='AA154' AND active=false (3중 가드) 로 단일행만.
 *   - rows-affected==1 검증 (Cross-CRM Write Rows-Affected 표준): 0 또는 2+ 면 abort.
 *   - 순소실0: 행 삭제 없음(soft 중화만). 롤백 = service_code='AA154' 복원.
 *   - 원장 무접점: inactive 서비스는 어떤 UI picker/차트에도 노출 안 됨.
 *   - dry-run 기본, --apply 플래그가 있어야 실제 UPDATE.
 *
 * 롤백 SQL:
 *   UPDATE services SET service_code='AA154'
 *   WHERE id='ed424017-f3d2-4a8f-a00c-b81ab7c69069' AND service_code IS NULL AND active=false;
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TARGET_ID = 'ed424017-f3d2-4a8f-a00c-b81ab7c69069'; // inactive '초진진찰료' 중복행
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`=== D-1 AA154 dedup — ${APPLY ? 'APPLY' : 'DRY-RUN'} ===\n`);

  // 1) freeze-set 재검증 (대상행 현재 상태 스냅샷 + 가드조건 확인)
  const { data: target, error: te } = await sb.from('services').select('*').eq('id', TARGET_ID).maybeSingle();
  if (te) throw te;
  if (!target) { console.error('ABORT: 대상행 없음'); process.exit(1); }
  console.log('[archive-first 스냅샷] 변경 前 대상행:');
  console.log(JSON.stringify(target, null, 2));

  if (target.service_code !== 'AA154' || target.active !== false) {
    console.error(`\nABORT: 가드 불일치 (service_code=${target.service_code}, active=${target.active}). 기대: AA154/false`);
    process.exit(1);
  }

  // 2) 참조 무결성 재확인 (0건이어야 안전)
  const { count: cis } = await sb.from('check_in_services').select('id',{count:'exact',head:true}).eq('service_id', TARGET_ID);
  const { count: sc }  = await sb.from('service_charges').select('id',{count:'exact',head:true}).eq('service_id', TARGET_ID);
  console.log(`\n[참조 무결성] check_in_services=${cis} service_charges=${sc}`);
  if ((cis ?? 0) > 0 || (sc ?? 0) > 0) { console.error('ABORT: 참조행 존재 — 중화 시 청구영향 가능. 재검토 필요.'); process.exit(1); }

  // 3) active 정상행이 AA154 로 여전히 존재하는지 확인 (canonical 보존 검증)
  const { data: canon } = await sb.from('services').select('id,name,active').eq('service_code','AA154').eq('active', true);
  console.log(`\n[canonical 보존] active AA154 행: ${JSON.stringify(canon)}`);
  if (!canon || canon.length !== 1) { console.error('ABORT: active AA154 정상행이 정확히 1건이 아님.'); process.exit(1); }

  if (!APPLY) {
    console.log('\n=== DRY-RUN 종료. 실행하려면 --apply. 예상: service_code AA154 → NULL (1행) ===');
    return;
  }

  // 4) APPLY — per-row 3중 가드 + rows-affected==1 검증
  const { data: updated, error: ue } = await sb.from('services')
    .update({ service_code: null })
    .eq('id', TARGET_ID).eq('service_code', 'AA154').eq('active', false)
    .select('id, service_code, active, name');
  if (ue) throw ue;
  const n = updated?.length ?? 0;
  console.log(`\n[APPLY 결과] rows-affected=${n}`);
  console.log(JSON.stringify(updated, null, 2));
  if (n !== 1) { console.error(`ABORT-POST: rows-affected=${n} ≠ 1. 즉시 롤백 검토.`); process.exit(1); }
  console.log('\n=== APPLY 완료. service_code 중화됨. active AA154 정상행 무접촉 확인. ===');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
