param([ValidateSet('protect','unprotect')][string]$Mode)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -eq 'Desktop') { Add-Type -AssemblyName System.Security }
else { Add-Type -AssemblyName System.Security.Cryptography.ProtectedData }
$inputValue = [Console]::In.ReadToEnd()
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
if ($Mode -eq 'protect') {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($inputValue)
  try { [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)) }
  finally { [Array]::Clear($bytes, 0, $bytes.Length) }
} else {
  $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($inputValue), $null, $scope)
  try { [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($bytes)) }
  finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}
