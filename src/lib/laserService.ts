// T-20260801-foot-ALT-LASERBLOCK-PAYMINI-PARITY: ALT 환자 레이저코드 삽입 차단 판별의 공용 SSOT.
//   origin = T-20260522-foot-ALT-BADGE AC-12 (DocumentPrintPanel 내부 정의).
//   서류패널(DocumentPrintPanel)·결제 미니창(PaymentMiniWindow) 양쪽이 동일 로직을 공유하도록
//   lib 로 승격(중복정의 금지). 판별 규칙 변경 시 이 파일 한 곳만 수정.
//
// 판별(OR 결합 — 어느 하나라도 매치 시 레이저로 차단):
//   1. 코드가 SZ035 prefix — 현장 확정 레이저코드(MSG-rpiy, 김주연 총괄 reporter-authoritative).
//        실 DB 확인(2026-08-01): SZ035="비가열성/가열성 진균증 레이저 치료", SZ035-OL/TL/FL(비가열레이저 변형).
//        startsWith('SZ035') 로 진균증 레이저 치료 2종 + 변형 3종 전부 포섭.
//        (기존 MM*/category 만으론 SZ035 미포섭 → ALT 차단 무력화 hazard였음. 이 판별이 그 gap 봉합.)
//   2. 코드가 MM* prefix — 이학요법료 레이저 수가(기존 판별, 유지).
//   3. category=laser/heated_laser — 영문 카테고리(현 DB는 한글'풋케어'라 사실상 inert이나 회귀방지 위해 유지).
//   4. 이름에 '레이저' 포함 — 명칭 기반 폴백.
export function isLaserService(svc: {
  service_code?: string | null;
  name?: string | null;
  category?: string | null;
}): boolean {
  const cat = svc.category ?? '';
  const name = svc.name ?? '';
  const code = (svc.service_code ?? '').toUpperCase();
  return (
    code.startsWith('SZ035') || // 현장 확정 진균증 레이저 치료(가열성/비가열성) + 변형
    code.startsWith('MM') ||    // 이학요법료 레이저 수가코드 접두사
    cat === 'laser' ||
    cat === 'heated_laser' ||
    name.includes('레이저')
  );
}
