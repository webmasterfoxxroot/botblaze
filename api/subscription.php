<?php
// BotBlaze API - Subscription status and available plans
require_once __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    jsonResponse(['error' => 'Metodo nao permitido'], 405);
}

$user = validateToken();
$db = getDB();

// Get current active subscription
$subscription = hasActiveSubscription($user['id']);

// DEBUG: Se nao encontrou assinatura, busca informacao crua do banco
$debug = null;
if (!$subscription) {
    // Busca TODAS as subscriptions deste usuario (sem filtro de status/expiry)
    $stmtDebug = $db->prepare("
        SELECT s.id, s.user_id, s.plan_id, s.status, s.starts_at, s.expires_at,
               p.name as plan_name, p.id as pid, NOW() as server_now
        FROM subscriptions s
        LEFT JOIN plans p ON s.plan_id = p.id
        WHERE s.user_id = ?
        ORDER BY s.id DESC
    ");
    $stmtDebug->execute([$user['id']]);
    $allSubs = $stmtDebug->fetchAll();

    $debug = [
        'user_id' => $user['id'],
        'total_subscriptions' => count($allSubs),
        'subscriptions' => $allSubs
    ];
}

// Get user's api_token
$stmtToken = $db->prepare("SELECT api_token FROM users WHERE id = ?");
$stmtToken->execute([$user['id']]);
$tokenRow = $stmtToken->fetch();

$response = [
    'success' => true,
    'subscription' => null,
    'api_token' => $tokenRow['api_token'] ?? null,
    'plans' => [],
    'days_remaining' => 0,
];

if ($debug) {
    $response['_debug'] = $debug;
}

if ($subscription) {
    $daysRemaining = max(0, (int) ceil((strtotime($subscription['expires_at']) - time()) / 86400));

    $response['subscription'] = [
        'id'             => (int) $subscription['id'],
        'plan_name'      => $subscription['plan_name'],
        'status'         => $subscription['status'],
        'starts_at'      => $subscription['starts_at'],
        'expires_at'     => $subscription['expires_at'],
        'days_remaining' => $daysRemaining,
        'features'       => explode(',', $subscription['features'] ?? ''),
    ];
    $response['days_remaining'] = $daysRemaining;
}

// Always return available plans (for upgrade or new purchase)
if (!$subscription) {
    $stmt = $db->prepare("SELECT id, name, price, duration_days, description, features FROM plans WHERE active = 1 ORDER BY price ASC");
    $stmt->execute();
    $plans = $stmt->fetchAll();

    foreach ($plans as &$plan) {
        $plan['id']            = (int) $plan['id'];
        $plan['price']         = (float) $plan['price'];
        $plan['duration_days'] = (int) $plan['duration_days'];
        $plan['features']      = explode(',', $plan['features'] ?? '');
    }
    unset($plan);

    $response['plans'] = $plans;
}

jsonResponse($response);
