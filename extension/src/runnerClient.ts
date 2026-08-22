import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import {
    CancellationToken,
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
    status: 'success' | 'compileError' | 'runtimeError' | 'infrastructureError' | 'cancelled';
    value?: ResultNode;
    dumps?: DumpNode[];
    diagnostics?: DiagnosticInfo[];
    error?: ErrorInfo;
    output?: string;
    outputTruncated?: boolean;
    sqlCommands?: SqlCommandInfo[];
    elapsedMs: number;
}

export interface DumpNode {
    label?: string;
    value: ResultNode;
    sqlCommands?: SqlCommandInfo[];
}

export interface SqlCommandInfo {
    order: number;
    text: string;
    commandType: string;
    parameters?: SqlParameterInfo[];
    elapsedMs?: number;
    succeeded?: boolean;
    error?: string;
}

export interface SqlParameterInfo {
    name: string;
    value?: string;
    dbType?: string;
    direction?: string;
}

export interface DbOptions {
    context?: string;
    provider?: string;
    connectionString?: string;
    contextFactoryType?: string;
    contextFactoryMethod?: string;
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
        private readonly cwd?: string,
    ) {}

    async execute(
        source: string,
        rowLimit: number,
        assemblies: string[],
        imports: string[],
        packages: string[],
        db: DbOptions,
        cancellationToken?: CancellationToken,
    ): Promise<ExecuteResult> {
        await this.ensureStarted();
        let forcedStop: NodeJS.Timeout | undefined;
        const cancellationSubscription = cancellationToken?.onCancellationRequested(() => {
            // A synchronous infinite loop cannot observe cancellation. Stop the dedicated runner
            // if it does not respond to the JSON-RPC cancellation request promptly.
            forcedStop = setTimeout(() => {
                this.log('Execution did not respond to cancellation; stopping runner.');
                this.dispose();
            }, 1000);
        });

        try {
            return await this.connection!.sendRequest<ExecuteResult>(
                'execute',
                { source, rowLimit, assemblies, imports, packages, ...db },
                cancellationToken,
            );
        } finally {
            cancellationSubscription?.dispose();
            if (forcedStop) {
                clearTimeout(forcedStop);
            }
        }
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
        const proc = spawn(this.dotnetPath, [this.runnerPath], { stdio: ['pipe', 'pipe', 'pipe'], cwd: this.cwd });
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
