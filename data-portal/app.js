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
    userTrends: '/data-portal/api/user-trends',
    download: '/data-portal/download'
  };
  const TASKS = ['Motion', 'Orientation', 'Centrality', 'Bar'];
  const SHOW_UNUSED_TASKS = false;
  const UNUSED_DEPLOYMENT_TASKS = new Set(['Orientation', 'Bar']);
  const TASK_COLORS = {
    Motion: '#2563eb',
    Orientation: '#059669',
    Centrality: '#d97706',
    Bar: '#7c3aed'
  };
  const REST_TRIAL_CATEGORIES = new Set(['scheduled_break', 'manual_pause_screen']);
  const DURATION_BAR_MIN_WIDTH = 148;
  const DURATION_BAR_MAX_WIDTH = 276;
  const view = getPortalView();
  const csvRowsCache = new Map();

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
      dateTo: '',
      showPauseFiles: false,
      showSessionFiles: false
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
      fileSessions: [],
      users: [],
      selectedUserId: '',
      visibleTasks: TASKS.reduce((visible, task) => {
        visible[task] = isDeploymentTaskVisible(task);
        return visible;
      }, {}),
      difficultyTaskByUser: {}
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
    const metricTypes = getRequestedMetricTypes();
    if (metricTypes.length) {
      params.set('metric_types', metricTypes.join(','));
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
      const rows = await fetchCsvRows(state.preview.fileName);
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
    state.users.fileSessions = [];
    state.users.users = [];
    renderUsers();

    try {
      const response = await fetch(API.userTrends, {
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
        throw new Error(data.error || 'Could not load user trends.');
      }

      const csvFiles = Array.isArray(data.csv_files) ? data.csv_files : [];
      const records = normalizeTrendRecords(data.records);
      const fileSessions = normalizeTrendSessions(data.file_sessions);
      const users = buildUserSummaries(records, fileSessions);
      const selectedUserStillExists = users.some((user) => user.id === state.users.selectedUserId);

      state.users.csvFiles = csvFiles;
      state.users.loadedFileCount = Number.isFinite(data.loaded_file_count) ? data.loaded_file_count : csvFiles.length;
      state.users.failedFileCount = Number.isFinite(data.failed_file_count) ? data.failed_file_count : 0;
      state.users.records = records;
      state.users.fileSessions = fileSessions;
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
    renderFileTypeControls(card);
    const visibleFiles = getVisibleFiles();
    renderSummary(card, visibleFiles);

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

    renderTable(card, visibleFiles);
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
      card.append('p').attr('class', 'message info').text('No final CSV data files were found.');
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
    renderUserEncouragement(panel, selectedUser);

    const trendSection = panel.append('section').attr('class', 'chart-section');
    trendSection.append('h2').text('Accuracy Over Time');
    renderTaskControls(trendSection);

    const series = aggregateUserTrendSeries(state.users.records, selectedUser.id);
    const chart = trendSection.append('div').attr('class', 'chart-wrap');
    renderUserTrendChart(chart.node(), series);

    const durationSection = panel.append('section').attr('class', 'chart-section');
    durationSection.append('h2').text('Duration Over Time');
    const durationSeries = aggregateUserDurationTrendSeries(state.users.fileSessions, selectedUser.id);
    const durationChart = durationSection.append('div').attr('class', 'chart-wrap duration-trend-chart');
    renderUserDurationTrendChart(durationChart.node(), durationSeries);

    const difficultyTask = getSelectedDifficultyTask(selectedUser.id);
    const difficultySection = panel.append('section').attr('class', 'chart-section');
    difficultySection.append('h2').text('Accuracy by Difficulty Over Dates');
    renderDifficultyTaskControls(difficultySection, selectedUser.id, difficultyTask);

    const difficultySeries = aggregateUserDifficultyTrendSeries(state.users.records, selectedUser.id, difficultyTask);
    const difficultyChart = difficultySection.append('div').attr('class', 'chart-wrap difficulty-trend-chart');
    renderUserDifficultyTrendChart(difficultyChart.node(), difficultySeries, difficultyTask);
  }

  function renderUserEncouragement(panel, user) {
    const trials = formatUnit(user.trials, 'trial');
    const sessions = formatUnit(user.sessions, 'session');
    const minutes = formatMinutesPhrase(user.durationMs);
    const encouragement = panel.append('p').attr('class', 'user-encouragement');

    if (isAdminLogin()) {
      encouragement.append('span').text(`${user.label} has completed `);
      encouragement.append('span').attr('class', 'encouragement-number').text(trials);
      encouragement.append('span').text(' across ');
      encouragement.append('span').attr('class', 'encouragement-number').text(sessions);
      encouragement.append('span').text(' in ');
      encouragement.append('span').attr('class', 'encouragement-number').text(minutes);
      encouragement.append('span').text('. Keep going!');
      return;
    }

    encouragement.append('span').text("You've done ");
    encouragement.append('span').attr('class', 'encouragement-number').text(trials);
    encouragement.append('span').text(', ');
    encouragement.append('span').attr('class', 'encouragement-number').text(sessions);
    encouragement.append('span').text(' in ');
    encouragement.append('span').attr('class', 'encouragement-number').text(minutes);
    encouragement.append('span').text('. Keep going!');
  }

  function renderTaskControls(panel) {
    const controls = panel.append('div').attr('class', 'task-controls');
    getPlottedTasks().forEach((task) => {
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

  function renderDifficultyTaskControls(panel, userId, selectedTask) {
    const controls = panel.append('div').attr('class', 'task-toggle-controls');
    getPlottedTasks().forEach((task) => {
      const button = controls
        .append('button')
        .attr('type', 'button')
        .attr('class', task === selectedTask ? 'task-toggle active' : 'task-toggle')
        .attr('aria-pressed', task === selectedTask ? 'true' : 'false')
        .style('--task-color', TASK_COLORS[task])
        .on('click', () => {
          state.users.difficultyTaskByUser[userId] = task;
          renderUsers();
        });

      button
        .append('span')
        .attr('class', 'task-swatch')
        .style('background', TASK_COLORS[task]);
      button.append('span').text(task);
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

  function renderFileTypeControls(card) {
    const counts = {
      final: state.files.filter(isFinalCsvFile).length,
      session: state.files.filter(isSessionCsvFile).length,
      pause: state.files.filter(isPauseCsvFile).length
    };
    const controls = card.append('div').attr('class', 'file-type-controls');
    controls
      .append('span')
      .attr('class', 'file-type-label')
      .text(`Showing final CSV files (${counts.final})`);

    [
      { key: 'showSessionFiles', label: `Session files (${counts.session})` },
      { key: 'showPauseFiles', label: `Pause files (${counts.pause})` }
    ].forEach((option) => {
      const label = controls.append('label').attr('class', 'checkbox-row file-type-option');
      label
        .append('input')
        .attr('type', 'checkbox')
        .property('checked', state.filters[option.key])
        .on('change', (event) => {
          state.filters[option.key] = event.currentTarget.checked;
          if (event.currentTarget.checked) {
            loadFiles();
          } else {
            renderFiles();
          }
        });
      label.append('span').text(option.label);
    });
  }

  function renderSummary(card, files = state.files) {
    const totalBytes = d3.sum(files, (file) => Number(file.size_bytes) || 0);
    const latestTimestamp = d3.max(files, (file) => Number(file.created_at) || 0);
    const metrics = [
      { label: 'Files', value: String(files.length || 0) },
      { label: 'Total Size', value: formatBytes(totalBytes) },
      { label: 'Newest File', value: latestTimestamp ? formatDate(latestTimestamp) : 'None' }
    ];

    const summary = card.append('div').attr('class', 'summary');
    const metric = summary.selectAll('.metric').data(metrics).enter().append('div').attr('class', 'metric');
    metric.append('div').attr('class', 'metric-label').text((item) => item.label);
    metric.append('div').attr('class', 'metric-value').text((item) => item.value);
  }

  function renderTable(card, files = state.files) {
    const wrap = card.append('div').attr('class', 'table-wrap');
    const table = wrap.append('table');
    table
      .append('thead')
      .append('tr')
      .selectAll('th')
      .data(['File', 'Duration', 'Size', 'Created', 'Test Pass Rate', 'Actions'])
      .enter()
      .append('th')
      .text((label) => label);

    const tbody = table.append('tbody');
    if (!files.length) {
      tbody
        .append('tr')
        .append('td')
        .attr('class', 'empty-cell')
        .attr('colspan', 6)
        .text(state.loadingFiles ? 'Loading files...' : (state.files.length ? 'No files match the selected file type filters.' : 'No files found.'));
      return;
    }

    const maxDurationMs = d3.max(files, getDurationTotalMs) || 0;
    const rows = tbody.selectAll('tr').data(files, (file) => file.name).enter().append('tr');
    rows.append('td').append('span').attr('class', 'file-name').text((file) => file.name);
    rows.append('td').each(function (file) {
      renderDurationStack(d3.select(this), file, maxDurationMs);
    });
    rows.append('td').text((file) => formatBytes(file.size_bytes));
    rows.append('td').text((file) => formatDate(file.created_at));
    rows.append('td').text(formatCatchPassRate);
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

  function renderDurationStack(cell, file, maxDurationMs) {
    const trainingMs = Number(file.duration?.trainingMs) || 0;
    const restingMs = Number(file.duration?.restingMs) || 0;
    const totalMs = trainingMs + restingMs;
    const minutes = getDurationMinuteParts(trainingMs, restingMs);
    const trainingRatio = totalMs > 0 ? (trainingMs / totalMs) * 100 : 0;
    const restingRatio = totalMs > 0 ? (restingMs / totalMs) * 100 : 0;
    const barWidth = getDurationBarWidth(totalMs, maxDurationMs);
    const title = `${minutes.total}m = ${minutes.training}m training + ${minutes.resting}m resting`;

    const stack = cell
      .append('div')
      .attr('class', 'duration-stack')
      .style('--duration-width', `${barWidth}px`)
      .attr('title', title);

    const label = stack.append('div').attr('class', 'duration-stack-label');
    label.append('span').attr('class', 'duration-total-label').text(`${minutes.total}m`);
    label
      .append('span')
      .attr('class', 'duration-equation')
      .text(`${minutes.training}m + ${minutes.resting}m`);

    const bar = stack.append('div').attr('class', 'duration-bar');
    bar
      .append('span')
      .attr('class', 'duration-segment training')
      .style('width', `${trainingRatio}%`);
    bar
      .append('span')
      .attr('class', 'duration-segment resting')
      .style('width', `${restingRatio}%`);
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

  async function fetchCsvRows(fileName) {
    if (csvRowsCache.has(fileName)) {
      return csvRowsCache.get(fileName);
    }

    const csvText = await fetchCsvFile(fileName);
    const rows = d3.csvParse(csvText);
    csvRowsCache.set(fileName, rows);
    return rows;
  }

  async function hydrateFileDurationMetrics(files) {
    const targets = files.filter((file) => isCsvFile(file) && isPortalDataCsvFile(file));
    await Promise.all(targets.map(async (file) => {
      try {
        file.duration = calculateDurationMetrics(await fetchCsvRows(file.name));
        file.durationError = false;
      } catch (error) {
        if (!state.authenticated) {
          throw error;
        }

        file.duration = null;
        file.durationError = true;
      }
    }));
  }

  function calculateDurationMetrics(rows) {
    const rowDurations = new Map();
    const trialDurations = new Map();
    let previousElapsed = null;
    let trainingMs = 0;
    let restingMs = 0;

    rows.forEach((row) => {
      const elapsed = parseFiniteNumber(row.time_elapsed);
      const rt = parseFiniteNumber(row.rt);
      let durationMs = 0;

      if (elapsed !== null) {
        if (previousElapsed !== null && elapsed >= previousElapsed) {
          durationMs = elapsed - previousElapsed;
        } else if (rt !== null) {
          durationMs = rt;
        }
        previousElapsed = elapsed;
      } else if (rt !== null) {
        durationMs = rt;
      }

      rowDurations.set(row, durationMs);

      if (isRestingRow(row)) {
        restingMs += durationMs;
        return;
      }

      const trialKey = getTrialKey(row);
      if (!trialKey) {
        return;
      }

      trainingMs += durationMs;
      if (!trialDurations.has(trialKey)) {
        trialDurations.set(trialKey, {
          durationMs: 0,
          task: normalizeTask(row),
          difficultyLevel: '',
          difficultySortValue: ''
        });
      }

      const trial = trialDurations.get(trialKey);
      trial.durationMs += durationMs;
      if (!trial.task) {
        trial.task = normalizeTask(row);
      }

      const difficulty = parseDifficultyLevel(row);
      if (difficulty) {
        trial.difficultyLevel = difficulty.level;
        trial.difficultySortValue = difficulty.sortValue;
      }
    });

    return {
      totalMs: trainingMs + restingMs,
      trainingMs,
      restingMs,
      rowDurations,
      trialDurations
    };
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

  function formatCatchPassRate(file) {
    const metric = file?.catch_pass_rate;
    const total = Number(metric?.total) || 0;
    if (!total) {
      return 'N/A';
    }

    const correct = Number(metric?.correct) || 0;
    return `${formatPercent(metric.accuracy)} (${correct}/${total})`;
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

  function isDeploymentTaskVisible(task) {
    return SHOW_UNUSED_TASKS || !UNUSED_DEPLOYMENT_TASKS.has(task);
  }

  function getPlottedTasks() {
    return TASKS.filter(isDeploymentTaskVisible);
  }

  function getVisibleFiles() {
    return state.files.filter((file) => {
      if (!isCsvFile(file)) {
        return false;
      }
      if (isFinalCsvFile(file)) {
        return true;
      }
      if (isSessionCsvFile(file)) {
        return state.filters.showSessionFiles;
      }
      if (isPauseCsvFile(file)) {
        return state.filters.showPauseFiles;
      }

      return false;
    });
  }

  function getRequestedMetricTypes() {
    const types = ['final'];
    if (state.filters.showSessionFiles) {
      types.push('session');
    }
    if (state.filters.showPauseFiles) {
      types.push('pause');
    }

    return types;
  }

  function isPortalDataCsvFile(file) {
    return isFinalCsvFile(file) || isSessionCsvFile(file) || isPauseCsvFile(file);
  }

  function isFinalCsvFile(file) {
    return isCsvFile(file) && getBaseFileName(file.name).toLowerCase().startsWith('final');
  }

  function isSessionCsvFile(file) {
    return isCsvFile(file) && getBaseFileName(file.name).toLowerCase().startsWith('session');
  }

  function isPauseCsvFile(file) {
    return isCsvFile(file) && getBaseFileName(file.name).toLowerCase().startsWith('pause');
  }

  function getBaseFileName(fileName) {
    const parts = String(fileName || '').split('/');
    return parts[parts.length - 1] || '';
  }

  function parseFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function parseApiDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
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

    const date = new Date(value || '');
    return Number.isNaN(date.getTime()) ? new Date(NaN) : date;
  }

  function normalizeTrendRecords(records) {
    if (!Array.isArray(records)) {
      return [];
    }

    return records
      .map((record) => {
        const userId = String(record.userId || '').trim() || 'Unknown';
        const task = String(record.task || '').trim();
        const difficultyLevel = String(record.difficultyLevel || '').trim();
        const date = parseApiDate(record.dateLocal);
        if (!task || !difficultyLevel || Number.isNaN(date.getTime())) {
          return null;
        }

        return {
          userId,
          userLabel: String(record.userLabel || formatUserLabel(userId)),
          task,
          correct: Boolean(record.correct),
          difficultyLevel,
          difficultySortValue: record.difficultySortValue,
          durationMs: Number(record.durationMs) || 0,
          date,
          dateKey: String(record.dateKey || formatDateKey(date)),
          fileName: String(record.fileName || '')
        };
      })
      .filter(Boolean);
  }

  function normalizeTrendSessions(sessions) {
    if (!Array.isArray(sessions)) {
      return [];
    }

    return sessions
      .map((session) => {
        const userId = String(session.userId || '').trim() || 'Unknown';
        const date = parseApiDate(session.dateLocal);
        if (Number.isNaN(date.getTime())) {
          return null;
        }

        return {
          userId,
          userLabel: String(session.userLabel || formatUserLabel(userId)),
          task: String(session.task || '').trim(),
          fileName: String(session.fileName || ''),
          date,
          dateKey: String(session.dateKey || formatDateKey(date)),
          durationMs: Number(session.durationMs) || 0,
          trainingMs: Number(session.trainingMs) || 0,
          restingMs: Number(session.restingMs) || 0
        };
      })
      .filter(Boolean);
  }

  function isRestingRow(row) {
    return REST_TRIAL_CATEGORIES.has(String(row.trial_category || '').trim());
  }

  function getTrialKey(row) {
    const trialNumber = String(row.overall_trial_number ?? '').trim();
    if (!trialNumber) {
      return '';
    }

    return `${normalizeTask(row) || 'Unknown'}|${trialNumber}`;
  }

  function formatUnit(value, unit) {
    const count = Number(value) || 0;
    return `${count} ${count === 1 ? unit : `${unit}s`}`;
  }

  function formatDurationCell(valueMs) {
    const ms = Number(valueMs);
    if (!Number.isFinite(ms) || ms <= 0) {
      return '0s';
    }

    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }

    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (totalMinutes < 60) {
      return seconds ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  function getDurationMinuteParts(trainingMs, restingMs) {
    const safeTrainingMs = Number(trainingMs) || 0;
    const safeRestingMs = Number(restingMs) || 0;
    const total = Math.floor((safeTrainingMs + safeRestingMs) / 60000);
    let training = Math.floor(safeTrainingMs / 60000);
    let resting = Math.floor(safeRestingMs / 60000);
    const missingMinutes = total - training - resting;

    if (missingMinutes > 0) {
      if (safeRestingMs % 60000 >= safeTrainingMs % 60000) {
        resting += missingMinutes;
      } else {
        training += missingMinutes;
      }
    }

    return { total, training, resting };
  }

  function getDurationTotalMs(file) {
    const trainingMs = Number(file.duration?.trainingMs) || 0;
    const restingMs = Number(file.duration?.restingMs) || 0;
    return trainingMs + restingMs;
  }

  function getDurationBarWidth(totalMs, maxDurationMs) {
    if (!Number.isFinite(totalMs) || totalMs <= 0 || !Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
      return DURATION_BAR_MIN_WIDTH;
    }

    const ratio = Math.min(1, totalMs / maxDurationMs);
    return Math.round(DURATION_BAR_MIN_WIDTH + ratio * (DURATION_BAR_MAX_WIDTH - DURATION_BAR_MIN_WIDTH));
  }

  function formatDurationTick(valueMs) {
    const ms = Number(valueMs);
    if (!Number.isFinite(ms) || ms <= 0) {
      return '0s';
    }
    if (ms < 60000) {
      return `${Math.round(ms / 1000)}s`;
    }

    return `${Math.round(ms / 60000)}m`;
  }

  function formatMinutesPhrase(valueMs) {
    const ms = Number(valueMs);
    const minutes = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60000) : 0;
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
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

  function parseDifficultyLevel(row) {
    const rawLevel = String(row.difficulty_level ?? '').trim();
    if (rawLevel === '') {
      return null;
    }

    const numericLevel = Number(rawLevel);
    return {
      level: Number.isFinite(numericLevel) ? String(numericLevel) : rawLevel,
      sortValue: Number.isFinite(numericLevel) ? numericLevel : rawLevel
    };
  }

  function compareDifficultySort(a, b) {
    if (typeof a.sortValue === 'number' && typeof b.sortValue === 'number') {
      return a.sortValue - b.sortValue;
    }

    return String(a.sortValue).localeCompare(String(b.sortValue), undefined, { numeric: true });
  }

  function aggregateAccuracyByDifficulty(rows) {
    const groups = new Map();

    rows.forEach((row) => {
      const correct = parseBoolean(row.correct);
      const difficulty = parseDifficultyLevel(row);
      if (correct === null || !difficulty) {
        return;
      }

      const key = difficulty.level;
      if (!groups.has(key)) {
        groups.set(key, {
          level: key,
          sortValue: difficulty.sortValue,
          correct: 0,
          total: 0
        });
      }

      const group = groups.get(key);
      group.correct += correct ? 1 : 0;
      group.total += 1;
    });

    return Array.from(groups.values())
      .sort(compareDifficultySort)
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

  function inferTaskFromRows(rows) {
    const row = rows.find((item) => normalizeTask(item));
    return row ? normalizeTask(row) : '';
  }

  function extractResponseRecords(file, rows, scopedUserId = '', durationMetrics = null) {
    const sessionDate = parseSessionDate(file);
    const sessionKey = formatDateKey(sessionDate);

    return rows
      .map((row) => {
        const correct = parseBoolean(row.correct);
        const task = normalizeTask(row);
        const difficulty = parseDifficultyLevel(row);
        if (correct === null || !task || !difficulty) {
          return null;
        }

        const userId = scopedUserId || getUserId(row, file.name);
        const trialDuration = durationMetrics?.trialDurations?.get(getTrialKey(row));
        return {
          userId,
          userLabel: formatUserLabel(userId),
          task,
          correct,
          difficultyLevel: difficulty.level,
          difficultySortValue: difficulty.sortValue,
          durationMs: trialDuration?.durationMs || 0,
          date: sessionDate,
          dateKey: sessionKey,
          fileName: file.name
        };
      })
      .filter(Boolean);
  }

  function extractFileSessionSummary(file, rows, durationMetrics, scopedUserId = '') {
    const userId = scopedUserId || getUserId(rows.find((row) => getUserId(row, file.name) !== 'Unknown') || {}, file.name);
    if (!userId || userId === 'Unknown') {
      return null;
    }

    const sessionDate = parseSessionDate(file);
    return {
      userId,
      userLabel: formatUserLabel(userId),
      task: inferTaskFromRows(rows),
      fileName: file.name,
      date: sessionDate,
      dateKey: formatDateKey(sessionDate),
      durationMs: durationMetrics?.totalMs || 0,
      trainingMs: durationMetrics?.trainingMs || 0,
      restingMs: durationMetrics?.restingMs || 0
    };
  }

  function buildUserSummaries(records, sessions = []) {
    const users = new Map();

    function ensureUser(userId, userLabel) {
      if (!users.has(userId)) {
        users.set(userId, {
          id: userId,
          label: userLabel,
          trials: 0,
          correct: 0,
          sessions: new Set(),
          durationMs: 0,
          trainingMs: 0,
          restingMs: 0
        });
      }

      return users.get(userId);
    }

    records.forEach((record) => {
      const user = ensureUser(record.userId, record.userLabel);
      user.trials += 1;
      user.correct += record.correct ? 1 : 0;
    });

    sessions.forEach((session) => {
      const user = ensureUser(session.userId, session.userLabel);
      user.sessions.add(session.fileName);
      user.durationMs += session.durationMs || 0;
      user.trainingMs += session.trainingMs || 0;
      user.restingMs += session.restingMs || 0;
    });

    return Array.from(users.values())
      .map((user) => ({
        id: user.id,
        label: user.label,
        trials: user.trials,
        accuracy: user.trials ? (user.correct / user.trials) * 100 : 0,
        sessions: user.sessions.size,
        durationMs: user.durationMs,
        trainingMs: user.trainingMs,
        restingMs: user.restingMs
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

    return getPlottedTasks().map((task) => ({
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

  function aggregateUserDurationTrendSeries(sessions, userId) {
    const groups = new Map();

    sessions.forEach((session) => {
      if (
        session.userId !== userId ||
        Number.isNaN(session.date.getTime()) ||
        !isDeploymentTaskVisible(session.task)
      ) {
        return;
      }

      const key = `${session.dateKey}|${session.task}`;
      if (!groups.has(key)) {
        groups.set(key, {
          date: startOfDay(session.date),
          dateKey: session.dateKey,
          task: session.task,
          durationMs: 0,
          trainingMs: 0,
          restingMs: 0,
          sessions: 0
        });
      }

      const group = groups.get(key);
      group.durationMs += session.durationMs || 0;
      group.trainingMs += session.trainingMs || 0;
      group.restingMs += session.restingMs || 0;
      group.sessions += 1;
    });

    return getPlottedTasks().map((task) => ({
      task,
      color: TASK_COLORS[task],
      values: Array.from(groups.values())
        .filter((group) => group.task === task)
        .sort((a, b) => a.date - b.date)
    }));
  }

  function aggregateUserDifficultyTrendSeries(records, userId, task) {
    const groups = new Map();

    records.forEach((record) => {
      if (
        record.userId !== userId ||
        record.task !== task ||
        Number.isNaN(record.date.getTime()) ||
        !record.difficultyLevel
      ) {
        return;
      }

      const key = `${record.dateKey}|${record.difficultyLevel}`;
      if (!groups.has(key)) {
        groups.set(key, {
          date: startOfDay(record.date),
          dateKey: record.dateKey,
          level: record.difficultyLevel,
          sortValue: record.difficultySortValue,
          correct: 0,
          total: 0
        });
      }

      const group = groups.get(key);
      group.correct += record.correct ? 1 : 0;
      group.total += 1;
    });

    const byDate = new Map();
    Array.from(groups.values()).forEach((group) => {
      if (!byDate.has(group.dateKey)) {
        byDate.set(group.dateKey, {
          date: group.date,
          dateKey: group.dateKey,
          values: []
        });
      }

      byDate.get(group.dateKey).values.push({
        level: group.level,
        sortValue: group.sortValue,
        accuracy: group.total ? (group.correct / group.total) * 100 : 0,
        correct: group.correct,
        total: group.total
      });
    });

    const series = Array.from(byDate.values())
      .sort((a, b) => a.date - b.date)
      .map((item) => ({
        date: item.date,
        dateKey: item.dateKey,
        values: item.values.sort(compareDifficultySort)
      }));

    const maxIndex = series.length - 1;
    return series.map((item, index) => ({
      ...item,
      opacity: maxIndex > 0 ? Number((0.3 + (index / maxIndex) * 0.7).toFixed(3)) : 1
    }));
  }

  function aggregateUserDurationDifficultyTrendSeries(records, userId, task) {
    const groups = new Map();

    records.forEach((record) => {
      if (
        record.userId !== userId ||
        record.task !== task ||
        Number.isNaN(record.date.getTime()) ||
        !record.difficultyLevel ||
        !record.durationMs
      ) {
        return;
      }

      const key = `${record.dateKey}|${record.difficultyLevel}`;
      if (!groups.has(key)) {
        groups.set(key, {
          date: startOfDay(record.date),
          dateKey: record.dateKey,
          level: record.difficultyLevel,
          sortValue: record.difficultySortValue,
          durationMs: 0,
          total: 0
        });
      }

      const group = groups.get(key);
      group.durationMs += record.durationMs;
      group.total += 1;
    });

    const byDate = new Map();
    Array.from(groups.values()).forEach((group) => {
      if (!byDate.has(group.dateKey)) {
        byDate.set(group.dateKey, {
          date: group.date,
          dateKey: group.dateKey,
          values: []
        });
      }

      byDate.get(group.dateKey).values.push({
        level: group.level,
        sortValue: group.sortValue,
        averageDurationMs: group.total ? group.durationMs / group.total : 0,
        totalDurationMs: group.durationMs,
        total: group.total
      });
    });

    const series = Array.from(byDate.values())
      .sort((a, b) => a.date - b.date)
      .map((item) => ({
        date: item.date,
        dateKey: item.dateKey,
        values: item.values.sort(compareDifficultySort)
      }));

    const maxIndex = series.length - 1;
    return series.map((item, index) => ({
      ...item,
      opacity: maxIndex > 0 ? Number((0.3 + (index / maxIndex) * 0.7).toFixed(3)) : 1
    }));
  }

  function getSelectedDifficultyTask(userId) {
    const savedTask = state.users.difficultyTaskByUser[userId];
    if (TASKS.includes(savedTask) && isDeploymentTaskVisible(savedTask)) {
      return savedTask;
    }

    return getFirstUserTask(userId) || getPlottedTasks()[0] || TASKS[0];
  }

  function getFirstUserTask(userId) {
    const availableTasks = new Set(
      state.users.records
        .filter((record) => record.userId === userId && record.difficultyLevel)
        .map((record) => record.task)
    );

    return getPlottedTasks().find((task) => availableTasks.has(task)) || '';
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

  function renderUserDurationTrendChart(container, series) {
    container.innerHTML = '';

    const visibleSeries = series.filter((item) => state.users.visibleTasks[item.task] && item.values.length);
    const points = visibleSeries.flatMap((item) => item.values);
    if (!points.length) {
      const empty = document.createElement('p');
      empty.className = 'message info';
      empty.textContent = 'Select at least one task with available duration data to show the chart.';
      container.appendChild(empty);
      return;
    }

    const width = Math.max(container.clientWidth || 760, 360);
    const height = 420;
    const margin = { top: 24, right: 34, bottom: 56, left: 72 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    let [minDate, maxDate] = d3.extent(points, (point) => point.date);
    if (minDate.getTime() === maxDate.getTime()) {
      minDate = new Date(minDate.getTime() - 12 * 60 * 60 * 1000);
      maxDate = new Date(maxDate.getTime() + 12 * 60 * 60 * 1000);
    }

    const maxDuration = d3.max(points, (point) => point.durationMs) || 1000;
    const svg = d3
      .select(container)
      .append('svg')
      .attr('class', 'chart')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('role', 'img')
      .attr('aria-label', 'User duration over time by task');

    const x = d3.scaleTime().domain([minDate, maxDate]).range([margin.left, margin.left + innerWidth]);
    const y = d3
      .scaleLinear()
      .domain([0, maxDuration * 1.12])
      .nice()
      .range([margin.top + innerHeight, margin.top]);

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
      .call(d3.axisLeft(y).ticks(5).tickFormat(formatDurationTick));

    visibleSeries.forEach((item) => {
      if (item.values.length > 1) {
        svg
          .append('path')
          .datum(item.values)
          .attr('class', 'task-line')
          .attr('stroke', item.color)
          .attr('d', d3.line().x((point) => x(point.date)).y((point) => y(point.durationMs)));
      }

      const point = svg
        .selectAll(`.duration-trend-point-${item.task}`)
        .data(item.values)
        .enter()
        .append('g')
        .attr('class', `duration-trend-point duration-trend-point-${item.task}`);

      point
        .append('circle')
        .attr('cx', (value) => x(value.date))
        .attr('cy', (value) => y(value.durationMs))
        .attr('r', 5)
        .attr('fill', item.color);
      point
        .append('title')
        .text(
          (value) =>
            `${item.task} ${value.dateKey}: ${formatDurationCell(value.durationMs)} (${formatDurationCell(value.trainingMs)} training + ${formatDurationCell(value.restingMs)} resting)`
        );
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
      .text('Duration');
  }

  function renderUserDifficultyTrendChart(container, dateSeries, task) {
    container.innerHTML = '';

    const color = TASK_COLORS[task] || '#0b6b61';
    const points = dateSeries.flatMap((item) => item.values);
    if (!points.length) {
      const empty = document.createElement('p');
      empty.className = 'message info';
      empty.textContent = `No ${task} response rows with difficulty levels were found for this user.`;
      container.appendChild(empty);
      return;
    }

    const levels = Array.from(
      points
        .reduce((levelMap, point) => {
          if (!levelMap.has(point.level)) {
            levelMap.set(point.level, {
              level: point.level,
              sortValue: point.sortValue
            });
          }

          return levelMap;
        }, new Map())
        .values()
    )
      .sort(compareDifficultySort)
      .map((point) => point.level);

    const width = Math.max(container.clientWidth || 760, 360);
    const height = 420;
    const margin = { top: 24, right: 34, bottom: 56, left: 64 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3
      .select(container)
      .append('svg')
      .attr('class', 'chart')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('role', 'img')
      .attr('aria-label', `${task} accuracy by difficulty level over dates`);

    const x = d3
      .scalePoint()
      .domain(levels)
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

    function highlightDate(dateKey) {
      const hasHighlight = Boolean(dateKey);
      svg
        .selectAll('.difficulty-date-series')
        .attr('display', (item) => (!hasHighlight || item.dateKey === dateKey ? null : 'none'));
      d3.select(container)
        .selectAll('.date-legend-item')
        .classed('muted', (item) => hasHighlight && item.dateKey !== dateKey);
    }

    dateSeries.forEach((item) => {
      const dateGroup = svg.append('g').datum(item).attr('class', 'difficulty-date-series');

      if (item.values.length > 1) {
        const path = dateGroup
          .append('path')
          .datum(item.values)
          .attr('class', 'difficulty-date-line')
          .attr('stroke', color)
          .attr('stroke-opacity', item.opacity)
          .attr('d', d3.line().x((point) => x(point.level)).y((point) => y(point.accuracy)));

        path.append('title').text(`${item.dateKey}: ${task} accuracy by difficulty`);
      }

      const point = dateGroup
        .selectAll('g')
        .data(item.values)
        .enter()
        .append('g')
        .attr('class', 'difficulty-trend-point');

      point
        .append('circle')
        .attr('cx', (value) => x(value.level))
        .attr('cy', (value) => y(value.accuracy))
        .attr('r', 5)
        .attr('fill', color)
        .attr('fill-opacity', item.opacity);
      point
        .append('title')
        .text(
          (value) =>
            `${task} ${item.dateKey} level ${value.level}: ${formatPercent(value.accuracy)} (${value.correct}/${value.total})`
        );
    });

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

    const legend = d3.select(container).append('div').attr('class', 'date-legend');
    const legendItem = legend
      .selectAll('.date-legend-item')
      .data(dateSeries)
      .enter()
      .append('span')
      .attr('class', 'date-legend-item')
      .attr('tabindex', 0)
      .attr('aria-label', (item) => `Show only ${item.dateKey}`)
      .on('mouseenter focus', (event, item) => highlightDate(item.dateKey))
      .on('mouseleave blur', () => highlightDate(''));
    legendItem
      .append('span')
      .attr('class', 'date-legend-swatch')
      .style('background', color)
      .style('opacity', (item) => item.opacity);
    legendItem.append('span').text((item) => item.dateKey);
  }

  function renderUserDurationDifficultyTrendChart(container, dateSeries, task) {
    container.innerHTML = '';

    const color = TASK_COLORS[task] || '#0b6b61';
    const points = dateSeries.flatMap((item) => item.values);
    if (!points.length) {
      const empty = document.createElement('p');
      empty.className = 'message info';
      empty.textContent = `No ${task} duration rows with difficulty levels were found for this user.`;
      container.appendChild(empty);
      return;
    }

    const levels = Array.from(
      points
        .reduce((levelMap, point) => {
          if (!levelMap.has(point.level)) {
            levelMap.set(point.level, {
              level: point.level,
              sortValue: point.sortValue
            });
          }

          return levelMap;
        }, new Map())
        .values()
    )
      .sort(compareDifficultySort)
      .map((point) => point.level);

    const width = Math.max(container.clientWidth || 760, 360);
    const height = 420;
    const margin = { top: 24, right: 34, bottom: 56, left: 72 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const maxDuration = d3.max(points, (point) => point.averageDurationMs) || 1000;

    const svg = d3
      .select(container)
      .append('svg')
      .attr('class', 'chart')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('role', 'img')
      .attr('aria-label', `${task} average duration by difficulty level over dates`);

    const x = d3
      .scalePoint()
      .domain(levels)
      .range([margin.left, margin.left + innerWidth])
      .padding(0.45);
    const y = d3
      .scaleLinear()
      .domain([0, maxDuration * 1.12])
      .nice()
      .range([margin.top + innerHeight, margin.top]);

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
      .call(d3.axisLeft(y).ticks(5).tickFormat(formatDurationTick));

    function highlightDate(dateKey) {
      const hasHighlight = Boolean(dateKey);
      svg
        .selectAll('.duration-date-series')
        .attr('display', (item) => (!hasHighlight || item.dateKey === dateKey ? null : 'none'));
      d3.select(container)
        .selectAll('.date-legend-item')
        .classed('muted', (item) => hasHighlight && item.dateKey !== dateKey);
    }

    dateSeries.forEach((item) => {
      const dateGroup = svg.append('g').datum(item).attr('class', 'duration-date-series');

      if (item.values.length > 1) {
        const path = dateGroup
          .append('path')
          .datum(item.values)
          .attr('class', 'duration-date-line')
          .attr('stroke', color)
          .attr('stroke-opacity', item.opacity)
          .attr('d', d3.line().x((point) => x(point.level)).y((point) => y(point.averageDurationMs)));

        path.append('title').text(`${item.dateKey}: ${task} average trial duration by difficulty`);
      }

      const point = dateGroup
        .selectAll('g')
        .data(item.values)
        .enter()
        .append('g')
        .attr('class', 'duration-trend-point');

      point
        .append('circle')
        .attr('cx', (value) => x(value.level))
        .attr('cy', (value) => y(value.averageDurationMs))
        .attr('r', 5)
        .attr('fill', color)
        .attr('fill-opacity', item.opacity);
      point
        .append('title')
        .text(
          (value) =>
            `${task} ${item.dateKey} level ${value.level}: ${formatDurationCell(value.averageDurationMs)} avg (${value.total} trials, ${formatDurationCell(value.totalDurationMs)} total)`
        );
    });

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
      .text('Avg Trial Time');

    const legend = d3.select(container).append('div').attr('class', 'date-legend');
    const legendItem = legend
      .selectAll('.date-legend-item')
      .data(dateSeries)
      .enter()
      .append('span')
      .attr('class', 'date-legend-item')
      .attr('tabindex', 0)
      .attr('aria-label', (item) => `Show only ${item.dateKey}`)
      .on('mouseenter focus', (event, item) => highlightDate(item.dateKey))
      .on('mouseleave blur', () => highlightDate(''));
    legendItem
      .append('span')
      .attr('class', 'date-legend-swatch')
      .style('background', color)
      .style('opacity', (item) => item.opacity);
    legendItem.append('span').text((item) => item.dateKey);
  }
})();
