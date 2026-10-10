param([switch]$Accept,[switch]$Deny,[string]$ProfileName='browser-fixture-v4')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if($ProfileName -notmatch '^browser-fixture-v[0-9]+$'){throw 'Unexpected acceptance profile'}
$browserProcess=Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object {$_.CommandLine -like "*$ProfileName*" -and $_.CommandLine -notlike '*--type=*'} | Select-Object -First 1
if(!$browserProcess){throw 'Isolated acceptance browser is not running'}
$condition=New-Object Windows.Automation.PropertyCondition ([Windows.Automation.AutomationElement]::ProcessIdProperty),([int]$browserProcess.ProcessId)
$windows=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$condition)
foreach($window in $windows){
 Write-Output ("Window: "+$window.Current.Name)
 $children=$window.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
 $names=@($children | ForEach-Object {$_.Current.Name})
 foreach($child in $children){if($child.Current.ControlType -eq [Windows.Automation.ControlType]::Button -or $child.Current.ControlType -eq [Windows.Automation.ControlType]::Text){Write-Output ($child.Current.ControlType.ProgrammaticName+": "+$child.Current.Name)}}
 if($Deny){foreach($child in $children){if($child.Current.Name -eq 'Deny' -and !$child.Current.IsOffscreen){$child.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke();Write-Output 'Denied the broad permission request in the isolated test profile.';return;}}}
 $promptIndex=[Array]::FindIndex([string[]]$names,[Predicate[string]]{param($name) $name -like '*has requested additional permissions*'})
 $promptText=if($promptIndex -ge 0){$names[$promptIndex..($names.Count-1)] -join ' '}else{''}
 if($Accept -and $promptText -match 'Downloader' -and $promptText -match '127\.0\.0\.1' -and $promptText -notmatch 'all websites|browsing history'){
  foreach($child in $children){if($child.Current.Name -eq 'Allow' -and !$child.Current.IsOffscreen){$pattern=$child.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern);$pattern.Invoke();Write-Output 'Accepted the Downloader permission dialog in the isolated test profile.';return;}}
 }
}
