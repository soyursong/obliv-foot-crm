# Frontend Code Review — Obliv Ose

> Reviewer: Senior Frontend Engineer
> Date: 2026-04-10
> Scope: src/ 전체 (pages, components, hooks, lib)

---

## 1. 코드 품질 (Code Quality)

### 1-1. AdminDashboard 메가 컴포넌트 (Critical)
**파일:** `src/pages/AdminDashboard.tsx` (1194줄, useState 30+개)

단일 컴포넌트에 대시보드, DnD 보드, 예약 타임라인, 상세 시트, 결제 모달, 서비스 추가, 수동등록, 컨텍스트 메뉴가 모두 포함됨.

**수정 제안:**
- `ReservationTimeline` — 좌측 예약 타임라인 (L643-731)
- `KanbanBoard` — DnD 칸반 보드
- `CheckInDetailSheet` — 고객 상세 시트 (L959-1108)
- `ManualRegisterDialog` — 수동 등록 모달 (L924-952)
- 각 컴포넌트에 필요한 state만 분리

### 1-2. `as any` 타입 캐스팅 남용 (Medium)

| 파일:줄 | 코드 | 수정 |
|---------|------|------|
| `WaitingScreen.tsx:170` | `.update({ status: 'no_show' } as any)` | Supabase types에서 status 타입을 string으로 허용하므로 `as any` 불필요 — 제거 |
| `AdminReservations.tsx:225` | `.insert({...} as any)` | `referral_source`가 DB types에 이미 있음 — `as any` 제거 |
| `AdminDashboard.tsx:400` | `.update(updates as any)` | `updates` 타입을 `TablesUpdate<'check_ins'>`로 명시 |
| `AdminDashboard.tsx:505` | `.insert({...} as any)` | `referral_source`, `status` 등 이미 타입에 존재 — 제거 |
| `lib/clinic.ts:61,66` | `(supabase.from('clinic_schedules') as any)` | `clinic_schedules`, `clinic_holidays`가 DB types에 있음 — `as any` 불필요 |
| `AdminReservations.tsx:128` | `(clinic as any).max_per_slot` | Clinic 인터페이스에 `max_per_slot` 추가 필요 (이미 `lib/clinic.ts`에 있음) |

### 1-3. 인터페이스 중복 정의 (Medium)

동일 인터페이스가 여러 파일에 반복:

- **Customer** — `AdminCustomers.tsx:17`, `AdminLayout.tsx:21`, `AdminReservations.tsx:19`
- **PaymentRecord** — `AdminCustomers.tsx:19`, `AdminHistory.tsx:33`, `AdminLayout.tsx:35`, `AdminClosing.tsx:20`
- **VisitRecord** — `AdminCustomers.tsx:18`, `AdminLayout.tsx:28`
- **ReservationRecord** — `AdminCustomers.tsx:20`, `AdminLayout.tsx:45`, `AdminHistory.tsx:47`

**수정:** `src/types/index.ts`에 공통 인터페이스 정의 후 import

### 1-4. Index.tsx 하드코딩 리다이렉트 (Low)
**파일:** `src/pages/Index.tsx:8`
```tsx
// 현재
navigate('/jongno-longlasting');
// 수정: 환경변수 또는 설정에서 기본 클리닉 슬러그를 가져오도록
```

---

## 2. 성능 (Performance)

### 2-1. Route-level lazy loading 미적용 (Medium)
**파일:** `src/App.tsx`

모든 페이지가 eager import. Admin 페이지는 고객 체크인 페이지와 동시 로드 불필요.

```tsx
// 수정
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AdminReservations = lazy(() => import('./pages/AdminReservations'));
// ... 등
// <Suspense fallback={<LoadingSpinner />}> 래핑
```

### 2-2. Realtime UPDATE 시 전체 재조회 (High)
**파일:** `src/pages/AdminDashboard.tsx:353`
```tsx
// 현재: 모든 UPDATE 이벤트마다 fetchCheckIns(clinicId) 호출
// → 모든 check_in + payments + services 재조회
// 수정: payload.new로 상태만 업데이트하고, services/payments 변경 시에만 재조회
```

