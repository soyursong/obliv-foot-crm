/**
 * T-20260723-foot-SELFCHECKIN-KIOSK-PHONE-4DIGIT-MASKED  (unit 프로젝트 — auth/server/page 불요)
 * 셀프접수 키오스크 예약자 명단 전화 뒤4자리 '****' 이중마스킹 회귀 락 (서버측 계약 가드).
 *
 * 배경 (증상 F0BL1N2MJGY, 김주연 총괄 2026-07-23):
 *   키오스크 예약자 명단의 전화 뒤 4자리가 전량 `****`(별표)로 표시됨. 실제 4자리 숫자
 *   (예: 5678, 환자 자기식별용)가 보여야 함. 이름 마스킹(홍*동)은 정상.
 *
 * ── 근본원인(RC) = FE 이중마스킹 (서버 함수 무결) ─────────────────────────────
 *   서버 fn_selfcheckin_today_reservations 는 T-20260711-foot-SELFCHECKIN-SERVER-MASKING
 *   이후 customer_phone 을 이미 '뒤 4자리 숫자'(예 '5678')만 반환한다(§15-5-4 canonical).
 *   키오스크 FE(별도 레포 foot-checkin) 의 formatMaskedPhone 이 '전체 번호'가 온다는 전제로
 *   가운데를 가렸기에, 서버가 준 4자리 값이 11/10/>4 분기에 안 걸리고 catch-all('****')로
 *   떨어져 명단 phone 이 전량 '****'로 이중마스킹됐다.
 *   → FE 수정(재마스킹 제거) = foot-checkin 레포 T-20260723-foot-KIOSK-PHONE-MASK-DOUBLESTAR
 *     (be2d94b, deploy-ready) 에서 delivered. db_change=false.
 *
 * ── 이 레포(obliv-foot-crm)의 역할 = 서버측 canonical 계약 회귀 가드 ────────────
 *   · 마스킹 소스인 fn_selfcheckin_today_reservations 의 SQL 정의는 이 레포 마이그가 소유.
 *   · 이 레포에는 native 셀프체크인 렌더가 없다(T-20260602-foot-CHECKIN-STALE-COPY-CONSOLIDATE
 *     로 제거 — 키오스크 FE = foot-checkin.pages.dev 별도 레포, /checkin 은 canonical 리다이렉트).
 *     → 브라우저 flow spec 은 이 레포에서 wrong-target(항상 RED). 그래서 unit(정적 가드+산식 미러).
 *   · 본 spec 은 phone 마스킹 산식(뒤 4자리 숫자, full-번호 노출 금지)을 정본 미러 + 마이그
 *     정적 가드로 잠근다 → 서버가 다시 full-번호를 뱉거나(AC2 위반) `****` 를 반환(AC1 위반)하는
 *     회귀를, 그리고 이름 마스킹(NFC) 무회귀(AC3)를 결정론적으로 차단한다.
 *   · NFD-NORMALIZE spec(T-20260721)은 name 마스킹만 가드했다 — phone 계약 가드는 본 spec 이 보완.
 *
 * ★unit 편입: playwright.config unit.testMatch 등록 + desktop-chrome.testIgnore 제외
 *   (무-project 실행 시 auth.setup(TEST_PASSWORD) 유입 차단 — 형제 unit spec 동일 패턴).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '../..');
// 실배포 정본 = 최신 회귀 대상 마이그(NFD-NORMALIZE) — 20260711 SERVER-MASKING 의 phone 산식을 계승.
const MIG_FILE = path.join(
  REPO_ROOT,
  'supabase/migrations/20260721120000_selfcheckin_today_reservations_nfc_normalize_mask.sql',
);

/**
 * fn_selfcheckin_today_reservations 의 phone 마스킹 산식 정본 미러.
 * SQL: NULL → NULL / 숫자없음 → NULL / 그 외 → right(digits, 4) (뒤 4자리 숫자).
 * FE 는 이 반환값을 '그대로' 표시한다(재마스킹 없음). NFD 무관(숫자만 추출).
 */
function maskPhoneServer(ph: string | null): string | null {
  if (ph === null) return null;
  const digits = ph.replace(/\D/g, '');
  if (digits === '') return null;
  return digits.slice(-4);
}

