/**
 * T-20260702-foot-PROGRESS-CSV-BULKRESULT — 결과이미지 일괄업로드 → 환자 자동매칭 (pure-logic E2E)
 *
 * 검증 대상 = DA 자동매칭 계약(DA-20260718-foot-PROGRESS-BULKRESULT-AUTOMATCH)의 결정론적 핵심
 *   (오염 시 임상 결과지가 엉뚱한 환자에 붙는 실질 리스크):
 *   1. 파일명 strict 파싱(§3-1, G4 fuzzy 금지) — 토큰수/날짜/빈값 → PARSE-FAIL.
 *   2. chart_no 정규화(OPEN ITEM ②) · 이름 대조 정규화(G2 발음병기·공백 strip).
 *   3. resolveMatch fail-closed 결정 트리(§3) — auto/flagged/name_mismatch/no_match/parse_fail 5분기.
 *      G1 chart_no 단독조인 · G2 이름불일치 차단 · G3 미존재 자동생성 금지(=수동) · chart_no 충돌→수동.
 *   4. sha256 content-hash 결정성(§4 dedup 멱등키 요소).
 *
 * 왜 pure-logic: 파싱·매칭·해시가 오첨부의 실질 리스크. 업로드/insert/미리보기 UI(G5 사람게이트)는
 *   컴포넌트 통합(수동 QA + 실기기 confirm)로 확인. 본 spec 은 매칭 판정 정확성을 못박는다.
 */
import { test, expect } from '@playwright/test';
import {
  parseResultFilename,
  normalizeChartNo,
  normalizeNameForCompare,
  normalizeVisitDate,
  resolveMatch,
  sha256Hex,
  type CustomerLite,
} from '../../src/lib/progressResultMatch';

test.describe('BULKRESULT · 파일명 strict 파싱 (G4 fuzzy 금지)', () => {
  test('정상 이름_차트번호_날짜(YYYYMMDD) 파싱', () => {
    const p = parseResultFilename('홍길동_12345_20260702.png');
    expect(p.ok).toBe(true);
    expect(p.patientName).toBe('홍길동');
    expect(p.chartNoRaw).toBe('12345');
    expect(p.chartNo).toBe('12345');
    expect(p.visitDate).toBe('2026-07-02');
  });

  test('YYYY-MM-DD 날짜 토큰도 허용', () => {
    const p = parseResultFilename('김철수_A100_2026-01-05.jpg');
    expect(p.ok).toBe(true);
    expect(p.visitDate).toBe('2026-01-05');
  });

  test('토큰 수 불일치(언더스코어 과다/부족) → PARSE-FAIL', () => {
    expect(parseResultFilename('홍길동.png').ok).toBe(false);            // 토큰 1
    expect(parseResultFilename('홍길동_12345.png').ok).toBe(false);      // 토큰 2
    expect(parseResultFilename('홍_길동_12345_20260702.png').ok).toBe(false); // 토큰 4
  });

  test('날짜 미파싱 → PARSE-FAIL (fuzzy 추측 없음)', () => {
    expect(parseResultFilename('홍길동_12345_2026.png').ok).toBe(false);
    expect(parseResultFilename('홍길동_12345_notadate.png').ok).toBe(false);
    expect(parseResultFilename('홍길동_12345_20261302.png').ok).toBe(false); // 13월 배제
    expect(parseResultFilename('홍길동_12345_20260231.png').ok).toBe(false); // 2/31 배제
  });

  test('빈 이름/차트번호 토큰 → PARSE-FAIL', () => {
    expect(parseResultFilename('_12345_20260702.png').ok).toBe(false);
    expect(parseResultFilename('홍길동__20260702.png').ok).toBe(false);
  });

  test('허용 확장자 아님 → PARSE-FAIL', () => {
    expect(parseResultFilename('홍길동_12345_20260702.pdf').ok).toBe(false);
    expect(parseResultFilename('홍길동_12345_20260702').ok).toBe(false); // 확장자 없음
  });
});

test.describe('BULKRESULT · 정규화 규칙', () => {
  test('normalizeVisitDate — 8자리/대시/무효', () => {
    expect(normalizeVisitDate('20260702')).toBe('2026-07-02');
    expect(normalizeVisitDate('2026-07-02')).toBe('2026-07-02');
    expect(normalizeVisitDate('2026/07/02')).toBeNull();
    expect(normalizeVisitDate('')).toBeNull();
    expect(normalizeVisitDate(null)).toBeNull();
  });

  test('normalizeChartNo — 공백/전각 정규화, 선행0 보존(무손실)', () => {
    expect(normalizeChartNo(' 12345 ')).toBe('12345');
    expect(normalizeChartNo('1 2 3')).toBe('123');
    expect(normalizeChartNo('００１')).toBe('001');   // 전각→반각, 선행0 보존
    expect(normalizeChartNo('00123')).toBe('00123');  // 선행0 보존(exact 대조 원칙)
  });

  test('normalizeNameForCompare — G2 발음병기·공백 strip (조인키 아님)', () => {
    expect(normalizeNameForCompare('홍길동')).toBe('홍길동');
    expect(normalizeNameForCompare('홍길동 (홍 길 동)')).toBe('홍길동');
    expect(normalizeNameForCompare('홍 길 동')).toBe('홍길동');
    expect(normalizeNameForCompare('홍길동（Hong）')).toBe('홍길동');
    // 관대 비교: 표기편차 흡수하되 서로 다른 이름은 여전히 구분.
    expect(normalizeNameForCompare('김철수')).not.toBe(normalizeNameForCompare('김영수'));
  });
});

