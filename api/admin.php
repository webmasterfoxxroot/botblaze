<?php
// BotBlaze API - Admin panel (stats, users, actions)
require_once __DIR__ . '/config.php';

$user = validateToken();

if ($user['role'] !== 'admin') {
    jsonResponse(['error' => 'Acesso negado'], 403);
}

$db = getDB();

// ── POST: Admin actions ──────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = getInput();
    $action = $input['action'] ?? '';

    switch ($action) {

        // Block / Unblock user
        case 'toggle_status':
            $targetId = (int) ($input['user_id'] ?? 0);
            if (!$targetId) jsonResponse(['error' => 'user_id obrigatorio'], 400);
            if ($targetId === (int) $user['id']) jsonResponse(['error' => 'Voce nao pode bloquear a si mesmo'], 400);

            $stmt = $db->prepare("SELECT id, status FROM users WHERE id = ?");
            $stmt->execute([$targetId]);
            $target = $stmt->fetch();
            if (!$target) jsonResponse(['error' => 'Usuario nao encontrado'], 404);

            $newStatus = $target['status'] === 'active' ? 'blocked' : 'active';
            $db->prepare("UPDATE users SET status = ? WHERE id = ?")->execute([$newStatus, $targetId]);

            // Invalidate token if blocking
            if ($newStatus === 'blocked') {
                $db->prepare("UPDATE users SET api_token = NULL WHERE id = ?")->execute([$targetId]);
            }

            jsonResponse(['success' => true, 'new_status' => $newStatus]);
            break;

        // Assign / Change plan
        case 'set_plan':
            $targetId = (int) ($input['user_id'] ?? 0);
            $planId = (int) ($input['plan_id'] ?? 0);
            if (!$targetId || !$planId) jsonResponse(['error' => 'user_id e plan_id obrigatorios'], 400);

            // Check plan exists
            $stmt = $db->prepare("SELECT * FROM plans WHERE id = ? AND active = 1");
            $stmt->execute([$planId]);
            $plan = $stmt->fetch();
            if (!$plan) jsonResponse(['error' => 'Plano nao encontrado'], 404);

            // Cancel existing active subs
            $db->prepare("UPDATE subscriptions SET status = 'cancelled' WHERE user_id = ? AND status = 'active'")->execute([$targetId]);

            // Create new subscription
            $expiresAt = date('Y-m-d H:i:s', strtotime("+{$plan['duration_days']} days"));
            $stmt = $db->prepare("INSERT INTO subscriptions (user_id, plan_id, status, expires_at) VALUES (?, ?, 'active', ?)");
            $stmt->execute([$targetId, $planId, $expiresAt]);

            // Create user_settings if not exists
            $db->prepare("INSERT IGNORE INTO user_settings (user_id) VALUES (?)")->execute([$targetId]);

            jsonResponse(['success' => true, 'message' => "Plano {$plan['name']} atribuido", 'expires_at' => $expiresAt]);
            break;

        // Remove plan (cancel subscription)
        case 'remove_plan':
            $targetId = (int) ($input['user_id'] ?? 0);
            if (!$targetId) jsonResponse(['error' => 'user_id obrigatorio'], 400);

            $db->prepare("UPDATE subscriptions SET status = 'cancelled' WHERE user_id = ? AND status = 'active'")->execute([$targetId]);
            jsonResponse(['success' => true, 'message' => 'Assinatura cancelada']);
            break;

        // Delete user
        case 'delete_user':
            $targetId = (int) ($input['user_id'] ?? 0);
            if (!$targetId) jsonResponse(['error' => 'user_id obrigatorio'], 400);
            if ($targetId === (int) $user['id']) jsonResponse(['error' => 'Voce nao pode excluir a si mesmo'], 400);

            $db->prepare("DELETE FROM users WHERE id = ?")->execute([$targetId]);
            jsonResponse(['success' => true, 'message' => 'Usuario excluido']);
            break;

        // Reset password
        case 'reset_password':
            $targetId = (int) ($input['user_id'] ?? 0);
            $newPassword = $input['new_password'] ?? '';
            if (!$targetId) jsonResponse(['error' => 'user_id obrigatorio'], 400);
            if (strlen($newPassword) < 6) jsonResponse(['error' => 'Senha deve ter no minimo 6 caracteres'], 400);

            $hash = password_hash($newPassword, PASSWORD_DEFAULT);
            $db->prepare("UPDATE users SET password = ?, api_token = NULL WHERE id = ?")->execute([$hash, $targetId]);
            jsonResponse(['success' => true, 'message' => 'Senha alterada']);
            break;

        default:
            jsonResponse(['error' => 'Acao invalida'], 400);
    }
}

// ── GET: Stats + Users + Plans ───────────────────────────────────────────────

$totalUsers = (int) $db->query("SELECT COUNT(*) FROM users")->fetchColumn();
$activeSubs = (int) $db->query("SELECT COUNT(*) FROM subscriptions WHERE status = 'active' AND expires_at > NOW()")->fetchColumn();
$revenue = (float) $db->query("SELECT COALESCE(SUM(p.price), 0) FROM subscriptions s JOIN plans p ON s.plan_id = p.id")->fetchColumn();
$todayBets = (int) $db->query("SELECT COUNT(*) FROM bet_history WHERE DATE(created_at) = CURDATE()")->fetchColumn();

$stmt = $db->query("
    SELECT u.id, u.name, u.email, u.status, u.role, u.created_at,
           p.name AS plan_name, p.id AS plan_id,
           s.expires_at, s.status AS sub_status
    FROM users u
    LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active' AND s.expires_at > NOW()
    LEFT JOIN plans p ON s.plan_id = p.id
    GROUP BY u.id
    ORDER BY u.role DESC, u.id DESC
");
$users = $stmt->fetchAll();

// Available plans (for the assign dropdown)
$plans = $db->query("SELECT id, name, price, duration_days FROM plans WHERE active = 1 ORDER BY price")->fetchAll();

jsonResponse([
    'success' => true,
    'stats' => [
        'total_users' => $totalUsers,
        'active_subs' => $activeSubs,
        'revenue'     => $revenue,
        'today_bets'  => $todayBets,
    ],
    'users' => $users,
    'plans' => $plans,
]);
