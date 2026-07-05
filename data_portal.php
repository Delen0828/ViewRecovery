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

    if ($path === '/data-portal/api/user-trends') {
        data_portal_require_auth();
        data_portal_send_user_trends($config['data_dir'], data_portal_current_access_scope());
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
        data_portal_send_json(['success' => true, 'redirect' => '/data-portal/users.html']);
    }

    header('Location: /data-portal/users.html', true, 303);
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
            'redirect' => '/data-portal/users.html',
            'csrf_token' => (string) ($_SESSION['csrf_token'] ?? ''),
            'role' => data_portal_authenticated_role(),
            'user_id' => data_portal_authenticated_user_id(),
        ]);
    }

    header('Location: /data-portal/users.html', true, 303);
    exit();
}

function data_portal_login_error(string $message, int $statusCode, array $extra = []): void
{
    if (data_portal_wants_json()) {
        data_portal_send_json(array_merge(['success' => false, 'error' => $message], $extra), $statusCode);
    }

    $_SESSION['login_error'] = $message;
    header('Location: /data-portal/users.html', true, 303);
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
    header('Location: /data-portal/users.html', true, 302);
    exit();
}

function data_portal_send_file_index(string $dataDir, array $scope): void
{
    $search = trim((string) ($_GET['q'] ?? ''));
    $dateFrom = trim((string) ($_GET['date_from'] ?? ''));
    $dateTo = trim((string) ($_GET['date_to'] ?? ''));
    $metricTypes = data_portal_requested_metric_types();

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
    $metricsCache = data_portal_load_metrics_cache($dataDir);
    $metricsCacheDirty = false;

    if (is_dir($dataDir)) {
        $iterator = data_portal_data_file_iterator($dataDir);
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

            $file = [
                'name' => $relativePath,
                'size_bytes' => $fileInfo->getSize(),
                'created_at' => $createdAt,
                'modified_at' => $modifiedAt,
                'download_url' => '/data-portal/download?file=' . rawurlencode($relativePath),
            ];

            $metricType = data_portal_file_metric_type($relativePath);
            if ($metricType !== '' && isset($metricTypes[$metricType])) {
                try {
                    $metrics = data_portal_get_csv_metrics($absolutePath, $relativePath, $fileInfo, $metricsCache, $metricsCacheDirty);
                    $file['duration'] = $metrics['duration'];
                    $file['catch_pass_rate'] = $metrics['catch_pass_rate'];
                } catch (Throwable $error) {
                    $file['duration'] = null;
                    $file['catch_pass_rate'] = null;
                    $file['metrics_error'] = true;
                }
            }

            $files[] = $file;
        }
    }

    if ($metricsCacheDirty) {
        data_portal_store_metrics_cache($dataDir, $metricsCache);
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

function data_portal_send_user_trends(string $dataDir, array $scope): void
{
    $csvFiles = [];
    $records = [];
    $fileSessions = [];
    $loadedFileCount = 0;
    $failedFileCount = 0;
    $metricsCache = data_portal_load_metrics_cache($dataDir);
    $metricsCacheDirty = false;

    if (is_dir($dataDir)) {
        $iterator = data_portal_data_file_iterator($dataDir);
        $baseDirPrefixLength = strlen($dataDir) + 1;

        foreach ($iterator as $fileInfo) {
            if (!$fileInfo->isFile()) {
                continue;
            }

            $absolutePath = $fileInfo->getPathname();
            $relativePath = str_replace('\\', '/', substr($absolutePath, $baseDirPrefixLength));
            if (!data_portal_file_allowed_for_scope($relativePath, $scope) || data_portal_file_metric_type($relativePath) !== 'final') {
                continue;
            }

            $file = [
                'name' => $relativePath,
                'size_bytes' => $fileInfo->getSize(),
                'created_at' => $fileInfo->getCTime(),
                'modified_at' => $fileInfo->getMTime(),
                'download_url' => '/data-portal/download?file=' . rawurlencode($relativePath),
            ];
            $csvFiles[] = $file;

            try {
                $metrics = data_portal_get_csv_metrics($absolutePath, $relativePath, $fileInfo, $metricsCache, $metricsCacheDirty);
                $loadedFileCount++;
                foreach ($metrics['trend_records'] as $record) {
                    $records[] = $record;
                }
                if (isset($metrics['session']) && is_array($metrics['session'])) {
                    $fileSessions[] = $metrics['session'];
                }
            } catch (Throwable $error) {
                $failedFileCount++;
            }
        }
    }

    if ($metricsCacheDirty) {
        data_portal_store_metrics_cache($dataDir, $metricsCache);
    }

    usort($csvFiles, static function (array $a, array $b): int {
        return $b['created_at'] <=> $a['created_at'];
    });

    $trendPayload = data_portal_build_user_trend_payload($records, $fileSessions);
    $includeRecords = ((string) ($_GET['include_records'] ?? '')) === '1';

    data_portal_send_json([
        'generated_at' => time(),
        'csv_files' => $csvFiles,
        'loaded_file_count' => $loadedFileCount,
        'failed_file_count' => $failedFileCount,
        'records' => $includeRecords ? $records : [],
        'file_sessions' => $fileSessions,
        'user_summaries' => $trendPayload['user_summaries'],
        'accuracy_series' => $trendPayload['accuracy_series'],
        'duration_series' => $trendPayload['duration_series'],
        'difficulty_series' => $trendPayload['difficulty_series'],
    ]);
}


function data_portal_build_user_trend_payload(array $records, array $fileSessions): array
{
    $users = [];
    $accuracyGroups = [];
    $difficultyGroups = [];
    $durationGroups = [];

    foreach ($records as $record) {
        $userId = trim((string) ($record['userId'] ?? 'Unknown')) ?: 'Unknown';
        $userLabel = (string) ($record['userLabel'] ?? data_portal_user_label_for_chart($userId));
        $task = trim((string) ($record['task'] ?? ''));
        $dateKey = trim((string) ($record['dateKey'] ?? ''));
        $dateLocal = trim((string) ($record['dateLocal'] ?? ''));
        $difficultyLevel = trim((string) ($record['difficultyLevel'] ?? ''));
        if ($task === '' || $dateKey === '' || $dateLocal === '') {
            continue;
        }

        data_portal_ensure_user_summary($users, $userId, $userLabel);
        $users[$userId]['trials']++;
        $users[$userId]['correct'] += !empty($record['correct']) ? 1 : 0;

        $accuracyKey = $userId . "\0" . $dateKey . "\0" . $task;
        if (!isset($accuracyGroups[$accuracyKey])) {
            $accuracyGroups[$accuracyKey] = [
                'userId' => $userId,
                'userLabel' => $userLabel,
                'task' => $task,
                'dateLocal' => $dateLocal,
                'dateKey' => $dateKey,
                'correct' => 0,
                'total' => 0,
            ];
        }
        $accuracyGroups[$accuracyKey]['correct'] += !empty($record['correct']) ? 1 : 0;
        $accuracyGroups[$accuracyKey]['total']++;

        if ($difficultyLevel === '') {
            continue;
        }

        $difficultyKey = $accuracyKey . "\0" . $difficultyLevel;
        if (!isset($difficultyGroups[$difficultyKey])) {
            $difficultyGroups[$difficultyKey] = [
                'userId' => $userId,
                'userLabel' => $userLabel,
                'task' => $task,
                'dateLocal' => $dateLocal,
                'dateKey' => $dateKey,
                'difficultyLevel' => $difficultyLevel,
                'difficultySortValue' => $record['difficultySortValue'] ?? $difficultyLevel,
                'correct' => 0,
                'total' => 0,
            ];
        }
        $difficultyGroups[$difficultyKey]['correct'] += !empty($record['correct']) ? 1 : 0;
        $difficultyGroups[$difficultyKey]['total']++;
    }

    foreach ($fileSessions as $session) {
        $userId = trim((string) ($session['userId'] ?? 'Unknown')) ?: 'Unknown';
        $userLabel = (string) ($session['userLabel'] ?? data_portal_user_label_for_chart($userId));
        data_portal_ensure_user_summary($users, $userId, $userLabel);

        $fileName = (string) ($session['fileName'] ?? '');
        if ($fileName !== '') {
            $users[$userId]['sessions'][$fileName] = true;
        }
        $users[$userId]['durationMs'] += (float) ($session['durationMs'] ?? 0);
        $users[$userId]['trainingMs'] += (float) ($session['trainingMs'] ?? 0);
        $users[$userId]['restingMs'] += (float) ($session['restingMs'] ?? 0);

        $task = trim((string) ($session['task'] ?? ''));
        $dateKey = trim((string) ($session['dateKey'] ?? ''));
        $dateLocal = trim((string) ($session['dateLocal'] ?? ''));
        if ($task === '' || $dateKey === '' || $dateLocal === '') {
            continue;
        }

        $durationKey = $userId . "\0" . $dateKey . "\0" . $task;
        if (!isset($durationGroups[$durationKey])) {
            $durationGroups[$durationKey] = [
                'userId' => $userId,
                'userLabel' => $userLabel,
                'task' => $task,
                'dateLocal' => $dateLocal,
                'dateKey' => $dateKey,
                'durationMs' => 0.0,
                'trainingMs' => 0.0,
                'restingMs' => 0.0,
                'sessions' => 0,
            ];
        }
        $durationGroups[$durationKey]['durationMs'] += (float) ($session['durationMs'] ?? 0);
        $durationGroups[$durationKey]['trainingMs'] += (float) ($session['trainingMs'] ?? 0);
        $durationGroups[$durationKey]['restingMs'] += (float) ($session['restingMs'] ?? 0);
        $durationGroups[$durationKey]['sessions']++;
    }

    $userSummaries = array_map(static function (array $user): array {
        $trials = (int) $user['trials'];
        return [
            'id' => $user['id'],
            'label' => $user['label'],
            'trials' => $trials,
            'accuracy' => $trials > 0 ? ($user['correct'] / $trials) * 100 : 0,
            'sessions' => count($user['sessions']),
            'durationMs' => $user['durationMs'],
            'trainingMs' => $user['trainingMs'],
            'restingMs' => $user['restingMs'],
        ];
    }, array_values($users));

    usort($userSummaries, static fn(array $a, array $b): int => strnatcasecmp((string) $a['label'], (string) $b['label']));

    $durationSeries = array_values($durationGroups);
    usort($durationSeries, static fn(array $a, array $b): int => [$a['userLabel'], $a['dateKey'], $a['task']] <=> [$b['userLabel'], $b['dateKey'], $b['task']]);

    return [
        'user_summaries' => $userSummaries,
        'accuracy_series' => data_portal_finalize_count_series($accuracyGroups),
        'duration_series' => $durationSeries,
        'difficulty_series' => data_portal_finalize_count_series($difficultyGroups),
    ];
}

function data_portal_ensure_user_summary(array &$users, string $userId, string $userLabel): void
{
    if (isset($users[$userId])) {
        return;
    }

    $users[$userId] = [
        'id' => $userId,
        'label' => $userLabel,
        'trials' => 0,
        'correct' => 0,
        'sessions' => [],
        'durationMs' => 0.0,
        'trainingMs' => 0.0,
        'restingMs' => 0.0,
    ];
}

function data_portal_finalize_count_series(array $groups): array
{
    $series = array_values(array_map(static function (array $group): array {
        $total = (int) ($group['total'] ?? 0);
        $group['accuracy'] = $total > 0 ? (((int) ($group['correct'] ?? 0)) / $total) * 100 : 0;
        return $group;
    }, $groups));

    usort($series, static fn(array $a, array $b): int => [$a['userLabel'], $a['dateKey'], $a['task'], (string) ($a['difficultyLevel'] ?? '')] <=> [$b['userLabel'], $b['dateKey'], $b['task'], (string) ($b['difficultyLevel'] ?? '')]);

    return $series;
}

function data_portal_data_file_iterator(string $dataDir): Traversable
{
    $directory = new RecursiveDirectoryIterator($dataDir, FilesystemIterator::SKIP_DOTS);
    $includeBackups = data_portal_truthy_env('DATA_PORTAL_INCLUDE_BACKUPS');
    $filter = new RecursiveCallbackFilterIterator(
        $directory,
        static function (SplFileInfo $current) use ($includeBackups): bool {
            if (!$current->isDir()) {
                return $current->getBasename() !== '.data_portal_metrics_cache.json';
            }

            if (!$includeBackups && preg_match('/^\d{8}_\d{6}$/', $current->getBasename()) === 1) {
                return false;
            }

            return true;
        }
    );

    return new RecursiveIteratorIterator($filter, RecursiveIteratorIterator::LEAVES_ONLY);
}

function data_portal_truthy_env(string $name): bool
{
    $value = strtolower(trim((string) getenv($name)));
    return in_array($value, ['1', 'true', 'yes', 'on'], true);
}

function data_portal_requested_metric_types(): array
{
    $raw = trim((string) ($_GET['metric_types'] ?? ''));
    if ($raw === '') {
        return [];
    }

    $requested = [];
    foreach (explode(',', strtolower($raw)) as $type) {
        $type = trim($type);
        if (in_array($type, ['final', 'session', 'pause'], true)) {
            $requested[$type] = true;
        }
    }

    return $requested;
}

function data_portal_file_metric_type(string $relativePath): string
{
    $baseName = strtolower(basename(str_replace('\\', '/', $relativePath)));
    if (!str_ends_with($baseName, '.csv')) {
        return '';
    }

    if (str_starts_with($baseName, 'final')) {
        return 'final';
    }
    if (str_starts_with($baseName, 'session')) {
        return 'session';
    }
    if (str_starts_with($baseName, 'pause')) {
        return 'pause';
    }

    return '';
}

function data_portal_metrics_cache_file(string $dataDir): string
{
    if (is_dir($dataDir) && is_writable($dataDir)) {
        return rtrim($dataDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . '.data_portal_metrics_cache.json';
    }

    return sys_get_temp_dir() . '/data_portal_metrics_' . hash('sha256', $dataDir) . '.json';
}

function data_portal_load_metrics_cache(string $dataDir): array
{
    $file = data_portal_metrics_cache_file($dataDir);
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

function data_portal_store_metrics_cache(string $dataDir, array $cache): void
{
    $file = data_portal_metrics_cache_file($dataDir);
    $encoded = json_encode($cache, JSON_UNESCAPED_SLASHES);
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

function data_portal_get_csv_metrics(
    string $absolutePath,
    string $relativePath,
    SplFileInfo $fileInfo,
    array &$cache,
    bool &$cacheDirty
): array {
    $cacheKey = str_replace('\\', '/', $relativePath);
    $sizeBytes = $fileInfo->getSize();
    $modifiedAt = $fileInfo->getMTime();
    $parserVersion = 3;

    if (
        isset($cache[$cacheKey])
        && is_array($cache[$cacheKey])
        && ($cache[$cacheKey]['size_bytes'] ?? null) === $sizeBytes
        && ($cache[$cacheKey]['modified_at'] ?? null) === $modifiedAt
        && ($cache[$cacheKey]['parser_version'] ?? null) === $parserVersion
        && isset($cache[$cacheKey]['metrics'])
        && is_array($cache[$cacheKey]['metrics'])
    ) {
        return $cache[$cacheKey]['metrics'];
    }

    $metrics = data_portal_parse_csv_metrics($absolutePath, $relativePath, $fileInfo);
    $cache[$cacheKey] = [
        'size_bytes' => $sizeBytes,
        'modified_at' => $modifiedAt,
        'parser_version' => $parserVersion,
        'metrics' => $metrics,
    ];
    $cacheDirty = true;

    return $metrics;
}

function data_portal_parse_csv_metrics(string $absolutePath, string $relativePath, SplFileInfo $fileInfo): array
{
    $handle = @fopen($absolutePath, 'rb');
    if ($handle === false) {
        throw new RuntimeException('Could not open CSV file.');
    }

    $header = fgetcsv($handle, 0, ',', '"', '');
    if (!is_array($header) || $header === []) {
        fclose($handle);
        return data_portal_empty_csv_metrics($relativePath, $fileInfo);
    }

    $indexes = [];
    foreach ($header as $index => $column) {
        $indexes[(string) $column] = $index;
    }

    $dateInfo = data_portal_session_date_info($relativePath, $fileInfo);
    $fallbackUserId = data_portal_parse_user_id_from_filename($relativePath);
    $fallbackTask = data_portal_parse_task_from_filename($relativePath);
    $previousElapsed = null;
    $trainingMs = 0.0;
    $restingMs = 0.0;
    $catchCorrect = 0;
    $catchTotal = 0;
    $records = [];
    $sessionUserId = $fallbackUserId;
    $sessionTask = $fallbackTask;

    while (($row = fgetcsv($handle, 0, ',', '"', '')) !== false) {
        if (!is_array($row) || $row === [null]) {
            continue;
        }

        $elapsed = data_portal_parse_finite_number(data_portal_csv_value($row, $indexes, 'time_elapsed'));
        $rt = data_portal_parse_finite_number(data_portal_csv_value($row, $indexes, 'rt'));
        $durationMs = 0.0;

        if ($elapsed !== null) {
            if ($previousElapsed !== null && $elapsed >= $previousElapsed) {
                $durationMs = $elapsed - $previousElapsed;
            } elseif ($rt !== null) {
                $durationMs = $rt;
            }
            $previousElapsed = $elapsed;
        } elseif ($rt !== null) {
            $durationMs = $rt;
        }

        $trialCategory = trim(data_portal_csv_value($row, $indexes, 'trial_category'));
        if (in_array($trialCategory, ['scheduled_break', 'manual_pause_screen'], true)) {
            $restingMs += $durationMs;
        } elseif (trim(data_portal_csv_value($row, $indexes, 'overall_trial_number')) !== '') {
            $trainingMs += $durationMs;
        }

        $rowUserId = trim(data_portal_csv_value($row, $indexes, 'user_id'));
        if ($rowUserId !== '') {
            $sessionUserId = $rowUserId;
        }

        $task = data_portal_normalize_task_from_csv($row, $indexes);
        if ($task !== '') {
            $sessionTask = $task;
        }

        $correct = data_portal_parse_csv_bool(data_portal_csv_value($row, $indexes, 'correct'));
        if (data_portal_is_fixation_catch_response_row($row, $indexes) && $correct !== null) {
            $catchTotal++;
            $catchCorrect += $correct ? 1 : 0;
            continue;
        }

        $difficulty = data_portal_parse_difficulty_level(data_portal_csv_value($row, $indexes, 'difficulty_level'));
        if ($correct === null || $task === '' || $difficulty === null) {
            continue;
        }

        $userId = $rowUserId !== '' ? $rowUserId : $fallbackUserId;
        $records[] = [
            'userId' => $userId,
            'userLabel' => data_portal_user_label_for_chart($userId),
            'task' => $task,
            'correct' => $correct,
            'difficultyLevel' => $difficulty['level'],
            'difficultySortValue' => $difficulty['sortValue'],
            'dateLocal' => $dateInfo['dateLocal'],
            'dateKey' => $dateInfo['dateKey'],
            'fileName' => $relativePath,
        ];
    }

    fclose($handle);

    $duration = [
        'totalMs' => $trainingMs + $restingMs,
        'trainingMs' => $trainingMs,
        'restingMs' => $restingMs,
    ];

    return [
        'duration' => $duration,
        'catch_pass_rate' => [
            'correct' => $catchCorrect,
            'total' => $catchTotal,
            'accuracy' => $catchTotal > 0 ? ($catchCorrect / $catchTotal) * 100 : null,
        ],
        'trend_records' => $records,
        'session' => [
            'userId' => $sessionUserId,
            'userLabel' => data_portal_user_label_for_chart($sessionUserId),
            'task' => $sessionTask,
            'fileName' => $relativePath,
            'dateLocal' => $dateInfo['dateLocal'],
            'dateKey' => $dateInfo['dateKey'],
            'durationMs' => $duration['totalMs'],
            'trainingMs' => $duration['trainingMs'],
            'restingMs' => $duration['restingMs'],
        ],
    ];
}

function data_portal_empty_csv_metrics(string $relativePath, SplFileInfo $fileInfo): array
{
    $dateInfo = data_portal_session_date_info($relativePath, $fileInfo);
    $userId = data_portal_parse_user_id_from_filename($relativePath);
    return [
        'duration' => [
            'totalMs' => 0,
            'trainingMs' => 0,
            'restingMs' => 0,
        ],
        'catch_pass_rate' => [
            'correct' => 0,
            'total' => 0,
            'accuracy' => null,
        ],
        'trend_records' => [],
        'session' => [
            'userId' => $userId,
            'userLabel' => data_portal_user_label_for_chart($userId),
            'task' => data_portal_parse_task_from_filename($relativePath),
            'fileName' => $relativePath,
            'dateLocal' => $dateInfo['dateLocal'],
            'dateKey' => $dateInfo['dateKey'],
            'durationMs' => 0,
            'trainingMs' => 0,
            'restingMs' => 0,
        ],
    ];
}

function data_portal_csv_value(array $row, array $indexes, string $column): string
{
    if (!array_key_exists($column, $indexes)) {
        return '';
    }

    $index = $indexes[$column];
    return isset($row[$index]) ? (string) $row[$index] : '';
}

function data_portal_parse_finite_number(string $value): ?float
{
    if (trim($value) === '') {
        return null;
    }

    $number = (float) $value;
    return is_finite($number) && $number >= 0 ? $number : null;
}

function data_portal_parse_csv_bool(string $value): ?bool
{
    $normalized = strtolower(trim($value));
    if (in_array($normalized, ['true', '1', 'yes', 'correct'], true)) {
        return true;
    }
    if (in_array($normalized, ['false', '0', 'no', 'incorrect'], true)) {
        return false;
    }

    return null;
}

function data_portal_parse_difficulty_level(string $value): ?array
{
    $rawLevel = trim($value);
    if ($rawLevel === '') {
        return null;
    }

    if (is_numeric($rawLevel)) {
        $number = (float) $rawLevel;
        return [
            'level' => (string) (int) $number === $rawLevel ? (string) (int) $number : (string) $number,
            'sortValue' => $number,
        ];
    }

    return [
        'level' => $rawLevel,
        'sortValue' => $rawLevel,
    ];
}

function data_portal_normalize_task_from_csv(array $row, array $indexes): string
{
    $tasks = ['Motion', 'Orientation', 'Centrality', 'Bar'];
    foreach (['task_type', 'selected_task', 'task_route'] as $column) {
        $candidate = strtolower(trim(data_portal_csv_value($row, $indexes, $column)));
        if ($candidate === '') {
            continue;
        }

        foreach ($tasks as $task) {
            if (str_contains($candidate, strtolower($task))) {
                return $task;
            }
        }
    }

    $direction = strtolower(trim(data_portal_csv_value($row, $indexes, 'correct_direction')));
    if ($direction === 'up' || $direction === 'down') {
        return 'Motion';
    }
    if ($direction === 'vertical' || $direction === 'horizontal') {
        return 'Orientation';
    }
    if ($direction === 'black' || $direction === 'white') {
        return 'Centrality';
    }
    if ($direction === 'same' || $direction === 'different') {
        return 'Bar';
    }

    return '';
}

function data_portal_is_fixation_catch_response_row(array $row, array $indexes): bool
{
    $trialCategory = trim(data_portal_csv_value($row, $indexes, 'trial_category'));
    if ($trialCategory === 'fixation_catch_response') {
        return true;
    }

    $isCatchTrial = data_portal_parse_csv_bool(data_portal_csv_value($row, $indexes, 'fixation_catch_trial')) === true;
    $correctDirection = strtolower(trim(data_portal_csv_value($row, $indexes, 'correct_direction')));
    $responseKey = trim(data_portal_csv_value($row, $indexes, 'fixation_response_key'));

    return $isCatchTrial && $correctDirection === 'x' && $responseKey !== '';
}

function data_portal_parse_user_id_from_filename(string $relativePath): string
{
    $baseName = basename(str_replace('\\', '/', $relativePath));
    if (preg_match('/(?:^|_)user_([^_]+)_/i', $baseName, $match) === 1) {
        return $match[1];
    }

    return 'Unknown';
}

function data_portal_parse_task_from_filename(string $relativePath): string
{
    $baseName = basename(str_replace('\\', '/', $relativePath));
    if (preg_match('/(?:^|_)user_[^_]+_([A-Za-z]+)(?:_|\.csv$)/i', $baseName, $match) === 1) {
        $candidate = strtolower($match[1]);
        foreach (['Motion', 'Orientation', 'Centrality', 'Bar'] as $task) {
            if ($candidate === strtolower($task)) {
                return $task;
            }
        }
    }

    return '';
}

function data_portal_user_label_for_chart(string $userId): string
{
    if ($userId === '' || $userId === 'Unknown') {
        return 'Unknown User';
    }

    return stripos($userId, 'user') === 0 ? $userId : 'User ' . $userId;
}

function data_portal_session_date_info(string $relativePath, SplFileInfo $fileInfo): array
{
    $name = str_replace('\\', '/', $relativePath);
    if (preg_match('/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/', $name, $match) === 1) {
        return [
            'dateLocal' => $match[1] . '-' . $match[2] . '-' . $match[3] . 'T' . $match[4] . ':' . $match[5] . ':' . $match[6],
            'dateKey' => $match[1] . '-' . $match[2] . '-' . $match[3],
        ];
    }

    $createdAt = $fileInfo->getCTime();
    return [
        'dateLocal' => date('Y-m-d\TH:i:s', $createdAt),
        'dateKey' => date('Y-m-d', $createdAt),
    ];
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
    $quotedUserId = preg_quote($userId, '/');
    return preg_match('/^user_' . $quotedUserId . '_.+\.csv$/i', $baseName) === 1
        || preg_match('/^(?:final_complete|session_complete|pause_progress|session_chunk_complete|pause_checkpoint)_user_' . $quotedUserId . '_.+\.csv$/i', $baseName) === 1;
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
