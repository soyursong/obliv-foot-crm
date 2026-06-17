# T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL — 착수 전 4티켓 좌표맵 (dev-foot)

작성: 2026-06-17 / dev-foot / read-only 코드 그라운딩 후 1회 작성 → planner FOLLOWUP 보고용.
목적: 동일 묶음처방 surface 다발(REDEFINITION_RISK 4건)에서 이중작업/역작업 차단. 어느 컴포넌트가 base고 어디에 적층하는지 확정.

---

## 0. 결론 요약 (planner 판단 지원)

| 질문 | 답 |
|------|----|
| 신규 모델 필요? | **불요.** prescription_sets(items JSONB) + tag_label/tag_color/icon 계승. |
| Part A가 MIGCLEAR Part C를 흡수? | **흡수 확정 — 이중작업 0.** MIGCLEAR(commit 07c5b577, **이미 deployed**) §0.5가 "Part C OVERHAUL subsume" 명시. MIGCLEAR는 Part A+B(전체보기 서브탭+테이블)만 배포했고 Part C(옵션A 필터)는 코드 미구현 → 본 티켓 Part A로 단일화. 역작업 없음. |
| hide_name 영속화 | ADDITIVE `hide_name` boolean nullable 1컬럼 → **DA CONSULT 게이트(미선행, 아래 §4)**. |
| 빠른처방 surface(Part E/F) | QuickRxBar(buttons)·BundleRxTagBar(tags) 현재 **병존** → Part E=QuickRxBar REPLACE, Part F=admin `quick_rx` 서브탭 retire(reporter confirm 게이트). |

---

## 1. 4(+2)티켓 좌표맵

### ① BUILDER-RESTRUCTURE [deployed 4440d19c] = 데이터 모델 base
- 파일: `src/components/admin/PrescriptionSetsTab.tsx`
- 모델: `prescription_sets` (items JSONB: name/dosage/route/frequency/days/count/notes/prescription_code_id/classification + folder TEXT + name + sort_order + is_active)
- 1·3·2 = items의 `dosage`(1회량) / `count`(1일횟수, RxCountInput) / `days`(투여일수). baked-default, use-time 진료의 수동조정.
- **계승: 신규 모델 만들지 말 것.** Part D 저장 = 이 items 구조 그대로.

### ② TAG-QUICKTRIGGER [deploy-ready→merged 8fdf5ab6] = 태그 base (재사용·확장)
- 파일: 같은 `PrescriptionSetsTab.tsx` (태그편집 다이얼로그 L1106~1213), `src/lib/rxTagPalette.ts`, `src/components/doctor/BundleRxTagBar.tsx`
- ADDITIVE 컬럼: `tag_label`/`tag_color`/`icon` (nullable TEXT). 마이그 `20260615120000_rxset_tag_meta.sql` 적용됨.
- 태그편집 다이얼로그 = 라벨(maxLength 12) / 색상팔레트(RX_TAG_COLORS) / 아이콘(DRUG_ICON_OPTIONS) / 미리보기 칩. `useUpdateSetTagMeta`로 3컬럼만 부분 UPDATE.
- 색상팔레트 현재 **7종**(purple/teal/rose/amber/sky/emerald/slate) — chip은 `*-100` 밝은톤. → 본 티켓이 **10종 어두운톤으로 확장 + '이름숨기기' 추가**.
- **재사용 base: 이 다이얼로그를 "묶음처방 생성 팝업"(Part C)으로 확장.** 기존 케밥 '태그 편집' 진입점은 보존.

### ③ MIGCLEAR [**deployed** 07c5b577] = 테이블 자산 (Part B 참고)
- 파일: `src/components/admin/DrugFoldersTab.tsx` (서브탭 `[폴더 선택]/[전체보기]`, 전체보기 테이블 L502~615)
- 테이블 = **prescription_code_folders(개별 약 폴더배정) 기반**. 헤더 전체선택 체크박스 + 행 체크박스 + 일괄삭제(useUnassignDrug 재사용). 컬럼: 약이름(용량)/소속폴더 2컬럼.
- ⚠ **데이터 출처 차이**: MIGCLEAR 테이블 = `prescription_code_folders`(약 카탈로그). 본 티켓 Part B "처방세트에 있는 모든 약" = **데이터 출처 결정포인트**(아래 §3).
- Part C(옵션A 필터) = **미구현, OVERHAUL Part A로 subsume**(MIGCLEAR §0.5 명시).
- **재사용 base: 체크박스 테이블 UI 패턴**(thead 전체선택 + tbody 행체크 + Set<id> 선택상태)을 Part B 좌측 테이블로 이식.

