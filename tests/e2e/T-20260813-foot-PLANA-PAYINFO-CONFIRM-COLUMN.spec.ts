import { test, expect } from '@playwright/test';
import {
  PAYINFO_INACTIVE_MESSAGE,
  isPayInfoAvailable,
  maskCardNo,
  fmtTranDate,
  fmtTranTime,
  fmtTranType,
  fmtHalbu,
  projectRawResponse,
} from '../../src/lib/cband/payInfoView';
import { normalize, safeParse } from '../../src/lib/cband/protocol';

/**
 * T-20260813-foot-PLANA-PAYINFO-CONFIRM-COLUMN — 일마감 결제내역 [결제정보 확인] 컬럼/모달
 *   결정론 검증(순수 로직). 활성/비활성 분기 + 상세 11항목 표시 + PII 마스킹(카드번호·QR 구조적 차단).
 * ────────────────────────────────────────────────────────────────────────────
 * 모달 실 조회(supabase·auth·seed 의존)는 물리 환경 필요 → 본 스펙은 표시/판별/마스킹 순수 로직을
 *   실측 응답전문(T-20260804 REAL_APPROVAL/REAL_CANCEL shape)으로 고정한다.
 *   raw_response = toPersistableRaw(normalize(응답)) = NormalizedResponse − raw(원본 payload 제외).
 *
 * 현장 클릭 시나리오(티켓) → 순수 로직 대응:
 *   시나리오 1: 플랜A 결제행 상세 확인 → isPayInfoAvailable(활성) + 11항목 포매팅 + 카드/QR 마스킹.
 *   시나리오 2: 비활성 행(현금/이체/기존) → isPayInfoAvailable(비활성) + 안내 문구.
 */

// ── 실측 정본 응답전문(T-20260804-PAYRESP-RECORD-PERSIST-VERIFY 계승) ─
//   CARDNO 는 단말이 이미 마스킹해 반환(평문 PAN 아님). TRANSERIAL = 거래고유번호 12자리.
const REAL_APPROVAL =
  '{"ERRCODE":"0000","TRANTYPE":"0210","CARDNO":"55318440****364*  ","HALBU":"03",' +
  '"TAMT":"000003000","TRANDATE":"260804","TRANTIME":"110347","AUTHNO":"29258831    ",' +
  '"MERNO":"00113742229    ","TRANSERIAL":"110341558080",' +
  '"ISSUECARD":"하나기업","PURCHASECARD":"하나카드","MSG1":"거래 승인29258831"}';
const REAL_CANCEL =
  '{"ERRCODE":"0000","TRANTYPE":"0430","CARDNO":"55318440****364*  ","HALBU":"03",' +
  '"TAMT":"000003000","TRANDATE":"260804","TRANTIME":"111230","AUTHNO":"29258831    ",' +
  '"MERNO":"00113742229    ","TRANSERIAL":"111225558081","MSG1":"취소거래승인29258831"}';

// toPersistableRaw 는 normalize() 결과에서 `raw`(원본 payload)만 제외 → 표시에 쓰는 raw_response 재현.
function persistedRaw(wire: string): Record<string, unknown> {
  const { raw: _omit, ...safe } = normalize(safeParse(wire));
  return safe as Record<string, unknown>;
}

