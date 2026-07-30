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
//   · 선점축(pre-match) 불변식: open/expired 미확정 선점은 payments 에 조기진입 금지(미확정 금액이
//     매출/ROAS/전환에 조기발화하는 오염 차단). matchPass 는 이를 준수한다.
//   · ★ 경로A(matcher-as-payments-writer, T-20260730-...-PAYWRITE-BUILD-P2, DA GO ADDITIVE):
//     matched '전이 성공 후에만' payments 1행 INSERT. Model A(§Model A L1279 "matched=payments INSERT됨")
//     을 위반이 아니라 실현 — 쓰기 주체가 서버(EF)인 것은 브라우저 비의존으로 더 충실. AC7 정합:
//     recordManualPayment 와 row-shape parity(paymentRow.ts) + single-writer(FE usePlanbClaimStatus 는
//     status 폴러, write 안 함) + raw-claim 원자앵커 3조건 결속.
//   · 멱등 SSOT(DA Q4): claim-first — 클라 생성 payment UUID 로 redpay_raw_transactions.matched_payment_id 를
//     원자 claim(UPDATE ... WHERE matched_payment_id IS NULL, rows=1 만). claim 성공 후에만 INSERT →
//     orphan payment 물리 불가. rows=0 = 재전송·재클릭·reconcile/타 writer 선점 → skip. 앵커=raw.id(PK).
//     db_change=false 위해 true-txn RPC 대신 claim-first + 보상 release 채택(RPC 수렴은 fast-follow, DA #10).
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
import {
  buildPlanbPaymentRow,
  PlanbPaymentBuildError,
  type PlanbPendingRow,
  type PlanbRawRow,
} from "./paymentRow.ts";

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
//   경로A payments INSERT 는 pending 의 귀속키(customer_id/check_in_id, 스키마상 NOT NULL)와
//   raw 의 관측컬럼(external_trxid/approval_no/tid) + claim 게이트(matched_payment_id)가 추가로 필요 →
//   런타임 SELECT 를 확장하고 아래 Full 타입으로 좁혀 paymentRow.ts 빌더에 넘긴다(순수 매칭 로직은 base 타입 유지).
interface PendingRowFull extends PendingRow {
  customer_id: string;  // payments 귀속(AC5) — NOT NULL
  check_in_id: string;  // payments 귀속(AC5) — NOT NULL
}
interface RawRowFull extends RawRow {
  external_trxid: string;             // Model A ② 주석컬럼(AC7) — NOT NULL
  approval_no: string | null;
  tid: string | null;
  matched_payment_id: string | null; // reconcile/타 writer 소비분 배제 + claim 게이트
}

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
    .select("id, clinic_id, customer_id, check_in_id, expected_amount, created_at, expires_at, status")
    .in("status", ["open", "expired"])
    .gt("expires_at", cutoffIso);
  if (e1) throw e1;
  const pendings = (opensRaw ?? []) as PendingRowFull[];
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
    .select("id, clinic_id, amount, approved_at, external_status, received_at, external_trxid, approval_no, tid, matched_payment_id")
    .eq("external_status", "Y")
    .not("approved_at", "is", null)
    .not("received_at", "is", null)
    .is("matched_payment_id", null)   // 경로A: reconcile/타 writer 가 이미 payments 로 소비한 raw 배제
    .gt("amount", 0);
  if (e3) throw e3;
  const raws = (rawsRaw ?? []) as RawRowFull[];

  let matched = 0;
  let skippedAmbiguous = 0;

  for (const [, list] of groups) {
    if (list.length > 1) { skippedAmbiguous += list.length; continue; } // 모호 그룹 스킵
    const p = list[0] as PendingRowFull;
    // 후보 raw 선택 — 승인 raw + occurred_at 유효창 + 미소비, 가장 이른 승인시각 우선(match.ts).
    //   selectCandidateRaw 는 raws 배열의 동일 객체 참조를 반환 → RawRowFull 로 안전 복원.
    const raw = selectCandidateRaw(p, raws, used) as RawRowFull | null;
    if (raw === null) continue;

    // ── 경로A: matched 전이 성공 후 payments INSERT (claim-first, DA Q4 멱등 SSOT) ──────────
    const wrote = await matchAndRecordPayment(p, raw, nowIso);
    if (wrote) {
      matched += 1;
      used.add(raw.id); // 이 실행 내 raw 이중매칭 방지(전역 소비 집합 갱신)
    }
  }
  return { matched, skippedAmbiguous, retentionCandidates };
}

