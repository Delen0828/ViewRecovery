<?php

declare(strict_types=1);

function data_portal_handle_request(string $path): void
{
    data_portal_send_security_headers();
    $config = data_portal_config();
    data_portal_start_session($config['session_name']);

    if ($path === '/data-portal/login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        data_portal_process_login($config);
        return;
    }

    if ($path === '/data-portal/logout' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        data_portal_require_valid_csrf();
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();
        header('Location: /data-portal', true, 302);
        return;
    }

    if ($path === '/data-portal/api/files') {
        data_portal_require_auth();
        data_portal_send_file_index($config['data_dir']);
        return;
    }

    if ($path === '/data-portal/download') {
        data_portal_require_auth();
        data_portal_download_file($config['data_dir']);
        return;
    }

    data_portal_render_page();
}

function data_portal_config(): array
{
    $defaultPasswordHash = '$2y$12$QcA4yw1pW53AmQw.bZDL0OhXkrWFAKZy5OWjj4Ghf.N5Q2BAdfgr6';
    $dataDir = __DIR__ . '/data';

    return [
        'username' => getenv('DATA_PORTAL_USER') ?: 'admin',
        'password_hash' => getenv('DATA_PORTAL_PASS_HASH') ?: $defaultPasswordHash,
        'data_dir' => is_dir($dataDir) ? realpath($dataDir) ?: $dataDir : $dataDir,
        'session_name' => getenv('DATA_PORTAL_SESSION_NAME') ?: 'data_portal_session',
        'max_login_attempts' => data_portal_positive_int(getenv('DATA_PORTAL_MAX_ATTEMPTS'), 5),
        'attempt_window_seconds' => data_portal_positive_int(getenv('DATA_PORTAL_ATTEMPT_WINDOW_SEC'), 900),
    ];
}

function data_portal_positive_int($value, int $default): int
{
    if (!is_string($value) || $value === '') {
        return $default;
    }

    $parsed = filter_var($value, FILTER_VALIDATE_INT);
    if ($parsed === false || $parsed <= 0) {
        return $default;
    }

    return $parsed;
}

