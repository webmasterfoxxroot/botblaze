<?php
// BotBlaze - PHP Built-in Server Router
// Usage: php -S 0.0.0.0:8080 router.php

$uri = $_SERVER['REQUEST_URI'];
$path = parse_url($uri, PHP_URL_PATH);

// API routes
if (preg_match('#^/api/(.+\.php)#', $path, $m)) {
    $file = __DIR__ . '/api/' . $m[1];
    if (file_exists($file)) {
        require $file;
        return true;
    }
}

// Static files (HTML, CSS, JS, images at root level)
$file = __DIR__ . $path;
if ($path !== '/' && file_exists($file) && !is_dir($file)) {
    $ext = pathinfo($file, PATHINFO_EXTENSION);
    $types = [
        'html' => 'text/html',
        'css'  => 'text/css',
        'js'   => 'application/javascript',
        'png'  => 'image/png',
        'jpg'  => 'image/jpeg',
        'svg'  => 'image/svg+xml',
        'json' => 'application/json',
    ];
    if (isset($types[$ext])) {
        header('Content-Type: ' . $types[$ext]);
    }
    readfile($file);
    return true;
}

// Root redirects to index.html
if ($path === '/' || $path === '') {
    header('Location: /index.html');
    return true;
}

// Fallback: let PHP serve static files
return false;
