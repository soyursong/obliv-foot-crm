// T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD — Edge Function: redpay-planb-match (풋센터)
// T-20260729-foot-REDPAY-PLANB-MATCH-OCCURREDAT-SPEC-FIX — 매칭 SPEC 정정(최필경 총괄, 스레드 1785285157.831119)
//
// 레드페이 플랜B(비대기형 결제) 백그라운드 매칭 + 만료 워커.
//   비대기형 결제: FE(PaymentPlanb route)가 pending_payment 선점(open)을 만들고 화면을 즉시 전환.
//   본 EF 가 cron(pg_cron)으로 주기 실행되며 두 패스를 수행한다:
//     ① EXPIRE  — now() >= expires_at 인 open 선점 → status='expired' (TTL 만료, 수기입력 폴백). 행 보존(DELETE 아님).
//     ② MATCH   — 유효 open + 보관창(만료 후 1h) 내 expired 선점을, 승인(external_status='Y') raw 와
//                 예상금액 + occurred_at(승인시각=approved_at) 유효창으로 매칭 → status='matched', matched_raw_txid/matched_at set.
//
// ── SPEC 정정 3🔴 (T-20260729: occurred_at 전환 + 파라미터 2분리 + event_type 필터) ──────────────
//   · (정정2) 매칭 시간 키 = received_at(도착시각) → occurred_at(승인시각 = raw.approved_at 컬럼). 웹훅 지연을 설계변수에서 제거.
//     유효창 = approved_at ∈ [pending.created_at, pending.expires_at](=created_at+5분).
//     AC-5 pre-check(prod HTTP200 실측): approved_at 컬럼 영속 확인 → db_change 없음(순수 EF 로직 변경).
//   · (정정2 파라미터 2분리) 선점 유효창(5분, pending.expires_at) / 선점표 보관 기간(1h, match.ts RETENTION_MS) 분리.
//     만료 후 1h 내 expired 선점도 MATCH 후보 → late 웹훅(재시도 1/5/30분) 자동연결. 1h 초과분은 시간 필터로 자연 제외.
//     ★ 행 즉시삭제 없음 = status='expired' 보존 → 미배정 유입지표(UNASSIGNED-INFLOW-METRIC) 집계 정합(AC-7).
//   · (정정3) 매칭 대상 = 승인(external_status='Y') 한정. cancelled/refunded(N/M/X, cancelled_at)는 제외 → 결제후즉시취소 오연결 0.
//     ⚠ 취소 raw 도 approved_at(원 승인시각)이 세팅될 수 있음 → external_status='Y' 가 승인 판별 1급 게이트.
//   · (정정1) TTL 카드삽입시간 누락 = 정정2(occurred_at 기준)로 구조적 해소. TTL 값 변경 없음(무액션).
//
// ── 설계 원칙 (기존 EF 무접촉) ──────────────────────────────────────────────────
//   · redpay-webhook = OBSERVE-only(pending_payment/payments write 미발화, 런타임 가드 有) → 무변경.
//   · redpay-reconcile = raw↔payments 4-tier 매처 → 무변경.
//   · 본 EF 는 pending_payment(선점표) 전용 매칭을 격리 신설 — 두 기존 EF 의 계약을 건드리지 않음.
//
// ── 불변식 (§550 Model A / §789) ───────────────────────────────────────────────
//   · pending_payment 은 payments 를 write 하지 않는다(매출 grain 아님, 예정=선점).
//     실 매출 기록/대사는 기존 payments 파이프(redpay-reconcile)가 계승 — 본 EF 는 pending_payment 만 전이.
//   · 매칭 방향 = redpay_raw_transactions 역참조(matched_raw_txid). payments 신설참조 금지.
//   · TTL 판정은 pending_payment 에 app-set 된 expires_at/locked_until(정책 단일소스=src/lib/redpayPlanbTtl.ts,
//     write-time 적용)을 그대로 비교 — EF 에 5/6 상수 재복제 없음(divergence 0).
//
// ── 매칭 규율 (충돌 안전) ────────────────────────────────────────────────────────
//   · 같은 (clinic_id, expected_amount) 후보 선점이 2건+ = 모호 → 자동매칭 스킵(만료 후 수기 폴백).
//   · 이미 다른 선점에 matched_raw_txid 로 소비된 raw 는 재사용 금지(1 raw : 1 선점).
//   · 후보 raw = external_status='Y'(승인) + approved_at NOT NULL(occurred_at) + received_at NOT NULL(웹훅 수신분) + amount>0 +
//               approved_at ∈ [pending.created_at, pending.expires_at](occurred_at 유효창).
//   · 순수 매칭 로직(유효창·보관창·승인판별·후보선택)은 match.ts 로 격리(deno test 대상).
//
// ── 환경 변수 ──────────────────────────────────────────────────────────────────
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — 자동 주입(service_role = RLS 바이패스 매칭 워커)
//   INTERNAL_CRON_SECRET  — X-Internal-Cron 헤더 인증(pg_cron 호출). service_role bearer 도 허용.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  RETENTION_MS,
  retentionCutoffIso,
  groupPendingByAmount,
  selectCandidateRaw,
  type PendingRow,
  type RawRow,
} from "./match.ts";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_CRON_SECRET      = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const LOG = "[redpay-planb-match][foot]";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// PendingRow / RawRow 타입은 match.ts(순수 로직 모듈)에서 import.