### 2-3. 검색 입력 디바운스 없음 (Medium)
**파일:**
- `AdminCustomers.tsx:64` — `searchQuery` 변경 시 즉시 API 호출
- `AdminLayout.tsx:93` — `handleSearch` 매 키스트로크마다 실행

```tsx
// 수정: useDebouncedValue 또는 setTimeout 패턴
const debouncedQuery = useDebouncedValue(searchQuery, 300);
useEffect(() => { fetchCustomers(); }, [debouncedQuery]);
```

### 2-4. 워터폴 쿼리 (Medium)
**파일:** `AdminCustomers.tsx:60-86`

고객 목록 → 체크인 목록 → 결제 목록이 순차 실행. `Promise.all`로 병렬화 가능.

```tsx
const [ciData, payData] = await Promise.all([
  supabase.from('check_ins').select(...).in('customer_id', ids),
  supabase.from('payments').select(...).in('customer_id', ids),
]);
```

### 2-5. WaitingScreen 불필요한 전체 조회 (Low)
**파일:** `WaitingScreen.tsx:31-47`

대기 인원 수 확인을 위해 당일 전체 check_in을 가져와 클라이언트 필터링. `count` 쿼리 사용 권장.

---

## 3. 접근성 (Accessibility)

### 3-1. label과 input 연결 누락 (High)
**파일:**
- `AdminLogin.tsx:39` — `<label>이메일</label>` → `htmlFor` 없음
- `AdminLogin.tsx:49` — `<label>비밀번호</label>` → `htmlFor` 없음
- `AdminClosing.tsx:230,243` — "카드 영수증 합계", "현금 수납 합계"
- 모든 Admin 모달의 `<label>` 태그

```tsx
// 수정
<label htmlFor="email" className="...">이메일</label>
<Input id="email" type="email" ... />
```

### 3-2. 커스텀 `<select>` aria 속성 누락 (Medium)
네이티브 `<select>`를 직접 사용하면서 `aria-label` 없음:
- `AdminClosing.tsx:379` — 환불 고객 선택
- `AdminReservations.tsx:460,514` — 시간 선택
- `AdminStaff.tsx:290,307` — 역할 선택
- `AdminDashboard.tsx:932` — 국가코드 선택

```tsx
// 수정
<select aria-label="환불 대상 고객 선택" ...>
```

### 3-3. 컨텍스트 메뉴 키보드 접근 불가 (Medium)
**파일:** `AdminDashboard.tsx:907-921`

우클릭으로만 열리는 컨텍스트 메뉴. 키보드 사용자가 접근 불가.

**수정:** DropdownMenu 컴포넌트를 사용하거나, 카드에 "..." 버튼 추가

### 3-4. Loading 상태 스크린리더 미고려 (Low)
**파일:** `WaitingScreen.tsx:107`, `CheckIn.tsx:161`

```tsx
// 현재
<p className="text-muted-foreground">Loading...</p>
// 수정
<p className="text-muted-foreground" role="status" aria-live="polite">Loading...</p>
```

---

## 4. 반응형 (Responsiveness)

### 4-1. AdminLayout 헤더 오버플로우 (High)
**파일:** `AdminLayout.tsx:177-245`

헤더에 로고 + 클리닉 선택 + 날짜 + 검색바 + 6개 네비 버튼 + 로그아웃이 한 줄. 1280px 이하에서 오버플로우.

**수정:**
- 버튼 그룹을 햄버거 메뉴 또는 드롭다운으로
- 태블릿에서 검색바 축소

### 4-2. AdminHistory 5열 그리드 (Medium)
**파일:** `AdminHistory.tsx:195`
```tsx
// 현재
<div className="grid grid-cols-5 gap-3 mb-6">
// 수정
<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
```

### 4-3. 테이블 모바일 대응 없음 (Medium)
AdminHistory, AdminCustomers, AdminClosing, AdminStaff의 테이블이 모바일에서 가로 스크롤 불가.

```tsx
// 수정: 테이블을 overflow-x-auto wrapper로 감싸기
<div className="overflow-x-auto">
  <Table>...</Table>
</div>
```

