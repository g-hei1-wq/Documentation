(() => {
  'use strict';

  const KEYS = { users: 'fieldnotes.users.v1', records: 'fieldnotes.records.v1', session: 'fieldnotes.session.v1' };
  const MAX_BYTES = 500 * 1024 * 1024;
  const MAX_WORDS = 1000;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const today = new Date().toISOString().slice(0, 10);
  const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const safe = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const words = value => value.trim() ? value.trim().split(/\s+/).length : 0;
  const formatDate = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date';
  const formatSize = size => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
  const initials = name => name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();

  function load(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }
  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  let users = load(KEYS.users, null);
  if (!users) {
    users = [
      { id: 'user-admin', name: 'Morgan Ellis', email: 'admin@example.com', password: 'admin123', role: 'admin', joined: today },
      { id: 'user-alex', name: 'Alex Morgan', email: 'alex@example.com', password: 'demo123', role: 'user', joined: today }
    ];
    save(KEYS.users, users);
  }
  let records = load(KEYS.records, null);
  if (!records) {
    records = [
      { id: 'record-1', fullName: 'Morgan Ellis', date: today, type: 'Important', description: 'Revised the service access layout after the site review. The equipment clearance was increased and the maintenance route moved to the north wall.', authorId: 'user-admin', authorName: 'Morgan Ellis', createdAt: new Date().toISOString(), attachments: [], sharedWith: [] },
      { id: 'record-2', fullName: 'Alex Morgan', date: today, type: 'Middle', description: 'Updated the material schedule to reflect the approved finish change in the west corridor.', authorId: 'user-alex', authorName: 'Alex Morgan', createdAt: new Date(Date.now() - 86400000).toISOString(), attachments: [], sharedWith: [] },
      { id: 'record-3', fullName: 'Alex Morgan', date: today, type: 'Recent', description: 'Added the latest site photos and marked the cabinet alignment for the next review.', authorId: 'user-alex', authorName: 'Alex Morgan', createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), attachments: [], sharedWith: [] }
    ];
    save(KEYS.records, records);
  }

  let currentUser = users.find(user => user.id === load(KEYS.session, null)) || null;
  let currentFilter = 'All';
  let currentAdminTab = 'people';
  let toastTimer;
  let dbPromise;

  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('This browser does not support file storage.'));
      const request = indexedDB.open('fieldnotes-files-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open file storage.'));
    });
    return dbPromise;
  }
  async function storeFiles(files) {
    if (!files.length) return [];
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('files', 'readwrite');
      const stored = files.map(file => {
        const id = makeId();
        transaction.objectStore('files').put({ id, file });
        return { id, name: file.name, size: file.size, type: file.type || 'application/octet-stream' };
      });
      transaction.oncomplete = () => resolve(stored);
      transaction.onerror = () => reject(transaction.error || new Error('File storage failed. Your browser may not have enough free space.'));
      transaction.onabort = () => reject(transaction.error || new Error('File storage was cancelled.'));
    });
  }
  async function getFile(id) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction('files', 'readonly').objectStore('files').get(id);
      request.onsuccess = () => resolve(request.result?.file || null);
      request.onerror = () => reject(request.error);
    });
  }

  const loginView = $('#loginView');
  const workspaceView = $('#workspaceView');
  const modalBackdrop = $('#modalBackdrop');
  const modalContent = $('#modalContent');
  const toastElement = $('#toast');

  function showToast(message) {
    toastElement.textContent = message;
    toastElement.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastElement.classList.remove('show'), 2700);
  }
  function visibleRecords() {
    if (!currentUser) return [];
    if (currentUser.role === 'admin') return records;
    return records.filter(record => record.authorId === currentUser.id || (record.sharedWith || []).includes(currentUser.id));
  }
  function showLogin() {
    loginView.classList.remove('hidden');
    workspaceView.classList.add('hidden');
    $('#loginEmail').focus();
  }
  function showWorkspace() {
    if (!currentUser) return showLogin();
    loginView.classList.add('hidden');
    workspaceView.classList.remove('hidden');
    $('#userName').textContent = currentUser.name;
    $('#userRole').textContent = currentUser.role === 'admin' ? 'Administrator' : 'Workspace member';
    $('#userAvatar').textContent = initials(currentUser.name);
    $$('.admin-only').forEach(el => el.classList.toggle('hidden', currentUser.role !== 'admin'));
    $('#todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    showRecords();
  }

  function renderRecords() {
    const shown = visibleRecords();
    const query = $('#recordSearch').value.trim().toLowerCase();
    const filtered = shown.filter(record => (currentFilter === 'All' || record.type === currentFilter) && `${record.fullName} ${record.description} ${record.type} ${record.authorName}`.toLowerCase().includes(query));
    $('#navRecordCount').textContent = shown.length;
    $('#allCount').textContent = shown.length;
    $('#visibleCount').textContent = `${filtered.length} ${filtered.length === 1 ? 'record' : 'records'}`;
    const totals = { Important: shown.filter(record => record.type === 'Important').length, Middle: shown.filter(record => record.type === 'Middle').length, Recent: shown.filter(record => record.type === 'Recent').length };
    $('#summaryStrip').innerHTML = `<div class="summary-cell"><span>Total records</span><strong>${shown.length}</strong><span class="sum-mark">&#9638;</span></div><div class="summary-cell important"><span>Important</span><strong>${totals.Important}</strong><span class="sum-mark">&#9679;</span></div><div class="summary-cell middle"><span>Middle</span><strong>${totals.Middle}</strong><span class="sum-mark">&#9679;</span></div><div class="summary-cell recent"><span>Recent</span><strong>${totals.Recent}</strong><span class="sum-mark">&#9679;</span></div>`;
    $('#recordsSubtitle').textContent = currentUser.role === 'admin' ? 'A shared view of every documented change.' : 'Your records and the changes shared with you.';
    $('#recordList').innerHTML = filtered.map(record => {
      const attachmentCount = (record.attachments || []).length;
      const description = record.description.replace(/\s+/g, ' ').slice(0, 92);
      return `<button class="record-row" type="button" data-record-id="${safe(record.id)}" aria-label="Open record: ${safe(record.fullName)}"><span class="record-title"><i class="record-bar ${safe(record.type)}"></i><span class="record-title-copy"><strong>${safe(record.fullName)}</strong><small>${safe(description)}${record.description.length > 92 ? '...' : ''}</small></span></span><span class="priority-tag ${safe(record.type)}"><i class="level-dot level-${safe(record.type.toLowerCase())}"></i>${safe(record.type)}</span><span class="row-date">${formatDate(record.date)}</span><span class="row-author">${safe(record.authorName)}</span><span class="row-files">${attachmentCount ? `<span class="file-count">&#8595; ${attachmentCount}</span>` : '<span class="row-files">&#8212;</span>'}</span></button>`;
    }).join('');
    $('#emptyState').classList.toggle('hidden', filtered.length > 0);
    $('#recordList').classList.toggle('hidden', filtered.length === 0);
    if (shown.length === 0) $('#emptyState h3').textContent = 'No records here yet';
    else if (filtered.length === 0) $('#emptyState h3').textContent = 'No matching records';
    $$('.record-row').forEach(row => row.addEventListener('click', () => openRecord(row.dataset.recordId)));
  }

  function showModal(content, wide = false) {
    modalContent.classList.toggle('modal-wide', wide);
    modalContent.innerHTML = content;
    modalBackdrop.classList.remove('hidden');
    $('input, textarea, select, button', modalContent)?.focus();
  }
  function closeModal() {
    modalBackdrop.classList.add('hidden');
    modalContent.innerHTML = '';
  }
  function openRecordForm() {
    showModal(`<div class="modal-header"><div><p class="eyebrow">CHANGE DOCUMENTATION</p><h2 id="modalTitle">New record</h2><p>Capture the details while they are fresh.</p></div><button class="modal-close" type="button" aria-label="Close">&times;</button></div><form class="modal-body" id="recordForm"><div class="form-grid"><label class="field-label">Documentation type<select class="field-select" id="recordType" required><option value="Important">Important</option><option value="Middle">Middle</option><option value="Recent" selected>Recent</option></select></label><label class="field-label">Date<input class="field-input" id="recordDate" type="date" value="${today}" required></label><label class="field-label field-span">Full name<input class="field-input" id="recordFullName" type="text" maxlength="120" value="${safe(currentUser.name)}" required></label><div class="field-label field-span">Drawings / Sketches<div class="upload-box"><span class="upload-icon">&#8593;</span><input id="drawingFiles" type="file" multiple aria-label="Upload drawings and sketches"></div><span class="upload-note">Each file up to 500 MB. Multiple files allowed.</span><div class="selected-files" id="drawingNames"></div></div><div class="field-label field-span">Photos of the Change<div class="upload-box"><span class="upload-icon">&#8593;</span><input id="photoFiles" type="file" accept="image/*" multiple aria-label="Upload photos of the change"></div><span class="upload-note">Each file up to 500 MB. Multiple image files allowed.</span><div class="selected-files" id="photoNames"></div></div><label class="field-label field-span">Description what changed<textarea class="field-textarea" id="recordDescription" placeholder="Describe what changed, why it changed, and any relevant context..." required></textarea><span class="field-hint">Up to 1000 words <span class="word-count" id="wordCount">0 / 1000</span></span></label></div><p class="form-error" id="recordError" role="alert"></p><div class="modal-actions"><button class="button button-secondary" type="button" data-close>Cancel</button><button class="button button-primary" type="submit">Save record <span aria-hidden="true">&#8594;</span></button></div></form>`, true);
    $('#recordDescription').addEventListener('input', event => {
      const count = words(event.target.value);
      $('#wordCount').textContent = `${count} / ${MAX_WORDS}`;
      $('#wordCount').style.color = count > MAX_WORDS ? 'var(--red)' : '';
    });
    [['drawingFiles', 'drawingNames'], ['photoFiles', 'photoNames']].forEach(([inputId, namesId]) => {
      $(`#${inputId}`).addEventListener('change', event => {
        const selected = [...event.target.files];
        if (selected.some(file => file.size > MAX_BYTES)) {
          event.target.value = '';
          $(`#${namesId}`).textContent = '';
          $('#recordError').textContent = 'Each file must be 500 MB or smaller. Remove the oversized file and try again.';
          return;
        }
        $('#recordError').textContent = '';
        $(`#${namesId}`).textContent = selected.map(file => `${file.name} (${formatSize(file.size)})`).join(' · ');
      });
    });
    $('#recordForm').addEventListener('submit', submitRecord);
  }

  async function submitRecord(event) {
    event.preventDefault();
    const description = $('#recordDescription').value.trim();
    if (words(description) > MAX_WORDS) return $('#recordError').textContent = `Description is over the ${MAX_WORDS}-word limit.`;
    const drawings = [...$('#drawingFiles').files];
    const photos = [...$('#photoFiles').files];
    const button = $('button[type="submit"]', event.currentTarget);
    button.disabled = true;
    button.textContent = 'Saving...';
    try {
      const [drawingAttachments, photoAttachments] = await Promise.all([storeFiles(drawings), storeFiles(photos)]);
      const record = {
        id: makeId(), fullName: $('#recordFullName').value.trim(), date: $('#recordDate').value,
        type: $('#recordType').value, description, authorId: currentUser.id, authorName: currentUser.name,
        createdAt: new Date().toISOString(), attachments: [...drawingAttachments.map(file => ({ ...file, category: 'Drawing / Sketch' })), ...photoAttachments.map(file => ({ ...file, category: 'Photo' }))], sharedWith: []
      };
      records.unshift(record);
      save(KEYS.records, records);
      closeModal();
      currentFilter = 'All';
      $$('.filter-tab').forEach(tab => tab.classList.toggle('selected', tab.dataset.filter === 'All'));
      renderRecords();
      showToast('Record saved to this browser.');
    } catch (error) {
      $('#recordError').textContent = error.message || 'Could not save these files. Check browser storage and try again.';
      button.disabled = false;
      button.innerHTML = 'Save record <span aria-hidden="true">&#8594;</span>';
    }
  }

  async function openRecord(id) {
    const record = records.find(item => item.id === id);
    if (!record) return;
    const allowed = currentUser.role === 'admin' || record.authorId === currentUser.id || (record.sharedWith || []).includes(currentUser.id);
    if (!allowed) return showToast('You do not have access to this record.');
    const attachments = record.attachments || [];
    showModal(`<div class="modal-header"><div><p class="eyebrow">${safe(record.type.toUpperCase())} CHANGE</p><h2 id="modalTitle">${safe(record.fullName)}</h2><p>Submitted by ${safe(record.authorName)}</p></div><button class="modal-close" type="button" aria-label="Close">&times;</button></div><div class="modal-body"><div class="detail-meta"><div><span>DATE</span><strong>${formatDate(record.date)}</strong></div><div><span>DOCUMENTATION TYPE</span><strong><i class="priority-tag ${safe(record.type)}">${safe(record.type)}</i></strong></div><div><span>SUBMITTED BY</span><strong>${safe(record.authorName)}</strong></div></div><section class="detail-section"><h3>DESCRIPTION WHAT CHANGED</h3><div class="detail-description">${safe(record.description)}</div></section><section class="detail-section"><h3>DRAWINGS / SKETCHES &amp; PHOTOS</h3><div class="attachment-list" id="attachmentList">${attachments.length ? attachments.map(file => `<a class="attachment-link" href="#" data-file-id="${safe(file.id)}"><span aria-hidden="true">&#8595;</span><span>${safe(file.name)}</span><small>${safe(file.category)} &middot; ${formatSize(file.size)}</small></a>`).join('') : '<p class="muted">No files attached to this record.</p>'}</div></section><div class="modal-actions"><button class="button button-secondary" type="button" data-close>Close</button></div></div>`);
    $$('[data-file-id]', modalContent).forEach(link => link.addEventListener('click', async event => {
      event.preventDefault();
      try {
        const file = await getFile(link.dataset.fileId);
        if (!file) return showToast('This file is not available in local browser storage.');
        const url = URL.createObjectURL(file);
        const download = document.createElement('a');
        download.href = url;
        download.download = file.name;
        download.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch {
        showToast('Could not retrieve this file.');
      }
    }));
  }

  function renderPeople() {
    $('#peopleCount').textContent = users.length;
    $('#peopleList').innerHTML = users.map(user => `<div class="person-row"><span class="person-identity"><span class="avatar">${safe(initials(user.name))}</span><span><strong>${safe(user.name)}</strong><small>${safe(user.email)}</small></span></span><span class="role-chip ${user.role === 'admin' ? 'admin' : ''}">${user.role === 'admin' ? 'Administrator' : 'Member'}</span><span class="person-date">${formatDate(user.joined)}</span><button class="table-action" type="button" data-reset-user="${safe(user.id)}">Change password</button></div>`).join('');
    $$('[data-reset-user]').forEach(button => button.addEventListener('click', () => openPasswordForm(button.dataset.resetUser)));
  }
  function renderAccess() {
    const adminRecords = records;
    $('#accessEmpty').classList.toggle('hidden', adminRecords.length > 0);
    $('#accessList').innerHTML = adminRecords.map(record => {
      const shared = record.sharedWith || [];
      const options = users.filter(user => user.id !== record.authorId).map(user => `<label class="access-option"><input type="checkbox" value="${safe(user.id)}" ${shared.includes(user.id) ? 'checked' : ''}>${safe(user.name)}${user.role === 'admin' ? ' (admin)' : ''}</label>`).join('');
      return `<article class="access-card" data-access-record="${safe(record.id)}"><div class="access-card-top"><div><h3>${safe(record.fullName)}</h3><p>${safe(record.type)} &middot; ${formatDate(record.date)} &middot; by ${safe(record.authorName)}</p></div><span class="priority-tag ${safe(record.type)}">${safe(record.type)}</span></div><div class="access-options">${options || '<span class="muted">No other people in the workspace.</span>'}</div><button class="button button-secondary access-save" type="button" data-save-access="${safe(record.id)}">Save access</button></article>`;
    }).join('');
    $$('[data-save-access]').forEach(button => button.addEventListener('click', () => {
      const record = records.find(item => item.id === button.dataset.saveAccess);
      const card = button.closest('.access-card');
      record.sharedWith = $$('input[type="checkbox"]:checked', card).map(input => input.value);
      save(KEYS.records, records);
      if (currentUser.role !== 'admin') renderRecords();
      showToast('Record access updated.');
    }));
  }
  function showAdmin() {
    if (currentUser.role !== 'admin') return;
    $('#recordsView').classList.add('hidden');
    $('#adminView').classList.remove('hidden');
    $('#pageCrumb').textContent = 'Administration';
    $('.nav-item[data-view="records"]').classList.remove('active');
    $('.nav-item[data-view="admin"]').classList.add('active');
    renderPeople();
    renderAccess();
  }
  function showRecords() {
    $('#adminView').classList.add('hidden');
    $('#recordsView').classList.remove('hidden');
    $('#pageCrumb').textContent = 'Change records';
    $('.nav-item[data-view="records"]').classList.add('active');
    $('.nav-item[data-view="admin"]')?.classList.remove('active');
    renderRecords();
  }

  function openUserForm() {
    showModal(`<div class="modal-header"><div><p class="eyebrow">WORKSPACE PEOPLE</p><h2 id="modalTitle">Add a person</h2><p>Create a sign-in and choose their workspace role.</p></div><button class="modal-close" type="button" aria-label="Close">&times;</button></div><form class="modal-body" id="userForm"><div class="form-grid"><label class="field-label field-span">Full name<input class="field-input" id="newUserName" required maxlength="120"></label><label class="field-label field-span">Email address<input class="field-input" id="newUserEmail" type="email" required></label><label class="field-label">Temporary password<input class="field-input" id="newUserPassword" type="password" minlength="6" required></label><label class="field-label">Workspace role<select class="field-select" id="newUserRole"><option value="user">Member</option><option value="admin">Administrator</option></select></label></div><p class="form-error" id="userError" role="alert"></p><div class="modal-actions"><button class="button button-secondary" type="button" data-close>Cancel</button><button class="button button-primary" type="submit">Create account</button></div></form>`);
    $('#userForm').addEventListener('submit', event => {
      event.preventDefault();
      const email = $('#newUserEmail').value.trim().toLowerCase();
      if (users.some(user => user.email.toLowerCase() === email)) return $('#userError').textContent = 'An account already uses this email address.';
      users.push({ id: makeId(), name: $('#newUserName').value.trim(), email, password: $('#newUserPassword').value, role: $('#newUserRole').value, joined: today });
      save(KEYS.users, users);
      closeModal();
      renderPeople();
      renderAccess();
      showToast('Account created. Share the sign-in details securely.');
    });
  }
  function openPasswordForm(userId) {
    const user = users.find(item => item.id === userId);
    if (!user || currentUser.role !== 'admin') return;
    showModal(`<div class="modal-header"><div><p class="eyebrow">ACCOUNT SECURITY</p><h2 id="modalTitle">Change password</h2><p>Set a new password for ${safe(user.name)}.</p></div><button class="modal-close" type="button" aria-label="Close">&times;</button></div><form class="modal-body" id="passwordForm"><label class="field-label">New password<input class="field-input" id="newPassword" type="password" minlength="6" required autofocus></label><p class="form-error" id="passwordError" role="alert"></p><div class="modal-actions"><button class="button button-secondary" type="button" data-close>Cancel</button><button class="button button-primary" type="submit">Update password</button></div></form>`);
    $('#passwordForm').addEventListener('submit', event => {
      event.preventDefault();
      user.password = $('#newPassword').value;
      save(KEYS.users, users);
      closeModal();
      showToast(`Password updated for ${user.name}.`);
    });
  }

  $('#loginForm').addEventListener('submit', event => {
    event.preventDefault();
    const email = $('#loginEmail').value.trim().toLowerCase();
    const password = $('#loginPassword').value;
    const user = users.find(item => item.email.toLowerCase() === email && item.password === password);
    if (!user) return $('#loginError').textContent = 'That email and password combination was not recognized.';
    currentUser = user;
    save(KEYS.session, currentUser.id);
    $('#loginError').textContent = '';
    showWorkspace();
  });
  $('#signOutButton').addEventListener('click', () => {
    currentUser = null;
    localStorage.removeItem(KEYS.session);
    showLogin();
  });
  $('#newRecordButton').addEventListener('click', openRecordForm);
  $('#emptyNewButton').addEventListener('click', openRecordForm);
  $('#recordSearch').addEventListener('input', renderRecords);
  $$('.filter-tab').forEach(tab => tab.addEventListener('click', () => {
    currentFilter = tab.dataset.filter;
    $$('.filter-tab').forEach(item => item.classList.toggle('selected', item === tab));
    renderRecords();
  }));
  $$('.nav-item').forEach(item => item.addEventListener('click', () => item.dataset.view === 'admin' ? showAdmin() : showRecords()));
  $$('.admin-tab').forEach(tab => tab.addEventListener('click', () => {
    currentAdminTab = tab.dataset.adminTab;
    $$('.admin-tab').forEach(item => item.classList.toggle('selected', item === tab));
    $('#peoplePanel').classList.toggle('hidden', currentAdminTab !== 'people');
    $('#accessPanel').classList.toggle('hidden', currentAdminTab !== 'access');
  }));
  $('#addUserButton').addEventListener('click', openUserForm);
  $('#profileButton').addEventListener('click', () => showToast(`${currentUser.name} · ${currentUser.role === 'admin' ? 'Administrator' : 'Workspace member'}`));
  modalBackdrop.addEventListener('click', event => {
    if (event.target === modalBackdrop || event.target.closest('[data-close]') || event.target.closest('.modal-close')) closeModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modalBackdrop.classList.contains('hidden')) closeModal();
  });

  showWorkspace();
})();
