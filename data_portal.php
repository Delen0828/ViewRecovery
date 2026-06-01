<?php

declare(strict_types=1);

function data_portal_handle_request(string $path): void
{
    data_portal_send_security_headers();
    $config = data_portal_config();
    data_portal_start_session($config['session_name']);

    if ($path === '/data-portal' || $path === '/data-portal/') {
        data_portal_redirect_to_app();
    }

    if ($path === '/data-portal/api/session') {
        data_portal_send_session_state();
    }

    if ($path === '/data-portal/login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        data_portal_process_login($config);
    }

    if ($path === '/data-portal/logout' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        data_portal_process_logout();
    }

    if ($path === '/data-portal/api/files') {
        data_portal_require_auth();
        data_portal_send_file_index($config['data_dir'], data_portal_current_access_scope());
    }

    if ($path === '/data-portal/download') {
        data_portal_require_auth();
        data_portal_download_file($config['data_dir'], data_portal_current_access_scope());
    }

    if (strpos($path, '/data-portal/api/') === 0) {
        data_portal_send_json(['error' => 'Not found'], 404);
    }

    data_portal_redirect_to_app();
}

function data_portal_config(): array
{
    $defaultPasswordHash = '$2y$12$QcA4yw1pW53AmQw.bZDL0OhXkrWFAKZy5OWjj4Ghf.N5Q2BAdfgr6';
    $dataDir = data_portal_default_data_dir();

    return [
        'admin_username' => getenv('DATA_PORTAL_USER') ?: 'admin',
        'admin_password_hash' => getenv('DATA_PORTAL_PASS_HASH') ?: $defaultPasswordHash,
        'participant_password_hash' => getenv('DATA_PORTAL_PARTICIPANT_PASS_HASH') ?: '',
        'data_dir' => is_dir($dataDir) ? realpath($dataDir) ?: $dataDir : $dataDir,
        'session_name' => getenv('DATA_PORTAL_SESSION_NAME') ?: 'data_portal_session',
        'max_login_attempts' => data_portal_positive_int(getenv('DATA_PORTAL_MAX_ATTEMPTS'), 5),
        'attempt_window_seconds' => data_portal_positive_int(getenv('DATA_PORTAL_ATTEMPT_WINDOW_SEC'), 900),
    ];
}

function data_portal_default_data_dir(): string
{
    $configured = getenv('EXPERIMENT_DATA_DIR');
    if (is_string($configured) && trim($configured) !== '') {
        return $configured;
    }

    $portalConfigured = getenv('DATA_PORTAL_DATA_DIR');
    if (is_string($portalConfigured) && trim($portalConfigured) !== '') {
        return $portalConfigured;
    }

    if (basename(__DIR__) === 'dist') {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data';
    }

    return __DIR__ . DIRECTORY_SEPARATOR . 'data';
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
        data_portal_login_error(
            'Too many failed login attempts. Retry in ' . (int) $blockState['retry_after'] . ' seconds.',
            429,
            ['retry_after' => (int) $blockState['retry_after']]
        );
    }

    $submittedUser = trim((string) ($_POST['username'] ?? ''));
    $submittedPassword = (string) ($_POST['password'] ?? '');

    $isAdminUsername = hash_equals($config['admin_username'], $submittedUser);
    $passwordValid = password_verify($submittedPassword, $config['admin_password_hash']);

    if ($isAdminUsername && $passwordValid) {
        data_portal_set_authenticated_session('admin', $submittedUser);
        data_portal_clear_login_failures($ip, $config['attempt_window_seconds']);
        data_portal_login_success();
    }

    $participantId = $isAdminUsername ? '' : data_portal_normalize_participant_id($submittedUser);
    if ($participantId !== '' && data_portal_participant_password_valid($submittedPassword, $config)) {
        data_portal_set_authenticated_session('user', $participantId, $participantId);
        data_portal_clear_login_failures($ip, $config['attempt_window_seconds']);
        data_portal_login_success();
    }

    data_portal_record_login_failure($ip, $config['attempt_window_seconds']);
    data_portal_login_error('Invalid username or password.', 401);
}

function data_portal_process_logout(): void
{
    data_portal_require_valid_csrf();

    $wantsJson = data_portal_wants_json();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
    }
    session_destroy();

    if ($wantsJson) {
        data_portal_send_json(['success' => true, 'redirect' => '/data-portal/index.html']);
    }

    header('Location: /data-portal/index.html', true, 303);
    exit();
}

function data_portal_require_valid_csrf(): void
{
    $posted = (string) ($_POST['csrf_token'] ?? '');
    $sessionToken = (string) ($_SESSION['csrf_token'] ?? '');

    if ($posted === '' || $sessionToken === '' || !hash_equals($sessionToken, $posted)) {
        data_portal_abort_request(400, 'Invalid CSRF token');
    }
}

function data_portal_is_authenticated(): bool
{
    return !empty($_SESSION['authenticated']) && $_SESSION['authenticated'] === true;
}

