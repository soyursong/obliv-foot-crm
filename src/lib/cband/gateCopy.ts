/**
 * cband/gateCopy.ts — 코밴 직결결제(BETA) 버튼 6-상태 문구 SSOT (순수·JSX 없음)
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260803-foot-CBAND-PAYBTN-DISABLED-TOOLTIP (미연결 시 숨김 → 비활성+툴팁+1줄사유)
 *
 * ★ 목적: "왜 못 누르는지"가 항상 보이게. 미연결/미설정 시 버튼을 숨기지 않고
 *   비활성 렌더 + 마우스오버 툴팁 + 버튼 아래 상시 1줄 사유(AC-6)로 노출한다.
 *
 * 6-상태 표(AC-4):
 *   | # | 상태            | 조건                | 버튼   | 사유(1줄, 상시)                              |
 *   |---|-----------------|---------------------|--------|-----------------------------------------------|
 *   | 1 | 기능 미도입     | 플래그 OFF          | 숨김   | (렌더 안 함)                                  |
 *   | 2 | TID 미등록      | cfg==null           | 비활성 | 이 PC 단말기 정보(TID) 미등록 → 관리자 문의   |
 *   | 3 | 단말 확인 중    | probe==null         | 비활성 | 카드 단말 연결 확인 중…                       |
 *   | 4 | 접속 허용 대기  | probe=='awaiting'   | 비활성 | 브라우저에서 [허용] 필요 + [다시 확인]        |
 *   | 5 | 연결 실패       | probe=='blocked'    | 비활성 | 차단 해제 또는 단말 프로그램 실행(두 조치)     |
 *   | 6 | 연결됨          | probe=='ok'         | 활성   | (정상 — 게이트 문구 없음)                     |
 *
 * ★ ⑤ blocked: 권한차단·데몬미실행 두 원인은 WS close 1006 으로 코드 구분 불가 →
 *   툴팁에 두 조치(차단 해제 / 단말 프로그램 실행)를 반드시 함께 안내한다(티켓 필수).
 * ★ 결제·이중결제방지·전문 로직 불변. 바뀌는 것은 'FE 렌더 조건'뿐(db_change=false).
 */

/** 비활성(못 누르는) 게이트 종류. probe==='ok'(활성)은 게이트가 아니므로 제외. */
export type CbandGateKind = 'tid-missing' | 'probing' | 'awaiting' | 'blocked';

export interface CbandGateCopy {
  /** ★AC-6: 버튼 아래 상시 노출되는 1줄 사유(마우스오버 불필요). */
  reason: string;
  /** 마우스오버 툴팁(상세 조치 안내). */
  tooltip: string;
  /** [다시 확인](재탐지) 버튼 노출 여부. TID 미등록·탐지중은 재시도 무의미 → false. */
  retryable: boolean;
  /** 상태 컨테이너 data-testid. */
  testid: string;
}

export function cbandGateCopy(kind: CbandGateKind): CbandGateCopy {
  switch (kind) {
    case 'tid-missing':
      return {
        reason: '이 PC의 단말기 정보(TID)가 등록되지 않았습니다. 관리자에게 문의하세요.',
        tooltip: '이 PC에는 카드 단말기 정보(TID)가 등록되어 있지 않아 카드 단말 결제를 쓸 수 없습니다. 관리자에게 단말 설정을 요청해 주세요.',
        retryable: false,
        testid: 'cband-gate-tid-missing',
      };
    case 'probing':
      return {
        reason: '카드 단말 연결을 확인하고 있습니다…',
        tooltip: '카드 단말 연결 상태를 확인하는 중입니다. 연결이 확인되면 결제 버튼이 자동으로 활성화됩니다.',
        retryable: false,
        testid: 'cband-gate-probing',
      };
    case 'awaiting':
      return {
        reason: '브라우저에서 카드 단말 접속을 [허용]해야 결제할 수 있습니다.',
        tooltip: '주소창에 뜬 “이 사이트가 로컬 기기(카드 단말)에 접속하도록 허용하시겠습니까?” 창에서 [허용]을 누른 뒤 아래 [다시 확인]을 눌러 주세요.',
        retryable: true,
        testid: 'cband-gate-awaiting',
      };
    case 'blocked':
    default:
      // ★1006(close)로는 원인을 구분할 수 없어 두 조치를 함께 안내한다(티켓 필수).
      return {
        reason: '카드 단말에 연결하지 못했습니다. 접속 차단을 해제하거나 단말 프로그램을 켜 주세요.',
        tooltip: '두 가지 원인일 수 있습니다 — ① 브라우저에서 로컬 기기 접속을 [차단]했거나, ② 카드 단말 프로그램이 꺼져 있습니다. 주소창 자물쇠 → 사이트 설정에서 차단을 해제하거나, 단말 프로그램을 켠 뒤 아래 [다시 확인]을 눌러 주세요.',
        retryable: true,
        testid: 'cband-gate-blocked',
      };
  }
}
