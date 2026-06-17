# T-20260617-foot-DOCPHRASE-CSV-BULK — Phase 0 설계 제안 (READ-ONLY)

- 도메인: foot (obliv-foot-crm) · P2
- 요청자: 문지은 대표원장 (C0ATE5P6JTH)
- 단계: **read-only 설계 제안만** — 코드/마이그/배포 변경 0
- 작성: dev-foot · 2026-06-18
- 산출 용도: planner 회신(FOLLOWUP) + data-architect CONSULT 입력안

> 요청 요지: 진단서·소견서 등 **서류 버튼에 미리 채워질 상용구(문구)** 를 CSV로 대량 입력.
> 양식 다운로드 → 채워서 업로드 → 즉시 반영. **버튼별/항목명별 "최신 업데이트 시각" 이력**.

---

## 0. 핵심 발견 (착수 전 정합) — 서류 문구 저장소가 **3갈래로 분산**

요청의 "서류 상용구"가 가리킬 수 있는 현행 저장소가 3개이며, **서로 다른 테이블/구조**다. CSV 타겟을 어디로 둘지가 본 설계의 1급 결정사항.

| # | 저장소 | 구조 | 소비 화면 | 관리 화면 | "서류 상용구"인가? |
|---|--------|------|-----------|-----------|--------------------|
| ① | `phrase_templates` (SERIAL) | category / name / content / shortcut_key / **phrase_type**(pen_chart\|medical_chart) | 진료차트·펜차트 차팅 | `PhrasesTab` (서비스관리>상용구관리) | **아님** — 진료 차팅용. category='document'(='원장님') 라벨은 있으나 서류 발행과 무관한 레거시 |
| ② | `document_templates` (SERIAL) | **document_type**(diagnosis\|opinion\|prescription\|visit_confirmation\|general) / name / **content** / category / subcategory | `DocumentPrintPanel`(서류 발행, 진단서·처방전 등) | `DocumentTemplatesTab` (진료관리>서류템플릿) | **예 (광의)** — 서류 본문 문구 라이브러리. 2단 분류(category>subcategory) 보유 |
| ③ | `form_templates(form_key='opinion_doc').field_map.sections` (jsonb) | sections[{title, options[{key, **label**, **phrase**}]}] | `OpinionDocTab`(소견서 팝업 옵션그리드) — 버튼 클릭 시 phrase 자동삽입 | `OpinionPhrasesTab` (진료관리>소견서상용구) | **예 (협의, 요청 예시와 정확히 일치)** — "버튼이름(label)+자동삽입멘트(phrase)" |

요청 본문이 **"서류 팝업(OpinionDocTab 옵션그리드 텍스트 자동삽입)"** 을 명시 → 1차 타겟은 ③(opinion_doc)으로 읽힘.
다만 "**진단서·소견서 등** 서류"라는 표현은 ②(document_templates, 진단서/처방전/진료확인서 포함)의 광의 범위를 시사 → **planner 확인 1건 필요**(§A).

> ⚠ **"문구영문(name_en/phrase_en)"은 ①②③ 어디에도 존재하지 않는 신규 컬럼**. CSV 4컬럼 중 영문은 ADDITIVE 신설 대상.

---

## 1. 현행 상용구 시스템 기술맵

### ③ opinion_doc (요청의 1차 타겟 — 소견서 팝업)
- **저장**: `form_templates` row 1건 (clinic_id + form_key='opinion_doc', UNIQUE(clinic_id,form_key)). 문구는 `field_map`(jsonb)의 `sections` 키.
  - 구조: `sections = [{ "title": "진단서", "options": [{ "key":"oral_o", "label":"경구약 O", "phrase":"경구약 복용이 가능한 상태로 확인됩니다." }, ...] }, { "title":"금기증", "options":[...24종] }]`
  - `field_map`에는 `print_template_key`(='diag_opinion') 등 다른 키가 공존 → **sections만 교체, 타 키 보존** 필수.
