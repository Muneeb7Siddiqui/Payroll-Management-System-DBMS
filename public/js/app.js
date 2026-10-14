/**
 * PayFlow.db - Payroll Management System Application Logic
 * Real-time integration with MySQL database (payrollmanagementdb)
 */

const API_BASE = '/api';

const app = {
  currentTab: 'dashboard',
  departments: [],
  jobs: [],
  employees: [],
  selectedEmployeeForRun: null,

  // -------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------
  async init() {
    this.setupClock();
    this.setupNavigation();
    this.setupModals();
    this.setupForms();
    this.setupFilters();

    // Initial data fetch
    await this.fetchMeta();
    await this.loadDashboard();
    this.setDefaultPayrollDates();
  },

  setupClock() {
    const clockEl = document.getElementById('liveClock');
    const update = () => {
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    update();
    setInterval(update, 1000);
  },

  setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        this.switchTab(tab);
      });
    });

    document.getElementById('btnQuickRunPayroll')?.addEventListener('click', () => {
      this.switchTab('run-payroll');
    });
  },

  switchTab(tabName) {
    this.currentTab = tabName;
    document.querySelectorAll('.nav-item').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tabName);
    });

    document.querySelectorAll('.tab-pane').forEach((p) => {
      p.classList.remove('active');
    });

    const targetPane = document.getElementById(`tab-${tabName}`);
    if (targetPane) targetPane.classList.add('active');

    // Update Titles
    const titles = {
      dashboard: { title: 'Payroll Overview', sub: 'Real-time compensation analytics and database records' },
      employees: { title: 'Employee Directory', sub: 'Manage workforce personnel, compensation, and departmental records' },
      payrolls: { title: 'Payroll Ledger', sub: 'Historical disbursements, statutory deductions, and printable payslips' },
      'run-payroll': { title: 'Execute Payroll Run', sub: 'Calculate statutory withholding and disburse compensation' },
      departments: { title: 'Departments & Job Positions', sub: 'Organizational hierarchy, departments, and base salary brackets' }
    };

    const current = titles[tabName] || titles.dashboard;
    document.getElementById('pageTitle').textContent = current.title;
    document.getElementById('pageSubtitle').textContent = current.sub;

    // Load data for specific tab
    if (tabName === 'dashboard') this.loadDashboard();
    if (tabName === 'employees') this.loadEmployees();
    if (tabName === 'payrolls') this.loadPayrolls();
    if (tabName === 'departments') this.loadDepartmentsAndJobs();
  },

  // -------------------------------------------------------------
  // Meta Data (Departments, Jobs)
  // -------------------------------------------------------------
  async fetchMeta() {
    try {
      const [deptRes, jobRes] = await Promise.all([
        fetch(`${API_BASE}/departments`),
        fetch(`${API_BASE}/jobs`)
      ]);
      this.departments = await deptRes.json();
      this.jobs = await jobRes.json();

      this.populateSelects();
    } catch (err) {
      this.showToast('Failed to fetch departments/jobs: ' + err.message, 'error');
    }
  },

  populateSelects() {
    // Dept filters & dropdowns
    const empDeptFilter = document.getElementById('employeeDeptFilter');
    const empDeptSelect = document.getElementById('empDeptSelect');

    const deptOptions = this.departments.map(d => `<option value="${d.department_id}">${d.department_name}</option>`).join('');
    if (empDeptFilter) empDeptFilter.innerHTML = `<option value="">All Departments</option>` + deptOptions;
    if (empDeptSelect) empDeptSelect.innerHTML = `<option value="">Select Department</option>` + deptOptions;

    // Job dropdowns
    const empJobSelect = document.getElementById('empJobSelect');
    if (empJobSelect) {
      empJobSelect.innerHTML = `<option value="">Select Job Position</option>` +
        this.jobs.map(j => `<option value="${j.job_id}">${j.job_title} ($${Number(j.base_salary).toLocaleString()}/mo)</option>`).join('');
    }
  },

  // -------------------------------------------------------------
  // TAB 1: Dashboard
  // -------------------------------------------------------------
  async loadDashboard() {
    try {
      const res = await fetch(`${API_BASE}/stats`);
      const data = await res.json();

      // Stat cards
      document.getElementById('statNetDisbursed').textContent = this.formatCurrency(data.payroll?.total_net_disbursed || 0);
      document.getElementById('statGrossDeduction').textContent = 
        `Gross: ${this.formatCurrency(data.payroll?.total_gross_disbursed || 0)} • Deductions: ${this.formatCurrency(data.payroll?.total_deductions_retained || 0)}`;

      document.getElementById('statActiveEmployees').textContent = data.employees?.active_employees || 0;
      document.getElementById('statTotalEmployees').textContent = `Total registered: ${data.employees?.total_employees || 0}`;

      document.getElementById('statAvgSalary').textContent = this.formatCurrency(data.payroll?.avg_net_payout || 0);
      document.getElementById('statDeptCount').textContent = `${data.departments_count || 0} Depts`;
      document.getElementById('statJobCount').textContent = `${data.jobs_count || 0} Job Roles`;

      // Recent payrolls table
      const tbody = document.getElementById('recentPayrollsTableBody');
      if (data.recent_payrolls && data.recent_payrolls.length > 0) {
        tbody.innerHTML = data.recent_payrolls.map(p => `
          <tr>
            <td><strong>${this.formatDate(p.payment_date)}</strong></td>
            <td>
              <div style="font-weight:600;">${p.employee_name}</div>
              <div style="font-size:0.75rem; color:var(--text-muted);">${p.job_title || ''}</div>
            </td>
            <td><span class="badge badge-dept">${p.department_name || 'General'}</span></td>
            <td>${this.formatCurrency(p.gross_salary)}</td>
            <td class="text-rose">${this.formatCurrency(p.total_deductions)}</td>
            <td class="text-emerald" style="font-weight:700;">${this.formatCurrency(p.net_salary)}</td>
            <td>
              <button class="btn btn-outline btn-sm" onclick="app.viewPayslip(${p.payroll_id})">
                <span>Payslip</span>
              </button>
            </td>
          </tr>
        `).join('');
      } else {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No payroll records processed yet.</td></tr>`;
      }

      // Dept list distribution
      const deptList = document.getElementById('deptBreakdownList');
      if (data.department_breakdown && data.department_breakdown.length > 0) {
        const maxBudget = Math.max(...data.department_breakdown.map(d => Number(d.total_salary_cost) || 1));
        deptList.innerHTML = data.department_breakdown.map(d => {
          const pct = Math.round(((Number(d.total_salary_cost) || 0) / maxBudget) * 100);
          return `
            <div class="dept-item">
              <div class="dept-item-header">
                <div>
                  <span class="dept-name">${d.department_name}</span>
                  <span style="font-size:0.75rem; color:var(--text-muted); margin-left:6px;">(${d.employee_count} staff)</span>
                </div>
                <div class="dept-budget">${this.formatCurrency(d.total_salary_cost)}</div>
              </div>
              <div class="progress-track">
                <div class="progress-bar" style="width: ${pct}%;"></div>
              </div>
            </div>
          `;
        }).join('');
      } else {
        deptList.innerHTML = `<div class="empty-cell">No departments found.</div>`;
      }

    } catch (err) {
      this.showToast('Error loading stats: ' + err.message, 'error');
    }
  },

  // -------------------------------------------------------------
  // TAB 2: Employees
  // -------------------------------------------------------------
  async loadEmployees() {
    try {
      const search = document.getElementById('employeeSearchInput')?.value || '';
      const dept = document.getElementById('employeeDeptFilter')?.value || '';
      const status = document.getElementById('employeeStatusFilter')?.value || '';

      const query = new URLSearchParams();
      if (search) query.append('search', search);
      if (dept) query.append('department_id', dept);
      if (status) query.append('status', status);

      const res = await fetch(`${API_BASE}/employees?${query.toString()}`);
      this.employees = await res.json();

      const tbody = document.getElementById('employeesTableBody');
      if (this.employees.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">No matching employees found.</td></tr>`;
        return;
      }

      tbody.innerHTML = this.employees.map(emp => {
        const statusBadge = emp.status === 'Active' 
          ? `<span class="badge badge-active">Active</span>`
          : emp.status === 'On Leave'
          ? `<span class="badge badge-leave">On Leave</span>`
          : `<span class="badge badge-term">Terminated</span>`;

        return `
          <tr>
            <td style="font-family:var(--font-mono); color:var(--text-dim);">#${emp.employee_id}</td>
            <td>
              <div style="font-weight:600;">${emp.full_name}</div>
              <div style="font-size:0.75rem; color:var(--text-muted);">${emp.email} • ${emp.phone_number || 'N/A'}</div>
            </td>
            <td><span class="badge badge-dept">${emp.department_name || 'N/A'}</span></td>
            <td>${emp.job_title || 'N/A'}</td>
            <td style="font-weight:600; font-family:var(--font-mono);">${this.formatCurrency(emp.effective_salary)}</td>
            <td>${this.formatDate(emp.hire_date)}</td>
            <td>${statusBadge}</td>
            <td>
              <div class="flex-center gap-2">
                <button class="btn btn-outline btn-sm" onclick="app.openEditEmployee(${emp.employee_id})">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="app.deleteEmployee(${emp.employee_id})">Delete</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      // Also populate Run Payroll employee select dropdown
      this.updateRunPayrollEmployeeSelect();
    } catch (err) {
      this.showToast('Error loading employees: ' + err.message, 'error');
    }
  },

  updateRunPayrollEmployeeSelect() {
    const sel = document.getElementById('runEmployeeSelect');
    if (!sel) return;
    const activeStaff = this.employees.filter(e => e.status === 'Active');
    let opts = `<option value="ALL">🌟 All Active Employees (${activeStaff.length} staff - Batch Processing)</option>`;
    activeStaff.forEach(e => {
      opts += `<option value="${e.employee_id}">${e.full_name} - ${e.job_title} (${this.formatCurrency(e.effective_salary)})</option>`;
    });
    sel.innerHTML = opts;
  },

  setupFilters() {
    const searchInput = document.getElementById('employeeSearchInput');
    const deptFilter = document.getElementById('employeeDeptFilter');
    const statusFilter = document.getElementById('employeeStatusFilter');

    let debounce;
    searchInput?.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => this.loadEmployees(), 300);
    });

    deptFilter?.addEventListener('change', () => this.loadEmployees());
    statusFilter?.addEventListener('change', () => this.loadEmployees());

    document.getElementById('payrollEmployeeFilter')?.addEventListener('change', () => this.loadPayrolls());
    document.getElementById('btnRefreshPayrolls')?.addEventListener('click', () => this.loadPayrolls());
  },

  // -------------------------------------------------------------
  // TAB 3: Payroll Ledger
  // -------------------------------------------------------------
  async loadPayrolls() {
    try {
      const empFilter = document.getElementById('payrollEmployeeFilter')?.value || '';
      const query = new URLSearchParams();
      if (empFilter) query.append('employee_id', empFilter);

      const res = await fetch(`${API_BASE}/payrolls?${query.toString()}`);
      const payrolls = await res.json();

      // Populate filter dropdown if empty
      const filterSelect = document.getElementById('payrollEmployeeFilter');
      if (filterSelect && filterSelect.options.length <= 1 && this.employees.length > 0) {
        filterSelect.innerHTML = `<option value="">All Employees</option>` +
          this.employees.map(e => `<option value="${e.employee_id}">${e.full_name}</option>`).join('');
      }

      const tbody = document.getElementById('payrollLedgerTableBody');
      if (payrolls.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" class="empty-cell">No payroll records found.</td></tr>`;
        return;
      }

      tbody.innerHTML = payrolls.map(p => `
        <tr>
          <td style="font-family:var(--font-mono); font-weight:700;">#PR-${String(p.payroll_id).padStart(4, '0')}</td>
          <td>
            <div style="font-weight:600;">${p.employee_name}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${p.job_title || ''} • ${p.department_name || ''}</div>
          </td>
          <td style="font-size:0.8rem;">${this.formatDate(p.pay_period_start)} to ${this.formatDate(p.pay_period_end)}</td>
          <td><strong>${this.formatDate(p.payment_date)}</strong></td>
          <td style="font-family:var(--font-mono);">${this.formatCurrency(p.gross_salary)}</td>
          <td class="text-rose">${this.formatCurrency(p.income_tax || 0)}</td>
          <td class="text-rose">${this.formatCurrency(p.provident_fund || 0)}</td>
          <td class="text-rose">${this.formatCurrency(p.health_insurance || 0)}</td>
          <td class="text-rose" style="font-weight:600;">${this.formatCurrency(p.total_deductions)}</td>
          <td class="text-emerald" style="font-weight:800; font-family:var(--font-mono);">${this.formatCurrency(p.net_salary)}</td>
          <td>
            <div class="flex-center gap-2">
              <button class="btn btn-primary btn-sm" onclick="app.viewPayslip(${p.payroll_id})">
                <span>Payslip</span>
              </button>
              <button class="btn btn-danger btn-sm" onclick="app.deletePayroll(${p.payroll_id})">Delete</button>
            </div>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      this.showToast('Error loading payroll ledger: ' + err.message, 'error');
    }
  },

  // -------------------------------------------------------------
  // TAB 4: Run / Process Payroll Logic
  // -------------------------------------------------------------
  setDefaultPayrollDates() {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth(); // 0-indexed

    // Default: current month 1st to last day
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const fmt = d => d.toISOString().split('T')[0];

    const startInput = document.getElementById('runPeriodStart');
    const endInput = document.getElementById('runPeriodEnd');
    const payDateInput = document.getElementById('runPayDate');

    if (startInput) startInput.value = fmt(firstDay);
    if (endInput) endInput.value = fmt(lastDay);
    if (payDateInput) payDateInput.value = fmt(today);
  },

  calculatePreview() {
    const targetEmpId = document.getElementById('runEmployeeSelect')?.value;
    const taxPct = Number(document.getElementById('rateTax')?.value || 10) / 100;
    const pfPct = Number(document.getElementById('ratePF')?.value || 4) / 100;
    const insPct = Number(document.getElementById('rateHealth')?.value || 2) / 100;

    let targetEmployees = [];
    if (targetEmpId === 'ALL') {
      targetEmployees = this.employees.filter(e => e.status === 'Active');
    } else {
      const single = this.employees.find(e => e.employee_id == targetEmpId);
      if (single) targetEmployees = [single];
    }

    const tbody = document.getElementById('previewPayrollTableBody');
    const totalsBar = document.getElementById('previewTotalsBar');

    if (targetEmployees.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">No active employees found to preview.</td></tr>`;
      totalsBar.style.display = 'none';
      return;
    }

    let totGross = 0;
    let totDeduct = 0;
    let totNet = 0;

    tbody.innerHTML = targetEmployees.map(e => {
      const gross = Number(e.effective_salary || 0);
      const tax = gross * taxPct;
      const pf = gross * pfPct;
      const ins = gross * insPct;
      const deductions = tax + pf + ins;
      const net = gross - deductions;

      totGross += gross;
      totDeduct += deductions;
      totNet += net;

      return `
        <tr>
          <td>
            <strong>${e.full_name}</strong>
            <div style="font-size:0.75rem; color:var(--text-muted);">${e.job_title}</div>
          </td>
          <td>${this.formatCurrency(gross)}</td>
          <td class="text-rose">${this.formatCurrency(deductions)}</td>
          <td class="text-emerald" style="font-weight:700;">${this.formatCurrency(net)}</td>
        </tr>
      `;
    }).join('');

    totalsBar.style.display = 'flex';
    document.getElementById('prevTotalGross').textContent = this.formatCurrency(totGross);
    document.getElementById('prevTotalDeductions').textContent = this.formatCurrency(totDeduct);
    document.getElementById('prevTotalNet').textContent = this.formatCurrency(totNet);
  },

  async handleRunPayrollSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('btnSubmitRunPayroll');
    btn.disabled = true;
    btn.textContent = 'Processing Transaction in MySQL...';

    const employee_id = document.getElementById('runEmployeeSelect').value;
    const pay_period_start = document.getElementById('runPeriodStart').value;
    const pay_period_end = document.getElementById('runPeriodEnd').value;
    const payment_date = document.getElementById('runPayDate').value;

    const custom_rates = {
      income_tax_pct: Number(document.getElementById('rateTax').value),
      pf_pct: Number(document.getElementById('ratePF').value),
      health_insurance_pct: Number(document.getElementById('rateHealth').value)
    };

    try {
      const res = await fetch(`${API_BASE}/payrolls/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id,
          pay_period_start,
          pay_period_end,
          payment_date,
          custom_rates
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process payroll');

      this.showToast(`🎉 Successfully committed ${data.count} payroll record(s) to MySQL!`, 'success');
      this.switchTab('payrolls');
    } catch (err) {
      this.showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg><span>Commit Payroll to Database</span>`;
    }
  },

  async deletePayroll(id) {
    if (!confirm(`Are you sure you want to delete payroll record #PR-${String(id).padStart(4, '0')}? This will remove the record and statutory deductions.`)) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/payrolls/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete payroll record');

      this.showToast('Payroll record deleted successfully', 'success');
      this.loadPayrolls();
      this.loadDashboard();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  // -------------------------------------------------------------
  // TAB 5: Departments & Jobs
  // -------------------------------------------------------------
  async loadDepartmentsAndJobs() {
    await this.fetchMeta();

    // Departments Table
    const deptTbody = document.getElementById('departmentsTableBody');
    deptTbody.innerHTML = this.departments.map(d => `
      <tr>
        <td style="font-family:var(--font-mono); color:var(--text-dim);">#${d.department_id}</td>
        <td><strong>${d.department_name}</strong></td>
        <td>${d.total_employees} staff</td>
        <td><span class="badge badge-active">${d.active_employees} active</span></td>
        <td style="font-weight:600; font-family:var(--font-mono); color:var(--emerald);">${this.formatCurrency(d.monthly_salary_budget)}</td>
      </tr>
    `).join('');

    // Jobs Table
    const jobTbody = document.getElementById('jobsTableBody');
    jobTbody.innerHTML = this.jobs.map(j => `
      <tr>
        <td style="font-family:var(--font-mono); color:var(--text-dim);">#${j.job_id}</td>
        <td><strong>${j.job_title}</strong></td>
        <td style="font-weight:600; font-family:var(--font-mono);">${this.formatCurrency(j.base_salary)}</td>
        <td>${j.total_employees} employees</td>
      </tr>
    `).join('');
  },

  // -------------------------------------------------------------
  // Official Payslip Modal
  // -------------------------------------------------------------
  async viewPayslip(payrollId) {
    try {
      const res = await fetch(`${API_BASE}/payrolls/${payrollId}`);
      const p = await res.json();
      if (!res.ok) throw new Error(p.error || 'Failed to fetch payslip details');

      document.getElementById('slipIdDisplay').textContent = `VOUCHER #PR-${String(p.payroll_id).padStart(4, '0')}`;
      document.getElementById('slipDateDisplay').textContent = `Disbursed: ${this.formatDate(p.payment_date)}`;

      document.getElementById('slipEmpName').textContent = p.employee_name;
      document.getElementById('slipEmpId').textContent = `EMP-${String(p.employee_id).padStart(4, '0')}`;
      document.getElementById('slipEmpDept').textContent = p.department_name || 'General';
      document.getElementById('slipEmpJob').textContent = p.job_title || 'Staff';
      document.getElementById('slipEmpEmail').textContent = p.email || '-';
      document.getElementById('slipPayPeriod').textContent = `${this.formatDate(p.pay_period_start)} - ${this.formatDate(p.pay_period_end)}`;

      document.getElementById('slipGrossSalary').textContent = this.formatCurrency(p.gross_salary);
      document.getElementById('slipTotalGross').textContent = this.formatCurrency(p.gross_salary);

      document.getElementById('slipTax').textContent = this.formatCurrency(p.income_tax);
      document.getElementById('slipPF').textContent = this.formatCurrency(p.provident_fund);
      document.getElementById('slipHealth').textContent = this.formatCurrency(p.health_insurance);
      document.getElementById('slipOther').textContent = this.formatCurrency(p.other_statutory);
      document.getElementById('slipTotalDeductions').textContent = this.formatCurrency(p.total_deductions);

      document.getElementById('slipNetSalary').textContent = this.formatCurrency(p.net_salary);

      this.openModal('payslipModal');
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  // -------------------------------------------------------------
  // Modals & Forms
  // -------------------------------------------------------------
  setupModals() {
    // Open Add Employee
    document.getElementById('btnOpenAddEmployee')?.addEventListener('click', () => {
      document.getElementById('employeeModalTitle').textContent = 'Add New Employee';
      document.getElementById('empEditId').value = '';
      document.getElementById('employeeForm').reset();
      document.getElementById('empHireDate').value = new Date().toISOString().split('T')[0];
      this.openModal('employeeModal');
    });

    // Close Modals
    const closeBtns = [
      { id: 'btnCloseEmployeeModal', modal: 'employeeModal' },
      { id: 'btnCancelEmployeeModal', modal: 'employeeModal' },
      { id: 'btnCloseDeptModal', modal: 'departmentModal' },
      { id: 'btnCancelDeptModal', modal: 'departmentModal' },
      { id: 'btnCloseJobModal', modal: 'jobModal' },
      { id: 'btnCancelJobModal', modal: 'jobModal' },
      { id: 'btnClosePayslipModal', modal: 'payslipModal' },
    ];

    closeBtns.forEach(b => {
      document.getElementById(b.id)?.addEventListener('click', () => this.closeModal(b.modal));
    });

    // Open Dept & Job Modals
    document.getElementById('btnOpenAddDept')?.addEventListener('click', () => {
      document.getElementById('departmentForm').reset();
      this.openModal('departmentModal');
    });

    document.getElementById('btnOpenAddJob')?.addEventListener('click', () => {
      document.getElementById('jobForm').reset();
      this.openModal('jobModal');
    });

    // Print Payslip Button
    document.getElementById('btnPrintPayslip')?.addEventListener('click', () => {
      window.print();
    });

    // Close modals on backdrop click
    document.querySelectorAll('.modal-backdrop').forEach(mb => {
      mb.addEventListener('click', (e) => {
        if (e.target === mb) mb.classList.remove('active');
      });
    });
  },

  setupForms() {
    // Employee Form Submit
    document.getElementById('employeeForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('empEditId').value;
      const payload = {
        first_name: document.getElementById('empFirstName').value.trim(),
        last_name: document.getElementById('empLastName').value.trim(),
        email: document.getElementById('empEmail').value.trim(),
        phone_number: document.getElementById('empPhone').value.trim(),
        department_id: document.getElementById('empDeptSelect').value,
        job_id: document.getElementById('empJobSelect').value,
        primary_salary: document.getElementById('empPrimarySalary').value || null,
        hire_date: document.getElementById('empHireDate').value,
        status: document.getElementById('empStatus').value
      };

      try {
        const url = editId ? `${API_BASE}/employees/${editId}` : `${API_BASE}/employees`;
        const method = editId ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error saving employee');

        this.showToast(`Employee ${payload.first_name} ${payload.last_name} saved successfully!`, 'success');
        this.closeModal('employeeModal');
        await this.loadEmployees();
        this.loadDashboard();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // Dept Form Submit
    document.getElementById('departmentForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('newDeptName').value.trim();
      try {
        const res = await fetch(`${API_BASE}/departments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ department_name: name })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create department');

        this.showToast(`Department "${name}" created!`, 'success');
        this.closeModal('departmentModal');
        this.loadDepartmentsAndJobs();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // Job Form Submit
    document.getElementById('jobForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('newJobTitle').value.trim();
      const baseSalary = document.getElementById('newJobBaseSalary').value;
      try {
        const res = await fetch(`${API_BASE}/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_title: title, base_salary: baseSalary })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create job');

        this.showToast(`Job role "${title}" created!`, 'success');
        this.closeModal('jobModal');
        this.loadDepartmentsAndJobs();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // Payroll Run Form & Preview
    document.getElementById('btnCalcPreview')?.addEventListener('click', () => {
      this.calculatePreview();
    });

    document.getElementById('payrollRunForm')?.addEventListener('submit', (e) => {
      this.handleRunPayrollSubmit(e);
    });
  },

  openEditEmployee(id) {
    const emp = this.employees.find(e => e.employee_id === id);
    if (!emp) return;

    document.getElementById('employeeModalTitle').textContent = `Edit Employee #${emp.employee_id}`;
    document.getElementById('empEditId').value = emp.employee_id;
    document.getElementById('empFirstName').value = emp.first_name;
    document.getElementById('empLastName').value = emp.last_name;
    document.getElementById('empEmail').value = emp.email;
    document.getElementById('empPhone').value = emp.phone_number || '';
    document.getElementById('empDeptSelect').value = emp.department_id || '';
    document.getElementById('empJobSelect').value = emp.job_id || '';
    document.getElementById('empPrimarySalary').value = emp.primary_salary || '';
    document.getElementById('empHireDate').value = emp.hire_date ? emp.hire_date.split('T')[0] : '';
    document.getElementById('empStatus').value = emp.status || 'Active';

    this.openModal('employeeModal');
  },

  async deleteEmployee(id) {
    if (!confirm('Are you sure you want to delete this employee?')) return;
    try {
      const res = await fetch(`${API_BASE}/employees/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete employee');

      this.showToast('Employee deleted successfully', 'success');
      this.loadEmployees();
      this.loadDashboard();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.add('active');
  },

  closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.remove('active');
  },

  // -------------------------------------------------------------
  // Helpers & Toast Notifications
  // -------------------------------------------------------------
  formatCurrency(val) {
    const num = Number(val) || 0;
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return isNaN(d) ? dateStr : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
      <span>${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
};

// Start application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
