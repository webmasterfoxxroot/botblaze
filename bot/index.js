require('dotenv').config({ path: '../.env' });
const mysql = require('mysql2/promise');
const { WebSocketServer } = require('ws');

const DoubleCollector = require('./games/double/collector');
const DoubleAnalyzer = require('./games/double/analyzer');
const DoubleSignals = require('./games/double/signals');

class BotBlaze {
    constructor() {
        this.db = null;
        this.wss = null;
        this.collector = null;
        this.analyzer = null;
        this.signals = null;
    }

    async start() {
        console.log('=================================');
        console.log('  BotBlaze Engine v1.0');
        console.log('  Double Game Analyzer');
        console.log('=================================\n');

        await this.connectDB();
        await this.migrateDB();

        const config = {
            apiUrl: process.env.BLAZE_API_URL || 'https://blaze.bet.br/api/singleplayer-originals/originals/roulette_games/recent/1',
            collectInterval: parseInt(process.env.COLLECT_INTERVAL) || 15000,
            analysisWindow: parseInt(process.env.ANALYSIS_WINDOW) || 50,
            signalConfidenceMin: parseInt(process.env.SIGNAL_CONFIDENCE_MIN) || 65
        };

        this.collector = new DoubleCollector(this.db, config);
        this.analyzer = new DoubleAnalyzer(this.db, config);
        this.signals = new DoubleSignals(this.db, config);

        this.startWebSocket();
        this.collector.start();

        // VERIFICACAO RAPIDA a cada 10s (separada da analise)
        console.log('[Bot] Verificacao de sinais a cada 10s');
        setInterval(() => this.runVerification(), 10000);

        // Analise a cada 20s
        const analysisInterval = config.collectInterval + 5000;
        console.log(`[Bot] Analise a cada ${analysisInterval / 1000}s\n`);
        setInterval(() => this.runAnalysis(), analysisInterval);

        // Primeira execucao apos 10s
        setTimeout(() => this.runAnalysis(), 10000);
    }

    async connectDB() {
        try {
            this.db = await mysql.createPool({
                host: process.env.DB_HOST || 'localhost',
                port: parseInt(process.env.DB_PORT) || 3306,
                user: process.env.DB_USER || 'root',
                password: process.env.DB_PASS || '',
                database: process.env.DB_NAME || 'botblaze',
                waitForConnections: true,
                connectionLimit: 10,
                charset: 'utf8mb4'
            });

            await this.db.execute('SELECT 1');
            console.log('[DB] Conectado ao MySQL com sucesso');
        } catch (err) {
            console.error('[DB] Erro ao conectar:', err.message);
            process.exit(1);
        }
    }

    // Auto-cria colunas que faltam (nao precisa rodar SQL manual)
    async migrateDB() {
        try {
            const [cols] = await this.db.execute(
                `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'signals' AND COLUMN_NAME = 'ref_game_db_id'`,
                [process.env.DB_NAME || 'botblaze']
            );
            if (cols.length === 0) {
                await this.db.execute('ALTER TABLE signals ADD COLUMN ref_game_db_id INT NULL');
                console.log('[DB] Coluna ref_game_db_id adicionada automaticamente');
            }
        } catch (err) {
            console.error('[DB] Aviso migracao:', err.message);
        }
        console.log('[DB] Schema OK\n');
    }

    startWebSocket() {
        const port = parseInt(process.env.BOT_PORT) || 3001;
        this.wss = new WebSocketServer({ port });
        this.wss.on('connection', (ws) => {
            console.log('[WS] Dashboard conectado');
            ws.send(JSON.stringify({ type: 'connected', message: 'BotBlaze Engine conectado' }));
        });
        console.log(`[WS] WebSocket rodando na porta ${port}\n`);
    }

    broadcast(data) {
        if (!this.wss) return;
        const message = JSON.stringify(data);
        this.wss.clients.forEach(client => {
            if (client.readyState === 1) client.send(message);
        });
    }

    // Roda verificacao de WIN/LOSS a cada 10s
    async runVerification() {
        try {
            const verified = await this.signals.verifyLastSignals();
            if (verified > 0) {
                const stats = await this.signals.getStats();
                const strategyStats = await this.signals.getStatsByStrategy();
                this.broadcast({ type: 'stats_update', data: { stats, strategyStats } });
            }
        } catch (err) {
            console.error('[Verify] ERRO:', err.message);
        }
    }

    // Roda analise e gera novos sinais
    async runAnalysis() {
        try {
            // Tambem verifica aqui como backup
            await this.signals.verifyLastSignals();

            const analysis = await this.analyzer.analyze();
            if (!analysis) return;

            const newSignals = await this.signals.generateSignals(analysis);
            const stats = await this.signals.getStats();
            const strategyStats = await this.signals.getStatsByStrategy();

            this.broadcast({
                type: 'analysis',
                data: {
                    lastGame: analysis.lastGame,
                    totalGames: analysis.totalGames,
                    signals: newSignals,
                    stats,
                    strategyStats
                }
            });

            for (const signal of newSignals) {
                this.broadcast({ type: 'signal', data: signal });
            }
        } catch (err) {
            console.error('[Bot] Erro na analise:', err.message);
        }
    }
}

const bot = new BotBlaze();
bot.start().catch(err => {
    console.error('Erro fatal:', err);
    process.exit(1);
});