- **주입(소비)**: `OpinionDocTab.tsx` → `useOpinionTemplate`가 동일 row를 read → `parseOpinionSections(field_map)` → 옵션 그리드 렌더. 옵션(버튼) 클릭 시 `togglePhraseInText(editor, phrase)`로 textarea(editor=최종 SSOT)에 줄단위 append/remove. DB sections 없으면 하드코드 `OPINION_SECTIONS`(empty-safe 폴백).
- **관리(쓰기)**: `OpinionPhrasesTab.tsx` (T-20260616-foot-OPINION-PHRASE-MGMT-TAB) — 섹션/옵션 CRUD를 jsonb 통째로 `form_templates.field_map` UPDATE(atomic, DDL 없음). RLS=`form_templates_admin_all`(is_admin_or_manager) → **admin/manager 쓰기 한정**. 저장 시 `['opinion_form_template']` 캐시 invalidate → OpinionDocTab 즉시 반영.
- **현재 입력 방식**: 버튼 1개씩 다이얼로그(label+phrase) 수기. **대량 입력 수단 없음** ← 본 요청의 공백.
- **option `key`**: 템플릿 내 유일 안정 식별자(`genOptionKey`, 한글 라벨 무관). **이력·매칭의 자연키 후보**.

### ② document_templates (광의 서류 — 진단서/처방전/진료확인서 본문)
- DDL(20260504): `id SERIAL, document_type TEXT, name TEXT, content TEXT, is_active, sort_order, created_at, updated_at`. + (20260603070000) `category, subcategory` 2단 분류 nullable 추가.
- **clinic_id 없음**(단일 클리닉 가정). **updated_at 이미 보유** → 행별 최신 업데이트 시각 추적 기반 존재.
- 소비: `DocumentPrintPanel.tsx`(CheckInDetailSheet 내 서류 발행) — `content`를 본문 프리셋으로 사용, form_templates(양식/좌표)와 결합해 인쇄(L-006 LOGIC-LOCK 경로).
- 관리: `DocumentTemplatesTab.tsx`(진료관리>서류템플릿) — document_type/name/content/category/subcategory CRUD 수기. **대량 입력 없음**.

### ① phrase_templates (서류 아님 — 참고용 배제)
- 진료차트/펜차트 차팅 상용구. phrase_type=pen_chart|medical_chart. **본 요청 범위 밖** — CSV 타겟에서 제외 권고.

### form_templates "서류 종류" 전체 universe (name_ko)
- 5종 seed(20260427100000): `diag_opinion`(소견서) · `diagnosis`(진단서) · `bill_detail`(진료비내역서) · `treat_confirm`(진료확인서) · `visit_confirm`(통원확인서)
- +`opinion_doc`(소견서, 옵션그리드형, 20260616160000)
- 컬럼: id(uuid) / clinic_id / category(foot-service) / **form_key** / **name_ko** / template_path / template_format(jpg\|png\|pdf\|html) / **field_map**(jsonb) / requires_signature / required_role / active / sort_order / UNIQUE(clinic_id,form_key)

---

## 2. CSV 컬럼 셋 확정안

초안 `서류종류 | 항목명 | 문구국문 | 문구영문` 을 현행 구조에 맞춰 가감:

### 타겟이 ③ opinion_doc(소견서 옵션그리드)인 경우 — **권고 매핑**
| CSV 컬럼 | 현행 매핑 | 비고 |
|----------|-----------|------|
| `서류종류` | `sections[].title` (예: 진단서 / 금기증) | 섹션 그룹핑 = 진단서/금기증. (※ "서류종류"라는 용어는 섹션명에 가까움 — §A 확인) |
| `항목명` | `options[].label` (버튼이름, 예: 경구약 O) | 매칭/업서트 자연키 후보. label 변경 시 신규로 인식되는 문제 → §3 key 정책 참조 |
| `문구국문` | `options[].phrase` (자동삽입멘트) | 필수 |
| `문구영문` | **신규** `options[].phrase_en` | jsonb 내 ADDITIVE 키. 현재 영문 인쇄 경로 없음 → 표시/인쇄 와이어링은 Phase 1+ 별도 |

권고 추가 컬럼(선택):
- `옵션키`(option key) — 숨김/선택 열. 있으면 정확 업서트(label 변경 무손실), 없으면 (서류종류+항목명) 자연키 매칭 후 신규 발번. **양식 다운로드 시 기존 행에는 key 채워서 제공** 권고.
- `활성여부`(O/X) — 일괄 비활성 지원(선택).

