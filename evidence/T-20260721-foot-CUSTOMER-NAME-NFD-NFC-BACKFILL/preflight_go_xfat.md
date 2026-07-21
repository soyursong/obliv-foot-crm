# T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL — DA GO 후 PREFLIGHT/GATE 실행 evidence

- **DA CONSULT-REPLY(GO)**: MSG-20260721-234423-xfat — CONDITIONAL GO / 파생 사본 FOLD-IN / frozen-subset discharge.
- **SOP**: Cross-CRM Data-Correction 백필 SOP v2.0 (§0-2-a 값-보존 멱등 discharge / §2-S 사본 완전열거 / §3-5 제약 프리플라이트).
- ⚠ **PHI 위생**: 본 문서는 git-tracked → 실명 미기재. 식별은 chart# + id8 + raw/nfc len 만. rollback hex·실명은 off-git freeze.json.

## 1. §2-S 파생 동기필드 기계 완전열거 (손 열거 금지)
- customer_id 보유 테이블 text/char 컬럼 **220개** 기계열거 → 3 target customer_id 에 대해 NFD 지문 전수 스캔(단일 UNION).
- **name/customer 계열 전 테이블 전역 NFD census**도 병행.
- **NFD hit surface = 4** (`_preflight.out.txt`):

| surface | NFD | 판정 |
|---|---|---|
| customers.name | 3 | ★유일 SoT — 직접 UPDATE 대상 |
| reservations.customer_name | 3 | 트리거 cascade 대상(직접 UPDATE 안 함) |
| check_ins.customer_name | 1 | 트리거 cascade 대상 |
| aicc_crm_phone_match.name | 3 | **VIEW** — 아래 §1.1 |
| notification_logs.body_rendered | 7 | **제외** — 아래 §1.2 |

### 1.1 aicc_crm_phone_match = VIEW (독립 저장 없음)
- `relkind='v'`. viewdef = `SELECT id AS customer_id, clinic_id, name, phone, created_at FROM customers`.
- `aicc.name` == `customers.name` read-through → customers 정정 시 **자동 반영**. 별도 UPDATE 불요/금지(뷰).
- dry-run 재확인: aicc 대상 explicit UPDATE affected=0(이미 뷰로 NFC) & post NFD=0.
- ∴ §2-S 로 늘어난 것처럼 보였던 aicc(+3)는 실제 신규 surface 아님 → **freeze-set 7 유지**(count 확장 없음, DA 명시 7 과 정합).

### 1.2 notification_logs.body_rendered (7건) — 백필 제외
- 발송완료 메시지 body(이름 embed). 이름검색/dedup surface 아님. 정정 = "실제 발송된 내용"의 감사기록 왜곡.
- → 불변 이력 보존, **백필 제외**. (DA 통지 대상; 검색·dedup 목적과 무관하여 correctness 손실 0.)

## 2. 파생 사본 정정 메커니즘 = 기존 트리거 cascade (DA in-place 와 값-동일)
- 트리거 `trg_sync_customer_name` = `AFTER UPDATE OF name ON customers WHEN (new.name IS DISTINCT FROM old.name)`.
- fn 본문: `UPDATE check_ins SET customer_name=NEW.name WHERE customer_id=NEW.id AND customer_name IS DISTINCT FROM NEW.name;` + 동일 `reservations`.
- 즉 customers.name NFD→NFC UPDATE 시 트리거가 reservations(3)+check_ins(1) 를 NFC 로 자동 동기 = "정식 mirror"(ingest EF 주석에서도 정식 mirror 명시).
- **DA 우려(스냅샷 clobber) 무해 검증**: 3 customer_id 의 reservations/check_ins customer_name 은 각 **1개 distinct 값뿐이며 전부 customers.name 과 NFC-equal**(개명/동행 등 정당한 상이 스냅샷 0). ∴ cascade 결과 == DA in-place NFC 값. clobber 0.
- 트리거 비활성화(session_replication_role/ALTER) = 불필요 + 추가 위험 → 채택 안 함. 트리거 자연 cascade 이용.

