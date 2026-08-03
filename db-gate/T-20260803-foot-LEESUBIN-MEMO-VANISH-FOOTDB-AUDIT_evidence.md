# T-20260803-foot-LEESUBIN-MEMO-VANISH-FOOTDB-AUDIT — 풋 leg READ-ONLY 감사 스냅샷

> PHI 정책(§4.3 UUID-PK-only): 환자 참조는 reservation_id 로만. 환자 실명·연락처·임상 memo 본문은 미기재.
> registrar(=스태프)명은 AC-4 교차분석상 필수라 유지.

- **모드**: READ-ONLY (write/DDL/복구 0건). 러너: `scripts/T-20260803-foot-LEESUBIN-MEMO-VANISH_audit_ro.mjs` (비-SELECT/WITH 차단 가드 내장).
- **DB**: rxlomoozakkjesdqjtvd (foot prod), Management API `/database/query`.
- **감사 대상**: clinic jongno-foot = 74967aea-a60b-4da3-a0e7-9c997a930bc8, 2026-08-03 세션.
- **부모**: T-20260803-dopamine-FOOTRESV-MEMO-VANISH-LEESUBIN-DIAG (AC-4 교차도메인 게이트).

## 0. 풋측 memo 저장 구조 (판정 전제)
- **FE 가 read 하는 SoT = `reservation_memo_history`(rmh)**. `reservations.memo`/`booking_memo` = deprecated(T-20260504-MEMO-RESTRUCTURE, FE 미read).
- rmh 는 `uq_rmh_resv_source` (reservation_id, source_system) **partial-unique 로 파티션** — 사람저작(source_system=NULL)과 dopamine-sync(source_system='dopamine')는 **서로 다른 행**. → 도파민 re-push 는 사람 메모 행을 덮거나 지울 수 없다(파티션 독립).
- 풋 ingest EF `reservation-ingest-from-dopamine` → `syncReservationMemoToTimeline()` line 111~113: **`if (!content) return;` (빈값 no-op skip)**. delete 경로 없음. 비어있지 않은 content 만 insert 또는 content UPDATE.
- rmh 스키마에 **updated_at / soft-delete(deleted_at) 컬럼 없음** → content UPDATE·hard DELETE 시 이전값 흔적 0.

## AC-1 — 대상행 64ff1d87 최종구분: **미착지 (dopamine memo 한번도 안실림)**
| 필드 | 값 |
|---|---|
| reservation id | 64ff1d87-9e32-411a-9491-17c776b9eb27 |
| 환자/연락처 | (PHI 생략 — 티켓 본문 참조) |
| source_system | dopamine · registrar 이수빈 |
| created_at | 2026-08-03 06:07:28Z = **15:07:28 KST** (= 티켓 emit 시각 일치) |
| updated_at | 2026-08-03 06:53:20Z (status→checked_in) |
| reservations.memo / booking_memo | **NULL** (deprecated 축, 무의미) |
| rmh(dopamine) | **0행** ← dopamine memo 미착지 |
| rmh(human, source=NULL) | 1행: 작성자 이수빈, 헤더 `<초진&meta&foot&이수빈&20260803>`, created **08:23:50Z=17:23 KST** (임상 본문 PHI 생략) |
| reservation_logs | **0건** (해당 행 감사엔트리 없음) |

**판정근거**: (a) dopamine-source rmh 행이 애초에 없음 → 착지한 적 없음. (b) 풋 ingest 는 rmh delete 경로가 없고 빈값은 skip → 착지 후 삭제(증발) 구조적 불가. (c) FE-visible 메모는 이수빈이 15:07 이후(17:23) **수기로 재작성**하여 현재 온전. ⇒ **미착지** 확정, 증발 아님.

## AC-2 — 이수빈 push-origin 예약 memo 3분류 (전수 255건)
| 분류 | 건수 | 근거 |
|---|---|---|
| **정상** (dopamine memo 착지) | **244** | rmh(dopamine) 1행 · content 전부 실값(길이 min29/avg83/max175, 빈행 0건). 이 중 일부는 human 행과 **공존**(파티션 독립, 상호 무간섭). |
| **미착지** (dopamine memo 미착지 + human 존재) | **11** | rmh(dopamine)=0 · human rmh 만 존재. freeze셋 아래. |
| **증발** (착지 후 삭제/overwrite) | **0** | 풋측 positive 증거 0. rmh delete 경로는 FE 수기삭제뿐(ingest 무관)이고 그 흔적도 없음. |

**RC(c) `input.memo ?? null` overwrite 개별 판정 (풋 실데이터)**: **풋 rmh SoT 기준 REFUTE.**
- null/empty 인입 → 풋 `if(!content) return;` **no-op skip** → 기존 dopamine 행 content 보존, 사람 행 무관(파티션). null-clobber 로 rmh 를 덮거나 비울 **구조적 경로 없음**.
- landed-but-empty(착지했으나 빈 content) dopamine 행 = **0건** → "덮여서 비워진" 흔적 없음.
- RC(c)의 풋측 관측 귀결 = **미착지**(모든 push 가 memo 를 못실어 dopamine 행이 생성된 적 없음)이지, 착지행의 overwrite/vanish 가 아님.

