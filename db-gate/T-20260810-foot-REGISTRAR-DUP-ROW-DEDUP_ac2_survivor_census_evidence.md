# AC-2 SURVIVOR CENSUS (RE-SCOPE staff-record dedup) — T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP

**mode: READ-ONLY (SELECT only · WRITE 0 / DDL 0 / DML 0) · ref: rxlomoozakkjesdqjtvd (foot prod)**
DA canonical CONSULT-REPLY = MSG-20260810-225709-8bno (조건부 GO · soft-archive · merge-before-archive)
runner: `scripts/T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP_ac2_survivor_census.mjs` + `_ac2b_edges_auth.mjs`
判定 프레임: INV-8-a 다축 DB ground-truth (name-string 단독 판별 금지) + INV-8-b fail-closed (사람 confirm)

---

## 0. dup 대상 (AC-1 census 4253fbdf 계승 — 실 RC = staff identity dup)
원내(Jongno 74967aea) coordinator 강다연·이진석 각 **active staff 2레코드**. reservation_registrars 축은 각 1행뿐(정리대상 0) → 정정 타깃은 **staff-record**.

## 1. INV-8-a 다축 census 결과

### 강다연 (clinic 74967aea)
| 축 | `4bcf55a2` (08-08) | `0ff81a68` (08-10) |
|---|---|---|
| created_at | 2026-08-08 11:12 | 2026-08-10 02:15 |
| user_id (auth) | **NULL (로그인 불가)** | `08a68143` |
| auth email | — | ekdusrkd1@naver.com |
| **last_sign_in_at** | — | **2026-08-10 03:03 (실 로그인 有)** |
| email_confirmed_at | — | 2026-08-10 02:32 |
| registrar 링크 | 없음 | `00f04818` (1) |
| reference-edge 총계 | **1** (staff_attendance×1) | **14** (health_q_tokens created_by×13 + registrar×1) |

→ **SURVIVOR 후보 = `0ff81a68` (08-10)** · 신뢰=**STRONG**
근거: 유일 auth 계정 + **실 로그인 실사용** + 참조무게 14(실 업무 health_q_tokens 13) + registrar 링크.
loser = `4bcf55a2` (08-08 placeholder·auth無·edge 1).

### 이진석 (clinic 74967aea)
| 축 | `9a429fb7` (08-08) | `884b4571` (08-10) |
|---|---|---|
| created_at | 2026-08-08 11:12 | 2026-08-10 02:15 |
| user_id (auth) | **NULL (로그인 불가)** | `7a5c7012` |
| auth email | — | naspos82@gmail.com |
| **last_sign_in_at** | — | **NULL (미로그인)** |
| email_confirmed_at | — | 2026-08-10 02:13 (confirmed) |
| registrar 링크 | 없음 | `88353cd4` (1) |
| reference-edge 총계 | **1** (staff_attendance×1) | **1** (registrar×1) |

→ **SURVIVOR 후보 = `884b4571` (08-10)** · 신뢰=**MODERATE → INV-8-b 사람 confirm 필수**
근거: 유일 auth 계정(email confirmed) + registrar 링크(coordinator 표시면). 단 **미로그인** + 양측 edge 동률(1) →
자동 판정 불충분 → **HR/현장 per-pair confirm 없이 write 금지(INV-8-b fail-closed)**.
loser 후보 = `9a429fb7` (08-08 placeholder·auth無·staff_attendance×1).

## 2. DA "flip" 가설 확증
DA 경고("08-08 기본가설이나 auth live-login 08-10 이면 뒤집힘 = census dispositive") → **CONFIRMED**.
blanket "구건(08-08) 유지" 규칙은 **오답**. 두 사람 모두 live/canonical identity = **08-10 (auth 보유) 레코드**.
∴ blanket 단일축 택일 REJECT(DA) 준수 — per-pair 다축으로 08-10 survivor 도출.

## 3. merge-before-archive re-point universe (full-FK 기계 열거)
`pg_constraint confrelid=public.staff` = **35 inbound FK** 전수 계수(A0b/A3). loser 실 참조 = **staff_attendance ×1 (각 pair)** 뿐.
- 강다연 loser 4bcf55a2 → staff_attendance 1행 re-point → 0ff81a68
- 이진석 loser 9a429fb7 → staff_attendance 1행 re-point → 884b4571(confirm 후)
나머지 34 FK 에서 loser 참조 = 0 (registrar 링크는 survivor 가 이미 보유 → "사람당 registrar 1개 수렴" 旣충족).

## 4. §416 방화벽 안전성
`reservations.created_by` = **staff FK 아님**(staff inbound FK 목록에 reservations 는 preferred_therapist_id 만) → auth.users 참조 축.
loser 2건은 **user_id=NULL(auth 무링크)** → 어떤 auth-기반 created_by 도 loser 를 참조 불가 → soft-archive 가 §416 귀속 소실 유발 0.
HARD: ON DELETE SET NULL / hard-DELETE cascade 의존 금지 → **soft-archive(active=false) + 명시 UPDATE re-point** 경로만 사용.

## 5. 8쌍 carve 재확인 (불변·정리대상 아님)
원내 김민경·김지혜·박민석·장예지 / TM 김효신·문해민·이수빈·진운선 = 각 종로(74967aea)+송도(b4dc0de5) 1행씩 = **cross-clinic seed(16행)**, staff_id NULL·동일 created_at. within-clinic 진성중복 아님 → 어떤 dedup 배치도 **제외**. (A4 재확인 = 16행 불변)

## 6. 착수 게이트 상태
- ☑ AC-2 survivor census(INV-8-a 다축) 완료 · survivor 후보 도출.
- ☐ **INV-8-b per-pair 사람 confirm** — 강다연(STRONG, confirm 권고) / **이진석(MODERATE, confirm 필수)**.
- ☐ merge-before-archive SQL + before_image + rollback (DRAFT 작성 — §7 SQL, 미실행).
- ☐ **supervisor DB-GATE dry-run(무영속 rows-affected) + 물리 GO-token** → 그 후에만 prod write (apply_before_go 금지).
- ☐ apply → POST-VERIFY(INV-8-c, before_image uid) → 현장(김주연 총괄 C0ATE5P6JTH) confirm.

**prod WRITE 0 유지. GO-token 前 archive/re-point 선집행 금지.**
