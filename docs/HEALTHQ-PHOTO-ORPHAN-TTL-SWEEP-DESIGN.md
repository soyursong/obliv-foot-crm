# 발건강 질문지 사진 orphan TTL sweep — 설계 + dry-run

- **티켓**: T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP (P2, 유지보수·비블로커)
- **부모**: T-20260731-foot-FOOTQST-PHOTO-UPLOAD (deploy-ready, commit d0412c42)
- **선결(DONE)**: T-20260731-foot-HEALTHQ-PHOTO-RETENTION-CODIFY — DA CODIFY DONE (MSG-20260731-152807-sli6)
- **정본 술어 근거**: `memory/1_Projects/201_메디빌더_AI도입/da_decision_foot_healthq_photo_retention_20260731.md` §3
- **db_change**: false (본 문서 = 설계 + READ-ONLY dry-run. DDL·데이터 mutation 0)
- **status**: 설계 완료 + dry-run 러너 준비. **파괴 실행은 미착수** (supervisor 코드리뷰/gated 이후).

---

## 1. 문제

발건강 질문지 자가작성(`/health-q/:token`)에서 사진을 업로드(Pattern B: `health-q-photo-sign` EF 가 token 경로 한정 signed upload URL 발급)했으나 **질문지를 최종 제출하지 않으면**:

- Storage `foot-health-q-photos` 버킷의 `health-q/{clinic_id}/{token}/{uuid}.{ext}` 경로에 **바이너리만 남고**,
- `health_q_results`(질문지 결과행)·`health_q_photos`(사진 참조행)는 **생성되지 않는다**.

→ 주인 없는 PHI 이미지가 저장소에 누적 (draft-orphan). 이를 만료 기준으로 정리하는 배치 잡.

---

## 2. 삭제 2-class (DA §2) — 무엇을 지우고 무엇을 절대 안 지우는가