### ④ BUNDLE-MERGE [in_progress 687462c3] = 이관약 그룹 (Part A 대상)
- 마이그 `20260614120000_rxset_bundle_drugfolder.sql`: 19 단독약을 `prescription_sets.folder='약'`로 묶음(옵션A 백필). 06-15 14:50 apply 완료.
- **Part A 비우기 1차 대상 = 이 folder='약' 그룹.** 같은 prescription_sets 테이블 → 좌표충돌 없음.

### ⑤ RX-COLUMN-INPUT-UNIFY (관련) = 1·3·2 숫자입력 표준
- Part D 숫자입력칸 정합 확인 대상. (RxCountInput + days number input 기존 패턴 재사용.)

---

## 2. 본 티켓 적층 지점 (어디에 무엇을)

| Part | 적층 파일 | 작업 |
|------|----------|------|
| A | `PrescriptionSetsTab.tsx` usePrescriptionSets 쿼리/grouped 렌더 + (게이트 후) 데이터 정리 SQL | folder='약' 그룹 노출제외(옵션A) or 클린슬레이트(범위 confirm 후) |
| B | `PrescriptionSetsTab.tsx` 좌측단 신규 | 처방세트 전체 약 테이블뷰(체크박스+검색) — MIGCLEAR 테이블 패턴 이식 |
| C | `PrescriptionSetsTab.tsx` 생성 팝업 = 태그편집 다이얼로그 확장 + `rxTagPalette.ts` 10색 | [묶음처방 생성] 버튼 → 팝업(이름/10색/아이콘/이름숨기기) |
| D | 같은 팝업 하단 + `prescription_sets.items` 저장 | 선택약 순서/약이름/1·3·2 숫자입력 → 1세트 저장 |
| E | `DoctorTreatmentPanel.tsx` L911~943 | QuickRxBar(buttons) → BundleRxTagBar(tags)로 REPLACE |
| F | `ClinicManagement.tsx` `quick_rx` 탭(L132,204) | QuickRxButtonsTab 서브탭 retire (reporter confirm 후) |

---

## 3. ⚠ 결정포인트 (FOLLOWUP에 동봉)

1. **Part B 좌측 테이블 데이터 출처** — "처방세트에 있는 모든 약" = ⓐ prescription_code_folders(약 카탈로그, MIGCLEAR 전체보기와 동일) ⓑ services 처방약 리스트(빌더 검색 출처, searchServiceRxDrugs) ⓒ prescription_sets.items 평탄화. 빌더 약 검색은 현재 ⓑ(services 처방약). → **dev 권장 ⓑ**(생성 시 선택→items 저장 일관). reporter/planner 확인.
2. **Part A 싹 범위** — ① 전체 클린슬레이트(prescription_sets 전부 DELETE) vs ② folder='약' 이관약 잔재만(정상 favorite 보존). dry-run COUNT 4종 보고 후 reporter 1줄 확인. 추정 DELETE 금지.
3. **hide_name 영속화** — ADDITIVE boolean nullable → **DA CONSULT 필요**(미선행). 목록 렌더 재현 위해 영속 권장.
4. **10색 어두운톤 팔레트** — dev 1차 제안(아래) → reporter 스크린샷 시각확인.
5. **Part F 서브탭 retire** — "될듯" 소프트 → Part E 동작확인 후 reporter confirm.

### 10색 어두운톤 팔레트 dev 1차 제안 (눈피로↓, *-700/800 base)
slate / stone / red / orange / amber / emerald / teal / sky / indigo / fuchsia
(chip = `bg-{c}-800/15 text-{c}-200 border-{c}-700` 등 dark-tone — tailwind JIT 리터럴 명시 필요, 동적문자열 금지. 시각확인 후 hex 확정.)