test.describe('BULKRESULT · resolveMatch fail-closed 결정 트리 (§3)', () => {
  const cust = (id: string, name: string, chart: string): CustomerLite => ({ id, name, chart_number: chart });
  const byChart = (list: CustomerLite[]): Map<string, CustomerLite[]> => {
    const m = new Map<string, CustomerLite[]>();
    for (const c of list) {
      const k = normalizeChartNo(c.chart_number);
      const arr = m.get(k) ?? [];
      arr.push(c);
      m.set(k, arr);
    }
    return m;
  };

  test('auto — chart_no 일치 + 이름 일치 + 해당일 방문 존재', () => {
    const parsed = parseResultFilename('홍길동_12345_20260702.png');
    const res = resolveMatch({
      parsed,
      customersByChartNo: byChart([cust('u1', '홍길동', '12345')]),
      visitsByCustomer: new Map([['u1', new Set(['2026-07-02'])]]),
    });
    expect(res.status).toBe('auto');
    expect(res.customer?.id).toBe('u1');
  });

  test('flagged — chart_no·이름 일치하나 해당일 방문기록 없음(soft-flag §3-4, 첨부 허용)', () => {
    const parsed = parseResultFilename('홍길동_12345_20260702.png');
    const res = resolveMatch({
      parsed,
      customersByChartNo: byChart([cust('u1', '홍길동', '12345')]),
      visitsByCustomer: new Map(), // 방문 없음
    });
    expect(res.status).toBe('flagged');
    expect(res.customer?.id).toBe('u1'); // 환자는 확정 — 첨부는 허용
  });

  test('name_mismatch — chart_no 존재하나 이름 불일치 → 자동첨부 차단(G2)', () => {
    const parsed = parseResultFilename('홍길동_12345_20260702.png');
    const res = resolveMatch({
      parsed,
      customersByChartNo: byChart([cust('u1', '김철수', '12345')]), // 이름 다름
      visitsByCustomer: new Map([['u1', new Set(['2026-07-02'])]]),
    });
    expect(res.status).toBe('name_mismatch'); // 방문 있어도 이름 가드가 우선 차단
  });

  test('no_match — chart_no 미존재 → 수동 UI, 환자 자동생성 금지(G3)', () => {
    const parsed = parseResultFilename('홍길동_99999_20260702.png');
    const res = resolveMatch({
      parsed,
      customersByChartNo: byChart([cust('u1', '홍길동', '12345')]),
      visitsByCustomer: new Map(),
    });
    expect(res.status).toBe('no_match');
    expect(res.customer).toBeNull(); // 생성하지 않음
  });

  test('chart_no 정규화 충돌(다건 후보) → name_mismatch(수동 확인, 자동 아님)', () => {
    const parsed = parseResultFilename('홍길동_12345_20260702.png');
    const res = resolveMatch({
      parsed,
      customersByChartNo: byChart([cust('u1', '홍길동', '12345'), cust('u2', '홍길동', '12345')]),
      visitsByCustomer: new Map([['u1', new Set(['2026-07-02'])]]),
    });
    expect(res.status).toBe('name_mismatch'); // 결정 불가 → 안전 폴백
    expect(res.customer).toBeNull();
  });

  test('parse_fail — 파싱 실패 파일 → parse_fail(수동 UI)', () => {
    const parsed = parseResultFilename('홍길동.png');
    const res = resolveMatch({ parsed, customersByChartNo: new Map(), visitsByCustomer: new Map() });
    expect(res.status).toBe('parse_fail');
    expect(res.customer).toBeNull();
  });

  test('발음병기 이름도 G2 통과(홍길동 vs 홍길동(Hong)) → auto', () => {
    const parsed = parseResultFilename('홍길동_12345_20260702.png');
    const res = resolveMatch({
      parsed,
      customersByChartNo: byChart([cust('u1', '홍길동(Hong)', '12345')]),
      visitsByCustomer: new Map([['u1', new Set(['2026-07-02'])]]),
    });
    expect(res.status).toBe('auto');
  });
});

test.describe('BULKRESULT · sha256 content-hash 결정성 (§4 dedup)', () => {
  const buf = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer;

  test('동일 내용 → 동일 hash(멱등), 다른 내용 → 다른 hash', async () => {
    const h1 = await sha256Hex(buf('IMAGE-BYTES-A'));
    const h2 = await sha256Hex(buf('IMAGE-BYTES-A'));
    const h3 = await sha256Hex(buf('IMAGE-BYTES-B'));
    expect(h1).toBe(h2);      // 동일파일 재업 = no-op 근거
    expect(h1).not.toBe(h3);  // 다른 N장 = 정상 1:N 근거
    expect(h1).toMatch(/^[0-9a-f]{64}$/); // sha256 hex 64자
  });

  test('알려진 벡터 — 빈 입력 sha256', async () => {
    expect(await sha256Hex(buf(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
