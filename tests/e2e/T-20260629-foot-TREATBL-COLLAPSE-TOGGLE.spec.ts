/**
 * E2E spec — T-20260629-foot-TREATBL-COLLAPSE-TOGGLE
 *
 * 풋센터CRM 치료테이블 §B '균검사 & 피검사 대상자' 목록을 날짜(일자)별 그룹 헤더로 묶고,
 * 헤더 클릭 시 접고/펼치는 아코디언. 화면 진입 시 전 그룹 기본 접힘(▶), 펼치면 ▼.
 *
 *   AC-1: 균검사·피검사 대상자 목록이 날짜별 그룹 헤더로 묶여 표시(기존 ExamDateGroup 재사용 — 새 DB 필드 0, NO-DDL).
 *   AC-2: 화면 최초 진입 시 전 그룹 접힘(▶) — 환자 행 미렌더(초기 expandedDates = 빈 Set).
 *   AC-3: 헤더 클릭 → 펼침(▼) 환자 행 표시 / 재클릭 → 접힘(▶). 토글 핸들러 + chevron 분기.
 *   AC-4: 펼친 상태 기존 행 클릭 동작(좌클릭 2번차트 / 우클릭 CRM 컨텍스트 메뉴) 무변경 — 회귀 가드.
 *   AC-5: 그룹 독립 토글 — 펼침 키를 Set 으로 개별 관리(한 그룹 변경이 다른 그룹 무영향).
 *   AC-6: 데이터(조회·집계·정렬·건수) 무변경 — useExamTargets/그룹핑 로직 비터치, 표시 구조만.
 *
 * 검증: 현장 PHI 계정 → 실데이터 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) +
 *   티켓 §5 현장 클릭 시나리오(3종)를 코드 가드로 변환. NO-DDL(db_change=none).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const sectionB = () => read('src/components/treatment/ExamTargetsSection.tsx');

test.describe('T-20260629-foot-TREATBL-COLLAPSE-TOGGLE', () => {
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1: 날짜별 그룹 헤더로 묶여 표시 (기존 그룹핑 재사용) ──────────────────
  test('AC-1: 균검사·피검사 대상자가 날짜별 그룹 헤더(아코디언)로 묶여 표시', () => {
    const b = sectionB();
    // 일자 그룹 컨테이너 + 그룹 헤더(토글 버튼) + 건수 라벨
    expect(b).toContain('data-testid="exam-date-group"');
    expect(b).toContain('data-testid="exam-date-group-header"');
    expect(b).toContain('data-testid="exam-date-group-count"');
    // 그룹 키 = 기존 날짜 필드(requestDate=seoulISODate(checked_in_at)) 재사용 — 새 필드 신설 0
    expect(b).toContain('requestDate');
    expect(b).toContain('seoulISODate');
  });

  // ── AC-2: 최초 진입 전 그룹 접힘(▶) — 환자 행 미렌더 ─────────────────────────
  test('AC-2: 초기 상태 전 그룹 접힘 — expandedDates 빈 Set, 펼침 시에만 테이블 렌더', () => {
    const b = sectionB();
    // 펼침 키 집합 초기값 = 빈 Set (전 그룹 접힘). 화면 재진입 시 remount → 접힘 복귀.
    expect(b).toContain('useState<Set<string>>(new Set())');
    expect(b).toContain('expandedDates');
    // 펼친 그룹에서만 명단 테이블 렌더(접힘 그룹 행 미렌더) — {isOpen && (...table...)}
    expect(b).toContain('isOpen &&');
    expect(b).toMatch(/const isOpen = expandedDates\.has\(g\.date\)/);
  });

  // ── AC-3: 헤더 클릭 펼침(▼)/재클릭 접힘(▶) + chevron 분기 ───────────────────
  test('AC-3: 헤더 클릭 토글 핸들러 + ▶/▼ chevron 상태 분기', () => {
    const b = sectionB();
    // 토글 핸들러: has → delete(접힘) / else add(펼침)
    expect(b).toContain('toggleGroup');
    expect(b).toContain('onClick={() => toggleGroup(g.date)}');
    expect(b).toMatch(/if \(next\.has\(d\)\) next\.delete\(d\);/);
    expect(b).toContain('else next.add(d);');
    // 접힘=ChevronRight(▶) / 펼침=ChevronDown(▼) 분기 + 접근성 aria-expanded
    expect(b).toContain('ChevronRight');
    expect(b).toContain('ChevronDown');
    expect(b).toContain('data-testid="exam-date-group-chevron"');
    expect(b).toContain('aria-expanded={isOpen}');
    expect(b).toContain("data-state={isOpen ? 'expanded' : 'collapsed'}");
  });

  // ── AC-4: 펼친 상태 기존 행 클릭 동작 무변경(회귀 가드) ─────────────────────
  test('AC-4: 좌클릭=2번차트 / 우클릭=CRM 컨텍스트 메뉴 동작 무변경', () => {
    const b = sectionB();
    // 기존 행 상호작용 위임 그대로 — 신규 정의 0
    expect(b).toContain('nameInteraction.onLeftClick(r.customerId)');
    expect(b).toContain('nameInteraction.onContextMenu');
    expect(b).toContain('data-testid="exam-name-clickable"');
    // 검사결과 동작(균/피검사 결과 보기·생성·업로드)도 보존
    expect(b).toContain('exam-koh-badge');
    expect(b).toContain('exam-blood-badge');
  });

  // ── AC-5: 그룹 독립 토글 ────────────────────────────────────────────────────
  test('AC-5: 그룹 독립 토글 — 펼침 키를 Set 으로 개별 관리(불변 복사)', () => {
    const b = sectionB();
    // 불변 복사 후 단일 키만 추가/삭제 → 다른 그룹 상태 무영향
    expect(b).toContain('const next = new Set(prev);');
    // 그룹별 isOpen 을 각 그룹 키로 독립 산출
    expect(b).toMatch(/groups\.map\(\(g\) => \{/);
  });

  // ── AC-6: 데이터(조회·집계·정렬·건수) 무변경 — 표시 구조만 ───────────────────
  test('AC-6: 데이터 로직 무변경 — 조회/집계/정렬/건수 비터치', () => {
    const b = sectionB();
    // 기존 데이터 훅·그룹핑·정렬 보존
    expect(b).toContain('useExamTargets');
    expect(b).toContain('totalCount');
    expect(b).toContain('대상 {totalCount}명');
    // 그룹 정렬(최근 신청일 먼저) + 그룹 내 가나다 정렬 보존
    expect(b).toContain('b.date.localeCompare(a.date)');
    expect(b).toContain("localeCompare(b.customerName, 'ko')");
  });

  // ── 시나리오 3 (엣지): 빈 목록 — 헤더 토글이 빈 상태를 깨지 않음 ───────────────
  test('시나리오3: 대상자 0명 시 빈 상태(empty) 분기 유지 — 그룹 토글과 분리', () => {
    const b = sectionB();
    expect(b).toContain('data-testid="exam-targets-empty"');
    expect(b).toContain('groups.length === 0');
  });
});
