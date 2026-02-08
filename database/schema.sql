-- BotBlaze Database Schema

CREATE DATABASE IF NOT EXISTS botblaze CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE botblaze;

-- Usuarios
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'user') DEFAULT 'user',
    balance DECIMAL(10,2) DEFAULT 0.00,
    status ENUM('active', 'blocked') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Planos
CREATE TABLE IF NOT EXISTS plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    slug VARCHAR(50) NOT NULL UNIQUE,
    duration_days INT NOT NULL COMMENT '1=diario, 7=semanal, 30=mensal, 0=vitalicio',
    price DECIMAL(10,2) NOT NULL,
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Assinaturas
CREATE TABLE IF NOT EXISTS subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    plan_id INT NOT NULL,
    starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NULL COMMENT 'NULL = vitalicio',
    status ENUM('active', 'expired', 'cancelled') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES plans(id)
) ENGINE=InnoDB;

-- Historico de jogos Double
CREATE TABLE IF NOT EXISTS game_history_double (
    id INT AUTO_INCREMENT PRIMARY KEY,
    game_id VARCHAR(50) NOT NULL UNIQUE,
    color TINYINT NOT NULL COMMENT '0=branco, 1=vermelho, 2=preto',
    roll TINYINT NOT NULL,
    server_seed VARCHAR(255),
    played_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_played_at (played_at),
    INDEX idx_color (color)
) ENGINE=InnoDB;

-- Sinais gerados
CREATE TABLE IF NOT EXISTS signals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    game_type ENUM('double', 'crash') NOT NULL DEFAULT 'double',
    predicted_color TINYINT COMMENT '0=branco, 1=vermelho, 2=preto',
    confidence DECIMAL(5,2) NOT NULL,
    strategy_used VARCHAR(50) NOT NULL,
    result ENUM('pending', 'win', 'loss') DEFAULT 'pending',
    actual_color TINYINT NULL,
    ref_game_db_id INT NULL COMMENT 'ID do ultimo jogo no momento do sinal',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_game_type (game_type),
    INDEX idx_created (created_at),
    INDEX idx_result (result)
) ENGINE=InnoDB;

-- Apostas/Registros dos usuarios (tracking de ganho/perda)
CREATE TABLE IF NOT EXISTS user_bets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    signal_id INT NULL,
    game_type ENUM('double', 'crash') NOT NULL DEFAULT 'double',
    amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    result ENUM('win', 'loss', 'pending') DEFAULT 'pending',
    profit DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (signal_id) REFERENCES signals(id),
    INDEX idx_user (user_id),
    INDEX idx_result (result)
) ENGINE=InnoDB;

-- Transacoes de saldo
CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type ENUM('deposit', 'withdraw', 'subscription', 'bonus') NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    description VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user (user_id)
) ENGINE=InnoDB;

-- Planos padrao
INSERT INTO plans (name, slug, duration_days, price) VALUES
('Diario', 'diario', 1, 9.90),
('Semanal', 'semanal', 7, 39.90),
('Mensal', 'mensal', 30, 99.90),
('Vitalicio', 'vitalicio', 0, 299.90);

-- Admin padrao (senha: admin123)
INSERT INTO users (name, email, password, role) VALUES
('Admin', 'admin@botblaze.com', '$2y$12$LCm1x1nK/OrMVVGWadD4IO/e1AkNugSUrvoYVZbQNP4t299.odYPu', 'admin');

-- Configuracoes do bot (admin ajusta em tempo real)
CREATE TABLE IF NOT EXISTS bot_settings (
    setting_key VARCHAR(50) PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Defaults
INSERT INTO bot_settings (setting_key, setting_value) VALUES
('collect_interval', '2'),
('confidence_min', '55'),
('strategy_sequences', '1'),
('strategy_frequency', '1'),
('strategy_martingale', '1'),
('strategy_ml_patterns', '1'),
('signals_active', '1'),
('max_signals_per_round', '4'),
('analysis_window', '50'),
('history_limit', '2000'),
('time_offset', '0'),
('bot_status', 'running'),
('blaze_api_url', '')
ON DUPLICATE KEY UPDATE setting_key = setting_key;
