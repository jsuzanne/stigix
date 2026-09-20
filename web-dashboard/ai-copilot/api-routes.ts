/**
 * Stigix In-App AI Copilot — Express API Router
 */

import { Router, Request, Response } from 'express';
import { AiManager } from './ai-manager.js';

export function createAiCopilotRouter(aiManager: AiManager): Router {
    const router = Router();

    // ─── Configuration ───────────────────────────────────────────────────────

    // GET /api/copilot/config — Get public masked configuration
    router.get('/config', (_req: Request, res: Response) => {
        try {
            const pubConfig = aiManager.getPublicConfig();
            res.json({ success: true, config: pubConfig, ...pubConfig });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // POST /api/copilot/config — Update AI configuration
    router.post('/config', (req: Request, res: Response) => {
        try {
            const { apiKey, defaultModel, requireConfirmation, enabled } = req.body;
            const updated = aiManager.saveConfig({
                ...(apiKey !== undefined ? { apiKey: String(apiKey).trim() } : {}),
                ...(defaultModel ? { defaultModel: String(defaultModel).trim() } : {}),
                ...(requireConfirmation !== undefined ? { requireConfirmation: Boolean(requireConfirmation) } : {}),
                ...(enabled !== undefined ? { enabled: Boolean(enabled) } : {})
            });
            res.json({ success: true, config: updated, ...updated });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // POST /api/copilot/test-key — Test an Anthropic API Key
    router.post('/test-key', async (req: Request, res: Response) => {
        try {
            const { apiKey } = req.body;
            const result = await aiManager.testApiKey(String(apiKey || '').trim());
            res.json({ success: result.valid, valid: result.valid, error: result.error });
        } catch (e: any) {
            res.status(500).json({ success: false, valid: false, error: e.message });
        }
    });

    // ─── Sessions ────────────────────────────────────────────────────────────

    // GET /api/copilot/sessions — List all conversation sessions
    router.get('/sessions', (_req: Request, res: Response) => {
        try {
            res.json({ success: true, sessions: aiManager.getSessionsList() });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // GET /api/copilot/sessions/:id — Get full session with messages
    router.get('/sessions/:id', (req: Request, res: Response) => {
        try {
            const session = aiManager.getSession(req.params.id);
            if (!session) {
                return res.status(404).json({ success: false, error: 'Session not found' });
            }
            res.json({ success: true, session });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // POST /api/copilot/sessions — Create new session
    router.post('/sessions', (req: Request, res: Response) => {
        try {
            const session = aiManager.createSession(req.body.model);
            res.json({ success: true, session });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // DELETE /api/copilot/sessions/:id — Delete a session
    router.delete('/sessions/:id', (req: Request, res: Response) => {
        try {
            const deleted = aiManager.deleteSession(req.params.id);
            res.json({ success: true, deleted });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // DELETE /api/copilot/sessions — Clear all sessions
    router.delete('/sessions', (_req: Request, res: Response) => {
        try {
            aiManager.clearAllSessions();
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // ─── Streaming Chat ───────────────────────────────────────────────────────

    // POST /api/copilot/chat — Server-Sent Events (SSE) streaming chat endpoint
    router.post('/chat', async (req: Request, res: Response) => {
        const { sessionId, prompt, model } = req.body;

        if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({ success: false, error: 'Missing prompt in request body' });
        }

        // Configure SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        const sendEvent = (event: string, data: any) => {
            if (!res.writableEnded) {
                res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            }
        };

        try {
            const targetSessionId = sessionId || aiManager.createSession(model).id;
            await aiManager.streamChat(targetSessionId, prompt, model, sendEvent);
        } catch (err: any) {
            sendEvent('error', { message: err?.message || 'Chat stream encountered a fatal error' });
        } finally {
            if (!res.writableEnded) {
                res.end();
            }
        }
    });

    return router;
}
