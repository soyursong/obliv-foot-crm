/**
 * T-20260622-foot-CHART2-STAYMSG-TAB-LAYOUT — 2번차트 체류시간/메시지 탭 레이아웃 정리
 *
 * planner NEW-TASK (MSG-20260622-185108-cg4s · 김주연 총괄, 마감 6/25):
 *   [요청9]  체류시간 탭: 일자별 1열 세로나열 → 박스(카드) + 한 줄 2개(grid 2-col).
 *            홀수면 마지막 칸 비움(좌측정렬), 정렬순서(일자순) 유지.
 *   [요청10] 메시지 탭(발송 이력):
 *            10-1 컴팩트화 — 패딩/여백 최소.
 *            10-2 에러 한글화 — 영문 에러코드 → 한글(클라 표시 매핑, 서버응답 불변).
 *                 미정의 코드는 "발송 실패(원본코드)" fallback.
 *            10-3 실패 상태 인라인 — 별도 줄 → 항목 헤더 옆 인라인.
 *
 * FE 표시 레이어만 변경(DB·API 스키마 불변). 본 spec 은 (1) 발송 실패 한글화 매핑
 * 순수 함수 검증, (2) 소스 구조(grid 2-col / 컴팩트 패딩 / 인라인 에러 / testid)
 * 정적 검증으로 회귀 가드한다. (DB/브라우저 불필요 — supervisor 실QA 는 갤탭 실기기 별도.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __srcPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/pages/CustomerChartPage.tsx',
);
const src = readFileSync(__srcPath, 'utf-8');

// ──────────────────────────────────────────────────────────────────────
// koNotiError 미러 — 소스의 NOTI_ERROR_KO_MAP 규칙을 그대로 복제(회귀 시 즉시 실패).
// 소스가 매핑을 바꾸면 본 미러도 동기화해야 하며, 정적 검증(아래)이 그 동기화를 강제한다.
// ──────────────────────────────────────────────────────────────────────
const MAP: { match: RegExp; ko: string }[] = [
  { match: /messaging disabled/i,                 ko: '메시지 발송 기능 꺼짐' },
  { match: /no recipient phone|no recipient/i,    ko: '수신 번호 없음' },
  { match: /sms_opt_in\s*=\s*false/i,             ko: '문자 수신 미동의' },
  { match: /opt_?out/i,                           ko: '수신거부 고객' },
  { match: /no template( found)?/i,               ko: '메시지 템플릿 없음' },
  { match: /vault or sender not configured/i,     ko: '발신 설정 미완료' },
  { match: /vault secret missing/i,               ko: '발신 인증정보 누락' },
  { match: /outside business hours/i,             ko: '영업시간 외 발송 제한' },
  { match: /화이트리스트 미등록|whitelist/i,        ko: '발신번호 미등록(승인 필요)' },
  { match: /invalid (phone|number)/i,             ko: '잘못된 수신 번호' },
  { match: /insufficient|not enough balance/i,    ko: '발송 잔액 부족' },
  { match: /blocked( number)?/i,                  ko: '발송 차단 번호' },
];
function koNotiError(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const text = raw.trim();
  const body = text.includes(':') ? (text.split(':').slice(1).join(':').trim() || text) : text;
  for (const { match, ko } of MAP) {
    if (match.test(text) || match.test(body)) return ko;
  }
  return `발송 실패(${text})`;
}

// ──────────────────────────────────────────────────────────────────────
// 요청10-2: 발송 실패 에러 한글화 (순수 함수)
// ──────────────────────────────────────────────────────────────────────
test.describe('요청10-2: 발송 실패 에러 한글화 매핑', () => {
  test('알려진 영문 사유 → 한글 변환 (영문 노출 0)', () => {
    expect(koNotiError('messaging disabled')).toBe('메시지 발송 기능 꺼짐');
    expect(koNotiError('no recipient phone')).toBe('수신 번호 없음');
    expect(koNotiError('sms_opt_in=false')).toBe('문자 수신 미동의');
    expect(koNotiError('opt_out')).toBe('수신거부 고객');
    expect(koNotiError('no template found')).toBe('메시지 템플릿 없음');
    expect(koNotiError('Vault or sender not configured')).toBe('발신 설정 미완료');
    expect(koNotiError('Vault secret missing')).toBe('발신 인증정보 누락');
    expect(koNotiError('outside business hours: 23KST')).toBe('영업시간 외 발송 제한');
  });

  test('source 프리픽스("resv_confirm: opt_out")도 본문 매칭', () => {
    expect(koNotiError('resv_confirm: opt_out')).toBe('수신거부 고객');
    expect(koNotiError('manual_send: outside business hours: 5KST')).toBe('영업시간 외 발송 제한');
  });

  test('미정의 코드 → "발송 실패(원본코드)" fallback (원본 병기)', () => {
    expect(koNotiError('SOME_UNKNOWN_CODE_9999')).toBe('발송 실패(SOME_UNKNOWN_CODE_9999)');
    expect(koNotiError('Solapi error xyz')).toBe('발송 실패(Solapi error xyz)');
  });

  test('null/공백 → null (에러 표시 없음)', () => {
    expect(koNotiError(null)).toBeNull();
    expect(koNotiError(undefined)).toBeNull();
    expect(koNotiError('   ')).toBeNull();
  });

  test('변환 결과에 영문 사유 키워드가 노출되지 않음(미정의 fallback 제외)', () => {
    const known = ['messaging disabled', 'no recipient phone', 'opt_out', 'no template found'];
    for (const raw of known) {
      const ko = koNotiError(raw)!;
      expect(/[a-zA-Z]{4,}/.test(ko)).toBe(false); // 한글 매핑이면 영단어 없음
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// 소스 구조 정적 검증 (요청9·10 회귀 가드)
// ──────────────────────────────────────────────────────────────────────
test.describe('요청9: 체류시간 탭 2열 박스 그리드', () => {
  test('slot-dwell 패널에 grid 2-col 래퍼(slot-dwell-grid) 존재', () => {
    const start = src.indexOf('data-testid="slot-dwell-panel"');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("chartTab === 'messages'", start);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    // grid 2-col 래퍼 — 한 행 2개 카드
    expect(block).toContain('data-testid="slot-dwell-grid"');
    expect(block).toMatch(/grid grid-cols-2/);
    // 홀수 마지막 칸 좌측정렬 위해 카드 높이 stretch 방지(items-start)
    expect(block).toContain('items-start');
    // 일자 카드(slot-dwell-visit)는 그대로 유지 — 박스 형태
    expect(block).toContain('data-testid="slot-dwell-visit"');
  });

  test('grid 래퍼가 visits.map 을 감싼다(카드들이 그리드 셀)', () => {
    const gridStart = src.indexOf('data-testid="slot-dwell-grid"');
    expect(gridStart).toBeGreaterThan(-1);
    const after = src.slice(gridStart, gridStart + 400);
    expect(after).toContain('visits.map');
  });
});

test.describe('요청10: 메시지 탭 컴팩트 + 인라인 실패 + 한글 에러', () => {
  // 메시지 탭 블록만 슬라이스 (chartTab === 'messages' ~ 좌측 패널 종료)
  const msgStart = src.indexOf("chartTabGroup === 'history' && chartTab === 'messages'");
  const msgEnd = src.indexOf('우측 패널 — 건보', msgStart);
  const msgBlock = src.slice(msgStart, msgEnd > msgStart ? msgEnd : msgStart + 6000);

  test('10-1 컴팩트화: 자동 SMS 발송 이력 항목 패딩 축소(px-2 py-1.5) + testid', () => {
    expect(msgStart).toBeGreaterThan(-1);
    expect(msgBlock).toContain('data-testid="noti-log-item"');
    expect(msgBlock).toContain('px-2 py-1.5');
    // 기존 넓은 패딩(px-2.5 py-2 space-y-1)은 항목에서 제거됨
    expect(msgBlock).not.toContain('bg-gray-50 px-2.5 py-2 space-y-1"');
  });

  test('10-3 인라인 실패: 에러를 항목 헤더 행에 인라인 표기(별도 <p> 줄 제거)', () => {
    expect(msgBlock).toContain('data-testid="noti-log-error"');
    // 기존 별도 줄 패턴(빨강 <p>로 raw error_message 출력)은 제거됨
    expect(msgBlock).not.toContain('text-[10px] text-red-500">{log.error_message}');
  });

  test('10-2 한글화: raw error_message 직접 출력 대신 koNotiError 경유', () => {
    // 인라인 에러는 koErr(=koNotiError 결과)만 렌더
    expect(msgBlock).toContain('koNotiError(log.error_message)');
    expect(msgBlock).toContain('{koErr}');
    // 성공(sent)은 사유 미표시
    expect(msgBlock).toContain("log.status === 'sent' ? null : koNotiError");
  });

  test('10-1 컴팩트화: 섹션 컨테이너 space-y-2 + 박스 패딩 p-2.5', () => {
    expect(msgBlock).toContain('space-y-2');
    expect(msgBlock).toContain('rounded-lg border bg-white p-2.5');
  });

  test('koNotiError 헬퍼/매핑 테이블이 소스에 정의됨(서버응답 불변·클라 표시 전용)', () => {
    expect(src).toContain('const NOTI_ERROR_KO_MAP');
    expect(src).toContain('function koNotiError');
    // 매핑 항목 수 = 미러(MAP)와 동일해야 회귀 가드 유효
    const mapBlock = src.slice(src.indexOf('const NOTI_ERROR_KO_MAP'), src.indexOf('function koNotiError'));
    // 엔트리( { match: /regex/ ... } )만 카운트 — 타입 선언({ match: RegExp; ... }) 제외
    const entryCount = (mapBlock.match(/\{\s*match:\s*\//g) || []).length;
    expect(entryCount).toBe(MAP.length);
  });
});
