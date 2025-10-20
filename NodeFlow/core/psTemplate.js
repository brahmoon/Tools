export function wrapPowerShellScript(body) {
  const timestamp = new Date().toISOString();
  const header = `# Generated with PowerShell Visual Builder\n# ${timestamp}`;
  const bootstrap = `
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
`;
  const scriptBody = body || '# Flow contains no executable steps';
  return [header, bootstrap.trim(), scriptBody.trim()].join('\n\n').trim() + '\n';
}