### 4-4. Sheet 고정 너비 (Low)
**파일:** 여러 곳
- `AdminHistory.tsx:320` — `w-[420px]`
- `AdminCustomers.tsx:203` — `w-[440px]`
- `AdminLayout.tsx:274` — `w-[400px]`

```tsx
// 수정
className="w-full sm:w-[420px]"
```

### 4-5. AdminDashboard 보드 레이아웃 (Medium)
**파일:** `AdminDashboard.tsx:641`

고정 px 기반 레이아웃(w-40, w-44, w-28)은 태블릿에서 부적절. 최소 overflow-x-auto 필요.

---

## 5. 에러 처리 (Error Handling)

### 5-1. Supabase 에러 무시 패턴 (Critical)
대부분의 Supabase 호출에서 `error` 반환값을 체크하지 않음:

| 파일:줄 | 함수 | 위험도 |
|---------|------|--------|
| `AdminHistory.tsx:94-98` | `fetchData` | data가 null이면 빈 배열 표시 — 네트워크 에러 구분 불가 |
| `AdminClosing.tsx:162-166` | `handleSave` | 마감 저장 실패 시 사용자에게 성공 토스트 표시 |
| `AdminStaff.tsx:114` | `handleAddStaff` | 직원 등록 실패 시 무반응 |
| `AdminReservations.tsx:221` | `handleCreate` | 예약 등록 실패 시 "등록 완료" 토스트 표시 |
| `AdminDashboard.tsx:460` | `handlePaymentComplete` | 결제 insert 실패 시 상태만 변경되고 결제 미반영 |

```tsx
// 수정 패턴
const { error } = await supabase.from('daily_closings').update(data).eq('id', closing.id);
if (error) {
  toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
  return;
}
toast({ title: '마감 확정 완료' });
```

### 5-2. 초기 로딩 상태 없음 (Medium)
Admin 페이지들이 clinicId 로드 전까지 빈 화면 표시. 로딩 스피너 필요:
- `AdminHistory.tsx`
- `AdminCustomers.tsx`
- `AdminClosing.tsx`
- `AdminStaff.tsx`
- `AdminReservations.tsx`

### 5-3. Auth guard 미흡 (Medium)
각 Admin 페이지에서 개별적으로 세션 체크하고 있음. 하지만 토큰 만료 시 실시간 처리 없음.

**수정:** `AdminLayout` 또는 별도 `ProtectedRoute`에서 일괄 처리 + `onAuthStateChange` 리스너

### 5-4. Optimistic update 롤백 없음 (Low)
**파일:** `AdminDashboard.tsx:388-402`

상태 변경을 UI에 즉시 반영(optimistic update)하지만, DB 호출 실패 시 롤백하지 않음.

---

## 6. 코드 중복 (DRY)

### 6-1. Auth + Clinic 초기화 패턴 (High)
6개 Admin 페이지에 동일 패턴:

```tsx
useEffect(() => {
  const init = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate('/admin'); return; }
    const clinic = await getSelectedClinic();
    if (clinic) { setClinicId(clinic.id); setClinicName(clinic.name); }
  };
  init();
}, [navigate]);
```

**파일:** AdminHistory:80, AdminCustomers:50, AdminClosing:63, AdminReservations:119, AdminStaff:91, AdminDashboard:319

**수정:** `useClinicAuth()` 커스텀 훅 생성

```tsx
function useClinicAuth() {
  const navigate = useNavigate();
  const [clinic, setClinic] = useState<Clinic | null>(null);
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate('/admin'); return; }
      const c = await getSelectedClinic();
      if (c) setClinic(c);
    };
    init();
  }, [navigate]);
  return clinic;
}
```

### 6-2. 고객 상세 시트 중복 (High)
`AdminLayout.tsx:272-362`와 `AdminCustomers.tsx:202-286`에 거의 동일한 고객 상세 Sheet 존재.

**수정:** `CustomerDetailSheet` 공통 컴포넌트로 추출

### 6-3. 날짜 네비게이터 중복 (Medium)
이전/다음 날짜 + 캘린더 팝오버 패턴이 3곳에 반복:
- `AdminHistory.tsx:169-191`
- `AdminClosing.tsx:181-192`
- `AdminReservations.tsx:284-300` (주간 단위)

