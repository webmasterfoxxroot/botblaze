<?php
require_once __DIR__ . '/../includes/auth.php';
header('Content-Type: application/json');

if (!isLoggedIn()) {
    http_response_code(401);
    echo json_encode(['error' => 'Nao autorizado']);
    exit;
}

$db = getDB();

// Sinais pendentes (ativos) - criados nos ultimos 2 minutos
$pending = $db->query("
    SELECT id, predicted_color, confidence, strategy_used, created_at, result
    FROM signals
    WHERE game_type = 'double' AND result = 'pending'
    AND created_at >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)
    ORDER BY created_at DESC
    LIMIT 4
")->fetchAll();

// Ultimo sinal resolvido (WIN ou LOSS) para feedback
$lastResolved = $db->query("
    SELECT id, predicted_color, actual_color, confidence, strategy_used, result, created_at
    FROM signals
    WHERE game_type = 'double' AND result != 'pending'
    ORDER BY created_at DESC
    LIMIT 1
")->fetch();

echo json_encode([
    'active' => $pending,
    'lastResolved' => $lastResolved ?: null,
    'timestamp' => date('Y-m-d H:i:s')
]);
