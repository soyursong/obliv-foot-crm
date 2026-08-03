import { test, expect } from '@playwright/test';
import {
  buildMsg,
  makeTrace,
  canonicalizeCatMessage,
  CBAND_DATA_TYPE,
  TRANTYPE_APPROVE,
  TRANTYPE_CANCEL,
} from '../../src/lib/cband/protocol';

/**
 * T-20260803-foot-CBAND-DAEMON-JEONMUN-DATATYPE-PARSE-ROBUST — 코밴 전문 파서 robustness (P2, GO_WARN)
 * ════════════════════════════════════════════════════════════════════════════
 * ★근본원인(CONFIRMED): 로컬 코밴 CAT 데몬(ws://127.0.0.1:8888)은 DATA_TYPE(전문형태)를 정식 JSON
 *   파싱이 아니라 리터럴 substring 매칭(`"DATA_TYPE":"…"`)으로 추출한다 → 콜론 뒤 공백(④)·개행/들여쓰기(⑤)
 *   가 섞이면 유효 전문도 "DATA_TYPE 전문형태 값이 없습니다"로 오거부.
 * ★파서 위치: 거부 파서는 **외부 밴사 데몬**(우리 레포 아님·수정 불가). 우리 송신경로 =
 *   protocol.buildMsg(조립) → catClient.send() → ws.send(). 수정 = wire 직전 canonicalizeCatMessage 로
 *   데몬이 항상 받는 compact(①) 형태만 내보낸다(값·키순서 round-trip 보존, GO_WARN 오파싱 방지).
 *
 * ── 재현 매트릭스 = AC 계약(①~⑤) ────────────────────────────────────────────
 *   ① 정상(콜론뒤 공백無)           → canonicalize no-op, 회귀0            (AC3)
 *   ② DATA_TYPE 필드 누락           → 스펙상 무효 → 데몬 거부 정당(주입 안함) (AC4)
 *   ③ DATA_TYPE 빈 문자열           → 스펙상 무효 → 데몬 거부 정당           (AC4)
 *   ④ 콜론 뒤 공백 `"DATA_TYPE": …` → canonicalize → compact ① 정상          (AC1)
 *   ⑤ 들여쓰기/pretty-print         → canonicalize → compact ① 정상          (AC2)
 *
 * ── ②③ 스펙근거 판정(AC4) ───────────────────────────────────────────────────
 *   코밴 CAT 전문은 header.DATA_TYPE(전문형태)를 데몬이 **먼저** 읽어 전문 종류를 판정한다
 *   (protocol.ts §봉투 규칙0). DATA_TYPE 부재(②)·빈값(③) = 전문형태 discriminator 없음 = 스펙상 무효.
 *   → 데몬의 "DATA_TYPE 값이 없습니다" 거부는 **정당(정상 동작)**. canonicalize 는 DATA_TYPE 를
 *   지어내 무효 전문을 통과시키지 않는다(실오류 은폐 방지) — round-trip 후에도 무효로 남겨 데몬이 정당 거부.
 *   ※ 우리 buildMsg 는 애초에 ②③ 전문을 만들 수 없다(header.DATA_TYPE='JSON' 상수 + 빈값 throw 가드).
 */

const BASE = { tid: 'TID12345678', catPort: 'COM3' as const };

/** 데몬이 리터럴로 찾는 토큰(콜론 뒤 공백 없는 정상형). */
const LITERAL = '"DATA_TYPE":"JSON"';

