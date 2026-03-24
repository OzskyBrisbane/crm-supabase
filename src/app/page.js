'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const STATUSES = ["Lead", "Consultation", "Applied", "Offer", "Deposit Paid", "Enrolled", "Lost"]
const SOURCES = ["Referral", "Xiaohongshu", "Wechat", "Walk-in", "Website", "Friend", "Other"]
const COUNSELLORS = ["David", "Ming", "Jett"]

// 简单的密码验证
function verifyLogin(name, password) {
  if (name === "Manager" && password === "admin123") {
    return { role: "manager", counsellor: null }
  }
  if (COUNSELLORS.includes(name) && password === "123456") {
    return { role: "counsellor", counsellor: name }
  }
  return null
}

export default function Home() {
  // 登录状态
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [loginForm, setLoginForm] = useState({ name: "", password: "" })
  const [loginError, setLoginError] = useState("")
  
  // 用户信息
  const [user, setUser] = useState({ role: "", counsellor: "" })
  
  // CRM 数据
  const [students, setStudents] = useState([])
  const [settings] = useState({ defaultBonus: 500, bonusOptions: [250, 500] })
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

  // 检查本地存储的登录状态
  useEffect(() => {
    const savedUser = localStorage.getItem("crm_user")
    if (savedUser) {
      const parsed = JSON.parse(savedUser)
      setUser(parsed)
      setIsLoggedIn(true)
    }
  }, [])

  // 登录处理
  function handleLogin(e) {
    e.preventDefault()
    const result = verifyLogin(loginForm.name, loginForm.password)
    if (result) {
      setUser(result)
      setIsLoggedIn(true)
      localStorage.setItem("crm_user", JSON.stringify(result))
      setLoginError("")
    } else {
      setLoginError("用户名或密码错误")
    }
  }

  // 登出
  function handleLogout() {
    setIsLoggedIn(false)
    setUser({ role: "", counsellor: "" })
    localStorage.removeItem("crm_user")
  }

  // 加载数据
  useEffect(() => {
    if (isLoggedIn) {
      loadData()
    }
  }, [isLoggedIn])

  async function loadData() {
    setLoading(true)
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (!error) {
      // 根据权限过滤数据
      let filtered = data || []
      if (user.role === "counsellor") {
        filtered = filtered.filter(s => s.counsellor === user.counsellor)
      }
      setStudents(filtered)
    }
    setLoading(false)
  }

  async function saveStudent(student) {
    const old = editingId ? students.find(s => s.id === editingId) : null
    
    // 顾问只能保存自己的学生
    const saveCounsellor = user.role === "manager" 
      ? student.counsellor 
      : user.counsellor
    
    const payload = {
      id: student.id,
      student_name: student.studentName,
      counsellor: saveCounsellor,
      school: student.school,
      course: student.course,
      source: student.source,
      status: student.status,
      intake_date: student.intakeDate || null,
      tuition: Number(student.tuition || 0),
      bonus: Number(student.bonus || settings.defaultBonus),
      bonus_status: old?.bonus_status || "Unpaid",
      paid_at: old?.paid_at || null,
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
    // 顾问只能操作自己的学生
    if (user.role === "counsellor" && s.counsellor !== user.counsellor) return
    
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

  async function generateStudentID() {
    const year = new Date().getFullYear()
    // 從數據庫獲取所有學生ID（不只是當前用戶可見的）
    const { data: allStudents, error } = await supabase
      .from('students')
      .select('id')
      .ilike('id', `STU-${year}-%`)
    
    if (error) {
      console.error('獲取學生ID失敗:', error)
    }
    
    const regex = new RegExp(`^STU-${year}-(\\d{4})$`)
    let maxNum = 0
    const studentList = allStudents || students
    studentList.forEach(s => {
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

  async function openModal(editId = null) {
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
      const newId = await generateStudentID()
      setFormData({
        id: newId,
        studentName: "",
        counsellor: user.role === "manager" ? COUNSELLORS[0] : user.counsellor,
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

  // 过滤数据
  const visibleStudents = students.filter(s => {
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

  // ==================== 登录页面 ====================
  if (!isLoggedIn) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="card" style={{ maxWidth: '400px', width: '100%', padding: '32px' }}>
          <h1 style={{ textAlign: 'center', marginBottom: '8px' }}>留学招生 CRM</h1>
          <p style={{ textAlign: 'center', color: '#64748b', marginBottom: '24px' }}>请登录</p>
          
          <form onSubmit={handleLogin}>
            <div className="field" style={{ marginBottom: '16px' }}>
              <label>用户名</label>
              <select 
                value={loginForm.name} 
                onChange={e => setLoginForm({...loginForm, name: e.target.value})}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}
                required
              >
                <option value="">请选择</option>
                <option value="Manager">Manager</option>
                {COUNSELLORS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            
            <div className="field" style={{ marginBottom: '24px' }}>
              <label>密码</label>
              <input 
                type="password" 
                placeholder="输入密码"
                value={loginForm.password}
                onChange={e => setLoginForm({...loginForm, password: e.target.value})}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}
                required
              />
            </div>
            
            {loginError && (
              <div style={{ color: '#dc2626', marginBottom: '16px', textAlign: 'center' }}>
                {loginError}
              </div>
            )}
            
            <button type="submit" className="btn" style={{ width: '100%' }}>
              登录
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ==================== CRM 主页面 ====================
  if (loading) return <div className="page"><p>加载中...</p></div>

  return (
    <div className="page">
      {/* Header */}
      <div className="header card">
        <div>
          <h1>留学招生 CRM</h1>
          <p>{user.role === "manager" ? "管理员视图 - 查看全部数据" : `顾问视图 - ${user.counsellor}`}</p>
        </div>
        <div className="header-actions">
          <div style={{ textAlign: 'right', marginRight: '16px' }}>
            <div style={{ fontWeight: 600 }}>{user.role === "manager" ? "Manager" : user.counsellor}</div>
            <button onClick={handleLogout} style={{ fontSize: '12px', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>
              退出登录
            </button>
          </div>
          <button className="btn" onClick={() => openModal()}>新增学生</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpis">
        <div className="card kpi">
          <div className="kpi-title">学生总数</div>
          <div className="kpi-value">{visibleStudents.length}</div>
          <div className="kpi-sub">{user.role === "manager" ? "全公司数据" : "我的学生"}</div>
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
        {user.role === "manager" && (
          <button className={`tab ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => setActiveTab("dashboard")}>Dashboard</button>
        )}
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
                  {user.role === "manager" && <th>Counsellor</th>}
                  <th>School / Course</th>
                  <th>Status</th>
                  <th>Intake</th>
                  <th>Bonus</th>
                  <th>Bonus Status</th>
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
                    {user.role === "manager" && <td>{s.counsellor}</td>}
                    <td>
                      <div>{s.school}</div>
                      <div style={{color:"#64748b",fontSize:12}}>{s.course}</div>
                    </td>
                    <td><span className={`badge ${s.status === "Enrolled" ? "ready" : ""}`}>{s.status}</span></td>
                    <td>{s.intake_date || "-"}</td>
                    <td>{currency(s.bonus)}</td>
                    <td><span className={`badge ${s.bonus_status === "Paid" ? "paid" : s.bonus_status === "Ready for Bonus" ? "ready" : ""}`}>{s.bonus_status}</span></td>
                    <td>
                      <div className="action-group">
                        {s.status === "Enrolled" && user.role === "counsellor" && s.bonus_status !== "Paid" && (
                          <button className="small-btn primary" onClick={() => markReady(s.id)}>
                            {s.bonus_status === "Ready for Bonus" ? "Undo Ready" : "Mark Ready"}
                          </button>
                        )}
                        {s.status === "Enrolled" && user.role === "manager" && (
                          <button className="small-btn primary" onClick={() => markPaid(s.id)}>
                            {s.bonus_status === "Paid" ? "Undo Paid" : "Mark Paid"}
                          </button>
                        )}
                        <button className="small-btn" onClick={() => openModal(s.id)}>Edit</button>
                        {user.role === "manager" && (
                          <button className="small-btn danger" onClick={() => deleteStudent(s.id)}>Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Dashboard Tab (仅 Manager) */}
      {activeTab === "dashboard" && user.role === "manager" && (
        <div className="dashboard-grid">
          <div className="card">
            <h2>Pipeline overview</h2>
            {STATUSES.map(st => {
              const count = students.filter(s => s.status === st).length
              const total = students.length || 1
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
            {COUNSELLORS.map((c, i) => {
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
            <h2>我的信息</h2>
            <div className="info-box">
              <p><strong>角色：</strong>{user.role === "manager" ? "管理员" : "顾问"}</p>
              {user.role === "counsellor" && <p><strong>顾问名字：</strong>{user.counsellor}</p>}
              <p><strong>学生总数：</strong>{students.length}</p>
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
              {user.role === "manager" && (
                <div className="field">
                  <label>Counsellor</label>
                  <select value={formData.counsellor} onChange={e => setFormData({...formData, counsellor: e.target.value})}>
                    {COUNSELLORS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}
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
