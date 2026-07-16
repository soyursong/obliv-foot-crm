/**
 * T-20260715-foot-MASKPII-CONTAM-BACKFILL — FREEZE 2차 패스 (READ-ONLY)
 *
 * canonical(07-15) fresh-freeze superset. trigger-seal 기준 현 재고 오염 정본 대상셋 산출.
 * CEO 자율진행 지시(MSG-20260716-120729-dne2): freeze 재산출 2차 패스 = 07-14/15 신규
 *   masked(b1b5f6f7·e3216e83) 포섭 + carve-out 불변. 현장 confirm waive→사후검증. DA/supervisor 게이트 유지.
 *
 * ★★★ READ-ONLY. UPDATE/DELETE/INSERT 절대 없음. 실 정정은 DA 재자문 GO + supervisor DB-GATE 후에만. ★★★
 *
 * 지문 (SSOT = _fn_is_masked_pii / WS-A 가드 코드와 동일):
 *   · name  masked (name_star)  = name 에 '*' 포함
 *   · phone masked (phone_short) = phone 에 '*' 포함 OR phone 유효자릿수 1~7 (tail-only)
 *   · anon-RPC 산 앵커 = created_by IS NULL
 *
 * 단일 count(9) blind UPDATE 금지 → 지문 교집합으로 대상 식별 + PK freeze + 판정근거 스냅샷.
 *
 * carve-out (fold 금지, 별트랙 존치):
 *   · row1 (0356b229): DA NOT-ELIGIBLE(phantom name 비마스킹). name_star-7 에 부재를 실측 assert (단정 금지).
 *   · 02594dfa: §2-F per-row HOLD. phone_short-2 포함 시 carry-forward 하여 제외.
 *
 * supersede 대사 b: fresh freeze-set ⊇ (07-13 rescope-5 미적용행 + 07-14/15 신규 masked) − carve-out.
 *
 * PHI 위생(§4): 실명/전체번호 콘솔·git-tracked 출력 금지. 이름=마스킹형/길이, phone=tail4 만.
 *   상세 per-row 판정근거 = off-git(~/foot-phi-offgit/). git-tracked = count·PK prefix·assert 결과만.
 * author: dev-foot / 2026-07-16
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_CRM_FOOT_URL || 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_CRM_FOOT_SERVICE
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || (() => { throw new Error('SUPABASE_CRM_FOOT_SERVICE env required'); })();
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ── known IDs (8-char prefix) ──
const ROW1_CARVEOUT = '0356b229';                 // DA NOT-ELIGIBLE (name 비마스킹) — name_star 부재 실측
const HOLD_2F       = '02594dfa';                 // §2-F per-row HOLD — phone_short 제외 carry-forward
const NEW_MASKED    = ['b1b5f6f7', 'e3216e83'];   // 07-14/15 신규 masked (CEO 명시 포섭 대상)
const RESCOPE5      = ['512998d0', '67ea1793', 'bd307dfe', '44a6a076', '2dc21d1c']; // 07-13 mutation0 → 미적용 잔존 기대

// ── PHI 위생 헬퍼 ──
const digitsLen  = (p) => (p == null ? 0 : ('' + p).replace(/[^0-9]/g, '').length);
const phoneTail  = (p) => (p == null ? null : ('' + p).replace(/[^0-9]/g, '').slice(-4));
const redactName = (n) => (n == null ? null : `<${n.includes('*') ? 'NAME_STAR' : 'len' + n.length}>`);
const isNameMasked  = (n) => n != null && n.includes('*');
const isPhoneMasked = (p) => {
  if (p == null) return false;
  if (('' + p).includes('*')) return true;
  const L = digitsLen(p);
  return L >= 1 && L <= 7;
};

async function main() {
  console.log('=== T-20260715-foot-MASKPII-CONTAM-BACKFILL — FREEZE 2차 패스 (READ-ONLY) ===\n');

  // ── customers 전량 스캔 ──
  const { data: custs, error: ce } = await supabase
    .from('customers')
    .select('id, clinic_id, name, phone, visit_type, created_by, created_at, updated_at')
    .order('created_at', { ascending: true });
  if (ce) throw new Error('customers scan 실패: ' + ce.message);
  console.log(`customers 전량: ${custs.length}행`);

  // ── 지문 교집합: masked fingerprint hit ──
  const maskedAll = custs.filter(c => isNameMasked(c.name) || isPhoneMasked(c.phone));
  const nullCreatedBy = maskedAll.filter(c => c.created_by == null);
  console.log(`마스킹 지문 hit(전 created_by): ${maskedAll.length}행`);
  console.log(`  └ created_by IS NULL (anon-RPC 앵커): ${nullCreatedBy.length}행`);
  const nonNullMasked = maskedAll.filter(c => c.created_by != null);
  if (nonNullMasked.length) {
    console.log(`  ⚠ created_by 有 masked ${nonNullMasked.length}행 — anon 앵커 밖 (delta 경위 검토 대상):`);
    nonNullMasked.forEach(c => console.log(`     ${c.id.slice(0,8)} name=${redactName(c.name)} tail=${phoneTail(c.phone)} created_by=${c.created_by?.slice(0,8)}`));
  }

  // ── 분류: name_star vs phone_short(only) ──
  const nameStar   = nullCreatedBy.filter(c => isNameMasked(c.name));
  const phoneShort = nullCreatedBy.filter(c => !isNameMasked(c.name) && isPhoneMasked(c.phone));

  console.log(`\n[분류] name_star=${nameStar.length}행 / phone_short(only)=${phoneShort.length}행`);

  // ── 행별 지문 상세 + 분류 신호 (phantom vs real-polluted prep) ──
  const detail = [];
  for (const c of [...nameStar, ...phoneShort]) {
    const tail = phoneTail(c.phone);
    // raw recovery 후보: 동일 clinic + tail4 일치 + non-masked (un-mask/relink source 후보)
    let rawCands = [];
    if (tail && tail.length === 4) {
      rawCands = custs.filter(o => o.id !== c.id && o.clinic_id === c.clinic_id
        && !isNameMasked(o.name) && !isPhoneMasked(o.phone) && phoneTail(o.phone) === tail);
    }
    const { count: ciCount } = await supabase.from('check_ins')
      .select('id', { count: 'exact', head: true }).eq('customer_id', c.id);
    const { count: rvCount } = await supabase.from('reservations')
      .select('id', { count: 'exact', head: true }).eq('customer_id', c.id);
    // 분류 신호: phantom(orphan/부모소실) vs real-polluted(실환자 마스킹)
    //  - resv 참조 無 + raw 1:1 有 = self_checkin phantom 후보(archive-first relink)
    //  - raw 0 = un-mask 소스 소실 → sentinel/소스복구 후보
    const cls = rawCands.length === 1 ? 'has_raw_1to1'
              : rawCands.length === 0 ? 'no_raw(unmask_source_lost)'
              : `raw_ambiguous(${rawCands.length})`;
    detail.push({
      id8: c.id.slice(0, 8), id_full: c.id, clinic8: c.clinic_id?.slice(0, 8),
      axis: isNameMasked(c.name) ? 'name_star' : 'phone_short',
      name: redactName(c.name), name_len: c.name?.length ?? null,
      phone_tail4: tail, phone_digits: digitsLen(c.phone), phone_masked: isPhoneMasked(c.phone),
      created_by: c.created_by, created_at: c.created_at, updated_at: c.updated_at,
      raw_recovery_candidates: rawCands.map(r => ({ id8: r.id.slice(0,8), id_full: r.id, name: redactName(r.name), tail4: phoneTail(r.phone) })),
      raw_class: cls,
      ref_check_ins: ciCount ?? 0, ref_reservations: rvCount ?? 0,
    });
  }

  // ── carve-out 실측 assert ──
  const inSet = (p) => detail.some(d => d.id8 === p);
  const row1_present   = inSet(ROW1_CARVEOUT);
  const row1_in_namestar = nameStar.some(c => c.id.slice(0,8) === ROW1_CARVEOUT);
  const hold2f_present = inSet(HOLD_2F);

  console.log('\n=== CARVE-OUT 실측 assert ===');
  console.log(`  row1(${ROW1_CARVEOUT}) name_star 멤버십: ${row1_in_namestar ? '⚠ 존재(예상=부재)' : '✅ 부재(실측 확인) — 마스킹 백필 부적격, 별트랙(ROW1-MASTER-DEFECT)'}`);
  console.log(`  row1(${ROW1_CARVEOUT}) 전체 freeze-set 멤버십: ${row1_present ? '⚠ 존재' : '✅ 부재'}`);
  console.log(`  02594dfa(§2-F) phone_short 멤버십: ${hold2f_present ? '검출 → carry-forward 제외 마킹' : '미검출'}`);

  // ── 신규 masked 포섭 assert (CEO 명시) ──
  console.log('\n=== 신규 masked 포섭 assert (CEO MSG-dne2) ===');
  const newMaskedStatus = NEW_MASKED.map(p => ({ id8: p, present: inSet(p) }));
  newMaskedStatus.forEach(s => console.log(`  ${s.id8}: ${s.present ? '✅ freeze-set 포섭' : '⚠ 미포섭 — delta 경위 규명 필요'}`));

  // ── supersede 대사 b: 07-13 rescope-5 잔존(mutation0 확증) ──
  console.log('\n=== supersede 대사 b: 07-13 rescope-5 미적용 잔존 확인 ===');
  const rescope5Status = RESCOPE5.map(p => ({ id8: p, present_in_freeze: inSet(p) }));
  rescope5Status.forEach(s => console.log(`  ${s.id8}: ${s.present_in_freeze ? '✅ 잔존(07-13 mutation0 확증)' : '⚠ 부재 — 정정/변동 delta 경위 검토'}`));

  // ── 정정 대상셋 (carve-out 제외 후) ──
  const mutationTargets = detail.filter(d => d.id8 !== ROW1_CARVEOUT && d.id8 !== HOLD_2F);
  const carvedOut = detail.filter(d => d.id8 === ROW1_CARVEOUT || d.id8 === HOLD_2F);

  console.log('\n=== FREEZE 요약 ===');
  const gitSafe = {
    ticket: 'T-20260715-foot-MASKPII-CONTAM-BACKFILL',
    run_stage: 'freeze-2nd',
    read_only: true, mutation_count: 0,
    scanned_customers: custs.length,
    fingerprint: { name_star: '* in name', phone_short: '* in phone OR effective digits 1-7', anchor: 'created_by IS NULL' },
    masked_hit_total: maskedAll.length,
    masked_created_by_null: nullCreatedBy.length,
    masked_created_by_nonnull: nonNullMasked.length,
    split: { name_star: nameStar.length, phone_short_only: phoneShort.length },
    freeze_pk8: detail.map(d => d.id8),
    carve_out: {
      row1_0356b229: { in_name_star: row1_in_namestar, in_freeze_set: row1_present, verdict: 'exclude(별트랙 ROW1-MASTER-DEFECT)' },
      hold_02594dfa: { in_freeze_set: hold2f_present, verdict: 'exclude(§2-F carry-forward)' },
    },
    new_masked_inclusion: newMaskedStatus,
    rescope5_residual: rescope5Status,
    mutation_target_pk8: mutationTargets.map(d => d.id8),
    mutation_target_count: mutationTargets.length,
    classification_prep: mutationTargets.map(d => ({ id8: d.id8, axis: d.axis, raw_class: d.raw_class,
      raw_cand_count: d.raw_recovery_candidates.length, ref_check_ins: d.ref_check_ins, ref_reservations: d.ref_reservations })),
  };
  console.log(JSON.stringify(gitSafe, null, 2));

  // ── 산출물 저장 ──
  // git-tracked evidence (PHI-free)
  const gitEvidencePath = process.env.GIT_EVIDENCE_PATH;
  if (gitEvidencePath) { writeFileSync(gitEvidencePath, JSON.stringify(gitSafe, null, 2)); console.log(`\n[git-evidence] ${gitEvidencePath}`); }

  // off-git 판정근거 스냅샷 (PHI 라우팅 §4) — 상세 per-row (name 마스킹형/tail4 까지만)
  const offgitDir = join(homedir(), 'foot-phi-offgit');
  mkdirSync(offgitDir, { recursive: true });
  const offgitPath = join(offgitDir, 'T-20260715-foot-MASKPII-CONTAM-BACKFILL_freeze2_confirm.json');
  writeFileSync(offgitPath, JSON.stringify({ ...gitSafe, per_row_detail: detail, carved_out: carvedOut }, null, 2));
  console.log(`[off-git 판정근거 스냅샷] ${offgitPath}`);

  console.log('\n⚠ READ-ONLY freeze. 실 mutation/deploy-ready 는 DA 재자문 GO + supervisor DB-GATE 후에만.');
}

main().catch(e => { console.error('\n[FATAL]', e.message); process.exit(1); });
