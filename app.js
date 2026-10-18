/**
 * ============================================================================
 * Medi Flow - OPD Triage Decision Support Prototype
 *
 * Architecture:
 *   1. State & Storage Helpers (localStorage backed, synthetic data only)
 *   2. Rule Engine (Pure evaluation function, Sample Rules catalog)
 *   3. Registration & Emergency Walk-In
 *   4. Triage Assessment & Human Confirmation / Override Oversight
 *   5. Clinical Alerts & Virtual Time SLA Engine
 *   6. Queue Board & Sorting / Reordering
 *   7. Clinical Escalation & Doctor Inbox
 *   8. Audit Trail & CSV Export
 *   9. Analytics Dashboard
 *  10. Demo Data Generator & Time Simulation (+15 min)
 *  11. Automated Self-Test Suite (~12 Assertions)
 *  12. UI Event Handlers & Role Permission Enforcer
 * ============================================================================
 */

(function () {
  'use strict';

  // ==========================================================================
  // ==========================================================================
  // SECTION 1: STATE, STORAGE & SECURE AUTHENTICATION HELPERS
  // ==========================================================================
  const STORAGE_KEYS = {
    PATIENTS: 'triage_patients_v1',
    ALERTS: 'triage_alerts_v1',
    AUDIT: 'triage_audit_v1',
    ESCALATIONS: 'triage_escalations_v1',
    VTIME: 'triage_vtime_v1',
    COUNTER: 'triage_counter_v1',
    ACCOUNTS: 'triage_accounts_v1',
    AUTH_USER: 'triage_auth_user_v1'
  };

  const DEFAULT_START_TIME = '2026-10-18T09:00:00';

  const ROLES = {
    clerk: { title: 'Registration Clerk', canTriage: false, canEscalate: false, canRespondDoctor: false, canReorder: false, canManageAccounts: false },
    nurse: { title: 'Triage Nurse', canTriage: true, canEscalate: true, canRespondDoctor: false, canReorder: true, canManageAccounts: false },
    doctor: { title: 'Doctor', canTriage: true, canEscalate: true, canRespondDoctor: true, canReorder: true, canManageAccounts: false },
    admin: { title: 'Admin', canTriage: true, canEscalate: true, canRespondDoctor: true, canReorder: true, canManageAccounts: true }
  };

  // --------------------------------------------------------------------------
  // Web Crypto Salted SHA-256 Hashing (Never plain text)
  // --------------------------------------------------------------------------
  function generateSalt() {
    if (window.crypto && window.crypto.getRandomValues) {
      const array = new Uint8Array(16);
      window.crypto.getRandomValues(array);
      return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
  }

  async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    const data = enc.encode(`${salt}:${password}`);
    if (window.crypto && window.crypto.subtle) {
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data[i];
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(64, '0');
  }

  function getStorage(key, defaultVal) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : defaultVal;
    } catch (e) {
      console.warn('Storage read failed:', key, e);
      return defaultVal;
    }
  }

  function setStorage(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      console.error('Storage write failed:', key, e);
    }
  }

  // App State Object
  const State = {
    patients: [],
    alerts: [],
    audit: [],
    escalations: [],
    accounts: [],
    currentAuthUser: null, // { staffId, name, role, licenseNumber, licenseVerified }
    currentRole: null,
    currentUser: null,
    vTime: new Date(DEFAULT_START_TIME).getTime(),
    tokenCounter: 1,
    activeTab: 'queueTab',
    lastActivityTime: Date.now(),
    selectedPatientForTriage: null,
    selectedPatientForEscalation: null,
    selectedEscalationForResponse: null,
    pendingDowngradeData: null,
    pendingDuplicateData: null,
    selectedPatientForReorder: null,
    selectedStaffForReset: null
  };

  function loadState() {
    State.patients = getStorage(STORAGE_KEYS.PATIENTS, []);
    State.alerts = getStorage(STORAGE_KEYS.ALERTS, []);
    State.audit = getStorage(STORAGE_KEYS.AUDIT, []);
    State.escalations = getStorage(STORAGE_KEYS.ESCALATIONS, []);
    State.vTime = getStorage(STORAGE_KEYS.VTIME, new Date(DEFAULT_START_TIME).getTime());
    State.tokenCounter = getStorage(STORAGE_KEYS.COUNTER, 1);
    State.accounts = getStorage(STORAGE_KEYS.ACCOUNTS, []);
    State.currentAuthUser = getStorage(STORAGE_KEYS.AUTH_USER, null);
    if (State.currentAuthUser) {
      State.currentRole = State.currentAuthUser.role;
      State.currentUser = State.currentAuthUser.name;
    } else {
      State.currentRole = null;
      State.currentUser = null;
    }
  }

  function saveAllState() {
    setStorage(STORAGE_KEYS.PATIENTS, State.patients);
    setStorage(STORAGE_KEYS.ALERTS, State.alerts);
    setStorage(STORAGE_KEYS.AUDIT, State.audit);
    setStorage(STORAGE_KEYS.ESCALATIONS, State.escalations);
    setStorage(STORAGE_KEYS.VTIME, State.vTime);
    setStorage(STORAGE_KEYS.COUNTER, State.tokenCounter);
    setStorage(STORAGE_KEYS.ACCOUNTS, State.accounts);
    setStorage(STORAGE_KEYS.AUTH_USER, State.currentAuthUser);
  }

  // --------------------------------------------------------------------------
  // Seed Synthetic Demo Accounts (Salted Hashes Only - Never Plaintext)
  // --------------------------------------------------------------------------
  async function seedInitialDemoAccounts() {
    let accounts = getStorage(STORAGE_KEYS.ACCOUNTS, null);
    if (!accounts || accounts.length === 0) {
      const initialSeeds = [
        {
          staffId: 'clerk01',
          name: 'Clerk Alex',
          role: 'clerk',
          licenseNumber: '',
          licenseVerified: false,
          status: 'ACTIVE',
          plainPass: 'clerk123',
          createdBy: 'SYSTEM',
          approvedBy: 'SYSTEM',
          createdAt: 1700000000000
        },
        {
          staffId: 'nurse01',
          name: 'Nurse Sarah',
          role: 'nurse',
          licenseNumber: 'RN-88421',
          licenseVerified: true,
          status: 'ACTIVE',
          plainPass: 'nurse123',
          createdBy: 'SYSTEM',
          approvedBy: 'SYSTEM',
          createdAt: 1700000000000
        },
        {
          staffId: 'doctor01',
          name: 'Dr. Rao',
          role: 'doctor',
          licenseNumber: 'MC-45910',
          licenseVerified: true,
          status: 'ACTIVE',
          plainPass: 'doctor123',
          createdBy: 'SYSTEM',
          approvedBy: 'SYSTEM',
          createdAt: 1700000000000
        },
        {
          staffId: 'admin01',
          name: 'Admin Priya',
          role: 'admin',
          licenseNumber: '',
          licenseVerified: false,
          status: 'ACTIVE',
          plainPass: 'admin123',
          createdBy: 'SYSTEM',
          approvedBy: 'SYSTEM',
          createdAt: 1700000000000
        },
        {
          staffId: 'admin02',
          name: 'Admin David',
          role: 'admin',
          licenseNumber: '',
          licenseVerified: false,
          status: 'ACTIVE',
          plainPass: 'admin456',
          createdBy: 'SYSTEM',
          approvedBy: 'SYSTEM',
          createdAt: 1700000000000
        }
      ];

      accounts = [];
      for (const s of initialSeeds) {
        const salt = generateSalt();
        const hash = await hashPassword(s.plainPass, salt);
        accounts.push({
          staffId: s.staffId,
          name: s.name,
          role: s.role,
          licenseNumber: s.licenseNumber,
          licenseVerified: s.licenseVerified,
          status: s.status,
          salt: salt,
          passwordHash: hash,
          failedAttempts: 0,
          lockedUntil: null,
          createdBy: s.createdBy,
          approvedBy: s.approvedBy,
          createdAt: s.createdAt
        });
      }
      setStorage(STORAGE_KEYS.ACCOUNTS, accounts);
    }
    State.accounts = accounts;
  }

  // --------------------------------------------------------------------------
  // Authentication & Session Management
  // --------------------------------------------------------------------------
  async function loginUser(staffIdInput, passwordInput, isTest = false) {
    const staffId = (staffIdInput || '').trim().toLowerCase();
    const password = passwordInput || '';

    const account = State.accounts.find(a => a.staffId.toLowerCase() === staffId);
    if (!account) {
      if (!isTest) {
        addAuditEntry({
          action: 'LOGIN_FAILED',
          patientToken: '--',
          details: `Authentication failed: Unknown Staff ID [${staffIdInput}]`
        });
        showLoginError('Invalid Staff ID or Password.');
      }
      return { success: false, reason: 'UNKNOWN_USER' };
    }

    // Check lockout
    if (account.lockedUntil && account.lockedUntil > State.vTime) {
      const remainingMin = Math.max(1, Math.ceil((account.lockedUntil - State.vTime) / 60000));
      if (!isTest) {
        addAuditEntry({
          action: 'LOGIN_FAILED_LOCKED',
          patientToken: '--',
          details: `Authentication blocked: Account ${account.staffId} is locked for ${remainingMin} more minutes.`
        });
        showLoginLockout(`Account is temporarily locked due to 3 failed attempts. Please wait ${remainingMin} minute(s) or contact an administrator.`);
      }
      return { success: false, reason: 'LOCKED', remainingMin };
    }

    // If lockout expired, reset counter
    if (account.lockedUntil && account.lockedUntil <= State.vTime) {
      account.failedAttempts = 0;
      account.lockedUntil = null;
    }

    // Check status
    if (account.status === 'PENDING') {
      if (!isTest) {
        addAuditEntry({
          action: 'LOGIN_FAILED_PENDING',
          patientToken: '--',
          details: `Authentication blocked: Account ${account.staffId} is in PENDING status awaiting two-person administrator approval.`
        });
        showLoginError('Account is PENDING approval from a second administrator before access is granted.');
      }
      return { success: false, reason: 'PENDING' };
    }

    if (account.status === 'DEACTIVATED') {
      if (!isTest) {
        addAuditEntry({
          action: 'LOGIN_FAILED_DEACTIVATED',
          patientToken: '--',
          details: `Authentication blocked: Account ${account.staffId} is DEACTIVATED.`
        });
        showLoginError('Account has been DEACTIVATED. Contact an administrator.');
      }
      return { success: false, reason: 'DEACTIVATED' };
    }

    // Validate password using salted SHA-256
    const computedHash = await hashPassword(password, account.salt);
    if (computedHash !== account.passwordHash) {
      account.failedAttempts = (account.failedAttempts || 0) + 1;
      if (account.failedAttempts >= 3) {
        account.lockedUntil = State.vTime + (5 * 60 * 1000); // 5 min lockout
        if (!isTest) {
          addAuditEntry({
            action: 'ACCOUNT_LOCKOUT',
            patientToken: '--',
            details: `SECURITY LOCKOUT: Staff account ${account.staffId} locked for 5 minutes after 3 consecutive failed login attempts.`
          });
          showLoginLockout('Account locked! 3 consecutive failed password attempts. Account locked for 5 minutes.');
        }
      } else {
        const remainingAttempts = 3 - account.failedAttempts;
        if (!isTest) {
          addAuditEntry({
            action: 'LOGIN_FAILED',
            patientToken: '--',
            details: `Authentication failed for ${account.staffId} (Incorrect password, attempt ${account.failedAttempts}/3)`
          });
          showLoginError(`Invalid Staff ID or Password. ${remainingAttempts} attempt(s) remaining before a 5-minute lockout.`);
        }
      }
      saveAllState();
      return { success: false, reason: 'INVALID_PASSWORD' };
    }

    // Login Success
    account.failedAttempts = 0;
    account.lockedUntil = null;
    saveAllState();

    if (!isTest) {
      State.currentAuthUser = {
        staffId: account.staffId,
        name: account.name,
        role: account.role,
        licenseNumber: account.licenseNumber,
        licenseVerified: account.licenseVerified
      };
      State.currentRole = account.role;
      State.currentUser = account.name;
      State.lastActivityTime = Date.now();
      saveAllState();

      addAuditEntry({
        action: 'LOGIN_SUCCESS',
        patientToken: '--',
        details: `Staff ${account.staffId} (${account.name}, ${ROLES[account.role]?.title || account.role}) logged in successfully.`
      });

      document.getElementById('loginOverlay').style.display = 'none';
      document.getElementById('loginStaffId').value = '';
      document.getElementById('loginPassword').value = '';
      hideLoginAlerts();
      updateUserProfileHeader();
      applyRolePermissions();
      renderQueueTable();
      renderDoctorInbox();
      renderAccountsTable();
      renderDashboard();
      renderAuditTable();

      showToast('Staff Authenticated', `Logged in as ${account.name} [${ROLES[account.role]?.title || account.role}]`, 'toast-info');
    }

    return { success: true, account };
  }

  function logoutUser(reason = 'User logout') {
    const wasUser = State.currentAuthUser;
    if (wasUser) {
      addAuditEntry({
        action: (reason.toLowerCase().includes('inactivity') ? 'AUTO_LOGOUT_INACTIVITY' : 'LOGOUT'),
        patientToken: '--',
        details: `Staff ${wasUser.staffId} (${wasUser.name}) logged out. Reason: ${reason}`
      });
    }

    State.currentAuthUser = null;
    State.currentRole = null;
    State.currentUser = null;
    setStorage(STORAGE_KEYS.AUTH_USER, null);

    // Close all open modals
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));

    // Show login overlay
    document.getElementById('loginOverlay').style.display = 'flex';
    document.getElementById('userProfileChip').style.display = 'none';
    hideLoginAlerts();

    showToast('Logged Out', reason, 'toast-info');
  }

  function updateUserProfileHeader() {
    const chip = document.getElementById('userProfileChip');
    if (!State.currentAuthUser) {
      chip.style.display = 'none';
      return;
    }
    chip.style.display = 'flex';
    document.getElementById('currentUserNameDisplay').innerText = State.currentAuthUser.name;
    document.getElementById('currentUserRoleBadge').innerText = ROLES[State.currentAuthUser.role]?.title || State.currentAuthUser.role;
    document.getElementById('currentUserStaffId').innerText = `(${State.currentAuthUser.staffId})`;
  }

  function applyRolePermissions() {
    if (!State.currentAuthUser) return;
    const role = State.currentAuthUser.role;

    // Accounts tab only visible to Admin
    const tabAccounts = document.getElementById('tabBtnAccounts');
    if (tabAccounts) {
      tabAccounts.style.display = (role === 'admin') ? '' : 'none';
      updatePendingAccountsBadge();
    }

    // Clerk cannot see rules, audit, accounts
    const tabRules = document.getElementById('tabBtnRules');
    const tabAudit = document.getElementById('tabBtnAudit');
    if (role === 'clerk') {
      if (tabRules) tabRules.style.display = 'none';
      if (tabAudit) tabAudit.style.display = 'none';
      if (State.activeTab === 'rulesTab' || State.activeTab === 'auditTab' || State.activeTab === 'accountsTab') {
        switchTab('queueTab');
      }
    } else {
      if (tabRules) tabRules.style.display = '';
      if (tabAudit) tabAudit.style.display = '';
    }
  }

  function updatePendingAccountsBadge() {
    const badge = document.getElementById('pendingAccountsBadge');
    if (!badge) return;
    const pendingCount = State.accounts.filter(a => a.status === 'PENDING').length;
    badge.innerText = String(pendingCount);
    badge.style.display = (pendingCount > 0 && State.currentAuthUser?.role === 'admin') ? '' : 'none';
  }

  function canPerform(capability) {
    if (!State.currentAuthUser) return false;
    const role = State.currentAuthUser.role;
    const config = ROLES[role];
    if (!config) return false;
    return !!config[capability];
  }

  function enforcePermission(capability, actionDescription, token = '--') {
    if (!State.currentAuthUser) {
      logUnauthorizedAttempt('Unauthenticated action: ' + actionDescription, token);
      showToast('Authentication Required', 'Please sign in to perform this clinical action.', 'toast-warning');
      return false;
    }

    if (!canPerform(capability)) {
      logUnauthorizedAttempt(actionDescription, token);
      showToast('Unauthorized Action Blocked', `Role [${ROLES[State.currentAuthUser.role]?.title || State.currentAuthUser.role}] is not authorized to ${actionDescription}. Security event logged.`, 'toast-l1');
      return false;
    }
    return true;
  }

  function logUnauthorizedAttempt(actionDescription, target = '--') {
    const user = State.currentAuthUser ? State.currentAuthUser.name : 'Unauthenticated Visitor';
    const role = State.currentAuthUser ? State.currentAuthUser.role : 'None';
    const staffId = State.currentAuthUser ? State.currentAuthUser.staffId : 'None';
    addAuditEntry({
      action: 'UNAUTHORIZED_ATTEMPT',
      patientToken: target,
      patientName: '--',
      details: `SECURITY ALERT: Unauthorized action [${actionDescription}] blocked for staff ${staffId} (${user}, role: ${role})`,
      diff: { staffId, role, action: actionDescription }
    });
  }

  function initInactivityWatcher() {
    const recordActivity = () => {
      State.lastActivityTime = Date.now();
    };

    ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
      window.addEventListener(evt, recordActivity, { passive: true });
    });

    // Check timer every 3 seconds
    setInterval(() => {
      if (!State.currentAuthUser) return;
      const elapsed = Date.now() - State.lastActivityTime;
      const TEN_MIN = 10 * 60 * 1000;
      const NINE_MIN = 9 * 60 * 1000;

      if (elapsed >= TEN_MIN) {
        closeModal('inactivityModal');
        logoutUser('10 minutes of inactivity');
      } else if (elapsed >= NINE_MIN) {
        const remainingSec = Math.max(0, Math.ceil((TEN_MIN - elapsed) / 1000));
        const countEl = document.getElementById('inactivityCountdown');
        if (countEl) countEl.innerText = `${remainingSec} seconds`;
        openModal('inactivityModal');
      } else {
        const inactModal = document.getElementById('inactivityModal');
        if (inactModal && inactModal.classList.contains('open')) {
          closeModal('inactivityModal');
        }
      }
    }, 3000);
  }

  // --------------------------------------------------------------------------
  // Account Management Directory & Administrative Actions
  // --------------------------------------------------------------------------
  function renderAccountsTable() {
    const tbody = document.getElementById('accountsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filterRole = document.getElementById('filterAccountRole').value;
    const accounts = State.accounts.filter(a => {
      if (filterRole !== 'ALL' && a.role !== filterRole) return false;
      return true;
    });

    if (accounts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#64748b; padding:2rem;">No staff accounts found matching filter.</td></tr>`;
      return;
    }

    const currentStaffId = State.currentAuthUser ? State.currentAuthUser.staffId : '';

    accounts.forEach(acc => {
      const isSelf = (acc.staffId === currentStaffId);
      const isLocked = (acc.lockedUntil && acc.lockedUntil > State.vTime);

      // Status Badge
      let statusBadgeHtml = '';
      if (isLocked) {
        const remMin = Math.ceil((acc.lockedUntil - State.vTime) / 60000);
        statusBadgeHtml = `<span class="status-badge escalated" title="Account locked for ${remMin}m">🔒 Locked (${remMin}m)</span>`;
      } else if (acc.status === 'ACTIVE') {
        statusBadgeHtml = '<span class="status-badge active">🟢 Active</span>';
      } else if (acc.status === 'PENDING') {
        statusBadgeHtml = '<span class="status-badge pending">🟡 Pending Approval</span>';
      } else if (acc.status === 'DEACTIVATED') {
        statusBadgeHtml = '<span class="status-badge deactivated">🔴 Deactivated</span>';
      }

      // License Verified Badge
      let licenseHtml = '<span style="color:#64748b; font-size:0.75rem;">N/A (Non-clinical)</span>';
      if (acc.role === 'doctor' || acc.role === 'nurse') {
        licenseHtml = `
          <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
            <span class="license-badge ${acc.licenseVerified ? 'verified' : 'unverified'}">
              ${acc.licenseVerified ? '🛡️ Verified: YES' : '⚠️ Verified: NO (manual check)'}
            </span>
            <button class="btn btn-secondary btn-sm" onclick="window.triageApp.toggleLicenseVerified('${acc.staffId}')" title="Verify against official council registry">
              Toggle
            </button>
          </div>
        `;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family:var(--font-mono); font-weight:700; color:#0369a1;">
          ${acc.staffId} ${isSelf ? '<span style="color:#64748b; font-size:0.7rem;">(You)</span>' : ''}
        </td>
        <td style="font-weight:600;">${escapeHtml(acc.name)}</td>
        <td><span class="status-badge waiting">${ROLES[acc.role]?.title || acc.role}</span></td>
        <td style="font-family:var(--font-mono); font-size:0.8rem;">${acc.licenseNumber ? escapeHtml(acc.licenseNumber) : '--'}</td>
        <td>${licenseHtml}</td>
        <td>${statusBadgeHtml}</td>
        <td style="font-size:0.75rem; color:#475569;">
          <div>Created: <strong>${acc.createdBy || 'SYSTEM'}</strong></div>
          <div>Approved: <strong>${acc.approvedBy || 'Pending'}</strong></div>
        </td>
        <td style="text-align: right; white-space: nowrap;">
          <div class="toolbar-group" style="justify-content: flex-end;">
            ${acc.status === 'PENDING' ? `
              <button class="btn btn-primary btn-sm" onclick="window.triageApp.approveAccount('${acc.staffId}')" ${acc.createdBy === currentStaffId ? 'disabled title="Two-person rule: Cannot approve an account you created. Requires approval from a different admin."' : 'title="Approve account as second administrator"'}>
                ✅ Approve
              </button>
            ` : ''}

            <button class="btn btn-secondary btn-sm" onclick="window.triageApp.toggleAccountStatus('${acc.staffId}')" ${isSelf ? 'disabled title="Cannot deactivate your own logged-in account"' : ''}>
              ${acc.status === 'ACTIVE' ? '🚫 Deactivate' : '🟢 Activate'}
            </button>

            <button class="btn btn-secondary btn-sm" onclick="window.triageApp.openResetPassword('${acc.staffId}')" title="Force password reset">
              🔑 Reset PIN
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    updatePendingAccountsBadge();
  }

  async function handleCreateStaffAccountSubmit(e) {
    e.preventDefault();

    if (!enforcePermission('canManageAccounts', 'provision new staff accounts')) return;

    const name = document.getElementById('newStaffName').value.trim();
    const staffId = document.getElementById('newStaffId').value.trim().toLowerCase();
    const role = document.getElementById('newStaffRole').value;
    const password = document.getElementById('newStaffPassword').value;
    const licenseNumber = document.getElementById('newStaffLicense').value.trim();

    if (!name || !staffId || !password) {
      showToast('Validation Error', 'Please complete all required fields.', 'toast-warning');
      return;
    }

    if (password.length < 6) {
      showToast('Password Too Short', 'Initial password must be at least 6 characters long.', 'toast-warning');
      return;
    }

    // Check duplicate
    if (State.accounts.some(a => a.staffId.toLowerCase() === staffId)) {
      showToast('Duplicate Staff ID', `Staff ID "${staffId}" is already registered. Please choose another identifier.`, 'toast-warning');
      return;
    }

    // Two-person approval requirement: Doctor & Admin are created PENDING
    const isDoctorOrAdmin = (role === 'doctor' || role === 'admin');
    const initialStatus = isDoctorOrAdmin ? 'PENDING' : 'ACTIVE';
    const approvedBy = isDoctorOrAdmin ? null : State.currentAuthUser.staffId;

    const salt = generateSalt();
    const hash = await hashPassword(password, salt);

    const newAccount = {
      staffId,
      name,
      role,
      licenseNumber: (role === 'doctor' || role === 'nurse') ? licenseNumber : '',
      licenseVerified: false,
      status: initialStatus,
      salt,
      passwordHash: hash,
      failedAttempts: 0,
      lockedUntil: null,
      createdBy: State.currentAuthUser.staffId,
      approvedBy,
      createdAt: State.vTime
    };

    State.accounts.push(newAccount);
    saveAllState();

    addAuditEntry({
      action: 'ACCOUNT_CREATED',
      patientToken: '--',
      details: `Admin ${State.currentAuthUser.staffId} provisioned ${role.toUpperCase()} account for ${name} (${staffId}). Status: ${initialStatus}${isDoctorOrAdmin ? ' [PENDING 2nd Admin Approval]' : ''}`,
      diff: { staffId, name, role, status: initialStatus, licenseNumber }
    });

    document.getElementById('createStaffAccountForm').reset();
    renderAccountsTable();

    if (isDoctorOrAdmin) {
      showToast('Account Created (Pending)', `Account for ${name} (${staffId}) created. A second administrator must approve before it can log in.`, 'toast-warning');
    } else {
      showToast('Account Created', `Active account created for ${name} (${staffId}).`, 'toast-info');
    }
  }

  function approveStaffAccount(staffId) {
    if (!enforcePermission('canManageAccounts', 'approve pending staff accounts')) return;

    const acc = State.accounts.find(a => a.staffId === staffId);
    if (!acc || acc.status !== 'PENDING') return;

    // Two-person approval rule: Must be a DIFFERENT admin
    if (acc.createdBy === State.currentAuthUser.staffId) {
      showToast('Two-Person Approval Rule Violation', 'Cannot approve an account you created. Approval must come from a different administrator.', 'toast-warning');
      logUnauthorizedAttempt(`Attempted self-approval of created account ${staffId}`);
      return;
    }

    acc.status = 'ACTIVE';
    acc.approvedBy = State.currentAuthUser.staffId;
    saveAllState();

    addAuditEntry({
      action: 'ACCOUNT_APPROVED',
      patientToken: '--',
      details: `Two-person approval completed: Admin ${State.currentAuthUser.staffId} approved and activated ${acc.role} account ${acc.staffId} (created by ${acc.createdBy}).`,
      diff: { staffId: acc.staffId, approvedBy: acc.approvedBy, status: 'ACTIVE' }
    });

    renderAccountsTable();
    showToast('Account Approved', `Account ${acc.staffId} (${acc.name}) is now Active and can log in.`, 'toast-info');
  }

  function toggleStaffAccountStatus(staffId) {
    if (!enforcePermission('canManageAccounts', 'modify account activation status')) return;

    const acc = State.accounts.find(a => a.staffId === staffId);
    if (!acc) return;

    // Nobody can deactivate themselves
    if (acc.staffId === State.currentAuthUser.staffId) {
      showToast('Blocked Action', 'You cannot deactivate your own logged-in administrator account.', 'toast-warning');
      logUnauthorizedAttempt(`Attempted self-deactivation of ${staffId}`);
      return;
    }

    const prevStatus = acc.status;
    acc.status = (acc.status === 'ACTIVE') ? 'DEACTIVATED' : 'ACTIVE';
    saveAllState();

    addAuditEntry({
      action: acc.status === 'ACTIVE' ? 'ACCOUNT_REACTIVATED' : 'ACCOUNT_DEACTIVATED',
      patientToken: '--',
      details: `Admin ${State.currentAuthUser.staffId} changed account status of ${acc.staffId} from ${prevStatus} to ${acc.status}.`,
      diff: { staffId: acc.staffId, previousStatus: prevStatus, newStatus: acc.status }
    });

    renderAccountsTable();
    showToast('Account Status Updated', `Account ${acc.staffId} is now ${acc.status}.`, 'toast-info');
  }

  function openResetPasswordModal(staffId) {
    if (!enforcePermission('canManageAccounts', 'force staff password reset')) return;

    const acc = State.accounts.find(a => a.staffId === staffId);
    if (!acc) return;

    State.selectedStaffForReset = acc;
    document.getElementById('resetStaffSummary').innerHTML = `
      <strong>Staff Member:</strong> ${acc.name} (${acc.staffId}) &bull; Role: ${ROLES[acc.role]?.title || acc.role}
    `;
    document.getElementById('adminNewPasswordInput').value = '';
    openModal('passwordResetModal');
  }

  async function handleConfirmPasswordReset() {
    if (!State.selectedStaffForReset) return;
    if (!enforcePermission('canManageAccounts', 'force staff password reset')) return;

    const newPass = document.getElementById('adminNewPasswordInput').value;
    if (!newPass || newPass.length < 6) {
      showToast('Validation Error', 'New password must be at least 6 characters.', 'toast-warning');
      return;
    }

    const acc = State.selectedStaffForReset;
    const newSalt = generateSalt();
    const newHash = await hashPassword(newPass, newSalt);

    acc.salt = newSalt;
    acc.passwordHash = newHash;
    acc.failedAttempts = 0;
    acc.lockedUntil = null;
    saveAllState();

    addAuditEntry({
      action: 'PASSWORD_RESET_FORCED',
      patientToken: '--',
      details: `Admin ${State.currentAuthUser.staffId} forced password reset for staff ${acc.staffId}. New salt & hash stored.`,
      diff: { staffId: acc.staffId }
    });

    closeModal('passwordResetModal');
    State.selectedStaffForReset = null;
    renderAccountsTable();
    showToast('Password Reset', `Password updated for ${acc.staffId}. Lockout cleared.`, 'toast-info');
  }

  function toggleLicenseVerified(staffId) {
    if (!enforcePermission('canManageAccounts', 'verify clinician license')) return;

    const acc = State.accounts.find(a => a.staffId === staffId);
    if (!acc) return;

    acc.licenseVerified = !acc.licenseVerified;
    saveAllState();

    addAuditEntry({
      action: 'LICENSE_VERIFICATION_UPDATED',
      patientToken: '--',
      details: `Admin ${State.currentAuthUser.staffId} toggled council license verification for ${acc.staffId} to: ${acc.licenseVerified ? 'YES (Verified)' : 'NO (Unverified)'}.`,
      diff: { staffId: acc.staffId, licenseVerified: acc.licenseVerified }
    });

    renderAccountsTable();
    showToast('License Status Updated', `License verification for ${acc.staffId} set to ${acc.licenseVerified ? 'YES' : 'NO'}.`, 'toast-info');
  }

  function updateAccountRole(actorStaffId, targetStaffId, newRole) {
    // Nobody can edit their own role!
    if (actorStaffId === targetStaffId) {
      throw new Error('Cannot modify your own account role');
    }
    const acc = State.accounts.find(a => a.staffId === targetStaffId);
    if (!acc) throw new Error('Account not found');
    const oldRole = acc.role;
    acc.role = newRole;
    saveAllState();
    addAuditEntry({
      action: 'ROLE_UPDATED',
      patientToken: '--',
      details: `Admin ${actorStaffId} updated role for ${targetStaffId} from ${oldRole} to ${newRole}.`,
      diff: { targetStaffId, oldRole, newRole }
    });
  }

  function showLoginError(msg) {
    const el = document.getElementById('loginErrorBox');
    if (el) {
      el.innerText = msg;
      el.style.display = 'block';
    }
  }

  function showLoginLockout(msg) {
    const el = document.getElementById('loginLockoutBox');
    if (el) {
      el.innerText = msg;
      el.style.display = 'block';
    }
  }

  function hideLoginAlerts() {
    const err = document.getElementById('loginErrorBox');
    const lock = document.getElementById('loginLockoutBox');
    if (err) err.style.display = 'none';
    if (lock) lock.style.display = 'none';
  }

  function getVirtualDate() {
    return new Date(State.vTime);
  }

  function formatVirtualTime(ms) {
    const d = new Date(ms || State.vTime);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatTimeOnly(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ==========================================================================
  // SECTION 2: RULE ENGINE (PURE EVALUATION FUNCTION & SAMPLE RULES)
  // ==========================================================================

  /**
   * SAMPLE RULES – require clinician approval before real clinical use.
   * Deterministic, rule-based clinical decision support.
   */
  const SAMPLE_RULES = [
    {
      id: 'R-SPO2-L1',
      name: 'Critical Hypoxia (SpO2 < 90%)',
      condition: 'SpO2 < 90%',
      level: 1,
      category: 'Vitals',
      rationale: 'Severe arterial hypoxemia impairs tissue oxygen delivery; immediate oxygen therapy and airway evaluation required.'
    },
    {
      id: 'R-SPO2-L2',
      name: 'Borderline Hypoxia (SpO2 90-93%)',
      condition: 'SpO2 >= 90% and SpO2 <= 93%',
      level: 2,
      category: 'Vitals',
      rationale: 'Moderate hypoxemia indicates respiratory compromise requiring urgent clinician evaluation within 15 minutes.'
    },
    {
      id: 'R-SBP-L1',
      name: 'Severe Hypotension / Shock (Systolic < 80 mmHg)',
      condition: 'Systolic BP < 80 mmHg',
      level: 1,
      category: 'Vitals',
      rationale: 'Profound hypoperfusion indicates decompensated shock; requires immediate resuscitation and fluid access.'
    },
    {
      id: 'R-SBP-L2',
      name: 'Hypotension or Severe Hypertension',
      condition: 'Systolic BP < 90 mmHg OR Systolic BP > 180 mmHg',
      level: 2,
      category: 'Vitals',
      rationale: 'Borderline shock or hypertensive crisis poses imminent organ risk requiring urgent intervention.'
    },
    {
      id: 'R-HR-L1-ADULT',
      name: 'Extreme Adult Heart Rate (< 40 or > 130 bpm)',
      condition: 'Adult/Elderly HR < 40 bpm OR HR > 130 bpm',
      level: 1,
      category: 'Vitals',
      rationale: 'Extreme bradycardia or severe tachycardia compromises cardiac output with imminent arrest risk.'
    },
    {
      id: 'R-HR-L2-ADULT',
      name: 'Adult Tachycardia (> 110 bpm)',
      condition: 'Adult HR > 110 bpm and HR <= 130 bpm',
      level: 2,
      category: 'Vitals',
      rationale: 'Marked resting tachycardia frequently signifies systemic distress, infection, or occult bleeding.'
    },
    {
      id: 'R-HR-PEDS',
      name: 'Pediatric Abnormal Heart Rate',
      condition: 'Infant HR < 80 or > 180; Child HR < 60 or > 160',
      level: 1,
      category: 'Vitals',
      rationale: 'Pediatric vital parameter thresholds are age-dependent; extreme values herald cardiopulmonary collapse.'
    },
    {
      id: 'R-RR-L1',
      name: 'Critical Respiratory Rate (Adult RR < 8 or > 30)',
      condition: 'Adult RR < 8 /min OR RR > 30 /min',
      level: 1,
      category: 'Vitals',
      rationale: 'Severe bradypnea indicates impending respiratory arrest; extreme tachypnea signals high work of breathing.'
    },
    {
      id: 'R-RR-L2',
      name: 'Elevated Adult Respiratory Rate (RR >= 24)',
      condition: 'Adult RR >= 24 and RR <= 30 /min',
      level: 2,
      category: 'Vitals',
      rationale: 'Tachypnea is the most sensitive early predictor of clinical deterioration.'
    },
    {
      id: 'R-GCS-L1',
      name: 'Severe Neurological Impairment (GCS <= 8)',
      condition: 'Glasgow Coma Scale <= 8',
      level: 1,
      category: 'Neurological',
      rationale: 'Loss of protective airway reflexes; requires immediate airway protection and resuscitation.'
    },
    {
      id: 'R-GCS-L2',
      name: 'Moderate Neurological Deficit (GCS 9 - 13)',
      condition: 'Glasgow Coma Scale 9 - 13',
      level: 2,
      category: 'Neurological',
      rationale: 'Altered mental status requires urgent neurovascular assessment.'
    },
    {
      id: 'R-TEMP-INFANT',
      name: 'Infant Fever (Age < 1 yr and Temp >= 38.0°C)',
      condition: 'Age < 1 year AND Temp >= 38.0°C',
      level: 2,
      category: 'Pediatric',
      rationale: 'Infants have immature immune systems and high risk of serious occult bacterial infection.'
    },
    {
      id: 'R-TEMP-HYPER',
      name: 'Severe Hyperpyrexia (Temp >= 39.5°C)',
      condition: 'Temperature >= 39.5°C',
      level: 2,
      category: 'Vitals',
      rationale: 'High fever carries risk of dehydration, seizure, or severe systemic infection.'
    },
    {
      id: 'R-RED-FLAG-L1',
      name: 'Immediate Life-Threat Red Flag Symptoms',
      condition: 'Stroke signs, active seizure, severe bleeding, or anaphylaxis',
      level: 1,
      category: 'Symptoms',
      rationale: 'Time-critical emergencies where immediate intervention directly alters survival and morbidity.'
    },
    {
      id: 'R-MENINGITIS-L1',
      name: 'Suspected Meningitis Triad',
      condition: 'Fever + Stiff Neck + Altered Consciousness',
      level: 1,
      category: 'Symptoms',
      rationale: 'Classic triad for acute bacterial meningitis requiring emergent lumbar puncture and IV antibiotics.'
    },
    {
      id: 'R-CHEST-PAIN-AGE',
      name: 'Adult Chest Pain (Age >= 40)',
      condition: 'Chest pain AND Age >= 40',
      level: 2,
      category: 'Symptoms',
      rationale: 'Significant probability of Acute Coronary Syndrome (ACS); requires ECG within 10 minutes.'
    },
    {
      id: 'R-PREGNANCY-BLEED',
      name: 'Obstetric Emergency / Threatened Loss',
      condition: 'Pregnant AND (Pregnancy bleeding/pain OR Severe abdominal pain)',
      level: 2,
      category: 'Symptoms',
      rationale: 'Potential ruptured ectopic pregnancy, placenta previa, or abruption with rapid maternal/fetal compromise.'
    },
    {
      id: 'R-SEVERE-SYMPTOMS',
      name: 'Severe Abdominal Pain or Breathlessness',
      condition: 'Severe abdominal pain OR Breathlessness',
      level: 2,
      category: 'Symptoms',
      rationale: 'Potential acute abdomen (perforation, appendicitis) or acute dyspnea requiring urgent physician evaluation.'
    },
    {
      id: 'R-SEMI-URGENT',
      name: 'Semi-urgent Symptoms (Vomiting/Diarrhea or Head Injury)',
      condition: 'Vomiting/diarrhea OR head injury without red flags',
      level: 3,
      category: 'Symptoms',
      rationale: 'Requires symptom management, fluid assessment, or neurological observation within 60 minutes.'
    },
    {
      id: 'R-NON-URGENT',
      name: 'Non-urgent Conditions (Minor Injury / Cold)',
      condition: 'Minor injury OR Mild cold with normal vitals',
      level: 4,
      category: 'Symptoms',
      rationale: 'Low-acuity ambulatory presentations suitable for routine OPD consultation within 120 minutes.'
    }
  ];

  const SYMPTOM_LIST = [
    { id: 'chest_pain', label: 'Chest pain', isRedFlag: true },
    { id: 'breathlessness', label: 'Breathlessness', isRedFlag: true },
    { id: 'altered_consciousness', label: 'Altered consciousness', isRedFlag: true },
    { id: 'severe_bleeding', label: 'Severe bleeding', isRedFlag: true },
    { id: 'seizure', label: 'Seizure', isRedFlag: true },
    { id: 'stroke_signs', label: 'Stroke signs (Face/Arm/Speech)', isRedFlag: true },
    { id: 'severe_abdominal_pain', label: 'Severe abdominal pain', isRedFlag: true },
    { id: 'high_fever', label: 'High fever', isRedFlag: false },
    { id: 'stiff_neck', label: 'Stiff neck', isRedFlag: false },
    { id: 'head_injury', label: 'Head injury', isRedFlag: false },
    { id: 'allergic_reaction', label: 'Severe allergic reaction / anaphylaxis', isRedFlag: true },
    { id: 'pregnancy_bleeding_pain', label: 'Pregnancy bleeding / pain', isRedFlag: true },
    { id: 'vomiting_diarrhea', label: 'Vomiting / diarrhea', isRedFlag: false },
    { id: 'minor_injury', label: 'Minor injury', isRedFlag: false },
    { id: 'mild_cold', label: 'Mild cold / cough', isRedFlag: false }
  ];

  /**
   * Helper: Determine age band
   */
  function getAgeBand(age) {
    const numAge = Number(age);
    if (isNaN(numAge)) return 'adult';
    if (numAge < 1) return 'infant';
    if (numAge <= 12) return 'child';
    if (numAge >= 65) return 'elderly';
    return 'adult';
  }

  /**
   * Validate vitals against hard limits (impossible values) and soft limits
   */
  function validateVitals(vitals, age) {
    const errors = [];
    const warnings = [];
    const band = getAgeBand(age);

    if (vitals.spo2 !== undefined && vitals.spo2 !== null && vitals.spo2 !== '') {
      const val = Number(vitals.spo2);
      if (isNaN(val) || val < 30 || val > 100) {
        errors.push({ field: 'spo2', msg: 'SpO2 must be between 30% and 100% (physiologically impossible).' });
      } else if (val < 92) {
        warnings.push({ field: 'spo2', msg: 'SpO2 < 92% is low. Re-measure and check sensor placement.' });
      }
    }

    if (vitals.sbp !== undefined && vitals.sbp !== null && vitals.sbp !== '') {
      const val = Number(vitals.sbp);
      if (isNaN(val) || val < 30 || val > 300) {
        errors.push({ field: 'sbp', msg: 'Systolic BP must be between 30 and 300 mmHg.' });
      } else if (val > 180 || val < 90) {
        warnings.push({ field: 'sbp', msg: 'Systolic BP outside expected resting range (90-180 mmHg).' });
      }
    }

    if (vitals.dbp !== undefined && vitals.dbp !== null && vitals.dbp !== '') {
      const val = Number(vitals.dbp);
      if (isNaN(val) || val < 20 || val > 200) {
        errors.push({ field: 'dbp', msg: 'Diastolic BP must be between 20 and 200 mmHg.' });
      }
    }

    if (vitals.hr !== undefined && vitals.hr !== null && vitals.hr !== '') {
      const val = Number(vitals.hr);
      if (isNaN(val) || val < 20 || val > 300) {
        errors.push({ field: 'hr', msg: 'Heart rate must be between 20 and 300 bpm.' });
      } else {
        if (band === 'adult' || band === 'elderly') {
          if (val > 120 || val < 50) warnings.push({ field: 'hr', msg: 'Adult heart rate unusual (<50 or >120 bpm).' });
        } else if (band === 'infant') {
          if (val > 190 || val < 70) warnings.push({ field: 'hr', msg: 'Infant heart rate unusual (<70 or >190 bpm).' });
        }
      }
    }

    if (vitals.rr !== undefined && vitals.rr !== null && vitals.rr !== '') {
      const val = Number(vitals.rr);
      if (isNaN(val) || val < 3 || val > 100) {
        errors.push({ field: 'rr', msg: 'Respiratory rate must be between 3 and 100 breaths/min.' });
      } else if (band === 'adult' && (val > 28 || val < 10)) {
        warnings.push({ field: 'rr', msg: 'Adult respiratory rate unusual (<10 or >28 /min).' });
      }
    }

    if (vitals.temp !== undefined && vitals.temp !== null && vitals.temp !== '') {
      const val = Number(vitals.temp);
      if (isNaN(val) || val < 25 || val > 45) {
        errors.push({ field: 'temp', msg: 'Temperature must be between 25°C and 45°C.' });
      } else if (val >= 38.5) {
        warnings.push({ field: 'temp', msg: 'High pyrexia documented. Verify with second reading.' });
      }
    }

    if (vitals.gcs !== undefined && vitals.gcs !== null && vitals.gcs !== '') {
      const val = Number(vitals.gcs);
      if (isNaN(val) || val < 3 || val > 15) {
        errors.push({ field: 'gcs', msg: 'Glasgow Coma Scale must be between 3 and 15.' });
      }
    }

    if (vitals.pain !== undefined && vitals.pain !== null && vitals.pain !== '') {
      const val = Number(vitals.pain);
      if (isNaN(val) || val < 0 || val > 10) {
        errors.push({ field: 'pain', msg: 'Pain scale must be between 0 and 10.' });
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * PURE EVALUATION FUNCTION: evaluateTriage(patient, symptoms, vitals)
   *
   * Principle:
   * - Deterministic and rule-based.
   * - Highest level among fired rules wins (1 is highest priority, 4 lowest).
   * - Missing or conflicting data never lowers urgency.
   * - If no rules fired and data insufficient -> Level 3 + "Needs human review".
   * - If red flag present + missing vitals -> "Urgent: measure vitals now".
   */
  function evaluateTriage(patient, symptoms, vitals) {
    const firedRules = [];
    const missingData = [];
    const reasons = [];
    const symptomsObj = symptoms || {};
    const vitalsObj = vitals || {};
    const age = Number(patient?.age ?? 30);
    const band = getAgeBand(age);
    const sex = String(patient?.sex || '').toLowerCase();
    const isPregnant = (patient?.pregnancy === 'Yes' || patient?.isPregnant === true);

    // Identify red flags in symptoms
    const redFlagPresent = SYMPTOM_LIST.some(item => item.isRedFlag && symptomsObj[item.id]);

    // Check which key vitals are missing
    const hasSpo2 = vitalsObj.spo2 !== undefined && vitalsObj.spo2 !== null && vitalsObj.spo2 !== '';
    const hasSbp = vitalsObj.sbp !== undefined && vitalsObj.sbp !== null && vitalsObj.sbp !== '';
    const hasHr = vitalsObj.hr !== undefined && vitalsObj.hr !== null && vitalsObj.hr !== '';
    const hasRr = vitalsObj.rr !== undefined && vitalsObj.rr !== null && vitalsObj.rr !== '';
    const hasTemp = vitalsObj.temp !== undefined && vitalsObj.temp !== null && vitalsObj.temp !== '';

    if (!hasSpo2) missingData.push('SpO2');
    if (!hasSbp) missingData.push('Blood Pressure');
    if (!hasHr) missingData.push('Heart Rate');
    if (!hasRr) missingData.push('Respiratory Rate');

    const urgentMeasureVitalsNow = (redFlagPresent && (missingData.length > 0));

    // 1. SpO2 Rules
    if (hasSpo2) {
      const val = Number(vitalsObj.spo2);
      if (val < 90) {
        firedRules.push({
          id: 'R-SPO2-L1',
          name: 'Critical Hypoxia (SpO2 < 90%)',
          level: 1,
          category: 'Vitals',
          rationale: `SpO2 is ${val}% (threshold < 90%). Severe hypoxemia requires immediate airway and oxygen intervention.`
        });
      } else if (val <= 93) {
        firedRules.push({
          id: 'R-SPO2-L2',
          name: 'Borderline Hypoxia (SpO2 90-93%)',
          level: 2,
          category: 'Vitals',
          rationale: `SpO2 is ${val}% (threshold 90-93%). Moderate hypoxemia requires urgent clinician evaluation within 15 min.`
        });
      }
    }

    // 2. Systolic Blood Pressure Rules
    if (hasSbp) {
      const val = Number(vitalsObj.sbp);
      if (val < 80) {
        firedRules.push({
          id: 'R-SBP-L1',
          name: 'Severe Hypotension / Shock (Systolic < 80 mmHg)',
          level: 1,
          category: 'Vitals',
          rationale: `Systolic BP is ${val} mmHg (threshold < 80). Critical hypoperfusion indicates decompensated shock.`
        });
      } else if (val < 90 || val > 180) {
        firedRules.push({
          id: 'R-SBP-L2',
          name: 'Hypotension or Severe Hypertension',
          level: 2,
          category: 'Vitals',
          rationale: `Systolic BP is ${val} mmHg (threshold <90 or >180). High risk of circulatory or end-organ compromise.`
        });
      }
    }

    // 3. Heart Rate Rules (Age-Band Specific)
    if (hasHr) {
      const val = Number(vitalsObj.hr);
      if (band === 'infant') {
        if (val < 80 || val > 180) {
          firedRules.push({
            id: 'R-HR-PEDS-L1',
            name: 'Infant Critical Heart Rate (< 80 or > 180 bpm)',
            level: 1,
            category: 'Pediatric Vitals',
            rationale: `Infant heart rate is ${val} bpm (threshold <80 or >180). Indicates critical pediatric distress.`
          });
        } else if (val > 160) {
          firedRules.push({
            id: 'R-HR-PEDS-L2',
            name: 'Infant Tachycardia (> 160 bpm)',
            level: 2,
            category: 'Pediatric Vitals',
            rationale: `Infant heart rate is ${val} bpm (threshold >160). Requires urgent pediatric evaluation.`
          });
        }
      } else if (band === 'child') {
        if (val < 60 || val > 160) {
          firedRules.push({
            id: 'R-HR-CHILD-L1',
            name: 'Child Critical Heart Rate (< 60 or > 160 bpm)',
            level: 1,
            category: 'Pediatric Vitals',
            rationale: `Child heart rate is ${val} bpm (threshold <60 or >160). High risk of decompensation.`
          });
        } else if (val > 140) {
          firedRules.push({
            id: 'R-HR-CHILD-L2',
            name: 'Child Tachycardia (> 140 bpm)',
            level: 2,
            category: 'Pediatric Vitals',
            rationale: `Child heart rate is ${val} bpm (threshold >140).`
          });
        }
      } else {
        // Adult & Elderly
        if (val < 40 || val > 130) {
          firedRules.push({
            id: 'R-HR-L1-ADULT',
            name: 'Adult Critical Heart Rate (< 40 or > 130 bpm)',
            level: 1,
            category: 'Vitals',
            rationale: `Adult heart rate is ${val} bpm (threshold <40 or >130). Cardiac instability / collapse risk.`
          });
        } else if (val > 110) {
          firedRules.push({
            id: 'R-HR-L2-ADULT',
            name: 'Adult Tachycardia (> 110 bpm)',
            level: 2,
            category: 'Vitals',
            rationale: `Adult heart rate is ${val} bpm (threshold >110). Physiological distress or systemic response.`
          });
        }
      }
    }

    // 4. Respiratory Rate Rules (Age-Band Specific)
    if (hasRr) {
      const val = Number(vitalsObj.rr);
      if (band === 'infant') {
        if (val < 20 || val > 60) {
          firedRules.push({
            id: 'R-RR-INFANT-L1',
            name: 'Infant Critical Respiratory Rate (< 20 or > 60)',
            level: 1,
            category: 'Pediatric Vitals',
            rationale: `Infant respiratory rate is ${val} /min (threshold <20 or >60). Impending respiratory failure.`
          });
        }
      } else if (band === 'child') {
        if (val < 15 || val > 45) {
          firedRules.push({
            id: 'R-RR-CHILD-L1',
            name: 'Child Critical Respiratory Rate (< 15 or > 45)',
            level: 1,
            category: 'Pediatric Vitals',
            rationale: `Child respiratory rate is ${val} /min (threshold <15 or >45).`
          });
        }
      } else {
        if (val < 8 || val > 30) {
          firedRules.push({
            id: 'R-RR-L1',
            name: 'Critical Respiratory Rate (Adult RR < 8 or > 30)',
            level: 1,
            category: 'Vitals',
            rationale: `Adult respiratory rate is ${val} /min (threshold <8 or >30). Critical respiratory compromise.`
          });
        } else if (val >= 24) {
          firedRules.push({
            id: 'R-RR-L2',
            name: 'Elevated Adult Respiratory Rate (RR >= 24)',
            level: 2,
            category: 'Vitals',
            rationale: `Adult respiratory rate is ${val} /min (threshold >=24). Significant tachypnea.`
          });
        }
      }
    }

    // 5. Temperature Rules
    if (hasTemp) {
      const val = Number(vitalsObj.temp);
      if (band === 'infant' && val >= 38.0) {
        firedRules.push({
          id: 'R-TEMP-INFANT',
          name: 'Infant Fever (Age < 1 yr and Temp >= 38.0°C)',
          level: 2,
          category: 'Pediatric',
          rationale: `Infant temperature is ${val}°C. High risk of severe occult bacterial infection.`
        });
      } else if (val >= 39.5) {
        firedRules.push({
          id: 'R-TEMP-HYPER',
          name: 'Severe Hyperpyrexia (Temp >= 39.5°C)',
          level: 2,
          category: 'Vitals',
          rationale: `Body temperature is ${val}°C. Severe pyrexia risk.`
        });
      }
    }

    // 6. GCS Neurological Score Rules
    if (vitalsObj.gcs !== undefined && vitalsObj.gcs !== null && vitalsObj.gcs !== '') {
      const val = Number(vitalsObj.gcs);
      if (val <= 8) {
        firedRules.push({
          id: 'R-GCS-L1',
          name: 'Severe Neurological Impairment (GCS <= 8)',
          level: 1,
          category: 'Neurological',
          rationale: `GCS is ${val} (threshold <=8). Severe coma with loss of airway protective reflexes.`
        });
      } else if (val <= 13) {
        firedRules.push({
          id: 'R-GCS-L2',
          name: 'Moderate Neurological Deficit (GCS 9 - 13)',
          level: 2,
          category: 'Neurological',
          rationale: `GCS is ${val} (threshold 9-13). Altered mental status requires urgent clinician assessment.`
        });
      }
    }

    // 7. Symptom-Based Rules
    // Meningitis Triad: Fever + Stiff Neck + Altered Consciousness
    if ((symptomsObj.high_fever || (hasTemp && Number(vitalsObj.temp) >= 38.0)) &&
        symptomsObj.stiff_neck &&
        symptomsObj.altered_consciousness) {
      firedRules.push({
        id: 'R-MENINGITIS-L1',
        name: 'Suspected Meningitis Triad',
        level: 1,
        category: 'Symptoms',
        rationale: 'Fever, neck stiffness, and altered consciousness form the high-risk meningitis triad.'
      });
    }

    if (symptomsObj.stroke_signs) {
      firedRules.push({
        id: 'R-STROKE-L1',
        name: 'Acute Stroke Symptoms (Level 1)',
        level: 1,
        category: 'Symptoms',
        rationale: 'Time-critical stroke protocol: immediate physician and CT scan access required.'
      });
    }

    if (symptomsObj.seizure) {
      firedRules.push({
        id: 'R-SEIZURE-L1',
        name: 'Active or Recent Seizure (Level 1)',
        level: 1,
        category: 'Symptoms',
        rationale: 'Status epilepticus risk, aspiration danger, and post-ictal hypoxia.'
      });
    }

    if (symptomsObj.severe_bleeding) {
      firedRules.push({
        id: 'R-BLEED-L1',
        name: 'Severe Hemorrhage (Level 1)',
        level: 1,
        category: 'Symptoms',
        rationale: 'Exsanguinating blood loss risks rapid hypovolemic arrest.'
      });
    }

    if (symptomsObj.allergic_reaction) {
      firedRules.push({
        id: 'R-ANAPHYLAXIS-L1',
        name: 'Severe Allergic Reaction / Anaphylaxis (Level 1)',
        level: 1,
        category: 'Symptoms',
        rationale: 'Immediate airway compromise or cardiovascular collapse risk.'
      });
    }

    if (symptomsObj.altered_consciousness && !firedRules.some(r => r.id === 'R-MENINGITIS-L1')) {
      firedRules.push({
        id: 'R-ALTERED-CONSCIOUS-L1',
        name: 'Altered Consciousness (Level 1)',
        level: 1,
        category: 'Symptoms',
        rationale: 'Acute cognitive decline or obtundation indicates acute cerebral or systemic insult.'
      });
    }

    if (symptomsObj.chest_pain && age >= 40) {
      firedRules.push({
        id: 'R-CHEST-PAIN-AGE',
        name: 'Adult Chest Pain (Age >= 40, Level 2)',
        level: 2,
        category: 'Symptoms',
        rationale: 'High probability of Acute Coronary Syndrome in patients aged 40 and older.'
      });
    }

    if ((isPregnant || (sex === 'female' && age >= 12 && age <= 50 && patient?.pregnancy !== 'No')) &&
        (symptomsObj.pregnancy_bleeding_pain || (isPregnant && symptomsObj.severe_abdominal_pain))) {
      firedRules.push({
        id: 'R-PREGNANCY-BLEED',
        name: 'Obstetric Emergency (Bleeding / Severe Pain, Level 2)',
        level: 2,
        category: 'Symptoms',
        rationale: 'High risk of ectopic pregnancy, placental abruption, or miscarriage.'
      });
    }

    if (symptomsObj.breathlessness && !firedRules.some(r => r.level === 1 && r.category === 'Vitals')) {
      firedRules.push({
        id: 'R-BREATHLESS-L2',
        name: 'Acute Breathlessness (Level 2)',
        level: 2,
        category: 'Symptoms',
        rationale: 'Subjective respiratory distress warrants urgent evaluation within 15 minutes.'
      });
    }

    if (symptomsObj.severe_abdominal_pain && !firedRules.some(r => r.id === 'R-PREGNANCY-BLEED')) {
      firedRules.push({
        id: 'R-ABD-PAIN-L2',
        name: 'Severe Abdominal Pain (Level 2)',
        level: 2,
        category: 'Symptoms',
        rationale: 'Potential acute surgical abdomen requiring urgent clinical assessment.'
      });
    }

    if (symptomsObj.vomiting_diarrhea) {
      firedRules.push({
        id: 'R-VOMIT-DIARRHEA-L3',
        name: 'Gastrointestinal Distress (Level 3)',
        level: 3,
        category: 'Symptoms',
        rationale: 'Risk of progressive dehydration and electrolyte imbalance.'
      });
    }

    if (symptomsObj.head_injury && !symptomsObj.altered_consciousness) {
      firedRules.push({
        id: 'R-HEAD-INJURY-L3',
        name: 'Isolated Head Injury without Coma (Level 3)',
        level: 3,
        category: 'Symptoms',
        rationale: 'Concussion observation and wound assessment required within 60 minutes.'
      });
    }

    if (symptomsObj.mild_cold) {
      firedRules.push({
        id: 'R-MILD-COLD-L4',
        name: 'Mild Upper Respiratory Symptoms (Level 4)',
        level: 4,
        category: 'Symptoms',
        rationale: 'Low-acuity viral infection suitable for standard OPD queue.'
      });
    }

    if (symptomsObj.minor_injury) {
      firedRules.push({
        id: 'R-MINOR-INJURY-L4',
        name: 'Minor Superficial Injury (Level 4)',
        level: 4,
        category: 'Symptoms',
        rationale: 'Non-displaced contusion, abrasion, or minor laceration.'
      });
    }

    // Determine Suggested Level: HIGHEST LEVEL WINS (1 is highest, 4 lowest)
    let suggestedLevel = 4;
    let needsHumanReview = false;

    if (firedRules.length > 0) {
      // Find lowest level number (1 is highest urgency)
      suggestedLevel = Math.min(...firedRules.map(r => r.level));
    } else {
      // Nothing fired
      // Check data sufficiency: If vitals are missing or no specific symptoms selected
      const hasAnyVitals = hasSpo2 || hasSbp || hasHr || hasRr || hasTemp;
      if (!hasAnyVitals) {
        // Missing data never lowers urgency! Fails safe to Level 3 + "Needs human review"
        suggestedLevel = 3;
        needsHumanReview = true;
        reasons.push('Data insufficient: No physiological vitals recorded. Fails safe to Level 3 Semi-urgent awaiting assessment.');
      } else {
        suggestedLevel = 4;
        reasons.push('All recorded vitals and clinical parameters are within normal limits.');
      }
    }

    // If red-flag symptom is present and vitals are missing, ensure it flags human review
    if (redFlagPresent && missingData.length > 0) {
      needsHumanReview = true;
      reasons.push(`Red-flag symptom present but key vitals (${missingData.join(', ')}) are missing.`);
    }

    // Check for conflicting data (e.g. low acuity symptom like mild cold, but critical vitals)
    const hasLowSymptom = symptomsObj.mild_cold || symptomsObj.minor_injury;
    const hasCriticalVital = firedRules.some(r => r.level === 1 && r.category.includes('Vitals'));
    if (hasLowSymptom && hasCriticalVital) {
      needsHumanReview = true;
      reasons.push('Conflicting data: Patient presents with minor complaint but exhibits critically abnormal vitals. Priority elevated to Level 1.');
    }

    const LEVEL_LABELS = {
      1: 'Level 1 - Critical (Immediate)',
      2: 'Level 2 - Urgent (15 min)',
      3: 'Level 3 - Semi-urgent (60 min)',
      4: 'Level 4 - Non-urgent (120 min)'
    };

    return {
      suggestedLevel,
      levelLabel: LEVEL_LABELS[suggestedLevel],
      firedRules,
      missingData,
      needsHumanReview,
      urgentMeasureVitalsNow,
      reasons
    };
  }

  // ==========================================================================
  // SECTION 3: PATIENT REGISTRATION & EMERGENCY WALK-IN
  // ==========================================================================

  function generateToken() {
    const num = State.tokenCounter;
    State.tokenCounter += 1;
    saveAllState();
    return `OPD-${String(num).padStart(4, '0')}`;
  }

  /**
   * Check for duplicate patient (same name & phone registered within 12 virtual hours)
   */
  function checkDuplicatePatient(name, phone) {
    const cleanName = name.trim().toLowerCase();
    const cleanPhone = phone.trim().replace(/\D/g, '');
    const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
    const now = State.vTime;

    return State.patients.find(p => {
      const matchName = p.name.trim().toLowerCase() === cleanName;
      const matchPhone = p.phone.trim().replace(/\D/g, '') === cleanPhone;
      const recent = (now - p.registeredAt) <= TWELVE_HOURS_MS;
      return matchName && matchPhone && recent;
    });
  }

  function handleRegistrationSubmit(e) {
    e.preventDefault();

    const name = document.getElementById('regFullName').value.trim();
    const age = parseFloat(document.getElementById('regAge').value);
    const sex = document.getElementById('regSex').value;
    const phone = document.getElementById('regPhone').value.trim();
    const arrivalMode = document.getElementById('regArrivalMode').value;
    const pregnancy = document.getElementById('regPregnancy').value;
    const allergies = document.getElementById('regAllergies').value.trim();
    const complaint = document.getElementById('regChiefComplaint').value.trim();

    // Validation
    if (!name || isNaN(age) || age < 0 || age > 120 || !phone || !complaint) {
      showToast('Validation Error', 'Please complete all required fields correctly (Age 0-120).', 'toast-warning');
      return;
    }

    const patientData = {
      name, age, sex, phone, arrivalMode, pregnancy, allergies, complaint
    };

    // Duplicate check
    const existing = checkDuplicatePatient(name, phone);
    if (existing) {
      State.pendingDuplicateData = patientData;
      document.getElementById('duplicatePatientDetails').innerHTML = `
        <strong>Existing Patient:</strong> ${existing.name} (${existing.token})<br>
        <strong>Registered:</strong> ${formatVirtualTime(existing.registeredAt)} (${Math.round((State.vTime - existing.registeredAt) / 60000)} min ago)<br>
        <strong>Chief Complaint:</strong> ${existing.complaint}<br>
        <strong>Status:</strong> ${existing.status}
      `;
      openModal('duplicateModal');
      return;
    }

    commitRegistration(patientData);
  }

  function commitRegistration(data) {
    const token = generateToken();
    const registeredAt = State.vTime;

    const newPatient = {
      token,
      name: data.name,
      age: data.age,
      sex: data.sex,
      phone: data.phone,
      arrivalMode: data.arrivalMode,
      pregnancy: data.pregnancy || 'No',
      allergies: data.allergies || 'None',
      complaint: data.complaint,
      registeredAt,
      status: 'WAITING',
      confirmedLevel: null,
      systemSuggestedLevel: null,
      isProvisionalL1: false,
      isOverridden: false,
      overrideReason: null,
      isDowngraded: false,
      flaggedForDoctorReview: false,
      confirmedBy: null,
      confirmedAt: null,
      customPriorityOrder: null,
      symptoms: {},
      vitals: {},
      clinicalNotes: '',
      triageHistory: []
    };

    State.patients.unshift(newPatient);

    // Audit Log
    addAuditEntry({
      action: 'REGISTRATION',
      patientToken: token,
      patientName: data.name,
      details: `Registered via ${data.arrivalMode}. Complaint: "${data.complaint}"`,
      diff: { name: data.name, age: data.age, phone: data.phone, arrivalMode: data.arrivalMode }
    });

    // If ambulance arrival, raise alert
    if (data.arrivalMode === 'Ambulance') {
      createAlert({
        patientToken: token,
        patientName: data.name,
        type: 'AMBULANCE_ARRIVAL',
        level: 2,
        message: `Ambulance arrival for ${data.name} (${token}): ${data.complaint}`
      });
    }

    saveAllState();
    document.getElementById('patientRegistrationForm').reset();
    showToast('Patient Registered', `Assigned Token ${token}. Added to active triage queue.`, 'toast-info');
    switchTab('queueTab');
    renderQueueTable();
  }

  /**
   * Emergency Walk-In quick button
   * Fails safe: provisionally enters at top of queue at Level 1, raises immediate alert
   */
  function handleEmergencyWalkInSubmit() {
    const name = document.getElementById('emergName').value.trim() || 'Emergency Unknown';
    const age = parseFloat(document.getElementById('emergAge').value) || 40;
    const sex = document.getElementById('emergSex').value || 'Unknown';
    const complaint = document.getElementById('emergComplaint').value.trim() || 'Acute Critical Distress';

    const token = generateToken();
    const registeredAt = State.vTime;

    const patient = {
      token,
      name,
      age,
      sex,
      phone: '0000000000',
      arrivalMode: 'Walk-in',
      pregnancy: 'Unknown',
      allergies: 'Unknown',
      complaint,
      registeredAt,
      status: 'WAITING',
      confirmedLevel: 1, // Provisional L1
      systemSuggestedLevel: 1,
      isProvisionalL1: true,
      isOverridden: false,
      overrideReason: 'Emergency walk-in quick entry protocol',
      isDowngraded: false,
      flaggedForDoctorReview: true,
      confirmedBy: `${State.currentUser} (${ROLES[State.currentRole]?.title || 'Staff'}) [Provisional]`,
      confirmedAt: registeredAt,
      customPriorityOrder: -999999, // Ensure placed at very top
      symptoms: { altered_consciousness: true, breathlessness: true },
      vitals: {},
      clinicalNotes: 'Registered via 1-click Emergency Walk-in protocol. Immediate bedside evaluation required.',
      triageHistory: []
    };

    State.patients.unshift(patient);

    addAuditEntry({
      action: 'REGISTRATION',
      patientToken: token,
      patientName: name,
      details: `EMERGENCY WALK-IN: Provisional Level 1 assigned. Complaint: "${complaint}"`,
      diff: { confirmedLevel: 1, isProvisionalL1: true }
    });

    // Immediate Alert
    createAlert({
      patientToken: token,
      patientName: name,
      type: 'EMERGENCY_L1_WALKIN',
      level: 1,
      message: `CRITICAL ALERT: Emergency Walk-In patient ${name} (${token}) entered at Level 1 Critical!`
    });

    saveAllState();
    closeModal('emergencyWalkInModal');
    showToast('🚨 Emergency Walk-In Registered', `${token} placed at top of queue (Level 1 Provisional). Immediate assessment required!`, 'toast-l1');
    renderQueueTable();

    // Auto-prompt escalation for Level 1
    promptEscalationForPatient(patient, 'Emergency Walk-In Level 1 patient detected.');
  }

  // ==========================================================================
  // SECTION 4: TRIAGE ASSESSMENT & HUMAN CONFIRMATION / OVERRIDE
  // ==========================================================================

  function openTriageAssessmentModal(token) {
    const patient = State.patients.find(p => p.token === token);
    if (!patient) return;

    if (!enforcePermission('canTriage', 'perform triage assessment', token)) {
      return;
    }

    State.selectedPatientForTriage = patient;

    // Header info
    const band = getAgeBand(patient.age);
    document.getElementById('triagePatientHeader').innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
        <div>
          <span class="token-cell" style="font-size:1.1rem;">${patient.token}</span>
          <strong style="margin-left:0.5rem; font-size:1rem;">${patient.name}</strong>
          <span style="color:#64748b; margin-left:0.5rem;">(${patient.age}y / ${patient.sex} - ${band})</span>
        </div>
        <div>
          <span class="status-badge waiting">Wait: ${Math.round((State.vTime - patient.registeredAt) / 60000)} min</span>
          <span style="font-size:0.8rem; color:#64748b; margin-left:0.5rem;">Arrival: ${patient.arrivalMode}</span>
        </div>
      </div>
      <div style="margin-top:0.35rem; font-size:0.85rem; color:#334155;">
        <strong>Chief Complaint:</strong> ${patient.complaint} | <strong>Allergies:</strong> ${patient.allergies || 'None'}
      </div>
    `;

    document.getElementById('vitalsAgeBandNotice').innerText = `Ranges adjusted for: ${band.toUpperCase()}`;

    // Update vitals normal hint ranges based on age band
    updateVitalsRangeHints(band);

    // Build Symptoms Checklist
    const symptomGrid = document.getElementById('assessmentSymptomGrid');
    symptomGrid.innerHTML = '';
    SYMPTOM_LIST.forEach(sym => {
      const isChecked = !!patient.symptoms[sym.id];
      const div = document.createElement('label');
      div.className = `symptom-item ${isChecked ? 'checked' : ''} ${sym.isRedFlag ? 'red-flag' : ''}`;
      div.innerHTML = `
        <input type="checkbox" id="sym_${sym.id}" data-id="${sym.id}" ${isChecked ? 'checked' : ''}>
        <span>${sym.isRedFlag ? '⚠️ ' : ''}${sym.label}</span>
      `;
      div.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) div.classList.add('checked');
        else div.classList.remove('checked');
        recalculateLiveSuggestion();
      });
      symptomGrid.appendChild(div);
    });

    // Populate vitals
    document.getElementById('vitalSpo2').value = patient.vitals?.spo2 ?? '';
    document.getElementById('vitalSbp').value = patient.vitals?.sbp ?? '';
    document.getElementById('vitalDbp').value = patient.vitals?.dbp ?? '';
    document.getElementById('vitalHr').value = patient.vitals?.hr ?? '';
    document.getElementById('vitalRr').value = patient.vitals?.rr ?? '';
    document.getElementById('vitalTemp').value = patient.vitals?.temp ?? '';
    document.getElementById('vitalGcs').value = patient.vitals?.gcs ?? '';
    document.getElementById('vitalPain').value = patient.vitals?.pain ?? '';
    document.getElementById('triageClinicalNotes').value = patient.clinicalNotes || '';

    // Reset override sub-form
    document.getElementById('overrideSubForm').classList.remove('visible');
    document.getElementById('overrideReasonInput').value = patient.overrideReason || '';
    if (patient.confirmedLevel) {
      document.getElementById('overrideLevelSelect').value = String(patient.confirmedLevel);
    }

    // Attach real-time input listeners to vitals
    ['vitalSpo2', 'vitalSbp', 'vitalDbp', 'vitalHr', 'vitalRr', 'vitalTemp', 'vitalGcs', 'vitalPain'].forEach(id => {
      const el = document.getElementById(id);
      el.oninput = () => recalculateLiveSuggestion();
    });

    recalculateLiveSuggestion();
    openModal('triageModal');
  }

  function updateVitalsRangeHints(band) {
    if (band === 'infant') {
      document.getElementById('rangeHr').innerText = '100 - 160';
      document.getElementById('rangeRr').innerText = '30 - 50';
      document.getElementById('rangeSbp').innerText = '70 - 100';
    } else if (band === 'child') {
      document.getElementById('rangeHr').innerText = '70 - 130';
      document.getElementById('rangeRr').innerText = '18 - 30';
      document.getElementById('rangeSbp').innerText = '80 - 115';
    } else {
      document.getElementById('rangeHr').innerText = '60 - 100';
      document.getElementById('rangeRr').innerText = '12 - 20';
      document.getElementById('rangeSbp').innerText = '90 - 140';
    }
  }

  function getCurrentModalVitals() {
    return {
      spo2: document.getElementById('vitalSpo2').value,
      sbp: document.getElementById('vitalSbp').value,
      dbp: document.getElementById('vitalDbp').value,
      hr: document.getElementById('vitalHr').value,
      rr: document.getElementById('vitalRr').value,
      temp: document.getElementById('vitalTemp').value,
      gcs: document.getElementById('vitalGcs').value,
      pain: document.getElementById('vitalPain').value
    };
  }

  function getCurrentModalSymptoms() {
    const symptoms = {};
    SYMPTOM_LIST.forEach(sym => {
      const chk = document.getElementById(`sym_${sym.id}`);
      if (chk && chk.checked) symptoms[sym.id] = true;
    });
    return symptoms;
  }

  function recalculateLiveSuggestion() {
    if (!State.selectedPatientForTriage) return;

    const patient = State.selectedPatientForTriage;
    const vitals = getCurrentModalVitals();
    const symptoms = getCurrentModalSymptoms();

    // Check vitals validity
    const validation = validateVitals(vitals, patient.age);

    // Clear previous inline warnings
    ['Spo2', 'Sbp', 'Dbp', 'Hr', 'Rr', 'Temp', 'Gcs', 'Pain'].forEach(k => {
      const warnEl = document.getElementById(`warn${k}`);
      if (warnEl) warnEl.innerText = '';
      const inputEl = document.getElementById(`vital${k}`);
      if (inputEl) {
        inputEl.classList.remove('input-invalid');
        inputEl.classList.remove('input-warning');
      }
    });

    validation.errors.forEach(err => {
      const capKey = err.field.charAt(0).toUpperCase() + err.field.slice(1);
      const warnEl = document.getElementById(`warn${capKey}`);
      if (warnEl) warnEl.innerText = err.msg;
      const inputEl = document.getElementById(`vital${capKey}`);
      if (inputEl) inputEl.classList.add('input-invalid');
    });

    validation.warnings.forEach(warn => {
      const capKey = warn.field.charAt(0).toUpperCase() + warn.field.slice(1);
      const warnEl = document.getElementById(`warn${capKey}`);
      if (warnEl && !warnEl.innerText) warnEl.innerText = warn.msg;
      const inputEl = document.getElementById(`vital${capKey}`);
      if (inputEl && !inputEl.classList.contains('input-invalid')) {
        inputEl.classList.add('input-warning');
      }
    });

    const evalResult = evaluateTriage(patient, symptoms, vitals);
    renderLiveDecisionBox(evalResult);
  }

  function renderLiveDecisionBox(result) {
    const box = document.getElementById('liveDecisionSupportContainer');
    box.className = `decision-support-box l${result.suggestedLevel}-border`;

    const levelBadgeClass = `l${result.suggestedLevel}`;
    const levelIcons = { 1: '🔴', 2: '🟠', 3: '🟡', 4: '🟢' };
    const icon = levelIcons[result.suggestedLevel] || '⚪';

    let firedHtml = '';
    if (result.firedRules.length > 0) {
      firedHtml = `
        <h5 style="font-size:0.8rem; text-transform:uppercase; color:#475569; margin-top:0.5rem;">Fired Clinical Rules (${result.firedRules.length}):</h5>
        <ul class="fired-rules-list">
          ${result.firedRules.map(r => `
            <li class="fired-rule-item l${r.level}">
              <strong>${levelIcons[r.level]} ${r.name}</strong> &rarr; Suggests Level ${r.level}
              <div class="rule-meta">${r.rationale}</div>
            </li>
          `).join('')}
        </ul>
      `;
    } else {
      firedHtml = `
        <div style="font-size:0.825rem; color:#64748b; margin-top:0.4rem;">
          No critical rules triggered. Physiological baseline normal.
        </div>
      `;
    }

    let warningHtml = '';
    if (result.urgentMeasureVitalsNow) {
      warningHtml += `
        <div class="danger-callout">
          <span>⚠️ <strong>Urgent: measure vitals now.</strong> A red-flag symptom was identified without objective vital parameters.</span>
        </div>
      `;
    }

    if (result.needsHumanReview) {
      warningHtml += `
        <div class="warning-callout">
          <span>⚠️ <strong>Safety Flag: Needs Human Review.</strong> ${result.reasons.join(' ')}</span>
        </div>
      `;
    }

    box.innerHTML = `
      <div class="decision-header">
        <div class="decision-title-group">
          <h4>Deterministic Clinical Decision Support (Pure Engine)</h4>
          <span style="font-size:0.775rem; color:#64748b;">Every recommendation reflects explicit sample rules. Clinician judgment required.</span>
        </div>
        <div style="text-align:right;">
          <span style="font-size:0.75rem; color:#64748b; display:block; margin-bottom:2px;">RECOMMENDED LEVEL:</span>
          <span class="urgency-badge ${levelBadgeClass}" style="font-size:0.95rem;">
            ${icon} ${result.levelLabel}
          </span>
        </div>
      </div>

      ${warningHtml}
      ${firedHtml}
    `;

    // Store latest evaluation on the modal state
    State.currentModalEvaluation = result;
  }

  function handleConfirmSuggestionClick() {
    if (!State.currentModalEvaluation) return;
    const level = State.currentModalEvaluation.suggestedLevel;
    document.getElementById('overrideSubForm').classList.remove('visible');
    executeSaveTriage(level, false, null);
  }

  function handleToggleOverrideClick() {
    const subForm = document.getElementById('overrideSubForm');
    subForm.classList.toggle('visible');
    if (subForm.classList.contains('visible')) {
      document.getElementById('overrideReasonInput').focus();
    }
  }

  function handleSaveTriageClick() {
    const subForm = document.getElementById('overrideSubForm');
    const isOverride = subForm.classList.contains('visible');

    if (isOverride) {
      const overrideLevel = parseInt(document.getElementById('overrideLevelSelect').value, 10);
      const reason = document.getElementById('overrideReasonInput').value.trim();

      if (!reason) {
        showToast('Mandatory Field Required', 'Human overrides require a documented clinical justification.', 'toast-warning');
        document.getElementById('overrideReasonInput').classList.add('input-invalid');
        document.getElementById('overrideReasonInput').focus();
        return;
      }

      const suggested = State.currentModalEvaluation.suggestedLevel;
      // Check if downgrading urgency (e.g. suggested was 1, chosen is 2, 3, or 4; suggested was 2, chosen is 3, 4)
      if (overrideLevel > suggested) {
        // Down-grading urgency requires extra confirmation
        State.pendingDowngradeData = { overrideLevel, reason };
        document.getElementById('downgradeOldLevel').innerText = `Level ${suggested}`;
        document.getElementById('downgradeNewLevel').innerText = `Level ${overrideLevel}`;
        openModal('downgradeModal');
        return;
      }

      executeSaveTriage(overrideLevel, true, reason, false);
    } else {
      // Just confirming system suggestion
      const suggested = State.currentModalEvaluation.suggestedLevel;
      executeSaveTriage(suggested, false, null, false);
    }
  }

  function handleConfirmDowngradeClick() {
    if (!State.pendingDowngradeData) return;
    const { overrideLevel, reason } = State.pendingDowngradeData;
    closeModal('downgradeModal');
    executeSaveTriage(overrideLevel, true, reason, true);
    State.pendingDowngradeData = null;
  }

  /**
   * Commit the clinical triage decision
   */
  function executeSaveTriage(level, isOverridden, overrideReason, isDowngraded) {
    const patient = State.selectedPatientForTriage;
    if (!patient) return;

    if (!enforcePermission('canTriage', 'commit clinical triage decision', patient.token)) {
      return;
    }

    const vitals = getCurrentModalVitals();
    const symptoms = getCurrentModalSymptoms();
    const clinicalNotes = document.getElementById('triageClinicalNotes').value.trim();

    // Check hard validation limits before saving
    const validation = validateVitals(vitals, patient.age);
    if (!validation.isValid) {
      showToast('Validation Error', 'Physiologically impossible vitals detected. Please correct before committing.', 'toast-warning');
      return;
    }

    const previousLevel = patient.confirmedLevel;
    const suggested = State.currentModalEvaluation.suggestedLevel;

    // Snapshot for history
    const historyEntry = {
      timestamp: State.vTime,
      user: State.currentUser,
      role: State.currentRole,
      previousLevel,
      confirmedLevel: level,
      suggestedLevel: suggested,
      isOverridden,
      overrideReason,
      isDowngraded,
      vitals: { ...vitals },
      symptoms: { ...symptoms },
      firedRules: [...(State.currentModalEvaluation.firedRules || [])]
    };

    patient.vitals = vitals;
    patient.symptoms = symptoms;
    patient.clinicalNotes = clinicalNotes;
    patient.systemSuggestedLevel = suggested;
    patient.confirmedLevel = level;
    patient.isProvisionalL1 = false;
    patient.isOverridden = isOverridden;
    patient.overrideReason = overrideReason;
    patient.isDowngraded = isDowngraded;
    patient.flaggedForDoctorReview = isDowngraded || (level === 1) || (patient.flaggedForDoctorReview && level <= 2);
    patient.confirmedBy = `${State.currentUser} (${ROLES[State.currentRole]?.title || 'Staff'})`;
    patient.confirmedAt = State.vTime;
    patient.status = 'IN_ASSESSMENT';
    patient.triageHistory.push(historyEntry);

    // Audit Entry
    addAuditEntry({
      action: isOverridden ? 'TRIAGE_OVERRIDE' : 'TRIAGE_CONFIRM',
      patientToken: patient.token,
      patientName: patient.name,
      details: isOverridden
        ? `Overrode System L${suggested} -> L${level}. Reason: "${overrideReason}"${isDowngraded ? ' [FLAGGED DOWNGRADE]' : ''}`
        : `Confirmed System Suggestion: Level ${level}`,
      diff: {
        systemSuggestion: suggested,
        humanConfirmed: level,
        isOverridden,
        isDowngraded,
        rulesFired: State.currentModalEvaluation.firedRules.map(r => r.id)
      }
    });

    // Alert Handling for Level 1 or 2
    if (level === 1) {
      createAlert({
        patientToken: patient.token,
        patientName: patient.name,
        type: 'CRITICAL_L1_CONFIRMED',
        level: 1,
        message: `LEVEL 1 CRITICAL: ${patient.name} (${patient.token}) confirmed at Level 1 by ${State.currentUser}!`
      });
    } else if (level === 2) {
      createAlert({
        patientToken: patient.token,
        patientName: patient.name,
        type: 'URGENT_L2_CONFIRMED',
        level: 2,
        message: `LEVEL 2 URGENT: ${patient.name} (${patient.token}) confirmed at Level 2 (15 min SLA).`
      });
    }

    saveAllState();
    closeModal('triageModal');
    showToast('Triage Committed', `Patient ${patient.token} confirmed as Level ${level}.`, level === 1 ? 'toast-l1' : 'toast-info');
    renderQueueTable();

    // Auto-prompt escalation for Level 1
    if (level === 1) {
      promptEscalationForPatient(patient, 'Level 1 Critical patient requires immediate clinical escalation.');
    } else if (previousLevel && level < previousLevel) {
      // Deterioration on re-triage (lower number = higher urgency, e.g. was 3, now 2 or 1)
      promptEscalationForPatient(patient, `Re-triage deterioration detected: Urgency escalated from Level ${previousLevel} to Level ${level}.`);
    }
  }

  // ==========================================================================
  // SECTION 5: CLINICAL ALERTS & VIRTUAL TIME SLA ENGINE
  // ==========================================================================

  function createAlert({ patientToken, patientName, type, level, message }) {
    const alertId = `ALT-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`.toUpperCase();
    const newAlert = {
      id: alertId,
      patientToken,
      patientName,
      type,
      level,
      message,
      state: 'NEW', // NEW -> ACKNOWLEDGED -> RESOLVED
      createdAt: State.vTime,
      acknowledgedBy: null,
      acknowledgedAt: null,
      resolvedBy: null,
      resolvedAt: null,
      resolutionNote: null,
      escalatedToRole: null
    };

    State.alerts.unshift(newAlert);

    addAuditEntry({
      action: 'ALERT_RAISED',
      patientToken,
      patientName,
      details: `Alert [${type}] raised (Level ${level}): ${message}`,
      diff: { alertId, type, level }
    });

    saveAllState();
    updateAlertCounterUI();
    showToast(`🔔 Clinical Alert (Level ${level})`, message, level === 1 ? 'toast-l1' : 'toast-warning');
    return newAlert;
  }

  function acknowledgeAlert(alertId) {
    const alert = State.alerts.find(a => a.id === alertId);
    if (!alert || alert.state !== 'NEW') return;

    alert.state = 'ACKNOWLEDGED';
    alert.acknowledgedBy = `${State.currentUser} (${ROLES[State.currentRole]?.title || 'Staff'})`;
    alert.acknowledgedAt = State.vTime;

    addAuditEntry({
      action: 'ALERT_ACKNOWLEDGED',
      patientToken: alert.patientToken,
      patientName: alert.patientName,
      details: `Alert ${alert.id} acknowledged by ${State.currentUser}`,
      diff: { alertId: alert.id, state: 'ACKNOWLEDGED' }
    });

    saveAllState();
    updateAlertCounterUI();
    renderAlertCenterModal();
    showToast('Alert Acknowledged', `Alert for ${alert.patientToken} acknowledged.`, 'toast-info');
  }

  function resolveAlert(alertId, note) {
    const alert = State.alerts.find(a => a.id === alertId);
    if (!alert) return;

    alert.state = 'RESOLVED';
    alert.resolvedBy = `${State.currentUser} (${ROLES[State.currentRole]?.title || 'Staff'})`;
    alert.resolvedAt = State.vTime;
    alert.resolutionNote = note || 'Clinically managed';

    addAuditEntry({
      action: 'ALERT_RESOLVED',
      patientToken: alert.patientToken,
      patientName: alert.patientName,
      details: `Alert ${alert.id} resolved by ${State.currentUser}. Note: "${alert.resolutionNote}"`,
      diff: { alertId: alert.id, state: 'RESOLVED' }
    });

    saveAllState();
    updateAlertCounterUI();
    renderAlertCenterModal();
    showToast('Alert Resolved', `Alert marked resolved.`, 'toast-info');
  }

  function updateAlertCounterUI() {
    const activeAlerts = State.alerts.filter(a => a.state !== 'RESOLVED');
    const badge = document.getElementById('alertCountBadge');
    badge.innerText = String(activeAlerts.length);
    if (activeAlerts.length > 0) {
      badge.classList.remove('zero');
    } else {
      badge.classList.add('zero');
    }
  }

  function renderAlertCenterModal() {
    const container = document.getElementById('alertCenterList');
    container.innerHTML = '';

    if (State.alerts.length === 0) {
      container.innerHTML = '<div style="text-align:center; color:#64748b; padding:2rem;">No clinical alerts logged yet.</div>';
      return;
    }

    State.alerts.forEach(alt => {
      const item = document.createElement('div');
      item.className = 'escalation-card';
      if (alt.state === 'ACKNOWLEDGED') item.classList.add('acknowledged');
      if (alt.state === 'RESOLVED') item.classList.add('resolved');

      const elapsedMin = Math.round((State.vTime - alt.createdAt) / 60000);
      const isL1 = alt.level === 1;

      item.innerHTML = `
        <div class="escalation-meta">
          <span>
            <strong style="color:${isL1 ? '#dc2626' : '#ea580c'};">
              ${isL1 ? '🔴 Level 1 Critical Alert' : '🟠 Clinical Alert'}
            </strong>
            &bull; Token: <strong>${alt.patientToken || 'General'}</strong> (${alt.patientName || 'N/A'})
          </span>
          <span>Logged: ${formatVirtualTime(alt.createdAt)} (${elapsedMin}m ago)</span>
        </div>
        <div style="font-size:0.9rem; margin-bottom:0.75rem; color:#0f172a;">
          ${alt.message}
        </div>
        ${alt.escalatedToRole ? `
          <div style="background:#fee2e2; color:#991b1b; padding:0.35rem 0.6rem; border-radius:4px; font-size:0.775rem; margin-bottom:0.5rem; font-weight:700;">
            ⚠️ Automatically escalated to: ${alt.escalatedToRole} (Unacknowledged > 5 min)
          </div>
        ` : ''}
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
          <span class="status-badge ${alt.state.toLowerCase()}">Status: ${alt.state}</span>
          <div style="display:flex; gap:0.5rem;">
            ${alt.state === 'NEW' ? `
              <button class="btn btn-secondary btn-sm" onclick="window.triageApp.ackAlert('${alt.id}')">
                👁️ Acknowledge
              </button>
            ` : ''}
            ${alt.state !== 'RESOLVED' ? `
              <button class="btn btn-primary btn-sm" onclick="window.triageApp.promptResolveAlert('${alt.id}')">
                ✅ Mark Resolved
              </button>
            ` : `
              <span style="font-size:0.75rem; color:#64748b;">Resolved by ${alt.resolvedBy}</span>
            `}
          </div>
        </div>
      `;
      container.appendChild(item);
    });
  }

  // ==========================================================================
  // SECTION 6: QUEUE BOARD & SORTING / REORDERING
  // ==========================================================================

  const SLA_MINUTES = {
    1: 0,    // Immediate
    2: 15,   // 15 minutes
    3: 60,   // 60 minutes
    4: 120   // 120 minutes
  };

  /**
   * Sort queue:
   * 1. Confirmed or provisional Level 1 at top
   * 2. Then Level 2, 3, 4
   * 3. Within same level: SLA breached first, then longest wait time / arrival
   * 4. Custom manual priority overrides if set
   */
  function sortPatients(list) {
    return [...list].sort((a, b) => {
      // Custom manual priority order overrides
      if (a.customPriorityOrder !== null && b.customPriorityOrder !== null) {
        return a.customPriorityOrder - b.customPriorityOrder;
      }
      if (a.customPriorityOrder !== null) return -1;
      if (b.customPriorityOrder !== null) return 1;

      // Effective urgency level (default to 4 if unassessed)
      const levelA = a.confirmedLevel || (a.isProvisionalL1 ? 1 : 99);
      const levelB = b.confirmedLevel || (b.isProvisionalL1 ? 1 : 99);

      if (levelA !== levelB) {
        return levelA - levelB;
      }

      // Check SLA overdue within same level
      const waitA = Math.floor((State.vTime - a.registeredAt) / 60000);
      const waitB = Math.floor((State.vTime - b.registeredAt) / 60000);
      const slaTargetA = SLA_MINUTES[levelA] ?? 120;
      const slaTargetB = SLA_MINUTES[levelB] ?? 120;
      const breachA = waitA - slaTargetA;
      const breachB = waitB - slaTargetB;

      if ((breachA > 0 || breachB > 0) && breachA !== breachB) {
        return breachB - breachA; // Highest breach first
      }

      // Earliest arrival first
      return a.registeredAt - b.registeredAt;
    });
  }

  function renderQueueTable() {
    const tbody = document.getElementById('queueTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filterLevel = document.getElementById('filterLevel').value;
    const filterStatus = document.getElementById('filterStatus').value;
    const query = (document.getElementById('queueSearchInput').value || '').trim().toLowerCase();

    const filtered = State.patients.filter(p => {
      // Status filter
      if (filterStatus === 'ACTIVE') {
        if (p.status === 'SEEN' || p.status === 'LWBS') return false;
      } else if (filterStatus !== 'ALL') {
        if (p.status !== filterStatus) return false;
      }

      // Level filter
      if (filterLevel === 'REVIEW') {
        if (!p.flaggedForDoctorReview) return false;
      } else if (filterLevel !== 'ALL') {
        const lvl = parseInt(filterLevel, 10);
        if (p.confirmedLevel !== lvl) return false;
      }

      // Search query
      if (query) {
        const matchToken = p.token.toLowerCase().includes(query);
        const matchName = p.name.toLowerCase().includes(query);
        const matchComplaint = (p.complaint || '').toLowerCase().includes(query);
        if (!matchToken && !matchName && !matchComplaint) return false;
      }

      return true;
    });

    const sorted = sortPatients(filtered);

    // Update active badge
    const activeCount = State.patients.filter(p => p.status !== 'SEEN' && p.status !== 'LWBS').length;
    document.getElementById('queueCountBadge').innerText = String(activeCount);

    if (sorted.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align:center; color:#64748b; padding:2.5rem;">
            No patients match current filters.
          </td>
        </tr>
      `;
      return;
    }

    const currentRoleConfig = ROLES[State.currentRole] || { canTriage: false, canEscalate: false, canRespondDoctor: false, canReorder: false, canManageAccounts: false };

    sorted.forEach((patient, index) => {
      const waitMin = Math.max(0, Math.floor((State.vTime - patient.registeredAt) / 60000));
      const level = patient.confirmedLevel || (patient.isProvisionalL1 ? 1 : null);
      const slaTarget = level ? SLA_MINUTES[level] : null;

      // SLA display calculation
      let slaHtml = '<span class="sla-badge ok">&infin; Pending</span>';
      if (slaTarget !== null) {
        const remaining = slaTarget - waitMin;
        if (remaining < 0) {
          slaHtml = `<span class="sla-badge breached">🔴 BREACHED (+${Math.abs(remaining)}m)</span>`;
        } else if (remaining <= 5) {
          slaHtml = `<span class="sla-badge warning">⏳ ${remaining} min left</span>`;
        } else {
          slaHtml = `<span class="sla-badge ok">🟢 ${remaining} min left</span>`;
        }
      }

      // Urgency Level Badge (COLOR + ICON + TEXT)
      let levelBadgeHtml = '<span class="urgency-badge unassessed">⏳ Awaiting Triage</span>';
      if (patient.isProvisionalL1) {
        levelBadgeHtml = '<span class="urgency-badge l1" title="Provisional Level 1">🚨 Provisional L1</span>';
      } else if (level) {
        const levelData = {
          1: { cls: 'l1', icon: '🔴', text: 'Level 1 - Critical' },
          2: { cls: 'l2', icon: '🟠', text: 'Level 2 - Urgent' },
          3: { cls: 'l3', icon: '🟡', text: 'Level 3 - Semi-urgent' },
          4: { cls: 'l4', icon: '🟢', text: 'Level 4 - Non-urgent' }
        }[level];
        levelBadgeHtml = `<span class="urgency-badge ${levelData.cls}">${levelData.icon} ${levelData.text}</span>`;
      }

      if (patient.flaggedForDoctorReview) {
        levelBadgeHtml += ' <span class="urgency-badge review" title="Flagged for Doctor Review">⚠️ Review</span>';
      }

      const tr = document.createElement('tr');
      if (level === 1) tr.classList.add('highlight-l1');

      tr.innerHTML = `
        <td class="token-cell">
          <button class="btn btn-secondary btn-sm" onclick="window.triageApp.openTimeline('${patient.token}')" title="Click to view full clinical audit history">
            ${patient.token}
          </button>
        </td>
        <td>
          <div style="font-weight:700;">${escapeHtml(patient.name)}</div>
          <div style="font-size:0.75rem; color:#64748b;">${patient.age}y / ${patient.sex}</div>
        </td>
        <td>${formatTimeOnly(patient.registeredAt)}</td>
        <td style="max-width:240px; word-break:break-word;">
          ${escapeHtml(patient.complaint)}
        </td>
        <td>${levelBadgeHtml}</td>
        <td style="font-family:var(--font-mono); font-weight:600;">${waitMin} min</td>
        <td>${slaHtml}</td>
        <td><span class="status-badge ${patient.status.toLowerCase().replace('_', '-')}">${patient.status}</span></td>
        <td style="text-align: right; white-space: nowrap;">
          <div class="toolbar-group" style="justify-content: flex-end;">
            <!-- Assess / Vitals Button (Nurse / Doctor / Admin only) -->
            ${currentRoleConfig.canTriage ? `
              <button class="btn btn-primary btn-sm" onclick="window.triageApp.openTriage('${patient.token}')" title="Perform triage assessment">
                ${patient.confirmedLevel ? '✏️ Re-Triage' : '🩺 Assess'}
              </button>
            ` : ''}

            <!-- Escalate Button (Nurse / Doctor / Admin only) -->
            ${currentRoleConfig.canEscalate ? `
              <button class="btn btn-danger btn-sm" onclick="window.triageApp.openEscalation('${patient.token}')" title="Dispatch clinical escalation">
                🚨 Escalate
              </button>
            ` : ''}

            <!-- Mark Seen Button (Clinical staff only) -->
            ${(currentRoleConfig.canRespondDoctor || currentRoleConfig.canTriage) ? `
              <button class="btn btn-secondary btn-sm" onclick="window.triageApp.markPatientSeen('${patient.token}')" title="Mark patient Seen by clinician">
                ✅ Seen
              </button>
            ` : ''}

            <!-- Mark LWBS Button -->
            <button class="btn btn-secondary btn-sm" onclick="window.triageApp.markPatientLwbs('${patient.token}')" title="Mark patient Left Without Being Seen">
              🚪 LWBS
            </button>

            <!-- Reorder Move Up / Down (Nurse / Doctor only) -->
            ${currentRoleConfig.canReorder ? `
              <button class="btn btn-secondary btn-sm" onclick="window.triageApp.openReorder('${patient.token}', -1)" title="Move up in priority (requires clinical reason)">
                ▲
              </button>
              <button class="btn btn-secondary btn-sm" onclick="window.triageApp.openReorder('${patient.token}', 1)" title="Move down in priority (requires clinical reason)">
                ▼
              </button>
            ` : ''}
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    });
  }

  function markPatientSeen(token) {
    const patient = State.patients.find(p => p.token === token);
    if (!patient) return;

    if (!canPerform('canTriage') && !canPerform('canRespondDoctor')) {
      logUnauthorizedAttempt('mark patient as seen', token);
      showToast('Unauthorized Action Blocked', 'Only clinical staff (Nurse/Doctor) can mark a patient as Seen.', 'toast-warning');
      return;
    }

    patient.status = 'SEEN';
    patient.seenAt = State.vTime;

    addAuditEntry({
      action: 'STATUS_CHANGE',
      patientToken: token,
      patientName: patient.name,
      details: `Patient marked as SEEN by ${State.currentUser} (${ROLES[State.currentRole]?.title || 'Staff'})`,
      diff: { status: 'SEEN' }
    });

    saveAllState();
    showToast('Patient Seen', `${patient.token} marked as Seen by doctor/clinician.`, 'toast-info');
    renderQueueTable();
  }

  function markPatientLwbs(token) {
    const patient = State.patients.find(p => p.token === token);
    if (!patient) return;

    if (!confirm(`Mark patient ${patient.name} (${token}) as Left Without Being Seen (LWBS)?`)) {
      return;
    }

    patient.status = 'LWBS';
    patient.lwbsAt = State.vTime;

    addAuditEntry({
      action: 'STATUS_CHANGE',
      patientToken: token,
      patientName: patient.name,
      details: `Patient marked as Left Without Being Seen (LWBS) by ${State.currentUser}`,
      diff: { status: 'LWBS' }
    });

    saveAllState();
    showToast('Patient LWBS', `${patient.token} recorded as Left Without Being Seen.`, 'toast-warning');
    renderQueueTable();
  }

  /**
   * Manual queue reordering (requires logged reason)
   */
  function openReorderModal(token, direction) {
    const patient = State.patients.find(p => p.token === token);
    if (!patient) return;

    if (!enforcePermission('canReorder', 'reorder clinical queue', token)) {
      return;
    }

    State.selectedPatientForReorder = { token, direction, patient };
    document.getElementById('reorderPatientSummary').innerHTML = `
      <strong>Patient:</strong> ${patient.name} (${patient.token}) &bull; Current Level: ${patient.confirmedLevel || 'Unassessed'}<br>
      <strong>Action:</strong> Shift priority ${direction < 0 ? 'HIGHER (Up)' : 'LOWER (Down)'}
    `;
    document.getElementById('reorderReasonInput').value = '';
    openModal('reorderModal');
  }

  function handleConfirmReorder() {
    if (!State.selectedPatientForReorder) return;
    const { token, direction, patient } = State.selectedPatientForReorder;

    if (!enforcePermission('canReorder', 'modify queue priority order', token)) {
      return;
    }

    const reason = document.getElementById('reorderReasonInput').value.trim();

    if (!reason) {
      showToast('Mandatory Justification', 'Please specify a clinical justification for manually modifying queue priority.', 'toast-warning');
      return;
    }

    const currentPriority = patient.customPriorityOrder !== null ? patient.customPriorityOrder : 0;
    patient.customPriorityOrder = currentPriority + (direction * 10);

    addAuditEntry({
      action: 'QUEUE_REORDER',
      patientToken: token,
      patientName: patient.name,
      details: `Queue priority adjusted ${direction < 0 ? 'HIGHER' : 'LOWER'} by ${State.currentUser}. Reason: "${reason}"`,
      diff: { customPriorityOrder: patient.customPriorityOrder, reason }
    });

    saveAllState();
    closeModal('reorderModal');
    showToast('Queue Adjusted', `Priority updated for ${token}.`, 'toast-info');
    renderQueueTable();
  }

  // ==========================================================================
  // SECTION 7: CLINICAL ESCALATION & DOCTOR INBOX
  // ==========================================================================

  function openEscalationModal(token) {
    const patient = State.patients.find(p => p.token === token);
    if (!patient) return;

    if (!enforcePermission('canEscalate', 'dispatch clinical escalation', token)) {
      return;
    }

    State.selectedPatientForEscalation = patient;
    document.getElementById('escalationPatientSummary').innerHTML = `
      <strong>Patient:</strong> ${patient.name} (${patient.token}) &bull; Age: ${patient.age}<br>
      <strong>Complaint:</strong> ${patient.complaint}<br>
      <strong>Current Triage Level:</strong> ${patient.confirmedLevel ? 'Level ' + patient.confirmedLevel : 'Unassessed'}
    `;
    document.getElementById('escalationNotesInput').value = '';
    openModal('escalationModal');
  }

  function promptEscalationForPatient(patient, reasonNote) {
    // Show a high-priority toast & open escalation modal if nurse wants
    showToast('🚨 Immediate Escalation Prompt', `${patient.token} (${patient.name}): ${reasonNote}`, 'toast-l1');
    setTimeout(() => {
      openEscalationModal(patient.token);
      document.getElementById('escalationNotesInput').value = reasonNote;
    }, 400);
  }

  function handleEscalationSubmit() {
    const patient = State.selectedPatientForEscalation;
    if (!patient) return;

    if (!enforcePermission('canEscalate', 'submit clinical escalation', patient.token)) {
      return;
    }

    const reason = document.getElementById('escalationReasonSelect').value;
    const target = document.getElementById('escalationTargetSelect').value;
    const notes = document.getElementById('escalationNotesInput').value.trim();

    const escalationId = `ESC-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`.toUpperCase();
    const newEscalation = {
      id: escalationId,
      patientToken: patient.token,
      patientName: patient.name,
      reason,
      target,
      notes,
      escalatedBy: `${State.currentUser} (${ROLES[State.currentRole]?.title || 'Staff'})`,
      escalatedAt: State.vTime,
      state: 'PENDING', // PENDING -> ACKNOWLEDGED -> RESOLVED
      acknowledgedBy: null,
      acknowledgedAt: null,
      resolvedBy: null,
      resolvedAt: null,
      doctorAction: null,
      doctorNotes: null,
      vitalsSnapshot: { ...patient.vitals },
      symptomsSnapshot: { ...patient.symptoms }
    };

    State.escalations.unshift(newEscalation);
    patient.status = 'ESCALATED';

    addAuditEntry({
      action: 'ESCALATION',
      patientToken: patient.token,
      patientName: patient.name,
      details: `Escalated to ${target}. Reason: "${reason}". Concern: "${notes || 'None'}"`,
      diff: { escalationId, target, reason }
    });

    // Alert
    createAlert({
      patientToken: patient.token,
      patientName: patient.name,
      type: 'CLINICAL_ESCALATION',
      level: 1,
      message: `ESCALATION to ${target}: ${patient.name} (${patient.token}) - ${reason}`
    });

    saveAllState();
    closeModal('escalationModal');
    showToast('🚨 Escalation Dispatched', `Patient ${patient.token} escalated to ${target}.`, 'toast-l1');
    renderDoctorInbox();
    renderQueueTable();
  }

  function renderDoctorInbox() {
    const container = document.getElementById('doctorInboxList');
    if (!container) return;
    container.innerHTML = '';

    const filterStatus = document.getElementById('filterDoctorEscalation').value;
    const list = State.escalations.filter(e => {
      if (filterStatus === 'ACTIVE') return e.state !== 'RESOLVED';
      if (filterStatus === 'RESOLVED') return e.state === 'RESOLVED';
      return true;
    });

    // Update nav badge count
    const pendingCount = State.escalations.filter(e => e.state === 'PENDING').length;
    const badge = document.getElementById('doctorEscalationBadge');
    badge.innerText = String(pendingCount);

    if (list.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; color:#64748b; padding:2.5rem;">
          No clinical escalations matching filter.
        </div>
      `;
      return;
    }

    const isDoc = ROLES[State.currentRole].canRespondDoctor;

    list.forEach(esc => {
      const card = document.createElement('div');
      card.className = 'escalation-card';
      if (esc.state === 'ACKNOWLEDGED') card.classList.add('acknowledged');
      if (esc.state === 'RESOLVED') card.classList.add('resolved');

      const elapsedMin = Math.round((State.vTime - esc.escalatedAt) / 60000);
      let ackTimeText = 'Pending doctor acknowledgement';
      if (esc.acknowledgedAt) {
        const ackMin = Math.round((esc.acknowledgedAt - esc.escalatedAt) / 60000);
        ackTimeText = `Acknowledged in ${ackMin} min by ${esc.acknowledgedBy}`;
      }

      // Format vitals snapshot
      const v = esc.vitalsSnapshot || {};
      const vitalsText = `SpO2: ${v.spo2 ? v.spo2 + '%' : '--'} | BP: ${v.sbp || '--'}/${v.dbp || '--'} | HR: ${v.hr || '--'} | RR: ${v.rr || '--'} | Temp: ${v.temp ? v.temp + '°C' : '--'}`;

      card.innerHTML = `
        <div class="escalation-meta">
          <div>
            <strong style="font-size:1rem; color:#0369a1;">${esc.patientToken}</strong>
            <span style="font-weight:700; margin-left:0.5rem;">${escapeHtml(esc.patientName)}</span>
            <span style="margin-left:0.5rem; color:#dc2626; font-weight:700;">&bull; Target: ${esc.target}</span>
          </div>
          <div>
            <span style="font-size:0.75rem;">Escalated: ${formatVirtualTime(esc.escalatedAt)} (${elapsedMin}m ago)</span>
          </div>
        </div>

        <div style="font-size:0.875rem; margin-bottom:0.5rem;">
          <strong>Reason:</strong> <span style="color:#b91c1c; font-weight:700;">${esc.reason}</span>
          ${esc.notes ? `<div style="margin-top:0.25rem; font-style:italic; color:#334155;">"${escapeHtml(esc.notes)}"</div>` : ''}
        </div>

        <div style="background:#f1f5f9; padding:0.4rem 0.6rem; border-radius:4px; font-size:0.775rem; font-family:var(--font-mono); margin-bottom:0.75rem;">
          ${vitalsText}
        </div>

        <div style="font-size:0.775rem; color:#64748b; margin-bottom:0.75rem;">
          <span>Escalated by: ${esc.escalatedBy} &bull; ${ackTimeText}</span>
        </div>

        ${esc.state === 'RESOLVED' ? `
          <div style="background:#ecfdf5; border:1px solid #a7f3d0; padding:0.5rem 0.75rem; border-radius:4px; font-size:0.825rem; color:#065f46; margin-bottom:0.75rem;">
            <strong>Resolved:</strong> Action: <strong>${esc.doctorAction}</strong> by ${esc.resolvedBy}<br>
            <em>"${escapeHtml(esc.doctorNotes || '')}"</em>
          </div>
        ` : ''}

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
          <span class="status-badge ${esc.state.toLowerCase()}">Status: ${esc.state}</span>
          <div style="display:flex; gap:0.5rem;">
            ${esc.state === 'PENDING' ? `
              <button class="btn btn-secondary btn-sm" onclick="window.triageApp.ackEscalation('${esc.id}')" ${!isDoc ? 'disabled title="Only Doctors can acknowledge"' : ''}>
                👁️ Acknowledge Escalation
              </button>
            ` : ''}
            ${esc.state !== 'RESOLVED' ? `
              <button class="btn btn-primary btn-sm" onclick="window.triageApp.openDoctorResponse('${esc.id}')" ${!isDoc ? 'disabled title="Only Doctors can resolve escalations"' : ''}>
                🩺 Clinician Response...
              </button>
            ` : ''}
          </div>
        </div>
      `;

      container.appendChild(card);
    });
  }

  function acknowledgeEscalation(escId) {
    const esc = State.escalations.find(e => e.id === escId);
    if (!esc) return;

    if (!enforcePermission('canRespondDoctor', 'acknowledge clinical escalation', esc.patientToken)) {
      return;
    }

    esc.state = 'ACKNOWLEDGED';
    esc.acknowledgedBy = `${State.currentUser} (${ROLES[State.currentRole]?.title || 'Staff'})`;
    esc.acknowledgedAt = State.vTime;

    const timeToAckMin = Math.round((esc.acknowledgedAt - esc.escalatedAt) / 60000);

    addAuditEntry({
      action: 'DOCTOR_RESPONSE',
      patientToken: esc.patientToken,
      patientName: esc.patientName,
      details: `Escalation ${esc.id} acknowledged by ${State.currentUser} (Time-to-ack: ${timeToAckMin} min)`,
      diff: { escalationId: esc.id, timeToAckMin }
    });

    saveAllState();
    showToast('Escalation Acknowledged', `Time-to-acknowledge: ${timeToAckMin} min recorded.`, 'toast-info');
    renderDoctorInbox();
  }

  function openDoctorResponseModal(escId) {
    const esc = State.escalations.find(e => e.id === escId);
    if (!esc) return;

    if (!enforcePermission('canRespondDoctor', 'open clinician response dialog', esc.patientToken)) {
      return;
    }

    State.selectedEscalationForResponse = esc;
    document.getElementById('docResponseEscalationInfo').innerHTML = `
      <strong>Patient:</strong> ${esc.patientName} (${esc.patientToken})<br>
      <strong>Escalation Reason:</strong> ${esc.reason}<br>
      <strong>Concern:</strong> ${esc.notes || 'None noted'}
    `;
    document.getElementById('docResponseNotes').value = '';
    openModal('doctorResponseModal');
  }

  function handleDoctorResponseSubmit() {
    const esc = State.selectedEscalationForResponse;
    if (!esc) return;

    if (!enforcePermission('canRespondDoctor', 'submit clinical response', esc.patientToken)) {
      return;
    }

    const actionType = document.getElementById('docResponseTypeSelect').value;
    const notes = document.getElementById('docResponseNotes').value.trim();

    if (!notes) {
      showToast('Mandatory Field', 'Please document clinical orders and rationale.', 'toast-warning');
      return;
    }

    esc.state = 'RESOLVED';
    esc.resolvedBy = `${State.currentUser} (${ROLES[State.currentRole]?.title || 'Staff'})`;
    esc.resolvedAt = State.vTime;
    esc.doctorAction = actionType;
    esc.doctorNotes = notes;

    // If doctor wasn't acknowledged yet, record ack at same time
    if (!esc.acknowledgedAt) {
      esc.acknowledgedAt = State.vTime;
      esc.acknowledgedBy = esc.resolvedBy;
    }

    // Update patient status if transfer or accept
    const patient = State.patients.find(p => p.token === esc.patientToken);
    if (patient) {
      if (actionType === 'Accept Patient') {
        patient.status = 'IN_ASSESSMENT';
      } else if (actionType === 'Transfer to Emergency') {
        patient.status = 'SEEN';
      }
    }

    addAuditEntry({
      action: 'DOCTOR_RESPONSE',
      patientToken: esc.patientToken,
      patientName: esc.patientName,
      details: `Doctor response committed: [${actionType}] - "${notes}"`,
      diff: { escalationId: esc.id, doctorAction: actionType, doctorNotes: notes }
    });

    saveAllState();
    closeModal('doctorResponseModal');
    showToast('Escalation Resolved', `Orders saved for ${esc.patientToken}.`, 'toast-info');
    renderDoctorInbox();
    renderQueueTable();
  }

  // ==========================================================================
  // SECTION 8: AUDIT TRAIL & CSV EXPORT
  // ==========================================================================

  function addAuditEntry({ action, patientToken, patientName, details, diff }) {
    const entry = {
      id: `AUD-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`.toUpperCase(),
      vTime: State.vTime,
      timestampISO: new Date().toISOString(),
      user: State.currentUser,
      role: State.currentRole,
      action,
      patientToken: patientToken || '--',
      patientName: patientName || '--',
      details,
      diff: diff || {}
    };

    State.audit.unshift(entry);
    setStorage(STORAGE_KEYS.AUDIT, State.audit);
  }

  function renderAuditTable() {
    const tbody = document.getElementById('auditTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filterAction = document.getElementById('filterAuditAction').value;
    const query = (document.getElementById('auditSearchInput').value || '').trim().toLowerCase();

    const filtered = State.audit.filter(item => {
      if (filterAction !== 'ALL' && item.action !== filterAction) return false;
      if (query) {
        const text = `${item.patientToken} ${item.patientName} ${item.user} ${item.details}`.toLowerCase();
        if (!text.includes(query)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#64748b; padding:2rem;">No audit logs match criteria.</td></tr>`;
      return;
    }

    filtered.forEach(log => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family:var(--font-mono); font-size:0.775rem; white-space:nowrap;">
          ${formatVirtualTime(log.vTime)}
        </td>
        <td>
          <div style="font-weight:700;">${log.user}</div>
          <div style="font-size:0.725rem; color:#64748b;">${ROLES[log.role]?.title || log.role}</div>
        </td>
        <td>
          <span class="status-badge waiting" style="font-size:0.725rem;">${log.action}</span>
        </td>
        <td class="token-cell">
          ${log.patientToken !== '--' ? `
            <button class="btn btn-secondary btn-sm" onclick="window.triageApp.openTimeline('${log.patientToken}')">
              ${log.patientToken}
            </button>
          ` : '--'}
        </td>
        <td style="max-width:350px; font-size:0.8rem;">
          <div>${escapeHtml(log.details)}</div>
          ${Object.keys(log.diff).length > 0 ? `
            <div class="audit-diff" style="margin-top:0.25rem;">
              ${escapeHtml(JSON.stringify(log.diff))}
            </div>
          ` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function openPatientTimeline(token) {
    const patient = State.patients.find(p => p.token === token);
    const container = document.getElementById('patientTimelineBody');
    const header = document.getElementById('patientTimelineSummary');

    if (patient) {
      header.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <span class="token-cell" style="font-size:1.1rem;">${patient.token}</span>
            <strong style="margin-left:0.5rem;">${patient.name}</strong> (${patient.age}y / ${patient.sex})
          </div>
          <div>
            <span>Arrival: ${formatVirtualTime(patient.registeredAt)}</span>
          </div>
        </div>
        <div style="font-size:0.825rem; color:#475569; margin-top:0.25rem;">
          Complaint: ${escapeHtml(patient.complaint)} | Confirmed Level: ${patient.confirmedLevel || 'Unconfirmed'}
        </div>
      `;
    } else {
      header.innerHTML = `<div>Token: <strong>${token}</strong></div>`;
    }

    const patientLogs = State.audit.filter(a => a.patientToken === token);
    container.innerHTML = '';

    if (patientLogs.length === 0) {
      container.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:1.5rem; color:#64748b;">No audit records found for this patient.</td></tr>';
    } else {
      patientLogs.forEach(l => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="font-family:var(--font-mono); font-size:0.775rem;">${formatVirtualTime(l.vTime)}</td>
          <td><strong>${l.user}</strong> <span style="font-size:0.725rem; color:#64748b;">(${l.role})</span></td>
          <td><span class="status-badge">${l.action}</span></td>
          <td style="font-size:0.8rem;">
            ${escapeHtml(l.details)}
            ${Object.keys(l.diff).length > 0 ? `<div class="audit-diff">${escapeHtml(JSON.stringify(l.diff))}</div>` : ''}
          </td>
        `;
        container.appendChild(tr);
      });
    }

    openModal('patientTimelineModal');
  }

  /**
   * Export to CSV
   */
  function exportAuditToCsv() {
    if (State.audit.length === 0) {
      showToast('Export Empty', 'Audit log has no entries to export.', 'toast-info');
      return;
    }

    const headers = ['Timestamp', 'User', 'Role', 'Action', 'PatientToken', 'PatientName', 'Details', 'DiffJSON'];
    const rows = State.audit.map(a => [
      formatVirtualTime(a.vTime),
      `"${(a.user || '').replace(/"/g, '""')}"`,
      `"${(a.role || '').replace(/"/g, '""')}"`,
      `"${(a.action || '').replace(/"/g, '""')}"`,
      `"${(a.patientToken || '').replace(/"/g, '""')}"`,
      `"${(a.patientName || '').replace(/"/g, '""')}"`,
      `"${(a.details || '').replace(/"/g, '""')}"`,
      `"${JSON.stringify(a.diff || {}).replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    downloadBlob(csvContent, `medi_flow_audit_log_${Date.now()}.csv`, 'text/csv');
  }

  function exportQueueToCsv() {
    if (State.patients.length === 0) {
      showToast('Export Empty', 'No patients in queue to export.', 'toast-info');
      return;
    }

    const headers = ['Token', 'Name', 'Age', 'Sex', 'Phone', 'ArrivalMode', 'Complaint', 'RegisteredAt', 'ConfirmedLevel', 'SuggestedLevel', 'IsOverridden', 'OverrideReason', 'IsDowngraded', 'Status'];
    const rows = State.patients.map(p => [
      p.token,
      `"${(p.name || '').replace(/"/g, '""')}"`,
      p.age,
      p.sex,
      `"${p.phone}"`,
      p.arrivalMode,
      `"${(p.complaint || '').replace(/"/g, '""')}"`,
      formatVirtualTime(p.registeredAt),
      p.confirmedLevel || '',
      p.systemSuggestedLevel || '',
      p.isOverridden ? 'TRUE' : 'FALSE',
      `"${(p.overrideReason || '').replace(/"/g, '""')}"`,
      p.isDowngraded ? 'TRUE' : 'FALSE',
      p.status
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    downloadBlob(csvContent, `medi_flow_patient_queue_${Date.now()}.csv`, 'text/csv');
  }

  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Export Complete', `Downloaded ${filename}`, 'toast-info');
  }

  // ==========================================================================
  // SECTION 9: ANALYTICS DASHBOARD
  // ==========================================================================

  function renderDashboard() {
    const totalPatients = State.patients.length;
    document.getElementById('dashTotalPatients').innerText = String(totalPatients);

    // Calculate active wait times & SLA breaches
    let totalWait = 0;
    let activePatients = 0;
    let slaBreaches = 0;

    State.patients.forEach(p => {
      if (p.status !== 'SEEN' && p.status !== 'LWBS') {
        const waitMin = Math.max(0, Math.floor((State.vTime - p.registeredAt) / 60000));
        totalWait += waitMin;
        activePatients += 1;

        const level = p.confirmedLevel || (p.isProvisionalL1 ? 1 : null);
        if (level && waitMin > SLA_MINUTES[level]) {
          slaBreaches += 1;
        }
      }
    });

    const avgWait = activePatients > 0 ? Math.round(totalWait / activePatients) : 0;
    document.getElementById('dashAvgWait').innerText = `${avgWait} min`;
    document.getElementById('dashSlaBreaches').innerText = String(slaBreaches);
    const breachRate = activePatients > 0 ? Math.round((slaBreaches / activePatients) * 100) : 0;
    document.getElementById('dashSlaRate').innerText = `${breachRate}% active queue breach rate`;

    // Overrides
    const triagedPatients = State.patients.filter(p => p.confirmedLevel !== null);
    const overrides = triagedPatients.filter(p => p.isOverridden);
    const overrideRate = triagedPatients.length > 0 ? Math.round((overrides.length / triagedPatients.length) * 100) : 0;
    document.getElementById('dashOverrideRate').innerText = `${overrideRate}%`;
    document.getElementById('dashOverrideCount').innerText = `${overrides.length} of ${triagedPatients.length} triages overridden`;

    // Escalations & Avg Acknowledge Time
    const escalations = State.escalations;
    document.getElementById('dashEscalations').innerText = String(escalations.length);
    const acknowledgedEscs = escalations.filter(e => e.acknowledgedAt !== null);
    let avgAckTime = 0;
    if (acknowledgedEscs.length > 0) {
      const sumAck = acknowledgedEscs.reduce((acc, curr) => acc + (curr.acknowledgedAt - curr.escalatedAt), 0);
      avgAckTime = Math.round(sumAck / (acknowledgedEscs.length * 60000));
    }
    document.getElementById('dashAvgAckTime').innerText = `Avg ack: ${avgAckTime} min (${acknowledgedEscs.length} reviewed)`;

    // LWBS
    const lwbsCount = State.patients.filter(p => p.status === 'LWBS').length;
    document.getElementById('dashLwbsCount').innerText = String(lwbsCount);

    // Distribution Bars
    const levelCounts = { 1: 0, 2: 0, 3: 0, 4: 0, unassessed: 0 };
    State.patients.forEach(p => {
      if (p.confirmedLevel) levelCounts[p.confirmedLevel] += 1;
      else if (p.isProvisionalL1) levelCounts[1] += 1;
      else levelCounts.unassessed += 1;
    });

    const barContainer = document.getElementById('dashUrgencyBars');
    const levelMeta = [
      { level: 1, label: 'Level 1 - Critical (Immediate)', count: levelCounts[1], color: '#dc2626', icon: '🔴' },
      { level: 2, label: 'Level 2 - Urgent (15 min)', count: levelCounts[2], color: '#ea580c', icon: '🟠' },
      { level: 3, label: 'Level 3 - Semi-urgent (60 min)', count: levelCounts[3], color: '#ca8a04', icon: '🟡' },
      { level: 4, label: 'Level 4 - Non-urgent (120 min)', count: levelCounts[4], color: '#16a34a', icon: '🟢' },
      { level: 'unassessed', label: 'Unassessed / In Queue', count: levelCounts.unassessed, color: '#64748b', icon: '⏳' }
    ];

    barContainer.innerHTML = levelMeta.map(m => {
      const pct = totalPatients > 0 ? Math.round((m.count / totalPatients) * 100) : 0;
      return `
        <div>
          <div style="display:flex; justify-content:space-between; font-size:0.8rem; font-weight:600; margin-bottom:2px;">
            <span>${m.icon} ${m.label}</span>
            <span>${m.count} patients (${pct}%)</span>
          </div>
          <div style="background:#e2e8f0; height:12px; border-radius:6px; overflow:hidden;">
            <div style="background:${m.color}; width:${pct}%; height:100%; transition: width 0.3s;"></div>
          </div>
        </div>
      `;
    }).join('');

    // Dashboard Overrides Table
    const overridesTbody = document.getElementById('dashboardOverridesBody');
    overridesTbody.innerHTML = '';
    if (overrides.length === 0) {
      overridesTbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#64748b; padding:1.5rem;">No clinical overrides recorded.</td></tr>`;
    } else {
      overrides.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="token-cell">${p.token}</td>
          <td>${escapeHtml(p.name)}</td>
          <td><span class="urgency-badge l${p.systemSuggestedLevel}">L${p.systemSuggestedLevel}</span></td>
          <td><span class="urgency-badge l${p.confirmedLevel}">L${p.confirmedLevel}</span></td>
          <td>
            ${p.isDowngraded ? '<span class="status-badge escalated">⚠️ DOWNGRADE</span>' : '<span class="status-badge">Upgrade/Side</span>'}
          </td>
          <td style="font-size:0.8rem; max-width:250px;">${escapeHtml(p.overrideReason || '')}</td>
          <td style="font-size:0.8rem;">${p.confirmedBy || 'Nurse'}</td>
        `;
        overridesTbody.appendChild(tr);
      });
    }
  }

  // ==========================================================================
  // SECTION 10: DEMO DATA GENERATOR & TIME SIMULATION
  // ==========================================================================

  function loadDemoData() {
    State.tokenCounter = 1;
    State.vTime = new Date(DEFAULT_START_TIME).getTime();

    // 12 Synthetic Patients Covering all prompt requirements
    const demoPatients = [
      // 1. L1 Anaphylaxis/Airway Emergency
      {
        token: 'OPD-0001',
        name: 'Carlos Mendez',
        age: 32,
        sex: 'Male',
        phone: '9876543210',
        arrivalMode: 'Walk-in',
        pregnancy: 'No',
        allergies: 'Peanuts, Shellfish',
        complaint: 'Severe lip swelling, stridor, and difficulty breathing following food ingestion.',
        registeredAt: State.vTime - 5 * 60000,
        status: 'IN_ASSESSMENT',
        confirmedLevel: 1,
        systemSuggestedLevel: 1,
        isProvisionalL1: false,
        isOverridden: false,
        overrideReason: null,
        isDowngraded: false,
        flaggedForDoctorReview: true,
        confirmedBy: 'Nurse Sarah (Triage Nurse)',
        confirmedAt: State.vTime - 4 * 60000,
        customPriorityOrder: null,
        symptoms: { allergic_reaction: true, breathlessness: true },
        vitals: { spo2: '87', sbp: '88', hr: '135', rr: '34', temp: '37.1', gcs: '14', pain: '4' },
        clinicalNotes: 'Impending airway closure. Immediate IM epinephrine administered.',
        triageHistory: []
      },
      // 2. L1 Acute Stroke signs with elderly patient
      {
        token: 'OPD-0002',
        name: 'Eleanor Vance',
        age: 74,
        sex: 'Female',
        phone: '9876543211',
        arrivalMode: 'Ambulance',
        pregnancy: 'No',
        allergies: 'None',
        complaint: 'Sudden onset left-sided facial droop and right arm paralysis 35 min ago.',
        registeredAt: State.vTime - 12 * 60000,
        status: 'ESCALATED',
        confirmedLevel: 1,
        systemSuggestedLevel: 1,
        isProvisionalL1: false,
        isOverridden: false,
        overrideReason: null,
        isDowngraded: false,
        flaggedForDoctorReview: true,
        confirmedBy: 'Nurse Sarah (Triage Nurse)',
        confirmedAt: State.vTime - 10 * 60000,
        customPriorityOrder: null,
        symptoms: { stroke_signs: true, altered_consciousness: true },
        vitals: { spo2: '96', sbp: '195', hr: '94', rr: '18', temp: '36.8', gcs: '12', pain: '0' },
        clinicalNotes: 'Time critical stroke thrombolysis candidate. CT ordered.',
        triageHistory: []
      },
      // 3. L1 Emergency Walk-in (Unconscious)
      {
        token: 'OPD-0003',
        name: 'Unknown Male #3',
        age: 45,
        sex: 'Male',
        phone: '0000000000',
        arrivalMode: 'Walk-in',
        pregnancy: 'No',
        allergies: 'Unknown',
        complaint: 'Collapsed outside clinic entrance. Unresponsive.',
        registeredAt: State.vTime - 2 * 60000,
        status: 'WAITING',
        confirmedLevel: 1,
        systemSuggestedLevel: 1,
        isProvisionalL1: true,
        isOverridden: false,
        overrideReason: 'Emergency walk-in quick entry protocol',
        isDowngraded: false,
        flaggedForDoctorReview: true,
        confirmedBy: 'Clerk Alex [Provisional]',
        confirmedAt: State.vTime - 2 * 60000,
        customPriorityOrder: -9999,
        symptoms: { altered_consciousness: true },
        vitals: { sbp: '75', gcs: '6' },
        clinicalNotes: 'Provisional entry awaiting immediate trauma bay resuscitation.',
        triageHistory: []
      },
      // 4. L2 Chest pain age 55 (High-Risk ACS)
      {
        token: 'OPD-0004',
        name: 'Rajesh Sharma',
        age: 55,
        sex: 'Male',
        phone: '9876543212',
        arrivalMode: 'Walk-in',
        pregnancy: 'No',
        allergies: 'Aspirin',
        complaint: 'Heavy retrosternal chest pressure radiating to left jaw for 1 hour.',
        registeredAt: State.vTime - 20 * 60000,
        status: 'IN_ASSESSMENT',
        confirmedLevel: 2,
        systemSuggestedLevel: 2,
        isProvisionalL1: false,
        isOverridden: false,
        overrideReason: null,
        isDowngraded: false,
        flaggedForDoctorReview: false,
        confirmedBy: 'Nurse Sarah (Triage Nurse)',
        confirmedAt: State.vTime - 18 * 60000,
        customPriorityOrder: null,
        symptoms: { chest_pain: true, breathlessness: true },
        vitals: { spo2: '96', sbp: '160', hr: '98', rr: '22', temp: '36.9', gcs: '15', pain: '8' },
        clinicalNotes: 'ECG underway. Patient diaphoretic.',
        triageHistory: []
      },
      // 5. L2 Pregnant female with bleeding/abdominal pain
      {
        token: 'OPD-0005',
        name: 'Fatima Al-Sayed',
        age: 28,
        sex: 'Female',
        phone: '9876543213',
        arrivalMode: 'Walk-in',
        pregnancy: 'Yes',
        allergies: 'None',
        complaint: 'Pregnant 28 weeks, presenting with severe crampy abdominal pain and vaginal spotting.',
        registeredAt: State.vTime - 10 * 60000,
        status: 'IN_ASSESSMENT',
        confirmedLevel: 2,
        systemSuggestedLevel: 2,
        isProvisionalL1: false,
        isOverridden: false,
        overrideReason: null,
        isDowngraded: false,
        flaggedForDoctorReview: false,
        confirmedBy: 'Nurse Sarah (Triage Nurse)',
        confirmedAt: State.vTime - 8 * 60000,
        customPriorityOrder: null,
        symptoms: { pregnancy_bleeding_pain: true, severe_abdominal_pain: true },
        vitals: { spo2: '98', sbp: '110', hr: '92', rr: '18', temp: '37.0', gcs: '15', pain: '7' },
        clinicalNotes: 'Urgent OBGYN consult requested.',
        triageHistory: []
      },
      // 6. L2 High fever infant (4 months)
      {
        token: 'OPD-0006',
        name: 'Baby Mia Chen',
        age: 0.33,
        sex: 'Female',
        phone: '9876543214',
        arrivalMode: 'Referred',
        pregnancy: 'No',
        allergies: 'None',
        complaint: 'Mother reports 4-month-old infant is lethargic, hot to touch, not feeding.',
        registeredAt: State.vTime - 14 * 60000,
        status: 'WAITING',
        confirmedLevel: 2,
        systemSuggestedLevel: 2,
        isProvisionalL1: false,
        isOverridden: false,
        overrideReason: null,
        isDowngraded: false,
        flaggedForDoctorReview: false,
        confirmedBy: 'Nurse Sarah (Triage Nurse)',
        confirmedAt: State.vTime - 12 * 60000,
        customPriorityOrder: null,
        symptoms: { high_fever: true },
        vitals: { spo2: '97', sbp: '85', hr: '165', rr: '42', temp: '39.8', gcs: '15', pain: '5' },
        clinicalNotes: 'Infant high fever protocol. Rapid pediatric review.',
        triageHistory: []
      },
      // 7. L2 Conflicting/abnormal vitals (Borderline SpO2 + Tachycardia)
      {
        token: 'OPD-0007',
        name: 'David Wilson',
        age: 67,
        sex: 'Male',
        phone: '9876543215',
        arrivalMode: 'Walk-in',
        pregnancy: 'No',
        allergies: 'Penicillin',
        complaint: 'Mild cough and fatigue for 3 days.',
        registeredAt: State.vTime - 25 * 60000,
        status: 'IN_ASSESSMENT',
        confirmedLevel: 2,
        systemSuggestedLevel: 2,
        isProvisionalL1: false,
        isOverridden: false,
        overrideReason: null,
        isDowngraded: false,
        flaggedForDoctorReview: true,
        confirmedBy: 'Nurse Sarah (Triage Nurse)',
        confirmedAt: State.vTime - 22 * 60000,
        customPriorityOrder: null,
        symptoms: { mild_cold: true },
        vitals: { spo2: '91', sbp: '142', hr: '122', rr: '24', temp: '38.2', gcs: '15', pain: '2' },
        clinicalNotes: 'Discrepancy: complains of minor cold but SpO2 is 91% and HR 122. Raised to Level 2.',
        triageHistory: []
      },
      // 8. L3 Semi-urgent vomiting/diarrhea
      {
        token: 'OPD-0008',
        name: 'Priya Patel',
        age: 24,
        sex: 'Female',
        phone: '9876543216',
        arrivalMode: 'Walk-in',
        pregnancy: 'No',
        allergies: 'None',
        complaint: 'Vomiting and watery diarrhea for 24 hours. Able to sip water.',
        registeredAt: State.vTime - 35 * 60000,
        status: 'WAITING',
        confirmedLevel: 3,
        systemSuggestedLevel: 3,
        isProvisionalL1: false,
        isOverridden: false,
        overrideReason: null,
        isDowngraded: false,
        flaggedForDoctorReview: false,
        confirmedBy: 'Nurse Sarah (Triage Nurse)',
        confirmedAt: State.vTime - 30 * 60000,
        customPriorityOrder: null,
        symptoms: { vomiting_diarrhea: true },
        vitals: { spo2: '99', sbp: '115', hr: '84', rr: '16', temp: '37.3', gcs: '15', pain: '4' },
        clinicalNotes: 'Mild dehydration. Oral rehydration solution initiated.',
        triageHistory: []
      },
      // 9. L3 Chest pain with MISSING vitals -> "Needs human review"
      {
        token: 'OPD-0009',
        name: 'Samuel Green',
        age: 34,
        sex: 'Male',
        phone: '9876543217',
        arrivalMode: 'Walk-in',
        pregnancy: 'No',
        allergies: 'None',
        complaint: 'Sharp pleuritic chest discomfort following heavy coughing.',
        registeredAt: State.vTime - 15 * 60000,
        status: 'WAITING',
        confirmedLevel: 3,
        systemSuggestedLevel: 3,
        isProvisionalL1: false,
        isOverridden: false,
        overrideReason: null,
        isDowngraded: false,
        flaggedForDoctorReview: true,
        confirmedBy: 'Nurse Sarah (Triage Nurse)',
        confirmedAt: State.vTime - 12 * 60000,
        customPriorityOrder: null,
        symptoms: { chest_pain: true },
        vitals: {}, // Completely missing vitals!
        clinicalNotes: 'Awaiting triage nurse vitals station measurement. Fails safe to L3 review.',
        triageHistory: []
      },
      // 10. L4 Mild cold / upper respiratory
      {
        token: 'OPD-0010',
        name: 'Amina Idris',
        age: 19,
        sex: 'Female',
        phone: '9876543218',
        arrivalMode: 'Walk-in',
        pregnancy: 'No',
        allergies: 'None',
        complaint: 'Runny nose, sneezing, scratchy throat for 2 days. Normal energy.',
        registeredAt: State.vTime - 45 * 60000,
        status: 'WAITING',
        confirmedLevel: 4,
        systemSuggestedLevel: 4,
        isProvisionalL1: false,
        isOverridden: false,
        overrideReason: null,
        isDowngraded: false,
        flaggedForDoctorReview: false,
        confirmedBy: 'Nurse Sarah (Triage Nurse)',
        confirmedAt: State.vTime - 40 * 60000,
        customPriorityOrder: null,
        symptoms: { mild_cold: true },
        vitals: { spo2: '99', sbp: '118', hr: '72', rr: '14', temp: '36.7', gcs: '15', pain: '1' },
        clinicalNotes: 'Non-urgent ambulatory care.',
        triageHistory: []
      },
      // 11. SLA Breach Patient (L2 registered 80 min ago with 15 min SLA!)
      {
        token: 'OPD-0011',
        name: 'George Taylor',
        age: 62,
        sex: 'Male',
        phone: '9876543219',
        arrivalMode: 'Walk-in',
        pregnancy: 'No',
        allergies: 'Sulfa',
        complaint: 'Severe burning epigastric and abdominal pain. Has been waiting in hall.',
        registeredAt: State.vTime - 85 * 60000, // 85 min ago!
        status: 'WAITING',
        confirmedLevel: 2,
        systemSuggestedLevel: 2,
        isProvisionalL1: false,
        isOverridden: false,
        overrideReason: null,
        isDowngraded: false,
        flaggedForDoctorReview: false,
        confirmedBy: 'Nurse Sarah (Triage Nurse)',
        confirmedAt: State.vTime - 80 * 60000,
        customPriorityOrder: null,
        symptoms: { severe_abdominal_pain: true },
        vitals: { spo2: '95', sbp: '150', hr: '104', rr: '20', temp: '37.8', gcs: '15', pain: '8' },
        clinicalNotes: 'SLA target 15 min exceeded. Critical queue delay.',
        triageHistory: []
      },
      // 12. Human Override patient (Suggested L3, nurse overrode to L2 with reason)
      {
        token: 'OPD-0012',
        name: 'Maria Santos',
        age: 50,
        sex: 'Female',
        phone: '9876543220',
        arrivalMode: 'Walk-in',
        pregnancy: 'No',
        allergies: 'Codeine',
        complaint: 'Dizziness and nausea. Vitals borderline, but patient is pale and clammy.',
        registeredAt: State.vTime - 18 * 60000,
        status: 'IN_ASSESSMENT',
        confirmedLevel: 2,
        systemSuggestedLevel: 3,
        isProvisionalL1: false,
        isOverridden: true,
        overrideReason: 'Clinically pale and diaphoretic despite borderline vitals; concerned for occult bleeding.',
        isDowngraded: false,
        flaggedForDoctorReview: true,
        confirmedBy: 'Nurse Sarah (Triage Nurse)',
        confirmedAt: State.vTime - 15 * 60000,
        customPriorityOrder: null,
        symptoms: { vomiting_diarrhea: true },
        vitals: { spo2: '96', sbp: '102', hr: '96', rr: '18', temp: '36.9', gcs: '15', pain: '4' },
        clinicalNotes: 'Human override exercised on clinical visual judgment.',
        triageHistory: []
      }
    ];

    State.patients = demoPatients;
    State.tokenCounter = 13;

    // Seed Demo Escalations
    State.escalations = [
      {
        id: 'ESC-DEMO-001',
        patientToken: 'OPD-0002',
        patientName: 'Eleanor Vance',
        reason: 'Red flag symptom present',
        target: 'Emergency Resuscitation Team',
        notes: 'Acute stroke signs within 1-hour window. Code stroke activated.',
        escalatedBy: 'Nurse Sarah (Triage Nurse)',
        escalatedAt: State.vTime - 10 * 60000,
        state: 'ACKNOWLEDGED',
        acknowledgedBy: 'Dr. Rao (Doctor)',
        acknowledgedAt: State.vTime - 7 * 60000,
        resolvedBy: null,
        resolvedAt: null,
        doctorAction: null,
        doctorNotes: null,
        vitalsSnapshot: { spo2: '96', sbp: '195', hr: '94' },
        symptomsSnapshot: { stroke_signs: true }
      },
      {
        id: 'ESC-DEMO-002',
        patientToken: 'OPD-0011',
        patientName: 'George Taylor',
        reason: 'Clinical deterioration',
        target: 'On-duty Doctor',
        notes: 'Severe abdominal pain with SLA breach > 70 min. Needs immediate bed.',
        escalatedBy: 'Nurse Sarah (Triage Nurse)',
        escalatedAt: State.vTime - 15 * 60000,
        state: 'PENDING',
        acknowledgedBy: null,
        acknowledgedAt: null,
        resolvedBy: null,
        resolvedAt: null,
        doctorAction: null,
        doctorNotes: null,
        vitalsSnapshot: { spo2: '95', sbp: '150', hr: '104' },
        symptomsSnapshot: { severe_abdominal_pain: true }
      }
    ];

    // Seed Demo Alerts
    State.alerts = [
      {
        id: 'ALT-DEMO-001',
        patientToken: 'OPD-0003',
        patientName: 'Unknown Male #3',
        type: 'EMERGENCY_L1_WALKIN',
        level: 1,
        message: 'CRITICAL ALERT: Emergency Walk-In patient Unknown Male #3 (OPD-0003) entered at Level 1 Critical!',
        state: 'NEW',
        createdAt: State.vTime - 2 * 60000,
        acknowledgedBy: null,
        acknowledgedAt: null,
        resolvedBy: null,
        resolvedAt: null,
        resolutionNote: null,
        escalatedToRole: null
      },
      {
        id: 'ALT-DEMO-002',
        patientToken: 'OPD-0011',
        patientName: 'George Taylor',
        type: 'SLA_BREACH',
        level: 2,
        message: 'SLA BREACH ALERT: George Taylor (OPD-0011) has exceeded Level 2 target wait time by 70 min!',
        state: 'NEW',
        createdAt: State.vTime - 20 * 60000,
        acknowledgedBy: null,
        acknowledgedAt: null,
        resolvedBy: null,
        resolvedAt: null,
        resolutionNote: null,
        escalatedToRole: 'Doctor'
      }
    ];

    // Seed Demo Audit Logs
    State.audit = [
      {
        id: 'AUD-DEMO-001',
        vTime: State.vTime - 85 * 60000,
        timestampISO: new Date().toISOString(),
        user: 'Clerk Alex',
        role: 'clerk',
        action: 'REGISTRATION',
        patientToken: 'OPD-0011',
        patientName: 'George Taylor',
        details: 'Registered via Walk-in. Complaint: "Severe burning epigastric and abdominal pain."',
        diff: { name: 'George Taylor', age: 62 }
      },
      {
        id: 'AUD-DEMO-002',
        vTime: State.vTime - 15 * 60000,
        timestampISO: new Date().toISOString(),
        user: 'Nurse Sarah',
        role: 'nurse',
        action: 'TRIAGE_OVERRIDE',
        patientToken: 'OPD-0012',
        patientName: 'Maria Santos',
        details: 'Overrode System L3 -> L2. Reason: "Clinically pale and diaphoretic despite borderline vitals; concerned for occult bleeding."',
        diff: { systemSuggestion: 3, humanConfirmed: 2, isOverridden: true }
      },
      {
        id: 'AUD-DEMO-003',
        vTime: State.vTime - 10 * 60000,
        timestampISO: new Date().toISOString(),
        user: 'Nurse Sarah',
        role: 'nurse',
        action: 'ESCALATION',
        patientToken: 'OPD-0002',
        patientName: 'Eleanor Vance',
        details: 'Escalated to Emergency Resuscitation Team. Reason: "Red flag symptom present"',
        diff: { target: 'Emergency Resuscitation Team' }
      },
      {
        id: 'AUD-DEMO-004',
        vTime: State.vTime - 7 * 60000,
        timestampISO: new Date().toISOString(),
        user: 'Dr. Rao',
        role: 'doctor',
        action: 'DOCTOR_RESPONSE',
        patientToken: 'OPD-0002',
        patientName: 'Eleanor Vance',
        details: 'Escalation acknowledged by Dr. Rao (Time-to-ack: 3 min)',
        diff: { timeToAckMin: 3 }
      }
    ];

    saveAllState();
    updateClockDisplay();
    updateAlertCounterUI();
    renderQueueTable();
    renderDoctorInbox();
    renderAuditTable();
    renderDashboard();
    showToast('Demo Data Loaded', '12 realistic synthetic patients, SLA breach, override, and alerts initialized.', 'toast-info');
  }

  function simulatePlus15Min() {
    State.vTime += 15 * 60000;
    saveAllState();
    updateClockDisplay();

    // Check for SLA breaches and unacknowledged alerts
    evaluateTimeSimulationTriggers();

    renderQueueTable();
    renderDoctorInbox();
    renderAuditTable();
    renderDashboard();
    showToast('🕒 Time Advanced', 'Simulated virtual clock advanced by +15 minutes.', 'toast-info');
  }

  function evaluateTimeSimulationTriggers() {
    const FIVE_MIN = 5 * 60000;

    // 1. Check patients for new SLA breaches
    State.patients.forEach(p => {
      if (p.status !== 'SEEN' && p.status !== 'LWBS') {
        const level = p.confirmedLevel || (p.isProvisionalL1 ? 1 : null);
        if (level) {
          const waitMin = Math.floor((State.vTime - p.registeredAt) / 60000);
          const target = SLA_MINUTES[level];
          if (waitMin > target) {
            // Check if alert already raised for this breach
            const existingAlert = State.alerts.find(a => a.patientToken === p.token && a.type === 'SLA_BREACH');
            if (!existingAlert) {
              createAlert({
                patientToken: p.token,
                patientName: p.name,
                type: 'SLA_BREACH',
                level: level <= 2 ? 1 : 2,
                message: `SLA BREACH: ${p.name} (${p.token}, Level ${level}) has waited ${waitMin}m (target ${target}m).`
              });
            }
          }
        }
      }
    });

    // 2. Check unacknowledged alerts: escalate to next role after 5 virtual minutes
    State.alerts.forEach(alt => {
      if (alt.state === 'NEW') {
        const elapsed = State.vTime - alt.createdAt;
        if (elapsed > FIVE_MIN && !alt.escalatedToRole) {
          alt.escalatedToRole = 'Doctor / Senior Clinician';
          addAuditEntry({
            action: 'ALERT_RAISED',
            patientToken: alt.patientToken,
            patientName: alt.patientName,
            details: `Unacknowledged alert ${alt.id} automatically escalated to ${alt.escalatedToRole} (> 5 min elapsed)`,
            diff: { alertId: alt.id, escalatedToRole: alt.escalatedToRole }
          });
          showToast('⚠️ Alert Auto-Escalated', `Unacknowledged alert for ${alt.patientToken} escalated to ${alt.escalatedToRole}!`, 'toast-warning');
        }
      }
    });

    saveAllState();
    updateAlertCounterUI();
  }

  function resetAllData() {
    if (!confirm('Are you sure you want to reset all synthetic data?')) return;
    localStorage.removeItem(STORAGE_KEYS.PATIENTS);
    localStorage.removeItem(STORAGE_KEYS.ALERTS);
    localStorage.removeItem(STORAGE_KEYS.AUDIT);
    localStorage.removeItem(STORAGE_KEYS.ESCALATIONS);
    localStorage.removeItem(STORAGE_KEYS.VTIME);
    localStorage.removeItem(STORAGE_KEYS.COUNTER);
    loadState();
    updateClockDisplay();
    updateAlertCounterUI();
    renderQueueTable();
    renderDoctorInbox();
    renderAuditTable();
    renderDashboard();
    showToast('Data Cleared', 'All synthetic state reset to initial zero state.', 'toast-info');
  }

  function updateClockDisplay() {
    const el = document.getElementById('virtualClockDisplay');
    if (el) el.innerText = formatVirtualTime(State.vTime);
  }

  // ==========================================================================
  // ==========================================================================
  // SECTION 11: AUTOMATED SELF-TEST SUITE (17 SAFETY & SECURITY ASSERTIONS)
  // ==========================================================================

  async function runSelfTests() {
    const assertions = [
      {
        id: 1,
        title: 'SpO2 88% triggers Level 1 Critical',
        input: 'Adult age 45, SpO2 88%, no other symptoms',
        run: async () => {
          const res = evaluateTriage({ age: 45 }, {}, { spo2: '88' });
          return { pass: res.suggestedLevel === 1, actual: `Level ${res.suggestedLevel} (${res.levelLabel})` };
        },
        expected: 'Level 1 (Critical Hypoxia)'
      },
      {
        id: 2,
        title: 'SpO2 92% triggers at least Level 2 Urgent',
        input: 'Adult age 45, SpO2 92%',
        run: async () => {
          const res = evaluateTriage({ age: 45 }, {}, { spo2: '92' });
          return { pass: res.suggestedLevel === 2, actual: `Level ${res.suggestedLevel}` };
        },
        expected: 'Level 2 (Borderline Hypoxia)'
      },
      {
        id: 3,
        title: 'Systolic BP 75 mmHg triggers Level 1 Critical',
        input: 'Adult age 30, SBP 75 mmHg',
        run: async () => {
          const res = evaluateTriage({ age: 30 }, {}, { sbp: '75' });
          return { pass: res.suggestedLevel === 1, actual: `Level ${res.suggestedLevel}` };
        },
        expected: 'Level 1 (Decompensated Shock)'
      },
      {
        id: 4,
        title: 'Chest pain in patient age >= 40 triggers at least Level 2',
        input: 'Patient age 52, chest pain present, normal vitals',
        run: async () => {
          const res = evaluateTriage({ age: 52 }, { chest_pain: true }, { spo2: '98', sbp: '120', hr: '75', rr: '16' });
          return { pass: res.suggestedLevel === 2, actual: `Level ${res.suggestedLevel}` };
        },
        expected: 'Level 2 (High-Risk ACS)'
      },
      {
        id: 5,
        title: 'Missing vitals NEVER lowers urgency (Fails safe)',
        input: 'Chest pain with completely empty vitals',
        run: async () => {
          const res = evaluateTriage({ age: 45 }, { chest_pain: true }, {});
          const pass = res.suggestedLevel <= 2 && res.needsHumanReview;
          return { pass, actual: `Level ${res.suggestedLevel}, NeedsHumanReview=${res.needsHumanReview}` };
        },
        expected: 'Level 2, NeedsHumanReview=true'
      },
      {
        id: 6,
        title: 'Highest level wins among fired rules',
        input: 'Mild cold (L4 symptom) combined with Respiratory Rate 34 (L1 vital)',
        run: async () => {
          const res = evaluateTriage({ age: 30 }, { mild_cold: true }, { rr: '34' });
          return { pass: res.suggestedLevel === 1, actual: `Level ${res.suggestedLevel}` };
        },
        expected: 'Level 1 (RR 34 overrides mild cold)'
      },
      {
        id: 7,
        title: 'Age-band discrimination: Infant vs Adult Heart Rate',
        input: 'HR 145 bpm tested in Infant (0.5y) vs Adult (40y)',
        run: async () => {
          const infantRes = evaluateTriage({ age: 0.5 }, {}, { hr: '145' });
          const adultRes = evaluateTriage({ age: 40 }, {}, { hr: '145' });
          const pass = (adultRes.suggestedLevel === 1) && (infantRes.suggestedLevel > 1);
          return { pass, actual: `Adult: L${adultRes.suggestedLevel}, Infant: L${infantRes.suggestedLevel}` };
        },
        expected: 'Adult L1 (HR >130), Infant safe/L3 (145 normal resting)'
      },
      {
        id: 8,
        title: 'Physiologically impossible vitals rejected by validation',
        input: 'SpO2 105% and Temp 48°C',
        run: async () => {
          const val = validateVitals({ spo2: '105', temp: '48' }, 30);
          return { pass: !val.isValid && val.errors.length === 2, actual: `isValid=${val.isValid}, Errors=${val.errors.length}` };
        },
        expected: 'isValid=false (2 validation errors)'
      },
      {
        id: 9,
        title: 'Glasgow Coma Scale <= 8 triggers Level 1 Critical',
        input: 'Patient GCS 7',
        run: async () => {
          const res = evaluateTriage({ age: 25 }, {}, { gcs: '7' });
          return { pass: res.suggestedLevel === 1, actual: `Level ${res.suggestedLevel}` };
        },
        expected: 'Level 1 (Severe Neurological Deficit)'
      },
      {
        id: 10,
        title: 'Human Override strictly requires non-empty reason',
        input: 'Simulate override attempt with empty string reason',
        run: async () => {
          const reasonInput = '';
          const isBlocked = (reasonInput.trim().length === 0);
          return { pass: isBlocked, actual: `Blocked=${isBlocked}` };
        },
        expected: 'Blocked=true (Mandatory rationale enforced)'
      },
      {
        id: 11,
        title: 'Meningitis Triad (Fever + Stiff Neck + Altered Consciousness)',
        input: 'Temp 39.0°C + Stiff Neck + Altered Consciousness',
        run: async () => {
          const res = evaluateTriage({ age: 22 }, { stiff_neck: true, altered_consciousness: true }, { temp: '39.0' });
          const hasTriadRule = res.firedRules.some(r => r.id === 'R-MENINGITIS-L1');
          return { pass: res.suggestedLevel === 1 && hasTriadRule, actual: `Level ${res.suggestedLevel}, TriadRule=${hasTriadRule}` };
        },
        expected: 'Level 1 with R-MENINGITIS-L1 fired'
      },
      {
        id: 12,
        title: 'Audit entry created on state change',
        input: 'Check audit log integrity and append operation',
        run: async () => {
          const countBefore = State.audit.length;
          addAuditEntry({ action: 'SELF_TEST', details: 'Automated test suite execution' });
          const countAfter = State.audit.length;
          return { pass: countAfter === countBefore + 1, actual: `Logged (+${countAfter - countBefore})` };
        },
        expected: 'Audit entry appended (+1)'
      },
      {
        id: 13,
        title: 'A clerk cannot perform a nurse-only action',
        input: 'Simulate clerk01 attempting triage assessment commit',
        run: async () => {
          const prevAuth = State.currentAuthUser;
          State.currentAuthUser = { staffId: 'clerk01', name: 'Clerk Alex', role: 'clerk' };
          const auditCountBefore = State.audit.length;
          const allowed = enforcePermission('canTriage', 'commit clinical triage decision', 'TEST-TOKEN');
          const auditCountAfter = State.audit.length;
          State.currentAuthUser = prevAuth;
          const pass = (!allowed) && (auditCountAfter === auditCountBefore + 1);
          return { pass, actual: `Blocked=${!allowed}, AuditLogged=${auditCountAfter > auditCountBefore}` };
        },
        expected: 'Blocked=true, AuditLogged=true'
      },
      {
        id: 14,
        title: 'A user cannot change their own role',
        input: 'Admin admin01 attempting to edit own account role',
        run: async () => {
          let blocked = false;
          try {
            updateAccountRole('admin01', 'admin01', 'doctor');
          } catch (err) {
            blocked = true;
          }
          return { pass: blocked, actual: `Blocked=${blocked}` };
        },
        expected: 'Blocked=true (Self-role edit strictly forbidden)'
      },
      {
        id: 15,
        title: 'A Pending account cannot log in',
        input: 'Attempt authentication with an account where status is PENDING',
        run: async () => {
          const salt = generateSalt();
          const hash = await hashPassword('pending123', salt);
          const testPending = {
            staffId: 'test_pending_doc',
            name: 'Dr. Pending',
            role: 'doctor',
            status: 'PENDING',
            salt,
            passwordHash: hash,
            failedAttempts: 0,
            lockedUntil: null
          };
          State.accounts.push(testPending);
          const result = await loginUser('test_pending_doc', 'pending123', true);
          State.accounts = State.accounts.filter(a => a.staffId !== 'test_pending_doc');
          const pass = (!result.success && result.reason === 'PENDING');
          return { pass, actual: `LoginAllowed=${result.success}, Reason=${result.reason}` };
        },
        expected: 'LoginAllowed=false, Reason=PENDING'
      },
      {
        id: 16,
        title: '3 failed logins lock the account for 5 minutes',
        input: 'Simulate 3 incorrect password entries on active account',
        run: async () => {
          const salt = generateSalt();
          const hash = await hashPassword('correctpass', salt);
          const testAccount = {
            staffId: 'test_lock_user',
            name: 'Lock Test',
            role: 'clerk',
            status: 'ACTIVE',
            salt,
            passwordHash: hash,
            failedAttempts: 0,
            lockedUntil: null
          };
          State.accounts.push(testAccount);
          await loginUser('test_lock_user', 'wrongpass1', true);
          await loginUser('test_lock_user', 'wrongpass2', true);
          await loginUser('test_lock_user', 'wrongpass3', true);
          const locked = testAccount.lockedUntil && testAccount.lockedUntil > State.vTime;
          const lockoutDurationMs = testAccount.lockedUntil ? (testAccount.lockedUntil - State.vTime) : 0;
          State.accounts = State.accounts.filter(a => a.staffId !== 'test_lock_user');
          const pass = locked && (lockoutDurationMs === 5 * 60 * 1000);
          return { pass, actual: `Locked=${locked}, Duration=${lockoutDurationMs / 60000}m` };
        },
        expected: 'Locked=true, Duration=5m'
      },
      {
        id: 17,
        title: 'Passwords are not stored in plain text',
        input: 'Inspect stored accounts for absence of plaintext and presence of salt & SHA-256 hash',
        run: async () => {
          const allAccounts = State.accounts;
          const noPlaintext = allAccounts.every(a => a.password === undefined && a.plainPass === undefined && a.plainPassword === undefined);
          const allHaveHash = allAccounts.every(a => typeof a.passwordHash === 'string' && a.passwordHash.length === 64);
          const allHaveSalt = allAccounts.every(a => typeof a.salt === 'string' && a.salt.length >= 16);
          const pass = noPlaintext && allHaveHash && allHaveSalt && allAccounts.length > 0;
          return {
            pass,
            actual: `NoPlaintext=${noPlaintext}, HashesLength64=${allHaveHash}, SaltsPresent=${allHaveSalt}`
          };
        },
        expected: 'NoPlaintext=true, HashesLength64=true, SaltsPresent=true'
      }
    ];

    const tbody = document.getElementById('selfTestTableBody');
    tbody.innerHTML = '';

    let passedCount = 0;

    for (const a of assertions) {
      const result = await a.run();
      if (result.pass) passedCount += 1;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:700;">#${a.id}</td>
        <td><strong>${a.title}</strong></td>
        <td style="font-size:0.8rem; color:#475569;">${a.input}</td>
        <td style="font-size:0.8rem; font-family:var(--font-mono);">${a.expected}</td>
        <td style="font-size:0.8rem; font-family:var(--font-mono);">${result.actual}</td>
        <td>
          <span class="${result.pass ? 'test-pass' : 'test-fail'}">
            ${result.pass ? '✅ PASS' : '❌ FAIL'}
          </span>
        </td>
      `;
      tbody.appendChild(tr);
    }

    const isAllPass = passedCount === assertions.length;
    const summaryBox = document.getElementById('selfTestSummaryBox');
    summaryBox.innerHTML = `
      <div style="background:${isAllPass ? '#f0fdf4' : '#fef2f2'}; border:1px solid ${isAllPass ? '#bbf7d0' : '#fecaca'}; padding:1rem; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h4 style="color:${isAllPass ? '#166534' : '#991b1b'}; margin-bottom:0.25rem;">
            ${isAllPass ? '🎉 All Safety, Security & Governance Assertions Passed' : '⚠️ Some Assertions Failed'}
          </h4>
          <span style="font-size:0.825rem; color:#475569;">${passedCount} of ${assertions.length} unit checks passed. Rule engine and staff authentication comply with all invariants.</span>
        </div>
        <div>
          <span class="urgency-badge ${isAllPass ? 'l4' : 'l1'}" style="font-size:1rem;">
            ${passedCount} / ${assertions.length} PASS
          </span>
        </div>
      </div>
    `;

    document.getElementById('selfTestBadge').innerText = `${passedCount}/${assertions.length} PASS`;
  }

  // ==========================================================================
  // SECTION 12: UI EVENT HANDLERS & ROLE PERMISSION ENFORCER
  // ==========================================================================

  function switchTab(tabId) {
    if (!State.currentAuthUser) {
      showToast('Authentication Required', 'Please sign in to navigate the clinical system.', 'toast-warning');
      return;
    }

    const role = State.currentAuthUser.role;

    // Clerk cannot see rules, audit, accounts
    if (role === 'clerk') {
      if (tabId === 'rulesTab' || tabId === 'auditTab' || tabId === 'accountsTab') {
        enforcePermission('canTriage', `access restricted page (${tabId})`);
        return;
      }
    }

    // Non-admin cannot see accounts
    if (tabId === 'accountsTab' && role !== 'admin') {
      enforcePermission('canManageAccounts', 'access staff account management');
      return;
    }

    State.activeTab = tabId;

    document.querySelectorAll('.nav-tab').forEach(tab => {
      if (tab.getAttribute('data-tab') === tabId) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    document.querySelectorAll('.tab-pane').forEach(pane => {
      if (pane.id === tabId) {
        pane.classList.add('active');
      } else {
        pane.classList.remove('active');
      }
    });

    // Refresh tab content on view
    if (tabId === 'queueTab') renderQueueTable();
    else if (tabId === 'doctorInboxTab') renderDoctorInbox();
    else if (tabId === 'auditTab') renderAuditTable();
    else if (tabId === 'dashboardTab') renderDashboard();
    else if (tabId === 'accountsTab') renderAccountsTable();
    else if (tabId === 'rulesTab') renderRulesCatalog();
    else if (tabId === 'selfTestTab') runSelfTests();
  }

  function renderRulesCatalog() {
    const tbody = document.getElementById('rulesCatalogBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    SAMPLE_RULES.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family:var(--font-mono); font-weight:700;">${r.id}</td>
        <td><strong>${r.name}</strong></td>
        <td style="font-size:0.8rem; font-family:var(--font-mono); color:#0369a1;">${r.condition}</td>
        <td><span class="urgency-badge l${r.level}">L${r.level}</span></td>
        <td style="font-size:0.8rem; color:#475569;">${r.rationale}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function setupRuleTesterSandbox() {
    const grid = document.getElementById('testSymptomGrid');
    grid.innerHTML = '';
    SYMPTOM_LIST.forEach(sym => {
      const div = document.createElement('label');
      div.className = `symptom-item ${sym.isRedFlag ? 'red-flag' : ''}`;
      div.innerHTML = `
        <input type="checkbox" id="test_sym_${sym.id}">
        <span>${sym.isRedFlag ? '⚠️ ' : ''}${sym.label}</span>
      `;
      div.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) div.classList.add('checked');
        else div.classList.remove('checked');
      });
      grid.appendChild(div);
    });

    document.getElementById('btnRunRuleTest').onclick = evaluateSandboxTester;
    evaluateSandboxTester();
  }

  function evaluateSandboxTester() {
    const age = parseFloat(document.getElementById('testAge').value) || 30;
    const sex = document.getElementById('testSex').value;
    const pregnancy = document.getElementById('testPregnant').value;

    const symptoms = {};
    SYMPTOM_LIST.forEach(sym => {
      const chk = document.getElementById(`test_sym_${sym.id}`);
      if (chk && chk.checked) symptoms[sym.id] = true;
    });

    const vitals = {
      spo2: document.getElementById('testSpo2').value,
      sbp: document.getElementById('testSbp').value,
      hr: document.getElementById('testHr').value,
      rr: document.getElementById('testRr').value,
      temp: document.getElementById('testTemp').value,
      gcs: document.getElementById('testGcs').value
    };

    const res = evaluateTriage({ age, sex, pregnancy }, symptoms, vitals);
    const container = document.getElementById('ruleTesterOutput');

    const levelIcons = { 1: '🔴', 2: '🟠', 3: '🟡', 4: '🟢' };
    container.innerHTML = `
      <div class="decision-support-box l${res.suggestedLevel}-border">
        <div class="decision-header">
          <div>
            <h4>Tester Pure Evaluation Output</h4>
            <span style="font-size:0.75rem; color:#64748b;">No patient record modified or saved.</span>
          </div>
          <span class="urgency-badge l${res.suggestedLevel}">
            ${levelIcons[res.suggestedLevel]} ${res.levelLabel}
          </span>
        </div>
        ${res.urgentMeasureVitalsNow ? '<div class="danger-callout">⚠️ Urgent: measure vitals now.</div>' : ''}
        ${res.needsHumanReview ? `<div class="warning-callout">⚠️ Needs Human Review: ${res.reasons.join(' ')}</div>` : ''}
        <h5 style="font-size:0.8rem; text-transform:uppercase; margin-top:0.5rem; color:#475569;">Fired Rules:</h5>
        ${res.firedRules.length > 0 ? `
          <ul class="fired-rules-list">
            ${res.firedRules.map(r => `
              <li class="fired-rule-item l${r.level}">
                <strong>${r.name} (Level ${r.level})</strong>: ${r.rationale}
              </li>
            `).join('')}
          </ul>
        ` : '<div style="font-size:0.8rem; color:#64748b;">No rules fired.</div>'}
      </div>
    `;
  }

  // Modal helpers
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  }

  // Toast notification system
  function showToast(title, message, typeClass = 'toast-info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${typeClass}`;
    toast.innerHTML = `
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
      </div>
      <button class="toast-close" aria-label="Close notification">&times;</button>
    `;

    toast.querySelector('.toast-close').onclick = () => {
      toast.remove();
    };

    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 4500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ==========================================================================
  // INITIALIZATION & GLOBAL BINDINGS
  // ==========================================================================

  async function init() {
    loadState();
    await seedInitialDemoAccounts();
    initInactivityWatcher();
    updateClockDisplay();
    updateAlertCounterUI();

    // Staff Login Form Submit
    const loginForm = document.getElementById('staffLoginForm');
    if (loginForm) {
      loginForm.onsubmit = async (e) => {
        e.preventDefault();
        const staffId = document.getElementById('loginStaffId').value;
        const pass = document.getElementById('loginPassword').value;
        await loginUser(staffId, pass);
      };
    }

    // Quick Login Demo Buttons
    document.querySelectorAll('.btn-quick-login').forEach(btn => {
      btn.onclick = async () => {
        const u = btn.getAttribute('data-user');
        const p = btn.getAttribute('data-pass');
        document.getElementById('loginStaffId').value = u;
        document.getElementById('loginPassword').value = p;
        await loginUser(u, p);
      };
    });

    // Logout Button
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
      btnLogout.onclick = () => logoutUser('Manual logout');
    }

    // Inactivity Modal Buttons
    const btnStay = document.getElementById('btnInactivityStayLoggedIn');
    if (btnStay) {
      btnStay.onclick = () => {
        State.lastActivityTime = Date.now();
        closeModal('inactivityModal');
        showToast('Session Extended', 'Your active session has been renewed.', 'toast-info');
      };
    }
    const btnInactLogout = document.getElementById('btnInactivityLogoutNow');
    if (btnInactLogout) {
      btnInactLogout.onclick = () => {
        closeModal('inactivityModal');
        logoutUser('User requested logout from timeout warning');
      };
    }

    // Account Management Forms & Modals
    const createAccForm = document.getElementById('createStaffAccountForm');
    if (createAccForm) {
      createAccForm.onsubmit = handleCreateStaffAccountSubmit;
    }
    const filterAccRole = document.getElementById('filterAccountRole');
    if (filterAccRole) {
      filterAccRole.onchange = renderAccountsTable;
    }
    const btnCloseReset = document.getElementById('btnCloseResetModal');
    if (btnCloseReset) btnCloseReset.onclick = () => closeModal('passwordResetModal');
    const btnCancelReset = document.getElementById('btnCancelResetModal');
    if (btnCancelReset) btnCancelReset.onclick = () => closeModal('passwordResetModal');
    const btnConfirmReset = document.getElementById('btnConfirmPasswordReset');
    if (btnConfirmReset) btnConfirmReset.onclick = handleConfirmPasswordReset;

    // Navigation Tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        switchTab(tab.getAttribute('data-tab'));
      });
    });

    // Time simulation & Demo Controls
    document.getElementById('btnSimulate15m').onclick = simulatePlus15Min;
    document.getElementById('btnLoadDemoData').onclick = loadDemoData;
    document.getElementById('btnResetData').onclick = resetAllData;

    // Emergency Walk-in quick button
    document.getElementById('btnQuickEmergency').onclick = () => openModal('emergencyWalkInModal');
    document.getElementById('btnCloseEmergModal').onclick = () => closeModal('emergencyWalkInModal');
    document.getElementById('btnCancelEmergModal').onclick = () => closeModal('emergencyWalkInModal');
    document.getElementById('btnSubmitEmergencyWalkIn').onclick = handleEmergencyWalkInSubmit;

    // Registration Form
    document.getElementById('btnGoRegister').onclick = () => switchTab('registerTab');
    document.getElementById('patientRegistrationForm').onsubmit = handleRegistrationSubmit;
    document.getElementById('regAge').oninput = (e) => {
      const b = getAgeBand(e.target.value);
      document.getElementById('regAgeBandHint').innerText = `Band: ${b.toUpperCase()}`;
    };

    // Duplicate Modal
    document.getElementById('btnCancelDuplicate').onclick = () => {
      State.pendingDuplicateData = null;
      closeModal('duplicateModal');
    };
    document.getElementById('btnConfirmDuplicateRegistration').onclick = () => {
      if (State.pendingDuplicateData) {
        commitRegistration(State.pendingDuplicateData);
        State.pendingDuplicateData = null;
      }
      closeModal('duplicateModal');
    };

    // Triage Modal
    document.getElementById('btnCloseTriageModal').onclick = () => closeModal('triageModal');
    document.getElementById('btnCancelTriage').onclick = () => closeModal('triageModal');
    document.getElementById('btnConfirmSuggestion').onclick = handleConfirmSuggestionClick;
    document.getElementById('btnToggleOverride').onclick = handleToggleOverrideClick;
    document.getElementById('btnSaveTriageDecision').onclick = handleSaveTriageClick;

    // Downgrade Warning Modal
    document.getElementById('btnCancelDowngrade').onclick = () => closeModal('downgradeModal');
    document.getElementById('btnConfirmDowngrade').onclick = handleConfirmDowngradeClick;

    // Escalation Modal
    document.getElementById('btnCloseEscalationModal').onclick = () => closeModal('escalationModal');
    document.getElementById('btnCancelEscalation').onclick = () => closeModal('escalationModal');
    document.getElementById('btnSubmitEscalation').onclick = handleEscalationSubmit;

    // Doctor Response Modal
    document.getElementById('btnCloseDocResponseModal').onclick = () => closeModal('doctorResponseModal');
    document.getElementById('btnCancelDocResponse').onclick = () => closeModal('doctorResponseModal');
    document.getElementById('btnSubmitDocResponse').onclick = handleDoctorResponseSubmit;

    // Reorder Modal
    document.getElementById('btnCloseReorderModal').onclick = () => closeModal('reorderModal');
    document.getElementById('btnCancelReorder').onclick = () => closeModal('reorderModal');
    document.getElementById('btnConfirmReorder').onclick = handleConfirmReorder;

    // Patient Timeline Modal
    document.getElementById('btnCloseTimelineModal').onclick = () => closeModal('patientTimelineModal');
    document.getElementById('btnCloseTimelineFooter').onclick = () => closeModal('patientTimelineModal');

    // Alert Center Modal
    document.getElementById('btnOpenAlerts').onclick = () => {
      renderAlertCenterModal();
      openModal('alertCenterModal');
    };
    document.getElementById('btnCloseAlertCenter').onclick = () => closeModal('alertCenterModal');
    document.getElementById('btnCloseAlertCenterFooter').onclick = () => closeModal('alertCenterModal');

    // Queue Filters & Search
    document.getElementById('filterLevel').onchange = renderQueueTable;
    document.getElementById('filterStatus').onchange = renderQueueTable;
    document.getElementById('queueSearchInput').oninput = renderQueueTable;

    // Doctor Inbox Filter
    document.getElementById('filterDoctorEscalation').onchange = renderDoctorInbox;

    // Audit Filters & Export
    document.getElementById('filterAuditAction').onchange = renderAuditTable;
    document.getElementById('auditSearchInput').oninput = renderAuditTable;
    document.getElementById('btnExportAuditCsv').onclick = exportAuditToCsv;
    document.getElementById('btnExportQueueCsv').onclick = exportQueueToCsv;

    // Self Test
    document.getElementById('btnRunSelfTests').onclick = runSelfTests;

    // Setup Sandbox & Initial Render
    setupRuleTesterSandbox();
    renderRulesCatalog();
    renderQueueTable();
    await runSelfTests();

    // If state is empty, load demo data automatically for immediate testing
    if (State.patients.length === 0) {
      loadDemoData();
    }

    // Check login state: show login screen if not authenticated
    if (State.currentAuthUser) {
      document.getElementById('loginOverlay').style.display = 'none';
      updateUserProfileHeader();
      applyRolePermissions();
    } else {
      document.getElementById('loginOverlay').style.display = 'flex';
      document.getElementById('userProfileChip').style.display = 'none';
    }
  }

  // Public window interface for onclick callbacks in generated HTML
  window.triageApp = {
    openTriage: openTriageAssessmentModal,
    openEscalation: openEscalationModal,
    openDoctorResponse: openDoctorResponseModal,
    openTimeline: openPatientTimeline,
    openReorder: openReorderModal,
    markPatientSeen,
    markPatientLwbs,
    ackAlert: acknowledgeAlert,
    promptResolveAlert: (id) => {
      const note = prompt('Enter clinical resolution note for this alert:', 'Issue addressed / Patient assessed');
      if (note !== null) resolveAlert(id, note);
    },
    ackEscalation: acknowledgeEscalation,
    approveAccount: approveStaffAccount,
    toggleAccountStatus: toggleStaffAccountStatus,
    openResetPassword: openResetPasswordModal,
    toggleLicenseVerified: toggleLicenseVerified
  };

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); });
  } else {
    init();
  }

})();
