# DML 게이트 요청 — T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE

**작성:** dev-foot · 2026-07-18 · **성격:** 파괴적 DML(row DELETE) — supervisor DML 게이트 필수(dev 자가적용 안 함)
**요청자:** 김주연 총괄(has_ops_authority, C0ATE5P6JTH ts 1784338735.191229) explicit "빼달라" → reporter 확인 충족(추가 confirm 불요)

## 1. 대상 (Step1 READ-ONLY freeze, 무영속 조사)

| 항목 | 값 |
|------|-----|
| id | `676ceca0-23f0-4d33-a362-1af04770b564` |
| name_ko | `대웅푸루나졸정150mg(플루코나졸)` |
| claim_code | `LEGACY-12d7730e32e8` |
| code_source | `custom` (자체 — 부모 T-20260617 '매핑 제외/미접촉' 약) |
| classification | 내복약 |

> 총괄 "규격 여러개" 언급했으나 실제 마스터엔 150mg **단일행**. `name_ko LIKE '대웅푸루나졸%'` = **1건**. (freeze json: `db-gate/..._step1_freeze.json`)

## 2. 참조 검사 (무결성 — hard-DELETE 안전성 판정)

| surface | 건수 | 성격 |
|---------|------|------|
| medical_charts.prescription_items[] (실 처방 이력) | **0** | JSONB 스냅샷 · 무FK |
| prescription_sets.items[] (묶음처방) | **0** | JSONB 스냅샷 · 무FK |
| prescription_contraindications (금기증) | **0** | FK CASCADE |
| service_charges (청구) | **0** | services 참조 — 약 직접참조 없음(스키마 확인) |
| prescription_code_folders (약품폴더 배정) | **1** | FK CASCADE · = 서비스관리 목록 노출 surface 자체(folder=ed3ae609…) |

**판정:** 보존해야 할 처방·청구·금기 **무결성 참조 = 0**. 유일 참조는 목록 노출 surface(폴더배정)뿐 → "참조 없음" 분기 → **archive-first hard-DELETE 안전**. 순소실 0.

## 3. 방식 (권고 = archive-first hard-DELETE)

- prescription_codes 엔 `is_active`/`deleted_at` 컬럼 **없음** → soft-delete 하려면 스키마 추가(data-architect CONSULT + 코드필터) 필요 = P2 과중. 소비자도 없음.
- 무결성 참조 0 이므로 archive-first 후 hard-DELETE 가 AC 4개 전부 충족 + 완전가역:
  - **AC1** 검색카탈로그(prescription_codes) + 폴더목록 양쪽에서 사라짐 ← 마스터 삭제라야 검색에서도 비표시(폴더배정만 지우면 검색엔 잔존).
  - **AC2** 깨질 처방/청구 이력 0(참조 없음).
  - **AC3** 삭제대상 = freeze 1건과 정확 일치(guard 가 초과대상 abort).
  - **AC4** archive 테이블 → 롤백 재INSERT 로 원복.
- **최종 hard/soft 판정은 supervisor DML 게이트 소관.** soft 선호 시 → is_active 컬럼추가(architect CONSULT) 경로로 전환.

## 4. 파일

| 종류 | 경로 |
|------|------|
| up (apply) | `supabase/migrations/20260718150000_daewoong_pluranazole_remove.sql` |
| rollback | `supabase/migrations/20260718150000_daewoong_pluranazole_remove.rollback.sql` |
| dry-run(무영속) | `supabase/migrations/20260718150000_daewoong_pluranazole_remove.dryrun.sql` |
| freeze 스냅샷 | `db-gate/T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE_step1_freeze.json` |
| Step1 조사 스크립트 | `scripts/T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE_step1_readonly.mjs` |

## 5. 안전장치 (up.sql 내장)

1. **freeze-guard**: id+name prefix+custom = 1건 아니면 abort. prefix 총건 ≠ 1(규격추가 등) 이면 abort → 초과삭제 0.
2. **무결성 재검증**: apply 시점 처방이력/묶음/금기 참조 발견 시 abort → soft 전환 재검토.
3. **archive-first**: 삭제 전 마스터+폴더 스냅샷 (롤백 원천). 사후검증(마스터0/폴더0/archive1) 실패 시 txn 전체 롤백.
4. 단일 트랜잭션, COMMIT 는 up.sql 에만. dryrun.sql 은 ROLLBACK(무영속).

## 6. 부모 티켓 대조

부모 `T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP`(18종 HIRA 승격) 은 대웅푸루나졸을 **'매핑 제외(미접촉)'** 로 둠 → 본 삭제와 **surface/action 분기 명확**(매핑제외≠삭제), 충돌 없음. 부모 apply 범위(18종)는 대웅 미접촉 그대로 유지. 본 티켓 대상은 부모가 손대지 않은 그 custom 1행.

## 7. 원장 무접점 — 청구원장 미참조(service_charges 약 직접참조 0) 확인.