## 3. §3-5 제약-도메인 프리플라이트
- touched 컬럼(customers.name / reservations.customer_name / check_ins.customer_name / aicc.name) **CHECK/UNIQUE(name) = 0건** → collision 위험 없음.
- NFC collision 시뮬(clinic jongno): 각 이름 NFC-equal 총 **1건**(=NFD 본인) → 기존 NFC 동명 충돌 0.
- NOT NULL: customers.name / check_ins.customer_name = NOT NULL → NFC 는 값-보존(비-NULL) → 안전.

## 4. §0-2-a INSERT-only 코드-핀 (reservation-ingest-from-dopamine)
- **UPDATE path(기존 고객, 시점: existingCustomer)**: name = `shouldFillName ? {name} : {}` — 기존 name **공란일 때만** 채움(preserve-on-NULL). 기존 non-empty name = **no-touch**(T-20260713 INGEST-NAME-OVERWRITE-GUARD). → frozen 3 PK 는 정정 후 non-empty NFC → `shouldFillName=false` 영구 → **moving-target 없음**.
- **INSERT path(신규 고객)** + **reservations.customer_name denormalize**: raw payload name 착지(무-NFC) = NFD 유입점.
- ∴ 기존행 name 은 UPDATE-clobber 안 됨(INSERT-only 성격 확인). 신규 유입만 residual → AC-2 가드로 차단.

## 5. AC-2 foot ingest NFC 가드 (ADDITIVE, defense-in-depth)
- reservation-ingest-from-dopamine: payload `name`·`customer_real_name` 추출 직후 `.normalize('NFC')`(값-보존 멱등, 완성형 no-op). 모든 downstream landing(customers INSERT/fill, reservations.customer_name/customer_real_name) 이 NFC 값 사용.
- 근원(도파민 write-path) = 별건 T-20260721-dopamine-PUSH-PAYLOAD-NAME-NFC-NORMALIZE-GUARD. 본 가드는 foot 경계 방어심층.
- **배포 트랙 분리**: 백필과 별개 ADDITIVE. supervisor 백필 승인/적용 후 배포(DA §7).

## 6. 재오염 sentinel + 잔여 주기 sweep (blocking)
- **sentinel**: 정정된 3 customer_id 가 NFD 재진입 시 감지(informational; NFC 멱등 self-heal 대상, P0 아님).
- **주기 sweep**: 동일 NFD 지문(customers/reservations/check_ins/aicc-view/notification_logs) 전수 count 를 일일 정합성 감사에 fold. >0 시 재-sweep 트리거. silent cap 금지.
- 구현: `scripts/..._nfd_sentinel_sweep.mjs`(read-only census, 일일 실행 후보). AC-2 배포 전까지 신규 NFD 유입 잔여 추적.

## 7. dry-run 무영속 evidence (No-Persistence Protocol)
- 방식: 단일 plpgsql DO 블록에서 customers UPDATE 실행 → 계측 후 `RAISE EXCEPTION` 강제 unwind(COMMIT 없음 → sentinel-bypass 불가) + 별도 read-only post-probe 로 무영속 재확인.
- 결과(`_dryrun.out.txt`): `cust_aff=3 | 사후 NFD cust=0 resv=0 chk=0 aicc(view)=0 | LIKE강승은=1` / **PRE==POST(persist 0 확정)**.
- 단일 customers UPDATE 3건 → 트리거 cascade(resv3/chk1) + 뷰 자동 → 4 surface NFD 전멸 + 이름검색 재현.

## 8. 게이트 상태
- [x] §2-S 완전열거 → freeze-set **7 확정**(customers3 + cascade resv3/chk1). aicc=view/notification_logs=제외 처리.
- [x] §3-5 제약 프리플라이트 clean(제약0/collision0/NOT NULL 안전).
- [x] §0-2-a 코드-핀(기존행 no-touch) + 재오염 sentinel/주기 sweep 등록 + AC-2 가드 코드.
- [x] archive-first: off-git freeze.json(before/after/hex) + dry-run 무영속 evidence.
- [ ] **supervisor 백필 승인 (불변 최종 게이트)** ← 대기.
- [ ] 승인 후 apply(customers 3-row 원자 배치) + POSTCHECK + AC-2 별도 ADDITIVE 배포.
- gate_hold: customers.name UPDATE **미실행**(deploy-ready 미마킹=정상). supervisor 승인 전 apply 금지.

