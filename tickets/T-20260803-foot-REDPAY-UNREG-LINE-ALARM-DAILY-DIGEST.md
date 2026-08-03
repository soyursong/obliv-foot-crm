---
id: T-20260803-foot-REDPAY-UNREG-LINE-ALARM-DAILY-DIGEST
domain: foot
priority: P2
status: consult-pending
deploy_ready: false
hotfix: false
created: 2026-08-03
db_changed: pending-consult
db_change_class: ADDITIVE
data_architect_consult: required-sent
e2e_spec: supabase/functions/redpay-unreg-digest/digest-lib.test.ts
risk_verdict: PENDING
risk_reason: "레드페이 미등록 회선 알람 스팸(push당 실시간 Slack, 쿨다운0 → 재시도 반복 5회/40분)을 하루 1회 digest 로 전환. 발원지=redpay-webhook unknown 경로(§317-340, dedup 없음). 폴러(redpay-reconcile)는 filterToFootScope 로 미등록 merchant 를 upsert 前 drop → raw 미적재 → 기존 v_redpay_unclassified_merchants 뷰로는 미등록 회선 재집계 불가(무DDL 불가 확인). AC5(알림 유실 0) 보장 위해 webhook 관측시점 영속 필요 → ADDITIVE 신규 테이블 redpay_unregistered_line_seen 1개(+RPC 1·cron trigger 1·cron job 1). 파괴 변경 0(기존 payments/raw/registry/뷰/RLS 무접촉) → 대표 게이트 불요(autonomy §3.1). 신규 테이블 = §S2.4 데이터 정책 게이트 → data-architect CONSULT 선행 필수(GO 전 deploy-ready 금지). 발송시각 기본 09:00 KST(cron 0 0 * * *) 현장 확정 대기(responder)."
author: dev-foot
build_verified: "2026-08-03 — deno check redpay-unreg-digest/index.ts + redpay-webhook/index.ts clean / deno test digest-lib.test.ts 11 passed 0 failed / FE tsc -b + vite build ✓ (EF/migration only, FE 무변경)"
followups:
  - "data-architect CONSULT (ADDITIVE redpay_unregistered_line_seen) GO 대기 → GO 시 db_changed=true 전환 + prod apply"
  - "digest 발송시각 현장 확정(기본 09:00 KST) via responder"
---

# T-20260803-foot-REDPAY-UNREG-LINE-ALARM-DAILY-DIGEST

## 요청 (planner NEW-TASK, MSG-20260803-164022-pu6g)
레드페이 회선 등록 알람이 10분마다 반복(15:52~16:32 동일내용 5회) → 등록담당 즉시처리 불가 시
하루 수십회 쌓여 타 알람이 묻힘. 실시간 반복 → **오전 업무시작 하루 1회 요약(digest)** 전환.
미등록 회선만 1회 발송·같은 회선 반복 금지·각 행 `가맹점 <merchant_id> / 회선 <tid> (첫 감지 M/D, 누적 N건)`.

## 발원지 특정 (착수 가이드 §1)
- **origin = redpay-webhook/index.ts unknown 경로**(§317-340). `center==="unknown"`(미등록 merchant)마다
  `sendSlackMessage` **즉시 발송 — 쿨다운/ dedup 전무**. 레드페이 재시도(1/5/30분)가 push 반복 → 스팸.
- redpay-reconcile 폴러의 알람은 이미 30분 쿨다운+배치요약(§1006) → 스팸 아님. non2xx 알람은 별개 경로.
- **무DDL 불가 확인**: 폴러는 `filterToFootScope`(§544)로 미등록 merchant 를 `kept`에서 제외 → `redpay_raw_transactions` **미적재**.
  기존 `v_redpay_unclassified_merchants` 뷰는 raw 기반이므로 webhook-only 미등록 회선을 담지 못함 →
  재집계 불가. AC5(유실 0) 보장하려면 **webhook 관측시점에 상태 영속** 필요.

## 구현
| 파일 | 변경 |
|------|------|
| `supabase/migrations/20260803160000_redpay_unregistered_line_digest.sql` (신규) | **ADDITIVE** — TABLE `redpay_unregistered_line_seen`(dedup 상태: first_seen/last_seen/hit_count/resolved_at) + FUNC `redpay_note_unregistered_line`(멱등 증분 accumulate) + FUNC `trigger_redpay_unreg_digest`(cron→EF) + cron job `foot-redpay-unreg-digest`(`0 0 * * *`=09:00 KST). |
| `…rollback.sql` (신규) | cron unschedule + DROP FUNC 2 + DROP TABLE. 데이터손실 0. |
| `supabase/functions/redpay-webhook/index.ts` | unknown 경로: **실시간 Slack → accumulate(RPC 멱등 증분)**. `REDPAY_UNREG_ALARM_MODE`(digest 기본 / realtime=구동작 롤백레일). **accumulate 항상 수행**(어느 모드든) → AC5 데이터원 보장. accumulate 실패 시 **fail-safe 실시간 Slack**(유실 0). 타 경로 무접촉. |
| `supabase/functions/redpay-unreg-digest/index.ts` (신규 EF) | cron 하루 1회 — 미등록(resolved_at NULL) 조회 → registry 재대조로 **등록전이 resolved 스탬프(제외)** → 남은 미등록 ≥1이면 요약 1건 발송, 0이면 no-send(빈 digest 금지). |
| `supabase/functions/redpay-unreg-digest/digest-lib.ts` (신규) | 순수 로직(dedup키·partition·행포맷·요약조립) — DB/네트워크 무의존, 결정적 단위검증 대상. |
| `supabase/functions/redpay-unreg-digest/digest-lib.test.ts` (신규) | 단위검증 11 case — dedup·집계·미등록필터·등록전이제외·발송억제(0건)·행포맷·AC5(빈set 전량미등록). |

## AC 매핑
- **실시간/반복 → 하루 1회 digest**: cron `0 0 * * *`(09:00 KST) + webhook 실시간 Slack 억제(digest 모드). ✅
- **미등록 회선만·같은 회선 반복 금지**: `dedup_key`(merchant::tid) UNIQUE 멱등 증분 → 회선당 1행 → digest 회선당 1행. ✅
- **행 포맷**: `• 가맹점 <merchant_id> / 회선 <tid> (첫 감지 M/D, 누적 N건)` (unit 검증). ✅
- **미등록→등록 전이 자동 제외**: digest 실행 시 registry(domain=foot,active) 재대조 → resolved_at 스탬프 → 이후 제외. ✅
- **AC5 알림 유실 0**: 미등록 ≥1 → 반드시 발송 / accumulate 실패 → fail-safe 실시간 / registry 조회실패 → 전량 미등록 취급. 기존 정상 알람·타 경로 무영향(격리). ✅
- **롤백레일**: `REDPAY_UNREG_ALARM_MODE=realtime`(즉시 구 cadence) + cron unschedule + migration rollback. ✅

## 게이트 (deploy-ready 차단 사유)
- 신규 테이블 = **§S2.4 데이터 정책 게이트** → **data-architect CONSULT 선행 필수**. CONSULT GO 전 `deploy_ready` 금지.
- CONSULT GO 시: `db_changed=true` 전환 + prod DDL apply(dry-run+rollback) + deploy-ready 5필드 충족 → supervisor QA.
- 발송시각 기본 09:00 KST → responder 통해 현장 확정(확정 시 cron.schedule 만 교체, 코드 무영향).
