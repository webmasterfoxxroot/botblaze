<?php
// BotBlaze API - Admin panel data (stats + users list)
require_once __DIR__ . '/config.php';

$user = validateToken();

// Only admins
if ($user['role'] !== 'admin') {
    jsonResponse(['error' => 'Acesso negado'], 403);
}

$db = getDB();

// ── Stats ────────────────────────────────────────────────────────────────────

// Total users
$totalUsers = (int) $db->query("SELECT COUNT(*) FROM users")->fetchColumn();

// Active subscribers
$activeSubs = (int) $db->query("SELECT COUNT(*) FROM subscriptions WHERE status = 'active' AND expires_at > NOW()")->fetchColumn();

// Total revenue
$revenue = (float) $db->query("SELECT COALESCE(SUM(p.price), 0) FROM subscriptions s JOIN plans p ON s.plan_id = p.id")->fetchColumn();

// Today's bets
$todayBets = (int) $db->query("SELECT COUNT(*) FROM bet_history WHERE DATE(created_at) = CURDATE()")->fetchColumn();

// ── Users list ───────────────────────────────────────────────────────────────

$stmt = $db->query("
    SELECT u.id, u.name, u.email, u.status, u.role, u.created_at,
           p.name AS plan_name,
           s.expires_at,
           s.status AS sub_status
    FROM users u
    LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active' AND s.expires_at > NOW()
    LEFT JOIN plans p ON s.plan_id = p.id
    GROUP BY u.id
    ORDER BY u.id DESC
");
$users = $stmt->fetchAll();

jsonResponse([
    'success' => true,
    'stats' => [
        'total_users'   => $totalUsers,
        'active_subs'   => $activeSubs,
        'revenue'       => $revenue,
        'today_bets'    => $todayBets,
    ],
    'users' => $users,
]);
