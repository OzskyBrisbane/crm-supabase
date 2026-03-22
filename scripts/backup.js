// Supabase 數據庫備份腳本
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// 從環境變量或 .env 文件讀取配置
require('dotenv').config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mskzfsxvwoftmunowtix.supabase.co';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  console.error('錯誤: 缺少 Supabase API Key');
  console.error('請設置 NEXT_PUBLIC_SUPABASE_ANON_KEY 或 SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function backupDatabase() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, '..', 'backups');
  
  // 創建備份目錄
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  const backupFile = path.join(backupDir, `crm-backup-${timestamp}.json`);
  
  console.log('🔄 開始備份 CRM 數據庫...');
  console.log(`📅 時間: ${new Date().toLocaleString()}`);
  console.log(`🔗 URL: ${SUPABASE_URL}`);
  
  try {
    // 獲取所有表數據
    const tables = ['students', 'users', 'auth_users'];
    const backup = {
      metadata: {
        timestamp: new Date().toISOString(),
        url: SUPABASE_URL,
        version: '1.0'
      },
      data: {}
    };
    
    // 備份 students 表
    console.log('📊 備份 students 表...');
    const { data: students, error: studentsError } = await supabase
      .from('students')
      .select('*');
    
    if (studentsError) {
      console.warn('⚠️ 讀取 students 表失敗:', studentsError.message);
      backup.data.students = { error: studentsError.message, records: [] };
    } else {
      backup.data.students = {
        count: students?.length || 0,
        records: students || []
      };
      console.log(`✅ Students: ${students?.length || 0} 條記錄`);
    }
    
    // 保存備份文件
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
    
    console.log('\n✅ 備份完成!');
    console.log(`📁 文件: ${backupFile}`);
    console.log(`📊 總記錄數: ${backup.data.students.count || 0}`);
    
    // 同時創建一個 CSV 格式的備份（更易讀）
    if (students && students.length > 0) {
      const csvFile = path.join(backupDir, `crm-backup-${timestamp}.csv`);
      const headers = Object.keys(students[0]).join(',');
      const rows = students.map(row => 
        Object.values(row).map(v => {
          if (v === null) return '';
          const str = String(v);
          if (str.includes(',') || str.includes('\n') || str.includes('"')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(',')
      );
      fs.writeFileSync(csvFile, [headers, ...rows].join('\n'));
      console.log(`📄 CSV: ${csvFile}`);
    }
    
    return backupFile;
    
  } catch (error) {
    console.error('❌ 備份失敗:', error.message);
    process.exit(1);
  }
}

backupDatabase();
