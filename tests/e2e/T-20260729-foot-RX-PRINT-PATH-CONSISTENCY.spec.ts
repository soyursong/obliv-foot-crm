/**
 * E2E Spec — T-20260729-foot-RX-PRINT-PATH-CONSISTENCY
 *
 * 문제: 처방전이 인쇄 경로(수납창/단일/배치)마다 다르게 나옴 → 손님 서류 오류.
 *   §0 매핑 전수조사(경로×토큰) 실측: 배치 경로만 (a)교부번호 미채번(공란) (b)총투약일수 공란
 *   (c)rx 약품행 필터 없음(상병·검사·진찰료·풋케어 혼입) — 3경로 입력 불일치.
 *
 * 근거 = Slack 첨부 지시서(handoff, ts 1785324745). MQ 릴레이는 #1/#2 에서 truncation →
 *   첨부 원본에서 §1-1~§1-6 전수 대조(스코프 확장 확인, planner FOLLOWUP 발행).
 *
 * 3개 호출부(경로):
 *   - DPP 단일/미리보기 = DocumentPrintPanel.tsx  IssueDialog.handlePrint / allValues
 *   - DPP 배치          = DocumentPrintPanel.tsx  handleBatchPrint
 *   - PMW 결제창(PATH-4) = PaymentMiniWindow.tsx   buildCodeEnrichedValues
 *   최종 렌더 SSOT = buildRxItemsHtml / splitIssueNoForDisplay / buildIssueNo (src/lib).
 *
 * AC 커버리지:
 *  - AC1 (§1-3): rx 약품행 필터 = category_label==='처방약' 로 3경로 통일. '!==상병' 폐기(상병·검사·진찰료 혼입 차단).
 *  - AC2 (§1-2): 배치 total_days '' → '1' (단일/PMW 와 통일).
 *  - AC3 (§1-1): 배치 교부번호 채번(issue_foot_rx_issue_no) + 멱등키=inserted.id + 차트번호 게이트.
 *  - AC4 (§1-4): clinicDoctorOverrides 에 prescriber_name/prescriber_license_no 추가(이름↔도장 정합).
 *  - AC5 (§1-6): PMW 상병코드 stale — 재세팅 전 diag_code_1~N·diag_name_1~N 전부 delete(autoBind 패턴).
 *  - AC6 회귀: 정상 처방약 행 누락 없음 + buildRxItemsHtml/issue_no 렌더 pass-through 무회귀.
 *
 * 실행: npx playwright test T-20260729-foot-RX-PRINT-PATH-CONSISTENCY.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildRxItemsHtml } from '../../src/lib/htmlFormTemplates';
import { buildIssueNo, splitIssueNoForDisplay, ISSUE_NO_SEQ_WIDTH } from '../../src/lib/docSerial';

// playwright 실행 CWD = 레포 루트(package.json 위치).
const ROOT = process.cwd();
const DPP = readFileSync(join(ROOT, 'src/components/DocumentPrintPanel.tsx'), 'utf8');
const PMW = readFileSync(join(ROOT, 'src/components/PaymentMiniWindow.tsx'), 'utf8');

// category_label 7종(PMW 실측): 상병/처방약/기본/검사/풋케어/수액/풋화장품.
type Item = { name: string; service_code: string | null; category_label: string | null };
const MIXED_ITEMS: Item[] = [
  { name: '급성 발톱주위염', service_code: 'L03.0', category_label: '상병' },
  { name: '테르비나핀정', service_code: 'D-TERB', category_label: '처방약' },
  { name: '진찰료', service_code: 'AA154', category_label: '기본' },
  { name: '균검사', service_code: 'C-FUNGI', category_label: '검사' },
  { name: '발톱관리', service_code: 'F-CARE', category_label: '풋케어' },
  { name: '이트라코나졸캡슐', service_code: 'D-ITRA', category_label: '처방약' },
  { name: '수액', service_code: 'IV-01', category_label: '수액' },
];

// 실제 rx 필터(확정): category_label === '처방약'
function rxFilter(items: Item[]): Item[] {
  return items.filter((i) => (i.category_label ?? '') === '처방약');
}

// 행별 데이터 셀(용량/횟수/투약일수) 추출: name 다음 3개 <td>.
//   buildRxItemsHtml 은 8행으로 pad(빈 행 name='') → 실제 약품행(name 비지 않음)만 카운트.
function doseCells(html: string): Array<{ unit_dose: string; daily_freq: string; total_days: string }> {
  const rows: Array<{ unit_dose: string; daily_freq: string; total_days: string }> = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const tds = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => x[1].trim());
    if (tds.length >= 4 && tds[0]) rows.push({ unit_dose: tds[1], daily_freq: tds[2], total_days: tds[3] });
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC1 — §1-3: rx 약품행 필터 = category_label==='처방약' (3경로 통일)
// ─────────────────────────────────────────────────────────────────────────────
test('AC1-behavior: 혼합 항목 → 처방약만 남고 상병·검사·진찰료·풋케어·수액 전부 제외', () => {
  const rx = rxFilter(MIXED_ITEMS);
  expect(rx.map((r) => r.name)).toEqual(['테르비나핀정', '이트라코나졸캡슐']);
  // 오혼입 대상이 하나도 남지 않아야 함(손님 처방전 오류의 근본)
  expect(rx.some((r) => r.category_label === '상병')).toBe(false);
  expect(rx.some((r) => r.category_label === '검사')).toBe(false);
  expect(rx.some((r) => r.category_label === '기본')).toBe(false);
  expect(rx.some((r) => r.category_label === '풋케어')).toBe(false);
  expect(rx.some((r) => r.category_label === '수액')).toBe(false);
});

test('AC1-behavior: 구 필터(!==상병)는 검사·진찰료·풋케어·수액을 혼입시킴(반증)', () => {
  const oldFilter = MIXED_ITEMS.filter((i) => (i.category_label ?? '') !== '상병');
  // 구 필터는 처방약 2건 외에 검사/기본/풋케어/수액 4건을 잘못 포함 → 손님 오류
  expect(oldFilter.length).toBe(6);
  expect(oldFilter.length).toBeGreaterThan(rxFilter(MIXED_ITEMS).length);
});

test('AC1-source: 3경로 rx 빌더가 모두 ===\'처방약\' 사용 / rx 컨텍스트에 !==\'상병\' 잔존 없음', () => {
  // PMW buildCodeEnrichedValues rx 블록
  expect(PMW).toMatch(/formKey === 'rx_standard'[\s\S]*?category_label \?\? ''\) === '처방약'/);
  // DPP 단일(allValues) rx_standard 블록
  expect(DPP).toMatch(/template\.form_key === 'rx_standard'[\s\S]*?category_label === '처방약'/);
  // DPP 배치(handleBatchPrint) rxItems 빌더
  expect(DPP).toMatch(/const rxItems = mappedItems\s*\n?\s*\.filter\(\(item\) => item\.category_label === '처방약'\)/);
  // 구 반증 필터가 rx 빌더 라인에 남아있지 않아야 함
  expect(DPP).not.toMatch(/rxServiceItems = serviceItems\.filter\(\(i\) => i\.category_label !== '상병'\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2 — §1-2: 배치 total_days '' → '1' (3경로 통일)
// ─────────────────────────────────────────────────────────────────────────────
test('AC2-source: 배치 rx 빌더 total_days 리터럴 \'1\' / 구 공란(\'\') 잔존 없음', () => {
  // 배치 rxItems 빌더 블록에 total_days: '1'
  const batchBlock = DPP.slice(
    DPP.indexOf("const rxItems = mappedItems"),
    DPP.indexOf("autoValues.rx_items_html = buildRxItemsHtml(rxItems)"),
  );
  expect(batchBlock).toContain("total_days: '1'");
  expect(batchBlock).not.toContain("total_days: ''");
});

test('AC2-behavior: 미입력 시 3칸 전부 기본 \'1\' 렌더(단일/PMW/배치 동일 리터럴)', () => {
  const html = buildRxItemsHtml([
    { name: '테르비나핀정', code: 'D-TERB', unit_dose: '1', daily_freq: '1', total_days: '1' },
  ]);
  const cells = doseCells(html);
  expect(cells.length).toBe(1);
  expect(cells[0]).toEqual({ unit_dose: '1', daily_freq: '1', total_days: '1' });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC3 — §1-1: 배치 교부번호 채번 + 멱등키 + 차트번호 게이트
// ─────────────────────────────────────────────────────────────────────────────
test('AC3-source: 배치 serial 루프가 issue_foot_rx_issue_no 를 멱등키=inserted.id 로 발번', () => {
  // rx issue_no 대상 게이트 = rx_standard + 차트번호(batchChartNo) 보유
  expect(DPP).toMatch(/const isRxIssue = t\.form_key === 'rx_standard' && !!batchChartNo;/);
  // RPC 호출 + 멱등키(p_form_submission_id = inserted.id) — isRxIssue 분기 ~ 루프 종료까지.
  const loopStart = DPP.indexOf('const isRxIssue');
  const loop = DPP.slice(loopStart, DPP.indexOf('연번호 발번 양식은 per-template'));
  expect(loop).toContain("supabase.rpc('issue_foot_rx_issue_no'");
  expect(loop).toContain('p_form_submission_id: inserted.id');
  expect(loop).toContain('p_issue_date: issueDateIso');
  // 발번 결과를 buildIssueNo 로 조립 후 issue_no 주입 + field_data 갱신
  expect(loop).toContain('const iss = buildIssueNo(issueDateYmd');
  expect(loop).toContain('issue_no: iss');
});

test('AC3-source: 단건 경로와 동일 RPC 시그니처(파리티) — 두 경로 모두 3개 파라미터', () => {
  const rpcCalls = [...DPP.matchAll(/issue_foot_rx_issue_no'\s*,\s*\{[\s\S]*?\}\)/g)].map((m) => m[0]);
  // 단건(handlePrint)·배치(serial 루프) 최소 2회 이상 호출, 모두 clinic/date/submission 3파라미터
  expect(rpcCalls.length).toBeGreaterThanOrEqual(2);
  for (const c of rpcCalls) {
    expect(c).toContain('p_clinic_id');
    expect(c).toContain('p_issue_date');
    expect(c).toContain('p_form_submission_id');
  }
});

test('AC3-behavior: buildIssueNo (8+N) 형식 + splitIssueNoForDisplay 표시 분리(멱등)', () => {
  const iss = buildIssueNo('20260729', 25);
  expect(iss).toBe('20260729' + '25'.padStart(ISSUE_NO_SEQ_WIDTH, '0'));
  expect(iss).toMatch(/^\d{14}$/); // 8 + 6
  // RPC 실패 시 seq=1 폴백도 유효 (8+N)자리 (공란/UUID 반려 방지)
  expect(buildIssueNo('20260729', 1)).toMatch(/^\d{14}$/);
  // 표시 분리 + 멱등(재적용 no-op)
  const once = splitIssueNoForDisplay({ issue_no: iss!, issue_date: '' });
  expect(once.issue_date).toBe('2026-07-29');
  expect(once.issue_no).toBe('000025');
  const twice = splitIssueNoForDisplay(once);
  expect(twice.issue_no).toBe('000025'); // 재적용 무변경(멱등)
});

// ─────────────────────────────────────────────────────────────────────────────
// AC4 — §1-4: prescriber_* override (이름↔도장 정합)
// ─────────────────────────────────────────────────────────────────────────────
test('AC4-source: clinicDoctorOverrides 에 prescriber_name/prescriber_license_no 추가', () => {
  const ovr = DPP.slice(DPP.indexOf('setClinicDoctorOverrides({'), DPP.indexOf('setClinicDoctorOverrides({') + 600);
  expect(ovr).toContain('prescriber_name: data.name');
  expect(ovr).toContain('prescriber_license_no: data.license_no');
  // 도장 축(doctor_seal_image)과 동일 override 블록에서 세팅 → 이름·도장 동시 전환
  expect(ovr).toContain('doctor_seal_image: sealUrl');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC5 — §1-6: PMW 상병코드 stale delete (autoBind 패턴)
// ─────────────────────────────────────────────────────────────────────────────
// buildCodeEnrichedValues 의 diag 재세팅 로직 재현(실제 코드 표현식과 동일).
function enrichDiag(base: Record<string, string>, diagItems: Array<{ code: string; name: string }>): Record<string, string> {
  const values = { ...base };
  if (diagItems.length > 0) {
    for (const k of Object.keys(values)) {
      if (/^diag_(code|name)_\d+$/.test(k)) delete values[k];
    }
    diagItems.forEach((item, idx) => {
      const n = idx + 1;
      values[`diag_code_${n}`] = item.code;
      values[`diag_name_${n}`] = item.name;
    });
  }
  return values;
}

test('AC5-behavior: 선택 상병이 base 보다 적으면 옛 diag_code_3/4 잔존 없이 정리됨', () => {
  const base = {
    diag_code_1: 'A', diag_name_1: '가',
    diag_code_2: 'B', diag_name_2: '나',
    diag_code_3: 'C', diag_name_3: '다', // stale — 없어져야 함
    diag_code_4: 'D', diag_name_4: '라', // stale — 없어져야 함
  };
  const out = enrichDiag(base, [{ code: 'X', name: '엑스' }]); // 이번 선택 1건
  expect(out.diag_code_1).toBe('X');
  expect(out.diag_name_1).toBe('엑스');
  expect(out.diag_code_2).toBeUndefined();
  expect(out.diag_code_3).toBeUndefined(); // ★stale 제거
  expect(out.diag_code_4).toBeUndefined(); // ★stale 제거
  expect(out.diag_name_3).toBeUndefined();
  expect(out.diag_name_4).toBeUndefined();
});

test('AC5-behavior: 선택 상병 0건이면 base 차트상병 보존(wipe 금지 = 기존 동작)', () => {
  const base = { diag_code_1: 'A', diag_name_1: '가', diag_code_2: 'B', diag_name_2: '나' };
  const out = enrichDiag(base, []);
  expect(out.diag_code_1).toBe('A');
  expect(out.diag_code_2).toBe('B');
});

test('AC5-source: PMW 가 재세팅 전 diag_code/name 전체 delete + length>0 가드', () => {
  const blk = PMW.slice(PMW.indexOf('const diagItems = codeItems.filter'), PMW.indexOf('const diagItems = codeItems.filter') + 800);
  expect(blk).toContain('if (diagItems.length > 0)');
  expect(blk).toMatch(/\/\^diag_\(code\|name\)_\\d\+\$\/\.test\(k\)/);
  expect(blk).toContain('delete values[k]');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC6 — 회귀: 정상 처방약 누락 없음 + 렌더 pass-through
// ─────────────────────────────────────────────────────────────────────────────
test('AC6-regression: 처방약 여러 건 전건 렌더(누락 없음) + code/dose pass-through', () => {
  const rx = rxFilter(MIXED_ITEMS).map((i) => ({
    name: i.name,
    code: i.service_code,
    unit_dose: '2',
    daily_freq: '3',
    total_days: '5',
  }));
  const html = buildRxItemsHtml(rx);
  // 처방약 2건 모두 표기
  expect(html).toContain('테르비나핀정');
  expect(html).toContain('이트라코나졸캡슐');
  // 오혼입 항목명은 등장하지 않음
  expect(html).not.toContain('급성 발톱주위염');
  expect(html).not.toContain('균검사');
  expect(html).not.toContain('진찰료');
  // dose pass-through
  const cells = doseCells(html);
  expect(cells.length).toBe(2);
  expect(cells[0]).toEqual({ unit_dose: '2', daily_freq: '3', total_days: '5' });
});
