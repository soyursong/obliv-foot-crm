# Grounding Report — T-20260607-foot-PROCMENU-RX-UNIFY (Stage 0 / AC-0, READ-ONLY)

- author: agent-fdd-dev-foot
- date: 2026-06-08
- scope: **READ-ONLY 그라운딩 + 마이그 플랜 산출까지만**. 파괴적 write 0건.
- 확정 모델 (문지은 대표원장, "딱 두개", MSG-160602-g8y5 confirm):
  - ① **처방세트** = 약품폴더 기능(`prescription_folders`+`prescription_code_folders`+`prescription_codes`)을 캐노니컬 홈, 기존 약 DB 전부 이관, 화면명 "처방세트" 유지.
  - ② **묶음처방** = 처방세트 N개를 단축키 하나로 부르는 신규 상용구 레이어 (additive, Stage 2).

---

## 1. 양 모델 코드 그라운딩

### A. `prescription_sets` — 06-03 baseline (현 "처방세트"의 데이터 본체)
| 항목 | 값 |
|------|----|
| 생성 | `20260504_doctor_treatment_flow_up.sql` (+ `20260603040000_*folder`, `20260603040010_*item_code_id`) |
| PK | `id SERIAL` (INT) |
| 핵심 컬럼 | `name`, `items JSONB`, `folder TEXT`(06-03, nullable), `is_active`, `sort_order` |
| **items 원소 shape** | `{name, dosage, route, frequency, days, notes, prescription_code_id?:UUID(nullable), classification?:TEXT(스냅샷)}` |
| **grain** | **1 row = 1 세트(약 묶음)**. posology(용법·용량)가 **세트별 항목 단위로** items 안에 박혀 있음. |
| 소비처 | `quick_rx_buttons.prescription_set_id`(FK), `QuickRxBar`, `PrescriptionSetsTab`, `PrescriptionSetTreePicker`, `prescribableDrugs.getPrescribableCodeIds()` |

### B. 약품폴더 기능 — 11:18 배포 (캐노니컬 홈 후보)
파일 `20260607180000_prescription_drug_folders.sql` 이 실제 생성한 객체:
| 테이블 | 역할 | posology? |
|--------|------|-----------|
| `prescription_folders` | 자기참조 다단계 폴더 트리 (`parent_id`, `name`, `sort_order`) | 없음 |
| `prescription_code_folders` | 약↔폴더 매핑. **PK=`prescription_code_id`** → 약 1건당 폴더 1개(move 시맨틱). 미분류=행 없음 | 없음 |
| `prescription_codes` (04-22) | 약 마스터 카탈로그. `claim_code`(**NOT NULL UNIQUE**), `name_ko`(NN), `code_type`(NN dflt), `classification`(NN dflt '내복약'), `code_source` CHECK('official','custom'), `ingredient_code`, `low_dose`, `price_krw` | **없음** |
| **grain** | **1 row = 개별 약품(코드)**. | — |

FE: `DrugFolderTree.tsx`는 **폴더에 분류된 약만 렌더**한다(`drugsByFolder`). **미분류(매핑 없는) 약은 트리에서 보이지 않음.**

### C. ⚠️ 11:18 마이그의 SSOT 주석이 현장 확정 모델과 용어가 어긋남
11:18 마이그/`drugFolders.ts`의 자체 SSOT 주석:
```
현장 "처방세트" = 전체 약 카탈로그   → prescription_codes
현장 "폴더"     = 약 분류/탐색       → prescription_folders
현장 "묶음처방" = 빠른처방 프리셋     → prescription_sets
```
→ 11:18 구현은 "처방세트 = 카탈로그 view, 묶음처방 = prescription_sets"로 가정했고, 이는 이번 확정 "처방세트=약품폴더홈 / 묶음처방=신규레이어"와 **방향은 같으나 prescription_sets의 운명에서 갈린다**(아래 §2).

---

## 2. 핵심 판정 — "약품폴더 스키마가 약+posology 전필드를 보존 가능한가?"

