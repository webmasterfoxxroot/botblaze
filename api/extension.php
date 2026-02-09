<?php
// BotBlaze API - Extension Download
// Gera um ZIP personalizado da extensao com o token do usuario pre-configurado.
// O cliente instala e a extensao ja vem autenticada e pronta para usar.
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
$zipFilename = 'BotBlaze-Extension-' . preg_replace('/[^a-zA-Z0-9]/', '', $user['name']) . '.zip';
$zipPath = sys_get_temp_dir() . '/' . $zipFilename;

$zip = new ZipArchive();
if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
    jsonResponse(['error' => 'Erro ao criar pacote da extensao'], 500);
}

// Adiciona todos os arquivos da extensao ao ZIP
$iterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($extDir, RecursiveDirectoryIterator::SKIP_DOTS),
    RecursiveIteratorIterator::LEAVES_ONLY
);

foreach ($iterator as $file) {
    if ($file->isFile()) {
        $relativePath = substr($file->getPathname(), strlen($extDir) + 1);
        $zip->addFile($file->getPathname(), 'BotBlaze-Extension/' . $relativePath);
    }
}

// Adiciona config.json personalizado dentro da extensao
$zip->addFromString(
    'BotBlaze-Extension/config.json',
    json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
);

$zip->close();

// Verifica se o ZIP foi criado
if (!file_exists($zipPath)) {
    jsonResponse(['error' => 'Erro ao gerar pacote da extensao'], 500);
}

// Serve o ZIP para download
header('Content-Type: application/zip');
header('Content-Disposition: attachment; filename="' . $zipFilename . '"');
header('Content-Length: ' . filesize($zipPath));
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');

readfile($zipPath);
unlink($zipPath);
exit;
