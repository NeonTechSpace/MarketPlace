import {
    defaultUpstreamMonitorReportPath,
    resolveUpstreamMonitorArgs,
    runUpstreamMonitor,
} from './lib/upstream-monitor.js';

const options = resolveUpstreamMonitorArgs(process.argv.slice(2), process.cwd());

runUpstreamMonitor({
    ...options,
    reportPath: options.reportPath ?? defaultUpstreamMonitorReportPath,
})
    .then((result) => {
        process.stdout.write(result.reportMarkdown);
        if (result.packages.some((pkg) => pkg.status === 'blocked')) {
            process.exitCode = 1;
        }
    })
    .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
