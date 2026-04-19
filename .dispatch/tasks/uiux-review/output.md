# UI/UX 디자이너 리뷰 — 오블리브 Ose

> 리뷰 일자: 2026-04-10
> 대상: src/pages/*.tsx + src/components/*.tsx
> 환경: 데스크탑(직원 대시보드) + 모바일(환자 셀프체크인/대기화면)

---

## 1. 시각적 일관성 (Visual Consistency)

### 1-1. 버튼 색상 불일치 — Login vs 나머지 페이지
**문제:** AdminLogin.tsx:62 에서 로그인 버튼이 `bg-primary`를 사용하지만, 나머지 모든 CTA 버튼은 `bg-accent`를 사용함. primary(HSL 213 27% 24%, 어두운 네이비)와 accent(HSL 199 89% 48%, 밝은 시안)는 완전히 다른 색상.
**영향:** 사용자가 브랜드 색상을 인식하는 데 혼란을 줌. 로그인 → 대시보드 전환 시 톤이 갑자기 바뀜.
**수정:**
```tsx
// AdminLogin.tsx:62
// before
className="w-full h-12 bg-primary text-primary-foreground hover:bg-primary/90"
// after
className="w-full h-12 bg-accent text-accent-foreground hover:bg-accent/90"
```

### 1-2. select 요소에 디자인 시스템 미적용
**문제:** 여러 페이지에서 `<select>`를 사용할 때 네이티브 스타일링을 직접 적용하고 있음(예: AdminStaff.tsx:290, AdminClosing.tsx:379, PaymentModal.tsx:129 등). shadcn/ui의 `Select` 컴포넌트 대신 네이티브 HTML select를 쓰면서 높이·테두리·radius가 페이지마다 미세하게 다름.
- `h-10` vs `h-12` vs 명시 없음
- `rounded-md` vs `rounded-lg`
- border 색상: `border-input` vs `border` (디폴트)
**영향:** 폼 요소의 일관성이 깨져서 전체적으로 "조립한" 느낌.
**수정:** 모든 select에 통일된 클래스를 적용하거나 shadcn Select 컴포넌트로 교체:
```tsx
// 통일 클래스
className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
```

### 1-3. 카드 border-radius 불일치
**문제:** 카드 컴포넌트에 `rounded-xl`, `rounded-2xl`, `rounded-lg`가 혼용됨.
- WaitingScreen:146 → `rounded-2xl`
- AdminHistory:219 → `rounded-xl`
- DraggableCard(compact):129 → `rounded-lg`
- DraggableCard(full):155 → `rounded-xl`
**영향:** 미세하지만 시각적 정돈감을 떨어뜨림.
**수정:** 메인 카드는 `rounded-xl`, 내부 서브카드는 `rounded-lg`로 통일.

### 1-4. 헤더 nav 버튼 active 상태 없음
**문제:** AdminLayout.tsx:227-244에서 모든 네비게이션 버튼이 `variant="outline"`으로 동일함. 현재 활성 탭을 시각적으로 구분할 수 없음. `activeTab` prop이 있으나 TABS 배열이 비어있어(line 53) 탭 바가 렌더링되지 않고, 상단 버튼들에도 active 스타일이 없음.
**영향:** 직원이 현재 어떤 페이지에 있는지 한눈에 파악 불가.
**수정:**
```tsx
// AdminLayout.tsx — 각 nav 버튼에 active 조건 추가
<Button
  variant={activeTab === 'queue' ? 'default' : 'outline'}
  size="sm"
  onClick={() => navigate('/admin/dashboard')}
  className={activeTab === 'queue' ? 'bg-accent text-accent-foreground' : ''}
>
  대시보드
</Button>
```

---

## 2. 정보 계층 (Information Hierarchy)

### 2-1. 대시보드 예약 타임라인 — 시간 레이블 가독성
**문제:** AdminDashboard.tsx:697 에서 시간 레이블이 `text-[10px]`이고 30분 슬롯은 빈칸. 정시만 `w-10` 너비에 2자리 시간(예: "10")만 표시.
**영향:** 좁은 w-44 사이드바에서 시간 위치를 파악하기 어려움.
**수정:**
```tsx
// 30분 슬롯에도 ':30' 표시, 가독성 향상
<div className={`w-10 shrink-0 px-1 text-right text-[10px] pt-1 ${
  isHour ? 'font-semibold text-foreground' : 'text-muted-foreground'
}`}>
  {isHour ? slot.slice(0, 2) + ':00' : ':30'}
</div>
```

### 2-2. 고객 상세 시트 — 방문 이력 상태 라벨이 영문 raw 값
**문제:** AdminLayout.tsx:345, AdminCustomers.tsx:261에서 방문 이력의 status가 `{v.status}`로 영문 raw 값(waiting, consultation, done 등)을 그대로 출력함.
**영향:** 직원이 한글 라벨 대신 영문 코드를 읽어야 함.
**수정:**
```tsx
// STATUS_KO 매핑 사용
const STATUS_KO: Record<string, string> = {
  waiting: '대기', consultation: '상담', treatment_waiting: '시술대기',
  treatment: '시술중', done: '완료', no_show: '노쇼',
};
// 사용
<span className="text-xs text-muted-foreground">{STATUS_KO[v.status] || v.status}</span>
```

### 2-3. AdminHistory 요약 카드 — 5칸 동일 비중
**문제:** AdminHistory.tsx:195-216 에서 5개 요약 카드가 `grid-cols-5`로 동일 비율. "총 방문"과 "매출"이 가장 중요하나, "노쇼"나 "미결제"와 같은 크기를 차지.
**영향:** 중요도와 시각적 비중이 일치하지 않음.
**수정:**
```tsx
// 매출 카드를 2칸으로 확대
<div className="grid grid-cols-6 gap-3 mb-6">
  <div className="bg-card rounded-xl border border-border px-4 py-3">
    ...총 방문...
  </div>
  <div>...시술완료...</div>
  <div>...노쇼...</div>
  <div>...미결제...</div>
  <div className="col-span-2 bg-card rounded-xl border border-border px-4 py-3">
    ...매출 (더 큰 폰트, 강조)...
  </div>
</div>
```

### 2-4. 예약관리 — 셀 내 정보 밀도 과다
**문제:** AdminReservations.tsx:354-374에서 각 예약 셀이 9px 폰트로 이름+상태+결제+노쇼를 한 줄에 넣음. 셀 높이가 고정되어 있어 2건 이상이면 overflow 처리.
**영향:** 예약이 많은 시간대에 정보가 잘려서 보이지 않음.
**수정:** 셀 최소 높이를 동적으로 조절하고, 폰트를 10px로 올리기:
```tsx
// 기본 슬롯 높이를 콘텐츠에 맞게 자동 확장
style={{ minHeight: items.length > 2 ? `${items.length * 20 + 8}px` : '36px' }}
```

---

## 3. 사용성 (Usability)

### 3-1. 로딩 상태 — 스피너 없이 텍스트만
**문제:** CheckIn.tsx:162, WaitingScreen.tsx:107 등에서 로딩 시 단순히 `<p>Loading...</p>` 텍스트만 표시. 스켈레톤이나 스피너가 없음.
**영향:** 사용자가 앱이 멈춘 건지 로딩 중인지 구분 불가. 특히 모바일에서 네트워크가 느릴 때 UX 저하.
**수정:**
```tsx
<div className="flex min-h-screen items-center justify-center bg-background">
  <div className="flex flex-col items-center gap-3">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
    <p className="text-muted-foreground text-sm">불러오는 중...</p>
  </div>
</div>
```

### 3-2. 빈 상태 — 고객 목록의 "고객 없음"이 CTA 없음
**문제:** AdminCustomers.tsx:176에서 검색 결과가 없을 때 `결과 없음`만 표시. 고객 없을 때도 `고객 없음`만 표시하고, "신규 고객 등록" 같은 CTA가 없음.
**영향:** 빈 화면에서 다음 행동을 유도하지 못함.
**수정:**
```tsx
{customers.length === 0 && (
  <TableRow>
    <TableCell colSpan={5} className="text-center py-12">
      <p className="text-muted-foreground mb-3">{searchQuery ? '검색 결과가 없습니다' : '등록된 고객이 없습니다'}</p>
      {!searchQuery && (
        <Button variant="outline" onClick={() => setCreateOpen(true)}>+ 첫 고객 등록하기</Button>
      )}
    </TableCell>
  </TableRow>
)}
```

### 3-3. 체크인 취소 — confirm() 네이티브 다이얼로그
**문제:** WaitingScreen.tsx:169, AdminClosing.tsx:291 등에서 `window.confirm()`을 사용. 네이티브 다이얼로그는 모바일에서 스타일링이 불가하고, 앱의 디자인과 이질적.
**영향:** 사용자 경험이 갑자기 네이티브 OS로 전환되어 불안감 유발.
**수정:** shadcn `AlertDialog` 컴포넌트로 교체.

### 3-4. 대시보드 컨텍스트 메뉴 — 위치 오버플로우
**문제:** AdminDashboard.tsx:910에서 컨텍스트 메뉴가 `fixed` + `left/top` 으로 열림. 화면 우측/하단 가장자리에서 우클릭하면 메뉴가 화면 밖으로 나갈 수 있음.
**영향:** 메뉴 항목이 잘려서 클릭 불가.
**수정:**
```tsx
const menuX = Math.min(contextMenu.x, window.innerWidth - 200);
const menuY = Math.min(contextMenu.y, window.innerHeight - 180);
style={{ left: menuX, top: menuY }}
```

### 3-5. 예약관리 overflow 알림 — window.alert 사용
**문제:** AdminReservations.tsx:378-379에서 2건 초과 예약을 클릭하면 `window.alert()`으로 이름을 보여줌.
**영향:** 3-1과 동일. 네이티브 다이얼로그는 UX를 저하시킴. Popover나 Tooltip으로 교체 권장.

---

## 4. 모바일 UX

### 4-1. CheckIn — 국번 셀렉트 터치 영역 부족
**문제:** CheckIn.tsx:206에서 국번 select가 `h-12`이지만 `w-[110px]`로 좁음. 모바일에서 국가번호 선택 시 좁은 영역에서 드롭다운 열기가 불편.
**영향:** 특히 외국인 환자가 국번을 변경하려 할 때 오탭 가능성 높음.
**수정:**
```tsx
className="h-12 rounded-lg border border-input bg-background px-3 text-base w-[120px] shrink-0"
// text-sm → text-base로 확대 (모바일 auto-zoom 방지)
```

### 4-2. WaitingScreen — 체크인 취소 버튼이 너무 작음
**문제:** WaitingScreen.tsx:173에서 체크인 취소 링크가 `text-xs` + `underline`로 매우 작음. 터치 타겟이 약 20x12px 정도.
**영향:** Apple HIG 권장 터치 타겟(44x44px) 미달. 실수 취소를 원하는 환자가 탭하기 어려움.
**수정:**
```tsx
<button
  onClick={...}
  className="text-sm text-muted-foreground underline py-2 px-4 min-h-[44px]"
>
  {lang === 'ko' ? '체크인 취소' : 'Cancel Check-in'}
</button>
```

### 4-3. WaitingScreen Call Alert — 확인 버튼 접근성
**문제:** WaitingScreen.tsx:128-134에서 호출 알림이 전체 화면을 덮지만, 확인 버튼이 `variant="outline"` + 반투명 배경(`bg-card/20`). 배경색과 대비가 낮아 눈에 잘 띄지 않음.
**영향:** 환자가 알림을 받았을 때 어디를 눌러야 하는지 찾기 어려움. 특히 밝은 조명 아래 모바일 화면에서.
**수정:**
```tsx
<Button
  onClick={() => setCallAlert(null)}
  className="text-lg px-8 py-4 h-auto bg-white text-foreground font-bold shadow-lg hover:bg-gray-100"
>
  {t(lang, 'confirm')}
</Button>
```

### 4-4. CheckIn 폼 — referralSource 미선택 시 피드백 부재
**문제:** CheckIn.tsx:276에서 방문 경로 미선택 시 submit 버튼이 disabled되지만, 왜 disabled인지 시각적 힌트가 없음. 필수 항목임을 라벨에 표시하지 않음.
**영향:** 모바일에서 스크롤 후 왜 버튼이 안 눌리는지 당황.
**수정:** 라벨에 필수 마크 추가:
```tsx
<label className="block text-sm font-medium text-foreground mb-1.5">
  {lang === 'ko' ? '방문 경로' : 'How did you find us?'} <span className="text-destructive">*</span>
</label>
```

---

## 5. 대시보드 레이아웃

### 5-1. 시술실 15개 → 5x3 그리드에서 빈 공간 과다
**문제:** AdminDashboard.tsx:822에서 `grid-cols-5 gap-1`로 시술실 15개를 5x3 배치. 환자가 적을 때 대부분의 시술실이 빈 `border-dashed` 상자로 남아서 공간을 차지하지만 정보가 없음.
**영향:** 대시보드의 가장 넓은 영역이 빈 상자로 채워져 "한산한 느낌"만 줌. 의미 있는 정보 밀도가 낮음.
**수정 방안:**
```tsx
// 옵션 A: 빈 방은 축소하여 사용 중인 방을 강조
className={`rounded-lg border transition-all ${
  hasOccupant
    ? 'border-green-200 bg-green-50/50 p-1.5 w-32'  // 넓게
    : 'border-dashed border-border/60 bg-muted/10 p-0.5 w-20 opacity-50'  // 축소
}`}
```
```tsx
// 옵션 B: 사용 중인 방만 먼저 표시, 빈 방은 "+12 rooms available" 요약
```

### 5-2. 대기/시술대기/완료 컬럼 폭 고정 w-40
**문제:** AdminDashboard.tsx:748,797,850에서 세 컬럼 모두 `w-40`(160px) 고정. 화면이 넓을 때도 확장되지 않고, 환자 이름이 긴 경우(외국인) truncate됨.
**영향:** 넓은 모니터에서도 왼쪽에 몰려있는 레이아웃.
**수정:** `min-w-40 flex-shrink-0` + 상담/시술 영역이 나머지 공간을 flex로 채우도록.

### 5-3. 예약 사이드바 w-44 너무 좁음
**문제:** AdminDashboard.tsx:643에서 예약 타임라인이 `w-44`(176px). 고객 이름, 유입경로 배지, 메모, 체크인/노쇼 버튼 2개가 이 안에 들어감.
**영향:** 모든 텍스트가 truncate되어 예약 정보를 제대로 읽을 수 없음.
**수정:**
```tsx
<div className="w-56 shrink-0 border-r border-border bg-card overflow-hidden flex flex-col">
```
또는 접기/펼치기 토글 추가.

### 5-4. 수평 스크롤 방향 명시 부재
**문제:** 대시보드가 `flex gap-2`로 수평 배치되어 있어 화면 폭이 부족하면 수평 스크롤이 필요. 그러나 스크롤바가 보이지 않고(overflow-auto), 스크롤 가능하다는 시각적 힌트가 없음.
**영향:** 직원이 오른쪽에 시술실이 더 있는지 모를 수 있음.
**수정:** 우측에 그라디언트 fade 힌트 추가:
```tsx
// 오른쪽 가장자리에 fade overlay
<div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-muted/50 to-transparent pointer-events-none" />
```

---

## 6. 색상 의미 (Color Semantics)

### 6-1. 상태 색상 — treatment_waiting 정의 누락
**문제:** index.css에 `--status-treatment-waiting`이 정의되어 있지 않음. i18n.ts:94에서 `status-treatment-waiting`을 참조하지만, CSS에는 waiting/consultation/treatment/done/noshow만 있음.
**영향:** WaitingScreen의 호출 알림에서 시술대기 상태일 때 배경색이 적용되지 않음(fallback으로 status-waiting 사용).
**수정:**
```css
/* index.css */
--status-treatment-waiting: 45 93% 47%;  /* 노란색 계열 */

