<?php
// BotBlaze API - Authentication (login, register, token validation, logout)
require_once __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['error' => 'Metodo nao permitido'], 405);
}

$input = getInput();
$action = $input['action'] ?? '';

switch ($action) {

    // ── LOGIN ────────────────────────────────────────────────────────────
    case 'login':
        $email = trim($input['email'] ?? '');
        $password = $input['password'] ?? '';

        if (!$email || !$password) {
            jsonResponse(['error' => 'Email e senha sao obrigatorios'], 400);
        }

        $db = getDB();
        $stmt = $db->prepare("SELECT * FROM users WHERE email = ?");
        $stmt->execute([$email]);
        $user = $stmt->fetch();

        if (!$user || !password_verify($password, $user['password'])) {
            jsonResponse(['error' => 'Email ou senha incorretos'], 401);
        }

        if ($user['status'] !== 'active') {
            jsonResponse(['error' => 'Conta bloqueada. Entre em contato com o suporte'], 403);
        }

        // Detecta tipo de dispositivo pelo header ou parametro
        $deviceType = $input['device_type'] ?? 'web';
        if (!in_array($deviceType, ['web', 'extension', 'admin'])) {
            $deviceType = 'web';
        }

        // Cria nova sessao (nao apaga as existentes - permite multiplos logins)
        $token = createSession($user['id'], $deviceType);

        // Tambem atualiza users.api_token para compatibilidade
        $db->prepare("UPDATE users SET api_token = ? WHERE id = ?")->execute([$token, $user['id']]);

        // Get subscription status
        $subscription = hasActiveSubscription($user['id']);

        jsonResponse([
            'success' => true,
            'user' => [
                'id'    => $user['id'],
                'name'  => $user['name'],
                'email' => $user['email'],
                'role'  => $user['role'],
            ],
            'api_token' => $token,
            'subscription' => $subscription ? [
                'active'    => true,
                'plan_name' => $subscription['plan_name'],
                'expires_at'=> $subscription['expires_at'],
            ] : [
                'active' => false,
            ],
        ]);
        break;

    // ── REGISTER ─────────────────────────────────────────────────────────
    case 'register':
        $name     = trim($input['name'] ?? '');
        $email    = trim($input['email'] ?? '');
        $password = $input['password'] ?? '';

        if (!$name || !$email || !$password) {
            jsonResponse(['error' => 'Nome, email e senha sao obrigatorios'], 400);
        }

        if (strlen($name) < 2 || strlen($name) > 100) {
            jsonResponse(['error' => 'Nome deve ter entre 2 e 100 caracteres'], 400);
        }

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            jsonResponse(['error' => 'Email invalido'], 400);
        }

        if (strlen($password) < 6) {
            jsonResponse(['error' => 'Senha deve ter no minimo 6 caracteres'], 400);
        }

        $db = getDB();

        // Check if email already exists
        $stmt = $db->prepare("SELECT id FROM users WHERE email = ?");
        $stmt->execute([$email]);
        if ($stmt->fetch()) {
            jsonResponse(['error' => 'Email ja cadastrado'], 409);
        }

        // Create user
        $hashedPassword = password_hash($password, PASSWORD_DEFAULT);

        $stmt = $db->prepare("INSERT INTO users (name, email, password) VALUES (?, ?, ?)");
        $stmt->execute([$name, $email, $hashedPassword]);
        $userId = $db->lastInsertId();

        // Cria sessao
        $token = createSession($userId, 'web');

        // Atualiza users.api_token para compatibilidade
        $db->prepare("UPDATE users SET api_token = ? WHERE id = ?")->execute([$token, $userId]);

        // Create default user_settings row
        $stmt = $db->prepare("INSERT INTO user_settings (user_id) VALUES (?)");
        $stmt->execute([$userId]);

        jsonResponse([
            'success' => true,
            'user' => [
                'id'    => (int) $userId,
                'name'  => $name,
                'email' => $email,
                'role'  => 'user',
            ],
            'api_token' => $token,
            'subscription' => [
                'active' => false,
            ],
        ], 201);
        break;

    // ── VALIDATE TOKEN ───────────────────────────────────────────────────
    case 'validate':
        $user = validateToken();

        $subscription = hasActiveSubscription($user['id']);

        jsonResponse([
            'success' => true,
            'user' => [
                'id'    => $user['id'],
                'name'  => $user['name'],
                'email' => $user['email'],
                'role'  => $user['role'],
            ],
            'subscription' => $subscription ? [
                'active'     => true,
                'plan_name'  => $subscription['plan_name'],
                'expires_at' => $subscription['expires_at'],
                'days_remaining' => max(0, (int) ceil((strtotime($subscription['expires_at']) - time()) / 86400)),
                'features'   => explode(',', $subscription['features'] ?? ''),
            ] : [
                'active' => false,
            ],
        ]);
        break;

    // ── LOGOUT ────────────────────────────────────────────────────────────
    case 'logout':
        $header = getAuthHeader();
        $token = str_replace('Bearer ', '', $header);
        if ($token) {
            deleteSession($token);
        }
        jsonResponse(['success' => true, 'message' => 'Sessao encerrada']);
        break;

    default:
        jsonResponse(['error' => 'Acao invalida. Use: login, register, validate ou logout'], 400);
}
