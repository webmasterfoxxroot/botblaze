<?php
require_once __DIR__ . '/../includes/auth.php';
header('Content-Type: application/json');

if (!isLoggedIn()) {
    http_response_code(401);
    echo json_encode(['error' => 'Nao autorizado']);
    exit;
}

$db = getDB();
$limit = min(intval($_GET['limit'] ?? 50), 200);

$stmt = $db->prepare("
    SELECT * FROM game_history_double
    ORDER BY played_at DESC
    LIMIT ?
");
$stmt->bindValue(1, $limit, PDO::PARAM_INT);
$stmt->execute();
$games = $stmt->fetchAll();

// Stats de distribuicao (cor derivada do roll: 0=branco, 1-7=vermelho, 8-14=preto)
$counts = [0 => 0, 1 => 0, 2 => 0];
foreach ($games as $g) {
    $r = (int)$g['roll'];
    $cc = $r === 0 ? 0 : ($r <= 7 ? 1 : 2);
    $counts[$cc]++;
}
$total = count($games) ?: 1;

echo json_encode([
    'games' => $games,
    'total' => count($games),
    'distribution' => [
        'white' => ['count' => $counts[0], 'pct' => round($counts[0] / $total * 100, 1)],
        'red' => ['count' => $counts[1], 'pct' => round($counts[1] / $total * 100, 1)],
        'black' => ['count' => $counts[2], 'pct' => round($counts[2] / $total * 100, 1)]
    ]
]);
