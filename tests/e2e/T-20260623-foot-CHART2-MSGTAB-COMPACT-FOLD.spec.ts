/**
 * E2E spec — T-20260623-foot-CHART2-MSGTAB-COMPACT-FOLD
 *
 * 2번차트(CustomerChartPage) 메시지 탭 컴팩트화 + 발송완료 접기/펼치기 (순수 FE 레이아웃/토글, risk GO):
 *   ① 메시지 탭(chartTabGroup==='history' && chartTab==='messages') 3블록
 *      (문자 이력 등록 / 자동 SMS 발송 이력 notification_logs / 수동 문자 기록 message_logs) 세로 밀도 추가 컴팩트.
 *   ② "발송 완료된 내용"(자동 SMS 이력 + 수동 문자 기록) 접기/펼치기 토글, 기본=접힘.
 *      - 토글 헤더에 "발송 완료 N건" 카운트 배지(notificationLogs.length + messageLogs.length).
 *      - 클라이언트 UI state(msgSentHistoryOpen), DB 영속화 없음.
 *      - 신규 입력 폼(문자 이력 등록)은 접기 대상 아님 — 상시 노출.
 *
 * 현장 클릭 시나리오(티켓 본문 2종):
 *   1) 메시지 탭 진입 → 기본 접힘 → "발송 완료된 내용 N건" 클릭 → 이력 펼침 → 재클릭 → 접힘.
 *   2) 입력 폼(문자 이력 등록)은 접힘/펼침과 무관하게 항상 노출.
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

// 메시지(messages) 탭 렌더 블록만 좁혀서 검증
function messagesBlock(): string {
  const src = chartPage();
  const start = src.indexOf("chartTab === 'messages' && (");
  expect(start).toBeGreaterThan(-1);
  // 메시지 탭 닫힘(/msgSentHistoryOpen 직후 탭 콘텐츠 종료)까지
  const after = src.indexOf('/msgSentHistoryOpen', start);
  return after > start ? src.slice(start, after + 600) : src.slice(start, start + 12000);
}

test.describe('T-20260623-foot-CHART2-MSGTAB-COMPACT-FOLD — 메시지 탭 컴팩트 + 발송완료 접기', () => {

  // 회귀 가드 — 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  test('① 접기/펼치기 상태값 존재 (기본 접힘 = false)', () => {
    const src = chartPage();
    expect(src).toContain('const [msgSentHistoryOpen, setMsgSentHistoryOpen] = useState(false)');
  });

  test('② 토글 버튼 존재 + 카운트 배지(N건)', () => {
    const block = messagesBlock();
    expect(block).toContain('data-testid="msg-sent-history-toggle"');
    expect(block).toContain('setMsgSentHistoryOpen((v) => !v)');
    expect(block).toContain('발송 완료된 내용');
    // 카운트 = 자동SMS + 수동기록 합
    expect(block).toContain('notificationLogs.length + messageLogs.length');
    expect(block).toContain('건');
  });

  test('③ 토글 chevron 방향 분기 (열림=Down / 닫힘=Right)', () => {
    const block = messagesBlock();
    expect(block).toMatch(/msgSentHistoryOpen\s*\?\s*<ChevronDown[\s\S]*?:\s*<ChevronRight/);
  });

  test('④ 발송완료 영역(자동SMS+수동기록)이 토글로 감싸짐', () => {
    const block = messagesBlock();
    // 펼침 조건부 래퍼
    expect(block).toContain('{msgSentHistoryOpen && (<>');
    expect(block).toContain('/msgSentHistoryOpen');
    // 래퍼 안에 두 이력 블록 포함
    expect(block).toContain('자동 SMS 발송 이력');
    expect(block).toContain('수동 문자 기록');
  });

  test('⑤ 신규 입력 폼(문자 이력 등록)은 접기 대상 아님 — 토글 래퍼 밖 상시 노출', () => {
    const block = messagesBlock();
    const formIdx = block.indexOf('문자 이력 등록');
    const wrapIdx = block.indexOf('{msgSentHistoryOpen && (<>');
    expect(formIdx).toBeGreaterThan(-1);
    expect(wrapIdx).toBeGreaterThan(-1);
    // 입력 폼이 토글 래퍼보다 앞에 위치 = 래퍼 밖 상시 노출
    expect(formIdx).toBeLessThan(wrapIdx);
  });

  test('⑥ 컴팩트화 — 3블록 패딩 p-2.5 → p-2 축소', () => {
    const block = messagesBlock();
    // 메시지 탭 블록 내부에 p-2.5 잔존 없음(전부 p-2로 축소)
    expect(block).not.toContain('p-2.5');
    expect(block).toContain('p-2 text-xs');
  });

  test('⑦ DB 영속화 없음 — 토글은 순수 클라이언트 state (insert/update에 msgSentHistory 미관여)', () => {
    const src = chartPage();
    expect(src).not.toMatch(/msgSentHistoryOpen[\s\S]{0,60}supabase/);
    expect(src).not.toMatch(/supabase[\s\S]{0,60}msgSentHistoryOpen/);
  });
});

/*
 * ── 갤탭 실기기 현장 confirm 체크리스트 (정적검증 통과 후) ──
 * [ ] S1: 2번차트 → 발송이력(메시지) 탭 진입 → 기본 접힘, "발송 완료된 내용 N건" 헤더만 보임
 * [ ] S1: 헤더 클릭 → 자동 SMS 이력 + 수동 문자 기록 펼쳐짐 (chevron ▼)
 * [ ] S1: 재클릭 → 다시 접힘 (chevron ▸), N건 카운트 정확
 * [ ] S2: 접힘/펼침과 무관하게 "문자 이력 등록" 입력 폼은 항상 상단 노출, 등록 정상 동작
 * [ ] 3블록 세로폭 컴팩트 — 이전 대비 밀도 향상 육안 확인
 */
