---
id: T-20260723-foot-REDPAY-PLANB-OBSERVE-MODE
domain: foot
status: deploy-ready
qa_result: pass
deploy_commit: e6bc1688b202
deployed_at: n/a (NOT yet deployed — supervisor DDL apply(received_at) + EF deploy 선행)
bundle_hash: n/a (ef_only — EF/폴러 배포, CF Pages bundle 무관)
e2e_spec_exempt: ef_only
priority: P2
depends_on: T-20260723-foot-REDPAY-PLANB-DDL-BUILD (received_at 컬럼 prod 적용 후 observe write 활성)
db_change: 없음 (기존 redpay_raw_transactions.received_at[DDL-BUILD] + raw_payload JSONB 재사용, 신규 오브젝트 0)
da_consult: 불요 (신규 컬럼·테이블·enum 0 — received_at/pending_payment 은 DDL-BUILD DA-20260723 기승인, 본 build 은 코드+read-only 쿼리)
---

# T-20260723-foot-REDPAY-PLANB-OBSERVE-MODE — 레드페이 플랜B 관측모드 BUILD

## 요약
`PAYMENT_AUTO_MODE` 를 3-state(off/observe/auto) 단일 플래그로 확장하고, **observe(관측 전용)** 경로를 신설.
관측모드는 웹훅 raw 를 전량 적재하고 수신시각(`received_at`)만 기록하며, **매칭·payments write 를 일체 발화하지 않는다.**
폴러(redpay-reconcile)는 관측행을 매칭/대사 대상에서 제외해 실 payments 로의 승격을 금지한다.

## 근거
- reporter(최필경) SPEC v1.0 §7·§9 step1 + §5 위임경계 confirm (MSG-20260723-145815-d4yt).
- 현행: OFF=raw skip / ON=raw+폴러매칭 2단(WEBHOOK-PLANB done, d461ab1e). 그 사이 '관측 전용' 신설이 본 태스크.

## AC 충족
| AC | 구현 | 위치 |
|----|------|------|
| 1. 관측 3단(observe) 도입 + raw+received_at 저장 | `PAYMENT_AUTO_MODE=observe` 3-state 확장(단일 플래그 SSOT, 별도 플래그 병존 회피). `_mode:'observe'` 마커 + `received_at=now()`(서버 수신시각) | verify.ts `resolvePaymentMode`/`buildWebhookRawRow`, index.ts §6·§7 |
| 2. ★관측 시 매칭·payments 자동생성 미발화 (write 0 자기검증) | 웹훅은 구조적으로 payments/pending_payment write 안 함. 런타임 안전가드: row 에 matched_payment_id/match_rule 혼입 시 즉시 500 중단. 서명검증·멱등·merchant 풋필터·business_no(511) 방어필터는 그대로 통과 | index.ts §7 SAFETY 블록 |
| 3. 폴러가 observe 적재행 매칭/대사 제외 | DB or-필터(`OBSERVE_EXCLUDE_FILTER`) + `isObserveRow` JS 2차 방어 — Y 미매칭 조회 + N/X/M 환불추적 양쪽 제외 | redpay-reconcile/index.ts `runMatcher`, matcher.ts `isObserveRow` |
| 4. 2~3일 관측지표 산출 쿼리/뷰 | 5종 SELECT: ①지연(received_at−occurred_at) ②폴러 대비 누락·중복 ③수신순서 ④취소(M) 반영지연 ⑤분할·복합 빈도 | docs/redpay_planb_observe_metrics.sql |
| 5. 기존 경로 회귀 0 | off = 현행 100% 동일(적재 skip). auto(on/true) 하위호환 유지. PaymentMiniWindow 수기입력·사후 대사 무접촉. `isPaymentAutoModeOn` alias 계약 보존 | verify.ts, index.ts |

## 검증
- `deno test` 25건 PASS (webhook verify 21 + reconcile observe 4).
- `npm run build` OK. `deno check` (webhook·reconcile index.ts) OK.
- ef_only 면제(EF+폴러, UI 무변경) → 웹훅 mock POST 시뮬 대체 = 순수함수 통합 테스트로 observe 저장·매칭 미발화·매칭컬럼 0 검증.

## 배포 순서 (supervisor)
1. **선행**: DDL-BUILD(e78ebbae) `received_at` 컬럼 prod 적용(DDL-diff + apply). 미적용 시 observe write 실패 위험 — 단, secret 미설정 시 웹훅이 적재 이전 200(ignored_secret_unset) 반환하므로 실적재는 secret 설정(step2, 필드액션) 이후에만 발생 → 자연 순서 안전.
2. EF 배포: redpay-webhook + redpay-reconcile.
3. 실 관측 개시(필드액션): `REDPAY_WEBHOOK_SECRET` 설정(Supabase EF Secrets, rxlomoozakkjesdqjtvd) + 레드페이 풋 URL 등록 + `PAYMENT_AUTO_MODE=observe`.

## 스코프 밖 (§9 step5, 관측 리포트로 파라미터 확정 후 별도 BUILD)
새 결제페이지 UI(§4.2) · 매칭 자동연결/충돌UI/미배정함(§4.3~4.4) · 분할 선점모드(§5) · TTL(expires_at) 컬럼.