// ── ① EXPIRE 패스 — now() >= expires_at 인 open → expired ──────────────────────
async function expirePass(nowIso: string): Promise<number> {
  const { data, error } = await supabase
    .from("pending_payment")
    .update({ status: "expired", updated_at: nowIso })
    .eq("status", "open")
    .lte("expires_at", nowIso)
    .select("id");
  if (error) {
    console.error(`${LOG}[EXPIRE] update 오류: ${error.message}`);
    throw error;
  }
  const n = data?.length ?? 0;
  if (n > 0) console.log(`${LOG}[EXPIRE] ${n}건 open→expired (TTL 만료, 수기 폴백).`);
  return n;
}

// ── ② MATCH 패스 — 유효 open + 보관창 내 expired 선점을 승인 raw 의 occurred_at 유효창으로 매칭 ──
async function matchPass(
  nowIso: string,
): Promise<{ matched: number; skippedAmbiguous: number; retentionCandidates: number }> {
  // MATCH 후보 선점 (정정2 파라미터 2분리):
  //   status ∈ {open, expired}  — 유효 open + 만료 후 보관창 내 expired.
  //   expires_at > (now - RETENTION_MS)  — 유효 open(expires_at>now) + 만료 후 1h 이내 expired 를 함께 포함.
  //     · 만료 후 1h 초과 expired 는 자연 제외(매칭 후보 아님, 행은 그대로 보존 → 미배정 지표 정합).
  //     · EXPIRE 패스가 선행되어 만료된 open 은 이미 expired 로 전이됨(잔여 open 은 모두 expires_at>now).
  const cutoffIso = retentionCutoffIso(nowIso, RETENTION_MS);
  const { data: opensRaw, error: e1 } = await supabase
    .from("pending_payment")
    .select("id, clinic_id, expected_amount, created_at, expires_at, status")
    .in("status", ["open", "expired"])
    .gt("expires_at", cutoffIso);
  if (e1) throw e1;
  const pendings = (opensRaw ?? []) as PendingRow[];
  const retentionCandidates = pendings.filter((p) => p.status === "expired").length;
  if (pendings.length === 0) return { matched: 0, skippedAmbiguous: 0, retentionCandidates };

  // (clinic_id, expected_amount) 그룹핑 — 2건+ 는 모호(자동매칭 제외). match.ts 순수 로직.
  const groups = groupPendingByAmount(pendings);

  // 이미 소비된 raw(다른 선점의 matched_raw_txid) 집합 — 재사용 금지.
  const { data: usedRaw, error: e2 } = await supabase
    .from("pending_payment")
    .select("matched_raw_txid")
    .not("matched_raw_txid", "is", null);
  if (e2) throw e2;
  const used = new Set<string>((usedRaw ?? []).map((r) => r.matched_raw_txid as string));

  // 후보 raw (정정3) — 승인(external_status='Y') + approved_at(occurred_at) NOT NULL +
  //   received_at NOT NULL(웹훅 수신분) + amount>0. 취소/환불(N/M/X)은 external_status 필터로 제외.
  const { data: rawsRaw, error: e3 } = await supabase
    .from("redpay_raw_transactions")
    .select("id, clinic_id, amount, approved_at, external_status, received_at")
    .eq("external_status", "Y")
    .not("approved_at", "is", null)
    .not("received_at", "is", null)
    .gt("amount", 0);
  if (e3) throw e3;
  const raws = (rawsRaw ?? []) as RawRow[];

  let matched = 0;
  let skippedAmbiguous = 0;

  for (const [, list] of groups) {
    if (list.length > 1) { skippedAmbiguous += list.length; continue; } // 모호 그룹 스킵
    const p = list[0];
    // 후보 raw 선택 — 승인 raw + occurred_at 유효창 + 미소비, 가장 이른 승인시각 우선(match.ts).
    const raw = selectCandidateRaw(p, raws, used);
    if (raw === null) continue;

    // matched 전이 — 후보 상태(open|expired) 재확인(동시성 가드). 이미 전이됐으면 no-op.
    const { data: upd, error: eUpd } = await supabase
      .from("pending_payment")
      .update({ status: "matched", matched_raw_txid: raw.id, matched_at: nowIso, updated_at: nowIso })
      .eq("id", p.id)
      .in("status", ["open", "expired"])
      .select("id");
    if (eUpd) {
      console.error(`${LOG}[MATCH] 전이 오류(id=${p.id}): ${eUpd.message}`);
      continue;
    }
    if ((upd?.length ?? 0) > 0) {
      matched += 1;
      used.add(raw.id); // 이 실행 내 raw 이중매칭 방지(전역 소비 집합 갱신)
      console.log(
        `${LOG}[MATCH] 선점 ${p.id}(${p.status}) ← raw ${raw.id} (amount=${p.expected_amount}, occurred_at=${raw.approved_at}) matched.`,
      );
    }
  }
  return { matched, skippedAmbiguous, retentionCandidates };
}

