<?php
require_once __DIR__ . '/../includes/auth.php';
header('Content-Type: application/json');

if (!isLoggedIn()) {
    http_response_code(401);
    echo json_encode(['error' => 'Nao autorizado']);
    exit;
}

$db = getDB();

// Ultimos 20 jogos para o carousel
$games = $db->query("
    SELECT game_id, color, roll, played_at
    FROM game_history_double
    ORDER BY played_at DESC
    LIMIT 20
")->fetchAll();

// Ultimo jogo (para detectar se e novo)
$lastGame = !empty($games) ? $games[0] : null;

// Tempo desde ultimo jogo
$secondsSince = null;
if ($lastGame) {
    $playedAt = new DateTime($lastGame['played_at']);
    $now = new DateTime();
    $secondsSince = $now->getTimestamp() - $playedAt->getTimestamp();
}

// Estimar estado do jogo baseado no tempo
// Blaze Double: ~30s aposta + ~5s girando + resultado
$state = 'waiting'; // waiting, spinning, result
if ($secondsSince !== null) {
    if ($secondsSince < 8) {
        $state = 'result'; // Acabou de sair resultado
    } elseif ($secondsSince > 25 && $secondsSince < 35) {
        $state = 'spinning'; // Provavelmente girando agora
    } else {
        $state = 'waiting'; // Aguardando / aceitando apostas
    }
}

echo json_encode([
    'games' => $games,
    'lastGame' => $lastGame,
    'secondsSince' => $secondsSince,
    'state' => $state,
    'timestamp' => date('Y-m-d H:i:s')
]);
