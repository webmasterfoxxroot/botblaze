<?php
// BotBlaze API - Extension Download
// Gera um ZIP personalizado da extensao com o token do usuario pre-configurado.
// Usa criador de ZIP puro em PHP - NAO precisa da extensao php_zip.
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
if (isset($_GET['check'])) {
    $checks = [];
    $checks['php_version'] = PHP_VERSION;
    $checks['zip_method'] = 'pure_php';
    $checks['temp_dir'] = sys_get_temp_dir();
    $checks['temp_writable'] = is_writable(sys_get_temp_dir());
    $checks['ext_dir'] = realpath(__DIR__ . '/../extension');
    $checks['ext_dir_exists'] = is_dir(realpath(__DIR__ . '/../extension') ?: '');

    try {
        $user = validateToken();
        $checks['user'] = $user['name'] ?? 'OK';
        $checks['token_valid'] = true;
    } catch (\Throwable $e) {
        $checks['token_valid'] = false;
        $checks['token_error'] = $e->getMessage();
    }

    if (!empty($user)) {
        $subscription = hasActiveSubscription($user['id']);
        $checks['has_subscription'] = !!$subscription;
        if ($subscription) $checks['plan_name'] = $subscription['plan_name'];
    }

    $extDir = realpath(__DIR__ . '/../extension');
    if ($extDir && is_dir($extDir)) {
        $count = 0;
        $iter = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($extDir, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::LEAVES_ONLY
        );
        foreach ($iter as $f) { if ($f->isFile()) $count++; }
        $checks['ext_files_count'] = $count;
    }

    ob_end_clean();
    jsonResponse(['success' => true, 'diagnostics' => $checks]);
}

// === DOWNLOAD REAL ===
try {
    $user = validateToken();

    $subscription = hasActiveSubscription($user['id']);
    if (!$subscription) {
        jsonResponse(['error' => 'Voce precisa de um plano ativo para baixar a extensao'], 403);
    }

    $db = getDB();
    $stmt = $db->prepare("SELECT api_token FROM users WHERE id = ?");
    $stmt->execute([$user['id']]);
    $tokenRow = $stmt->fetch();

    if (!$tokenRow || !$tokenRow['api_token']) {
        throw new Exception('Token nao encontrado. Faca login novamente.');
    }

    $extDir = realpath(__DIR__ . '/../extension');
    if (!$extDir || !is_dir($extDir)) {
        throw new Exception('Pasta extension/ nao encontrada.');
    }

    // URL da API
    $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $apiUrl = $protocol . '://' . $host . '/api';

    // Config personalizado
    $config = json_encode([
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
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

    // Coleta arquivos da extensao
    $files = [];
    $extDirNorm = str_replace('\\', '/', $extDir);
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($extDir, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );

    foreach ($iterator as $file) {
        if ($file->isFile()) {
            $fullPath = $file->getPathname();
            $relativePath = str_replace('\\', '/', substr($fullPath, strlen($extDirNorm) + 1));
            $content = file_get_contents($fullPath);
            if ($content !== false) {
                $files['BotBlaze-Extension/' . $relativePath] = $content;
            }
        }
    }

    // Adiciona config.json personalizado
    $files['BotBlaze-Extension/config.json'] = $config;

    if (count($files) < 2) {
        throw new Exception('Nenhum arquivo da extensao encontrado.');
    }

    // Gera o ZIP em memoria (sem precisar de ZipArchive)
    $zipData = createZipPure($files);

    // Limpa output buffer
    if (ob_get_level()) ob_end_clean();

    // Envia o ZIP
    $safeName = preg_replace('/[^a-zA-Z0-9]/', '', $user['name'] ?? 'user');
    $zipFilename = 'BotBlaze-Extension-' . $safeName . '.zip';

    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="' . $zipFilename . '"');
    header('Content-Length: ' . strlen($zipData));
    header('Content-Transfer-Encoding: binary');
    header('Cache-Control: no-cache, no-store, must-revalidate');
    header('Pragma: no-cache');
    header('Expires: 0');
    header('Access-Control-Allow-Origin: *');

    echo $zipData;
    exit;

} catch (\Throwable $e) {
    if (ob_get_level()) ob_end_clean();
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

// ============================================================
// Criador de ZIP puro em PHP - nao precisa de extensao php_zip
// Implementa o formato ZIP (PKZip) com store (sem compressao)
// ============================================================
function createZipPure(array $files): string {
    $localHeaders = '';
    $centralDir = '';
    $offset = 0;
    $count = 0;

    foreach ($files as $name => $content) {
        $name = str_replace('\\', '/', $name);
        $crc32 = crc32($content);
        $size = strlen($content);
        $nameLen = strlen($name);
        $time = dosTime(time());

        // Local file header (30 bytes + name + content)
        $local  = "\x50\x4b\x03\x04"; // Signature
        $local .= "\x14\x00";         // Version needed (2.0)
        $local .= "\x00\x00";         // Flags
        $local .= "\x00\x00";         // Compression (store)
        $local .= pack('v', $time[0]); // Mod time
        $local .= pack('v', $time[1]); // Mod date
        $local .= pack('V', $crc32);   // CRC-32
        $local .= pack('V', $size);    // Compressed size
        $local .= pack('V', $size);    // Uncompressed size
        $local .= pack('v', $nameLen); // Filename length
        $local .= "\x00\x00";         // Extra field length
        $local .= $name;              // Filename
        $local .= $content;           // File data

        // Central directory entry (46 bytes + name)
        $central  = "\x50\x4b\x01\x02"; // Signature
        $central .= "\x14\x00";         // Version made by
        $central .= "\x14\x00";         // Version needed
        $central .= "\x00\x00";         // Flags
        $central .= "\x00\x00";         // Compression (store)
        $central .= pack('v', $time[0]);
        $central .= pack('v', $time[1]);
        $central .= pack('V', $crc32);
        $central .= pack('V', $size);   // Compressed
        $central .= pack('V', $size);   // Uncompressed
        $central .= pack('v', $nameLen);
        $central .= "\x00\x00";         // Extra field length
        $central .= "\x00\x00";         // Comment length
        $central .= "\x00\x00";         // Disk number
        $central .= "\x00\x00";         // Internal attributes
        $central .= "\x20\x00\x00\x00"; // External attributes (archive)
        $central .= pack('V', $offset); // Offset of local header
        $central .= $name;

        $localHeaders .= $local;
        $centralDir .= $central;
        $offset += strlen($local);
        $count++;
    }

    // End of central directory
    $centralDirOffset = strlen($localHeaders);
    $centralDirSize = strlen($centralDir);

    $eocd  = "\x50\x4b\x05\x06";     // Signature
    $eocd .= "\x00\x00";              // Disk number
    $eocd .= "\x00\x00";              // Disk with central dir
    $eocd .= pack('v', $count);       // Entries on this disk
    $eocd .= pack('v', $count);       // Total entries
    $eocd .= pack('V', $centralDirSize);
    $eocd .= pack('V', $centralDirOffset);
    $eocd .= "\x00\x00";              // Comment length

    return $localHeaders . $centralDir . $eocd;
}

function dosTime(int $unixTime): array {
    $d = getdate($unixTime);
    $time = (($d['hours'] & 0x1F) << 11) | (($d['minutes'] & 0x3F) << 5) | (($d['seconds'] >> 1) & 0x1F);
    $date = ((($d['year'] - 1980) & 0x7F) << 9) | (($d['mon'] & 0x0F) << 5) | ($d['mday'] & 0x1F);
    return [$time, $date];
}
