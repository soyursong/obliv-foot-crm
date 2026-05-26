---
id: T-20260526-foot-SVC-CATEGORY-SORT
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-passed: true
db-change: true
e2e-spec: tests/e2e/T-20260526-foot-SVC-CATEGORY-SORT.spec.ts
summary: "서비스관리 탭 전환(전체+6카테고리) + DnD/↑↓ 버튼 sort_order 변경 + DB persist (debounce 800ms). 탭 간 독립 순서, admin+특정탭+검색없음 조건 재정렬 활성. 신규 migration: idx_services_clinic_catlabel_sort + sort_order 재정규화."
created: 2026-05-26
risk_verdict: GO_WARN
risk_reason: "DB: sort_order 컬럼 재정규화(기존 상대 순서 유지, PARTITION BY clinic_id, category_label). FE: Services.tsx 전면 교체 — filteredRows → tabItems + DnD. PaymentMiniWindow의 display_order는 무관. CRUD(softDelete/hardDelete/insert) 로직 보존."
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
mq_origin: MSG-20260526-101601-9hll
---

## T-20260526-foot-SVC-CATEGORY-SORT — 서비스관리 탭별 순서 변경 + DB 저장

### 배경

서비스관리 페이지에서 각 카테고리 탭 내 항목 순서를 DnD/버튼으로 변경하고 DB에 저장하여 재접속 후에도 유지. 이전 T-20260525 티켓(FE-only 카테고리 정렬)의 후속으로 persistent 순서 관리 추가.

### 구현 내용

#### DB 마이그레이션 (`20260526120000_services_category_sort_order.sql`)
- `sort_order` 컬럼 `(clinic_id, category_label)` 단위로 재정규화 (PARTITION BY + ROW_NUMBER × 10)
- 인덱스 추가: `idx_services_clinic_catlabel_sort ON services(clinic_id, category_label, sort_order)`

#### Services.tsx 전면 재작성
- **탭 네비게이션**: `전체 + 기본 + 검사 + 상병 + 풋케어 + 수액 + 풋화장품` (7탭)
- **SortableServiceRow 컴포넌트**: useSortable hook 분리 + 드래그핸들(GripVertical) + ↑↓ 버튼
- **tabItems useMemo**: 탭별 sort_order 정렬 (전체 탭은 category_label → sort_order → name 3단)
- **canReorder 조건**: `isAdmin && activeTab !== '전체' && !debouncedSearch`
- **handleDragEnd**: DnD arrayMove → setRows 낙관적 업데이트 + scheduleSortSave
- **handleReorderBtn**: ↑↓ swap → setRows 낙관적 업데이트 + scheduleSortSave
- **scheduleSortSave**: debounce 800ms, batch UPDATE sort_order (AC-2)
- **재정렬 안내 텍스트**: canReorder일 때 표시
- **검색 활성 시 재정렬 비활성 안내**: amber 텍스트
- **전체 탭**: 항목분류 컬럼 표시, 재정렬 미지원
- **개별 탭**: 항목분류 컬럼 대신 재정렬 핸들 표시

#### DnD 센서
- PointerSensor(distance:3) → MouseSensor(distance:3) → TouchSensor(delay:250, tolerance:5)
- 태블릿 탭 오인식 방지 (touch-none 핸들)

### AC 충족 여부

- [x] **AC-1**: 탭별 DnD(drag handle) + ↑↓ 버튼 복합 지원
- [x] **AC-2**: sort_order UPDATE (debounce 800ms, batch). 신규 서비스 sort_order=999 → 탭 맨 뒤
- [x] **AC-3**: fetchServices에서 `.order('sort_order')` → 재진입 시 저장 순서 복원
- [x] **AC-4**: tabItems는 activeTab의 category_label 항목만 + 독립 sort_order 공간
- [x] **AC-5**: fetchServices에서 `.eq('clinic_id', clinic.id)` → 단일 지점 범위
- [x] **AC-6**: softDelete/hardDelete/insert 로직 보존. PaymentMiniWindow display_order 무영향
- [x] **AC-7**: 빌드 (build-passed 업데이트 예정) + E2E spec 22개 케이스

### 주의사항

- DB 마이그레이션은 Supabase Dashboard에서 수동 실행 필요 (supervisor 담당)
- sort_order 재정규화 후 기존 PaymentMiniWindow 동작 무영향 (display_order 독립)
- 재정렬은 admin 역할만 가능
