<?php
// BotBlaze API - Extension Download
// Gera um ZIP personalizado da extensao com o token do usuario pre-configurado.
ob_start(); // Captura qualquer output acidental
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

// Verifica se ZipArchive esta disponivel
if (!class_exists('ZipArchive')) {
    jsonResponse(['error' => 'Modulo ZIP nao disponivel no servidor. Ative php_zip no php.ini'], 500);
}

// Aceita token via header OU query parameter (para download direto)
$headerToken = getAuthHeader();
$queryToken = $_GET['token'] ?? '';
if ($queryToken && !$headerToken) {
    $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $queryToken;
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
    jsonResponse(['error' => 'Token nao encontrado. Faca login novamente.'], 500);
}

// Diretorio da extensao
$extDir = realpath(__DIR__ . '/../extension');
if (!$extDir || !is_dir($extDir)) {
    jsonResponse(['error' => 'Arquivos da extensao nao encontrados no servidor'], 500);
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
$safeName = preg_replace('/[^a-zA-Z0-9]/', '', $user['name'] ?? 'user');
$zipFilename = 'BotBlaze-Extension-' . $safeName . '.zip';
$zipPath = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'botblaze_' . $user['id'] . '_' . time() . '.zip';

$zip = new ZipArchive();
$result = $zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE);
if ($result !== true) {
    jsonResponse(['error' => 'Erro ao criar pacote ZIP (code: ' . $result . ')'], 500);
}

// Adiciona todos os arquivos da extensao ao ZIP
$extDir = str_replace('\\', '/', $extDir); // Normaliza para forward slash
$addedFiles = 0;

$iterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($extDir, RecursiveDirectoryIterator::SKIP_DOTS),
    RecursiveIteratorIterator::LEAVES_ONLY
);

foreach ($iterator as $file) {
    if ($file->isFile()) {
        $filePath = str_replace('\\', '/', $file->getPathname());
        $relativePath = substr($filePath, strlen($extDir) + 1);
        $zip->addFile($file->getPathname(), 'BotBlaze-Extension/' . $relativePath);
        $addedFiles++;
    }
}

// Adiciona config.json personalizado
$zip->addFromString(
    'BotBlaze-Extension/config.json',
    json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
);
$addedFiles++;

$zip->close();

// Verifica se o ZIP foi criado
if (!file_exists($zipPath) || filesize($zipPath) < 100) {
    jsonResponse(['error' => 'Erro ao gerar pacote. Arquivos adicionados: ' . $addedFiles], 500);
}

// Limpa QUALQUER output acumulado (notices, warnings, whitespace)
ob_end_clean();

// Serve o ZIP para download
$fileSize = filesize($zipPath);
header('Content-Type: application/octet-stream');
header('Content-Disposition: attachment; filename="' . $zipFilename . '"');
header('Content-Length: ' . $fileSize);
header('Content-Transfer-Encoding: binary');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Expose-Headers: Content-Disposition, Content-Length');

// Envia o arquivo
readfile($zipPath);

// Remove o arquivo temporario
@unlink($zipPath);
exit;
