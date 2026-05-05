<?php
require_once __DIR__ . '/data_portal.php';

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$file = __DIR__ . $path;

if (strpos($path, '/data-portal') === 0) {
    data_portal_handle_request($path);
    return true;
}

if ($path !== '/' && is_file($file)) {
    return false;
}

$index = __DIR__ . '/index.html';
if (is_file($index)) {
    header('Content-Type: text/html; charset=UTF-8');
    readfile($index);
    return true;
}

return false;
