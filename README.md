# Medi Flow – OPD Triage Decision Support System

Medi Flow is a lightweight, responsive Outpatient Department (OPD) decision-support web prototype designed to reinforce reliable data processing, secure staff governance, and clinical human oversight in outpatient triage.

---

## 🚀 How to Open
1. Double-click or open `index.html` directly in any modern web browser (Google Chrome, Microsoft Edge, Mozilla Firefox, or Apple Safari).
2. **Zero installation:** No Node.js, no npm, no build steps, and no web server required.
3. Everything runs locally in the browser with state stored in `localStorage`.

---

## 🔐 Staff Authentication & Role Governance
- **No Public Sign-Up:** Roles cannot be selected arbitrarily. Access requires authentication with a pre-provisioned synthetic Staff ID and password.
- **Web Crypto Salted Hashing:** Passwords are never stored in plain text. Each account stores an individual cryptographic salt and a 64-character SHA-256 hash computed using the browser's native Web Crypto API (`window.crypto.subtle.digest`).
- **Lockout Protection:** Three consecutive failed login attempts trigger an immediate 5-minute security lockout. Every login attempt, failure, lockout, and logout is written to the immutable audit trail.
- **Inactivity Session Expiry:** Automated 10-minute inactivity timer with a 60-second warning countdown modal; automatically logs out unattended terminals.
- **Two-Person Governance (Admin Only):** New Doctor and Administrator accounts are created in `PENDING` status and strictly require activation by a *different* administrator before login is permitted (self-approval blocked).
- **Medical Council License Verification:** Clinical accounts include a statutory registration/license number field with a "Verify against official council registry before activating" safeguard and verification toggle.
- **Role Permissions & Tamper Resistance:** Permissions are checked programmatically on every action (blocking and audit-logging unauthorized attempts). Clerks are strictly restricted from triage assessment controls, clinical escalations, priority reordering, and the Rules, Audit, and Accounts tabs. Users are prevented from modifying their own roles or deactivating their own logged-in accounts.

---

## 🛡️ Safety Design & Core Principles
- **Decision Support Only:** The tool never diagnoses or makes final clinical decisions; final triage determination remains strictly with a qualified clinician.
- **Deterministic & Rule-Based:** Uses an explicit, deterministic rule engine without opaque AI/LLM scoring. Every recommendation explicitly lists the exact rules that fired along with their clinical rationale.
- **Fail-Safe Design:** Missing or conflicting physiological vitals never lower urgency. Unassessed or incomplete presentations default safe to Level 3 ("Needs human review") and highlight missing vitals.
- **Human Confirmation & Oversight:** Every recommendation requires a human clinician to either **Confirm** or **Override**. Overrides mandate a written clinical justification. Down-grading urgency below a system recommendation requires a secondary confirmation dialog and is automatically flagged for doctor review.
- **Accessible Urgency Presentation:** Urgency is never conveyed through color alone; it always pairs **Color + Icon + Explicit Text** (🔴 Level 1 - Critical, 🟠 Level 2 - Urgent, 🟡 Level 3 - Semi-urgent, 🟢 Level 4 - Non-urgent).
- **Immutable Audit Logging:** All registrations, suggestions, confirmations, overrides, queue shifts, alerts, and escalations append to an immutable audit trail with diff tracking and CSV export.

---

## ⚠️ Prototype Limitations (Non-Production Disclaimers)
1. **Browser-Simulated Auth:** Authentication, hashing, and session timeouts run in client-side JavaScript. Real deployment requires server-side authentication, MFA/OTP tokens, hospital SSO/Active Directory integration, and programmatic API checks against national medical council registries.
2. **Local Storage Persistence:** State is persisted in browser `localStorage`. Real deployment requires a HIPAA/GDPR-compliant database with TLS 1.3 transit encryption, AES-256 at-rest disk encryption, and distributed multi-terminal concurrency.
3. **Clinical Interoperability:** Does not interface with HL7 v2 / FHIR clinical message feeds, Electronic Health Records (EHR/EMR), or hospital master patient indexes (MPI).
4. **Regulatory Classification:** This prototype is not certified as Software as a Medical Device (SaMD) by CDSCO, FDA, or CE and requires formal clinical steering review prior to clinical trials.

---

## ⚖️ Real vs. Simulated Summary
1. **REAL:** Deterministic clinical triage rule engine, physiological range validation, human confirmation/override guardrails, Web Crypto salted SHA-256 password hashing, append-only audit logging, and 17 automated safety/security assertions.
2. **SIMULATED:** Authentication backend, hospital SSO, council registry API checks, session token exchange, and multi-user concurrency (all executed locally within browser memory and localStorage).
3. **SIMULATED:** Clinical hardware telemetry (vital signs, SpO2, and ECG feeds are entered manually via synthetic demo data rather than live biomedical devices).
