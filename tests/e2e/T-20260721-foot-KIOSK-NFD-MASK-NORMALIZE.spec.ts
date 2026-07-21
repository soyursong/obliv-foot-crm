/**
 * T-20260721-foot-KIOSK-NFD-MASK-NORMALIZE  (unit 프로젝트 — auth/server/page 불요)
 * 셀프접수 키오스크 예약자 명단 이름 마스킹 NFD 깨짐 교정 회귀 락.
 *
 * 배경 (RCA T-20260721-foot-KIOSK-CRM-1030-ORPHAN-RCA):
 *   customers.name 이 유니코드 NFD(자모분해)로 저장 → 서버측 마스킹 함수
 *   fn_selfcheckin_today_reservations 가 codepoint 단위(left/right/char_length)로 잘라
 *   실환자 '강승은'이 `ᄀ*******ᆫ`(자모 쪼개짐)으로 표시됨.
 *   교정: 함수 내 마스킹 입력을 normalize(nm, NFC) 로 래핑 → 완성형 글자 기준 마스킹(`강*은`).
 *
 * ── 왜 브라우저 E2E 가 아니라 unit 인가 ─────────────────────────────────────────
 *   · 마스킹은 100% 서버측(Postgres SQL RPC). 이 레포에는 native 셀프체크인 렌더가 없다
 *     (T-20260602-foot-CHECKIN-STALE-COPY-CONSOLIDATE 로 제거 — 키오스크 FE 는 별도
 *      레포 foot-checkin.pages.dev). obliv-foot-crm 의 /checkin 라우트는 canonical 리다이렉트 전용
 *      → btn-reserved 등 native flow 를 구동하는 브라우저 spec 은 이 레포에서 wrong-target(항상 RED).
 *   · 실 배포 함수의 NFD→NFC 교정 증거 = SQL dry-run(무영속):
 *       scripts/T-20260721-foot-KIOSK-NFD-MASK-NORMALIZE_dryrun.mjs
 *       (NFD '강승은' raw_len=9 → masked_before `ᄀ*******ᆫ` / masked_after `강*은`, 정상 이름 회귀 0)
 *   · 본 spec = 그 마스킹 산식의 정본 미러(JS `normalize('NFC')`) + 마이그 파일 정적 가드로
 *     "NFC 정규화 후 codepoint 마스킹 = 완성형 글자 기준" 계약을 결정론적으로 잠근다.
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
const MIG_FILE = path.join(
  REPO_ROOT,
  'supabase/migrations/20260721120000_selfcheckin_today_reservations_nfc_normalize_mask.sql',
);

/**
 * fn_selfcheckin_today_reservations 의 name 마스킹 산식 정본 미러.
 * SQL: 성+끝자 (홍길동→홍*동 / 홍길→홍* / 1자→그대로 / 결측→그대로), codepoint(char_length/left/right) 기준.
 * @param nm 이미 정규화(또는 미정규화) 된 입력 — codepoint 배열로 자른다(SQL char_length/left/right 동형).
 */
function maskName(nm: string | null): string | null {
  if (nm === null) return null;
  const t = nm.trim();
  if (t === '') return nm;
  const cp = Array.from(t); // codepoint 단위 (SQL char_length/left/right 와 동형)
  if (cp.length === 1) return t;
  if (cp.length === 2) return cp[0] + '*';
  return cp[0] + '*'.repeat(cp.length - 2) + cp[cp.length - 1];
}

// 교정 후 함수: 마스킹 입력을 NFC 정규화한 뒤 마스킹 (up 마이그 델타의 JS 미러)
const maskNameFixed = (nm: string | null) => maskName(nm === null ? null : nm.normalize('NFC'));

const GARBLED = 'ᄀ*******ᆫ';

test.describe('T-20260721 NFD 마스킹 교정 — 산식 계약', () => {
  test('AC-2: NFD 저장값 강승은 → 교정 전 깨짐, NFC 정규화 후 `강*은`', () => {
    const nfd = '강승은'.normalize('NFD'); // 저장 오염 재현 (conjoining jamo)
    expect(Array.from(nfd).length).toBe(9); // codepoint 팽창 (자모분해)

    // 교정 전(raw 에 직접 마스킹) → 자모 사이로 쪼개져 깨짐
    expect(maskName(nfd)).toBe(GARBLED);

    // 교정 후(normalize NFC 래핑) → 완성형 3글자 기준 마스킹
    expect(maskNameFixed(nfd)).toBe('강*은');
    // 깨진 자모형 + conjoining jamo(U+1100~U+11FF) 미출현
    expect(maskNameFixed(nfd)).not.toBe(GARBLED);
    expect(/[ᄀ-ᇿ]/.test(maskNameFixed(nfd)!)).toBe(false);
  });

  test('회귀: 이미 NFC 인 정상 이름 마스킹 무변경', () => {
    const cases: Array<[string, string]> = [
      ['강승은', '강*은'],
      ['홍길동', '홍*동'],
      ['남궁민수', '남**수'],
      ['이영', '이*'],
    ];
    for (const [name, masked] of cases) {
      const nfc = name.normalize('NFC');
      // NFC 입력은 교정 전/후 동일 (normalize 는 이미 NFC 인 문자열에 무영향) → 회귀 0
      expect(maskName(nfc)).toBe(masked);
      expect(maskNameFixed(nfc)).toBe(masked);
    }
  });

  test('엣지: 1자/결측/공백 — 교정 전후 동형(과대 노출 방지 유지)', () => {
    expect(maskNameFixed('박')).toBe('박'); // 1자 그대로
    expect(maskNameFixed('')).toBe(''); // 빈값 그대로
    expect(maskNameFixed(null)).toBeNull(); // NULL 그대로
    // NFD 1자도 NFC 후 1자로 수렴 → 그대로
    expect(maskNameFixed('박'.normalize('NFD'))).toBe('박');
  });

  test('정적 가드: 마이그가 nm 파생을 normalize(...,NFC) 로 래핑 + 시그니처/SECDEF 불변', () => {
    const sql = readFileSync(MIG_FILE, 'utf8');
    // 유일 델타: nm 파생 NFC 래핑
    expect(sql).toMatch(/normalize\(\s*COALESCE\(r\.customer_name,\s*c\.name\)\s*,\s*NFC\s*\)\s+AS\s+nm/);
    // ADDITIVE 불변식: 시그니처/반환형/권한/SECDEF/owner/search_path 핀 유지
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_selfcheckin_today_reservations');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path = ''");
    expect(sql).toContain('OWNER TO postgres');
    expect(sql).toContain('GRANT  EXECUTE ON FUNCTION public.fn_selfcheckin_today_reservations(UUID, DATE)');
    expect(sql).toContain('TO anon, authenticated');
    // 데이터 mutation 금지: UPDATE/DELETE/INSERT 문 부재
    expect(/\b(UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/i.test(sql)).toBe(false);
  });
});
