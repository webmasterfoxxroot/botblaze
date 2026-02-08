<?php
// BotBlaze - Setup: reset admin password
// Access: http://localhost/api/setup.php
// DELETE THIS FILE after use!
require_once __DIR__ . '/config.php';

$db = getDB();
$newHash = password_hash('admin123', PASSWORD_DEFAULT);

$stmt = $db->prepare("UPDATE users SET password = ? WHERE email = ?");
$stmt->execute([$newHash, 'admin@botblaze.com']);

$rows = $stmt->rowCount();

header('Content-Type: text/html; charset=utf-8');
if ($rows > 0) {
    echo "<h2 style='color:green;'>Senha do admin resetada com sucesso!</h2>";
    echo "<p>Email: admin@botblaze.com</p>";
    echo "<p>Senha: admin123</p>";
    echo "<p><strong>APAGUE este arquivo (api/setup.php) depois de usar!</strong></p>";
    echo "<p><a href='/login.html'>Ir para Login</a></p>";
} else {
    echo "<h2 style='color:red;'>Nenhum usuario encontrado com email admin@botblaze.com</h2>";
}
