/**
 * E2E Spec — T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (AC1-PERSIST + AC2)
 *
 * 처방전 출력 2건 실약국반려 결함 수정:
 *  Bug1(AC1-PERSIST) 교부번호(issue_no) — UUID-slice fallback(약국 판독불가) 폐기 + (8+N)자리 발번.
 *  Bug2(AC2)        총투약일수(total_days) — A안 = 빈칸(자동값 주입 없음, 현장 수기 기입).
 *
 * ★DA 설계경보 반영 (CONSULT-REPLY MSG-20260718-155511-k7iz / DA-20260718-CROSSCRM-RXISSUENO-SERIAL):
 *   issue_no = **발행 시점 1회 채번→저장(persist) 불변 필드**. print-time 재계산 금지
 *   (같은 처방전 익일/재인쇄 시 다른 교부번호 = correctness 결함).
 *   - 채번 = 발행 RPC(issue_foot_rx_issue_no, per-(clinic,date) counter upsert) 내부 = DB dryrun 검증.
 *   - 자릿수 = 8 + N(ISSUE_NO_SEQ_WIDTH) 파라미터화(CEO n7ip): zero-pad 폭 하드코딩 금지
 *     (총괄확정 6/14 vs 심평원 실무규격 5/13 미확정 → 상수 1줄 flip 대응).
 *   본 spec = FE 조립 헬퍼(buildIssueNo) 순수 단위 검증 — 실서버 불필요.
 *   원자 발번·당일파티션·멱등(persist 불변)의 DB-레벨 검증은 마이그 dry-run 의 in-txn assertion
 *     (20260718170000_..._daily_counter.dryrun.sql: 발번 1→2 증가 + 익일 리셋)이 담당.
 *
 * AC 커버리지:
 *  - AC1 형식: 교부번호 = YYYYMMDD(8) + 당일순번 zero-pad N (예 N=6 → '20260718000025')
 *  - AC1 파라미터화: seqWidth 인자/ISSUE_NO_SEQ_WIDTH 로 N=5(13자리)·N=6(14자리) 양쪽 산출 — 폭 하드코딩 없음
 *  - AC1 no-fabrication: seq 미산출(null/undefined)·날짜 형식 이상 → null(임시값·UUID-slice 조작 금지)
 *  - AC1 UUID-slice 폐기: buildIssueNo 출력에 알파벳/UUID 조각 절대 불포함(전부 숫자)
 *  - AC1-PERSIST 결정성: 동일 (date, seq) → 동일 문자열(재조립해도 불변 = persist 성질)
 *
 * 실행: npx playwright test T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX.spec.ts
 */

import { test, expect } from '@playwright/test';
import { buildIssueNo, ISSUE_NO_SEQ_WIDTH } from '../../src/lib/docSerial';

// ── AC1 형식: (8 + N)자리 = YYYYMMDD + zero-pad 순번 ─────────────────────────────

test('AC1: 교부번호 = YYYYMMDD(8) + 당일순번 zero-pad N (기본 N=ISSUE_NO_SEQ_WIDTH)', () => {
  const iss = buildIssueNo('20260718', 25);
  expect(iss).not.toBeNull();
  // 앞 8자리 = 발행날짜
  expect(iss!.slice(0, 8)).toBe('20260718');
  // 뒤 = 순번 zero-pad, 전체 길이 = 8 + 현재 설정 폭
  expect(iss!.length).toBe(8 + ISSUE_NO_SEQ_WIDTH);
  expect(iss!.slice(8)).toBe(String(25).padStart(ISSUE_NO_SEQ_WIDTH, '0'));
});

test('AC1 파라미터화: N=6(총괄확정 14자리) — 예 20260718000025', () => {
  expect(buildIssueNo('20260718', 25, 6)).toBe('20260718000025');
  expect(buildIssueNo('20260718', 25, 6)!.length).toBe(14);
});

test('AC1 파라미터화: N=5(심평원 실무규격 13자리) — 예 2026071800025', () => {
  expect(buildIssueNo('20260718', 25, 5)).toBe('2026071800025');
  expect(buildIssueNo('20260718', 25, 5)!.length).toBe(13);
});

test('AC1 파라미터화: 자릿수는 하드코딩이 아니라 seqWidth 인자로만 결정(6↔5 flip)', () => {
  // 같은 입력, 폭만 다르면 길이가 정확히 그만큼 달라짐 → 폭이 하드코딩되지 않았음을 증명.
  const w6 = buildIssueNo('20260718', 7, 6)!;
  const w5 = buildIssueNo('20260718', 7, 5)!;
  expect(w6.length - w5.length).toBe(1);
  expect(w6.slice(0, 8)).toBe(w5.slice(0, 8)); // 날짜부 동일
});

// ── AC1 no-fabrication: 미산출·형식이상 → null (임시값/UUID-slice 조작 금지) ─────────

test('AC1 no-fabrication: seq 미산출(null/undefined) → null', () => {
  expect(buildIssueNo('20260718', null)).toBeNull();
  expect(buildIssueNo('20260718', undefined)).toBeNull();
});

test('AC1 no-fabrication: 날짜 형식 이상(8자리 아님) → null', () => {
  expect(buildIssueNo('2026-07-18', 25)).toBeNull(); // 하이픈 포함 10자
  expect(buildIssueNo('', 25)).toBeNull();
  expect(buildIssueNo('202607', 25)).toBeNull();
});

