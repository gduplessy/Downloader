param([Parameter(Mandatory)][string]$FixtureRoot, [switch]$Detach)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$allowed = [IO.Path]::GetFullPath((Join-Path $workspace '.local')) + [IO.Path]::DirectorySeparatorChar
$root = [IO.Path]::GetFullPath($FixtureRoot)
if (-not $root.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture must stay within workspace .local' }
$image = Join-Path $root 'filesystem.vhd'
if ($Detach) {
    if ((Get-DiskImage -ImagePath $image).Attached) { Dismount-DiskImage -ImagePath $image }
    exit
}
if (Test-Path -LiteralPath $image) { throw 'Refusing to reuse an existing image' }
$null = New-Item -ItemType Directory -Path $root -Force
$commands = Join-Path $root 'create-image.txt'
@("create vdisk file=`"$image`" maximum=128 type=expandable", "select vdisk file=`"$image`"", 'attach vdisk', 'exit') | Set-Content -LiteralPath $commands
$null = & diskpart.exe /s $commands
if ($LASTEXITCODE -ne 0) { throw 'Disposable image creation failed' }
try {
    $disk = Get-DiskImage -ImagePath $image | Get-Disk
    if ($disk.IsBoot -or $disk.IsSystem -or @('File Backed Virtual','FileBackedVirtual') -notcontains "$($disk.BusType)" -or $disk.Size -ne 128MB) { throw 'Refusing to format a disk that is not the newly created 128 MiB virtual image' }
    $null = Initialize-Disk -InputObject $disk -PartitionStyle MBR
    $partition = New-Partition -DiskNumber $disk.Number -UseMaximumSize -AssignDriveLetter
    $null = $partition | Get-Volume | Format-Volume -FileSystem NTFS -NewFileSystemLabel DownloaderFixture -Confirm:$false
    @{ volume = "$($partition.DriveLetter):\" } | ConvertTo-Json -Compress
} catch {
    Dismount-DiskImage -ImagePath $image
    throw
}
