<?php
// BotBlaze API - Configuration, DB connection (SQLite), and helper functions

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

define('DB_PATH', __DIR__ . '/../database/botblaze.db');

function getDB() {
    static $pdo = null;
    if ($pdo) return $pdo;

    $needsInit = !file_exists(DB_PATH);
    $pdo = new PDO('sqlite:' . DB_PATH, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
    ]);
    $pdo->exec('PRAGMA journal_mode=WAL');
    $pdo->exec('PRAGMA foreign_keys=ON');

    if ($needsInit) initDatabase($pdo);
    return $pdo;
}

function initDatabase($pdo) {
    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL, role TEXT DEFAULT 'user', status TEXT DEFAULT 'active',
        api_token TEXT UNIQUE, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL NOT NULL,
        duration_days INTEGER NOT NULL, description TEXT, features TEXT, active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, plan_id INTEGER NOT NULL,
        status TEXT DEFAULT 'active', starts_at TEXT DEFAULT (datetime('now')), expires_at TEXT,
        payment_id TEXT, created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (plan_id) REFERENCES plans(id)
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS user_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL UNIQUE,
        bet_amount REAL DEFAULT 2.00, strategy TEXT DEFAULT 'color_frequency',
        martingale_enabled INTEGER DEFAULT 0, martingale_max INTEGER DEFAULT 3,
        martingale_multiplier REAL DEFAULT 2.0, stop_loss REAL DEFAULT 50.00,
        stop_gain REAL DEFAULT 100.00, max_bets_per_day INTEGER DEFAULT 50, auto_bet INTEGER DEFAULT 1,
        updated_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS bet_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, game_id TEXT NOT NULL,
        color_bet INTEGER NOT NULL, amount REAL NOT NULL, result TEXT DEFAULT 'pending',
        profit REAL DEFAULT 0, roll_result INTEGER, was_martingale INTEGER DEFAULT 0,
        martingale_level INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_bh_user_date ON bet_history(user_id, created_at)");

    // Default plans
    $pdo->exec("INSERT INTO plans (name, price, duration_days, description, features) VALUES
        ('Semanal', 29.90, 7, 'Acesso por 7 dias', 'Extensao Chrome,Apostas automaticas,Suporte basico'),
        ('Mensal', 79.90, 30, 'Acesso por 30 dias', 'Extensao Chrome,Apostas automaticas,Martingale,Suporte prioritario'),
        ('Trimestral', 199.90, 90, 'Acesso por 90 dias', 'Extensao Chrome,Apostas automaticas,Martingale,Suporte VIP,Estrategias avancadas')
    ");

    // Default admin (senha: admin123) with 365-day subscription
    $hash = password_hash('admin123', PASSWORD_DEFAULT);
    $token = bin2hex(random_bytes(32));
    $stmt = $pdo->prepare("INSERT INTO users (name, email, password, role, api_token) VALUES (?, ?, ?, ?, ?)");
    $stmt->execute(['Admin', 'admin@botblaze.com', $hash, 'admin', $token]);
    $adminId = $pdo->lastInsertId();

    $stmt = $pdo->prepare("SELECT id FROM plans WHERE name = 'Mensal' LIMIT 1");
    $stmt->execute();
    $plan = $stmt->fetch();
    if ($plan) {
        $stmt = $pdo->prepare("INSERT INTO subscriptions (user_id, plan_id, status, expires_at) VALUES (?, ?, 'active', datetime('now', '+365 days'))");
        $stmt->execute([$adminId, $plan['id']]);
    }
    $stmt = $pdo->prepare("INSERT INTO user_settings (user_id) VALUES (?)");
    $stmt->execute([$adminId]);
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
        WHERE s.user_id = ? AND s.status = 'active' AND s.expires_at > datetime('now')
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
