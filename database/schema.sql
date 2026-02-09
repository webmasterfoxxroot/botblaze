-- BotBlaze - Extensao Chrome de apostas automaticas na Blaze
-- Schema do banco de dados

CREATE DATABASE IF NOT EXISTS botblaze CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE botblaze;

-- Usuarios
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('user', 'admin') DEFAULT 'user',
    status ENUM('active', 'blocked') DEFAULT 'active',
    api_token VARCHAR(64) NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Planos
CREATE TABLE IF NOT EXISTS plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    duration_days INT NOT NULL,
    description TEXT NULL,
    features TEXT NULL,
    active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Assinaturas
CREATE TABLE IF NOT EXISTS subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    plan_id INT NOT NULL,
    status ENUM('active', 'expired', 'cancelled') DEFAULT 'active',
    starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NULL,
    payment_id VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES plans(id)
) ENGINE=InnoDB;

-- Configuracoes de aposta do usuario (usadas pela extensao)
CREATE TABLE IF NOT EXISTS user_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    bet_amount DECIMAL(10,2) DEFAULT 2.00,
    strategy VARCHAR(30) DEFAULT 'moderado',
    min_confidence INT DEFAULT 60,
    bet_white TINYINT(1) DEFAULT 1,
    martingale_enabled TINYINT(1) DEFAULT 0,
    martingale_max INT DEFAULT 3,
    martingale_multiplier DECIMAL(3,1) DEFAULT 2.0,
    stop_loss DECIMAL(10,2) DEFAULT 50.00,
    stop_gain DECIMAL(10,2) DEFAULT 100.00,
    max_bets_per_day INT DEFAULT 50,
    auto_bet TINYINT(1) DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Historico de apostas (registrado pela extensao)
CREATE TABLE IF NOT EXISTS bet_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    game_id VARCHAR(50) NOT NULL,
    color_bet TINYINT NOT NULL COMMENT '1=vermelho, 2=preto, 0=branco',
    amount DECIMAL(10,2) NOT NULL,
    result ENUM('win', 'loss', 'pending') DEFAULT 'pending',
    profit DECIMAL(10,2) DEFAULT 0,
    roll_result INT NULL,
    was_martingale TINYINT(1) DEFAULT 0,
    martingale_level INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_date (user_id, created_at),
    INDEX idx_game (game_id)
) ENGINE=InnoDB;

-- Planos padrao
INSERT INTO plans (name, price, duration_days, description, features) VALUES
('Semanal', 29.90, 7, 'Acesso por 7 dias', 'Extensao Chrome,Apostas automaticas,Suporte basico'),
('Mensal', 79.90, 30, 'Acesso por 30 dias', 'Extensao Chrome,Apostas automaticas,Martingale,Suporte prioritario'),
('Trimestral', 199.90, 90, 'Acesso por 90 dias', 'Extensao Chrome,Apostas automaticas,Martingale,Suporte VIP,Estrategias avancadas')
ON DUPLICATE KEY UPDATE name = name;

-- Admin padrao (senha: admin123)
INSERT INTO users (name, email, password, role) VALUES
('Admin', 'admin@botblaze.com', '$2y$12$trTJx4/pTgKqgC3IF5Dp8.Epu4CBoZCMm7qXg5LSDfvtqVVYQtJz2', 'admin')
ON DUPLICATE KEY UPDATE password = '$2y$12$trTJx4/pTgKqgC3IF5Dp8.Epu4CBoZCMm7qXg5LSDfvtqVVYQtJz2';

-- Assinatura do admin (365 dias)
INSERT INTO subscriptions (user_id, plan_id, status, expires_at)
SELECT 1, 2, 'active', DATE_ADD(NOW(), INTERVAL 365 DAY)
FROM dual WHERE NOT EXISTS (SELECT 1 FROM subscriptions WHERE user_id = 1);

-- Settings padrao do admin
INSERT INTO user_settings (user_id) VALUES (1)
ON DUPLICATE KEY UPDATE user_id = user_id;

-- ── MIGRATION: Atualiza tabela existente para novo sistema de estrategias ────
-- Execute estas queries se a tabela ja existir:
-- ALTER TABLE user_settings MODIFY strategy VARCHAR(30) DEFAULT 'moderado';
-- ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS min_confidence INT DEFAULT 60 AFTER strategy;
-- ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS bet_white TINYINT(1) DEFAULT 1 AFTER min_confidence;
-- UPDATE user_settings SET strategy = 'moderado' WHERE strategy IN ('color_frequency', 'pattern', 'manual');
-- UPDATE user_settings SET strategy = 'moderado' WHERE strategy = 'martingale';