| class | 상태 | TTL sweep |
|---|---|---|
| **(A) 제출완료** | `health_q_results` 결과행 또는 `health_q_photos` 사진행 존재 | **절대 대상 아님.** soft-delete 만·Storage 영구삭제 금지(의료법 §22·§2-23 #6). freeze-set 재검증 시 혼입되면 batch abort. |
| **(B) draft-orphan** | 부모 결과행·사진행 **미생성** + Storage token 경로에만 바이너리 | **적격.** 원장 미성립 = 진료기록 아님 = 보존대상 아님. |

---

## 3. orphan 판정 술어 — 3-교집합 (단일 기준 blanket 금지)

**적격(B_orphan_ELIGIBLE) = 아래 전부 충족 시에만:**

```
(1) health_q_tokens.expires_at < now()                         -- draft 토큰 만료
AND (2) 대응 health_q_results 행 부재 (token_id 매칭 없음)        -- 질문지 결과 미생성(미제출)
AND (3) 대응 health_q_photos 행 부재 (storage_path 매칭 없음)     -- 사진 참조행 미생성
AND (g) health_q_tokens.used_at IS NULL                        -- [freeze guard] 진짜 미제출
```

- **(1)·(2)·(3) 단독 blanket 삭제 금지** (`data_correction_backfill_sop` doctrine 계승). 3-교집합만이 "제출 안 된 draft 사진"을 안전 특정.
- **(g) freeze guard `used_at IS NULL` 추가 근거**: DA §3 canonical 3-교집합에 dev-foot 이 보수적 4번째 조건을 덧댐. `used_at NOT NULL`(제출 이력 있음)인데 결과행이 부재한 경우 = **제출 후 결과행 삭제된 잔류(post-deletion residue)** 로, DA §2 의 draft "미생성"(never created)과 의미가 다르다. 이 잔류는 (A) 계보이므로 draft-orphan sweep 에 넣지 않고 **별건 검토 클래스(RESIDUE_*)로 격리**한다. → sweep 을 더 좁혀 오삭제를 원천 차단(안전 방향).

### 3.1 판정 불가 → 자동 삭제 금지
- **UNCLASSIFIED_no_token_row**: path 의 token 이 `health_q_tokens` 에 없음(정상 경로상 발생 불가하나 방어). 만료 여부 평가 불가 → **절대 자동 삭제 금지**, 수동 검토 플래그.
- **B_draft_not_yet_expired**: 미제출이지만 아직 만료 전(살아있는 draft) → 대상 아님(만료 대기).

### 3.2 술어 산출물 (본 티켓 deliverable)
- **canonical 술어 SQL**: `scripts/T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP_orphan_predicate.sql` (READ-ONLY, `storage.objects` ⋈ tokens/results/photos, 전 클래스 가시화 + 클래스별 건수).
- **★분류 술어 SSOT 모듈**: `scripts/_healthq_orphan_scan.mjs` — Storage 스캔 + 3-교집합 분류 로직을 **한 곳에** 둔다. dry-run 러너와 sweep 실행기가 이 모듈을 공유 → **술어 drift(=PHI 오삭제 위험) 원천 차단**. env 로더는 `.env`→`.env.local` 폴백(macstudio 개발머신 service_role 위치).
- **dry-run 러너**: `scripts/T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP_dryrun.mjs` (READ-ONLY, SSOT 모듈 소비 → 대상목록·건수 + freeze-set 스냅샷 JSON). Storage move/remove·DB write 0.
- **sweep 실행기(gated)**: `scripts/T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP_sweep_execute.mjs` — archive-first 2단 파괴잡. **기본=PLAN(READ-ONLY)**, `--execute` 플래그 있을 때만 실제 archive+delete. SSOT 모듈 동일 술어 사용. §5 실행 설계의 코드 구현체.

---

## 4. AC 정합화 (DA 3-교집합 기준)

티켓 SSOT 의 AC1 원문("만료 AND 행부재 교집합")은 DA 결정문의 **3-교집합**으로 아래와 같이 정합화한다:

> **AC1 (reconciled)**: orphan = `health_q_tokens.expires_at < now()` **AND** 대응 `health_q_results` 행 부재 **AND** 대응 `health_q_photos` 행 부재 **(3-교집합)**. `used_at IS NULL` freeze guard 로 진짜 미제출만 적격. 단일 기준(만료 단독·행부재 단독) blanket 삭제 금지.

나머지 AC2(archive-first 2단)·AC3(멱등)·AC4(dry-run READ-ONLY 선행)·AC5(제출완료 절대 배제·freeze 재검증 abort)는 원문 유지, 아래 §5 실행 설계로 이행.

> ※ SSOT 티켓 AC1 텍스트 갱신은 planner lifecycle 소관 — 본 정합안을 완료 보고에 제안. 코드/술어의 권위 정의는 본 문서 + predicate SQL.

---

## 5. Archive-First 파괴 실행 설계 (코드 구현 완료 — 실 파괴 실행은 supervisor gated 이후에만)

`Cross-CRM Orphan-Row Archive-First Cleanup + FK Integrity Guard SOP` 봉투 준수. 실행기(`..._sweep_execute.mjs`)로 **코드 구현되었으나**, `--execute` 없이는 PLAN(READ-ONLY) 모드로만 동작한다. **dev-foot 은 `--execute` 로 직접 돌리지 않는다(gate=supervisor).**

1. **dry-run READ-ONLY 선행** (AC4·본 티켓): §3.2 러너로 대상목록·건수 + freeze-set 스냅샷 산출. supervisor 검토.
2. **freeze-set 고정**: dry-run 시점 `B_orphan_ELIGIBLE` object_id 집합을 고정(freeze).
3. **archive (1단, 순소실 0)**: freeze-set 각 오브젝트를 `_archive/health-q-orphans/{sweep_ts}/…` 아카이브 prefix 로 **copy/move** (Storage 내 이동). 판정근거 스냅샷(freeze-set JSON)을 아카이브에 동봉. → 원본 삭제 전 복원 가능 상태 경유.
4. **freeze-set 재검증 (abort 게이트)**: 삭제 직전 각 대상에 대해 3-교집합 **재평가**. 하나라도 그 사이 `health_q_results`/`health_q_photos` 가 생겼으면(제출 발생) → 그 대상 제외. **(A) 제출완료가 freeze-set 에 혼입 판정되면 전체 batch ABORT**.
5. **delete (2단)**: 아카이브 확정된 대상만 원본 오브젝트 remove.
6. **멱등**(AC3): 이미 아카이브됨(manifest 존재)·원본 부재 시 skip, 재실행 안전.

### 5.1 파괴 실행의 선결 게이트 (본 티켓 이후)
- **supervisor 코드리뷰 + gated 실행** (DA §3 / 티켓 선결 게이트).
- **manifest/audit 를 DB 테이블로 둘 경우 = 신규 테이블 DDL → data-architect CONSULT 선행 의무**(§S2.4). 이를 피하려 본 설계는 **manifest = Storage 아카이브 내 JSON 오브젝트**(DDL-free)를 1안으로 한다. DB audit table 은 선택적 enhancement 로 별도 consult 후에만.
- 배치 스케줄(cron/pg_cron) 도입도 별건 — 최초에는 gated 수동 실행.

---

## 6. cross-CRM

foot 로컬 인스턴스. 우산 자산클래스 = `cross_crm_data_contract.md §2-23`(PHI-image Storage). 타 CRM 이 anon-draft 자가업로드 이미지를 도입하면 본 submitted-vs-orphan 2-class + 3-교집합 술어 상속(재발명 금지) — DA §4.

---

## 7. 실행 방법 (dry-run, macstudio)

```bash
# repo 루트 .env 에 VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 필요
node scripts/T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP_dryrun.mjs
# → 콘솔 클래스별 건수 + scripts/..._dryrun.out.json (freeze-set 스냅샷)
```

dry-run 은 **READ-ONLY** — Storage/DB 를 변경하지 않는다. 산출된 건수·freeze-set 이 supervisor 코드리뷰의 입력이며, 그 승인 후에만 §5 파괴 실행 설계로 진입한다.

---

## 8. dry-run 실건수 evidence (macstudio service_role 실행 — 2026-08-11)

**실행 환경**: macstudio `.env.local`(service_role, project `rxlomoozakkjesdqjtvd`). service_role → RLS 우회 = 실 데이터 전수 스캔(silent 0-row read 아님. 91건 오브젝트 발견 + photo 행 매칭 확인 = 진성 non-empty read).

| 지표 | 값 |
|---|---|
| Storage 오브젝트 총계 | **91건** |
| `A_submitted_protected` (제출완료·sweep 절대배제) | **91건** |
| `B_orphan_ELIGIBLE` (적격 orphan·삭제 대상) | **0건** |
| `RESIDUE_used_but_result_absent` | 0건 |
| `UNCLASSIFIED_no_token_row` | 0건 |
| `B_draft_not_yet_expired` | 0건 |

- **현시점 sweep 대상 = 0건.** 저장소의 모든 사진(91건)이 제출완료 원장(`health_q_photos` 행)에 결속 → 전량 보호대상. **지금 파괴잡을 돌려도 no-op(순소실 0).**
- 실행기 PLAN 모드도 동일: `freeze-set 0건 → 종료(no-op, 멱등)`.
- 함의: orphan 은 아직 누적되지 않음(미제출 draft-orphan 부재). 본 잡은 **누적 대비 상비 도구**로서 봉인해 두고, orphan 이 실제 발생하면 그때 supervisor gated 로 `--execute`. 정기 스케줄(cron)은 별건(§5.1).
- evidence 원본 JSON(`..._dryrun.out.json`)은 `.gitignore` 대상(로컬 산출물) — 위 표가 커밋된 요약본. freeze-set 은 빈 배열(PHI 무동봉).
