# show-otp.ps1 — fetch the latest login OTP codes from the live E-Works server.
#
# Usage (from this folder in PowerShell):
#   .\show-otp.ps1                # show the most recent codes for any phone
#   .\show-otp.ps1 9944312345     # show codes for one phone number only
#
# Codes expire 5 minutes after "Send OTP" — enter the phone on the sign-in
# page first, then run this and type the code shown.
param([string]$Phone = '')

$pattern = if ($Phone) { "code for $Phone" } else { "\[otp:" }
$lines = ssh root@139.84.209.18 "docker logs -t marketplace-bff --since 10m 2>&1 | grep -E '$pattern' | tail -5"

if (-not $lines) {
    Write-Host "No OTP issued in the last 10 minutes. On the sign-in page, enter the phone number and press Send OTP first, then run this again." -ForegroundColor Yellow
    return
}

Write-Host ""
foreach ($line in $lines) {
    # e.g. 2026-07-15T07:50:12.123Z [otp:otp] code for 9944312345: 482913
    if ($line -match '^(\S+)\s+\[otp:(\w+)\] code for (\d+): (\d{6})$') {
        $when = ([datetime]$Matches[1]).ToLocalTime().ToString('HH:mm:ss')
        Write-Host ("  {0}  phone {1}  {2,-4} code: " -f $when, $Matches[3], $Matches[2].ToUpper()) -NoNewline
        Write-Host $Matches[4] -ForegroundColor Green
    } else {
        Write-Host "  $line"
    }
}
Write-Host ""
Write-Host "Newest is at the bottom. Codes expire 5 minutes after they were sent." -ForegroundColor DarkGray