### 타겟이 ② document_templates(광의 서류 본문)인 경우
| CSV 컬럼 | 현행 매핑 |
|----------|-----------|
| `서류종류` | `document_type` (diagnosis/opinion/prescription/visit_confirmation/general) 또는 `category` |
| `항목명` | `name` (+`subcategory` 선택) |
| `문구국문` | `content` |
| `문구영문` | **신규** `content_en` 컬럼 (ALTER ADD, nullable) |

> 공통: CSV는 **UTF-8 BOM + 헤더 고정**, 콤마/줄바꿈 포함 문구는 따옴표 escape. 인코딩·헤더 검증을 업로드 1차 게이트로.

---

## 3. 스키마 권고 (data-architect CONSULT 입력안 — dev 마이그 실행 금지)

**원칙: ADDITIVE 우선, 신규 전용 테이블 최소화.**

### 3-1. 문구 저장 — ADDITIVE 확장 권고 (신규 상용구 테이블 비권고)
- **타겟 ③(opinion_doc)**: `field_map.sections[].options[]`에 **`phrase_en` 키 ADDITIVE** 추가. DDL 0(jsonb, OpinionPhrasesTab 저장 패턴 그대로). 신규 테이블 불요.
- **타겟 ②(document_templates)**: `content_en TEXT NULL` 컬럼 **ALTER ADD** (파괴 0). 신규 테이블 불요.
- 신규 전용 상용구 테이블은 **비권고** — 기존 소비 경로(OpinionDocTab/DocumentPrintPanel)가 이미 ③/②를 읽으므로, 별도 테이블 신설 시 이중 SSOT·동기화 부채 발생.

### 3-2. 업로드 이력 — **신규 테이블 1개** 권고 (`document_phrase_imports`)
요청의 "버튼별/항목명별 최신 업데이트 시각 + 업로드자 + 파일명 + 적용건수"는 기존 어느 테이블로도 표현 불가 → 경량 이력 테이블 신설.

```
document_phrase_imports (DA CONSULT 대상 — 아래는 제안 스키마)
  id            uuid PK
  clinic_id     uuid           -- ③ 멀티클리닉 대비(②는 단일이나 일관성 위해 보유)
  target_kind   text           -- 'opinion_doc' | 'document_templates' (CSV 타겟 구분)
  file_name     text           -- 업로드 원본 파일명
  uploaded_by   uuid           -- staff.id (감사)
  uploaded_at   timestamptz default now()
  row_total     int            -- CSV 총 행
  row_applied   int            -- 실제 반영(신규+갱신) 건수
  row_skipped   int            -- 무변경/오류 스킵
  summary       jsonb          -- 항목별 결과(서류종류/항목명/op: insert|update|skip)
```
- **"항목/버튼별 최신 업데이트 시각"** = `summary` jsonb에 항목별 타임스탬프 누적, 또는 ②는 행 `updated_at`(이미 존재) 직접 노출. ③(jsonb)은 옵션별 타임스탬프 보관 필드가 없으므로 → 옵션에 `updated_at` 키 ADDITIVE 동반 권고(또는 import 테이블 summary로 대체).
- 이력 테이블은 **append-only**(수정/삭제 없음) — 업로드 감사 추적.
- RLS = `form_templates_admin_all` 동형(is_admin_or_manager) write, clinic 격리.

> DA 판단 요청 포인트: (a) ③ phrase_en/updated_at을 jsonb 키로 둘지 vs ② content_en 컬럼, (b) 이력 테이블 신설 GO 여부 + summary jsonb 구조, (c) target_kind enum vs text.

---

## 4. 화면 위치 권고

> 정정: 요청의 "서비스관리>서류관리 탭"은 실제로는 **진료관리(ClinicManagement)** 아래에 위치. 서류 관련 어드민(서류템플릿=`documents`, 소견서상용구=`opinion_phrases`)이 모두 ClinicManagement 탭에 이미 존재.

