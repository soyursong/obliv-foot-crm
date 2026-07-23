# T-20260724-foot-DUMMY-NORMALIZE-OOB-HOLD-GUARD — ① 진원 pin (READ-ONLY) + ② hold-aware 가드 설계

- 수행: dev-foot / 2026-07-24. **① = READ-ONLY forensics (prod mutation 0)**. **② = 설계 산출 (코드/DDL 확정·apply 0)**.
- 러너: `scripts/T-20260724-foot-DUMMY-NORMALIZE-OOB-HOLD-GUARD_origin_probe.mjs` (Management API `/database/query`, guard 로 mutation/DDL 정규식 차단 — SELECT only).
- PHI 위생: phone 평문 미기재 — updated_at·행수·with_rrn·PK8(prefix 8)·구조지문만. 평문 필요분 없음(전량 git-safe).
- SSOT 계승: `_handoff/T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION_recharacterize-forensics.md` §①·§⚠부수발견 (batch 지문 원출처).

---

## ① OOB dummy-normalize corrective 진원 pin (operator / 경로 / cadence)

### 결론 (HIGH / 실증)
07-18/21/22 dummy-normalize batch는 **git·schema_migrations·pg_cron·서버함수·트리거 그 어디에도 없는, 사람 operator 의 수동(ad-hoc) out-of-band SQL UPDATE** 이다. 스케줄러/자동화 소산 아님.

`UPDATE public.customers SET phone = 'DUMMY-'||gen_random_uuid() WHERE <masked-phone predicate>` 이 **prod 에 직접(psql / Management API `/database/query` / Supabase SQL editor) 수동 실행**된 것. DA-20260709 이 승인한 것은 (i) *bounded one-shot* 4행 CORRECTIVE + (ii) insert-time write-path 뿐 — **masked 코호트 반복 batch UPDATE 는 DA 미승인·git 무접점.**

### 용의 경로 전수 배제 (5분기 close)
| 후보 경로 | 판정 | 근거 (probe/grep 실측) |
|---|---|---|
| **committed 스크립트** (`T-20260702…normalize.sql`) | ✗ 불가 | 프로즌 4-PK + `phone IN ('0','000','000-0001-1111','000-0111-0000')` + `abort if ≠4`. masked 행(tail4 등) 접촉 시 EXCEPTION. **one-shot, 반복·masked 불가.** repo 내 `SET phone='DUMMY-'` writer 는 이 1건 뿐(grep 전수). |
| **pg_cron 스케줄** | ✗ | pg_cron 1.6.4 설치·active job 8개 전수 확인 — notif-reminder/keep-warm/retry-failed/dopamine-callback/redpay-reconcile/attendance-sync/closing-confirmed. **phone-normalize job 0건.** |
| **서버함수/RPC** | ✗ | 본문에 `'DUMMY-'` 담은 pg_proc = `is_dummy_phone`(predicate, write 0) · `self_checkin_with_reservation_link`(`writes_phone_dummy=false`,`uses_uuid=false`). **`SET phone='DUMMY-'||uuid` write 함수 0건.** |
| **트리거** | ✗ | customers 트리거 6종 전수 — `set_phone_dummy`(bool 파생만, SSOT=phone) 외 phone-값 생성 트리거 0. maskreject/nfc/updated_at/sync_name 은 값 생성 아님. |
| **self_checkin write-path** | ✗ (batch UPDATE 주체 아님) | write-path 는 per-row insert-time mint → 행별 distinct timestamp. 관측된 건 **동일 마이크로초 다행 batch UPDATE** → insert-path 소산 아님. |

→ 소거법 확정: **남는 유일 경로 = 사람 operator 의 수동 OOB SQL.**

### operator 지문
- **누구**: prod DB write 권한 보유자(service_role / Management API access-token / SQL editor). 07-10~07-24 PII-위생 사고대응(mask-contam / maskreject / E164 백필) 라인의 dev-foot 계열 수동 정정 작업 흐름과 정합. **자동 에이전트/봇 아님(스케줄·함수 부재).**
- **actor 로그 직접 pin 불가(정직 caveat)**: `phi_access_log` 에 old-value·mutation-actor 컬럼 부재(access-event only, `created_at` 컬럼조차 스키마 상이 → 조회 실패). `customers_audit`/change_log 부재. → operator 개인 특정은 DB-native 로 불가, **경로·성격(수동 OOB)만 실증.**

