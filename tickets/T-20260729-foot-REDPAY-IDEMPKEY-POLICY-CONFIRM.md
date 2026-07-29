---
id: T-20260729-foot-REDPAY-IDEMPKEY-POLICY-CONFIRM
domain: foot
priority: P1
status: deploy-ready
qa_result: pass
deploy_commit: ba327547
deployed_at: n/a (no prod change — EF 런타임 로직 무변경, 회귀테스트+보고서만)
bundle_hash: n/a (ef_only, no FE bundle)
db_change: false
e2e_spec_exempt_reason: ef_only
created: 2026-07-29
assignee: dev-foot
summary: 레드페이 웹훅 멱등키 정정 검증 — 현행 이미 trxid+status+amount(정본) → 무변경 종결 + 송도 동시승인/취소 보존 회귀 가드 추가
---

# T-20260729-foot-REDPAY-IDEMPKEY-POLICY-CONFIRM

레드페이 웹훅(WEBHOOK-RECV-EF = `supabase/functions/redpay-webhook`) 멱등키 정정.
최필경 총괄 자기정정: 이전 "trxid 단독 멱등키" 지시는 오류(같은 trxid로 동시각 승인/취소 시 취소가 승인 중복으로 흡수됨).

## AC-1 — 현행 멱등/중복판정 로직 실측 보고 (완료)

**WEBHOOK-RECV-EF 현행 멱등키 = `(external_trxid, external_status, amount)` = trxid + status + amount.**

증거 (실측, 코드+DDL 대조):

| 위치 | 실측값 |
|------|--------|
| EF upsert onConflict | `supabase/functions/redpay-webhook/index.ts:357` → `onConflict: "external_trxid,external_status,amount"` |
| EF upsert 모드 | `ignoreDuplicates: false` → onConflict DO UPDATE (merge-safe 빌더가 폴러 소유 컬럼 제외) |
| DB UNIQUE 제약 | `supabase/migrations/20260607190000_pay_recon_port.sql:81` → `CONSTRAINT redpay_raw_trx_unique UNIQUE (external_trxid, external_status, amount)` |
| status 도메인 | Y=승인 / N=취소 / M=부분취소 / X=오류 (`verify.ts normalizeStatus`, event_type·status 파생 — 금액부호 무판별, AC-2.4) |
| amount | 원부호 보존 (`verify.ts buildWebhookRawRow:183`) |

→ **이미 trxid+status+amount (정본 정책의 가장 안전한 형태)**. trxid 단독이 아님.
   폴러(redpay-reconcile)와 동일 유니크 키로 이중적재 없이 같은 행에 수렴.

## AC-2 — 조건 분기 판정: **무변경 종결 (no-change close)**

정본 정책 = 멱등키 trxid+status(+amount). 현행이 이미 trxid+status+amount이므로
**"이미 trxid+status+amount이면 무변경 유지, trxid 단독으로 바꾸지 말 것"** 분기에 해당.
→ EF 런타임 로직 **무변경**. trxid 단독으로 절대 축소하지 않음.

회귀검증(신규 회귀 가드 추가): `supabase/functions/redpay-webhook/verify.test.ts`
`"송도 동시 승인/취소 보존(AC-4)"` 테스트 — 두 불변식 동시 실증:
- ① 같은 trxid(28226869) 동시각 승인(Y,+968000)/취소(N,−968000) → status·amount 상이 → **별 row 보존**(취소 흡수 금지). status 상이(Y≠N)만으로도 금액부호 무의존 분리 보장.
- ② 진짜 중복(동일 trxid+status+amount 재수신) → 동일 키 → upsert no-op(**1행 수렴, 중복 차단**).
- ★ trxid 단독이었다면 ①이 깨짐(승인·취소 동일 키 → 흡수)을 명시적으로 assert하여 재발 회귀 가드로 고정.

`deno test` 결과: **22 passed / 0 failed** (신규 테스트 포함).

## AC-3 — DB 게이트: **db_change=false 유지**

신규 컬럼/테이블/enum/UNIQUE DDL 추가 **없음**. 기존 `redpay_raw_trx_unique` UNIQUE 제약이
이미 (external_trxid, external_status, amount) — 정본과 일치. 순수 무변경 확인 + 테스트 추가.
→ **db_change=false**. DA CONSULT 게이트 대상 아님(신규 오브젝트 0). mig evidence 4필드 불필요.

## AC-4 — 송도 10건 보존 실증

branch = 무변경(정정 없음)이므로 "정정 후" 백필/재적재 불필요.
송도 8자 형식(예 trxid 28226869 동시각 +968,000 승인/−968,000 취소 10건)은
**현행 UNIQUE 키가 승인(Y)·취소(N)를 서로 다른 status로 이미 별 row 분리** → 흡수된 적 없음(구조적 보존).
회귀 테스트가 이 보존 불변식을 코드레벨로 실증·고정.
(prod DB 실 샘플 보존 카운트 확인이 추가로 필요하면 supervisor/DA read-only 조회로 확정 가능 — read-only, 정정 불요.)

## 승인번호 키 사용 정책 (기존 지시 유효)

승인번호(approval_no)는 당일 범위 밖에서 멱등키로 사용하지 않음. 현행 키는 approval_no를
멱등키에 포함하지 않으므로 위반 없음(approval_no는 row에 저장만, 키 아님).
