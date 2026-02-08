<?php
/**
 * Reset Admin Password - APAGUE ESTE ARQUIVO DEPOIS DE USAR
 */
require_once __DIR__ . '/includes/db.php';

$newPassword = 'admin123';
$hash = password_hash($newPassword, PASSWORD_DEFAULT);

try {
    $db = getDB();

    // Atualiza a senha do admin
    $stmt = $db->prepare("UPDATE users SET password = ? WHERE email = 'admin@botblaze.com'");
    $stmt->execute([$hash]);

    if ($stmt->rowCount() > 0) {
        echo "<h2 style='color:green'>Senha do admin resetada com sucesso!</h2>";
        echo "<p>Email: admin@botblaze.com</p>";
        echo "<p>Senha: admin123</p>";
        echo "<p>Hash gerado: " . $hash . "</p>";
        echo "<br><a href='/index.php'>Ir para Login</a>";
        echo "<br><br><strong style='color:red'>APAGUE ESTE ARQUIVO (reset-admin.php) AGORA!</strong>";
    } else {
        echo "<h2 style='color:red'>Admin nao encontrado no banco!</h2>";
        echo "<p>Verificando usuarios existentes:</p>";
        $users = $db->query("SELECT id, name, email, role FROM users")->fetchAll(PDO::FETCH_ASSOC);
        echo "<pre>" . print_r($users, true) . "</pre>";
    }
} catch (Exception $e) {
    echo "<h2 style='color:red'>Erro: " . $e->getMessage() . "</h2>";
}