### cadence = 반응성 수동 (스케줄 아님)
DUMMY-% 코호트 updated_at batch 지문 (probe 실측):

| batch (UTC) | KST | 행수 | with_rrn | 마이크로초그룹 | 해석 |
|---|---|---|---|---|---|
| 2026-07-10 23:42:19 | 08:42 | 4 | 1 | 1 (단일 stmt) | STAGE2 one-shot 원형(4 legacy literal) |
| 2026-07-18 11:12:16 | 20:12 | 3 (ROW1 포함) | 2 | 1 (단일 stmt) | masked 코호트 수동 sweep |
| 2026-07-21 11:32:10 | 20:32 | 1 | 0 | 1 | **개별 단행** |
| 2026-07-21 11:32:11 | 20:32 | 1 | 0 | 1 | **개별 단행 (+1초)** |
| 2026-07-21 11:32:12 | 20:32 | 1 | 0 | 1 | **개별 단행 (+1초)** |
| 2026-07-21 11:32:37 | 20:32 | 1 | 0 | 1 | **개별 단행 (+25초 gap)** |
| 2026-07-22 21:29:19 | 06:29 | 8 | 3 | 1 (단일 stmt) | masked 코호트 수동 sweep |

- **스케줄 아님 실증**: 실행시각 KST 08:42/20:12/20:32/06:29 = 불규칙 사람 근무시간, 고정 cron slot 아님. 간격 3·3·1일 = 등간격 아님.
- **★ 07-21 = 손실행 결정타**: 1초 간격 단행 3개 + 25초 gap 후 4번째 = **사람이 대화형으로 한 행씩 UPDATE 실행**한 지문. 스크립트/스케줄은 다행 단일 stmt(07-10/18/22 처럼 마이크로초 1그룹)로 찍힘. → cadence 트리거 = **operator 가 masked-phone 누적을 주기적으로 눈으로 확인하고 반응적으로 재적용**(사고대응 창 07-13~07-24 중).

### ① 산출 요약 (AC1)
- **operator**: 사람(prod write 권한자, dev-foot 사고대응 라인). 자동화 아님.
- **경로**: OOB 수동 SQL `UPDATE customers SET phone='DUMMY-'||gen_random_uuid() WHERE <masked predicate>`. git/ledger/cron/함수/트리거 전부 무접점.
- **cadence**: 반응성 수동(스케줄 無). 07-21 단행-per-초 지문이 대화형 hand-run 실증.

---

## ② hold-aware 가드 설계 (AC2)

### 문제 재정의
masked-phone corrective 의 predicate(`phone에 '*' 포함 OR 유효자릿수 1~7`; MASK-CONTAM-BACKFILL `isPhoneMasked` 와 동치)는 **hold-row 를 인지하지 않는다.** ROW1(tail 9089 = 4자리 → masked predicate 매칭)이 [G0-hold] 임에도 07-18 sweep 됨. mask-contam backfill 은 [G0-hold] fail-closed 제외했으나(그 backfill 은 미적용), **수동 OOB corrective 는 SOP 밖이라 그 제외를 상속하지 못함.**

**핵심 제약**: corrective 가 *수동·OOB* 이므로 "predicate 한 곳만 고치면 된다"는 성립하지 않음(고정 코드 지점 부재). → operator 선의에 의존하지 않는 **DB-enforced 구조 가드**가 필요.

### 옵션 평가
| 옵션 | 내용 | 평가 |
|---|---|---|
| (a) predicate 제외 | corrective SQL 에 `AND id NOT IN (hold set)` 이식 | 필요조건이나 **불충분** — OOB 수동 SQL 이 그 조건을 포함할 보장 없음(operator 망각 시 무력). |
| (b) git ledger·gated 편입 | 향후 corrective 를 committed 스크립트+SOP freeze 경로로만 | 재현성·감사성 확보 O. 단 **수동 직접 SQL 을 물리적으로 못 막음**(프로세스 규율). |
| (c) hold-row registry + DB-enforced 가드 | 진행중 cleanup/forensics hold 대상 SSOT 테이블 + **BEFORE UPDATE 트리거가 hold-flagged 행의 phone→DUMMY write 를 fail-closed 차단** | operator 선의 무의존·구조적. **채택.** |

