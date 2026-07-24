/**
 * E2E spec — T-20260724-foot-OPINIONDOC-DOCDATE-DEFAULT-GUARD
 * 소견서 발행 폼 '서류 날짜'(opinion-date-input) 오늘-고정 default → 과거 진단일 오발행(손정아 F-4673) 재발 방지.
 *
 * R5 확정 (문지은 대표원장 A+B 병행 컨펌, 김주연 총괄 relay):
 *   - A(=dp83 A): '서류 날짜' 기본값 = 해당 환자 최근 진료일(medical_charts.visit_date 최신) 자동채움.
 *       ★PREFLIGHT: authoritative 소스 미상/모호 → null → 오늘 폴백 + 확인 강조 병행(맹목 auto-set 금지).
 *   - B(=dp83 B): '서류 날짜' 칸 시각 강조(필수 확인 필드, amber) + 발행 직전 날짜 재확인 스텝.
 *   - 각인 규칙(§22 append-only·published) 무접점 — default 소스만 오늘→최근 진료일 교체. 각인 로직 무접촉.
 *   - 실장 명시 날짜(initialDate) 우선(자동채움에 안 덮임). UX 마찰 최소(원장 발행 속도 저해 X).
 *
 * 검증 방식: 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200).
 *   실브라우저 클릭 시나리오는 하단 체크리스트(갤탭 실기기 현장 confirm 대상).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const tab = () => read('src/components/doctor/OpinionDocTab.tsx');

test.describe('T-20260724-foot-OPINIONDOC-DOCDATE-DEFAULT-GUARD — 서류 날짜 default=최근 진료일 + 확인 가드', () => {

  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── R5 A: default 소스 = 최근 진료일(medical_charts.visit_date) ──────────────
  test('R5-A: 최근 진료일 조회 훅(useLatestVisitDate) = medical_charts.visit_date 최신 1건', () => {
    const t = tab();
    expect(t).toContain('function useLatestVisitDate');
    expect(t).toContain("from('medical_charts')");
    expect(t).toContain(".select('visit_date')");
    // 최신 1건 — 그 환자 실 진료 기록.
    expect(t).toContain(".order('visit_date', { ascending: false })");
    expect(t).toContain('.limit(1)');
    // customer/clinic 격리(타 환자 노출 방지).
    expect(t).toContain(".eq('customer_id', customerId)");
  });

  test('R5-A: default = initialDate(실장 명시) → 최근 진료일 → 오늘(폴백) 우선순위', () => {
    const t = tab();
    // 바인딩 시 우선순위: 실장 명시 날짜 > 최근 진료일 > 오늘.
    expect(t).toContain('setDocDate(initialDate || latestVisitDate || todaySeoulISODate())');
    // 비동기 도착 스냅 effect — open + 미변경 + initialDate 없음 조건에서만 최근 진료일로 세팅.
    expect(t).toContain('if (!open || docDateTouched) return;');
    expect(t).toContain('if (initialDate) return;');
    expect(t).toContain('if (!latestVisitDate) return;');
    expect(t).toContain('setDocDate(latestVisitDate);');
  });

  // ── PREFLIGHT: 소스 미상/모호 → 오늘 폴백(맹목 auto-set 금지) ──────────────────
  test('PREFLIGHT: visit_date 규격(YYYY-MM-DD)만 신뢰, 그 외/미상 → null(오늘 폴백)', () => {
    const t = tab();
    // 'YYYY-MM-DD' 형식만 신뢰 — 규격 밖/미상은 null 반환 → 호출부에서 오늘 폴백.
    expect(t).toContain('/^\\d{4}-\\d{2}-\\d{2}$/.test(v)');
  });

  // ── R5 B: 시각 강조(amber) + 발행 직전 확인 ──────────────────────────────────
  test('R5-B: 서류 날짜 칸 시각 강조(amber 필수 확인 필드) + 안내 힌트', () => {
    const t = tab();
    expect(t).toContain('data-testid="opinion-date-guard"');
    expect(t).toContain('data-testid="opinion-date-guard-hint"');
    // amber 강조 톤(발행일=오늘 무비판 각인 경고).
    expect(t).toContain('border-amber-300');
    expect(t).toContain('진단일');
    // 진료 기록 없을 때 오늘 폴백임을 명시(확인 유도).
    expect(t).toContain('진료 기록이 없어 오늘 날짜로 설정됨');
  });

  test('R5-B: 발행 버튼 직전 날짜 재확인 줄([날짜] 서류=showDate 한정, 과도 마찰 회피)', () => {
    const t = tab();
    expect(t).toContain('const dateConfirmLine');
    expect(t).toContain('showDate && docDate');
    expect(t).toContain('서류 날짜(진단일)');
    expect(t).toContain('실제 진단일이 맞습니까');
    // 발행 확인 window.confirm 에 날짜 확인 줄 결합.
    expect(t).toContain('${dateConfirmLine}');
  });

  // ── docDateTouched: 사용자 변경값 보존(자동채움이 덮지 않음) ────────────────────
  test('사용자 변경 보존: onChange 시 docDateTouched=true → 자동 default 스냅 중단', () => {
    const t = tab();
    expect(t).toContain('const [docDateTouched, setDocDateTouched] = useState(false)');
    expect(t).toContain('setDocDate(e.target.value); setDocDateTouched(true)');
    // 새 바인딩 시 touched 리셋.
    expect(t).toContain('setDocDateTouched(false)');
  });

  // ── AC3: 각인 규칙 무접촉(default 소스 교체만) ────────────────────────────────
  test('AC3(경계): published/발행 RPC 미접촉 — default 소스만 교체(각인 로직 무변경)', () => {
    const t = tab();
    // 최근 진료일 훅은 read-only(medical_charts SELECT)만 — write 없음.
    const start = t.indexOf('function useLatestVisitDate');
    const end = t.indexOf('staleTime: 30_000,\n  });\n}', start);
    const hook = t.slice(start, end > start ? end : start + 800);
    expect(hook).not.toContain('.insert(');
    expect(hook).not.toContain('.update(');
    expect(hook).not.toContain('.delete(');
  });
});

/**
 * 현장 클릭 시나리오 (갤탭 실기기 현장 confirm 체크리스트 — 단계별 확인 의무):
 *
 * [시나리오1] 정상 동선 (진단일=최근 진료일이 맞는 경우) — R5 A/B
 *   1. 원장 로그인 → 진료대시보드 → 소견서 발행 화면 진입(허브 직접발행 or 실장 요청 '작성하기')
 *   2. [날짜] 포함 문구 선택 → '서류 날짜' 칸이 amber(노랑) 강조로 뜨고 기본값=그 환자 최근 진료일인지 확인
 *   3. 힌트에 "(기본값=최근 진료일 YYYY-MM-DD)"가 뜨는지 확인
 *   4. 발행 버튼 클릭 → 발행 확인창에 "📅 서류 날짜(진단일): YYYY-MM-DD ... 맞습니까?" 재확인 줄이 뜨는지 확인
 *   5. 승인 → 진단일=최근 진료일로 각인 확인
 *   Expected: 오늘이 아니라 실 진료일이 기본으로 채워지고, 발행 직전 한 번 더 확인.
 *
 * [시나리오2] 과거 진단일 (재발 방지 핵심) — 손정아 사례
 *   1. 07-22 진료, 07-24 발행 케이스 → '서류 날짜' 기본값이 07-22(최근 진료일)로 자동 채워지는지 확인
 *   2. 원장이 날짜를 손대면(직접 변경) 그 값이 유지되고 자동채움이 덮지 않는지 확인
 *   3. 변경 안 하고 발행 시 확인창이 07-22 을 명시적으로 재확인시키는지 확인
 *   Expected: 발행일(오늘 07-24)이 진단일로 오각인되지 않음.
 *
 * [시나리오3] 엣지 — 진료 기록 없음(PREFLIGHT 폴백)
 *   1. 진료 기록(medical_charts)이 없는 환자 → '서류 날짜' 기본값=오늘로 폴백되는지
 *   2. 힌트에 "진료 기록이 없어 오늘 날짜로 설정됨 — 확인 필요" 안내가 뜨는지 확인
 *   Expected: 맹목 auto-set 없이 오늘 폴백 + 강조/확인으로 오발행 방지.
 *
 * [시나리오4] 실장 요청 경로 우선
 *   1. 실장이 '서류 날짜'를 지정해 요청(initialDate) → 발행 화면에서 그 지정 날짜가 최근 진료일 자동채움에 안 덮이는지 확인
 *   Expected: 실장 명시 날짜 우선(자동채움 무시).
 *
 * 비고(NO-DDL/경계): default 소스만 오늘→medical_charts.visit_date 최신으로 교체(read-only). 각인 규칙(§22
 *   append-only·published) 무접점. 신규 컬럼/테이블/RPC/마이그 = 0(db_change=false).
 *   ★deploy 게이트: 소견서=§11 의료화면 → 문지은 대표원장(U0ALGAAAJAV) direct confirm 후에만 배포(우선순위 상향 무관).
 */
