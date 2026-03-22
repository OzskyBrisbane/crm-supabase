#!/usr/bin/env node
/**
 * CRM 自動備份腳本 - 每週一運行
 * 備份 Supabase 數據並通過 OpenClaw 推送到企業微信群
 * 
 * 使用方法:
 * node scripts/weekly-backup.js [chatId]
 * 
 * 環境變量:
 * - WECOM_CHAT_ID: 企業微信群 ID（可選）
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 加載環境變量
require('dotenv').config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const WECOM_CHAT_ID = process.env.WECOM_CHAT_ID || process.argv[2];

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ 錯誤: 缺少 Supabase 配置');
  console.error('請檢查 .env 文件中的 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 格式化文件大小
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 格式化貨幣
function formatCurrency(amount) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 0
  }).format(amount || 0);
}

// 發送企業微信消息（通過 OpenClaw CLI）
async function sendWeComMessage(message, chatId) {
  if (!chatId) {
    console.log('⚠️ 未設置企業微信群 ID，跳過通知');
    return false;
  }

  try {
    // 將消息寫入臨時文件，避免命令行特殊字符問題
    const tmpFile = path.join('/tmp', `crm-msg-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, message, 'utf8');
    
    // 使用文件方式傳遞消息
    const cmd = `cat "${tmpFile}" | openclaw message send --channel wecom --target "${chatId}" --message -`;
    execSync(cmd, { stdio: 'inherit' });
    
    // 清理臨時文件
    fs.unlinkSync(tmpFile);
    return true;
  } catch (error) {
    console.error('⚠️ 企業微信發送失敗:', error.message);
    return false;
  }
}

// 生成數據表格（文字格式）
function generateDataTable(students) {
  if (!students || students.length === 0) return '暫無數據';
  
  // 選擇要顯示的字段
  const columns = [
    { key: 'student_name', title: '學生', width: 8 },
    { key: 'counsellor', title: '顧問', width: 8 },
    { key: 'school', title: '學校', width: 10 },
    { key: 'course', title: '課程', width: 10 },
    { key: 'status', title: '狀態', width: 6 },
    { key: 'tuition', title: '學費', width: 10, format: v => formatCurrency(v) },
    { key: 'bonus', title: '獎金', width: 8, format: v => formatCurrency(v) }
  ];
  
  // 生成表格
  let table = '';
  
  // 標題行
  const headerRow = columns.map(col => col.title).join(' │ ');
  table += headerRow + '\n';
  table += '─'.repeat(headerRow.length) + '\n';
  
  // 數據行
  students.forEach(student => {
    const row = columns.map(col => {
      let value = student[col.key] || '';
      if (col.format) value = col.format(value);
      return String(value).substring(0, col.width).padEnd(col.width);
    }).join(' │ ');
    table += row + '\n';
  });
  
  return table;
}

// 主備份函數
async function backupAndNotify() {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const dateStr = now.toLocaleDateString('zh-CN');
  const backupDir = path.join(__dirname, '..', 'backups');
  
  // 確保備份目錄存在
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  console.log('🔄 開始 CRM 每週備份...');
  console.log(`📅 時間: ${dateStr}`);
  console.log(`🔗 Supabase: ${SUPABASE_URL}`);
  
  try {
    // 獲取數據
    const { data: students, error } = await supabase
      .from('students')
      .select('*');
    
    if (error) throw error;
    
    const recordCount = students?.length || 0;
    
    // 創建備份
    const backup = {
      metadata: {
        timestamp: now.toISOString(),
        date: dateStr,
        url: SUPABASE_URL,
        version: '1.0'
      },
      data: {
        students: students || []
      }
    };
    
    // 保存 JSON 備份
    const jsonFile = path.join(backupDir, `crm-backup-${timestamp}.json`);
    fs.writeFileSync(jsonFile, JSON.stringify(backup, null, 2));
    const jsonSize = fs.statSync(jsonFile).size;
    
    // 創建 CSV 備份
    let csvFile = null;
    let csvSize = 0;
    if (recordCount > 0) {
      csvFile = path.join(backupDir, `crm-backup-${timestamp}.csv`);
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
      csvSize = fs.statSync(csvFile).size;
    }
    
    console.log(`✅ 備份完成!`);
    console.log(`📊 記錄數: ${recordCount}`);
    console.log(`📁 JSON: ${formatBytes(jsonSize)}`);
    if (csvFile) console.log(`📄 CSV: ${formatBytes(csvSize)}`);
    
    // 清理舊備份（保留最近 4 週）
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('crm-backup-'))
      .map(f => ({
        name: f,
        path: path.join(backupDir, f),
        time: fs.statSync(path.join(backupDir, f)).mtime
      }))
      .sort((a, b) => b.time - a.time);
    
    let deletedCount = 0;
    if (files.length > 8) {
      files.slice(8).forEach(f => {
        fs.unlinkSync(f.path);
        deletedCount++;
        console.log(`🗑️ 刪除舊備份: ${f.name}`);
      });
    }
    
    // 生成數據表格
    const dataTable = generateDataTable(students);
    
    // 計算統計數據
    const totalTuition = students?.reduce((sum, s) => sum + (s.tuition || 0), 0) || 0;
    const totalBonus = students?.reduce((sum, s) => sum + (s.bonus || 0), 0) || 0;
    
    // 生成報告消息
    const statusEmoji = recordCount > 0 ? '✅' : '⚠️';
    const message = `📊 CRM 系統每週備份報告

${statusEmoji} 備份時間：${dateStr} 週一
📁 數據記錄：${recordCount} 條
💰 總學費：${formatCurrency(totalTuition)}
🎁 總獎金：${formatCurrency(totalBonus)}
💾 備份大小：${formatBytes(jsonSize)}
🗑️ 清理舊備份：${deletedCount} 個

📋 數據明細：
${dataTable}
${recordCount === 0 ? '\n⚠️ 提醒：數據庫目前沒有記錄' : ''}`;

    console.log('\n' + '='.repeat(40));
    console.log('📤 準備發送企業微信通知...');
    console.log('='.repeat(40));
    
    // 發送通知
    if (WECOM_CHAT_ID) {
      await sendWeComMessage(message, WECOM_CHAT_ID);
    } else {
      console.log('\n📋 備份報告（未發送）:');
      console.log(message);
      console.log('\n💡 提示: 設置 WECOM_CHAT_ID 環境變量後將自動發送到企業微信');
    }
    
    return { 
      success: true, 
      recordCount, 
      jsonFile, 
      csvFile,
      timestamp,
      dateStr
    };
    
  } catch (error) {
    console.error('❌ 備份失敗:', error.message);
    
    // 發送失敗通知
    if (WECOM_CHAT_ID) {
      const failMessage = `❌ CRM 備份失敗！\n\n時間：${dateStr}\n錯誤：${error.message}\n\n請檢查系統狀態。`;
      await sendWeComMessage(failMessage, WECOM_CHAT_ID);
    }
    
    throw error;
  }
}

// 運行備份
backupAndNotify()
  .then(result => {
    console.log('\n✨ 備份流程完成');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 備份流程失敗');
    process.exit(1);
  });
