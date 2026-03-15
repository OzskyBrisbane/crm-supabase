'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const STATUSES = ["Lead", "Consultation", "Applied", "Offer", "Deposit Paid", "Enrolled", "Lost"]
const SOURCES = ["Referral", "Xiaohongshu", "Wechat", "Walk-in", "Website", "Friend", "Other"]

export default function Home() {
  const [students, setStudents] = useState([])
  const [settings, setSettings] = useState({ defaultBonus: 500, bonusOptions: [250, 500] })
  const [counsellors] = useState(["David", "Ming", "Jett"])
  const [role, setRole] = useState("manager")
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("students")
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [filters, setFilters] = useState({ search: "", status: "All", source: "All", year: "All" })
  
  const [formData, setFormData] = useState({
    id: "", studentName: "", counsellor: "", school: "", course: "",
    source: "Referral", status: "Lead", intakeDate: "", tuition: "",
    bonus: 500, notes: ""
  })

  // 实时订阅
  useEffect(() => {
    loadData()
    
    // Supabase 实时订阅
    const subscription = supabase
      .channel('students')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => {
        loadData()
      })
      .subscribe()
    
    return () => subscription.unsubscribe()
  }, [])

  async function loadData() {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (!error) setStudents(data || [])
    setLoading(false)
  }

  async function saveStudent(student) {
    const old = editingId ? students.find(s => s.id === editingId) : null
    const payload = {
      id: student.id,
      student_name: student.studentName,
      counsellor: role === "manager" ? student.counsellor : role,
      school: student.school,
      course: student.course,
      source: student.source,
      status: student.status,
      intake_date: student.intakeDate || null,
      tuition: Number(student.tuition || 0),
      bonus: Number(student.bonus || settings.defaultBonus),
      bonus_status: old?.bonusStatus || "Unpaid",
      paid_at: old?.paidAt || null,
      notes: student.notes
    }
    
    const { error } = await supabase
      .from('students')
      .upsert(payload, { onConflict: 'id' })
    
    if (!error) {
      await loadData()
      setModalOpen(false)
    }
  }

  async function deleteStudent(id) {
    if (!confirm('确定删除？')) return
    await supabase.from('students').delete().eq('id', id)
    await loadData()
  }

  async function markReady(id) {
    const s = students.find(x => x.id === id)
    const newStatus = s.bonus_status === "Ready for Bonus" ? "Unpaid" : "Ready for Bonus"
    await supabase.from('students').update({ 
      bonus_status: newStatus, 
      paid_at: null 
    }).eq('id', id)
    await loadData()
  }

  async function markPaid(id) {
    const s = students.find(x => x.id === id)
    const newStatus = s.bonus_status === "Paid" ? "Unpaid" : "Paid"
    await supabase.from('students').update({ 
      bonus_status: newStatus, 
      paid_at: newStatus === "Paid" ? new Date().toISOString() : null 
    }).eq('id', id)
    await loadData()
  }

  function generateStudentID() {
    const year = new Date().getFullYear()
    const regex = new RegExp(`^STU-${year}-(\\d{4})$`)
    let maxNum = 0
    students.forEach(s => {
      const m = String(s.id || "").match(regex)
      if (m) maxNum = Math.max(maxNum, Number(m[1]))
    })
    return `STU-${year}-${String(maxNum + 1).padStart(4, "0")}`
  }

  function getRecordYear(s) {
    if (s.id && /^STU-\d{4}-\d{4}$/.test(s.id)) return s.id.slice(4, 8)
    if (s.intake_date) return String(new Date(s.intake_date).getFullYear())
    return "Unknown"
  }

  function openModal(editId = null) {
    setEditingId(editId)
    if (editId) {
      const s = students.find(x => x.id === editId)
      setFormData({
        id: s.id,
        studentName: s.student_name,
        counsellor: s.counsellor,
        school: s.school,
        course: s.course,
        source: s.source,
        status: s.status,
        intakeDate: s.intake_date || "",
        tuition: s.tuition,
        bonus: s.bonus,
        notes: s.notes || ""
      })
    } else {
      setFormData({
        id: generateStudentID(),
        studentName: "",
        counsellor: role === "manager" ? counsellors[0] : role,
        school: "",
        course: "",
        source: "Referral",
        status: "Lead",
        intakeDate: "",
        tuition: "",
        bonus: settings.defaultBonus,
        notes: ""
      })
    }
    setModalOpen(true)
  }

  async function handleSave() {
    await saveStudent(formData)
  }

  function currency(n) {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(Number(n || 0))
  }

  function fmtDateTime(v) {
    if (!v) return "-"
    const d = new Date(v)
    if (isNaN(d.getTime())) return "-"
    return new Intl.DateTimeFormat("en-AU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d)
  }

  const visibleStudents = students.filter(s => {
    if (role !== "manager" && s.counsellor !== role) return false
    if (filters.search && !(
      (s.student_name || "").toLowerCase().includes(filters.search.toLowerCase()) ||
      (s.school || "").toLowerCase().includes(filters.search.toLowerCase()) ||
      (s.course || "").toLowerCase().includes(filters.search.toLowerCase()) ||
      (s.id || "").toLowerCase().includes(filters.search.toLowerCase())
    )) return false
    if (filters.status !== "All" && s.status !== filters.status) return false
    if (filters.source !== "All" && s.source !== filters.source) return false
    if (filters.year !== "All" && getRecordYear(s) !== filters.year) return false
    return true
  })

  const enrolled = visibleStudents.filter(s => s.status === "Enrolled")
  const pipeline = visibleStudents.filter(s => !["Enrolled", "Lost"].includes(s.status))
  const totalBonus = enrolled.reduce((a, s) => a + (s.bonus || settings.defaultBonus), 0)
  const paidBonus = enrolled.filter(s => s.bonus_status === "Paid").reduce((a, s) => a + (s.bonus || settings.defaultBonus), 0)
  const years = [...new Set(students.map(getRecordYear))].sort((a, b) => String(b).localeCompare(String(a)))

  if (loading) return <div className="page"><p>加载中...</p></div>

  return (
    <div className="page">
      {/* Header */}
      <div className="header card">
        <div>
          <h1>留学招生 CRM</h1>
          <p>Supabase 实时同步版</p>
        </div>
        <div className="header-actions">
          <div className="field small">
            <label>当前身份</label>
            <select value={role} onChange={e => setRole(e.target.value)}>
              <option value="manager">Manager</option>
              {counsellors.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button className="btn" onClick={() => openModal()}>新增学生</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpis">
        <div className="card kpi">
          <div className="kpi-title">学生总数</div>
          <div className="kpi-value">{visibleStudents.length}</div>
          <div className="kpi-sub">{role === "manager" ? "全公司数据" : `${role} 的学生`}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-title">已入学</div>
          <div className="kpi-value">{enrolled.length}</div>
          <div className="kpi-sub">转化率 {visibleStudents.length ? Math.round(enrolled.length / visibleStudents.length * 100) : 0}%</div>
        </div>
        <div className="card kpi">
          <div className="kpi-title">跟进中</div>
          <div className="kpi-value">{pipeline.length}</div>
          <div className="kpi-sub">未完成的 pipeline</div>
        </div>
        <div className="card kpi">
          <div className="kpi-title">总 Bonus</div>
          <div className="kpi-value">{currency(totalBonus)}</div>
          <div className="kpi-sub">已支付 {currency(paidBonus)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${activeTab === "students" ? "active" : ""}`} onClick={() => setActiveTab("students")}>Students</button>
        <button className={`tab ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => setActiveTab("dashboard")}>Dashboard</button>
        <button className={`tab ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}>Settings</button>
      </div>

      {/* Students Tab */}
      {activeTab === "students" && (
        <div className="card">
          <div className="section-head">
            <h2>学生管理</h2>
            <div className="filters filters-4">
              <input placeholder="搜索学生 / 学校 / 课程 / ID" 
                value={filters.search} 
                onChange={e => setFilters({...filters, search: e.target.value})} />
              <select value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})}>
                <option value="All">All Status</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={filters.source} onChange={e => setFilters({...filters, source: e.target.value})}>
                <option value="All">All Sources</option>
                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={filters.year} onChange={e => setFilters({...filters, year: e.target.value})}>
                <option value="All">All Years</option>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Student</th>
                  <th>Counsellor</th>
                  <th>School / Course</th>
                  <th>Status</th>
                  <th>Intake</th>
                  <th>Bonus</th>
                  <th>Bonus Status</th>
                  <th>Paid Time</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleStudents.map(s => (
                  <tr key={s.id}>
                    <td>{s.id}</td>
                    <td>
                      <div><strong>{s.student_name}</strong></div>
                      <div style={{color:"#64748b",fontSize:12}}>{s.source}</div>
                    </td>
                    <td>{s.counsellor}</td>
                    <td>
                      <div>{s.school}</div>
                      <div style={{color:"#64748b",fontSize:12}}>{s.course}</div>
                    </td>
                    <td><span className={`badge ${s.status === "Enrolled" ? "ready" : ""}`}>{s.status}</span></td>
                    <td>{s.intake_date || "-"}</td>
                    <td>{currency(s.bonus)}</td>
                    <td><span className={`badge ${s.bonus_status === "Paid" ? "paid" : s.bonus_status === "Ready for Bonus" ? "ready" : ""}`}>{s.bonus_status}</span></td>
                    <td>{fmtDateTime(s.paid_at)}</td>
                    <td>
                      <div className="action-group">
                        {s.status === "Enrolled" && role !== "manager" && s.counsellor === role && s.bonus_status !== "Paid" && (
                          <button className="small-btn primary" onClick={() => markReady(s.id)}>
                            {s.bonus_status === "Ready for Bonus" ? "Undo Ready" : "Mark Ready"}
                          </button>
                        )}
                        {s.status === "Enrolled" && role === "manager" && (
                          <button className="small-btn primary" onClick={() => markPaid(s.id)}>
                            {s.bonus_status === "Paid" ? "Undo Paid" : "Mark Paid"}
                          </button>
                        )}
                        <button className="small-btn" onClick={() => openModal(s.id)}>Edit</button>
                        <button className="small-btn danger" onClick={() => deleteStudent(s.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Dashboard Tab */}
      {activeTab === "dashboard" && (
        <div className="dashboard-grid">
          <div className="card">
            <h2>Pipeline overview</h2>
            {STATUSES.map(st => {
              const count = students.filter(s => s.status === st && (role === "manager" || s.counsellor === role)).length
              const total = students.filter(s => role === "manager" || s.counsellor === role).length || 1
              const pct = Math.round(count / total * 100)
              return (
                <div className="pipeline-row" key={st}>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <span>{st}</span>
                    <span style={{color:"#64748b"}}>{count} students</span>
                  </div>
                  <div className="progress"><div style={{width:`${pct}%`}}></div></div>
                </div>
              )
            })}
          </div>
          <div className="card">
            <h2>顾问排行榜</h2>
            {counsellors.map((c, i) => {
              const mine = students.filter(s => s.counsellor === c)
              const enrolled = mine.filter(s => s.status === "Enrolled")
              const bonus = enrolled.reduce((a, s) => a + (s.bonus || settings.defaultBonus), 0)
              return (
                <div className="rank-card" key={c}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:12}}>
                    <div>
                      <div style={{fontSize:12,color:"#64748b"}}>#{i+1}</div>
                      <div style={{fontWeight:700}}>{c}</div>
                      <div style={{fontSize:12,color:"#64748b"}}>{enrolled.length} enrolled / {mine.length} students</div>
                    </div>
                    <div style={{fontWeight:700}}>{currency(bonus)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === "settings" && (
        <div className="settings-grid">
          <div className="card">
            <h2>系统信息</h2>
            <div className="info-box">
              <p><strong>数据存储：</strong>Supabase PostgreSQL</p>
              <p><strong>实时同步：</strong>✅ 已启用</p>
              <p><strong>当前用户：</strong>{role}</p>
              <p><strong>学生总数：</strong>{students.length}</p>
              <p><strong>Bonus 状态流程：</strong>Unpaid → Ready for Bonus → Paid</p>
              <p><strong>学生ID格式：</strong>STU-YYYY-XXXX</p>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="modal" onClick={e => e.target === e.currentTarget && setModalOpen(false)}>
          <div className="modal-card">
            <div className="modal-head">
              <h3>{editingId ? "Edit student" : "Add new student"}</h3>
              <button className="icon-btn" onClick={() => setModalOpen(false)}>✕</button>
            </div>
            <div className="form-grid">
              <div className="field"><label>Student ID</label><input value={formData.id} disabled /></div>
              <div className="field"><label>Student name</label><input value={formData.studentName} onChange={e => setFormData({...formData, studentName: e.target.value})} /></div>
              <div className="field">
                <label>Counsellor</label>
                <select value={formData.counsellor} onChange={e => setFormData({...formData, counsellor: e.target.value})} disabled={role !== "manager"}>
                  {counsellors.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="field"><label>School</label><input value={formData.school} onChange={e => setFormData({...formData, school: e.target.value})} /></div>
              <div className="field"><label>Course</label><input value={formData.course} onChange={e => setFormData({...formData, course: e.target.value})} /></div>
              <div className="field">
                <label>Lead source</label>
                <select value={formData.source} onChange={e => setFormData({...formData, source: e.target.value})}>
                  {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Status</label>
                <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="field"><label>Intake date</label><input type="date" value={formData.intakeDate} onChange={e => setFormData({...formData, intakeDate: e.target.value})} /></div>
              <div className="field"><label>Tuition (AUD)</label><input type="number" value={formData.tuition} onChange={e => setFormData({...formData, tuition: e.target.value})} /></div>
              <div className="field">
                <label>Bonus</label>
                <select value={formData.bonus} onChange={e => setFormData({...formData, bonus: Number(e.target.value)})}>
                  {settings.bonusOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="field"><label>Bonus preview</label><div className="preview">{currency(formData.bonus)}</div></div>
              <div className="field full"><label>Notes</label><textarea rows={4} value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} /></div>
            </div>
            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setModalOpen(false)}>Cancel</button>
              <button className="btn" onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
