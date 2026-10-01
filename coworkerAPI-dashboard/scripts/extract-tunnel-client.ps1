param([Parameter(Mandatory=$true)][string]$ArchivePath, [Parameter(Mandatory=$true)][string]$DestinationPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
try {
  $entries = @($archive.Entries | Where-Object { ($_.FullName -split '[/\\]')[-1] -eq 'tunnel-client.exe' })
  if ($entries.Count -ne 1 -or $entries[0].Length -lt 1024 -or $entries[0].Length -gt 209715200) { throw 'Invalid tunnel archive' }
  # Extract only this file to the exact managed target, never arbitrary ZIP paths.
  $sourceStream = $entries[0].Open()
  $targetStream = [System.IO.File]::Open($DestinationPath, [System.IO.FileMode]::CreateNew)
  try { $sourceStream.CopyTo($targetStream) }
  finally { $sourceStream.Dispose(); $targetStream.Dispose() }
} finally { $archive.Dispose() }
