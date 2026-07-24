# T-20260724-foot-EOMSANGWOOK-OWNER-PARKMINSEOK-DEL — 실행 증거 요약

- 실행: dev-foot, 2026-07-24
- 근거 SOP: data_correction_backfill_sop(UPDATE) · orphan_row_archive_first_cleanup(DELETE)
- 선례: T-20260722-foot-KIMJONGMIN-CONSULT-OWNER-CORRECT (동일 강경민→엄경은 정정)
- db_change=false (DML only, 스키마 무접점) · risk=GO_WARN

## staff id 확정
| 이름 | id | role |
|------|----|----|
| 강경민 | 6ab26d9f-fd10-4042-9fd7-076f277be5d4 | consultant |
| 엄경은 | b311593d-9e46-4ac8-9424-6b0fa1689a06 | consultant |

---

## 수정1 — 엄상욱 상담담당자 강경민→엄경은 ✅ 완료

### 동명이인 가드 (§1)
- customers name=엄상욱 → **1건** (id `fd9417a3-ccaf-4323-a595-04204f6ee32a`, chart F-5057). 동명이인 없음.
- check_ins customer_name=엄상욱 → **1건** (id `976e2667-7d75-4c09-95e2-b6faa7d3a14d`, 2026-07-24, status=done). → 단일 특정 (AC-4 클리어).

### 대상 freeze & 실행
- 대상: `check_ins.id = 976e2667-7d75-4c09-95e2-b6faa7d3a14d`
- before: `consultant_id = 6ab26d9f (강경민)` — from-value guard 적용
- UPDATE `consultant_id = b311593d (엄경은)`
- **rows-affected = 1** (이중가드 통과)
- after 재조회: `consultant_id = b311593d (엄경은)` 확인 ✅
- 정본 근거: Assignments.tsx — 배정 owner 표시면(배정 드롭다운·금일 배분 이력·상담기록) 전부 `check_ins.consultant_id` 정본 read. (assignment_actions는 audit/방식표시용 — 선례대로 스코프 밖)

### rollback SQL
```sql
UPDATE public.check_ins
SET consultant_id = '6ab26d9f-fd10-4042-9fd7-076f277be5d4'  -- 강경민
WHERE id = '976e2667-7d75-4c09-95e2-b6faa7d3a14d'
  AND consultant_id = 'b311593d-9e46-4ac8-9424-6b0fa1689a06'; -- 엄경은
```
- full before-row: `T-20260724-foot-EOMSANGWOOK-OWNER-PARKMINSEOK-DEL_eomsangwook_UPDATE.json`

---

## 수정2 — 박민석 배정 내역 삭제 ⛔ 착수 중단 (동명이인 가드 §1 발동)

안전 가드 §1 "박민석 2건 이상 매칭 시 착수 즉시 중단 + planner 보고" 발동. **삭제 미수행.**

박민석 매칭 결과 (대상 특정 불가):
| 유형 | 건수 | 상세 |
|------|------|------|
| customers | **2건** | F-4790(customer_id 1c61bad2, 7/15생성) / F-4445(customer_id 66c08e48, 7/1생성 — 테스트성 번호) |
| check_ins | **5건** | F-4790 4건(7/23~7/24, cancelled 3+laser_waiting 1) / F-4445 1건(7/13 done) |
| staff | 1건 | 박민석 coordinator (id fd54a977) — 동명 직원 존재 |
| reservations | 7건 | 다수 날짜(5/21~7/24) |

### check_ins 후보 (배정 이력 grain — 환자참조 UUID/차트만, PHI-redacted §4.3)
| check_in_id | chart | customer_id | status | date | queue |
|-------------|-------|-------------|--------|------|-------|
| 4c0f40b6-e674-473d-bb48-0f5bb7757ad9 | F-4790 | 1c61bad2 | cancelled | 07-24 | 8 |
| 32c1431c-23e9-465b-8575-164f8a763ee3 | F-4790 | 1c61bad2 | cancelled | 07-24 | 7 |
| 9fa4be59-2b48-47f7-beed-561d5483377d | F-4790 | 1c61bad2 | cancelled | 07-24 | 6 |
| e77d1266-fd1b-4599-afa3-6fdf035fe37f | F-4790 | 1c61bad2 | laser_waiting | 07-23 | 1 |
| 8c06d473-3275-4dac-b575-575ca84cabd0 | F-4445 | 66c08e48 | done | 07-13 | 4 |

→ "테스트 건" 이 어느 것인지 데이터만으로 단정 불가. 첨부 스크린샷(F0BKK9C1MC1)이 대상 행을 특정할 것으로 보이나 로컬 미확보.
→ **planner FOLLOWUP: 현장에 대상 disambiguation 요청** (차트번호 F-4790/F-4445 중 어느 것 / 어느 날짜·화면 행 / 삭제 grain=check_in인지 reservation인지).
→ 확정 수신 시 orphan_row_archive_first_cleanup 준수(전체 컬럼 before 스냅샷 + rollback INSERT SQL → 단일 레코드 DELETE, rows-affected=1 이중가드)로 즉시 처리.
