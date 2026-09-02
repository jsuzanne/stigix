/**
 * Stigix Custom TCP Inter-Site Applications — Length-Prefixed Frame Parser
 * Handles stream fragmentation, concatenation, and frame boundaries.
 * Format: [ 4-byte UInt32BE Length N ] [ N-byte UTF-8 JSON Payload ]
 */

import { EventEmitter } from 'events';
import { CustomTcpMessage } from './types.js';

export interface FrameParserEvents {
    message: (msg: CustomTcpMessage) => void;
    error: (err: Error) => void;
}

export class FrameParser extends EventEmitter {
    private buffer: Buffer = Buffer.alloc(0);
    private readonly maxPayloadBytes: number;

    constructor(maxPayloadBytes: number = 1048576) { // 1 MiB default cap
        super();
        this.maxPayloadBytes = maxPayloadBytes;
    }

    /**
     * Ingests a raw TCP chunk from a socket and processes any completed frames.
     */
    public push(chunk: Buffer): void {
        if (!chunk || chunk.length === 0) return;
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.process();
    }

    /**
     * Resets internal buffer state on socket closure or fatal protocol errors.
     */
    public reset(): void {
        this.buffer = Buffer.alloc(0);
    }

    /**
     * Loops through the buffer extracting complete frames.
     */
    private process(): void {
        while (this.buffer.length >= 4) {
            // Read 4-byte Big Endian frame length
            const payloadLength = this.buffer.readUInt32BE(0);

            // Validation: payload size bounds
            if (payloadLength <= 0 || payloadLength > this.maxPayloadBytes) {
                const err = new Error(
                    `Invalid frame length: ${payloadLength} bytes (limit is 1 to ${this.maxPayloadBytes} bytes)`
                );
                this.emit('error', err);
                this.reset();
                return;
            }

            // Check if full frame is present in buffer
            const totalFrameSize = 4 + payloadLength;
            if (this.buffer.length < totalFrameSize) {
                // Fragmented message: wait for more TCP chunks
                return;
            }

            // Extract the payload buffer and advance internal buffer
            const payloadBuf = this.buffer.subarray(4, totalFrameSize);
            this.buffer = this.buffer.subarray(totalFrameSize);

            // Parse UTF-8 JSON
            try {
                const jsonStr = payloadBuf.toString('utf8');
                const parsed = JSON.parse(jsonStr) as CustomTcpMessage;
                if (!parsed || typeof parsed !== 'object' || !parsed.type) {
                    throw new Error('Message payload missing valid "type" property');
                }
                this.emit('message', parsed);
            } catch (err: any) {
                this.emit('error', new Error(`Failed to parse frame JSON: ${err.message}`));
            }
        }
    }
}