function data_portal_start_session(string $sessionName): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    $secureCookie = data_portal_is_https_request();
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_strict_mode', '1');

    session_name($sessionName);
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'domain' => '',
        'secure' => $secureCookie,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();

    if (!isset($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
}

function data_portal_is_https_request(): bool
{
    if (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') {
        return true;
    }

    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower((string) $_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https') {
        return true;
    }

    if (!empty($_SERVER['HTTP_CF_VISITOR']) && strpos((string) $_SERVER['HTTP_CF_VISITOR'], '"https"') !== false) {
        return true;
    }

    return false;
}

function data_portal_send_security_headers(): void
{
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
}

function data_portal_current_user_ip(): string
{
    $remoteAddr = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');

    if (
        ($remoteAddr === '127.0.0.1' || $remoteAddr === '::1')
        && !empty($_SERVER['HTTP_CF_CONNECTING_IP'])
    ) {
        return (string) $_SERVER['HTTP_CF_CONNECTING_IP'];
    }

    return $remoteAddr;
}

function data_portal_rate_limit_file(): string
{
    return sys_get_temp_dir() . '/data_portal_login_attempts.json';
}

function data_portal_load_rate_limits(): array
{
    $file = data_portal_rate_limit_file();
    if (!is_file($file)) {
        return [];
    }

    $raw = @file_get_contents($file);
    if ($raw === false || $raw === '') {
        return [];
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function data_portal_store_rate_limits(array $limits): void
{
    $file = data_portal_rate_limit_file();
    $directory = dirname($file);
    if (!is_dir($directory)) {
        @mkdir($directory, 0700, true);
    }

    $encoded = json_encode($limits, JSON_PRETTY_PRINT);
    if (!is_string($encoded)) {
        return;
    }

    $fp = @fopen($file, 'c+');
    if ($fp === false) {
        return;
    }

    if (flock($fp, LOCK_EX)) {
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, $encoded);
        fflush($fp);
        flock($fp, LOCK_UN);
    }

    fclose($fp);
}

function data_portal_prune_attempts(array $attempts, int $windowSeconds): array
{
    $cutoff = time() - $windowSeconds;
    $active = [];

    foreach ($attempts as $ip => $timestamps) {
        if (!is_array($timestamps)) {
            continue;
        }

        $recent = array_values(array_filter($timestamps, static function ($ts) use ($cutoff) {
            return is_int($ts) && $ts > $cutoff;
        }));

        if ($recent !== []) {
            $active[$ip] = $recent;
        }
    }

    return $active;
}

function data_portal_is_login_blocked(string $ip, int $maxAttempts, int $windowSeconds): array
{
    $attempts = data_portal_prune_attempts(data_portal_load_rate_limits(), $windowSeconds);
    data_portal_store_rate_limits($attempts);

    $count = isset($attempts[$ip]) && is_array($attempts[$ip]) ? count($attempts[$ip]) : 0;
    if ($count < $maxAttempts) {
        return ['blocked' => false, 'retry_after' => 0];
    }

    $oldest = min($attempts[$ip]);
    $retryAfter = max(1, ($oldest + $windowSeconds) - time());

    return ['blocked' => true, 'retry_after' => $retryAfter];
}

function data_portal_record_login_failure(string $ip, int $windowSeconds): void
{
    $attempts = data_portal_prune_attempts(data_portal_load_rate_limits(), $windowSeconds);
    $attempts[$ip] = $attempts[$ip] ?? [];
    $attempts[$ip][] = time();
    data_portal_store_rate_limits($attempts);
}

function data_portal_clear_login_failures(string $ip, int $windowSeconds): void
{
    $attempts = data_portal_prune_attempts(data_portal_load_rate_limits(), $windowSeconds);
    unset($attempts[$ip]);
    data_portal_store_rate_limits($attempts);
}

function data_portal_process_login(array $config): void
{
    data_portal_require_valid_csrf();

    $ip = data_portal_current_user_ip();
    $blockState = data_portal_is_login_blocked($ip, $config['max_login_attempts'], $config['attempt_window_seconds']);

    if ($blockState['blocked']) {
        http_response_code(429);
        data_portal_render_page('Too many failed login attempts. Retry in ' . (int) $blockState['retry_after'] . ' seconds.');
        return;
    }

    $submittedUser = trim((string) ($_POST['username'] ?? ''));
    $submittedPassword = (string) ($_POST['password'] ?? '');

    $usernameValid = hash_equals($config['username'], $submittedUser);
    $passwordValid = password_verify($submittedPassword, $config['password_hash']);

    if ($usernameValid && $passwordValid) {
        session_regenerate_id(true);
        $_SESSION['authenticated'] = true;
        $_SESSION['auth_time'] = time();
        data_portal_clear_login_failures($ip, $config['attempt_window_seconds']);
        header('Location: /data-portal', true, 302);
        return;
    }

    data_portal_record_login_failure($ip, $config['attempt_window_seconds']);
    http_response_code(401);
    data_portal_render_page('Invalid username or password.');
}

function data_portal_require_valid_csrf(): void
{
    $posted = (string) ($_POST['csrf_token'] ?? '');
    $sessionToken = (string) ($_SESSION['csrf_token'] ?? '');

    if ($posted === '' || $sessionToken === '' || !hash_equals($sessionToken, $posted)) {
        http_response_code(400);
        echo 'Invalid CSRF token';
        exit();
    }
}

function data_portal_is_authenticated(): bool
{
    return !empty($_SESSION['authenticated']) && $_SESSION['authenticated'] === true;
}

function data_portal_require_auth(): void
{
    if (!data_portal_is_authenticated()) {
        data_portal_send_json(['error' => 'Unauthorized'], 401);
    }
}

function data_portal_send_json(array $payload, int $statusCode = 200): void
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode($payload);
    exit();
}

function data_portal_send_file_index(string $dataDir): void
{
    $search = trim((string) ($_GET['q'] ?? ''));
    $dateFrom = trim((string) ($_GET['date_from'] ?? ''));
    $dateTo = trim((string) ($_GET['date_to'] ?? ''));

    $fromTimestamp = null;
    if ($dateFrom !== '') {
        $dt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $dateFrom . ' 00:00:00');
        if ($dt !== false) {
            $fromTimestamp = $dt->getTimestamp();
        }
    }

    $toTimestamp = null;
    if ($dateTo !== '') {
        $dt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $dateTo . ' 23:59:59');
        if ($dt !== false) {
            $toTimestamp = $dt->getTimestamp();
        }
    }

    $files = [];
    if (is_dir($dataDir)) {
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($dataDir, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::LEAVES_ONLY
        );

        $baseDirPrefixLength = strlen($dataDir) + 1;

        foreach ($iterator as $fileInfo) {
            if (!$fileInfo->isFile()) {
                continue;
            }

            $absolutePath = $fileInfo->getPathname();
            $relativePath = str_replace('\\', '/', substr($absolutePath, $baseDirPrefixLength));
            $createdAt = $fileInfo->getCTime();
            $modifiedAt = $fileInfo->getMTime();

            if ($search !== '' && stripos($relativePath, $search) === false) {
                continue;
            }

            if ($fromTimestamp !== null && $createdAt < $fromTimestamp) {
                continue;
            }

            if ($toTimestamp !== null && $createdAt > $toTimestamp) {
                continue;
            }

            $files[] = [
                'name' => $relativePath,
                'size_bytes' => $fileInfo->getSize(),
                'created_at' => $createdAt,
                'modified_at' => $modifiedAt,
                'download_url' => '/data-portal/download?file=' . rawurlencode($relativePath),
            ];
        }
    }

    usort($files, static function (array $a, array $b): int {
        return $b['created_at'] <=> $a['created_at'];
    });

    data_portal_send_json([
        'generated_at' => time(),
        'total' => count($files),
        'files' => $files,
    ]);
}

