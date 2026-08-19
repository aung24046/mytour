-- =====================================================================
-- Storage bucket 'quiz-media' — รูป/วิดีโอประกอบคำถามในควิซ
-- วันที่: 18 ส.ค. 2026 (เฟส 2 ของ MyTour_Quiz_Design_v1.md)
--
-- รันใน Supabase Dashboard → SQL Editor
--
-- ทำไมต้อง public: จอใหญ่กับมือถือลูกทัวร์เรียกไฟล์ผ่าน <img>/<video> ตรงๆ
-- ถ้าเป็น private ต้องใช้ signed URL ที่หมดอายุ ซึ่งพังตอนเปิดข้อเดิมซ้ำ
-- และรูปคำถามไม่ใช่ความลับ (ความลับคือ "เฉลย" ซึ่งอยู่ในตาราง quiz_keys)
--
-- ⚠️ อย่าเผลอเอาเฉลยมาใส่ในชื่อไฟล์หรือรูป — bucket นี้ใครเดา URL ถูกก็เปิดได้
--    เช่น อย่าตั้งชื่อไฟล์ว่า "answer-tokyo.jpg"
--
-- จำกัดขนาดที่ 10 MB ต่อไฟล์ (บังคับจริงที่ชั้น bucket ไม่ใช่แค่ฝั่ง UI):
--   งานจริงเล่นบนรถบัสที่ใช้ 4G ร่วมกัน 40 คน — วิดีโอ 50 MB คือเงียบกลางงาน
--   ฝั่งแอปจำกัดความยาววิดีโอไว้ 15 วินาทีอีกชั้นหนึ่ง
-- =====================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'quiz-media', 'quiz-media', true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Policy — แบบเดียวกับ 'org-assets' / 'receipt-photos'
-- คุมสิทธิ์จริงที่ชั้นแอป (route ใช้ capability 'quiz.edit')
-- ⚠️ ตราบใดที่ยังไม่มี Supabase Auth ผู้ใช้ที่รู้ anon key ยังอัปโหลดตรงได้
--    เหมือนทั้งระบบ (ดู lib/permissions.js หัวไฟล์)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'quiz_media_read'
  ) THEN
    CREATE POLICY quiz_media_read ON storage.objects
      FOR SELECT USING (bucket_id = 'quiz-media');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'quiz_media_write'
  ) THEN
    CREATE POLICY quiz_media_write ON storage.objects
      FOR ALL USING (bucket_id = 'quiz-media')
      WITH CHECK (bucket_id = 'quiz-media');
  END IF;
END $$;

-- ตรวจผล
-- SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'quiz-media';
