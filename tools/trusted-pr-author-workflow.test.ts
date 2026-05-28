import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'pr-vouch.yml');
const labelsPath = path.join(repoRoot, '.github', 'labels.yml');
const vouchedPath = path.join(repoRoot, '.github', 'VOUCHED.td');

const workflowText = readFileSync(workflowPath, 'utf8');
const labelsText = readFileSync(labelsPath, 'utf8');
const vouchedText = readFileSync(vouchedPath, 'utf8');

const trustedLabels = ['vouch: trusted', 'vouch: unvouched', 'vouch: denounced'] as const;
const allowedVouchedUsers = ['github:Neonsy'] as const;

function vouchedEntryLines(): string[] {
    return vouchedText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function isGitHubUsername(value: string): boolean {
    if (value.length < 1 || value.length > 39) return false;
    if (value.startsWith('-') || value.endsWith('-')) return false;

    for (const character of value) {
        const codePoint = character.codePointAt(0);
        if (codePoint === undefined) return false;
        const isDigit = codePoint >= 48 && codePoint <= 57;
        const isUppercaseLetter = codePoint >= 65 && codePoint <= 90;
        const isLowercaseLetter = codePoint >= 97 && codePoint <= 122;
        if (!isDigit && !isUppercaseLetter && !isLowercaseLetter && character !== '-') return false;
    }

    return true;
}

function workflowUsesValues(): string[] {
    return [...workflowText.matchAll(/^\s*uses:\s+(.+)$/gm)].map((match) => match[1]?.trim() ?? '');
}

function workflowRunLines(): string[] {
    return [...workflowText.matchAll(/^\s*run:\s+(.+)$/gm)].map((match) => match[1]?.trim() ?? '');
}

function parseVouchedEntry(line: string): { denounced: boolean; user: string; reason: string | null } | null {
    const denounced = line.startsWith('-github:');
    const prefix = denounced ? '-github:' : 'github:';
    if (!line.startsWith(prefix)) return null;

    const remainder = line.slice(prefix.length);
    const separatorIndex = remainder.search(/\s/);
    const username = separatorIndex === -1 ? remainder : remainder.slice(0, separatorIndex);
    const reason = separatorIndex === -1 ? null : remainder.slice(separatorIndex).trim();
    if (!isGitHubUsername(username)) return null;
    if (denounced && !reason) return null;
    if (!denounced && reason) return null;

    return {
        denounced,
        user: `github:${username}`,
        reason,
    };
}

describe('trusted PR author workflow', () => {
    it('uses only SHA-pinned external actions', () => {
        const usesValues = workflowUsesValues();

        expect(usesValues).toEqual([
            'actions/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd',
            'mitchellh/vouch/action/check-user@c6d80ead49839655b61b422700b7a3bc9d0804a9',
            'actions/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd',
        ]);
        expect(usesValues.every((use) => /@[a-f0-9]{40}$/.test(use))).toBe(true);
    });

    it('keeps workflow permissions limited to metadata reads and PR label writes', () => {
        expect(workflowText).toContain('permissions:\n  contents: read\n  issues: write\n  pull-requests: write');
        expect(workflowText).not.toContain('contents: write');
        expect(workflowText).not.toContain('actions: write');
        expect(workflowText).not.toContain('checks: write');
        expect(workflowText).not.toContain('statuses: write');
    });

    it('stays metadata-only and never checks out or executes PR code', () => {
        expect(workflowText).toContain('pull_request_target:');
        expect(workflowRunLines()).toEqual([]);
        expect(workflowText).not.toContain('actions/checkout');
        expect(workflowText).not.toContain('github.event.pull_request.head.ref');
        expect(workflowText).not.toContain('github.event.pull_request.head.sha');
        expect(workflowText).not.toContain('github.event.pull_request.head.repo');
        expect(workflowText).not.toContain('pullRequest.head');
        expect(workflowText).not.toContain('git checkout');
        expect(workflowText).not.toContain('git fetch');
        expect(workflowText).not.toContain('pnpm ');
        expect(workflowText).not.toContain('npm ');
        expect(workflowText).not.toContain('yarn ');
        expect(workflowText).not.toContain('bun ');
        expect(workflowText).not.toContain('npx ');
        expect(workflowText).not.toContain('corepack ');
    });

    it('does not use shared untrusted caches, artifacts, releases, publishing, or approval paths', () => {
        expect(workflowText).not.toContain('actions/cache');
        expect(workflowText).not.toContain('actions/upload-artifact');
        expect(workflowText).not.toContain('actions/download-artifact');
        expect(workflowText).not.toContain('peter-evans/create-pull-request');
        expect(workflowText).not.toContain('softprops/action-gh-release');
        expect(workflowText).not.toContain('github.rest.pulls.createReview');
        expect(workflowText).not.toContain('github.rest.pulls.merge');
        expect(workflowText).not.toContain('github.rest.repos.createRelease');
    });

    it('uses only GITHUB_TOKEN and does not fail normal CI for unknown authors', () => {
        expect(workflowText).toContain('allow-fail: true');
        expect([...workflowText.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1])).toEqual([
            'GITHUB_TOKEN',
        ]);
        expect(workflowText).not.toContain('auto-close');
        expect(workflowText).not.toContain('auto_close');
    });

    it('manages only the trusted author labels', () => {
        for (const label of trustedLabels) {
            expect(workflowText).toContain(`name: "${label}"`);
            expect(labelsText).toContain(`name: "${label}"`);
        }

        expect(labelsText.match(/name: "vouch:/g)?.length).toBe(3);
        expect(labelsText.match(/description: "Informational only:/g)?.length).toBeGreaterThanOrEqual(3);

        expect(labelsText).not.toContain('status: trusted-author');
        expect(labelsText).not.toContain('status: untrusted-author');
    });

    it('keeps the checked-in trust list explicit, minimal, sorted, and duplicate-free', () => {
        const entries = vouchedEntryLines();
        const normalizedEntries = entries.map((entry) => entry.toLowerCase());

        expect(vouchedText).toContain('github:username');
        expect(vouchedText).toContain('-github:username reason for denouncement');
        expect(entries).toEqual([...allowedVouchedUsers]);
        expect(normalizedEntries).toEqual([...normalizedEntries].sort());
        expect(new Set(normalizedEntries).size).toBe(normalizedEntries.length);
        expect(entries.map((entry) => parseVouchedEntry(entry))).toEqual([
            {
                denounced: false,
                user: 'github:Neonsy',
                reason: null,
            },
        ]);
    });

    it('rejects broad or malformed trust-list examples at the static parser boundary', () => {
        expect(parseVouchedEntry('github:*')).toBeNull();
        expect(parseVouchedEntry('github:@octocat')).toBeNull();
        expect(parseVouchedEntry('github:octocat extra trust note')).toBeNull();
        expect(parseVouchedEntry('-github:octocat')).toBeNull();
        expect(parseVouchedEntry('gitlab:octocat')).toBeNull();
        expect(parseVouchedEntry('github:octocat/repo')).toBeNull();
    });
});