function data_portal_download_file(string $dataDir): void
{
    $requested = trim((string) ($_GET['file'] ?? ''));
    if ($requested === '' || strpos($requested, "\0") !== false) {
        http_response_code(400);
        echo 'Missing or invalid file parameter.';
        exit();
    }

    $resolvedDataDir = realpath($dataDir);
    if ($resolvedDataDir === false) {
        http_response_code(404);
        echo 'Data directory not found.';
        exit();
    }

    $targetPath = realpath($resolvedDataDir . '/' . $requested);
    if ($targetPath === false || !is_file($targetPath)) {
        http_response_code(404);
        echo 'File not found.';
        exit();
    }

    $prefix = rtrim($resolvedDataDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
    if (substr($targetPath, 0, strlen($prefix)) !== $prefix) {
        http_response_code(403);
        echo 'Forbidden.';
        exit();
    }

    $mime = 'application/octet-stream';
    if (function_exists('mime_content_type')) {
        $detected = @mime_content_type($targetPath);
        if (is_string($detected) && $detected !== '') {
            $mime = $detected;
        }
    }

    header('Content-Description: File Transfer');
    header('Content-Type: ' . $mime);
    header('Content-Disposition: attachment; filename="' . basename($targetPath) . '"');
    header('Content-Length: ' . filesize($targetPath));
    header('Cache-Control: private, no-store, no-cache, must-revalidate');
    header('Pragma: no-cache');

    readfile($targetPath);
    exit();
}

function data_portal_render_page(string $errorMessage = ''): void
{
    $authenticated = data_portal_is_authenticated();
    $csrfToken = htmlspecialchars((string) ($_SESSION['csrf_token'] ?? ''), ENT_QUOTES, 'UTF-8');
    $nonce = base64_encode(random_bytes(18));

    header("Content-Security-Policy: default-src 'self'; script-src 'nonce-{$nonce}'; style-src 'nonce-{$nonce}'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    header('Content-Type: text/html; charset=UTF-8');

    $safeError = htmlspecialchars($errorMessage, ENT_QUOTES, 'UTF-8');

    echo '<!doctype html>';
    echo '<html lang="en">';
    echo '<head>';
    echo '<meta charset="UTF-8">';
    echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<title>Data Portal</title>';
    echo "<style nonce=\"{$nonce}\">";
    echo 'body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:linear-gradient(135deg,#ecfeff,#f8fafc);color:#0f172a;}';
    echo '.shell{max-width:1080px;margin:40px auto;padding:24px;}';
    echo '.card{background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;box-shadow:0 10px 30px rgba(15,23,42,0.06);}';
    echo 'h1{margin:0 0 16px;font-size:1.6rem;}';
    echo 'form{display:grid;gap:12px;}';
    echo 'label{font-weight:600;font-size:0.93rem;}';
    echo 'input{width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:10px;font-size:0.95rem;box-sizing:border-box;}';
    echo 'button{background:#0f766e;border:none;color:#fff;padding:10px 14px;border-radius:10px;font-weight:700;cursor:pointer;}';
    echo 'button.secondary{background:#334155;}';
    echo '.row{display:flex;gap:12px;flex-wrap:wrap;align-items:end;}';
    echo '.grow{flex:1 1 220px;}';
    echo '.muted{color:#475569;font-size:0.9rem;}';
    echo '.error{margin-bottom:12px;color:#b91c1c;background:#fee2e2;padding:10px;border-radius:8px;}';
    echo 'table{width:100%;border-collapse:collapse;margin-top:14px;font-size:0.92rem;}';
    echo 'th,td{text-align:left;border-bottom:1px solid #e2e8f0;padding:10px 8px;}';
    echo 'thead th{font-size:0.83rem;color:#334155;text-transform:uppercase;letter-spacing:.03em;}';
    echo 'a{color:#0f766e;text-decoration:none;font-weight:600;}';
    echo '.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:end;}';
    echo '.toolbar .grow{min-width:170px;}';
    echo '@media (max-width:720px){.shell{margin:18px auto;padding:14px;}.card{padding:14px;}table{font-size:0.86rem;}}';
    echo '</style>';
    echo '</head>';
    echo '<body>';
    echo '<div class="shell">';
    echo '<div class="card">';

    if (!$authenticated) {
        echo '<h1>Data Portal Login</h1>';
        echo '<p class="muted">Access to experiment files in <code>dist/data</code>.</p>';
        if ($safeError !== '') {
            echo '<div class="error">' . $safeError . '</div>';
        }
        echo '<form method="post" action="/data-portal/login" autocomplete="off">';
        echo '<input type="hidden" name="csrf_token" value="' . $csrfToken . '">';
        echo '<div><label for="username">Username</label><input id="username" name="username" required></div>';
        echo '<div><label for="password">Password</label><input id="password" type="password" name="password" required></div>';
        echo '<button type="submit">Sign In</button>';
        echo '</form>';
    } else {
        echo '<div class="row" style="justify-content:space-between;align-items:center;">';
        echo '<div><h1>Data Files</h1><p class="muted">Search by filename and filter by created date.</p></div>';
        echo '<form method="post" action="/data-portal/logout" style="display:block;">';
        echo '<input type="hidden" name="csrf_token" value="' . $csrfToken . '">';
        echo '<button type="submit" class="secondary">Log Out</button>';
        echo '</form></div>';

        echo '<div class="toolbar">';
        echo '<div class="grow"><label for="q">Filename search</label><input id="q" type="text" placeholder="e.g. user_123"></div>';
        echo '<div class="grow"><label for="date_from">Created from</label><input id="date_from" type="date"></div>';
        echo '<div class="grow"><label for="date_to">Created to</label><input id="date_to" type="date"></div>';
        echo '<div><button id="refresh" type="button">Refresh</button></div>';
        echo '</div>';

        echo '<p class="muted" id="status">Loading files...</p>';
        echo '<div style="overflow:auto;">';
        echo '<table>';
        echo '<thead><tr><th>File</th><th>Size</th><th>Created</th><th>Modified</th><th>Download</th></tr></thead>';
        echo '<tbody id="rows"></tbody>';
        echo '</table>';
        echo '</div>';

        echo "<script nonce=\"{$nonce}\">";
        echo '(function(){';
        echo 'const rows=document.getElementById("rows");';
        echo 'const status=document.getElementById("status");';
        echo 'const q=document.getElementById("q");';
        echo 'const dateFrom=document.getElementById("date_from");';
        echo 'const dateTo=document.getElementById("date_to");';
        echo 'const refresh=document.getElementById("refresh");';
        echo 'function fmtBytes(v){if(v<1024)return v+" B";const u=["KB","MB","GB"];let i=-1;let n=v;do{n/=1024;i++;}while(n>=1024&&i<u.length-1);return n.toFixed(1)+" "+u[i];}';
        echo 'function fmtDate(ts){return new Date(ts*1000).toLocaleString();}';
        echo 'async function load(){';
        echo 'status.textContent="Loading...";';
        echo 'const params=new URLSearchParams();';
        echo 'if(q.value.trim())params.set("q",q.value.trim());';
        echo 'if(dateFrom.value)params.set("date_from",dateFrom.value);';
        echo 'if(dateTo.value)params.set("date_to",dateTo.value);';
        echo 'const url="/data-portal/api/files"+(params.toString()?"?"+params.toString():"");';
        echo 'let res;';
        echo 'try{res=await fetch(url,{credentials:"same-origin"});}catch(e){status.textContent="Failed to load data.";return;}';
        echo 'if(res.status===401){window.location.href="/data-portal";return;}';
        echo 'if(!res.ok){status.textContent="Error loading files.";return;}';
        echo 'const data=await res.json();';
        echo 'rows.innerHTML="";';
        echo 'if(!data.files||!data.files.length){rows.innerHTML="<tr><td colspan=\"5\">No files found.</td></tr>";}';
        echo 'else{for(const file of data.files){const tr=document.createElement("tr");const safeName=file.name.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/\'/g,"&#39;");tr.innerHTML=`<td>${safeName}</td><td>${fmtBytes(file.size_bytes)}</td><td>${fmtDate(file.created_at)}</td><td>${fmtDate(file.modified_at)}</td><td><a href="${file.download_url}">Download</a></td>`;rows.appendChild(tr);}}';
        echo 'status.textContent=`${data.total||0} file(s)`;';
        echo '}';
        echo 'refresh.addEventListener("click",load);';
        echo '[q,dateFrom,dateTo].forEach((el)=>el.addEventListener("change",load));';
        echo 'let timer; q.addEventListener("input",function(){clearTimeout(timer);timer=setTimeout(load,220);});';
        echo 'load();';
        echo '})();';
        echo '</script>';
    }

    echo '</div>';
    echo '</div>';
    echo '</body>';
    echo '</html>';
}
