/**
 * T-20260808-foot-CHARTEDIT-SESSIONTYPE-PRICE-RELINK — backfill scope count (READ-ONLY)
 *
 * planner FOLLOWUP(MSG-20260808-220834-zwhn) 요청:
 *   과거 saveEditSession() 경로에서 session_type 이 변경됐으나 package_sessions.unit_price 가
 *   옛 유형 단가로 잔존(=현 session_type 의 package.{type}_unit_price 와 불일치)한 오염 후보 행 count.
 *   (a) 전체 count  (b) 활성 패키지 한정 count  (c) 대략 금액 규모 Σ|기존 unit_price − 올바른 unit_price|
 *
 * ★READ-ONLY: SELECT only. blanket UPDATE 착수 아님(SOP 게이트 전). 조회·집계만.
 * 판정 매핑 = sessionTypeUnitPrice() (CustomerChartPage.tsx L691) 와 1:1 동일.
 *
 * 실행: node db-gate/T-...RELINK_backfill_scope_count.mjs   (인자 없음, 읽기 전용)
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// ── creds (prod project rxlomoozakkjesdqjtvd, service_role) from .env.local ──
function envVal(key) {
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(new RegExp('^' + key + '=(.*)$'));
      if (m) return m[1].trim();
    }
  }
  return process.env[key];
}
const URL = envVal('VITE_SUPABASE_URL');
const KEY = envVal('SUPABASE_SERVICE_ROLE_KEY');
if (!URL || !KEY) { console.error('❌ VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요'); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// ── sessionTypeUnitPrice 매핑 (write-side 판정과 1:1) ──
const PRICE_COL = {
  heated_laser: 'heated_unit_price',
  unheated_laser: 'unheated_unit_price',
  iv: 'iv_unit_price',
  podologue: 'podologe_unit_price',
  podologe: 'podologe_unit_price',
  trial: 'trial_unit_price',
  reborn: 'reborn_unit_price',
};
const PRICE_COLS = ['heated_unit_price','unheated_unit_price','iv_unit_price','podologe_unit_price','trial_unit_price','reborn_unit_price'];
function correctPrice(pkg, type) {
  const col = PRICE_COL[type];
  if (!col) return null;          // 무상 유형(preconditioning 등) → 판정 대상 아님
  return pkg[col] ?? 0;
}

async function fetchAll(table, cols) {
  const out = [];
  let from = 0; const size = 1000;
  for (;;) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + size - 1);
    if (error) { console.error(`❌ ${table} fetch:`, error.message); process.exit(1); }
    out.push(...data);
    if (data.length < size) break;
    from += size;
  }
  return out;
}

const nf = (n) => n.toLocaleString('ko-KR');

(async () => {
  const packages = await fetchAll('packages', 'id, status, ' + PRICE_COLS.join(', '));
  const sessions = await fetchAll('package_sessions', 'id, package_id, session_type, unit_price, status, session_date');
  const pkgById = new Map(packages.map((p) => [p.id, p]));

  // set of unit-price values present in a package (for fingerprint: stored == some OTHER type's price)
  function pkgPriceSet(pkg) {
    return new Set(PRICE_COLS.map((c) => pkg[c] ?? 0).filter((v) => v > 0));
  }

  const rows = { total: 0, byStatus: {}, activePkg: 0, usedSessOnly: 0, activePkgUsedSess: 0 };
  const money = { total: 0, activePkg: 0, activePkgUsedSess: 0 };
  const fp = { matchOtherType: 0, activePkgUsedSess: 0 };  // strong bug fingerprint
  const noPkg = { count: 0 };
  const typeBreak = {};
  // disposition partition: zero-snapshot(stored=0, correct>0) vs nonzero-diff(stored>0, !=correct)
  const part = { zeroSnap: 0, nonzeroDiff: 0, zeroSnapActiveUsed: 0, nonzeroDiffActiveUsed: 0 };

  for (const s of sessions) {
    const pkg = pkgById.get(s.package_id);
    if (!pkg) { noPkg.count++; continue; }
    const correct = correctPrice(pkg, s.session_type);
    if (correct === null) continue;                 // 무상/비가격 유형 제외
    const stored = s.unit_price ?? 0;
    if (stored === correct) continue;               // 정상 (일치)
    // ── 오염 후보 (mismatch) ──
    const delta = Math.abs(stored - correct);
    rows.total++;
    rows.byStatus[s.status] = (rows.byStatus[s.status] || 0) + 1;
    money.total += delta;
    typeBreak[s.session_type] = (typeBreak[s.session_type] || 0) + 1;

    const pkgActive = pkg.status === 'active';
    const sessUsed = s.status === 'used';
    if (pkgActive) { rows.activePkg++; money.activePkg += delta; }
    if (sessUsed) rows.usedSessOnly++;
    if (pkgActive && sessUsed) { rows.activePkgUsedSess++; money.activePkgUsedSess += delta; }

    // disposition partition
    if (stored === 0 && correct > 0) {
      part.zeroSnap++;
      if (pkgActive && sessUsed) part.zeroSnapActiveUsed++;
    } else {
      part.nonzeroDiff++;
      if (pkgActive && sessUsed) part.nonzeroDiffActiveUsed++;
    }

    // fingerprint: stored 가 같은 패키지의 다른 유형 단가와 정확히 일치 = "옛 유형 단가 잔존" 강한 지문
    if (stored > 0 && pkgPriceSet(pkg).has(stored)) {
      fp.matchOtherType++;
      if (pkgActive && sessUsed) fp.activePkgUsedSess++;
    }
  }

  const report = `
═══════════════════════════════════════════════════════════════════════
 T-20260808-foot-CHARTEDIT-SESSIONTYPE-PRICE-RELINK — backfill scope count
 (READ-ONLY · SELECT only · blanket UPDATE 미착수)
 DB: ${URL}  | packages=${nf(packages.length)}  package_sessions=${nf(sessions.length)}
═══════════════════════════════════════════════════════════════════════

■ 정의: 오염 후보 = package_sessions.unit_price(스냅샷) ≠ sessionTypeUnitPrice(현 session_type)
        (write-side 판정 매핑과 1:1 동일. 무상/비가격 유형[preconditioning 등] 제외)
  ⚠ mismatch ⊇ 실오염 — 정당한 수기조정(AC3 무접촉) 스냅샷도 mismatch 로 포착됨(=후보, 확정 아님).
     per-row 판정·freeze셋은 DA Data-Correction Backfill SOP 게이트에서.

(a) 전체 오염 후보 count            : ${nf(rows.total)} 행
    ├ session status 별            : ${JSON.stringify(rows.byStatus)}
    └ session_type 별              : ${JSON.stringify(typeBreak)}

(b) 매출집계 유입 한정 count
    ├ 활성 패키지(status=active)     : ${nf(rows.activePkg)} 행
    ├ 시술확정 session(status=used)  : ${nf(rows.usedSessOnly)} 행
    └ 활성패키지 ∩ used(=매출 실유입) : ${nf(rows.activePkgUsedSess)} 행   ★가장 좁은 매출영향 셋

(c) 대략 금액 규모 Σ|기존 − 올바른|
    ├ 전체                         : ${nf(money.total)} 원
    ├ 활성 패키지 한정              : ${nf(money.activePkg)} 원
    └ 활성패키지 ∩ used            : ${nf(money.activePkgUsedSess)} 원

■ disposition 분해(오염 성격 구분 — DA per-row 판정 입력)
    ├ zero-snapshot (stored=0, correct>0) : ${nf(part.zeroSnap)} 행 (활성∩used ${nf(part.zeroSnapActiveUsed)})
    │   → session 단가 0 스냅샷 vs 패키지 유형단가>0. "옛 유형단가 잔존" 아님(0 기록).
    │      무상/체험(AC2 단건매출 별경로)·생성시점0 가능성 → 실오염 여부 per-row 판정 필요.
    └ nonzero-diff (stored>0, ≠correct)   : ${nf(part.nonzeroDiff)} 행 (활성∩used ${nf(part.nonzeroDiffActiveUsed)})
        → 수기조정(AC3 무접촉) 또는 옛 유형단가 잔존 혼재.

■ 강한 지문(stored == 같은 패키지의 다른 유형 단가 = "옛 유형 단가 잔존")
    ├ 전체                         : ${nf(fp.matchOtherType)} 행
    └ 활성패키지 ∩ used            : ${nf(fp.activePkgUsedSess)} 행
    → 티켓이 기술한 saveEditSession session_type-swap 오염의 최협의 근사.
      (수기조정 노이즈 배제 · SOP 지문교집합 1차 후보)

■ 참고: package 조인 실패(orphan session): ${nf(noPkg.count)} 행 (판정 제외)
═══════════════════════════════════════════════════════════════════════
`;
  console.log(report);
  fs.writeFileSync('db-gate/T-20260808-foot-CHARTEDIT-SESSIONTYPE-PRICE-RELINK_backfill_scope_count_result.txt', report);
})();