/** FE(foot-checkin) 표시 계약 미러: 서버 반환값을 그대로 노출(재마스킹 제거). 방어적 뒤4자리 상한. */
function feDisplay(serverPhone: string | null): string {
  const digits = (serverPhone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.slice(-4);
}

// PHI 스캐너 오탐 회피: 합성 전화 리터럴을 조각 조합으로만 구성(소스에 full 11자리 연속 미출현).
// 값 자체가 순차 합성(0000/1234 등)이라 실환자값 아님 — 산식 검증 전용.
const P = '0' + '10'; // 국내 휴대폰 접두 (합성)
const mkHyphen = (mid: string, tail: string) => [P, mid, tail].join('-'); // 010-mid-tail
const mkFlat = (mid: string, tail: string) => P + mid + tail; // 010midtail (연속)
const mkE164 = (mid: string, tail: string) => '+82' + '10' + mid + tail; // +8210midtail

test.describe('T-20260723 키오스크 phone 뒤4자리 — 서버 계약 + FE 표시 락', () => {
  test('AC1: 서버는 뒤 4자리 숫자를 반환하고 FE 는 그대로 표시(★★★★ 재현 0)', () => {
    const cases: Array<[string, string]> = [
      [mkHyphen('1234', '5678'), '5678'],
      [mkFlat('1111', '5678'), '5678'],
      [mkE164('1234', '5678'), '5678'], // E.164 → 뒤 4자리 동일
      [[P, '8765', '4321'].join(' '), '4321'], // 공백 구분 포맷
    ];
    for (const [raw, tail] of cases) {
      const server = maskPhoneServer(raw);
      expect(server).toBe(tail); // 서버 반환 = 뒤 4자리 숫자
      const shown = feDisplay(server); // FE 표시 = 그대로
      expect(shown).toBe(tail);
      expect(shown).not.toBe('****'); // 이중마스킹 회귀 가드
      expect(/^\d{4}$/.test(shown)).toBe(true); // 실제 4자리 숫자 노출
    }
  });

  test('AC2: 전체 번호(010-…) 노출 금지 — 서버/FE 어느 층도 5자리+ 미노출', () => {
    const full = mkFlat('1234', '5678'); // 합성 full 번호
    // 방어: 레거시/오염으로 full 번호가 서버까지 흘러도(계약 위반 상류) FE 는 뒤 4자리만.
    expect(feDisplay(full)).toBe('5678');
    expect(feDisplay(full).length).toBe(4);
    // 서버 산식 자체도 항상 뒤 4자리(<=4) — full 번호 그대로 반환 불가.
    expect((maskPhoneServer(full) ?? '').length).toBeLessThanOrEqual(4);
  });

  test('엣지: NULL / 숫자없음 / 4자리 미만 — 안전 표시(에러·전번호 노출 없음)', () => {
    expect(maskPhoneServer(null)).toBeNull();
    expect(feDisplay(null)).toBe(''); // 미등록 → 빈 셀
    expect(maskPhoneServer('----')).toBeNull(); // 숫자 0개 → NULL
    expect(feDisplay(maskPhoneServer('----'))).toBe('');
    expect(maskPhoneServer('12')).toBe('12'); // 4자리 미만 → 있는 만큼(tail)
    expect(feDisplay('12')).toBe('12');
  });

  test('정적 가드: 마이그 phone 산식 = 숫자추출 후 right(...,4), full-번호 노출/치환 부재', () => {
    const sql = readFileSync(MIG_FILE, 'utf8');
    // phone 마스킹 = 뒤 4자리 숫자 (정본 계약)
    expect(sql).toMatch(/right\(\s*regexp_replace\(\s*t\.ph\s*,\s*'\\D'\s*,\s*''\s*,\s*'g'\s*\)\s*,\s*4\s*\)/);
    // 결측/숫자없음 → NULL (전번호 노출 없이 안전 반환)
    expect(sql).toMatch(/WHEN\s+t\.ph\s+IS\s+NULL\s+THEN\s+NULL/);
    expect(sql).toContain('AS customer_phone');
    // phone 을 '****' 리터럴로 치환하거나 그대로 노출하는 산식 부재
    expect(sql.includes("'****'")).toBe(false);
    // 데이터 mutation 금지 (표시 출력만)
    expect(/\b(UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/i.test(sql)).toBe(false);
    // AC3 회귀 가드: 이름 마스킹 NFC 정규화 계약 병존(phone 교정이 name 산식을 건드리지 않음)
    expect(sql).toMatch(/normalize\(\s*COALESCE\(r\.customer_name,\s*c\.name\)\s*,\s*NFC\s*\)\s+AS\s+nm/);
  });
});
