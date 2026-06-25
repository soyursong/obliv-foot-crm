// ForeignInfoSection.tsx — 외국인 정보(국적/여권번호/만료일) + 여권 스캔 자동입력
// T-20260625-foot-PASSPORT-FOREIGN-INFO-PORT (origin: obliv-derm-crm hold/passport-foreign-info-20260609)
//
// 신규/수정 고객 모달 공용. 여권 스캔은 클라이언트 OCR(tesseract.js, 이미지 미저장).
//  - 카메라 촬영만(capture="environment") — 파일 업로드는 제외(AC: 카메라 촬영, 파일업로드 제외).
//  - MRZ 파싱 → 국적(alpha-3)·여권번호 자동입력 + 영문명/생년월일/성별은 onScanResult로 부모에 전달.
//  - 인식 실패 시 toast 안내 후 수동 입력 폴백.
//  - PII 가드: 여권 원본 이미지 영구저장 없음(scanPassportImage가 메모리 내에서만 처리·즉시 폐기).
import { useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/lib/toast';
import { scanPassportImage } from '@/lib/passport-ocr';
import { alpha3ToKoreanName, type MrzResult } from '@/lib/mrz';

export interface ForeignInfoValue {
  nationalityCode: string;
  passportNumber: string;
  docExpiry: string; // ISO yyyy-mm-dd (date input)
}

interface Props {
  value: ForeignInfoValue;
  onChange: (next: Partial<ForeignInfoValue>) => void;
  /** 펼침 상태(부모가 소유) */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 민감정보 수정 권한. false면 열람 전용(스캔/입력 비활성). 기본 true. */
  canEdit?: boolean;
  /**
   * 스캔 성공 시 부모-소관 필드(영문명/생년월일/성별) 반영용 콜백.
   * 국적/여권번호는 본 컴포넌트가 onChange로 직접 채운다.
   */
  onScanResult?: (result: MrzResult) => void;
}

export default function ForeignInfoSection({
  value,
  onChange,
  open,
  onOpenChange,
  canEdit = true,
  onScanResult,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanPhase, setScanPhase] = useState('');

  // 국적 alpha-3 → 한글명 힌트 (매칭 시에만)
  const koName = alpha3ToKoreanName(value.nationalityCode || null);

  async function handlePassportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 동일 파일 재선택 허용 위해 input 즉시 초기화
    e.target.value = '';
    if (!file) return;

    setScanning(true);
    setScanPhase('준비 중');
    try {
      const result = await scanPassportImage(file, (phase) => setScanPhase(phase));
      if (!result) {
        toast.error('여권 인식 실패 — MRZ(하단 2줄)를 읽지 못했습니다. 빛 반사 없이 다시 촬영하거나 수동으로 입력해 주세요.');
        return;
      }

      // 외국인 정보 섹션 자동 펼침
      onOpenChange(true);

      const filled: string[] = [];
      const patch: Partial<ForeignInfoValue> = {};
      if (result.passportNumber) {
        patch.passportNumber = result.passportNumber;
        filled.push('여권번호');
      }
      // 국적 — MRZ alpha-3 그대로 저장(검토·수정 가능). 한글명은 힌트로 표시.
      if (result.nationalityAlpha3) {
        patch.nationalityCode = result.nationalityAlpha3;
        filled.push('국적');
      }
      if (Object.keys(patch).length > 0) onChange(patch);

      // 부모-소관 필드(영문명/생년월일/성별)
      if (onScanResult) onScanResult(result);
      if (result.surname || result.givenNames) filled.push('영문명');
      if (result.birthDate) filled.push('생년월일');
      if (result.gender) filled.push('성별');

      if (filled.length === 0) {
        toast.error('여권 인식 결과 부족 — 읽을 수 있는 정보가 없습니다. 수동으로 입력해 주세요.');
        return;
      }
      toast.success(`여권 자동입력: ${filled.join(', ')} (검토 후 수정 가능)`);
    } catch (err) {
      console.error('[ForeignInfoSection] passport scan error', err);
      toast.error('여권 스캔 오류 — 잠시 후 다시 시도하거나 수동으로 입력해 주세요.');
    } finally {
      setScanning(false);
      setScanPhase('');
    }
  }

  return (
    <div className="rounded-md border border-input">
      {/* 헤더: 토글 + 여권 스캔 버튼(상시 노출) */}
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
          data-testid="foreign-info-toggle"
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          외국인 정보
        </button>
        {canEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={scanning}
            onClick={() => fileRef.current?.click()}
            data-testid="passport-scan-btn"
          >
            {scanning ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                {scanPhase || '인식 중'}
              </>
            ) : (
              <>
                <ScanLine className="h-4 w-4 mr-1.5" />
                여권 스캔하기
              </>
            )}
          </Button>
        )}
        {/* 카메라 촬영 전용 (파일 업로드 제외): capture="environment" */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePassportFile}
          data-testid="passport-scan-input"
        />
      </div>

      {open && (
        <div className="space-y-3 border-t border-input px-3 py-3">
          <p className="text-[11px] text-muted-foreground">
            여권을 촬영하면 국적·여권번호·영문명·생년월일·성별이 자동 입력됩니다. (원본 이미지는 저장되지 않습니다)
          </p>
          {/* 국적 (여권 국가코드, ISO alpha-3) */}
          <div className="space-y-1.5">
            <Label>
              국적 <span className="text-xs text-muted-foreground font-normal">(여권 국가코드)</span>
            </Label>
            <div className="flex items-center gap-2">
              <Input
                value={value.nationalityCode}
                onChange={(e) => onChange({ nationalityCode: e.target.value.toUpperCase().slice(0, 3) })}
                placeholder="예: KOR"
                className="font-mono w-28"
                maxLength={3}
                readOnly={!canEdit}
                data-testid="foreign-nationality"
              />
              {koName && <span className="text-sm text-muted-foreground">{koName}</span>}
            </div>
          </div>
          {/* 여권번호 */}
          <div className="space-y-1.5">
            <Label>여권번호</Label>
            <Input
              value={value.passportNumber}
              onChange={(e) => onChange({ passportNumber: e.target.value.toUpperCase() })}
              placeholder="예: M12345678"
              className="font-mono"
              readOnly={!canEdit}
              data-testid="foreign-passport"
            />
          </div>
          {/* 만료일 (여권/체류 만료일) */}
          <div className="space-y-1.5">
            <Label>
              만료일 <span className="text-xs text-muted-foreground font-normal">(여권·체류)</span>
            </Label>
            <Input
              type="date"
              value={value.docExpiry}
              onChange={(e) => onChange({ docExpiry: e.target.value })}
              readOnly={!canEdit}
              data-testid="foreign-doc-expiry"
            />
          </div>
        </div>
      )}
    </div>
  );
}
