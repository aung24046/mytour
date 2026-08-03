-- =====================================================================
-- Storage bucket 'org-assets' — เก็บโลโก้บริษัทที่ใช้บนหัวกระดาษเอกสาร
-- วันที่: 2026-08-03
--
-- รันใน Supabase Dashboard → SQL Editor
-- (จะกดสร้างผ่าน Dashboard → Storage → New bucket ก็ได้ ผลเหมือนกัน
--  แต่ทำผ่าน SQL แล้วเก็บไฟล์นี้ไว้ จะสร้างซ้ำบน environment อื่นได้ตรงกัน)
--
-- ทำไมต้อง public: หัวกระดาษเรียกโลโก้ผ่าน <img src> ตรงๆ ตอนพิมพ์
-- ถ้าเป็น private ต้องใช้ signed URL ที่หมดอายุ ซึ่งพังตอนเปิดเอกสารซ้ำ
-- โลโก้บริษัทเป็นข้อมูลสาธารณะอยู่แล้ว จึงไม่มีปัญหาเรื่องความลับ
-- =====================================================================

-- 1) สร้าง bucket แบบ public read
INSERT INTO storage.buckets (id, name, public)
VALUES ('org-assets', 'org-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2) Policy — ทำตามแบบเดียวกับ bucket 'receipt-photos' ที่ ExpenseTracker ใช้อยู่
--    คุมสิทธิ์จริงที่ชั้นแอป (RequireRole capability="org.profile" → owner เท่านั้น)
--    ⚠️ ตราบใดที่ยังไม่มี Supabase Auth ผู้ใช้ที่รู้ anon key ยังอัปโหลดตรงได้
--       เหมือนตารางอื่นทั้งระบบ (ดู lib/permissions.js หัวไฟล์)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'org_assets_read'
  ) THEN
    CREATE POLICY org_assets_read ON storage.objects
      FOR SELECT USING (bucket_id = 'org-assets');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'org_assets_write'
  ) THEN
    CREATE POLICY org_assets_write ON storage.objects
      FOR ALL USING (bucket_id = 'org-assets')
      WITH CHECK (bucket_id = 'org-assets');
  END IF;
END $$;

-- ตรวจผล
-- SELECT id, name, public FROM storage.buckets WHERE id = 'org-assets';
-- SELECT policyname FROM pg_policies WHERE schemaname='storage' AND tablename='objects';