| 후보 | 위치 | 평가 |
|------|------|------|
| **A (권고)** | 진료관리 > 기존 **소견서상용구(opinion_phrases)** 탭 또는 **서류템플릿(documents)** 탭 안에 "CSV 대량 입력" 섹션 추가 (양식 다운로드/업로드/이력) | ✅ 대량 설정 = 어드민 배치 작업의 성격과 일치. 기존 RLS·권한(admin/manager)·캐시 invalidate 경로 재사용. 타겟 테이블 관리 화면과 동거 → 응집도 높음 |
| B | DOCFORM 서류설정 팝업(환자 대면 서류 발행 팝업) 내 어드민 | ❌ 비권고 — 클리닉 일괄 설정을 환자별 임상 팝업에 결합 = 관심사 혼재. 발행 동선 회귀 위험. 팝업은 "소비" 전용 유지 |

**권고: 후보 A**. 타겟이 ③이면 OpinionPhrasesTab에 import 섹션, 타겟이 ②면 DocumentTemplatesTab에 import 섹션. (타겟 확정=§A)

---

## 5. DOCFORM-POPUP-OVERHAUL 정합

- 본 레포 `tickets/`에 **DOCFORM-POPUP-OVERHAUL 단일 티켓 파일은 미존재**(grep 0). 다만 서류 팝업/발행 표면은 활발히 in-flight:
  - 진행/대기: `T-20260614-foot-DOCPATIENTLIST-OPINION-COL-PHRASE-POPUP`(db-gate consult pending — 소견서 저장모델·환자별 기본값 결정 중) ← **③ opinion_doc 저장모델과 직접 겹침**.
  - 보호 락: `T-20260522-foot-DOC-PRINT-LOCK-L006`(LOGIC-LOCK **L-006** 서류출력 경로 통일) — 인쇄 경로 변경 금지 락 활성.
  - 최근 다수 DOCDASH/DOCPATIENTLIST 티켓이 서류 팝업/발행 표면 활발히 변경 중.
- **정합 전제(덮어쓰기 금지, 위에 얹기)**:
  1. CSV 주입 타겟이 ③(opinion_doc)이면, **저장 경로는 OpinionPhrasesTab과 동일한 `field_map.sections` jsonb UPDATE만 사용** — 새 저장 모델/새 테이블로 분기 금지(DOCPATIENTLIST-OPINION-COL-PHRASE-POPUP의 저장모델 결정과 충돌 방지). 그 결정이 sections 구조를 바꾸면 CSV 매핑도 따라가야 함 → **Phase 1 착수 전 해당 db-gate 결론 확인 필요**.
  2. 인쇄/출력 경로(L-006)는 **불가침** — CSV는 문구 데이터만 적재, 인쇄 스택 무변경.
  3. 옵션 `key` 안정성: 팝업 재구성이 option key 스킴을 바꾸면 CSV 업서트 자연키가 깨짐 → key 정책을 OVERHAUL과 공유.
- **의존 지점**: ① opinion_doc 저장모델 결정(DOCPATIENTLIST-OPINION-COL-PHRASE-POPUP db-gate), ② L-006 인쇄 락, ③ option key 스킴.

---

## A. planner 확인 필요 (Phase 1 착수 전)

1. **CSV 타겟 범위**: ③ 소견서 옵션그리드(버튼+자동삽입멘트) 단독인가, 아니면 ② 광의 서류(진단서/처방전/진료확인서 본문 content)까지 포함인가? → 매핑·스키마·화면이 갈림.
2. **"서류종류" 의미**: 섹션명(진단서/금기증)인가, form_key/document_type(소견서/진단서/처방전)인가?
3. **문구영문 용도**: 영문 서류 인쇄가 목표인가(인쇄 와이어링 필요), 아니면 데이터 보관/추후용인가? (현재 영문 인쇄 경로 0)
4. **이력 단위**: "버튼별 최신 업데이트 시각" = 업로드 배치 단위로 충분한가, 옵션(버튼) 개별 타임스탬프까지 필요한가?

---

## 가드 준수 확인
- 코드/DB 마이그/배포 변경 **0** (본 문서 = 분석·설계 제안 markdown only).
- 스키마 권고(§3)는 **data-architect CONSULT 입력안** — dev 직접 마이그 실행 안 함.
- 산출 = planner FOLLOWUP 회신. DA 자문 → Phase 1 착수.