---

## 9. AC-2 소스닫힘 하드닝 — storage-boundary write-guard (DA hdm3 §3/§5, 2026-07-22 추가)
- **트리거**: `trg_name_nfc_writeguard` (BEFORE INSERT OR UPDATE) on customers.name / reservations.customer_name+customer_real_name / check_ins.customer_name → `fn_name_nfc_writeguard()` normalize(NFC).
- **왜**: hdm3 §3 = "가드가 3 필드 write-site 전부를 normalize 해야 파생셋 전체 소스닫힘 성립". §5 = "각 경계가 자기 정합 방어 — 상류 신뢰 금지".
  - 기존 EF-ingest AC-2(§5)는 결정적 오염원(도파민 push)만 닫음. 단 EF 는 check_ins 를 직접 쓰지 않음 → check_ins 직접 write-site(self_checkin_create / fn_selfcheckin_create_check_in / FE ReservationDetailPopup) + customers/reservations FE 직접 INSERT 는 EF-only 로 미가드.
  - 저장 경계 트리거 → write-path(EF/RPC/kiosk/FE/cascade) 무관 NFD 저장 구조적 불가 → 3 write-site 전부 소스닫힘 + forensics(신규 NFD=0) 구조적 보장.
- **안전**: NFC 무손실·멱등·never-downgrade·NULL 무해. ADDITIVE(트리거만, DDL=컬럼/테이블/enum 0). 기존 trg_sync_customer_name(AFTER) 과 정합(BEFORE 가 NFC 확정 → AFTER cascade → 파생 BEFORE 가드 no-op).
- **파일**: 20260721150000_name_nfc_writeguard_trigger.{sql,rollback.sql,dryrun.sql}. dryrun = BEGIN…ROLLBACK + 진짜 NFD(9 conjoining jamo, \u escape) INSERT → stored len=3(NFC) 계측 + 강제 unwind(무영속) + post-probe.
- **배포 순서(hdm3 §3 엄수)**: 본 가드 supervisor DB-gate 적용·live → forensics(가드 live 이후 신규 NFD row=0, tz-aware) 통과 → **그 다음** 백필(140000) 적용. 가드는 백필과 별개 선행 ADDITIVE 트랙.

## 10. §8 파생층 전파 — Bronze id-scoped re-ingest (백필 DoD, DA hdm3 §4)
- 백필은 updated_at 동결(§2-3) → Bronze updated_at-watermark 증분이면 정정행 자연 재수집 실패 → datalake/Silver NFD 잔존.
- **DoD**: 백필 apply 직후 3 필드 정정행(customer_id/PK id-scoped) agent-bronze 강제 re-ingest(updated_at bump 금지) → Bronze 최신 파티션 재적재. Silver dedup = 최신 ingested_dt 우선.
- 전파방법=DA / re-ingest 실행=agent-bronze. → planner FOLLOWUP 로 bronze DoD 연결.

## 11. 메시지 정합 (hdm3 처리 + 게이트 상태)
- 본 세션 처리 message = MSG-20260721-234913-hdm3 (CONSULT-REPLY, GO conditional §0-2 + 3테이블 FOLD).
- 이후 ticket gate_hold = RELEASED 2026-07-22T00:02 (planner, 후속 DA reply uipp/b1pv/ji06). APPLY 착수 허용(supervisor DB-gate + MIG-GATE only).
- dev-foot 판단: hdm3 §3 소스닫힘-先 순서 유지 — AC-2 가드 선행 배포+forensics 후 백필. 백필 SQL 내 ⛔GATE_HOLD(supervisor DB-gate) 배너 유지. dev-foot PROD 직접 apply 안 함(운영 DB 변경=supervisor 게이트).
