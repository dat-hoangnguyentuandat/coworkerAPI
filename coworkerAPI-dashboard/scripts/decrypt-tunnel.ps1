param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$config = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
if ($config.version -ne 1 -or $config.encryptedRuntimeApiKey -notmatch '^enc:' -or $config.encryptedStateKey -notmatch '^[A-Za-z0-9+/=]+$') { throw 'Invalid encrypted tunnel configuration' }
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$wrapped = [Convert]::FromBase64String($config.encryptedStateKey)
if ($wrapped.Length -lt 6 -or [System.Text.Encoding]::ASCII.GetString($wrapped,0,5) -ne 'DPAPI') { throw 'Unsupported encrypted state key' }
$key = [System.Security.Cryptography.ProtectedData]::Unprotect($wrapped[5..($wrapped.Length-1)], $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
$encrypted = [Convert]::FromBase64String($config.encryptedRuntimeApiKey.Substring(4))
if ($encrypted.Length -lt 32 -or [System.Text.Encoding]::ASCII.GetString($encrypted,0,3) -ne 'v10') { throw 'Unsupported encrypted tunnel key' }
$nonce = $encrypted[3..14]
$cipher = $encrypted[15..($encrypted.Length-17)]
$tag = $encrypted[($encrypted.Length-16)..($encrypted.Length-1)]
$plaintext = [byte[]]::new($cipher.Length)
$aes = [System.Security.Cryptography.AesGcm]::new($key,16)
try {
  $aes.Decrypt($nonce,$cipher,$tag,$plaintext)
  $runtimeKey = [System.Text.Encoding]::UTF8.GetString($plaintext)
  @{ tunnelId = $config.tunnelId; binaryPath = $config.binaryPath; runtimeApiKey = $runtimeKey } | ConvertTo-Json -Compress
} finally {
  $aes.Dispose()
  [Array]::Clear($plaintext,0,$plaintext.Length)
  [Array]::Clear($key,0,$key.Length)
}
