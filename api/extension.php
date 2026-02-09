<?php
// BotBlaze API - Extension Download
// Gera um ZIP personalizado da extensao com o token do usuario pre-configurado.
error_reporting(E_ALL);
ob_start();

require_once __DIR__ . '/config.php';

// Handle CORS preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Access-Control-Allow-Methods: GET, OPTIONS');
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    jsonResponse(['error' => 'Metodo nao permitido'], 405);
}

// Aceita token via header OU query parameter (para download direto)
$queryToken = $_GET['token'] ?? '';
if ($queryToken) {
    $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $queryToken;
}

// === MODO DIAGNOSTICO ===
// Acesse: /api/extension.php?token=SEU_TOKEN&check=1
if (isset($_GET['check'])) {
    $checks = [];
    $checks['php_version'] = PHP_VERSION;
    $checks['zip_available'] = class_exists('ZipArchive');
    $checks['temp_dir'] = sys_get_temp_dir();
    $checks['temp_writable'] = is_writable(sys_get_temp_dir());
    $checks['ext_dir'] = realpath(__DIR__ . '/../extension');
    $checks['ext_dir_exists'] = is_dir(realpath(__DIR__ . '/../extension') ?: '');

    // Tenta validar token
    try {
        $user = validateToken();
        $checks['user'] = $user['name'] ?? 'OK';
        $checks['token_valid'] = true;
    } catch (\Throwable $e) {
        $checks['token_valid'] = false;
        $checks['token_error'] = $e->getMessage();
    }

    // Tenta verificar assinatura
    if (!empty($user)) {
        $subscription = hasActiveSubscription($user['id']);
        $checks['has_subscription'] = !!$subscription;
        if ($subscription) {
            $checks['plan_name'] = $subscription['plan_name'];
        }
    }

    // Testa criacao de ZIP
    if ($checks['zip_available'] && $checks['temp_writable']) {
        $testZip = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'botblaze_test.zip';
        $z = new ZipArchive();
        $r = $z->open($testZip, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        $checks['zip_create'] = ($r === true) ? 'OK' : 'FAIL (code: ' . $r . ')';
        if ($r === true) {
            $z->addFromString('test.txt', 'hello');
            $z->close();
            $checks['zip_size'] = filesize($testZip);
            @unlink($testZip);
        }
    }

    // Conta arquivos da extensao
    $extDir = realpath(__DIR__ . '/../extension');
    if ($extDir && is_dir($extDir)) {
        $count = 0;
        $files = [];
        $iter = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($extDir, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::LEAVES_ONLY
        );
        foreach ($iter as $f) {
            if ($f->isFile()) {
                $count++;
                $files[] = str_replace('\\', '/', substr($f->getPathname(), strlen($extDir) + 1));
            }
        }
        $checks['ext_files_count'] = $count;
        $checks['ext_files'] = $files;
    }

    ob_end_clean();
    jsonResponse(['success' => true, 'diagnostics' => $checks]);
}

// === DOWNLOAD REAL ===
try {
    // Verifica se ZipArchive esta disponivel
    if (!class_exists('ZipArchive')) {
        throw new Exception('Modulo ZIP nao disponivel no servidor. Ative php_zip no php.ini do XAMPP.');
    }

    // Valida token do usuario
    $user = validateToken();

    // Verifica assinatura ativa
    $subscription = hasActiveSubscription($user['id']);
    if (!$subscription) {
        jsonResponse(['error' => 'Voce precisa de um plano ativo para baixar a extensao'], 403);
    }

    // Busca o api_token do usuario
    $db = getDB();
    $stmt = $db->prepare("SELECT api_token FROM users WHERE id = ?");
    $stmt->execute([$user['id']]);
    $tokenRow = $stmt->fetch();

    if (!$tokenRow || !$tokenRow['api_token']) {
        throw new Exception('Token nao encontrado no banco. Faca login novamente.');
    }

    // Diretorio da extensao
    $extDir = realpath(__DIR__ . '/../extension');
    if (!$extDir || !is_dir($extDir)) {
        throw new Exception('Pasta extension/ nao encontrada em: ' . __DIR__ . '/../extension');
    }

    // Determina a URL base da API
    $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $apiUrl = $protocol . '://' . $host . '/api';

    // Cria o config.json personalizado
    $config = [
        'api_url'      => $apiUrl,
        'api_token'    => $tokenRow['api_token'],
        'user'         => [
            'id'    => (int) $user['id'],
            'name'  => $user['name'],
            'email' => $user['email'],
            'role'  => $user['role']
        ],
        'subscription' => [
            'active'     => true,
            'plan_name'  => $subscription['plan_name'],
            'expires_at' => $subscription['expires_at']
        ],
        'generated_at' => date('Y-m-d H:i:s')
    ];

    // Cria ZIP temporario
    $tmpDir = sys_get_temp_dir();
    if (!is_writable($tmpDir)) {
        throw new Exception('Diretorio temporario nao tem permissao de escrita: ' . $tmpDir);
    }

    $safeName = preg_replace('/[^a-zA-Z0-9]/', '', $user['name'] ?? 'user');
    $zipFilename = 'BotBlaze-Extension-' . $safeName . '.zip';
    $zipPath = $tmpDir . DIRECTORY_SEPARATOR . 'botblaze_' . $user['id'] . '_' . time() . '.zip';

    // Cria o ZIP
    $zip = new ZipArchive();
    $result = $zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    if ($result !== true) {
        throw new Exception('Erro ao criar ZIP. Codigo: ' . $result . '. Path: ' . $zipPath);
    }

    // Adiciona todos os arquivos da extensao ao ZIP
    $extDirNorm = str_replace('\\', '/', $extDir);
    $addedFiles = 0;

    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($extDir, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );

    foreach ($iterator as $file) {
        if ($file->isFile()) {
            $fullPath = $file->getPathname();
            $relativePath = str_replace('\\', '/', substr($fullPath, strlen($extDirNorm) + 1));
            $zip->addFile($fullPath, 'BotBlaze-Extension/' . $relativePath);
            $addedFiles++;
        }
    }

    if ($addedFiles === 0) {
        $zip->close();
        @unlink($zipPath);
        throw new Exception('Nenhum arquivo encontrado na pasta extension/: ' . $extDir);
    }

    // Adiciona config.json personalizado
    $zip->addFromString(
        'BotBlaze-Extension/config.json',
        json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
    );

    $zip->close();

    // Verifica se o ZIP foi criado
    if (!file_exists($zipPath)) {
        throw new Exception('ZIP nao foi criado no disco: ' . $zipPath);
    }

    $fileSize = filesize($zipPath);
    if ($fileSize < 100) {
        @unlink($zipPath);
        throw new Exception('ZIP criado com tamanho invalido: ' . $fileSize . ' bytes');
    }

    // Limpa QUALQUER output acumulado (notices, warnings, whitespace)
    if (ob_get_level()) {
        ob_end_clean();
    }

    // Serve o ZIP para download
    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="' . $zipFilename . '"');
    header('Content-Length: ' . $fileSize);
    header('Content-Transfer-Encoding: binary');
    header('Cache-Control: no-cache, no-store, must-revalidate');
    header('Pragma: no-cache');
    header('Expires: 0');
    header('Access-Control-Allow-Origin: *');

    readfile($zipPath);
    @unlink($zipPath);
    exit;

} catch (\Throwable $e) {
    if (ob_get_level()) {
        ob_end_clean();
    }
    http_response_code(500);
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: *');
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage(),
        'file' => basename($e->getFile()),
        'line' => $e->getLine()
    ]);
    exit;
}
