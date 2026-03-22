#!/usr/bin/env node
/**
 * CRM 自動備份腳本 - 每週一運行
 * 備份 Supabase 數據並通過郵件發送
 * 
 * 使用方法:
 * node scripts/weekly-backup-email.js
 * 
 * 環境變量:
 * - SMTP_SERVER: SMTP 服務器地址
 * - SMTP_PORT: SMTP 端口
 * - SMTP_USER: SMTP 用戶名
 * - SMTP_PASS: SMTP 密碼
 * - EMAIL_FROM: 發件人地址
 * - EMAIL_TO: 收件人地址（可多個，用逗號分隔）
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// 加載環境變量
require('dotenv').config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// 郵件配置
const SMTP_SERVER = process.env.SMTP_SERVER;
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM;
const EMAIL_TO = process.env.EMAIL_TO;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ 錯誤: 缺少 Supabase 配置');
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

// 生成 HTML 表格
function generateHTMLTable(students) {
  if (!students || students.length === 0) {
    return '<p>暫無數據</p>';
  }
  
  const columns = [
    { key: 'student_name', title: '學生姓名' },
    { key: 'counsellor', title: '顧問' },
    { key: 'school', title: '學校' },
    { key: 'course', title: '課程' },
    { key: 'source', title: '來源' },
    { key: 'status', title: '狀態' },
    { key: 'tuition', title: '學費', format: v => formatCurrency(v) },
    { key: 'bonus', title: '獎金', format: v => formatCurrency(v) }
  ];
  
  let html = '<table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; font-family: Arial, sans-serif;">';
  
  // 表頭
  html += '<tr style="background-color: #f0f0f0;">';
  columns.forEach(col => {
    html += `<th style="text-align: left;">${col.title}</th>`;
  });
  html += '</tr>';
  
  // 數據行
  students.forEach((student, index) => {
    const bgColor = index % 2 === 0 ? '#ffffff' : '#f9f9f9';
    html += `<tr style="background-color: ${bgColor;">`;
    columns.forEach(col => {
      let value = student[col.key] || '';
      if (col.format) value = col.format(value);
      html += `<td>${value}</td>`;
    });
    html += '</tr>';
  });
  
  html += '</table>';
  return html;
}

// 發送郵件
async function sendEmail(subject, htmlContent, attachments = []) {
  if (!SMTP_SERVER || !SMTP_USER || !SMTP_PASS || !EMAIL_FROM || !EMAIL_TO) {
    console.log('⚠️ 郵件配置不完整，跳過郵件發送');
    console.log('請檢查 .env 文件中的 SMTP 配置');
    return false;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_SERVER,
      port: parseInt(SMTP_PORT),
      secure: parseInt(SMTP_PORT) === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });

    const recipients = EMAIL_TO.split(',').map(e => e.trim());
    
    const info = await transporter.sendMail({
      from: `"CRM 備份系統" <${EMAIL_FROM}>`,
      to: recipients,
      subject: subject,
      html: htmlContent,
      attachments: attachments
    });

    console.log(`✅ 郵件發送成功: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('❌ 郵件發送失敗:', error.message);
    return false;
  }
}

// 主備份函數
async function backupAndEmail() {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const dateStr = now.toLocaleDateString('zh-CN');
  const backupDir = path.join(__dirname, '..', 'backups');
  
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  console.log('🔄 開始 CRM 每週備份（郵件版）...');
  console.log(`📅 時間: ${dateStr}`);
  
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
      data: { students: students || [] }
    };
    
    // 保存 JSON
    const jsonFile = path.join(backupDir, `crm-backup-${timestamp}.json`);
    fs.writeFileSync(jsonFile, JSON.stringify(backup, null, 2));
    const jsonSize = fs.statSync(jsonFile).size;
    
    // 創建 CSV
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
    
    // 清理舊備份
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
      });
    }
    
    // 計算統計
    const totalTuition = students?.reduce((sum, s) => sum + (s.tuition || 0), 0) || 0;
    const totalBonus = students?.reduce((sum, s) => sum + (s.bonus || 0), 0) || 0;
    
    // 生成郵件內容
    const subject = `📊 CRM 每週備份報告 - ${dateStr}`;
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .stats { background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .stats-item { margin: 10px 0; }
    table { width: 100%; margin-top: 20px; }
    th, td { padding: 10px; text-align: left; border: 1px solid #ddd; }
    th { background-color: #4CAF50; color: white; }
    tr:nth-child(even) { background-color: #f9f9f9; }
    .footer { margin-top: 30px; padding: 15px; background-color: #f0f0f0; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="header">
    <h1>📊 CRM 每週備份報告</h1>
    <p>備份時間：${dateStr}</p>
  </div>
  
  <div class="content">
    <div class="stats">
      <h2>📈 統計概覽</h2>
      <div class="stats-item">📁 數據記錄：<strong>${recordCount} 條</strong></div>
      <div class="stats-item">💰 總學費：<strong>${formatCurrency(totalTuition)}</strong></div>
      <div class="stats-item">🎁 總獎金：<strong>${formatCurrency(totalBonus)}</strong></div>
      <div class="stats-item">💾 備份大小：<strong>${formatBytes(jsonSize)}</strong></div>
      <div class="stats-item">🗑️ 清理舊備份：<strong>${deletedCount} 個</strong></div>
    </div>
    
    <h2>📋 數據明細</h2>
    ${generateHTMLTable(students)}
  </div>
  
  <div class="footer">
    <p>此郵件由 CRM 自動備份系統發送</p>
    <p>備份文件：${csvFile ? path.basename(csvFile) : '無'} | ${jsonFile ? path.basename(jsonFile) : '無'}</p>
  </div>
</body>
</html>
    `;
    
    // 準備附件
    const attachments = [];
    if (csvFile && fs.existsSync(csvFile)) {
      attachments.push({
        filename: path.basename(csvFile),
        path: csvFile
      });
    }
    attachments.push({
      filename: path.basename(jsonFile),
      path: jsonFile
    });
    
    console.log('\n📤 準備發送郵件...');
    await sendEmail(subject, htmlContent, attachments);
    
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
    throw error;
  }
}

// 運行備份
backupAndEmail()
  .then(result => {
    console.log('\n✨ 備份流程完成');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 備份流程失敗');
    process.exit(1);
  });
