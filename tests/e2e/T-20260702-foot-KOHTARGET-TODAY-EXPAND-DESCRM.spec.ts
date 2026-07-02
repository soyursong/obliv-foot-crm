/**
 * E2E spec — T-20260702-foot-KOHTARGET-TODAY-EXPAND-DESCRM
 *
 * 풋센터CRM 치료테이블 §B '균검사 & 피검사 대상자' 화면 표시 튜닝 2건(김주연 총괄).
 *   AC-1: 검사신청일 날짜별 아코디언 중 '오늘(당일, KST)' 묶음만 기본 펼침(open),
 *         과거 날짜는 접힘으로 시작. groups 최초 로드 시 useEffect 로 오늘만 펼침(ref 가드 1회).
 *         오늘 신청 0건(오늘 그룹 없음) → 강제로 다른 날짜 펼치지 않음(전부 접힘 유지) [정책 명시].
 *         사용자가 헤더 클릭 시 과거 날짜 수동 확장 가능(기존 toggleGroup 보존).
 *   AC-2: 상단 정적 안내 문구('검사신청일 기준 …~… 동안 …신청한 검사만 활성(●)…') 전체 DOM 제거.
 *   AC-3: 집계·필터·활성(●) 표기 로직 불변 — 표시(아코디언 초기 상태 + 문구 제거)만 변경(회귀 가드).
 *
 * 검증: 현장 PHI 계정 → 실데이터 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) +
 *   티켓 §현장 클릭 시나리오(2종)를 코드 가드로 변환. NO-DDL(db_change=false).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const sectionB = () => read('src/components/treatment/ExamTargetsSection.tsx');

test.describe('T-20260702-foot-KOHTARGET-TODAY-EXPAND-DESCRM', () => {
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1: '오늘' 묶음만 기본 펼침 (과거 접힘, ref 가드 1회) ────────────────────
  test('AC-1: groups 최초 로드 시 오늘 날짜 묶음만 기본 펼침 (useEffect + ref 가드)', () => {
    const b = sectionB();
    // 초기값은 여전히 빈 Set — 로드 전 강제 펼침 없음
    expect(b).toContain('useState<Set<string>>(new Set())');
    // 최초 1회만 초기화하는 ref 가드
    expect(b).toContain('didInitExpandRef');
    expect(b).toMatch(/const didInitExpandRef = useRef\(false\)/);
    expect(b).toContain('if (didInitExpandRef.current) return;');
    // groups 미로드(빈 배열) 시 초기화 보류 → 로드 후 실행
    expect(b).toContain('if (groups.length === 0) return;');
    // 오늘 그룹이 있으면 오늘만 펼침 집합으로 설정
    expect(b).toContain('groups.some((g) => g.date === today)');
    expect(b).toContain('setExpandedDates(new Set([today]))');
    // '오늘' 기준 = KST 현재 날짜
    expect(b).toContain('const today = seoulISODate(new Date())');
  });

  // ── AC-1(엣지): 오늘 0건 → 강제 펼침 없음(전부 접힘 유지) ─────────────────────
  test('AC-1 엣지: 오늘 신청 0건이면 다른 날짜를 강제로 펼치지 않음', () => {
    const b = sectionB();
    // setExpandedDates 는 오늘 그룹 존재(if) 안에서만 호출 → 오늘 없으면 빈 Set 유지(전부 접힘)
    const m = b.match(/if \(groups\.some\(\(g\) => g\.date === today\)\) \{\s*setExpandedDates\(new Set\(\[today\]\)\);\s*\}/);
    expect(m).not.toBeNull();
  });

  // ── AC-1: 과거 날짜 수동 확장 가능 (기존 토글 보존) ──────────────────────────
  test('AC-1: 헤더 클릭 토글(toggleGroup) 보존 — 과거 날짜 수동 확장 가능', () => {
    const b = sectionB();
    expect(b).toContain('toggleGroup');
    expect(b).toContain('onClick={() => toggleGroup(g.date)}');
    expect(b).toContain('const next = new Set(prev);');
    expect(b).toMatch(/if \(next\.has\(d\)\) next\.delete\(d\);/);
    expect(b).toContain('else next.add(d);');
    // 그룹별 isOpen 개별 산출 + chevron 분기 유지
    expect(b).toMatch(/const isOpen = expandedDates\.has\(g\.date\)/);
    expect(b).toContain('ChevronRight');
    expect(b).toContain('ChevronDown');
  });

  // ── AC-2: 상단 정적 안내 문구 전체 제거 ─────────────────────────────────────
  test('AC-2: 안내 문구("검사신청일 기준 …활성(●)…") DOM 제거', () => {
    const b = sectionB();
    // 제거 대상 문구의 특징 문자열이 소스에서 사라졌는지
    expect(b).not.toContain('일자별로 묶어 보여줍니다');
    expect(b).not.toContain('신청한 검사만 활성(●)으로 표시됩니다');
    expect(b).not.toContain('검사신청일 기준 {dateLabel(start)} ~ {dateLabel(date)}');
    // 안내문 전용 지역변수 start 는 컴포넌트 본문(totalCount 근처)에서 제거(미사용 방지).
    //   단 windowBounds 훅 내부(useExamSigningDoctors)의 start 사용은 유지되므로 exact 문자열 금지 대신
    //   totalCount 직후에 본문 start 선언이 없는지 확인.
    expect(b).not.toMatch(/const today = seoulISODate\(new Date\(\)\);\s*\n\s*const \{ start \} = windowBounds\(date\);/);
  });

  // ── AC-3: 집계·필터·활성(●) 표기 로직 불변 (회귀 가드) ──────────────────────
  test('AC-3: 데이터 로직 무변경 — 조회/집계/정렬/건수/활성표기 비터치', () => {
    const b = sectionB();
    // 데이터 훅·그룹핑·정렬·건수 보존
    expect(b).toContain('useExamTargets');
    expect(b).toContain('totalCount');
    expect(b).toContain('대상 {totalCount}명');
    expect(b).toContain('b.date.localeCompare(a.date)');
    expect(b).toContain("localeCompare(b.customerName, 'ko')");
    // 활성(●)/미신청(○) 표기 로직 보존
    expect(b).toContain("{active ? '●' : '○'}");
    expect(b).toContain('exam-koh-badge');
    expect(b).toContain('exam-blood-badge');
    // 섹션 제목은 유지(제거 대상은 안내문만)
    expect(b).toContain('균검사 &amp; 피검사 대상자');
    // 빈 목록 분기 유지
    expect(b).toContain('data-testid="exam-targets-empty"');
    expect(b).toContain('groups.length === 0');
  });
});