// ── ③ AUTO-CANCEL 패스 — 보관창(1h) 초과 미매칭 선점 → cancelled ──────────────────
//   T-20260730-foot-REDPAY-PLANB-OPT3-V3-BUILD #4 (§CARRY-AUTOCANCEL-FEASIBILITY salvage 승계).
//   ★match-before-cancel 순서 강제: 반드시 matchPass '이후' 3번째 패스로 실행 —
//     같은 invocation 내 late 웹훅 매칭(matchPass)이 자동취소보다 항상 우선(보관창 내 건은 여기 도달 전 matched).
//   대상 = status ∈ {expired, failed} AND expires_at <= now - RETENTION_MS(보관창 초과).
//     · expires_at 컷오프 SSOT = RETENTION_MS(src/lib/redpayPlanbTtl.retentionMs 미러, 1h 하드코딩 금지).
//     · 보관창 내(late 웹훅 매칭 여지 有) 건은 절대 취소하지 않음(retentionCutoffIso 경계, isWithinRetention 상보).
//   ★상태전환만(DELETE 아님 — 행 보존 → 미배정 유입지표 정합). 'cancelled' CHECK 旣존재(mig 20260727) = DDL 불요.
//   ★감사구분 컬럼(cancel_source 등)은 2차/ADDITIVE 유예(PAYWRITE-DA-CONSULT 번들 판정) — 1차는 상태전환만.
//   rows-affected 가드: .select('id') 반환 0건이면 no-op(대상 없음 skip).
async function autoCancelPass(nowIso: string): Promise<number> {
  // 컷오프 = now - RETENTION_MS. expires_at <= 컷오프 = 보관창 초과(match.isAutoCancelTarget 와 동치).
  const cutoffIso = retentionCutoffIso(nowIso, RETENTION_MS);
  const { data, error } = await supabase
    .from("pending_payment")
    .update({ status: "cancelled", updated_at: nowIso })
    .in("status", ["expired", "failed"])   // 미매칭 종료 선점만(open/matched/cancelled 무접촉).
    .lte("expires_at", cutoffIso)          // 보관창 초과분만 — 보관창 내는 matchPass 여지 위해 제외.
    .select("id");
  if (error) {
    console.error(`${LOG}[AUTO-CANCEL] update 오류: ${error.message}`);
    throw error;
  }
  const n = data?.length ?? 0;
  if (n > 0) console.log(`${LOG}[AUTO-CANCEL] ${n}건 (expired|failed)→cancelled (등록 후 보관창 초과, 매칭창 종료).`);
  return n;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST" && req.method !== "GET") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  // ── 인증 — X-Internal-Cron(pg_cron) 또는 service_role bearer(redpay-reconcile 동형) ──
  const cronHeader = req.headers.get("x-internal-cron");
  const authHeader = req.headers.get("authorization");
  const isInternalCron = INTERNAL_CRON_SECRET !== "" && cronHeader === INTERNAL_CRON_SECRET;
  const isServiceRole  = authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  if (!isInternalCron && !isServiceRole) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  const nowIso = new Date().toISOString();
  try {
    // ★패스 순서 = expire → match → autoCancel. match-before-cancel 구조 강제(별도 cron 금지, OPT3 #4).
    const expired = await expirePass(nowIso);
    const { matched, skippedAmbiguous, retentionCandidates } = await matchPass(nowIso);
    const autoCancelled = await autoCancelPass(nowIso);
    return json(200, {
      ok: true,
      run_at: nowIso,
      expired,
      matched,
      skipped_ambiguous: skippedAmbiguous,
      retention_candidates: retentionCandidates, // 보관창(만료 후 1h) 내 expired 선점 수(관측).
      auto_cancelled: autoCancelled,             // 보관창 초과 → cancelled 전이 수(OPT3 #4, 관측).
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG} 처리 예외 → 500: ${msg}`);
    return json(500, { ok: false, error: "unexpected_error", message: msg });
  }
});
