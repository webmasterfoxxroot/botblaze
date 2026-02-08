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

$response = [
    'success' => true,
    'subscription' => null,
    'plans' => [],
];

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
