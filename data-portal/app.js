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
    files: '/data-portal/api/files'
  };

  const state = {
    authenticated: false,
    csrfToken: '',
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
      state.loginError = data.login_error || '';

      if (state.authenticated) {
        await loadFiles();
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
    appendHeader(card, 'Data Portal Login', 'Access saved experiment files.');

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
      label: 'Username',
      required: true
    });

    appendInput(form, {
      id: 'password',
      name: 'password',
      label: 'Password',
      type: 'password',
      required: true
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
    appendHeader(card, 'Data Files', 'Search by filename and filter by created date.', true);
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

  function appendHeader(card, title, subtitle, withLogout) {
    const header = card.append('div').attr('class', 'portal-header');
    const copy = header.append('div');
    copy.append('h1').text(title);
    copy.append('p').attr('class', 'muted').text(subtitle);

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
      .data(['File', 'Size', 'Created', 'Modified', 'Download'])
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
    rows
      .append('td')
      .append('a')
      .attr('href', (file) => file.download_url)
      .text('Download');
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
})();
