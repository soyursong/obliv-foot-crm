/**
 * writeBufferInstance.ts — 앱 전역 write-buffer 싱글턴 (browserStorage + refresh401Bus 배선)
 *
 * 티켓: T-20260818-foot-REFRESH401-RESILIENCE-PILOT (Step2 (c))
 *
 * writeBuffer.ts(순수 코어)를 브라우저 localStorage(durableStore) + 가시성 bus(setPendingWrites)에
 * 배선한 단일 인스턴스. 앱 write-path 는 이 인스턴스에 executor 를 등록하고 enqueue 한다.
 *   · 가시성(spec §3.3 기준5): 보류 건수 변동 → refresh401Bus.setPendingWrites → 배너 "저장 대기 N건".
 *   · surface(R2-B/fatal): 콘솔 경고(현 pilot) — per-path adoption 시 toast 로 승격(호출측 override 여지).
 *
 * 코어(writeBuffer.ts)는 이 파일을 import 하지 않는다(테스트는 격리 store 로 createWriteBuffer 직접 사용).
 */
import { browserStorage, createDurableStore } from './durableStore';
import { createWriteBuffer, type WriteBuffer } from './writeBuffer';
import { setPendingWrites } from './refresh401Bus';

const store = createDurableStore(browserStorage());

export const writeBuffer: WriteBuffer = createWriteBuffer({
  store,
  onPendingChange: (count) => setPendingWrites(count),
  onSurface: (rec, outcome) => {
    // 현 pilot: 정직 로그(사일런트 성공취급 금지의 최소 surface). adoption 시 toast override.
    // eslint-disable-next-line no-console
    console.warn(
      `[write-buffer] ${outcome === 'domain_conflict' ? '도메인 충돌' : '저장 실패'} — ` +
        `"${rec.label}" 는 자동 저장되지 못했습니다(사용자 조치 필요). opId=${rec.opId}`,
    );
  },
});

// 부팅 시 로컬에 남은(이전 세션 blip 중 미완료) 보류 건수를 배너에 즉시 반영.
try {
  setPendingWrites(store.list().length);
} catch {
  /* noop */
}