.status-treatment-waiting {
  background-color: hsl(var(--status-treatment-waiting));
}
```

### 6-2. AdminHistory vs AdminDashboard — 동일 상태, 다른 색상
**문제:**
- AdminHistory.tsx:55-63의 `STATUS_BADGE`: done=`bg-green-100 text-green-700`, treatment=`bg-emerald-100 text-emerald-700`
- AdminReservations.tsx:33-41의 `STATUS_BG`: done=`bg-emerald-100 text-emerald-700`
- 대시보드 컬럼 헤더: treatment=`bg-green-500` 점
- green vs emerald 혼용

**영향:** 같은 상태인데 페이지마다 색조가 미묘하게 다름. 직원의 색상-상태 연결 학습을 방해.
**수정:** 상태별 색상을 하나의 상수 파일로 중앙 관리:
```ts
// lib/status-colors.ts
export const STATUS_COLORS = {
  waiting:    { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  consultation: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
  treatment_waiting: { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-400' },
  treatment:  { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  done:       { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-300' },
  no_show:    { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' },
  unpaid:     { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500' },
} as const;
```

### 6-3. 완료 상태 — 완료=green vs done=gray 혼란
**문제:**
- 대시보드 완료 컬럼: 헤더 dot=`bg-gray-300` → 완료를 "끝남"으로 표현(중립)
- AdminHistory: done=`bg-green-100 text-green-700` → 완료를 "성공"으로 표현
- 결제 완료 Badge: `bg-green-100 text-green-700`

**영향:** "완료"의 의미가 페이지마다 다르게 해석됨. 대시보드에서는 "끝난 것"(grey), 이력에서는 "성공적으로 시술 완료"(green).
**수정:** 통일 방향 제안 — "완료+결제" = green, "완료+미결제" = orange, 대시보드에서도 green dot 사용.

---

## 7. 마이크로인터랙션

### 7-1. 드래그 시 시각 피드백 — drop zone 강조 미약
**문제:** DroppableZone(AdminDashboard.tsx:182)에서 `isOver` 시 `ring-2 ring-accent/50 bg-accent/5` 적용. accent가 시안이라 매우 연한 하이라이트. 상담실/시술실의 기존 bg-blue-50/bg-green-50와 구분이 어려움.
**영향:** 드래그 중 어느 방에 드롭하려는 건지 시각적 확인이 어려움.
**수정:**
```tsx
className={`transition-colors ${
  isOver ? 'ring-2 ring-accent bg-accent/15 scale-[1.02] shadow-md' : ''
} ${className || ''}`}
```

### 7-2. DragOverlay 카드 — 기존 카드와 차별화 부족
**문제:** CardPreview(AdminDashboard.tsx:186-192)가 기본 카드와 거의 동일한 스타일(`bg-card rounded-xl border shadow-lg`). 드래그 중인 카드가 원래 자리의 카드와 혼동될 수 있음.
**영향:** 드래그 조작 중 어느 것이 "움직이는 카드"인지 순간적으로 헷갈림.
**수정:**
```tsx
<div className="bg-card rounded-xl border-2 border-accent p-3 shadow-xl w-56 rotate-2 opacity-90">
```

### 7-3. 토스트 알림 — 위치 및 지속시간 미설정
**문제:** useToast를 사용하지만, Toaster/Sonner 설정에서 기본 위치(bottom-right)와 기본 지속시간이 커스터마이징되지 않음. 대시보드에서는 왼쪽 예약 패널 위에 토스트가 가려질 수 있음.
**영향:** 새 체크인 알림이 진행 중인 작업 영역을 가릴 수 있음.
**수정:** Toaster 위치를 top-right로 설정:
```tsx
// App.tsx or layout
<Toaster position="top-right" duration={3000} />
```

### 7-4. 예약 체크인/노쇼 버튼 — 클릭 후 피드백 지연
**문제:** AdminDashboard.tsx:713-718에서 "체크인" / "노쇼" 버튼 클릭 후 즉각적인 UI 피드백 없이 DB 요청을 기다림. Realtime subscription이 UI를 갱신하지만, 네트워크 지연 시 버튼이 눌렸는지 불확실.
**영향:** 직원이 버튼을 여러 번 누를 수 있음 (중복 체크인 위험).
**수정:** 클릭 시 즉시 loading 상태 표시 + 버튼 비활성화:
```tsx
<Button
  size="sm"
  variant="outline"
  className="h-5 text-[9px] flex-1"
  disabled={isProcessing}
  onClick={async () => { setIsProcessing(true); await handleReservationCheckIn(res); setIsProcessing(false); }}
>
  {isProcessing ? '...' : '체크인'}
</Button>
```

### 7-5. 마취 타이머 — animate-pulse가 주의를 과도하게 끌 수 있음
**문제:** DraggableCard:144에서 마취 20분 이상 경과 시 `animate-pulse`가 적용됨. 여러 환자가 동시에 마취 중이면 카드가 동시에 깜빡여서 시각적 노이즈.
**영향:** 중요한 정보가 깜빡임 속에 묻힘.
**수정:** pulse 대신 정적 강조 + 아이콘 표시:
```tsx
className={`text-[10px] mt-0.5 ${
  anesthesiaElapsed >= 20
    ? 'text-green-600 font-bold bg-green-50 rounded px-1'
    : 'text-purple-600'
}`}
```

---

## 8. 추가 이슈

### 8-1. 접근성 — form label과 input 연결 불완전
**문제:** 대부분의 폼에서 `<label>` 태그에 `htmlFor`가 없고 `<Input>`에 `id`가 없음 (CheckIn.tsx:190-197, AdminLogin.tsx:39-46 등). 유일한 예외: CheckIn.tsx:256의 consent checkbox.
**영향:** 스크린 리더 사용자, 라벨 클릭으로 인풋 포커스 전환 불가.
**수정:** 각 input에 id 추가, label에 htmlFor 매칭.

### 8-2. NotFound 페이지 — 한국어화 미적용
**문제:** NotFound.tsx:15-16에서 "Oops! Page not found"와 "Return to Home"이 영문.
**영향:** 한국어 사용자에게 갑작스러운 영문 페이지.
**수정:**
```tsx
<h1 className="mb-4 text-4xl font-bold">404</h1>
<p className="mb-4 text-xl text-muted-foreground">페이지를 찾을 수 없습니다</p>
<a href="/" className="text-accent underline hover:text-accent/90">홈으로 돌아가기</a>
```

### 8-3. 대시보드 PaymentModal 2개 동시 렌더링
**문제:** AdminDashboard.tsx:955-956에서 PaymentModal이 2개 렌더링됨 (하나는 드래그→완료, 하나는 상세 시트). 두 모달 모두 `z-[100]`이라 동시 오픈 시 겹침 가능.
**영향:** 에지 케이스이나, 동시 열림 시 UI가 깨질 수 있음.
**수정:** 단일 PaymentModal로 통합하거나, open 조건을 상호 배타적으로 관리.

### 8-4. 예약관리 주간 그리드 — min-w-[800px] 하드코딩
**문제:** AdminReservations.tsx:305에서 `min-w-[800px]` 고정. 7일 x 시간 슬롯 그리드가 800px 미만이면 수평 스크롤.
**영향:** 1024px 이하 노트북에서 사용성 저하. 토요일/일요일 칼럼이 항상 스크롤 뒤에 숨음.
**수정:** 영업일만 표시하는 5일 뷰 옵션 추가 또는 컬럼 너비를 비율로 변경.

---

## 우선순위 정리

| 등급 | 이슈 | 영향도 | 난이도 |
|------|------|--------|--------|
| **P0 (즉시)** | 6-1 treatment_waiting CSS 누락 | 기능 버그 | 낮음 |
| **P0 (즉시)** | 1-4 nav active 상태 없음 | 네비 혼란 | 낮음 |
| **P1 (높음)** | 6-2 상태 색상 중앙화 | 전체 일관성 | 중간 |
| **P1 (높음)** | 2-2 상태 라벨 영문 raw 값 | 가독성 | 낮음 |
| **P1 (높음)** | 3-1 로딩 스피너 부재 | 사용자 불안 | 낮음 |
| **P1 (높음)** | 4-3 Call Alert 확인 버튼 대비 | 모바일 핵심 | 낮음 |
| **P1 (높음)** | 7-4 체크인 버튼 중복 클릭 방지 | 데이터 무결성 | 낮음 |
| **P2 (중간)** | 1-1 로그인 버튼 색상 | 브랜드 일관성 | 낮음 |
| **P2 (중간)** | 5-3 예약 사이드바 폭 | 정보 가독성 | 낮음 |
| **P2 (중간)** | 7-1 드롭존 강조 | 드래그 UX | 낮음 |
| **P2 (중간)** | 4-2 취소 버튼 터치 타겟 | 모바일 접근성 | 낮음 |
| **P3 (낮음)** | 나머지 | 개선 사항 | 다양 |