**수정:** `DateNavigator` 컴포넌트 추출

### 6-4. COUNTRY_CODES 중복 (Low)
- `CheckIn.tsx:11-23` — 11개 국가
- `AdminDashboard.tsx:77-79` — 4개 국가

**수정:** `lib/constants.ts`로 통합

### 6-5. 유입경로 옵션 중복 (Low)
- `CheckIn.tsx:25-43` — REFERRAL_SOURCES_KO/EN
- `AdminDashboard.tsx:941` — 인라인 배열
- `AdminReservations.tsx:471` — 인라인 배열

**수정:** `lib/constants.ts`로 통합

### 6-6. STATUS_BADGE / STATUS_BG 중복 (Low)
- `AdminHistory.tsx:55-63` — STATUS_BADGE
- `AdminReservations.tsx:33-41` — STATUS_BG

---

## 7. 기타 이슈

### 7-1. SQL Injection 위험 (Critical)
**파일:** `AdminCustomers.tsx:64`
```tsx
query = query.or(`name.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%`);
```
**파일:** `AdminLayout.tsx:104`
```tsx
query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%`);
```

사용자 입력을 직접 Supabase PostgREST 필터 문자열에 삽입. `,`, `.`, `(`, `)` 등 특수문자로 필터 조작 가능.

**수정:** Supabase JS client의 `.ilike()` 필터 사용 또는 입력값 sanitize
```tsx
const sanitized = searchQuery.replace(/[%_(),.]/g, '');
query = query.or(`name.ilike.%${sanitized}%,phone.ilike.%${sanitized}%`);
```

### 7-2. AdminLayout TABS 배열 비어 있음 (Low)
**파일:** `AdminLayout.tsx:53`
```tsx
const TABS: { key: string; label: string; path: string }[] = [];
```
사용되지 않는 탭 바 렌더링 로직(L249-268)이 dead code로 남아있음.

### 7-3. localStorage JSON.parse 에러 미처리 (Low)
**파일:** `CheckIn.tsx:61`
```tsx
const parsed = JSON.parse(saved); // saved가 유효하지 않은 JSON이면 크래시
```

```tsx
// 수정
try {
  const parsed = JSON.parse(saved);
  // ...
} catch { localStorage.removeItem('obliv_customer'); }
```

### 7-4. window.confirm 사용 (Low)
여러 곳에서 `window.confirm` 사용 (AdminClosing:291, AdminReservations:247, AdminStaff:318).
AlertDialog 컴포넌트로 대체하면 디자인 일관성 + 접근성 개선.

### 7-5. window.alert 사용 (Low)
**파일:** `AdminReservations.tsx:379`
```tsx
window.alert(`추가 ${overflow}명: ${names}`);
```
Dialog 또는 Popover로 대체 권장.

---

## 우선순위 요약

| 우선순위 | 항목 | 영향 |
|---------|------|------|
| 🔴 Critical | SQL Injection 위험 (7-1) | 보안 |
| 🔴 Critical | Supabase 에러 무시 (5-1) | 데이터 정합성 |
| 🟠 High | AdminDashboard 분리 (1-1) | 유지보수성 |
| 🟠 High | Auth+Clinic 초기화 훅 (6-1) | DRY |
| 🟠 High | label 접근성 (3-1) | 접근성 |
| 🟠 High | AdminLayout 헤더 반응형 (4-1) | UX |
| 🟡 Medium | Route lazy loading (2-1) | 초기 로드 성능 |
| 🟡 Medium | Realtime 전체 재조회 (2-2) | 런타임 성능 |
| 🟡 Medium | 검색 디바운스 (2-3) | API 부하 |
| 🟡 Medium | 고객 상세 시트 중복 (6-2) | DRY |
| 🟡 Medium | 날짜 네비게이터 중복 (6-3) | DRY |
| 🟢 Low | 인터페이스 통합 (1-3) | 타입 안전성 |
| 🟢 Low | 상수 통합 (6-4, 6-5, 6-6) | DRY |
