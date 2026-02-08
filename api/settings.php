<?php
// BotBlaze API - User bet settings (read/update, used by Chrome extension)
require_once __DIR__ . '/config.php';

$user = validateToken();
$db = getDB();

// Require active subscription for settings access
$subscription = hasActiveSubscription($user['id']);
if (!$subscription) {
    jsonResponse(['error' => 'Assinatura ativa necessaria para acessar configuracoes'], 403);
}

// ── GET: Return current settings ─────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $stmt = $db->prepare("SELECT * FROM user_settings WHERE user_id = ?");
    $stmt->execute([$user['id']]);
    $settings = $stmt->fetch();

    if (!$settings) {
        // Create default settings if missing
        $stmt = $db->prepare("INSERT INTO user_settings (user_id) VALUES (?)");
        $stmt->execute([$user['id']]);
        $stmt = $db->prepare("SELECT * FROM user_settings WHERE user_id = ?");
        $stmt->execute([$user['id']]);
        $settings = $stmt->fetch();
    }

    jsonResponse([
        'success'  => true,
        'settings' => [
            'bet_amount'            => (float) $settings['bet_amount'],
            'strategy'              => $settings['strategy'],
            'martingale_enabled'    => (bool) $settings['martingale_enabled'],
            'martingale_max'        => (int) $settings['martingale_max'],
            'martingale_multiplier' => (float) $settings['martingale_multiplier'],
            'stop_loss'             => (float) $settings['stop_loss'],
            'stop_gain'             => (float) $settings['stop_gain'],
            'max_bets_per_day'      => (int) $settings['max_bets_per_day'],
            'auto_bet'              => (bool) $settings['auto_bet'],
            'updated_at'            => $settings['updated_at'],
        ],
    ]);
}

// ── POST: Update settings ────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = getInput();

    if (empty($input)) {
        jsonResponse(['error' => 'Nenhum dado enviado'], 400);
    }

    // Allowed fields and their validation rules
    $validStrategies = ['color_frequency', 'martingale', 'pattern', 'manual'];
    $errors = [];

    // Fetch current settings as base
    $stmt = $db->prepare("SELECT * FROM user_settings WHERE user_id = ?");
    $stmt->execute([$user['id']]);
    $current = $stmt->fetch();

    if (!$current) {
        $stmt = $db->prepare("INSERT INTO user_settings (user_id) VALUES (?)");
        $stmt->execute([$user['id']]);
        $stmt = $db->prepare("SELECT * FROM user_settings WHERE user_id = ?");
        $stmt->execute([$user['id']]);
        $current = $stmt->fetch();
    }

    // Build update fields with validation
    $updates = [];
    $params = [];

    if (isset($input['bet_amount'])) {
        $val = (float) $input['bet_amount'];
        if ($val < 0.1 || $val > 1000) {
            $errors[] = 'bet_amount deve ser entre 0.1 e 1000';
        } else {
            $updates[] = 'bet_amount = ?';
            $params[] = $val;
        }
    }

    if (isset($input['strategy'])) {
        if (!in_array($input['strategy'], $validStrategies)) {
            $errors[] = 'strategy deve ser: ' . implode(', ', $validStrategies);
        } else {
            $updates[] = 'strategy = ?';
            $params[] = $input['strategy'];
        }
    }

    if (isset($input['martingale_enabled'])) {
        $updates[] = 'martingale_enabled = ?';
        $params[] = $input['martingale_enabled'] ? 1 : 0;
    }

    if (isset($input['martingale_max'])) {
        $val = (int) $input['martingale_max'];
        if ($val < 1 || $val > 10) {
            $errors[] = 'martingale_max deve ser entre 1 e 10';
        } else {
            $updates[] = 'martingale_max = ?';
            $params[] = $val;
        }
    }

    if (isset($input['martingale_multiplier'])) {
        $val = (float) $input['martingale_multiplier'];
        if ($val < 1.0 || $val > 9.9) {
            $errors[] = 'martingale_multiplier deve ser entre 1.0 e 9.9';
        } else {
            $updates[] = 'martingale_multiplier = ?';
            $params[] = $val;
        }
    }

    if (isset($input['stop_loss'])) {
        $val = (float) $input['stop_loss'];
        if ($val < 1 || $val > 10000) {
            $errors[] = 'stop_loss deve ser entre 1 e 10000';
        } else {
            $updates[] = 'stop_loss = ?';
            $params[] = $val;
        }
    }

    if (isset($input['stop_gain'])) {
        $val = (float) $input['stop_gain'];
        if ($val < 1 || $val > 10000) {
            $errors[] = 'stop_gain deve ser entre 1 e 10000';
        } else {
            $updates[] = 'stop_gain = ?';
            $params[] = $val;
        }
    }

    if (isset($input['max_bets_per_day'])) {
        $val = (int) $input['max_bets_per_day'];
        if ($val < 1 || $val > 500) {
            $errors[] = 'max_bets_per_day deve ser entre 1 e 500';
        } else {
            $updates[] = 'max_bets_per_day = ?';
            $params[] = $val;
        }
    }

    if (isset($input['auto_bet'])) {
        $updates[] = 'auto_bet = ?';
        $params[] = $input['auto_bet'] ? 1 : 0;
    }

    // Return validation errors
    if (!empty($errors)) {
        jsonResponse(['error' => 'Erros de validacao', 'details' => $errors], 400);
    }

    // Nothing to update
    if (empty($updates)) {
        jsonResponse(['error' => 'Nenhum campo valido para atualizar'], 400);
    }

    // Execute update
    $params[] = $user['id'];
    $sql = "UPDATE user_settings SET " . implode(', ', $updates) . " WHERE user_id = ?";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    // Return updated settings
    $stmt = $db->prepare("SELECT * FROM user_settings WHERE user_id = ?");
    $stmt->execute([$user['id']]);
    $settings = $stmt->fetch();

    jsonResponse([
        'success'  => true,
        'message'  => 'Configuracoes atualizadas com sucesso',
        'settings' => [
            'bet_amount'            => (float) $settings['bet_amount'],
            'strategy'              => $settings['strategy'],
            'martingale_enabled'    => (bool) $settings['martingale_enabled'],
            'martingale_max'        => (int) $settings['martingale_max'],
            'martingale_multiplier' => (float) $settings['martingale_multiplier'],
            'stop_loss'             => (float) $settings['stop_loss'],
            'stop_gain'             => (float) $settings['stop_gain'],
            'max_bets_per_day'      => (int) $settings['max_bets_per_day'],
            'auto_bet'              => (bool) $settings['auto_bet'],
            'updated_at'            => $settings['updated_at'],
        ],
    ]);
}

// Any other method
jsonResponse(['error' => 'Metodo nao permitido'], 405);