// ── 경로A 코어: raw-claim + matched 전이 + payments INSERT (claim-first) ───────────────────────
//   순서(orphan payment 물리 불가):
//     0) 결제행 조립(check_in_id/customer_id/금액/매출-일자 앵커 검증). 실패 = 수동폴백(claim 미취득).
//     1) raw 원자 claim (UPDATE ... WHERE matched_payment_id IS NULL, rows=1 만). rows=0 → 이미 소비, skip.
//     2) pending 후보상태(open|expired)→matched 전이 (동시성 가드). rows=0 → 상태 이탈 → claim release, skip.
//     3) payments INSERT (shape-parity 행). 실패 → matched·claim 보상 release → 다음 사이클 재시도.
//   §CARRY-Q0 NOT-NULL read-check(2차)는 (1) WHERE 술어에 내장(TOCTOU 제거)되어 별도 SELECT 불요.
//   @returns true = payments 1행 영속(matched 확정) · false = skip/실패(무-write 또는 보상 완료).
async function matchAndRecordPayment(
  p: PendingRowFull,
  raw: RawRowFull,
  nowIso: string,
): Promise<boolean> {
  // (0) 결제행 조립 — 실패(check_in_id/금액/앵커 부정)면 claim 도 취하지 않고 수동폴백.
  const paymentId = crypto.randomUUID();
  let row;
  try {
    const built = buildPlanbPaymentRow(
      p as unknown as PlanbPendingRow,
      raw as unknown as PlanbRawRow,
      { paymentId, reconciledAtIso: nowIso },
    );
    row = built.row;
    for (const w of built.warnings) console.warn(`${LOG}[MATCH][WARN] 선점 ${p.id}: ${w}`);
  } catch (err) {
    const msg = err instanceof PlanbPaymentBuildError ? err.message : String(err);
    console.error(`${LOG}[MATCH] 결제행 조립 실패(선점 ${p.id}) → INSERT 차단·수동폴백: ${msg}`);
    return false;
  }

  // (1) raw 원자 claim — 멱등 1차 방어. rows-affected=1 만 정상.
  const { data: claimed, error: eClaim } = await supabase
    .from("redpay_raw_transactions")
    .update({ matched_payment_id: paymentId })
    .eq("id", raw.id)
    .is("matched_payment_id", null)
    .select("id");
  if (eClaim) {
    console.error(`${LOG}[MATCH] raw claim 오류(raw=${raw.id}): ${eClaim.message}`);
    return false;
  }
  if ((claimed?.length ?? 0) === 0) {
    console.log(`${LOG}[MATCH] raw ${raw.id} 이미 claim 됨(재전송·재클릭·reconcile 선점) → skip(멱등).`);
    return false;
  }

  // (2) pending 후보상태(open|expired)→matched 전이 (동시성 가드).
  const { data: upd, error: eUpd } = await supabase
    .from("pending_payment")
    .update({ status: "matched", matched_raw_txid: raw.id, matched_at: nowIso, updated_at: nowIso })
    .eq("id", p.id)
    .in("status", ["open", "expired"])
    .select("id");
  if (eUpd || (upd?.length ?? 0) === 0) {
    await releaseClaim(raw.id, paymentId);
    if (eUpd) console.error(`${LOG}[MATCH] 전이 오류(id=${p.id}) → claim release: ${eUpd.message}`);
    else console.log(`${LOG}[MATCH] 선점 ${p.id} 이미 후보상태 아님 → claim release, skip.`);
    return false;
  }

  // (3) payments INSERT — shape-parity 행(id=claim 앵커). 실패 시 matched·claim 보상 release.
  const { error: eIns } = await supabase.from("payments").insert(row);
  if (eIns) {
    console.error(`${LOG}[MATCH] payments INSERT 실패(선점 ${p.id}, raw ${raw.id}) → matched/claim 보상 release: ${eIns.message}`);
    // matched → 원상태(open|expired) 되돌림: 우리가 만든 전이만(matched_raw_txid=raw.id 결속 확인).
    await supabase
      .from("pending_payment")
      .update({ status: p.status, matched_raw_txid: null, matched_at: null, updated_at: nowIso })
      .eq("id", p.id)
      .eq("status", "matched")
      .eq("matched_raw_txid", raw.id);
    await releaseClaim(raw.id, paymentId);
    return false;
  }

  console.log(
    `${LOG}[MATCH] 선점 ${p.id}(${p.status}) ← raw ${raw.id} (amount=${p.expected_amount}, occurred_at=${raw.approved_at}) ` +
    `matched + payments ${paymentId} INSERT(created_at=${row.created_at} accounting_date=${row.accounting_date}).`,
  );
  return true;
}

/** raw claim 보상 release — 우리가 취득한 claim(matched_payment_id=paymentId)만 되돌린다(타 writer claim 무접촉). */
async function releaseClaim(rawId: string, paymentId: string): Promise<void> {
  const { error } = await supabase
    .from("redpay_raw_transactions")
    .update({ matched_payment_id: null })
    .eq("id", rawId)
    .eq("matched_payment_id", paymentId);
  if (error) {
    console.error(`${LOG}[MATCH] claim release 실패(raw=${rawId}, pay=${paymentId}): ${error.message} ` +
      `— 다음 사이클 dangling ref 주의(수동폴백 필요).`);
  }
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
    const expired = await expirePass(nowIso);
    const { matched, skippedAmbiguous, retentionCandidates } = await matchPass(nowIso);
    return json(200, {
      ok: true,
      run_at: nowIso,
      expired,
      matched,
      skipped_ambiguous: skippedAmbiguous,
      retention_candidates: retentionCandidates, // 보관창(만료 후 1h) 내 expired 선점 수(관측).
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG} 처리 예외 → 500: ${msg}`);
    return json(500, { ok: false, error: "unexpected_error", message: msg });
  }
});
