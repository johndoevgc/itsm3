param(
    [string]$Slot = ''  # '' = production, 'staging' = staging slot
)
$ErrorActionPreference = 'Continue'
function Get-AdminHash {
    param([string]$SlotName)
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        if ($SlotName) {
            $v = az webapp config appsettings list --name vgc-itsm1-app --slot $SlotName --resource-group vgc-itsm-1-RG --query "[?name=='LOCAL_ADMIN_PASSWORD_HASH'].value | [0]" -o tsv 2>$null
        } else {
            $v = az webapp config appsettings list --name vgc-itsm1-app --resource-group vgc-itsm-1-RG --query "[?name=='LOCAL_ADMIN_PASSWORD_HASH'].value | [0]" -o tsv 2>$null
        }
        if ($v -and $v.Length -ge 64) { return $v }
        Start-Sleep -Seconds 2
    }
    return $null
}
$h = Get-AdminHash -SlotName $Slot
if ($Slot) { $base = "https://vgc-itsm1-app-$Slot.azurewebsites.net" } else { $base = 'https://vgc-itsm1-app.azurewebsites.net' }
if (-not $h) { Write-Host "ERR: no admin hash available for slot='$Slot'"; exit 1 }
$hdr = @{ Authorization = "Bearer local-hash:$h"; 'Content-Type' = 'application/json' }
Write-Host "Target: $base (slot='$Slot', hash-prefix=$($h.Substring(0,8)))"
$total = 0
for ($i = 1; $i -le 40; $i++) {
    try {
        $s = Invoke-RestMethod "$base/api/admin/data-hygiene/summary" -Headers $hdr -TimeoutSec 30
        $orph = $s.orphanedAiRows.totalOrphaned
        Write-Host "[r$i] orphan=$orph (purged so far: $total)"
        if ($orph -le 0) { break }
        $body = @{
            dryRun  = $false
            targets = @{
                ai_actions        = @($s.orphanedAiRows.byCollection.ai_actions.sampleIds)
                ai_resolve_queue  = @($s.orphanedAiRows.byCollection.ai_resolve_queue.sampleIds)
                ai_triage_history = @($s.orphanedAiRows.byCollection.ai_triage_history.sampleIds)
            }
        } | ConvertTo-Json -Depth 5
        $r = Invoke-RestMethod "$base/api/purge-test-data" -Method Post -Headers $hdr -Body $body -TimeoutSec 60 -ErrorAction Stop
        $total += $r.totalPurged
        Write-Host "       +$($r.totalPurged) purged"
    } catch {
        Write-Host "ERR r$i : $($_.Exception.Message)"
        Start-Sleep -Seconds 3
    }
}
Write-Host "==FINAL== totalPurged=$total"
$s2 = Invoke-RestMethod "$base/api/admin/data-hygiene/summary" -Headers $hdr -TimeoutSec 30
Write-Host "AFTER incidents=$($s2.incidents.total) orphan=$($s2.orphanedAiRows.totalOrphaned) drift=$($s2.priorityDrift.totalDrifted) audit=$($s2.auditLog.totalRows)"
