/**
 * Unit spec — T-20260821-foot-PROGANALYSIS-EXTRACT-PHASE1
 *
 * 진료대시보드>경과분석 탭 — 현재 live 목록에 (1) 행별 인풋 .md 다운로드 + (2) 전체선택 ZIP 추가.
 *   추출·조립 로직 = TXMEMO-3VISIT-MD-ZIP 계보(6MULTIPLE-PROGRESS-MD-ZIP 스크립트) 그대로 이식(재가공 금지).
 *   ZIP = 무의존 STORE 조립(새 npm 미추가). read-only(db_change=false).
 *
 * 대상(순수 함수) — auth/page/server 미사용 → playwright.config 'unit' 프로젝트:
 *   src/lib/progressAnalysisMd.ts  : buildProgressAnalysisMd / progressAnalysisMdBasename
 *   src/lib/progressAnalysisZip.ts : createStoreZip
 *
 * AC(현장 시나리오 매핑):
 *   시나리오1(행별 .md): 5섹션 구조 + 헤더 6배수 예정일 + 확정 추출로직 동일 산출 → md 문자열 단언.
 *   시나리오2(전체선택 ZIP): 선택 전원 .md 를 zip 1개로 → zip 시그니처/엔트리 수 단언.
 *   시나리오3(엣지): 기록 없는 환자 = "기록 없음" 정직 표기 / 빈 선택 = zip 미생성(호출부 가드).
 *
 * 실기기 다운로드/토스트/현장 클릭 = supervisor 갤탭 field-soak(browser_verify).
 */
import { test, expect } from '@playwright/test';
import {
  buildProgressAnalysisMd,
  progressAnalysisMdBasename,
  type ProgressAnalysisEnvelope,
  type ProgressAnalysisPatient,
} from '../../src/lib/progressAnalysisMd';
import { createStoreZip } from '../../src/lib/progressAnalysisZip';

const CUST_ID = '11111111-2222-3333-4444-555555555555';

// 완전 채워진 envelope(치료메모·처방·과거력·첫날상담·임상텍스트 전부 보유).
function fullEnvelope(): ProgressAnalysisEnvelope {
  return {
    boilerSet: new Set(['정형 상용구 원문 그대로']),
    milestonesByCust: new Map([[CUST_ID, [{ anticipated: 6, used: 5, total: 12 }]]]),
    visitCountByCust: new Map([[CUST_ID, 5]]),
    nextResvByCust: new Map([
      [CUST_ID, { reservation_date: '2026-08-25', reservation_time: '14:30', registrar_name: '김코디' }],
    ]),
    memosByCust: new Map([
      [
        CUST_ID,
        [
          {
            content: '좌측 엄지 호전. 부기 감소.',
            created_at: '2026-08-01T10:00:00Z',
            created_by: null,
            created_by_name: '박치료',
          },
        ],
      ],
    ]),
    rxByCust: new Map([
      [
        CUST_ID,
        [
          {
            id: 'rx1',
            prescribed_at: '2026-08-01T10:00:00Z',
            prescribed_by_name: '문지은',
            diagnosis: '조갑감입',
            memo: null,
            created_at: '2026-08-01T10:00:00Z',
            items: [
              { medication_name: '세프디니르', dosage: '1일 3회', duration_days: 5, quantity: 15, memo: null },
            ],
          },
        ],
      ],
    ]),
    hqByCust: new Map([
      [
        CUST_ID,
        {
          form_data: { symptoms: ['통증', '부기'], foot_pain_level: '중등도', has_private_insurance: '예' },
          submitted_at: '2026-07-20T09:00:00Z',
          created_at: '2026-07-20T09:00:00Z',
        },
      ],
    ]),
    firstVisitByCust: new Map([[CUST_ID, '2026-07-20']]),
    consultByCust: new Map([
      [
        CUST_ID,
        [
          {
            content: '주소: 좌측 엄지 통증\n특이사항: 당뇨 없음',
            created_at: '2026-07-20T09:30:00Z',
            created_by_name: '이상담',
          },
        ],
      ],
    ]),
    chartByCust: new Map([
      [
        CUST_ID,
        [
          {
            visit_date: '2026-07-20',
            chief_complaint: '좌측 엄지 통증',
            diagnosis: '조갑감입증',
            treatment_record: null,
            clinical_progress: null,
            materials_used: null,
            treatment_result: null,
            created_by_name: '문지은',
            created_at: '2026-07-20T09:40:00Z',
          },
        ],
      ],
    ]),
  };
}

// 비어있는 envelope(기록 전무).
function emptyEnvelope(): ProgressAnalysisEnvelope {
  return {
    boilerSet: new Set(),
    milestonesByCust: new Map(),
    visitCountByCust: new Map(),
    nextResvByCust: new Map(),
    memosByCust: new Map(),
    rxByCust: new Map(),
    hqByCust: new Map(),
    firstVisitByCust: new Map(),
    consultByCust: new Map(),
    chartByCust: new Map(),
  };
}

const PATIENT: ProgressAnalysisPatient = { id: CUST_ID, name: '홍길동', chart_number: '404658' };

