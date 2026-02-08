<?php
// BotBlaze API - Configuration, DB connection (MySQL), and helper functions

// Load .env from parent dir
$envFile = __DIR__ . '/../.env';
if (file_exists($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (strpos($line, '#') === 0) continue;
        if (strpos($line, '=') === false) continue;
        list($key, $val) = explode('=', $line, 2);
        $_ENV[trim($key)] = trim($val);
        putenv(trim($key) . '=' . trim($val));
    }
}

function getDB() {
    static $pdo = null;
    if ($pdo) return $pdo;
    $pdo = new PDO(
        sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
            getenv('DB_HOST') ?: 'localhost',
            getenv('DB_PORT') ?: '3306',
            getenv('DB_NAME') ?: 'botblaze'
        ),
        getenv('DB_USER') ?: 'root',
        getenv('DB_PASS') ?: '',
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
    return $pdo;
}

function jsonResponse($data, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    echo json_encode($data);
    exit;
}

function getInput() {
    return json_decode(file_get_contents('php://input'), true) ?: [];
}

// Validate API token (used by Chrome extension)
function getAuthHeader() {
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) return $_SERVER['HTTP_AUTHORIZATION'];
    if (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) return $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        foreach ($headers as $k => $v) {
            if (strtolower($k) === 'authorization') return $v;
        }
    }
    return '';
}

function validateToken() {
    $header = getAuthHeader();
    $token = str_replace('Bearer ', '', $header);
    if (!$token) jsonResponse(['error' => 'Token obrigatorio'], 401);

    $db = getDB();
    $stmt = $db->prepare("SELECT id, name, email, role, status FROM users WHERE api_token = ? AND status = 'active'");
    $stmt->execute([$token]);
    $user = $stmt->fetch();
    if (!$user) jsonResponse(['error' => 'Token invalido'], 401);
    return $user;
}

// Check if user has active subscription
function hasActiveSubscription($userId) {
    $db = getDB();
    $stmt = $db->prepare("
        SELECT s.*, p.name as plan_name, p.features
        FROM subscriptions s
        JOIN plans p ON s.plan_id = p.id
        WHERE s.user_id = ? AND s.status = 'active' AND s.expires_at > NOW()
        ORDER BY s.expires_at DESC LIMIT 1
    ");
    $stmt->execute([$userId]);
    return $stmt->fetch();
}

// Handle CORS preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    exit;
}
