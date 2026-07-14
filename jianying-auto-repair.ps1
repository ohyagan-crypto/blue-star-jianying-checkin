param(
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$Root = "C:\Users\Administrator\blue-star-jianying-checkin"
$Port = 8097
$LocalBase = "http://127.0.0.1:$Port"
$ConfigPath = Join-Path $Root "config.js"
$LogPath = Join-Path $Root "jianying-monitor.log"

function Write-Log {
    param([string]$Message)
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -LiteralPath $LogPath -Value "$stamp $Message" -Encoding UTF8
}

function Test-Url {
    param([string]$Url, [int]$TimeoutSec = 12)
    try {
        $res = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSec -Headers @{
            "Cache-Control" = "no-cache"
        }
        return [pscustomobject]@{ Ok = $true; Status = [int]$res.StatusCode; Body = [string]$res.Content }
    } catch {
        return [pscustomobject]@{ Ok = $false; Status = 0; Body = "" }
    }
}

function Get-ConfiguredBase {
    if (-not (Test-Path -LiteralPath $ConfigPath)) { return "" }
    $text = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8
    $match = [regex]::Match($text, 'JY_API_BASE\s*=\s*"([^"]+)"')
    if ($match.Success) { return $match.Groups[1].Value }
    return ""
}

function Set-ConfiguredBase {
    param([string]$BaseUrl)
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($ConfigPath, "window.JY_API_BASE = `"$BaseUrl`";`n", $utf8NoBom)
}

function Test-Backend {
    param([string]$BaseUrl)
    if ([string]::IsNullOrWhiteSpace($BaseUrl)) { return $false }
    $health = Test-Url "$BaseUrl/api/health" 15
    if (-not $health.Ok) { return $false }
    $roster = Test-Url "$BaseUrl/api/roster" 15
    if (-not $roster.Ok) { return $false }
    try {
        $json = $roster.Body | ConvertFrom-Json
        $sessionsText = (@($json.sessions) -join "|")
        return ($sessionsText.Contains("6/24") -and $sessionsText.Contains("7/1"))
    } catch {
        return $false
    }
}

function Ensure-LocalServer {
    if ((Test-Url "$LocalBase/api/health" 6).Ok) { return }
    $running = Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq "node.exe" -and $_.CommandLine -match "server\.js" -and $_.CommandLine -match "blue-star-jianying-checkin"
    }
    if (-not $running) {
        Start-Process -FilePath "node.exe" -ArgumentList "server.js" -WorkingDirectory $Root `
            -RedirectStandardOutput (Join-Path $Root "server.out.log") `
            -RedirectStandardError (Join-Path $Root "server.err.log") `
            -WindowStyle Hidden
    }
    Start-Sleep -Seconds 3
    if (-not (Test-Url "$LocalBase/api/health" 8).Ok) { throw "local backend down" }
}

function Start-PublicTunnel {
    Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq "cloudflared.exe" -and $_.CommandLine -match "8097"
    } | ForEach-Object {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {}
    }

    $errLog = Join-Path $Root "cloudflared-jy.err.log"
    $outLog = Join-Path $Root "cloudflared-jy.out.log"
    Remove-Item -LiteralPath $errLog, $outLog -Force -ErrorAction SilentlyContinue

    Start-Process -FilePath "C:\blue-course-checkin\cloudflared.exe" `
        -ArgumentList @("tunnel", "--url", $LocalBase, "--no-autoupdate", "--protocol", "http2") `
        -WorkingDirectory $Root `
        -RedirectStandardError $errLog `
        -RedirectStandardOutput $outLog `
        -WindowStyle Hidden

    $deadline = (Get-Date).AddSeconds(75)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        if (-not (Test-Path -LiteralPath $errLog)) { continue }
        $text = Get-Content -LiteralPath $errLog -Raw -Encoding UTF8
        $matches = [regex]::Matches($text, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($matches.Count -gt 0) {
            $url = $matches[$matches.Count - 1].Value
            if (Test-Backend $url) { return $url }
        }
    }
    throw "public tunnel failed"
}

function Publish-IfChanged {
    $status = git -C $Root status --short -- .gitignore index.html script.js styles.css config.js server.js jianying-auto-repair.ps1
    if ([string]::IsNullOrWhiteSpace(($status | Out-String))) { return "no-change" }
    git -C $Root add .gitignore index.html script.js styles.css config.js server.js jianying-auto-repair.ps1 | Out-Null
    git -C $Root commit -m "Keep Jianying black gold registration live" | Out-Null
    git -C $Root push origin main | Out-Null
    return "pushed"
}

try {
    Ensure-LocalServer
    $base = Get-ConfiguredBase
    if (-not (Test-Backend $base)) {
        Write-Log "public backend unavailable, repairing"
        $lastTunnelError = $null
        for ($attempt = 1; $attempt -le 5; $attempt++) {
            try {
                if ($attempt -gt 1) { Write-Log "retry public tunnel attempt=$attempt" }
                $base = Start-PublicTunnel
                $lastTunnelError = $null
                break
            } catch {
                $lastTunnelError = $_.Exception
                Write-Log ("public tunnel attempt " + $attempt + " failed")
                if ($attempt -lt 5) { Start-Sleep -Seconds (5 * $attempt) }
            }
        }
        if ($null -ne $lastTunnelError) { throw $lastTunnelError.Message }
        Set-ConfiguredBase $base
        $publish = Publish-IfChanged
        Write-Log "repair ok public=$base publish=$publish"
        if (-not $Quiet) { "OK repaired $base" }
    } else {
        Write-Log "ok public=$base"
        if (-not $Quiet) { "OK $base" }
    }
    exit 0
} catch {
    Write-Log ("failed " + $_.Exception.Message)
    if (-not $Quiet) { "FAILED " + $_.Exception.Message }
    exit 1
}
