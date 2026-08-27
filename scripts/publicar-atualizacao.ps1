[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$')]
  [string]$Version,

  [string]$Notes = "Melhorias e correções no Workdeck.",

  [string]$ReleaseDirectory = (Join-Path $PSScriptRoot "..\releases"),

  [string]$WindowsInstaller = "",
  [string]$WindowsSignature = "",
  [string]$MacIntelArchive = "",
  [string]$MacIntelSignature = "",
  [string]$MacArmArchive = "",
  [string]$MacArmSignature = ""
)

$ErrorActionPreference = "Stop"
$releaseRoot = [System.IO.Path]::GetFullPath($ReleaseDirectory)
[System.IO.Directory]::CreateDirectory($releaseRoot) | Out-Null

if (-not $WindowsInstaller) {
  $defaultInstaller = Join-Path $PSScriptRoot "..\src-tauri\target\release\bundle\nsis\Workdeck_${Version}_x64-setup.exe"
  if (Test-Path -LiteralPath $defaultInstaller) { $WindowsInstaller = $defaultInstaller }
}
if ($WindowsInstaller -and -not $WindowsSignature) { $WindowsSignature = "$WindowsInstaller.sig" }

$platforms = [ordered]@{}

function Add-ReleasePlatform {
  param([string]$Key, [string]$Artifact, [string]$Signature)
  if (-not $Artifact) { return }
  if (-not (Test-Path -LiteralPath $Artifact -PathType Leaf)) { throw "Artefato não encontrado: $Artifact" }
  if (-not (Test-Path -LiteralPath $Signature -PathType Leaf)) { throw "Assinatura não encontrada: $Signature" }
  $artifactName = [System.IO.Path]::GetFileName($Artifact)
  Copy-Item -LiteralPath $Artifact -Destination (Join-Path $releaseRoot $artifactName) -Force
  $platforms[$Key] = [ordered]@{
    file = $artifactName
    signature = (Get-Content -LiteralPath $Signature -Raw).Trim()
  }
}

Add-ReleasePlatform "windows-x86_64" $WindowsInstaller $WindowsSignature
Add-ReleasePlatform "darwin-x86_64" $MacIntelArchive $MacIntelSignature
Add-ReleasePlatform "darwin-aarch64" $MacArmArchive $MacArmSignature

if ($platforms.Count -eq 0) { throw "Nenhum instalador assinado foi informado ou encontrado." }

$manifest = [ordered]@{
  version = $Version
  notes = $Notes
  pub_date = [DateTime]::UtcNow.ToString("o")
  platforms = $platforms
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $releaseRoot "latest.json") -Encoding utf8
Write-Host "Release $Version pronta em $releaseRoot"
Write-Host "Envie essa pasta para a VPS mantendo os mesmos nomes de arquivo."
