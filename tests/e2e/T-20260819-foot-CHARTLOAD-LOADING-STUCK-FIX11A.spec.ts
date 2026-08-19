/**
 * T-20260819-foot-CHARTLOAD-LOADING-STUCK-FIX11A
 *
 * [RC] CustomerChartPage 차트 초기 로드 useEffect 가 `setLoading(true)` 로 진행 게이트를 켠 뒤
 *   IIFE 안에서 `await supabase…` 를 try/catch/finally 없이 나열한다. 로드 쿼리 하나만
 *   연결끊김·중단으로 **throw** 하면 말미의 `setLoading(false)` 라인에 도달하지 못한다.
 *     → `if (loading)` 렌더 가드가 영구 잠김 → 차트가 영구 "불러오는 중…" 에 갇힘.
 *       복구 수단이 새로고침뿐이 됨(08-19 이은상 팀장 relay MSG-20260819-144834-ng38).
 *   ★ 오전 MEDIMG 33곳(async UI 게이팅 플래그 finally 해제, deployed@692a5341)과 **동일 결함 클래스**.
 *     단 오전 스캐너가 UI 게이팅 플래그(busy/uploading/uploadProgress)만 봐서 `loading` 을 놓친 누락분(reporter 자인).
 *
 * [처방 = 11-A only]
 *   차트 초기 로드 IIFE 본문을 try/catch/finally 로 감싸 **어떤 쿼리가 throw 해도**
 *   `finally { setLoading(false) }` 로 loading 을 반드시 해제 → 영구 "불러오는 중…" 제거.
 *   catch: 실패를 삼키지 않고 복구 가능한 loadError + [다시 시도] 로 착지(새로고침 불필요).
 *   부분 성공 데이터(throw 이전 setter 반영분)는 보존. 정상 경로 동작 무변(방어코드만 추가).
 *   ⚠ 11-B(핵심/부가 분리)는 scope 밖 — reporter 명시 제외("하지 마세요").
 *
 * [본 spec = 정적 회귀 가드 — 시나리오1(정상 무변)+시나리오2(throw→loading 해제·복구착지)의 결정론 대체]
 *   차트 초기 로드 useEffect 블록에 try/catch/finally 가 존재하고, finally 에서 loading 을 해제하며,
 *   catch 가 복구 가능한 에러 상태로 착지함을 소스에 대해 정적 단언.
 *   🔴 수정 전 코드(BASE=b9e19b75)에서 RED / 수정 후 GREEN. 이 계열 재발(loading 누락분)의 종결 조건.
 *   런타임 fault-injection(DevTools offline, 시나리오2)은 supervisor 단독 QA 가 수행.
 *
 * project=unit (순수 fs-grep 정적 단언 — auth/DB/server 불요·결정론). db_change=false.
 * 선례 스타일: tests/e2e/T-20260819-foot-MEDIMG-UPLOAD-PROGRESS-LOCK.spec.ts
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(process.cwd(), 'src');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

/**
 * 차트 초기 로드 useEffect 블록 추출:
 *   `setLoading(true);` 직후 `(async () => {` 로 시작하는 로드 effect 를,
 *   deps 배열 `}, [customerId, profile, reloadNonce]);` 까지 슬라이스한다.
 */
