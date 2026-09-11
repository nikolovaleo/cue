const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Electron 33 embeds Node 20, which does not load Windows trusted roots.
// Read public CA certificates only; never bypass chain or hostname validation.
function readWindowsRoots() {
  const script = `
    $ErrorActionPreference = 'Stop'
    Import-Module "$PSHOME\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1"
    $blocked = @(Get-ChildItem Cert:\\CurrentUser\\Disallowed, Cert:\\LocalMachine\\Disallowed | ForEach-Object { $_.Thumbprint })
    Get-ChildItem Cert:\\CurrentUser\\Root, Cert:\\LocalMachine\\Root | ForEach-Object {
      $eku = @($_.EnhancedKeyUsageList | ForEach-Object { [string]$_.ObjectId })
      if ($blocked -notcontains $_.Thumbprint -and ($eku.Count -eq 0 -or $eku -contains '1.3.6.1.5.5.7.3.1' -or $eku -contains '2.5.29.37.0')) {
        '-----BEGIN CERTIFICATE-----'
        [Convert]::ToBase64String($_.RawData, [Base64FormattingOptions]::InsertLineBreaks)
        '-----END CERTIFICATE-----'
      }
    }
  `;
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return execFileSync(executable, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024,
  });
}

function createWebSocketTlsOptions({ platform = process.platform, readRoots = readWindowsRoots,
  defaultRoots = () => typeof tls.getCACertificates === 'function'
    ? tls.getCACertificates('default') : tls.rootCertificates,
  extraCaFile = process.env.NODE_EXTRA_CA_CERTS } = {}) {
  let cached;
  return function getOptions() {
    if (platform !== 'win32') return {};
    if (!cached) {
      const ca = [...defaultRoots()];
      const windowsRoots = readRoots();
      if (windowsRoots.trim()) ca.push(windowsRoots);
      // Explicit ca replaces Node's defaults, so retain an administrator's extras.
      if (extraCaFile) ca.push(fs.readFileSync(extraCaFile, 'utf8'));
      cached = { ca, rejectUnauthorized: true };
    }
    return { ...cached, ca: [...cached.ca] };
  };
}

module.exports = { createWebSocketTlsOptions, getWebSocketTlsOptions: createWebSocketTlsOptions() };
