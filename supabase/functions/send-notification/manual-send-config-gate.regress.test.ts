// send-notification/manual-send-config-gate.regress.test.ts
//   manual_send 설정 게이트: '비활성화(enabled=false)' ↔ '연결/발신번호 미설정' 구분 불변식 회귀 가드
//
// T-20260731-foot-MSGSET-SENDBLOCK-RECOVER
//   [배경] 07-29~30 Solapi vault 교체 후, 서울오리진점(jongno-foot 74967aea) 은
//     sender_number·vault name 은 저장돼 있으나 clinic_messaging_capability.enabled=false(운영 self-halt).
//     총괄님이 수동 발송 시도 → EF 가 enabled=false + 미설정을 한 덩어리로 판정해
//     "…(연결/발신번호 미설정). 먼저 저장하세요" 로 표출 → "이미 저장했는데?" 현장 혼선.
//   [조치] index.ts manual_send 게이트를 (1) enabled=false → '비활성화, 활성화 후 저장'
//     (2) 연결/발신번호 누락 → '미설정, 먼저 저장' 두 분기로 분리. 아래 순수 결정부가 그 미러.
//     이 매트릭스가 깨지면(예: 발신번호가 있는데도 '미설정' 안내가 나옴) 테스트가 실패해
//     현장 혼선 회귀를 표면화한다.
//
//   실행: deno test --node-modules-dir=none supabase/functions/send-notification/manual-send-config-gate.regress.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

interface MsgCap {
  enabled: boolean;
  solapi_api_key_vault_name: string | null;
  solapi_secret_vault_name: string | null;
  sender_number: string | null;
}

type GateVerdict = "OK" | "DISABLED" | "UNCONFIGURED";

// ── index.ts manual_send 설정 게이트 결정부 미러 (분기 순서 포함) ──
function manualSendGateDecision(mc: MsgCap): GateVerdict {
  if (!mc.enabled) return "DISABLED";
  if (!mc.solapi_api_key_vault_name || !mc.solapi_secret_vault_name || !mc.sender_number) {
    return "UNCONFIGURED";
  }
  return "OK";
}

// 서울오리진점(jongno-foot) 07-30 실제 저장 상태 스냅샷: 발신번호·vault 있음, enabled=false
const JONGNO_0730: MsgCap = {
  enabled: false,
  solapi_api_key_vault_name: "solapi_api_key_74967aea",
  solapi_secret_vault_name: "solapi_secret_74967aea",
  sender_number: "0269563225",
};

Deno.test("현장 재현: 발신번호·vault 저장됨 + enabled=false → DISABLED('비활성화'), '미설정' 아님", () => {
  assertEquals(
    manualSendGateDecision(JONGNO_0730),
    "DISABLED",
    "발신번호가 저장돼 있으므로 '미설정'이 아니라 '비활성화'로 판정해야 현장 혼선이 없다",
  );
});

Deno.test("진짜 미설정: 발신번호 누락 → UNCONFIGURED", () => {
  assertEquals(
    manualSendGateDecision({ ...JONGNO_0730, enabled: true, sender_number: null }),
    "UNCONFIGURED",
  );
});

Deno.test("진짜 미설정: vault name 누락 → UNCONFIGURED", () => {
  assertEquals(
    manualSendGateDecision({ ...JONGNO_0730, enabled: true, solapi_secret_vault_name: null }),
    "UNCONFIGURED",
  );
});

Deno.test("self-halt 개방 후: enabled=true + 전 항목 저장 → OK(발송 가능)", () => {
  assertEquals(
    manualSendGateDecision({ ...JONGNO_0730, enabled: true }),
    "OK",
    "총괄 go → enabled=true 전환 시 수동 발송이 통과해야 한다",
  );
});

Deno.test("분기 우선순위: enabled=false 는 미설정보다 먼저 판정(비활성화 메시지 우선)", () => {
  // enabled=false 이면서 발신번호도 없을 때: DISABLED 가 우선(활성화가 선결 안내)
  assertEquals(
    manualSendGateDecision({ enabled: false, solapi_api_key_vault_name: null, solapi_secret_vault_name: null, sender_number: null }),
    "DISABLED",
  );
});