function data_portal_set_authenticated_session(string $role, string $username, string $userId = ''): void
{
    session_regenerate_id(true);
    $_SESSION['authenticated'] = true;
    $_SESSION['auth_time'] = time();
    $_SESSION['role'] = $role;
    $_SESSION['username'] = $username;
    $_SESSION['user_id'] = $userId;
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

function data_portal_normalize_participant_id(string $value): string
{
    $trimmed = trim($value);
    if (preg_match('/^[A-Za-z0-9]{1,32}$/', $trimmed) !== 1) {
        return '';
    }

    return $trimmed;
}

function data_portal_participant_password_valid(string $submittedPassword, array $config): bool
{
    $hash = (string) ($config['participant_password_hash'] ?? '');
    if ($hash === '') {
        return true;
    }

    return password_verify($submittedPassword, $hash);
}

function data_portal_authenticated_role(): string
{
    if (!data_portal_is_authenticated()) {
        return '';
    }

    $role = (string) ($_SESSION['role'] ?? 'admin');
    return $role === 'user' ? 'user' : 'admin';
}

function data_portal_authenticated_user_id(): string
{
    if (data_portal_authenticated_role() !== 'user') {
        return '';
    }

    return data_portal_normalize_participant_id((string) ($_SESSION['user_id'] ?? ''));
}

function data_portal_current_access_scope(): array
{
    $role = data_portal_authenticated_role();
    if ($role === 'admin') {
        return ['role' => 'admin', 'user_id' => ''];
    }

    if ($role === 'user') {
        return ['role' => 'user', 'user_id' => data_portal_authenticated_user_id()];
    }

    return ['role' => '', 'user_id' => ''];
}

function data_portal_user_label(string $userId): string
{
    return $userId === '' ? '' : 'User ' . $userId;
}

function data_portal_require_auth(): void
{
    if (!data_portal_is_authenticated()) {
        data_portal_send_json(['error' => 'Unauthorized'], 401);
    }
}

function data_portal_wants_json(): bool
{
    $accept = (string) ($_SERVER['HTTP_ACCEPT'] ?? '');
    $requestedWith = strtolower((string) ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? ''));

    return stripos($accept, 'application/json') !== false || $requestedWith === 'xmlhttprequest';
}

function data_portal_login_success(): void
{
    if (data_portal_wants_json()) {
        data_portal_send_json([
            'success' => true,
            'redirect' => '/data-portal/index.html',
            'csrf_token' => (string) ($_SESSION['csrf_token'] ?? ''),
            'role' => data_portal_authenticated_role(),
            'user_id' => data_portal_authenticated_user_id(),
        ]);
    }

    header('Location: /data-portal/index.html', true, 303);
    exit();
}

function data_portal_login_error(string $message, int $statusCode, array $extra = []): void
{
    if (data_portal_wants_json()) {
        data_portal_send_json(array_merge(['success' => false, 'error' => $message], $extra), $statusCode);
    }

    $_SESSION['login_error'] = $message;
    header('Location: /data-portal/index.html', true, 303);
    exit();
}

function data_portal_abort_request(int $statusCode, string $message): void
{
    if (data_portal_wants_json()) {
        data_portal_send_json(['success' => false, 'error' => $message], $statusCode);
    }

    http_response_code($statusCode);
    header('Content-Type: text/plain; charset=UTF-8');
    echo $message;
    exit();
}

function data_portal_send_session_state(): void
{
    $loginError = (string) ($_SESSION['login_error'] ?? '');
    unset($_SESSION['login_error']);
    $role = data_portal_authenticated_role();
    $userId = data_portal_authenticated_user_id();

    data_portal_send_json([
        'authenticated' => data_portal_is_authenticated(),
        'csrf_token' => (string) ($_SESSION['csrf_token'] ?? ''),
        'login_error' => $loginError,
        'role' => $role,
        'user_id' => $userId,
        'user_label' => $role === 'user' ? data_portal_user_label($userId) : ($role === 'admin' ? 'Admin' : ''),
    ]);
}

function data_portal_send_json(array $payload, int $statusCode = 200): void
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit();
}

function data_portal_redirect_to_app(): void
{
    header('Location: /data-portal/index.html', true, 302);
    exit();
}

function data_portal_send_file_index(string $dataDir, array $scope): void
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

            if (!data_portal_file_allowed_for_scope($relativePath, $scope)) {
                continue;
            }

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

function data_portal_file_allowed_for_scope(string $relativePath, array $scope): bool
{
    if (($scope['role'] ?? '') === 'admin') {
        return true;
    }

    if (($scope['role'] ?? '') !== 'user') {
        return false;
    }

    $userId = data_portal_normalize_participant_id((string) ($scope['user_id'] ?? ''));
    if ($userId === '') {
        return false;
    }

    $baseName = basename(str_replace('\\', '/', $relativePath));
    return preg_match('/^user_' . preg_quote($userId, '/') . '_.+\.csv$/i', $baseName) === 1;
}

function data_portal_download_file(string $dataDir, array $scope): void
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

    $relativePath = str_replace('\\', '/', substr($targetPath, strlen($prefix)));
    if (!data_portal_file_allowed_for_scope($relativePath, $scope)) {
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