### 권고 = **(c) 주축 + (b) 보강 + (a) 계승** (defense-in-depth)
1. **(c) hold-registry SSOT** — `data_correction_hold_registry(clinic_id, target_table, target_pk, hold_ticket, reason, created_by, created_at, released_at)`. 진행중 cleanup/forensics 대상행을 등록(ROW1 = 현 항목). = 옵션 c 의 "corrective 공통 pre-check SSOT".
2. **(c) DB-enforced 가드** — customers `BEFORE UPDATE` 트리거: `NEW.phone LIKE 'DUMMY-%' AND OLD.phone NOT LIKE 'DUMMY-%'`(=dummy-normalize write) 이고 대상 id 가 active hold(released_at IS NULL) 이면 `RAISE EXCEPTION`(fail-closed). → **수동 OOB SQL 도 DB 레벨에서 차단**. 정상 스태프 편집(→실번호)·write-path insert-mint 는 매칭 안 됨(범위 좁게 phone→DUMMY 전이에만).
3. **(b) 감사성** — 향후 masked-normalize corrective 는 committed 스크립트(SOP freeze + before-image + hold-registry pre-check)로만. 수동 직접 SQL 지양을 SOP/런북에 명문화.
4. **(a) 계승** — 그 committed corrective predicate 에 `LEFT JOIN hold_registry ... WHERE h.target_pk IS NULL` 제외를 표준 스니펫으로.

### db_change 재평가 + 게이트 라우팅
- **db_change = YES (설계 확정·apply 단계에서).** 신규 테이블(`data_correction_hold_registry`) + 신규 트리거/함수 = **ADDITIVE**, 롤백 = `DROP TRIGGER`+`DROP FUNCTION`+`DROP TABLE`.
- **§S2.4 데이터정책 자문 게이트 발동**: 신규 테이블 + cross-corrective 규율(데이터정책축) → **apply 전 data-architect CONSULT 필수**(hold-registry 를 cross-CRM 공통 SOP 로 승격할지 = DA 소유 판단). 본 티켓은 **설계까지** — apply 는 DA CONSULT-REPLY GO → supervisor DB-GATE → (ADDITIVE 이므로 대표게이트 면제 여부 DA 확인) 순.
- **현 티켓 mutation 0 유지.** 코드/DDL 미확정. [G0-hold] 존치.

### 부모 트랙 의존 해소 관점
- 부모 T-20260715 ROW1 DUP-CLEANUP 파괴 apply 는 본 가드 확정 전까지 hold(티켓 frontmatter `related` 의 blocked_by 링크). 본 설계의 (c) hold-registry 가 서면 → ROW1 이 registry 에 등록된 채 파괴 op 재개 시에도 dummy-normalize 재-sweep 물리 차단 → freeze-window 무결 보장.

---

## AC 대사
- [x] ① OOB dummy-normalize corrective 진원(operator=사람 수동 / 경로=OOB SQL / cadence=반응성 수동) pin — READ-ONLY 근거(probe 실측 5분기 close).
- [x] ② hold-aware 가드 설계안 — **옵션 (c) 주축 + (b)(a) 보강** 채택 + 근거.
- [x] ② db_change 재평가(=YES, ADDITIVE, apply 단계) + DA CONSULT / supervisor DB-GATE 라우팅 명시.

## 핸드오프
- **planner FOLLOWUP**: ① 진원 pin 완료(수동 OOB·스케줄無 실증), ② 가드 설계 확정 → **apply 는 DA CONSULT 선행 필수**(신규 테이블·cross-corrective 데이터정책축). planner: ② apply 를 별도 db_change 티켓으로 승격 + DA CONSULT 라우팅 요망.
- 본 트랙은 재특성화(T-20260724…RECHARACTERIZE)·부모 파괴 apply 와 **독립**(block 안 함) — 단 부모 파괴 apply 의 freeze 무결 선행의존으로 DA 가 승격(부모 blocked_by).