### 결론: **약 식별자(identity)는 보존 가능. posology(용법·용량)는 캐노니컬 홈에 보존 불가 → 확장/분리 필요.**

| 보존 대상 | 캐노니컬 홈(약품폴더) 수용 가능? | 처리 |
|-----------|------------------------------|------|
| 약 식별(name, 코드) | **가능** | Type A(code_id 보유)=이미 존재 / Type B(자유텍스트)=custom 코드 insert |
| classification(분류) | 부분 — 컬럼 존재하나 세트 route≠마스터 classification | 기본값 적용 + 현장 재분류 (flag) |
| **posology: dosage/route/frequency/days/notes** | **불가** — prescription_codes/folders에 자리 없음 | **묶음처방(Stage 2) 레이어가 보존** |

**이유(grain mismatch):** 약품폴더 홈은 **개별 약(1 row=1 drug)** 단위이고 posology 컬럼이 없다. 반면 posology는 본질적으로 **세트(묶음)별 항목 속성**이다 — 같은 약이 세트마다 다른 용법으로 등장 가능. 따라서 약을 마스터 1행으로 합치면 세트별 용법 분산을 표현할 곳이 사라진다.

→ **posology 무손실은 묶음처방(Stage 2) 레이어에서만 달성된다.** "딱 두개" 모델과 정확히 일치: 식별=처방세트(홈), 용법묶음=묶음처방.

### 따라서 무손실 보장 조건 (현장 "기존 약들 디비 다 가져와" 충족)
1. **Stage 1(이 패키지) = additive backfill만.** `prescription_sets` **DROP/파괴적 ALTER 금지**.
   - 근거 ①: posology가 묶음처방(Stage 2)으로 이관되기 전까지 `prescription_sets`가 **posology의 유일한 집**.
   - 근거 ②: `quick_rx_buttons.prescription_set_id`(FK, ON DELETE CASCADE)가 prescription_sets에 의존 → 드롭 시 빠른처방 회귀.
2. Stage 1은 (a) 자유텍스트 약 → custom 코드 insert, (b) 세트에 쓰인 모든 약 → 폴더 배정(미배정 약은 트리에서 안 보이므로 필수)까지만.
3. 실제 posology 이관 + prescription_sets→묶음처방 전환은 **Stage 2**(supervisor GO 후 별도).

---

## 3. 발견된 확장 필요 항목 (Stage 1 마이그가 해소)

- **E1 — 자유텍스트 약 코드화:** `items` 중 `prescription_code_id=null`(수기 약)은 카탈로그에 없음. 캐노니컬 홈에 노출하려면 `prescription_codes`에 `code_source='custom'` 행 insert 필요. `claim_code` NOT NULL UNIQUE → 합성코드 `LEGACY-<md5(name)[0:12]>` 발번(네임스페이스 충돌 회피).
- **E2 — 폴더 배정 필수:** `DrugFolderTree`는 미배정 약 비표시 → backfill로 "처방세트 이관" 랜딩 폴더에 배정해야 "다 가져와" 충족. 현장이 이미 배정한 약은 `ON CONFLICT(prescription_code_id) DO NOTHING`으로 보존.
- **E3 — posology는 Stage 1 범위 밖:** 무손실은 prescription_sets 보존 + Stage 2 묶음처방으로 달성(파괴 금지).
- **E4 — classification 추정 불가:** custom 약의 분류는 세트 route로 역추정 불가(외용/경구 혼재). 마스터 기본값 부여 후 현장 재분류 권고(비차단).

## 4. 무회귀 가드 (진입경로)
- `prescriptionGate.ts` / `QuickRxBar`: prescription_sets 보존 + items 비파괴 → 무영향. custom 코드는 `code_source='custom'`로 official 499 스코프 게이트와 독립.
- `getPrescribableCodeIds()`: prescription_sets.items 미수정 → 처방가능 스코프 불변.

## 5. 메뉴 순서(Stage 3)
SERVICES-NAV-RESTRUCTURE 랜딩 후. 이번 scope 아님.