function chartLoadEffectBlock(src: string): string | null {
  // 로드 effect 고유 지문: setLoading(true) 다음 줄에 async IIFE.
  const m = /setLoading\(true\);\s*\n\s*\(async \(\) => \{/.exec(src);
  if (!m) return null;
  const from = m.index;
  const depsMarker = '}, [customerId, profile, reloadNonce]);';
  const end = src.indexOf(depsMarker, from);
  if (end < 0) return null;
  return src.slice(from, end + depsMarker.length);
}

test.describe('CHARTLOAD-LOADING-STUCK-FIX11A — 차트 초기 로드 try/catch/finally 정적 회귀 가드', () => {
  test('AC-1: 차트 초기 로드 effect 에 try/catch/finally 가 존재한다', () => {
    const block = chartLoadEffectBlock(read('pages/CustomerChartPage.tsx'));
    expect(block, '차트 초기 로드 useEffect 블록을 찾지 못함(지문 변경?)').not.toBeNull();
    const b = block as string;
    expect(b.includes('try {'), 'try 블록 없음').toBe(true);
    expect(/\}\s*catch\s*\(/.test(b), 'catch 절 없음').toBe(true);
    expect(/\}\s*finally\s*\{/.test(b), 'finally 절 없음').toBe(true);
  });

  test('AC-2 (핵심 불변식): finally 블록에서 loading(진행 게이트) 을 해제한다', () => {
    const b = chartLoadEffectBlock(read('pages/CustomerChartPage.tsx')) as string;
    expect(b).not.toBeNull();
    const fi = b.search(/\}\s*finally\s*\{/);
    expect(fi, 'finally 구문 없음').toBeGreaterThanOrEqual(0);
    // 어떤 쿼리 throw 든 도달하는 finally 안에서 setLoading(false) 가 호출되어야 한다.
    expect(b.indexOf('setLoading(false)', fi), 'finally 내 setLoading(false) 없음').toBeGreaterThanOrEqual(0);
  });

  test('AC-3: setLoading(false) 가 finally 안에서만 해제됨(try 본문 말미 무방비 해제 아님)', () => {
    const b = chartLoadEffectBlock(read('pages/CustomerChartPage.tsx')) as string;
    const fi = b.search(/\}\s*finally\s*\{/);
    // finally 이전(try/catch 본문)에는 setLoading(false) 가 남아있지 않아야 한다.
    // (남아있으면 throw 시 도달 못하는 옛 해제 경로가 잔존 = 회귀).
    const beforeFinally = b.slice(0, fi);
    expect(beforeFinally.includes('setLoading(false)'), 'try/catch 본문에 setLoading(false) 잔존(무방비 해제)').toBe(false);
  });

  test('AC-4 (catch 복구 착지): 실패를 삼키지 않고 복구 가능한 loadError 상태로 착지한다', () => {
    const src = read('pages/CustomerChartPage.tsx');
    const b = chartLoadEffectBlock(src) as string;
    // ⚠ 주석 텍스트에 'catch'/'finally' 단어가 있어 indexOf 오탐 → 실제 구문(`} catch (` / `} finally {`)으로 앵커.
    const ci = b.search(/\}\s*catch\s*\(/);
    const fi = b.search(/\}\s*finally\s*\{/);
    expect(ci, 'catch 구문 없음').toBeGreaterThanOrEqual(0);
    expect(fi, 'finally 구문 없음').toBeGreaterThan(ci);
    // catch 블록(= catch..finally 사이)에서 loadError 를 세팅해야 한다(white-screen/무한로딩 금지).
    const catchBody = b.slice(ci, fi);
    expect(catchBody.includes('setLoadError('), 'catch 에서 loadError 착지 없음(실패 삼킴)').toBe(true);
    // 복구 UI: loadError && !customer 시 [다시 시도] 렌더 + reloadNonce 재실행 경로 존재.
    expect(src.includes('loadError && !customer'), '복구 에러 렌더 가드 없음').toBe(true);
    expect(src.includes('다시 시도'), '[다시 시도] 버튼 없음').toBe(true);
    expect(/setReloadNonce\(\(n\) => n \+ 1\)/.test(src), 'reloadNonce 재실행(새로고침 없는 복구) 경로 없음').toBe(true);
  });

  test('AC-5 (회귀 방어·정상경로 무변): custData 없음 조기반환은 finally 로 loading 해제(inline setLoading 제거)', () => {
    const b = chartLoadEffectBlock(read('pages/CustomerChartPage.tsx')) as string;
    // 고객 미존재 조기반환은 `if (!custData) { return; }` — inline setLoading(false) 제거(finally 가 담당).
    expect(/if \(!custData\) \{ return; \}/.test(b), 'custData 조기반환이 finally 위임 형태가 아님').toBe(true);
  });
});
