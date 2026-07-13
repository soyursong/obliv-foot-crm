/**
 * T-20260713-foot-NAME-ALIAS-BACKFILL — 별칭 오염 customers.name 백필 대상셋 FREEZE (dry-run, READ-ONLY)
 *
 * 배경: 도파민 emit(별칭이 cue_cards.customer_name에 잔류) → foot EF
 *   `reservation-ingest-from-dopamine` 이 customers.name 을 무가드 override(downgrade).
 *   forensic(MSG-3lky): bulk=NO, footprint ≤6명, 증폭=트리거 fn_sync_customer_name 캐스케이드.
 *   양쪽 가드(EF v27 + RPC-UPSERT) prod-LIVE → bleed-stop 확정 → 백필 재오염 위험 제거.
 *
 * SOP 정합 (data_correction_backfill_sop.md §2 per-row):
 *   freeze 술어 = reservations.source_system='dopamine' (+ customer_id 조인) AND updated_at ≥ 7/8.
 *   ⚠ lead_source 로 도파민 링크 판별 금지 — 앵커(임○옥 ****4470)는 lead_source=NULL (AC-F4 인계).
 *   단일 count 기준 mass UPDATE 금지 → per-row 판정근거 스냅샷.
 *
 * 복원소스 우선순위 (DA 확정, foot audit NEGATIVE):
 *   1) cross-CRM 동일-phone 미오염 name  — ⛔ foot 서비스키로 타 CRM 접근 불가 → per-row UNRESOLVED 표기
 *   2) reservations.customer_real_name    — foot-local, 단 별칭 운반 가능 → per-row 검증 필수
 *   3) cue_cards 도파민 원본               — dev-dopamine 관할(부모)
 *   4) 현장 재입력                          — 1~3 불가 잔여 (AC-B4)
 *
 * ★★★ READ-ONLY. UPDATE/DELETE/INSERT 절대 없음. dry-run 전용. ★★★
 * ★★★ 실 apply 는 AC-B3 현장(박민지 TM팀장) 사람 GO 후에만. ★★★
 * PHI 위생(§4): 실명/전체번호 git-tracked 출력 금지. name=마스킹/길이/ascii여부, phone=tail4.
 * author: dev-foot / 2026-07-13
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const supabase = createClient(
  'https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SRK required'); })(),
  { auth: { persistSession: false } }
);

// 버그윈도우 시작(KST): 82aa77b 도파민 emit 배포(7/8). updated_at ≥ 여기 = 별칭 착지 후보.
const WINDOW_START = '2026-07-08T00:00:00+09:00';

// ── PHI 위생 헬퍼 ──
const hasHangul = (s) => /[㄰-㆏가-힣]/.test(s || '');
const asciiOnly  = (s) => s != null && s.length > 0 && /^[A-Za-z0-9 .,'-]+$/.test(s);
const redactName = (n) => {
  if (n == null) return null;
  const kind = asciiOnly(n) ? 'ASCII' : (hasHangul(n) ? 'HANGUL' : 'MIXED');
  // 한글 이름은 성만 노출(초성 관례), ascii 별칭은 원문(별칭이라 PHI 아님/짧음)
  if (kind === 'HANGUL') return `<${n.slice(0,1)}*len${n.length}>`;
  return `<${kind}:${n.length<=4 ? n : n.slice(0,2)+'…'}>`;
};
const phoneDigits = (p) => (p == null ? '' : ('' + p).replace(/[^0-9]/g, ''));
const phoneTail   = (p) => { const d = phoneDigits(p); return d ? d.slice(-4) : null; };

async function main() {
  console.log('=== T-20260713-foot-NAME-ALIAS-BACKFILL — FREEZE dry-run (READ-ONLY) ===');
  console.log(`freeze 술어: reservations.source_system='dopamine' (customer_id 조인) AND customers.updated_at ≥ ${WINDOW_START}\n`);

  // ── (1) 도파민 링크 예약 → distinct customer_id (source_system 기준, lead_source 금지) ──
  const dopaResv = [];
  { let from = 0; const page = 1000;
    for (;;) {
      const { data, error } = await supabase
        .from('reservations')
        .select('id, customer_id, customer_name, customer_real_name, source_system, reservation_date, created_at, updated_at')
        .eq('source_system', 'dopamine')
        .order('created_at', { ascending: true })
        .range(from, from + page - 1);
      if (error) throw new Error('reservations scan 실패: ' + error.message);
      dopaResv.push(...data);
      if (data.length < page) break; from += page;
    }
  }
  const dopaCustIds = [...new Set(dopaResv.map(r => r.customer_id).filter(Boolean))];
  console.log(`도파민 예약 ${dopaResv.length}건 → distinct 도파민-링크 customer_id ${dopaCustIds.length}명`);

  // ── (2) 해당 customers 조회 ──
  const custs = [];
  for (let i = 0; i < dopaCustIds.length; i += 200) {
    const chunk = dopaCustIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from('customers')
      .select('id, clinic_id, name, phone, phone_dummy, lead_source, visit_type, created_at, updated_at, unified_customer_id')
      .in('id', chunk);
    if (error) throw new Error('customers 조회 실패: ' + error.message);
    custs.push(...data);
  }

  // ── (3) freeze: updated_at ≥ 윈도우 ──
  const winStartMs = new Date(WINDOW_START).getTime();
  const frozen = custs.filter(c => c.updated_at && new Date(c.updated_at).getTime() >= winStartMs);
  console.log(`도파민-링크 고객 중 updated_at ≥ 7/8 = FREEZE 후보 ${frozen.length}명\n`);

  // ── (4) per-row 판정근거 스냅샷 ──
  const rows = [];
  for (const c of frozen) {
    const resvs = dopaResv.filter(r => r.customer_id === c.id);
    // 캐스케이드 영향: 이 고객의 全 reservations / check_ins
    const { count: resvCount } = await supabase.from('reservations')
      .select('id', { count: 'exact', head: true }).eq('customer_id', c.id);
    const { count: ciCount } = await supabase.from('check_ins')
      .select('id', { count: 'exact', head: true }).eq('customer_id', c.id);

    // 복원소스 #2: reservations.customer_real_name (별칭 아닌 실명 후보)
    const realNames = [...new Set(resvs.map(r => r.customer_real_name).filter(Boolean))];
    const realNameHangul = realNames.filter(hasHangul);

    // 별칭 시그니처: 현재 name 이 ascii-only(한글 없음) = 강한 별칭 의심 (앵커 'Ok' 패턴)
    const aliasSig = asciiOnly(c.name);

    // 복원값·출처 판정
    let restore_source = null, restore_hint = null, needs;
    if (realNameHangul.length === 1) {
      restore_source = '#2 reservations.customer_real_name (검증필요)';
      restore_hint = redactName(realNameHangul[0]);
      needs = 'verify_real_name_not_alias';
    } else if (realNameHangul.length > 1) {
      restore_source = '#2 (복수 후보 → per-row 사람검토)';
      restore_hint = realNameHangul.map(redactName).join(' | ');
      needs = 'human_pick';
    } else {
      // #1 cross-CRM 불가(foot 서비스키) + #2 없음 → #4 현장 재입력
      restore_source = '#1 cross-CRM=UNRESOLVED(접근불가) → #4 현장 재입력';
      restore_hint = null;
      needs = 'field_reentry_or_crosscrm';
    }

    rows.push({
      id8: c.id.slice(0, 8),
      customer_id: c.id,
      name_masked: redactName(c.name),
      alias_sig_ascii: aliasSig,
      phone_tail: phoneTail(c.phone),
      phone_dummy: c.phone_dummy,
      lead_source: c.lead_source, // 앵커는 NULL 예상 (freeze 는 lead_source 미사용)
      created_at: c.created_at,
      updated_at: c.updated_at,
      created_eq_updated: c.created_at === c.updated_at,
      dopamine_resv_count: resvs.length,
      cascade_reservations: resvCount,
      cascade_check_ins: ciCount,
      resv_real_name_candidates: realNames.map(redactName),
      restore_source,
      restore_hint,
      needs,
    });
  }

  // 앵커 확인 (customer ac65896b… / phone ****4470)
  const anchor = rows.find(r => r.customer_id.startsWith('ac65896b') || r.phone_tail === '4470');

  // ── 출력 ──
  console.log('id(8) | name | ascii? | tail | dummy | lead_source | created | updated | c=u | dopaResv | casc.resv | casc.ci | real_name후보 | 복원출처 | needs');
  for (const r of rows) {
    console.log(`${r.id8} | ${r.name_masked} | ${r.alias_sig_ascii?'Y':'n'} | ${r.phone_tail} | ${r.phone_dummy?'Y':'n'} | ${r.lead_source ?? 'NULL'} | ${r.created_at?.slice(5,16)} | ${r.updated_at?.slice(5,16)} | ${r.created_eq_updated?'Y':'n'} | ${r.dopamine_resv_count} | ${r.cascade_reservations} | ${r.cascade_check_ins} | ${r.resv_real_name_candidates.join(',')||'-'} | ${r.restore_source} | ${r.needs}`);
  }
  console.log(`\nFREEZE 총 ${rows.length}명. 앵커(****4470) 포함: ${anchor ? 'YES ('+anchor.id8+', name='+anchor.name_masked+', lead_source='+(anchor.lead_source??'NULL')+')' : 'NO ⚠'}`);
  const autoResolvable = rows.filter(r => r.needs === 'verify_real_name_not_alias').length;
  const fieldNeeded = rows.filter(r => r.needs === 'field_reentry_or_crosscrm' || r.needs === 'human_pick').length;
  console.log(`복원 자동후보(#2 검증) ${autoResolvable}명 / 현장·cross-CRM 필요(#4) ${fieldNeeded}명`);

  const out = {
    ticket: 'T-20260713-foot-NAME-ALIAS-BACKFILL',
    kind: 'freeze_dryrun', mutation: 'NONE (READ-ONLY)',
    window_start_kst: WINDOW_START,
    predicate: "reservations.source_system='dopamine' JOIN customer_id AND customers.updated_at >= 7/8 (lead_source 미사용)",
    dopamine_resv_total: dopaResv.length,
    dopamine_linked_customers: dopaCustIds.length,
    frozen_count: rows.length,
    anchor_included: !!anchor,
    anchor_id8: anchor?.id8 ?? null,
    crosscrm_source1_status: 'UNRESOLVED — foot 서비스키로 타 CRM 접근 불가. planner 게이트 필요.',
    rows,
  };
  writeFileSync('db-gate/T-20260713-foot-NAME-ALIAS-BACKFILL_freeze_dryrun.json', JSON.stringify(out, null, 2));
  console.log('\n스냅샷 저장: db-gate/T-20260713-foot-NAME-ALIAS-BACKFILL_freeze_dryrun.json (PHI 마스킹)');
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
