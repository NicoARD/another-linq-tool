import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import {
    createMessageConnection,
    MessageConnection,
    StreamMessageReader,
    StreamMessageWriter,
} from 'vscode-jsonrpc/node';

export interface ResultNode {
    kind: 'null' | 'scalar' | 'object' | 'table';
    typeName?: string;
    text?: string;
    properties?: PropertyNode[];
    columns?: string[];
    rows?: (string | null)[][];
    rowCount?: number;
    truncated?: boolean;
}

export interface PropertyNode {
    name: string;
    typeName?: string;
    value?: string | null;
}

export interface DiagnosticInfo {
    severity: string;
    id: string;
    message: string;
    line: number;
    character: number;
}

export interface ErrorInfo {
    type: string;
    message: string;
    stack?: string;
    inner?: ErrorInfo;
}

export interface ExecuteResult {
    status: 'success' | 'compileError' | 'runtimeError' | 'cancelled';
    value?: ResultNode;
    diagnostics?: DiagnosticInfo[];
    error?: ErrorInfo;
    elapsedMs: number;
}

/**
 * Owns the runner child process and a JSON-RPC connection to it over stdio.
 * The process is started lazily on first use and restarted on demand.
 */
export class RunnerClient {
    private proc?: ChildProcessWithoutNullStreams;
    private connection?: MessageConnection;
    private startPromise?: Promise<void>;

    constructor(
        private readonly dotnetPath: string,
        private readonly runnerPath: string,
        private readonly log: (message: string) => void,
    ) {}

    async execute(source: string, rowLimit: number): Promise<ExecuteResult> {
        await this.ensureStarted();
        return this.connection!.sendRequest<ExecuteResult>('execute', { source, rowLimit });
    }

    async restart(): Promise<void> {
        this.dispose();
        await this.ensureStarted();
    }

    dispose(): void {
        try {
            this.connection?.dispose();
        } catch {
            /* ignore */
        }
        try {
            this.proc?.kill();
        } catch {
            /* ignore */
        }
        this.connection = undefined;
        this.proc = undefined;
        this.startPromise = undefined;
    }

    private ensureStarted(): Promise<void> {
        if (this.connection) {
            return Promise.resolve();
        }
        this.startPromise ??= this.start();
        return this.startPromise;
    }

    private async start(): Promise<void> {
        this.log(`Starting runner: ${this.dotnetPath} ${this.runnerPath}`);
        const proc = spawn(this.dotnetPath, [this.runnerPath], { stdio: ['pipe', 'pipe', 'pipe'] });
        this.proc = proc;

        proc.on('error', (err) => this.log(`Runner failed to start: ${err.message}`));
        proc.on('exit', (code) => {
            this.log(`Runner exited (code ${code}).`);
            this.connection?.dispose();
            this.connection = undefined;
            this.proc = undefined;
            this.startPromise = undefined;
        });
        proc.stderr.on('data', (chunk: Buffer) => this.log(chunk.toString().trimEnd()));

        const connection = createMessageConnection(
            new StreamMessageReader(proc.stdout),
            new StreamMessageWriter(proc.stdin),
        );
        connection.onError((err) => this.log(`RPC error: ${JSON.stringify(err[0])}`));
        connection.listen();
        this.connection = connection;

        const init = await connection.sendRequest('initialize', { clientProtocolVersion: 1 });
        this.log(`Runner initialized: ${JSON.stringify(init)}`);
    }
}
