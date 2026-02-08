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
        this.analysisTimer = null;
    }

    async start() {
        console.log('=================================');
        console.log('  BotBlaze Engine v1.0');
        console.log('  Double Game Analyzer');
        console.log('=================================\n');

        // Conecta no MySQL
        await this.connectDB();

        const config = {
            apiUrl: process.env.BLAZE_API_URL || 'https://blaze.bet.br/api/singleplayer-originals/originals/roulette_games/recent/1',
            collectInterval: parseInt(process.env.COLLECT_INTERVAL) || 30000,
            analysisWindow: parseInt(process.env.ANALYSIS_WINDOW) || 50,
            signalConfidenceMin: parseInt(process.env.SIGNAL_CONFIDENCE_MIN) || 65
        };

        // Inicializa modulos
        this.collector = new DoubleCollector(this.db, config);
        this.analyzer = new DoubleAnalyzer(this.db, config);
        this.signals = new DoubleSignals(this.db, config);

        // Inicia WebSocket para dashboard
        this.startWebSocket();

        // Inicia coleta
        this.collector.start();

        // Inicia loop de analise (a cada 35s, logo apos cada coleta)
        const analysisInterval = config.collectInterval + 5000;
        console.log(`[Bot] Analise a cada ${analysisInterval / 1000}s\n`);

        this.analysisTimer = setInterval(async () => {
            await this.runAnalysis();
        }, analysisInterval);

        // Primeira analise apos 10s
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
            console.log('[DB] Conectado ao MySQL com sucesso\n');
        } catch (err) {
            console.error('[DB] Erro ao conectar:', err.message);
            console.error('[DB] Verifique as configuracoes no .env');
            process.exit(1);
        }
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
            if (client.readyState === 1) {
                client.send(message);
            }
        });
    }

    async runAnalysis() {
        try {
            // Verifica sinais anteriores
            await this.signals.verifyLastSignals();

            // Roda analise
            const analysis = await this.analyzer.analyze();
            if (!analysis) return;

            // Gera sinais separados por estrategia
            const newSignals = await this.signals.generateSignals(analysis);

            // Busca stats gerais e por estrategia
            const stats = await this.signals.getStats();
            const strategyStats = await this.signals.getStatsByStrategy();

            // Envia para dashboards conectados
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

// Inicia o bot
const bot = new BotBlaze();
bot.start().catch(err => {
    console.error('Erro fatal:', err);
    process.exit(1);
});
