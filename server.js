require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// Helper functions
// -------------------------------------------------------------
const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

// -------------------------------------------------------------
// API Routes
// -------------------------------------------------------------

// Health & System Info
app.get('/api/health', async (req, res) => {
  try {
    const [result] = await pool.query('SELECT 1 AS ok, DATABASE() AS database_name, VERSION() AS version');
    res.json({
      status: 'online',
      database: result[0].database_name,
      mysql_version: result[0].version,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Overview Dashboard Stats
app.get('/api/stats', async (req, res) => {
  try {
    // 1. Employee metrics
    const [[empStats]] = await pool.query(`
      SELECT 
        COUNT(*) AS total_employees,
        SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) AS active_employees,
        SUM(CASE WHEN status = 'On Leave' THEN 1 ELSE 0 END) AS on_leave_employees,
        SUM(CASE WHEN status = 'Terminated' THEN 1 ELSE 0 END) AS terminated_employees
      FROM employees
    `);

    // 2. Department & Job counts
    const [[{ dept_count }]] = await pool.query('SELECT COUNT(*) AS dept_count FROM departments');
    const [[{ job_count }]] = await pool.query('SELECT COUNT(*) AS job_count FROM jobs');

    // 3. Payroll totals
    const [[payrollStats]] = await pool.query(`
      SELECT 
        COUNT(*) AS total_payroll_runs,
        COALESCE(SUM(gross_salary), 0) AS total_gross_disbursed,
        COALESCE(SUM(total_deductions), 0) AS total_deductions_retained,
        COALESCE(SUM(net_salary), 0) AS total_net_disbursed,
        COALESCE(AVG(net_salary), 0) AS avg_net_payout
      FROM payroll_records
    `);

    // 4. Latest month payroll
    const [[latestMonthStats]] = await pool.query(`
      SELECT 
        COALESCE(SUM(net_salary), 0) AS latest_month_disbursed,
        COUNT(*) AS latest_month_records
      FROM payroll_records
      WHERE pay_period_end >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
    `);

    // 5. Recent payroll records (5 items)
    const [recentPayrolls] = await pool.query(`
      SELECT 
        p.payroll_id,
        p.payment_date,
        p.pay_period_start,
        p.pay_period_end,
        p.gross_salary,
        p.total_deductions,
        p.net_salary,
        e.employee_id,
        CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
        d.department_name,
        j.job_title
      FROM payroll_records p
      JOIN employees e ON p.employee_id = e.employee_id
      LEFT JOIN departments d ON e.department_id = d.department_id
      LEFT JOIN jobs j ON e.job_id = j.job_id
      ORDER BY p.payment_date DESC, p.payroll_id DESC
      LIMIT 5
    `);

    // 6. Department breakdown
    const [deptBreakdown] = await pool.query(`
      SELECT 
        d.department_id,
        d.department_name,
        COUNT(e.employee_id) AS employee_count,
        COALESCE(SUM(COALESCE(e.primary_salary, j.base_salary)), 0) AS total_salary_cost
      FROM departments d
      LEFT JOIN employees e ON d.department_id = e.department_id
      LEFT JOIN jobs j ON e.job_id = j.job_id
      GROUP BY d.department_id, d.department_name
      ORDER BY employee_count DESC
    `);

    res.json({
      employees: empStats,
      departments_count: dept_count,
      jobs_count: job_count,
      payroll: payrollStats,
      latest_month: latestMonthStats,
      recent_payrolls: recentPayrolls,
      department_breakdown: deptBreakdown
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Employees Endpoints
// -------------------------------------------------------------

// List all employees (with filters & search)
app.get('/api/employees', async (req, res) => {
  try {
    const { search, department_id, status } = req.query;
    let query = `
      SELECT 
        e.employee_id,
        e.first_name,
        e.last_name,
        CONCAT(e.first_name, ' ', e.last_name) AS full_name,
        e.email,
        e.phone_number,
        e.hire_date,
        e.status,
        e.primary_salary,
        j.job_id,
        j.job_title,
        j.base_salary,
        COALESCE(e.primary_salary, j.base_salary, 0) AS effective_salary,
        d.department_id,
        d.department_name,
        (SELECT COUNT(*) FROM payroll_records pr WHERE pr.employee_id = e.employee_id) AS payroll_history_count
      FROM employees e
      LEFT JOIN departments d ON e.department_id = d.department_id
      LEFT JOIN jobs j ON e.job_id = j.job_id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ` AND (e.first_name LIKE ? OR e.last_name LIKE ? OR e.email LIKE ? OR e.phone_number LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    if (department_id) {
      query += ` AND e.department_id = ?`;
      params.push(department_id);
    }

    if (status) {
      query += ` AND e.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY e.employee_id ASC`;

    const [employees] = await pool.query(query, params);
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single Employee with Payroll History
app.get('/api/employees/:id', async (req, res) => {
  try {
    const [employees] = await pool.query(`
      SELECT 
        e.*,
        CONCAT(e.first_name, ' ', e.last_name) AS full_name,
        j.job_title,
        j.base_salary,
        COALESCE(e.primary_salary, j.base_salary, 0) AS effective_salary,
        d.department_name
      FROM employees e
      LEFT JOIN departments d ON e.department_id = d.department_id
      LEFT JOIN jobs j ON e.job_id = j.job_id
      WHERE e.employee_id = ?
    `, [req.params.id]);

    if (employees.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const [payrolls] = await pool.query(`
      SELECT 
        p.*,
        sd.income_tax,
        sd.provident_fund,
        sd.health_insurance,
        sd.other_statutory
      FROM payroll_records p
      LEFT JOIN statutory_deductions sd ON p.payroll_id = sd.payroll_id
      WHERE p.employee_id = ?
      ORDER BY p.payment_date DESC, p.payroll_id DESC
    `, [req.params.id]);

    res.json({
      employee: employees[0],
      payrolls
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new employee
app.post('/api/employees', async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      email,
      phone_number,
      primary_salary,
      hire_date,
      department_id,
      job_id,
      status
    } = req.body;

    if (!first_name || !last_name || !email || !department_id || !job_id || !hire_date) {
      return res.status(400).json({ error: 'Missing required employee fields' });
    }

    const [result] = await pool.query(`
      INSERT INTO employees (
        first_name, last_name, email, phone_number,
        primary_salary, hire_date, department_id, job_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      first_name,
      last_name,
      email,
      phone_number || null,
      primary_salary ? Number(primary_salary) : null,
      hire_date,
      Number(department_id),
      Number(job_id),
      status || 'Active'
    ]);

    const [created] = await pool.query(`
      SELECT e.*, d.department_name, j.job_title 
      FROM employees e
      LEFT JOIN departments d ON e.department_id = d.department_id
      LEFT JOIN jobs j ON e.job_id = j.job_id
      WHERE e.employee_id = ?
    `, [result.insertId]);

    res.status(201).json(created[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An employee with this email already exists.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Update employee
app.put('/api/employees/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      first_name,
      last_name,
      email,
      phone_number,
      primary_salary,
      hire_date,
      department_id,
      job_id,
      status
    } = req.body;

    await pool.query(`
      UPDATE employees 
      SET 
        first_name = ?,
        last_name = ?,
        email = ?,
        phone_number = ?,
        primary_salary = ?,
        hire_date = ?,
        department_id = ?,
        job_id = ?,
        status = ?
      WHERE employee_id = ?
    `, [
      first_name,
      last_name,
      email,
      phone_number || null,
      primary_salary ? Number(primary_salary) : null,
      hire_date,
      Number(department_id),
      Number(job_id),
      status || 'Active',
      id
    ]);

    const [updated] = await pool.query(`
      SELECT e.*, d.department_name, j.job_title 
      FROM employees e
      LEFT JOIN departments d ON e.department_id = d.department_id
      LEFT JOIN jobs j ON e.job_id = j.job_id
      WHERE e.employee_id = ?
    `, [id]);

    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete employee
app.delete('/api/employees/:id', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    // Check if payroll records exist
    const [[{ pCount }]] = await connection.query(
      'SELECT COUNT(*) AS pCount FROM payroll_records WHERE employee_id = ?',
      [id]
    );

    if (pCount > 0) {
      // Rather than a destructive hard fail, inform or allow archive
      return res.status(400).json({
        error: `Cannot delete employee because they have ${pCount} payroll records. You can change their status to 'Terminated' instead.`
      });
    }

    await connection.query('DELETE FROM employees WHERE employee_id = ?', [id]);
    res.json({ success: true, message: 'Employee deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// -------------------------------------------------------------
// Departments & Jobs
// -------------------------------------------------------------

// List departments
app.get('/api/departments', async (req, res) => {
  try {
    const [departments] = await pool.query(`
      SELECT 
        d.department_id,
        d.department_name,
        COUNT(e.employee_id) AS total_employees,
        COALESCE(SUM(CASE WHEN e.status = 'Active' THEN 1 ELSE 0 END), 0) AS active_employees,
        COALESCE(SUM(COALESCE(e.primary_salary, j.base_salary)), 0) AS monthly_salary_budget
      FROM departments d
      LEFT JOIN employees e ON d.department_id = e.department_id
      LEFT JOIN jobs j ON e.job_id = j.job_id
      GROUP BY d.department_id, d.department_name
      ORDER BY d.department_id ASC
    `);
    res.json(departments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add department
app.post('/api/departments', async (req, res) => {
  try {
    const { department_name } = req.body;
    if (!department_name || !department_name.trim()) {
      return res.status(400).json({ error: 'Department name is required' });
    }
    const [result] = await pool.query(
      'INSERT INTO departments (department_name) VALUES (?)',
      [department_name.trim()]
    );
    res.status(201).json({
      department_id: result.insertId,
      department_name: department_name.trim()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List jobs
app.get('/api/jobs', async (req, res) => {
  try {
    const [jobs] = await pool.query(`
      SELECT 
        j.job_id,
        j.job_title,
        j.base_salary,
        COUNT(e.employee_id) AS total_employees
      FROM jobs j
      LEFT JOIN employees e ON j.job_id = e.job_id
      GROUP BY j.job_id, j.job_title, j.base_salary
      ORDER BY j.job_id ASC
    `);
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add job
app.post('/api/jobs', async (req, res) => {
  try {
    const { job_title, base_salary } = req.body;
    if (!job_title || !job_title.trim()) {
      return res.status(400).json({ error: 'Job title is required' });
    }
    const [result] = await pool.query(
      'INSERT INTO jobs (job_title, base_salary) VALUES (?, ?)',
      [job_title.trim(), Number(base_salary) || 0]
    );
    res.status(201).json({
      job_id: result.insertId,
      job_title: job_title.trim(),
      base_salary: Number(base_salary) || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Payroll Management & Payslips
// -------------------------------------------------------------

// List payroll records
app.get('/api/payrolls', async (req, res) => {
  try {
    const { employee_id, month, year } = req.query;
    let query = `
      SELECT 
        p.payroll_id,
        p.employee_id,
        CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
        e.email,
        d.department_name,
        j.job_title,
        p.pay_period_start,
        p.pay_period_end,
        p.payment_date,
        p.gross_salary,
        p.total_deductions,
        p.net_salary,
        sd.deduction_id,
        sd.income_tax,
        sd.provident_fund,
        sd.health_insurance,
        sd.other_statutory
      FROM payroll_records p
      JOIN employees e ON p.employee_id = e.employee_id
      LEFT JOIN departments d ON e.department_id = d.department_id
      LEFT JOIN jobs j ON e.job_id = j.job_id
      LEFT JOIN statutory_deductions sd ON p.payroll_id = sd.payroll_id
      WHERE 1=1
    `;
    const params = [];

    if (employee_id) {
      query += ` AND p.employee_id = ?`;
      params.push(employee_id);
    }

    if (year) {
      query += ` AND YEAR(p.payment_date) = ?`;
      params.push(year);
    }

    if (month) {
      query += ` AND MONTH(p.payment_date) = ?`;
      params.push(month);
    }

    query += ` ORDER BY p.payment_date DESC, p.payroll_id DESC`;

    const [records] = await pool.query(query, params);
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single Payroll Record Details (for printable payslip)
app.get('/api/payrolls/:id', async (req, res) => {
  try {
    const [records] = await pool.query(`
      SELECT 
        p.payroll_id,
        p.employee_id,
        CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
        e.first_name,
        e.last_name,
        e.email,
        e.phone_number,
        e.hire_date,
        d.department_name,
        j.job_title,
        p.pay_period_start,
        p.pay_period_end,
        p.payment_date,
        p.gross_salary,
        p.total_deductions,
        p.net_salary,
        COALESCE(sd.income_tax, 0) AS income_tax,
        COALESCE(sd.provident_fund, 0) AS provident_fund,
        COALESCE(sd.health_insurance, 0) AS health_insurance,
        COALESCE(sd.other_statutory, 0) AS other_statutory
      FROM payroll_records p
      JOIN employees e ON p.employee_id = e.employee_id
      LEFT JOIN departments d ON e.department_id = d.department_id
      LEFT JOIN jobs j ON e.job_id = j.job_id
      LEFT JOIN statutory_deductions sd ON p.payroll_id = sd.payroll_id
      WHERE p.payroll_id = ?
    `, [req.params.id]);

    if (records.length === 0) {
      return res.status(404).json({ error: 'Payroll record not found' });
    }

    res.json(records[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Process / Generate Payroll (Single or Bulk)
app.post('/api/payrolls/generate', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const {
      employee_id, // If null or 'ALL', runs for all active employees
      pay_period_start,
      pay_period_end,
      payment_date,
      custom_rates // optional overrides { income_tax_pct, pf_pct, health_insurance_pct }
    } = req.body;

    if (!pay_period_start || !pay_period_end || !payment_date) {
      await connection.rollback();
      return res.status(400).json({ error: 'Start date, end date, and payment date are required.' });
    }

    let empQuery = `
      SELECT e.employee_id, e.first_name, e.last_name, 
             COALESCE(e.primary_salary, j.base_salary, 0) AS salary
      FROM employees e
      LEFT JOIN jobs j ON e.job_id = j.job_id
      WHERE e.status = 'Active'
    `;
    const empParams = [];

    if (employee_id && employee_id !== 'ALL') {
      empQuery += ` AND e.employee_id = ?`;
      empParams.push(employee_id);
    }

    const [eligibleEmployees] = await connection.query(empQuery, empParams);

    if (eligibleEmployees.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'No active employees found to generate payroll for.' });
    }

    const itRate = custom_rates?.income_tax_pct !== undefined ? custom_rates.income_tax_pct / 100 : 0.10; // 10%
    const pfRate = custom_rates?.pf_pct !== undefined ? custom_rates.pf_pct / 100 : 0.04; // 4%
    const insRate = custom_rates?.health_insurance_pct !== undefined ? custom_rates.health_insurance_pct / 100 : 0.02; // 2%

    const generatedPayrolls = [];

    for (const emp of eligibleEmployees) {
      const gross = round2(emp.salary);
      const incomeTax = round2(gross * itRate);
      const pf = round2(gross * pfRate);
      const healthInsurance = round2(gross * insRate);
      const other = 0.00;
      const totalDeductions = round2(incomeTax + pf + healthInsurance + other);
      const netSalary = round2(gross - totalDeductions);

      // 1. Insert payroll_record (net_salary is a GENERATED ALWAYS column, computed automatically by MySQL)
      const [pResult] = await connection.query(`
        INSERT INTO payroll_records (
          employee_id, pay_period_start, pay_period_end, payment_date,
          gross_salary, total_deductions
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [
        emp.employee_id,
        pay_period_start,
        pay_period_end,
        payment_date,
        gross,
        totalDeductions
      ]);

      const newPayrollId = pResult.insertId;

      // 2. Insert statutory_deductions
      await connection.query(`
        INSERT INTO statutory_deductions (
          payroll_id, income_tax, provident_fund, health_insurance, other_statutory
        ) VALUES (?, ?, ?, ?, ?)
      `, [
        newPayrollId,
        incomeTax,
        pf,
        healthInsurance,
        other
      ]);

      generatedPayrolls.push({
        payroll_id: newPayrollId,
        employee_id: emp.employee_id,
        name: `${emp.first_name} ${emp.last_name}`,
        gross_salary: gross,
        total_deductions: totalDeductions,
        net_salary: netSalary
      });
    }

    await connection.commit();
    res.status(201).json({
      success: true,
      count: generatedPayrolls.length,
      records: generatedPayrolls
    });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// Delete a payroll record
app.delete('/api/payrolls/:id', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { id } = req.params;

    // Delete associated deductions first
    await connection.query('DELETE FROM statutory_deductions WHERE payroll_id = ?', [id]);
    // Delete payroll record
    await connection.query('DELETE FROM payroll_records WHERE payroll_id = ?', [id]);

    await connection.commit();
    res.json({ success: true, message: 'Payroll record deleted successfully' });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// Serve frontend for all other routes (Express 5 compatible)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Payroll Management Server listening at http://localhost:${PORT}`);
  console.log(`🌐 Dashboard UI accessible at http://localhost:${PORT}`);
});
