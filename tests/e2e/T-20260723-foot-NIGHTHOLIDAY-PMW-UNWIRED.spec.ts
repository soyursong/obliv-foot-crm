/**
 * E2E Spec — T-20260723-foot-NIGHTHOLIDAY-PMW-UNWIRED  (+ DOCCONFIRM 결함③ 연번호)
 *
 * [P1] 단일 PMW pass — 수납창(PaymentMiniWindow) 출력경로의 평행경로 divergence 2건 배선.
 *      현장 보고: 이은상 팀장(풋센터), 2026-07-23. L-006(DOC-PRINT-UNIFY) human-approval CLOSED(MSG-uvuh).
 *
 * 근본원인(공통): 수납창(PMW) 출력경로가 DocumentPrintPanel(DPP)이 가진 값-빌드 스텝을
 *   체계적으로 누락 → 발번(연번호)·야간/공휴일 가산이 이 창 발급분에서 공란(반복원인 #2, 평행경로).
 *
 * 수정 A (NIGHTHOLIDAY): applyNightHolidaySurcharge(SSOT 헬퍼)를 PMW 출력·수납 양경로에 DPP 동형 호출.
 *   판정기준 refDate = 진료일(checked_in_at) — body canon 미러(과거일 출력 정확).
 * 수정 ③ (DOCCONFIRM 연번호): issue_foot_doc_serial RPC + buildDocSerial 조립 → field_data.visit_no 배선.
 *   발번 실패 시 가짜 번호 미기록(공란 유지) = 발번대장 무결성.
 *
 * ★L-006 금지조항 준수: DPP가 쓰는 SSOT 헬퍼(applyNightHolidaySurcharge / buildDocSerial) 재사용 —
 *   surcharge·serial 로직 독립 복제 금지. PMW 재발급 모달(:3705)은 DPP 재사용 = 무접촉.
 *
 * NOTE: PaymentMiniWindow.tsx 는 대형 컴포넌트(렌더 E2E 부적) → DPP 대칭성·SSOT 재사용을
 *   소스레벨 정적검증으로 확인(기존 DOCCONFIRM-SERIAL spec 의 DocumentPrintPanel 검증과 동일 패턴).
 *   가산 순수함수(detectSurchargeKind/applyNightHolidaySurcharge)의 금액·마크 결정론은
 *   T-20260717-foot-DOCPRINT-NIGHTHOLIDAY-SURCHARGE-AUTOCALC.spec.ts 가 커버(중복 회피).
 *
 * 실행: npx playwright test --project=unit T-20260723-foot-NIGHTHOLIDAY-PMW-UNWIRED.spec.ts
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PMW_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/components/PaymentMiniWindow.tsx'),
  'utf-8',
);

// PMW 출력경로 함수 본문 추출 헬퍼 (const NAME = ... 또는 async 핸들러)
function occurrences(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

test.describe('수정-A 야간(공휴일) 배선 — PMW 출력·수납 양경로 (평행경로 divergence 해소)', () => {
  test('SSOT 헬퍼 applyNightHolidaySurcharge / resolveSurchargeRefDate import (복제 아님)', () => {
    expect(PMW_SRC, 'applyNightHolidaySurcharge SSOT import 누락').toContain(
      "from '@/lib/nightHolidaySurcharge'",
    );
    expect(PMW_SRC).toContain('applyNightHolidaySurcharge');
    expect(PMW_SRC).toContain('resolveSurchargeRefDate');
  });

  test('양경로(출력 handleDocPrint + 출력및수납 handleDocAndSettle) 모두 가산 호출 — 대칭', () => {
    // 호출 사이트 2곳(import/주석 제외 실제 호출) — buildPages / buildPages2 각각
    const callSites = occurrences(PMW_SRC, 'applyNightHolidaySurcharge(enriched');
    expect(callSites, '가산 호출이 양경로 대칭이 아님(한쪽 누락=재오픈)').toBeGreaterThanOrEqual(2);
  });

  test('가산 판정기준 refDate = 진료일(checked_in_at) — 과거일 출력 정확(now 폴백)', () => {
    const refCalls = occurrences(PMW_SRC, 'resolveSurchargeRefDate(checkIn.checked_in_at');
    expect(refCalls, 'checked_in_at 기준 판정이 양경로에 없음').toBeGreaterThanOrEqual(2);
  });

  test('달력 빨간날(clinic_events holiday) 로더 배선 — 임시/대체공휴일 합집합', () => {
    expect(PMW_SRC).toContain("event_type', 'holiday'");
    expect(PMW_SRC).toContain('holidayDateSet');
  });

  test('★재발급 모달은 DocumentPrintPanel 재사용 = 무접촉 (이중표기 방지)', () => {
    expect(PMW_SRC, '재발급 모달이 DPP 위임을 유지해야 함').toContain('<DocumentPrintPanel');
  });
});

test.describe('결함③ 연번호(visit_no) 발번 배선 — PMW 발번 미배선 divergence 해소', () => {
  test('SSOT buildDocSerial / docSerialPrefix import (docSerial 로직 복제 아님)', () => {
    expect(PMW_SRC).toContain('buildDocSerial');
    expect(PMW_SRC).toContain('docSerialPrefix');
  });

  test('발번 RPC issue_foot_doc_serial 호출 배선 (DPP handleBatchPrint 동형)', () => {
    expect(PMW_SRC).toContain("supabase.rpc('issue_foot_doc_serial'");
  });

  test('★발번대장 무결성: RPC/조립 실패 시 가짜 번호 미기록(visit_no 공란 유지)', () => {
    // 실패 분기가 continue 로 공란 유지 — 가짜 순번 fabrication 금지
    expect(PMW_SRC).toMatch(/rpcErr \|\| typeof seq !== 'number'\)\s*continue/);
  });

  test('persist 함수 반환 = { rxIssueNo, visitNoByTemplateId } per-template 맵', () => {
    expect(PMW_SRC).toContain('visitNoByTemplateId');
    expect(PMW_SRC).toMatch(/rxIssueNo:\s*[^,]+,\s*visitNoByTemplateId/);
  });

  test('인쇄 경로가 form_key별 발번 visit_no 를 enriched 에 주입 (저장본=인쇄본 동일번호)', () => {
    // 양경로에서 visitNoByTemplateId.get(t.id) → enriched.visit_no 주입
    const injects = occurrences(PMW_SRC, 'visitNoByTemplateId.get(t.id)');
    expect(injects, 'visit_no 주입이 양경로에 없음').toBeGreaterThanOrEqual(2);
  });

  test('처방전 행 clobber 방지: visit_no + issue_no 단일 update 누적', () => {
    // rx_standard 는 2)에서 update 생략 후 4)에서 issue_no 와 함께 병합(이중 update 상호 덮어쓰기 방지)
    expect(PMW_SRC).toContain('rxVisitNo');
    expect(PMW_SRC).toMatch(/form_key === 'rx_standard'\)\s*continue/);
  });
});
