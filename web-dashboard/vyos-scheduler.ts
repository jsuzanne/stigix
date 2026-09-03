import { VyosManager, VyosRouter } from './vyos-manager.js';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { log } from './utils/logger.js';

export interface VyosAction {
    id: string;                    // Unique action ID
    offset_minutes: number;        // Offset within the cycle (0 to cycle_duration)
    router_id: string;             // Target router ID
    interface: string;             // Target interface
    command: string;               // e.g., 'interface-down', 'set-impairment'
    parameters?: {                 // Command parameters
        latency?: number;            // ms
        loss?: number;               // percent
        corrupt?: number;            // percent
        reorder?: number;            // percent
        rate?: string;               // rate limit, e.g., '10mbit'
        interface?: string;          // fallback for older scripts
    };
    duration_ms?: number;          // Measured execution time
    run_id?: string;               // Sequence run identifier
    status?: 'running' | 'success' | 'failed'; // NEW: Status for step tracking
    error?: string;                // NEW: Error message for step tracking
}

export interface VyosSequence {
    id: string;
    name: string;
    enabled: boolean;
    paused?: boolean;  // NEW: Paused state for running sequences
    executionMode: 'CYCLE' | 'STEP_BY_STEP'; // NEW: Execution mode
    currentStep?: number; // NEW: Pointer for Step-by-Step mode
    cycle_duration: number; // Cycle duration in minutes (replaces cycleMinutes)
    actions: VyosAction[];
    lastRun?: number;
    lastResult?: 'success' | 'failed';
}

export interface VyosExecutionLog {
    timestamp: number;
    sequenceId: string;
    sequenceName: string;
    results: {
        action: string;
        router: string;
        status: 'success' | 'failed';
        error?: string;
        duration: number;
    }[];
    overallStatus: 'success' | 'failed';
}

export class VyosScheduler extends EventEmitter {
    private sequencesFile: string;
    private logFile: string;
    private sequences: Map<string, VyosSequence> = new Map();
    private activeTimers: Map<string, NodeJS.Timeout[]> = new Map();
    private pausedTimers: Map<string, NodeJS.Timeout[]> = new Map();  // NEW: Store paused timers
    private runCounter: number = 0;

    constructor(private manager: VyosManager, configDir: string, private logDir: string) {
        super();
        this.sequencesFile = path.join(configDir, 'vyos-config.json');
        this.logFile = path.join(logDir, 'vyos-history.jsonl');

        this.loadSequences();
        this.startAllScheduled();
    }