test.describe('T-20260821 PROGANALYSIS-EXTRACT-PHASE1 — 행별 .md (시나리오1)', () => {
  test('AC1-1: 5섹션 구조 + 행정/식별 헤더 존재', () => {
    const md = buildProgressAnalysisMd(PATIENT, fullEnvelope());
    expect(md).toContain('# 경과분석 자료 — 홍길동');
    expect(md).toContain('## 【행정】 환자 식별 정보');
    expect(md).toContain('- 성함: 홍길동');
    expect(md).toContain('- 차트번호: 404658');
    expect(md).toContain('# 【1】 치료메모');
    expect(md).toContain('# 【2】 처방내역');
    expect(md).toContain('# 【3】 과거력 (QR 셀프접수 입력)');
    expect(md).toContain('# 【4】 첫날 상담차트 (첫 방문일 초진 기록)');
    expect(md).toContain('# 【5】 임상 유의미 텍스트 (전체 경과 · 루틴상용구 제외)');
  });

  test('AC1-2: 헤더에 6배수 예정 회차·예약일 포함(★티켓 핵심 요구)', () => {
    const md = buildProgressAnalysisMd(PATIENT, fullEnvelope());
    expect(md).toContain('### 6배수 예정 회차 · 예약일');
    expect(md).toContain('6회 경과분석 (현재 5/12회 진행 → 다음 내방 6회차)');
    expect(md).toContain('- 다음 예약일: 2026-08-25 14:30 · 담당 김코디');
  });

  test('AC1-3: 확정 추출로직 그대로 — 치료메모/처방/과거력 원문 반영(재가공 없음)', () => {
    const md = buildProgressAnalysisMd(PATIENT, fullEnvelope());
    expect(md).toContain('좌측 엄지 호전. 부기 감소.');
    expect(md).toContain('| 세프디니르 | 1일 3회 | 5 | 15 |');
    expect(md).toContain('- 주요 증상: 통증, 부기');
    expect(md).toContain('- 실손보험 가입: 예');
  });

  test('AC1-4: 섹션5 임상 유의미 텍스트 발췌 — 라벨값 include', () => {
    const md = buildProgressAnalysisMd(PATIENT, fullEnvelope());
    expect(md).toContain('### 상담메모 발췌 (전 방문)');
    expect(md).toContain('- 특이사항: 당뇨 없음');
    expect(md).toContain('### 진료차트 발췌 (전 방문, 의사 임상필드)');
  });

  test('AC1-5: 루틴상용구(boilerSet 전체일치)는 제외 표기', () => {
    const env = fullEnvelope();
    env.consultByCust.set(CUST_ID, [
      { content: '정형 상용구 원문 그대로', created_at: '2026-08-02T09:00:00Z', created_by_name: '이상담' },
    ]);
    const md = buildProgressAnalysisMd(PATIENT, env);
    expect(md).toContain('_(루틴상용구 원문 그대로 — 유의미 텍스트 없음)_');
  });
});

test.describe('T-20260821 PROGANALYSIS-EXTRACT-PHASE1 — 파일명', () => {
  test('AC-F1: 파일명 = {차트번호}_{이름}', () => {
    expect(progressAnalysisMdBasename(PATIENT)).toBe('404658_홍길동');
  });

  test('AC-F2: 차트번호 없으면 id-앞8자리 폴백', () => {
    expect(progressAnalysisMdBasename({ id: CUST_ID, name: '무명', chart_number: null })).toBe(
      `id-${CUST_ID.slice(0, 8)}_무명`,
    );
  });
});

test.describe('T-20260821 PROGANALYSIS-EXTRACT-PHASE1 — 전체선택 ZIP (시나리오2)', () => {
  test('AC2-1: 여러 .md → zip 1개(PK 시그니처 + EOCD entry 수 일치)', async () => {
    const entries = [
      { name: '404658_홍길동.md', content: buildProgressAnalysisMd(PATIENT, fullEnvelope()) },
      { name: '404659_김철수.md', content: '# 경과분석 자료 — 김철수\n내용' },
      { name: '404660_이영희.md', content: '# 경과분석 자료 — 이영희\n내용' },
    ];
    const blob = createStoreZip(entries);
    expect(blob.type).toBe('application/zip');
    const buf = new Uint8Array(await blob.arrayBuffer());
    // Local file header 시그니처 PK\x03\x04
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
    // End of central directory record(마지막 22바이트) 시그니처 PK\x05\x06 + total entries == 3
    const dv = new DataView(buf.buffer);
    const eocd = buf.length - 22;
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
    expect(dv.getUint16(eocd + 10, true)).toBe(3); // total entries
  });

  test('AC2-2: STORE 무압축 — 파일 내용(UTF-8 BOM 포함)이 zip 바이트에 원문 보존', async () => {
    const entries = [{ name: 't.md', content: '경과분석 원문 ABC' }];
    const blob = createStoreZip(entries);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder().decode(buf);
    expect(text).toContain('경과분석 원문 ABC'); // STORE(무압축)이므로 평문 검출
  });
});

test.describe('T-20260821 PROGANALYSIS-EXTRACT-PHASE1 — 엣지(시나리오3)', () => {
  test('AC3-1: 기록 전무 환자 = 각 섹션 "기록 없음" 정직 표기(조용한 누락 금지)', () => {
    const md = buildProgressAnalysisMd(PATIENT, emptyEnvelope());
    expect(md).toContain('# 【1】 치료메모');
    expect(md).toMatch(/# 【1】 치료메모\n\n_기록 없음_/);
    expect(md).toContain('_기록 없음_  (처방 테이블·차트/접수 처방필드 전부 미기재)');
    expect(md).toContain('_상담메모 없음_');
    expect(md).toContain('_진료차트(디지털) 기록 없음_');
    expect(md).toContain('- 도래 회차(예정): (회차 정보 없음)');
    expect(md).toContain('- 다음 예약일: (다음 예약 없음)');
  });

  test('AC3-2: 빈 선택 → zip 엔트리 0개(호출부는 안내 후 미생성; 라이브러리는 방어적으로 유효 zip 반환)', async () => {
    const blob = createStoreZip([]);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(buf.buffer);
    expect(dv.getUint32(0, true)).toBe(0x06054b50); // 엔트리 0 → 곧바로 EOCD
    expect(dv.getUint16(10, true)).toBe(0);
  });
});
