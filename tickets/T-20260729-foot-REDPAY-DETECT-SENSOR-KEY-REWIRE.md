---
id: T-20260729-foot-REDPAY-DETECT-SENSOR-KEY-REWIRE
domain: foot
priority: P2
status: done
deploy-ready: false
build-passed: n/a
db-change: false
e2e-spec: "ef_only — UI 무변경(관측성 배선 only). AC-2 재현 = node scripts/redpay_envshadow_valuecheck.mjs --ef exit0(합의). evidence/T-20260729-foot-REDPAY-DETECT-SENSOR-KEY-REWIRE/{EVIDENCE.md,ac2-post-rewire-4way-fold.json}"
summary: "DETECT 자동 회귀센서(valuecheck --ef) 배선 env 키 미정렬 봉인. RC: 신 Supabase API 키체계 마이그로 reconcile EF(D) 런타임 주입 SUPABASE_SERVICE_ROLE_KEY = 신 secret key(sb_secret_…)로 전환됐으나, macstudio valuecheck 배선 .env.local 은 legacy service_role JWT(eyJ…) 잔존 → D introspect Bearer 불일치 401 unauthorized_introspection → D 지문 미확보 → 4주체→3주체 축소(D 상시 미편입). FIX: .env.local SUPABASE_SERVICE_ROLE_KEY 를 신 secret key(EF 주입값과 동일 스킴, empirical introspect 200 ground-truth 확정)로 정렬 + legacy JWT 제거. 결과: valuecheck --ef 재실행 → D introspect 200(subject=reconcile-ef, tid_count=40) + 4-way TID/merchant fold 합의 자동 재현(부모 실증 count=40, sha256=aa74b84d03ddf561e27df1d745fad168610773c2f4e3314da97464ab1aa5296f 완전 PARITY), exit0. 관측성 배선 only — behavior 변화 0."
created: 2026-07-29
reporter: planner
parent: T-20260729-foot-REDPAY-RECONCILE-EF-ENVSHADOW-4TH-LOCUS
commit: EVIDENCE_ONLY_NO_SOURCE_CHANGE
risk_verdict: GO_WARN
risk_reason: "무DDL·무prod-deploy·무EF-코드변경 → 대표 게이트·supervisor code-gate 불요(dev 배선 env only). db_change=false(신규 컬럼·테이블·enum 0 → DA CONSULT 불요). 변경 대상 = ~/GitHub/obliv-foot-crm/.env.local 단 1파일(gitignore IGNORED + git UNTRACKED 확인). AC-3 secret 안전: 신 secret key 값 커밋/로그/티켓/MQ/evidence 평문 노출 0건(grep 검증), 백업 chmod 600, reveal-temp secure-purge. AC-4 live 무접촉: introspect route=결제/매칭 POST 경로 top early-return 격리(read-only·no-DB-write·PHI 무접촉), live cron 인증축=x-internal-cron/INTERNAL_CRON_SECRET(별개 축). poller live 적재 secret ~/.env.redpay-foot 무접촉(mtime Jul28), reconcile EF source 무변경(git clean) → 실서비스 매칭/수납/매출 write 회귀 표면 0. 리스크#2 service_role secret 취급 WARN 준수(값 비노출·gitignore-only)."
option_decision: "신 secret key 정체 확정 = empirical ground-truth — 3후보(legacy JWT / sb_secret / publishable)를 D ?introspect=whitelist 로 실측: sb_secret 만 200(subject=reconcile-ef, tid_count=40), 나머지 401. EF 런타임 주입값 = sb_secret 로 특정 후 정렬. Management API reveal=true 로 값 획득(값 비노출)."
---

# T-20260729-foot-REDPAY-DETECT-SENSOR-KEY-REWIRE

부모 T-20260729-foot-REDPAY-RECONCILE-EF-ENVSHADOW-4TH-LOCUS(DEPLOYED/Green) 종결 세션에서
supervisor ★후속 발번 권고(observability wiring — 재배포/코드결함 아님).

## RC
신 Supabase API 키 체계 마이그 → reconcile EF(D) 런타임 주입 `SUPABASE_SERVICE_ROLE_KEY` = 신 secret key.
macstudio valuecheck 배선 `.env.local` 은 legacy service_role JWT 잔존 → DETECT 자동센서(`valuecheck --ef`)가
D introspect 에 legacy 키 전송 → EF `bearer !== SUPABASE_SERVICE_ROLE_KEY`(index.ts L297) → 401 → D 상시 미편입.

## FIX / 결과
`.env.local` `SUPABASE_SERVICE_ROLE_KEY` → 신 secret key(`sb_secret_…`) 정렬 + legacy JWT 제거.
`valuecheck --ef` exit0(합의) — D introspect 200, 4주체 TID/merchant fold 합의, 부모 실증
count=40/sha256=aa74b84d 완전 PARITY.

상세 evidence: `evidence/T-20260729-foot-REDPAY-DETECT-SENSOR-KEY-REWIRE/EVIDENCE.md`.
