(function () {
  'use strict';

  const portalNode = document.getElementById('portal');
  if (!portalNode) {
    return;
  }

  if (!window.d3) {
    portalNode.innerHTML = [
      '<section class="card">',
      '<h1>Data Portal</h1>',
      '<p class="message error">D3 failed to load. Check the network connection and reload this page.</p>',
      '</section>'
    ].join('');
    return;
  }

  const d3 = window.d3;
  const portal = d3.select(portalNode);
  const API = {
    session: '/data-portal/api/session',
    login: '/data-portal/login',
    logout: '/data-portal/logout',
    files: '/data-portal/api/files',
    download: '/data-portal/download'
  };
  const TASKS = ['Motion', 'Orientation', 'Centrality', 'Bar'];
  const TASK_COLORS = {
    Motion: '#2563eb',
    Orientation: '#d97706',
    Centrality: '#059669',
    Bar: '#7c3aed'
  };
  const view = getPortalView();

  const state = {
    authenticated: false,
    csrfToken: '',
    account: {
      role: '',
      userId: '',
      label: ''
    },
    loginError: '',
    fileError: '',
    loadingFiles: false,
    files: [],
    total: 0,
    generatedAt: null,
    filters: {
      q: '',
      dateFrom: '',
      dateTo: ''
    },
    preview: {
      fileName: '',
      loading: false,
      error: '',
      rows: [],
      points: []
    },
    users: {
      loading: false,
      error: '',
      csvFiles: [],
      loadedFileCount: 0,
      failedFileCount: 0,
      records: [],
      users: [],
      selectedUserId: '',
      visibleTasks: TASKS.reduce((visible, task) => {
        visible[task] = true;
        return visible;
      }, {})
    }
  };

  const debouncedLoadFiles = debounce(loadFiles, 220);

  loadSession();

  async function loadSession() {
    renderLoading('Loading data portal...');

    try {
      const response = await fetch(API.session, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });

      if (!response.ok) {
        throw new Error('Could not load session state.');
      }

      const data = await response.json();
      state.authenticated = Boolean(data.authenticated);
      state.csrfToken = data.csrf_token || '';
      state.account.role = data.role || '';
      state.account.userId = data.user_id || '';
      state.account.label = data.user_label || '';
      state.loginError = data.login_error || '';

      if (state.authenticated) {
        await loadCurrentView();
      } else {
        renderLogin();
      }
    } catch (error) {
      renderError(error.message || 'Could not load data portal.');
    }
  }

  async function loadFiles() {
    state.loadingFiles = true;
    state.fileError = '';
    renderFiles();

    const params = new URLSearchParams();
    if (state.filters.q.trim()) {
      params.set('q', state.filters.q.trim());
    }
    if (state.filters.dateFrom) {
      params.set('date_from', state.filters.dateFrom);
    }
    if (state.filters.dateTo) {
      params.set('date_to', state.filters.dateTo);
    }

    try {
      const response = await fetch(API.files + (params.toString() ? `?${params.toString()}` : ''), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });

      if (response.status === 401) {
        state.authenticated = false;
        state.loginError = 'Your session expired. Sign in again.';
        return;
      }

      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(data.error || 'Could not load files.');
      }

      state.files = Array.isArray(data.files) ? data.files : [];
      state.total = Number.isFinite(data.total) ? data.total : state.files.length;
      state.generatedAt = data.generated_at || null;
    } catch (error) {
      state.fileError = error.message || 'Could not load files.';
    } finally {
      state.loadingFiles = false;
      if (state.authenticated) {
        renderFiles();
      } else {
        renderLogin();
      }
    }
  }

  async function loadCurrentView() {
    if (view === 'preview') {
      await loadPreview();
      return;
    }

    if (view === 'users') {
      await loadUsers();
      return;
    }

    await loadFiles();
  }

  async function loadPreview() {
    state.preview.fileName = getFileQueryParam();
    state.preview.loading = true;
    state.preview.error = '';
    state.preview.rows = [];
    state.preview.points = [];
    renderPreview();

    if (!state.preview.fileName) {
      state.preview.loading = false;
      state.preview.error = 'No file was selected for preview.';
      renderPreview();
      return;
    }

    try {
      const csvText = await fetchCsvFile(state.preview.fileName);
      const rows = d3.csvParse(csvText);
      state.preview.rows = rows;
      state.preview.points = aggregateAccuracyByDifficulty(rows);
    } catch (error) {
      state.preview.error = error.message || 'Could not load preview data.';
    } finally {
      state.preview.loading = false;
      if (state.authenticated) {
        renderPreview();
      } else {
        renderLogin();
      }
    }
  }

  async function loadUsers() {
    state.users.loading = true;
    state.users.error = '';
    state.users.csvFiles = [];
    state.users.loadedFileCount = 0;
    state.users.failedFileCount = 0;
    state.users.records = [];
    state.users.users = [];
    renderUsers();

    try {
      const response = await fetch(API.files, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });

      if (response.status === 401) {
        state.authenticated = false;
        state.loginError = 'Your session expired. Sign in again.';
        return;
      }

      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(data.error || 'Could not load data files.');
      }

      const csvFiles = (Array.isArray(data.files) ? data.files : []).filter(isCsvFile);
      const results = await Promise.all(csvFiles.map(async (file) => {
        try {
          const csvText = await fetchCsvFile(file.name);
          return { file, rows: d3.csvParse(csvText), error: null };
        } catch (error) {
          if (!state.authenticated) {
            throw error;
          }

          return { file, rows: [], error };
        }
      }));
      const scopedUserId = isUserLogin() ? state.account.userId : '';
      const records = results.flatMap((result) => extractResponseRecords(result.file, result.rows, scopedUserId));
      const users = buildUserSummaries(records);
      const selectedUserStillExists = users.some((user) => user.id === state.users.selectedUserId);

      state.users.csvFiles = csvFiles;
      state.users.loadedFileCount = results.filter((result) => !result.error).length;
      state.users.failedFileCount = results.filter((result) => result.error).length;
      state.users.records = records;
      state.users.users = users;
      state.users.selectedUserId = selectedUserStillExists ? state.users.selectedUserId : (users[0]?.id || '');
    } catch (error) {
      state.users.error = error.message || 'Could not load user visualizations.';
    } finally {
      state.users.loading = false;
      if (state.authenticated) {
        renderUsers();
      } else {
        renderLogin();
      }
    }
  }

  function renderLoading(message) {
    portal.html('');
    const card = portal.append('section').attr('class', 'card');
    card.append('p').attr('class', 'muted').text(message);
  }

  function renderError(message) {
    portal.html('');
    const card = portal.append('section').attr('class', 'card');
    card.append('h1').text('Data Portal');
    card.append('p').attr('class', 'message error').text(message);
  }

  function renderLogin() {
    portal.html('');
    const card = portal.append('section').attr('class', 'card');
    appendHeader(card, 'Data Portal Login', 'Admins use their password. Users can enter their participant ID.');

    if (state.loginError) {
      card.append('p').attr('class', 'message error').text(state.loginError);
    }

    const form = card
      .append('form')
      .attr('class', 'form-grid')
      .attr('autocomplete', 'off');

    form
      .append('input')
      .attr('type', 'hidden')
      .attr('name', 'csrf_token')
      .attr('value', state.csrfToken);

    appendInput(form, {
      id: 'username',
      name: 'username',
      label: 'Admin username or User ID',
      required: true
    });

    appendInput(form, {
      id: 'password',
      name: 'password',
      label: 'Password',
      type: 'password',
      placeholder: 'Required for admins'
    });

    const status = form.append('p').attr('class', 'muted').attr('role', 'status');
    const submitButton = form.append('button').attr('type', 'submit').text('Sign In');

    form.on('submit', async function (event) {
      event.preventDefault();
      state.loginError = '';
      status.text('Signing in...');
      setButtonBusy(submitButton, true, 'Signing In...');

      const formData = new FormData(this);
      formData.set('csrf_token', state.csrfToken);

      try {
        const response = await fetch(API.login, {
          method: 'POST',
          body: formData,
          credentials: 'same-origin',
          headers: { Accept: 'application/json' }
        });
        const data = await readJson(response);

        if (!response.ok || data.success === false) {
          throw new Error(data.error || 'Sign in failed.');
        }

        await loadSession();
      } catch (error) {
        state.loginError = error.message || 'Sign in failed.';
        renderLogin();
      }
    });
  }

  function renderFiles() {
    portal.html('');
    const card = portal.append('section').attr('class', 'card');
    appendHeader(card, 'Data Files', isAdminLogin() ? 'Search by filename and filter by created date.' : 'Search your saved experiment files.', true);
    const nav = card.append('p').attr('class', 'portal-nav');
    nav.append('a').attr('href', '/data-portal/users.html').text('User Trends');
    renderToolbar(card);
    renderSummary(card);

    if (state.fileError) {
      card.append('p').attr('class', 'message error').text(state.fileError);
    } else if (state.loadingFiles) {
      card.append('p').attr('class', 'message info').text('Loading files...');
    } else if (state.generatedAt) {
      card
        .append('p')
        .attr('class', 'muted')
        .text(`Updated ${formatDate(state.generatedAt)}.`);
    }

    renderTable(card);
  }

  function renderPreview() {
    portal.html('');
    const card = portal.append('section').attr('class', 'card');
    appendHeader(card, 'Data Preview', 'Accuracy by difficulty level for one data file.', true);

    const nav = card.append('p').attr('class', 'portal-nav');
    nav.append('a').attr('href', '/data-portal/index.html').text('Data Files');
    nav.append('a').attr('href', '/data-portal/users.html').text('User Trends');

    if (state.preview.fileName) {
      card
        .append('p')
        .attr('class', 'file-context')
        .text(state.preview.fileName);
    }

    if (state.preview.error) {
      card.append('p').attr('class', 'message error').text(state.preview.error);
      return;
    }

    if (state.preview.loading) {
      card.append('p').attr('class', 'message info').text('Loading preview...');
      return;
    }

    const summary = previewSummary(state.preview.rows, state.preview.points);
    const metrics = [
      { label: 'Task', value: summary.task },
      { label: 'Trials', value: String(summary.trials) },
      { label: 'Accuracy', value: formatPercent(summary.accuracy) },
      { label: 'Difficulty Levels', value: String(summary.levels) }
    ];
    renderMetrics(card, metrics);

    if (!state.preview.points.length) {
      card
        .append('p')
        .attr('class', 'message info')
        .text('No response rows with both correct and difficulty_level values were found.');
      return;
    }

    const chart = card.append('div').attr('class', 'chart-wrap');
    renderDifficultyChart(chart.node(), state.preview.points);
  }

  function renderUsers() {
    portal.html('');
    const card = portal.append('section').attr('class', 'card');
    appendHeader(card, 'User Trends', isAdminLogin() ? 'Accuracy over time by task.' : 'Your accuracy over time by task.', true);

    const nav = card.append('p').attr('class', 'portal-nav');
    nav.append('a').attr('href', '/data-portal/index.html').text('Data Files');

    if (state.users.error) {
      card.append('p').attr('class', 'message error').text(state.users.error);
      return;
    }

    if (state.users.loading) {
      card.append('p').attr('class', 'message info').text('Loading user visualizations...');
      return;
    }

    if (!state.users.csvFiles.length) {
      card.append('p').attr('class', 'message info').text('No CSV data files were found.');
      return;
    }

    if (!state.users.users.length) {
      card
        .append('p')
        .attr('class', 'message info')
        .text('CSV files were found, but no response rows with task and correct values were available.');
      return;
    }

    if (state.users.failedFileCount > 0) {
      card
        .append('p')
        .attr('class', 'message error')
        .text(`${state.users.failedFileCount} CSV file could not be loaded.`);
    }

    const layout = card.append('div').attr('class', 'user-dashboard');
    renderUserList(layout.append('aside').attr('class', 'user-list-panel'));
    renderUserVisualization(layout.append('section').attr('class', 'visualization-panel'));
  }

  function renderUserList(panel) {
    panel.append('h2').text(isAdminLogin() ? 'Users' : 'User');
    const list = panel.append('div').attr('class', 'user-list');
    const button = list
      .selectAll('button')
      .data(state.users.users, (user) => user.id)
      .enter()
      .append('button')
      .attr('type', 'button')
      .attr('class', (user) => (user.id === state.users.selectedUserId ? 'user-button active' : 'user-button'))
      .on('click', (event, user) => {
        state.users.selectedUserId = user.id;
        renderUsers();
      });

    button.append('span').attr('class', 'user-name').text((user) => user.label);
    button
      .append('span')
      .attr('class', 'user-meta')
      .text((user) => `${user.trials} trials, ${formatPercent(user.accuracy)}`);
  }

  function renderUserVisualization(panel) {
    const selectedUser = state.users.users.find((user) => user.id === state.users.selectedUserId);
    if (!selectedUser) {
      panel.append('p').attr('class', 'message info').text('Select a user to show visualization.');
      return;
    }

    panel.append('h2').text(selectedUser.label);
    renderTaskControls(panel);

    const metrics = [
      { label: 'Sessions', value: String(selectedUser.sessions) },
      { label: 'Trials', value: String(selectedUser.trials) },
      { label: 'Accuracy', value: formatPercent(selectedUser.accuracy) },
      { label: 'Files Loaded', value: String(state.users.loadedFileCount) }
    ];
    renderMetrics(panel, metrics);

    const series = aggregateUserTrendSeries(state.users.records, selectedUser.id);
    const chart = panel.append('div').attr('class', 'chart-wrap');
    renderUserTrendChart(chart.node(), series);
  }

  function renderTaskControls(panel) {
    const controls = panel.append('div').attr('class', 'task-controls');
    TASKS.forEach((task) => {
      const label = controls.append('label').attr('class', 'checkbox-row');
      label
        .append('input')
        .attr('type', 'checkbox')
        .property('checked', state.users.visibleTasks[task])
        .on('change', (event) => {
          state.users.visibleTasks[task] = event.currentTarget.checked;
          renderUsers();
        });
      label
        .append('span')
        .attr('class', 'task-swatch')
        .style('background', TASK_COLORS[task]);
      label.append('span').text(task);
    });
  }

  function appendHeader(card, title, subtitle, withLogout) {
    const header = card.append('div').attr('class', 'portal-header');
    const copy = header.append('div');
    copy.append('h1').text(title);
    copy.append('p').attr('class', 'muted').text(subtitle);
    if (withLogout && state.account.label) {
      copy.append('p').attr('class', 'muted').text(`Signed in as ${state.account.label}.`);
    }

    if (!withLogout) {
      return;
    }

    const form = header.append('form');
    const button = form.append('button').attr('type', 'submit').attr('class', 'secondary').text('Log Out');

    form.on('submit', async function (event) {
      event.preventDefault();
      setButtonBusy(button, true, 'Logging Out...');

      const body = new URLSearchParams();
      body.set('csrf_token', state.csrfToken);

      try {
        await fetch(API.logout, {
          method: 'POST',
          body,
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });
      } finally {
        state.authenticated = false;
        state.account.role = '';
        state.account.userId = '';
        state.account.label = '';
        state.files = [];
        await loadSession();
      }
    });
  }

  function renderToolbar(card) {
    const toolbar = card.append('form').attr('class', 'toolbar');

    toolbar.on('submit', function (event) {
      event.preventDefault();
      loadFiles();
    });

    appendInput(toolbar, {
      id: 'q',
      label: 'Filename search',
      value: state.filters.q,
      placeholder: 'e.g. user_123'
    }).on('input', function (event) {
      state.filters.q = event.currentTarget.value;
      debouncedLoadFiles();
    });

    appendInput(toolbar, {
      id: 'date_from',
      label: 'Created from',
      type: 'date',
      value: state.filters.dateFrom
    }).on('change', function (event) {
      state.filters.dateFrom = event.currentTarget.value;
      loadFiles();
    });

    appendInput(toolbar, {
      id: 'date_to',
      label: 'Created to',
      type: 'date',
      value: state.filters.dateTo
    }).on('change', function (event) {
      state.filters.dateTo = event.currentTarget.value;
      loadFiles();
    });

    toolbar.append('button').attr('type', 'submit').text('Refresh');
  }

  function renderSummary(card) {
    const totalBytes = d3.sum(state.files, (file) => Number(file.size_bytes) || 0);
    const latestTimestamp = d3.max(state.files, (file) => Number(file.created_at) || 0);
    const metrics = [
      { label: 'Files', value: String(state.total || 0) },
      { label: 'Total Size', value: formatBytes(totalBytes) },
      { label: 'Newest File', value: latestTimestamp ? formatDate(latestTimestamp) : 'None' }
    ];

    const summary = card.append('div').attr('class', 'summary');
    const metric = summary.selectAll('.metric').data(metrics).enter().append('div').attr('class', 'metric');
    metric.append('div').attr('class', 'metric-label').text((item) => item.label);
    metric.append('div').attr('class', 'metric-value').text((item) => item.value);
  }

  function renderTable(card) {
    const wrap = card.append('div').attr('class', 'table-wrap');
    const table = wrap.append('table');
    table
      .append('thead')
      .append('tr')
      .selectAll('th')
      .data(['File', 'Size', 'Created', 'Modified', 'Actions'])
      .enter()
      .append('th')
      .text((label) => label);

    const tbody = table.append('tbody');
    if (!state.files.length) {
      tbody
        .append('tr')
        .append('td')
        .attr('class', 'empty-cell')
        .attr('colspan', 5)
        .text(state.loadingFiles ? 'Loading files...' : 'No files found.');
      return;
    }

    const rows = tbody.selectAll('tr').data(state.files, (file) => file.name).enter().append('tr');
    rows.append('td').append('span').attr('class', 'file-name').text((file) => file.name);
    rows.append('td').text((file) => formatBytes(file.size_bytes));
    rows.append('td').text((file) => formatDate(file.created_at));
    rows.append('td').text((file) => formatDate(file.modified_at));
    const actions = rows.append('td').append('div').attr('class', 'action-links');
    actions
      .append('a')
      .attr('class', (file) => (isCsvFile(file) ? 'button-link secondary' : 'button-link disabled'))
      .attr('href', (file) => (isCsvFile(file) ? previewUrl(file.name) : null))
      .attr('aria-disabled', (file) => (isCsvFile(file) ? null : 'true'))
      .text('Preview');
    actions
      .append('a')
      .attr('class', 'button-link')
      .attr('href', (file) => file.download_url)
      .text('Download');
  }

  function renderMetrics(parent, metrics) {
    const summary = parent.append('div').attr('class', 'summary');
    const metric = summary.selectAll('.metric').data(metrics).enter().append('div').attr('class', 'metric');
    metric.append('div').attr('class', 'metric-label').text((item) => item.label);
    metric.append('div').attr('class', 'metric-value').text((item) => item.value);
  }

  function appendInput(parent, options) {
    const field = parent.append('div').attr('class', 'field');
    field.append('label').attr('for', options.id).text(options.label);
    const input = field
      .append('input')
      .attr('id', options.id)
      .attr('type', options.type || 'text');

    if (options.name) {
      input.attr('name', options.name);
    }
    if (options.placeholder) {
      input.attr('placeholder', options.placeholder);
    }
    if (options.required) {
      input.attr('required', true);
    }
    if (options.value) {
      input.property('value', options.value);
    }

    return input;
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function fetchCsvFile(fileName) {
    const response = await fetch(downloadUrl(fileName), {
      credentials: 'same-origin',
      headers: { Accept: 'text/csv, text/plain, */*' }
    });

    if (response.status === 401) {
      state.authenticated = false;
      state.loginError = 'Your session expired. Sign in again.';
      throw new Error(state.loginError);
    }

    if (!response.ok) {
      throw new Error(`Could not load ${fileName}.`);
    }

    return response.text();
  }

  function setButtonBusy(button, busy, label) {
    button.property('disabled', busy).text(label);
  }

  function debounce(callback, delay) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => callback.apply(this, args), delay);
    };
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = -1;
    do {
      size /= 1024;
      unitIndex++;
    } while (size >= 1024 && unitIndex < units.length - 1);

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  function formatDate(timestamp) {
    const seconds = Number(timestamp);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return 'Unknown';
    }

    return new Date(seconds * 1000).toLocaleString();
  }

  function formatPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return '0%';
    }

    return `${Math.round(number)}%`;
  }

  function getPortalView() {
    const page = window.location.pathname.split('/').pop();
    if (page === 'preview.html') {
      return 'preview';
    }
    if (page === 'users.html') {
      return 'users';
    }

    return 'files';
  }

  function getFileQueryParam() {
    return new URLSearchParams(window.location.search).get('file') || '';
  }

  function previewUrl(fileName) {
    return `/data-portal/preview.html?file=${encodeURIComponent(fileName)}`;
  }

  function downloadUrl(fileName) {
    return `${API.download}?file=${encodeURIComponent(fileName)}`;
  }

  function isCsvFile(file) {
    return Boolean(file && /\.csv$/i.test(file.name || ''));
  }

  function parseBoolean(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (['true', '1', 'yes', 'correct'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'incorrect'].includes(normalized)) {
      return false;
    }

    return null;
  }

  function hasDifficultyLevel(row) {
    return String(row.difficulty_level ?? '').trim() !== '';
  }

  function aggregateAccuracyByDifficulty(rows) {
    const groups = new Map();

    rows.forEach((row) => {
      const correct = parseBoolean(row.correct);
      const rawLevel = String(row.difficulty_level ?? '').trim();
      if (correct === null || rawLevel === '') {
        return;
      }

      const numericLevel = Number(rawLevel);
      const key = Number.isFinite(numericLevel) ? String(numericLevel) : rawLevel;
      if (!groups.has(key)) {
        groups.set(key, {
          level: key,
          sortValue: Number.isFinite(numericLevel) ? numericLevel : key,
          correct: 0,
          total: 0
        });
      }

      const group = groups.get(key);
      group.correct += correct ? 1 : 0;
      group.total += 1;
    });

    return Array.from(groups.values())
      .sort((a, b) => {
        if (typeof a.sortValue === 'number' && typeof b.sortValue === 'number') {
          return a.sortValue - b.sortValue;
        }

        return String(a.sortValue).localeCompare(String(b.sortValue), undefined, { numeric: true });
      })
      .map((group) => ({
        level: group.level,
        correct: group.correct,
        total: group.total,
        accuracy: group.total ? (group.correct / group.total) * 100 : 0
      }));
  }

  function previewSummary(rows, points) {
    const correct = d3.sum(points, (point) => point.correct);
    const trials = d3.sum(points, (point) => point.total);

    return {
      task: inferTaskName(rows),
      trials,
      accuracy: trials ? (correct / trials) * 100 : 0,
      levels: points.length
    };
  }

  function inferTaskName(rows) {
    const row = rows.find((item) => String(item.task_type || item.selected_task || '').trim() !== '');
    if (!row) {
      return 'Unknown';
    }

    return String(row.task_type || row.selected_task).trim();
  }

  function extractResponseRecords(file, rows, scopedUserId = '') {
    const sessionDate = parseSessionDate(file);
    const sessionKey = formatDateKey(sessionDate);

    return rows
      .map((row) => {
        const correct = parseBoolean(row.correct);
        const task = normalizeTask(row);
        if (correct === null || !task || !hasDifficultyLevel(row)) {
          return null;
        }

        const userId = scopedUserId || getUserId(row, file.name);
        return {
          userId,
          userLabel: formatUserLabel(userId),
          task,
          correct,
          date: sessionDate,
          dateKey: sessionKey,
          fileName: file.name
        };
      })
      .filter(Boolean);
  }

  function buildUserSummaries(records) {
    const users = new Map();

    records.forEach((record) => {
      if (!users.has(record.userId)) {
        users.set(record.userId, {
          id: record.userId,
          label: record.userLabel,
          trials: 0,
          correct: 0,
          sessions: new Set()
        });
      }

      const user = users.get(record.userId);
      user.trials += 1;
      user.correct += record.correct ? 1 : 0;
      user.sessions.add(record.fileName);
    });

    return Array.from(users.values())
      .map((user) => ({
        id: user.id,
        label: user.label,
        trials: user.trials,
        accuracy: user.trials ? (user.correct / user.trials) * 100 : 0,
        sessions: user.sessions.size
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }

  function aggregateUserTrendSeries(records, userId) {
    const groups = new Map();

    records.forEach((record) => {
      if (record.userId !== userId || Number.isNaN(record.date.getTime())) {
        return;
      }

      const key = `${record.dateKey}|${record.task}`;
      if (!groups.has(key)) {
        groups.set(key, {
          date: startOfDay(record.date),
          dateKey: record.dateKey,
          task: record.task,
          correct: 0,
          total: 0
        });
      }

      const group = groups.get(key);
      group.correct += record.correct ? 1 : 0;
      group.total += 1;
    });

    return TASKS.map((task) => ({
      task,
      color: TASK_COLORS[task],
      values: Array.from(groups.values())
        .filter((group) => group.task === task)
        .sort((a, b) => a.date - b.date)
        .map((group) => ({
          date: group.date,
          dateKey: group.dateKey,
          accuracy: group.total ? (group.correct / group.total) * 100 : 0,
          correct: group.correct,
          total: group.total
        }))
    }));
  }

  function normalizeTask(row) {
    const candidates = [row.task_type, row.selected_task, row.task_route]
      .map((value) => String(value ?? '').trim().toLowerCase())
      .filter(Boolean);

    for (const candidate of candidates) {
      const task = TASKS.find((item) => candidate.includes(item.toLowerCase()));
      if (task) {
        return task;
      }
    }

    const direction = String(row.correct_direction ?? '').trim().toLowerCase();
    if (direction === 'up' || direction === 'down') {
      return 'Motion';
    }
    if (direction === 'vertical' || direction === 'horizontal') {
      return 'Orientation';
    }
    if (direction === 'black' || direction === 'white') {
      return 'Centrality';
    }
    if (direction === 'same' || direction === 'different') {
      return 'Bar';
    }

    return '';
  }

  function getUserId(row, fileName) {
    const fromRow = String(row.user_id ?? '').trim();
    if (fromRow) {
      return fromRow;
    }

    return parseUserIdFromFileName(fileName);
  }

  function parseUserIdFromFileName(fileName) {
    const match = String(fileName).match(/(?:^|\/|_)user_([^_/]+)_/i);
    return match ? match[1] : 'Unknown';
  }

  function formatUserLabel(userId) {
    if (!userId || userId === 'Unknown') {
      return 'Unknown User';
    }

    return String(userId).toLowerCase().startsWith('user') ? String(userId) : `User ${userId}`;
  }

  function isAdminLogin() {
    return state.account.role === 'admin';
  }

  function isUserLogin() {
    return state.account.role === 'user' && Boolean(state.account.userId);
  }

  function parseSessionDate(file) {
    const name = String(file.name || '');
    const match = name.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
    if (match) {
      return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
        Number(match[6])
      );
    }

    const timestamp = Number(file.created_at) || Number(file.modified_at);
    return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000) : new Date(NaN);
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function formatDateKey(date) {
    if (Number.isNaN(date.getTime())) {
      return 'Unknown';
    }

    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function renderDifficultyChart(container, points) {
    container.innerHTML = '';

    const width = Math.max(container.clientWidth || 760, 360);
    const height = 420;
    const margin = { top: 24, right: 26, bottom: 56, left: 64 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3
      .select(container)
      .append('svg')
      .attr('class', 'chart')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('role', 'img')
      .attr('aria-label', 'Accuracy by difficulty level');

    const x = d3
      .scalePoint()
      .domain(points.map((point) => point.level))
      .range([margin.left, margin.left + innerWidth])
      .padding(0.45);
    const y = d3.scaleLinear().domain([0, 100]).range([margin.top + innerHeight, margin.top]);

    svg
      .append('g')
      .attr('class', 'grid-lines')
      .attr('transform', `translate(${margin.left},0)`)
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickSize(-innerWidth)
          .tickFormat('')
      );

    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${margin.top + innerHeight})`)
      .call(d3.axisBottom(x));

    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat((value) => `${value}%`));

    if (points.length > 1) {
      svg
        .append('path')
        .datum(points)
        .attr('class', 'line-path')
        .attr('d', d3.line().x((point) => x(point.level)).y((point) => y(point.accuracy)));
    }

    const point = svg.selectAll('.chart-point').data(points).enter().append('g').attr('class', 'chart-point');
    point
      .append('circle')
      .attr('cx', (item) => x(item.level))
      .attr('cy', (item) => y(item.accuracy))
      .attr('r', 5);
    point
      .append('title')
      .text((item) => `Level ${item.level}: ${formatPercent(item.accuracy)} (${item.correct}/${item.total})`);

    svg
      .append('text')
      .attr('class', 'axis-label')
      .attr('x', margin.left + innerWidth / 2)
      .attr('y', height - 12)
      .attr('text-anchor', 'middle')
      .text('Difficulty Level');

    svg
      .append('text')
      .attr('class', 'axis-label')
      .attr('transform', 'rotate(-90)')
      .attr('x', -(margin.top + innerHeight / 2))
      .attr('y', 18)
      .attr('text-anchor', 'middle')
      .text('Accuracy');
  }

  function renderUserTrendChart(container, series) {
    container.innerHTML = '';

    const visibleSeries = series.filter((item) => state.users.visibleTasks[item.task] && item.values.length);
    const points = visibleSeries.flatMap((item) => item.values);
    if (!points.length) {
      const empty = document.createElement('p');
      empty.className = 'message info';
      empty.textContent = 'Select at least one task with available data to show the chart.';
      container.appendChild(empty);
      return;
    }

    const width = Math.max(container.clientWidth || 760, 360);
    const height = 420;
    const margin = { top: 24, right: 34, bottom: 56, left: 64 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    let [minDate, maxDate] = d3.extent(points, (point) => point.date);
    if (minDate.getTime() === maxDate.getTime()) {
      minDate = new Date(minDate.getTime() - 12 * 60 * 60 * 1000);
      maxDate = new Date(maxDate.getTime() + 12 * 60 * 60 * 1000);
    }

    const svg = d3
      .select(container)
      .append('svg')
      .attr('class', 'chart')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('role', 'img')
      .attr('aria-label', 'User accuracy over time by task');

    const x = d3.scaleTime().domain([minDate, maxDate]).range([margin.left, margin.left + innerWidth]);
    const y = d3.scaleLinear().domain([0, 100]).range([margin.top + innerHeight, margin.top]);

    svg
      .append('g')
      .attr('class', 'grid-lines')
      .attr('transform', `translate(${margin.left},0)`)
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickSize(-innerWidth)
          .tickFormat('')
      );

    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${margin.top + innerHeight})`)
      .call(d3.axisBottom(x).ticks(Math.min(5, points.length)).tickFormat(d3.timeFormat('%b %d')));

    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat((value) => `${value}%`));

    visibleSeries.forEach((item) => {
      if (item.values.length > 1) {
        svg
          .append('path')
          .datum(item.values)
          .attr('class', 'task-line')
          .attr('stroke', item.color)
          .attr('d', d3.line().x((point) => x(point.date)).y((point) => y(point.accuracy)));
      }

      const point = svg
        .selectAll(`.trend-point-${item.task}`)
        .data(item.values)
        .enter()
        .append('g')
        .attr('class', `trend-point trend-point-${item.task}`);

      point
        .append('circle')
        .attr('cx', (value) => x(value.date))
        .attr('cy', (value) => y(value.accuracy))
        .attr('r', 5)
        .attr('fill', item.color);
      point
        .append('title')
        .text((value) => `${item.task} ${value.dateKey}: ${formatPercent(value.accuracy)} (${value.correct}/${value.total})`);
    });

    svg
      .append('text')
      .attr('class', 'axis-label')
      .attr('x', margin.left + innerWidth / 2)
      .attr('y', height - 12)
      .attr('text-anchor', 'middle')
      .text('Date');

    svg
      .append('text')
      .attr('class', 'axis-label')
      .attr('transform', 'rotate(-90)')
      .attr('x', -(margin.top + innerHeight / 2))
      .attr('y', 18)
      .attr('text-anchor', 'middle')
      .text('Accuracy');
  }
})();
