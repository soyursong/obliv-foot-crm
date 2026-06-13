/**
 * T-20260613-foot-REFRESH-BANNER-AUTOLO — 미저장(dirty) 입력 보호 글로벌 레지스트리.
 *
 * 배경: 새 버전 배포 배너가 '버튼식'이라 며칠째 화면에 떠 불편 → 10~15초 카운트다운 후
 *   '버튼 없이 자동 새로고침'으로 전환(UpdateBanner). 그런데 자동 새로고침이 진료차트
 *   작성 중·문자 발송 중에 무방비로 발화하면 데이터가 날아가는 footgun이 생긴다.
 *
 * 본 모듈 = 그 footgun 방어선(AC-3 dirty-guard, 데이터 유실 0):
 *   각 화면이 자신의 '미저장 상태'와 '저장(flush) 경로'를 가드로 등록한다. 자동/즉시
 *   새로고침 직전 UpdateBanner가 등록된 가드를 훑어:
 *     - flushable(저장 경로 보유)  → 자동 저장(flush) 후 새로고침 ("자동 저장됨")
 *     - blocking(저장 경로 없음)   → 새로고침 보류 + "저장 후 새로고침" 안내
 *
 * 설계 원칙:
 *   - 범용 임시저장(localStorage/DB draft) 신규 인프라는 본 모듈 범위 밖
 *     (T-20260603-foot-CHART-DRAFT-SAVE에서 별도 처리). 여기선 '유실 방지' intent만 보장.
 *   - 무패키지. 모듈-레벨 Map + 순수 함수만 사용.
 *   - over-block은 안전(저장 후 진행), under-block은 데이터 유실 → 의심되면 blocking 취급.
 */

export interface UnsavedGuard {
  /** 가드 고유 id (화면/인스턴스 단위). 같은 id 재등록 시 덮어쓴다. */
  id: string;
  /** 현재 미저장(dirty) 입력이 있는지. 예외는 false(안전 통과)로 취급. */
  isDirty: () => boolean;
  /**
   * 있으면 '자동 저장 가능' 경로(flushable). 새로고침 직전 await flush() 후 진행.
   * 없으면(undefined) blocking — 묵시적 저장이 불가/위험한 화면(예: 진료차트: 의료법상
   * 진료의 NOT NULL 강제로 미완 차트를 임의 저장 불가)이며 새로고침을 보류한다.
   */
  flush?: () => Promise<void> | void;
  /** 사용자 안내·디버깅용 라벨(예: '진료차트', '체크인 메모'). */
  label?: string;
}

const guards = new Map<string, UnsavedGuard>();

/** 가드 등록. 반환된 함수를 호출(또는 effect cleanup)하면 해제된다. */
export function registerUnsavedGuard(guard: UnsavedGuard): () => void {
  guards.set(guard.id, guard);
  return () => {
    // 같은 id가 그새 다른 인스턴스로 교체됐으면 그 인스턴스를 지우지 않는다.
    if (guards.get(guard.id) === guard) guards.delete(guard.id);
  };
}

export interface DirtySnapshot {
  /** dirty + flush 보유 → 자동 저장 후 진행 가능. */
  flushable: UnsavedGuard[];
  /** dirty + flush 없음 → 새로고침 보류(저장 후 진행 안내). */
  blocking: UnsavedGuard[];
}

/** 현재 등록된 가드 중 dirty인 것들을 flushable/blocking으로 분류해 스냅샷 반환. */
export function collectDirty(): DirtySnapshot {
  const flushable: UnsavedGuard[] = [];
  const blocking: UnsavedGuard[] = [];
  for (const g of guards.values()) {
    let dirty = false;
    try {
      dirty = g.isDirty();
    } catch {
      dirty = false; // 가드 평가 실패는 정상 사용을 방해하지 않도록 안전 통과
    }
    if (!dirty) continue;
    if (g.flush) flushable.push(g);
    else blocking.push(g);
  }
  return { flushable, blocking };
}

/**
 * flushable 가드들을 순차 저장. 실패한 가드(throw)는 반환 배열로 돌려준다.
 * 호출부(UpdateBanner)는 실패분을 blocking과 동일하게 취급해 새로고침을 보류한다
 * (저장에 실패했는데 새로고침하면 데이터 유실 → 유실 0 원칙 위반).
 */
export async function flushAll(gs: UnsavedGuard[]): Promise<UnsavedGuard[]> {
  const failed: UnsavedGuard[] = [];
  for (const g of gs) {
    try {
      await g.flush?.();
    } catch {
      failed.push(g);
    }
  }
  return failed;
}

// ── E2E/디버깅 훅 ────────────────────────────────────────────────────────────
// Playwright가 결정적으로 dirty-guard 분기(정상/즉시/blocking)를 재현할 수 있도록
// 합성 가드를 주입/해제하는 최소 API를 window에 노출. (프로덕션 동작엔 무영향)
if (typeof window !== 'undefined') {
  (window as unknown as { __unsavedGuardTest?: unknown }).__unsavedGuardTest = {
    register: registerUnsavedGuard,
    collect: collectDirty,
    clear: () => guards.clear(),
  };
}