test.describe('시나리오 1: 플랜A 결제행 상세 확인 (정상 동선)', () => {
  test('활성 판별 — payment_attempt_id ∧ external_approval_no 존재 시 활성', () => {
    expect(isPayInfoAvailable({ payment_attempt_id: 'att-1', external_approval_no: '29258831' })).toBe(true);
  });

  test('상세 모달 11항목 — 승인건 포매팅(거래구분·일시·할부·응답코드)', () => {
    const raw = persistedRaw(REAL_APPROVAL);
    const view = projectRawResponse(raw);
    const n = normalize(safeParse(REAL_APPROVAL));

    // ①거래구분 0210=승인
    expect(fmtTranType(n.tranType)).toBe('승인 (0210)');
    // ②승인번호(AUTHNO, trailing space trim)
    expect(n.authNo).toBe('29258831');
    // ③거래일자·거래시각
    expect(fmtTranDate(view.tranDate)).toBe('2026-08-04');
    expect(fmtTranTime(view.tranTime)).toBe('11:03:47');
    // ④승인금액(TAMT 파싱)
    expect(view.amount).toBe(3000);
    // ⑤할부(HALBU '03' → 3개월)
    expect(fmtHalbu(view.halbu)).toBe('3개월');
    // ⑧단말기 TID / ⑨가맹점 MERNO / ⑪응답코드 — attempt 컬럼/정규화 값
    expect(n.merno).toBe('00113742229');
    expect(n.responseCode).toBe('0000');
    // ⑩거래고유번호 TRANSERIAL(msg_trace 12자리) — 반드시 포함(단말 승인내역조회 유일 키)
    expect(n.msgTrace).toBe('110341558080');
    expect(n.msgTrace).toMatch(/^\d{12}$/);
  });

  test('PII HARD — 카드번호 마스킹(평문 PAN 노출 0)', () => {
    const view = projectRawResponse(persistedRaw(REAL_APPROVAL));
    const masked = maskCardNo(view.cardNoMasked);
    // 단말 verbatim 마스킹 값 유지(별표 포함), 평문 16연속숫자 아님.
    expect(masked).toBe('55318440****364*');
    expect(masked).toContain('*');
    expect(masked).not.toMatch(/\b\d{13,19}\b/);
  });

  test('PII HARD — 평문 PAN 유입 시 강제 마스킹(방어)', () => {
    // 마스킹 마커 없는 평문 PAN-유사(16자리 합성 시퀀스) → first6/last4 만 남기고 중간 마스킹.
    expect(maskCardNo('1234567890123456')).toBe('123456******3456');
    expect(maskCardNo('1234567890123456')).not.toContain('7890123'); // 중간 원문 미노출
  });

  test('PII HARD — QR_DATA_256 등 비화이트리스트 필드는 구조적으로 미노출', () => {
    // raw_response 에 QR/track/PAN 이 섞여 와도 projectRawResponse 는 화이트리스트만 반환.
    //   (오염 값은 합성 센티넬 — 실 PII 아님. 테스트 요지는 '키 자체가 반환되지 않음'.)
    const contaminated = {
      tranDate: '260804', tranTime: '110347', amount: 3000, halbu: '00',
      cardNoMasked: '55318440****364*', cardName: '하나기업',
      QR_DATA_256: 'QR-SENTINEL-256', SET_QR_DATA_256: 'QR-SENTINEL-256', track2: 'TRACK-SENTINEL', full_pan: 'PAN-SENTINEL',
    } as Record<string, unknown>;
    const view = projectRawResponse(contaminated) as unknown as Record<string, unknown>;
    expect(Object.keys(view).sort()).toEqual(
      ['amount', 'cardName', 'cardNoMasked', 'halbu', 'tranDate', 'tranTime'].sort(),
    );
    expect(view).not.toHaveProperty('QR_DATA_256');
    expect(view).not.toHaveProperty('SET_QR_DATA_256');
    expect(view).not.toHaveProperty('track2');
    expect(view).not.toHaveProperty('full_pan');
  });

  test('취소건(0430) 거래구분 표시', () => {
    const n = normalize(safeParse(REAL_CANCEL));
    expect(fmtTranType(n.tranType)).toBe('취소 (0430)');
    expect(n.msgTrace).toBe('111225558081');
  });
});

test.describe('시나리오 2: 비활성 행 (엣지)', () => {
  test('비활성 판별 — payment_attempt_id 부재(현금/이체/기존 결제)', () => {
    expect(isPayInfoAvailable({ payment_attempt_id: null, external_approval_no: null })).toBe(false);
    expect(isPayInfoAvailable({ payment_attempt_id: 'att-1', external_approval_no: null })).toBe(false);
    expect(isPayInfoAvailable({ payment_attempt_id: 'att-1', external_approval_no: '   ' })).toBe(false);
    expect(isPayInfoAvailable({ payment_attempt_id: null, external_approval_no: '29258831' })).toBe(false);
  });

  test('안내 문구 — 회색 only 금지(현장 명시 문구 일치)', () => {
    expect(PAYINFO_INACTIVE_MESSAGE).toBe('CRM 결제로 진행한 건만 확인할 수 있습니다');
  });
});

test.describe('포매터 엣지', () => {
  test('일시불/빈값/비정상 입력 방어', () => {
    expect(fmtHalbu('00')).toBe('일시불');
    expect(fmtHalbu('01')).toBe('일시불');
    expect(fmtHalbu(null)).toBe('—');
    expect(fmtTranDate(null)).toBe('—');
    expect(fmtTranTime('')).toBe('—');
    expect(fmtTranType(null)).toBe('—');
    expect(maskCardNo(null)).toBeNull();
    expect(maskCardNo('')).toBeNull();
  });
});