// ══════════════════════════════════════════════════════════════════════════
// AC3 — 케이스① 정상(compact) 회귀 0: canonicalize idempotent no-op
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC3 — 케이스① compact 회귀0', () => {
  test('buildMsg 출력(①)은 canonicalize 후 바이트 동일(idempotent)', () => {
    const { message } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1002, catPort: BASE.catPort, msgTrace: makeTrace(),
    });
    // 이미 compact → 리터럴 토큰 존재 + canonicalize no-op(완전 동일).
    expect(message).toContain(LITERAL);
    expect(canonicalizeCatMessage(message)).toBe(message);
    // 두 번 돌려도 동일(idempotent).
    expect(canonicalizeCatMessage(canonicalizeCatMessage(message))).toBe(message);
  });

  test('취소(0430) compact 전문도 canonicalize no-op', () => {
    const { message } = buildMsg({
      tranType: TRANTYPE_CANCEL, tid: BASE.tid, amount: 1002, catPort: 3,
      msgTrace: makeTrace(), originalAuthNo: '28102510',
    });
    expect(canonicalizeCatMessage(message)).toBe(message);
    expect(canonicalizeCatMessage(message)).toContain(LITERAL);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC1 — 케이스④ 콜론 뒤 공백 → compact ① 로 정상화
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC1 — 케이스④ 콜론뒤 공백 정상화', () => {
  test('`"DATA_TYPE": "JSON"`(콜론뒤 공백) → 콜론뒤공백 0 + 리터럴 토큰 복원', () => {
    // JSON.stringify 3번째 인자로 콜론 뒤 공백을 인위 주입(현장 ④ 재현).
    const envelope = {
      header: { LENGTH: '0034', MSG_VERSION: '0002', TCODE: 'S0', MSG_TRACE: '235112000001', DATA_TYPE: 'JSON' },
      body: { TRANTYPE: '0210', TID: BASE.tid, CAT_PORT: '03', TAMT: '000001002' },
    };
    const spaced = JSON.stringify(envelope, null, 0).replace(/":"/g, '": "'); // 콜론 뒤 공백 삽입
    expect(spaced).toMatch(/:\s/);                 // 전제: ④ 형태(콜론 뒤 공백 존재)
    expect(spaced).not.toContain(LITERAL);         // 데몬 리터럴 매칭 실패 형태

    const out = canonicalizeCatMessage(spaced);
    expect(out).not.toMatch(/:\s/);                // 콜론 뒤 공백 0
    expect(out).toContain(LITERAL);                // 데몬 리터럴 토큰 복원 → 수용
    // 값 보존(GO_WARN): 파싱 결과 완전 동일.
    expect(JSON.parse(out)).toEqual(envelope);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC2 — 케이스⑤ 들여쓰기/pretty-print → compact ① 로 정상화
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC2 — 케이스⑤ pretty-print 정상화', () => {
  test('개행+들여쓰기 전문 → 개행/탭 0 + 리터럴 토큰 복원 + 값 보존', () => {
    const envelope = {
      header: { LENGTH: '0034', MSG_VERSION: '0002', TCODE: 'S0', MSG_TRACE: '235112000002', DATA_TYPE: 'JSON' },
      body: { TRANTYPE: '0210', TID: BASE.tid, CAT_PORT: '03', TAMT: '000000500', MERNO: '00918554560' },
    };
    const pretty = JSON.stringify(envelope, null, 2);   // ⑤ pretty-print(개행+2칸 들여쓰기)
    expect(pretty).toMatch(/\n/);                        // 전제: 개행 존재
    expect(pretty).not.toContain(LITERAL);              // 데몬 리터럴 매칭 실패

    const out = canonicalizeCatMessage(pretty);
    expect(out).not.toMatch(/\n|\t/);                   // 개행·탭 0
    expect(out).not.toMatch(/:\s/);                     // 콜론 뒤 공백 0
    expect(out).toContain(LITERAL);                     // 리터럴 토큰 복원
    expect(JSON.parse(out)).toEqual(envelope);          // 값 완전 보존
  });

  test('canonicalize 는 header/body 키 순서 보존(리터럴매칭 데몬 순서민감 대비)', () => {
    const { message, header } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1000, catPort: 3, msgTrace: makeTrace(),
    });
    const pretty = JSON.stringify(JSON.parse(message), null, 4);
    const out = canonicalizeCatMessage(pretty);
    const reHeaderKeys = Object.keys((JSON.parse(out) as { header: object }).header);
    expect(reHeaderKeys).toEqual(Object.keys(header)); // 순서 동일
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC4 — 케이스②③ 스펙상 무효 → canonicalize 가 DATA_TYPE 을 지어내지 않음(데몬 거부 정당)
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC4 — 케이스②③ 무효 전문 판정(주입 금지)', () => {
  test('②DATA_TYPE 누락 → canonicalize 후에도 DATA_TYPE 부재(주입 안함)', () => {
    const missing = '{"header":{"LENGTH":"0034","MSG_VERSION":"0002","TCODE":"S0","MSG_TRACE":"235112000003"},"body":{"TRANTYPE":"0210","TID":"TID12345678","CAT_PORT":"03","TAMT":"000001002"}}';
    const out = canonicalizeCatMessage(missing);
    // 무효는 무효인 채로 — DATA_TYPE 를 지어내 은폐하지 않는다 → 데몬이 정당 거부.
    expect(out).not.toContain('DATA_TYPE');
    expect((JSON.parse(out) as { header: Record<string, string> }).header.DATA_TYPE).toBeUndefined();
  });

  test('③DATA_TYPE 빈 문자열 → canonicalize 후에도 빈값 유지(비어있음=무효)', () => {
    // 콜론 뒤 공백까지 섞인 ③(=③+④ 복합) → 공백은 정상화되나 빈값은 채우지 않는다.
    const empty = '{"header":{"MSG_VERSION":"0002","TCODE":"S0", "DATA_TYPE": ""},"body":{}}';
    const out = canonicalizeCatMessage(empty);
    expect(out).not.toMatch(/:\s/);                    // ④적 공백은 제거
    const dt = (JSON.parse(out) as { header: Record<string, string> }).header.DATA_TYPE;
    expect(dt).toBe('');                               // 빈값 그대로(무효 판정 유지) → 데몬 정당 거부
  });

  test('★buildMsg 는 ②③ 전문을 애초에 만들 수 없다(DATA_TYPE 상수 + 빈값 throw 가드)', () => {
    const { header, message } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1002, catPort: BASE.catPort, msgTrace: makeTrace(),
    });
    expect(header.DATA_TYPE).toBe(CBAND_DATA_TYPE);    // 항상 'JSON'(②③ 원천 불가)
    expect(header.DATA_TYPE.trim().length).toBeGreaterThan(0);
    expect(canonicalizeCatMessage(message)).toContain(LITERAL);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// fail-safe — 깨진 전문은 원문 유지(값 훼손 금지, GO_WARN)
// ══════════════════════════════════════════════════════════════════════════
test.describe('fail-safe (파싱 불가·비객체 원문 유지)', () => {
  test('파싱 불가 문자열 → 원문 그대로 반환', () => {
    const broken = '{"header":{"DATA_TYPE":"JSON"'; // 깨진 JSON
    expect(canonicalizeCatMessage(broken)).toBe(broken);
  });

  test('스칼라/배열 JSON → 원문 유지(전문 객체만 정규화)', () => {
    expect(canonicalizeCatMessage('"just a string"')).toBe('"just a string"');
    expect(canonicalizeCatMessage('[1,2,3]')).toBe('[1,2,3]'); // 배열도 전문 아님 → 원문
  });
});
