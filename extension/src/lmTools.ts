import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProfileManager } from './profiles';

/**
 * Language model tool that gives Copilot the `.linq`/`.csx` format spec plus the live,
 * secret-free list of Another LINQ Tool profiles, reusing {@link ProfileManager}.
 */
class LinqProfilesTool implements vscode.LanguageModelTool<Record<string, never>> {
    constructor(
        private readonly profiles: ProfileManager,
        private readonly instructionsPath: string,
    ) {}

    async invoke(
        _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
        _token: vscode.CancellationToken,
    ): Promise<vscode.LanguageModelToolResult> {
        const guide = this.readGuide();
        const profiles = await this.profiles.describeProfiles();
        const active = this.profiles.getActiveName() ?? null;
        const profilesJson = JSON.stringify({ activeProfile: active, profiles }, null, 2);

        const summary = profiles.length === 0
            ? 'No Another LINQ Tool profiles are configured. Scripts run with only the default imports and no database.'
            : `${profiles.length} profile(s) configured. Active profile: ${active ?? 'none'}.`;

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(guide),
            new vscode.LanguageModelTextPart(`\n\n## Available profiles\n\n${summary}\n\n\`\`\`json\n${profilesJson}\n\`\`\``),
        ]);
    }

    private readGuide(): string {
        try {
            return fs.readFileSync(this.instructionsPath, 'utf8');
        } catch {
            return 'Another LINQ Tool `.linq`/`.csx` files run C# via Roslyn scripting. See the extension documentation for the format.';
        }
    }
}

export function registerLanguageModelTools(
    context: vscode.ExtensionContext,
    profiles: ProfileManager,
): void {
    if (!vscode.lm?.registerTool) {
        return;
    }
    const instructionsPath = path.join(context.extensionPath, 'instructions', 'linq-csx.md');
    context.subscriptions.push(
        vscode.lm.registerTool('another-linq-tool_getProfiles', new LinqProfilesTool(profiles, instructionsPath)),
    );
}
