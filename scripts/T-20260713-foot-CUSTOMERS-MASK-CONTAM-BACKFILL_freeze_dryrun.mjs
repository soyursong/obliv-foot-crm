/**
 * T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL — 마스킹오염 대상셋 FREEZE 지문 재확정 (READ-ONLY)
 *
 * 배경: UNAUTH-CHANGE(마스킹 payload → customers 마스터 write) 사고의 잔류 오염행.
 *   13:05 배포된 WS-A write-path 가드(516eb548/757165d6/798a2281)는 forward-only —
 *   앞으로의 마스킹 저장은 차단하나 이미 오염된 기존 행은 정정 못함. 본 스캔 = 잔류물 freeze.
 *
 * 지문 (WS-A 가드 코드 20260713120000_selfcheckin_writepath_harden_masked_reject.sql 와 동일 SSOT):
 *   · name  masked  = name 에 '*' 포함 (예: 최***트)
 *   · phone masked  = phone 에 '*' 포함 OR phone 유효자릿수 1~7 (tail-only, 예: 5453)
 *   (실 국내번호 canonical 11~12자리는 non-masked. DUMMY-*(자릿수 0)도 non-masked.)
 *
 * SOP 정합 (data_correction_backfill_sop.md):
 *   §0 분류 — customers.name/phone 은 스태프 수동편집 가능하나, 본 오염은 '마스킹 표시값이
 *      마스터에 write' 된 것 → 정당한 per-row divergence 아님(사람이 '최***트'로 이름을 지을 수 없음).
 *      → §2 지문 교집합으로 버그경로 오염분만 특정.
 *   §2 지문 4교집합: (Q1 마스킹지문) ∩ (버그윈도우 147b3417@2026-07-11 ~ WS-A가드@2026-07-13 13:05)
 *      ∩ (버그경로 앵커: 원본 raw customer 존재) ∩ (post-creation override 없음).
 *   §2-F 폴백: 원본 raw 매칭 불가행은 blanket 금지 → per-row 사람검토.
 *
 * ★★★ READ-ONLY. UPDATE/DELETE/INSERT 절대 없음. ★★★
 * ★★★ 실 정정(착수)은 data-architect CONSULT-REPLY GO 후에만. 본 스크립트는 freeze 증거 생성 전용. ★★★
 *
 * PHI 위생(§4): 실명/전체번호 콘솔·git-tracked 출력 금지. 이름=마스킹형/길이, phone=tail 4자리만.
 * author: dev-foot / 2026-07-13
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })();
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 버그 윈도우 (KST). 147b3417 서버측 마스킹 배포(2026-07-11) ~ WS-A write-path 가드 live(2026-07-13 13:05).
const WINDOW_START = '2026-07-11T00:00:00+09:00';
const WINDOW_END   = '2026-07-13T13:05:00+09:00';

// PHI 위생: 이름은 마스킹형/길이만, 전화는 뒤 4자리만 노출.
const redactName = (n) => (n == null ? null : `<${n.includes('*') ? 'MASKED*' : 'len' + n.length}>`);
const phoneTail  = (p) => (p == null ? null : ('' + p).replace(/[^0-9]/g, '').slice(-4));
const digitsLen  = (p) => (p == null ? 0 : ('' + p).replace(/[^0-9]/g, '').length);
const isPhoneMasked = (p) => {
  if (p == null) return false;
  if (('' + p).includes('*')) return true;
  const L = digitsLen(p);
  return L >= 1 && L <= 7;
};
const isNameMasked = (n) => n != null && n.includes('*');

async function main() {
  console.log('=== T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL — FREEZE 지문 재확정 (READ-ONLY) ===');
  console.log(`버그윈도우(KST): ${WINDOW_START} ~ ${WINDOW_END}\n`);

  // ── (A) customers 마스킹오염행 ──
  const { data: custs, error: ce } = await supabase
    .from('customers')
    .select('id, clinic_id, name, phone, visit_type, created_at, updated_at')
    .order('created_at', { ascending: true });
  if (ce) throw new Error('customers scan 실패: ' + ce.message);

  const custMasked = (custs || []).filter(c => isNameMasked(c.name) || isPhoneMasked(c.phone));
  const inWindow = (ts) => ts && ts >= WINDOW_START && ts <= WINDOW_END;

  console.log(`[A] customers 마스킹지문 hit: ${custMasked.length}건 (전 기간)`);
  const custRows = [];
  for (const c of custMasked) {
    // 버그경로 앵커: 이 마스킹행의 원본 raw customer 후보 = 동일 clinic + phone tail 일치 + non-masked
    const tail = phoneTail(c.phone);
    let rawCandidates = [];
    if (tail && tail.length === 4) {
      rawCandidates = (custs || []).filter(o =>
        o.id !== c.id && o.clinic_id === c.clinic_id &&
        !isNameMasked(o.name) && !isPhoneMasked(o.phone) &&
        phoneTail(o.phone) === tail);
    }
    // 이 마스킹 customer 를 참조하는 check_ins / reservations (재링크 대상 파악용)
    const { count: ciCount } = await supabase.from('check_ins')
      .select('id', { count: 'exact', head: true }).eq('customer_id', c.id);
    const { count: rvCount } = await supabase.from('reservations')
      .select('id', { count: 'exact', head: true }).eq('customer_id', c.id);
    custRows.push({
      id: c.id.slice(0, 8), clinic: c.clinic_id?.slice(0, 8),
      name: redactName(c.name), name_masked: isNameMasked(c.name),
      phone_tail: tail, phone_digits_len: digitsLen(c.phone), phone_masked: isPhoneMasked(c.phone),
      created_at: c.created_at, updated_at: c.updated_at,
      in_bug_window: inWindow(c.created_at),
      post_create_override: c.updated_at && c.created_at && c.updated_at > c.created_at,
      raw_recovery_candidates: rawCandidates.map(r => ({ id: r.id.slice(0, 8), name: redactName(r.name), phone_tail: phoneTail(r.phone) })),
      ref_check_ins: ciCount ?? 0, ref_reservations: rvCount ?? 0,
    });
  }
  console.table(custRows);

  const custInWindow = custRows.filter(r => r.in_bug_window);
  const custResolvable = custInWindow.filter(r => r.raw_recovery_candidates.length === 1);
  const custAmbiguous  = custInWindow.filter(r => r.raw_recovery_candidates.length !== 1);
  console.log(`\n  → 버그윈도우 내: ${custInWindow.length}건`);
  console.log(`  → 원본 raw 1:1 매칭(정정 후보): ${custResolvable.length}건`);
  console.log(`  → 원본 raw 0 또는 2+ (§2-F per-row 폴백): ${custAmbiguous.length}건`);

  // ── (B) check_ins 마스킹-name 잔존 ──
  const { data: cis, error: cie } = await supabase
    .from('check_ins')
    .select('id, clinic_id, customer_id, customer_name, customer_phone, created_at')
    .order('created_at', { ascending: true });
  if (cie) throw new Error('check_ins scan 실패: ' + cie.message);

  // 마스킹-name = '*' 포함. sentinel '미확인'(가드 정상행)은 대상 아님.
  const ciMasked = (cis || []).filter(ci => isNameMasked(ci.customer_name) || isPhoneMasked(ci.customer_phone));
  console.log(`\n[B] check_ins 마스킹지문 hit: ${ciMasked.length}건 ('미확인' sentinel 제외)`);
  console.table(ciMasked.map(ci => ({
    id: ci.id.slice(0, 8), clinic: ci.clinic_id?.slice(0, 8),
    customer_id: ci.customer_id ? ci.customer_id.slice(0, 8) : null,
    name: redactName(ci.customer_name), phone_tail: phoneTail(ci.customer_phone),
    created_at: ci.created_at, in_bug_window: inWindow(ci.created_at),
  })));

  // ── FREEZE 요약 ──
  console.log('\n=== FREEZE 요약 (DA CONSULT 동봉) ===');
  const freeze = {
    window: { start: WINDOW_START, end: WINDOW_END },
    customers_masked_total: custMasked.length,
    customers_in_window: custInWindow.length,
    customers_resolvable_1to1: custResolvable.length,
    customers_ambiguous_fallback: custAmbiguous.length,
    check_ins_masked: ciMasked.length,
    frozen_customer_ids: custInWindow.map(r => r.id),
    frozen_check_in_ids: ciMasked.map(ci => ci.id.slice(0, 8)),
  };
  console.log('FREEZE_RESULT:', JSON.stringify(freeze, null, 2));
  console.log('\n⚠ 본 결과는 READ-ONLY freeze. 실 정정은 DA CONSULT-REPLY GO + 사람 confirm 후에만.');
}

main().catch(e => { console.error('\n[FATAL]', e.message); process.exit(1); });
