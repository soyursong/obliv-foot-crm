// send-notification/no-template-cause.regress.test.ts — no-template 원인분류 + CONFIG-GUARD 불변식 회귀 가드
//
// T-20260725-foot-SOLAPI-NO-TEMPLATE-RESOLVE-FAIL ②③ (ADDITIVE·no-DDL, 관측성)
//   [배경] 06-25~07-11 no-template 에피소드(jongno 497건)가 error_message="no template found" 로
//     레코드無 vs is_active=false 를 뭉개 기록 → 실원인(설정상태) 로그판별 불가 → "충전무관 별개결함"
//     오진 유발. 1단계 진단(commit af7b1302)이 원인=(a)템플릿 설정상태 미조회기간으로 확정.
//   [조치] ② 실패경로에서 is_active 필터 없는 진단 조회로 no_record/inactive 원인축 각인.
//          ③ 자동발송(EventType) no-template은 무징후 발송중단이므로 CONFIG-GUARD 로 severity 격상.
//
//   ▸ index.ts 단계6 no-template 분기의 순수 결정부(cause 파생 + isCoreAutomated)를 미러링한다.
//     이 매트릭스가 깨지면(예: inactive 를 no_record 로 오분류, 자동발송이 가드에서 누락)
//     테스트가 실패해 관측성 회귀를 표면화한다.
//
//   실행: deno test --node-modules-dir=none supabase/functions/send-notification/no-template-cause.regress.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

type EventType = "resv_confirm" | "resv_reminder_d1" | "resv_reminder_morning" | "noshow";
interface TemplateRow { id: string; is_active: boolean }

// ── index.ts 단계6 no-template 원인분류 결정부 미러 (DB fetch 제거, 순수 함수) ──
// probe = is_active 필터 없이 (clinic_id,event_type) 로 조회한 전 행.
function deriveCause(probeRows: TemplateRow[]): "no_record" | "inactive" {
  if (probeRows.length > 0) {
    return probeRows.some((r) => r.is_active) ? "no_record" : "inactive";
  }
  return "no_record";
}

const CORE_AUTOMATED: EventType[] = ["resv_confirm", "resv_reminder_d1", "resv_reminder_morning", "noshow"];
function isCoreAutomated(event_type: string): boolean {
  return CORE_AUTOMATED.includes(event_type as EventType);
}

// ── ② 원인분류: no_record vs inactive ────────────────────────────────────
Deno.test("②-1: (clinic,event) 행 자체 없음 → no_record", () => {
  assertEquals(deriveCause([]), "no_record");
});

Deno.test("②-2: 행 존재하나 전부 is_active=false → inactive (06-25~07-11 실원인 케이스)", () => {
  assertEquals(deriveCause([{ id: "t1", is_active: false }]), "inactive");
  assertEquals(
    deriveCause([{ id: "t1", is_active: false }, { id: "t2", is_active: false }]),
    "inactive",
  );
});

Deno.test("②-3: 활성행이 하나라도 있으면(비정상 도달) 보수적 no_record 유지", () => {
  assertEquals(deriveCause([{ id: "t1", is_active: true }]), "no_record");
  assertEquals(
    deriveCause([{ id: "t1", is_active: false }, { id: "t2", is_active: true }]),
    "no_record",
  );
});

// ── ③ CONFIG-GUARD: 자동발송 event_type 전량 가드 대상 ───────────────────
Deno.test("③-1: 자동발송 4종 event_type 은 모두 CONFIG-GUARD 대상", () => {
  for (const ev of ["resv_confirm", "resv_reminder_d1", "resv_reminder_morning", "noshow"]) {
    assertEquals(isCoreAutomated(ev), true, `${ev} 는 자동발송인데 가드 누락됨`);
  }
});

Deno.test("③-2: 수동/기타 경로 event_type(manual_send 등)은 이 조회분기 비진입 → 가드 비대상", () => {
  // manual_send/test_send/scheduled_send 는 명시 body 경로로 템플릿 조회 분기(단계6) 자체를 타지 않음.
  // 만약 레거시/구버전에서 event_type='manual_send' 로 진입해도 CONFIG-GUARD 격상 없이 warn 유지.
  assertEquals(isCoreAutomated("manual_send"), false);
  assertEquals(isCoreAutomated("test_send"), false);
  assertEquals(isCoreAutomated("scheduled_send"), false);
});

// ── error_message 조립 정합 (로그 각인 형식) ─────────────────────────────
Deno.test("②③-조립: error_message 는 원인축을 괄호로 각인", () => {
  assertEquals(`no template found (${deriveCause([])})`, "no template found (no_record)");
  assertEquals(
    `no template found (${deriveCause([{ id: "t1", is_active: false }])})`,
    "no template found (inactive)",
  );
});