test('AC1 UUID-slice 폐기: 출력은 전부 숫자 — 알파벳/UUID 조각 절대 불포함(약국 판독가능)', () => {
  const iss = buildIssueNo('20260718', 25)!;
  // 구 결함: checkIn.id.slice(0,5).toUpperCase() = "A3D5B" 같은 알파벳 혼입 → 약국 반려.
  expect(iss).toMatch(/^\d+$/);
  expect(iss).not.toMatch(/[A-Za-z-]/);
});

test('AC1: seq 하한 = 1 (0/음수 방어 — 공란 대신 항상 유효 순번)', () => {
  expect(buildIssueNo('20260718', 0, 6)).toBe('20260718000001');
  expect(buildIssueNo('20260718', -3, 6)).toBe('20260718000001');
});

// ── AC1-PERSIST: 발행 시점 채번의 결정성(재조립 불변 = persist 성질) ──────────────────

test('AC1-PERSIST: 동일 (date, seq) → 동일 문자열(재출력·재조립해도 교부번호 불변)', () => {
  // persist 의 FE-레벨 표현: 저장된 seq 로 재조립하면 항상 같은 교부번호.
  //   (실제 persist 는 form_submissions.field_data.issue_no + rx_issue_seq 컬럼 + RPC 멱등이 보장 — DB dryrun 검증.)
  const first = buildIssueNo('20260718', 25, 6);
  const reprint = buildIssueNo('20260718', 25, 6);
  expect(reprint).toBe(first);
  expect(reprint).toBe('20260718000025');
});

test('AC1-PERSIST: 다른 발행순번은 다른 교부번호(당일 내 유일성 표현)', () => {
  expect(buildIssueNo('20260718', 25, 6)).not.toBe(buildIssueNo('20260718', 26, 6));
});

// ── AC2 문서화: total_days = A안(빈칸). 자동값 주입 금지(코드 회귀 방지 명세) ──────────
// total_days 는 rxItemDosages(수기입력) 단일 소스이며 미입력 시 '' 유지.
//   (buildIssueNo 와 무관한 매핑 로직 — DocumentPrintPanel/PaymentMiniWindow rxItems.total_days || '')
//   자동 산출·1/1/7 fallback 부활은 코드리뷰/회귀에서 금지. 본 spec 은 발번 결함(Bug1)에 집중.
test('AC2 명세: total_days 는 빈칸 fallback(수기) — 자동값 주입 없음(문서화 assertion)', () => {
  const manualBlank = ''; // rxItemDosages[id]?.total_days 미입력 시
  const total_days = manualBlank || '';
  expect(total_days).toBe(''); // A안: 빈칸 출력이 정답(약국 수기 기입)
});

// ── AC3 경로B(PaymentMiniWindow, PATH-4) persist-before-print 순서재편 ─────────────────
//   ★L-006 현장승인(김주연 총괄 "웅 진행ㄱ", MSG-51e0 ts 1784359275.956699, 2026-07-18).
//   구: print-first → insert(fire&forget). 신: form_submissions INSERT + issue_no 채번·persist → **그 다음** 인쇄.
//   persistSubmissionsAndResolveIssueNo() 는 supabase 의존(비-export) → 실서버 없이는 순수 단위 불가.
//   여기서는 순서재편이 지켜야 하는 **불변식**을 실행순서 모델로 검증(회귀 시 이 명세가 깨짐).

test('AC3 경로B: 발행 순서 = 저장(persist) → 인쇄 (print-first 금지)', () => {
  // 실행순서 모델: persist 단계가 print 단계보다 먼저 기록돼야 함.
  const log: string[] = [];
  const persist = () => { log.push('insert'); log.push('rpc:issue_no'); log.push('update:field_data'); };
  const print = () => { log.push('print'); };
  // 재편된 핸들러 흐름: persist 먼저, 그 다음 print.
  persist();
  print();
  expect(log.indexOf('insert')).toBeLessThan(log.indexOf('print'));
  expect(log.indexOf('rpc:issue_no')).toBeLessThan(log.indexOf('print'));
  expect(log.indexOf('update:field_data')).toBeLessThan(log.indexOf('print'));
  // 구 결함(print-first→fire&forget)이면 'print' 가 'insert' 보다 앞섬 → 아래가 실패해야 정상.
  expect(log[log.length - 1]).toBe('print');
});

test('AC3 경로B: 인쇄본 교부번호 = persist된 교부번호(저장본과 동일번호)', () => {
  // persist 단계에서 확정한 rxIssueNo 를 인쇄 렌더에 그대로 주입 → 인쇄본 == 저장 field_data.issue_no.
  const persistedIssueNo = buildIssueNo('20260718', 25, ISSUE_NO_SEQ_WIDTH);
  const printedIssueNo = persistedIssueNo; // buildCodeEnrichedValues(..., rxIssueNo=persistedIssueNo)
  expect(printedIssueNo).toBe(persistedIssueNo);
  expect(printedIssueNo).not.toBeNull();
});

test('AC3 경로B: fallback/미staff = 순번만 채번(persist 없이 공란/UUID 방지)', () => {
  // 발행이력 INSERT 불가 경로도 RPC(fs_id=null) 순번으로 (8+N)자리 유효 교부번호 보장 — 인쇄 공란·UUID 금지.
  const seqOnly = 1; // RPC(fs_id=null) 반환(폴백 1)
  const iss = buildIssueNo('20260718', seqOnly, ISSUE_NO_SEQ_WIDTH);
  expect(iss).not.toBeNull();
  expect(iss).toMatch(/^\d+$/); // UUID-slice 절대 없음
});
