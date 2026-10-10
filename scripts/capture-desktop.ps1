param([int]$CaptureProcessId=0,[string]$Name='desktop')
$ErrorActionPreference='Stop'
if($Name -notmatch '^[a-z0-9-]+$'){throw 'Invalid capture name'}
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DownloaderCapture {
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT rect);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr insert,int x,int y,int cx,int cy,uint flags);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
}
'@
$process=if($CaptureProcessId){Get-Process -Id $CaptureProcessId}else{Get-Process downloader-desktop | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1}
if(!$process){throw 'Downloader window is not running'}
[DownloaderCapture]::ShowWindow($process.MainWindowHandle,9) | Out-Null
[DownloaderCapture]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
[DownloaderCapture]::SetWindowPos($process.MainWindowHandle,[IntPtr](-1),0,0,0,0,0x13) | Out-Null
Start-Sleep -Milliseconds 500
$rect=New-Object DownloaderCapture+RECT
[DownloaderCapture]::GetWindowRect($process.MainWindowHandle,[ref]$rect) | Out-Null
if($rect.Right-$rect.Left -lt 100 -or $rect.Bottom-$rect.Top -lt 100){throw 'Invalid window bounds'}
$bitmap=New-Object Drawing.Bitmap ($rect.Right-$rect.Left),($rect.Bottom-$rect.Top)
$graphics=[Drawing.Graphics]::FromImage($bitmap)
try{
 $dc=$graphics.GetHdc()
 try{if(![DownloaderCapture]::PrintWindow($process.MainWindowHandle,$dc,2)){throw 'Native window capture failed'}}finally{$graphics.ReleaseHdc($dc)}
 $destination=Join-Path $PSScriptRoot "../.local/evidence/$Name.png"
 [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
 $bitmap.Save($destination,[Drawing.Imaging.ImageFormat]::Png)
 Write-Output ([IO.Path]::GetFullPath($destination))
}finally{$graphics.Dispose();$bitmap.Dispose();[DownloaderCapture]::SetWindowPos($process.MainWindowHandle,[IntPtr](-2),0,0,0,0,0x13) | Out-Null}