    private loadSequences() {
        if (fs.existsSync(this.sequencesFile)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.sequencesFile, 'utf8'));
                if (data.sequences && Array.isArray(data.sequences)) {
                    data.sequences.forEach((s: any) => {
                        // Migration: handle old cycleMinutes if present
                        if (s.cycleMinutes !== undefined && s.cycle_duration === undefined) {
                            s.cycle_duration = s.cycleMinutes;
                        }

                        // SANITIZATION: Force offsets within cycle_duration
                        if (s.cycle_duration > 0 && s.actions) {
                            s.actions.forEach((a: VyosAction) => {
                                a.offset_minutes = Math.min(s.cycle_duration, Math.max(0, a.offset_minutes));
                            });
                        }

                        // Initialize executionMode if missing
                        if (s.executionMode === undefined) {
                            s.executionMode = 'CYCLE';
                        }
                        if (s.currentStep === undefined) {
                            s.currentStep = 0;
                        }

                        this.sequences.set(s.id, s);
                    });
                }
                if (data.runCounter) this.runCounter = data.runCounter;
            } catch (e: any) {
                log('VYOS-SCHED', `Failed to load sequences: ${e.message}`, 'error');
            }
        }
    }

    private saveSequences() {
        try {
            let data: any = { routers: [], sequences: [], runCounter: 0 };
            if (fs.existsSync(this.sequencesFile)) {
                data = JSON.parse(fs.readFileSync(this.sequencesFile, 'utf8'));
            }
            data.sequences = Array.from(this.sequences.values());
            data.runCounter = this.runCounter;

            fs.writeFileSync(this.sequencesFile, JSON.stringify(data, null, 2));
        } catch (e: any) {
            log('VYOS-SCHED', `Failed to save sequences: ${e.message}`, 'error');
        }
    }

    reload() {
        log('VYOS-SCHED', 'Force reloading sequences from file...');
        // Stop all active timers
        for (const id of this.sequences.keys()) {
            this.stopScheduled(id);
        }
        this.sequences.clear();
        this.loadSequences();
        this.startAllScheduled();
        log('VYOS-SCHED', `Reloaded ${this.sequences.size} sequences.`);
    }

    getSequences(): VyosSequence[] {
        return Array.from(this.sequences.values());
    }

    saveSequence(sequence: VyosSequence) {
        // ENFORCEMENT: Clamp offsets before saving
        if (sequence.cycle_duration > 0 && sequence.actions) {
            sequence.actions.forEach(a => {
                a.offset_minutes = Math.min(sequence.cycle_duration, Math.max(0, a.offset_minutes));
            });
        }

        this.sequences.set(sequence.id, sequence);
        this.saveSequences();
        this.restartScheduled(sequence.id);
    }

    deleteSequence(id: string) {
        this.stopScheduled(id);
        this.sequences.delete(id);
        this.saveSequences();
    }

    private startAllScheduled() {
        for (const seq of this.sequences.values()) {
            if (seq.enabled && seq.cycle_duration > 0) {
                this.startScheduled(seq);
            }
        }
    }

    private startScheduled(seq: VyosSequence) {
        this.stopScheduled(seq.id);

        seq.lastRun = Date.now();
        this.saveSequences();

        const cycleDurationMs = seq.cycle_duration * 60 * 1000;
        const timers: NodeJS.Timeout[] = [];

        log('VYOS-SCHED', `Starting cyclic sequence "${seq.name}" (${seq.cycle_duration}min cycle)`);

        // Master cycle timer to update lastRun every cycle reboot
        const masterTimer = setInterval(() => {
            seq.lastRun = Date.now();
            this.saveSequences();
        }, cycleDurationMs);
        timers.push(masterTimer);

        for (const action of seq.actions) {
            const offsetMs = action.offset_minutes * 60 * 1000;

            const executeAction = async () => {
                const runId = `SEQ-${(++this.runCounter).toString().padStart(4, '0')}`;
                this.saveSequences(); // Persist run counter

                const startTime = performance.now();
                try {
                    this.emit('sequence:step', { sequenceId: seq.id, step: action.command, status: 'running', action });

                    // Adapt to Manager's executeAction signature
                    const result = await this.manager.executeAction(action.router_id, {
                        id: action.id,
                        offset_minutes: action.offset_minutes,
                        router_id: action.router_id,
                        command: action.command,
                        params: { ...action.parameters, interface: action.interface }
                    });

                    const duration = Math.round(performance.now() - startTime);
                    this.logActionExecution(seq.id, action, 'success', undefined, runId, duration, result?.cliEquivalent);
                    this.emit('sequence:step', { sequenceId: seq.id, step: action.command, status: 'success', action, cliEquivalent: result?.cliEquivalent });
                } catch (error: any) {
                    const duration = Math.round(performance.now() - startTime);
                    this.logActionExecution(seq.id, action, 'failed', error.message, runId, duration);
                    this.emit('sequence:step', { sequenceId: seq.id, step: action.command, status: 'failed', error: error.message, action });
                }
            };

            // Initial execution
            if (offsetMs === 0) {
                executeAction();
            } else {
                timers.push(setTimeout(executeAction, offsetMs));
            }

            // Cyclic execution
            const cycleTimer = setInterval(() => {
                setTimeout(executeAction, offsetMs);
            }, cycleDurationMs);

            timers.push(cycleTimer);
        }

        this.activeTimers.set(seq.id, timers);
    }

    private stopScheduled(id: string) {
        const timers = this.activeTimers.get(id);
        if (timers && Array.isArray(timers)) {
            timers.forEach(timer => {
                // Clear both timeouts and intervals
                clearTimeout(timer);
                clearInterval(timer);
            });
            this.activeTimers.delete(id);
            log('VYOS-SCHED', `Stopped timers for sequence ${id}`, 'debug');
        }
    }

    private restartScheduled(id: string) {
        const seq = this.sequences.get(id);
        if (seq && seq.enabled && seq.cycle_duration > 0) {
            this.startScheduled(seq);
        } else {
            this.stopScheduled(id);
        }
    }

    // Pause a running sequence — actually clears all timers to stop execution
    pauseSequence(id: string) {
        const seq = this.sequences.get(id);
        if (!seq) throw new Error('Sequence not found');

        const timers = this.activeTimers.get(id);
        if (!timers || timers.length === 0) {
            throw new Error('Sequence is not running');
        }

        // Actually stop the timers — moving references alone does NOT stop execution
        timers.forEach(t => { clearTimeout(t); clearInterval(t); });
        this.activeTimers.delete(id);
        this.pausedTimers.delete(id); // clean any stale paused refs

        seq.paused = true;
        this.saveSequences();

        log('VYOS-SCHED', `Paused sequence "${seq.name}" — timers cleared`);
    }

    // Resume a paused sequence — restarts timers from the current cycle
    resumeSequence(id: string) {
        const seq = this.sequences.get(id);
        if (!seq) throw new Error('Sequence not found');
        if (!seq.paused) throw new Error('Sequence is not paused');

        seq.paused = false;
        this.saveSequences();

        // Restart scheduled timers from scratch (timers were cleared on pause)
        if (seq.enabled && seq.cycle_duration > 0) {
            this.startScheduled(seq);
        }

        log('VYOS-SCHED', `Resumed sequence "${seq.name}" — timers restarted`);
    }

    // NEW: Stop a running sequence (reset to beginning)
    stopSequence(id: string) {
        const seq = this.sequences.get(id);
        if (!seq) throw new Error('Sequence not found');

        // Clear both active and paused timers
        this.stopScheduled(id);
        this.pausedTimers.delete(id);

        seq.paused = false;
        seq.lastRun = undefined;  // Reset last run
        this.saveSequences();

        log('VYOS-SCHED', `Stopped sequence "${seq.name}" - will restart from beginning`);

        // Restart if enabled
        if (seq.enabled && seq.cycle_duration > 0) {
            this.startScheduled(seq);
        }
    public async executeDirectAction(
        routerId: string,
        action: { command: string; interface?: string; parameters?: any },
        sourceName: string = 'Topology Action'
    ): Promise<{ success: boolean; durationMs: number; cliEquivalent?: string[] }> {
        const actionId = `dir-${Date.now().toString(36)}`;
        const vyosAction: VyosAction = {
            id: actionId,
            offset_minutes: 0,
            router_id: routerId,
            command: action.command,
            params: { ...(action.parameters || {}), interface: action.interface }
        };

        const startTime = performance.now();
        const runId = `DIR-${Date.now().toString().slice(-4)}`;

        try {
            const result = await this.manager.executeAction(routerId, vyosAction);
            const duration = Math.round(performance.now() - startTime);
            this.logActionExecution(sourceName, { ...vyosAction, interface: action.interface, parameters: action.parameters }, 'success', undefined, runId, duration, result?.cliEquivalent);
            this.emit('action:executed', { source: sourceName, action: vyosAction, status: 'success', cliEquivalent: result?.cliEquivalent });
            return { success: true, durationMs: duration, cliEquivalent: result?.cliEquivalent };
        } catch (error: any) {
            const duration = Math.round(performance.now() - startTime);
            this.logActionExecution(sourceName, { ...vyosAction, interface: action.interface, parameters: action.parameters }, 'failed', error.message, runId, duration);
            this.emit('action:executed', { source: sourceName, action: vyosAction, status: 'failed', error: error.message });
            throw error;
        }
    }

    public logActionExecution(
        sequenceId: string,
        action: any,
        status: 'success' | 'failed',
        error?: string,
        runId?: string,
        durationMs?: number,
        cliEquivalent?: string[]   // Stored for History CLI viewer
    ) {
        const seq = this.sequences.get(sequenceId);
        const timestamp = Date.now();

        // Structured JSON log entry
        const logEntry = {
            timestamp,
            sequence_id: sequenceId,
            sequence_name: seq?.name || sequenceId || 'Topology Action',
            action_id: action.id || `act-${Date.now().toString(36)}`,
            run_id: runId,
            router_id: action.router_id,
            interface: action.interface,
            command: action.command,
            parameters: action.parameters || action.params,
            status,
            duration_ms: durationMs,
            error,
            cli_equivalent: cliEquivalent  // Persisted for History CLI viewer
        };

        // Format parameters for console log
        const paramsStr = action.parameters ?
            Object.entries(action.parameters)
                .map(([k, v]) => `${k}=${v}`)
                .join(' ') : 'none';

        // VoIP-style Formatted Console Output
        const timeStr = new Date(timestamp).toLocaleTimeString('en-GB', { hour12: false });
        const runTag = runId ? `[${runId}]` : '[SEQ-xxxx]';
        const statusLabel = status === 'success' ? 'SUCCESS' : 'FAILED';
        const durStr = durationMs !== undefined ? `(${durationMs}ms)` : '';
        const errorMessage = error ? ` ERROR: ${error}` : '';

        log(runTag.replace('[', '').replace(']', ''), `${action.id} ${action.command.toUpperCase()} ${action.router_id}:${action.interface} | ${paramsStr} | ${statusLabel} ${durStr}${errorMessage}`);

        try {
            fs.appendFileSync(this.logFile, JSON.stringify(logEntry) + '\n');
        } catch (e: any) {
            log('VYOS-SCHED', `Failed to log action: ${e.message}`, 'error');
        }
    }

    async runSequenceManually(id: string): Promise<void> {
        const seq = this.sequences.get(id);
        if (!seq) throw new Error('Sequence not found');

        log('VYOS-SCHED', `Manual execution: ${seq.name}`);

        const runId = `MAN-${(++this.runCounter).toString().padStart(4, '0')}`;
        this.saveSequences();

        // Execute all actions immediately (ignore offsets)
        for (const action of seq.actions) {
            const startTime = performance.now();
            try {
                const result = await this.manager.executeAction(action.router_id, {
                    id: action.id,
                    offset_minutes: action.offset_minutes,
                    router_id: action.router_id,
                    command: action.command,
                    params: { ...action.parameters, interface: action.interface }
                });
                const duration = Math.round(performance.now() - startTime);
                this.logActionExecution(seq.id, action, 'success', undefined, runId, duration, result?.cliEquivalent);
            } catch (error: any) {
                const duration = Math.round(performance.now() - startTime);
                this.logActionExecution(seq.id, action, 'failed', error.message, runId, duration);
            }
        }

        seq.lastRun = Date.now();
        this.saveSequences();
    }

    async runSequenceStep(id: string, stepIndex: number): Promise<void> {
        const seq = this.sequences.get(id);
        if (!seq) throw new Error('Sequence not found');
        if (seq.executionMode !== 'STEP_BY_STEP') throw new Error('Sequence is not in Step-by-Step mode');

        const action = seq.actions[stepIndex];
        if (!action) throw new Error(`Action at index ${stepIndex} not found`);

        log('VYOS-SCHED', `Step-by-Step execution: ${seq.name} - Step ${stepIndex + 1} (${action.command})`);

        const runId = `STEP-${(++this.runCounter).toString().padStart(4, '0')}`;
        seq.currentStep = stepIndex;
        this.saveSequences();

        const startTime = performance.now();
        try {
            this.emit('sequence:step', { sequenceId: seq.id, stepIndex, step: action.command, status: 'running', action });

            const result = await this.manager.executeAction(action.router_id, {
                id: action.id,
                offset_minutes: action.offset_minutes,
                router_id: action.router_id,
                command: action.command,
                params: { ...action.parameters, interface: action.interface }
            });

            const duration = Math.round(performance.now() - startTime);
            this.logActionExecution(seq.id, action, 'success', undefined, runId, duration, result?.cliEquivalent);
            this.emit('sequence:step', { sequenceId: seq.id, stepIndex, step: action.command, status: 'success', action, cliEquivalent: result?.cliEquivalent });

            // Move pointer to next step automatically if successful
            if (stepIndex < seq.actions.length - 1) {
                seq.currentStep = stepIndex + 1;
                this.saveSequences();
            }
        } catch (error: any) {
            const duration = Math.round(performance.now() - startTime);
            this.logActionExecution(seq.id, action, 'failed', error.message, runId, duration);
            this.emit('sequence:step', { sequenceId: seq.id, stepIndex, step: action.command, status: 'failed', error: error.message, action });
            throw error;
        }
    }

    getHistory(limit: number = 50): any[] {
        if (!fs.existsSync(this.logFile)) return [];
        try {
            const lines = fs.readFileSync(this.logFile, 'utf8').split('\n').filter(Boolean);
            return lines.slice(-limit).map(l => JSON.parse(l)).reverse();
        } catch (e: any) {
            log('VYOS-SCHED', `Failed to read history: ${e.message}`, 'error');
            return [];
        }
    }
}
