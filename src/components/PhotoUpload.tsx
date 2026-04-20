import { useCallback, useEffect, useState } from 'react';
import { Camera, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

interface Props {
  checkInId: string;
  photos: string[];
  onUpdated: () => void;
}

export function PhotoUpload({ checkInId, photos, onUpdated }: Props) {
  const [uploading, setUploading] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const publicUrls = (photos ?? []).map((path) => {
      if (path.startsWith('http')) return path;
      const { data } = supabase.storage.from('photos').getPublicUrl(path);
      return data.publicUrl;
    });
    setUrls(publicUrls);
  }, [photos]);

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      setUploading(true);

      const newPaths: string[] = [];
      for (const file of Array.from(files)) {
        const ext = file.name.split('.').pop() ?? 'jpg';
        const path = `${checkInId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage
          .from('photos')
          .upload(path, file, { contentType: file.type });
        if (error) {
          toast.error(`업로드 실패: ${error.message}`);
          continue;
        }
        newPaths.push(path);
      }

      if (newPaths.length > 0) {
        const allPhotos = [...(photos ?? []), ...newPaths];
        const { error } = await supabase
          .from('check_ins')
          .update({ treatment_photos: allPhotos })
          .eq('id', checkInId);
        if (error) {
          toast.error('사진 저장 실패');
        } else {
          toast.success(`${newPaths.length}장 업로드 완료`);
          onUpdated();
        }
      }

      setUploading(false);
      e.target.value = '';
    },
    [checkInId, photos, onUpdated],
  );

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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
          <Camera className="h-3 w-3" /> 비포/애프터 사진
        </span>
        <label className="cursor-pointer">
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleUpload}
            disabled={uploading}
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-1 text-xs pointer-events-none"
            disabled={uploading}
          >
            <Upload className="h-3 w-3" />
            {uploading ? '업로드 중…' : '사진 추가'}
          </Button>
        </label>
      </div>

      {urls.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {urls.map((url, i) => (
            <div key={i} className="relative group">
              <img
                src={url}
                alt={`Photo ${i + 1}`}
                className="w-full h-24 object-cover rounded-lg border"
              />
              <button
                onClick={() => removePhoto(i)}
                className="absolute top-1 right-1 hidden group-hover:flex h-9 w-9 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {urls.length === 0 && (
        <div className="rounded-lg border border-dashed py-4 text-center text-xs text-muted-foreground">
          사진이 없습니다
        </div>
      )}
    </div>
  );
}
