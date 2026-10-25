import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { Upload } from 'https://esm.sh/tus-js-client@4';

(() => {
  'use strict';

  const config = window.RACING_PROTOCOLS_SUPABASE || {};
  const supabase = config.url && config.anonKey ? createClient(config.url, config.anonKey) : null;
  const MAX_BYTES = 500 * 1024 * 1024;
  const MAX_WORDS = 1000;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const today = new Date().toISOString().slice(0, 10);
  const makeId = () => crypto.randomUUID();
  const safe = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const words = value => value.trim() ? value.trim().split(/\s+/).length : 0;
  const formatDate = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date';
  const formatSize = size => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
  const initials = name => (name || '?').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();

  let currentUser = null;
  let users = [];
  let records = [];
  let currentFilter = 'All';
  let currentAdminTab = 'people';
  let toastTimer;

  const loginView = $('#loginView');
  const workspaceView = $('#workspaceView');
  const modalBackdrop = $('#modalBackdrop');
  const modalContent = $('#modalContent');
  const toastElement = $('#toast');

  function showToast(message) {
    toastElement.textContent = message;
    toastElement.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastElement.classList.remove('show'), 3500);
  }

  function visibleRecords() {
    return records;
  }

  function showLogin() {
    loginView.classList.remove('hidden');
    workspaceView.classList.add('hidden');
  }

  async function loadWorkspaceData() {
    const { data, error } = await supabase
      .from('change_records')
      .select('id, full_name, record_date, priority, description, author_id, author_name, created_at, attachments(id, storage_path, file_name, category, file_size, content_type), record_shares(user_id)')
      .order('created_at', { ascending: false });
    if (error) throw error;

    records = (data || []).map(record => ({
      id: record.id,
      fullName: record.full_name,
      date: record.record_date,
      type: record.priority,
      description: record.description,
      authorId: record.author_id,
      authorName: record.author_name,
      createdAt: record.created_at,
      attachments: record.attachments || [],
      sharedWith: (record.record_shares || []).map(share => share.user_id)
    }));

    if (currentUser.role === 'admin') {
      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, created_at')
        .order('created_at', { ascending: true });
      if (profileError) throw profileError;
      users = (profiles || []).map(profile => ({
        id: profile.id,
        email: profile.email,
        name: profile.full_name,
        role: profile.role,
        joined: profile.created_at
      }));
    } else {
      users = [];
    }
  }

  async function activateUser(authUser) {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, created_at')
      .eq('id', authUser.id)
      .single();
    if (error || !profile) {
      await supabase.auth.signOut();
      showLogin();
      $('#loginError').textContent = 'Your account is not provisioned in Racing Protocols. Contact the workspace administrator.';
      return;
    }

    currentUser = {
      id: profile.id,
      email: profile.email,
      name: profile.full_name,
      role: profile.role,
      joined: profile.created_at
    };
    try {
      await loadWorkspaceData();
      showWorkspace();
    } catch (loadError) {
      await supabase.auth.signOut();
      showLogin();
      $('#loginError').textContent = loadError.message || 'Could not load your workspace. Please try again.';
    }
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
    const totals = {
      Important: shown.filter(record => record.type === 'Important').length,
      Middle: shown.filter(record => record.type === 'Middle').length,
      Recent: shown.filter(record => record.type === 'Recent').length
    };
    $('#summaryStrip').innerHTML = `<div class="summary-cell"><span>Total records</span><strong>${shown.length}</strong><span class="sum-mark">&#9638;</span></div><div class="summary-cell important"><span>Important</span><strong>${totals.Important}</strong><span class="sum-mark">&#9679;</span></div><div class="summary-cell middle"><span>Middle</span><strong>${totals.Middle}</strong><span class="sum-mark">&#9679;</span></div><div class="summary-cell recent"><span>Recent</span><strong>${totals.Recent}</strong><span class="sum-mark">&#9679;</span></div>`;
    $('#recordsSubtitle').textContent = currentUser.role === 'admin' ? 'A shared view of every documented change.' : 'Your records and the changes shared with you.';
    $('#recordList').innerHTML = filtered.map(record => {
      const attachmentCount = record.attachments.length;
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

  async function uploadFiles(recordId, files, category) {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) throw new Error('Your session expired. Sign in again before uploading files.');
    for (const file of files) {
      const fileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-160) || 'upload';
      const storagePath = `${recordId}/${makeId()}-${fileName}`;
      const endpoint = `${config.url.replace(/\/$/, '')}/storage/v1/upload/resumable`;
      await new Promise((resolve, reject) => {
        const upload = new Upload(file, {
          endpoint,
          chunkSize: 6 * 1024 * 1024,
          retryDelays: [0, 1000, 3000, 5000],
          headers: {
            authorization: `Bearer ${sessionData.session.access_token}`,
            apikey: config.anonKey,
            'x-upsert': 'false'
          },
          metadata: {
            bucketName: 'record-files',
            objectName: storagePath,
            contentType: file.type || 'application/octet-stream',
            cacheControl: '3600'
          },
          onError: reject,
          onSuccess: resolve
        });
        upload.start();
      });

      const { error: metadataError } = await supabase.from('attachments').insert({
        record_id: recordId,
        storage_path: storagePath,
        file_name: file.name,
        category,
        file_size: file.size,
        content_type: file.type || 'application/octet-stream'
      });
      if (metadataError) {
        await supabase.storage.from('record-files').remove([storagePath]);
        throw metadataError;
      }
    }
  }

  async function submitRecord(event) {
    event.preventDefault();
    const description = $('#recordDescription').value.trim();
    if (words(description) > MAX_WORDS) return $('#recordError').textContent = `Description is over the ${MAX_WORDS}-word limit.`;
    const drawings = [...$('#drawingFiles').files];
    const photos = [...$('#photoFiles').files];
    if ([...drawings, ...photos].some(file => file.size > MAX_BYTES)) return $('#recordError').textContent = 'Each file must be 500 MB or smaller.';

    const button = $('button[type="submit"]', event.currentTarget);
    button.disabled = true;
    button.textContent = 'Saving...';
    const { data: record, error } = await supabase.from('change_records').insert({
      full_name: $('#recordFullName').value.trim(),
      record_date: $('#recordDate').value,
      priority: $('#recordType').value,
      description,
      author_id: currentUser.id,
      author_name: $('#recordFullName').value.trim()
    }).select('id').single();

    if (error) {
      $('#recordError').textContent = error.message || 'Could not save this record.';
      button.disabled = false;
      button.innerHTML = 'Save record <span aria-hidden="true">&#8594;</span>';
      return;
    }

    let attachmentError = null;
    try {
      await uploadFiles(record.id, drawings, 'Drawing / Sketch');
      await uploadFiles(record.id, photos, 'Photo');
    } catch (uploadError) {
      attachmentError = uploadError.message || 'One or more files could not be uploaded.';
    }

    try {
      await loadWorkspaceData();
      closeModal();
      currentFilter = 'All';
      $$('.filter-tab').forEach(tab => tab.classList.toggle('selected', tab.dataset.filter === 'All'));
      renderRecords();
      showToast(attachmentError ? `Record saved, but an attachment failed: ${attachmentError}` : 'Record saved to the shared workspace.');
    } catch (loadError) {
      $('#recordError').textContent = loadError.message || 'Record saved, but the workspace could not refresh.';
    }
  }

  async function openRecord(id) {
    const record = records.find(item => item.id === id);
    if (!record) return;
    const attachments = record.attachments;
    showModal(`<div class="modal-header"><div><p class="eyebrow">${safe(record.type.toUpperCase())} CHANGE</p><h2 id="modalTitle">${safe(record.fullName)}</h2><p>Submitted by ${safe(record.authorName)}</p></div><button class="modal-close" type="button" aria-label="Close">&times;</button></div><div class="modal-body"><div class="detail-meta"><div><span>DATE</span><strong>${formatDate(record.date)}</strong></div><div><span>DOCUMENTATION TYPE</span><strong><i class="priority-tag ${safe(record.type)}">${safe(record.type)}</i></strong></div><div><span>SUBMITTED BY</span><strong>${safe(record.authorName)}</strong></div></div><section class="detail-section"><h3>DESCRIPTION WHAT CHANGED</h3><div class="detail-description">${safe(record.description)}</div></section><section class="detail-section"><h3>DRAWINGS / SKETCHES &amp; PHOTOS</h3><div class="attachment-list" id="attachmentList">${attachments.length ? attachments.map(file => `<a class="attachment-link" href="#" data-storage-path="${safe(file.storage_path)}" data-file-name="${safe(file.file_name)}"><span aria-hidden="true">&#8595;</span><span>${safe(file.file_name)}</span><small>${safe(file.category)} &middot; ${formatSize(file.file_size)}</small></a>`).join('') : '<p class="muted">No files attached to this record.</p>'}</div></section><div class="modal-actions"><button class="button button-secondary" type="button" data-close>Close</button></div></div>`);
    $$('[data-storage-path]', modalContent).forEach(link => link.addEventListener('click', async event => {
      event.preventDefault();
      const { data, error } = await supabase.storage.from('record-files').createSignedUrl(link.dataset.storagePath, 60, { download: link.dataset.fileName });
      if (error || !data?.signedUrl) return showToast(error?.message || 'Could not retrieve this file.');
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    }));
  }

  function renderPeople() {
    $('#peopleCount').textContent = users.length;
    $('#peopleList').innerHTML = users.map(user => `<div class="person-row"><span class="person-identity"><span class="avatar">${safe(initials(user.name))}</span><span><strong>${safe(user.name)}</strong><small>${safe(user.email)}</small></span></span><span class="role-chip ${user.role === 'admin' ? 'admin' : ''}">${user.role === 'admin' ? 'Administrator' : 'Member'}</span><span class="person-date">${formatDate(user.joined.slice(0, 10))}</span><button class="table-action" type="button" data-reset-user="${safe(user.id)}">Change password</button></div>`).join('');
    $$('[data-reset-user]').forEach(button => button.addEventListener('click', () => openPasswordForm(button.dataset.resetUser)));
  }

  function renderAccess() {
    $('#accessEmpty').classList.toggle('hidden', records.length > 0);
    $('#accessList').innerHTML = records.map(record => {
      const shared = record.sharedWith;
      const options = users.filter(user => user.id !== record.authorId).map(user => `<label class="access-option"><input type="checkbox" value="${safe(user.id)}" ${shared.includes(user.id) ? 'checked' : ''}>${safe(user.name)}${user.role === 'admin' ? ' (admin)' : ''}</label>`).join('');
      return `<article class="access-card" data-access-record="${safe(record.id)}"><div class="access-card-top"><div><h3>${safe(record.fullName)}</h3><p>${safe(record.type)} &middot; ${formatDate(record.date)} &middot; by ${safe(record.authorName)}</p></div><span class="priority-tag ${safe(record.type)}">${safe(record.type)}</span></div><div class="access-options">${options || '<span class="muted">No other people in the workspace.</span>'}</div><button class="button button-secondary access-save" type="button" data-save-access="${safe(record.id)}">Save access</button></article>`;
    }).join('');
    $$('[data-save-access]').forEach(button => button.addEventListener('click', async () => {
      const card = button.closest('.access-card');
      const userIds = $$('input[type="checkbox"]:checked', card).map(input => input.value);
      button.disabled = true;
      const { error } = await supabase.rpc('set_record_shares', {
        target_record_id: button.dataset.saveAccess,
        target_user_ids: userIds
      });
      button.disabled = false;
      if (error) return showToast(error.message || 'Could not update record access.');
      await loadWorkspaceData();
      renderAccess();
      showToast('Record access updated for the workspace.');
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

  async function callAdminFunction(body) {
    const { data, error } = await supabase.functions.invoke('manage-users', { body });
    if (error) {
      let message = error.message;
      try {
        const response = await error.context?.json?.();
        if (response?.error) message = response.error;
      } catch {
        message = error.message;
      }
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function updateActivationButton() {
    const button = $('#activationButton');
    if (!supabase || !button) return;
    const { data, error } = await supabase.rpc('workspace_activation_available');
    button.classList.toggle('hidden', Boolean(error) || data !== true);
  }

  function openActivationForm() {
    showModal(`<div class="modal-header"><div><p class="eyebrow">ONE-TIME SETUP</p><h2 id="modalTitle">Activate Racing Protocols</h2><p>Create the first administrator account for this workspace.</p></div><button class="modal-close" type="button" aria-label="Close">&times;</button></div><form class="modal-body" id="activationForm"><div class="form-grid"><label class="field-label field-span">Full name<input class="field-input" id="activationName" required maxlength="120" autocomplete="name"></label><label class="field-label field-span">Administrator email<input class="field-input" id="activationEmail" type="email" value="20240014@htlwrn.ac.at" required autocomplete="email"></label><label class="field-label field-span">New password<input class="field-input" id="activationPassword" type="password" minlength="12" required autocomplete="new-password"></label><label class="field-label field-span">One-time activation code<input class="field-input" id="activationCode" type="password" minlength="24" required autocomplete="off"></label></div><p class="field-hint">Use a new password with at least 12 characters. The activation code is provided by the workspace setup administrator.</p><p class="form-error" id="activationError" role="alert"></p><div class="modal-actions"><button class="button button-secondary" type="button" data-close>Cancel</button><button class="button button-primary" type="submit">Create administrator</button></div></form>`);
    $('#activationForm').addEventListener('submit', async event => {
      event.preventDefault();
      const button = $('button[type="submit"]', event.currentTarget);
      button.disabled = true;
      try {
        await callAdminFunction({
          action: 'activate_first_admin',
          fullName: $('#activationName').value.trim(),
          email: $('#activationEmail').value.trim(),
          password: $('#activationPassword').value,
          activationCode: $('#activationCode').value
        });
        await updateActivationButton();
        const { data, error } = await supabase.auth.signInWithPassword({
          email: $('#activationEmail').value.trim().toLowerCase(),
          password: $('#activationPassword').value
        });
        if (error) {
          closeModal();
          $('#loginError').textContent = 'The administrator was created. Sign in with the new account to continue.';
          return;
        }
        closeModal();
        await activateUser(data.user);
      } catch (error) {
        $('#activationError').textContent = error.message || 'Could not activate this workspace.';
        button.disabled = false;
      }
    });
  }

  function openUserForm() {
    showModal(`<div class="modal-header"><div><p class="eyebrow">WORKSPACE PEOPLE</p><h2 id="modalTitle">Add a person</h2><p>Create a sign-in and choose their workspace role.</p></div><button class="modal-close" type="button" aria-label="Close">&times;</button></div><form class="modal-body" id="userForm"><div class="form-grid"><label class="field-label field-span">Full name<input class="field-input" id="newUserName" required maxlength="120"></label><label class="field-label field-span">Email address<input class="field-input" id="newUserEmail" type="email" required></label><label class="field-label">Temporary password<input class="field-input" id="newUserPassword" type="password" minlength="12" required></label><label class="field-label">Workspace role<select class="field-select" id="newUserRole"><option value="member">Member</option><option value="admin">Administrator</option></select></label></div><p class="field-hint">Use at least 12 characters and share temporary credentials privately.</p><p class="form-error" id="userError" role="alert"></p><div class="modal-actions"><button class="button button-secondary" type="button" data-close>Cancel</button><button class="button button-primary" type="submit">Create account</button></div></form>`);
    $('#userForm').addEventListener('submit', async event => {
      event.preventDefault();
      const button = $('button[type="submit"]', event.currentTarget);
      button.disabled = true;
      try {
        await callAdminFunction({
          action: 'create_user',
          email: $('#newUserEmail').value.trim(),
          fullName: $('#newUserName').value.trim(),
          password: $('#newUserPassword').value,
          role: $('#newUserRole').value
        });
        await loadWorkspaceData();
        closeModal();
        renderPeople();
        renderAccess();
        showToast('Account created. Share the temporary password privately.');
      } catch (error) {
        $('#userError').textContent = error.message || 'Could not create that account.';
        button.disabled = false;
      }
    });
  }

  function openPasswordForm(userId) {
    const user = users.find(item => item.id === userId);
    if (!user || currentUser.role !== 'admin') return;
    showModal(`<div class="modal-header"><div><p class="eyebrow">ACCOUNT SECURITY</p><h2 id="modalTitle">Change password</h2><p>Set a new password for ${safe(user.name)}.</p></div><button class="modal-close" type="button" aria-label="Close">&times;</button></div><form class="modal-body" id="passwordForm"><label class="field-label">New password<input class="field-input" id="newPassword" type="password" minlength="12" required></label><p class="field-hint">Use at least 12 characters.</p><p class="form-error" id="passwordError" role="alert"></p><div class="modal-actions"><button class="button button-secondary" type="button" data-close>Cancel</button><button class="button button-primary" type="submit">Update password</button></div></form>`);
    $('#passwordForm').addEventListener('submit', async event => {
      event.preventDefault();
      const button = $('button[type="submit"]', event.currentTarget);
      button.disabled = true;
      try {
        await callAdminFunction({ action: 'change_password', userId, password: $('#newPassword').value });
        closeModal();
        showToast(`Password updated for ${user.name}.`);
      } catch (error) {
        $('#passwordError').textContent = error.message || 'Could not update that password.';
        button.disabled = false;
      }
    });
  }

  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!supabase) return $('#loginError').textContent = 'Cloud sign-in is not configured yet. Contact the site administrator.';
    const button = $('button[type="submit"]', event.currentTarget);
    button.disabled = true;
    $('#loginError').textContent = '';
    const { data, error } = await supabase.auth.signInWithPassword({
      email: $('#loginEmail').value.trim().toLowerCase(),
      password: $('#loginPassword').value
    });
    button.disabled = false;
    if (error) return $('#loginError').textContent = 'Sign-in failed. Check your email and password.';
    await activateUser(data.user);
  });
  $('#activationButton').addEventListener('click', openActivationForm);

  $('#signOutButton').addEventListener('click', async () => {
    if (supabase) await supabase.auth.signOut();
    currentUser = null;
    users = [];
    records = [];
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

  async function initialize() {
    showLogin();
    if (!supabase) {
      $('#loginError').textContent = 'Cloud sign-in is not configured. Add the public Supabase project URL and anon key to supabase-config.js.';
      $('button[type="submit"]', $('#loginForm')).disabled = true;
      return;
    }
    await updateActivationButton();
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      $('#loginError').textContent = 'Could not connect to the authentication service.';
      return;
    }
    if (data.session?.user) await activateUser(data.session.user);
    supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') {
        currentUser = null;
        records = [];
        users = [];
        showLogin();
      }
    });
  }

  initialize();
})();
