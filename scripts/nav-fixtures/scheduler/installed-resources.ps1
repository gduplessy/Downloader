param([Parameter(Mandatory=$true)][uint32]$BrowserPid)
$navProcesses = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name
$navOwned = [System.Collections.Generic.HashSet[uint32]]::new()
[void]$navOwned.Add($BrowserPid)
do { $navAdded=$false; foreach($navProcess in $navProcesses){if($navOwned.Contains([uint32]$navProcess.ParentProcessId) -and $navOwned.Add([uint32]$navProcess.ProcessId)){$navAdded=$true}} } while($navAdded)
$navBrowserProcesses=@($navProcesses | Where-Object {$navOwned.Contains([uint32]$_.ProcessId) -and $_.Name -match '^(chrome|msedge|chromium|headless_shell)' } | ForEach-Object {Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue})
[pscustomobject]@{processes=$navBrowserProcesses.Count;working_set_mib=[Math]::Round(($navBrowserProcesses | Measure-Object WorkingSet64 -Sum).Sum/1MB,1);private_mib=[Math]::Round(($navBrowserProcesses | Measure-Object PrivateMemorySize64 -Sum).Sum/1MB,1)} | ConvertTo-Json -Compress
