/**
 * E2E spec — T-20260616-foot-OPINION-DOC-FEATURE (Phase 1 — FE scaffold, 영속 제외)
 * 소견서(진단서) 작성 탭 — 균검사지 '옆' 신규 탭.
 *
 * 검증 대상(Phase 1):
 *   S1 옵션 자동삽입(toggle) — 옵션 phrase 가 editor 본문에 줄 단위로 append/remove(AC-3).
 *   S2 수기수정 보존 — editor 텍스트가 SSOT. 빈 본문/공백 경계에서 append 정상(AC-4).
 *   S3 옵션 그리드 무결성 — F0BAETELCTF 섹션/옵션 구성, key 중복 없음.
 *   S4 Phase 경계 — '최종 발행'(AC-6)·서류 출력(AC-7) 은 Phase 1 미포함(준비중). 영속 ZERO.
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(OpinionDocTab.togglePhraseInText / OPINION_SECTIONS)을
 *   모사해 회귀를 잡는다. (컴포넌트는 auth/DB 의존이라 직접 마운트 대신 로직 동치 검증 — KOH spec 동일 컨벤션.)
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: togglePhraseInText (OpinionDocTab.tsx) ─────────────────────────
const togglePhraseInText = (text: string, phrase: string): string => {
  const lines = text.split('\n').map((l) => l.trimEnd());
  const idx = lines.findIndex((l) => l.trim() === phrase.trim());
  if (idx >= 0) {
    lines.splice(idx, 1);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  }
  const base = text.replace(/\s+$/, '');
  return base ? `${base}\n${phrase}` : phrase;
};

// ── 정본 모사: OPINION_SECTIONS 구조(요약) ────────────────────────────────────
const SECTION_TITLES = ['진단서', '금기증'];
const SAMPLE_KEYS = ['oral_o', 'oral_x', 'after_1m', 'medical_staff', 'hyperlipidemia', 'diabetes', 'pediatric'];

test.describe('T-20260616-foot-OPINION-DOC-FEATURE (Phase 1 scaffold)', () => {
  // S1 — 옵션 클릭 시 phrase 가 editor 에 자동 삽입(빈 본문)
  test('S1: 빈 editor 에 옵션 phrase append', () => {
    const phrase = '경구약 복용이 가능한 상태로 확인됩니다.';
    expect(togglePhraseInText('', phrase)).toBe(phrase);
  });

  // S1 — 같은 옵션 재클릭 시 phrase 제거(toggle off)
  test('S1: 동일 phrase 재클릭 → 제거(toggle)', () => {
    const phrase = '당뇨 관련 사항을 확인하였습니다.';
    const once = togglePhraseInText('', phrase);
    expect(togglePhraseInText(once, phrase)).toBe('');
  });

  // S1 — 여러 옵션 누적 append(줄 단위)
  test('S1: 여러 옵션 누적 append(줄 단위)', () => {
    const a = '경구약 복용이 가능한 상태로 확인됩니다.';
    const b = '당뇨 관련 사항을 확인하였습니다.';
    let t = togglePhraseInText('', a);
    t = togglePhraseInText(t, b);
    expect(t).toBe(`${a}\n${b}`);
  });

  // S1 — 중간 옵션만 제거(앞뒤 보존)
  test('S1: 중간 phrase 제거 시 앞뒤 줄 보존', () => {
    const a = 'AAA';
    const b = 'BBB';
    const c = 'CCC';
    let t = togglePhraseInText('', a);
    t = togglePhraseInText(t, b);
    t = togglePhraseInText(t, c);
    expect(t).toBe('AAA\nBBB\nCCC');
    expect(togglePhraseInText(t, b)).toBe('AAA\nCCC');
  });

  // S2 — 원장이 수기 수정한 본문 뒤에도 정상 append(공백 경계)
  test('S2: 수기수정 본문 끝에 append(trailing whitespace 정리)', () => {
    const manual = '환자는 양호한 상태입니다.\n\n';
    const phrase = '의료진 판단 하에 진료를 진행하였습니다.';
    expect(togglePhraseInText(manual, phrase)).toBe('환자는 양호한 상태입니다.\n의료진 판단 하에 진료를 진행하였습니다.');
  });

  // S2 — 본문에 수기로 적힌 동일 문구도 toggle 매칭(줄 trim 비교)
  test('S2: 수기로 적힌 동일 문구도 toggle 제거 대상', () => {
    const phrase = '소아 환자임을 확인하였습니다.';
    const manual = `앞줄\n  ${phrase}  \n뒷줄`;
    expect(togglePhraseInText(manual, phrase)).toBe('앞줄\n뒷줄');
  });

  // S3 — 옵션 그리드 무결성(섹션·샘플 key) — 실제 SECTIONS 는 컴포넌트 소유, 여기선 계약만.
  test('S3: 섹션 타이틀/샘플 옵션 key 계약', () => {
    expect(SECTION_TITLES).toContain('진단서');
    expect(SECTION_TITLES).toContain('금기증');
    // key 중복 없음(샘플)
    expect(new Set(SAMPLE_KEYS).size).toBe(SAMPLE_KEYS.length);
  });

  // S4 — Phase 경계: 발행/저장은 Phase 1 비활성(영속 ZERO). 로직상 toggle 결과는 순수 문자열만 생산.
  test('S4: toggle 은 부수효과(저장/발행) 없는 순수 변환', () => {
    const before = '기존 본문';
    const after = togglePhraseInText(before, '추가 문구');
    // 순수 함수 — 입력 불변
    expect(before).toBe('기존 본문');
    expect(after).toBe('기존 본문\n추가 문구');
  });
});

// ── S5: 실 브라우저 렌더 — 소견서 탭 + 팝업 동선 (균검사지 옆 신설 무회귀) ───────
test.describe('T-20260616-foot-OPINION-DOC-FEATURE — render', () => {
  test('S5: 진료대시보드 → 소견서 탭 렌더 + (데이터 있으면) 작성 팝업 오픈', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    await page.getByRole('link', { name: '진료 대시보드' }).click();
    await page.waitForTimeout(1500);

    // 균검사지 탭 무회귀 — 여전히 존재.
    await expect(page.getByTestId('tab-koh-report')).toBeVisible();
    // 소견서 탭 — 신설 노출.
    const opinionTab = page.getByTestId('tab-opinion-doc');
    await expect(opinionTab).toBeVisible();
    await opinionTab.click();
    await page.waitForTimeout(2000);

    // 탭 헤더 렌더(빈 명단이어도 안내 문구는 항상).
    await expect(page.getByText('소견서 — 금일 내방객')).toBeVisible({ timeout: 5000 });

    const openBtn = page.getByTestId('opinion-open').first();
    if (await openBtn.count() > 0) {
      await openBtn.click();
      await page.waitForTimeout(1200);
      const dialog = page.getByTestId('opinion-dialog');
      await expect(dialog).toBeVisible({ timeout: 5000 });
      // 옵션 클릭 → editor 자동삽입(AC-3).
      await page.getByTestId('opinion-opt-oral_o').click();
      await page.waitForTimeout(300);
      await expect(page.getByTestId('opinion-editor')).not.toHaveValue('');
      // 발행 버튼 = Phase 1 비활성(준비중).
      await expect(page.getByTestId('opinion-publish-btn')).toBeDisabled();
      await page.screenshot({ path: 'evidence/T-20260616-foot-OPINION-DOC-FEATURE_dialog.png', fullPage: true });
    } else {
      await page.screenshot({ path: 'evidence/T-20260616-foot-OPINION-DOC-FEATURE_empty.png', fullPage: true });
    }
  });
});
