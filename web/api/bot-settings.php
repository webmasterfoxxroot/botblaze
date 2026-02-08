<?php
require_once __DIR__ . '/../includes/auth.php';
header('Content-Type: application/json');

if (!isLoggedIn() || !isAdmin()) {
    http_response_code(403);
    echo json_encode(['error' => 'Acesso negado']);
    exit;
}

$db = getDB();

// Garante que a tabela existe
try {
    $db->exec("
        CREATE TABLE IF NOT EXISTS bot_settings (
            setting_key VARCHAR(50) PRIMARY KEY,
            setting_value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
    ");
} catch (Exception $e) {}

// GET = ler todas configuracoes
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $rows = $db->query("SELECT setting_key, setting_value, updated_at FROM bot_settings")->fetchAll();

    $settings = [];
    foreach ($rows as $r) {
        $settings[$r['setting_key']] = $r['setting_value'];
    }

    // Defaults para configs que nao existem
    $defaults = [
        'collect_interval' => '3',
        'confidence_min' => '55',
        'strategy_sequences' => '1',
        'strategy_frequency' => '1',
        'strategy_martingale' => '1',
        'strategy_ml_patterns' => '1',
        'signals_active' => '1',
        'max_signals_per_round' => '4',
        'analysis_window' => '50',
        'history_limit' => '2000',
        'time_offset' => '0',
        'bot_status' => 'running',
        'blaze_api_url' => '',
        'blaze_ws_url' => ''
    ];

    foreach ($defaults as $k => $v) {
        if (!isset($settings[$k])) {
            $settings[$k] = $v;
        }
    }

    echo json_encode(['settings' => $settings]);
    exit;
}

// POST = salvar configuracoes
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);

    if (!$input || !is_array($input)) {
        http_response_code(400);
        echo json_encode(['error' => 'Dados invalidos']);
        exit;
    }

    // Validacoes
    $allowed = [
        'collect_interval', 'confidence_min', 'strategy_sequences', 'strategy_frequency',
        'strategy_martingale', 'strategy_ml_patterns', 'signals_active',
        'max_signals_per_round', 'analysis_window', 'history_limit',
        'time_offset', 'bot_status', 'blaze_api_url', 'blaze_ws_url'
    ];

    $validations = [
        'collect_interval' => ['min' => 1, 'max' => 30],
        'confidence_min' => ['min' => 30, 'max' => 95],
        'max_signals_per_round' => ['min' => 1, 'max' => 10],
        'analysis_window' => ['min' => 10, 'max' => 200],
        'history_limit' => ['min' => 100, 'max' => 10000],
        'time_offset' => ['min' => -300, 'max' => 300],
    ];

    $stmt = $db->prepare("
        INSERT INTO bot_settings (setting_key, setting_value) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
    ");

    $saved = [];
    foreach ($input as $key => $value) {
        if (!in_array($key, $allowed)) continue;

        $val = trim((string)$value);

        // Valida range numerico
        if (isset($validations[$key])) {
            $num = (int)$val;
            $num = max($validations[$key]['min'], min($validations[$key]['max'], $num));
            $val = (string)$num;
        }

        // Booleans
        if (in_array($key, ['strategy_sequences', 'strategy_frequency', 'strategy_martingale', 'strategy_ml_patterns', 'signals_active'])) {
            $val = $val === '1' || $val === 'true' || $val === 'on' ? '1' : '0';
        }

        // bot_status
        if ($key === 'bot_status') {
            $val = in_array($val, ['running', 'paused']) ? $val : 'running';
        }

        // URLs - sanitiza
        if (in_array($key, ['blaze_api_url', 'blaze_ws_url'])) {
            $val = filter_var($val, FILTER_SANITIZE_URL);
            // Permite vazio (usa default) ou URLs validas
            if ($val !== '' && !preg_match('#^https?://#i', $val)) {
                $val = '';
            }
        }

        $stmt->execute([$key, $val]);
        $saved[$key] = $val;
    }

    echo json_encode(['ok' => true, 'saved' => $saved]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Metodo nao permitido']);
