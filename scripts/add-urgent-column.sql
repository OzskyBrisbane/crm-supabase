-- 為 students 表添加 is_urgent 欄位（緊急標記）
-- 請在 Supabase Dashboard 的 SQL Editor 中執行

-- 添加欄位（如果不存在）
ALTER TABLE students 
ADD COLUMN IF NOT EXISTS is_urgent BOOLEAN DEFAULT FALSE;

-- 創建索引以提高查詢性能
CREATE INDEX IF NOT EXISTS idx_students_is_urgent ON students(is_urgent);

-- 驗證欄位已添加
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'students' 
AND column_name = 'is_urgent';
