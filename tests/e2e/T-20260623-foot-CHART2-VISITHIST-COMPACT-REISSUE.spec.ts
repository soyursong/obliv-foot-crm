/**
 * E2E spec — T-20260623-foot-CHART2-VISITHIST-COMPACT-REISSUE
 *
 * 2번차트(CustomerChartPage) 컴팩트화 3건 (순수 FE 레이아웃/표시, risk GO):
 *   ① 탭 버튼 레이아웃 세로폭 축소 (min-h 44px → 32px, 탭 기능 불변)
 *   ② 진료내역 리스트 타이트 + 컬럼 재정의(방문일자·접수시간·귀가시간·서류재발급)
 *      - 귀가시간 = 기존 check_ins.completed_at('완료' 상태전환 timestamp). 신규 집계/DB컬럼 0.
 *        소스 없으면 '-'(임의 추정 금지).
 *      - 하단 프린터아이콘 + 발행서류(접힘상태 chips) 줄 삭제. 출력 동선은 '서류 재발급' 버튼으로 유지.
 *   ③ 서류재발급 클릭 시 [발행이력] 패널 상단으로 이동 + 2단(2열) 진열
 *      - DocumentPrintPanel historyAtTop prop으로 스코프 → 타 surface(결제미니창·진료콜) 무영향(1열·원위치).
 *      - DOCOUTPUT-COLORBOX(서류출력 행리스트) 회귀 없음 검증.
 *
 * 검증 방식: 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200).
 *   실브라우저 클릭 시나리오는 하단 체크리스트(갤탭 실기기 현장 confirm 후 done).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const chartPage = () => read('src/pages/CustomerChartPage.tsx');
const dpp = () => read('src/components/DocumentPrintPanel.tsx');

// 진료내역(treatments) 탭 렌더 블록만 좁혀서 검증
function treatmentsBlock(): string {
  const src = chartPage();
  const start = src.indexOf("chartTab === 'treatments' && (() => {");
  expect(start).toBeGreaterThan(-1);
  const after = src.indexOf('서류 재발급 모달', start); // DOC-REISSUE-BTN 모달 직전까지
  return after > start ? src.slice(start, after) : src.slice(start, start + 12000);
}

test.describe('T-20260623-foot-CHART2-VISITHIST-COMPACT-REISSUE — 2번차트 컴팩트화 3건', () => {

  // 회귀 가드 — 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ① 탭 버튼 세로폭 축소
  test('① 탭 버튼 — min-h-[44px] 제거, min-h-[32px]로 컴팩트', () => {
    const src = chartPage();
    // CLINICAL/HISTORY/진료차트 탭 3개 모두 32px로 전환
    expect(src).toContain('min-h-[32px] py-1 text-[11px] font-medium border-r border-gray-300 whitespace-nowrap transition flex items-center');
    // 탭 버튼 영역에 44px 잔존 없음 (서브탭 7935는 별개 — 탭 그룹 컨테이너만 확인)
    const clinicalIdx = src.indexOf('data-testid="chart-tab-clinical"');
    const contentIdx = src.indexOf('data-testid="chart-tab-content"');
    expect(clinicalIdx).toBeGreaterThan(-1);
    const tabNav = src.slice(clinicalIdx, contentIdx);
    expect(tabNav).not.toContain('min-h-[44px]');
    // 탭 기능 불변 — 핸들러 보존
    expect(src).toContain('handleClinicalTab(key)');
    expect(src).toContain('handleHistoryTab(key)');
  });

  // ② 진료내역 컬럼 재정의 — 귀가시간 추가
  test('② 진료내역 — 귀가시간(completed_at) 컬럼 추가, 임의 추정 금지', () => {
    const tb = treatmentsBlock();
    // 귀가시간 = completed_at. 소스 없으면 '-' (추정 금지)
    expect(tb).toContain("const departedStr = ci.completed_at ? format(new Date(ci.completed_at), 'HH:mm') : '-'");
    expect(tb).toContain('data-testid="visit-hist-departed-time"');
    expect(tb).toContain('귀가');
    // 접수시간도 라벨로 명시 노출
    expect(tb).toContain('data-testid="visit-hist-checkin-time"');
    expect(tb).toContain('접수');
  });

  // ② 하단 프린터아이콘 + 발행서류(접힘상태 chips) 줄 삭제
  test('② 진료내역 — 접힘상태 프린터아이콘+발행서류 chips 줄 제거', () => {
    const tb = treatmentsBlock();
    // 제거됨: 접힘 상태(!isExpanded)에서 ciSubs를 chips로 출력하던 블록
    expect(tb).not.toContain('{!isExpanded && ciSubs.length > 0 && (');
    // 서류재발급 동선은 유지
    expect(tb).toContain('서류 재발급');
    expect(tb).toContain('setDocReissueCheckIn(ci)');
  });

  // ② 타이트 — 카드 패딩/리스트 간격 축소
  test('② 진료내역 — 카드/리스트 타이트(px-2.5 py-1 / space-y-1)', () => {
    const tb = treatmentsBlock();
    expect(tb).toContain('w-full flex items-center gap-2 px-2.5 py-1 text-left');
  });

  // ③ DocumentPrintPanel — historyAtTop prop으로 발행이력 상단+2열 분기
  test('③ DocumentPrintPanel — historyAtTop prop 추가, 발행이력 상단+2열 분기', () => {
    const src = dpp();
    // prop 선언 + 시그니처
    expect(src).toContain('historyAtTop?: boolean;');
    expect(src).toContain('historyAtTop = false }: Props)');
    // 발행이력 블록 추출 + 2열/1열 분기
    expect(src).toContain('const historyBlock = submissions.length > 0');
    expect(src).toContain("historyAtTop ? 'grid grid-cols-2 gap-1.5' : 'space-y-1.5'");
    // 상단 배치(헤더 직후) + 원위치는 !historyAtTop
    expect(src).toContain('{historyAtTop && historyBlock}');
    expect(src).toContain('{!historyAtTop && historyBlock}');
  });

  // ③ 서류재발급 모달이 historyAtTop으로 호출
  test('③ 2번차트 서류재발급 모달 — historyAtTop으로 DocumentPrintPanel 호출', () => {
    const cp = chartPage();
    const reissueIdx = cp.indexOf('서류 재발급 —');
    expect(reissueIdx).toBeGreaterThan(-1);
    const after = cp.slice(reissueIdx, reissueIdx + 800);
    expect(after).toContain('<DocumentPrintPanel');
    expect(after).toContain('historyAtTop');
  });

  // ③ 회귀 가드 — DOCOUTPUT-COLORBOX 행리스트(TemplateSection) 무영향
  test('③ 회귀0 — DOCOUTPUT-COLORBOX 서류출력 행리스트 보존', () => {
    const src = dpp();
    // 서류 출력 TemplateSection은 historyBlock 변경과 무관하게 유지
    expect(src).toContain('data-testid="docprint-doc-list"');
    expect(src).toContain('<TemplateSection');
    // 발행이력 2열 grid가 TemplateSection(서류출력) 행리스트를 건드리지 않음 — grid 적용은 historyBlock 내부 한정
    expect(src).toContain('flex flex-col gap-1');
  });
});

/**
 * ─── 갤탭 실기기 현장 confirm 체크리스트 (done 전제) ───
 * [ ] ① 2번차트 진입 → 상·하단 탭 버튼 세로폭이 기존보다 얇아짐(컴팩트), 탭 전환 정상 동작
 * [ ] ② 진료내역 탭 → 각 방문 행에 [방문일자][접수 HH:mm][귀가 HH:mm][서류 재발급] 노출
 * [ ] ② 귀가시간 = 완료 처리된 방문은 완료시각, 미완료/소스없음 방문은 '-' (임의값 아님)
 * [ ] ② 접힘 상태에서 프린터아이콘+발행서류 chips 줄이 더 이상 안 보임(리스트 타이트)
 * [ ] ③ 진료내역 → '서류 재발급' 클릭 → 모달 최상단에 [발행 이력]이 2열로 진열
 * [ ] ③ 발행 이력 항목 클릭 → 해당 양식 재선택(상세 발행) 진입 정상
 * [ ] ③ 서류 출력(체크박스 행 리스트, DOCOUTPUT-COLORBOX)은 기존과 동일하게 1줄 행으로 렌더(회귀 없음)
 * [ ] 회귀: 결제미니창/진료콜의 서류 발행 패널은 발행이력이 기존 위치(하단)·1열 유지(변화 없음)
 */
