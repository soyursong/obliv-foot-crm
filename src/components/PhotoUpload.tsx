import { useEffect, useState } from 'react';
import { Camera, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

interface Props {
  checkInId: string;
  photos: string[];
  onUpdated: () => void;
}

/** 비포/애프터 사진을 한 장에 배치하여 인쇄창을 열어준다 */
function openPhotoPrintWindow(urls: string[], customerName: string) {
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const imgTags = urls
    .map(
      (url, i) => `
      <div class="photo-item">
        <img src="${url}" alt="사진 ${i + 1}" />
        <p class="photo-label">사진 ${i + 1}</p>
      </div>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>비포/애프터 사진 — ${customerName}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    body {
      font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;
      margin: 0; padding: 0;
      background: #fff;
    }
    .header {
      text-align: center;
      margin-bottom: 8px;
      border-bottom: 1.5px solid #333;
      padding-bottom: 6px;
    }
    .header h2 { font-size: 16px; margin: 0 0 2px; }
    .header p  { font-size: 11px; color: #666; margin: 0; }
    .photo-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 10px;
      padding: 8px 0;
    }
    .photo-item { text-align: center; }
    .photo-item img {
      width: 100%;
      height: 160px;
      object-fit: cover;
      border: 1px solid #ccc;
      border-radius: 4px;
    }
    .photo-label { font-size: 10px; color: #555; margin-top: 3px; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h2>비포/애프터 사진 — ${customerName}</h2>
    <p>출력일: ${today} · 총 ${urls.length}장</p>
  </div>
  <div class="photo-grid">
    ${imgTags}
  </div>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (!w) {
    toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
    return;
  }
  w.document.write(html);
  w.document.close();
  w.focus();

  // 첫 이미지 로드 후 인쇄
  const firstImg = w.document.querySelector('img');
  if (firstImg) {
    firstImg.onload = () => w.print();
  } else {
    setTimeout(() => w.print(), 600);
  }
}

export function PhotoUpload({ checkInId, photos, onUpdated }: Props) {
  const [urls, setUrls] = useState<string[]>([]);
  const [customerName, setCustomerName] = useState('고객');

  useEffect(() => {
    (async () => {
      // check_in 의 customer_name 조회 (인쇄 제목용)
      const { data: ci } = await supabase
        .from('check_ins')
        .select('customer_name')
        .eq('id', checkInId)
        .single();
      if (ci?.customer_name) setCustomerName(ci.customer_name);

      // 사진 URL 생성
      const resolved: string[] = [];
      for (const path of photos ?? []) {
        if (path.startsWith('http')) { resolved.push(path); continue; }
        const { data } = await supabase.storage.from('photos').createSignedUrl(path, 3600);
        resolved.push(data?.signedUrl ?? '');
      }
      setUrls(resolved);
    })();
  }, [photos, checkInId]);

  const removePhoto = async (index: number) => {
    if (!window.confirm('사진을 삭제하시겠습니까?')) return;
    const path = photos[index];
    const newPhotos = photos.filter((_, i) => i !== index);
    const { error } = await supabase
      .from('check_ins')
      .update({ treatment_photos: newPhotos })
      .eq('id', checkInId);
    if (error) {
      toast.error('삭제 실패');
      return;
    }
    await supabase.storage.from('photos').remove([path]);
    toast.success('사진 삭제');
    onUpdated();
  };

  const handlePrint = () => {
    const validUrls = urls.filter(Boolean);
    if (validUrls.length === 0) {
      toast.error('출력할 사진이 없습니다 — 고객차트에서 사진을 업로드하세요');
      return;
    }
    openPhotoPrintWindow(validUrls, customerName);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
          <Camera className="h-3 w-3" /> 비포/애프터 사진
          {photos.length > 0 && (
            <span className="ml-1 text-teal-600 font-normal">{photos.length}장</span>
          )}
        </span>
        {/* T-20260506-foot-CHART-SIMPLE-REVAMP: [사진추가] → [출력] 버튼 */}
        <Button
          variant="outline"
          size="sm"
          className="gap-1 text-xs border-teal-300 text-teal-700 hover:bg-teal-50"
          onClick={handlePrint}
          disabled={urls.filter(Boolean).length === 0}
        >
          <Printer className="h-3 w-3" />
          출력
        </Button>
      </div>

      {urls.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {urls.map((url, i) => (
            <div key={i} className="relative group">
              <img
                src={url}
                alt={`사진 ${i + 1}`}
                className="w-full h-24 object-cover rounded-lg border"
              />
              <button
                onClick={() => removePhoto(i)}
                className="absolute top-1 right-1 hidden group-hover:flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
                title="사진 삭제"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed py-4 text-center text-xs text-muted-foreground">
          사진 없음 — 고객차트(미니홈피창)에서 업로드하세요
        </div>
      )}
    </div>
  );
}
