# 데이터 백필 패키지 + AC5 정책 확정 — T-20260610-foot-SMS-OPTIN-BACKFILL-REJECT

> 산출: dev-foot · 2026-06-10 · **supervisor DB 게이트(AC1) 대기. count 확인·GO 전 무변경.**
> 부모: T-20260609-foot-CHART-CONSENT-ALIGN-SMS (deployed, 신규/차트편집분 정합 완료)
> risk_verdict: **BLOCK** — 대량 동의데이터 write. dev-foot 자동 실행 금지.

## TL;DR (supervisor DB 게이트 요청)
- **단일 backfill**: `customers` 중 `sms_reject=true AND sms_opt_in IS NULL` 행 →
  `sms_opt_in=false`(+ `sms_opt_in_at=NULL`) 로 보정. 과거 수신거부 고객을 자동발송 제외 정합.
- **갭 근원**: 자동발송 Edge Fn(`send-notification/index.ts` L760-769)은 `sms_opt_in===false` 일 때만 SKIP.
  과거 OLD 차트 거부고객은 `sms_opt_in=NULL` 로 남아 필터에 안 걸림 → 여전히 발송 대상.
- **방향**: 발송 차단(정보통신망법 수신거부자 발송금지 부합) — compliance positive, 데이터 손상 위험 낮음.
- **사람 게이트 사유**: BLOCK 은 충돌이 아니라 대량 동의데이터 write 라서 count 확인을 사람이 봐야 함.

## ⚠️ supervisor 실행 순서 (불변)
1. **DRY-RUN count 단독 실행**(READ-ONLY):
   ```sql
   SELECT count(*) AS affected_rows
     FROM public.customers
    WHERE sms_reject = true AND sms_opt_in IS NULL;
   ```
   → **`affected_rows` = `__________`** (실행 후 기입) 를 **김주연 총괄(U0ATDB587PV)/대표에게 제시(AC1)**.
2. 김주연/대표 **count 확인 수신** 후에만 `datafix.sql` 의 STEP0 백업 → BEGIN/COMMIT 실행.
3. 실행 후 **AC4 검증**(아래).

> **count 확인 전 UPDATE 절대 금지.** (티켓 분업 3·AC1)

## AC5 — `sms_opt_in_at` 채움 정책 = **NULL** (NOT now()) ★ dev-foot 확정
티켓 ⚠️("발송 제외 판정 영향 없으면 now() 허용, UI 노출되면 NULL")를 자동발송 Edge Fn + 동의이력 로직과 대조한 결과:

| 대조 축 | 결과 | 함의 |
|---|---|---|
| 발송 제외 판정 영향 | **없음** — Edge Fn 은 `sms_opt_in===false` 만 읽음. `send-notification` 에 `sms_opt_in_at` 참조 **0건**(grep 전수). | "now() 허용" 조건은 형식상 충족하나 결정 근거 안 됨 |
| 동의이력 UI 노출 | 차트에 `sms_opt_in_at` 직접 렌더 **없음**(노출되는 건 `hira_consent_at` L4075-4077 뿐) | UI 기준으로도 강제는 아님 |
| 코드베이스 불변식 | **`false ⇒ NULL` 강제** — T-20260602-foot-CONSENT-TIMESTAMP-COLS 계약. 全 write 사이트가 `value ? now() : null`: CustomerChartPage L2950, SelfCheckIn L1213/L1236 | **결정 근거** |

→ **NULL 확정.** `sms_opt_in_at` 의미는 "수신 **동의** 시각". `false`(거부) 행에 `now()` 를 채우면
어떤 UI/토글도 만들 수 없는 모순 상태가 되어 불변식이 깨짐. 백필도 false 행이므로 NULL 유지.
(대상 행은 애초에 `sms_opt_in_at IS NULL` → 명시 `SET NULL` 은 방어적 no-op, 불변식 보존 의도.)

> 티켓 초안 SQL 은 `SET sms_opt_in_at = now()` 였으나 위 불변식 근거로 **`= NULL` 로 정정**(AC5 위임 범위 내 dev 확정).

## AC 대응
- **AC1**: dry-run count 를 supervisor 게이트가 김주연/대표에게 제시·확인 후 실행 — 위 실행순서 1~2 강제.
- **AC2**: `WHERE sms_reject=true AND sms_opt_in IS NULL` 조건 + 가드로 이미 false/true 행 미변경(멱등).
- **AC3**: 롤백 — STEP0 백업 테이블 `_datafix_bk_T20260610_sms_optin_reject`(변경 대상 id+원본값 스냅샷) + `rollback.sql`.
- **AC4**: 실행 후 `SELECT count(*) WHERE sms_reject=true AND sms_opt_in IS NULL` = **0**. 자동발송 제외 확인.
- **AC5**: 위 표 — `sms_opt_in_at = NULL` 확정.

## 산출물
- `datafix.sql` — DRY-RUN(주석) → STEP0 백업 → BEGIN/COMMIT `UPDATE sms_opt_in=false, sms_opt_in_at=NULL`(가드 포함) → AC4 검증(주석).
- `rollback.sql` — 백업 원본값(NULL)으로 `sms_opt_in/sms_opt_in_at` 복원(가드: 백필로 false 된 행만).
- `dry_run_report.md` — 본 문서(게이트 요청 + AC5 근거).

## 게이트 요청
- **supervisor (DB게이트)**: ① dry-run count 단독 실행 → ② 김주연/대표 제시·확인(AC1) → ③ GO 후 datafix.sql 실행 → ④ AC4 검증.
- **dev-foot**: 본 패키지 산출 완료. 실행 권한 보유하나 BLOCK 이므로 **게이트 승인·count 확인 전 미실행**. 핸드오프함.