### freeze셋 — 이수빈 미착지 11행 (재검증용 동결, reservation_id only; ★복구 write 는 본 티켓 범위 밖)
모두 human rmh 존재 = **이미 수기 remediation 완료**(추가 풋 backfill 불요). 작성자·시각만 기재(환자·본문 PHI 생략):
```
64ff1d87-9e32-411a-9491-17c776b9eb27  human memo 08-03 17:23 (이수빈)
481ee999-7566-447d-b747-afa0c092dc1a  human memo 08-03 16:18 (이수빈) + 방문확인 09:15 (김지혜)
6e985137-c64c-4ad1-b6cb-b883f7eb5f86  human memo 07-30 06:06 (이수빈)
a3ac8590-03ad-4474-87a7-6678396f9267  human memo 08-03 07:28 (이수빈)
6ba5cd83-c162-4e0a-aecf-0e9c3b7324fa  human memo 08-03 07:37 (이수빈)
cc45ce5e-c42f-48c9-ba5e-77ab4dec6500  human memo 07-16 +11s (이수빈)
36b2cb0d-b5ba-48a9-81e0-5643b3fb5db8  human memo 07-16 (이수빈)
bce04396-bf13-4906-b1ac-1f93109013c6  human memo 07-15 +67s (이수빈)
57cb5444-297d-44e3-b726-3dc13544ece9  human memo 07-15 (이수빈)
666be289-bcce-4431-954f-f823357c9394  human memo 07-15 (이수빈)
0e42c8a9-250e-47aa-84d6-1ad12a5837a8  human memo 07-15 (이수빈)
```
※ 6건(cc45ce5e/36b2cb0d/bce04396/57cb5444/666be289/0e42c8a9)은 human memo 가 예약생성 **수초~수분 내** 작성 = 애초 도파민 memo 부재 상태로 이수빈이 풋에서 직접 최초작성(도파민 memo 존재 자체가 불확실). 4건(64ff1d87/481ee999/a3ac8590/6ba5cd83)은 08-03 오전 일괄 재작성 = 누락 인지 후 backfill.

## AC-3 — 증발행 backfill freeze셋 + 복원소스 존부
- **증발 판정행 = 0** → 풋측 소급복구 대상 **없음**. 미착지 11행은 전부 human memo 로 이미 자가치유됨(원내 미삭제 재검증: 위 freeze셋 현재 rmh 온전).
- **풋측 memo 원값 복원소스 = 없음**:
  - rmh: updated_at/history/soft-delete 컬럼 무 → overwrite/삭제 시 원값 복원 불가.
  - reservation_logs: **deprecated `reservations.memo`(전부 NULL)만 추적** → 이수빈 dopamine 198엔트리(reschedule99/status_change44/cancel44/restore10/update1) 中 memo_cleared **0건**, old_memo_present **0건**. rmh 미추적 → 복원소스 무효.
  - ⇒ 원 TM memo 원값은 **도파민측(cue_cards/TM memo store)** 에서만 복원가능 = 풋 범위 밖(dopamine leg).

## AC-4 — 이수빈 1인 한정성: **REFUTE (풋측)**
"dopamine memo 미착지 + human 재작성" 현상은 **전 고volume registrar 에 volume 비례 분포**, 이수빈 전용 아님:
| registrar | dopamine 예약 | 미착지(human존재) | 비율 |
|---|---|---|---|
| 이수빈 | 255 | 11 | 4.3% |
| 김효신 | 234 | 4 | 1.7% |
| 진운선 | 232 | 6 | 2.6% |
| 강솔희 | 39 | 3 (+1 무memo) | 7.7% |
| [도파민TM] 강솔희 | 9 | 2 | — |
- 풋측 RLS(rmh_clinic_access)·워크플로·push payload 처리는 registrar 무차별(ingest EF 는 registrar 로 분기 안 함). 이수빈이 절대건수 최다인 것은 취급 예약수 최다 때문 = 노출 표본 크기 효과. **풋측에 이수빈만 격리하는 차이 없음.**

## 종합 (planner 회신 요지)
1. **증발(실삭제) 0건** — 풋 rmh SoT 상 착지 후 소실 경로 구조적 부재.
2. **RC(c) overwrite 는 풋 rmh 기준 REFUTE** — null/empty 는 no-op skip, 파티션 독립. 풋측 귀결은 **미착지**.
3. dev-dopamine 의 "원인 leg=도파민 emit" 은 정합 — 풋은 못실린 memo 를 받은 것(미착지)이지 받아서 지운 것(증발) 아님. forward-fix(carve-out + isReconfirm 가드)는 emit 이 memo 를 계속 싣도록 하는 게 정답축.
4. 소급복구 트랙: 풋측 복원소스 없음 → 도파민 store 가 유일 원본. 미착지 11행은 이미 수기치유 = 긴급복구 불요. dopamine 측 미착지 모수(전 registrar) 산정은 dopamine leg 판단.
