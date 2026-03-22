#!/usr/bin/env node
/**
 * CRM 顧問招生評價報告 - 每週一運行
 * 分析上週各顧問的招生表現
 * 
 * 使用方法:
 * node scripts/counsellor-report.js [chatId]
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// 加載環境變量
require('dotenv').config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ 錯誤: 缺少 Supabase 配置');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 獲取日期範圍（上週一到上週日）
function getLastWeekRange() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=週日, 1=週一, ...
  
  // 計算上週日（本週一的 7 天前）
  const lastSunday = new Date(now);
  lastSunday.setDate(now.getDate() - dayOfWeek);
  lastSunday.setHours(0, 0, 0, 0);
  
  // 計算上週一
  const lastMonday = new Date(lastSunday);
  lastMonday.setDate(lastSunday.getDate() - 6);
  
  return {
    start: lastMonday.toISOString(),
    end: lastSunday.toISOString(),
    startStr: lastMonday.toLocaleDateString('zh-CN'),
    endStr: lastSunday.toLocaleDateString('zh-CN')
  };
}

// 格式化貨幣
function formatCurrency(amount) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 0
  }).format(amount);
}

// 主報告函數
async function generateCounsellorReport() {
  const weekRange = getLastWeekRange();
  
  console.log('📊 生成顧問招生評價報告...');
  console.log(`📅 統計週期：${weekRange.startStr} 至 ${weekRange.endStr}`);
  
  try {
    // 獲取上週新增的學生記錄
    const { data: students, error } = await supabase
      .from('students')
      .select('*')
      .gte('created_at', weekRange.start)
      .lte('created_at', weekRange.end);
    
    if (error) throw error;
    
    const recordCount = students?.length || 0;
    
    if (recordCount === 0) {
      console.log('⚠️ 上週沒有新招生記錄');
      return {
        success: true,
        hasData: false,
        weekRange,
        message: `📊 上週招生評價報告\n\n📅 統計週期：${weekRange.startStr} 至 ${weekRange.endStr}\n\n⚠️ 上週沒有新的招生記錄`
      };
    }
    
    // 按顧問分組統計
    const counsellorStats = {};
    
    students.forEach(student => {
      const counsellor = student.counsellor || '未分配';
      
      if (!counsellorStats[counsellor]) {
        counsellorStats[counsellor] = {
          name: counsellor,
          count: 0,
          totalTuition: 0,
          totalBonus: 0,
          students: [],
          statuses: {}
        };
      }
      
      const stats = counsellorStats[counsellor];
      stats.count++;
      stats.totalTuition += student.tuition || 0;
      stats.totalBonus += student.bonus || 0;
      stats.students.push(student);
      
      // 統計狀態分佈
      const status = student.status || 'Unknown';
      stats.statuses[status] = (stats.statuses[status] || 0) + 1;
    });
    
    // 轉換為數組並排序（按招生數量）
    const sortedStats = Object.values(counsellorStats)
      .sort((a, b) => b.count - a.count);
    
    // 計算總計
    const totalStudents = sortedStats.reduce((sum, s) => sum + s.count, 0);
    const totalTuition = sortedStats.reduce((sum, s) => sum + s.totalTuition, 0);
    const totalBonus = sortedStats.reduce((sum, s) => sum + s.totalBonus, 0);
    
    // 生成報告文本
    let report = `📊 上週招生評價報告

📅 統計週期：${weekRange.startStr} 至 ${weekRange.endStr}
📈 總計招生：${totalStudents} 人
💰 總學費：${formatCurrency(totalTuition)}
🎁 總獎金：${formatCurrency(totalBonus)}

`;
    
    report += '═'.repeat(40) + '\n\n';
    
    // 各顧問詳情
    sortedStats.forEach((stats, index) => {
      const rank = index + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '  ';
      const percentage = ((stats.count / totalStudents) * 100).toFixed(1);
      
      report += `${medal} ${rank}. ${stats.name}\n`;
      report += `   ├─ 招生人數：${stats.count} 人 (${percentage}%)\n`;
      report += `   ├─ 學費總額：${formatCurrency(stats.totalTuition)}\n`;
      report += `   ├─ 預計獎金：${formatCurrency(stats.totalBonus)}\n`;
      
      // 狀態分佈
      const statusStr = Object.entries(stats.statuses)
        .map(([status, count]) => `${status}: ${count}`)
        .join(', ');
      report += `   └─ 狀態分佈：${statusStr}\n\n`;
    });
    
    report += '═'.repeat(40) + '\n';
    
    // 添加學生明細
    report += '\n📋 學生明細：\n\n';
    
    sortedStats.forEach(stats => {
      report += `【${stats.name}】${stats.count}人\n`;
      stats.students.forEach((s, i) => {
        report += `  ${i + 1}. ${s.student_name} | ${s.school || '-'} | ${s.course || '-'} | ${formatCurrency(s.tuition)}\n`;
      });
      report += '\n';
    });
    
    console.log('✅ 報告生成完成');
    console.log(`📊 統計顧問數：${sortedStats.length} 人`);
    console.log(`📈 總招生數：${totalStudents} 人`);
    
    return {
      success: true,
      hasData: true,
      weekRange,
      stats: sortedStats,
      totals: { totalStudents, totalTuition, totalBonus },
      message: report
    };
    
  } catch (error) {
    console.error('❌ 生成報告失敗:', error.message);
    throw error;
  }
}

// 運行報告
if (require.main === module) {
  generateCounsellorReport()
    .then(result => {
      console.log('\n' + '='.repeat(40));
      console.log('📋 報告內容：');
      console.log('='.repeat(40));
      console.log(result.message);
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 報告生成失敗');
      process.exit(1);
    });
}

module.exports = { generateCounsellorReport };
