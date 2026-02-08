<?php
require_once __DIR__ . '/db.php';

function isLoggedIn() {
    return isset($_SESSION['user_id']);
}

function isAdmin() {
    return isset($_SESSION['user_role']) && $_SESSION['user_role'] === 'admin';
}

function requireLogin() {
    if (!isLoggedIn()) {
        header('Location: /index.php');
        exit;
    }
    // Verifica se usuario esta bloqueado
    $db = getDB();
    $stmt = $db->prepare('SELECT status FROM users WHERE id = ?');
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();
    if (!$user || $user['status'] === 'blocked') {
        session_destroy();
        header('Location: /index.php?error=blocked');
        exit;
    }
}

function requireAdmin() {
    requireLogin();
    if (!isAdmin()) {
        header('Location: /dashboard.php');
        exit;
    }
}

function loginUser($email, $password) {
    $db = getDB();
    $stmt = $db->prepare('SELECT * FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if (!$user) return ['success' => false, 'error' => 'Email ou senha incorretos'];
    if ($user['status'] === 'blocked') return ['success' => false, 'error' => 'Conta bloqueada. Contate o suporte.'];
    if (!password_verify($password, $user['password'])) return ['success' => false, 'error' => 'Email ou senha incorretos'];

    $_SESSION['user_id'] = $user['id'];
    $_SESSION['user_name'] = $user['name'];
    $_SESSION['user_email'] = $user['email'];
    $_SESSION['user_role'] = $user['role'];

    return ['success' => true, 'user' => $user];
}

function registerUser($name, $email, $password) {
    $db = getDB();

    // Verifica se email ja existe
    $stmt = $db->prepare('SELECT id FROM users WHERE email = ?');
    $stmt->execute([$email]);
    if ($stmt->fetch()) {
        return ['success' => false, 'error' => 'Email ja cadastrado'];
    }

    $hash = password_hash($password, PASSWORD_DEFAULT);
    $stmt = $db->prepare('INSERT INTO users (name, email, password) VALUES (?, ?, ?)');
    $stmt->execute([$name, $email, $hash]);

    $userId = $db->lastInsertId();
    $_SESSION['user_id'] = $userId;
    $_SESSION['user_name'] = $name;
    $_SESSION['user_email'] = $email;
    $_SESSION['user_role'] = 'user';

    return ['success' => true, 'user_id' => $userId];
}

function hasActiveSubscription($userId = null) {
    $userId = $userId ?? $_SESSION['user_id'] ?? null;
    if (!$userId) return false;

    $db = getDB();
    $stmt = $db->prepare(
        "SELECT s.*, p.name as plan_name, p.slug as plan_slug FROM subscriptions s
         JOIN plans p ON s.plan_id = p.id
         WHERE s.user_id = ? AND s.status = 'active'
         AND (s.expires_at IS NULL OR s.expires_at > NOW())
         ORDER BY s.created_at DESC LIMIT 1"
    );
    $stmt->execute([$userId]);
    return $stmt->fetch();
}

function getCurrentUser() {
    if (!isLoggedIn()) return null;
    $db = getDB();
    $stmt = $db->prepare('SELECT id, name, email, role, balance, status, created_at FROM users WHERE id = ?');
    $stmt->execute([$_SESSION['user_id']]);
    return $stmt->fetch();
}
